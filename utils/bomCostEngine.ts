/**
 * bomCostEngine — BomReviewView와 100% 동일한 계산 엔진 (순수 함수)
 * 단가 우선순위: 구매단가 → 사출공식 → 도장공식 → 재질코드 → 표준(leaf only)
 */
import { normalizePn } from './bomDataParser';
import type { BomRecord } from './bomDataParser';
import type { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from './bomMasterParser';
import type { PurchasePrice, OutsourcePrice, PaintMixRatio, ItemStandardCost } from './standardMaterialParser';
import type { ForecastItem } from './salesForecastParser';
import type { ItemRevenueRow } from './revenueDataParser';

// ============================================================
// Types
// ============================================================

export interface PriceData {
  matPriceMap: Map<string, number>;       // 재질코드 → 원/kg
  materialTypeMap: Map<string, string>;   // 재질코드 → 유형
  matNameMap: Map<string, string>;        // 재질코드 → 명칭
  purchaseMap: Map<string, number>;       // 품번 → 구매단가
  outsourceMap: Map<string, number>;      // 품번 → 외주가공비
  stdMap: Map<string, number>;            // 품번 → 표준재료비
  supplierMap: Map<string, string>;       // 품번 → 업체명 (구매/외주 데이터 기반)
}

export interface PaintDetail {
  paintCode: string;
  paintName: string;
  mainRatio: number;
  hardenerRatio: number;
  thinnerRatio: number;
  mainPrice: number;
  hardenerPrice: number;
  thinnerPrice: number;
  mixCostPerKg: number;
  paintIntake: number;
  costPerEa: number;
}

export interface ProductCostRow {
  pn: string;
  name: string;
  customer: string;
  model: string;
  childCount: number;
  sellingPrice: number;
  planQty: number;
  expectedRevenue: number;
  materialCost: number;    // EA당 재료비
  materialTotal: number;   // planQty × materialCost
  materialRatio: number;   // %
  source: string;          // 가격 출처 요약
}

/** MRP용 리프 자재 집계 */
export interface LeafMaterialRow {
  materialCode: string;
  materialName: string;
  materialType: string;    // RESIN/PAINT/구매/외주
  unit: string;
  monthlyQty: number[];    // 12개월
  unitPrice: number;
  totalCost: number;
  supplier: string;
  parentProducts: string[];
}

export interface CostEngineSummary {
  totalRevenue: number;
  totalMaterial: number;
  materialRatio: number;   // 0~1
  productCount: number;
  matchedCount: number;
  byType: { name: string; amount: number }[];
}

export interface CostEngineResult {
  products: ProductCostRow[];
  summary: CostEngineSummary;
  leafMaterials: LeafMaterialRow[];
}

// ============================================================
// 1. Price Data 구축
// ============================================================

export function buildPriceData(
  materialCodes: MaterialCodeRecord[],
  purchasePrices: PurchasePrice[],
  outsourcePrices: OutsourcePrice[],
  stdCosts: ItemStandardCost[],
): PriceData {
  const matPriceMap = new Map<string, number>();
  const materialTypeMap = new Map<string, string>();
  const matNameMap = new Map<string, string>();
  for (const mc of materialCodes) {
    const code = normalizePn(mc.materialCode);
    if (mc.currentPrice > 0) matPriceMap.set(code, mc.currentPrice);
    // 업종명 + 재질분류 + 도료구분을 결합하여 RESIN/PAINT 분류에 활용
    const combined = [mc.materialType, mc.materialCategory, mc.paintCategory].filter(Boolean).join('|');
    materialTypeMap.set(code, combined);
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

  // 업체명 맵 (구매단가 + 외주단가 데이터에서 추출)
  const supplierMap = new Map<string, string>();
  for (const pp of purchasePrices) {
    if (pp.supplier) {
      supplierMap.set(normalizePn(pp.itemCode), pp.supplier);
      if (pp.customerPn) supplierMap.set(normalizePn(pp.customerPn), pp.supplier);
    }
  }
  for (const op of outsourcePrices) {
    if (op.supplier) {
      const code = normalizePn(op.itemCode);
      if (!supplierMap.has(code)) supplierMap.set(code, op.supplier);
      if (op.customerPn) {
        const custCode = normalizePn(op.customerPn);
        if (!supplierMap.has(custCode)) supplierMap.set(custCode, op.supplier);
      }
    }
  }

  return { matPriceMap, materialTypeMap, matNameMap, purchaseMap, outsourceMap, stdMap, supplierMap };
}

// ============================================================
// 2. PaintMixMap 구축
// ============================================================

export function buildPaintMixMap(paintMixRatios: PaintMixRatio[]): Map<string, PaintMixRatio> {
  const map = new Map<string, PaintMixRatio>();
  for (const pmr of paintMixRatios) {
    map.set(normalizePn(pmr.paintCode), pmr);
    if (pmr.mainCode) map.set(normalizePn(pmr.mainCode), pmr);
  }
  return map;
}

// ============================================================
// 3. RefInfoMap 구축
// ============================================================

export function buildRefInfoMap(refInfo: ReferenceInfoRecord[]): Map<string, ReferenceInfoRecord> {
  const map = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    const code = normalizePn(ri.itemCode);
    map.set(code, ri);
    if (ri.customerPn) map.set(normalizePn(ri.customerPn), ri);
  }
  return map;
}

// ============================================================
// 4. ForwardMap 구축 (BOM 부모→자식)
// ============================================================

export function buildForwardMap(bomRecords: BomRecord[]): Map<string, BomRecord[]> {
  const map = new Map<string, BomRecord[]>();
  const seen = new Set<string>();
  for (const rec of bomRecords) {
    const key = normalizePn(rec.parentPn);
    const dedupKey = `${key}|${normalizePn(rec.childPn)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const list = map.get(key) || [];
    list.push(rec);
    map.set(key, list);
  }
  return map;
}

// ============================================================
// 5. getPaintInfo — 도장 배합비율 기반 단가
// ============================================================

export function getPaintInfo(
  pn: string,
  refInfoMap: Map<string, ReferenceInfoRecord>,
  priceData: PriceData,
  paintMixMap: Map<string, PaintMixRatio>,
): PaintDetail | undefined {
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
      paintCode: raw, paintName: mix.paintName || raw,
      mainRatio: mix.mainRatio, hardenerRatio: mix.hardenerRatio, thinnerRatio: mix.thinnerRatio,
      mainPrice: mix.mainPrice, hardenerPrice: mix.hardenerPrice, thinnerPrice: mix.thinnerPrice,
      mixCostPerKg, paintIntake, costPerEa,
    };
  }

  // 2차: 도장 유형이면 rawCode로 paintMixMap 직접 시도
  if (isPaintPart) {
    for (const raw of rawCodes) {
      const rawNorm = normalizePn(raw);
      let mix = paintMixMap.get(rawNorm);
      // P→S 접두사 변환
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
        paintCode: raw, paintName: mix.paintName || raw,
        mainRatio: mix.mainRatio, hardenerRatio: mix.hardenerRatio, thinnerRatio: mix.thinnerRatio,
        mainPrice: mix.mainPrice, hardenerPrice: mix.hardenerPrice, thinnerPrice: mix.thinnerPrice,
        mixCostPerKg, paintIntake, costPerEa,
      };
    }
  }

  return undefined;
}

// ============================================================
// 6. getNodePrice — BOM 개별 노드 단가 (BomReviewView 동일)
// 우선순위: 구매 → 사출 → 도장 → 재질 → 표준(leaf only)
// ============================================================

export function getNodePrice(
  pn: string,
  priceData: PriceData,
  refInfoMap: Map<string, ReferenceInfoRecord>,
  paintMixMap: Map<string, PaintMixRatio>,
): { price: number; source: string } {
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

  // 2.5) 도장공식 (외주도장은 구매단가 사용 → 도장공식 스킵)
  if (ri && /도장/.test(ri.processType || '') && !/외주/.test(ri.supplyType || '')) {
    const paint = getPaintInfo(pn, refInfoMap, priceData, paintMixMap);
    if (paint && paint.costPerEa > 0) return { price: paint.costPerEa, source: '도장' };
  }

  // 3) 재질코드 직접
  const dp = matPriceMap.get(code);
  if (dp && dp > 0) return { price: dp, source: '재질' };

  // 4) 표준재료비 (최후순위 — leaf만 사용, non-leaf에서는 caller가 판단)
  const std = stdMap.get(code);
  if (std && std > 0) return { price: std, source: '표준' };

  return { price: 0, source: '' };
}

// ============================================================
// 7. calcRootMaterialCost — BOM 트리 walk (BomReviewView 동일)
// non-leaf에서 '표준' 단가는 가공비/경비 포함이므로 사용 금지
// ============================================================

export function calcRootMaterialCost(
  rootPn: string,
  forwardMap: Map<string, BomRecord[]>,
  priceData: PriceData,
  refInfoMap: Map<string, ReferenceInfoRecord>,
  paintMixMap: Map<string, PaintMixRatio>,
): number {
  const visited = new Set<string>();

  function walk(pn: string, qty: number): number {
    const code = normalizePn(pn);
    if (visited.has(code)) return 0;
    visited.add(code);

    const children = forwardMap.get(code) || [];
    if (children.length === 0) {
      // Leaf: 자체 단가 사용 (표준 포함 OK)
      const { price } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
      visited.delete(code);
      return qty * price;
    }

    // Non-leaf: 구매/사출/도장/재질만 사용, '표준'은 제외 → 자식 재귀
    const { price, source } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
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
}

// ============================================================
// 8. collectLeafMaterials — BOM walk 중 리프 자재 수집 (MRP용)
// ============================================================

function collectLeafMaterials(
  rootPn: string,
  monthlyQty: number[],
  forwardMap: Map<string, BomRecord[]>,
  priceData: PriceData,
  refInfoMap: Map<string, ReferenceInfoRecord>,
  paintMixMap: Map<string, PaintMixRatio>,
  materialAgg: Map<string, { name: string; type: string; monthlyQty: number[]; unitPrice: number; parents: Set<string>; supplier: string }>,
): void {
  const { materialTypeMap, matNameMap } = priceData;

  function walk(pn: string, qtyPerRoot: number, visited: Set<string>): void {
    const code = normalizePn(pn);
    if (visited.has(code)) return;
    visited.add(code);

    const children = forwardMap.get(code) || [];
    if (children.length === 0) {
      // Leaf → 자재로 집계
      const { price, source } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
      addToAgg(code, pn, qtyPerRoot, price, source);
      visited.delete(code);
      return;
    }

    // Non-leaf: 직접 단가 있으면 (표준 제외) 해당 노드를 "자재"로 집계
    const { price, source } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
    if (price > 0 && source !== '표준') {
      addToAgg(code, pn, qtyPerRoot, price, source);
      visited.delete(code);
      return;
    }

    // 자식 재귀
    for (const child of children) {
      walk(child.childPn, qtyPerRoot * child.qty, visited);
    }
    visited.delete(code);
  }

  function addToAgg(code: string, pn: string, qtyPerRoot: number, price: number, source: string) {
    const ri = refInfoMap.get(code);
    // 1차: 직접 코드(재질코드)로 materialTypeMap 조회
    let mt = materialTypeMap.get(code) || '';
    // 2차: 원재료코드(refInfo)로 조회 — BOM 품번 ≠ 재질코드인 경우
    if (!mt && ri) {
      const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean) as string[];
      for (const raw of rawCodes) {
        const rawMt = materialTypeMap.get(normalizePn(raw));
        if (rawMt) { mt = rawMt; break; }
      }
    }
    let matType = '구매';
    if (/resin|수지|사출/i.test(mt)) matType = 'RESIN';
    else if (/paint|도료|도장|경화제|희석제/i.test(mt)) matType = 'PAINT';
    else if (source === '사출') matType = 'RESIN';
    else if (source === '도장') matType = 'PAINT';
    else if (source === '외주') matType = '외주';

    // 업체명 결정: 기준정보 → 구매/외주 데이터 → 자작 자동지정
    let supplier = ri?.supplier || '';
    if (!supplier) {
      supplier = priceData.supplierMap.get(code) || '';
    }
    if (!supplier && (source === '사출' || source === '도장')) {
      supplier = '신성오토텍(자작)';
    }

    const existing = materialAgg.get(code);
    if (existing) {
      for (let m = 0; m < 12; m++) {
        existing.monthlyQty[m] += qtyPerRoot * (monthlyQty[m] || 0);
      }
      existing.parents.add(normalizePn(rootPn));
    } else {
      const mq = new Array(12).fill(0);
      for (let m = 0; m < 12; m++) {
        mq[m] = qtyPerRoot * (monthlyQty[m] || 0);
      }
      materialAgg.set(code, {
        name: matNameMap.get(code) || ri?.itemName || pn,
        type: matType,
        monthlyQty: mq,
        unitPrice: price,
        parents: new Set([normalizePn(rootPn)]),
        supplier,
      });
    }
  }

  // 루트의 자식부터 시작
  const rootChildren = forwardMap.get(normalizePn(rootPn)) || [];
  const visited = new Set<string>();
  for (const child of rootChildren) {
    walk(child.childPn, child.qty, visited);
  }
}

// ============================================================
// 9. calcAllProductCosts — 전체 forecast 제품 원가 산출 (메인 함수)
// ============================================================

export interface CalcAllParams {
  forecastData: ForecastItem[];
  bomRecords: BomRecord[];
  refInfo: ReferenceInfoRecord[];
  materialCodes: MaterialCodeRecord[];
  purchasePrices: PurchasePrice[];
  outsourcePrices: OutsourcePrice[];
  paintMixRatios: PaintMixRatio[];
  itemStandardCosts: ItemStandardCost[];
  productCodes: ProductCodeRecord[];
  itemRevenue: ItemRevenueRow[];
  selectedMonth: number;  // -1=전체(내부0), 0~11=특정월(외부1~12 → 내부0~11)
}

export function calcAllProductCosts(params: CalcAllParams): CostEngineResult {
  const {
    forecastData, bomRecords, refInfo, materialCodes,
    purchasePrices, outsourcePrices, paintMixRatios,
    itemStandardCosts, productCodes,
    selectedMonth,
  } = params;

  // Build maps (BomReviewView 동일)
  const priceData = buildPriceData(materialCodes, purchasePrices, outsourcePrices, itemStandardCosts);
  const paintMixMap = buildPaintMixMap(paintMixRatios);
  const refInfoMap = buildRefInfoMap(refInfo);
  const forwardMap = buildForwardMap(bomRecords);

  // P/N 매핑 (이전 ProductMaterialCostView 동일)
  const custToInternal = new Map<string, string>();
  const internalToCust = new Map<string, string>();
  for (const pc of productCodes) {
    if (pc.productCode && pc.customerPn) {
      custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
      internalToCust.set(normalizePn(pc.productCode), normalizePn(pc.customerPn));
    }
    // pc.customer field에 고객 PN이 저장된 경우 (e.g., 84650G6080JAQ)
    if (pc.productCode && pc.customer && /^\d/.test(pc.customer)) {
      const custNorm = normalizePn(pc.customer);
      if (!custToInternal.has(custNorm)) custToInternal.set(custNorm, normalizePn(pc.productCode));
    }
  }
  for (const ri of refInfo) {
    if (ri.itemCode && ri.customerPn) {
      custToInternal.set(normalizePn(ri.customerPn), normalizePn(ri.itemCode));
      internalToCust.set(normalizePn(ri.itemCode), normalizePn(ri.customerPn));
    }
  }
  // item_standard_cost에서 추가 P/N 매핑
  for (const sc of itemStandardCosts) {
    if (sc.customer_pn && sc.item_code) {
      const cpn = normalizePn(sc.customer_pn);
      const icode = normalizePn(sc.item_code);
      if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
      if (!internalToCust.has(icode)) internalToCust.set(icode, cpn);
    }
  }

  // BOM prefix index (fuzzy 매칭용 — 이전 코드 동일)
  const bomPrefixIndex = new Map<string, string>();
  for (const pn of forwardMap.keys()) {
    for (let len = 8; len <= pn.length; len++) {
      const p = pn.slice(0, len);
      if (!bomPrefixIndex.has(p)) bomPrefixIndex.set(p, pn);
    }
  }

  // BOM 부모 찾기 (이전 ProductMaterialCostView.findBomParent 동일)
  function findBomParent(forecastPn: string): string | null {
    const bomParent = normalizePn(forecastPn);
    if (forwardMap.has(bomParent)) return bomParent;
    const internal = custToInternal.get(bomParent);
    if (internal && forwardMap.has(internal)) return internal;
    const cust = internalToCust.get(bomParent);
    if (cust && forwardMap.has(cust)) return cust;
    // fuzzy prefix matching
    if (bomParent.length >= 10) {
      for (let pl = bomParent.length - 1; pl >= 8; pl--) {
        const prefix = bomParent.slice(0, pl);
        const candidate = bomPrefixIndex.get(prefix);
        if (candidate && forwardMap.has(candidate)) return candidate;
      }
    }
    return null;
  }

  const materialAgg = new Map<string, { name: string; type: string; monthlyQty: number[]; unitPrice: number; parents: Set<string>; supplier: string }>();

  // 디버그: 매칭 진단
  const fcSamples = forecastData.slice(0, 5).map(f => ({ pn: f.partNo, newPn: f.newPartNo, cust: f.customer }));
  const c2iSample = [...custToInternal.entries()].slice(0, 5);
  const fwdSample = [...forwardMap.keys()].slice(0, 5);
  console.log(`[원가분석 매칭진단] forecast=${forecastData.length}건, custToInternal=${custToInternal.size}, forwardMap=${forwardMap.size}, bomPrefixIndex=${bomPrefixIndex.size}`);
  console.log(`[원가분석 forecast샘플]`, JSON.stringify(fcSamples));
  console.log(`[원가분석 custToInternal샘플]`, JSON.stringify(c2iSample));
  console.log(`[원가분석 forwardMap샘플]`, JSON.stringify(fwdSample));
  // 첫 3개 forecast에 대해 findBomParent 결과
  for (const f of forecastData.slice(0, 3)) {
    const fpn = normalizePn(f.newPartNo || f.partNo);
    const result = findBomParent(fpn);
    const altResult = f.newPartNo ? findBomParent(f.partNo) : null;
    console.log(`[매칭시도] newPartNo="${f.newPartNo}" partNo="${f.partNo}" → fpn="${fpn}" → bomParent=${result}, alt=${altResult}`);
  }

  // Forecast-driven product list (forecast 순회 → BOM parent 매칭)
  const products: ProductCostRow[] = [];
  let totalRevenue = 0;
  let totalMaterial = 0;
  let matchedCount = 0;
  const processedFcPns = new Set<string>();

  for (const fc of forecastData) {
    // 이전 코드 동일: newPartNo 우선 사용
    const forecastPn = normalizePn(fc.newPartNo || fc.partNo);

    // 동일 품번 중복 방지
    if (processedFcPns.has(forecastPn)) continue;
    processedFcPns.add(forecastPn);

    // BOM 매칭 (newPartNo 우선 → partNo 보조)
    let bomParent = findBomParent(forecastPn);
    if (!bomParent && fc.newPartNo) {
      bomParent = findBomParent(fc.partNo);
    }

    // Quantities (selectedMonth: -1=전체, 0~11=특정월)
    const qty = selectedMonth === -1 ? fc.totalQty : (fc.monthlyQty[selectedMonth] || 0);
    const rev = selectedMonth === -1
      ? (fc.totalRevenue > 0 ? fc.totalRevenue : fc.unitPrice * fc.totalQty)
      : (fc.monthlyRevenue?.[selectedMonth] || fc.unitPrice * (fc.monthlyQty[selectedMonth] || 0));

    // EA당 재료비 (BOM 매칭 시 on-demand 계산)
    const materialCost = bomParent
      ? calcRootMaterialCost(bomParent, forwardMap, priceData, refInfoMap, paintMixMap)
      : 0;
    const materialTotal = qty * materialCost;
    const materialRatio = rev > 0 ? (materialTotal / rev) * 100 : 0;

    if (rev > 0 && materialCost > 0) {
      totalRevenue += rev;
      totalMaterial += materialTotal;
      matchedCount++;
    }

    // MRP용 리프 자재 수집
    if (bomParent && materialCost > 0 && fc.monthlyQty.some(q => q > 0)) {
      collectLeafMaterials(bomParent, fc.monthlyQty, forwardMap, priceData, refInfoMap, paintMixMap, materialAgg);
    }

    // 출처 판별
    let mainSource = '';
    if (bomParent) {
      const children = forwardMap.get(bomParent) || [];
      if (children.length > 0) {
        const { source } = getNodePrice(children[0].childPn, priceData, refInfoMap, paintMixMap);
        mainSource = source;
      }
    }

    products.push({
      pn: fc.partNo,
      name: fc.partName || '',
      customer: fc.customer || '',
      model: fc.model || '',
      childCount: bomParent ? (forwardMap.get(bomParent)?.length || 0) : 0,
      sellingPrice: fc.unitPrice || 0,
      planQty: qty,
      expectedRevenue: rev,
      materialCost,
      materialTotal,
      materialRatio,
      source: mainSource,
    });
  }

  products.sort((a, b) => b.expectedRevenue - a.expectedRevenue);

  // Leaf materials 결과 구성
  const leafMaterials: LeafMaterialRow[] = [];
  for (const [code, agg] of materialAgg) {
    const totalQty = agg.monthlyQty.reduce((s, q) => s + q, 0);
    leafMaterials.push({
      materialCode: code,
      materialName: agg.name,
      materialType: agg.type,
      unit: agg.type === 'RESIN' ? 'kg' : agg.type === 'PAINT' || agg.type === '도장' ? 'L' : 'EA',
      monthlyQty: agg.monthlyQty,
      unitPrice: agg.unitPrice,
      totalCost: totalQty * agg.unitPrice,
      supplier: agg.supplier,
      parentProducts: Array.from(agg.parents),
    });
  }
  leafMaterials.sort((a, b) => b.totalCost - a.totalCost);

  // byType 결과 — leafMaterials 기반 집계 (정확한 materialType 사용)
  const leafTypeAmounts = new Map<string, number>();
  for (const lm of leafMaterials) {
    leafTypeAmounts.set(lm.materialType, (leafTypeAmounts.get(lm.materialType) || 0) + lm.totalCost);
  }
  const byType = Array.from(leafTypeAmounts.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    products,
    summary: {
      totalRevenue,
      totalMaterial,
      materialRatio: totalRevenue > 0 ? totalMaterial / totalRevenue : 0,
      productCount: products.length,
      matchedCount,
      byType,
    },
    leafMaterials,
  };
}
