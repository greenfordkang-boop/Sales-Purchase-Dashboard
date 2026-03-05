
import React, { useState, useEffect, useMemo, useRef } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { BomRecord, normalizePn, buildBomRelations, expandBomToLeaves } from '../utils/bomDataParser';
import { ForecastItem } from '../utils/salesForecastParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord, BomMasterRecord } from '../utils/bomMasterParser';
import { calculateMRP, MRPResult, MRPMaterialRow } from '../utils/mrpCalculator';
import { calcProductBasedMaterialCost } from '../utils/calcProductBasedCost';
import { downloadCSV } from '../utils/csvExport';
import { safeSetItem } from '../utils/safeStorage';
import { bomMasterService, productCodeService, referenceInfoService, materialCodeService, forecastService, purchaseSummaryService, paintMixRatioService, itemStandardCostService, purchasePriceService, outsourceInjPriceService, itemRevenueService } from '../services/supabaseService';
import fallbackMaterialCodes from '../data/materialCodes.json';
import fallbackPurchasePrices from '../data/purchasePrices.json';
import fallbackStandardCosts from '../data/standardMaterialCost.json';
import paintConsumptionData from '../data/paintConsumptionByProduct.json';
import type { PurchasePrice, OutsourcePrice } from '../utils/standardMaterialParser';
import type { ItemRevenueRow } from '../utils/revenueDataParser';

// ============================================================
// Constants
// ============================================================

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const TYPE_COLORS: Record<string, string> = {
  RESIN: '#3b82f6',
  PAINT: '#10b981',
  '구매': '#f59e0b',
  '외주': '#8b5cf6',
  '제품': '#6366f1',
};

interface TreeRow {
  key: string;
  pn: string;
  name: string;
  type: string;
  unitQty: number;
  totalQty: number;
  supplier: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  unitPrice: number;
  unit: string;
  childCount: number;
}

// ============================================================
// 산출근거 팝업 (총소요량 / 총원가 호버)
// ============================================================

const formatCompact = (v: number): string => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}백만`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return Math.round(v).toLocaleString();
};

/** 총소요량 셀 + 호버 팝업 */
const MrpQtyCell: React.FC<{ m: MRPMaterialRow }> = ({ m }) => {
  const [show, setShow] = useState(false);
  const activeMonths = m.monthlyQty
    .map((q, i) => ({ month: `${i + 1}월`, qty: q }))
    .filter(x => x.qty > 0);
  const topMonths = [...activeMonths].sort((a, b) => b.qty - a.qty);
  const maxMonthQty = topMonths.length > 0 ? topMonths[0].qty : 0;

  return (
    <td
      className="px-3 py-1.5 text-right text-gray-600 relative cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="border-b border-dashed border-gray-400">
        {m.requiredQty.toLocaleString()}
      </span>
      {m.unit && <span className="text-[10px] text-gray-400 ml-0.5">{m.unit}</span>}
      {show && (
        <div
          className="absolute z-[100] right-0 top-full mt-1 bg-slate-800 text-white rounded-xl shadow-xl px-4 py-3 min-w-[320px] text-left pointer-events-none"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[10px] font-bold text-slate-300 mb-2">산출근거 (총소요량)</div>

          {/* 관련 제품 */}
          <div className="text-[11px] mb-2">
            <span className="text-slate-400">관련 제품:</span>
            <span className="text-indigo-300 font-bold ml-1">{m.parentProducts.length}개</span>
            <div className="flex flex-wrap gap-1 mt-1 max-h-[40px] overflow-hidden">
              {m.parentProducts.slice(0, 5).map((pn, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-slate-700 rounded text-[9px] font-mono text-slate-300">{pn}</span>
              ))}
              {m.parentProducts.length > 5 && (
                <span className="text-[9px] text-slate-500">...외 {m.parentProducts.length - 5}개</span>
              )}
            </div>
          </div>

          {/* 월별 분포 (활성 월만) */}
          <div className="text-[10px] text-slate-400 mb-1">월별 소요량:</div>
          <div className="space-y-0.5 max-h-[140px] overflow-y-auto">
            {topMonths.slice(0, 12).map(({ month, qty }) => (
              <div key={month} className="flex items-center gap-2 text-[11px]">
                <span className="w-8 text-slate-400">{month}</span>
                <div className="flex-1 h-3 bg-slate-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded"
                    style={{ width: `${maxMonthQty > 0 ? (qty / maxMonthQty) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-20 text-right font-mono text-white">{Math.round(qty).toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* 합계 */}
          <div className="border-t border-slate-600 mt-2 pt-2 flex items-center justify-between text-xs">
            <span className="text-slate-400">Σ(제품 계획수량 × BOM 누적소요량)</span>
            <span className="text-amber-300 font-black">{m.requiredQty.toLocaleString()} {m.unit}</span>
          </div>
        </div>
      )}
    </td>
  );
};

/** 총원가 셀 + 호버 팝업 */
const MrpCostCell: React.FC<{ m: MRPMaterialRow }> = ({ m }) => {
  const [show, setShow] = useState(false);

  return (
    <td
      className="px-3 py-1.5 text-right text-gray-700 font-medium relative cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className={m.totalCost > 0 ? 'border-b border-dashed border-gray-400' : ''}>
        {m.totalCost > 0 ? `₩${Math.round(m.totalCost).toLocaleString()}` : '-'}
      </span>
      {show && m.totalCost > 0 && (
        <div
          className="absolute z-[100] right-0 top-full mt-1 bg-slate-800 text-white rounded-xl shadow-xl px-4 py-3 min-w-[260px] text-left pointer-events-none"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[10px] font-bold text-slate-300 mb-2">산출근거 (총원가)</div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">총소요량</span>
              <span className="text-white font-mono">{m.requiredQty.toLocaleString()} {m.unit}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-amber-400 font-bold">×</span>
              <span className="text-slate-400">단가</span>
              <span className="text-white font-mono ml-auto">₩{Math.round(m.unitPrice).toLocaleString()}/{m.unit}</span>
            </div>
          </div>
          <div className="border-t border-slate-600 mt-2 pt-2 flex items-center justify-between text-xs">
            <span className="text-slate-400">= {m.requiredQty.toLocaleString()} × ₩{Math.round(m.unitPrice).toLocaleString()}</span>
            <span className="text-amber-300 font-black">₩{formatCompact(m.totalCost)}</span>
          </div>
          {m.totalCost > 1e8 && (
            <div className="mt-1 text-[10px] text-rose-400">
              ⚠ 1억원 초과 — 소요량/단가 검증 필요
            </div>
          )}
        </div>
      )}
      {!show && m.totalCost <= 0 && m.unitPrice <= 0 && null}
    </td>
  );
};

// ============================================================
// Component
// ============================================================

const MRPView: React.FC = () => {
  const [mrpResult, setMrpResult] = useState<MRPResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [dataSource, setDataSource] = useState<'forecast' | 'revenue'>('forecast');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterText, setFilterText] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<MRPMaterialRow | null>(null);
  const [tableOpen, setTableOpen] = useState(true);
  const [manualPriceCount, setManualPriceCount] = useState(() => {
    try {
      const stored = localStorage.getItem('dashboard_manualPrices');
      return stored ? (JSON.parse(stored) as any[]).length : 0;
    } catch { return 0; }
  });
  const priceFileRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('flat');
  const [monthlyMode, setMonthlyMode] = useState<'qty' | 'cost'>('qty');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const bomRelationsRef = useRef<Map<string, BomRecord[]>>(new Map());
  const bomRootsRef = useRef<string[]>([]);
  const bomNameMapRef = useRef<Map<string, string>>(new Map());

  // --- 데이터 로드 + MRP 계산 ---
  useEffect(() => {
    calculateMRPData();

    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.type === 'bomMaster' || detail?.type === 'forecast') {
        calculateMRPData();
      }
    };
    window.addEventListener('dashboard-data-updated', handleUpdate);
    return () => window.removeEventListener('dashboard-data-updated', handleUpdate);
  }, [dataSource]);

  const calculateMRPData = async () => {
    setIsCalculating(true);
    try {
      // 서비스를 통해 데이터 로드 (Supabase → localStorage 폴백)
      const [forecastData, masterRecords, productCodes, refInfo, materialCodes, purchaseData, paintMixRatios, itemStandardCosts] = await Promise.all([
        forecastService.getItems('current'),
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
        materialCodeService.getAll(),
        purchaseSummaryService.getAll(),
        paintMixRatioService.getAll(),
        itemStandardCostService.getAll(),
      ]);

      // BomMasterRecord → BomRecord 변환
      const bomRecords: BomRecord[] = masterRecords.map(r => ({
        parentPn: r.parentPn,
        childPn: r.childPn,
        level: r.level,
        qty: r.qty,
        childName: r.childName,
        supplier: r.supplier,
        partType: r.partType,
      }));

      // BOM 트리 뷰용 데이터 구축
      const bomDedupKey = new Set<string>();
      const dedupedForTree: BomRecord[] = [];
      for (const r of bomRecords) {
        const k = `${normalizePn(r.parentPn)}|${normalizePn(r.childPn)}`;
        if (!bomDedupKey.has(k)) { bomDedupKey.add(k); dedupedForTree.push(r); }
      }
      const bomRel = buildBomRelations(dedupedForTree);
      bomRelationsRef.current = bomRel;

      const nMap = new Map<string, string>();
      for (const r of bomRecords) {
        const cn = normalizePn(r.childPn);
        if (r.childName && !nMap.has(cn)) nMap.set(cn, r.childName);
      }
      for (const pc of productCodes) {
        const n = normalizePn(pc.productCode);
        if (pc.productName && !nMap.has(n)) nMap.set(n, pc.productName);
        if (pc.customerPn) { const cn2 = normalizePn(pc.customerPn); if (pc.productName && !nMap.has(cn2)) nMap.set(cn2, pc.productName); }
      }
      for (const ri of refInfo) {
        const n = normalizePn(ri.itemCode);
        if (ri.itemName && !nMap.has(n)) nMap.set(n, ri.itemName);
      }
      bomNameMapRef.current = nMap;

      const allChildNorms = new Set(bomRecords.map(r => normalizePn(r.childPn)));
      const seenR = new Set<string>();
      const rootArr: string[] = [];
      for (const r of bomRecords) {
        const pn = normalizePn(r.parentPn);
        if (!allChildNorms.has(pn) && !seenR.has(pn)) { rootArr.push(r.parentPn); seenR.add(pn); }
      }
      bomRootsRef.current = rootArr;

      if (forecastData.length === 0 || bomRecords.length === 0) {
        console.warn(`MRP 데이터 부족: forecast=${forecastData.length}, bom=${bomRecords.length}`);
        setMrpResult(null);
        return;
      }

      // 재질코드 데이터 보강: 서비스 데이터 + 내장 재질단가 병합
      const pricedFromService = materialCodes.filter(m => m.currentPrice > 0).length;
      let mergedMaterialCodes = materialCodes;
      if (pricedFromService === 0 && fallbackMaterialCodes.length > 0) {
        // 서비스에 단가가 없으면 내장 재질단가를 사용
        const existingCodes = new Set(materialCodes.map(m => m.materialCode.trim().toUpperCase()));
        const merged = [...materialCodes];
        for (const fb of fallbackMaterialCodes) {
          const key = fb.materialCode.trim().toUpperCase();
          if (!existingCodes.has(key)) {
            merged.push(fb as MaterialCodeRecord);
            existingCodes.add(key);
          } else if (fb.currentPrice > 0) {
            // 기존 항목에 단가만 업데이트
            const idx = merged.findIndex(m => m.materialCode.trim().toUpperCase() === key);
            if (idx >= 0 && merged[idx].currentPrice <= 0) {
              merged[idx] = { ...merged[idx], currentPrice: fb.currentPrice };
            }
          }
        }
        mergedMaterialCodes = merged;
      }

      // 구매단가 보강: 내장 구매단가를 purchaseData에 병합
      const existingPartNos = new Set(purchaseData.map(p => p.partNo.trim().toUpperCase().replace(/[\s\-_\.]+/g, '')));
      const mergedPurchaseData = [...purchaseData];
      for (const fp of fallbackPurchasePrices) {
        const key = fp.partNo.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
        if (!existingPartNos.has(key)) {
          mergedPurchaseData.push({
            partNo: fp.partNo, partName: fp.partName, unit: fp.unit, unitPrice: fp.unitPrice,
            year: 2026, month: '1월', supplier: '', spec: '', salesQty: 0, closingQty: 0,
            amount: 0, location: '', costType: '', purchaseType: '구매', materialType: '', process: '', customer: '',
          } as any);
          existingPartNos.add(key);
        }
      }

      // 수동 단가 병합 (최우선 적용 - 기존 항목 덮어쓰기)
      try {
        const manualRaw = localStorage.getItem('dashboard_manualPrices');
        if (manualRaw) {
          const manualPrices: { partNo: string; unitPrice: number; partName?: string }[] = JSON.parse(manualRaw);
          for (const mp of manualPrices) {
            if (!mp.partNo || mp.unitPrice <= 0) continue;
            const key = mp.partNo.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
            // 기존 항목에서 같은 partNo 찾아 단가 덮어쓰기
            const existIdx = mergedPurchaseData.findIndex(
              p => p.partNo.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === key
            );
            if (existIdx >= 0) {
              mergedPurchaseData[existIdx] = { ...mergedPurchaseData[existIdx], unitPrice: mp.unitPrice };
            } else {
              mergedPurchaseData.push({
                partNo: mp.partNo, partName: mp.partName || '', unit: 'EA', unitPrice: mp.unitPrice,
                year: 2026, month: '1월', supplier: '', spec: '', salesQty: 0, closingQty: 0,
                amount: 0, location: '', costType: '', purchaseType: '구매', materialType: '', process: '', customer: '',
              } as any);
            }
          }
        }
      } catch (e) {
        console.warn('수동 단가 로드 실패:', e);
      }

      // ===== 제품별재료비 기준 통합 엔진 (3탭 일치) =====
      // 추가 데이터 로드
      const [dbPurchasePrices, dbOutsourcePrices, revenueData] = await Promise.all([
        purchasePriceService.getAll(),
        outsourceInjPriceService.getAll(),
        itemRevenueService.getAll(),
      ]);
      // 구매단가 보강: mergedPurchaseData → PurchasePrice 형태로 변환 + DB 데이터 병합
      const enrichedPurchasePrices: PurchasePrice[] = [...(dbPurchasePrices as PurchasePrice[])];
      const ppExists = new Set(enrichedPurchasePrices.map(p => normalizePn(p.itemCode)));
      for (const mp of mergedPurchaseData) {
        const key = normalizePn(mp.partNo);
        if (!ppExists.has(key) && mp.unitPrice > 0) {
          enrichedPurchasePrices.push({
            itemCode: mp.partNo,
            customerPn: '',
            itemName: mp.partName || '',
            supplier: mp.supplier || '',
            currentPrice: mp.unitPrice,
            previousPrice: 0,
          });
          ppExists.add(key);
        }
      }

      // ===== 원재료 기준 MRP: BOM leaf → refInfo rawMaterialCode로 전개 =====
      // P/N bridge
      const c2i = new Map<string, string>();
      for (const pc of productCodes) {
        if (pc.customerPn && pc.productCode) c2i.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
      }
      for (const ri of refInfo) {
        if (ri.customerPn && ri.itemCode) {
          const k = normalizePn(ri.customerPn);
          if (!c2i.has(k)) c2i.set(k, normalizePn(ri.itemCode));
        }
      }

      const normBomRel = new Map<string, BomRecord[]>();
      for (const [k, v] of bomRel) normBomRel.set(normalizePn(k), v);

      const findBomKey = (pn: string): string | null => {
        if (normBomRel.has(pn)) return pn;
        const asInt = c2i.get(pn);
        if (asInt && normBomRel.has(asInt)) return asInt;
        return null;
      };

      // refInfo 맵
      const refInfoMap = new Map<string, typeof refInfo[0]>();
      for (const ri of refInfo) {
        refInfoMap.set(normalizePn(ri.itemCode), ri);
        if (ri.customerPn) refInfoMap.set(normalizePn(ri.customerPn), ri);
      }

      // 재질코드 맵 (materialCode → record)
      const matCodeMap = new Map<string, typeof mergedMaterialCodes[0]>();
      for (const mc of mergedMaterialCodes) {
        matCodeMap.set(normalizePn(mc.materialCode), mc);
      }

      // supplier 맵
      const isValidSupp = (s: string) => s && !/^VEND_NAME\b/i.test(s) && !/^Row\s*\d/i.test(s);
      const suppMap = new Map<string, string>();
      const setSupp = (k: string, s: string) => { if (k && isValidSupp(s)) suppMap.set(normalizePn(k), s); };
      for (const pp of enrichedPurchasePrices) { setSupp(pp.itemCode, pp.supplier); setSupp(pp.customerPn, pp.supplier); }
      for (const ri of refInfo) { setSupp(ri.itemCode, ri.supplier); setSupp(ri.customerPn, ri.supplier); }
      for (const p of mergedPurchaseData) { setSupp(p.partNo, p.supplier); }
      // 원재료코드 → 구입처 역매핑: refInfo의 rawMaterialCode가 사용되는 부품의 구입처를 원재료에도 적용
      for (const ri of refInfo) {
        const riSupp = suppMap.get(normalizePn(ri.itemCode)) || ri.supplier;
        if (!riSupp || !isValidSupp(riSupp)) continue;
        const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean) as string[];
        for (const rc of rawCodes) {
          const rk = normalizePn(rc);
          if (!suppMap.has(rk)) suppMap.set(rk, riSupp);
        }
      }

      // 구매단가 맵
      const purchasePriceMap = new Map<string, number>();
      for (const pp of enrichedPurchasePrices) {
        const k = normalizePn(pp.itemCode);
        if (pp.currentPrice > 0) purchasePriceMap.set(k, pp.currentPrice);
      }

      // 원재료 집계 구조
      type RawMatAgg = {
        name: string; unit: string; materialType: string;
        totalReq: number; monthlyQty: number[]; parents: Set<string>;
      };
      const rawAgg = new Map<string, RawMatAgg>();

      const addToRawAgg = (rawCode: string, name: string, unit: string, matType: string, qty: number, monthIdx: number, parentKey: string) => {
        const ex = rawAgg.get(rawCode);
        if (ex) {
          ex.totalReq += qty;
          ex.monthlyQty[monthIdx] += qty;
          ex.parents.add(parentKey);
        } else {
          const mq = new Array(12).fill(0);
          mq[monthIdx] = qty;
          rawAgg.set(rawCode, { name, unit, materialType: matType, totalReq: qty, monthlyQty: mq, parents: new Set([parentKey]) });
        }
      };

      // 12개월 BOM 전개 → 원재료 집계
      for (let m = 0; m < 12; m++) {
        const forecastByPn = new Map<string, number>();
        for (const item of forecastData) {
          if (!item.partNo) continue;
          const raw = normalizePn(item.partNo);
          const qty = (item.monthlyQty?.[m] || 0);
          if (qty <= 0) continue;
          const key = findBomKey(raw) || raw;
          forecastByPn.set(key, (forecastByPn.get(key) || 0) + qty);
        }

        for (const [bomKey, productQty] of forecastByPn) {
          if (!normBomRel.has(bomKey)) continue;
          const leaves = expandBomToLeaves(bomKey, productQty, normBomRel, undefined, 0, 10);
          for (const leaf of leaves) {
            const ck = normalizePn(leaf.childPn);
            const ri = refInfoMap.get(ck);
            const mc = matCodeMap.get(ck);
            const supplyType = ri?.supplyType || '';
            const isOutsourced = /외주/.test(supplyType);
            const isSelfMade = !supplyType || /자작/.test(supplyType);

            // 1) matCodeMap 최우선: RESIN/PAINT 원재료는 어떤 경로든 정확히 분류
            if (mc && /RESIN|수지/i.test(mc.materialType || '')) {
              const unitStr = mc.unit && /kg/i.test(mc.unit) ? 'KG' : (mc.unit || 'EA');
              addToRawAgg(ck, mc.materialName || leaf.childName || ck, unitStr, 'RESIN', leaf.totalRequired, m, bomKey);
            } else if (mc && /PAINT|도료/i.test(mc.materialType || mc.paintCategory || '')) {
              const unitStr = mc.unit && /kg/i.test(mc.unit) ? 'KG' : (mc.unit || 'EA');
              addToRawAgg(ck, mc.materialName || leaf.childName || ck, unitStr, 'PAINT', leaf.totalRequired, m, bomKey);
            }
            // 2) 외주품: 외주/EA
            else if (isOutsourced) {
              addToRawAgg(ck, leaf.childName || ck, 'EA', '외주', leaf.totalRequired, m, bomKey);
            }
            // 3) 자작 사출품: rawMaterialCode → RESIN KG 전개
            else if (isSelfMade && ri && /사출/.test(ri.processType || '')) {
              const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
              const nw = ri.netWeight || 0;
              const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
              const rw = ri.runnerWeight || 0;
              const lossM = 1 + ((ri.lossRate || 0) / 100);
              let resolved = false;
              for (const rawCode of rawCodes) {
                const rawNorm = normalizePn(rawCode);
                const rcMc = matCodeMap.get(rawNorm);
                if (rcMc && /PAINT|도료/i.test(rcMc.materialType || '')) continue;
                if (nw > 0) {
                  const wPerEa = (nw + rw / cavity) * lossM / 1000;
                  const totalKg = leaf.totalRequired * wPerEa;
                  addToRawAgg(rawNorm, rcMc?.materialName || rawCode, 'KG', 'RESIN', totalKg, m, bomKey);
                  resolved = true;
                }
              }
              if (!resolved) {
                addToRawAgg(ck, leaf.childName || ck, 'EA', 'RESIN', leaf.totalRequired, m, bomKey);
              }
            }
            // 4) 자작 도장품: paintQty × rawMaterialCode → PAINT KG 전개
            else if (isSelfMade && ri && /도장/.test(ri.processType || '')) {
              const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4 || ''].filter(Boolean) as string[];
              const paintQtys = [ri.paintQty1, ri.paintQty2, ri.paintQty3, ri.paintQty4 || 0];
              const lossM = 1 + ((ri.lossRate || 0) / 100);
              const lotDiv = (ri.lotQty && ri.lotQty > 0) ? ri.lotQty : 1;
              let resolved = false;
              for (let pi = 0; pi < rawCodes.length; pi++) {
                const pq = paintQtys[pi] || 0;
                if (pq <= 0) continue;
                const rawNorm = normalizePn(rawCodes[pi]);
                const rcMc = matCodeMap.get(rawNorm);
                const kgPerEa = (pq / 1000) * lossM / lotDiv;
                const totalKg = leaf.totalRequired * kgPerEa;
                addToRawAgg(rawNorm, rcMc?.materialName || rawCodes[pi], 'KG', 'PAINT', totalKg, m, bomKey);
                resolved = true;
              }
              if (!resolved) {
                addToRawAgg(ck, leaf.childName || ck, 'EA', 'PAINT', leaf.totalRequired, m, bomKey);
              }
            }
            // 5) 기타 구매품
            else {
              addToRawAgg(ck, leaf.childName || ck, 'EA', '구매', leaf.totalRequired, m, bomKey);
            }
          }
        }
      }

      // MRPMaterialRow 변환
      const materials: MRPMaterialRow[] = [];
      for (const [code, data] of rawAgg) {
        if (data.totalReq <= 0) continue;
        const supplier = suppMap.get(code) || '';
        const mc = matCodeMap.get(code);
        const unitPrice = mc?.currentPrice || purchasePriceMap.get(code) || 0;
        materials.push({
          materialCode: code,
          materialName: data.name,
          materialType: data.materialType,
          unit: data.unit,
          requiredQty: data.totalReq,
          unitPrice,
          totalCost: data.totalReq * unitPrice,
          parentProducts: [...data.parents],
          monthlyQty: data.monthlyQty,
          supplier,
        });
      }
      materials.sort((a, b) => b.totalCost - a.totalCost);

      const matchedProducts = new Set<string>();
      for (const data of rawAgg.values()) data.parents.forEach(p => matchedProducts.add(p));

      const totalCost = materials.reduce((s, m) => s + m.totalCost, 0);
      const byMonth = Array.from({ length: 12 }, (_, i) => ({
        month: `${i + 1}월`,
        totalQty: materials.reduce((s, m) => s + m.monthlyQty[i], 0),
        totalCost: materials.reduce((s, m) => s + m.monthlyQty[i] * m.unitPrice, 0),
      }));

      const result: MRPResult = {
        materials,
        byMonth,
        summary: {
          totalMaterials: materials.length,
          totalRequiredQty: materials.reduce((s, m) => s + m.requiredQty, 0),
          totalCost,
          bomMatchRate: matchedProducts.size > 0 ? 100 : 0,
          unmatchedProducts: [],
          fuzzyMatchedProducts: [],
          matchedProducts: matchedProducts.size,
          directCostProducts: 0,
          noPriceMaterials: materials.filter(m => m.unitPrice <= 0).length,
          priceMatchRate: materials.length > 0 ? (materials.filter(m => m.unitPrice > 0).length / materials.length) * 100 : 0,
        },
      };
      console.log(`[MRP 리프전개] ${matchedProducts.size}제품 → ${materials.length}리프자재, 총 ${(totalCost / 1e8).toFixed(2)}億`);
      setMrpResult(result);
    } catch (err) {
      console.error('MRP 계산 실패:', err);
      setMrpResult(null);
    } finally {
      setIsCalculating(false);
    }
  };

  // --- 파생 데이터 ---
  const typeDistribution = useMemo(() => {
    if (!mrpResult) return [];
    const typeMap = new Map<string, { qty: number; cost: number }>();
    for (const m of mrpResult.materials) {
      const existing = typeMap.get(m.materialType) || { qty: 0, cost: 0 };
      existing.qty += m.requiredQty;
      existing.cost += m.totalCost;
      typeMap.set(m.materialType, existing);
    }
    return Array.from(typeMap.entries()).map(([name, data]) => ({
      name,
      qty: data.qty,
      cost: data.cost,
    }));
  }, [mrpResult]);

  const filteredMaterials = useMemo(() => {
    if (!mrpResult) return [];
    let result = mrpResult.materials;

    if (filterType === '__NO_PRICE__') {
      result = result.filter(m => m.unitPrice <= 0);
    } else if (filterType !== 'All') {
      result = result.filter(m => m.materialType === filterType);
    }
    if (filterText) {
      const f = filterText.toLowerCase();
      result = result.filter(m =>
        m.materialCode.toLowerCase().includes(f) ||
        m.materialName.toLowerCase().includes(f)
      );
    }

    if (sortConfig) {
      result = [...result].sort((a, b) => {
        let aVal: any;
        let bVal: any;
        // 월별 컬럼 정렬 지원
        const monthMatch = sortConfig.key.match(/^month_(\d+)$/);
        if (monthMatch) {
          const mi = parseInt(monthMatch[1], 10);
          if (monthlyMode === 'cost') {
            aVal = a.unitPrice > 0 ? (a.monthlyQty[mi] || 0) * a.unitPrice : 0;
            bVal = b.unitPrice > 0 ? (b.monthlyQty[mi] || 0) * b.unitPrice : 0;
          } else {
            aVal = a.monthlyQty[mi] || 0;
            bVal = b.monthlyQty[mi] || 0;
          }
        } else if (sortConfig.key === 'parentProducts') {
          aVal = a.parentProducts.length;
          bVal = b.parentProducts.length;
        } else {
          aVal = (a as any)[sortConfig.key];
          bVal = (b as any)[sortConfig.key];
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      });
    }

    return result;
  }, [mrpResult, filterType, filterText, sortConfig, monthlyMode]);

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' }
    );
  };

  // --- BOM 트리 뷰 ---
  const visibleTreeRows = useMemo((): TreeRow[] => {
    if (viewMode !== 'tree' || !mrpResult) return [];
    const bomRel = bomRelationsRef.current;
    const nameMap = bomNameMapRef.current;
    let roots = bomRootsRef.current;

    // 루트 필터링 (검색어)
    if (filterText) {
      const f = filterText.toLowerCase();
      roots = roots.filter(root => {
        const norm = normalizePn(root);
        return root.toLowerCase().includes(f) || (nameMap.get(norm) || '').toLowerCase().includes(f);
      });
    }

    // 가격 맵 (MRP 결과에서)
    const priceMap = new Map<string, { unitPrice: number; unit: string }>();
    for (const m of mrpResult.materials) {
      priceMap.set(normalizePn(m.materialCode), { unitPrice: m.unitPrice, unit: m.unit });
    }

    const rows: TreeRow[] = [];
    const MAX_ROWS = 1000;

    function addChildren(parentPn: string, parentTotalQty: number, depth: number, parentKey: string) {
      if (rows.length >= MAX_ROWS) return;
      const children = bomRel.get(normalizePn(parentPn));
      if (!children) return;
      for (let ci = 0; ci < children.length; ci++) {
        if (rows.length >= MAX_ROWS) return;
        const child = children[ci];
        const childNorm = normalizePn(child.childPn);
        const childKey = `${parentKey}/${childNorm}:${ci}`;
        const grandChildren = bomRel.get(childNorm);
        const hasChildren = !!grandChildren && grandChildren.length > 0;
        const isExpanded = expandedNodes.has(childKey);
        const totalQty = parentTotalQty * child.qty;
        const price = priceMap.get(childNorm);
        rows.push({
          key: childKey, pn: child.childPn,
          name: child.childName || nameMap.get(childNorm) || '',
          type: child.partType || '', unitQty: child.qty, totalQty,
          supplier: child.supplier || '', depth, hasChildren, isExpanded,
          unitPrice: price?.unitPrice || 0, unit: price?.unit || '',
          childCount: grandChildren?.length || 0,
        });
        if (isExpanded) addChildren(child.childPn, totalQty, depth + 1, childKey);
      }
    }

    for (const root of roots) {
      if (rows.length >= MAX_ROWS) break;
      const rootNorm = normalizePn(root);
      const children = bomRel.get(rootNorm);
      const hasChildren = !!children && children.length > 0;
      const isExpanded = expandedNodes.has(rootNorm);
      rows.push({
        key: rootNorm, pn: root, name: nameMap.get(rootNorm) || '',
        type: '제품', unitQty: 1, totalQty: 1, supplier: '', depth: 0,
        hasChildren, isExpanded, unitPrice: 0, unit: '',
        childCount: children?.length || 0,
      });
      if (isExpanded) addChildren(root, 1, 1, rootNorm);
    }
    return rows;
  }, [viewMode, mrpResult, expandedNodes, filterText]);

  const toggleTreeNode = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        // 접기: 하위 노드도 모두 접기
        for (const k of prev) { if (k === key || k.startsWith(key + '/')) next.delete(k); }
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDownload = () => {
    if (!filteredMaterials.length) return;
    const headers = ['자재코드', '자재명', '유형', '구입처', '총소요량', '단가', '총원가', '관련제품수', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`)];
    const rows = filteredMaterials.map(m => [
      m.materialCode,
      m.materialName,
      m.materialType,
      m.supplier || '',
      m.requiredQty,
      m.unitPrice,
      m.totalCost,
      m.parentProducts.length,
      ...m.monthlyQty,
    ]);
    downloadCSV(`MRP_소요량_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows.map(r => r.map(String)));
  };

  const handleNoPriceExport = () => {
    if (!mrpResult) return;
    const noPriceItems = mrpResult.materials.filter(m => m.unitPrice <= 0);
    if (noPriceItems.length === 0) return;
    const headers = ['파트넘버', '부품명', '자재유형', '구입처', '단가', '단위', '총소요량', '관련제품'];
    const rows = noPriceItems
      .sort((a, b) => b.requiredQty - a.requiredQty)
      .map(m => [
        m.materialCode,
        m.materialName,
        m.materialType,
        m.supplier || '',
        '',
        m.unit || '',
        String(m.requiredQty),
        m.parentProducts.join('; '),
      ]);
    downloadCSV(`MRP_단가미등록_자재_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handlePriceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buf = ev.target?.result as ArrayBuffer;
        // 인코딩 감지: EUC-KR / UTF-8
        let text: string;
        const bytes = new Uint8Array(buf);
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
          text = new TextDecoder('utf-8').decode(buf);
        } else {
          text = new TextDecoder('utf-8').decode(buf);
          if (text.includes('�')) {
            text = new TextDecoder('euc-kr').decode(buf);
          }
        }

        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { alert('CSV에 데이터가 없습니다.'); return; }

        // 헤더 파싱
        const headerLine = lines[0];
        const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const partNoIdx = headers.findIndex(h => /파트|partno|자재코드|materialcode/i.test(h));
        const priceIdx = headers.findIndex(h => /단가|unitprice|price/i.test(h));
        const nameIdx = headers.findIndex(h => /부품명|자재명|partname|materialname/i.test(h));

        if (partNoIdx < 0 || priceIdx < 0) {
          alert('CSV에 "파트넘버"와 "단가" 컬럼이 필요합니다.');
          return;
        }

        // 기존 수동 단가 로드
        let existing: { partNo: string; unitPrice: number; partName?: string }[] = [];
        try {
          const stored = localStorage.getItem('dashboard_manualPrices');
          if (stored) existing = JSON.parse(stored);
        } catch { /* ignore */ }
        const priceMap = new Map(existing.map(p => [p.partNo.trim().toUpperCase().replace(/[\s\-_\.]+/g, ''), p]));

        // CSV 파싱
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          // 간단한 CSV 파싱 (쉼표 구분, 따옴표 처리)
          const cells: string[] = [];
          let current = '';
          let inQuote = false;
          for (const ch of lines[i]) {
            if (ch === '"') { inQuote = !inQuote; }
            else if (ch === ',' && !inQuote) { cells.push(current.trim()); current = ''; }
            else { current += ch; }
          }
          cells.push(current.trim());

          const partNo = cells[partNoIdx]?.replace(/^"|"$/g, '').trim();
          const priceStr = cells[priceIdx]?.replace(/^"|"$/g, '').replace(/,/g, '').trim();
          const price = parseFloat(priceStr);
          if (!partNo || isNaN(price) || price <= 0) continue;

          const partName = nameIdx >= 0 ? cells[nameIdx]?.replace(/^"|"$/g, '').trim() : undefined;
          const key = partNo.toUpperCase().replace(/[\s\-_\.]+/g, '');
          priceMap.set(key, { partNo, unitPrice: price, partName });
          imported++;
        }

        if (imported === 0) {
          alert('유효한 단가 데이터가 없습니다. 단가 > 0인 항목이 필요합니다.');
          return;
        }

        const merged = Array.from(priceMap.values());
        safeSetItem('dashboard_manualPrices', JSON.stringify(merged));
        setManualPriceCount(merged.length);
        calculateMRPData();
        alert(`${imported}건 단가 등록 완료 (총 ${merged.length}건 수동단가)`);
      } catch (err) {
        console.error('단가 CSV 파싱 실패:', err);
        alert('CSV 파싱에 실패했습니다. 파일 형식을 확인해주세요.');
      }
    };
    reader.readAsArrayBuffer(file);
    // 같은 파일 재업로드 허용
    e.target.value = '';
  };

  const handleManualPriceReset = () => {
    if (!confirm('수동 등록 단가를 모두 초기화하시겠습니까?')) return;
    localStorage.removeItem('dashboard_manualPrices');
    setManualPriceCount(0);
    calculateMRPData();
  };

  // No data state
  if (!mrpResult && !isCalculating) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-gray-400 text-lg mb-2">MRP 데이터가 없습니다</div>
          <div className="text-xs text-gray-400 space-y-1">
            <p>1. BOM 마스터 탭에서 <span className="font-semibold">bom_개정.xlsx</span>를 업로드하세요</p>
            <p>2. 영업현황에서 <span className="font-semibold">매출계획(Forecast)</span>을 업로드하세요</p>
          </div>
        </div>
      </div>
    );
  }

  if (isCalculating) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <div className="text-gray-500">MRP 계산 중...</div>
      </div>
    );
  }

  const { summary, byMonth } = mrpResult!;

  return (
    <div className="space-y-4">
      {/* 메트릭 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <MetricCard label="총 소요자재" value={`${summary.totalMaterials.toLocaleString()}종`} />
        <MetricCard
          label="BOM 매칭률"
          value={`${(summary.bomMatchRate * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="단가 매칭률"
          value={`${(summary.priceMatchRate * 100).toFixed(1)}%`}
        />
        {summary.noPriceMaterials > 0 && (
          <MetricCard label="단가 미매칭" value={`${summary.noPriceMaterials}종`} />
        )}
        <MetricCard
          label="총 소요원가"
          value={`${summary.totalCost > 0 ? (summary.totalCost / 100000000).toFixed(1) : '0'}억원`}
        />
      </div>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 월별 소요량 바차트 */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">월별 소요량</h3>
          <ResponsiveContainer minWidth={0} width="100%" height={250}>
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
              <Tooltip
                formatter={(v: number) => [v.toLocaleString(), '소요량']}
                contentStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="totalQty" fill="#3b82f6" name="소요량" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 자재유형별 파이차트 */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">자재유형별 분포</h3>
          <ResponsiveContainer minWidth={0} width="100%" height={250}>
            <PieChart>
              <Pie
                data={typeDistribution}
                dataKey="qty"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
                style={{ fontSize: 11 }}
              >
                {typeDistribution.map((entry, index) => (
                  <Cell key={index} fill={TYPE_COLORS[entry.name] || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => v.toLocaleString()}
                contentStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 필터 + 다운로드 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-xs"
        >
          <option value="All">전체 유형</option>
          <option value="RESIN">RESIN</option>
          <option value="PAINT">PAINT</option>
          <option value="구매">구매</option>
          <option value="외주">외주</option>
          <option value="__NO_PRICE__">단가없음</option>
        </select>
        <input
          type="text"
          placeholder="자재코드/자재명 검색..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-xs w-48"
        />
        <span className="text-xs text-gray-400">
          {filteredMaterials.length.toLocaleString()}건
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={calculateMRPData}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            재계산
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
          >
            Excel 내보내기
          </button>
          {mrpResult && summary.noPriceMaterials > 0 && (
            <>
              <button
                onClick={handleNoPriceExport}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
              >
                단가없음 리스트 ({summary.noPriceMaterials}건)
              </button>
              <button
                onClick={() => priceFileRef.current?.click()}
                className="px-3 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600"
              >
                단가 업로드
              </button>
              <input
                ref={priceFileRef}
                type="file"
                accept=".csv"
                onChange={handlePriceUpload}
                className="hidden"
              />
            </>
          )}
          {manualPriceCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] font-medium">
                수동단가 {manualPriceCount}건
              </span>
              <button
                onClick={handleManualPriceReset}
                className="text-[10px] text-gray-400 hover:text-red-500"
                title="수동단가 초기화"
              >
                ✕
              </button>
            </span>
          )}
        </div>
      </div>

      {/* 상세 테이블 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="w-full flex items-center justify-between px-4 py-2 bg-gray-50">
          <button
            onClick={() => setTableOpen(!tableOpen)}
            className="flex items-center gap-2 hover:bg-gray-100 -m-1 p-1 rounded"
          >
            <span className="text-sm font-semibold text-gray-700">
              {viewMode === 'tree'
                ? `BOM 트리 (${bomRootsRef.current.length}개 제품)`
                : `자재별 소요량 상세 (${filteredMaterials.length.toLocaleString()}건)`}
            </span>
            <span className="text-gray-400 text-xs">{tableOpen ? '▲' : '▼'}</span>
          </button>
          <div className="flex items-center gap-2">
            {viewMode === 'tree' && expandedNodes.size > 0 && (
              <button
                onClick={() => setExpandedNodes(new Set())}
                className="text-[10px] text-gray-400 hover:text-gray-600"
              >
                전체접기
              </button>
            )}
            {viewMode === 'flat' && (
              <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded text-[10px]">
                <button
                  onClick={() => setMonthlyMode('qty')}
                  className={`px-2 py-0.5 rounded ${monthlyMode === 'qty' ? 'bg-white shadow text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  월별수량
                </button>
                <button
                  onClick={() => setMonthlyMode('cost')}
                  className={`px-2 py-0.5 rounded ${monthlyMode === 'cost' ? 'bg-white shadow text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  월별금액
                </button>
              </div>
            )}
            <button
              onClick={() => { setViewMode(v => v === 'flat' ? 'tree' : 'flat'); setExpandedNodes(new Set()); }}
              className="px-2 py-0.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100"
            >
              {viewMode === 'flat' ? 'BOM 트리' : '테이블'}
            </button>
          </div>
        </div>

        {/* Flat 테이블 */}
        {tableOpen && viewMode === 'flat' && (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {[
                    { key: 'materialCode', label: '자재코드' },
                    { key: 'materialName', label: '자재명' },
                    { key: 'materialType', label: '유형' },
                    { key: 'unit', label: '단위' },
                    { key: 'supplier', label: '구입처' },
                    { key: 'requiredQty', label: '총소요량', align: 'right' },
                    { key: 'unitPrice', label: '단가(₩)', align: 'right' },
                    { key: 'totalCost', label: '총원가(₩)', align: 'right' },
                    { key: 'parentProducts', label: '관련제품', align: 'right' },
                    ...Array.from({ length: 12 }, (_, i) => ({
                      key: `month_${i}`,
                      label: monthlyMode === 'cost' ? `${i + 1}월(₩)` : `${i + 1}월`,
                      align: 'right' as const,
                    })),
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-3 py-2 text-gray-600 font-medium cursor-pointer hover:bg-gray-100 whitespace-nowrap ${
                        (col as any).align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.label}
                      {sortConfig?.key === col.key && (
                        <span className="ml-1">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredMaterials.slice(0, 300).map((m, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-blue-50 cursor-pointer ${selectedMaterial?.materialCode === m.materialCode ? 'bg-blue-50' : m.unitPrice <= 0 ? 'bg-red-50' : ''}`}
                    onClick={() => setSelectedMaterial(selectedMaterial?.materialCode === m.materialCode ? null : m)}
                  >
                    <td className="px-3 py-1.5 font-mono text-gray-700 whitespace-nowrap">{m.materialCode}</td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-72 truncate" title={m.materialName}>{m.materialName}</td>
                    <td className="px-3 py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
                        backgroundColor: `${TYPE_COLORS[m.materialType] || '#94a3b8'}20`,
                        color: TYPE_COLORS[m.materialType] || '#94a3b8',
                      }}>
                        {m.materialType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 text-center">{m.unit || '-'}</td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-40 truncate" title={m.supplier || ''}>{m.supplier || '-'}</td>
                    <MrpQtyCell m={m} />
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {m.unitPrice > 0 ? `₩${Math.round(m.unitPrice).toLocaleString()}` : '-'}
                    </td>
                    <MrpCostCell m={m} />
                    <td className="px-3 py-1.5 text-right text-gray-500">{m.parentProducts.length}</td>
                    {Array.from({ length: 12 }, (_, i) => {
                      if (monthlyMode === 'cost') {
                        const cost = m.unitPrice > 0 ? m.monthlyQty[i] * m.unitPrice : 0;
                        return (
                          <td key={i} className={`px-3 py-1.5 text-right font-mono ${cost > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                            {m.unitPrice <= 0 ? '-' : cost > 0 ? `₩${Math.round(cost).toLocaleString()}` : '-'}
                          </td>
                        );
                      }
                      return (
                        <td key={i} className={`px-3 py-1.5 text-right font-mono ${m.monthlyQty[i] > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                          {m.monthlyQty[i] > 0 ? Math.round(m.monthlyQty[i]).toLocaleString() : '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredMaterials.length > 300 && (
              <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                {filteredMaterials.length - 300}건 더 있음
              </div>
            )}
          </div>
        )}

        {/* BOM 트리 테이블 */}
        {tableOpen && viewMode === 'tree' && (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium min-w-[280px]">품번</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">품명</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">유형</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">BOM수량</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">누적소요량</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">구입처</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">단가</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleTreeRows.map((row, rowIdx) => (
                  <tr
                    key={`${row.key}_${rowIdx}`}
                    className={`hover:bg-blue-50 ${row.depth === 0 ? 'bg-indigo-50/50' : ''} ${!row.hasChildren && row.unitPrice <= 0 ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-3 py-1.5 font-mono text-gray-700 whitespace-nowrap">
                      <span style={{ paddingLeft: `${row.depth * 20}px` }} className="inline-flex items-center">
                        {row.hasChildren ? (
                          <button
                            onClick={() => toggleTreeNode(row.key)}
                            className="mr-1 text-gray-400 hover:text-gray-700 w-4 text-center flex-shrink-0"
                          >
                            {row.isExpanded ? '▼' : '▶'}
                          </button>
                        ) : (
                          <span className="mr-1 w-4 text-center text-gray-300 flex-shrink-0">·</span>
                        )}
                        <span>{row.pn}</span>
                        {row.hasChildren && (
                          <span className="ml-1 text-[9px] text-gray-400">({row.childCount})</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-48 truncate">{row.name}</td>
                    <td className="px-3 py-1.5">
                      {row.type && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
                          backgroundColor: `${TYPE_COLORS[row.type] || '#94a3b8'}20`,
                          color: TYPE_COLORS[row.type] || '#94a3b8',
                        }}>
                          {row.type}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600 font-mono">
                      {row.depth === 0 ? '-' : (
                        Number.isInteger(row.unitQty) ? row.unitQty.toLocaleString() : row.unitQty.toFixed(row.unitQty < 0.01 ? 4 : 3)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 font-mono font-medium">
                      {row.depth === 0 ? '-' : (
                        Number.isInteger(row.totalQty) ? row.totalQty.toLocaleString() : row.totalQty.toFixed(row.totalQty < 0.01 ? 4 : 3)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-24 truncate">{row.supplier || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {row.unitPrice > 0 ? `₩${Math.round(row.unitPrice).toLocaleString()}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleTreeRows.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-gray-400">
                {filterText ? '검색 결과가 없습니다' : 'BOM 데이터가 없습니다'}
              </div>
            )}
            {visibleTreeRows.length >= 1000 && (
              <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                표시 제한 (1,000행). 일부 노드를 접어서 범위를 줄여주세요.
              </div>
            )}
          </div>
        )}
      </div>

      {/* 자재 클릭 → 관련 제품 드릴다운 */}
      {selectedMaterial && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">
              [{selectedMaterial.materialCode}] {selectedMaterial.materialName} - 관련 제품
            </h3>
            <button
              onClick={() => setSelectedMaterial(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              닫기
            </button>
          </div>

          {/* 월별 소요량 바차트 */}
          <ResponsiveContainer minWidth={0} width="100%" height={150}>
            <BarChart data={selectedMaterial.monthlyQty.map((q, i) => ({ month: `${i + 1}월`, qty: q }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} contentStyle={{ fontSize: 10 }} />
              <Bar dataKey="qty" fill={TYPE_COLORS[selectedMaterial.materialType] || '#3b82f6'} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* 월별 금액 바차트 (단가 있을 때만) */}
          {selectedMaterial.unitPrice > 0 && (
            <>
              <h4 className="text-xs font-medium text-gray-500 mt-3 mb-1">월별 소요금액 (₩)</h4>
              <ResponsiveContainer minWidth={0} width="100%" height={150}>
                <BarChart data={selectedMaterial.monthlyQty.map((q, i) => ({ month: `${i + 1}월`, cost: Math.round(q * selectedMaterial.unitPrice) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)} />
                  <Tooltip formatter={(v: number) => [`₩${(v as number).toLocaleString()}`, '금액']} contentStyle={{ fontSize: 10 }} />
                  <Bar dataKey="cost" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {selectedMaterial.parentProducts.map((pn, i) => (
              <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-mono">
                {pn}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 퍼지 매칭 결과 */}
      {summary.fuzzyMatchedProducts && summary.fuzzyMatchedProducts.length > 0 && (
        <div className="bg-blue-50 rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-blue-700 mb-2">
            퍼지 매칭 ({summary.fuzzyMatchedProducts.length}건) - 유사 BOM 사용
          </h3>
          <div className="flex flex-wrap gap-1">
            {summary.fuzzyMatchedProducts.map((desc, i) => (
              <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-mono">
                {desc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 미매칭 제품 */}
      {summary.unmatchedProducts.length > 0 && (
        <div className="bg-orange-50 rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-orange-700">
              BOM 미매칭 제품 ({summary.unmatchedProducts.length}건)
            </h3>
            <button
              onClick={() => {
                const csv = 'NEW_PN\n' + summary.unmatchedProducts.join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'BOM_미매칭_리스트.csv'; a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs px-2 py-1 bg-orange-200 text-orange-800 rounded hover:bg-orange-300"
            >
              CSV 다운로드
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.unmatchedProducts.slice(0, 30).map((pn, i) => (
              <span key={i} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-mono">
                {pn}
              </span>
            ))}
            {summary.unmatchedProducts.length > 30 && (
              <span className="text-xs text-orange-500">...외 {summary.unmatchedProducts.length - 30}건</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MRPView;
