#!/usr/bin/env node
/**
 * verify-mrp.mjs — MRP RESIN 소요량 독립 검증 스크립트
 * Supabase REST API에서 데이터 로드 → BOM 엔진 독립 재현 → RESIN 자재 역전개 검증
 *
 * 실행: node verify-mrp.mjs
 */

const SUPABASE_URL = 'https://bzszcukworybtozwbgay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6c3pjdWt3b3J5YnRvendiZ2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MTkyMTEsImV4cCI6MjA4NDk5NTIxMX0._kyiOPy3und1dhpSdZy6ER4OFJix7hhiysAWWN3EL1Q';

// ============================================================
// 1. Supabase REST API 헬퍼
// ============================================================

async function fetchAllRows(table, orderBy = 'id', extraFilter = '') {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=${orderBy}&limit=${pageSize}&offset=${offset}${extraFilter}`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      }
    });
    if (!res.ok) {
      console.error(`[WARN] ${table} fetch failed: ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

// ============================================================
// 2. 유틸리티
// ============================================================

function normalizePn(pn) {
  if (!pn) return '';
  return String(pn).trim().toUpperCase().replace(/\s+/g, '');
}

// ============================================================
// 3. 데이터 로드 + 변환
// ============================================================

async function loadAllData() {
  console.log('📥 Supabase 데이터 로드 시작...\n');

  const [
    fcRaw, bomRaw, riRaw, mcRaw, ppRaw, opRaw, pmRaw, iscRaw, pcRaw, pnRaw, irvRaw, purchRaw,
  ] = await Promise.all([
    fetchAllRows('forecast_data', 'no', '&version=eq.current'),
    fetchAllRows('bom_master', 'id'),
    fetchAllRows('reference_info_master', 'item_code'),
    fetchAllRows('material_code_master', 'material_code'),
    fetchAllRows('purchase_price_master', 'item_code'),
    fetchAllRows('outsource_injection_price', 'item_code'),
    fetchAllRows('paint_mix_ratio_master', 'paint_code'),
    fetchAllRows('item_standard_cost', 'item_code'),
    fetchAllRows('product_code_master', 'product_code'),
    fetchAllRows('pn_mapping', 'customer_pn'),
    fetchAllRows('item_revenue_data', 'id'),
    fetchAllRows('purchase_data', 'id'),
  ]);

  console.log(`  forecast_data: ${fcRaw.length}건`);
  console.log(`  bom_master: ${bomRaw.length}건`);
  console.log(`  reference_info_master: ${riRaw.length}건`);
  console.log(`  material_code_master: ${mcRaw.length}건`);
  console.log(`  purchase_price_master: ${ppRaw.length}건`);
  console.log(`  outsource_injection_price: ${opRaw.length}건`);
  console.log(`  paint_mix_ratio_master: ${pmRaw.length}건`);
  console.log(`  item_standard_cost: ${iscRaw.length}건`);
  console.log(`  product_code_master: ${pcRaw.length}건`);
  console.log(`  pn_mapping: ${pnRaw.length}건`);
  console.log(`  item_revenue_data: ${irvRaw.length}건`);
  console.log(`  purchase_data: ${purchRaw.length}건`);

  // Transform to engine-compatible format
  const forecast = fcRaw.map(r => {
    // monthly_qty, monthly_revenue는 Supabase에서 JSON 배열로 저장됨
    const mq = Array.isArray(r.monthly_qty) ? r.monthly_qty.map(Number) : [];
    const mr = Array.isArray(r.monthly_revenue) ? r.monthly_revenue.map(Number) : [];
    // 12개월로 패딩
    while (mq.length < 12) mq.push(0);
    while (mr.length < 12) mr.push(0);
    return {
      partNo: r.part_no || '',
      newPartNo: r.new_part_no || '',
      partName: r.part_name || '',
      customer: r.customer || '',
      model: r.model || '',
      unitPrice: Number(r.unit_price) || 0,
      totalQty: Number(r.total_qty) || 0,
      totalRevenue: Number(r.total_revenue) || 0,
      monthlyQty: mq,
      monthlyRevenue: mr,
    };
  });

  const bomRecords = bomRaw.map(r => ({
    parentPn: r.parent_pn || '',
    childPn: r.child_pn || '',
    childName: r.child_name || '',
    level: Number(r.level) || 0,
    qty: Number(r.qty) || 0,
    partType: r.part_type || '',
    supplier: r.supplier || '',
  }));

  const refInfo = riRaw.map(r => ({
    itemCode: r.item_code || '',
    customerPn: r.customer_pn || '',
    itemName: r.item_name || '',
    itemType: r.item_type || '',
    processType: r.process_type || '',
    supplyType: r.supply_type || '',
    spec: r.spec || '',
    netWeight: Number(r.net_weight) || 0,
    runnerWeight: Number(r.runner_weight) || 0,
    cavity: Number(r.cavity) || 0,
    paintIntake: Number(r.paint_intake) || 0,
    rawMaterialCode1: r.raw_material_code_1 || '',
    rawMaterialCode2: r.raw_material_code_2 || '',
    rawMaterialCode3: r.raw_material_code_3 || '',
    rawMaterialCode4: r.raw_material_code_4 || '',
    lossRate: Number(r.loss_rate) || 0,
    lotQty: Number(r.lot_qty) || 0,
    supplier: r.supplier || '',
    paintQty1: Number(r.paint_qty_1) || 0,
    paintQty2: Number(r.paint_qty_2) || 0,
    paintQty3: Number(r.paint_qty_3) || 0,
    paintQty4: Number(r.paint_qty_4) || 0,
  }));

  const materialCodes = mcRaw.map(r => ({
    industryCode: r.industry_code || '',
    materialType: r.material_type || '',
    materialCode: r.material_code || '',
    materialName: r.material_name || '',
    materialCategory: r.material_category || '',
    paintCategory: r.paint_category || '',
    color: r.color || '',
    unit: r.unit || '',
    safetyStock: Number(r.safety_stock) || 0,
    dailyAvgUsage: Number(r.daily_avg_usage) || 0,
    lossRate: Number(r.loss_rate) || 0,
    validDays: Number(r.valid_days) || 0,
    orderSize: Number(r.order_size) || 0,
    useYn: r.use_yn || '',
    protectedItem: r.protected_item || '',
    currentPrice: Number(r.current_price) || 0,
  }));

  const purchasePrices = ppRaw.map(r => ({
    itemCode: r.item_code || '',
    customerPn: r.customer_pn || '',
    itemName: r.item_name || '',
    supplier: r.supplier || '',
    currentPrice: Number(r.current_price) || 0,
    previousPrice: Number(r.previous_price) || 0,
  }));

  const outsourcePrices = opRaw.map(r => ({
    itemCode: r.item_code || '',
    customerPn: r.customer_pn || '',
    itemName: r.item_name || '',
    supplier: r.supplier || '',
    injectionPrice: Number(r.injection_price) || 0,
  }));

  const paintMixRatios = pmRaw.map(r => ({
    paintCode: r.paint_code || '',
    paintName: r.paint_name || '',
    mainRatio: Number(r.main_ratio) || 100,
    hardenerRatio: Number(r.hardener_ratio) || 0,
    thinnerRatio: Number(r.thinner_ratio) || 0,
    mainCode: r.main_code || '',
    hardenerCode: r.hardener_code || '',
    thinnerCode: r.thinner_code || '',
    mainPrice: Number(r.main_price) || 0,
    hardenerPrice: Number(r.hardener_price) || 0,
    thinnerPrice: Number(r.thinner_price) || 0,
  }));

  const itemStandardCosts = iscRaw.map(r => ({
    item_code: r.item_code || '',
    customer_pn: r.customer_pn || '',
    item_name: r.item_name || '',
    material_cost_per_ea: Number(r.material_cost_per_ea) || 0,
    resin_cost_per_ea: Number(r.resin_cost_per_ea) || 0,
    paint_cost_per_ea: Number(r.paint_cost_per_ea) || 0,
  }));

  const productCodes = pcRaw.map(r => ({
    productCode: r.product_code || '',
    customerPn: r.customer_pn || '',
    productName: r.product_name || '',
    customer: r.customer || '',
    model: r.model || '',
  }));

  const pnMapping = pnRaw.map(r => ({
    customerPn: r.customer_pn || '',
    internalCode: r.internal_code || '',
    partName: r.part_name || '',
  }));

  // purchase_data (입고실적)
  const purchaseData = purchRaw.map(r => ({
    itemCode: r.item_code || '',
    itemName: r.item_name || '',
    type: r.type || '',
    category: r.category || '',
    supplier: r.supplier || '',
    unit: r.unit || '',
    qty: Number(r.qty) || 0,
    unitPrice: Number(r.unit_price) || 0,
    amount: Number(r.amount) || 0,
    month: r.month || '',
    year: Number(r.year) || 0,
    date: r.date || '',
  }));

  return {
    forecast, bomRecords, refInfo, materialCodes,
    purchasePrices, outsourcePrices, paintMixRatios,
    itemStandardCosts, productCodes, pnMapping,
    purchaseData,
  };
}

// ============================================================
// 4. Price Maps 구축 (bomCostEngine.buildPriceData 재현)
// ============================================================

function buildPriceData(materialCodes, purchasePrices, outsourcePrices, stdCosts) {
  const matPriceMap = new Map();
  const materialTypeMap = new Map();
  const matNameMap = new Map();
  for (const mc of materialCodes) {
    const code = normalizePn(mc.materialCode);
    if (mc.currentPrice > 0) matPriceMap.set(code, mc.currentPrice);
    const combined = [mc.materialType, mc.materialCategory, mc.paintCategory].filter(Boolean).join('|');
    materialTypeMap.set(code, combined);
    matNameMap.set(code, mc.materialName || '');
  }

  const purchaseMap = new Map();
  for (const pp of purchasePrices) {
    if (pp.currentPrice > 0) {
      purchaseMap.set(normalizePn(pp.itemCode), pp.currentPrice);
      if (pp.customerPn) purchaseMap.set(normalizePn(pp.customerPn), pp.currentPrice);
    }
  }

  const outsourceMap = new Map();
  for (const op of outsourcePrices) {
    if (op.injectionPrice > 0) {
      outsourceMap.set(normalizePn(op.itemCode), op.injectionPrice);
      if (op.customerPn) outsourceMap.set(normalizePn(op.customerPn), op.injectionPrice);
    }
  }

  const stdMap = new Map();
  for (const sc of stdCosts) {
    const costVal = sc.material_cost_per_ea || (sc.resin_cost_per_ea + sc.paint_cost_per_ea);
    if (costVal > 0) {
      stdMap.set(normalizePn(sc.item_code), costVal);
      if (sc.customer_pn) stdMap.set(normalizePn(sc.customer_pn), costVal);
    }
  }

  const supplierMap = new Map();
  for (const pp of purchasePrices) {
    if (pp.supplier) {
      supplierMap.set(normalizePn(pp.itemCode), pp.supplier);
      if (pp.customerPn) supplierMap.set(normalizePn(pp.customerPn), pp.supplier);
    }
  }

  return { matPriceMap, materialTypeMap, matNameMap, purchaseMap, outsourceMap, stdMap, supplierMap };
}

// ============================================================
// 5. Map 구축 헬퍼
// ============================================================

function buildRefInfoMap(refInfo) {
  const map = new Map();
  for (const ri of refInfo) {
    const code = normalizePn(ri.itemCode);
    map.set(code, ri);
    if (ri.customerPn) map.set(normalizePn(ri.customerPn), ri);
  }
  return map;
}

function buildPaintMixMap(paintMixRatios, priceData) {
  const map = new Map();
  for (const pmr of paintMixRatios) {
    let enriched = pmr;
    if (priceData && (pmr.mainPrice === 0 || pmr.hardenerPrice === 0 || pmr.thinnerPrice === 0)) {
      const lookup = (code) => {
        if (!code) return 0;
        const c = normalizePn(code);
        return priceData.matPriceMap.get(c) || priceData.purchaseMap.get(c) || 0;
      };
      enriched = {
        ...pmr,
        mainPrice: pmr.mainPrice > 0 ? pmr.mainPrice : lookup(pmr.mainCode),
        hardenerPrice: pmr.hardenerPrice > 0 ? pmr.hardenerPrice : lookup(pmr.hardenerCode),
        thinnerPrice: pmr.thinnerPrice > 0 ? pmr.thinnerPrice : lookup(pmr.thinnerCode),
      };
    }
    map.set(normalizePn(enriched.paintCode), enriched);
    if (enriched.mainCode) map.set(normalizePn(enriched.mainCode), enriched);
  }
  return map;
}

function buildForwardMap(bomRecords) {
  const map = new Map();
  const seen = new Set();
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
// 6. getPaintInfo (bomCostEngine 동일)
// ============================================================

function getPaintInfo(pn, refInfoMap, priceData, paintMixMap) {
  const code = normalizePn(pn);
  const ri = refInfoMap.get(code);
  if (!ri) return undefined;

  const { materialTypeMap } = priceData;
  const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean);
  const isPaintPart = /도장/.test(ri.processType || '');

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
    return { paintCode: raw, paintName: mix.paintName || raw, mixCostPerKg, paintIntake, costPerEa };
  }

  if (isPaintPart) {
    for (const raw of rawCodes) {
      const rawNorm = normalizePn(raw);
      let mix = paintMixMap.get(rawNorm);
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
      return { paintCode: raw, paintName: mix.paintName || raw, mixCostPerKg, paintIntake, costPerEa };
    }
  }
  return undefined;
}

// ============================================================
// 7. getNodePrice (bomCostEngine 동일)
// ============================================================

function getNodePrice(pn, priceData, refInfoMap, paintMixMap) {
  const code = normalizePn(pn);
  const { matPriceMap, materialTypeMap, purchaseMap, outsourceMap, stdMap } = priceData;
  const ri = refInfoMap.get(code);

  // 1) 구매단가 (BOM코드 → customerPn fallback)
  const pp = purchaseMap.get(code)
    || (ri && ri.customerPn ? purchaseMap.get(normalizePn(ri.customerPn)) : 0)
    || 0;
  if (pp && pp > 0) {
    if (ri && /외주/.test(ri.supplyType || '')) {
      const op = outsourceMap.get(code)
        || (ri.customerPn ? outsourceMap.get(normalizePn(ri.customerPn)) : 0)
        || 0;
      return { price: Math.max(0, pp - op), source: op > 0 ? '외주' : '구매' };
    }
    return { price: pp, source: '구매' };
  }

  // 2) 사출공식 — ★ 엔진 원본: rawMaterialCode1,2만 탐색
  if (ri) {
    const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean);
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

  // 2.5) 도장공식
  if (ri && /도장/.test(ri.processType || '') && !/외주/.test(ri.supplyType || '')) {
    const paint = getPaintInfo(pn, refInfoMap, priceData, paintMixMap);
    if (paint && paint.costPerEa > 0) return { price: paint.costPerEa, source: '도장' };
  }

  // 3) 재질코드
  const dp = matPriceMap.get(code);
  if (dp && dp > 0) return { price: dp, source: '재질' };

  // 4) 표준 (BOM코드 → customerPn fallback)
  const std = stdMap.get(code)
    || (ri && ri.customerPn ? stdMap.get(normalizePn(ri.customerPn)) : 0)
    || 0;
  if (std && std > 0) return { price: std, source: '표준' };

  return { price: 0, source: '' };
}

// ============================================================
// 8. collectLeafMaterials (bomCostEngine 동일)
// ============================================================

function collectLeafMaterials(rootPn, monthlyQty, forwardMap, priceData, refInfoMap, paintMixMap, materialAgg) {
  const { materialTypeMap, matNameMap } = priceData;

  function walk(pn, qtyPerRoot, visited) {
    const code = normalizePn(pn);
    if (visited.has(code)) return;
    visited.add(code);

    const children = forwardMap.get(code) || [];
    if (children.length === 0) {
      const { price, source } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
      addToAgg(code, pn, qtyPerRoot, price, source);
      visited.delete(code);
      return;
    }

    const { price, source } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
    if (price > 0 && source !== '표준') {
      addToAgg(code, pn, qtyPerRoot, price, source);
      visited.delete(code);
      return;
    }

    for (const child of children) {
      walk(child.childPn, qtyPerRoot * child.qty, visited);
    }
    visited.delete(code);
  }

  // 디버그 카운터
  let _dbgCalls = 0, _dbgHasRi = 0, _dbgHasRaw = 0, _dbgRawMatch = 0, _dbgResinFound = 0;

  function addToAgg(code, pn, qtyPerRoot, price, source) {
    _dbgCalls++;
    const ri = refInfoMap.get(code);
    if (ri) _dbgHasRi++;
    const rawCodes = ri
      ? [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean)
      : [];
    if (rawCodes.length > 0) _dbgHasRaw++;

    let mt = materialTypeMap.get(code) || '';
    if (!mt) {
      for (const raw of rawCodes) {
        const rawMt = materialTypeMap.get(normalizePn(raw));
        if (rawMt) { mt = rawMt; break; }
      }
    }

    // 부품 코드 자체가 재질코드인지 (= 원재료 직접 사용) vs rawCode를 통한 간접 참조
    const selfIsRawMaterial = materialTypeMap.has(code);

    // matType 결정:
    // RESIN: mt 기반으로 넓게 (사출/외주사출 모두 — MRP)
    // PAINT: source='도장'만 (자체도장). 외주도장은 완성품 단가에 포함
    let matType = '구매';
    if (selfIsRawMaterial) {
      if (/resin|수지|사출/i.test(mt)) { matType = 'RESIN'; _dbgResinFound++; }
      else if (/paint|도료|도장|경화제|희석제/i.test(mt)) matType = 'PAINT';
    } else if (source === '구매') {
      matType = '구매';
    } else if (/resin|수지|사출/i.test(mt)) {
      matType = 'RESIN'; _dbgResinFound++;
    } else if (source === '사출') {
      matType = 'RESIN'; _dbgResinFound++;
    } else if (source === '도장') {
      matType = 'PAINT';
    } else if (source === '외주') {
      matType = '외주';
    } else if (/paint|도료|도장|경화제|희석제/i.test(mt)) {
      matType = 'PAINT';
    }

    let aggCode = code;
    let resolvedName = '';
    let supplier = '';
    let aggPrice = price;
    let qtyMultiplier = 1;

    if (matType === 'RESIN' && ri && !selfIsRawMaterial) {
      // BOM 부품의 rawCode를 통한 RESIN 집계 — EA→kg 변환이 가능한 경우만
      let resinResolved = false;
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        const rawMt = materialTypeMap.get(rawNorm) || '';
        if (/paint|도료/i.test(rawMt)) continue;
        if (materialTypeMap.has(rawNorm) || priceData.matPriceMap.has(rawNorm) || matNameMap.has(rawNorm)) {
          const rp = priceData.matPriceMap.get(rawNorm);
          if (rp && rp > 0 && ri.netWeight && ri.netWeight > 0) {
            aggCode = rawNorm;
            resolvedName = matNameMap.get(rawNorm) || raw;
            aggPrice = rp;
            const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
            const wpe = ri.netWeight + (ri.runnerWeight || 0) / cavity;
            qtyMultiplier = wpe * (1 + (ri.lossRate || 0) / 100) / 1000;
            resinResolved = true;
          }
          break;
        }
      }
      // netWeight 없어 변환 불가 → 구매부품으로 유지 (1EA=1kg 오류 방지)
      if (!resinResolved) {
        matType = source === '외주' ? '외주' : '구매';
      }
    } else if (matType === 'RESIN' && ri && selfIsRawMaterial) {
      // 코드 자체가 재질코드 → 변환 불필요, 가격만 확인
      const rp = priceData.matPriceMap.get(code);
      if (rp && rp > 0) aggPrice = rp;
      resolvedName = matNameMap.get(code) || ri?.itemName || pn;
    } else if (matType === 'PAINT' && ri && !selfIsRawMaterial) {
      // BOM 부품의 rawCode를 통한 PAINT 집계 — paintIntake 있을 때만
      let paintResolved = false;
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        const rawMt = materialTypeMap.get(rawNorm) || '';
        const isPaintCode = /paint|도료|도장|경화제|희석제/i.test(rawMt);
        const mix = paintMixMap.get(rawNorm);
        if (!isPaintCode && !mix) continue;
        if (mix && ri.paintIntake && ri.paintIntake > 0) {
          aggCode = rawNorm;
          resolvedName = mix.paintName || matNameMap.get(rawNorm) || raw;
          const mixCostPerKg =
            (mix.mainRatio / 100) * mix.mainPrice +
            (mix.hardenerRatio / 100) * mix.hardenerPrice +
            (mix.thinnerRatio / 100) * mix.thinnerPrice;
          aggPrice = mixCostPerKg;
          qtyMultiplier = 1 / ri.paintIntake;
          paintResolved = true;
        }
        break;
      }
      // paintIntake 없어 변환 불가 → 구매부품으로 유지
      if (!paintResolved) {
        matType = source === '외주' ? '외주' : '구매';
      }
    } else if (matType === 'PAINT' && ri && selfIsRawMaterial) {
      // 코드 자체가 도료코드 → 변환 불필요
      const rp = priceData.matPriceMap.get(code);
      if (rp && rp > 0) aggPrice = rp;
      resolvedName = matNameMap.get(code) || ri?.itemName || pn;
    }

    if (!resolvedName) {
      resolvedName = matNameMap.get(aggCode) || ri?.itemName || pn;
    }

    // 집계
    const rootNorm = normalizePn(rootPn);
    const existing = materialAgg.get(aggCode);
    if (existing) {
      for (let m = 0; m < 12; m++) {
        existing.monthlyQty[m] += qtyPerRoot * qtyMultiplier * (monthlyQty[m] || 0);
      }
      existing.parents.add(rootNorm);
      const contrib = existing.contributions.get(rootNorm);
      if (contrib) {
        contrib.qtyPerUnit += qtyPerRoot * qtyMultiplier;
        for (let m = 0; m < 12; m++) {
          contrib.monthlyQty[m] += qtyPerRoot * qtyMultiplier * (monthlyQty[m] || 0);
        }
      } else {
        const cmq = new Array(12).fill(0);
        for (let m = 0; m < 12; m++) {
          cmq[m] = qtyPerRoot * qtyMultiplier * (monthlyQty[m] || 0);
        }
        existing.contributions.set(rootNorm, { qtyPerUnit: qtyPerRoot * qtyMultiplier, monthlyQty: cmq });
      }
    } else {
      const mq = new Array(12).fill(0);
      const cmq = new Array(12).fill(0);
      for (let m = 0; m < 12; m++) {
        mq[m] = qtyPerRoot * qtyMultiplier * (monthlyQty[m] || 0);
        cmq[m] = mq[m];
      }
      const contributions = new Map();
      contributions.set(rootNorm, { qtyPerUnit: qtyPerRoot * qtyMultiplier, monthlyQty: cmq });
      materialAgg.set(aggCode, {
        name: resolvedName,
        type: matType,
        monthlyQty: mq,
        unitPrice: aggPrice,
        parents: new Set([rootNorm]),
        supplier,
        contributions,
      });
    }
  }

  const rootChildren = forwardMap.get(normalizePn(rootPn)) || [];
  const visited = new Set();
  for (const child of rootChildren) {
    walk(child.childPn, child.qty, visited);
  }
}

// ============================================================
// 9. calcRootMaterialCost (bomCostEngine 동일 — 제품 원가)
// ============================================================

function calcRootMaterialCost(rootPn, forwardMap, priceData, refInfoMap, paintMixMap) {
  const visited = new Set();

  function walk(pn, qty) {
    const code = normalizePn(pn);
    if (visited.has(code)) return 0;
    visited.add(code);

    const children = forwardMap.get(code) || [];
    if (children.length === 0) {
      const { price } = getNodePrice(pn, priceData, refInfoMap, paintMixMap);
      visited.delete(code);
      return qty * price;
    }

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

  const children = forwardMap.get(normalizePn(rootPn)) || [];
  let total = 0;
  for (const child of children) {
    total += walk(child.childPn, child.qty);
  }
  return total;
}

// ============================================================
// 10. 메인: 전체 엔진 실행 + RESIN 검증
// ============================================================

async function main() {
  const data = await loadAllData();
  const {
    forecast, bomRecords, refInfo, materialCodes,
    purchasePrices, outsourcePrices, paintMixRatios,
    itemStandardCosts, productCodes, pnMapping,
    purchaseData,
  } = data;

  console.log('\n🔧 Map 구축 중...');
  const priceData = buildPriceData(materialCodes, purchasePrices, outsourcePrices, itemStandardCosts);
  const paintMixMap = buildPaintMixMap(paintMixRatios, priceData);
  const refInfoMap = buildRefInfoMap(refInfo);
  const forwardMap = buildForwardMap(bomRecords);

  // P/N 매핑
  const custToInternal = new Map();
  const internalToCust = new Map();
  for (const pc of productCodes) {
    if (pc.productCode && pc.customerPn) {
      custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
      internalToCust.set(normalizePn(pc.productCode), normalizePn(pc.customerPn));
    }
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
  for (const sc of itemStandardCosts) {
    if (sc.customer_pn && sc.item_code) {
      const cpn = normalizePn(sc.customer_pn);
      const icode = normalizePn(sc.item_code);
      if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
      if (!internalToCust.has(icode)) internalToCust.set(icode, cpn);
    }
  }
  for (const m of pnMapping) {
    if (m.customerPn && m.internalCode) {
      const cpn = normalizePn(m.customerPn);
      const icode = normalizePn(m.internalCode);
      if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
      if (!internalToCust.has(icode)) internalToCust.set(icode, cpn);
    }
  }

  // BOM prefix index
  const bomPrefixIndex = new Map();
  for (const pn of forwardMap.keys()) {
    for (let len = 8; len <= pn.length; len++) {
      const p = pn.slice(0, len);
      if (!bomPrefixIndex.has(p)) bomPrefixIndex.set(p, pn);
    }
  }

  function findBomParent(forecastPn) {
    const bomParent = normalizePn(forecastPn);
    if (forwardMap.has(bomParent)) return bomParent;
    const internal = custToInternal.get(bomParent);
    if (internal && forwardMap.has(internal)) return internal;
    const cust = internalToCust.get(bomParent);
    if (cust && forwardMap.has(cust)) return cust;
    if (bomParent.length >= 10) {
      for (let pl = bomParent.length - 1; pl >= 8; pl--) {
        const prefix = bomParent.slice(0, pl);
        const candidate = bomPrefixIndex.get(prefix);
        if (candidate && forwardMap.has(candidate)) return candidate;
      }
    }
    return null;
  }

  // ── 전체 Forecast 순회 → 제품 원가 + MRP 자재 집계 ──
  console.log('\n📊 전체 Forecast 원가 계산 시작...\n');
  const materialAgg = new Map();
  const productNameMap = new Map();
  const products = [];
  let totalRevenue = 0;
  let totalMaterial = 0;
  let matchedCount = 0;
  const processedFcPns = new Set();

  for (const fc of forecast) {
    const forecastPn = normalizePn(fc.newPartNo || fc.partNo);
    if (processedFcPns.has(forecastPn)) continue;
    processedFcPns.add(forecastPn);

    let bomParent = findBomParent(forecastPn);
    if (!bomParent && fc.newPartNo) {
      bomParent = findBomParent(fc.partNo);
    }

    const qty = fc.totalQty;
    const rev = fc.totalRevenue > 0 ? fc.totalRevenue : fc.unitPrice * fc.totalQty;

    const materialCost = bomParent
      ? calcRootMaterialCost(bomParent, forwardMap, priceData, refInfoMap, paintMixMap)
      : 0;
    const materialTotal = qty * materialCost;

    if (rev > 0 && materialCost > 0) {
      totalRevenue += rev;
      totalMaterial += materialTotal;
      matchedCount++;
    }

    if (bomParent && materialCost > 0 && fc.monthlyQty.some(q => q > 0)) {
      productNameMap.set(normalizePn(bomParent), fc.partName || '');
      collectLeafMaterials(bomParent, fc.monthlyQty, forwardMap, priceData, refInfoMap, paintMixMap, materialAgg);
    }

    products.push({
      pn: fc.partNo,
      name: fc.partName || '',
      bomParent: bomParent || '(미매칭)',
      materialCost,
      planQty: qty,
      expectedRevenue: rev,
      materialTotal,
    });
  }

  // addToAgg 디버그 요약 (collectLeafMaterials 내부의 클로저 변수는 접근 불가하므로 materialAgg에서 유추)
  console.log(`\n[materialAgg 디버그]`);
  console.log(`  materialAgg 항목 수: ${materialAgg.size}`);
  const aggTypes = {};
  for (const [code, agg] of materialAgg) {
    aggTypes[agg.type] = (aggTypes[agg.type] || 0) + 1;
  }
  console.log(`  유형별: ${JSON.stringify(aggTypes)}`);
  // 사출 관련 refInfo가 있는 자재 코드 샘플 출력
  let sampleResinRef = 0;
  for (const ri of refInfo) {
    if (ri.rawMaterialCode1) {
      const rawNorm = normalizePn(ri.rawMaterialCode1);
      const rawMt = priceData.materialTypeMap.get(rawNorm) || '';
      if (/사출|수지|resin/i.test(rawMt) && sampleResinRef < 5) {
        sampleResinRef++;
        console.log(`  refInfo 샘플: ${ri.itemCode} → rawCode1=${ri.rawMaterialCode1} (mt="${rawMt}") netWeight=${ri.netWeight}g`);
      }
    }
  }

  // ── Leaf materials 결과 정리 ──
  const leafMaterials = [];
  for (const [code, agg] of materialAgg) {
    const totalQty = agg.monthlyQty.reduce((s, q) => s + q, 0);
    const breakdown = [];
    for (const [pn, contrib] of agg.contributions) {
      const cTotal = contrib.monthlyQty.reduce((s, q) => s + q, 0);
      breakdown.push({
        productPn: pn,
        productName: productNameMap.get(pn) || pn,
        qtyPerUnit: contrib.qtyPerUnit,
        monthlyQty: contrib.monthlyQty,
        totalQty: cTotal,
      });
    }
    breakdown.sort((a, b) => b.totalQty - a.totalQty);

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
      productBreakdown: breakdown,
    });
  }
  leafMaterials.sort((a, b) => b.totalCost - a.totalCost);

  // ── 결과 요약 ──
  console.log('='.repeat(80));
  console.log('MRP 원가 엔진 독립 검증 보고서');
  console.log('='.repeat(80));

  console.log(`\n[전체 요약]`);
  console.log(`  Forecast 품목 수: ${products.length}`);
  console.log(`  BOM 매칭 제품 수: ${matchedCount}`);
  console.log(`  총 매출: ₩${Math.round(totalRevenue).toLocaleString()}`);
  console.log(`  총 재료비: ₩${Math.round(totalMaterial).toLocaleString()}`);
  console.log(`  재료비율: ${(totalRevenue > 0 ? (totalMaterial / totalRevenue * 100) : 0).toFixed(1)}%`);
  console.log(`  리프 자재 수: ${leafMaterials.length}`);

  // ── 디버그: 자재 유형 분포 확인 ──
  const typeCounts = {};
  for (const lm of leafMaterials) {
    typeCounts[lm.materialType] = (typeCounts[lm.materialType] || 0) + 1;
  }
  console.log(`\n[리프 자재 유형 분포]`);
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type}: ${count}건`);
  }

  // 디버그: materialTypeMap 값 중 RESIN 관련 있는지 확인
  let resinTypeMapCount = 0;
  let sampleTypes = [];
  for (const [code, mt] of priceData.materialTypeMap) {
    if (/resin|수지|사출/i.test(mt)) resinTypeMapCount++;
    if (sampleTypes.length < 5 && mt) sampleTypes.push(`${code}=${mt}`);
  }
  console.log(`\n[materialTypeMap 디버그]`);
  console.log(`  총 항목: ${priceData.materialTypeMap.size}`);
  console.log(`  RESIN 타입 항목: ${resinTypeMapCount}`);
  console.log(`  샘플: ${sampleTypes.join(' | ')}`);

  // 디버그: materialCodes 원본 데이터의 materialType 분포
  const mcTypes = {};
  for (const mc of materialCodes) {
    const combined = [mc.materialType, mc.materialCategory, mc.paintCategory].filter(Boolean).join('|');
    mcTypes[combined] = (mcTypes[combined] || 0) + 1;
  }
  console.log(`\n[material_code_master 유형 분포]`);
  for (const [type, count] of Object.entries(mcTypes).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  "${type}": ${count}건`);
  }

  // ── RESIN 자재 Top 10 ──
  const resinMats = leafMaterials.filter(m => m.materialType === 'RESIN');
  console.log(`\n[RESIN 자재 Top 10] (${resinMats.length}건 중)`);
  console.log('-'.repeat(80));
  console.log(
    '순위'.padEnd(4) +
    '코드'.padEnd(18) +
    '자재명'.padEnd(20) +
    '단가(₩/kg)'.padStart(12) +
    '총소요량(kg)'.padStart(14) +
    '총금액(₩)'.padStart(16) +
    '제품수'.padStart(6)
  );
  for (let i = 0; i < Math.min(10, resinMats.length); i++) {
    const m = resinMats[i];
    console.log(
      `${(i + 1)}`.padEnd(4) +
      m.materialCode.padEnd(18) +
      (m.materialName || '').substring(0, 18).padEnd(20) +
      Math.round(m.unitPrice).toLocaleString().padStart(12) +
      Math.round(m.monthlyQty.reduce((s, q) => s + q, 0)).toLocaleString().padStart(14) +
      Math.round(m.totalCost).toLocaleString().padStart(16) +
      `${m.productBreakdown.length}`.padStart(6)
    );
  }

  // ── Top 1 RESIN 상세 검증 ──
  if (resinMats.length === 0) {
    console.log('\n⚠️ RESIN 자재가 없습니다.');
    return;
  }

  // Top 3 RESIN에 대해 상세 검증
  const verifyCount = Math.min(3, resinMats.length);
  for (let vi = 0; vi < verifyCount; vi++) {
    const targetMat = resinMats[vi];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 [RESIN #${vi + 1} 상세 검증] ${targetMat.materialCode} — ${targetMat.materialName}`);
    console.log('='.repeat(80));

    console.log(`\n  [기본정보]`);
    console.log(`    코드: ${targetMat.materialCode}`);
    console.log(`    명칭: ${targetMat.materialName}`);
    console.log(`    유형: ${targetMat.materialType}`);
    console.log(`    단위: ${targetMat.unit}`);
    console.log(`    단가: ₩${Math.round(targetMat.unitPrice).toLocaleString()}/kg`);
    console.log(`    총소요량: ${targetMat.monthlyQty.reduce((s, q) => s + q, 0).toFixed(2)} kg`);
    console.log(`    총금액: ₩${Math.round(targetMat.totalCost).toLocaleString()}`);
    console.log(`    월별: ${targetMat.monthlyQty.map((q, i) => `${i + 1}월=${Math.round(q)}`).join(', ')}`);

    // ── 제품별 산출근거 ──
    console.log(`\n  [제품별 산출근거] (${targetMat.productBreakdown.length}건)`);
    console.log('  ' + '-'.repeat(78));
    const totalMatQty = targetMat.monthlyQty.reduce((s, q) => s + q, 0);
    for (const c of targetMat.productBreakdown) {
      const pct = totalMatQty > 0 ? (c.totalQty / totalMatQty * 100) : 0;
      console.log(`    ${c.productPn} (${c.productName})`);
      console.log(`      단위소요량: ${c.qtyPerUnit.toFixed(6)} kg/EA`);
      console.log(`      연간소요량: ${c.totalQty.toFixed(2)} kg (${pct.toFixed(1)}%)`);
      console.log(`      월별: ${c.monthlyQty.map((q, i) => q > 0 ? `${i + 1}월=${Math.round(q)}` : '').filter(Boolean).join(', ')}`);
    }

    // ── 교차 검증: 산출근거 합계 vs 자재 총소요량 ──
    const breakdownSum = targetMat.productBreakdown.reduce((s, c) => s + c.totalQty, 0);
    console.log(`\n  [교차 검증 #1: 산출근거 합계 vs 총소요량]`);
    console.log(`    산출근거 합계: ${breakdownSum.toFixed(4)} kg`);
    console.log(`    자재 총소요량: ${totalMatQty.toFixed(4)} kg`);
    const diff1 = Math.abs(breakdownSum - totalMatQty);
    console.log(`    차이: ${diff1.toFixed(4)} → ${diff1 < 0.01 ? '✅ 일치' : '❌ 불일치'}`);

    // ── BOM 역전개 검증 ──
    console.log(`\n  [BOM 역전개 검증]`);
    console.log('  ' + '-'.repeat(78));
    const targetCode = normalizePn(targetMat.materialCode);
    let totalReverseCheck = 0;
    const issues = [];

    for (const contrib of targetMat.productBreakdown) {
      const rootPn = normalizePn(contrib.productPn);
      const paths = [];

      function findPaths(pn, currentPath, accQty, visited) {
        const code = normalizePn(pn);
        if (visited.has(code)) return;
        visited.add(code);

        const ri = refInfoMap.get(code);
        const rawCodes = ri
          ? [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4]
              .filter(Boolean).map(r => normalizePn(r))
          : [];

        if (code === targetCode || rawCodes.includes(targetCode)) {
          paths.push({ path: [...currentPath, code], bomQty: accQty, refInfo: ri });
        }

        const children = forwardMap.get(code) || [];
        for (const child of children) {
          findPaths(child.childPn, [...currentPath, code], accQty * child.qty, visited);
        }
        visited.delete(code);
      }

      const rootChildren = forwardMap.get(rootPn) || [];
      for (const child of rootChildren) {
        findPaths(child.childPn, [rootPn], child.qty, new Set());
      }

      let productReverseTotal = 0;
      for (const { path, bomQty, refInfo: ri } of paths) {
        let qtyMultiplier = 1;
        let refData = null;

        if (ri && ri.netWeight) {
          const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
          const wpe = ri.netWeight + (ri.runnerWeight || 0) / cavity;
          qtyMultiplier = wpe * (1 + (ri.lossRate || 0) / 100) / 1000;
          refData = {
            netWeight: ri.netWeight,
            runnerWeight: ri.runnerWeight || 0,
            cavity,
            lossRate: ri.lossRate || 0,
          };
        }

        const qtyPerUnit = bomQty * qtyMultiplier;
        productReverseTotal += qtyPerUnit;

        console.log(`    ${contrib.productPn} → ${path.join(' → ')}`);
        console.log(`      BOM수량: ${bomQty} | 변환계수: ${qtyMultiplier.toFixed(6)} | qtyPerUnit: ${qtyPerUnit.toFixed(6)} kg/EA`);
        if (refData) {
          console.log(`      refInfo: NET=${refData.netWeight}g, Runner=${refData.runnerWeight}g, Cavity=${refData.cavity}, Loss=${refData.lossRate}%`);
        }
      }

      // Compare with engine's qtyPerUnit
      if (Math.abs(productReverseTotal - contrib.qtyPerUnit) > 0.0001) {
        issues.push(
          `[${contrib.productPn}] BOM역전개 qtyPerUnit(${productReverseTotal.toFixed(6)}) ≠ 엔진 qtyPerUnit(${contrib.qtyPerUnit.toFixed(6)})`
        );
      }
      totalReverseCheck += productReverseTotal;

      if (paths.length === 0) {
        console.log(`    ${contrib.productPn}: ⚠️ BOM 경로 없음 (역전개 실패)`);
        issues.push(`[${contrib.productPn}] BOM 경로를 찾을 수 없음`);
      }
    }

    // ── 교차 검증 #2: BOM 역전개 vs 엔진 ──
    console.log(`\n  [교차 검증 #2: 각 제품의 BOM역전개 qtyPerUnit vs 엔진 산출 qtyPerUnit]`);
    for (const contrib of targetMat.productBreakdown) {
      const rootPn = normalizePn(contrib.productPn);
      // 재계산
      const rpaths = [];
      function findP2(pn, currentPath, accQty, visited) {
        const code = normalizePn(pn);
        if (visited.has(code)) return;
        visited.add(code);
        const ri = refInfoMap.get(code);
        const rawCodes = ri
          ? [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4]
              .filter(Boolean).map(r => normalizePn(r))
          : [];
        if (code === targetCode || rawCodes.includes(targetCode)) {
          rpaths.push({ bomQty: accQty, refInfo: ri });
        }
        const children = forwardMap.get(code) || [];
        for (const child of children) {
          findP2(child.childPn, [...currentPath, code], accQty * child.qty, visited);
        }
        visited.delete(code);
      }
      const rootChildren = forwardMap.get(rootPn) || [];
      for (const child of rootChildren) {
        findP2(child.childPn, [rootPn], child.qty, new Set());
      }

      let revTotal = 0;
      for (const { bomQty, refInfo: ri } of rpaths) {
        let qm = 1;
        if (ri && ri.netWeight) {
          const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
          const wpe = ri.netWeight + (ri.runnerWeight || 0) / cavity;
          qm = wpe * (1 + (ri.lossRate || 0) / 100) / 1000;
        }
        revTotal += bomQty * qm;
      }

      const match = Math.abs(revTotal - contrib.qtyPerUnit) < 0.0001;
      console.log(
        `    ${contrib.productPn}: 역전개=${revTotal.toFixed(6)} vs 엔진=${contrib.qtyPerUnit.toFixed(6)} → ${match ? '✅' : '❌ 차이=' + (revTotal - contrib.qtyPerUnit).toFixed(6)}`
      );
    }

    // ── 교차 검증 #3: 제품별 재료비 내 비중 ──
    console.log(`\n  [교차 검증 #3: 제품별 재료비 내 이 자재 비중]`);
    for (const contrib of targetMat.productBreakdown) {
      const rootPn = normalizePn(contrib.productPn);
      const productMatCost = calcRootMaterialCost(rootPn, forwardMap, priceData, refInfoMap, paintMixMap);
      const thisContrib = contrib.qtyPerUnit * targetMat.unitPrice;
      const ratio = productMatCost > 0 ? (thisContrib / productMatCost * 100) : 0;
      console.log(
        `    ${contrib.productPn}: 전체재료비=₩${Math.round(productMatCost)} | 이 자재 기여분=₩${thisContrib.toFixed(2)} (${ratio.toFixed(1)}%)`
      );
    }

    // ── 엔진 내부 구조 검증: getNodePrice vs addToAgg rawCode 탐색 범위 비교 ──
    console.log(`\n  [교차 검증 #4: getNodePrice vs addToAgg rawCode 탐색 범위 검증]`);
    // 이 자재를 사용하는 각 BOM 부품에서 rawCode1~4 중 몇 번째에서 매칭되는지 확인
    for (const contrib of targetMat.productBreakdown) {
      const rootPn = normalizePn(contrib.productPn);
      // 이 제품 BOM에서 타겟 자재를 참조하는 모든 부품 찾기
      function findRefNodes(pn, visited) {
        const code = normalizePn(pn);
        if (visited.has(code)) return [];
        visited.add(code);
        const results = [];
        const ri = refInfoMap.get(code);
        if (ri) {
          const raws = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4];
          for (let idx = 0; idx < raws.length; idx++) {
            if (raws[idx] && normalizePn(raws[idx]) === targetCode) {
              results.push({ bomPn: code, rawIndex: idx + 1, ri });
            }
          }
        }
        const children = forwardMap.get(code) || [];
        for (const child of children) {
          results.push(...findRefNodes(child.childPn, visited));
        }
        visited.delete(code);
        return results;
      }
      const refNodes = findRefNodes(rootPn, new Set());
      for (const { bomPn, rawIndex, ri } of refNodes) {
        const gnp = getNodePrice(bomPn, priceData, refInfoMap, paintMixMap);
        const inGetNodePriceRange = rawIndex <= 2;
        console.log(
          `    ${contrib.productPn} > ${bomPn}: rawMaterialCode${rawIndex}에서 매칭` +
          ` | getNodePrice 범위(1-2): ${inGetNodePriceRange ? '✅ 포함' : '⚠️ 범위 밖 (3 or 4)'} ` +
          ` | addToAgg 범위(1-4): ✅ 포함` +
          ` | getNodePrice={price:${gnp.price.toFixed(2)}, source:'${gnp.source}'}`
        );
        if (!inGetNodePriceRange) {
          issues.push(
            `[${bomPn}] rawMaterialCode${rawIndex}에서 매칭됨 → getNodePrice(1-2 탐색)에서는 놓칠 수 있음`
          );
        }
      }
    }

    // ── 이슈 요약 ──
    if (issues.length > 0) {
      console.log(`\n  ⚠️ [발견된 이슈] (${issues.length}건)`);
      console.log('  ' + '-'.repeat(78));
      for (const issue of issues) {
        console.log(`    ❌ ${issue}`);
      }
    } else {
      console.log(`\n  ✅ 이 자재에 대한 이슈 없음 — 산출근거가 BOM 역전개와 일치합니다.`);
    }
  }

  // ── 전체 RESIN 합계 검증 ──
  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 전체 RESIN 합계 검증');
  console.log('='.repeat(80));

  const totalResinCost = resinMats.reduce((s, m) => s + m.totalCost, 0);
  const totalResinQty = resinMats.reduce((s, m) => s + m.monthlyQty.reduce((ss, q) => ss + q, 0), 0);
  console.log(`  RESIN 자재 수: ${resinMats.length}`);
  console.log(`  RESIN 총소요량: ${totalResinQty.toFixed(2)} kg`);
  console.log(`  RESIN 총금액: ₩${Math.round(totalResinCost).toLocaleString()}`);
  console.log(`  전체 재료비 대비 비율: ${(totalMaterial > 0 ? totalResinCost / totalMaterial * 100 : 0).toFixed(1)}%`);

  // ── 전체 자재 유형별 집계 ──
  const typeAmounts = new Map();
  for (const lm of leafMaterials) {
    typeAmounts.set(lm.materialType, (typeAmounts.get(lm.materialType) || 0) + lm.totalCost);
  }
  console.log(`\n  [유형별 재료비]`);
  for (const [type, amount] of [...typeAmounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ₩${Math.round(amount).toLocaleString()} (${(totalMaterial > 0 ? amount / totalMaterial * 100 : 0).toFixed(1)}%)`);
  }

  // ── PAINT 상세 진단 ──
  const paintMaterials = leafMaterials.filter(m => m.materialType === 'PAINT')
    .sort((a, b) => b.totalCost - a.totalCost);
  if (paintMaterials.length > 0) {
    console.log(`\n  [PAINT 상세 진단] (${paintMaterials.length}건)`);
    console.log(`  ${'─'.repeat(70)}`);
    // Top 15 PAINT by cost
    for (const pm of paintMaterials.slice(0, 15)) {
      const totalQty = pm.monthlyQty.reduce((s, q) => s + q, 0);
      console.log(`    ${pm.materialCode} (${pm.materialName || '?'})`);
      console.log(`      단가=₩${Math.round(pm.unitPrice).toLocaleString()} | 총소요=${totalQty.toFixed(1)}kg | 금액=₩${Math.round(pm.totalCost).toLocaleString()}`);
      // 이 자재를 사용하는 제품 중 source별 분포 확인
      const contributions = pm.productBreakdown || [];
      if (contributions.length > 0) {
        console.log(`      제품수: ${contributions.length} | 상위: ${contributions.slice(0, 3).map(c => `${c.productPn}(${c.totalQty.toFixed(1)}kg)`).join(', ')}`);
      }
    }
    // source 분석: 각 PAINT 자재의 원래 부품들이 어떤 source로 분류되었는지
    console.log(`\n  [PAINT 원인 분석]`);
    // paintIntake 분포 확인
    const paintIntakes = [];
    for (const ri of refInfo) {
      if (ri.paintIntake && ri.paintIntake > 0) {
        paintIntakes.push({ code: normalizePn(ri.itemCode), intake: ri.paintIntake });
      }
    }
    console.log(`    paintIntake > 0인 부품: ${paintIntakes.length}건`);
    paintIntakes.sort((a, b) => a.intake - b.intake);
    if (paintIntakes.length > 0) {
      console.log(`    paintIntake 범위: ${paintIntakes[0].intake} ~ ${paintIntakes[paintIntakes.length - 1].intake}`);
      console.log(`    paintIntake < 10: ${paintIntakes.filter(p => p.intake < 10).length}건 (= 1EA당 > 0.1kg 도료 사용)`);
      // 매우 낮은 paintIntake 표시
      for (const pi of paintIntakes.filter(p => p.intake < 5).slice(0, 10)) {
        console.log(`      ${pi.code}: paintIntake=${pi.intake} → 1/${pi.intake}=${(1/pi.intake).toFixed(4)} kg/EA`);
      }
    }
  }

  // ── getNodePrice rawCode 범위 이슈 전체 스캔 ──
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔍 전체 스캔: rawMaterialCode3,4에서만 매칭되는 RESIN 부품');
  console.log('='.repeat(80));
  let rawCode34Count = 0;
  for (const ri of refInfo) {
    const code = normalizePn(ri.itemCode);
    const raws = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4];
    // rawCode3 또는 rawCode4에 RESIN 코드가 있고, rawCode1,2에는 해당 코드가 없는 경우
    for (let idx = 2; idx < 4; idx++) {
      if (!raws[idx]) continue;
      const rawNorm = normalizePn(raws[idx]);
      const rawMt = priceData.materialTypeMap.get(rawNorm) || '';
      if (!/resin|수지|사출/i.test(rawMt)) continue;
      // rawCode1,2에 같은 코드가 없는지 확인
      const inFirstTwo = [raws[0], raws[1]].some(r => r && normalizePn(r) === rawNorm);
      if (!inFirstTwo) {
        const rp = priceData.matPriceMap.get(rawNorm);
        rawCode34Count++;
        if (rawCode34Count <= 20) {
          console.log(
            `  ${code}: rawMaterialCode${idx + 1}=${rawNorm} (RESIN) — rawCode1,2에 없음` +
            ` | netWeight=${ri.netWeight}g | matPrice=${rp ? '₩' + Math.round(rp) : '없음'}` +
            ` | getNodePrice에서 사출 계산 누락 가능`
          );
        }
      }
    }
  }
  console.log(`  합계: ${rawCode34Count}건 (rawCode3,4에서만 RESIN 매칭)`);
  if (rawCode34Count > 0) {
    console.log(`  ⚠️ getNodePrice는 rawCode1,2만 탐색하므로, 이 ${rawCode34Count}건에서 사출 계산이 누락될 수 있음`);
    console.log(`  → addToAgg는 rawCode1-4 모두 탐색하므로 MRP 집계에는 포함됨`);
    console.log(`  → 제품 재료비(EA당)와 MRP 소요금액(kg단가×소요량) 간 불일치 가능`);
  } else {
    console.log(`  ✅ 모든 RESIN rawCode가 1번 또는 2번에 위치 — 탐색 범위 이슈 없음`);
  }

  // ============================================================
  // 전체심도 MRP RESIN vs 실제 입고 비교
  // ============================================================
  console.log(`\n${'='.repeat(80)}`);
  console.log('📦 전체심도 MRP RESIN vs 실제 입고 비교');
  console.log('='.repeat(80));

  // 1) 전체심도 BOM 워크: 중간노드 가격 무시, 항상 리프까지 전개
  const resinCodes = new Set();
  for (const [code, mt] of priceData.materialTypeMap.entries()) {
    if (/resin|수지|사출/i.test(mt)) resinCodes.add(code);
  }

  // RESIN 코드별 집계 { qty: number[], totalQty: number, price: number }
  const mrpResin = new Map();

  for (const fc of forecast) {
    const partNo = normalizePn(fc.partNo);
    const newPartNo = normalizePn(fc.newPartNo || '');
    let bomParent = '';
    if (forwardMap.has(partNo)) bomParent = partNo;
    else if (newPartNo && forwardMap.has(newPartNo)) bomParent = newPartNo;
    else if (custToInternal.has(partNo) && forwardMap.has(custToInternal.get(partNo))) bomParent = custToInternal.get(partNo);
    else if (newPartNo && custToInternal.has(newPartNo) && forwardMap.has(custToInternal.get(newPartNo))) bomParent = custToInternal.get(newPartNo);
    if (!bomParent) continue;

    function walkDeep(pn, qtyPerRoot, visited) {
      const code = normalizePn(pn);
      if (visited.has(code)) return;
      visited.add(code);

      const children = forwardMap.get(code) || [];
      if (children.length === 0) {
        // 리프: RESIN rawCode + netWeight 확인
        const ri = refInfoMap.get(code);
        if (ri) {
          const rawCds = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean).map(normalizePn);
          for (const raw of rawCds) {
            if (!resinCodes.has(raw)) continue;
            const rp = priceData.matPriceMap.get(raw) || 0;
            if (ri.netWeight && ri.netWeight > 0) {
              const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
              const wpe = ri.netWeight + (ri.runnerWeight || 0) / cavity;
              const qtyMultiplier = wpe * (1 + (ri.lossRate || 0) / 100) / 1000;
              const qtyPerUnit = qtyPerRoot * qtyMultiplier;

              if (!mrpResin.has(raw)) mrpResin.set(raw, { name: priceData.matNameMap.get(raw) || raw, qty: Array(12).fill(0), totalQty: 0, price: rp });
              const agg = mrpResin.get(raw);
              for (let m = 0; m < 12; m++) {
                const mQty = qtyPerUnit * (Number(fc.monthlyQty[m]) || 0);
                agg.qty[m] += mQty;
                agg.totalQty += mQty;
              }
              break; // first RESIN rawCode only
            }
          }
        }
        visited.delete(code);
        return;
      }

      // 비-리프: 항상 자식으로 전개 (중간노드 가격 무시)
      for (const child of children) {
        walkDeep(child.childPn, qtyPerRoot * child.qty, visited);
      }
      visited.delete(code);
    }
    walkDeep(bomParent, 1, new Set());
  }

  // MRP 결과 정리
  const mrpSorted = [...mrpResin.entries()].sort((a, b) => b[1].totalQty - a[1].totalQty);
  const mrpTotalQty = mrpSorted.reduce((s, [, v]) => s + v.totalQty, 0);
  const mrpTotalCost = mrpSorted.reduce((s, [, v]) => s + v.totalQty * v.price, 0);

  console.log(`\n  [전체심도 MRP RESIN]`);
  console.log(`  RESIN 코드 수: ${mrpSorted.length}`);
  console.log(`  총소요량: ${Math.round(mrpTotalQty).toLocaleString()} kg`);
  console.log(`  총소요금액: ₩${Math.round(mrpTotalCost).toLocaleString()} (단가 기준)`);

  // 2) 실제 입고와 비교
  const purchMonths = new Set();
  const actualByCode = new Map();
  for (const pr of purchaseData) {
    if (pr.year !== 2026) continue;
    const code = normalizePn(pr.itemCode);
    if (!resinCodes.has(code)) continue;
    purchMonths.add(pr.month);
    if (!actualByCode.has(code)) actualByCode.set(code, { name: pr.itemName, qty: 0, amount: 0 });
    const a = actualByCode.get(code);
    a.qty += pr.qty;
    a.amount += pr.amount;
  }
  const nMonths = purchMonths.size || 1;
  const actualTotalQty = [...actualByCode.values()].reduce((s, v) => s + v.qty, 0);
  const actualTotalAmt = [...actualByCode.values()].reduce((s, v) => s + v.amount, 0);
  const annualActualQty = Math.round(actualTotalQty / nMonths * 12);
  const annualActualAmt = Math.round(actualTotalAmt / nMonths * 12);

  console.log(`\n  [2026년 실제 RESIN 입고] (${[...purchMonths].sort().join(', ')} = ${nMonths}개월)`);
  console.log(`  3개월 실적: ${Math.round(actualTotalQty).toLocaleString()} kg / ₩${Math.round(actualTotalAmt).toLocaleString()}`);
  console.log(`  연간 환산:  ${annualActualQty.toLocaleString()} kg / ₩${annualActualAmt.toLocaleString()}`);

  console.log(`\n  [비교 요약]`);
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  ${'구분'.padEnd(20)} ${'소요량(kg)'.padStart(14)} ${'금액(₩)'.padStart(18)} ${'비율'.padStart(8)}`);
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  ${'엔진(기존)'.padEnd(18)} ${Math.round(totalResinQty).toLocaleString().padStart(14)} ${('₩'+Math.round(totalResinCost).toLocaleString()).padStart(18)} ${(annualActualQty > 0 ? (totalResinQty / annualActualQty * 100).toFixed(0) : '-').padStart(7)}%`);
  console.log(`  ${'전체심도 MRP'.padEnd(18)} ${Math.round(mrpTotalQty).toLocaleString().padStart(14)} ${('₩'+Math.round(mrpTotalCost).toLocaleString()).padStart(18)} ${(annualActualQty > 0 ? (mrpTotalQty / annualActualQty * 100).toFixed(0) : '-').padStart(7)}%`);
  console.log(`  ${'실제입고(연환산)'.padEnd(18)} ${annualActualQty.toLocaleString().padStart(14)} ${('₩'+annualActualAmt.toLocaleString()).padStart(18)} ${'100'.padStart(7)}%`);
  console.log(`  ${'─'.repeat(60)}`);

  // 3) 코드별 비교 (Top 15)
  console.log(`\n  [RESIN 코드별 비교] (MRP vs 실제입고, Top 15)`);
  console.log(`  ${'코드'.padEnd(12)} ${'MRP(kg)'.padStart(10)} ${'실제(kg/년)'.padStart(12)} ${'차이%'.padStart(8)} ${'명칭'}`);
  console.log(`  ${'─'.repeat(70)}`);
  for (const [code, mrp] of mrpSorted.slice(0, 15)) {
    const act = actualByCode.get(code);
    const annualAct = act ? Math.round(act.qty / nMonths * 12) : 0;
    const diffPct = annualAct > 0 ? ((mrp.totalQty - annualAct) / annualAct * 100).toFixed(0) : 'N/A';
    console.log(`  ${code.padEnd(12)} ${Math.round(mrp.totalQty).toLocaleString().padStart(10)} ${annualAct.toLocaleString().padStart(12)} ${String(diffPct === 'N/A' ? diffPct : diffPct + '%').padStart(8)} ${mrp.name.substring(0, 35)}`);
  }

  // 실제 입고에는 있지만 MRP에 없는 코드
  const onlyInActual = [...actualByCode.entries()].filter(([code]) => !mrpResin.has(code)).sort((a, b) => b[1].amount - a[1].amount);
  if (onlyInActual.length > 0) {
    console.log(`\n  [실제 입고에만 있는 RESIN] (MRP 미추적 ${onlyInActual.length}건)`);
    for (const [code, v] of onlyInActual.slice(0, 10)) {
      console.log(`    ${code}: ${Math.round(v.qty / nMonths * 12).toLocaleString()}kg/년 / ₩${Math.round(v.amount / nMonths * 12).toLocaleString()}/년 (${v.name})`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('검증 완료');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('❌ 검증 스크립트 오류:', err);
  process.exit(1);
});
