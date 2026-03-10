import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
  MaterialCodeRecord,
} from '../utils/bomMasterParser';
import { normalizePn } from '../utils/bomDataParser';
import {
  buildForwardMap,
  buildRefInfoMap,
  expandForwardTree,
  BomTreeNode,
} from '../utils/bomExplosionEngine';
import {
  PurchasePrice,
  OutsourcePrice,
  ItemStandardCost,
  PaintMixRatio,
} from '../utils/standardMaterialParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { ForecastItem } from '../utils/salesForecastParser';
import {
  bomMasterService,
  productCodeService,
  referenceInfoService,
  materialCodeService,
  purchasePriceService,
  outsourceInjPriceService,
  itemStandardCostService,
  itemRevenueService,
  paintMixRatioService,
  forecastService,
} from '../services/supabaseService';
import PaintAnalysisPanel from './PaintAnalysisPanel';

// ============================================
// Types
// ============================================

interface ReviewStatus {
  production: boolean;
  development: boolean;
  sales: boolean;
  purchase: boolean;
}

type ReviewStatusMap = Record<string, ReviewStatus>;

interface EditCell {
  parentPn: string;
  childPn: string;
  field: 'childName' | 'qty' | 'partType' | 'supplier';
  nodeKey: string;
}

/** 사출 산출근거 */
interface InjectionDetail {
  rawMaterialCode: string;
  rawMaterialName: string;
  materialPrice: number;  // 원/kg
  netWeight: number;      // g
  runnerWeight: number;   // g
  cavity: number;
  lossRate: number;       // %
  weightPerEa: number;    // g
  calculatedCost: number; // 원
}

/** 도장 산출근거 (배합비율 기반) */
interface PaintDetail {
  paintCode: string;
  paintName: string;
  mainRatio: number;       // %
  hardenerRatio: number;   // %
  thinnerRatio: number;    // %
  mainPrice: number;       // 원/kg
  hardenerPrice: number;   // 원/kg
  thinnerPrice: number;    // 원/kg
  mixCostPerKg: number;    // 배합단가 원/kg
  paintIntake: number;     // 개취수량 EA/kg
  costPerEa: number;       // 개당 도료비 원/EA
}

interface SelectedNodeInfo {
  pn: string;
  name: string;
  partType: string;
  supplier: string;
  supplyType: string;
  unitQty: number;
  price: number;
  amount: number;
  priceSource: string;
  injection?: InjectionDetail;
  paint?: PaintDetail;
}

/** 선택 자재 상세 편집 상태 */
interface DetailEditState {
  price: string;
  unitQty: string;
  supplyType: string;
  supplier: string;
}

/** 도장 편집 상태 */
interface PaintEditState {
  paintIntake: string;
}

/** 사출 편집 상태 */
interface InjEditState {
  materialPrice: string;
  netWeight: string;
  runnerWeight: string;
  cavity: string;
  lossRate: string;
}

const DEPARTMENTS = [
  { key: 'production' as const, label: '생산팀' },
  { key: 'development' as const, label: '개발팀' },
  { key: 'sales' as const, label: '영업팀' },
  { key: 'purchase' as const, label: '구매팀' },
];

const REVIEW_STORAGE_KEY = 'dashboard_bomReviewStatus';

// ============================================
// Helpers
// ============================================

function loadReviewStatus(): ReviewStatusMap {
  try {
    const stored = localStorage.getItem(REVIEW_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveReviewStatus(map: ReviewStatusMap) {
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function isAllChecked(status: ReviewStatus | undefined): boolean {
  if (!status) return false;
  return status.production && status.development && status.sales && status.purchase;
}

const typeBadge = (t: string) => {
  if (/사출/.test(t)) return { label: '사출', cls: 'bg-emerald-100 text-emerald-700' };
  if (/도장/.test(t)) return { label: '도장', cls: 'bg-violet-100 text-violet-700' };
  if (/구매/.test(t)) return { label: '구매', cls: 'bg-amber-100 text-amber-700' };
  if (/외주/.test(t)) return { label: '외주', cls: 'bg-blue-100 text-blue-700' };
  if (/원재료/.test(t)) return { label: '원재료', cls: 'bg-rose-100 text-rose-700' };
  if (/조립/.test(t)) return { label: '조립', cls: 'bg-slate-100 text-slate-600' };
  if (t) return { label: t.slice(0, 4), cls: 'bg-slate-100 text-slate-600' };
  return null;
};

const fmtWon = (v: number) => v > 0 ? `₩${Math.round(v).toLocaleString()}` : '—';

// ============================================
// Component
// ============================================

const BomReviewView: React.FC = () => {
  // --- Data State ---
  const [bomRecords, setBomRecords] = useState<BomMasterRecord[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCodeRecord[]>([]);
  const [refInfo, setRefInfo] = useState<ReferenceInfoRecord[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCodeRecord[]>([]);
  const [purchasePrices, setPurchasePrices] = useState<PurchasePrice[]>([]);
  const [outsourcePrices, setOutsourcePrices] = useState<OutsourcePrice[]>([]);
  const [stdCosts, setStdCosts] = useState<ItemStandardCost[]>([]);
  const [revenueData, setRevenueData] = useState<ItemRevenueRow[]>([]);
  const [forecastData, setForecastData] = useState<ForecastItem[]>([]);
  const [paintMixRatios, setPaintMixRatios] = useState<PaintMixRatio[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Filter State ---
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [searchText, setSearchText] = useState('');

  // --- Selection State ---
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<SelectedNodeInfo | null>(null);

  // --- Review Status ---
  const [reviewStatus, setReviewStatus] = useState<ReviewStatusMap>(loadReviewStatus);

  // --- BOM Tree State ---
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // --- Inline Edit State ---
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);

  // --- Price Edit State ---
  const [editingPriceKey, setEditingPriceKey] = useState('');
  const [editPriceValue, setEditPriceValue] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const priceInputRef = useRef<HTMLInputElement>(null);

  // --- Sync BOM→표준 State ---
  const [syncingStd, setSyncingStd] = useState(false);
  const [syncedPns, setSyncedPns] = useState<Set<string>>(new Set());

  // --- Injection Edit State ---
  const [injEdit, setInjEdit] = useState<InjEditState | null>(null);
  const [savingInj, setSavingInj] = useState(false);

  // --- Paint Edit State ---
  const [paintEdit, setPaintEdit] = useState<PaintEditState | null>(null);
  const [savingPaint, setSavingPaint] = useState(false);

  // --- Detail Edit State ---
  const [detailEdit, setDetailEdit] = useState<DetailEditState | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);

  // --- Paint Analysis Panel ---
  const [showPaintAnalysis, setShowPaintAnalysis] = useState(false);

  // --- Sort State ---
  type SortKey = 'pn' | 'name' | 'customer' | 'model' | 'sellingPrice' | 'planQty' | 'expectedRevenue' | 'materialCost' | 'materialRatio';
  const [sortKey, setSortKey] = useState<SortKey>('pn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // --- Product List Collapse State ---
  const [productListCollapsed, setProductListCollapsed] = useState(false);

  // --- Month Selector ---
  const [selectedMonth, setSelectedMonth] = useState(0); // 0=연간, 1~12=해당월

  // --- Data Load ---
  const loadAllData = useCallback(async () => {
    setLoading(true);
    // 개별 서비스 실패해도 나머지 데이터는 정상 로드 (다른 PC에서 RLS/네트워크 에러 대응)
    const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((e) => { console.warn('데이터 로드 실패 (fallback 사용):', e?.message || e); return fallback; });

    const [bom, pc, ri, mc, pp, op, sc, rv, pmr] = await Promise.all([
      safe(bomMasterService.getAll(), []),
      safe(productCodeService.getAll(), []),
      safe(referenceInfoService.getAll(), []),
      safe(materialCodeService.getAll(), []),
      safe(purchasePriceService.getAll(), []),
      safe(outsourceInjPriceService.getAll(), []),
      safe(itemStandardCostService.getAll(), []),
      safe(itemRevenueService.getAll(), []),
      safe(paintMixRatioService.getAll(), []),
    ]);
    setBomRecords(bom);
    setProductCodes(pc);
    setRefInfo(ri);
    setMaterialCodes(mc);
    setPurchasePrices(pp);
    setOutsourcePrices(op);
    setStdCosts(sc);
    setRevenueData(rv);
    setPaintMixRatios(pmr);
    // Forecast (월별) 데이터 로드 (Supabase 우선, fallback localStorage)
    try {
      const fc = await safe(forecastService.getItems(), []);
      if (fc.length > 0) {
        setForecastData(fc);
      } else {
        const fcStr = localStorage.getItem('dashboard_forecastData');
        if (fcStr) setForecastData(JSON.parse(fcStr));
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  // --- Derived Maps ---
  const forwardMap = useMemo(() => buildForwardMap(bomRecords), [bomRecords]);
  const refInfoMap = useMemo(() => buildRefInfoMap(refInfo), [refInfo]);

  // --- PaintMix Map: paintCode(S코드) + mainCode(P코드) + P→S변환 → PaintMixRatio ---
  const paintMixMap = useMemo(() => {
    const map = new Map<string, PaintMixRatio>();
    for (const pmr of paintMixRatios) {
      // S코드(paintCode)로 키 등록
      map.set(normalizePn(pmr.paintCode), pmr);
      // P코드(mainCode)로도 키 등록 — reference_info의 원재료코드가 P코드
      if (pmr.mainCode) {
        map.set(normalizePn(pmr.mainCode), pmr);
      }
    }
    // 2차 패스: P접두사→S접두사 변환 매칭 (PHT0232→SHT0232 등)
    // 아직 map에 없는 P코드를 S코드로 변환해서 매칭 시도
    // (이미 mainCode로 등록된 P코드는 건너뜀)
    return map;
  }, [paintMixRatios]);

  // --- Price Maps ---
  const priceData = useMemo(() => {
    const matPriceMap = new Map<string, number>();
    const materialTypeMap = new Map<string, string>();
    const matNameMap = new Map<string, string>();
    for (const mc of materialCodes) {
      const code = normalizePn(mc.materialCode);
      if (mc.currentPrice > 0) matPriceMap.set(code, mc.currentPrice);
      materialTypeMap.set(code, mc.materialType || '');
      matNameMap.set(code, mc.materialName || '');
    }
    const purchaseMap = new Map<string, number>();
    for (const pp of purchasePrices) {
      if (pp.currentPrice > 0) {
        purchaseMap.set(normalizePn(pp.itemCode), pp.currentPrice);
        if (pp.customerPn) purchaseMap.set(normalizePn(pp.customerPn), pp.currentPrice);
      }
    }
    const outsourceMap = new Map<string, number>();
    for (const op of outsourcePrices) {
      if (op.injectionPrice > 0) {
        outsourceMap.set(normalizePn(op.itemCode), op.injectionPrice);
        if (op.customerPn) outsourceMap.set(normalizePn(op.customerPn), op.injectionPrice);
      }
    }
    const stdMap = new Map<string, number>();
    for (const sc of stdCosts) {
      const costVal = sc.material_cost_per_ea || (sc.resin_cost_per_ea + sc.paint_cost_per_ea);
      if (costVal > 0) {
        stdMap.set(normalizePn(sc.item_code), costVal);
        if (sc.customer_pn) stdMap.set(normalizePn(sc.customer_pn), costVal);
      }
    }
    return { matPriceMap, materialTypeMap, matNameMap, purchaseMap, outsourceMap, stdMap };
  }, [materialCodes, purchasePrices, outsourcePrices, stdCosts]);

  // --- Revenue (판매단가) Map ---
  const revenueMap = useMemo(() => {
    const map = new Map<string, number>(); // pn -> unit price

    if (forecastData.length > 0) {
      // ForecastItem의 unitPrice 사용 (판매단가)
      for (const fc of forecastData) {
        const pn = normalizePn(fc.partNo);
        const custPn = fc.newPartNo ? normalizePn(fc.newPartNo) : '';
        if (fc.unitPrice > 0) {
          for (const key of [pn, custPn]) {
            if (!key) continue;
            if (!map.has(key)) map.set(key, fc.unitPrice);
          }
        }
      }
    } else if (revenueData.length > 0) {
      // ItemRevenueRow에서 평균 판매단가 산출
      const agg = new Map<string, { totalAmt: number; totalQty: number }>();
      for (const rv of revenueData) {
        const pn = normalizePn(rv.partNo);
        const custPn = rv.customerPN ? normalizePn(rv.customerPN) : '';
        for (const key of [pn, custPn]) {
          if (!key) continue;
          const prev = agg.get(key) || { totalAmt: 0, totalQty: 0 };
          prev.totalAmt += rv.amount;
          prev.totalQty += rv.qty;
          agg.set(key, prev);
        }
      }
      for (const [key, val] of agg) {
        if (val.totalQty > 0) map.set(key, val.totalAmt / val.totalQty);
      }
    }
    return map;
  }, [forecastData, revenueData]);

  // --- Plan Qty & Expected Revenue Maps (월별 선택 지원) ---
  const { planQtyMap, expectedRevenueMap } = useMemo(() => {
    const qtyMap = new Map<string, number>();
    const revMap = new Map<string, number>();

    const monthQtyKeys = ['jan_qty','feb_qty','mar_qty','apr_qty','may_qty','jun_qty','jul_qty','aug_qty','sep_qty','oct_qty','nov_qty','dec_qty'] as const;

    if (forecastData.length > 0) {
      // ForecastItem 기반 (월별 데이터 사용 가능)
      for (const fc of forecastData) {
        const pn = normalizePn(fc.partNo);
        const custPn = fc.newPartNo ? normalizePn(fc.newPartNo) : '';
        const qty = selectedMonth === 0 ? fc.totalQty : (fc.monthlyQty[selectedMonth - 1] || 0);
        const rev = selectedMonth === 0
          ? (fc.totalRevenue > 0 ? fc.totalRevenue : fc.unitPrice * fc.totalQty)
          : (fc.monthlyRevenue[selectedMonth - 1] || fc.unitPrice * (fc.monthlyQty[selectedMonth - 1] || 0));
        for (const key of [pn, custPn]) {
          if (!key) continue;
          qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
          revMap.set(key, (revMap.get(key) || 0) + rev);
        }
      }
    } else if (stdCosts.length > 0) {
      // item_standard_cost 월별 수량 활용 + revenueMap 단가로 매출 산출
      for (const sc of stdCosts) {
        const pn = normalizePn(sc.item_code);
        const custPn = sc.customer_pn ? normalizePn(sc.customer_pn) : '';
        const qty = selectedMonth === 0
          ? (sc.total_qty || 0)
          : (sc[monthQtyKeys[selectedMonth - 1]] || 0);
        const unitPrice = revenueMap.get(pn) || (custPn ? revenueMap.get(custPn) : 0) || 0;
        for (const key of [pn, custPn]) {
          if (!key) continue;
          qtyMap.set(key, (qtyMap.get(key) || 0) + qty);
          if (unitPrice > 0) {
            revMap.set(key, (revMap.get(key) || 0) + unitPrice * qty);
          }
        }
      }
    } else {
      // ItemRevenueRow 폴백 (연간 합산만)
      for (const rv of revenueData) {
        const pn = normalizePn(rv.partNo);
        const custPn = rv.customerPN ? normalizePn(rv.customerPN) : '';
        for (const key of [pn, custPn]) {
          if (!key) continue;
          qtyMap.set(key, (qtyMap.get(key) || 0) + rv.qty);
          revMap.set(key, (revMap.get(key) || 0) + rv.amount);
        }
      }
    }
    return { planQtyMap: qtyMap, expectedRevenueMap: revMap };
  }, [revenueData, forecastData, stdCosts, selectedMonth]);

  // --- getPaintInfo: 도장 재료비 (배합비율 기반) ---
  const getPaintInfo = useCallback((pn: string): PaintDetail | undefined => {
    const code = normalizePn(pn);
    const ri = refInfoMap.get(code);
    if (!ri) return undefined;
    const { materialTypeMap } = priceData;
    const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean) as string[];
    const isPaintPart = /도장/.test(ri.processType || '');

    // 1차: materialTypeMap에서 PAINT/도료 타입인 코드로 매칭
    for (const raw of rawCodes) {
      const rawNorm = normalizePn(raw);
      const matType = materialTypeMap.get(rawNorm) || '';
      if (!/PAINT|도료/i.test(matType)) continue;
      const mix = paintMixMap.get(rawNorm);
      if (!mix) continue;
      const mixCostPerKg =
        (mix.mainRatio / 100) * mix.mainPrice +
        (mix.hardenerRatio / 100) * mix.hardenerPrice +
        (mix.thinnerRatio / 100) * mix.thinnerPrice;
      const paintIntake = ri.paintIntake || 0;
      const costPerEa = paintIntake > 0 ? mixCostPerKg / paintIntake : 0;
      return {
        paintCode: raw,
        paintName: mix.paintName || raw,
        mainRatio: mix.mainRatio, hardenerRatio: mix.hardenerRatio, thinnerRatio: mix.thinnerRatio,
        mainPrice: mix.mainPrice, hardenerPrice: mix.hardenerPrice, thinnerPrice: mix.thinnerPrice,
        mixCostPerKg, paintIntake, costPerEa,
      };
    }

    // 2차: 도장 유형이면 rawCode로 paintMixMap 직접 시도 (materialType 무관)
    if (isPaintPart) {
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        let mix = paintMixMap.get(rawNorm);
        // 2.5차: P→S 접두사 변환 시도 (PHT0232→SHT0232 등)
        if (!mix && /^P/.test(raw.trim().toUpperCase())) {
          const sCode = normalizePn('S' + raw.trim().substring(1));
          mix = paintMixMap.get(sCode);
        }
        if (!mix) continue;
        const mixCostPerKg =
          (mix.mainRatio / 100) * mix.mainPrice +
          (mix.hardenerRatio / 100) * mix.hardenerPrice +
          (mix.thinnerRatio / 100) * mix.thinnerPrice;
        const paintIntake = ri.paintIntake || 0;
        const costPerEa = paintIntake > 0 ? mixCostPerKg / paintIntake : 0;
        return {
          paintCode: raw,
          paintName: mix.paintName || raw,
          mainRatio: mix.mainRatio, hardenerRatio: mix.hardenerRatio, thinnerRatio: mix.thinnerRatio,
          mainPrice: mix.mainPrice, hardenerPrice: mix.hardenerPrice, thinnerPrice: mix.thinnerPrice,
          mixCostPerKg, paintIntake, costPerEa,
        };
      }
      // 3차: 도장 유형인데 매칭 안 됨 → skeleton (코드 정보만)
      const firstRaw = rawCodes[0] || '(미등록)';
      return {
        paintCode: firstRaw,
        paintName: firstRaw,
        mainRatio: 0, hardenerRatio: 0, thinnerRatio: 0,
        mainPrice: 0, hardenerPrice: 0, thinnerPrice: 0,
        mixCostPerKg: 0,
        paintIntake: ri.paintIntake || 0,
        costPerEa: 0,
      };
    }

    return undefined;
  }, [refInfoMap, priceData, paintMixMap]);

  // --- getNodePrice: BOM 트리 개별 부품 단가 ---
  // 표준재료비는 하위부품 합산값이므로 최후순위(leaf만)
  const getNodePrice = useCallback((pn: string): { price: number; source: string } => {
    const code = normalizePn(pn);
    const { matPriceMap, materialTypeMap, purchaseMap, outsourceMap, stdMap } = priceData;
    const ri = refInfoMap.get(code);

    // 1) 구매단가
    const pp = purchaseMap.get(code);
    if (pp && pp > 0) {
      if (ri && /외주/.test(ri.supplyType || '')) {
        const op = outsourceMap.get(code) || 0;
        return { price: Math.max(0, pp - op), source: op > 0 ? '외주' : '구매' };
      }
      return { price: pp, source: '구매' };
    }
    // 2) 사출공식
    if (ri) {
      const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        const matType = materialTypeMap.get(rawNorm) || '';
        if (/PAINT|도료/i.test(matType)) continue;
        const rp = matPriceMap.get(rawNorm);
        if (rp && rp > 0 && ri.netWeight && ri.netWeight > 0) {
          const rw = ri.runnerWeight || 0;
          const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
          const wpe = ri.netWeight + rw / cavity;
          const cost = (wpe * rp / 1000) * (1 + (ri.lossRate || 0) / 100);
          return { price: cost, source: '사출' };
        }
      }
    }
    // 2.5) 도장공식: 배합비율 기반 (외주도장은 구매단가 사용 → 도장공식 스킵)
    if (ri && /도장/.test(ri.processType || '') && !/외주/.test(ri.supplyType || '')) {
      const paint = getPaintInfo(pn);
      if (paint && paint.costPerEa > 0) return { price: paint.costPerEa, source: '도장' };
    }
    // 3) 재질코드 직접
    const dp = matPriceMap.get(code);
    if (dp && dp > 0) return { price: dp, source: '재질' };
    // 4) 표준재료비 (폴백 — 하위부품 합산값일 수 있으므로 최후순위)
    const std = stdMap.get(code);
    if (std && std > 0) return { price: std, source: '표준' };
    return { price: 0, source: '' };
  }, [priceData, refInfoMap, getPaintInfo]);

  // --- calcRootMaterialCost: Level-0 제품의 재료비를 BOM 트리 walk 방식으로 합산 ---
  // 주의: non-leaf 노드에서 '표준' 단가는 가공비/경비 포함 전체원가이므로 사용 금지
  const calcRootMaterialCost = useCallback((rootPn: string): number => {
    const visited = new Set<string>();
    function walk(pn: string, qty: number): number {
      const code = normalizePn(pn);
      if (visited.has(code)) return 0; // 순환 방지
      visited.add(code);
      const children = forwardMap.get(code) || [];
      if (children.length === 0) {
        // Leaf: 자체 단가 사용 (표준 포함 OK)
        const { price } = getNodePrice(pn);
        visited.delete(code);
        return qty * price;
      }
      // Non-leaf: 구매/사출/도장/재질 단가만 사용, '표준'은 제외 → 자식 재귀
      const { price, source } = getNodePrice(pn);
      if (price > 0 && source !== '표준') {
        visited.delete(code);
        return qty * price;
      }
      let sum = 0;
      for (const child of children) {
        sum += walk(child.childPn, qty * child.qty);
      }
      visited.delete(code);
      return sum;
    }
    // 루트 자체는 집계 대상이 아니므로 자식부터 시작
    const children = forwardMap.get(normalizePn(rootPn)) || [];
    let total = 0;
    for (const child of children) {
      total += walk(child.childPn, child.qty);
    }
    return total;
  }, [forwardMap, getNodePrice]);

  // --- getInjectionDetail ---
  const getInjectionDetail = useCallback((pn: string): InjectionDetail | undefined => {
    const code = normalizePn(pn);
    const ri = refInfoMap.get(code);
    if (!ri) return undefined;
    const { matPriceMap, materialTypeMap, matNameMap } = priceData;
    const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
    for (const raw of rawCodes) {
      const rawNorm = normalizePn(raw);
      const matType = materialTypeMap.get(rawNorm) || '';
      if (/PAINT|도료/i.test(matType)) continue;
      const rp = matPriceMap.get(rawNorm);
      if (rp && rp > 0 && ri.netWeight && ri.netWeight > 0) {
        const rw = ri.runnerWeight || 0;
        const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
        const loss = ri.lossRate || 0;
        const wpe = ri.netWeight + rw / cavity;
        const cost = (wpe * rp / 1000) * (1 + loss / 100);
        return {
          rawMaterialCode: raw,
          rawMaterialName: matNameMap.get(rawNorm) || raw,
          materialPrice: rp,
          netWeight: ri.netWeight,
          runnerWeight: rw,
          cavity,
          lossRate: loss,
          weightPerEa: wpe,
          calculatedCost: cost,
        };
      }
    }
    return undefined;
  }, [refInfoMap, priceData]);

  // --- BOM Tree for Selected Product ---
  const forwardTree = useMemo((): BomTreeNode | null => {
    if (!selectedProduct) return null;
    const normalizedSelected = normalizePn(selectedProduct);

    if (forwardMap.has(normalizedSelected)) {
      return expandForwardTree(selectedProduct, forwardMap, refInfoMap);
    }

    const pc = productCodes.find(p => normalizePn(p.productCode) === normalizedSelected);
    const selectedRef = refInfoMap.get(normalizedSelected);
    const customerPn = pc?.customerPn || selectedRef?.customerPn;

    if (customerPn) {
      const custNorm = normalizePn(customerPn);
      const bomRoots = refInfo
        .filter(ri => ri.customerPn && normalizePn(ri.customerPn) === custNorm && forwardMap.has(normalizePn(ri.itemCode)))
        .sort((a, b) => (forwardMap.get(normalizePn(b.itemCode))?.length || 0) - (forwardMap.get(normalizePn(a.itemCode))?.length || 0));

      if (bomRoots.length > 0) {
        const tree = expandForwardTree(bomRoots[0].itemCode, forwardMap, refInfoMap);
        tree.pn = selectedProduct;
        tree.name = pc?.productName || selectedRef?.itemName || tree.name;
        return tree;
      }
    }

    return expandForwardTree(selectedProduct, forwardMap, refInfoMap);
  }, [selectedProduct, forwardMap, refInfoMap, productCodes, refInfo]);

  // --- Enrich tree: 도장외주품 하위전개 + virtual paint nodes ---
  const enrichedTree = useMemo((): BomTreeNode | null => {
    if (!forwardTree) return null;

    function enrich(node: BomTreeNode): BomTreeNode {
      let newChildren = node.children.map(c => enrich(c));
      const code = normalizePn(node.pn);
      const ref = refInfoMap.get(code);

      // ── 도장외주품 하위전개 보완 ──
      // 외주(leaf 처리됨)인데 도장 프로세스인 경우, forwardMap에 하위 BOM이 있으면 전개
      if (
        newChildren.length === 0 &&
        node.level > 0 &&
        ref &&
        /외주/.test(ref.supplyType || '') &&
        /도장/.test(ref.processType || '')
      ) {
        const bomChildren = forwardMap.get(code) || [];
        if (bomChildren.length > 0) {
          // forwardMap에 하위 BOM 레코드가 있으면 직접 전개
          for (const child of bomChildren) {
            const childCode = normalizePn(child.childPn);
            const childRef = refInfoMap.get(childCode);
            const childQty = node.qty * child.qty;
            const childNode: BomTreeNode = {
              pn: child.childPn,
              name: child.childName || childRef?.itemName || '',
              level: node.level + 1,
              qty: childQty,
              unitQty: child.qty,
              partType: child.partType || childRef?.processType || childRef?.supplyType || '',
              supplier: child.supplier || childRef?.supplier || '',
              children: [],
              ...(childRef ? {
                netWeight: childRef.netWeight || undefined,
                cavity: childRef.cavity || undefined,
                processType: childRef.processType || undefined,
                supplyType: childRef.supplyType || undefined,
              } : {}),
            };
            newChildren.push(enrich(childNode));
          }
        } else {
          // BOM에 하위가 없지만 사출정보가 있으면 가상 사출물 노드 추가
          const hasInjection = ref.netWeight > 0 && ref.rawMaterialCode1;
          if (hasInjection) {
            newChildren.push({
              pn: node.pn, // 동일 품번 (도장전 사출물)
              name: `사출물 (${ref.itemName || node.name})`,
              level: node.level + 1,
              qty: node.qty,
              unitQty: 1,
              partType: '사출',
              supplier: '',
              children: [],
              processType: '사출',
              supplyType: '자작',
              netWeight: ref.netWeight || undefined,
              cavity: ref.cavity || undefined,
            });
          }
        }
      }

      // ── Virtual paint node (외주도장은 제외: 구매단가 사용) ──
      const isOutsourcePaint = ref && /외주/.test(ref.supplyType || '') && /도장/.test(ref.processType || '');
      const paintInfo = !isOutsourcePaint ? getPaintInfo(node.pn) : null;
      if (paintInfo && paintInfo.costPerEa > 0) {
        const hasPaintChild = newChildren.some(c => /PAINT_/.test(c.pn) || /도장재료/.test(c.name));
        if (!hasPaintChild) {
          newChildren.push({
            pn: `PAINT_${node.pn}`,
            name: `도장재료 (${paintInfo.paintName})`,
            level: node.level + 1,
            qty: node.qty,
            unitQty: 1,
            partType: '도장',
            supplier: '',
            children: [],
            processType: '도장',
            supplyType: '',
          });
        }
      }

      return { ...node, children: newChildren };
    }

    return enrich(forwardTree);
  }, [forwardTree, forwardMap, refInfoMap, getPaintInfo]);

  // --- BOM Total Cost ---
  const { bomTotal, stdTotal } = useMemo(() => {
    if (!enrichedTree) return { bomTotal: 0, stdTotal: 0 };
    const { stdMap } = priceData;

    let total = 0;
    let stdSum = 0;

    function walk(node: BomTreeNode) {
      if (node.level === 0) {
        for (const child of node.children) walk(child);
      } else if (node.children.length === 0) {
        // Leaf node
        if (/PAINT_/.test(node.pn)) {
          const parentPn = node.pn.replace('PAINT_', '');
          const paint = getPaintInfo(parentPn);
          if (paint) total += node.qty * paint.costPerEa;
          // 도장재료 virtual node는 표준재료비 없음 → stdSum 0
        } else {
          const { price } = getNodePrice(node.pn);
          total += node.qty * price;
          const s = stdMap.get(normalizePn(node.pn)) || 0;
          stdSum += node.qty * s;
        }
      } else {
        // Non-leaf (level > 0):
        // 트리 분개는 renderTreeRows에서 항상 유지 (원재료 소요량 확인 가능)
        // 재료비 집계만: 자체 단가 있으면 해당 노드에서만 집계 (자식은 집계 제외 → 중복 방지)
        const { price } = getNodePrice(node.pn);
        if (price > 0) {
          total += node.qty * price;
          const s = stdMap.get(normalizePn(node.pn)) || 0;
          stdSum += node.qty * s;
        } else {
          for (const child of node.children) walk(child);
        }
      }
    }
    walk(enrichedTree);

    return { bomTotal: total, stdTotal: stdSum };
  }, [enrichedTree, getNodePrice, getPaintInfo, priceData]);

  // --- Level-0 Root Products ---
  const rootProducts = useMemo(() => {
    const childSet = new Set<string>();
    for (const rec of bomRecords) childSet.add(normalizePn(rec.childPn));

    const rootPnSet = new Set<string>();
    const rootPnOriginal = new Map<string, string>();
    for (const rec of bomRecords) {
      const norm = normalizePn(rec.parentPn);
      if (!childSet.has(norm) && !rootPnSet.has(norm)) {
        rootPnSet.add(norm);
        rootPnOriginal.set(norm, rec.parentPn);
      }
    }

    const pcMap = new Map<string, ProductCodeRecord>();
    for (const pc of productCodes) {
      pcMap.set(normalizePn(pc.productCode), pc);
      if (pc.customerPn) pcMap.set(normalizePn(pc.customerPn), pc);
    }

    const roots: {
      pn: string;
      name: string;
      customer: string;
      model: string;
      childCount: number;
      sellingPrice: number;
      planQty: number;
      expectedRevenue: number;
      materialCost: number;
      materialRatio: number;
    }[] = [];

    // 코드/품번이 아닌 실제 고객사명인지 판별
    const isRealName = (s: string) => !!s && !/^\d/.test(s) && !/^[A-Z0-9]{5,}/.test(s) && !/-\d{3,}/.test(s);

    // Build customerPn → customer name map from productCodes
    const custNameByPn = new Map<string, string>();
    for (const pc of productCodes) {
      if (isRealName(pc.customer) && pc.customerPn) {
        custNameByPn.set(normalizePn(pc.customerPn), pc.customer);
      }
    }
    // Also from refInfo
    for (const ri of refInfo) {
      if (isRealName(ri.customerName) && ri.customerPn) {
        const key = normalizePn(ri.customerPn);
        if (!custNameByPn.has(key)) custNameByPn.set(key, ri.customerName);
      }
    }

    for (const norm of rootPnSet) {
      const original = rootPnOriginal.get(norm) || '';
      const pc = pcMap.get(norm);
      const ri = refInfoMap.get(norm);

      let matchedPc = pc;
      if (!matchedPc && ri?.customerPn) {
        matchedPc = pcMap.get(normalizePn(ri.customerPn));
      }

      // 고객사명: 코드/품번이 아닌 실제 이름만 사용
      let customerName = '';
      if (matchedPc?.customer && isRealName(matchedPc.customer)) {
        customerName = matchedPc.customer;
      }
      if (!customerName && ri?.customerName && isRealName(ri.customerName)) {
        customerName = ri.customerName;
      }
      if (!customerName && ri?.customerPn) {
        customerName = custNameByPn.get(normalizePn(ri.customerPn)) || '';
      }
      if (!customerName && matchedPc?.customerPn) {
        customerName = custNameByPn.get(normalizePn(matchedPc.customerPn)) || '';
      }

      // 판매가: revenue data or std cost total
      const sellingPrice = revenueMap.get(norm)
        || (matchedPc?.customerPn ? revenueMap.get(normalizePn(matchedPc.customerPn)) : 0)
        || 0;

      // 계획수량 & 예상매출
      const planQty = planQtyMap.get(norm)
        || (matchedPc?.customerPn ? planQtyMap.get(normalizePn(matchedPc.customerPn)) : 0)
        || 0;
      const expectedRevenue = expectedRevenueMap.get(norm)
        || (matchedPc?.customerPn ? expectedRevenueMap.get(normalizePn(matchedPc.customerPn)) : 0)
        || 0;

      // 재료비: BOM 트리 walk 합산 (개별 부품 단가 합계)
      const materialCost = calcRootMaterialCost(original);
      // 재료비율 = (계획수량 × 개당재료비) / 예상매출 × 100
      const materialTotal = planQty * materialCost;
      const materialRatio = expectedRevenue > 0 ? (materialTotal / expectedRevenue) * 100 : 0;

      roots.push({
        pn: original,
        name: matchedPc?.productName || ri?.itemName || '',
        customer: customerName,
        model: matchedPc?.model || ri?.variety || '',
        childCount: forwardMap.get(norm)?.length || 0,
        sellingPrice,
        planQty,
        expectedRevenue,
        materialCost,
        materialRatio,
      });
    }

    roots.sort((a, b) => a.pn.localeCompare(b.pn));
    return roots;
  }, [bomRecords, productCodes, refInfoMap, forwardMap, stdCosts, revenueMap, planQtyMap, expectedRevenueMap, calcRootMaterialCost]);

  // --- Unique Filter Values ---
  const { customers, models } = useMemo(() => {
    const custSet = new Set<string>();
    const modelSet = new Set<string>();
    for (const p of rootProducts) {
      if (p.customer) custSet.add(p.customer);
      if (p.model) modelSet.add(p.model);
    }
    return { customers: Array.from(custSet).sort(), models: Array.from(modelSet).sort() };
  }, [rootProducts]);

  const filteredModels = useMemo(() => {
    if (!filterCustomer) return models;
    const modelSet = new Set<string>();
    for (const p of rootProducts) {
      if (p.customer === filterCustomer && p.model) modelSet.add(p.model);
    }
    return Array.from(modelSet).sort();
  }, [filterCustomer, rootProducts, models]);

  const filteredProducts = useMemo(() => {
    let list = rootProducts;
    // 월 선택 시: 월별 데이터(forecast/stdCost)가 있을 때만 매출/수량 필터 적용
    // 월별 데이터가 없으면 전체 표시 (다른 PC에서 forecastData 없는 경우 대응)
    const hasMonthlyData = forecastData.length > 0 || stdCosts.length > 0;
    if (selectedMonth > 0 && hasMonthlyData) {
      list = list.filter(p => p.expectedRevenue > 0 || p.planQty > 0);
    }
    if (filterCustomer) list = list.filter(p => p.customer === filterCustomer);
    if (filterModel) list = list.filter(p => p.model === filterModel);
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(p => p.pn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      const key = sortKey;
      const va = a[key];
      const vb = b[key];
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rootProducts, filterCustomer, filterModel, searchText, sortKey, sortDir, selectedMonth, forecastData, stdCosts]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return key; }
      setSortDir('asc');
      return key;
    });
  }, []);

  const progressStats = useMemo(() => {
    const total = filteredProducts.length;
    const completed = filteredProducts.filter(p => isAllChecked(reviewStatus[p.pn])).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pct };
  }, [filteredProducts, reviewStatus]);

  // --- Handlers ---
  const handleReviewToggle = useCallback((pn: string, dept: keyof ReviewStatus) => {
    setReviewStatus(prev => {
      const current = prev[pn] || { production: false, development: false, sales: false, purchase: false };
      const updated = { ...prev, [pn]: { ...current, [dept]: !current[dept] } };
      saveReviewStatus(updated);
      return updated;
    });
  }, []);

  const toggleCollapse = useCallback((nodeKey: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const startEdit = useCallback((parentPn: string, childPn: string, field: EditCell['field'], nodeKey: string, currentValue: string) => {
    setEditCell({ parentPn, childPn, field, nodeKey });
    setEditValue(currentValue);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditCell(null);
    setEditValue('');
  }, []);

  const savingRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (!editCell || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    // 편집 정보를 로컬에 캡처 (cancelEdit 전에)
    const { parentPn, childPn, field, nodeKey } = editCell;
    const val = editValue;

    const updates: Partial<{ childName: string; partType: string; supplier: string; qty: number }> = {};
    if (field === 'qty') {
      const num = parseFloat(val);
      if (isNaN(num) || num < 0) { cancelEdit(); setSaving(false); savingRef.current = false; return; }
      updates.qty = num;
    } else {
      (updates as Record<string, string>)[field] = val;
    }

    // 먼저 editCell 해제 (UI 즉시 반영)
    cancelEdit();

    const ok = await bomMasterService.updateRecord(parentPn, childPn, updates);
    if (ok) {
      setBomRecords(prev => prev.map(r =>
        normalizePn(r.parentPn) === normalizePn(parentPn) && normalizePn(r.childPn) === normalizePn(childPn) ? { ...r, ...updates } : r,
      ));
      const key = nodeKey + ':' + field;
      setRecentlySaved(prev => new Set(prev).add(key));
      setTimeout(() => setRecentlySaved(prev => { const n = new Set(prev); n.delete(key); return n; }), 1500);
    }
    setSaving(false);
    savingRef.current = false;
  }, [editCell, editValue, cancelEdit]);

  useEffect(() => {
    if (editCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editCell]);

  useEffect(() => {
    if (editingPriceKey && priceInputRef.current) {
      priceInputRef.current.focus();
      priceInputRef.current.select();
    }
  }, [editingPriceKey]);

  const savingPriceRef = useRef(false);
  const handlePriceSave = useCallback(async (pn: string) => {
    if (savingPriceRef.current) return;
    const val = parseFloat(editPriceValue);
    if (isNaN(val) || val < 0) { setEditingPriceKey(''); return; }
    savingPriceRef.current = true;
    setSavingPrice(true);
    setEditingPriceKey('');

    try {
      const code = normalizePn(pn);
      const isMaterialCode = materialCodes.some(m => normalizePn(m.materialCode) === code);
      let ok: boolean;
      if (isMaterialCode) {
        ok = await materialCodeService.updatePrice(pn, val);
      } else {
        ok = await purchasePriceService.updatePrice(pn, val);
      }
      if (ok) {
        const [mc, pp] = await Promise.all([
          materialCodeService.getAll(),
          purchasePriceService.getAll(),
        ]);
        setMaterialCodes(mc);
        setPurchasePrices(pp);
      }
    } catch (e) {
      console.error('handlePriceSave error:', e);
    } finally {
      setSavingPrice(false);
      savingPriceRef.current = false;
    }
  }, [editPriceValue, materialCodes]);

  // --- Select node for detail panel ---
  const handleNodeSelect = useCallback((node: BomTreeNode, parentPn: string) => {
    setInjEdit(null); // 노드 변경 시 사출 편집 리셋
    setPaintEdit(null); // 도장 편집도 리셋
    setDetailEdit(null); // 상세 편집도 리셋
    const isVirtualPaint = /PAINT_/.test(node.pn);

    if (isVirtualPaint) {
      const realPn = node.pn.replace('PAINT_', '');
      const paint = getPaintInfo(realPn);
      setSelectedNodeInfo({
        pn: node.pn,
        name: node.name,
        partType: '도장',
        supplier: '',
        supplyType: '',
        unitQty: node.unitQty,
        price: paint?.costPerEa || 0,
        amount: node.qty * (paint?.costPerEa || 0),
        priceSource: '도장산출',
        paint: paint || undefined,
      });
      return;
    }

    const { price, source } = getNodePrice(node.pn);
    // 사출 산출근거: 자신 → 부모 fallback → 사출유형이면 빈 데이터라도 생성
    let injection = getInjectionDetail(node.pn);
    if (!injection && parentPn) {
      injection = getInjectionDetail(parentPn);
    }
    // 사출 유형인데 injection이 없으면 refInfo에서 최대한 뽑아서 빈 템플릿 생성
    const effectiveType = node.partType || node.processType || '';
    if (!injection && /사출/.test(effectiveType)) {
      const code = normalizePn(node.pn);
      const parentCode = parentPn ? normalizePn(parentPn) : '';
      const ri = refInfoMap.get(code) || (parentCode ? refInfoMap.get(parentCode) : undefined);
      const { matPriceMap, matNameMap } = priceData;
      const rawCode = ri?.rawMaterialCode1 || '';
      const rawNorm = rawCode ? normalizePn(rawCode) : '';
      const matPrice = rawNorm ? (matPriceMap.get(rawNorm) || 0) : 0;
      const net = ri?.netWeight || 0;
      const runner = ri?.runnerWeight || 0;
      const cav = (ri?.cavity && ri.cavity > 0) ? ri.cavity : 1;
      const loss = ri?.lossRate || 0;
      const wpe = net + runner / cav;
      const cost = matPrice > 0 && net > 0 ? (wpe * matPrice / 1000) * (1 + loss / 100) : 0;
      injection = {
        rawMaterialCode: rawCode || '(미등록)',
        rawMaterialName: rawNorm ? (matNameMap.get(rawNorm) || rawCode) : '(미등록)',
        materialPrice: matPrice,
        netWeight: net,
        runnerWeight: runner,
        cavity: cav,
        lossRate: loss,
        weightPerEa: wpe,
        calculatedCost: cost,
      };
    }
    const paint = getPaintInfo(node.pn);
    const ri = refInfoMap.get(normalizePn(node.pn));
    setSelectedNodeInfo({
      pn: node.pn,
      name: node.name,
      partType: effectiveType,
      supplier: node.supplier,
      supplyType: ri?.supplyType || node.supplyType || '',
      unitQty: node.unitQty,
      price,
      amount: node.qty * price,
      priceSource: source,
      injection: injection || undefined,
      paint: paint || undefined,
    });
  }, [getNodePrice, getInjectionDetail, getPaintInfo, refInfoMap, priceData]);

  // --- Render: BOM Tree Rows ---
  const renderTreeRows = (
    node: BomTreeNode,
    parentPn: string,
    parentKey = '',
    siblingIdx = 0,
  ): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    const nodeKey = `${parentKey}/${node.pn}-${node.level}:${siblingIdx}`;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes.has(nodeKey);
    const isVirtualPaint = /PAINT_/.test(node.pn);

    if (node.level > 0) {
      const isEditing = (field: EditCell['field']) =>
        editCell?.nodeKey === nodeKey && editCell?.field === field;
      const savedKey = (field: string) => nodeKey + ':' + field;

      // Price for this node
      let nodePrice = 0;
      let nodePriceSource = '';
      if (isVirtualPaint) {
        const realPn = node.pn.replace('PAINT_', '');
        const paint = getPaintInfo(realPn);
        nodePrice = paint?.costPerEa || 0;
        nodePriceSource = '도장';
      } else {
        const p = getNodePrice(node.pn);
        nodePrice = p.price;
        nodePriceSource = p.source;
      }

      const nodeAmount = node.qty * nodePrice;
      const effectiveType = node.partType || node.processType || node.supplyType || '';
      const badge = typeBadge(isVirtualPaint ? '도장' : effectiveType);
      // 구입처 표시: refInfoMap에서 최신 supplyType 직접 조회 (트리 rebuild 의존 X)
      const nodeRef = isVirtualPaint ? undefined : refInfoMap.get(normalizePn(node.pn));
      const displaySupplier = nodeRef?.supplyType || node.supplyType || node.supplier || '';

      const renderEditableCell = (
        field: EditCell['field'],
        value: string,
        className: string,
        displayValue?: string,
      ) => {
        if (isVirtualPaint) {
          return <td className={`px-2 py-1.5 ${className}`}>{displayValue ?? value}</td>;
        }
        if (isEditing(field)) {
          return (
            <td className={`px-2 py-1.5 ${className}`}>
              <input
                ref={editInputRef}
                type={field === 'qty' ? 'number' : 'text'}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancelEdit(); }}
                onBlur={handleSave}
                className="w-full px-1.5 py-0.5 border border-indigo-300 rounded text-xs outline-none focus:ring-1 focus:ring-indigo-400"
                disabled={saving}
              />
            </td>
          );
        }
        return (
          <td
            className={`px-2 py-1.5 cursor-pointer hover:bg-indigo-50 transition-colors ${className} ${
              recentlySaved.has(savedKey(field)) ? 'bg-amber-50' : ''
            }`}
            onClick={() => startEdit(parentPn, node.pn, field, nodeKey, value)}
            title="클릭하여 수정"
          >
            {displayValue ?? value}
          </td>
        );
      };

      rows.push(
        <tr
          key={nodeKey}
          className={`transition-colors border-b border-slate-100 ${
            isVirtualPaint ? 'bg-violet-50/40' : 'hover:bg-slate-50/80'
          } ${selectedNodeInfo?.pn === node.pn ? 'ring-1 ring-inset ring-indigo-300 bg-indigo-50/50' : ''}`}
          onClick={() => handleNodeSelect(node, parentPn)}
        >
          {/* Level */}
          <td className="px-2 py-1.5 text-center text-slate-400 text-[10px] font-mono w-10">
            Lv{node.level}
          </td>
          {/* Part No */}
          <td className="py-1.5 pr-2" style={{ paddingLeft: `${8 + node.level * 16}px` }}>
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  onClick={e => { e.stopPropagation(); toggleCollapse(nodeKey); }}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                >
                  <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${isVirtualPaint ? 'bg-violet-400' : 'bg-slate-300'}`} />
                </span>
              )}
              <span className={`font-mono text-xs font-bold truncate ${isVirtualPaint ? 'text-violet-600' : 'text-indigo-600'}`}>
                {isVirtualPaint ? node.pn.replace('PAINT_', '🎨 ') : node.pn}
              </span>
            </div>
          </td>
          {/* Name */}
          {renderEditableCell('childName', node.name, 'text-xs text-slate-700 max-w-[180px] truncate')}
          {/* Type badge */}
          <td className="px-2 py-1.5 w-14">
            {badge && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </td>
          {/* Supplier (supplyType 우선 표시) */}
          {renderEditableCell('supplier', node.supplier, 'text-xs text-slate-500 w-16 truncate', displaySupplier)}
          {/* Qty (editable) — unitQty = BOM 단위소요량 */}
          {renderEditableCell(
            'qty',
            String(node.unitQty),
            'text-xs text-right font-mono text-slate-600 w-14',
            Number.isInteger(node.unitQty) ? String(node.unitQty) : node.unitQty.toFixed(4),
          )}
          {/* 단가 (editable) */}
          {(() => {
            const isPriceEditing = editingPriceKey === nodeKey;
            return (
              <td className="px-2 py-1.5 text-right text-xs font-mono w-24">
                {isVirtualPaint ? (
                  <span className="text-purple-600">{nodePrice > 0 ? fmtWon(nodePrice) : '—'}</span>
                ) : isPriceEditing ? (
                  <input
                    ref={priceInputRef}
                    type="number"
                    value={editPriceValue}
                    onChange={(e) => setEditPriceValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handlePriceSave(node.pn);
                      if (e.key === 'Escape') setEditingPriceKey('');
                    }}
                    onBlur={() => handlePriceSave(node.pn)}
                    className="w-20 px-1 py-0.5 border border-indigo-300 rounded text-right text-xs outline-none focus:ring-1 focus:ring-indigo-400"
                    disabled={savingPrice}
                  />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPriceKey(nodeKey);
                      setEditPriceValue(nodePrice > 0 ? String(Math.round(nodePrice)) : '');
                    }}
                    className={`cursor-pointer hover:bg-indigo-50 px-1 py-0.5 rounded transition-colors w-full text-right ${
                      nodePrice > 0 ? 'text-slate-700' : 'text-slate-300'
                    }`}
                    title={nodePriceSource ? `출처: ${nodePriceSource} — 클릭하여 수정` : '클릭하여 단가 입력'}
                  >
                    {nodePrice > 0 ? fmtWon(nodePrice) : '—'}
                    {nodePriceSource && <span className="ml-0.5 text-[9px] text-slate-400">{nodePriceSource}</span>}
                  </button>
                )}
              </td>
            );
          })()}
          {/* 금액 */}
          <td className={`px-2 py-1.5 text-right text-xs font-mono font-bold w-20 ${
            nodeAmount > 0 ? 'text-slate-800' : 'text-slate-300'
          }`}>
            {nodeAmount > 0 ? fmtWon(nodeAmount) : '—'}
          </td>
          {/* 표준재료비 */}
          {(() => {
            const code = normalizePn(node.pn);
            const stdPrice = priceData.stdMap.get(code) || 0;
            const diff = nodePrice > 0 && stdPrice > 0 ? nodePrice - stdPrice : 0;
            const diffPct = stdPrice > 0 && nodePrice > 0 ? ((nodePrice - stdPrice) / stdPrice) * 100 : 0;
            const hasDiff = Math.abs(diff) > 1 && stdPrice > 0 && nodePrice > 0;
            const justSynced = syncedPns.has(code);
            return (
              <>
                <td className="px-2 py-1.5 text-right text-xs font-mono w-20 text-orange-600">
                  {stdPrice > 0 ? fmtWon(stdPrice) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-1 py-1.5 text-center text-xs w-20">
                  {justSynced ? (
                    <span className="text-emerald-600 font-bold text-[10px]">반영됨</span>
                  ) : hasDiff ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSyncNodeToStd(node.pn, nodePrice); }}
                      disabled={syncingStd}
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        diff > 0
                          ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                      }`}
                      title={`BOM단가(${fmtWon(nodePrice)})→표준 반영`}
                    >
                      {diff > 0 ? '△' : '▽'}{Math.abs(diffPct).toFixed(0)}%
                      <span className="text-[8px]">→반영</span>
                    </button>
                  ) : stdPrice > 0 && nodePrice > 0 ? (
                    <span className="text-emerald-500 text-[10px] font-bold">일치</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </>
            );
          })()}
        </tr>,
      );
    }

    if (hasChildren && !isCollapsed) {
      for (let ci = 0; ci < node.children.length; ci++) {
        rows.push(...renderTreeRows(node.children[ci], node.pn, nodeKey, ci));
      }
    }

    return rows;
  };

  // --- Sync BOM price → 표준재료비 ---
  const [syncMsg, setSyncMsg] = useState('');
  const handleSyncBomToStd = useCallback(async () => {
    if (syncingStd || !selectedProduct || bomTotal <= 0) return;
    setSyncingStd(true);
    setSyncMsg('');
    try {
      const ok = await itemStandardCostService.updateMaterialCostPerEa(selectedProduct, bomTotal);
      if (ok) {
        const updated = await itemStandardCostService.getAll();
        setStdCosts(updated);
        setSyncedPns(prev => new Set(prev).add(normalizePn(selectedProduct)));
        setSyncMsg(`✓ 표준재료비 ${Math.round(bomTotal).toLocaleString()}원 반영 완료`);
        setTimeout(() => setSyncMsg(''), 3000);
      }
    } catch (e) {
      console.error('BOM→표준 반영 오류:', e);
    } finally {
      setSyncingStd(false);
    }
  }, [syncingStd, selectedProduct, bomTotal]);

  /** 개별 부품 BOM단가 → 표준재료비 반영 */
  const handleSyncNodeToStd = useCallback(async (pn: string, bomPrice: number) => {
    if (syncingStd || bomPrice <= 0) return;
    setSyncingStd(true);
    try {
      const ok = await itemStandardCostService.updateMaterialCostPerEa(pn, bomPrice);
      if (ok) {
        const updated = await itemStandardCostService.getAll();
        setStdCosts(updated);
        setSyncedPns(prev => new Set(prev).add(normalizePn(pn)));
      }
    } catch (e) {
      console.error('개별 부품 표준 반영 오류:', e);
    } finally {
      setSyncingStd(false);
    }
  }, [syncingStd]);

  // --- Progress Bar Color ---
  const progressColor = progressStats.pct >= 80 ? 'bg-emerald-500' : progressStats.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  const costDiff = bomTotal - stdTotal;

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">BOM 데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  if (bomRecords.length === 0) {
    return (
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center">
        <p className="text-slate-500 mb-2">BOM 마스터 데이터가 없습니다.</p>
        <p className="text-xs text-slate-400">BOM 마스터 탭에서 먼저 데이터를 업로드해주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              BOM 관리
            </h2>
            <p className="text-xs text-slate-500 mt-1">셀 클릭 → 수정 → Enter 저장 (마스터 자동 업데이트). 행 클릭 시 상세 산출근거 표시.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              BOM: {bomRecords.length.toLocaleString()}행 | Level-0: {rootProducts.length}개
            </span>
            <button
              onClick={() => setShowPaintAnalysis(true)}
              className="px-3 py-1.5 bg-purple-100 text-purple-700 text-xs font-bold rounded-lg hover:bg-purple-200 transition-colors"
            >
              도장 분석
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-bold text-slate-600">고객사</label>
            <select value={filterCustomer} onChange={e => { setFilterCustomer(e.target.value); setFilterModel(''); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">전체</option>
              {customers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-bold text-slate-600">차종</label>
            <select value={filterModel} onChange={e => setFilterModel(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">전체</option>
              {filteredModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-bold text-slate-600">월</label>
            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value={0}>연간</option>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5 flex-1 max-w-xs">
            <label className="text-xs font-bold text-slate-600">검색</label>
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="품번/품명 검색..."
              className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
        </div>

        {/* Progress */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs font-bold text-slate-600 whitespace-nowrap">확인 진척율</span>
          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${progressColor}`} style={{ width: `${progressStats.pct}%` }} />
          </div>
          <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{progressStats.completed}/{progressStats.total} ({progressStats.pct}%)</span>
        </div>
      </div>

      {/* Product List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
            <span className="w-1 h-4 bg-indigo-600 rounded-full" />
            Level-0 제품 목록 <span className="text-xs font-normal text-slate-400 ml-1">({filteredProducts.length}개)</span>
          </h3>
          <button onClick={() => setProductListCollapsed(v => !v)}
            className="text-xs font-bold text-slate-500 hover:text-indigo-600 px-2 py-1 rounded transition-colors">
            {productListCollapsed ? '펼치기 ▼' : '접기 ▲'}
          </button>
        </div>
        {!productListCollapsed && (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="border-b border-slate-200">
                {([
                  { key: 'pn' as SortKey, label: '품번', align: 'text-left', w: 'w-32' },
                  { key: 'name' as SortKey, label: '품명', align: 'text-left', w: '' },
                  { key: 'customer' as SortKey, label: '고객사', align: 'text-left', w: 'w-20' },
                  { key: 'model' as SortKey, label: '차종', align: 'text-left', w: 'w-16' },
                  { key: 'sellingPrice' as SortKey, label: '판매가', align: 'text-right', w: 'w-20' },
                  { key: 'planQty' as SortKey, label: '계획수량', align: 'text-right', w: 'w-20' },
                  { key: 'expectedRevenue' as SortKey, label: '예상매출', align: 'text-right', w: 'w-24' },
                  { key: 'materialCost' as SortKey, label: '재료비합계', align: 'text-right', w: 'w-24' },
                  { key: 'materialRatio' as SortKey, label: '재료비율', align: 'text-right', w: 'w-16' },
                ]).map(col => (
                  <th key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`${col.align} px-3 py-2.5 font-bold text-slate-600 ${col.w} cursor-pointer hover:bg-slate-100 select-none`}>
                    {col.label}
                    {sortKey === col.key && <span className="ml-0.5 text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
                {DEPARTMENTS.map(d => (
                  <th key={d.key} className="text-center px-1 py-2.5 font-bold text-slate-600 w-12">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr><td colSpan={9 + DEPARTMENTS.length} className="py-12 text-center text-slate-400">조건에 맞는 제품이 없습니다.</td></tr>
              ) : (
                filteredProducts.map(p => {
                  const status = reviewStatus[p.pn];
                  const allDone = isAllChecked(status);
                  const isSelected = selectedProduct === p.pn;
                  const ratioColor = p.materialRatio > 70 ? 'text-rose-600' : p.materialRatio > 50 ? 'text-amber-600' : 'text-emerald-600';

                  return (
                    <tr key={p.pn}
                      onClick={() => { setSelectedProduct(prev => prev === p.pn ? '' : p.pn); setCollapsedNodes(new Set()); setSelectedNodeInfo(null); cancelEdit(); }}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-50'} ${allDone ? 'text-blue-600 font-semibold' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono font-bold">{p.pn}</td>
                      <td className="px-3 py-2 truncate max-w-[180px]" title={p.name}>{p.name}</td>
                      <td className="px-3 py-2">{p.customer}</td>
                      <td className="px-3 py-2">{p.model}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.sellingPrice > 0 ? fmtWon(p.sellingPrice) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.planQty > 0 ? p.planQty.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.expectedRevenue > 0 ? fmtWon(p.expectedRevenue) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{p.planQty > 0 && p.materialCost > 0 ? fmtWon(p.planQty * p.materialCost) : p.materialCost > 0 ? fmtWon(p.materialCost) : '—'}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${ratioColor}`}>
                        {p.materialRatio > 0 ? `${p.materialRatio.toFixed(1)}%` : '—'}
                      </td>
                      {DEPARTMENTS.map(d => (
                        <td key={d.key} className="px-1 py-2 text-center">
                          <input type="checkbox" checked={status?.[d.key] ?? false}
                            onChange={e => { e.stopPropagation(); handleReviewToggle(p.pn, d.key); }}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredProducts.length > 0 && (() => {
              const withSelling = filteredProducts.filter(p => p.sellingPrice > 0);
              const avgSelling = withSelling.length > 0 ? withSelling.reduce((s, p) => s + p.sellingPrice, 0) / withSelling.length : 0;
              const sumPlanQty = filteredProducts.reduce((s, p) => s + p.planQty, 0);
              const sumExpRevenue = filteredProducts.reduce((s, p) => s + p.expectedRevenue, 0);
              const sumMaterialTotal = filteredProducts.reduce((s, p) => s + (p.expectedRevenue > 0 ? p.planQty * p.materialCost : 0), 0);
              const avgRatio = sumExpRevenue > 0 ? (sumMaterialTotal / sumExpRevenue) * 100 : 0;
              const ratioColor = avgRatio > 70 ? 'text-rose-600' : avgRatio > 50 ? 'text-amber-600' : 'text-emerald-600';
              return (
                <tfoot className="bg-slate-100 border-t-2 border-slate-300 sticky bottom-0">
                  <tr>
                    <td className="px-3 py-2 font-black text-slate-700" colSpan={2}>합계 ({filteredProducts.length}개)</td>
                    <td className="px-3 py-2" colSpan={2} />
                    <td className="px-3 py-2 text-right font-mono font-black text-slate-800">{avgSelling > 0 ? `${fmtWon(avgSelling)} avg` : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-black text-slate-800">{sumPlanQty > 0 ? sumPlanQty.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-black text-slate-800">{sumExpRevenue > 0 ? fmtWon(sumExpRevenue) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-black text-slate-800">{sumMaterialTotal > 0 ? fmtWon(sumMaterialTotal) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono font-black ${ratioColor}`}>{avgRatio > 0 ? `${avgRatio.toFixed(1)}%` : '—'}</td>
                    {DEPARTMENTS.map(d => <td key={d.key} className="px-1 py-2" />)}
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
        )}
      </div>

      {/* BOM Tree + Detail Panel */}
      {selectedProduct && enrichedTree && (
        <div className="flex gap-4">
          {/* Left: BOM Tree */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                <span className="w-1 h-4 bg-emerald-500 rounded-full" />
                BOM 트리: <span className="text-indigo-600 font-mono">{selectedProduct}</span>
                {enrichedTree.name && <span className="text-slate-500 font-normal ml-1">{enrichedTree.name}</span>}
              </h3>
              {/* BOM vs Std cost warning */}
              {stdTotal > 0 && bomTotal > 0 && Math.abs(costDiff) > 1 && (
                <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
                  costDiff > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  BOM({fmtWon(bomTotal)}) {costDiff > 0 ? '>' : '<'} 표준({fmtWon(stdTotal)}) — {costDiff > 0 ? '△' : '▽'}{fmtWon(Math.abs(costDiff))}
                </span>
              )}
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs" style={{ minWidth: 920 }}>
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-center font-bold text-slate-500 w-10">Lv</th>
                    <th className="px-2 py-2 text-left font-bold text-slate-500 w-40">품번 (Part No)</th>
                    <th className="px-2 py-2 text-left font-bold text-slate-500">품명</th>
                    <th className="px-2 py-2 text-center font-bold text-slate-500 w-14">유형</th>
                    <th className="px-2 py-2 text-left font-bold text-slate-500 w-16">구입처</th>
                    <th className="px-2 py-2 text-right font-bold text-slate-500 w-14">소요량</th>
                    <th className="px-2 py-2 text-right font-bold text-slate-500 w-20">단가</th>
                    <th className="px-2 py-2 text-right font-bold text-slate-500 w-20">금액</th>
                    <th className="px-2 py-2 text-right font-bold text-orange-500 w-20">표준</th>
                    <th className="px-2 py-2 text-center font-bold text-slate-500 w-20">차이</th>
                  </tr>
                </thead>
                <tbody>
                  {renderTreeRows(enrichedTree, '', '', 0)}
                  {enrichedTree.children.length === 0 && (
                    <tr><td colSpan={10} className="py-8 text-center text-slate-400">하위 BOM이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* BOM Total */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-6 text-xs">
                <span className="font-bold text-slate-600">BOM 전개 소계</span>
                <span className="font-black text-lg text-slate-800">{fmtWon(bomTotal)}</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="font-bold text-orange-600">표준재료비</span>
                <span className="font-black text-lg text-orange-700">{stdTotal > 0 ? fmtWon(stdTotal) : '—'}</span>
                {bomTotal > 0 && Math.abs(costDiff) > 1 && stdTotal > 0 && (
                  <span className={`font-bold px-2 py-0.5 rounded ${costDiff > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {costDiff > 0 ? '△' : '▽'}{fmtWon(Math.abs(costDiff))} ({((costDiff / stdTotal) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
              {bomTotal > 0 && (
                <button
                  onClick={handleSyncBomToStd}
                  disabled={syncingStd}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    syncingStd
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                  }`}
                >
                  {syncingStd ? '반영 중...' : syncMsg || 'BOM소계 → 표준재료비 반영'}
                </button>
              )}
            </div>

            {/* Warning bar */}
            {stdTotal > 0 && bomTotal > 0 && costDiff > 0 && (
              <div className="px-5 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 font-bold">
                표준재료비({fmtWon(stdTotal)}) &lt; BOM 소계({fmtWon(bomTotal)}) — 표준재료비 재검토 필요 △{fmtWon(costDiff)}
              </div>
            )}
          </div>

          {/* Right: Detail Panel */}
          <div className="w-80 flex-shrink-0">
            {selectedNodeInfo ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-20 space-y-4">
                {/* Cost diff indicator */}
                {stdTotal > 0 && bomTotal > 0 && Math.abs(costDiff) > 1 && (
                  <div className={`text-xs font-bold px-3 py-2 rounded-lg ${
                    costDiff > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {costDiff > 0 ? '🟡' : '🟢'} BOM({fmtWon(bomTotal)}) ≠ 표준({fmtWon(stdTotal)}) — △{fmtWon(Math.abs(costDiff))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-700">선택 자재 상세</h4>
                  {detailEdit === null ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailEdit({
                          price: String(Math.round(selectedNodeInfo.price)),
                          unitQty: String(selectedNodeInfo.unitQty),
                          supplyType: selectedNodeInfo.supplyType || '',
                          supplier: selectedNodeInfo.supplier || '',
                        });
                      }}
                      className="text-[11px] text-white bg-slate-600 hover:bg-slate-700 font-bold px-3 py-1 rounded-lg transition-colors cursor-pointer"
                    >
                      수정
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDetailEdit(null); }}
                        className="text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold px-3 py-1 rounded-lg transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (savingDetail || !detailEdit) return;
                          setSavingDetail(true);
                          const newPrice = parseFloat(detailEdit.price) || 0;
                          const newQty = parseFloat(detailEdit.unitQty) || 0;
                          const pn = selectedNodeInfo.pn;
                          try {
                            // 단가 변경 → 트리 실제 가격과 비교 (selectedNodeInfo는 stale 가능)
                            const treeInfo = getNodePrice(pn);
                            if (Math.abs(newPrice - treeInfo.price) > 0.01) {
                              const src = treeInfo.source;
                              if (src === '구매' || src === '외주') {
                                await purchasePriceService.updatePrice(pn, newPrice);
                              } else if (src === '재질') {
                                const ri = refInfoMap.get(normalizePn(pn));
                                const rawCode = ri?.rawMaterialCode1 || pn;
                                await materialCodeService.updatePrice(rawCode, newPrice);
                              } else {
                                // 소스 없음/표준/사출 등 → 구매단가에 저장하여 트리에 반영
                                await purchasePriceService.updatePrice(pn, newPrice);
                              }
                              // 표준재료비도 항상 동기화
                              await itemStandardCostService.updateMaterialCostPerEa(pn, newPrice);
                              // 모든 가격 데이터 reload
                              const [sc, pp, mc] = await Promise.all([
                                itemStandardCostService.getAll(),
                                purchasePriceService.getAll(),
                                materialCodeService.getAll(),
                              ]);
                              setStdCosts(sc);
                              setPurchasePrices(pp);
                              setMaterialCodes(mc);
                            }
                            // 소요량 변경 → bom_master 업데이트 (현재 선택된 제품 기준)
                            if (Math.abs(newQty - selectedNodeInfo.unitQty) > 0.0001 && selectedProduct) {
                              await bomMasterService.updateQty(selectedProduct, pn, newQty);
                              const bom = await bomMasterService.getAll();
                              setBomRecords(bom);
                            }
                            // 구입유형(supplyType) 변경 → reference_info_master 업데이트
                            const newSupply = detailEdit.supplyType;
                            const oldSupply = selectedNodeInfo.supplyType || '';
                            const newSupplier = detailEdit.supplier.trim();
                            const oldSupplier = selectedNodeInfo.supplier || '';
                            const refUpdates: Parameters<typeof referenceInfoService.updateFields>[1] = {};
                            if (newSupply !== oldSupply) refUpdates.supplyType = newSupply;
                            if (newSupplier !== oldSupplier) refUpdates.supplier = newSupplier;
                            if (Object.keys(refUpdates).length > 0) {
                              await referenceInfoService.updateFields(pn, refUpdates);
                              const ri = await referenceInfoService.getAll();
                              setRefInfo(ri);
                            }
                            setDetailEdit(null);
                            setSelectedNodeInfo(prev => {
                              if (!prev) return prev;
                              const updated = {
                                ...prev,
                                price: newPrice,
                                unitQty: newQty,
                                amount: newQty * newPrice,
                                supplyType: newSupply,
                                supplier: newSupplier,
                              };
                              // 자작으로 변경 시 사출 산출근거 템플릿 생성
                              if (newSupply === '자작' && !prev.injection) {
                                const code = normalizePn(pn);
                                const ri = refInfoMap.get(code);
                                const { matPriceMap, matNameMap } = priceData;
                                const rawCode = ri?.rawMaterialCode1 || '';
                                const rawNorm = rawCode ? normalizePn(rawCode) : '';
                                const matPrice = rawNorm ? (matPriceMap.get(rawNorm) || 0) : 0;
                                updated.injection = {
                                  rawMaterialCode: rawCode || '(미등록)',
                                  rawMaterialName: rawNorm ? (matNameMap.get(rawNorm) || rawCode) : '(미등록)',
                                  materialPrice: matPrice,
                                  netWeight: ri?.netWeight || 0,
                                  runnerWeight: ri?.runnerWeight || 0,
                                  cavity: (ri?.cavity && ri.cavity > 0) ? ri.cavity : 1,
                                  lossRate: ri?.lossRate || 0,
                                  weightPerEa: 0,
                                  calculatedCost: 0,
                                };
                              }
                              return updated;
                            });
                          } catch (err) {
                            console.error('상세 저장 오류:', err);
                          } finally {
                            setSavingDetail(false);
                          }
                        }}
                        disabled={savingDetail}
                        className="text-[11px] text-white bg-slate-600 hover:bg-slate-700 font-bold px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {savingDetail ? '저장중...' : '저장'}
                      </button>
                    </div>
                  )}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {/* 읽기 전용 필드 */}
                    {[
                      ['품번', selectedNodeInfo.pn],
                      ['품명', selectedNodeInfo.name],
                      ['유형', selectedNodeInfo.partType],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">{label}</td>
                        <td className="py-1.5 text-right font-mono text-slate-800">{value}</td>
                      </tr>
                    ))}
                    {/* 구입유형 — 편집 가능 (자작/구매/외주) */}
                    <tr className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">구입유형</td>
                      <td className="py-1.5 text-right font-mono text-slate-800">
                        {detailEdit !== null ? (
                          <select
                            value={detailEdit.supplyType}
                            onChange={e => {
                              const val = e.target.value;
                              setDetailEdit(prev => prev ? { ...prev, supplyType: val } : prev);
                              // 자작 선택 시 사출 편집 자동 시작 (injection이 없을 때)
                              if (val === '자작' && !selectedNodeInfo.injection && injEdit === null) {
                                const code = normalizePn(selectedNodeInfo.pn);
                                const ri = refInfoMap.get(code);
                                const { matPriceMap } = priceData;
                                const rawCode = ri?.rawMaterialCode1 || '';
                                const rawNorm = rawCode ? normalizePn(rawCode) : '';
                                const matPrice = rawNorm ? (matPriceMap.get(rawNorm) || 0) : 0;
                                setInjEdit({
                                  materialPrice: String(Math.round(matPrice)),
                                  netWeight: String(ri?.netWeight || 0),
                                  runnerWeight: String(ri?.runnerWeight || 0),
                                  cavity: String((ri?.cavity && ri.cavity > 0) ? ri.cavity : 1),
                                  lossRate: String(ri?.lossRate || 0),
                                });
                              } else if (val !== '자작') {
                                setInjEdit(null);
                              }
                            }}
                            onClick={e => e.stopPropagation()}
                            className="w-24 px-1 py-0.5 border-2 border-blue-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
                          >
                            <option value="">-</option>
                            <option value="자작">자작</option>
                            <option value="구매">구매</option>
                            <option value="외주">외주</option>
                          </select>
                        ) : (selectedNodeInfo.supplyType || '-')}
                      </td>
                    </tr>
                    {/* 구입처 — 편집 가능 (회사명 텍스트 입력) */}
                    <tr className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">구입처</td>
                      <td className="py-1.5 text-right font-mono text-slate-800">
                        {detailEdit !== null ? (
                          <input
                            type="text"
                            value={detailEdit.supplier}
                            onChange={e => setDetailEdit(prev => prev ? { ...prev, supplier: e.target.value } : prev)}
                            onClick={e => e.stopPropagation()}
                            placeholder="구입처 입력"
                            className="w-full px-2 py-0.5 border-2 border-blue-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        ) : (selectedNodeInfo.supplier || '-')}
                      </td>
                    </tr>
                    {/* 소요량 — 편집 가능 */}
                    <tr className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">소요량</td>
                      <td className="py-1.5 text-right font-mono text-slate-800">
                        {detailEdit !== null ? (
                          <input
                            type="number"
                            step="0.0001"
                            value={detailEdit.unitQty}
                            onChange={e => setDetailEdit(prev => prev ? { ...prev, unitQty: e.target.value } : prev)}
                            onClick={e => e.stopPropagation()}
                            className="w-24 px-2 py-0.5 border-2 border-blue-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        ) : (
                          Number.isInteger(selectedNodeInfo.unitQty) ? String(selectedNodeInfo.unitQty) : selectedNodeInfo.unitQty.toFixed(4)
                        )}
                      </td>
                    </tr>
                    {/* 단가 — 편집 가능 */}
                    <tr className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">단가</td>
                      <td className="py-1.5 text-right font-mono text-slate-800">
                        {detailEdit !== null ? (
                          <input
                            type="number"
                            step="1"
                            value={detailEdit.price}
                            onChange={e => setDetailEdit(prev => prev ? { ...prev, price: e.target.value } : prev)}
                            onClick={e => e.stopPropagation()}
                            className="w-24 px-2 py-0.5 border-2 border-blue-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        ) : fmtWon(selectedNodeInfo.price)}
                      </td>
                    </tr>
                    {/* 표준재료비 + 단가 적용 버튼 */}
                    {(() => {
                      const std = priceData.stdMap.get(normalizePn(selectedNodeInfo.pn)) || 0;
                      const editPrice = detailEdit ? parseFloat(detailEdit.price) || 0 : selectedNodeInfo.price;
                      const editQty = detailEdit ? parseFloat(detailEdit.unitQty) || 0 : selectedNodeInfo.unitQty;
                      return (
                        <>
                          <tr className="border-b border-slate-100">
                            <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">표준재료비</td>
                            <td className="py-1.5 text-right font-mono text-slate-800">
                              <span className="inline-flex items-center gap-1.5">
                                {std > 0 ? fmtWon(std) : '-'}
                                {std > 0 && Math.abs(std - selectedNodeInfo.price) > 0.5 && detailEdit === null && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const pn = selectedNodeInfo.pn;
                                      await itemStandardCostService.updateMaterialCostPerEa(pn, std);
                                      const sc = await itemStandardCostService.getAll();
                                      setStdCosts(sc);
                                      setSelectedNodeInfo(prev => prev ? {
                                        ...prev,
                                        price: std,
                                        amount: prev.unitQty * std,
                                        priceSource: '표준',
                                      } : prev);
                                    }}
                                    className="text-[10px] text-white bg-indigo-500 hover:bg-indigo-600 font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    단가적용
                                  </button>
                                )}
                              </span>
                            </td>
                          </tr>
                          {[
                            ['금액', fmtWon(editQty * editPrice)],
                            ['출처', selectedNodeInfo.priceSource || '-'],
                          ].map(([label, value]) => (
                            <tr key={label} className="border-b border-slate-100">
                              <td className="py-1.5 pr-3 font-bold text-slate-500 whitespace-nowrap">{label}</td>
                              <td className="py-1.5 text-right font-mono text-slate-800">{value}</td>
                            </tr>
                          ))}
                        </>
                      );
                    })()}
                  </tbody>
                </table>

                {/* 사출 산출근거 — 편집 가능 */}
                {(() => {
                  // 자작 선택 시 injection이 없으면 빈 템플릿 생성
                  let effectiveInj = selectedNodeInfo.injection;
                  if (!effectiveInj && detailEdit?.supplyType === '자작') {
                    const code = normalizePn(selectedNodeInfo.pn);
                    const ri = refInfoMap.get(code);
                    const { matPriceMap, matNameMap } = priceData;
                    const rawCode = ri?.rawMaterialCode1 || '';
                    const rawNorm = rawCode ? normalizePn(rawCode) : '';
                    const matPrice = rawNorm ? (matPriceMap.get(rawNorm) || 0) : 0;
                    effectiveInj = {
                      rawMaterialCode: rawCode || '(미등록)',
                      rawMaterialName: rawNorm ? (matNameMap.get(rawNorm) || rawCode) : '(미등록)',
                      materialPrice: matPrice,
                      netWeight: ri?.netWeight || 0,
                      runnerWeight: ri?.runnerWeight || 0,
                      cavity: (ri?.cavity && ri.cavity > 0) ? ri.cavity : 1,
                      lossRate: ri?.lossRate || 0,
                      weightPerEa: 0,
                      calculatedCost: 0,
                    };
                  }
                  if (!effectiveInj) return null;
                  // effectiveInj를 selectedNodeInfo.injection 대신 사용
                  const injData = effectiveInj;
                  return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-black text-emerald-700">사출 산출근거</h4>
                      {injEdit === null ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setInjEdit({
                              materialPrice: String(Math.round(injData.materialPrice)),
                              netWeight: String(injData.netWeight),
                              runnerWeight: String(injData.runnerWeight),
                              cavity: String(injData.cavity),
                              lossRate: String(injData.lossRate),
                            });
                          }}
                          className="text-[11px] text-white bg-emerald-600 hover:bg-emerald-700 font-bold px-3 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          수정
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setInjEdit(null); }}
                            className="text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold px-3 py-1 rounded-lg transition-colors"
                          >
                            취소
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (savingInj || !injEdit) return;
                              setSavingInj(true);
                              const nw = parseFloat(injEdit.netWeight) || 0;
                              const rw = parseFloat(injEdit.runnerWeight) || 0;
                              const cv = Math.max(1, parseInt(injEdit.cavity) || 1);
                              const lr = parseFloat(injEdit.lossRate) || 0;
                              const mp = parseFloat(injEdit.materialPrice) || 0;
                              const wpe = nw + rw / cv;
                              const cc = (wpe * mp / 1000) * (1 + lr / 100);
                              try {
                                await referenceInfoService.updateFields(selectedNodeInfo.pn, {
                                  netWeight: nw, runnerWeight: rw, cavity: cv, lossRate: lr,
                                });
                                await itemStandardCostService.updateResinCost(selectedNodeInfo.pn, cc);
                                const [ri, sc] = await Promise.all([
                                  referenceInfoService.getAll(),
                                  itemStandardCostService.getAll(),
                                ]);
                                setRefInfo(ri);
                                setStdCosts(sc);
                                setInjEdit(null);
                                setSelectedNodeInfo(prev => prev ? {
                                  ...prev,
                                  price: cc,
                                  amount: prev.unitQty * cc,
                                  priceSource: '사출',
                                  injection: { ...injData, materialPrice: mp, netWeight: nw, runnerWeight: rw, cavity: cv, lossRate: lr, weightPerEa: wpe, calculatedCost: cc },
                                } : prev);
                              } catch (err) {
                                console.error('사출 산출근거 저장 오류:', err);
                              } finally {
                                setSavingInj(false);
                              }
                            }}
                            disabled={savingInj}
                            className="text-[11px] text-white bg-emerald-600 hover:bg-emerald-700 font-bold px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {savingInj ? '저장중...' : '저장'}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 space-y-2 text-xs">
                      {/* 원재료 (읽기 전용) */}
                      <div className="flex justify-between">
                        <span className="text-slate-500">원재료</span>
                        <span className="font-mono font-bold text-slate-800 text-right">
                          {injData.rawMaterialCode}
                          <span className="text-slate-400 ml-1 text-[10px]">({injData.rawMaterialName})</span>
                        </span>
                      </div>
                      {/* 편집 가능 필드들 */}
                      {([
                        ['재질단가', 'materialPrice', 'kg', '1'] as const,
                        ['NET중량', 'netWeight', 'g', '0.01'] as const,
                        ['Runner', 'runnerWeight', 'g', '0.01'] as const,
                        ['Cavity', 'cavity', '', '1'] as const,
                        ['Loss율', 'lossRate', '%', '0.1'] as const,
                      ]).map(([label, field, unit, step]) => (
                        <div key={field} className="flex items-center justify-between gap-2">
                          <span className="text-slate-500 whitespace-nowrap">{label}</span>
                          {injEdit !== null ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step={step}
                                value={injEdit[field]}
                                onChange={e => setInjEdit(prev => prev ? { ...prev, [field]: e.target.value } : prev)}
                                onClick={e => e.stopPropagation()}
                                className="w-24 px-2 py-1 border-2 border-emerald-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                              />
                              <span className="text-[10px] text-slate-400 w-6">{unit}</span>
                            </div>
                          ) : (
                            <span className="font-mono font-bold text-slate-800">
                              {field === 'materialPrice' ? (injData.materialPrice > 0 ? `${fmtWon(injData.materialPrice)}/${unit}` : `—/${unit}`) :
                               field === 'cavity' ? String(injData.cavity) :
                               field === 'lossRate' ? `${injData.lossRate}%` :
                               `${(injData as any)[field]?.toFixed(2) || '0.00'}${unit}`}
                            </span>
                          )}
                        </div>
                      ))}
                      {/* EA당중량 + 공식 산출 (계산값) */}
                      {(() => {
                        const mp = injEdit ? parseFloat(injEdit.materialPrice) || 0 : injData.materialPrice;
                        const nw = injEdit ? parseFloat(injEdit.netWeight) || 0 : injData.netWeight;
                        const rw = injEdit ? parseFloat(injEdit.runnerWeight) || 0 : injData.runnerWeight;
                        const cv = injEdit ? Math.max(1, parseInt(injEdit.cavity) || 1) : injData.cavity;
                        const lr = injEdit ? parseFloat(injEdit.lossRate) || 0 : injData.lossRate;
                        const wpe = nw + rw / cv;
                        const cc = (wpe * mp / 1000) * (1 + lr / 100);
                        return (
                          <>
                            <div className="flex justify-between border-t border-emerald-200 pt-1.5">
                              <span className="text-slate-500">EA당중량</span>
                              <span className="font-mono font-bold text-slate-800">{wpe.toFixed(2)}g</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-emerald-600 font-bold">공식 산출</span>
                              <span className={`font-mono font-black text-lg ${injEdit && Math.abs(cc - injData.calculatedCost) > 1 ? 'text-rose-600' : 'text-emerald-700'}`}>
                                {cc > 0 ? fmtWon(cc) : '—'}
                              </span>
                            </div>
                            {injEdit && Math.abs(cc - injData.calculatedCost) > 1 && (
                              <div className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded">
                                기존 {fmtWon(injData.calculatedCost)} → {fmtWon(cc)} ({cc > injData.calculatedCost ? '△' : '▽'}{fmtWon(Math.abs(cc - injData.calculatedCost))})
                              </div>
                            )}
                            {!injEdit && selectedNodeInfo.priceSource !== '사출' && (
                              <div className="text-[10px] text-amber-600 mt-1">
                                ※ 현재 단가는 '{selectedNodeInfo.priceSource}' 기준 — 사출 산출가와 비교하세요
                              </div>
                            )}
                            <div className="text-[9px] text-slate-400 mt-1 border-t border-emerald-100 pt-1">
                              = ({nw.toFixed(1)}g + {rw.toFixed(1)}g/{cv}) × ₩{Math.round(mp)}/kg ÷ 1000 × (1+{lr}%)
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  );
                })()}

                {/* 도장 산출근거 — 배합비율 기반 + 편집 가능 (외주도장 제외) */}
                {selectedNodeInfo.paint && !/외주/.test(selectedNodeInfo.supplyType || '') && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-black text-purple-700">도장 산출근거</h4>
                      {paintEdit === null ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaintEdit({
                              paintIntake: String(selectedNodeInfo.paint!.paintIntake || ''),
                            });
                          }}
                          className="text-[11px] text-white bg-purple-600 hover:bg-purple-700 font-bold px-3 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          수정
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPaintEdit(null); }}
                            className="text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold px-3 py-1 rounded-lg transition-colors"
                          >
                            취소
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (savingPaint || !paintEdit) return;
                              setSavingPaint(true);
                              const intake = parseFloat(paintEdit.paintIntake) || 0;
                              // 실제 품번: virtual paint면 PAINT_ 제거
                              const realPn = /PAINT_/.test(selectedNodeInfo.pn)
                                ? selectedNodeInfo.pn.replace('PAINT_', '')
                                : selectedNodeInfo.pn;
                              try {
                                await referenceInfoService.updateFields(realPn, { paintIntake: intake });
                                const ri = await referenceInfoService.getAll();
                                setRefInfo(ri);
                                setPaintEdit(null);
                                // 즉시 반영: 선택 노드 정보 갱신
                                const updatedPaint = getPaintInfo(realPn);
                                if (updatedPaint) {
                                  setSelectedNodeInfo(prev => prev ? {
                                    ...prev,
                                    price: updatedPaint.costPerEa,
                                    amount: prev.unitQty * updatedPaint.costPerEa,
                                    priceSource: '도장',
                                    paint: updatedPaint,
                                  } : prev);
                                }
                              } catch (err) {
                                console.error('도장 개취수량 저장 오류:', err);
                              } finally {
                                setSavingPaint(false);
                              }
                            }}
                            disabled={savingPaint}
                            className="text-[11px] text-white bg-purple-600 hover:bg-purple-700 font-bold px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {savingPaint ? '저장중...' : '저장'}
                          </button>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const p = selectedNodeInfo.paint!;
                      const intake = paintEdit ? parseFloat(paintEdit.paintIntake) || 0 : p.paintIntake;
                      const costPerEa = intake > 0 ? p.mixCostPerKg / intake : 0;
                      const hasMixData = p.mixCostPerKg > 0;
                      return (
                        <div className="bg-purple-50 rounded-xl p-3 space-y-1.5 text-xs">
                          {/* 도료 정보 */}
                          <div className="flex justify-between">
                            <span className="text-slate-500">도료코드</span>
                            <span className="font-mono font-bold text-slate-800">{p.paintCode}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">도료명</span>
                            <span className="font-mono font-bold text-slate-800">{p.paintName}</span>
                          </div>
                          {!hasMixData && (
                            <div className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1.5 rounded">
                              배합표준서에 도료코드({p.paintCode}) 매칭 데이터가 없습니다. 배합표준서를 업로드해주세요.
                            </div>
                          )}
                          {/* 배합비율 상세 */}
                          {hasMixData && <><div className="border-t border-purple-200 pt-1.5 space-y-1">
                            <div className="flex justify-between">
                              <span className="text-slate-500">주제 {p.mainRatio}%</span>
                              <span className="font-mono text-slate-700">
                                × {fmtWon(p.mainPrice)}/kg = {fmtWon(p.mainRatio / 100 * p.mainPrice)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">경화제 {p.hardenerRatio}%</span>
                              <span className="font-mono text-slate-700">
                                × {fmtWon(p.hardenerPrice)}/kg = {fmtWon(p.hardenerRatio / 100 * p.hardenerPrice)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">신너 {p.thinnerRatio}%</span>
                              <span className="font-mono text-slate-700">
                                × {fmtWon(p.thinnerPrice)}/kg = {fmtWon(p.thinnerRatio / 100 * p.thinnerPrice)}
                              </span>
                            </div>
                          </div>
                          {/* 배합단가 */}
                          <div className="flex justify-between border-t border-purple-200 pt-1.5">
                            <span className="text-slate-500 font-bold">배합단가</span>
                            <span className="font-mono font-bold text-slate-800">{fmtWon(p.mixCostPerKg)}/kg</span>
                          </div>
                          </>}
                          {/* 개취수량 (편집 가능) */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500 font-bold">개취수량</span>
                            {paintEdit !== null ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="1"
                                  value={paintEdit.paintIntake}
                                  onChange={e => setPaintEdit(prev => prev ? { ...prev, paintIntake: e.target.value } : prev)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-24 px-2 py-1 border-2 border-purple-400 rounded text-right text-xs font-mono outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                                />
                                <span className="text-[10px] text-slate-400">EA/kg</span>
                              </div>
                            ) : (
                              <span className={`font-mono font-bold ${p.paintIntake > 0 ? 'text-slate-800' : 'text-rose-500'}`}>
                                {p.paintIntake > 0 ? `${p.paintIntake} EA/kg` : '미입력'}
                              </span>
                            )}
                          </div>
                          {/* 개당 도료비 */}
                          <div className="flex justify-between border-t border-purple-200 pt-1.5">
                            <span className="text-purple-600 font-bold">개당 도료비</span>
                            <span className={`font-mono font-black text-lg ${
                              paintEdit && Math.abs(costPerEa - p.costPerEa) > 0.5 ? 'text-rose-600' : 'text-purple-700'
                            }`}>
                              {costPerEa > 0 ? fmtWon(costPerEa) : '—'}
                            </span>
                          </div>
                          {paintEdit && Math.abs(costPerEa - p.costPerEa) > 0.5 && p.costPerEa > 0 && (
                            <div className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded">
                              기존 {fmtWon(p.costPerEa)} → {fmtWon(costPerEa)} ({costPerEa > p.costPerEa ? '△' : '▽'}{fmtWon(Math.abs(costPerEa - p.costPerEa))})
                            </div>
                          )}
                          {p.paintIntake <= 0 && !paintEdit && (
                            <div className="text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded mt-1">
                              ※ 개취수량을 입력하면 개당 도료비가 계산됩니다. [수정] 버튼을 눌러 입력하세요.
                            </div>
                          )}
                          <div className="text-[9px] text-slate-400 mt-1 border-t border-purple-100 pt-1">
                            = {fmtWon(p.mixCostPerKg)}/kg ÷ {intake > 0 ? intake : '?'} EA/kg
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-slate-400 text-xs sticky top-20">
                행을 클릭하면 상세 정보가 표시됩니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paint Analysis Panel */}
      {showPaintAnalysis && (
        <PaintAnalysisPanel
          refInfo={refInfo}
          materialCodes={materialCodes}
          paintMixRatios={paintMixRatios}
          onRefInfoUpdated={setRefInfo}
          onClose={() => setShowPaintAnalysis(false)}
        />
      )}
    </div>
  );
};

export default BomReviewView;
