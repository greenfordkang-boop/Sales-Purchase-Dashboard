
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { BomRecord, YieldRow, PnMapping, parseBomCSV, parseBomExcel, parsePnMappingFromExcel, parseMaterialMasterExcel, buildBomRelations, expandBomToLeaves } from '../utils/bomDataParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { bomMasterService, itemRevenueService, purchaseService } from '../services/supabaseService';

const STATUS_COLORS: Record<YieldRow['status'], string> = {
  normal: '#10b981',
  over: '#ef4444',
  under: '#f59e0b',
  noMatch: '#94a3b8',
  otherPeriod: '#8b5cf6',
  zeroInput: '#64748b',
  rawMatch: '#3b82f6',
};

const STATUS_LABELS: Record<YieldRow['status'], string> = {
  normal: '정상',
  over: '과투입',
  under: '미달',
  noMatch: '미매칭',
  otherPeriod: '기간외',
  zeroInput: '무입고',
  rawMatch: '원재료',
};

const MaterialYieldView: React.FC = () => {
  // --- State ---
  const [bomData, setBomData] = useState<BomRecord[]>([]);
  const [pnMapping, setPnMapping] = useState<PnMapping[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>('All');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterPn, setFilterPn] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [tableOpen, setTableOpen] = useState(true);

  // --- Load BOM + 품번 매핑: bom_master 우선 → 기존 bom_data 폴백 ---
  useEffect(() => {
    const g = window as any;
    if (!g.__dashboardCache) g.__dashboardCache = {};
    const getStored = (key: string) => localStorage.getItem(key) || sessionStorage.getItem(key);

    // BOM 마스터 우선 로드
    const bomMasterRaw = getStored('dashboard_bomMasterData');
    if (bomMasterRaw) {
      try {
        const masterRecords = JSON.parse(bomMasterRaw);
        // BomMasterRecord → BomRecord 변환
        const converted: BomRecord[] = masterRecords.map((r: any) => ({
          parentPn: r.parentPn, childPn: r.childPn, level: r.level,
          qty: r.qty, childName: r.childName, supplier: r.supplier, partType: r.partType,
        }));
        setBomData(converted);
        g.__dashboardCache.bomData = converted;
      } catch { /* ignore */ }
    } else {
      const storedBom = getStored('dashboard_bomData');
      if (storedBom) {
        try {
          const parsed = JSON.parse(storedBom);
          setBomData(parsed);
          g.__dashboardCache.bomData = parsed;
        } catch { /* ignore */ }
      }
    }

    // 품번 매핑: 기준정보 마스터에서 자동 생성 or 기존 pnMapping 폴백
    const refInfoRaw = getStored('dashboard_referenceInfoMaster');
    if (refInfoRaw) {
      try {
        const refInfo = JSON.parse(refInfoRaw);
        const autoMapping: PnMapping[] = refInfo
          .filter((ri: any) => ri.itemCode && ri.customerPn)
          .map((ri: any) => ({
            customerPn: ri.customerPn,
            internalCode: ri.itemCode,
            partName: ri.itemName || '',
            rawMaterialCode1: ri.rawMaterialCode1 || undefined,
            rawMaterialCode2: ri.rawMaterialCode2 || undefined,
            supplyType: ri.supplyType || undefined,
            processType: ri.processType || undefined,
          }));
        if (autoMapping.length > 0) {
          setPnMapping(autoMapping);
          g.__dashboardCache.pnMapping = autoMapping;
        }
      } catch { /* ignore */ }
    }
    if (pnMapping.length === 0) {
      const storedMapping = getStored('dashboard_pnMapping');
      if (storedMapping) {
        try {
          const parsed = JSON.parse(storedMapping);
          setPnMapping(parsed);
          g.__dashboardCache.pnMapping = parsed;
        } catch { /* ignore */ }
      }
    }

    // dashboard-data-updated 이벤트 리스너 (BOM 마스터 업로드 시 자동 갱신)
    const handleMasterUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.type === 'bomMaster') {
        // 재로드
        const raw = localStorage.getItem('dashboard_bomMasterData');
        if (raw) {
          try {
            const records = JSON.parse(raw);
            const conv: BomRecord[] = records.map((r: any) => ({
              parentPn: r.parentPn, childPn: r.childPn, level: r.level,
              qty: r.qty, childName: r.childName, supplier: r.supplier, partType: r.partType,
            }));
            setBomData(conv);
          } catch { /* */ }
        }
      }
    };
    window.addEventListener('dashboard-data-updated', handleMasterUpdate);
    return () => window.removeEventListener('dashboard-data-updated', handleMasterUpdate);
  }, []);

  // --- Smart Supabase Load (폴백) ---
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;
      // bom_master가 이미 로드되었으면 스킵
      if (bomData.length > 0) return;
      try {
        const masterData = await bomMasterService.getAll();
        if (masterData && masterData.length > 0) {
          const converted: BomRecord[] = masterData.map(r => ({
            parentPn: r.parentPn, childPn: r.childPn, level: r.level,
            qty: r.qty, childName: r.childName, supplier: r.supplier, partType: r.partType,
          }));
          setBomData(converted);
          const g = window as any;
          if (!g.__dashboardCache) g.__dashboardCache = {};
          g.__dashboardCache.bomData = converted;
          try { localStorage.setItem('dashboard_bomData', JSON.stringify(converted)); } catch { /* quota */ }
        }
      } catch (err) {
        console.error('BOM Supabase 로드 실패:', err);
      }
    };
    loadFromSupabase();
  }, [bomData.length]);

  // --- Load Sales & Purchase (서비스에서 직접 로드) ---
  const [itemRevenueData, setItemRevenueData] = useState<ItemRevenueRow[]>([]);
  const [purchaseData, setPurchaseDataLocal] = useState<PurchaseItem[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const revData = await itemRevenueService.getAll();
        setItemRevenueData(revData);
        console.log(`[자재수율] 매출 데이터: ${revData.length}건`);
      } catch (err) {
        console.error('[자재수율] 매출 데이터 로드 실패:', err);
      }
      try {
        const purData = await purchaseService.getAll();
        setPurchaseDataLocal(purData);
        console.log(`[자재수율] 구매 데이터: ${purData.length}건`);
      } catch (err) {
        console.error('[자재수율] 구매 데이터 로드 실패:', err);
      }
    };

    loadData();

    // 다른 컴포넌트에서 데이터 업데이트 시 재로드
    const onUpdate = () => setTimeout(() => loadData(), 500);
    window.addEventListener('storage', onUpdate);
    window.addEventListener('dashboard-data-updated', onUpdate);
    return () => {
      window.removeEventListener('storage', onUpdate);
      window.removeEventListener('dashboard-data-updated', onUpdate);
    };
  }, []);

  // --- Available Years ---
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    purchaseData.forEach(d => years.add(d.year));
    itemRevenueData.forEach(d => {
      const m = d.period?.match(/(\d{4})/);
      if (m) years.add(parseInt(m[1]));
    });
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort();
  }, [purchaseData, itemRevenueData]);

  // --- period에서 월 추출 ---
  const extractMonth = (period: string): string | null => {
    if (!period) return null;
    // "2025-01" or "01" or "1월" or "01월"
    const dashMatch = period.match(/\d{4}-(\d{1,2})/);
    if (dashMatch) return dashMatch[1].padStart(2, '0') + '월';
    const monthMatch = period.match(/^(\d{1,2})$/);
    if (monthMatch) return monthMatch[1].padStart(2, '0') + '월';
    const kwolMatch = period.match(/(\d{1,2})월/);
    if (kwolMatch) return kwolMatch[1].padStart(2, '0') + '월';
    return null;
  };

  // --- 품번 정규화 (공백, 하이픈, 대소문자 통일) ---
  const normalizePn = (pn: string): string =>
    pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

  // --- 수율 계산 (핵심 로직) ---
  const { yieldRows, bomMissingCount, debugInfo } = useMemo(() => {
    if (bomData.length === 0) return { yieldRows: [] as YieldRow[], bomMissingCount: 0, debugInfo: null };

    // 품번 매핑: 양방향 + 다중값 (정규화된 키)
    const custToInternal = new Map<string, string>();
    const internalToCust = new Map<string, string>();
    // 다중값 브릿지: 하나의 고객사P/N에 여러 내부코드 가능
    const custToInternals = new Map<string, Set<string>>();
    const internalToCusts = new Map<string, Set<string>>();
    // 원재료코드 매핑: 품목코드 → 원재료코드1/2
    const itemToRawMaterial = new Map<string, string[]>();
    // 품명 조회 맵: 정규화된 코드 → partName (BOM childName 빈 경우 fallback용)
    const partNameLookup = new Map<string, string>();
    pnMapping.forEach(m => {
      const cust = normalizePn(m.customerPn);
      const internal = normalizePn(m.internalCode);
      if (cust) {
        custToInternal.set(cust, internal);
        internalToCust.set(internal, cust);
        // 다중값
        if (!custToInternals.has(cust)) custToInternals.set(cust, new Set());
        custToInternals.get(cust)!.add(internal);
        if (!internalToCusts.has(internal)) internalToCusts.set(internal, new Set());
        internalToCusts.get(internal)!.add(cust);
      }
      // 품명 조회 맵 구축 (내부코드, 고객사P/N 양쪽 키)
      if (m.partName) {
        if (internal) partNameLookup.set(internal, m.partName);
        if (cust) partNameLookup.set(cust, m.partName);
      }
      // 원재료코드 매핑 구축
      const rawCodes: string[] = [];
      if (m.rawMaterialCode1) rawCodes.push(normalizePn(m.rawMaterialCode1));
      if (m.rawMaterialCode2) rawCodes.push(normalizePn(m.rawMaterialCode2));
      if (rawCodes.length > 0) itemToRawMaterial.set(internal, rawCodes);
    });

    // BOM relations를 정규화된 키로 빌드
    const rawRelations = buildBomRelations(bomData);
    const bomRelations = new Map<string, typeof bomData>();
    for (const [key, val] of rawRelations) {
      bomRelations.set(normalizePn(key), val);
    }

    // 1) 매출 데이터를 partNo별로 집계 (연도/월 필터 적용)
    //    매출 partNo(고객사P/N) → 내부코드 변환 시도
    const salesByPart = new Map<string, number>();
    itemRevenueData.forEach(row => {
      // 연도 필터
      const yearMatch = row.period?.match(/(\d{4})/);
      if (yearMatch && parseInt(yearMatch[1]) !== selectedYear) return;

      // 월 필터
      if (selectedMonth !== 'All') {
        const month = extractMonth(row.period);
        if (month && month !== selectedMonth) return;
      }

      const rawPn = normalizePn(row.partNo || '');
      if (!rawPn) return;

      // 매핑 변환: 고객사P/N → 내부코드, 없으면 원본 사용
      const pn = custToInternal.get(rawPn) || rawPn;
      salesByPart.set(pn, (salesByPart.get(pn) || 0) + (row.qty || 0));
    });

    // 2) BOM 전개 → 자재별 표준소요량
    interface ChildAccum {
      childName: string;
      supplier: string;
      totalRequired: number;
      parentProducts: Set<string>;
    }
    const childMap = new Map<string, ChildAccum>();
    let missingCount = 0;

    for (const [partNo, salesQty] of salesByPart) {
      if (!bomRelations.has(partNo)) {
        missingCount++;
        continue;
      }
      const leaves = expandBomToLeaves(partNo, salesQty, bomRelations);
      for (const leaf of leaves) {
        const normalizedChild = normalizePn(leaf.childPn);
        // 품명: partNameLookup(개별 품명) 우선, BOM childName(모품목명일 수 있음) fallback
        const resolvedName = partNameLookup.get(normalizedChild) || leaf.childName || '';
        const existing = childMap.get(normalizedChild);
        if (existing) {
          existing.totalRequired += leaf.totalRequired;
          existing.parentProducts.add(partNo);
          // 기존 이름이 비어있고 새로 찾은 이름이 있으면 갱신
          if (!existing.childName && resolvedName) {
            existing.childName = resolvedName;
          }
        } else {
          childMap.set(normalizedChild, {
            childName: resolvedName,
            supplier: leaf.supplier,
            totalRequired: leaf.totalRequired,
            parentProducts: new Set([partNo]),
          });
        }
      }
    }

    // 3) 구매입고를 itemCode별로 집계 (연도/월 필터 적용, 정규화)
    //    + 양방향 매핑 + 구매 고객사P/N 직접 등록
    const inputByCode = new Map<string, number>();
    purchaseData.forEach(item => {
      if (item.year !== selectedYear) return;
      if (selectedMonth !== 'All' && item.month !== selectedMonth) return;
      const code = normalizePn(item.itemCode || '');
      if (!code) return;
      inputByCode.set(code, (inputByCode.get(code) || 0) + (item.qty || 0));
      // 내부코드 → 고객사P/N 역매핑 키 등록
      const custPn = internalToCust.get(code);
      if (custPn) {
        inputByCode.set(custPn, (inputByCode.get(custPn) || 0) + (item.qty || 0));
      }
      // 구매 CSV의 고객사P/N(col6) 직접 등록
      const rawCustPn = normalizePn(item.customerPn || '');
      if (rawCustPn && rawCustPn !== code) {
        inputByCode.set(rawCustPn, (inputByCode.get(rawCustPn) || 0) + (item.qty || 0));
      }
    });

    // 3-b) 구매입고 전체(기간 무관) — 미매칭 vs 기간외 판별용
    //    역매핑 + 구매 고객사P/N 포함
    const allInputCodes = new Set<string>();
    purchaseData.forEach(item => {
      const code = normalizePn(item.itemCode || '');
      if (code) {
        allInputCodes.add(code);
        const custPn = internalToCust.get(code);
        if (custPn) allInputCodes.add(custPn);
      }
      // 구매 CSV의 고객사P/N 직접 추가
      const rawCustPn = normalizePn(item.customerPn || '');
      if (rawCustPn) allInputCodes.add(rawCustPn);
    });

    // 4) 매칭하여 수율 산출 (다중 매칭 전략)
    const rows: YieldRow[] = [];
    let directMatchCount = 0;
    let mappedMatchCount = 0;
    let noMatchSamples: string[] = [];

    for (const [childPn, accum] of childMap) {
      const normalized = normalizePn(childPn);
      let inputQty = 0;
      let matched = false;

      // 전략 1: 직접 매칭 (childPn == itemCode)
      if (inputByCode.has(normalized)) {
        inputQty = inputByCode.get(normalized) || 0;
        matched = true;
        directMatchCount++;
      }

      // 전략 2: childPn이 고객사P/N → 내부코드로 변환하여 재시도
      if (!matched) {
        const asInternal = custToInternal.get(normalized);
        if (asInternal && inputByCode.has(asInternal)) {
          inputQty = inputByCode.get(asInternal) || 0;
          matched = true;
          mappedMatchCount++;
        }
      }

      // 전략 3: childPn이 내부코드 → 고객사P/N으로 변환하여 재시도
      if (!matched) {
        const asCust = internalToCust.get(normalized);
        if (asCust && inputByCode.has(asCust)) {
          inputQty = inputByCode.get(asCust) || 0;
          matched = true;
          mappedMatchCount++;
        }
      }

      // 전략 4: 고객사P/N 브릿지 (다중값)
      // childPn → 고객사P/N(들) → 해당 P/N의 모든 내부코드 → 구매 데이터 검색
      if (!matched) {
        // childPn이 내부코드인 경우: 내부코드 → 고객사P/N(들) → 다른 내부코드들
        const custPns = internalToCusts.get(normalized);
        if (custPns) {
          for (const cp of custPns) {
            const allInternals = custToInternals.get(cp);
            if (allInternals) {
              for (const ic of allInternals) {
                if (ic !== normalized && inputByCode.has(ic)) {
                  inputQty = inputByCode.get(ic) || 0;
                  matched = true;
                  mappedMatchCount++;
                  break;
                }
              }
            }
            if (matched) break;
          }
        }
        // childPn이 고객사P/N인 경우: 고객사P/N → 모든 내부코드
        if (!matched) {
          const allInternals = custToInternals.get(normalized);
          if (allInternals) {
            for (const ic of allInternals) {
              if (inputByCode.has(ic)) {
                inputQty = inputByCode.get(ic) || 0;
                matched = true;
                mappedMatchCount++;
                break;
              }
            }
          }
        }
      }

      // 전략 5: 원재료코드 브릿지 (공급관계 확인만, 수율 계산 불가)
      let rawMatched = false;
      if (!matched) {
        const rawCodes = itemToRawMaterial.get(normalized);
        if (rawCodes) {
          for (const rc of rawCodes) {
            if (inputByCode.has(rc)) {
              rawMatched = true;
              mappedMatchCount++;
              break;
            }
          }
        }
      }

      const standardReq = accum.totalRequired;
      let yieldRate = 0;
      let status: YieldRow['status'] = 'noMatch';

      if (rawMatched && !matched) {
        // 전략 5: 원재료코드 매칭 (공급관계는 확인됐으나 부품별 수율 계산 불가)
        status = 'rawMatch';
      } else if (standardReq > 0 && inputQty > 0) {
        yieldRate = (inputQty / standardReq) * 100;
        if (yieldRate >= 95 && yieldRate <= 105) status = 'normal';
        else if (yieldRate > 105) status = 'over';
        else status = 'under';
      } else if (inputQty === 0) {
        // matched but qty=0 처리
        if (matched) {
          status = 'zeroInput';
        } else {
          // allInputCodes에서도 다중 매칭 시도 (전략 1~4 동일)
          let foundInAll = allInputCodes.has(normalized);
          if (!foundInAll) {
            const asInternal = custToInternal.get(normalized);
            if (asInternal && allInputCodes.has(asInternal)) foundInAll = true;
          }
          if (!foundInAll) {
            const asCust = internalToCust.get(normalized);
            if (asCust && allInputCodes.has(asCust)) foundInAll = true;
          }
          // 브릿지: 고객사P/N 경유 다중 내부코드 검색
          if (!foundInAll) {
            const custPns = internalToCusts.get(normalized);
            if (custPns) {
              for (const cp of custPns) {
                const allInternals = custToInternals.get(cp);
                if (allInternals) {
                  for (const ic of allInternals) {
                    if (allInputCodes.has(ic)) { foundInAll = true; break; }
                  }
                }
                if (foundInAll) break;
              }
            }
          }
          if (!foundInAll) {
            const allInternals = custToInternals.get(normalized);
            if (allInternals) {
              for (const ic of allInternals) {
                if (allInputCodes.has(ic)) { foundInAll = true; break; }
              }
            }
          }
          // 원재료코드 브릿지로 기간외 판별
          if (!foundInAll) {
            const rawCodes = itemToRawMaterial.get(normalized);
            if (rawCodes) {
              for (const rc of rawCodes) {
                if (allInputCodes.has(rc)) { foundInAll = true; break; }
              }
            }
          }

          if (foundInAll) {
            status = 'otherPeriod';
          } else {
            status = 'noMatch';
            if (noMatchSamples.length < 20) noMatchSamples.push(normalized);
          }
        }
      }

      rows.push({
        childPn,
        childName: accum.childName,
        supplier: accum.supplier,
        parentProducts: Array.from(accum.parentProducts),
        standardReq: Math.round(standardReq * 100) / 100,
        inputQty,
        yieldRate: Math.round(yieldRate * 10) / 10,
        diff: Math.round((inputQty - standardReq) * 100) / 100,
        status,
      });
    }

    // 진단 정보
    const purchaseSamples = Array.from(new Set(
      purchaseData.slice(0, 50).map(p => normalizePn(p.itemCode || '')).filter(Boolean)
    )).slice(0, 20);

    // 다중값 매핑 통계
    const uniqueCustPns = custToInternals.size;
    const multiMappedCust = Array.from(custToInternals.values()).filter(s => s.size > 1).length;

    const debug = {
      totalLeafMaterials: childMap.size,
      directMatchCount,
      rawMaterialMappingCount: itemToRawMaterial.size,
      mappedMatchCount,
      rawMatchCount: rows.filter(r => r.status === 'rawMatch').length,
      noMatchCount: rows.filter(r => r.status === 'noMatch').length,
      otherPeriodCount: rows.filter(r => r.status === 'otherPeriod').length,
      noMatchSamples,
      purchaseSamples,
      mappingSize: pnMapping.length,
      uniqueCustPns,
      multiMappedCust,
      childInMapping: Array.from(childMap.keys()).filter(k => custToInternal.has(k) || internalToCust.has(k)).length,
    };
    console.log('[자재수율 진단]', debug);

    return { yieldRows: rows, bomMissingCount: missingCount, debugInfo: debug };
  }, [bomData, pnMapping, itemRevenueData, purchaseData, selectedYear, selectedMonth]);

  // --- Filtered & Sorted rows ---
  const displayRows = useMemo(() => {
    let result = yieldRows.filter(row => {
      if (filterPn && !row.childPn.toLowerCase().includes(filterPn.toLowerCase())) return false;
      if (filterName && !row.childName.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterSupplier && !row.supplier.toLowerCase().includes(filterSupplier.toLowerCase())) return false;
      if (filterStatus !== 'All' && row.status !== filterStatus) return false;
      return true;
    });

    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal || '').toLowerCase();
        const bStr = String(bVal || '').toLowerCase();
        if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [yieldRows, filterPn, filterName, filterSupplier, filterStatus, sortConfig]);

  // --- Summary Metrics ---
  const isNoDataStatus = (s: YieldRow['status']) => s === 'noMatch' || s === 'otherPeriod' || s === 'zeroInput' || s === 'rawMatch';
  const metrics = useMemo(() => {
    const total = yieldRows.length;
    const withData = yieldRows.filter(r => !isNoDataStatus(r.status));
    const avgYield = withData.length > 0
      ? withData.reduce((s, r) => s + r.yieldRate, 0) / withData.length
      : 0;
    const overCount = yieldRows.filter(r => r.status === 'over').length;
    const noMatchCount = yieldRows.filter(r => r.status === 'noMatch').length;
    const otherPeriodCount = yieldRows.filter(r => r.status === 'otherPeriod').length;
    const zeroInputCount = yieldRows.filter(r => r.status === 'zeroInput').length;
    const rawMatchCount = yieldRows.filter(r => r.status === 'rawMatch').length;
    return { total, avgYield, overCount, noMatchCount, otherPeriodCount, zeroInputCount, rawMatchCount };
  }, [yieldRows]);

  // --- Chart Data ---
  const deviationChartData = useMemo(() => {
    return [...yieldRows]
      .filter(r => !isNoDataStatus(r.status))
      .sort((a, b) => Math.abs(b.yieldRate - 100) - Math.abs(a.yieldRate - 100))
      .slice(0, 15)
      .map(r => ({
        name: r.childPn.length > 12 ? r.childPn.slice(0, 12) + '...' : r.childPn,
        deviation: Math.round((r.yieldRate - 100) * 10) / 10,
        fill: r.status === 'over' ? '#ef4444' : r.status === 'under' ? '#f59e0b' : '#10b981',
      }));
  }, [yieldRows]);

  const statusPieData = useMemo(() => {
    const counts: Record<string, number> = { normal: 0, over: 0, under: 0, noMatch: 0, otherPeriod: 0, zeroInput: 0, rawMatch: 0 };
    yieldRows.forEach(r => counts[r.status]++);
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({
        name: STATUS_LABELS[k as YieldRow['status']],
        value: v,
        color: STATUS_COLORS[k as YieldRow['status']],
      }));
  }, [yieldRows]);

  // --- Handlers ---
  const handleBomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      // CSV: 인코딩 자동 감지
      const readAsEncoding = (encoding: string): Promise<string> =>
        new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = ev => resolve((ev.target?.result as string) || '');
          reader.readAsText(file, encoding);
        });

      let text = await readAsEncoding('utf-8');
      const broken = (text.match(/�|Ã.|Â./g) || []).length / text.length;
      if (broken > 0.01) text = await readAsEncoding('euc-kr');

      const records = parseBomCSV(text);
      if (records.length === 0) {
        alert('BOM CSV 파싱 실패: 필수 컬럼(모품번, 자품번)을 확인해주세요.');
        e.target.value = '';
        return;
      }
      saveBomData(records);
    } else {
      // Excel
      const buffer = await file.arrayBuffer();
      const records = parseBomExcel(buffer);
      if (records.length === 0) {
        alert('BOM 엑셀 파싱 실패: 필수 컬럼(모품번, 자품번)을 확인해주세요.');
        e.target.value = '';
        return;
      }
      saveBomData(records);
    }

    e.target.value = '';
  };

  const saveBomData = async (records: BomRecord[]) => {
    setBomData(records);
    // 글로벌 캐시에 항상 저장 (localStorage 실패해도 다른 탭에서 접근 가능)
    const g = window as any;
    if (!g.__dashboardCache) g.__dashboardCache = {};
    g.__dashboardCache.bomData = records;
    // BOM 필수 필드만 저장 (용량 절약)
    const compactBom = records.map(r => ({
      parentPn: r.parentPn, childPn: r.childPn, level: r.level, qty: r.qty,
      childName: r.childName, supplier: r.supplier, partType: r.partType,
    }));
    const bomJson = JSON.stringify(compactBom);
    try {
      localStorage.setItem('dashboard_bomData', bomJson);
    } catch {
      console.warn('BOM localStorage 저장 실패, 용량 확보 시도');
      try {
        localStorage.removeItem('dashboard_standardMaterial');
        localStorage.removeItem('dashboard_forecastData_prev');
        localStorage.removeItem('dashboard_forecastData_prev_summary');
        localStorage.setItem('dashboard_bomData', bomJson);
      } catch (e2) {
        console.error('BOM localStorage 최종 실패, sessionStorage 사용:', e2);
        try { sessionStorage.setItem('dashboard_bomData', bomJson); } catch { /* */ }
      }
    }
    // CustomEvent로 데이터 직접 전달 (localStorage 실패해도 동작)
    window.dispatchEvent(new CustomEvent('dashboard-data-updated', {
      detail: { key: 'dashboard_bomData', data: records }
    }));

    if (isSupabaseConfigured()) {
      try {
        await bomMasterService.saveAll(records);
        console.log(`BOM Supabase 동기화 완료: ${records.length}건`);
      } catch (err) {
        console.error('BOM Supabase 동기화 실패:', err);
      }
    }

    alert(`BOM 데이터 ${records.length}건이 업로드되었습니다.`);
  };

  const handleMappingFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    // 1차: 표준재료비 형식 시도
    let mappings = parsePnMappingFromExcel(buffer);
    let source = '표준재료비';
    // 2차: 자재마스터 통합 형식 시도
    if (mappings.length === 0) {
      mappings = parseMaterialMasterExcel(buffer);
      source = '자재마스터';
    }

    if (mappings.length === 0) {
      alert('품번 매핑 파싱 실패: 품목코드, 고객사 P/N 컬럼을 확인해주세요.');
      e.target.value = '';
      return;
    }

    // 기존 매핑과 병합 (새 데이터 우선)
    if (pnMapping.length > 0) {
      const existingMap = new Map<string, PnMapping>(pnMapping.map(m => [m.internalCode, m]));
      mappings.forEach(m => existingMap.set(m.internalCode, m));
      mappings = Array.from(existingMap.values());
    }

    setPnMapping(mappings);
    // 글로벌 캐시에 항상 저장
    const g = window as any;
    if (!g.__dashboardCache) g.__dashboardCache = {};
    g.__dashboardCache.pnMapping = mappings;
    // localStorage 용량 절약: 필수 필드만 저장
    const compactMappings = mappings.map(m => ({
      customerPn: m.customerPn,
      internalCode: m.internalCode,
      partName: '',
      ...(m.rawMaterialCode1 ? { rawMaterialCode1: m.rawMaterialCode1 } : {}),
      ...(m.rawMaterialCode2 ? { rawMaterialCode2: m.rawMaterialCode2 } : {}),
    }));
    const mappingJson = JSON.stringify(compactMappings);
    try {
      localStorage.setItem('dashboard_pnMapping', mappingJson);
    } catch {
      console.warn('품번매핑 localStorage 저장 실패, sessionStorage 시도');
      try { sessionStorage.setItem('dashboard_pnMapping', mappingJson); } catch { /* */ }
    }
    window.dispatchEvent(new CustomEvent('dashboard-data-updated', {
      detail: { key: 'dashboard_pnMapping', data: mappings }
    }));
    const rawMatCount = mappings.filter(m => m.rawMaterialCode1).length;
    alert(`품번 매핑 ${mappings.length}건 업로드 (${source})${rawMatCount > 0 ? ` / 원재료코드 ${rawMatCount}건` : ''}`);
    e.target.value = '';
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const handleDownload = () => {
    const headers = ['자재품번', '자재품명', '협력업체', '관련제품', '표준소요량', '투입수량', '수율(%)', '차이', '상태'];
    const rows = displayRows.map(r => [
      r.childPn,
      r.childName,
      r.supplier,
      r.parentProducts.join('; '),
      r.standardReq,
      r.inputQty,
      r.yieldRate,
      r.diff,
      STATUS_LABELS[r.status],
    ]);
    downloadCSV(`자재수율_${selectedYear}_${selectedMonth}`, headers, rows);
  };

  // --- SortableHeader ---
  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: string }) => (
    <th
      className={`px-4 py-3 min-w-[80px] ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group`}
      onClick={() => handleSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        <span className={`text-[10px] ${sortConfig?.key === sortKey ? 'text-blue-600 font-bold' : 'text-slate-300 group-hover:text-slate-400'}`}>
          {sortConfig?.key === sortKey ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </div>
    </th>
  );

  // --- Status Badge ---
  const StatusBadge = ({ status }: { status: YieldRow['status'] }) => {
    const styles: Record<YieldRow['status'], string> = {
      normal: 'bg-emerald-100 text-emerald-700',
      over: 'bg-red-100 text-red-700',
      under: 'bg-amber-100 text-amber-700',
      noMatch: 'bg-slate-100 text-slate-500',
      otherPeriod: 'bg-violet-100 text-violet-700',
      zeroInput: 'bg-slate-200 text-slate-600',
      rawMatch: 'bg-blue-100 text-blue-700',
    };
    return (
      <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${styles[status]}`}>
        {STATUS_LABELS[status]}
      </span>
    );
  };

  // --- BOM 미업로드 상태 ---
  if (bomData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-2">자재수율 (Material Yield)</h2>
          <p className="text-sm text-slate-500 mb-6">BOM 데이터를 업로드하면 매출 대비 자재 투입 수율을 분석합니다.</p>

          <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-slate-600 font-bold mb-2">BOM 데이터를 업로드해주세요</p>
            <p className="text-xs text-slate-400 mb-6">엑셀(.xlsx, .xls) 또는 CSV 파일을 지원합니다.<br/>필수 컬럼: 모품번, 자품번 (소요량, 자품명, 협력업체 등 선택)</p>
            <label className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold cursor-pointer transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              BOM 파일 업로드
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleBomFileUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // --- 메인 렌더링 ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800">자재수율 (Material Yield)</h2>
          <p className="text-xs text-slate-500 mt-1">
            BOM {bomData.length}건
            {pnMapping.length > 0 && <span className="text-indigo-500 ml-2">| 품번매핑 {pnMapping.length}건</span>}
            {bomMissingCount > 0 && <span className="text-amber-500 ml-2">| {bomMissingCount}개 제품 BOM 미등록</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 연도/월 필터 */}
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-200">
            <span className="text-xs font-bold text-slate-500">조회:</span>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 min-w-[100px]"
            >
              <option value="All">전체 (누적)</option>
              {Array.from({ length: 12 }, (_, i) => {
                const m = `${(i + 1).toString().padStart(2, '0')}월`;
                return <option key={m} value={m}>{m}</option>;
              })}
            </select>
            <div className="flex gap-2">
              {availableYears.map(year => (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    selectedYear === year ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          {/* BOM 재업로드 */}
          <label className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            BOM 재업로드
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleBomFileUpload} className="hidden" />
          </label>

          {/* 품번 매핑 업로드 */}
          <label className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            {pnMapping.length > 0 ? '품번매핑 재업로드' : '품번매핑 업로드'}
            <input type="file" accept=".xlsx,.xls" onChange={handleMappingFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="분석 자재 수" value={`${metrics.total}개`} subValue="BOM 기준 leaf 자재" color="blue" />
        <MetricCard
          label="평균 수율"
          value={`${metrics.avgYield.toFixed(1)}%`}
          subValue="데이터 있는 자재 기준"
          color={metrics.avgYield >= 95 && metrics.avgYield <= 105 ? 'emerald' : 'amber'}
        />
        <MetricCard label="과투입 자재" value={`${metrics.overCount}개`} subValue=">105% 투입" color="rose" />
        <MetricCard
          label="데이터없음 자재"
          value={`${metrics.noMatchCount + metrics.rawMatchCount + metrics.otherPeriodCount + metrics.zeroInputCount}개`}
          subValue={`미매칭 ${metrics.noMatchCount} / 원재료 ${metrics.rawMatchCount} / 기간외 ${metrics.otherPeriodCount} / 무입고 ${metrics.zeroInputCount}`}
          color="slate"
        />
      </div>

      {/* 매칭 진단 패널 (미매칭 존재 시) */}
      {debugInfo && debugInfo.noMatchCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <details>
            <summary className="text-sm font-bold text-amber-800 cursor-pointer">
              매칭 진단 (미매칭 {debugInfo.noMatchCount}건 분석)
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-bold text-amber-700 mb-1">매칭 통계:</p>
                <ul className="space-y-1 text-amber-900">
                  <li>총 leaf 자재: {debugInfo.totalLeafMaterials}건</li>
                  <li>직접 매칭: {debugInfo.directMatchCount}건</li>
                  <li>매핑 변환 매칭: {debugInfo.mappedMatchCount}건</li>
                  <li>미매칭: {debugInfo.noMatchCount}건</li>
                  <li>기간외: {debugInfo.otherPeriodCount}건</li>
                  <li>품번매핑 내 존재: {debugInfo.childInMapping}/{debugInfo.totalLeafMaterials}건</li>
                  <li>고유 고객사P/N: {debugInfo.uniqueCustPns}건 (다중코드: {debugInfo.multiMappedCust}건)</li>
                </ul>
              </div>
              <div>
                <p className="font-bold text-amber-700 mb-1">미매칭 BOM childPn 샘플:</p>
                <div className="font-mono text-[10px] text-amber-800 bg-amber-100 rounded p-2 max-h-[120px] overflow-y-auto">
                  {debugInfo.noMatchSamples.map((s: string, i: number) => <div key={i}>{s}</div>)}
                </div>
                <p className="font-bold text-amber-700 mb-1 mt-2">구매 itemCode 샘플:</p>
                <div className="font-mono text-[10px] text-amber-800 bg-amber-100 rounded p-2 max-h-[120px] overflow-y-auto">
                  {debugInfo.purchaseSamples.map((s: string, i: number) => <div key={i}>{s}</div>)}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Charts */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 수율 편차 Bar Chart */}
        <div className="flex-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
            <span className="w-1 h-5 bg-indigo-600 rounded-full"></span>
            수율 편차 Top 15 (100% 기준)
          </h3>
          {deviationChartData.length > 0 ? (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deviationChartData} layout="vertical" margin={{ top: 10, right: 30, bottom: 10, left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value > 0 ? '+' : ''}${value}%`, '편차']}
                  />
                  <Bar dataKey="deviation" radius={[0, 4, 4, 0]} barSize={16}>
                    {deviationChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
        </div>

        {/* 상태 분포 Pie Chart */}
        <div className="w-full lg:w-1/3 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
            <span className="w-1 h-5 bg-slate-500 rounded-full"></span>
            상태 분포
          </h3>
          {statusPieData.length > 0 ? (
            <div className="flex-1 min-h-[300px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {statusPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value}개`, '자재 수']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTableOpen(!tableOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${tableOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              자재수율 상세 ({displayRows.length}건)
            </button>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="All">전체 상태</option>
              <option value="normal">정상 (95~105%)</option>
              <option value="over">과투입 (&gt;105%)</option>
              <option value="under">미달 (&lt;95%)</option>
              <option value="noMatch">미매칭 (구매코드없음)</option>
              <option value="rawMatch">원재료 (원재료매칭)</option>
              <option value="otherPeriod">기간외 (다른월존재)</option>
              <option value="zeroInput">무입고 (수량0)</option>
            </select>
          </div>
          <button
            onClick={handleDownload}
            className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            엑셀 다운로드
          </button>
        </div>

        {tableOpen && (
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <SortableHeader label="자재품번" sortKey="childPn" />
                  <SortableHeader label="자재품명" sortKey="childName" />
                  <SortableHeader label="협력업체" sortKey="supplier" />
                  <th className="px-4 py-3 min-w-[120px]">관련제품</th>
                  <SortableHeader label="표준소요량" sortKey="standardReq" align="right" />
                  <SortableHeader label="투입수량" sortKey="inputQty" align="right" />
                  <SortableHeader label="수율(%)" sortKey="yieldRate" align="right" />
                  <SortableHeader label="차이" sortKey="diff" align="right" />
                  <SortableHeader label="상태" sortKey="status" align="center" />
                </tr>
                <tr className="bg-slate-50">
                  <th className="px-2 py-2">
                    <input type="text" placeholder="품번" className="w-full p-1 border rounded text-xs font-normal" value={filterPn} onChange={e => setFilterPn(e.target.value)} />
                  </th>
                  <th className="px-2 py-2">
                    <input type="text" placeholder="품명" className="w-full p-1 border rounded text-xs font-normal" value={filterName} onChange={e => setFilterName(e.target.value)} />
                  </th>
                  <th className="px-2 py-2">
                    <input type="text" placeholder="업체" className="w-full p-1 border rounded text-xs font-normal" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} />
                  </th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.childPn}</td>
                    <td className="px-4 py-3 truncate max-w-[180px]" title={row.childName || row.childPn}>
                      {row.childName
                        ? <span className="text-slate-600">{row.childName}</span>
                        : <span className="text-slate-300 italic text-[10px]">({row.childPn})</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.supplier}</td>
                    <td className="px-4 py-3 text-slate-500 text-[10px] truncate max-w-[120px]" title={row.parentProducts.join(', ')}>
                      {row.parentProducts.slice(0, 3).join(', ')}
                      {row.parentProducts.length > 3 && ` +${row.parentProducts.length - 3}`}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{row.standardReq.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.inputQty.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${
                      row.status === 'normal' ? 'text-emerald-600' :
                      row.status === 'over' ? 'text-red-600' :
                      row.status === 'under' ? 'text-amber-600' :
                      row.status === 'otherPeriod' ? 'text-violet-500' : 'text-slate-400'
                    }`}>
                      {isNoDataStatus(row.status) ? '-' : `${row.yieldRate}%`}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${row.diff > 0 ? 'text-red-500' : row.diff < 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                      {isNoDataStatus(row.status) ? '-' : row.diff > 0 ? `+${row.diff.toLocaleString()}` : row.diff.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      {yieldRows.length === 0 ? '매출 데이터와 BOM을 매칭할 수 없습니다.' : '필터 조건에 맞는 데이터가 없습니다.'}
                    </td>
                  </tr>
                )}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-center">합계 ({displayRows.length}건)</td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.standardReq, 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.inputQty, 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-indigo-700">
                      {(() => {
                        const totalStd = displayRows.reduce((s, r) => s + r.standardReq, 0);
                        const totalInput = displayRows.reduce((s, r) => s + r.inputQty, 0);
                        return totalStd > 0 ? `${((totalInput / totalStd) * 100).toFixed(1)}%` : '-';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.diff, 0).toLocaleString()}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MaterialYieldView;
