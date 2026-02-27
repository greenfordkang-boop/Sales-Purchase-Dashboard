
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import MetricCard from './MetricCard';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { downloadCSV } from '../utils/csvExport';
import { ForecastItem } from '../utils/salesForecastParser';
import { BomRecord, PnMapping, buildBomRelations, expandBomToLeaves, parseMaterialMasterExcel, parsePnMappingFromExcel } from '../utils/bomDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { PurchaseItemMaster } from '../utils/purchaseSummaryTypes';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { extractTextFromPdf, extractBomFromText, compareBomWithDrawing, BomCompareResult } from '../utils/drawingBomAnalyzer';
import {
  StandardMaterialData,
  StandardMaterialSummary,
  parseStandardMaterialExcel,
} from '../utils/standardMaterialParser';
import {
  calcUnifiedMaterialCost,
  calcMonthlyUnified,
  UnifiedCalcResult,
  CalcItemRow,
} from '../utils/materialCostCalculator';

// ============================================================
// Types for automated calculation
// ============================================================

interface MaterialCostRow {
  id: string;
  childPn: string;        // 자재 품번
  childName: string;      // 자재명
  supplier: string;       // 협력업체
  materialType: string;   // RESIN / PAINT / 구매 / 외주
  parentProducts: string[];
  standardReq: number;    // 표준소요량 (BOM 전개)
  avgUnitPrice: number;   // 평균 단가 (입고 기준)
  standardCost: number;   // 표준재료비 = standardReq × avgUnitPrice
  actualQty: number;      // 실제 투입수량
  actualCost: number;     // 실적재료비 (입고 금액)
  diff: number;           // 차이 (표준 - 실적)
  diffRate: number;       // 차이율
}

interface AutoCalcResult {
  rows: MaterialCostRow[];
  totalStandard: number;
  totalActual: number;
  byType: { name: string; standard: number; actual: number }[];
  forecastRevenue: number;  // 매출계획 금액
  standardRatio: number;    // 표준재료비율
  actualRatio: number;      // 실적재료비율
  matchRate: number;        // BOM 매칭율
  debug: { forecastItems: number; bomProducts: number; bomMissing: number; materials: number; purchaseMatched: number; calcSource?: string };
}

// ============================================================
// Constants
// ============================================================

const COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const formatWon = (v: number): string => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return Math.round(v).toLocaleString();
};

const formatPercent = (v: number): string => `${(v * 100).toFixed(1)}%`;

const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/** 구매 type / category로 재료유형 분류 */
const classifyMaterialType = (
  purchaseType: string,
  purchaseCategory: string,
  itemMaster?: PurchaseItemMaster
): string => {
  const t = (purchaseType || '').toUpperCase();
  const c = (purchaseCategory || '').toUpperCase();
  const masterType = (itemMaster?.purchaseType || itemMaster?.materialType || '').toUpperCase();

  if (t.includes('RESIN') || masterType.includes('사출') || masterType.includes('RESIN')) return 'RESIN';
  if (t.includes('PAINT') || t.includes('도장') || masterType.includes('도장') || masterType.includes('PAINT')) return 'PAINT';
  if (c === 'MATERIAL' || t.includes('원재료')) {
    if (t.includes('RESIN') || t.includes('수지')) return 'RESIN';
    if (t.includes('PAINT') || t.includes('페인트') || t.includes('도료')) return 'PAINT';
    return 'RESIN'; // 원재료 기본값
  }
  if (masterType.includes('외주') || t.includes('외주')) return '외주';
  return '구매';
};

type ViewMode = 'summary' | 'items' | 'comparison' | 'diagnostic' | 'analysis';
type DataMode = 'auto' | 'excel' | 'master';

interface DiagnosticRow {
  customerPn: string;
  internalCode: string;
  itemName: string;
  supplyType: string;
  processType: string;
  hasForecast: boolean;
  forecastQty: number;
  hasPnMapping: boolean;
  hasUnitCost: boolean;
  unitCostPerEa: number;
  injectionCost: number;
  paintCost: number;
  purchasePrice: number;
  stdAmount: number;
  breakPoint: string;
  breakLevel: 0 | 1 | 2 | 3;
}

interface ComparisonRow {
  itemCode: string;
  itemName: string;
  supplyType: string;    // 자작/구매/외주/미분류
  stdQty: number;        // 표준수량
  stdUnitPrice: number;  // 표준단가 (원/EA)
  stdAmount: number;     // 표준금액
  actQty: number;        // 실적수량
  actUnitPrice: number;  // 실적단가
  actAmount: number;     // 실적금액
  diffAmount: number;    // 차이 (표준-실적, 양수=절감)
  diffRate: number;      // 차이율%
  absDiffAmount: number; // |차이| (정렬용)
  matchStatus: 'matched' | 'std-only' | 'act-only';
}

const StandardMaterialCostView: React.FC = () => {
  // --- Data Mode ---
  const [dataMode, setDataMode] = useState<DataMode>('auto');

  // --- Shared state ---
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // --- Auto mode: Load existing data from localStorage/Supabase ---
  const [forecastData, setForecastData] = useState<ForecastItem[]>([]);
  const [itemRevenueData, setItemRevenueData] = useState<ItemRevenueRow[]>([]);
  const [bomData, setBomData] = useState<BomRecord[]>([]);
  const [pnMapping, setPnMapping] = useState<PnMapping[]>([]);
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [itemMasterData, setItemMasterData] = useState<PurchaseItemMaster[]>([]);

  // --- Excel mode ---
  const [excelData, setExcelData] = useState<StandardMaterialData | null>(() => {
    try {
      const stored = localStorage.getItem('dashboard_standardMaterial')
        || sessionStorage.getItem('dashboard_standardMaterial');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterInputRef = useRef<HTMLInputElement>(null);

  // --- PDF 도면 저장 (품번 → dataURL) ---
  const [drawingMap, setDrawingMap] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('dashboard_bomDrawings');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [showDrawingViewer, setShowDrawingViewer] = useState(false);
  const [drawingAnalysis, setDrawingAnalysis] = useState<BomCompareResult | null>(null);
  const [drawingAnalyzing, setDrawingAnalyzing] = useState(false);

  // --- BOM 진단: 팝업 + 확인 체크 ---
  const [bomPopupPn, setBomPopupPn] = useState<{ customerPn: string; internalCode: string; itemName: string } | null>(null);
  const [confirmedBomPns, setConfirmedBomPns] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('dashboard_bomConfirmed');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // --- 자재마스터 업로드 핸들러 ---
  const handleMasterUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      // 1차: 자재마스터 형식, 2차: 표준재료비 형식
      let mappings = parseMaterialMasterExcel(buffer);
      let source = '자재마스터';
      if (mappings.length === 0) {
        mappings = parsePnMappingFromExcel(buffer);
        source = '표준재료비';
      }
      if (mappings.length === 0) {
        alert('품번 매핑 파싱 실패: 품목코드 컬럼을 확인해주세요.');
        e.target.value = '';
        return;
      }
      // 기존 매핑과 병합 (새 데이터 우선)
      if (pnMapping.length > 0) {
        const existingMap = new Map(pnMapping.map(m => [m.internalCode, m]));
        mappings.forEach(m => existingMap.set(m.internalCode, m));
        mappings = [...existingMap.values()] as PnMapping[];
      }
      setPnMapping(mappings);
      // 저장
      const g = window as any;
      if (!g.__dashboardCache) g.__dashboardCache = {};
      g.__dashboardCache.pnMapping = mappings;
      try { sessionStorage.setItem('dashboard_pnMapping', JSON.stringify(mappings)); } catch { /* */ }
      try { localStorage.setItem('dashboard_pnMapping', JSON.stringify(mappings)); } catch { /* */ }
      window.dispatchEvent(new CustomEvent('dashboard-data-updated', { detail: { key: 'dashboard_pnMapping', data: mappings } }));
      const withCost = mappings.filter(m => m.materialCost && m.materialCost > 0).length;
      const withSupply = mappings.filter(m => m.supplyType).length;
      console.log(`[표준재료비] ${source} 업로드: ${mappings.length}건 (재료비 ${withCost}건, 조달구분 ${withSupply}건)`);
      alert(`${source}에서 ${mappings.length}건 로드 (재료비 ${withCost}건, 조달구분 ${withSupply}건)`);
    } catch (err) {
      console.error('자재마스터 파싱 오류:', err);
      alert('파일 파싱 중 오류가 발생했습니다.');
    }
    e.target.value = '';
  }, [pnMapping]);

  // --- Filters ---
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterSupplier, setFilterSupplier] = useState('All');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // --- Safe storage read (localStorage → sessionStorage fallback) ---
  const safeGet = (key: string): string | null => {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key); } catch { return null; }
  };

  // --- Load data from localStorage (reusable), with global cache fallback ---
  const loadAllData = useCallback(() => {
    const cache = (window as any).__dashboardCache || {};
    const f = safeGet('dashboard_forecastData');
    if (f) try { setForecastData(JSON.parse(f)); } catch { /* */ }
    const ir = safeGet('dashboard_itemRevenueData');
    if (ir) try { setItemRevenueData(JSON.parse(ir)); } catch { /* */ }
    const b = safeGet('dashboard_bomData');
    if (b) try { setBomData(JSON.parse(b)); } catch { /* */ }
    else if (cache.bomData) setBomData(cache.bomData);
    const m = safeGet('dashboard_pnMapping');
    if (m) try { setPnMapping(JSON.parse(m)); } catch { /* */ }
    else if (cache.pnMapping) setPnMapping(cache.pnMapping);
    const p = safeGet('dashboard_purchaseData');
    if (p) try { setPurchaseData(JSON.parse(p)); } catch { /* */ }
    const im = safeGet('dashboard_purchaseItemMaster');
    if (im) try { setItemMasterData(JSON.parse(im)); } catch { /* */ }
    console.log('[표준재료비] 데이터 로드 완료', { bomFromCache: !b && !!cache.bomData, pnFromCache: !m && !!cache.pnMapping });
  }, []);

  // --- Load on mount + listen for changes ---
  useEffect(() => {
    loadAllData();
    // Cross-tab storage events
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('dashboard_')) loadAllData();
    };
    // Same-window custom events (with direct data payload - bypasses localStorage)
    const onDataUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key && detail?.data) {
        const { key, data } = detail;
        if (key === 'dashboard_bomData') setBomData(data);
        else if (key === 'dashboard_pnMapping') setPnMapping(data);
        else if (key === 'dashboard_purchaseData') setPurchaseData(data);
        else if (key === 'dashboard_forecastData') setForecastData(data);
        else if (key === 'dashboard_itemRevenueData') setItemRevenueData(data);
        console.log(`[표준재료비] ${key} 이벤트 수신: ${data.length}건`);
      } else {
        loadAllData(); // fallback: 전체 새로고침
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('dashboard-data-updated', onDataUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('dashboard-data-updated', onDataUpdate);
    };
  }, [loadAllData]);

  // --- Available years ---
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    purchaseData.forEach(d => years.add(d.year));
    if (years.size === 0) years.add(2026);
    return Array.from(years).sort();
  }, [purchaseData]);

  // --- Available months ---
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    purchaseData.filter(d => d.year === selectedYear).forEach(d => months.add(d.month));
    return Array.from(months).sort();
  }, [purchaseData, selectedYear]);

  // ============================================================
  // AUTO CALCULATION CORE
  // ============================================================
  const autoCalcResult = useMemo<AutoCalcResult | null>(() => {
    if (dataMode === 'excel') return null;
    // BOM, 자재마스터, 또는 Excel(재료비.xlsx) 중 하나라도 있으면 산출 가능
    const hasMasterCosts = pnMapping.some(m => m.materialCost && m.materialCost > 0);
    const hasExcelItems = excelData?.items && excelData.items.length > 0;
    if (bomData.length === 0 && !hasMasterCosts && !hasExcelItems) return null;

    // 1. Build P/N mappings (bidirectional + multi-value)
    const custToInternal = new Map<string, string>();
    const internalToCust = new Map<string, string>();
    const custToInternals = new Map<string, Set<string>>();
    const internalToCusts = new Map<string, Set<string>>();
    const itemToRawMaterial = new Map<string, string[]>();
    pnMapping.forEach(m => {
      const cust = normalizePn(m.customerPn);
      const internal = normalizePn(m.internalCode);
      if (cust && internal) {
        custToInternal.set(cust, internal);
        internalToCust.set(internal, cust);
        if (!custToInternals.has(cust)) custToInternals.set(cust, new Set());
        custToInternals.get(cust)!.add(internal);
        if (!internalToCusts.has(internal)) internalToCusts.set(internal, new Set());
        internalToCusts.get(internal)!.add(cust);
      }
      const rawCodes: string[] = [];
      if (m.rawMaterialCode1) rawCodes.push(normalizePn(m.rawMaterialCode1));
      if (m.rawMaterialCode2) rawCodes.push(normalizePn(m.rawMaterialCode2));
      if (rawCodes.length > 0 && internal) itemToRawMaterial.set(internal, rawCodes);
    });

    // Build item master map
    const masterMap = new Map<string, PurchaseItemMaster>();
    itemMasterData.forEach(m => {
      masterMap.set(normalizePn(m.partNo), m);
    });

    // 2. Build BOM relations (normalized keys)
    const rawRelations = buildBomRelations(bomData);
    const bomRelations = new Map<string, BomRecord[]>();
    for (const [key, val] of rawRelations) {
      bomRelations.set(normalizePn(key), val);
    }

    // 3. Get sales quantities for selected period
    //    우선순위: forecastData → itemRevenueData → (없으면 BOM 구조만)
    const forecastByPart = new Map<string, { qty: number; revenue: number; partNo: string }>();
    let totalForecastRevenue = 0;
    let salesSource = 'none';

    // 5-strategy BOM key resolver
    const findBomKey = (rawPn: string): string | null => {
      if (bomRelations.has(rawPn)) return rawPn;
      const asInternal = custToInternal.get(rawPn);
      if (asInternal && bomRelations.has(asInternal)) return asInternal;
      const asCust = internalToCust.get(rawPn);
      if (asCust && bomRelations.has(asCust)) return asCust;
      const internals = custToInternals.get(rawPn);
      if (internals) { for (const ic of internals) { if (bomRelations.has(ic)) return ic; } }
      for (const [internal, rawCodes] of itemToRawMaterial) {
        if (rawCodes.includes(rawPn) && bomRelations.has(internal)) return internal;
      }
      return null;
    };

    const addToForecast = (partNo: string, customerPN: string | undefined, qty: number, revenue: number) => {
      if (qty <= 0) return;
      const rawPn = normalizePn(partNo);
      // 품번 + 고객사P/N 양쪽 모두 시도
      let bomKey = findBomKey(rawPn);
      if (!bomKey && customerPN) {
        const custPn = normalizePn(customerPN);
        if (custPn !== rawPn) bomKey = findBomKey(custPn);
      }
      const resolvedKey = bomKey || rawPn;
      const existing = forecastByPart.get(resolvedKey);
      if (existing) {
        existing.qty += qty;
        existing.revenue += revenue;
      } else {
        forecastByPart.set(resolvedKey, { qty, revenue, partNo });
      }
      totalForecastRevenue += revenue;
    };

    if (forecastData.length > 0) {
      salesSource = 'forecast';
      forecastData.forEach(item => {
        if (!item.partNo) return;
        let qty = 0, revenue = 0;
        if (selectedMonth === 'All') {
          qty = item.totalQty || 0;
          revenue = item.totalRevenue || 0;
        } else {
          const monthIdx = parseInt(selectedMonth.replace('월', ''), 10) - 1;
          if (monthIdx >= 0 && monthIdx < 12) {
            qty = item.monthlyQty?.[monthIdx] || 0;
            revenue = item.monthlyRevenue?.[monthIdx] || 0;
          }
        }
        addToForecast(item.partNo, undefined, qty, revenue);
      });
    }

    // 매출실적 보완: forecast에 없는 품목 추가 (커버리지 확대)
    if (itemRevenueData.length > 0) {
      const beforeSize = forecastByPart.size;
      const extractMonth = (period: string): string | null => {
        const dm = period?.match(/\d{4}-(\d{1,2})/);
        if (dm) return dm[1].padStart(2, '0') + '월';
        const km = period?.match(/(\d{1,2})월/);
        if (km) return km[1].padStart(2, '0') + '월';
        return null;
      };
      itemRevenueData.forEach(row => {
        const yearMatch = row.period?.match(/(\d{4})/);
        if (yearMatch && parseInt(yearMatch[1]) !== selectedYear) return;
        if (selectedMonth !== 'All') {
          const month = extractMonth(row.period);
          if (month && month !== selectedMonth) return;
        }
        if (!row.partNo && !row.customerPN) return;
        // 이미 forecastByPart에 있는 품번은 스킵 (중복 방지)
        const rawPn = normalizePn(row.partNo || row.customerPN);
        if (forecastByPart.has(rawPn)) return;
        const asInternal = custToInternal.get(rawPn);
        if (asInternal && forecastByPart.has(asInternal)) return;
        const asCust = internalToCust.get(rawPn);
        if (asCust && forecastByPart.has(asCust)) return;
        addToForecast(row.partNo || row.customerPN, row.customerPN, row.qty || 0, row.amount || 0);
      });
      const added = forecastByPart.size - beforeSize;
      if (added > 0) {
        salesSource = salesSource === 'none' ? 'revenue' : 'forecast+revenue';
        console.log(`[표준재료비] 매출실적 보완: ${added}개 품목 추가 (총 ${forecastByPart.size}개)`);
      }
    }

    // Debug: 매칭 진단
    const bomParentSamples = [...bomRelations.keys()].slice(0, 5);
    const salesPnSamples = [...forecastByPart.keys()].slice(0, 5);
    console.log(`[표준재료비] 데이터: BOM ${bomRelations.size}개 모품번, 매출 ${forecastByPart.size}개 품번 (source: ${salesSource})`);
    console.log(`[표준재료비] BOM 모품번 샘플:`, bomParentSamples);
    console.log(`[표준재료비] 매출 품번 샘플:`, salesPnSamples);
    console.log(`[표준재료비] P/N 매핑: ${pnMapping.length}건, 구매: ${purchaseData.length}건`);

    // 4. BOM expansion → leaf materials with accumulated quantities
    interface ChildAccum {
      childName: string;
      supplier: string;
      totalRequired: number;
      parentProducts: Set<string>;
    }
    const childMap = new Map<string, ChildAccum>();
    let bomMissing = 0;
    let bomMatched = 0;

    if (forecastByPart.size > 0) {
      // 매출계획 기반 전개
      for (const [key, forecast] of forecastByPart) {
        if (!bomRelations.has(key)) {
          bomMissing++;
          continue;
        }
        bomMatched++;
        const leaves = expandBomToLeaves(key, forecast.qty, bomRelations);
        for (const leaf of leaves) {
          const normalizedChild = normalizePn(leaf.childPn);
          const existing = childMap.get(normalizedChild);
          if (existing) {
            existing.totalRequired += leaf.totalRequired;
            existing.parentProducts.add(key);
          } else {
            childMap.set(normalizedChild, {
              childName: leaf.childName,
              supplier: leaf.supplier,
              totalRequired: leaf.totalRequired,
              parentProducts: new Set([key]),
            });
          }
        }
      }
    } else {
      // 매출계획 없음 → BOM 구조만 표시 (각 모품번당 1개 기준)
      bomMatched = bomRelations.size;
      for (const [parentPn] of bomRelations) {
        const leaves = expandBomToLeaves(parentPn, 1, bomRelations);
        for (const leaf of leaves) {
          const normalizedChild = normalizePn(leaf.childPn);
          const existing = childMap.get(normalizedChild);
          if (existing) {
            existing.totalRequired += leaf.totalRequired;
            existing.parentProducts.add(parentPn);
          } else {
            childMap.set(normalizedChild, {
              childName: leaf.childName,
              supplier: leaf.supplier,
              totalRequired: leaf.totalRequired,
              parentProducts: new Set([parentPn]),
            });
          }
        }
      }
    }

    // 4b. Raw material (원재료: RESIN/PAINT) entries via rawMaterialCode linkage
    //     Products link to raw materials via PnMapping.rawMaterialCode1/rawMaterialCode2
    //     Raw materials aren't BOM leaves but contribute to total material cost

    // Get raw material info from purchase data
    const rawMaterialInfo = new Map<string, { name: string; supplier: string; type: string }>();
    purchaseData.filter(p => p.category === 'Material' && p.year === selectedYear).forEach(p => {
      const code = normalizePn(p.itemCode);
      if (code && !rawMaterialInfo.has(code)) {
        rawMaterialInfo.set(code, { name: p.itemName, supplier: p.supplier, type: p.type });
      }
    });

    // Build reverse map: rawCode → product bomKeys
    const rawCodeToProducts = new Map<string, Set<string>>();
    for (const [internalCode, rawCodes] of itemToRawMaterial) {
      // Find the product key for this internal code
      let productKey: string | null = null;
      if (forecastByPart.has(internalCode)) productKey = internalCode;
      if (!productKey) {
        const asCust = internalToCust.get(internalCode);
        if (asCust && forecastByPart.has(asCust)) productKey = asCust;
      }
      if (!productKey) {
        const custs = internalToCusts.get(internalCode);
        if (custs) { for (const c of custs) { if (forecastByPart.has(c)) { productKey = c; break; } } }
      }
      if (!productKey && bomRelations.has(internalCode)) productKey = internalCode;
      if (!productKey) continue;

      for (const rc of rawCodes) {
        if (!rawCodeToProducts.has(rc)) rawCodeToProducts.set(rc, new Set());
        rawCodeToProducts.get(rc)!.add(productKey);
      }
    }

    // Add raw material entries to childMap
    let rawMaterialAdded = 0;
    // Filter purchase by period for raw material qty calculation
    const filteredRawPurchase = purchaseData.filter(p => {
      if (p.category !== 'Material') return false;
      if (p.year !== selectedYear) return false;
      if (selectedMonth !== 'All' && p.month !== selectedMonth) return false;
      return true;
    });
    // Group raw material purchase by code for period totals
    const rawPurchaseByCode = new Map<string, { totalQty: number; totalAmount: number }>();
    filteredRawPurchase.forEach(p => {
      const code = normalizePn(p.itemCode);
      if (!code) return;
      const ex = rawPurchaseByCode.get(code);
      if (ex) { ex.totalQty += p.qty; ex.totalAmount += p.amount; }
      else rawPurchaseByCode.set(code, { totalQty: p.qty, totalAmount: p.amount });
    });

    for (const [rawCode, linkedProducts] of rawCodeToProducts) {
      if (childMap.has(rawCode)) continue;
      const rp = rawPurchaseByCode.get(rawCode);
      if (!rp || rp.totalAmount <= 0) continue;
      const rmInfo = rawMaterialInfo.get(rawCode);
      childMap.set(rawCode, {
        childName: rmInfo?.name || rawCode,
        supplier: rmInfo?.supplier || '',
        totalRequired: rp.totalQty,
        parentProducts: linkedProducts,
      });
      rawMaterialAdded++;
    }
    // Also add unlinked raw materials (in purchase data but no product linkage)
    for (const [rawCode, rp] of rawPurchaseByCode) {
      if (childMap.has(rawCode)) continue;
      if (rp.totalAmount <= 0) continue;
      const rmInfo = rawMaterialInfo.get(rawCode);
      childMap.set(rawCode, {
        childName: rmInfo?.name || rawCode,
        supplier: rmInfo?.supplier || '',
        totalRequired: rp.totalQty,
        parentProducts: new Set(['(원재료)']),
      });
      rawMaterialAdded++;
    }
    console.log(`[표준재료비] 원재료 추가: ${rawMaterialAdded}건, 연결된 제품: ${rawCodeToProducts.size}개 원재료코드`);

    // 5. Match with purchase inbound data → get unit prices and actual costs
    //    Filter purchase data by year/month
    const filteredPurchase = purchaseData.filter(p => {
      if (p.year !== selectedYear) return false;
      if (selectedMonth !== 'All' && p.month !== selectedMonth) return false;
      return true;
    });

    // Group purchase by itemCode → { totalQty, totalAmount, type, category }
    const purchaseByCode = new Map<string, { totalQty: number; totalAmount: number; avgPrice: number; type: string; category: string }>();
    filteredPurchase.forEach(p => {
      const code = normalizePn(p.itemCode || '');
      if (!code) return;
      const existing = purchaseByCode.get(code);
      if (existing) {
        existing.totalQty += p.qty;
        existing.totalAmount += p.amount;
        existing.avgPrice = existing.totalQty > 0 ? existing.totalAmount / existing.totalQty : 0;
      } else {
        purchaseByCode.set(code, {
          totalQty: p.qty,
          totalAmount: p.amount,
          avgPrice: p.qty > 0 ? p.amount / p.qty : 0,
          type: p.type,
          category: p.category,
        });
      }
      // Also index by customer P/N if available
      if (p.customerPn) {
        const custPn = normalizePn(p.customerPn);
        if (custPn && custPn !== code) {
          const ex2 = purchaseByCode.get(custPn);
          if (ex2) {
            ex2.totalQty += p.qty;
            ex2.totalAmount += p.amount;
            ex2.avgPrice = ex2.totalQty > 0 ? ex2.totalAmount / ex2.totalQty : 0;
          } else {
            purchaseByCode.set(custPn, {
              totalQty: p.qty,
              totalAmount: p.amount,
              avgPrice: p.qty > 0 ? p.amount / p.qty : 0,
              type: p.type,
              category: p.category,
            });
          }
        }
      }
    });

    // 6. Build result rows
    const rows: MaterialCostRow[] = [];
    let purchaseMatched = 0;

    for (const [childPn, accum] of childMap) {
      const normalized = normalizePn(childPn);

      // Try to find matching purchase data
      let purchaseInfo = purchaseByCode.get(normalized);
      if (!purchaseInfo) {
        const asCust = internalToCust.get(normalized);
        if (asCust) purchaseInfo = purchaseByCode.get(asCust);
      }
      if (!purchaseInfo) {
        const asInternal = custToInternal.get(normalized);
        if (asInternal) purchaseInfo = purchaseByCode.get(asInternal);
      }

      const avgUnitPrice = purchaseInfo?.avgPrice || 0;
      const standardCost = accum.totalRequired * avgUnitPrice;
      const actualCost = purchaseInfo?.totalAmount || 0;
      const actualQty = purchaseInfo?.totalQty || 0;
      const diff = standardCost - actualCost;
      const diffRate = standardCost > 0 ? (diff / standardCost) * 100 : 0;

      if (purchaseInfo) purchaseMatched++;

      const itemMaster = masterMap.get(normalized);
      const materialType = purchaseInfo
        ? classifyMaterialType(purchaseInfo.type, purchaseInfo.category, itemMaster)
        : (itemMaster ? classifyMaterialType('', '', itemMaster) : '구매');

      rows.push({
        id: `auto-${childPn}`,
        childPn,
        childName: accum.childName,
        supplier: accum.supplier,
        materialType,
        parentProducts: [...accum.parentProducts],
        standardReq: accum.totalRequired,
        avgUnitPrice,
        standardCost,
        actualQty,
        actualCost,
        diff,
        diffRate,
      });
    }

    // 디버그: 단가 분석
    const zeroPriceCount = rows.filter(r => r.avgUnitPrice === 0).length;
    const resinRows = rows.filter(r => r.materialType === 'RESIN');
    const paintRows = rows.filter(r => r.materialType === 'PAINT');
    const partsRows = rows.filter(r => r.materialType === '구매');
    console.log(`[표준재료비 진단] 총 자재: ${rows.length} (구매: ${partsRows.length}, RESIN: ${resinRows.length}, PAINT: ${paintRows.length})`);
    console.log(`[표준재료비 진단] 표준비 구성: 구매 ₩${partsRows.reduce((s,r)=>s+r.standardCost,0).toLocaleString()}, RESIN ₩${resinRows.reduce((s,r)=>s+r.standardCost,0).toLocaleString()}, PAINT ₩${paintRows.reduce((s,r)=>s+r.standardCost,0).toLocaleString()}`);
    console.log(`[표준재료비 진단] 실적비 구성: 구매 ₩${partsRows.reduce((s,r)=>s+r.actualCost,0).toLocaleString()}, RESIN ₩${resinRows.reduce((s,r)=>s+r.actualCost,0).toLocaleString()}, PAINT ₩${paintRows.reduce((s,r)=>s+r.actualCost,0).toLocaleString()}`);
    console.log(`[표준재료비 진단] 구매코드 수: ${purchaseByCode.size}, 매칭: ${purchaseMatched}/${rows.length}, 원재료추가: ${rawMaterialAdded}건`);
    console.log(`[표준재료비 진단] 원재료 입고 (기간내): Parts ${filteredPurchase.filter(p=>p.category==='Parts').length}건, Material ${filteredRawPurchase.length}건`);

    // Sort by standardCost descending
    rows.sort((a, b) => b.standardCost - a.standardCost);

    // Aggregate by type
    const typeMap = new Map<string, { standard: number; actual: number }>();
    rows.forEach(r => {
      const existing = typeMap.get(r.materialType);
      if (existing) {
        existing.standard += r.standardCost;
        existing.actual += r.actualCost;
      } else {
        typeMap.set(r.materialType, { standard: r.standardCost, actual: r.actualCost });
      }
    });
    const byType = [...typeMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.standard - a.standard);

    const bomTotalStandard = rows.reduce((s, r) => s + r.standardCost, 0);
    const bomTotalActual = rows.reduce((s, r) => s + r.actualCost, 0);

    // ===== Excel 기반 표준재료비: 통합 산출 엔진 사용 =====
    let finalStandard = bomTotalStandard;
    let finalActual = bomTotalActual;
    let finalByType = byType;
    let finalRevenue = totalForecastRevenue;
    let calcSource = 'BOM';
    let unifiedResult: UnifiedCalcResult | null = null;

    console.log(`[표준재료비] 통합엔진 체크: excelData?.items=${excelData?.items?.length ?? 'null'}, bomTotal=₩${bomTotalStandard.toLocaleString()}`);

    if (excelData?.items && excelData.items.length > 0) {
      const monthIdx = selectedMonth === 'All' ? -1 : parseInt(selectedMonth.replace('월', ''), 10) - 1;
      // 매출액: 매출계획 우선, 없으면 Excel ABC 매출
      let revenue = totalForecastRevenue;
      if (revenue <= 0 && excelData.summary?.abcSales) revenue = excelData.summary.abcSales;

      // Build forecastQtyMap from 영업현황 매출계획
      const forecastQtyMap = new Map<string, number>();
      if (forecastData.length > 0) {
        const registerWithBridge = (pn: string, qty: number) => {
          const key = normalizePn(pn);
          if (!key) return;
          forecastQtyMap.set(key, (forecastQtyMap.get(key) || 0) + qty);
          // pnMapping: customer → ALL internal codes (1:N 매핑)
          const allInternals = custToInternals.get(key);
          if (allInternals) {
            for (const ic of allInternals) forecastQtyMap.set(ic, (forecastQtyMap.get(ic) || 0) + qty);
          } else {
            const asInternal = custToInternal.get(key);
            if (asInternal) forecastQtyMap.set(asInternal, (forecastQtyMap.get(asInternal) || 0) + qty);
          }
          // 역방향: internal → ALL customer codes
          const allCusts = internalToCusts.get(key);
          if (allCusts) {
            for (const c of allCusts) forecastQtyMap.set(c, (forecastQtyMap.get(c) || 0) + qty);
          } else {
            const asCust = internalToCust.get(key);
            if (asCust) forecastQtyMap.set(asCust, (forecastQtyMap.get(asCust) || 0) + qty);
          }
        };
        forecastData.forEach(item => {
          if (!item.partNo) return;
          const qty = monthIdx >= 0
            ? (item.monthlyQty?.[monthIdx] || 0)
            : (item.totalQty || 0);
          if (qty <= 0) return;
          registerWithBridge(item.partNo, qty);
          // newPartNo도 등록 (신규 P/N 매칭)
          if (item.newPartNo && item.newPartNo !== item.partNo) {
            registerWithBridge(item.newPartNo, qty);
          }
        });
        // 2차 브릿지: 재료비.xlsx 자체 customerPn ↔ itemCode 매핑
        if (excelData.items) {
          for (const ei of excelData.items) {
            if (!ei.itemCode || !ei.customerPn) continue;
            const code = normalizePn(ei.itemCode);
            const cust = normalizePn(ei.customerPn);
            // forecast에 customerPn이 있으면 itemCode에도 등록 (또는 역방향)
            if (forecastQtyMap.has(cust) && !forecastQtyMap.has(code)) {
              forecastQtyMap.set(code, forecastQtyMap.get(cust)!);
            } else if (forecastQtyMap.has(code) && !forecastQtyMap.has(cust)) {
              forecastQtyMap.set(cust, forecastQtyMap.get(code)!);
            }
          }
        }
      }

      unifiedResult = calcUnifiedMaterialCost(excelData, monthIdx, revenue, forecastQtyMap.size > 0 ? forecastQtyMap : undefined);
      console.log(`[표준재료비] 통합엔진 결과: totalStandard=₩${unifiedResult.totalStandard.toLocaleString()}, source=${unifiedResult.calcSource}, items=${unifiedResult.stats.totalItems}`);

      if (unifiedResult.totalStandard > 0) {
        calcSource = unifiedResult.calcSource;
        finalStandard = unifiedResult.totalStandard;
        finalRevenue = revenue;

        // 실적: 전체 구매 데이터 (부품 + 원재료) 합산
        finalActual = filteredPurchase.reduce((s, p) => s + p.amount, 0);
        // 유형별 실적 분류
        const actualResin = filteredPurchase.filter(p => p.category === 'Material' && /사출|resin/i.test(p.type)).reduce((s, p) => s + p.amount, 0);
        const actualPaint = filteredPurchase.filter(p => p.category === 'Material' && /도장|paint/i.test(p.type)).reduce((s, p) => s + p.amount, 0);
        const actualParts = filteredPurchase.filter(p => p.category === 'Parts').reduce((s, p) => s + p.amount, 0);
        const actualOther = finalActual - actualResin - actualPaint - actualParts;

        // 통합 엔진 summaryByType에 실적 매핑
        const actualMap: Record<string, number> = {
          'RESIN': actualResin, 'PAINT': actualPaint, '구매': actualParts, '외주': actualOther > 0 ? actualOther : 0,
        };
        finalByType = unifiedResult.summaryByType.map(t => ({
          ...t,
          actual: actualMap[t.name] || 0,
        }));

        // ── 통합 엔진 itemRows → MaterialCostRow[] 변환 (상세 테이블 일원화) ──
        rows.length = 0; // BOM rows 제거
        let ufIdx = 0;
        for (const ir of unifiedResult.itemRows) {
          const isOut = ir.supplyType?.includes('외주');
          const isPur = ir.supplyType === '구매';
          let materialType = 'RESIN';
          if (isOut) materialType = '외주';
          else if (isPur) materialType = '구매';
          else if (ir.paintCostPerEa > 0 && ir.injectionCost <= 0) materialType = 'PAINT';
          else if (ir.injectionCost > 0) materialType = 'RESIN';
          else materialType = '구매';

          rows.push({
            id: `uf-${ir.itemCode}-${ufIdx++}`,
            childPn: ir.itemCode,
            childName: ir.itemName,
            supplier: '',
            materialType,
            parentProducts: [],
            standardReq: ir.production,
            avgUnitPrice: ir.totalCostPerEa,
            standardCost: ir.totalAmount,
            actualQty: 0,
            actualCost: 0,
            diff: ir.totalAmount,
            diffRate: 0,
          });
        }
        rows.sort((a, b) => b.standardCost - a.standardCost);

        console.log(`[표준재료비] 통합엔진 산출 (${unifiedResult.stats.totalItems}개 품목, source: ${calcSource}): ₩${unifiedResult.totalStandard.toLocaleString()}`);
        console.log(`[표준재료비] Excel ${unifiedResult.stats.excelItems}건 + RefCalc ${unifiedResult.stats.calcItems}건`);
        unifiedResult.summaryByType.forEach(t => console.log(`[표준재료비]   ${t.name}: ₩${Math.round(t.standard).toLocaleString()}`));
      }
    }

    // ===== 자재마스터 기반 표준재료비 (통합엔진 미활성 시 폴백) =====
    // 자재마스터 재료비 = 구매 부품비 (RESIN/PAINT 가공비 미포함)
    // 외주 = purchaseUnitPrice (정확), 자작 = materialCost + 원재료 입고 보정
    // ※ 통합엔진(Excel/RefCalc)이 활성이면 Master 경로 스킵 — 통합엔진이 더 정확함
    if (calcSource === 'BOM' && forecastByPart.size > 0) {
      const mappingsWithCost = pnMapping.filter(m => (m.materialCost && m.materialCost > 0) || (m.purchaseUnitPrice && m.purchaseUnitPrice > 0) || (m.injectionCost && m.injectionCost > 0) || (m.paintCost && m.paintCost > 0));
      if (mappingsWithCost.length > 0) {
        const masterLookup = new Map<string, typeof pnMapping[0]>();
        pnMapping.forEach(m => {
          if (m.internalCode) masterLookup.set(normalizePn(m.internalCode), m);
          if (m.customerPn) masterLookup.set(normalizePn(m.customerPn), m);
        });

        // ── 표준재료비: forecast qty × master 단가 ──
        let stdOutsource = 0, stdInhouse = 0, stdPurchaseDirect = 0;
        let stdResin = 0, stdPaint = 0;
        let mstMatchCount = 0, mstOutsourceCount = 0;
        let matchedRevenue = 0, unmatchedRevenue = 0;
        let resinCostItems = 0, paintCostItems = 0;

        for (const [key, forecast] of forecastByPart) {
          if (forecast.qty <= 0) continue;
          let master = masterLookup.get(key);
          if (!master) { const k2 = custToInternal.get(key); if (k2) master = masterLookup.get(k2); }
          if (!master) { const k2 = internalToCust.get(key); if (k2) master = masterLookup.get(k2); }
          if (!master) { unmatchedRevenue += forecast.revenue; continue; }

          mstMatchCount++;
          matchedRevenue += forecast.revenue;

          // RESIN/PAINT: 제품별 사출/도장 단가 × 수량
          if (master.injectionCost && master.injectionCost > 0) {
            stdResin += master.injectionCost * forecast.qty;
            resinCostItems++;
          }
          if (master.paintCost && master.paintCost > 0) {
            stdPaint += master.paintCost * forecast.qty;
            paintCostItems++;
          }

          // 구매/외주: purchaseUnitPrice or materialCost
          const isOutsource = master.supplyType?.includes('외주');
          const isPurchaseDirect = master.supplyType === '구매';

          if (isOutsource) {
            stdOutsource += (master.purchaseUnitPrice || master.materialCost || 0) * forecast.qty;
            mstOutsourceCount++;
          } else if (isPurchaseDirect) {
            stdPurchaseDirect += (master.purchaseUnitPrice || master.materialCost || 0) * forecast.qty;
          } else {
            stdInhouse += (master.purchaseUnitPrice || master.materialCost || 0) * forecast.qty;
          }
        }

        // ── 커버리지 보정: 매칭 안 되는 품목의 표준비를 비율 기반 추정 ──
        const matchedPartsStd = stdOutsource + stdInhouse + stdPurchaseDirect;
        const coverageRatio = matchedRevenue > 0 ? matchedPartsStd / matchedRevenue : 0;
        if (unmatchedRevenue > 0 && coverageRatio > 0) {
          const extrapolated = unmatchedRevenue * coverageRatio;
          stdInhouse += extrapolated;
          console.log(`[표준재료비] 커버리지 보정: 매칭 ${mstMatchCount}건, 미매칭 매출 ₩${unmatchedRevenue.toLocaleString()} × 비율 ${(coverageRatio * 100).toFixed(1)}% = +₩${extrapolated.toLocaleString()}`);
        }

        // RESIN/PAINT 커버리지 보정 (매칭 품목 기반 추정)
        if (stdResin > 0 && unmatchedRevenue > 0 && matchedRevenue > 0) {
          const resinRatio = stdResin / matchedRevenue;
          stdResin += unmatchedRevenue * resinRatio;
        }
        if (stdPaint > 0 && unmatchedRevenue > 0 && matchedRevenue > 0) {
          const paintRatio = stdPaint / matchedRevenue;
          stdPaint += unmatchedRevenue * paintRatio;
        }

        // RESIN/PAINT 폴백: 단가 데이터 없으면 실적 기반 사용
        const actResinRaw = filteredPurchase
          .filter(p => p.category === 'Material' && /사출|resin|수지/i.test(p.type))
          .reduce((s, p) => s + p.amount, 0);
        const actPaintRaw = filteredPurchase
          .filter(p => p.category === 'Material' && /도장|paint|페인트|도료/i.test(p.type))
          .reduce((s, p) => s + p.amount, 0);

        if (resinCostItems === 0) {
          stdResin = actResinRaw; // 단가 없으면 실적 = 표준 (차이 없음 인정)
          console.log(`[표준재료비] RESIN: 사출재료비 단가 없음 → 실적 기반 (₩${actResinRaw.toLocaleString()}). 자재마스터에 사출재료비 컬럼 추가 필요.`);
        }
        if (paintCostItems === 0) {
          stdPaint = actPaintRaw;
          console.log(`[표준재료비] PAINT: 도장재료비 단가 없음 → 실적 기반 (₩${actPaintRaw.toLocaleString()}). 자재마스터에 도장재료비 컬럼 추가 필요.`);
        }

        // ── 실적재료비: 구매입고 기반 (유형별 분류) ──
        const actResin = actResinRaw;
        const actPaint = actPaintRaw;
        const actOutsource = filteredPurchase
          .filter(p => {
            if (p.category !== 'Parts') return false;
            const code = normalizePn(p.itemCode);
            let m = masterLookup.get(code);
            if (!m && p.customerPn) m = masterLookup.get(normalizePn(p.customerPn));
            return m?.supplyType?.includes('외주') || false;
          })
          .reduce((s, p) => s + p.amount, 0);
        const actInhouse = filteredPurchase
          .filter(p => {
            if (p.category !== 'Parts') return false;
            const code = normalizePn(p.itemCode);
            let m = masterLookup.get(code);
            if (!m && p.customerPn) m = masterLookup.get(normalizePn(p.customerPn));
            if (m?.supplyType?.includes('외주')) return false;
            return true;
          })
          .reduce((s, p) => s + p.amount, 0);
        const actMaterialOther = filteredPurchase
          .filter(p => p.category === 'Material' && !/사출|resin|수지|도장|paint|페인트|도료/i.test(p.type))
          .reduce((s, p) => s + p.amount, 0);

        // ── 합산 ──
        const stdTotal = stdResin + stdPaint + (stdOutsource + stdInhouse + stdPurchaseDirect);
        const actTotal = actResin + actPaint + actOutsource + actInhouse + actMaterialOther;

        if (stdTotal > 0 && mstMatchCount > 0) {
          calcSource = 'Master';
          finalStandard = stdTotal;
          finalActual = actTotal;

          finalByType = [
            { name: 'RESIN', standard: stdResin, actual: actResin },
            { name: 'PAINT', standard: stdPaint, actual: actPaint },
            { name: '구매', standard: stdInhouse + stdPurchaseDirect, actual: actInhouse },
            { name: '외주', standard: stdOutsource, actual: actOutsource },
          ].filter(t => t.standard > 0 || t.actual > 0);

          console.log(`[표준재료비] ── Master 기반 산출 ──`);
          console.log(`[표준재료비] 매칭: ${mstMatchCount}/${forecastByPart.size} (${((mstMatchCount / forecastByPart.size) * 100).toFixed(0)}%), 외주 ${mstOutsourceCount}건`);
          console.log(`[표준재료비] 표준: RESIN ₩${stdResin.toLocaleString()} (목표), PAINT ₩${stdPaint.toLocaleString()} (목표), 구매 ₩${(stdInhouse + stdPurchaseDirect).toLocaleString()}, 외주 ₩${stdOutsource.toLocaleString()} → 합계 ₩${stdTotal.toLocaleString()}`);
          console.log(`[표준재료비] 실적: RESIN ₩${actResin.toLocaleString()}, PAINT ₩${actPaint.toLocaleString()}, 구매 ₩${actInhouse.toLocaleString()}, 외주 ₩${actOutsource.toLocaleString()} → 합계 ₩${actTotal.toLocaleString()}`);
          console.log(`[표준재료비] 차이: ₩${(stdTotal - actTotal).toLocaleString()} (${actTotal > 0 ? ((stdTotal / actTotal) * 100).toFixed(1) : 0}%)`);
          console.log(`[표준재료비] RESIN 소스: ${resinCostItems > 0 ? `master 사출재료비 (${resinCostItems}건)` : '실적 폴백 (사출재료비 단가 미등록)'}`);
          console.log(`[표준재료비] PAINT 소스: ${paintCostItems > 0 ? `master 도장재료비 (${paintCostItems}건)` : '실적 폴백 (도장재료비 단가 미등록)'}`);
          if (resinCostItems === 0 || paintCostItems === 0) {
            console.log(`[표준재료비] 💡 자재마스터(또는 표준재료비 Excel)에 '사출재료비'/'도장재료비' 컬럼이 있으면 정확한 표준 RESIN/PAINT 산출 가능`);
          }
        }
      }
    }

    return {
      rows,
      totalStandard: finalStandard,
      totalActual: finalActual,
      byType: finalByType,
      forecastRevenue: finalRevenue,
      standardRatio: finalRevenue > 0 ? finalStandard / finalRevenue : 0,
      actualRatio: finalRevenue > 0 ? finalActual / finalRevenue : 0,
      matchRate: forecastByPart.size > 0 ? (bomMatched / forecastByPart.size) * 100 : 0,
      debug: {
        forecastItems: forecastByPart.size,
        bomProducts: bomMatched,
        bomMissing,
        materials: childMap.size,
        purchaseMatched,
        calcSource,
      },
    };
  }, [dataMode, forecastData, itemRevenueData, bomData, pnMapping, purchaseData, itemMasterData, selectedYear, selectedMonth, excelData]);

  // ============================================================
  // MONTHLY SUMMARY (12개월 추이)
  // ============================================================
  interface MonthlySummaryRow {
    month: string;           // 'Jan', 'Feb', ...
    monthKr: string;         // '01월', '02월', ...
    revenue: number;         // 매출액
    standardCost: number;    // 표준재료비
    actualCost: number;      // 실적재료비
    diff: number;            // 차이금액 (표준 - 실적)
    standardRatio: number;   // 표준재료비율
    actualRatio: number;     // 실적재료비율
    achievementRate: number; // 달성율
  }

  const monthlySummary = useMemo<MonthlySummaryRow[]>(() => {
    const hasMasterCosts = pnMapping.some(m => m.materialCost && m.materialCost > 0);
    if (dataMode === 'excel' || (bomData.length === 0 && !hasMasterCosts && !(excelData?.items?.length))) return [];

    const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // 실적재료비 월별 집계 (전체 구매 데이터)
    const actualByMonth = new Array(12).fill(0);
    purchaseData.filter(p => p.year === selectedYear).forEach(p => {
      const mIdx = parseInt(p.month?.replace('월', ''), 10) - 1;
      if (mIdx >= 0 && mIdx < 12) actualByMonth[mIdx] += p.amount;
    });

    // ===== Excel 기반 월별 표준재료비: 통합 엔진 사용 =====
    if (excelData?.items && excelData.items.length > 0) {
      // P/N 매핑 (매출계획 P/N ↔ 재료비 P/N 브릿지) — 1:N 다중 매핑
      const mCustToInternals = new Map<string, Set<string>>();
      const mInternalToCusts = new Map<string, Set<string>>();
      const mCustToInt = new Map<string, string>();
      const mIntToCust = new Map<string, string>();
      pnMapping.forEach(m => {
        const c = normalizePn(m.customerPn);
        const i = normalizePn(m.internalCode);
        if (c && i) {
          mCustToInt.set(c, i);
          mIntToCust.set(i, c);
          if (!mCustToInternals.has(c)) mCustToInternals.set(c, new Set());
          mCustToInternals.get(c)!.add(i);
          if (!mInternalToCusts.has(i)) mInternalToCusts.set(i, new Set());
          mInternalToCusts.get(i)!.add(c);
        }
      });

      // 월별 매출액 + forecastQtyMap 산출
      const monthlyRevenue: number[] = [];
      const monthlyForecastMaps: (Map<string, number> | undefined)[] = [];
      for (let mi = 0; mi < 12; mi++) {
        // 매출액: 매출계획 우선, 없으면 Excel ABC매출
        let revenue = 0;
        if (forecastData.length > 0) {
          revenue = forecastData.reduce((s, item) => s + (item.monthlyRevenue?.[mi] || 0), 0);
        }
        if (revenue <= 0 && excelData.abcSales && excelData.abcSales.length > 0) {
          revenue = excelData.abcSales.reduce((s, item) => s + (item.monthlySales?.[mi] || 0), 0);
        }
        monthlyRevenue.push(revenue);

        // forecastQtyMap: 매출계획 수량 (개선된 매칭 — autoCalcResult와 동일 로직)
        if (forecastData.length > 0) {
          const qtyMap = new Map<string, number>();
          const registerWithBridge = (pn: string, qty: number) => {
            const key = normalizePn(pn);
            if (!key) return;
            qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
            // 1:N customer → internal
            const allInternals = mCustToInternals.get(key);
            if (allInternals) {
              for (const ic of allInternals) qtyMap.set(ic, (qtyMap.get(ic) || 0) + qty);
            } else {
              const asI = mCustToInt.get(key);
              if (asI) qtyMap.set(asI, (qtyMap.get(asI) || 0) + qty);
            }
            // 1:N internal → customer (역방향)
            const allCusts = mInternalToCusts.get(key);
            if (allCusts) {
              for (const c of allCusts) qtyMap.set(c, (qtyMap.get(c) || 0) + qty);
            } else {
              const asC = mIntToCust.get(key);
              if (asC) qtyMap.set(asC, (qtyMap.get(asC) || 0) + qty);
            }
          };
          forecastData.forEach(item => {
            if (!item.partNo) return;
            const qty = item.monthlyQty?.[mi] || 0;
            if (qty <= 0) return;
            registerWithBridge(item.partNo, qty);
            if (item.newPartNo && item.newPartNo !== item.partNo) {
              registerWithBridge(item.newPartNo, qty);
            }
          });
          // 2차 브릿지: 재료비.xlsx 자체 customerPn ↔ itemCode 매핑
          if (excelData.items) {
            for (const ei of excelData.items) {
              if (!ei.itemCode || !ei.customerPn) continue;
              const code = normalizePn(ei.itemCode);
              const cust = normalizePn(ei.customerPn);
              if (qtyMap.has(cust) && !qtyMap.has(code)) {
                qtyMap.set(code, qtyMap.get(cust)!);
              } else if (qtyMap.has(code) && !qtyMap.has(cust)) {
                qtyMap.set(cust, qtyMap.get(code)!);
              }
            }
          }
          monthlyForecastMaps.push(qtyMap.size > 0 ? qtyMap : undefined);
        } else {
          monthlyForecastMaps.push(undefined);
        }
      }

      const monthlyResults = calcMonthlyUnified(excelData, monthlyRevenue, monthlyForecastMaps);
      const rows: MonthlySummaryRow[] = monthlyResults.map((result, mi) => {
        const actual = actualByMonth[mi];
        const diff = result.totalStandard - actual;
        const stdRatio = result.revenue > 0 ? result.totalStandard / result.revenue : 0;
        const actRatio = result.revenue > 0 ? actual / result.revenue : 0;
        const achievement = stdRatio > 0 ? actRatio / stdRatio * 100 : 0;

        return {
          month: MONTH_EN[mi],
          monthKr: `${String(mi + 1).padStart(2, '0')}월`,
          revenue: result.revenue,
          standardCost: result.totalStandard,
          actualCost: actual,
          diff,
          standardRatio: stdRatio,
          actualRatio: actRatio,
          achievementRate: achievement,
        };
      });
      return rows;
    }

    // ===== 자재마스터 기반 월별 표준재료비 (Excel 불필요) =====
    const mappingsWithCost2 = pnMapping.filter(m => (m.materialCost && m.materialCost > 0) || (m.purchaseUnitPrice && m.purchaseUnitPrice > 0) || (m.injectionCost && m.injectionCost > 0) || (m.paintCost && m.paintCost > 0));
    if (mappingsWithCost2.length > 0 && (forecastData.length > 0 || itemRevenueData.length > 0)) {
      // Build master lookup
      const masterLookup = new Map<string, typeof pnMapping[0]>();
      pnMapping.forEach(m => {
        if (m.internalCode) masterLookup.set(normalizePn(m.internalCode), m);
        if (m.customerPn) masterLookup.set(normalizePn(m.customerPn), m);
      });

      const mstCustToInternal = new Map<string, string>();
      const mstInternalToCust = new Map<string, string>();
      pnMapping.forEach(m => {
        const c = normalizePn(m.customerPn);
        const i = normalizePn(m.internalCode);
        if (c && i) { mstCustToInternal.set(c, i); mstInternalToCust.set(i, c); }
      });

      const findMaster = (rawPn: string) => {
        let m = masterLookup.get(rawPn);
        if (m) return m;
        const asI = mstCustToInternal.get(rawPn);
        if (asI) { m = masterLookup.get(asI); if (m) return m; }
        const asC = mstInternalToCust.get(rawPn);
        if (asC) { m = masterLookup.get(asC); if (m) return m; }
        return null;
      };

      const mstRows: MonthlySummaryRow[] = [];
      let hasData = false;

      // RESIN/PAINT 단가 존재 여부 사전 체크
      const hasInjCost = pnMapping.some(m => m.injectionCost && m.injectionCost > 0);
      const hasPntCost = pnMapping.some(m => m.paintCost && m.paintCost > 0);

      for (let mi = 0; mi < 12; mi++) {
        const monthLabel = `${String(mi + 1).padStart(2, '0')}월`;
        let revenue = 0;
        let stdParts = 0, stdResinM = 0, stdPaintM = 0;
        let matchedRev = 0, unmatchedRev = 0;

        // ── 표준: forecast qty × master 단가 (RESIN/PAINT/구매/외주 모두 포함) ──
        const countedPns = new Set<string>();
        const processItem = (rawPn: string, qty: number, rev: number) => {
          const master = findMaster(rawPn);
          if (!master) { unmatchedRev += rev; return; }
          matchedRev += rev;
          // RESIN/PAINT
          if (master.injectionCost && master.injectionCost > 0) stdResinM += master.injectionCost * qty;
          if (master.paintCost && master.paintCost > 0) stdPaintM += master.paintCost * qty;
          // 구매/외주
          stdParts += (master.purchaseUnitPrice || master.materialCost || 0) * qty;
        };

        if (forecastData.length > 0) {
          for (const item of forecastData) {
            if (!item.partNo) continue;
            const qty = item.monthlyQty?.[mi] || 0;
            const rev = item.monthlyRevenue?.[mi] || 0;
            if (qty <= 0) continue;
            revenue += rev;
            const rawPn = normalizePn(item.partNo);
            countedPns.add(rawPn);
            processItem(rawPn, qty, rev);
          }
        }
        // 매출실적 보완
        if (itemRevenueData.length > 0) {
          for (const row of itemRevenueData) {
            const ym = row.period?.match(/(\d{4})-(\d{1,2})/);
            if (!ym || parseInt(ym[1]) !== selectedYear || parseInt(ym[2]) !== mi + 1) continue;
            const rawPn = normalizePn(row.partNo || row.customerPN || '');
            if (countedPns.has(rawPn)) continue;
            const asI = mstCustToInternal.get(rawPn);
            if (asI && countedPns.has(asI)) continue;
            const asC = mstInternalToCust.get(rawPn);
            if (asC && countedPns.has(asC)) continue;
            countedPns.add(rawPn);
            const qty = row.qty || 0;
            const rev = row.amount || 0;
            revenue += rev;
            if (qty <= 0) { unmatchedRev += rev; continue; }
            processItem(rawPn, qty, rev);
          }
        }

        // 커버리지 보정 (구매/외주)
        const covRatio = matchedRev > 0 ? stdParts / matchedRev : 0;
        if (unmatchedRev > 0 && covRatio > 0) stdParts += unmatchedRev * covRatio;
        // 커버리지 보정 (RESIN/PAINT)
        if (stdResinM > 0 && unmatchedRev > 0 && matchedRev > 0) stdResinM += unmatchedRev * (stdResinM / matchedRev);
        if (stdPaintM > 0 && unmatchedRev > 0 && matchedRev > 0) stdPaintM += unmatchedRev * (stdPaintM / matchedRev);

        // RESIN/PAINT 폴백: 단가 없으면 해당 월 실적 사용
        if (!hasInjCost) {
          stdResinM = purchaseData
            .filter(p => p.category === 'Material' && /사출|resin|수지/i.test(p.type) && p.year === selectedYear && p.month === monthLabel)
            .reduce((s, p) => s + p.amount, 0);
        }
        if (!hasPntCost) {
          stdPaintM = purchaseData
            .filter(p => p.category === 'Material' && /도장|paint|페인트|도료/i.test(p.type) && p.year === selectedYear && p.month === monthLabel)
            .reduce((s, p) => s + p.amount, 0);
        }

        const stdCost = stdResinM + stdPaintM + stdParts;

        if (stdCost > 0) hasData = true;
        const actual = actualByMonth[mi];
        const diff = stdCost - actual;
        const stdRatio = revenue > 0 ? stdCost / revenue : 0;
        const actRatio = revenue > 0 ? actual / revenue : 0;
        const achievement = stdRatio > 0 ? actRatio / stdRatio * 100 : 0;

        mstRows.push({
          month: MONTH_EN[mi],
          monthKr: monthLabel,
          revenue,
          standardCost: stdCost,
          actualCost: actual,
          diff,
          standardRatio: stdRatio,
          actualRatio: actRatio,
          achievementRate: achievement,
        });
      }

      if (hasData) return mstRows;
    }

    // ===== BOM 기반 월별 표준재료비 (근사) =====
    const custToInternal = new Map<string, string>();
    const custToInternals = new Map<string, Set<string>>();
    pnMapping.forEach(m => {
      const cust = normalizePn(m.customerPn);
      const internal = normalizePn(m.internalCode);
      if (cust && internal) {
        custToInternal.set(cust, internal);
        if (!custToInternals.has(cust)) custToInternals.set(cust, new Set());
        custToInternals.get(cust)!.add(internal);
      }
    });

    const rawRelations = buildBomRelations(bomData);
    const bomRelations = new Map<string, BomRecord[]>();
    for (const [key, val] of rawRelations) bomRelations.set(normalizePn(key), val);

    const findBomKey = (rawPn: string): string | null => {
      if (bomRelations.has(rawPn)) return rawPn;
      const asInternal = custToInternal.get(rawPn);
      if (asInternal && bomRelations.has(asInternal)) return asInternal;
      const internals = custToInternals.get(rawPn);
      if (internals) { for (const ic of internals) { if (bomRelations.has(ic)) return ic; } }
      return null;
    };

    const bomRatioCache = new Map<string, Map<string, number>>();
    const getBomRatios = (bomKey: string): Map<string, number> => {
      if (bomRatioCache.has(bomKey)) return bomRatioCache.get(bomKey)!;
      const leaves = expandBomToLeaves(bomKey, 1, bomRelations);
      const ratios = new Map<string, number>();
      for (const leaf of leaves) {
        const nk = normalizePn(leaf.childPn);
        ratios.set(nk, (ratios.get(nk) || 0) + leaf.totalRequired);
      }
      bomRatioCache.set(bomKey, ratios);
      return ratios;
    };

    const priceByCode = new Map<string, { totalQty: number; totalAmt: number }>();
    purchaseData.filter(p => p.year === selectedYear).forEach(p => {
      const code = normalizePn(p.itemCode || '');
      if (!code) return;
      const ex = priceByCode.get(code);
      if (ex) { ex.totalQty += p.qty; ex.totalAmt += p.amount; }
      else priceByCode.set(code, { totalQty: p.qty, totalAmt: p.amount });
    });
    const avgPrice = (code: string): number => {
      const d = priceByCode.get(code);
      return d && d.totalQty > 0 ? d.totalAmt / d.totalQty : 0;
    };

    const rows: MonthlySummaryRow[] = [];
    for (let mi = 0; mi < 12; mi++) {
      const monthLabel = `${String(mi + 1).padStart(2, '0')}월`;
      let revenue = 0;
      let stdCost = 0;

      if (forecastData.length > 0) {
        for (const item of forecastData) {
          if (!item.partNo) continue;
          const qty = item.monthlyQty?.[mi] || 0;
          const rev = item.monthlyRevenue?.[mi] || 0;
          if (qty <= 0) continue;
          revenue += rev;
          const rawPn = normalizePn(item.partNo);
          const bomKey = findBomKey(rawPn);
          if (!bomKey) continue;
          const ratios = getBomRatios(bomKey);
          for (const [leafPn, reqPerUnit] of ratios) {
            stdCost += reqPerUnit * qty * avgPrice(leafPn);
          }
        }
      } else if (itemRevenueData.length > 0) {
        for (const row of itemRevenueData) {
          const ym = row.period?.match(/(\d{4})-(\d{1,2})/);
          if (!ym || parseInt(ym[1]) !== selectedYear) continue;
          if (parseInt(ym[2]) !== mi + 1) continue;
          const qty = row.qty || 0;
          revenue += row.amount || 0;
          if (qty <= 0) continue;
          const rawPn = normalizePn(row.partNo || row.customerPN || '');
          const bomKey = findBomKey(rawPn);
          if (!bomKey) continue;
          const ratios = getBomRatios(bomKey);
          for (const [leafPn, reqPerUnit] of ratios) {
            stdCost += reqPerUnit * qty * avgPrice(leafPn);
          }
        }
      }

      // BOM 미포함 원재료 비용 추가 (근사)
      purchaseData.filter(p =>
        p.category === 'Material' && p.year === selectedYear && p.month === monthLabel
      ).forEach(p => { stdCost += p.amount; });

      const actual = actualByMonth[mi];
      const diff = stdCost - actual;
      const stdRatio = revenue > 0 ? stdCost / revenue : 0;
      const actRatio = revenue > 0 ? actual / revenue : 0;
      const achievement = stdRatio > 0 ? actRatio / stdRatio * 100 : 0;

      rows.push({
        month: MONTH_EN[mi],
        monthKr: monthLabel,
        revenue,
        standardCost: stdCost,
        actualCost: actual,
        diff,
        standardRatio: stdRatio,
        actualRatio: actRatio,
        achievementRate: achievement,
      });
    }

    return rows;
  }, [dataMode, forecastData, itemRevenueData, bomData, pnMapping, purchaseData, selectedYear, excelData]);

  // ============================================================
  // GAP ANALYSIS: Excel vs 구매입고 품목별 비교 분석
  // ============================================================
  const gapAnalysis = useMemo(() => {
    if (!excelData?.items?.length || purchaseData.length === 0) return null;
    const monthIdx = selectedMonth === 'All' ? -1 : parseInt(selectedMonth.replace('월', ''), 10) - 1;

    // 1. Excel items: 품목별 표준재료비 산출
    interface ExcelCalcItem {
      itemCode: string;
      customerPn: string;
      itemName: string;
      supplyType: string;
      production: number;
      resinCost: number;
      paintCost: number;
      purchaseCost: number;
      totalStdCost: number;
    }
    const excelItemMap = new Map<string, ExcelCalcItem>();
    const seenExcelItems = new Set<string>(); // 중복 방지

    for (const item of excelData.items) {
      const prod = monthIdx >= 0
        ? (item.monthlyProduction?.[monthIdx] || 0)
        : (item.totalProduction || 0);
      if (prod <= 0) continue;

      const key = item.itemCode || item.customerPn;
      if (seenExcelItems.has(key)) continue;
      seenExcelItems.add(key);

      const isOutsource = item.supplyType?.includes('외주');
      const resinCost = (item.injectionCost || 0) * prod;
      const paintCost = (item.paintCost || 0) * prod;
      const purchaseCost = (item.purchasePrice || 0) * prod;

      const entry: ExcelCalcItem = {
        itemCode: item.itemCode,
        customerPn: item.customerPn,
        itemName: item.itemName,
        supplyType: isOutsource ? '외주' : '자작',
        production: prod,
        resinCost,
        paintCost,
        purchaseCost,
        totalStdCost: resinCost + paintCost + purchaseCost,
      };

      if (item.itemCode) excelItemMap.set(normalizePn(item.itemCode), entry);
      if (item.customerPn) excelItemMap.set(normalizePn(item.customerPn), entry);
    }

    // 2. P/N 매핑 (구매입고 코드 → Excel 품목 연결)
    const custToInternal = new Map<string, string>();
    const internalToCust = new Map<string, string>();
    pnMapping.forEach(m => {
      const c = normalizePn(m.customerPn);
      const i = normalizePn(m.internalCode);
      if (c && i) { custToInternal.set(c, i); internalToCust.set(i, c); }
    });

    const findExcelItem = (code: string, custPn?: string): ExcelCalcItem | null => {
      if (excelItemMap.has(code)) return excelItemMap.get(code)!;
      if (custPn) { const n = normalizePn(custPn); if (excelItemMap.has(n)) return excelItemMap.get(n)!; }
      const asI = custToInternal.get(code);
      if (asI && excelItemMap.has(asI)) return excelItemMap.get(asI)!;
      const asC = internalToCust.get(code);
      if (asC && excelItemMap.has(asC)) return excelItemMap.get(asC)!;
      return null;
    };

    // 3. 자재마스터 조달구분 조회
    const masterLookup = new Map<string, typeof pnMapping[0]>();
    pnMapping.forEach(m => {
      if (m.internalCode) masterLookup.set(normalizePn(m.internalCode), m);
      if (m.customerPn) masterLookup.set(normalizePn(m.customerPn), m);
    });
    const getSupplyType = (code: string, custPn?: string): string => {
      let m = masterLookup.get(code);
      if (!m && custPn) m = masterLookup.get(normalizePn(custPn));
      return m?.supplyType || '';
    };

    // 4. 구매입고 기간 필터링
    const filteredPurchase = purchaseData.filter(p => {
      if (p.year !== selectedYear) return false;
      if (selectedMonth !== 'All' && p.month !== selectedMonth) return false;
      return true;
    });

    // 5. 구매입고 → Excel 매칭 분석
    let matchedPartsAmt = 0, unmatchedPartsAmt = 0;
    let matchedPartsCount = 0, unmatchedPartsCount = 0;
    let matchedOutsourceAmt = 0, unmatchedOutsourceAmt = 0;
    let matchedInhouseAmt = 0, unmatchedInhouseAmt = 0;

    const unmatchedByItem = new Map<string, { name: string; amount: number; count: number; supplyType: string }>();

    for (const p of filteredPurchase) {
      if (p.category !== 'Parts') continue;
      const code = normalizePn(p.itemCode);
      const exItem = findExcelItem(code, p.customerPn);
      const supply = getSupplyType(code, p.customerPn);
      const isOutsource = supply.includes('외주');

      if (exItem) {
        matchedPartsAmt += p.amount;
        matchedPartsCount++;
        if (isOutsource) matchedOutsourceAmt += p.amount;
        else matchedInhouseAmt += p.amount;
      } else {
        unmatchedPartsAmt += p.amount;
        unmatchedPartsCount++;
        if (isOutsource) unmatchedOutsourceAmt += p.amount;
        else unmatchedInhouseAmt += p.amount;
        // 미매칭 품목 집계
        const ex = unmatchedByItem.get(code);
        if (ex) { ex.amount += p.amount; ex.count++; }
        else unmatchedByItem.set(code, { name: p.itemName, amount: p.amount, count: 1, supplyType: supply || '미분류' });
      }
    }

    // 6. Excel 합계
    const uniqueExcelItems = [...new Set([...excelItemMap.values()])];
    const exResin = uniqueExcelItems.reduce((s, i) => s + i.resinCost, 0);
    const exPaint = uniqueExcelItems.reduce((s, i) => s + i.paintCost, 0);
    const exPurchase = uniqueExcelItems.filter(i => i.supplyType !== '외주').reduce((s, i) => s + i.purchaseCost, 0);
    const exOutsource = uniqueExcelItems.filter(i => i.supplyType === '외주').reduce((s, i) => s + i.purchaseCost, 0);
    const exTotal = exResin + exPaint + exPurchase + exOutsource;

    // 7. 자동산출 합계
    const autoResin = filteredPurchase.filter(p => p.category === 'Material' && /사출|resin|수지/i.test(p.type)).reduce((s, p) => s + p.amount, 0);
    const autoPaint = filteredPurchase.filter(p => p.category === 'Material' && /도장|paint|페인트|도료/i.test(p.type)).reduce((s, p) => s + p.amount, 0);
    const autoOutsource = matchedOutsourceAmt + unmatchedOutsourceAmt;
    const autoInhouse = matchedInhouseAmt + unmatchedInhouseAmt;
    const autoTotal = autoResin + autoPaint + autoOutsource + autoInhouse;

    // 8. 미매칭 상위 품목
    const topUnmatched = [...unmatchedByItem.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 15);

    // 9. Console 출력
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  표준재료비 Gap 분석 (${selectedMonth === 'All' ? '연간' : selectedMonth})`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n📊 Excel vs 자동산출 비교:`);
    console.log(`${'─'.repeat(50)}`);
    console.log(`  ${'구분'.padEnd(12)} ${'Excel'.padStart(15)} ${'자동산출'.padStart(15)} ${'Gap'.padStart(15)}`);
    console.log(`  ${'RESIN'.padEnd(12)} ${('₩'+Math.round(exResin).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoResin).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoResin-exResin).toLocaleString()).padStart(15)}`);
    console.log(`  ${'PAINT'.padEnd(12)} ${('₩'+Math.round(exPaint).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoPaint).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoPaint-exPaint).toLocaleString()).padStart(15)}`);
    console.log(`  ${'구매(자작)'.padEnd(12)} ${('₩'+Math.round(exPurchase).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoInhouse).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoInhouse-exPurchase).toLocaleString()).padStart(15)}`);
    console.log(`  ${'외주'.padEnd(12)} ${('₩'+Math.round(exOutsource).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoOutsource).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoOutsource-exOutsource).toLocaleString()).padStart(15)}`);
    console.log(`  ${'─'.repeat(48)}`);
    console.log(`  ${'합계'.padEnd(12)} ${('₩'+Math.round(exTotal).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoTotal).toLocaleString()).padStart(15)} ${('₩'+Math.round(autoTotal-exTotal).toLocaleString()).padStart(15)}`);

    console.log(`\n🔍 구매입고 매칭 분석 (Parts ${filteredPurchase.filter(p=>p.category==='Parts').length}건):`);
    console.log(`  Excel 매칭: ${matchedPartsCount}건 ₩${Math.round(matchedPartsAmt).toLocaleString()}`);
    console.log(`    ├ 자작: ₩${Math.round(matchedInhouseAmt).toLocaleString()}`);
    console.log(`    └ 외주: ₩${Math.round(matchedOutsourceAmt).toLocaleString()}`);
    console.log(`  미매칭:     ${unmatchedPartsCount}건 ₩${Math.round(unmatchedPartsAmt).toLocaleString()} ← 과다산출 원인`);
    console.log(`    ├ 자작: ₩${Math.round(unmatchedInhouseAmt).toLocaleString()}`);
    console.log(`    └ 외주: ₩${Math.round(unmatchedOutsourceAmt).toLocaleString()}`);

    console.log(`\n📋 미매칭 상위 ${topUnmatched.length}건 (과다산출 원인):`);
    topUnmatched.forEach(([code, info], i) => {
      console.log(`  ${String(i+1).padStart(2)}. ${code.slice(0,20).padEnd(20)} ${info.name.slice(0,15).padEnd(15)} ₩${Math.round(info.amount).toLocaleString().padStart(12)} [${info.supplyType}] (${info.count}건)`);
    });

    const accuracy = exTotal > 0 ? ((1 - Math.abs(autoTotal - exTotal) / exTotal) * 100).toFixed(1) : '0';
    console.log(`\n✅ 정확도: ${accuracy}% (Gap ₩${Math.round(Math.abs(autoTotal - exTotal)).toLocaleString()}, ${autoTotal > exTotal ? '과다' : '과소'})`);
    console.log(`💡 미매칭 제거 시 예상: ₩${Math.round(autoTotal - unmatchedPartsAmt).toLocaleString()} (정확도 ${exTotal > 0 ? ((1 - Math.abs((autoTotal - unmatchedPartsAmt) - exTotal) / exTotal) * 100).toFixed(1) : '0'}%)`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      exResin, exPaint, exPurchase, exOutsource, exTotal,
      autoResin, autoPaint, autoOutsource, autoInhouse, autoTotal,
      matchedPartsAmt, unmatchedPartsAmt, matchedPartsCount, unmatchedPartsCount,
      matchedOutsourceAmt, unmatchedOutsourceAmt, matchedInhouseAmt, unmatchedInhouseAmt,
      topUnmatched,
      accuracy: parseFloat(accuracy),
    };
  }, [excelData, purchaseData, pnMapping, selectedYear, selectedMonth]);

  // --- 표준 vs 실적 비교 데이터 ---
  const comparisonData = useMemo(() => {
    if (!autoCalcResult || !autoCalcResult.rows.length) return null;

    // Build P/N mappings (bidirectional + multi-value)
    const custToInternals = new Map<string, Set<string>>();
    const internalToCusts = new Map<string, Set<string>>();
    pnMapping.forEach(m => {
      const cust = normalizePn(m.customerPn);
      const internal = normalizePn(m.internalCode);
      if (cust && internal) {
        if (!custToInternals.has(cust)) custToInternals.set(cust, new Set());
        custToInternals.get(cust)!.add(internal);
        if (!internalToCusts.has(internal)) internalToCusts.set(internal, new Set());
        internalToCusts.get(internal)!.add(cust);
      }
    });

    // Build pnMapping lookup for supplyType
    const masterLookup = new Map<string, typeof pnMapping[0]>();
    pnMapping.forEach(m => {
      if (m.internalCode) masterLookup.set(normalizePn(m.internalCode), m);
      if (m.customerPn) masterLookup.set(normalizePn(m.customerPn), m);
    });

    // --- Standard side: from autoCalcResult.rows (통합엔진 결과) ---
    const stdMap = new Map<string, { code: string; name: string; supplyType: string; qty: number; unitPrice: number; amount: number }>();
    for (const row of autoCalcResult.rows) {
      const code = normalizePn(row.childPn);
      if (!code) continue;
      const master = masterLookup.get(code);
      let supplyType = master?.supplyType || '';
      if (!supplyType) {
        if (row.materialType === '외주') supplyType = '외주';
        else if (row.materialType === '구매') supplyType = '구매';
        else supplyType = '자작';
      }
      stdMap.set(code, {
        code: row.childPn,
        name: row.childName,
        supplyType,
        qty: row.standardReq,
        unitPrice: row.avgUnitPrice,
        amount: row.standardCost,
      });
    }

    // --- Actual side: from purchaseData (입고실적) ---
    const filteredPurchase = purchaseData.filter(p => {
      if (p.year !== selectedYear) return false;
      if (selectedMonth !== 'All' && p.month !== selectedMonth) return false;
      return true;
    });
    const actMap = new Map<string, { code: string; name: string; qty: number; amount: number }>();
    for (const p of filteredPurchase) {
      const code = normalizePn(p.itemCode || '');
      if (!code) continue;
      const existing = actMap.get(code);
      if (existing) {
        existing.qty += p.qty;
        existing.amount += p.amount;
      } else {
        actMap.set(code, { code: p.itemCode, name: p.itemName, qty: p.qty, amount: p.amount });
      }
    }

    // --- Join: standard ↔ actual via normalizePn + pnMapping bridge ---
    const rows: ComparisonRow[] = [];
    const matchedActCodes = new Set<string>();

    // Resolve actual code for a given standard code
    const findActual = (stdCode: string): string | null => {
      if (actMap.has(stdCode)) return stdCode;
      // stdCode → custPn variants
      const custs = internalToCusts.get(stdCode);
      if (custs) { for (const c of custs) { if (actMap.has(c)) return c; } }
      // stdCode → internalCode variants
      const internals = custToInternals.get(stdCode);
      if (internals) { for (const ic of internals) { if (actMap.has(ic)) return ic; } }
      return null;
    };

    for (const [stdCode, std] of stdMap) {
      const actCode = findActual(stdCode);
      if (actCode) {
        const act = actMap.get(actCode)!;
        matchedActCodes.add(actCode);
        // Also mark all aliases
        const custs = internalToCusts.get(stdCode);
        if (custs) custs.forEach(c => matchedActCodes.add(c));
        const internals = custToInternals.get(stdCode);
        if (internals) internals.forEach(ic => matchedActCodes.add(ic));
        matchedActCodes.add(stdCode);

        const actUnitPrice = act.qty > 0 ? act.amount / act.qty : 0;
        const diff = std.amount - act.amount;
        const diffRate = std.amount > 0 ? (diff / std.amount) * 100 : (act.amount > 0 ? -100 : 0);
        rows.push({
          itemCode: std.code,
          itemName: std.name,
          supplyType: std.supplyType,
          stdQty: std.qty,
          stdUnitPrice: std.unitPrice,
          stdAmount: std.amount,
          actQty: act.qty,
          actUnitPrice,
          actAmount: act.amount,
          diffAmount: diff,
          diffRate,
          absDiffAmount: Math.abs(diff),
          matchStatus: 'matched',
        });
      } else {
        // 표준에만 존재
        rows.push({
          itemCode: std.code,
          itemName: std.name,
          supplyType: std.supplyType,
          stdQty: std.qty,
          stdUnitPrice: std.unitPrice,
          stdAmount: std.amount,
          actQty: 0,
          actUnitPrice: 0,
          actAmount: 0,
          diffAmount: std.amount,
          diffRate: 100,
          absDiffAmount: std.amount,
          matchStatus: 'std-only',
        });
      }
    }

    // 실적에만 존재하는 품목
    for (const [actCode, act] of actMap) {
      if (matchedActCodes.has(actCode)) continue;
      const master = masterLookup.get(actCode);
      let supplyType = master?.supplyType || '미분류';
      rows.push({
        itemCode: act.code,
        itemName: act.name,
        supplyType,
        stdQty: 0,
        stdUnitPrice: 0,
        stdAmount: 0,
        actQty: act.qty,
        actUnitPrice: act.qty > 0 ? act.amount / act.qty : 0,
        actAmount: act.amount,
        diffAmount: -act.amount,
        diffRate: -100,
        absDiffAmount: act.amount,
        matchStatus: 'act-only',
      });
    }

    // 기본 정렬: absDiffAmount 내림차순
    rows.sort((a, b) => b.absDiffAmount - a.absDiffAmount);

    // 요약
    const matched = rows.filter(r => r.matchStatus === 'matched');
    const totalStd = rows.reduce((s, r) => s + r.stdAmount, 0);
    const totalAct = rows.reduce((s, r) => s + r.actAmount, 0);
    const supplyTypes = [...new Set(rows.map(r => r.supplyType).filter(Boolean))].sort();

    return {
      rows,
      totalMatched: matched.length,
      totalRows: rows.length,
      totalStd,
      totalAct,
      totalGap: totalStd - totalAct,
      supplyTypes,
    };
  }, [autoCalcResult, purchaseData, pnMapping, selectedYear, selectedMonth]);

  // ============================================================
  // BOM 파이프라인 진단 (diagnostic)
  // 표준재료비 = 매출수량(고객사P/N) × 단가/EA
  // 각 품목별로 파이프라인 어디가 끊기는지 진단
  // ============================================================
  const [diagFilterStatus, setDiagFilterStatus] = useState('All');

  const diagnosticData = useMemo(() => {
    // P/N 매핑 빌드
    const custToInt = new Map<string, string>();
    const intToCust = new Map<string, string>();
    pnMapping.forEach(m => {
      const cust = normalizePn(m.customerPn);
      const internal = normalizePn(m.internalCode);
      if (cust && internal) {
        custToInt.set(cust, internal);
        intToCust.set(internal, cust);
      }
    });

    // pnMapping lookup by normalized code
    const masterLookup = new Map<string, typeof pnMapping[0]>();
    pnMapping.forEach(m => {
      if (m.internalCode) masterLookup.set(normalizePn(m.internalCode), m);
      if (m.customerPn) masterLookup.set(normalizePn(m.customerPn), m);
    });

    // excelData.items lookup by normalized itemCode or customerPn
    const excelItemLookup = new Map<string, { injectionCost: number; paintCost: number; purchasePrice: number; itemName: string; supplyType: string; processType: string }>();
    if (excelData?.items) {
      for (const item of excelData.items) {
        const entry = {
          injectionCost: item.injectionCost || 0,
          paintCost: item.paintCost || 0,
          purchasePrice: item.purchasePrice || 0,
          itemName: item.itemName || '',
          supplyType: item.supplyType || '',
          processType: item.processType || '',
        };
        if (item.itemCode) excelItemLookup.set(normalizePn(item.itemCode), entry);
        if (item.customerPn) excelItemLookup.set(normalizePn(item.customerPn), entry);
      }
    }

    const monthIdx = selectedMonth === 'All' ? -1 : parseInt(selectedMonth.replace('월', ''), 10) - 1;
    const rows: DiagnosticRow[] = [];
    const processedPns = new Set<string>();

    // --- 1. forecastData 기준 순회 (매출계획 있는 품목) ---
    for (const fi of forecastData) {
      if (!fi.partNo) continue;
      const custPn = normalizePn(fi.partNo);
      if (!custPn || processedPns.has(custPn)) continue;
      processedPns.add(custPn);

      const qty = monthIdx >= 0
        ? (fi.monthlyQty?.[monthIdx] || 0)
        : (fi.totalQty || 0);
      if (qty <= 0) continue;

      // P/N 매핑
      const internalCode = custToInt.get(custPn) || '';
      const hasPnMapping = !!internalCode;

      // 단가 조회 (excelData.items 우선 → pnMapping fallback)
      let exItem = excelItemLookup.get(custPn);
      if (!exItem && internalCode) exItem = excelItemLookup.get(internalCode);

      const master = masterLookup.get(custPn) || (internalCode ? masterLookup.get(internalCode) : undefined);

      const injCost = exItem?.injectionCost || master?.injectionCost || 0;
      const pntCost = exItem?.paintCost || master?.paintCost || 0;
      const purPrice = exItem?.purchasePrice || master?.purchaseUnitPrice || 0;
      const unitCost = injCost + pntCost + purPrice;
      const hasUnitCost = unitCost > 0;

      const itemName = exItem?.itemName || master?.partName || fi.partName || '';
      const supplyType = exItem?.supplyType || master?.supplyType || '';
      const processType = exItem?.processType || master?.processType || '';

      let breakPoint = '정상';
      let breakLevel: 0 | 1 | 2 | 3 = 0;
      if (!hasPnMapping) { breakPoint = 'P/N 매핑 없음'; breakLevel = 2; }
      else if (!hasUnitCost) { breakPoint = '단가 없음'; breakLevel = 3; }

      rows.push({
        customerPn: fi.partNo,
        internalCode: internalCode || '-',
        itemName,
        supplyType: supplyType || '미분류',
        processType: processType || '-',
        hasForecast: true,
        forecastQty: qty,
        hasPnMapping,
        hasUnitCost,
        unitCostPerEa: unitCost,
        injectionCost: injCost,
        paintCost: pntCost,
        purchasePrice: purPrice,
        stdAmount: qty * unitCost,
        breakPoint,
        breakLevel,
      });
    }

    // --- 2. pnMapping에 있지만 forecastData에 없는 품목 ---
    for (const m of pnMapping) {
      const custPn = normalizePn(m.customerPn);
      const internalCode = normalizePn(m.internalCode);
      if (processedPns.has(custPn) || processedPns.has(internalCode)) continue;
      const key = custPn || internalCode;
      if (!key) continue;
      processedPns.add(key);

      let exItem = excelItemLookup.get(custPn) || excelItemLookup.get(internalCode);
      const injCost = exItem?.injectionCost || m.injectionCost || 0;
      const pntCost = exItem?.paintCost || m.paintCost || 0;
      const purPrice = exItem?.purchasePrice || m.purchaseUnitPrice || 0;
      const unitCost = injCost + pntCost + purPrice;

      rows.push({
        customerPn: m.customerPn || '-',
        internalCode: m.internalCode || '-',
        itemName: exItem?.itemName || m.partName || '',
        supplyType: exItem?.supplyType || m.supplyType || '미분류',
        processType: exItem?.processType || m.processType || '-',
        hasForecast: false,
        forecastQty: 0,
        hasPnMapping: !!(custPn && internalCode),
        hasUnitCost: unitCost > 0,
        unitCostPerEa: unitCost,
        injectionCost: injCost,
        paintCost: pntCost,
        purchasePrice: purPrice,
        stdAmount: 0,
        breakPoint: '매출계획 없음',
        breakLevel: 1,
      });
    }

    // 정렬: breakLevel 내림 → stdAmount 내림
    rows.sort((a, b) => b.breakLevel - a.breakLevel || b.stdAmount - a.stdAmount);

    const okCount = rows.filter(r => r.breakLevel === 0).length;
    const forecastMissCount = rows.filter(r => r.breakLevel === 1).length;
    const pnMissCount = rows.filter(r => r.breakLevel === 2).length;
    const costMissCount = rows.filter(r => r.breakLevel === 3).length;
    const totalStdAmount = rows.filter(r => r.breakLevel === 0).reduce((s, r) => s + r.stdAmount, 0);

    return {
      rows,
      totalProducts: rows.length,
      okCount,
      forecastMissCount,
      pnMissCount,
      costMissCount,
      totalStdAmount,
      coverageRate: rows.length > 0 ? (okCount / rows.length) * 100 : 0,
    };
  }, [forecastData, pnMapping, excelData, selectedMonth]);

  // Filtered diagnostic rows
  const filteredDiagRows = useMemo(() => {
    if (!diagnosticData) return [];
    let filtered = diagnosticData.rows;

    // 상태 필터
    if (diagFilterStatus === '정상') filtered = filtered.filter(r => r.breakLevel === 0);
    else if (diagFilterStatus === '매출계획없음') filtered = filtered.filter(r => r.breakLevel === 1);
    else if (diagFilterStatus === 'P/N미매핑') filtered = filtered.filter(r => r.breakLevel === 2);
    else if (diagFilterStatus === '단가없음') filtered = filtered.filter(r => r.breakLevel === 3);

    // 검색
    if (searchText) {
      const q = searchText.toLowerCase();
      filtered = filtered.filter(r =>
        r.customerPn.toLowerCase().includes(q) ||
        r.internalCode.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q)
      );
    }

    // 정렬
    if (sortConfig) {
      const { key, dir } = sortConfig;
      filtered = [...filtered].sort((a, b) => {
        const av = (a as any)[key];
        const bv = (b as any)[key];
        if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
        return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return filtered;
  }, [diagnosticData, diagFilterStatus, searchText, sortConfig]);

  const pagedDiagRows = filteredDiagRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const diagTotalPages = Math.ceil(filteredDiagRows.length / PAGE_SIZE);

  // BOM 팝업 데이터 (선택된 P/N의 BOM 전개)
  // BOM 트리 노드 타입
  interface BomTreeNode {
    id: string;
    childPn: string;
    childName: string;
    qty: number;
    supplier: string;
    partType: string;
    level: number;
    unitPrice: number;  // 단가 (원/EA)
    children: BomTreeNode[];
  }

  // BOM 팝업: 트리 구조 빌드 (원재료 전개 포함)
  const bomPopupData = useMemo(() => {
    if (!bomPopupPn) return null;
    // normalized BOM relations (키를 normalizePn으로 통일)
    const rawRelations = buildBomRelations(bomData);
    const bomRelations = new Map<string, BomRecord[]>();
    for (const [key, recs] of rawRelations) {
      const nk = normalizePn(key);
      const existing = bomRelations.get(nk) || [];
      bomRelations.set(nk, [...existing, ...recs]);
    }

    const custPn = normalizePn(bomPopupPn.customerPn);
    const intCode = normalizePn(bomPopupPn.internalCode);

    let bomKey = '';
    if (intCode && bomRelations.has(intCode)) bomKey = intCode;
    else if (custPn && bomRelations.has(custPn)) bomKey = custPn;
    else {
      for (const key of bomRelations.keys()) {
        if (key.includes(intCode) || key.includes(custPn)) { bomKey = key; break; }
      }
    }

    // pnMapping에서 원재료코드 매핑 빌드
    const rawMaterialMap = new Map<string, { code: string; name: string }[]>();
    pnMapping.forEach(m => {
      const ic = normalizePn(m.internalCode);
      if (!ic) return;
      const raws: { code: string; name: string }[] = [];
      if (m.rawMaterialCode1) raws.push({ code: m.rawMaterialCode1, name: `원재료1 (${m.processType || 'RESIN'})` });
      if (m.rawMaterialCode2) raws.push({ code: m.rawMaterialCode2, name: `원재료2 (PAINT)` });
      if (raws.length > 0) rawMaterialMap.set(ic, raws);
    });

    // 원재료 단가 조회용 (excelData.materialPrices)
    const matPriceLookup = new Map<string, string>();
    if (excelData?.materialPrices) {
      for (const mp of excelData.materialPrices) {
        if ((mp as any).materialCode && (mp as any).materialName) {
          matPriceLookup.set(normalizePn((mp as any).materialCode), (mp as any).materialName);
        }
      }
    }

    // 품명 보충용 룩업 (pnMapping + excelData)
    const nameLookup = new Map<string, string>();
    pnMapping.forEach(m => {
      if (m.partName) {
        if (m.internalCode) nameLookup.set(normalizePn(m.internalCode), m.partName);
        if (m.customerPn) nameLookup.set(normalizePn(m.customerPn), m.partName);
      }
    });
    if (excelData?.items) {
      for (const it of excelData.items) {
        if (it.itemName) {
          if (it.itemCode) nameLookup.set(normalizePn(it.itemCode), it.itemName);
          if (it.customerPn) nameLookup.set(normalizePn(it.customerPn), it.itemName);
        }
      }
    }
    // purchaseData에서도 품명 보충
    purchaseData.forEach(p => {
      if (p.itemName && p.itemCode) nameLookup.set(normalizePn(p.itemCode), p.itemName);
    });

    // 단가 조회 맵: 정규화된 코드 → 단가 (purchaseUnitPrice > materialCost 우선)
    const priceLookup = new Map<string, number>();
    pnMapping.forEach(m => {
      const ic = normalizePn(m.internalCode);
      const cp = normalizePn(m.customerPn);
      const price = m.purchaseUnitPrice || m.materialCost || 0;
      if (price > 0) {
        if (ic) priceLookup.set(ic, price);
        if (cp) priceLookup.set(cp, price);
      }
    });

    // 재귀적으로 트리 빌드
    const buildTree = (parentKey: string, depth: number, visited: Set<string>): BomTreeNode[] => {
      if (visited.has(parentKey) || depth > 10) return [];
      visited.add(parentKey);
      const children = bomRelations.get(parentKey) || [];
      const nodes: BomTreeNode[] = children.map((c, idx) => {
        const nodeId = `${parentKey}-${c.childPn}-${idx}`;
        const childNorm = normalizePn(c.childPn);
        let subChildren = buildTree(childNorm, depth + 1, new Set(visited));

        // Leaf 노드이고 BOM 하위가 없으면 원재료 전개 시도
        if (subChildren.length === 0) {
          const raws = rawMaterialMap.get(childNorm);
          if (raws) {
            subChildren = raws.map((raw, ri) => ({
              id: `${nodeId}-raw-${ri}`,
              childPn: raw.code,
              childName: matPriceLookup.get(normalizePn(raw.code)) || nameLookup.get(normalizePn(raw.code)) || raw.name,
              qty: 1,
              supplier: '',
              partType: raw.name.includes('PAINT') ? 'PAINT' : 'RESIN',
              level: depth + 2,
              unitPrice: priceLookup.get(normalizePn(raw.code)) || 0,
              children: [],
            }));
          }
        }

        // 품명: nameLookup(개별 품명) 우선, BOM childName(모품목명일 수 있음) fallback
        const resolvedName = nameLookup.get(childNorm) || c.childName || '';

        return {
          id: nodeId,
          childPn: c.childPn,
          childName: resolvedName,
          qty: c.qty,
          supplier: c.supplier,
          partType: c.partType,
          level: c.level,
          unitPrice: priceLookup.get(childNorm) || 0,
          children: subChildren,
        };
      });
      return nodes;
    };

    const tree = bomKey ? buildTree(bomKey, 0, new Set()) : [];
    const countNodes = (nodes: BomTreeNode[]): number => nodes.reduce((s, n) => s + 1 + countNodes(n.children), 0);

    // 재료비합계: leaf 노드의 unitPrice × qty 재귀 합산
    const calcMaterialCost = (nodes: BomTreeNode[], parentQty: number): number =>
      nodes.reduce((sum, n) => {
        const effectiveQty = parentQty * n.qty;
        if (n.children.length === 0) {
          return sum + (n.unitPrice * effectiveQty);
        }
        return sum + calcMaterialCost(n.children, effectiveQty);
      }, 0);
    const totalMaterialCost = Math.round(calcMaterialCost(tree, 1));

    // 판매가: itemRevenueData에서 해당 품번의 평균 단가 (amount / qty)
    const custPnForPrice = bomPopupPn?.customerPn || '';
    const intCodeForPrice = bomPopupPn?.internalCode || '';
    let totalSalesAmount = 0;
    let totalSalesQty = 0;
    itemRevenueData.forEach(row => {
      const rPn = row.partNo?.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') || '';
      const rCpn = row.customerPN?.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') || '';
      const cNorm = custPnForPrice.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
      const iNorm = intCodeForPrice.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
      if (rPn === cNorm || rPn === iNorm || rCpn === cNorm || rCpn === iNorm) {
        totalSalesAmount += row.amount || 0;
        totalSalesQty += row.qty || 0;
      }
    });
    const sellingPrice = totalSalesQty > 0 ? Math.round(totalSalesAmount / totalSalesQty) : 0;
    const materialRatio = sellingPrice > 0 ? Math.round((totalMaterialCost / sellingPrice) * 1000) / 10 : 0;

    return { tree, bomKey, totalNodes: countNodes(tree), totalMaterialCost, sellingPrice, materialRatio };
  }, [bomPopupPn, bomData, pnMapping, excelData, itemRevenueData]);

  // BOM 편집 상태
  const [bomEditingId, setBomEditingId] = useState<string | null>(null);
  const [bomEditForm, setBomEditForm] = useState({ childPn: '', childName: '', qty: '', supplier: '', partType: '', unitPrice: '' });
  const [bomAddingParent, setBomAddingParent] = useState<string | null>(null); // 추가 대상 부모 key
  const [bomAddForm, setBomAddForm] = useState({ childPn: '', childName: '', qty: '1', supplier: '', partType: '' });

  // --- 도면 자동 분석 ---
  const runDrawingAnalysis = useCallback(async (dataUrl: string) => {
    if (!bomPopupData || !bomPopupPn) return;
    setDrawingAnalyzing(true);
    setDrawingAnalysis(null);
    try {
      const rawText = await extractTextFromPdf(dataUrl);
      const drawingItems = extractBomFromText(rawText);
      // 도면 Part List는 1차 자재만 표시 → 1차 자재(top-level)만 비교
      const topLevelChildren = bomPopupData.tree.map(n => ({
        childPn: n.childPn,
        childName: n.childName,
        qty: n.qty,
      }));
      const result = compareBomWithDrawing(drawingItems, topLevelChildren);
      result.rawText = rawText;

      // "도면 미확인" 항목을 자동 분류 (하위자재/원재료 vs 실제 미확인)
      const classifyExtra = (item: { childPn: string; childName: string; qty: number }) => {
        const pnNorm = normalizePn(item.childPn);
        // 하위자재 여부: top-level 노드의 children에 존재
        for (const topNode of bomPopupData.tree) {
          for (const child of topNode.children) {
            if (normalizePn(child.childPn) === pnNorm) {
              return { ...item, reason: 'sub' as const, parentPn: topNode.childPn };
            }
            for (const gc of child.children) {
              if (normalizePn(gc.childPn) === pnNorm) {
                return { ...item, reason: 'sub' as const, parentPn: child.childPn };
              }
            }
          }
        }
        // 원재료 여부: partType에 RESIN/PAINT 포함 또는 rawMaterial 코드
        for (const topNode of bomPopupData.tree) {
          const findInTree = (nodes: BomTreeNode[]): BomTreeNode | null => {
            for (const n of nodes) {
              if (normalizePn(n.childPn) === pnNorm) return n;
              const found = findInTree(n.children);
              if (found) return found;
            }
            return null;
          };
          const found = findInTree(topNode.children);
          if (found && /RESIN|PAINT|원재료/i.test(found.partType)) {
            return { ...item, reason: 'raw' as const, parentPn: '' };
          }
        }
        return { ...item, reason: 'unknown' as const, parentPn: '' };
      };

      // extraInBom에 분류 정보 추가 (커스텀 필드로)
      (result as any).classifiedExtra = result.extraInBom.map(classifyExtra);

      setDrawingAnalysis(result);
    } catch (err) {
      console.error('도면 분석 실패:', err);
      setDrawingAnalysis(null);
    } finally {
      setDrawingAnalyzing(false);
    }
  }, [bomPopupData, bomPopupPn]);

  // BOM 자재 추가
  const handleBomAdd = useCallback((parentPn: string) => {
    if (!bomAddForm.childPn.trim()) return;
    const newRecord: BomRecord = {
      parentPn,
      childPn: bomAddForm.childPn.trim(),
      childName: bomAddForm.childName.trim(),
      level: 1,
      qty: parseFloat(bomAddForm.qty) || 1,
      supplier: bomAddForm.supplier.trim(),
      partType: bomAddForm.partType.trim(),
    };
    setBomData(prev => {
      const next = [...prev, newRecord];
      try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
    setBomAddForm({ childPn: '', childName: '', qty: '1', supplier: '', partType: '' });
    setBomAddingParent(null);
  }, [bomAddForm]);

  // BOM 자재 수정
  const handleBomEdit = useCallback((originalChildPn: string, parentPn: string) => {
    // 단가 수정: pnMapping에 반영
    const editedPrice = parseFloat(bomEditForm.unitPrice) || 0;
    if (editedPrice > 0) {
      const editedCode = (bomEditForm.childPn.trim() || originalChildPn).trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
      setPnMapping(prev => {
        const existing = prev.find(m => normalizePn(m.internalCode) === editedCode || normalizePn(m.customerPn) === editedCode);
        let next: PnMapping[];
        if (existing) {
          next = prev.map(m => (m === existing) ? { ...m, purchaseUnitPrice: editedPrice } : m);
        } else {
          next = [...prev, { customerPn: '', internalCode: bomEditForm.childPn.trim() || originalChildPn, partName: bomEditForm.childName.trim(), purchaseUnitPrice: editedPrice }];
        }
        try { localStorage.setItem('dashboard_pnMapping', JSON.stringify(next)); } catch { /* */ }
        return next;
      });
    }

    setBomData(prev => {
      const next = prev.map(r => {
        if (r.parentPn === parentPn && r.childPn === originalChildPn) {
          return {
            ...r,
            childPn: bomEditForm.childPn.trim() || r.childPn,
            childName: bomEditForm.childName.trim(),
            qty: parseFloat(bomEditForm.qty) || r.qty,
            supplier: bomEditForm.supplier.trim(),
            partType: bomEditForm.partType.trim(),
          };
        }
        return r;
      });
      try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
    setBomEditingId(null);
  }, [bomEditForm]);

  // BOM 자재 삭제
  const handleBomDelete = useCallback((childPn: string, parentPn: string) => {
    if (!confirm(`"${childPn}" 자재를 삭제하시겠습니까?`)) return;
    setBomData(prev => {
      const next = prev.filter(r => !(r.parentPn === parentPn && r.childPn === childPn));
      try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // BOM 확인 체크 핸들러
  const handleBomConfirm = useCallback((customerPn: string) => {
    const now = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    setConfirmedBomPns(prev => {
      const next = { ...prev };
      if (next[customerPn]) {
        delete next[customerPn]; // 토글: 이미 체크되어 있으면 해제
      } else {
        next[customerPn] = now;
      }
      try { localStorage.setItem('dashboard_bomConfirmed', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // --- Excel upload ---
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const monthStr = selectedMonth === 'All' ? '01월' : selectedMonth;
      const parsed = parseStandardMaterialExcel(workbook, selectedYear, monthStr);

      // 참조 데이터 파싱 결과 로깅
      const refSheets = [
        parsed.productInfo?.length && `품목정보 ${parsed.productInfo.length}건`,
        parsed.materialPrices?.length && `재질단가 ${parsed.materialPrices.length}건`,
        parsed.purchasePrices?.length && `구매단가 ${parsed.purchasePrices.length}건`,
        parsed.outsourcePrices?.length && `외주사출 ${parsed.outsourcePrices.length}건`,
        parsed.paintMixRatios?.length && `도료배합 ${parsed.paintMixRatios.length}건`,
      ].filter(Boolean);
      if (refSheets.length > 0) {
        console.log(`[표준재료비] 참조시트 로드: ${refSheets.join(', ')}`);
      }

      setExcelData(parsed);
      // localStorage 저장 (참조데이터 제외하여 용량 절감)
      try {
        const forStorage = { ...parsed };
        // 참조 시트 데이터는 용량이 크므로 localStorage에서 제외 (매번 업로드 시 재파싱)
        delete forStorage.productInfo;
        delete forStorage.materialPrices;
        delete forStorage.purchasePrices;
        delete forStorage.outsourcePrices;
        delete forStorage.paintMixRatios;
        const jsonStr = JSON.stringify(forStorage);
        // localStorage + sessionStorage 이중 저장 (용량 초과 대비)
        try { localStorage.setItem('dashboard_standardMaterial', jsonStr); } catch {
          console.warn('[표준재료비] localStorage 저장 실패 (용량 초과), items 경량화 시도');
          // items 경량화: 산출에 필요한 핵심 필드만 보존
          const lightItems = forStorage.items?.map((it: any) => ({
            itemCode: it.itemCode, customerPn: it.customerPn, itemName: it.itemName,
            supplyType: it.supplyType, processType: it.processType,
            injectionCost: it.injectionCost, paintCost: it.paintCost,
            purchasePrice: it.purchasePrice, materialCost: it.materialCost,
            resinCost: it.resinCost, paintCostTotal: it.paintCostTotal || it.paintCostAmount,
            purchaseCost: it.purchaseCost, totalCost: it.totalCost,
          }));
          const lightData = { ...forStorage, items: lightItems };
          try { localStorage.setItem('dashboard_standardMaterial', JSON.stringify(lightData)); }
          catch { console.warn('[표준재료비] 경량화 후에도 localStorage 초과'); }
        }
        try { sessionStorage.setItem('dashboard_standardMaterial', jsonStr); } catch { /* */ }
      } catch (storageErr) {
        console.warn('[표준재료비] localStorage 저장 실패:', storageErr);
      }

      // ── Excel 품목별 사출재료비/도장재료비를 pnMapping에 병합 ──
      if (parsed.items && parsed.items.length > 0) {
        const updatedMapping = [...pnMapping];
        const existingMap = new Map(updatedMapping.map(m => [m.internalCode, m]));
        let mergedCount = 0;
        for (const item of parsed.items) {
          if (!item.itemCode) continue;
          const existing = existingMap.get(item.itemCode);
          if (existing) {
            if (item.injectionCost > 0) existing.injectionCost = item.injectionCost;
            if (item.paintCost > 0) existing.paintCost = item.paintCost;
            mergedCount++;
          } else {
            // 새 항목 추가
            const newEntry: PnMapping = {
              customerPn: item.customerPn || '',
              internalCode: item.itemCode,
              partName: item.itemName || '',
              ...(item.supplyType ? { supplyType: item.supplyType } : {}),
              ...(item.processType ? { processType: item.processType } : {}),
              ...(item.purchasePrice > 0 ? { purchaseUnitPrice: item.purchasePrice } : {}),
              ...(item.materialCost > 0 ? { materialCost: item.materialCost } : {}),
              ...(item.injectionCost > 0 ? { injectionCost: item.injectionCost } : {}),
              ...(item.paintCost > 0 ? { paintCost: item.paintCost } : {}),
            };
            updatedMapping.push(newEntry);
            existingMap.set(item.itemCode, newEntry);
            mergedCount++;
          }
        }
        if (mergedCount > 0) {
          setPnMapping(updatedMapping);
          try { sessionStorage.setItem('dashboard_pnMapping', JSON.stringify(updatedMapping)); } catch { /* */ }
          try { localStorage.setItem('dashboard_pnMapping', JSON.stringify(updatedMapping)); } catch { /* */ }
          console.log(`[표준재료비] Excel→pnMapping 병합: ${mergedCount}건 (사출/도장 단가 포함)`);
        }
      }

      setViewMode('summary');
      setPage(0);
    } catch (err) {
      console.error('표준재료비 파싱 오류:', err);
      alert('엑셀 파싱 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [selectedYear, selectedMonth, pnMapping]);

  // --- Filtered rows (auto mode) ---
  const filteredAutoRows = useMemo(() => {
    if (!autoCalcResult) return [];
    let rows = autoCalcResult.rows;

    if (searchText) {
      const q = searchText.toLowerCase();
      rows = rows.filter(r =>
        r.childPn.toLowerCase().includes(q) ||
        r.childName.toLowerCase().includes(q) ||
        r.supplier.toLowerCase().includes(q)
      );
    }
    if (filterType !== 'All') rows = rows.filter(r => r.materialType === filterType);
    if (filterSupplier !== 'All') rows = rows.filter(r => r.supplier === filterSupplier);

    if (sortConfig) {
      rows = [...rows].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return rows;
  }, [autoCalcResult, searchText, filterType, filterSupplier, sortConfig]);

  const pagedAutoRows = filteredAutoRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredAutoRows.length / PAGE_SIZE);

  // --- Filter options (auto) ---
  const autoFilterOptions = useMemo(() => {
    if (!autoCalcResult) return { types: [], suppliers: [] };
    return {
      types: [...new Set(autoCalcResult.rows.map(r => r.materialType))].sort(),
      suppliers: [...new Set(autoCalcResult.rows.map(r => r.supplier).filter(Boolean))].sort(),
    };
  }, [autoCalcResult]);

  // --- Analysis data (auto) ---
  const autoAnalysis = useMemo(() => {
    if (!autoCalcResult) return null;
    const rows = autoCalcResult.rows.filter(r => r.standardCost > 0);

    const supplierMap = new Map<string, { standard: number; actual: number }>();
    rows.forEach(r => {
      const s = r.supplier || '기타';
      const ex = supplierMap.get(s);
      if (ex) { ex.standard += r.standardCost; ex.actual += r.actualCost; }
      else supplierMap.set(s, { standard: r.standardCost, actual: r.actualCost });
    });
    const bySupplier = [...supplierMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.standard - a.standard)
      .slice(0, 15);

    return { bySupplier };
  }, [autoCalcResult]);

  const handleSort = (key: string) => {
    setSortConfig(prev => prev?.key === key ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) : { key, direction: 'asc' });
  };

  const handleAutoDownload = () => {
    if (!filteredAutoRows.length) return;
    const headers = ['자재품번', '자재명', '협력업체', '재료유형', '표준소요량', '평균단가', '표준재료비', '실투입수량', '실적재료비', '차이', '차이율(%)'];
    const rows = filteredAutoRows.map(r => [
      r.childPn, r.childName, r.supplier, r.materialType,
      r.standardReq, r.avgUnitPrice, r.standardCost,
      r.actualQty, r.actualCost, r.diff, r.diffRate.toFixed(1),
    ]);
    downloadCSV('표준재료비_자동산출', headers, rows);
  };

  // --- Comparison tab: filter / sort / paging / download ---
  const [compFilterSupplyType, setCompFilterSupplyType] = useState('All');

  const filteredComparisonRows = useMemo(() => {
    if (!comparisonData) return [];
    let rows = comparisonData.rows;
    if (searchText) {
      const q = searchText.toLowerCase();
      rows = rows.filter(r => r.itemCode.toLowerCase().includes(q) || r.itemName.toLowerCase().includes(q));
    }
    if (compFilterSupplyType !== 'All') rows = rows.filter(r => r.supplyType === compFilterSupplyType);
    if (sortConfig) {
      rows = [...rows].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return rows;
  }, [comparisonData, searchText, compFilterSupplyType, sortConfig]);

  const pagedCompRows = filteredComparisonRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const compTotalPages = Math.ceil(filteredComparisonRows.length / PAGE_SIZE);

  const handleComparisonDownload = () => {
    if (!filteredComparisonRows.length) return;
    const headers = ['품목코드', '품목명', '조달구분', '표준수량', '표준단가', '표준금액', '실적수량', '실적단가', '실적금액', '차이금액', '차이율(%)', '매칭상태'];
    const csvRows = filteredComparisonRows.map(r => [
      r.itemCode, r.itemName, r.supplyType,
      r.stdQty, Math.round(r.stdUnitPrice), Math.round(r.stdAmount),
      r.actQty, Math.round(r.actUnitPrice), Math.round(r.actAmount),
      Math.round(r.diffAmount), r.diffRate.toFixed(1),
      r.matchStatus === 'matched' ? '매칭' : r.matchStatus === 'std-only' ? '표준만' : '실적만',
    ]);
    downloadCSV('표준vs실적_비교', headers, csvRows);
  };

  // 통합BOM Excel 다운로드
  const handleBomDownload = useCallback(() => {
    if (!diagnosticData) return;
    const wb = XLSX.utils.book_new();
    const monthLabel = selectedMonth === 'All' ? '연간' : selectedMonth;

    // --- Sheet 1: 품목마스터 ---
    const masterRows: any[][] = [
      ['고객사P/N', '내부코드', '품목명', '조달구분', '공정유형', '사출재료비', '도장재료비', '구매단가', '합계단가/EA', '매출수량', '표준재료비', '파이프라인', '진단메시지'],
    ];
    // Union merge: diagnosticData.rows 기반 (forecastData + pnMapping 전체)
    for (const r of diagnosticData.rows) {
      masterRows.push([
        r.customerPn,
        r.internalCode,
        r.itemName,
        r.supplyType,
        r.processType,
        r.injectionCost,
        r.paintCost,
        r.purchasePrice,
        r.unitCostPerEa,
        r.forecastQty,
        Math.round(r.stdAmount),
        r.breakLevel === 0 ? 'OK' : 'NG',
        r.breakPoint,
      ]);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(masterRows);
    // 컬럼 너비 설정
    ws1['!cols'] = [
      { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 8 }, { wch: 8 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      { wch: 14 }, { wch: 8 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, '품목마스터');

    // --- Sheet 2: BOM구조 ---
    if (bomData.length > 0) {
      const bomRows: any[][] = [
        ['모품목', '자품목', '자품목명', 'Level', '소요량', '협력업체', '자재유형'],
      ];
      for (const b of bomData) {
        bomRows.push([b.parentPn, b.childPn, b.childName, b.level, b.qty, b.supplier, b.partType]);
      }
      const ws2 = XLSX.utils.aoa_to_sheet(bomRows);
      ws2['!cols'] = [
        { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 6 }, { wch: 10 }, { wch: 15 }, { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'BOM구조');
    }

    // --- Sheet 3: 파이프라인진단 ---
    const diagRows: any[][] = [
      ['고객사P/N', '내부코드', '품목명', '매출수량', 'P/N매핑', '단가유무', '단가/EA', '표준재료비', '진단'],
    ];
    for (const r of diagnosticData.rows) {
      diagRows.push([
        r.customerPn,
        r.internalCode,
        r.itemName,
        r.forecastQty,
        r.hasPnMapping ? 'O' : 'X',
        r.hasUnitCost ? 'O' : 'X',
        r.unitCostPerEa,
        Math.round(r.stdAmount),
        r.breakPoint,
      ]);
    }
    const ws3 = XLSX.utils.aoa_to_sheet(diagRows);
    ws3['!cols'] = [
      { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 10 }, { wch: 8 },
      { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws3, '파이프라인진단');

    // 다운로드
    XLSX.writeFile(wb, `통합BOM_마스터_${selectedYear}-${monthLabel}.xlsx`);
  }, [diagnosticData, bomData, selectedYear, selectedMonth]);

  // Data availability check - BOM만 있어도 자동 산출 가능
  const hasAutoData = bomData.length > 0;
  const hasExcelData = excelData !== null;

  // SortableHeader
  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: string }) => (
    <th className={`px-3 py-2.5 min-w-[80px] ${align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group whitespace-nowrap`}
      onClick={() => handleSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        <span className={`text-[10px] ${sortConfig?.key === sortKey ? 'text-blue-600 font-bold' : 'text-slate-300 group-hover:text-slate-400'}`}>
          {sortConfig?.key === sortKey ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </div>
    </th>
  );

  const calc = autoCalcResult;
  const exSummary = excelData?.summary;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Header + Controls */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">표준재료비 (Standard Material Cost)</h2>
            <p className="text-sm text-slate-500">
              {dataMode === 'excel'
                ? (excelData ? `${excelData.year}년 ${excelData.month} 엑셀 데이터` : '엑셀 업로드 모드')
                : dataMode === 'master'
                ? `BOM 마스터 + MRP 기준 자동 산출 (기준정보 + 재질코드)`
                : (calc?.debug?.calcSource?.startsWith('Excel') || calc?.debug?.calcSource?.startsWith('RefCalc')
                    ? `통합엔진 (${excelData?.items?.length || 0}개 품목, ${calc?.debug?.calcSource}) 기반 산출`
                    : calc?.debug?.calcSource === 'Master'
                    ? `자재마스터 (${pnMapping.filter(m => m.materialCost).length}개 품목) + 매출실적 기반 자동 산출`
                    : `매출계획 + BOM + 입고현황 기반 자동 산출`)
              }
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Year/Month selector */}
            <select value={selectedYear} onChange={e => { setSelectedYear(Number(e.target.value)); setPage(0); }} className="text-xs border rounded-lg px-2 py-1.5">
              {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setPage(0); }} className="text-xs border rounded-lg px-2 py-1.5">
              <option value="All">전체</option>
              {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {/* Data mode toggle */}
            <div className="flex rounded-lg border overflow-hidden">
              <button onClick={() => setDataMode('auto')}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${dataMode === 'auto' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                자동 산출
              </button>
              <button onClick={() => setDataMode('master')}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${dataMode === 'master' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                마스터 기준
              </button>
              <button onClick={() => setDataMode('excel')}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${dataMode === 'excel' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                엑셀 업로드
              </button>
            </div>

            {dataMode !== 'excel' && (
              <>
                {dataMode === 'auto' && (
                  <>
                    <label className={`text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`} title="재료비.xlsx 업로드 (12시트 통합 산출)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      {uploading ? '처리 중...' : '재료비'}
                      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
                    </label>
                    <label className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer text-emerald-600 hover:bg-emerald-50 border border-emerald-200 transition-colors" title="자재마스터 업로드 (조달구분/재료비 포함)">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      자재마스터
                      <input ref={masterInputRef} type="file" accept=".xlsx,.xls" onChange={handleMasterUpload} className="hidden" />
                    </label>
                  </>
                )}
                {dataMode === 'master' && (
                  <span className="text-xs text-blue-600 font-medium px-2">BOM 마스터 + MRP 기준 자동 산출</span>
                )}
                <button onClick={loadAllData} className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" title="데이터 새로고침">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  새로고침
                </button>
                {diagnosticData && diagnosticData.rows.length > 0 && (
                  <button onClick={handleBomDownload} className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors" title="통합BOM 마스터 Excel 다운로드 (품목마스터 + BOM구조 + 진단)">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    통합BOM
                  </button>
                )}
              </>
            )}
            {dataMode === 'excel' && (
              <label className={`text-xs font-bold flex items-center gap-1 px-4 py-2 rounded-lg transition-colors cursor-pointer ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {uploading ? '처리 중...' : '업로드'}
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            )}
          </div>
        </div>

        {/* Data availability info (auto/master mode) */}
        {dataMode !== 'excel' && (
          <div className={`flex flex-wrap items-center gap-4 px-4 py-3 rounded-xl mb-4 text-xs ${hasAutoData ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${forecastData.length > 0 || itemRevenueData.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={forecastData.length > 0 || itemRevenueData.length > 0 ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                {forecastData.length > 0 ? `매출계획 ${forecastData.length.toLocaleString()}건` :
                  itemRevenueData.length > 0 ? `매출실적 ${itemRevenueData.length.toLocaleString()}건` : '매출 데이터 없음'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${bomData.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={bomData.length > 0 ? 'text-emerald-700 font-bold' : 'text-slate-400'}>BOM {bomData.length.toLocaleString()}건</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${pnMapping.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={pnMapping.length > 0 ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                P/N 매핑 {pnMapping.length.toLocaleString()}건
                {(() => {
                  const withCost = pnMapping.filter(m => m.materialCost && m.materialCost > 0).length;
                  return withCost > 0 ? ` (재료비 ${withCost.toLocaleString()})` : '';
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${purchaseData.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={purchaseData.length > 0 ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                입고현황 {purchaseData.filter(p => p.year === selectedYear).length.toLocaleString()}건
                {(() => {
                  const yearData = purchaseData.filter(p => p.year === selectedYear);
                  const parts = yearData.filter(p => p.category === 'Parts').length;
                  const material = yearData.filter(p => p.category === 'Material').length;
                  return material > 0 ? ` (부품 ${parts} + 원재료 ${material})` : '';
                })()}
              </span>
            </div>
            {calc && forecastData.length > 0 && (
              <div className="ml-auto text-slate-500">
                BOM 매칭율 <span className={`font-bold ${calc.matchRate >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>{calc.matchRate.toFixed(1)}%</span>
                ({calc.debug.bomProducts}/{calc.debug.forecastItems} 제품)
              </div>
            )}
            {calc && forecastData.length === 0 && (
              <div className="ml-auto text-amber-600 text-[11px]">
                매출계획 미등록 - BOM 구조만 표시 (제품당 1개 기준)
              </div>
            )}
          </div>
        )}

        {/* View Mode Tabs */}
        {((dataMode !== 'excel' && calc) || (dataMode === 'excel' && excelData)) && (
          <div className="flex gap-1 border-b border-slate-200 -mx-6 px-6">
            {([
              { id: 'summary', label: '종합현황' },
              { id: 'items', label: dataMode !== 'excel' ? '자재별 상세' : '품목별 상세' },
              ...(dataMode !== 'excel' ? [{ id: 'comparison' as ViewMode, label: '표준vs실적' }] : []),
              ...(dataMode !== 'excel' ? [{ id: 'diagnostic' as ViewMode, label: 'BOM진단' }] : []),
              { id: 'analysis', label: '분석' },
            ] as { id: ViewMode; label: string }[]).map(tab => (
              <button key={tab.id} onClick={() => { setViewMode(tab.id); setPage(0); setSortConfig(null); }}
                className={`px-4 py-2.5 text-sm font-bold transition-colors border-b-2 -mb-[1px] ${viewMode === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No Data - BOM이 없을 때만 */}
      {dataMode !== 'excel' && !hasAutoData && (
        <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm text-center">
          <h3 className="text-lg font-bold text-slate-600 mb-3">BOM 데이터가 필요합니다</h3>
          <p className="text-sm text-slate-400 mb-4">구매 &gt; 자재수율에서 BOM을 업로드한 후 <span className="font-bold text-blue-600 cursor-pointer" onClick={loadAllData}>새로고침</span>을 눌러주세요.</p>
          <div className="flex justify-center gap-6 text-xs">
            <div className={`px-4 py-3 rounded-xl border ${bomData.length > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {bomData.length > 0 ? '✓' : '!'} 구매 &gt; 자재수율 &gt; BOM 업로드 (필수)
            </div>
            <div className={`px-4 py-3 rounded-xl border ${forecastData.length > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {forecastData.length > 0 ? '✓' : '-'} 영업 &gt; 매출계획 (수량 기반 산출용)
            </div>
            <div className={`px-4 py-3 rounded-xl border ${purchaseData.length > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {purchaseData.length > 0 ? '✓' : '-'} 구매 &gt; 입고현황 (실적 비교용)
            </div>
          </div>
          <button onClick={loadAllData} className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors">
            데이터 새로고침
          </button>
        </div>
      )}

      {dataMode === 'excel' && !hasExcelData && (
        <div className="bg-white p-16 rounded-3xl border border-slate-200 shadow-sm text-center">
          <div className="text-6xl mb-4 opacity-30">📊</div>
          <h3 className="text-lg font-bold text-slate-600 mb-2">데이터가 없습니다</h3>
          <p className="text-sm text-slate-400">상단에서 표준재료비 엑셀 파일(.xlsx)을 업로드하세요.</p>
        </div>
      )}

      {/* ===== AUTO MODE: SUMMARY ===== */}
      {dataMode !== 'excel' && calc && viewMode === 'summary' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="매출계획 금액" value={`₩${formatWon(calc.forecastRevenue)}`} color="blue"
              subValue={`${selectedMonth === 'All' ? '연간' : selectedMonth} 계획`} />
            <MetricCard label="표준재료비" value={`₩${formatWon(calc.totalStandard)}`} color="slate"
              subValue={`비율 ${formatPercent(calc.standardRatio)}`} />
            <MetricCard label="실적재료비" value={`₩${formatWon(calc.totalActual)}`} color="emerald"
              subValue={`비율 ${formatPercent(calc.actualRatio)}`}
              percentage={calc.totalStandard > 0 ? ((calc.totalActual - calc.totalStandard) / calc.totalStandard) * 100 : 0}
              trend={calc.totalActual <= calc.totalStandard ? 'up' : 'down'} />
            <MetricCard label="표준-실적 차이" value={`₩${formatWon(calc.totalStandard - calc.totalActual)}`}
              color={calc.totalActual <= calc.totalStandard ? 'emerald' : 'rose'}
              subValue={calc.totalActual <= calc.totalStandard ? '실적 <= 표준 (양호)' : '실적 > 표준 (주의)'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 재료유형별 표준 vs 실적 */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">재료유형별 표준 vs 실적</h3>
              <ResponsiveContainer minWidth={0} width="100%" height={280}>
                <BarChart data={calc.byType} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 600 }} />
                  <YAxis tickFormatter={v => formatWon(v as number)} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => `₩${Math.round(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="standard" name="표준" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name="실적" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 재료유형별 구성 파이 */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">표준재료비 구성</h3>
              <ResponsiveContainer minWidth={0} width="100%" height={280}>
                <PieChart>
                  <Pie data={calc.byType} cx="50%" cy="50%" outerRadius={100} innerRadius={55} paddingAngle={3} dataKey="standard"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}>
                    {calc.byType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `₩${Math.round(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ===== 월별 추이 (Combo Chart + Tables) ===== */}
          {monthlySummary.length > 0 && monthlySummary.some(r => r.revenue > 0 || r.actualCost > 0) && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <span className="w-1 h-5 bg-indigo-600 rounded-full" />
                월별 재료비 추이 ({selectedYear}년)
              </h3>

              {/* Combo Chart: Bar(금액) + Line(비율) */}
              <ResponsiveContainer minWidth={0} width="100%" height={320}>
                <ComposedChart data={monthlySummary} margin={{ top: 10, right: 60, bottom: 10, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fontWeight: 600 }} />
                  <YAxis yAxisId="left" tickFormatter={v => formatWon(v as number)} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${((v as number) * 100).toFixed(0)}%`} tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                  <Tooltip
                    formatter={(v: number, name: string) => {
                      if (name === '표준비율' || name === '실적비율') return [`${(v * 100).toFixed(1)}%`, name];
                      return [`₩${Math.round(v).toLocaleString()}`, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="revenue" name="매출액" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar yAxisId="left" dataKey="standardCost" name="표준재료비" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar yAxisId="left" dataKey="actualCost" name="실적재료비" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                  <Line yAxisId="right" type="monotone" dataKey="standardRatio" name="표준비율" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="actualRatio" name="실적비율" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                </ComposedChart>
              </ResponsiveContainer>

              {/* 금액 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-300">
                      <th className="px-2 py-2 text-left text-slate-600 font-bold w-24"></th>
                      {monthlySummary.map(r => (
                        <th key={r.month} className="px-2 py-2 text-center text-slate-600 font-bold min-w-[80px]">{r.month}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-slate-700">매출액</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className="px-2 py-2 text-right font-mono text-slate-600">{r.revenue > 0 ? formatWon(r.revenue) : '-'}</td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-indigo-700">표준재료비</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className="px-2 py-2 text-right font-mono text-indigo-600">{r.standardCost > 0 ? formatWon(r.standardCost) : '-'}</td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-emerald-700">실적재료비</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className="px-2 py-2 text-right font-mono text-emerald-600">{r.actualCost > 0 ? formatWon(r.actualCost) : '-'}</td>
                      ))}
                    </tr>
                    <tr className="border-b-2 border-slate-300 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-slate-700">차이금액</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className={`px-2 py-2 text-right font-mono font-bold ${r.diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {r.standardCost > 0 || r.actualCost > 0 ? formatWon(r.diff) : '-'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 비율 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-slate-300">
                      <th className="px-2 py-2 text-left text-slate-600 font-bold w-24"></th>
                      {monthlySummary.map(r => (
                        <th key={r.month} className="px-2 py-2 text-center text-slate-600 font-bold min-w-[80px]">{r.month}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-indigo-700">표준재료비율</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className="px-2 py-2 text-right font-mono text-indigo-600">{r.revenue > 0 ? `${(r.standardRatio * 100).toFixed(1)}%` : '-'}</td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-emerald-700">실적재료비율</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className="px-2 py-2 text-right font-mono text-emerald-600">{r.revenue > 0 ? `${(r.actualRatio * 100).toFixed(1)}%` : '-'}</td>
                      ))}
                    </tr>
                    <tr className="border-b-2 border-slate-300 hover:bg-slate-50">
                      <td className="px-2 py-2 font-bold text-slate-700">달성율</td>
                      {monthlySummary.map(r => (
                        <td key={r.month} className={`px-2 py-2 text-right font-mono font-bold ${
                          r.achievementRate === 0 ? 'text-slate-400' :
                          r.achievementRate <= 100 ? 'text-emerald-600' : 'text-rose-600'
                        }`}>
                          {r.achievementRate > 0 ? `${r.achievementRate.toFixed(1)}%` : '-'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 산출 기반 정보 */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 mb-3">산출 기반 정보</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
              <div className="px-4 py-3 bg-slate-50 rounded-xl">
                <p className="text-slate-500">매출계획 제품수</p>
                <p className="text-lg font-black text-slate-800">{calc.debug.forecastItems}개</p>
              </div>
              <div className="px-4 py-3 bg-slate-50 rounded-xl">
                <p className="text-slate-500">BOM 매칭 제품</p>
                <p className="text-lg font-black text-emerald-600">{calc.debug.bomProducts}개</p>
              </div>
              <div className="px-4 py-3 bg-slate-50 rounded-xl">
                <p className="text-slate-500">BOM 미등록</p>
                <p className="text-lg font-black text-amber-600">{calc.debug.bomMissing}개</p>
              </div>
              <div className="px-4 py-3 bg-slate-50 rounded-xl">
                <p className="text-slate-500">전개 자재수</p>
                <p className="text-lg font-black text-slate-800">{calc.debug.materials}개</p>
              </div>
              <div className="px-4 py-3 bg-slate-50 rounded-xl">
                <p className="text-slate-500">입고 매칭 자재</p>
                <p className="text-lg font-black text-blue-600">{calc.debug.purchaseMatched}개</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== AUTO MODE: ITEMS ===== */}
      {dataMode !== 'excel' && calc && viewMode === 'items' && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input type="text" placeholder="자재품번 / 자재명 / 협력업체 검색..." value={searchText}
              onChange={e => { setSearchText(e.target.value); setPage(0); }}
              className="text-xs border rounded-lg px-3 py-2 w-64 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0); }} className="text-xs border rounded-lg px-2 py-2">
              <option value="All">전체 유형</option>
              {autoFilterOptions.types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterSupplier} onChange={e => { setFilterSupplier(e.target.value); setPage(0); }} className="text-xs border rounded-lg px-2 py-2">
              <option value="All">전체 협력사</option>
              {autoFilterOptions.suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-slate-500">{filteredAutoRows.length.toLocaleString()}건</span>
              <button onClick={handleAutoDownload} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                엑셀 다운로드
              </button>
            </div>
          </div>

          <div className="flex gap-6 px-4 py-3 bg-slate-50 rounded-xl mb-4 text-xs">
            <div><span className="text-slate-500">표준재료비:</span> <span className="font-bold text-indigo-700">₩{Math.round(filteredAutoRows.reduce((s, r) => s + r.standardCost, 0)).toLocaleString()}</span></div>
            <div><span className="text-slate-500">실적재료비:</span> <span className="font-bold text-emerald-700">₩{Math.round(filteredAutoRows.reduce((s, r) => s + r.actualCost, 0)).toLocaleString()}</span></div>
            <div><span className="text-slate-500">차이:</span> <span className="font-bold text-slate-800">₩{Math.round(filteredAutoRows.reduce((s, r) => s + r.diff, 0)).toLocaleString()}</span></div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <SortableHeader label="자재품번" sortKey="childPn" />
                  <SortableHeader label="자재명" sortKey="childName" />
                  <SortableHeader label="협력업체" sortKey="supplier" />
                  <SortableHeader label="유형" sortKey="materialType" />
                  <SortableHeader label="표준소요량" sortKey="standardReq" align="right" />
                  <SortableHeader label="평균단가" sortKey="avgUnitPrice" align="right" />
                  <SortableHeader label="표준재료비" sortKey="standardCost" align="right" />
                  <SortableHeader label="실투입량" sortKey="actualQty" align="right" />
                  <SortableHeader label="실적재료비" sortKey="actualCost" align="right" />
                  <SortableHeader label="차이" sortKey="diff" align="right" />
                  <SortableHeader label="차이율" sortKey="diffRate" align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedAutoRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{row.childPn}</td>
                    <td className="px-3 py-2.5 text-slate-800 max-w-[180px] truncate" title={row.childName}>{row.childName}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.supplier}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        row.materialType === 'RESIN' ? 'bg-amber-50 text-amber-700' :
                        row.materialType === 'PAINT' ? 'bg-pink-50 text-pink-700' :
                        row.materialType === '외주' ? 'bg-purple-50 text-purple-700' :
                        'bg-blue-50 text-blue-700'
                      }`}>{row.materialType}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.standardReq > 0 ? row.standardReq.toLocaleString() : '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.avgUnitPrice > 0 ? `₩${row.avgUnitPrice.toFixed(1)}` : '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-indigo-700">{row.standardCost > 0 ? `₩${Math.round(row.standardCost).toLocaleString()}` : '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.actualQty > 0 ? row.actualQty.toLocaleString() : '-'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{row.actualCost > 0 ? `₩${Math.round(row.actualCost).toLocaleString()}` : '-'}</td>
                    <td className={`px-3 py-2.5 text-right font-mono font-bold ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {row.standardCost > 0 || row.actualCost > 0 ? `₩${Math.round(row.diff).toLocaleString()}` : '-'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono ${row.diffRate >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {row.standardCost > 0 ? `${row.diffRate.toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                ))}
                {pagedAutoRows.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">검색 결과가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'<<'}</button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'<'}</button>
              <span className="text-xs text-slate-600 px-3">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'>'}</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'>>'}</button>
            </div>
          )}
        </div>
      )}

      {/* ===== AUTO MODE: COMPARISON (표준 vs 실적) ===== */}
      {dataMode !== 'excel' && calc && viewMode === 'comparison' && comparisonData && (
        <div className="space-y-4">
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">비교 품목수</p>
              <p className="text-xl font-black text-slate-800">{comparisonData.totalRows.toLocaleString()}건</p>
              <p className="text-[11px] text-emerald-600 font-bold">매칭 {comparisonData.totalMatched}건 / 표준만 {comparisonData.rows.filter(r => r.matchStatus === 'std-only').length}건 / 실적만 {comparisonData.rows.filter(r => r.matchStatus === 'act-only').length}건</p>
            </div>
            <div className="bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">총 표준금액</p>
              <p className="text-xl font-black text-indigo-700">₩{formatWon(comparisonData.totalStd)}</p>
            </div>
            <div className="bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">총 실적금액</p>
              <p className="text-xl font-black text-emerald-700">₩{formatWon(comparisonData.totalAct)}</p>
            </div>
            <div className="bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">총 차이 (표준-실적)</p>
              <p className={`text-xl font-black ${comparisonData.totalGap >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                ₩{formatWon(comparisonData.totalGap)}
              </p>
              <p className={`text-[11px] font-bold ${comparisonData.totalGap >= 0 ? 'text-blue-500' : 'text-rose-500'}`}>
                {comparisonData.totalGap >= 0 ? '절감 (표준 > 실적)' : '과다지출 (실적 > 표준)'}
              </p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            {/* 필터 바 */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input type="text" placeholder="품목코드 / 품목명 검색..." value={searchText}
                onChange={e => { setSearchText(e.target.value); setPage(0); }}
                className="text-xs border rounded-lg px-3 py-2 w-64 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <select value={compFilterSupplyType} onChange={e => { setCompFilterSupplyType(e.target.value); setPage(0); }} className="text-xs border rounded-lg px-2 py-2">
                <option value="All">전체 조달구분</option>
                {comparisonData.supplyTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-slate-500">{filteredComparisonRows.length.toLocaleString()}건</span>
                <button onClick={handleComparisonDownload} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  CSV 다운로드
                </button>
              </div>
            </div>

            {/* 테이블 */}
            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <SortableHeader label="품목코드" sortKey="itemCode" />
                    <SortableHeader label="품목명" sortKey="itemName" />
                    <SortableHeader label="조달구분" sortKey="supplyType" />
                    <SortableHeader label="표준수량" sortKey="stdQty" align="right" />
                    <SortableHeader label="표준단가" sortKey="stdUnitPrice" align="right" />
                    <SortableHeader label="표준금액" sortKey="stdAmount" align="right" />
                    <SortableHeader label="실적수량" sortKey="actQty" align="right" />
                    <SortableHeader label="실적단가" sortKey="actUnitPrice" align="right" />
                    <SortableHeader label="실적금액" sortKey="actAmount" align="right" />
                    <SortableHeader label="차이금액" sortKey="diffAmount" align="right" />
                    <SortableHeader label="차이율" sortKey="diffRate" align="right" />
                    <th className="px-3 py-2.5 text-center whitespace-nowrap">매칭</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedCompRows.map((row, idx) => (
                    <tr key={`${row.itemCode}-${idx}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">{row.itemCode}</td>
                      <td className="px-3 py-2.5 text-slate-800 max-w-[180px] truncate" title={row.itemName}>{row.itemName}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          row.supplyType === '자작' ? 'bg-amber-50 text-amber-700' :
                          row.supplyType === '구매' ? 'bg-blue-50 text-blue-700' :
                          row.supplyType === '외주' ? 'bg-purple-50 text-purple-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>{row.supplyType || '미분류'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.stdQty > 0 ? row.stdQty.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.stdUnitPrice > 0 ? `₩${Math.round(row.stdUnitPrice).toLocaleString()}` : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-indigo-700">{row.stdAmount > 0 ? `₩${Math.round(row.stdAmount).toLocaleString()}` : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.actQty > 0 ? row.actQty.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600">{row.actUnitPrice > 0 ? `₩${Math.round(row.actUnitPrice).toLocaleString()}` : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">{row.actAmount > 0 ? `₩${Math.round(row.actAmount).toLocaleString()}` : '-'}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-bold ${row.diffAmount > 0 ? 'text-blue-600' : row.diffAmount < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {row.stdAmount > 0 || row.actAmount > 0 ? `₩${Math.round(row.diffAmount).toLocaleString()}` : '-'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${row.diffRate > 0 ? 'text-blue-600' : row.diffRate < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {row.stdAmount > 0 || row.actAmount > 0 ? `${row.diffRate.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          row.matchStatus === 'matched' ? 'bg-emerald-50 text-emerald-700' :
                          row.matchStatus === 'std-only' ? 'bg-orange-50 text-orange-700' :
                          'bg-violet-50 text-violet-700'
                        }`}>
                          {row.matchStatus === 'matched' ? '매칭' : row.matchStatus === 'std-only' ? '표준만' : '실적만'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pagedCompRows.length === 0 && (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">검색 결과가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {compTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'<<'}</button>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'<'}</button>
                <span className="text-xs text-slate-600 px-3">{page + 1} / {compTotalPages}</span>
                <button onClick={() => setPage(p => Math.min(compTotalPages - 1, p + 1))} disabled={page >= compTotalPages - 1} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'>'}</button>
                <button onClick={() => setPage(compTotalPages - 1)} disabled={page >= compTotalPages - 1} className="px-2 py-1 text-xs rounded border disabled:opacity-30">{'>>'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== AUTO MODE: BOM DIAGNOSTIC ===== */}
      {dataMode !== 'excel' && viewMode === 'diagnostic' && diagnosticData && (
        <div className="space-y-4">
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-xs text-slate-500 mb-1">총 품목</div>
              <div className="text-xl font-black text-slate-800">{diagnosticData.totalProducts.toLocaleString()}</div>
              <div className="text-xs text-emerald-600 font-bold mt-1">정상 {diagnosticData.okCount}개 ({diagnosticData.coverageRate.toFixed(1)}%)</div>
            </div>
            <div className={`bg-white p-4 rounded-2xl border shadow-sm ${diagnosticData.forecastMissCount > 0 ? 'border-yellow-300' : 'border-slate-200'}`}>
              <div className="text-xs text-slate-500 mb-1">매출계획 누락</div>
              <div className={`text-xl font-black ${diagnosticData.forecastMissCount > 0 ? 'text-yellow-600' : 'text-slate-300'}`}>{diagnosticData.forecastMissCount}</div>
              <div className="text-xs text-slate-400 mt-1">P/N 매핑은 있으나 매출 없음</div>
            </div>
            <div className={`bg-white p-4 rounded-2xl border shadow-sm ${diagnosticData.pnMissCount > 0 ? 'border-orange-300' : 'border-slate-200'}`}>
              <div className="text-xs text-slate-500 mb-1">P/N 미매핑</div>
              <div className={`text-xl font-black ${diagnosticData.pnMissCount > 0 ? 'text-orange-600' : 'text-slate-300'}`}>{diagnosticData.pnMissCount}</div>
              <div className="text-xs text-slate-400 mt-1">고객사P/N → 내부코드 연결 필요</div>
            </div>
            <div className={`bg-white p-4 rounded-2xl border shadow-sm ${diagnosticData.costMissCount > 0 ? 'border-rose-300' : 'border-slate-200'}`}>
              <div className="text-xs text-slate-500 mb-1">단가 없음</div>
              <div className={`text-xl font-black ${diagnosticData.costMissCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{diagnosticData.costMissCount}</div>
              <div className="text-xs text-slate-400 mt-1">재료비.xlsx 단가 미등록</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-xs text-slate-500 mb-1">정상 표준재료비</div>
              <div className="text-lg font-black text-blue-700">{(diagnosticData.totalStdAmount / 1e8).toFixed(2)}억</div>
              <div className="text-xs text-slate-400 mt-1">{Math.round(diagnosticData.totalStdAmount).toLocaleString()}원</div>
            </div>
          </div>

          {/* 필터 바 */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <input type="text" placeholder="P/N 또는 품목명 검색..." value={searchText} onChange={e => { setSearchText(e.target.value); setPage(0); }}
                className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <select value={diagFilterStatus} onChange={e => { setDiagFilterStatus(e.target.value); setPage(0); }}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="All">전체 진단상태</option>
                <option value="정상">정상</option>
                <option value="매출계획없음">매출계획 없음</option>
                <option value="P/N미매핑">P/N 미매핑</option>
                <option value="단가없음">단가 없음</option>
              </select>
              <button onClick={handleBomDownload} className="text-xs font-bold flex items-center gap-1 px-3 py-2 rounded-lg text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                통합BOM 다운로드
              </button>
              <span className="text-xs text-slate-400">{filteredDiagRows.length.toLocaleString()}건</span>
            </div>
          </div>

          {/* 진단 테이블 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-slate-500 text-xs font-bold">
                    <SortableHeader label="고객사P/N" sortKey="customerPn" />
                    <SortableHeader label="내부코드" sortKey="internalCode" />
                    <SortableHeader label="품목명" sortKey="itemName" />
                    <SortableHeader label="조달구분" sortKey="supplyType" />
                    <SortableHeader label="매출수량" sortKey="forecastQty" align="right" />
                    <SortableHeader label="사출재료비" sortKey="injectionCost" align="right" />
                    <SortableHeader label="도장재료비" sortKey="paintCost" align="right" />
                    <SortableHeader label="구매단가" sortKey="purchasePrice" align="right" />
                    <SortableHeader label="합계단가" sortKey="unitCostPerEa" align="right" />
                    <SortableHeader label="표준재료비" sortKey="stdAmount" align="right" />
                    <th className="px-3 py-2.5 text-center min-w-[80px]">진단</th>
                    <th className="px-3 py-2.5 text-center min-w-[90px]">BOM확인</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedDiagRows.map((r, i) => (
                    <tr key={`${r.customerPn}-${i}`}
                      className={`hover:bg-slate-50 transition-colors ${
                        r.breakLevel === 3 ? 'bg-rose-50/50' :
                        r.breakLevel === 2 ? 'bg-orange-50/50' :
                        r.breakLevel === 1 ? 'bg-yellow-50/50' : ''
                      }`}>
                      <td className="px-3 py-2 font-mono text-xs">
                        <button onClick={() => setBomPopupPn({ customerPn: r.customerPn, internalCode: r.internalCode, itemName: r.itemName })}
                          className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-mono">
                          {r.customerPn}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.internalCode}</td>
                      <td className="px-3 py-2 text-xs max-w-[180px] truncate" title={r.itemName}>{r.itemName}</td>
                      <td className="px-3 py-2 text-xs">{r.supplyType}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{r.forecastQty > 0 ? r.forecastQty.toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{r.injectionCost > 0 ? Math.round(r.injectionCost).toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{r.paintCost > 0 ? Math.round(r.paintCost).toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono">{r.purchasePrice > 0 ? Math.round(r.purchasePrice).toLocaleString() : <span className="text-slate-300">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-right font-bold font-mono">{r.unitCostPerEa > 0 ? Math.round(r.unitCostPerEa).toLocaleString() : <span className="text-slate-300">0</span>}</td>
                      <td className="px-3 py-2 text-xs text-right font-bold font-mono">{r.stdAmount > 0 ? Math.round(r.stdAmount).toLocaleString() : <span className="text-slate-300">0</span>}</td>
                      <td className="px-3 py-2 text-center">
                        {r.breakLevel === 0 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">OK</span>}
                        {r.breakLevel === 1 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700">매출계획</span>}
                        {r.breakLevel === 2 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">P/N</span>}
                        {r.breakLevel === 3 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">단가</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {confirmedBomPns[r.customerPn] ? (
                          <button onClick={() => handleBomConfirm(r.customerPn)} className="inline-flex flex-col items-center gap-0.5 group" title={`확인일: ${confirmedBomPns[r.customerPn]} (클릭하여 해제)`}>
                            <span className="text-emerald-600 text-sm">&#10003;</span>
                            <span className="text-[9px] text-slate-400 group-hover:text-rose-400">{confirmedBomPns[r.customerPn]}</span>
                          </button>
                        ) : (
                          <button onClick={() => handleBomConfirm(r.customerPn)} className="w-4 h-4 border border-slate-300 rounded hover:border-blue-400 hover:bg-blue-50 transition-colors mx-auto block" title="BOM 확인 완료 체크" />
                        )}
                      </td>
                    </tr>
                  ))}
                  {pagedDiagRows.length === 0 && (
                    <tr><td colSpan={12} className="px-6 py-12 text-center text-slate-400 text-sm">진단 데이터가 없습니다. 매출계획과 재료비.xlsx를 업로드해주세요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 페이지네이션 */}
            {diagTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
                <span className="text-xs text-slate-500">{filteredDiagRows.length.toLocaleString()}건 중 {page * PAGE_SIZE + 1}~{Math.min((page + 1) * PAGE_SIZE, filteredDiagRows.length)}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-xs rounded hover:bg-slate-200 disabled:opacity-30">&#171;</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 text-xs rounded hover:bg-slate-200 disabled:opacity-30">&#8249;</button>
                  <span className="px-3 py-1 text-xs font-bold">{page + 1} / {diagTotalPages}</span>
                  <button onClick={() => setPage(p => Math.min(diagTotalPages - 1, p + 1))} disabled={page >= diagTotalPages - 1} className="px-2 py-1 text-xs rounded hover:bg-slate-200 disabled:opacity-30">&#8250;</button>
                  <button onClick={() => setPage(diagTotalPages - 1)} disabled={page >= diagTotalPages - 1} className="px-2 py-1 text-xs rounded hover:bg-slate-200 disabled:opacity-30">&#187;</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== AUTO MODE: ANALYSIS ===== */}
      {dataMode !== 'excel' && calc && viewMode === 'analysis' && autoAnalysis && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">재료유형별 비율 현황</h3>
              <div className="space-y-4">
                {calc.byType.map((item, i) => {
                  const stdPct = calc.totalStandard > 0 ? (item.standard / calc.totalStandard) * 100 : 0;
                  const actPct = calc.totalActual > 0 ? (item.actual / calc.totalActual) * 100 : 0;
                  return (
                    <div key={item.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-bold text-slate-600">{item.name}</span>
                        <div className="flex gap-3">
                          <span className="text-indigo-500">표준 {stdPct.toFixed(1)}% (₩{formatWon(item.standard)})</span>
                          <span className="text-emerald-500">실적 {actPct.toFixed(1)}% (₩{formatWon(item.actual)})</span>
                        </div>
                      </div>
                      <div className="flex gap-1 h-3">
                        <div className="rounded-full" style={{ width: `${stdPct}%`, backgroundColor: COLORS[i], opacity: 0.4 }} />
                        <div className="rounded-full" style={{ width: `${actPct}%`, backgroundColor: COLORS[i] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">협력업체별 표준재료비 Top 15</h3>
              <ResponsiveContainer minWidth={0} width="100%" height={350}>
                <BarChart data={autoAnalysis.bySupplier} layout="vertical" margin={{ left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={v => formatWon(v as number)} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                  <Tooltip formatter={(v: number) => `₩${Math.round(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="standard" name="표준" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="actual" name="실적" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ===== EXCEL MODE: SUMMARY ===== */}
      {dataMode === 'excel' && excelData && exSummary && viewMode === 'summary' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="ABC 매출액" value={`₩${formatWon(exSummary.abcSales)}`} color="blue" />
            <MetricCard label="표준재료비" value={`₩${formatWon(exSummary.standardTotal)}`} color="slate"
              subValue={`비율 ${formatPercent(exSummary.standardRatio)}`} />
            <MetricCard label="실적재료비" value={`₩${formatWon(exSummary.actualTotal)}`} color="emerald"
              subValue={`비율 ${formatPercent(exSummary.actualRatio)}`}
              percentage={exSummary.standardTotal > 0 ? ((exSummary.actualTotal - exSummary.standardTotal) / exSummary.standardTotal) * 100 : 0}
              trend={exSummary.actualTotal <= exSummary.standardTotal ? 'up' : 'down'} />
            <MetricCard label="표준-실적 차이" value={`₩${formatWon(exSummary.standardTotal - exSummary.actualTotal)}`}
              color={exSummary.actualTotal <= exSummary.standardTotal ? 'emerald' : 'rose'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">재료비율 현황 (목표 대비)</h3>
              <div className="space-y-5">
                {[
                  { label: '전체 재료비율', standard: exSummary.standardRatio, actual: exSummary.actualRatio, target: exSummary.targetTotalRatio, color: '#6366f1' },
                  { label: 'RESIN', standard: exSummary.resinRatio, actual: exSummary.actualResinRatio, target: null, color: '#f59e0b' },
                  { label: 'PAINT', standard: exSummary.paintRatio, actual: exSummary.actualPaintRatio, target: null, color: '#ec4899' },
                  { label: '구매', standard: exSummary.purchaseRatio, actual: exSummary.actualPurchaseRatio, target: exSummary.targetPurchaseRatio, color: '#10b981' },
                  { label: '외주', standard: exSummary.outsourceRatio, actual: exSummary.actualOutsourceRatio, target: null, color: '#8b5cf6' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-bold text-slate-600">{item.label}</span>
                      <div className="flex gap-3">
                        <span className="text-slate-400">표준 {formatPercent(item.standard)}</span>
                        <span className="font-bold" style={{ color: item.color }}>실적 {formatPercent(item.actual)}</span>
                        {item.target !== null && <span className="text-rose-400">목표 {formatPercent(item.target)}</span>}
                      </div>
                    </div>
                    <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="absolute h-full rounded-full opacity-30" style={{ width: `${Math.min(item.standard * 100 * 2, 100)}%`, backgroundColor: item.color }} />
                      <div className="absolute h-full rounded-full" style={{ width: `${Math.min(item.actual * 100 * 2, 100)}%`, backgroundColor: item.color }} />
                      {item.target !== null && <div className="absolute h-full w-0.5 bg-rose-500" style={{ left: `${Math.min(item.target * 100 * 2, 100)}%` }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4">재료유형별 표준 vs 실적</h3>
              <ResponsiveContainer minWidth={0} width="100%" height={280}>
                <BarChart data={[
                  { name: 'RESIN', 표준: exSummary.standardResin, 실적: exSummary.actualResin },
                  { name: 'PAINT', 표준: exSummary.standardPaint, 실적: exSummary.actualPaint },
                  { name: '구매', 표준: exSummary.standardPurchase, 실적: exSummary.actualPurchase },
                  { name: '외주', 표준: exSummary.standardOutsource, 실적: exSummary.actualOutsource },
                ]} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 600 }} />
                  <YAxis tickFormatter={v => formatWon(v as number)} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => `₩${Math.round(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="표준" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="실적" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Excel mode items/analysis views omitted for brevity - use the excelData same as before */}
      {dataMode === 'excel' && excelData && viewMode === 'items' && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-center py-12">
          <p className="text-sm text-slate-500">품목별 상세는 엑셀 데이터에서 {excelData.items.length.toLocaleString()}개 품목이 로드되었습니다.</p>
          <p className="text-xs text-slate-400 mt-1">자동 산출 모드로 전환하면 BOM 기반 자재별 상세를 확인할 수 있습니다.</p>
        </div>
      )}
      {dataMode === 'excel' && excelData && viewMode === 'analysis' && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-center py-12">
          <p className="text-sm text-slate-500">분석 뷰는 자동 산출 모드에서 더 상세한 정보를 제공합니다.</p>
        </div>
      )}

      {/* ===== BOM 팝업 모달 (트리 구조 + 편집) ===== */}
      {bomPopupPn && (() => {
        const bomParentKey = bomPopupData?.bomKey || bomPopupPn.internalCode || bomPopupPn.customerPn;

        // 재귀 트리 렌더 함수
        const renderTreeNode = (node: BomTreeNode, depth: number, parentKey: string): React.ReactNode => {
          const isEditing = bomEditingId === node.id;
          const hasChildren = node.children.length > 0;

          return (
            <div key={node.id}>
              <div className={`flex items-center gap-1 py-1.5 px-2 rounded-lg hover:bg-slate-50 group transition-colors ${isEditing ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
                style={{ paddingLeft: `${depth * 24 + 8}px` }}>
                {/* 트리 가이드 */}
                <span className="text-slate-300 text-xs w-4 flex-shrink-0 select-none">{hasChildren ? '\u25BC' : '\u25CF'}</span>

                {isEditing ? (
                  /* 수정 모드 */
                  <div className="flex-1 flex items-center gap-1.5">
                    <input value={bomEditForm.childPn} onChange={e => setBomEditForm(f => ({ ...f, childPn: e.target.value }))}
                      className="w-[120px] px-1.5 py-0.5 text-xs font-mono border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="자재코드" />
                    <input value={bomEditForm.childName} onChange={e => setBomEditForm(f => ({ ...f, childName: e.target.value }))}
                      className="flex-1 min-w-[100px] px-1.5 py-0.5 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="자재명" />
                    <input value={bomEditForm.qty} onChange={e => setBomEditForm(f => ({ ...f, qty: e.target.value }))}
                      className="w-[60px] px-1.5 py-0.5 text-xs font-mono border border-blue-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="수량" />
                    <input value={bomEditForm.unitPrice} onChange={e => setBomEditForm(f => ({ ...f, unitPrice: e.target.value }))}
                      className="w-[80px] px-1.5 py-0.5 text-xs font-mono border border-emerald-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="단가(원)" />
                    <input value={bomEditForm.supplier} onChange={e => setBomEditForm(f => ({ ...f, supplier: e.target.value }))}
                      className="w-[80px] px-1.5 py-0.5 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="협력업체" />
                    <button onClick={() => handleBomEdit(node.childPn, parentKey)}
                      className="px-2 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                    <button onClick={() => setBomEditingId(null)}
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-200 text-slate-600 rounded hover:bg-slate-300">취소</button>
                  </div>
                ) : (
                  /* 표시 모드 */
                  <>
                    <span className="font-mono text-xs text-blue-700 font-bold min-w-[120px]">{node.childPn}</span>
                    <span className="text-xs text-slate-700 flex-1 truncate">{node.childName || <span className="text-slate-300 italic">품명 없음</span>}</span>
                    <span className="text-xs text-slate-500 font-mono min-w-[50px] text-right">x{node.qty}</span>
                    {node.unitPrice > 0 && (
                      <span className="text-[10px] font-mono text-emerald-600 min-w-[70px] text-right" title="단가 (원/EA)">
                        ₩{node.unitPrice.toLocaleString()}
                      </span>
                    )}
                    {node.supplier && <span className="text-[10px] text-slate-400 min-w-[60px]">{node.supplier}</span>}
                    {node.partType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{node.partType}</span>}
                    {/* 편집 버튼 (hover시 표시) */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1 transition-opacity">
                      <button onClick={() => { setBomEditingId(node.id); setBomEditForm({ childPn: node.childPn, childName: node.childName, qty: String(node.qty), supplier: node.supplier, partType: node.partType, unitPrice: node.unitPrice > 0 ? String(node.unitPrice) : '' }); }}
                        className="p-0.5 rounded hover:bg-blue-100 text-slate-400 hover:text-blue-600" title="수정">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => handleBomDelete(node.childPn, parentKey)}
                        className="p-0.5 rounded hover:bg-rose-100 text-slate-400 hover:text-rose-600" title="삭제">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
              {/* 재귀: 하위 자재 */}
              {hasChildren && node.children.map(child => renderTreeNode(child, depth + 1, node.childPn))}
            </div>
          );
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setBomPopupPn(null); setBomEditingId(null); setBomAddingParent(null); setShowDrawingViewer(false); setDrawingAnalysis(null); }}>
            <div className={`bg-white rounded-2xl shadow-2xl max-h-[85vh] flex flex-col transition-all ${showDrawingViewer ? 'w-[95vw] max-w-[1400px]' : 'w-[90vw] max-w-[850px]'}`} onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 py-4 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-slate-800">BOM 트리</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="font-mono font-bold text-blue-600">{bomPopupPn.customerPn}</span>
                      {bomPopupPn.internalCode !== '-' && <span className="ml-2 text-slate-400">({bomPopupPn.internalCode})</span>}
                      <span className="ml-2">{bomPopupPn.itemName}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* PDF 도면 업로드 */}
                    {drawingMap[bomPopupPn.customerPn] ? (
                      <>
                      <button onClick={() => { setShowDrawingViewer(true); if (!drawingAnalysis) runDrawingAnalysis(drawingMap[bomPopupPn.customerPn]); }}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        도면 보기
                      </button>
                      <button onClick={() => runDrawingAnalysis(drawingMap[bomPopupPn.customerPn])}
                        disabled={drawingAnalyzing}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 ${drawingAnalyzing ? 'bg-amber-50 text-amber-400 cursor-wait' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                        {drawingAnalyzing ? '분석중...' : '도면 분석'}
                      </button>
                      </>
                    ) : (
                      <label className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-500 hover:bg-violet-100 hover:text-violet-600 transition-colors cursor-pointer flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        도면 업로드
                        <input type="file" accept=".pdf" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file || !bomPopupPn) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const dataUrl = ev.target?.result as string;
                            if (dataUrl) {
                              setDrawingMap(prev => {
                                const next = { ...prev, [bomPopupPn.customerPn]: dataUrl };
                                try { localStorage.setItem('dashboard_bomDrawings', JSON.stringify(next)); } catch {
                                  try { sessionStorage.setItem('dashboard_bomDrawings', JSON.stringify(next)); } catch { /* */ }
                                }
                                return next;
                              });
                              setShowDrawingViewer(true);
                              runDrawingAnalysis(dataUrl);
                            }
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }} />
                      </label>
                    )}
                    {confirmedBomPns[bomPopupPn.customerPn] ? (
                      <button onClick={() => handleBomConfirm(bomPopupPn.customerPn)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors flex items-center gap-1">
                        &#10003; 확인완료 ({confirmedBomPns[bomPopupPn.customerPn]})
                      </button>
                    ) : (
                      <button onClick={() => handleBomConfirm(bomPopupPn.customerPn)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                        BOM 확인 완료
                      </button>
                    )}
                    <button onClick={() => { setBomPopupPn(null); setBomEditingId(null); setBomAddingParent(null); setShowDrawingViewer(false); setDrawingAnalysis(null); }} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
                {/* 판매가 / 재료비합계 / 재료비율 */}
                {bomPopupData && (
                  <div className="flex items-center gap-4 mt-3 px-3 py-2 bg-slate-50 rounded-xl">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">판매가</span>
                      <span className="text-sm font-black text-slate-700 font-mono">
                        {bomPopupData.sellingPrice > 0 ? `₩${bomPopupData.sellingPrice.toLocaleString()}` : <span className="text-slate-300">-</span>}
                      </span>
                    </div>
                    <div className="w-px h-5 bg-slate-200" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">재료비합계</span>
                      <span className="text-sm font-black text-emerald-600 font-mono">
                        {bomPopupData.totalMaterialCost > 0 ? `₩${bomPopupData.totalMaterialCost.toLocaleString()}` : <span className="text-slate-300">-</span>}
                      </span>
                    </div>
                    <div className="w-px h-5 bg-slate-200" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">재료비율</span>
                      <span className={`text-sm font-black font-mono ${
                        bomPopupData.materialRatio > 70 ? 'text-red-600' :
                        bomPopupData.materialRatio > 50 ? 'text-amber-600' :
                        bomPopupData.materialRatio > 0 ? 'text-emerald-600' : 'text-slate-300'
                      }`}>
                        {bomPopupData.materialRatio > 0 ? `${bomPopupData.materialRatio}%` : '-'}
                      </span>
                    </div>
                    <div className="w-px h-5 bg-slate-200" />
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-bold">{bomPopupData.totalNodes}개 자재</span>
                  </div>
                )}
              </div>

              {/* 본문: 도면 + 트리 */}
              <div className={`flex-1 overflow-hidden flex ${showDrawingViewer ? 'flex-row' : 'flex-col'}`}>
                {/* PDF 도면 뷰어 (좌측) */}
                {showDrawingViewer && drawingMap[bomPopupPn.customerPn] && (
                  <div className="w-1/2 border-r border-slate-200 flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 bg-violet-50 border-b border-violet-200">
                      <span className="text-xs font-bold text-violet-700">도면</span>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-violet-500 hover:text-violet-700 cursor-pointer px-2 py-0.5 rounded hover:bg-violet-100">
                          교체
                          <input type="file" accept=".pdf" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file || !bomPopupPn) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const dataUrl = ev.target?.result as string;
                              if (dataUrl) {
                                setDrawingMap(prev => {
                                  const next = { ...prev, [bomPopupPn.customerPn]: dataUrl };
                                  try { localStorage.setItem('dashboard_bomDrawings', JSON.stringify(next)); } catch {
                                    try { sessionStorage.setItem('dashboard_bomDrawings', JSON.stringify(next)); } catch { /* */ }
                                  }
                                  return next;
                                });
                                runDrawingAnalysis(dataUrl);
                              }
                            };
                            reader.readAsDataURL(file);
                            e.target.value = '';
                          }} />
                        </label>
                        <button onClick={() => setShowDrawingViewer(false)}
                          className="text-[10px] text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded hover:bg-slate-100">닫기</button>
                      </div>
                    </div>
                    <iframe
                      src={drawingMap[bomPopupPn.customerPn]}
                      className={`w-full ${drawingAnalysis ? 'h-[45%]' : 'flex-1'}`}
                      title="도면 PDF"
                    />
                    {/* 도면 분석 결과 패널 */}
                    {drawingAnalyzing && (
                      <div className="px-3 py-4 text-center border-t border-amber-200 bg-amber-50">
                        <div className="inline-flex items-center gap-2 text-xs text-amber-600 font-bold">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          도면 텍스트 추출 및 BOM 비교 중...
                        </div>
                      </div>
                    )}
                    {drawingAnalysis && !drawingAnalyzing && (
                      <div className="h-[55%] overflow-auto border-t border-slate-200 bg-white">
                        {/* 분석 요약 헤더 */}
                        <div className={`px-3 py-2 flex items-center gap-3 ${drawingAnalysis.summary.matchRate >= 80 ? 'bg-emerald-50' : drawingAnalysis.summary.matchRate >= 50 ? 'bg-amber-50' : 'bg-red-50'}`}>
                          <span className={`text-sm font-black ${drawingAnalysis.summary.matchRate >= 80 ? 'text-emerald-700' : drawingAnalysis.summary.matchRate >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                            매칭률 {drawingAnalysis.summary.matchRate}%
                          </span>
                          <div className="flex items-center gap-2 text-[10px] flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-bold">도면 {drawingAnalysis.summary.drawingItemCount}건</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">BOM(1차) {drawingAnalysis.summary.bomItemCount}건</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-bold">일치 {drawingAnalysis.summary.matchedCount}</span>
                            {drawingAnalysis.summary.qtyMismatchCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 font-bold">수량불일치 {drawingAnalysis.summary.qtyMismatchCount}</span>
                            )}
                            {(() => {
                              const cl = (drawingAnalysis as any).classifiedExtra as any[] | undefined;
                              if (!cl) return null;
                              const unknowns = cl.filter((c: any) => c.reason === 'unknown').length;
                              return unknowns > 0 ? <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-bold">확인필요 {unknowns}</span> : null;
                            })()}
                          </div>
                        </div>

                        <div className="px-3 py-2 space-y-2 text-xs">
                          {/* 수량 불일치 항목 */}
                          {drawingAnalysis.matched.filter(m => !m.qtyMatch).length > 0 && (
                            <div>
                              <div className="flex items-center gap-1 mb-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                <span className="font-bold text-amber-700">수량 불일치 ({drawingAnalysis.matched.filter(m => !m.qtyMatch).length}건)</span>
                              </div>
                              {drawingAnalysis.matched.filter(m => !m.qtyMatch).map((m, i) => (
                                <div key={`qty-${i}`} className="flex items-center gap-2 px-2 py-1 bg-amber-50 rounded mb-0.5">
                                  {m.drawingItem.itemNo > 0 && <span className="text-[9px] text-slate-400 min-w-[16px]">#{m.drawingItem.itemNo}</span>}
                                  <span className="font-mono text-[10px] text-slate-600 truncate max-w-[120px]">{m.bomChildPn}</span>
                                  <span className="text-amber-600">도면:{m.drawingItem.qty} / BOM:{m.bomQty}</span>
                                  <button onClick={() => {
                                    // BOM 수량을 도면 기준으로 수정
                                    setBomData(prev => {
                                      const next = prev.map(r => {
                                        if (normalizePn(r.childPn) === normalizePn(m.bomChildPn)) {
                                          return { ...r, qty: m.drawingItem.qty };
                                        }
                                        return r;
                                      });
                                      try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
                                      return next;
                                    });
                                  }} className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-amber-600 text-white rounded hover:bg-amber-700">
                                    도면기준 수정
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 도면에 있지만 BOM에 없는 항목 */}
                          {drawingAnalysis.missingInBom.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1 mb-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                <span className="font-bold text-red-700">BOM 누락 ({drawingAnalysis.missingInBom.length}건) - 도면에만 있음</span>
                              </div>
                              {drawingAnalysis.missingInBom.map((item, i) => (
                                <div key={`miss-${i}`} className="flex items-center gap-2 px-2 py-1 bg-red-50 rounded mb-0.5">
                                  {item.itemNo > 0 && <span className="text-[9px] text-slate-400 min-w-[16px]">#{item.itemNo}</span>}
                                  <span className="font-mono text-[10px] text-slate-600 truncate max-w-[120px]">{item.partNo}</span>
                                  {item.partName && <span className="text-slate-500 truncate max-w-[100px]">{item.partName}</span>}
                                  <span className="text-red-500">x{item.qty}</span>
                                  <button onClick={() => {
                                    if (!bomPopupData?.bomKey) return;
                                    // BOM에 추가 (품명 + 수량 도면에서 가져옴)
                                    const newRecord: BomRecord = {
                                      parentPn: bomPopupData.bomKey,
                                      childPn: item.partNo,
                                      childName: item.partName || '',
                                      level: 1,
                                      qty: item.qty,
                                      supplier: '',
                                      partType: '',
                                    };
                                    setBomData(prev => {
                                      const next = [...prev, newRecord];
                                      try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
                                      return next;
                                    });
                                    // pnMapping에도 품명 등록 (트리에서 품명 표시용)
                                    if (item.partName) {
                                      setPnMapping(prev => {
                                        const code = normalizePn(item.partNo);
                                        const exists = prev.find(m => normalizePn(m.internalCode) === code || normalizePn(m.customerPn) === code);
                                        if (exists) {
                                          return prev.map(m => {
                                            if (normalizePn(m.internalCode) === code || normalizePn(m.customerPn) === code) {
                                              return { ...m, partName: m.partName || item.partName };
                                            }
                                            return m;
                                          });
                                        }
                                        return [...prev, { customerPn: item.partNo, internalCode: item.partNo, partName: item.partName, rawMaterialCode1: '', rawMaterialCode2: '', supplyType: '', processType: '', purchaseUnitPrice: 0, materialCost: 0, injectionCost: 0, paintCost: 0 }];
                                      });
                                    }
                                  }} className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-red-600 text-white rounded hover:bg-red-700">
                                    BOM 추가
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* BOM에 있지만 도면에 없는 항목 - 자동 분류 */}
                          {(() => {
                            const classified = (drawingAnalysis as any).classifiedExtra as { childPn: string; childName: string; qty: number; reason: 'sub' | 'raw' | 'unknown'; parentPn: string }[] | undefined;
                            if (!classified || classified.length === 0) return null;
                            const subs = classified.filter(c => c.reason === 'sub');
                            const raws = classified.filter(c => c.reason === 'raw');
                            const unknowns = classified.filter(c => c.reason === 'unknown');
                            return (
                              <div>
                                <div className="flex items-center gap-1 mb-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  <span className="font-bold text-blue-700">도면 미확인 ({classified.length}건) - BOM에만 있음</span>
                                </div>

                                {/* 하위자재: 도면 Part List에 안 나오는게 정상 */}
                                {subs.length > 0 && (
                                  <details className="mb-1" open={subs.length <= 5}>
                                    <summary className="cursor-pointer text-[10px] font-bold text-slate-500 px-2 py-0.5 bg-slate-50 rounded flex items-center gap-1">
                                      <span className="px-1 py-px rounded bg-slate-200 text-slate-500 text-[9px]">정상</span>
                                      하위자재 ({subs.length}건) - 도면 Part List에 미표기 (상위 부품의 구성자재)
                                    </summary>
                                    <div className="mt-0.5 space-y-0.5">
                                      {subs.map((item, i) => (
                                        <div key={`sub-${i}`} className="flex items-center gap-2 px-2 py-0.5 bg-slate-50 rounded text-[10px]">
                                          <span className="font-mono text-slate-500">{item.childPn}</span>
                                          {item.childName && <span className="text-slate-400 truncate max-w-[100px]">{item.childName}</span>}
                                          <span className="text-slate-400">x{item.qty}</span>
                                          <span className="ml-auto text-[9px] text-slate-300">← {item.parentPn}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}

                                {/* 원재료: 사출/도장 등 공정재료 */}
                                {raws.length > 0 && (
                                  <details className="mb-1" open={raws.length <= 5}>
                                    <summary className="cursor-pointer text-[10px] font-bold text-slate-500 px-2 py-0.5 bg-violet-50 rounded flex items-center gap-1">
                                      <span className="px-1 py-px rounded bg-violet-200 text-violet-600 text-[9px]">정상</span>
                                      원재료 ({raws.length}건) - 사출/도장 공정재료 (도면 Part List 비대상)
                                    </summary>
                                    <div className="mt-0.5 space-y-0.5">
                                      {raws.map((item, i) => (
                                        <div key={`raw-${i}`} className="flex items-center gap-2 px-2 py-0.5 bg-violet-50 rounded text-[10px]">
                                          <span className="font-mono text-violet-500">{item.childPn}</span>
                                          {item.childName && <span className="text-violet-400 truncate max-w-[100px]">{item.childName}</span>}
                                          <span className="text-violet-400">x{item.qty}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}

                                {/* 미분류: 실제 확인 필요한 항목 */}
                                {unknowns.length > 0 && (
                                  <div className="mb-1">
                                    <div className="text-[10px] font-bold text-amber-700 px-2 py-0.5 bg-amber-50 rounded flex items-center gap-1 mb-0.5">
                                      <span className="px-1 py-px rounded bg-amber-200 text-amber-700 text-[9px]">확인</span>
                                      도면에 없는 품번 ({unknowns.length}건) - 도면과 BOM 불일치 가능
                                    </div>
                                    {unknowns.map((item, i) => (
                                      <div key={`unk-${i}`} className="flex items-center gap-2 px-2 py-1 bg-amber-50 rounded mb-0.5">
                                        <span className="font-mono text-[10px] text-slate-600">{item.childPn}</span>
                                        {item.childName && <span className="text-slate-500 truncate max-w-[100px]">{item.childName}</span>}
                                        <span className="text-amber-600">x{item.qty}</span>
                                        <button onClick={() => {
                                          // BOM에서 삭제
                                          if (!bomPopupData?.bomKey) return;
                                          setBomData(prev => {
                                            const next = prev.filter(r =>
                                              !(normalizePn(r.parentPn) === normalizePn(bomPopupData.bomKey) && normalizePn(r.childPn) === normalizePn(item.childPn))
                                            );
                                            try { localStorage.setItem('dashboard_bomData', JSON.stringify(next)); } catch { /* */ }
                                            return next;
                                          });
                                        }} className="ml-auto px-1.5 py-0.5 text-[10px] font-bold bg-amber-600 text-white rounded hover:bg-amber-700">
                                          BOM 삭제
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* 일치 항목 (접이식) */}
                          {drawingAnalysis.matched.length > 0 && (
                            <details className="mt-1">
                              <summary className="flex items-center gap-1 cursor-pointer text-emerald-700 font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                일치 ({drawingAnalysis.matched.filter(m => m.qtyMatch).length}건)
                              </summary>
                              <div className="mt-1 space-y-0.5">
                                {drawingAnalysis.matched.filter(m => m.qtyMatch).map((m, i) => (
                                  <div key={`match-${i}`} className="flex items-center gap-2 px-2 py-0.5 bg-emerald-50 rounded">
                                    {m.drawingItem.itemNo > 0 && <span className="text-[9px] text-slate-400 min-w-[16px]">#{m.drawingItem.itemNo}</span>}
                                    <span className="font-mono text-[10px] text-slate-600 truncate max-w-[120px]">{m.bomChildPn}</span>
                                    <span className="text-slate-500 truncate max-w-[100px]">{m.bomChildName}</span>
                                    <span className="text-emerald-500">x{m.bomQty}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}

                          {/* 추출된 텍스트 (디버그) */}
                          {drawingAnalysis.rawText && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[10px] text-slate-400">추출 텍스트 보기 (디버그)</summary>
                              <pre className="mt-1 p-2 bg-slate-50 rounded text-[9px] text-slate-500 max-h-[100px] overflow-auto whitespace-pre-wrap">{drawingAnalysis.rawText.substring(0, 2000)}</pre>
                            </details>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* BOM 트리 (우측 또는 전체) */}
                <div className={`${showDrawingViewer ? 'w-1/2' : 'w-full'} overflow-auto px-4 py-3`}>
                {bomPopupData && bomPopupData.tree.length > 0 ? (
                  <div>
                    {/* 루트 노드 (모품목) */}
                    <div className="flex items-center gap-2 px-2 py-2 bg-slate-50 rounded-lg mb-1">
                      <span className="text-slate-400 text-xs">&#9660;</span>
                      <span className="font-mono text-xs font-black text-slate-800">{bomPopupData.bomKey}</span>
                      <span className="text-xs text-slate-500">(모품목)</span>
                    </div>

                    {/* 트리 렌더 */}
                    {bomPopupData.tree.map(node => renderTreeNode(node, 1, bomParentKey))}

                    {/* 자재 추가 폼 */}
                    {bomAddingParent === bomParentKey ? (
                      <div className="flex items-center gap-1.5 mt-2 px-2 py-2 bg-emerald-50 rounded-lg border border-emerald-200" style={{ paddingLeft: '32px' }}>
                        <span className="text-emerald-400 text-xs">+</span>
                        <input value={bomAddForm.childPn} onChange={e => setBomAddForm(f => ({ ...f, childPn: e.target.value }))}
                          className="w-[120px] px-1.5 py-1 text-xs font-mono border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="자재코드 *" autoFocus />
                        <input value={bomAddForm.childName} onChange={e => setBomAddForm(f => ({ ...f, childName: e.target.value }))}
                          className="flex-1 min-w-[100px] px-1.5 py-1 text-xs border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="자재명" />
                        <input value={bomAddForm.qty} onChange={e => setBomAddForm(f => ({ ...f, qty: e.target.value }))}
                          className="w-[50px] px-1.5 py-1 text-xs font-mono border border-emerald-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="수량" />
                        <input value={bomAddForm.supplier} onChange={e => setBomAddForm(f => ({ ...f, supplier: e.target.value }))}
                          className="w-[80px] px-1.5 py-1 text-xs border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="협력업체" />
                        <input value={bomAddForm.partType} onChange={e => setBomAddForm(f => ({ ...f, partType: e.target.value }))}
                          className="w-[60px] px-1.5 py-1 text-xs border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="유형" />
                        <button onClick={() => handleBomAdd(bomParentKey)}
                          className="px-2.5 py-1 text-[10px] font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700">추가</button>
                        <button onClick={() => setBomAddingParent(null)}
                          className="px-2 py-1 text-[10px] font-bold bg-slate-200 text-slate-600 rounded hover:bg-slate-300">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => { setBomAddingParent(bomParentKey); setBomAddForm({ childPn: '', childName: '', qty: '1', supplier: '', partType: '' }); }}
                        className="flex items-center gap-1 mt-2 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" style={{ marginLeft: '24px' }}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        하위 자재 추가
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <p className="text-sm text-slate-500 font-bold mb-2">BOM 구조가 없습니다</p>
                    <p className="text-xs text-slate-400 mb-4">
                      {bomPopupData?.bomKey
                        ? `BOM 키 "${bomPopupData.bomKey}"에 하위 자재가 없습니다.`
                        : `고객사P/N "${bomPopupPn.customerPn}" / 내부코드 "${bomPopupPn.internalCode}"에 매칭되는 BOM이 없습니다.`}
                    </p>
                    {/* BOM이 없어도 직접 추가 가능 */}
                    {bomAddingParent === bomParentKey ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                        <input value={bomAddForm.childPn} onChange={e => setBomAddForm(f => ({ ...f, childPn: e.target.value }))}
                          className="w-[120px] px-1.5 py-1 text-xs font-mono border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="자재코드 *" autoFocus />
                        <input value={bomAddForm.childName} onChange={e => setBomAddForm(f => ({ ...f, childName: e.target.value }))}
                          className="w-[120px] px-1.5 py-1 text-xs border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="자재명" />
                        <input value={bomAddForm.qty} onChange={e => setBomAddForm(f => ({ ...f, qty: e.target.value }))}
                          className="w-[50px] px-1.5 py-1 text-xs font-mono border border-emerald-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-emerald-400" placeholder="수량" />
                        <button onClick={() => handleBomAdd(bomParentKey)}
                          className="px-2.5 py-1 text-[10px] font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700">추가</button>
                        <button onClick={() => setBomAddingParent(null)}
                          className="px-2 py-1 text-[10px] font-bold bg-slate-200 text-slate-600 rounded hover:bg-slate-300">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => { setBomAddingParent(bomParentKey); setBomAddForm({ childPn: '', childName: '', qty: '1', supplier: '', partType: '' }); }}
                        className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">
                        + 첫 하위 자재 추가
                      </button>
                    )}
                  </div>
                )}
              </div>
              </div>

              {/* 푸터 */}
              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  BOM 키: <span className="font-mono">{bomPopupData?.bomKey || bomParentKey}</span>
                  {bomPopupData && bomPopupData.totalNodes > 0 && ` | ${bomPopupData.totalNodes}개 자재`}
                  <span className="ml-2 text-slate-300">| 편집 시 자동저장</span>
                </span>
                <button onClick={() => { setBomPopupPn(null); setBomEditingId(null); setBomAddingParent(null); setShowDrawingViewer(false); setDrawingAnalysis(null); }} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 transition-colors">닫기</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default StandardMaterialCostView;
