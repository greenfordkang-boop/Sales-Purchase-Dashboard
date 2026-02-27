import { BomRecord, buildBomRelations, expandBomToLeaves } from './bomDataParser';
import { ForecastItem } from './salesForecastParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from './bomMasterParser';

// ============================================
// Types
// ============================================

export interface MRPMaterialRow {
  materialCode: string;
  materialName: string;
  materialType: string;       // RESIN / PAINT / 구매 / 외주
  unit: string;                // 단위 (kg, EA, L 등)
  requiredQty: number;         // 총 소요량
  unitPrice: number;           // 재질 단가
  totalCost: number;           // 소요량 × 단가
  parentProducts: string[];    // 관련 모제품 리스트
  monthlyQty: number[];        // 월별 소요량 (12)
}

export interface MRPResult {
  materials: MRPMaterialRow[];
  byMonth: { month: string; totalQty: number; totalCost: number }[];
  summary: {
    totalMaterials: number;
    totalRequiredQty: number;
    totalCost: number;
    bomMatchRate: number;
    unmatchedProducts: string[];
    matchedProducts: number;
  };
}

// ============================================
// Helpers
// ============================================

const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/**
 * 매출계획에서 제품별 월별 수량 맵 구축
 * key: normalizedPN, value: [q1, q2, ... q12]
 */
function buildForecastQtyMap(
  forecastData: ForecastItem[],
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const item of forecastData) {
    if (!item.partNo && !item.newPartNo) continue;
    const key = normalizePn(item.newPartNo || item.partNo);
    const monthly = Array.isArray(item.monthlyQty)
      ? item.monthlyQty.map(q => Number(q) || 0)
      : new Array(12).fill(0);
    // 동일 P/N 합산
    const existing = map.get(key);
    if (existing) {
      for (let i = 0; i < 12; i++) existing[i] += (monthly[i] || 0);
    } else {
      map.set(key, [...monthly]);
    }
  }
  return map;
}

/**
 * P/N 매핑 구축: 고객사P/N ↔ 내부코드
 */
function buildPnMappingLookup(
  productCodes: ProductCodeRecord[],
  refInfo: ReferenceInfoRecord[],
): { custToInternal: Map<string, string>; internalToCust: Map<string, string> } {
  const custToInternal = new Map<string, string>();
  const internalToCust = new Map<string, string>();

  for (const pc of productCodes) {
    if (pc.productCode && pc.customerPn) {
      custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
      internalToCust.set(normalizePn(pc.productCode), normalizePn(pc.customerPn));
    }
  }

  for (const ri of refInfo) {
    if (ri.itemCode && ri.customerPn) {
      custToInternal.set(normalizePn(ri.customerPn), normalizePn(ri.itemCode));
      internalToCust.set(normalizePn(ri.itemCode), normalizePn(ri.customerPn));
    }
  }

  return { custToInternal, internalToCust };
}

// ============================================
// MRP 계산 엔진
// ============================================

export function calculateMRP(
  forecastData: ForecastItem[],
  bomRecords: BomRecord[],
  productCodes: ProductCodeRecord[],
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
  options?: { year?: number; months?: number[] },
): MRPResult {
  // 1. Forecast 수량 맵 구축
  const forecastQtyMap = buildForecastQtyMap(forecastData);

  // 2. P/N 매핑
  const { custToInternal, internalToCust } = buildPnMappingLookup(productCodes, refInfo);

  // 3. BOM 전개 준비
  const normalizedBom: BomRecord[] = bomRecords.map(b => ({
    ...b,
    parentPn: normalizePn(b.parentPn),
    childPn: normalizePn(b.childPn),
  }));
  const bomRelations = buildBomRelations(normalizedBom);

  // 4. 재질코드 가격 맵
  const priceMap = new Map<string, number>();
  const nameMap = new Map<string, string>();
  const typeMap = new Map<string, string>();
  const unitMap = new Map<string, string>();
  for (const mc of materialCodes) {
    const key = normalizePn(mc.materialCode);
    if (mc.currentPrice > 0) priceMap.set(key, mc.currentPrice);
    if (mc.materialName) nameMap.set(key, mc.materialName);
    if (mc.materialType) typeMap.set(key, mc.materialType);
    if (mc.unit) unitMap.set(key, mc.unit);
  }

  // 5. 기준정보에서 자재유형 분류 보조 맵
  const refInfoMap = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    refInfoMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refInfoMap.set(normalizePn(ri.customerPn), ri);
  }

  // 6. 자재별 월별 소요량 집계
  const materialAgg = new Map<string, {
    name: string;
    type: string;
    monthlyQty: number[];
    parents: Set<string>;
    unitPrice: number;
  }>();

  let matchedProducts = 0;
  const unmatchedProducts: string[] = [];

  for (const [forecastPn, monthlyQty] of forecastQtyMap.entries()) {
    // BOM에서 parent 찾기: forecast P/N 직접 or 매핑 변환
    let bomParent = forecastPn;
    if (!bomRelations.has(bomParent)) {
      const internal = custToInternal.get(forecastPn);
      if (internal && bomRelations.has(internal)) {
        bomParent = internal;
      } else {
        const cust = internalToCust.get(forecastPn);
        if (cust && bomRelations.has(cust)) {
          bomParent = cust;
        }
      }
    }

    if (!bomRelations.has(bomParent)) {
      unmatchedProducts.push(forecastPn);
      continue;
    }

    matchedProducts++;

    // 월별 BOM 전개
    for (let m = 0; m < 12; m++) {
      const qty = monthlyQty[m] || 0;
      if (qty <= 0) continue;

      const leaves = expandBomToLeaves(bomParent, qty, bomRelations);
      for (const leaf of leaves) {
        const childKey = normalizePn(leaf.childPn);
        const existing = materialAgg.get(childKey);

        if (existing) {
          existing.monthlyQty[m] += leaf.totalRequired;
          existing.parents.add(forecastPn);
        } else {
          // 자재 유형 결정
          const ri = refInfoMap.get(childKey);
          let matType = '구매';
          if (ri) {
            if (ri.supplyType?.includes('외주')) matType = '외주';
            else if (ri.processType?.includes('사출')) matType = 'RESIN';
            else if (ri.processType?.includes('도장')) matType = 'PAINT';
          }
          // 재질코드 타입 fallback
          const mcType = typeMap.get(childKey);
          if (mcType) {
            if (/resin|수지|사출/i.test(mcType)) matType = 'RESIN';
            else if (/paint|도장|도료/i.test(mcType)) matType = 'PAINT';
          }

          const mq = new Array(12).fill(0);
          mq[m] = leaf.totalRequired;
          materialAgg.set(childKey, {
            name: leaf.childName || nameMap.get(childKey) || childKey,
            type: matType,
            monthlyQty: mq,
            parents: new Set([forecastPn]),
            unitPrice: priceMap.get(childKey) || 0,
          });
        }
      }
    }
  }

  // 7. 결과 구성
  const materials: MRPMaterialRow[] = [];
  for (const [code, agg] of materialAgg.entries()) {
    const totalQty = agg.monthlyQty.reduce((s, q) => s + q, 0);
    // 단위: 재질코드 마스터 → 유형별 기본값 폴백
    const DEFAULT_UNITS: Record<string, string> = { RESIN: 'kg', PAINT: 'L', '구매': 'EA', '외주': 'EA' };
    const unit = unitMap.get(code) || DEFAULT_UNITS[agg.type] || 'EA';

    materials.push({
      materialCode: code,
      materialName: agg.name,
      materialType: agg.type,
      unit,
      requiredQty: Math.round(totalQty),
      unitPrice: agg.unitPrice,
      totalCost: totalQty * agg.unitPrice,
      parentProducts: Array.from(agg.parents),
      monthlyQty: agg.monthlyQty,
    });
  }

  // 정렬: 총 소요량 내림차순
  materials.sort((a, b) => b.requiredQty - a.requiredQty);

  // 월별 합계
  const byMonth = Array.from({ length: 12 }, (_, i) => ({
    month: `${i + 1}월`,
    totalQty: materials.reduce((s, m) => s + (m.monthlyQty[i] || 0), 0),
    totalCost: materials.reduce((s, m) => s + (m.monthlyQty[i] || 0) * m.unitPrice, 0),
  }));

  const totalRequiredQty = materials.reduce((s, m) => s + m.requiredQty, 0);
  const totalCost = materials.reduce((s, m) => s + m.totalCost, 0);
  const totalForecastProducts = forecastQtyMap.size;

  return {
    materials,
    byMonth,
    summary: {
      totalMaterials: materials.length,
      totalRequiredQty,
      totalCost,
      bomMatchRate: totalForecastProducts > 0 ? matchedProducts / totalForecastProducts : 0,
      unmatchedProducts: unmatchedProducts.slice(0, 50),
      matchedProducts,
    },
  };
}
