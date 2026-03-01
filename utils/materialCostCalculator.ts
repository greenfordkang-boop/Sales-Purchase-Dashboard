
import {
  StandardMaterialItem,
  ProductInfoItem,
  MaterialPrice,
  PurchasePrice,
  OutsourcePrice,
  PaintMixRatio,
  StandardMaterialData,
  ItemStandardCost,
} from './standardMaterialParser';
import { ReferenceInfoRecord, MaterialCodeRecord } from './bomMasterParser';

// ============================================================
// Types
// ============================================================

/** 참조 데이터 통합 */
export interface ReferenceData {
  materialPrices: Map<string, number>;   // 재질코드 → 단가(원/kg)
  purchasePrices: Map<string, number>;   // 품목코드 → 단가
  outsourcePrices: Map<string, number>;  // 품목코드 → 사출판매가
  paintMixMap: Map<string, PaintMixRatio>; // 도료코드 → 배합비율
  productInfoMap: Map<string, ProductInfoItem>; // 품목코드 → 품목정보
}

/** 유형별 요약 */
export interface SummaryByType {
  name: string;       // 'RESIN' | 'PAINT' | '구매' | '외주'
  standard: number;
  actual: number;
}

/** 상세 품목 행 */
export interface CalcItemRow {
  itemCode: string;
  customerPn: string;
  itemName: string;
  supplyType: string;
  processType: string;
  production: number;      // 월별 생산수량
  injectionCost: number;   // 단품 사출재료비 (원/EA)
  paintCostPerEa: number;  // 단품 도장재료비 (원/EA)
  purchaseCostPerEa: number; // 단품 구매/외주 재료비 (원/EA)
  totalCostPerEa: number;  // 단품 합계 (원/EA)
  resinAmount: number;     // 사출재료비 × 생산량
  paintAmount: number;     // 도장재료비 × 생산량
  purchaseAmount: number;  // 구매재료비 × 생산량 (or 외주)
  totalAmount: number;     // 합계 금액
  source: 'excel' | 'calc' | 'bom';  // 산출 경로
}

/** 통합 산출 결과 */
export interface UnifiedCalcResult {
  summaryByType: SummaryByType[];
  itemRows: CalcItemRow[];
  totalStandard: number;
  revenue: number;
  standardRatio: number;
  calcSource: string;
  stats: {
    excelItems: number;
    calcItems: number;
    bomItems: number;
    totalItems: number;
  };
}

// ============================================================
// Helper
// ============================================================

const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

// ============================================================
// 단품 산출 함수
// ============================================================

/** 단품 사출재료비 계산 (원/EA) */
export function calcInjectionCost(
  product: ProductInfoItem,
  materialPrices: Map<string, number>,
): number {
  if (product.netWeight <= 0) return 0;

  const cavity = product.cavity > 0 ? product.cavity : 1;
  const lossMultiplier = 1 + (product.lossRate > 0 ? product.lossRate / 100 : 0);

  // Resin1 (원재료코드1)
  let resinPrice = 0;
  if (product.rawMaterialCode1) {
    resinPrice = materialPrices.get(normalizePn(product.rawMaterialCode1)) || 0;
  }
  // Resin2 (원재료코드2) - 보통 같은 가격이지만 혼합 가능
  let resin2Price = 0;
  if (product.rawMaterialCode2) {
    resin2Price = materialPrices.get(normalizePn(product.rawMaterialCode2)) || 0;
  }

  // 기본 공식: (NET중량 + Runner중량/Cavity) × Resin단가/1000 × (1+Loss율)
  const effectivePrice = resinPrice || resin2Price;
  if (effectivePrice <= 0) return 0;

  const weightPerEa = product.netWeight + (product.runnerWeight / cavity);
  return (weightPerEa * effectivePrice / 1000) * lossMultiplier;
}

/** 단품 도장재료비 계산 (원/EA) */
export function calcPaintCost(
  product: ProductInfoItem,
  paintMixMap: Map<string, PaintMixRatio>,
  materialPrices: Map<string, number>,
): number {
  const lossMultiplier = 1 + (product.lossRate > 0 ? product.lossRate / 100 : 0);
  let totalPaintCost = 0;

  // 각 도 (1~3도) 처리
  // 도장 제품은 rawMaterialCode1=1도, rawMaterialCode2=2도에 도료코드 저장
  const paintQtys = [product.paintQty1, product.paintQty2, product.paintQty3];
  const paintCodes = [product.rawMaterialCode1, product.rawMaterialCode2, product.rawMaterialCode3];

  for (let d = 0; d < 3; d++) {
    const qty = paintQtys[d];
    if (qty <= 0) continue;

    const paintCode = paintCodes[d];
    if (!paintCode) {
      // 도료코드 없으면 재질단가에서 직접 조회
      continue;
    }

    const mix = paintMixMap.get(normalizePn(paintCode));
    if (mix) {
      // 배합비율 기반 산출
      const mainP = mix.mainPrice > 0 ? mix.mainPrice : (materialPrices.get(normalizePn(mix.mainCode)) || 0);
      const hardP = mix.hardenerPrice > 0 ? mix.hardenerPrice : (materialPrices.get(normalizePn(mix.hardenerCode)) || 0);
      const thinP = mix.thinnerPrice > 0 ? mix.thinnerPrice : (materialPrices.get(normalizePn(mix.thinnerCode)) || 0);

      const mainRatio = mix.mainRatio > 0 ? mix.mainRatio / 100 : 1;
      const hardRatio = mix.hardenerRatio > 0 ? mix.hardenerRatio / 100 : 0;
      const thinRatio = mix.thinnerRatio > 0 ? mix.thinnerRatio / 100 : 0;

      const mixedPrice = mainP * mainRatio + hardP * hardRatio + thinP * thinRatio;
      totalPaintCost += (qty * mixedPrice / 1000) * lossMultiplier;
    } else {
      // 배합 정보 없음 → 재질단가에서 직접 가격 조회
      const directPrice = materialPrices.get(normalizePn(paintCode)) || 0;
      if (directPrice > 0) {
        totalPaintCost += (qty * directPrice / 1000) * lossMultiplier;
      }
    }
  }

  return totalPaintCost;
}

/** 단품 구매재료비 (원/EA) */
export function calcPurchaseCost(
  itemCode: string,
  customerPn: string,
  purchasePrices: Map<string, number>,
): number {
  const price = purchasePrices.get(normalizePn(itemCode))
    || purchasePrices.get(normalizePn(customerPn))
    || 0;
  return price;
}

/** 단품 외주재료비 (원/EA) */
export function calcOutsourceCost(
  itemCode: string,
  customerPn: string,
  outsourcePrices: Map<string, number>,
): number {
  const price = outsourcePrices.get(normalizePn(itemCode))
    || outsourcePrices.get(normalizePn(customerPn))
    || 0;
  return price;
}

// ============================================================
// 참조 데이터 빌드
// ============================================================

/** StandardMaterialData에서 ReferenceData 구성 */
export function buildReferenceData(data: StandardMaterialData): ReferenceData {
  const materialPrices = new Map<string, number>();
  data.materialPrices?.forEach(mp => {
    if (mp.materialCode && mp.currentPrice > 0) {
      materialPrices.set(normalizePn(mp.materialCode), mp.currentPrice);
    }
  });

  const purchasePrices = new Map<string, number>();
  data.purchasePrices?.forEach(pp => {
    if (pp.itemCode && pp.currentPrice > 0) {
      purchasePrices.set(normalizePn(pp.itemCode), pp.currentPrice);
      if (pp.customerPn) purchasePrices.set(normalizePn(pp.customerPn), pp.currentPrice);
    }
  });

  const outsourcePrices = new Map<string, number>();
  data.outsourcePrices?.forEach(op => {
    if (op.itemCode && op.injectionPrice > 0) {
      outsourcePrices.set(normalizePn(op.itemCode), op.injectionPrice);
      if (op.customerPn) outsourcePrices.set(normalizePn(op.customerPn), op.injectionPrice);
    }
  });

  const paintMixMap = new Map<string, PaintMixRatio>();
  data.paintMixRatios?.forEach(pm => {
    // 도료배합의 주제/경화제/신너 단가를 재질단가에서 채움
    const enriched = { ...pm };
    if (enriched.mainPrice <= 0 && enriched.mainCode) {
      enriched.mainPrice = materialPrices.get(normalizePn(enriched.mainCode)) || 0;
    }
    if (enriched.hardenerPrice <= 0 && enriched.hardenerCode) {
      enriched.hardenerPrice = materialPrices.get(normalizePn(enriched.hardenerCode)) || 0;
    }
    if (enriched.thinnerPrice <= 0 && enriched.thinnerCode) {
      enriched.thinnerPrice = materialPrices.get(normalizePn(enriched.thinnerCode)) || 0;
    }
    if (pm.paintCode) paintMixMap.set(normalizePn(pm.paintCode), enriched);
    // 주제코드로도 매핑 (품목정보의 원재료코드3/4 → 주제코드와 연결)
    if (pm.mainCode) paintMixMap.set(normalizePn(pm.mainCode), enriched);
  });

  const productInfoMap = new Map<string, ProductInfoItem>();
  data.productInfo?.forEach(pi => {
    if (pi.itemCode) productInfoMap.set(normalizePn(pi.itemCode), pi);
    if (pi.customerPn) productInfoMap.set(normalizePn(pi.customerPn), pi);
  });

  return { materialPrices, purchasePrices, outsourcePrices, paintMixMap, productInfoMap };
}

// ============================================================
// 통합 산출 엔진
// ============================================================

/**
 * 통합 표준재료비 산출: 종합 + 상세를 동시에 생성 (일원화)
 *
 * 3-way 조달구분 분기:
 * - 자작: RESIN(injCost×qty) + PAINT(pntCost×qty)
 * - 구매: purchasePrice × qty → 구매
 * - 외주: purchasePrice × qty → 외주
 *
 * forecastQtyMap이 있으면: 매출계획 수량 × 재료비.xlsx 단가 (표준 산출)
 * forecastQtyMap이 없으면: 재료비.xlsx 자체 매입금액 기반 (과거 기준)
 */
export function calcUnifiedMaterialCost(
  excelData: StandardMaterialData,
  monthIdx: number,   // 0-11 for specific month, -1 for all
  revenue: number,    // 해당 기간 매출액
  forecastQtyMap?: Map<string, number>,  // normalizedCode → 매출계획 수량
): UnifiedCalcResult {
  const items = excelData.items || [];
  const ref = buildReferenceData(excelData);
  const itemRows: CalcItemRow[] = [];
  const useForecast = forecastQtyMap && forecastQtyMap.size > 0;

  let totalResin = 0, totalPaint = 0, totalPurchase = 0, totalOutsource = 0;
  let excelCount = 0, calcCount = 0, bomCount = 0;
  let forecastMatched = 0, forecastFallback = 0;

  for (const item of items) {
    if (!item.itemCode) continue;
    const normalizedCode = normalizePn(item.itemCode);
    const normalizedCust = item.customerPn ? normalizePn(item.customerPn) : '';

    // ── 생산수량 결정: 매출계획 우선, 없으면 재료비.xlsx 자체 수량으로 폴백 ──
    let production: number;
    let itemUseForecast = false; // 이 품목이 forecast 수량을 사용하는지 여부
    if (useForecast) {
      const fQty = forecastQtyMap!.get(normalizedCode)
        || (normalizedCust ? forecastQtyMap!.get(normalizedCust) : 0)
        || 0;
      if (fQty > 0) {
        production = fQty;
        itemUseForecast = true;
        forecastMatched++;
      } else {
        // 폴백: 재료비.xlsx 자체 수량
        production = monthIdx >= 0
          ? (item.monthlyProduction?.[monthIdx] || 0)
          : (item.totalProduction || 0);
        if (production <= 0) continue;
        forecastFallback++;
      }
    } else {
      production = monthIdx >= 0
        ? (item.monthlyProduction?.[monthIdx] || 0)
        : (item.totalProduction || 0);
      if (production <= 0) continue;
    }

    const isOutsource = item.supplyType?.includes('외주');
    const isPurchase = item.supplyType === '구매';

    let resinAmt = 0, paintAmt = 0, purchaseAmt = 0;
    let injCostPerEa = 0, pntCostPerEa = 0, purCostPerEa = 0;

    // 이 품목의 월별 매입금액 (xlsx 폴백 시 사용)
    const monthlyAmt = monthIdx >= 0
      ? (item.monthlyAmount?.[monthIdx] || 0)
      : (item.totalAmount || 0);

    if (isOutsource || isPurchase) {
      // ── 구매/외주 ──
      if (itemUseForecast) {
        // 매출계획 매칭: 단가 × forecast수량
        purCostPerEa = item.purchasePrice || 0;
        if (purCostPerEa <= 0) {
          if (isOutsource) {
            purCostPerEa = calcOutsourceCost(item.itemCode, item.customerPn, ref.outsourcePrices);
          } else {
            purCostPerEa = calcPurchaseCost(item.itemCode, item.customerPn, ref.purchasePrices);
          }
        }
        if (purCostPerEa <= 0) {
          const histProd = item.totalProduction || 0;
          const histAmt = item.totalAmount || 0;
          if (histProd > 0 && histAmt > 0) purCostPerEa = histAmt / histProd;
        }
        purchaseAmt = purCostPerEa * production;
      } else {
        // xlsx 폴백: 매입금액 전액
        purchaseAmt = monthlyAmt;
        purCostPerEa = production > 0 ? purchaseAmt / production : 0;
      }
    } else {
      // ── 자작: RESIN + PAINT ──
      injCostPerEa = item.injectionCost || 0;
      pntCostPerEa = item.paintCost || 0;

      // Tier 2: 참조데이터 보완 (단가가 0이면)
      if (injCostPerEa <= 0 || pntCostPerEa <= 0) {
        const productInfo = ref.productInfoMap.get(normalizedCode)
          || (normalizedCust ? ref.productInfoMap.get(normalizedCust) : undefined);

        // forecast 매칭: 항상 참조데이터 적용 / xlsx 폴백: 매입금액>0일 때만
        const shouldApplyRef = itemUseForecast || (monthlyAmt > 0);

        if (shouldApplyRef && productInfo) {
          if (injCostPerEa <= 0 && productInfo.netWeight > 0) {
            injCostPerEa = calcInjectionCost(productInfo, ref.materialPrices);
          }
          if (pntCostPerEa <= 0) {
            pntCostPerEa = calcPaintCost(productInfo, ref.paintMixMap, ref.materialPrices);
          }
        }
      }

      resinAmt = injCostPerEa * production;
      paintAmt = pntCostPerEa * production;

      if (itemUseForecast) {
        // forecast 매칭: RESIN + PAINT만 (잔액 없음)
        purchaseAmt = 0;
      } else {
        // xlsx 폴백: 잔액 = 매입금액 - RESIN - PAINT
        if (monthlyAmt > 0) {
          purchaseAmt = Math.max(0, monthlyAmt - resinAmt - paintAmt);
        }
      }
      purCostPerEa = production > 0 ? purchaseAmt / production : 0;
    }

    const totalAmt = resinAmt + paintAmt + purchaseAmt;
    const totalCostPerEa = injCostPerEa + pntCostPerEa + purCostPerEa;

    const source = (item.injectionCost > 0 || item.paintCost > 0 || item.purchasePrice > 0)
      ? 'excel' as const : 'calc' as const;

    if (source === 'excel') excelCount++;
    else calcCount++;

    totalResin += resinAmt;
    totalPaint += paintAmt;
    if (isOutsource) totalOutsource += purchaseAmt;
    else totalPurchase += purchaseAmt;

    itemRows.push({
      itemCode: item.itemCode,
      customerPn: item.customerPn || '',
      itemName: item.itemName || '',
      supplyType: item.supplyType || '',
      processType: item.processType || '',
      production,
      injectionCost: injCostPerEa,
      paintCostPerEa: pntCostPerEa,
      purchaseCostPerEa: purCostPerEa,
      totalCostPerEa,
      resinAmount: resinAmt,
      paintAmount: paintAmt,
      purchaseAmount: purchaseAmt,
      totalAmount: totalAmt,
      source,
    });
  }

  // 합계
  const totalStandard = totalResin + totalPaint + totalPurchase + totalOutsource;

  const summaryByType: SummaryByType[] = [
    { name: 'RESIN', standard: totalResin, actual: 0 },
    { name: 'PAINT', standard: totalPaint, actual: 0 },
    { name: '구매', standard: totalPurchase, actual: 0 },
    { name: '외주', standard: totalOutsource, actual: 0 },
  ].filter(t => t.standard > 0);

  const standardRatio = revenue > 0 ? totalStandard / revenue : 0;

  if (useForecast) {
    console.log(`[표준재료비] 매출계획 기반 산출: 매칭 ${forecastMatched}건, xlsx폴백 ${forecastFallback}건`);
  }

  return {
    summaryByType,
    itemRows,
    totalStandard,
    revenue,
    standardRatio,
    calcSource: useForecast ? 'Forecast+Excel' : (excelCount > 0 ? 'Excel+Ref' : calcCount > 0 ? 'RefCalc' : 'None'),
    stats: {
      excelItems: excelCount,
      calcItems: calcCount,
      bomItems: bomCount,
      totalItems: itemRows.length,
    },
  };
}

/**
 * 월별 통합 산출 (12개월 배열)
 */
export function calcMonthlyUnified(
  excelData: StandardMaterialData,
  monthlyRevenue: number[], // 12 elements
  monthlyForecastQtyMaps?: (Map<string, number> | undefined)[],
): UnifiedCalcResult[] {
  return monthlyRevenue.map((rev, mi) =>
    calcUnifiedMaterialCost(excelData, mi, rev, monthlyForecastQtyMaps?.[mi])
  );
}

// ============================================================
// 마스터 테이블 → ReferenceData 변환
// ============================================================

/**
 * BOM 마스터의 기준정보 + 재질코드 → ReferenceData 구성
 * StandardMaterialCostView에서 'master' 모드로 사용
 */
export function buildReferenceDataFromMasters(
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
  purchasePriceRecords?: PurchasePrice[],
  outsourcePriceRecords?: OutsourcePrice[],
  paintMixRatioRecords?: PaintMixRatio[],
): ReferenceData {
  const materialPrices = new Map<string, number>();
  for (const mc of materialCodes) {
    if (mc.materialCode && mc.currentPrice > 0) {
      materialPrices.set(normalizePn(mc.materialCode), mc.currentPrice);
    }
  }

  // 구매단가 Map
  const purchasePrices = new Map<string, number>();
  if (purchasePriceRecords) {
    for (const pp of purchasePriceRecords) {
      if (pp.itemCode && pp.currentPrice > 0) {
        purchasePrices.set(normalizePn(pp.itemCode), pp.currentPrice);
        if (pp.customerPn) purchasePrices.set(normalizePn(pp.customerPn), pp.currentPrice);
      }
    }
  }

  // 외주사출판매가 Map
  const outsourcePrices = new Map<string, number>();
  if (outsourcePriceRecords) {
    for (const op of outsourcePriceRecords) {
      if (op.itemCode && op.injectionPrice > 0) {
        outsourcePrices.set(normalizePn(op.itemCode), op.injectionPrice);
        if (op.customerPn) outsourcePrices.set(normalizePn(op.customerPn), op.injectionPrice);
      }
    }
  }

  // 도료배합비율 Map (단가는 materialPrices에서 enrich)
  const paintMixMap = new Map<string, PaintMixRatio>();
  if (paintMixRatioRecords) {
    for (const pm of paintMixRatioRecords) {
      const enriched = { ...pm };
      if (enriched.mainPrice <= 0 && enriched.mainCode) {
        enriched.mainPrice = materialPrices.get(normalizePn(enriched.mainCode)) || 0;
      }
      if (enriched.hardenerPrice <= 0 && enriched.hardenerCode) {
        enriched.hardenerPrice = materialPrices.get(normalizePn(enriched.hardenerCode)) || 0;
      }
      if (enriched.thinnerPrice <= 0 && enriched.thinnerCode) {
        enriched.thinnerPrice = materialPrices.get(normalizePn(enriched.thinnerCode)) || 0;
      }
      if (pm.paintCode) paintMixMap.set(normalizePn(pm.paintCode), enriched);
      if (pm.mainCode) paintMixMap.set(normalizePn(pm.mainCode), enriched);
    }
  }

  const productInfoMap = new Map<string, ProductInfoItem>();
  for (const ri of refInfo) {
    if (!ri.itemCode) continue;
    const pi: ProductInfoItem = {
      itemCode: ri.itemCode,
      customerPn: ri.customerPn,
      itemName: ri.itemName,
      itemType: ri.itemCategory || '',
      processType: ri.processType || '',
      supplyType: ri.supplyType || '',
      netWeight: ri.netWeight,
      cavity: ri.cavity || 1,
      lossRate: ri.lossRate,
      runnerWeight: ri.runnerWeight,
      rawMaterialCode1: ri.rawMaterialCode1 || '',
      rawMaterialCode2: ri.rawMaterialCode2 || '',
      rawMaterialCode3: ri.rawMaterialCode3 || '',
      rawMaterialCode4: ri.rawMaterialCode4 || '',
      paintQty1: ri.paintQty1,
      paintQty2: ri.paintQty2,
      paintQty3: ri.paintQty3,
    };
    productInfoMap.set(normalizePn(ri.itemCode), pi);
    if (ri.customerPn) productInfoMap.set(normalizePn(ri.customerPn), pi);
  }

  return { materialPrices, purchasePrices, outsourcePrices, paintMixMap, productInfoMap };
}

// ============================================================
// 마스터 데이터 기반 표준재료비 산출 엔진
// ============================================================

import { BomRecord, buildBomRelations, expandBomToLeaves } from './bomDataParser';

/**
 * BOM 트리의 모든 노드(자신 포함)를 순회하며 (childPn, accumulatedQty) 반환.
 * expandBomToLeaves와 달리 중간 노드도 포함한다.
 */
function getAllBomDescendants(
  parentPn: string,
  parentQty: number,
  bomRelations: Map<string, BomRecord[]>,
  visited?: Set<string>,
  depth: number = 0,
): { childPn: string; childName: string; accQty: number }[] {
  const seen = visited || new Set<string>();
  const np = normalizePn(parentPn);
  if (seen.has(np)) return [];
  seen.add(np);

  const children = bomRelations.get(np);
  if (!children || children.length === 0) return [];

  const results: { childPn: string; childName: string; accQty: number }[] = [];
  for (const child of children) {
    const accQty = parentQty * child.qty;
    const nc = normalizePn(child.childPn);
    // 자신을 포함
    results.push({ childPn: nc, childName: child.childName, accQty });
    // 재귀 (최대 깊이 8)
    if (depth < 8) {
      const sub = getAllBomDescendants(nc, accQty, bomRelations, new Set(seen), depth + 1);
      results.push(...sub);
    }
  }
  return results;
}

/**
 * BOM 마스터 + 기준정보 + 재질코드 기반 표준재료비 산출
 *
 * BOM 트리를 전체 순회하며 각 노드(중간 포함)의 사출/도장 원가를 합산.
 * 조립품 → 사출품/도장품 하위 전개, 각 노드의 기준정보에서 원가 계산.
 */
export function calcMasterMaterialCost(
  bomRecords: BomRecord[],
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
  productQtyMap: Map<string, number>,  // normalizedCode → 생산수량
  revenue: number,
  purchasePriceRecords?: PurchasePrice[],
  outsourcePriceRecords?: OutsourcePrice[],
  paintMixRatioRecords?: PaintMixRatio[],
): UnifiedCalcResult {
  const ref = buildReferenceDataFromMasters(refInfo, materialCodes, purchasePriceRecords, outsourcePriceRecords, paintMixRatioRecords);
  const rawRelations = buildBomRelations(bomRecords);
  const bomRelations = new Map<string, BomRecord[]>();
  for (const [key, val] of rawRelations) {
    bomRelations.set(normalizePn(key), val);
  }

  // 제품별 원가 누적 (중복 방지: 같은 itemCode는 합산)
  const costAccum = new Map<string, {
    info: ProductInfoItem;
    totalQty: number;
    injPerEa: number;
    pntPerEa: number;
    purchPerEa: number;    // 구매단가 (원/EA)
    outsrcPerEa: number;   // 외주사출판매가 (원/EA)
    costType: 'self' | 'purchase' | 'outsource';
  }>();

  let bomCount = 0;
  let bomMissing = 0;

  const addToCostAccum = (
    key: string,
    info: ProductInfoItem,
    qty: number,
    inj: number,
    pnt: number,
    purch: number,
    outsrc: number,
    costType: 'self' | 'purchase' | 'outsource',
  ) => {
    const existing = costAccum.get(key);
    if (existing) {
      existing.totalQty += qty;
    } else {
      costAccum.set(key, { info, totalQty: qty, injPerEa: inj, pntPerEa: pnt, purchPerEa: purch, outsrcPerEa: outsrc, costType });
    }
  };

  for (const [productCode, qty] of productQtyMap) {
    if (qty <= 0) continue;

    // BOM 키 탐색
    let bomKey: string | null = null;
    if (bomRelations.has(productCode)) {
      bomKey = productCode;
    } else {
      const pi = ref.productInfoMap.get(productCode);
      if (pi) {
        const internalKey = normalizePn(pi.itemCode);
        if (bomRelations.has(internalKey)) bomKey = internalKey;
        if (!bomKey && pi.customerPn) {
          const custKey = normalizePn(pi.customerPn);
          if (bomRelations.has(custKey)) bomKey = custKey;
        }
      }
    }

    if (!bomKey) {
      // BOM에 없더라도 제품 자체에 원가 데이터가 있으면 직접 산출
      const directInfo = ref.productInfoMap.get(productCode);
      if (directInfo) {
        const key = normalizePn(directInfo.itemCode);
        const isPurchase = directInfo.supplyType === '구매';
        const isOutsource = directInfo.supplyType?.includes('외주');

        if (isPurchase) {
          const purch = calcPurchaseCost(directInfo.itemCode, directInfo.customerPn || '', ref.purchasePrices);
          if (purch > 0) {
            addToCostAccum(key, directInfo, qty, 0, 0, purch, 0, 'purchase');
            bomCount++;
          } else {
            bomMissing++;
          }
        } else if (isOutsource) {
          // 외주: 자체사출 없음(inj=0), NET = 구매단가 - 사출판매가
          const pnt = calcPaintCost(directInfo, ref.paintMixMap, ref.materialPrices);
          const purch = calcPurchaseCost(directInfo.itemCode, directInfo.customerPn || '', ref.purchasePrices);
          const outsrc = calcOutsourceCost(directInfo.itemCode, directInfo.customerPn || '', ref.outsourcePrices);
          if (purch > 0 || outsrc > 0) {
            addToCostAccum(key, directInfo, qty, 0, pnt, purch, outsrc, 'outsource');
            bomCount++;
          } else {
            bomMissing++;
          }
        } else if (directInfo.netWeight > 0 || directInfo.paintQty1 > 0) {
          const inj = directInfo.netWeight > 0 ? calcInjectionCost(directInfo, ref.materialPrices) : 0;
          const pnt = calcPaintCost(directInfo, ref.paintMixMap, ref.materialPrices);
          if (inj > 0 || pnt > 0) {
            addToCostAccum(key, directInfo, qty, inj, pnt, 0, 0, 'self');
            bomCount++;
          } else {
            bomMissing++;
          }
        } else {
          bomMissing++;
        }
      } else {
        bomMissing++;
      }
      continue;
    }

    bomCount++;

    // (1) 제품 자체의 원가
    const productInfo = ref.productInfoMap.get(productCode) || ref.productInfoMap.get(bomKey);
    if (productInfo) {
      const key = normalizePn(productInfo.itemCode);
      const isPurchase = productInfo.supplyType === '구매';
      const isOutsource = productInfo.supplyType?.includes('외주');

      if (isPurchase) {
        const purch = calcPurchaseCost(productInfo.itemCode, productInfo.customerPn || '', ref.purchasePrices);
        if (purch > 0) addToCostAccum(key, productInfo, qty, 0, 0, purch, 0, 'purchase');
      } else if (isOutsource) {
        // 외주: 자체사출 없음(inj=0), NET = 구매단가 - 사출판매가
        const pnt = calcPaintCost(productInfo, ref.paintMixMap, ref.materialPrices);
        const purch = calcPurchaseCost(productInfo.itemCode, productInfo.customerPn || '', ref.purchasePrices);
        const outsrc = calcOutsourceCost(productInfo.itemCode, productInfo.customerPn || '', ref.outsourcePrices);
        if (purch > 0 || outsrc > 0) {
          addToCostAccum(key, productInfo, qty, 0, pnt, purch, outsrc, 'outsource');
        }
      } else if (productInfo.netWeight > 0 || productInfo.paintQty1 > 0) {
        const inj = productInfo.netWeight > 0 ? calcInjectionCost(productInfo, ref.materialPrices) : 0;
        const pnt = calcPaintCost(productInfo, ref.paintMixMap, ref.materialPrices);
        if (inj > 0 || pnt > 0) {
          addToCostAccum(key, productInfo, qty, inj, pnt, 0, 0, 'self');
        }
      }
    }

    // (2) BOM 하위 전개: 모든 자식 노드의 원가 합산
    const descendants = getAllBomDescendants(bomKey, qty, bomRelations);
    for (const desc of descendants) {
      const childInfo = ref.productInfoMap.get(desc.childPn);
      if (!childInfo) continue;
      const key = normalizePn(childInfo.itemCode);
      const isPurchase = childInfo.supplyType === '구매';
      const isOutsource = childInfo.supplyType?.includes('외주');

      if (isPurchase) {
        const purch = calcPurchaseCost(childInfo.itemCode, childInfo.customerPn || '', ref.purchasePrices);
        if (purch > 0) addToCostAccum(key, childInfo, desc.accQty, 0, 0, purch, 0, 'purchase');
      } else if (isOutsource) {
        // 외주: 자체사출 없음(inj=0), NET = 구매단가 - 사출판매가
        const pnt = calcPaintCost(childInfo, ref.paintMixMap, ref.materialPrices);
        const purch = calcPurchaseCost(childInfo.itemCode, childInfo.customerPn || '', ref.purchasePrices);
        const outsrc = calcOutsourceCost(childInfo.itemCode, childInfo.customerPn || '', ref.outsourcePrices);
        if (purch > 0 || outsrc > 0) {
          addToCostAccum(key, childInfo, desc.accQty, 0, pnt, purch, outsrc, 'outsource');
        }
      } else {
        if (childInfo.netWeight <= 0 && childInfo.paintQty1 <= 0) continue;
        const inj = childInfo.netWeight > 0 ? calcInjectionCost(childInfo, ref.materialPrices) : 0;
        const pnt = calcPaintCost(childInfo, ref.paintMixMap, ref.materialPrices);
        if (inj > 0 || pnt > 0) {
          addToCostAccum(key, childInfo, desc.accQty, inj, pnt, 0, 0, 'self');
        }
      }
    }
  }

  // 결과 집계
  const itemRows: CalcItemRow[] = [];
  let totalResin = 0, totalPaint = 0, totalPurchase = 0, totalOutsource = 0;

  for (const [, item] of costAccum) {
    const resinAmt = item.injPerEa * item.totalQty;
    const paintAmt = item.pntPerEa * item.totalQty;

    let purchAmt = 0;
    let outsrcAmt = 0;

    if (item.costType === 'purchase') {
      // 구매: 구매단가 × 수량
      purchAmt = item.purchPerEa * item.totalQty;
    } else if (item.costType === 'outsource') {
      // 외주: NET재료비 = (구매단가 - 사출판매가) × 수량
      // 구매단가는 전체 매입가, 사출판매가는 외주사출 서비스비
      // 차이가 순수 원재료 가치
      outsrcAmt = (item.purchPerEa - item.outsrcPerEa) * item.totalQty;
      if (outsrcAmt < 0) outsrcAmt = 0; // 사출판매가 > 구매단가이면 0 처리
    }

    const totalAmt = resinAmt + paintAmt + purchAmt + outsrcAmt;
    if (totalAmt <= 0) continue;

    totalResin += resinAmt;
    totalPaint += paintAmt;
    totalPurchase += purchAmt;
    totalOutsource += outsrcAmt;

    const netPerEa = item.costType === 'outsource'
      ? (item.purchPerEa - item.outsrcPerEa) + item.pntPerEa
      : item.injPerEa + item.pntPerEa + item.purchPerEa;

    itemRows.push({
      itemCode: item.info.itemCode,
      customerPn: item.info.customerPn || '',
      itemName: item.info.itemName || '',
      supplyType: item.info.supplyType || '자작',
      processType: item.info.processType || '',
      production: item.totalQty,
      injectionCost: item.injPerEa,
      paintCostPerEa: item.pntPerEa,
      purchaseCostPerEa: item.costType === 'outsource' ? item.purchPerEa - item.outsrcPerEa : item.purchPerEa,
      totalCostPerEa: netPerEa,
      resinAmount: resinAmt,
      paintAmount: paintAmt,
      purchaseAmount: item.costType === 'purchase' ? purchAmt : outsrcAmt,
      totalAmount: totalAmt,
      source: 'bom',
    });
  }

  // NET 표준재료비 = RESIN + PAINT + 구매 + 외주(구매단가-사출판매가)
  const totalStandard = totalResin + totalPaint + totalPurchase + totalOutsource;

  const summaryByType: SummaryByType[] = [
    { name: 'RESIN', standard: totalResin, actual: 0 },
    { name: 'PAINT', standard: totalPaint, actual: 0 },
    { name: '구매', standard: totalPurchase, actual: 0 },
    { name: '외주', standard: totalOutsource, actual: 0 },
  ].filter(t => t.standard !== 0);

  const standardRatio = revenue > 0 ? totalStandard / revenue : 0;

  console.log(`[마스터 산출] 제품 ${productQtyMap.size}개 → BOM 매칭 ${bomCount}건 (미매칭 ${bomMissing}), 원가항목 ${costAccum.size}건`);
  console.log(`[마스터 산출] RESIN ₩${Math.round(totalResin).toLocaleString()}, PAINT ₩${Math.round(totalPaint).toLocaleString()}, 구매 ₩${Math.round(totalPurchase).toLocaleString()}, 외주 ₩${Math.round(totalOutsource).toLocaleString()}, NET ₩${Math.round(totalStandard).toLocaleString()}`);

  return {
    summaryByType,
    itemRows,
    totalStandard,
    revenue,
    standardRatio,
    calcSource: 'Master',
    stats: {
      excelItems: 0,
      calcItems: 0,
      bomItems: bomCount,
      totalItems: itemRows.length,
    },
  };
}

// ============================================================
// Per-item standard cost aggregation (품목별재료비 기반)
// ============================================================

const MONTH_QTY_KEYS: (keyof ItemStandardCost)[] = [
  'jan_qty', 'feb_qty', 'mar_qty', 'apr_qty', 'may_qty', 'jun_qty',
  'jul_qty', 'aug_qty', 'sep_qty', 'oct_qty', 'nov_qty', 'dec_qty',
];
const MONTH_AMT_KEYS: (keyof ItemStandardCost)[] = [
  'jan_amt', 'feb_amt', 'mar_amt', 'apr_amt', 'may_amt', 'jun_amt',
  'jul_amt', 'aug_amt', 'sep_amt', 'oct_amt', 'nov_amt', 'dec_amt',
];

/**
 * 품목별재료비 데이터에서 월별 표준재료비 산출
 * Excel 검증된 per-item 비용을 직접 사용하여 정확한 집계
 */
export function calcFromItemStandardCosts(
  items: ItemStandardCost[],
  monthIndex: number, // 0=1월, 1=2월, ...
  revenue: number,
  forecastQtyMap?: Map<string, number>,  // forecast 수량 폴백 (월별 qty가 0인 항목용)
): UnifiedCalcResult {
  const qtyKey = MONTH_QTY_KEYS[monthIndex];
  const amtKey = MONTH_AMT_KEYS[monthIndex];

  let totalResin = 0;
  let totalPaint = 0;
  let totalPurchase = 0;
  let totalOutsource = 0;
  const itemRows: CalcItemRow[] = [];

  for (const item of items) {
    let qty = Number(item[qtyKey]) || 0;

    // 월별 수량이 0이면 forecast 수량으로 폴백 (DataQualityGuide 업로드 데이터 지원)
    if (qty <= 0 && forecastQtyMap) {
      qty = forecastQtyMap.get(normalizePn(item.item_code)) || 0;
      if (qty <= 0 && item.customer_pn) {
        qty = forecastQtyMap.get(normalizePn(item.customer_pn)) || 0;
      }
    }
    if (qty <= 0) continue;

    const st = item.supply_type || '';
    const resinPerEa = Number(item.resin_cost_per_ea) || 0;
    const paintPerEa = Number(item.paint_cost_per_ea) || 0;
    const materialPerEa = Number(item.material_cost_per_ea) || 0;
    const amt = Number(item[amtKey]) || 0;

    // 자작 판정: supply_type이 '자작' 이거나, 비어있지만 resin/paint/material 단가가 있으면 자작
    const isSelfMade = st === '자작' || (!st && (resinPerEa > 0 || paintPerEa > 0) && !st.includes('구매') && !st.includes('외주'));

    if (isSelfMade || (!st && materialPerEa > 0 && resinPerEa <= 0 && paintPerEa <= 0)) {
      // material_cost_per_ea를 총 단가로 사용 (resin+paint보다 정확)
      const totalPerEa = materialPerEa > 0 ? materialPerEa : (resinPerEa + paintPerEa);
      if (totalPerEa <= 0) continue;

      const resinAmt = resinPerEa * qty;
      const paintAmt = paintPerEa * qty;
      const totalAmt = totalPerEa * qty;
      const otherAmt = Math.max(0, totalAmt - resinAmt - paintAmt);

      totalResin += resinAmt;
      totalPaint += paintAmt;
      totalPurchase += otherAmt; // 기타 재료비 (가공/부자재 등)

      itemRows.push({
        itemCode: item.item_code,
        customerPn: item.customer_pn,
        itemName: item.item_name,
        supplyType: st || '자작',
        processType: item.item_type,
        production: qty,
        injectionCost: resinPerEa,
        paintCostPerEa: paintPerEa,
        purchaseCostPerEa: otherAmt > 0 ? otherAmt / qty : 0,
        totalCostPerEa: totalPerEa,
        resinAmount: resinAmt,
        paintAmount: paintAmt,
        purchaseAmount: otherAmt,
        totalAmount: totalAmt,
        source: 'excel',
      });
    } else if (st === '구매') {
      // amt가 0이면 materialPerEa × qty 사용
      const purchAmt = amt > 0 ? amt : (materialPerEa > 0 ? materialPerEa * qty : 0);
      if (purchAmt <= 0) continue;
      totalPurchase += purchAmt;
      const perEa = materialPerEa > 0 ? materialPerEa : (purchAmt / qty);
      itemRows.push({
        itemCode: item.item_code,
        customerPn: item.customer_pn,
        itemName: item.item_name,
        supplyType: st,
        processType: item.item_type,
        production: qty,
        injectionCost: 0,
        paintCostPerEa: 0,
        purchaseCostPerEa: perEa,
        totalCostPerEa: perEa,
        resinAmount: 0,
        paintAmount: 0,
        purchaseAmount: purchAmt,
        totalAmount: purchAmt,
        source: 'excel',
      });
    } else if (st.includes('외주')) {
      const outsrcAmt = amt > 0 ? amt : (materialPerEa > 0 ? materialPerEa * qty : 0);
      if (outsrcAmt <= 0) continue;
      totalOutsource += outsrcAmt;
      const perEa = materialPerEa > 0 ? materialPerEa : (outsrcAmt / qty);
      itemRows.push({
        itemCode: item.item_code,
        customerPn: item.customer_pn,
        itemName: item.item_name,
        supplyType: st,
        processType: item.item_type,
        production: qty,
        injectionCost: 0,
        paintCostPerEa: 0,
        purchaseCostPerEa: perEa,
        totalCostPerEa: perEa,
        resinAmount: 0,
        paintAmount: 0,
        purchaseAmount: outsrcAmt,
        totalAmount: outsrcAmt,
        source: 'excel',
      });
    }
  }

  const totalStandard = totalResin + totalPaint + totalPurchase + totalOutsource;
  const standardRatio = revenue > 0 ? totalStandard / revenue : 0;

  const summaryByType: SummaryByType[] = [
    { name: 'RESIN', standard: totalResin, actual: 0 },
    { name: 'PAINT', standard: totalPaint, actual: 0 },
    { name: '구매', standard: totalPurchase, actual: 0 },
    { name: '외주', standard: totalOutsource, actual: 0 },
  ];

  console.log(`[품목별원가] ${items.length}건 중 생산 ${itemRows.length}건 → RESIN ₩${Math.round(totalResin).toLocaleString()}, PAINT ₩${Math.round(totalPaint).toLocaleString()}, 구매 ₩${Math.round(totalPurchase).toLocaleString()}, 외주 ₩${Math.round(totalOutsource).toLocaleString()}, NET ₩${Math.round(totalStandard).toLocaleString()}`);

  return {
    summaryByType,
    itemRows,
    totalStandard,
    revenue,
    standardRatio,
    calcSource: 'ItemStandardCost',
    stats: {
      excelItems: itemRows.length,
      calcItems: 0,
      bomItems: 0,
      totalItems: itemRows.length,
    },
  };
}
