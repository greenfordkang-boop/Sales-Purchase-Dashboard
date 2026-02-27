import { BomRecord, buildBomRelations, expandBomToLeaves } from './bomDataParser';
import { ForecastItem } from './salesForecastParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from './bomMasterParser';
import { PurchaseMonthlySummary } from './purchaseSummaryTypes';

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
  supplier: string;            // 협력업체/구입처
}

export interface StandardMaterialCostEntry {
  productCode: string;
  customerPn: string;
  productName: string;
  processType: string;
  eaCost: number;
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
    fuzzyMatchedProducts: string[];
    matchedProducts: number;
    directCostProducts: number;   // 표준재료비 직접 적용 제품 수
    noPriceMaterials: number;      // 단가 없는 자재 수
    priceMatchRate: number;        // 자재 단가 매칭률
  };
}

// ============================================
// Helpers
// ============================================

const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/** 이름 매칭용 정규화 (괄호, 특수문자 모두 제거) */
const normalizeForName = (name: string): string =>
  name.trim().toUpperCase().replace(/[\s\-_\.\/\(\)\[\]\+#,]+/g, '');

/** 수지 타입 접두사 제거 (PC_, ABS_, PC+ABS_ 등) */
const stripResinPrefix = (name: string): string =>
  name.replace(/^(PC\+?ABS|PC|ABS|PP|PE|TPE|TPU|PA\d*|PBT|POM|PMMA|LEXAN|SAN|PPS|ASA|RUBBER)[_\s+]+/i, '').trim();

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
  purchaseData?: PurchaseMonthlySummary[],
  standardCosts?: StandardMaterialCostEntry[],
): MRPResult {
  // 1. Forecast 수량 맵 구축
  const forecastQtyMap = buildForecastQtyMap(forecastData);

  // 2. P/N 매핑
  const { custToInternal, internalToCust } = buildPnMappingLookup(productCodes, refInfo);

  // 3. BOM 전개 준비 (중복 parent-child 쌍 제거)
  const normalizedBom: BomRecord[] = bomRecords.map(b => ({
    ...b,
    parentPn: normalizePn(b.parentPn),
    childPn: normalizePn(b.childPn),
  }));
  const dedupedBom: BomRecord[] = [];
  const seenPairs = new Set<string>();
  for (const b of normalizedBom) {
    const pairKey = `${b.parentPn}|${b.childPn}`;
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      dedupedBom.push(b);
    }
  }
  const bomRelations = buildBomRelations(dedupedBom);

  // 4. 재질코드 맵 (이름/유형/단위)
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

  // 4-1. 매입단가 맵 구축 (partNo → 최신 단가)
  const purchasePriceMap = new Map<string, { price: number; unit: string; name: string }>();
  if (purchaseData && purchaseData.length > 0) {
    for (const row of purchaseData) {
      if (!row.partNo || row.unitPrice <= 0) continue;
      const key = normalizePn(row.partNo);
      const existing = purchasePriceMap.get(key);
      // 같은 P/N이면 최신(더 큰 금액)으로 갱신
      if (!existing || row.unitPrice > 0) {
        purchasePriceMap.set(key, {
          price: row.unitPrice,
          unit: row.unit || '',
          name: row.partName || '',
        });
      }
    }
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
    supplier: string;
  }>();

  // 6-1. 표준재료비 맵 (제품코드 → EA당 재료비)
  const stdCostMap = new Map<string, StandardMaterialCostEntry>();
  if (standardCosts) {
    for (const sc of standardCosts) {
      if (sc.eaCost > 0) {
        stdCostMap.set(normalizePn(sc.productCode), sc);
        if (sc.customerPn) stdCostMap.set(normalizePn(sc.customerPn), sc);
      }
    }
  }

  let matchedProducts = 0;
  let directCostProducts = 0;
  const unmatchedProducts: string[] = [];

  // BOM parent 접두사 인덱스 구축 (퍼지 매칭용)
  const bomPrefixIndex = new Map<string, string>();  // prefix → first BOM key
  for (const bk of bomRelations.keys()) {
    for (let len = 8; len <= bk.length; len++) {
      const p = bk.slice(0, len);
      if (!bomPrefixIndex.has(p)) bomPrefixIndex.set(p, bk);
    }
  }
  const fuzzyMatched: string[] = [];

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

    // 퍼지 매칭: 접두사 유사도 (같은 모델+파트, 다른 색상/리비전)
    if (!bomRelations.has(bomParent) && bomParent.length >= 10) {
      for (let prefixLen = bomParent.length - 1; prefixLen >= 8; prefixLen--) {
        const prefix = bomParent.slice(0, prefixLen);
        const candidate = bomPrefixIndex.get(prefix);
        if (candidate && bomRelations.has(candidate)) {
          fuzzyMatched.push(`${forecastPn} → ${candidate} (prefix ${prefixLen})`);
          bomParent = candidate;
          break;
        }
      }
    }

    if (!bomRelations.has(bomParent)) {
      // BOM 미매칭 → 표준재료비 직접 적용 시도
      const stdEntry = stdCostMap.get(forecastPn)
        || stdCostMap.get(custToInternal.get(forecastPn) || '')
        || stdCostMap.get(internalToCust.get(forecastPn) || '');
      if (stdEntry) {
        directCostProducts++;
        // 제품 자체를 하나의 자재로 등록 (EA당 재료비)
        const key = normalizePn(stdEntry.productCode);
        for (let m = 0; m < 12; m++) {
          const qty = monthlyQty[m] || 0;
          if (qty <= 0) continue;
          const existing = materialAgg.get(key);
          if (existing) {
            existing.monthlyQty[m] += qty;
            existing.parents.add(forecastPn);
          } else {
            const mq = new Array(12).fill(0);
            mq[m] = qty;
            materialAgg.set(key, {
              name: stdEntry.productName || stdEntry.productCode,
              type: stdEntry.processType || '구매',
              monthlyQty: mq,
              parents: new Set([forecastPn]),
              unitPrice: stdEntry.eaCost,
              supplier: '',
            });
          }
        }
        continue;
      }
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
          // 초기 단가: 재질코드 → 표준재료비(BOM 리프가 제품코드인 경우)
          let initPrice = priceMap.get(childKey) || 0;
          if (initPrice <= 0) {
            const stdEntry = stdCostMap.get(childKey);
            if (stdEntry) initPrice = stdEntry.eaCost;
          }
          materialAgg.set(childKey, {
            name: leaf.childName || nameMap.get(childKey) || childKey,
            type: matType,
            monthlyQty: mq,
            parents: new Set([forecastPn]),
            unitPrice: initPrice,
            supplier: leaf.supplier || '',
          });
        }
      }
    }
  }


  // 7. 결과 구성
  const DEFAULT_UNITS: Record<string, string> = { RESIN: 'kg', PAINT: 'L', '구매': 'EA', '외주': 'EA' };
  const materials: MRPMaterialRow[] = [];
  for (const [code, agg] of materialAgg.entries()) {
    const totalQty = agg.monthlyQty.reduce((s, q) => s + q, 0);

    // 기준정보 조회 (단위/단가/이름 공통)
    const ri = refInfoMap.get(code);
    const rawCodes = ri
      ? [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean)
      : [];

    // 단위 조회: 1) 직접 매칭 2) 기준정보→원재료코드→재질코드 단위 3) 유형 기본값
    let unit = unitMap.get(code);
    if (!unit) {
      for (const rawCode of rawCodes) {
        const u = unitMap.get(normalizePn(rawCode));
        if (u) { unit = u; break; }
      }
    }
    if (!unit) unit = DEFAULT_UNITS[agg.type] || 'EA';

    // 단가 조회: 1) 재질코드 직접 2) rawMaterialCode 경유 3) BOM 품명→재질코드 매칭
    let unitPrice = priceMap.get(code) || 0;
    if (unitPrice <= 0) {
      for (const rawCode of rawCodes) {
        const p = priceMap.get(normalizePn(rawCode));
        if (p && p > 0) { unitPrice = p; break; }
      }
    }
    // 재질코드: BOM 품명으로 매칭 (재질코드가 매입 도번일 때)
    if (unitPrice <= 0 && priceMap.size > 0) {
      const nameKey = normalizePn(agg.name);
      if (nameKey && nameKey !== code) {
        const p = priceMap.get(nameKey);
        if (p && p > 0) unitPrice = p;
      }
      // 접두사 제거 후 재시도
      if (unitPrice <= 0) {
        const stripped = stripResinPrefix(agg.name);
        const strippedKey = normalizeForName(stripped);
        if (strippedKey.length >= 6) {
          for (const [pk, pv] of priceMap.entries()) {
            const pkNorm = normalizeForName(pk);
            if (pkNorm === strippedKey ||
                (strippedKey.length >= 8 && pkNorm.startsWith(strippedKey.slice(0, 12))) ||
                (pkNorm.length >= 8 && strippedKey.startsWith(pkNorm.slice(0, 12)))) {
              unitPrice = pv;
              break;
            }
          }
        }
      }
    }
    // 매입단가 폴백: 1) 코드 직접 매칭
    if (unitPrice <= 0) {
      const pp = purchasePriceMap.get(code);
      if (pp && pp.price > 0) {
        unitPrice = pp.price;
        if (!unit || unit === DEFAULT_UNITS[agg.type]) unit = pp.unit || unit;
      }
    }
    // 매입단가 폴백: 2) rawMaterialCode로 매칭
    if (unitPrice <= 0) {
      for (const rawCode of rawCodes) {
        const pp = purchasePriceMap.get(normalizePn(rawCode));
        if (pp && pp.price > 0) { unitPrice = pp.price; break; }
      }
    }
    // 매입단가 폴백: 3) BOM 품명 → 매입 도번 정확 매칭
    if (unitPrice <= 0) {
      const nameKey = normalizePn(agg.name);
      if (nameKey && nameKey !== code) {
        const pp = purchasePriceMap.get(nameKey);
        if (pp && pp.price > 0) {
          unitPrice = pp.price;
          if (!unit || unit === DEFAULT_UNITS[agg.type]) unit = pp.unit || unit;
        }
      }
    }
    // 매입단가 폴백: 4) rawMaterialCode의 재질명 → 매입 도번 매칭
    if (unitPrice <= 0 && rawCodes.length > 0) {
      for (const rawCode of rawCodes) {
        const rawName = nameMap.get(normalizePn(rawCode));
        if (rawName) {
          const pp = purchasePriceMap.get(normalizePn(rawName));
          if (pp && pp.price > 0) { unitPrice = pp.price; break; }
        }
      }
    }
    // 매입단가 폴백: 5) 접두사 제거 + 유연한 이름 매칭 (RESIN/PAINT)
    if (unitPrice <= 0 && agg.name && agg.name !== code) {
      const stripped = stripResinPrefix(agg.name);
      const strippedKey = normalizeForName(stripped);
      if (strippedKey.length >= 6) {
        for (const [pk, pv] of purchasePriceMap.entries()) {
          const pkName = normalizeForName(pk);
          // 접두사 제거 후 일치 또는 한쪽이 다른쪽으로 시작
          if (pkName === strippedKey ||
              (strippedKey.length >= 8 && pkName.startsWith(strippedKey.slice(0, 12))) ||
              (pkName.length >= 8 && strippedKey.startsWith(pkName.slice(0, 12)))) {
            unitPrice = pv.price;
            if (!unit || unit === DEFAULT_UNITS[agg.type]) unit = pv.unit || unit;
            break;
          }
        }
      }
    }
    // 매입단가 폴백: 6) 표준재료비 EA단가 (BOM 리프가 제품코드인 경우)
    if (unitPrice <= 0) {
      const stdEntry = stdCostMap.get(code);
      if (stdEntry && stdEntry.eaCost > 0) {
        unitPrice = stdEntry.eaCost;
        unit = 'EA';
      }
    }
    // 매입단가 폴백: 7) 표준재료비 - 자재명으로 제품코드/고객사PN 검색
    if (unitPrice <= 0 && agg.name && agg.name !== code) {
      const nameKey = normalizePn(agg.name);
      const stdEntry = stdCostMap.get(nameKey);
      if (stdEntry && stdEntry.eaCost > 0) {
        unitPrice = stdEntry.eaCost;
        unit = 'EA';
      }
    }

    // 자재명 보강
    let materialName = agg.name;
    if (materialName === code) {
      // 매입 데이터에서 이름 가져오기
      const pp = purchasePriceMap.get(code);
      if (pp && pp.name) {
        materialName = pp.name;
      } else {
        for (const rawCode of rawCodes) {
          const n = nameMap.get(normalizePn(rawCode));
          if (n) { materialName = n; break; }
        }
      }
    }

    materials.push({
      materialCode: code,
      materialName,
      materialType: agg.type,
      unit,
      requiredQty: Math.round(totalQty),
      unitPrice,
      totalCost: totalQty * unitPrice,
      parentProducts: Array.from(agg.parents),
      monthlyQty: agg.monthlyQty,
      supplier: agg.supplier,
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
  const noPriceMaterials = materials.filter(m => m.unitPrice <= 0).length;

  return {
    materials,
    byMonth,
    summary: {
      totalMaterials: materials.length,
      totalRequiredQty,
      totalCost,
      bomMatchRate: totalForecastProducts > 0 ? (matchedProducts + directCostProducts) / totalForecastProducts : 0,
      unmatchedProducts: unmatchedProducts.slice(0, 100),
      fuzzyMatchedProducts: fuzzyMatched,
      matchedProducts: matchedProducts + directCostProducts,
      directCostProducts,
      noPriceMaterials,
      priceMatchRate: materials.length > 0 ? (materials.length - noPriceMaterials) / materials.length : 0,
    },
  };
}
