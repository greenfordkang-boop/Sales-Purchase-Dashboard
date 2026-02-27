
import {
  StandardMaterialItem,
  ProductInfoItem,
  MaterialPrice,
  PurchasePrice,
  OutsourcePrice,
  PaintMixRatio,
  StandardMaterialData,
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
  const paintQtys = [product.paintQty1, product.paintQty2, product.paintQty3];
  const paintCodes = [product.rawMaterialCode3, product.rawMaterialCode4, ''];

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
): ReferenceData {
  const materialPrices = new Map<string, number>();
  for (const mc of materialCodes) {
    if (mc.materialCode && mc.currentPrice > 0) {
      materialPrices.set(normalizePn(mc.materialCode), mc.currentPrice);
    }
  }

  const purchasePrices = new Map<string, number>();
  const outsourcePrices = new Map<string, number>();
  const paintMixMap = new Map<string, PaintMixRatio>();

  const productInfoMap = new Map<string, ProductInfoItem>();
  for (const ri of refInfo) {
    if (!ri.itemCode) continue;
    const pi: ProductInfoItem = {
      itemCode: ri.itemCode,
      customerPn: ri.customerPn,
      itemName: ri.itemName,
      itemType: '',
      processType: '',
      supplyType: '',
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
