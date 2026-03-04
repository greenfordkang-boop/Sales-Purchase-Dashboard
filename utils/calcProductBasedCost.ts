/**
 * 제품별재료비 기준 통합 재료비 산출
 * ProductMaterialCostView와 동일한 로직으로 표준재료비 탭에서도 사용 (일관성 보장)
 *
 * 우선순위: item_standard_cost → BOM전개 → 기준정보 직접산출
 * 수량기준: 과거월=실적수량, 당월+미래=계획수량
 */

import { BomRecord, normalizePn, buildBomRelations, expandBomToLeaves } from './bomDataParser';
import { ForecastItem } from './salesForecastParser';
import { ItemRevenueRow } from './revenueDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from './bomMasterParser';
import { PurchasePrice, OutsourcePrice, PaintMixRatio, ItemStandardCost } from './standardMaterialParser';
import type { UnifiedCalcResult, SummaryByType, CalcItemRow } from './materialCostCalculator';

// ============================================================
// Types
// ============================================================

export interface PaintConsumptionEntry {
  itemCode: string;
  custPN?: string;
  paintGPerEa: number;
  paintCostPerEa: number;
}

export interface FallbackStdCost {
  productCode: string;
  customerPn?: string;
  eaCost: number;
  processType?: string;
  productName?: string;
}

export interface CalcProductBasedParams {
  forecastData: ForecastItem[];
  itemStandardCosts: ItemStandardCost[];
  bomRecords: BomRecord[];
  refInfo: ReferenceInfoRecord[];
  materialCodes: MaterialCodeRecord[];
  purchasePrices: PurchasePrice[];
  outsourcePrices: OutsourcePrice[];
  paintMixRatios: PaintMixRatio[];
  productCodes?: ProductCodeRecord[];
  paintConsumptionData: PaintConsumptionEntry[];
  fallbackStandardCosts: FallbackStdCost[];
  fallbackMaterialCodes: MaterialCodeRecord[];
  actualRevenue: ItemRevenueRow[];
  monthIndex: number;   // 0-based (0=Jan, 1=Feb, ...), -1=All months
  currentMonth: number; // 0-based current month (for actual vs plan decision)
}

// ============================================================
// Main function
// ============================================================

export function calcProductBasedMaterialCost(params: CalcProductBasedParams): UnifiedCalcResult {
  const {
    forecastData, itemStandardCosts, bomRecords, refInfo, materialCodes,
    purchasePrices, outsourcePrices, paintMixRatios, productCodes,
    paintConsumptionData, fallbackStandardCosts, fallbackMaterialCodes,
    actualRevenue, monthIndex, currentMonth,
  } = params;

  // ========== 1. BOM 관계 구축 ==========
  const dedupKey = new Set<string>();
  const deduped: BomRecord[] = [];
  for (const r of bomRecords) {
    const k = `${normalizePn(r.parentPn)}|${normalizePn(r.childPn)}`;
    if (!dedupKey.has(k)) { dedupKey.add(k); deduped.push(r); }
  }
  const bomRelations = buildBomRelations(deduped);

  // ========== 2. P/N 매핑 (productCodes + refInfo, ProductMaterialCostView 동일) ==========
  const custToInternal = new Map<string, string>();
  const internalToCust = new Map<string, string>();
  // productCodes 우선 등록
  if (productCodes) {
    for (const pc of productCodes) {
      if (pc.productCode && pc.customerPn) {
        custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
        internalToCust.set(normalizePn(pc.productCode), normalizePn(pc.customerPn));
      }
    }
  }
  // refInfo로 보강 (덮어쓰기)
  for (const ri of refInfo) {
    if (ri.itemCode && ri.customerPn) {
      custToInternal.set(normalizePn(ri.customerPn), normalizePn(ri.itemCode));
      internalToCust.set(normalizePn(ri.itemCode), normalizePn(ri.customerPn));
    }
  }

  // ========== 3. 기준정보 맵 ==========
  const refInfoMap = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    refInfoMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refInfoMap.set(normalizePn(ri.customerPn), ri);
  }

  // ========== 4. 재질코드 단가 맵 ==========
  const mergedMat = [...materialCodes];
  if (materialCodes.filter(m => m.currentPrice > 0).length === 0) {
    const existing = new Set(materialCodes.map(m => m.materialCode.trim().toUpperCase()));
    for (const fb of fallbackMaterialCodes) {
      const k = fb.materialCode.trim().toUpperCase();
      if (!existing.has(k)) { mergedMat.push(fb); existing.add(k); }
      else {
        const idx = mergedMat.findIndex(m => m.materialCode.trim().toUpperCase() === k);
        if (idx >= 0 && mergedMat[idx].currentPrice <= 0 && fb.currentPrice > 0)
          mergedMat[idx] = { ...mergedMat[idx], currentPrice: fb.currentPrice };
      }
    }
  }
  const priceMap = new Map<string, number>();
  const materialTypeMap = new Map<string, string>();
  const materialNameMap = new Map<string, string>();
  for (const mc of mergedMat) {
    const k = normalizePn(mc.materialCode);
    if (mc.currentPrice > 0) priceMap.set(k, mc.currentPrice);
    materialTypeMap.set(k, mc.materialType || '');
    materialNameMap.set(k, mc.materialName || '');
  }

  // ========== 5. 도료배합비율 맵 ==========
  const paintMixMap = new Map<string, PaintMixRatio>();
  for (const pm of paintMixRatios) {
    const enriched: PaintMixRatio = {
      ...pm,
      mainPrice: pm.mainPrice > 0 ? pm.mainPrice : (pm.mainCode ? priceMap.get(normalizePn(pm.mainCode)) || 0 : 0),
      hardenerPrice: pm.hardenerPrice > 0 ? pm.hardenerPrice : (pm.hardenerCode ? priceMap.get(normalizePn(pm.hardenerCode)) || 0 : 0),
      thinnerPrice: pm.thinnerPrice > 0 ? pm.thinnerPrice : (pm.thinnerCode ? priceMap.get(normalizePn(pm.thinnerCode)) || 0 : 0),
    };
    if (pm.paintCode) paintMixMap.set(normalizePn(pm.paintCode), enriched);
    if (pm.mainCode) paintMixMap.set(normalizePn(pm.mainCode), enriched);
  }

  // ========== 6. 실측 도장소요량 맵 ==========
  const paintConsumptionMap = new Map<string, { paintGPerEa: number; paintCostPerEa: number }>();
  for (const pc of paintConsumptionData) {
    const entry = { paintGPerEa: pc.paintGPerEa, paintCostPerEa: pc.paintCostPerEa / 1000 };
    paintConsumptionMap.set(normalizePn(pc.itemCode), entry);
    if (pc.custPN) paintConsumptionMap.set(normalizePn(pc.custPN), entry);
  }

  // ========== 7. 구매단가 맵 ==========
  const purchasePriceMap = new Map<string, number>();
  for (const pp of purchasePrices) {
    if (pp.currentPrice > 0) {
      purchasePriceMap.set(normalizePn(pp.itemCode), pp.currentPrice);
      if (pp.customerPn) purchasePriceMap.set(normalizePn(pp.customerPn), pp.currentPrice);
    }
  }

  // ========== 8. 외주사출판매가 맵 ==========
  const outsourcePriceMap = new Map<string, number>();
  for (const op of outsourcePrices) {
    if (op.injectionPrice > 0) {
      outsourcePriceMap.set(normalizePn(op.itemCode), op.injectionPrice);
      if (op.customerPn) outsourcePriceMap.set(normalizePn(op.customerPn), op.injectionPrice);
    }
  }

  // ========== 9. 표준재료비 맵 (JSON fallback + DB item_standard_cost 우선) ==========
  interface StdCostEntry { eaCost: number; resinPerEa: number; paintPerEa: number; supplyType: string; processType: string }
  const stdCostMap = new Map<string, StdCostEntry>();
  for (const sc of fallbackStandardCosts) {
    if (sc.eaCost > 0) {
      const entry: StdCostEntry = { eaCost: sc.eaCost, resinPerEa: 0, paintPerEa: 0, supplyType: '', processType: sc.processType || '' };
      stdCostMap.set(normalizePn(sc.productCode), entry);
      if (sc.customerPn) stdCostMap.set(normalizePn(sc.customerPn), entry);
    }
  }
  // DB item_standard_cost 우선 적용 (calcFromItemStandardCosts 동일 로직)
  for (const sc of itemStandardCosts) {
    const matPerEa = Number((sc as unknown as Record<string, unknown>).material_cost_per_ea) || 0;
    const resinPerEa = Number((sc as unknown as Record<string, unknown>).resin_cost_per_ea) || 0;
    const paintPerEa = Number((sc as unknown as Record<string, unknown>).paint_cost_per_ea) || 0;
    const costVal = matPerEa > 0 ? matPerEa : (resinPerEa + paintPerEa);
    // P/N 매핑 보강
    if (sc.customer_pn && sc.item_code) {
      const cpn = normalizePn(sc.customer_pn);
      const icode = normalizePn(sc.item_code);
      if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
      if (!internalToCust.has(icode)) internalToCust.set(icode, cpn);
    }
    if (costVal > 0) {
      const entry: StdCostEntry = {
        eaCost: costVal, resinPerEa, paintPerEa,
        supplyType: sc.supply_type || '', processType: sc.item_type || '',
      };
      stdCostMap.set(normalizePn(sc.item_code), entry);
      if (sc.customer_pn) stdCostMap.set(normalizePn(sc.customer_pn), entry);
    }
  }

  // item_standard_cost P/N으로 refInfoMap 보강
  for (const sc of itemStandardCosts) {
    if (sc.customer_pn && sc.item_code) {
      const cpn = normalizePn(sc.customer_pn);
      if (!refInfoMap.has(cpn)) {
        const ri = refInfoMap.get(normalizePn(sc.item_code));
        if (ri) refInfoMap.set(cpn, ri);
      }
    }
  }

  // ========== 10. BOM leaf / 도장 중간노드 판정 ==========
  const forceLeafPns = new Set<string>();
  const paintIntermediatePns = new Set<string>();
  for (const ri of refInfo) {
    if (/구매|외주/.test(ri.supplyType || '')) {
      forceLeafPns.add(normalizePn(ri.itemCode));
      if (ri.customerPn) forceLeafPns.add(normalizePn(ri.customerPn));
    }
    if (/도장/.test(ri.processType || '') && !/구매|외주/.test(ri.supplyType || '')) {
      paintIntermediatePns.add(normalizePn(ri.itemCode));
      if (ri.customerPn) paintIntermediatePns.add(normalizePn(ri.customerPn));
    }
  }

  // ========== 11. BOM prefix index (fuzzy 매칭) ==========
  const bomPrefixIndex = new Map<string, string>();
  for (const bk of bomRelations.keys()) {
    for (let len = 8; len <= bk.length; len++) {
      const p = bk.slice(0, len);
      if (!bomPrefixIndex.has(p)) bomPrefixIndex.set(p, bk);
    }
  }

  // ========== 12. 매출실적 맵 (과거월 수량 참조) ==========
  const revenueMap = new Map<string, Map<string, { qty: number; amount: number }>>();
  for (const ar of actualRevenue) {
    const match = ar.period?.match(/(\d{4})-(\d{1,2})/);
    if (!match) continue;
    const monthStr = match[2].padStart(2, '0');
    const keys = [ar.partNo, ar.customerPN].filter(Boolean).map(k => normalizePn(k));
    for (const key of keys) {
      if (!revenueMap.has(key)) revenueMap.set(key, new Map());
      const monthMap = revenueMap.get(key)!;
      const existing = monthMap.get(monthStr) || { qty: 0, amount: 0 };
      existing.qty += ar.qty || 0;
      existing.amount += ar.amount || 0;
      monthMap.set(monthStr, existing);
    }
  }

  // ========== Helper: 도료 가중평균 배합가 ==========
  const getPaintBlendedPrice = (paintCode: string): number => {
    const norm = normalizePn(paintCode);
    const mix = paintMixMap.get(norm);
    if (mix) {
      const mR = mix.mainRatio > 0 ? mix.mainRatio : 0;
      const hR = mix.hardenerRatio > 0 ? mix.hardenerRatio : 0;
      const tR = mix.thinnerRatio > 0 ? mix.thinnerRatio : 0;
      const totalRatio = mR + hR + tR;
      if (totalRatio > 0) return (mix.mainPrice * mR + mix.hardenerPrice * hR + mix.thinnerPrice * tR) / totalRatio;
      if (mix.mainPrice > 0) return mix.mainPrice;
    }
    return priceMap.get(norm) || 0;
  };

  // ========== Helper: leaf 단가 조회 (ProductMaterialCostView.getLeafPrice 동일) ==========
  function getLeafPrice(leafCode: string): { price: number; source: string } {
    const code = normalizePn(leafCode);
    // 1) 표준재료비 EA단가
    const std = stdCostMap.get(code);
    if (std && std.eaCost > 0) return { price: std.eaCost, source: '표준재료비' };
    // 2) 재질코드 직접
    const dp = priceMap.get(code);
    if (dp && dp > 0) return { price: dp, source: '재질코드' };
    // 3) 구매단가 (외주품은 구매-사출=순재료비)
    const pp = purchasePriceMap.get(code);
    if (pp && pp > 0) {
      const riCheck = refInfoMap.get(code);
      if (riCheck && /외주/.test(riCheck.supplyType || '')) {
        const op = outsourcePriceMap.get(code) || 0;
        return { price: Math.max(0, pp - op), source: op > 0 ? '외주(구매-사출)' : '구매단가' };
      }
      return { price: pp, source: '구매단가' };
    }
    // 4) 기준정보: 사출재료비 공식
    const ri = refInfoMap.get(code);
    if (ri) {
      const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        if (/PAINT|도료/i.test(materialTypeMap.get(rawNorm) || '')) continue;
        const rp = priceMap.get(rawNorm);
        if (rp && rp > 0) {
          const nw = ri.netWeight || 0;
          if (nw > 0) {
            const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
            const wpe = nw + (ri.runnerWeight || 0) / cavity;
            return { price: (wpe * rp / 1000) * (1 + (ri.lossRate || 0) / 100), source: '사출산출' };
          }
          return { price: rp, source: '원재료' };
        }
      }
    }
    return { price: 0, source: '' };
  }

  // ========== Helper: BOM 부모 찾기 ==========
  function findBomParent(pn: string): string | null {
    const np = normalizePn(pn);
    if (bomRelations.has(np)) return np;
    const internal = custToInternal.get(np);
    if (internal && bomRelations.has(internal)) return internal;
    const cust = internalToCust.get(np);
    if (cust && bomRelations.has(cust)) return cust;
    if (np.length >= 10) {
      for (let pl = np.length - 1; pl >= 8; pl--) {
        const candidate = bomPrefixIndex.get(np.slice(0, pl));
        if (candidate && bomRelations.has(candidate)) return candidate;
      }
    }
    return null;
  }

  // ========== Helper: 제품별 도장비 산출 ==========
  function calcProductPaintCost(forecastPn: string, productRef: ReferenceInfoRecord | undefined): number {
    // 1순위: 실측
    const measured = paintConsumptionMap.get(forecastPn)
      || paintConsumptionMap.get(custToInternal.get(forecastPn) || '')
      || paintConsumptionMap.get(internalToCust.get(forecastPn) || '');
    if (measured && measured.paintCostPerEa > 0) return measured.paintCostPerEa;
    // 2순위: 기준정보 paintQty × 배합가 ÷ lotQty
    // paintQty1~4 = LOT 기준 총 투입량(g), lotQty = LOT당 생산수량
    if (productRef && /도장/i.test(productRef.processType || '')) {
      const rawCodes = [productRef.rawMaterialCode1, productRef.rawMaterialCode2, productRef.rawMaterialCode3, productRef.rawMaterialCode4 || ''].filter(Boolean) as string[];
      const paintQtys = [productRef.paintQty1, productRef.paintQty2, productRef.paintQty3, productRef.paintQty4 || 0];
      const lossM = 1 + ((productRef.lossRate || 0) / 100);
      const lotDivisor = (productRef.lotQty && productRef.lotQty > 0) ? productRef.lotQty : 1;
      let total = 0;
      for (let i = 0; i < rawCodes.length; i++) {
        const pp = getPaintBlendedPrice(rawCodes[i]);
        const pq = paintQtys[i] || 0;
        if (pp > 0 && pq > 0) total += (pp * pq / 1000) * lossM / lotDivisor;
      }
      return total;
    }
    return 0;
  }

  // ========== 제품별 산출 ==========
  let totalResin = 0, totalPaint = 0, totalPurchase = 0, totalOutsource = 0, totalRevenue = 0;
  const itemRows: CalcItemRow[] = [];

  /** 특정 제품의 월별 수량/매출 결정 헬퍼 */
  function getMonthQtyRevenue(f: ForecastItem, mi: number): { qty: number; revenue: number } {
    const ms = String(mi + 1).padStart(2, '0');
    if (mi < currentMonth) {
      const actual = revenueMap.get(normalizePn(f.newPartNo || f.partNo))?.get(ms)
        || revenueMap.get(normalizePn(f.partNo))?.get(ms);
      if (actual && actual.qty > 0) return { qty: actual.qty, revenue: actual.amount };
      return { qty: f.monthlyQty?.[mi] || 0, revenue: f.monthlyRevenue?.[mi] || 0 };
    }
    return { qty: f.monthlyQty?.[mi] || 0, revenue: f.monthlyRevenue?.[mi] || 0 };
  }

  for (const f of forecastData) {
    const forecastPn = normalizePn(f.newPartNo || f.partNo);

    // ---- 수량 결정: monthIndex=-1이면 12개월 합산 (ProductMaterialCostView "all" 동일) ----
    let qty = 0, revenue = 0;
    if (monthIndex === -1) {
      for (let m = 0; m < 12; m++) {
        const mr = getMonthQtyRevenue(f, m);
        qty += mr.qty;
        revenue += mr.revenue;
      }
    } else {
      const mr = getMonthQtyRevenue(f, monthIndex);
      qty = mr.qty;
      revenue = mr.revenue;
    }
    if (qty <= 0) continue;
    totalRevenue += revenue;

    // ---- 기준정보 매칭 ----
    const productRef = refInfoMap.get(forecastPn)
      || refInfoMap.get(custToInternal.get(forecastPn) || '')
      || refInfoMap.get(internalToCust.get(forecastPn) || '')
      || (f.partNo ? refInfoMap.get(normalizePn(f.partNo)) : undefined)
      || (f.partNo ? refInfoMap.get(custToInternal.get(normalizePn(f.partNo)) || '') : undefined)
      || (f.newPartNo ? refInfoMap.get(custToInternal.get(normalizePn(f.newPartNo)) || '') : undefined);

    // ---- 1. BOM 전개 재료비 ----
    const bomParent = findBomParent(forecastPn);
    let bomMaterialCost = 0;
    if (bomParent) {
      const leaves = expandBomToLeaves(bomParent, 1, bomRelations, undefined, 0, 10, forceLeafPns, paintIntermediatePns);
      for (const leaf of leaves) {
        const { price } = getLeafPrice(leaf.childPn);
        bomMaterialCost += leaf.totalRequired * price;
      }
    }

    // ---- 2. 도장재료비 (bomMaterialCost에 합산) ----
    const paintCost = calcProductPaintCost(forecastPn, productRef);
    if (paintCost > 0) bomMaterialCost += paintCost;

    // ---- 3. 표준재료비 조회 ----
    const stdEntry = stdCostMap.get(forecastPn)
      || stdCostMap.get(custToInternal.get(forecastPn) || '')
      || stdCostMap.get(internalToCust.get(forecastPn) || '');
    const stdMaterialCost = stdEntry?.eaCost || 0;

    // ---- 4. 기준정보 직접산출 (stdCost/BOM 모두 없을 때) ----
    let refInfoCost = 0;
    if (stdMaterialCost <= 0 && bomMaterialCost <= 0 && productRef) {
      const st = productRef.supplyType || '';
      if (/구매/.test(st)) {
        const pp = purchasePriceMap.get(forecastPn)
          || purchasePriceMap.get(custToInternal.get(forecastPn) || '')
          || purchasePriceMap.get(internalToCust.get(forecastPn) || '');
        if (pp && pp > 0) refInfoCost = pp;
      } else if (/외주/.test(st)) {
        const pp = purchasePriceMap.get(forecastPn)
          || purchasePriceMap.get(custToInternal.get(forecastPn) || '')
          || purchasePriceMap.get(internalToCust.get(forecastPn) || '');
        const op = outsourcePriceMap.get(forecastPn)
          || outsourcePriceMap.get(custToInternal.get(forecastPn) || '')
          || outsourcePriceMap.get(internalToCust.get(forecastPn) || '');
        if (pp && pp > 0) refInfoCost = Math.max(0, pp - (op || 0));
      } else {
        // 자작: 사출 공식
        const nw = productRef.netWeight || 0;
        if (nw > 0) {
          const rawCodes = [productRef.rawMaterialCode1, productRef.rawMaterialCode2].filter(Boolean) as string[];
          for (const raw of rawCodes) {
            const rawNorm = normalizePn(raw);
            if (/PAINT|도료/i.test(materialTypeMap.get(rawNorm) || '')) continue;
            const rawPrice = priceMap.get(rawNorm);
            if (rawPrice && rawPrice > 0) {
              const cavity = (productRef.cavity && productRef.cavity > 0) ? productRef.cavity : 1;
              const wpe = nw + (productRef.runnerWeight || 0) / cavity;
              refInfoCost += (wpe * rawPrice / 1000) * (1 + (productRef.lossRate || 0) / 100);
              break;
            }
          }
        }
        refInfoCost += paintCost; // 도장비 합산
      }
    }

    // ---- 5. 최종 재료비 (ProductMaterialCostView 동일 우선순위) ----
    const materialCost = stdMaterialCost > 0 ? stdMaterialCost
      : bomMaterialCost > 0 ? bomMaterialCost
      : refInfoCost;
    if (materialCost <= 0) continue;

    const totalMaterialAmt = materialCost * qty;

    // ---- 유형별 분류 ----
    let resinAmt = 0, paintAmt = 0, purchaseAmt = 0, outsourceAmt = 0;
    const supplyType = stdEntry?.supplyType || productRef?.supplyType || '';
    const processType = stdEntry?.processType || productRef?.processType || '';

    if (/구매/.test(supplyType)) {
      purchaseAmt = totalMaterialAmt;
    } else if (/외주/.test(supplyType)) {
      outsourceAmt = totalMaterialAmt;
    } else if (stdMaterialCost > 0 && stdEntry) {
      // 자작 - stdCost 분리: resin/paint/기타
      resinAmt = (stdEntry.resinPerEa || 0) * qty;
      paintAmt = (stdEntry.paintPerEa || 0) * qty;
      const other = Math.max(0, totalMaterialAmt - resinAmt - paintAmt);
      purchaseAmt = other;
    } else {
      // 자작 - BOM/refInfo 기반: 도장비 분리
      paintAmt = paintCost * qty;
      resinAmt = Math.max(0, totalMaterialAmt - paintAmt);
    }

    totalResin += resinAmt;
    totalPaint += paintAmt;
    totalPurchase += purchaseAmt;
    totalOutsource += outsourceAmt;

    itemRows.push({
      itemCode: f.newPartNo || f.partNo,
      customerPn: f.partNo,
      itemName: f.partName || '',
      supplyType: supplyType || (resinAmt > 0 ? '자작' : purchaseAmt > 0 ? '구매' : outsourceAmt > 0 ? '외주' : ''),
      processType,
      production: qty,
      injectionCost: resinAmt > 0 ? resinAmt / qty : 0,
      paintCostPerEa: paintAmt > 0 ? paintAmt / qty : 0,
      purchaseCostPerEa: (purchaseAmt + outsourceAmt) > 0 ? (purchaseAmt + outsourceAmt) / qty : 0,
      totalCostPerEa: materialCost,
      resinAmount: resinAmt,
      paintAmount: paintAmt,
      purchaseAmount: purchaseAmt + outsourceAmt,
      totalAmount: totalMaterialAmt,
      source: stdMaterialCost > 0 ? 'excel' : bomMaterialCost > 0 ? 'bom' : 'calc',
    });
  }

  const totalStandard = totalResin + totalPaint + totalPurchase + totalOutsource;
  const standardRatio = totalRevenue > 0 ? totalStandard / totalRevenue : 0;

  const summaryByType: SummaryByType[] = [
    { name: 'RESIN', standard: totalResin, actual: 0 },
    { name: 'PAINT', standard: totalPaint, actual: 0 },
    { name: '구매', standard: totalPurchase, actual: 0 },
    { name: '외주', standard: totalOutsource, actual: 0 },
  ];

  console.log(`[통합재료비] forecast ${forecastData.length}건 → 산출 ${itemRows.length}건 → RESIN ₩${Math.round(totalResin).toLocaleString()}, PAINT ₩${Math.round(totalPaint).toLocaleString()}, 구매 ₩${Math.round(totalPurchase).toLocaleString()}, 외주 ₩${Math.round(totalOutsource).toLocaleString()}, NET ₩${Math.round(totalStandard).toLocaleString()}`);

  return {
    summaryByType,
    itemRows,
    totalStandard,
    revenue: totalRevenue,
    standardRatio,
    calcSource: 'ProductBased',
    stats: {
      excelItems: itemRows.filter(r => r.source === 'excel').length,
      calcItems: itemRows.filter(r => r.source === 'calc').length,
      bomItems: itemRows.filter(r => r.source === 'bom').length,
      totalItems: itemRows.length,
    },
  };
}
