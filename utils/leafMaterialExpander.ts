/**
 * leafMaterialExpander.ts — BOM leaf 전개 + 원재료 집계 공유 함수
 * StandardMaterialCostView의 leafOrderRows / autoCalcResult 양쪽에서 사용
 */
import { BomRecord, PnMapping, buildBomRelations, expandBomToLeaves, normalizePn } from './bomDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord } from './bomMasterParser';
import { PurchasePrice } from './standardMaterialParser';
import { ForecastItem } from './salesForecastParser';

// ============================================
// Types
// ============================================

export interface LeafMaterial {
  code: string;          // 정규화된 품번
  name: string;
  unit: string;          // 'KG' | 'EA'
  materialType: string;  // 'RESIN' | 'PAINT' | '구매' | '외주'
  totalRequired: number;
  parentProducts: Set<string>;
}

export interface LeafMaterialRow {
  id: string;
  childPn: string;
  childName: string;
  supplier: string;
  materialType: string;
  unit: string;
  totalRequired: number;
  unitPrice: number;
  totalCost: number;
  parentProducts: string[];
}

// ============================================
// Helpers
// ============================================

const isJunkCode = (code: string) =>
  /^MATRCOD\d/i.test(code) || /ROW\d{3,}$/i.test(code) || /^MATR_COD/i.test(code);

const inferTypeFromName = (name: string): 'RESIN' | 'PAINT' | null => {
  if (!name) return null;
  const n = name.toUpperCase();
  if (/\b(PC|ABS|PP|PE|PA|POM|PBT|TPU|TPE|NYLON|LEXAN|NORYL|CYCOLOY|BAYBLEND|ASA|SAN|PMMA|PVC|PS)\b/.test(n)) return 'RESIN';
  if (/수지|레진|RESIN/i.test(n)) return 'RESIN';
  if (/도료|PAINT|페인트|프라이머|PRIMER|클리어|CLEAR\s*COAT|THINNER|신나|경화제|HARDENER/i.test(n)) return 'PAINT';
  return null;
};

const isValidSupplier = (s: string) =>
  s && !/^VEND_NAME\b/i.test(s) && !/^Row\s*\d/i.test(s);

// ============================================
// Core: BOM 전개 → 원재료 leaf 집계
// ============================================

export function expandForecastToLeafMaterials(
  forecastData: ForecastItem[],
  bomData: BomRecord[],
  pnMapping: PnMapping[],
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
  selectedMonth: string,
): Map<string, LeafMaterial> {
  if (bomData.length === 0 || forecastData.length === 0) return new Map();

  // BOM relations (정규화된 키)
  const rawRel = buildBomRelations(bomData);
  const bomRel = new Map<string, BomRecord[]>();
  for (const [k, v] of rawRel) bomRel.set(normalizePn(k), v);

  // P/N bridge: customerPn → internalCode
  const c2i = new Map<string, string>();
  pnMapping.forEach(m => {
    if (m.customerPn && m.internalCode) c2i.set(normalizePn(m.customerPn), normalizePn(m.internalCode));
  });
  refInfo.forEach(ri => {
    if (ri.customerPn && ri.itemCode) {
      const k = normalizePn(ri.customerPn);
      if (!c2i.has(k)) c2i.set(k, normalizePn(ri.itemCode));
    }
  });

  const findKey = (pn: string): string | null => {
    if (bomRel.has(pn)) return pn;
    const asInt = c2i.get(pn);
    if (asInt && bomRel.has(asInt)) return asInt;
    return null;
  };

  // refInfo 맵
  const refMap = new Map<string, ReferenceInfoRecord>();
  refInfo.forEach(ri => {
    refMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refMap.set(normalizePn(ri.customerPn), ri);
  });

  // 재질코드 맵 (쓰레기 코드 제외)
  const matCodeMap = new Map<string, MaterialCodeRecord>();
  materialCodes.forEach(mc => {
    if (!isJunkCode(mc.materialCode)) matCodeMap.set(normalizePn(mc.materialCode), mc);
  });

  // Forecast quantities
  const forecastByPn = new Map<string, number>();
  forecastData.forEach(item => {
    if (!item.partNo) return;
    const raw = normalizePn(item.partNo);
    let qty = 0;
    if (selectedMonth === 'All') qty = item.totalQty || 0;
    else {
      const mi = parseInt(selectedMonth.replace('월', ''), 10) - 1;
      qty = (mi >= 0 && mi < 12) ? (item.monthlyQty?.[mi] || 0) : 0;
    }
    if (qty <= 0) return;
    const key = findKey(raw) || raw;
    forecastByPn.set(key, (forecastByPn.get(key) || 0) + qty);
  });

  // 원재료 집계
  const rawAgg = new Map<string, LeafMaterial>();
  const addRaw = (code: string, name: string, unit: string, matType: string, qty: number, parent: string) => {
    const ex = rawAgg.get(code);
    if (ex) { ex.totalRequired += qty; ex.parentProducts.add(parent); }
    else rawAgg.set(code, { code, name, unit, materialType: matType, totalRequired: qty, parentProducts: new Set([parent]) });
  };

  // BOM 전개 → 원재료 집계
  for (const [bomKey, productQty] of forecastByPn) {
    if (!bomRel.has(bomKey)) continue;
    const leaves = expandBomToLeaves(bomKey, productQty, bomRel, undefined, 0, 10);
    for (const leaf of leaves) {
      const ck = normalizePn(leaf.childPn);
      const ri = refMap.get(ck);
      const mc = matCodeMap.get(ck);
      const supplyType = ri?.supplyType || '';
      const isOutsourced = /외주/.test(supplyType);
      const isSelfMade = !supplyType || /자작/.test(supplyType);

      // 1) matCodeMap 최우선: RESIN/PAINT 원재료
      if (mc && /RESIN|수지/i.test(mc.materialType || '')) {
        const unitStr = mc.unit && /kg/i.test(mc.unit) ? 'KG' : (mc.unit || 'EA');
        addRaw(ck, mc.materialName || leaf.childName || ck, unitStr, 'RESIN', leaf.totalRequired, bomKey);
      } else if (mc && /PAINT|도료/i.test(mc.materialType || mc.paintCategory || '')) {
        const unitStr = mc.unit && /kg/i.test(mc.unit) ? 'KG' : (mc.unit || 'EA');
        addRaw(ck, mc.materialName || leaf.childName || ck, unitStr, 'PAINT', leaf.totalRequired, bomKey);
      }
      // 2) 외주품
      else if (isOutsourced) {
        addRaw(ck, leaf.childName || ck, 'EA', '외주', leaf.totalRequired, bomKey);
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
          if (isJunkCode(rawCode)) continue;
          const rawNorm = normalizePn(rawCode);
          const rcMc = matCodeMap.get(rawNorm);
          if (rcMc && /PAINT|도료/i.test(rcMc.materialType || '')) continue;
          if (nw > 0) {
            const wPerEa = (nw + rw / cavity) * lossM / 1000;
            addRaw(rawNorm, rcMc?.materialName || rawCode, 'KG', 'RESIN', leaf.totalRequired * wPerEa, bomKey);
            resolved = true;
          }
        }
        if (!resolved) addRaw(ck, leaf.childName || ck, 'EA', 'RESIN', leaf.totalRequired, bomKey);
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
          if (pq <= 0 || isJunkCode(rawCodes[pi])) continue;
          const rawNorm = normalizePn(rawCodes[pi]);
          const rcMc = matCodeMap.get(rawNorm);
          const kgPerEa = (pq / 1000) * lossM / lotDiv;
          addRaw(rawNorm, rcMc?.materialName || rawCodes[pi], 'KG', 'PAINT', leaf.totalRequired * kgPerEa, bomKey);
          resolved = true;
        }
        if (!resolved) addRaw(ck, leaf.childName || ck, 'EA', 'PAINT', leaf.totalRequired, bomKey);
      }
      // 5) 기타: 자재명 패턴으로 추론
      else {
        if (isJunkCode(ck)) continue;
        const inferred = inferTypeFromName(leaf.childName || ck);
        if (inferred === 'RESIN') {
          addRaw(ck, leaf.childName || ck, 'KG', 'RESIN', leaf.totalRequired, bomKey);
        } else if (inferred === 'PAINT') {
          addRaw(ck, leaf.childName || ck, 'KG', 'PAINT', leaf.totalRequired, bomKey);
        } else {
          addRaw(ck, leaf.childName || ck, 'EA', '구매', leaf.totalRequired, bomKey);
        }
      }
    }
  }

  return rawAgg;
}

// ============================================
// Build LeafMaterialRow[] with pricing & supplier
// ============================================

export function buildLeafMaterialRows(
  rawAgg: Map<string, LeafMaterial>,
  materialCodes: MaterialCodeRecord[],
  purchasePrices: PurchasePrice[],
  refInfo: ReferenceInfoRecord[],
  purchaseData: { itemCode: string; customerPn?: string; supplier: string }[],
): LeafMaterialRow[] {
  // 재질코드 맵 (가격)
  const matCodeMap = new Map<string, MaterialCodeRecord>();
  materialCodes.forEach(mc => {
    if (!isJunkCode(mc.materialCode)) matCodeMap.set(normalizePn(mc.materialCode), mc);
  });

  // 구매단가 맵
  const ppMap = new Map<string, number>();
  purchasePrices.forEach(pp => {
    const k = normalizePn(pp.itemCode);
    if (pp.currentPrice > 0) ppMap.set(k, pp.currentPrice);
  });

  // supplier 맵
  const sMap = new Map<string, string>();
  const setS = (k: string, s: string) => { if (k && isValidSupplier(s)) sMap.set(normalizePn(k), s); };
  purchasePrices.forEach(pp => { setS(pp.itemCode, pp.supplier); });
  refInfo.forEach(ri => { setS(ri.itemCode, ri.supplier); if (ri.customerPn) setS(ri.customerPn, ri.supplier); });
  purchaseData.forEach(p => { setS(p.itemCode, p.supplier); if (p.customerPn) setS(p.customerPn, p.supplier); });
  // 원재료코드 → 구입처 역매핑
  for (const ri of refInfo) {
    const riSupp = sMap.get(normalizePn(ri.itemCode)) || ri.supplier;
    if (!riSupp || !isValidSupplier(riSupp)) continue;
    const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean) as string[];
    for (const rc of rawCodes) {
      const rk = normalizePn(rc);
      if (!sMap.has(rk)) sMap.set(rk, riSupp);
    }
  }

  const rows: LeafMaterialRow[] = [];
  for (const [code, data] of rawAgg) {
    const supplier = sMap.get(code) || '';
    const mc = matCodeMap.get(code);
    const unitPrice = mc?.currentPrice || ppMap.get(code) || 0;
    rows.push({
      id: `raw-${code}`,
      childPn: code,
      childName: data.name,
      supplier,
      materialType: data.materialType,
      unit: data.unit,
      totalRequired: data.totalRequired,
      unitPrice,
      totalCost: data.totalRequired * unitPrice,
      parentProducts: [...data.parentProducts],
    });
  }
  rows.sort((a, b) => b.totalCost - a.totalCost);
  return rows;
}
