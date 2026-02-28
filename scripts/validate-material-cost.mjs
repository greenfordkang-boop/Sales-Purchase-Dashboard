/**
 * 표준재료비 산출 검증 스크립트
 * Supabase 데이터 + 재료비.xlsx ABC매출로 계산하여 NET재료비 현황과 대조
 */
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://bzszcukworybtozwbgay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6c3pjdWt3b3J5YnRvendiZ2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MTkyMTEsImV4cCI6MjA4NDk5NTIxMX0._kyiOPy3und1dhpSdZy6ER4OFJix7hhiysAWWN3EL1Q';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EXCEL_PATH = '/Users/dongkilkang/Desktop/material rate/재료비.xlsx';

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};
const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();
function normalizePn(pn) {
  return String(pn || '').trim().toUpperCase().replace(/[\s\-\.]/g, '');
}

async function fetchAll(table) {
  const allRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) { console.error(`${table} err:`, error.message); break; }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return allRows;
}

// ── 원가 계산 함수 ──
function calcInjectionCost(info, materialPrices) {
  const resinCode = info.raw_material_code_1;
  if (!resinCode) return 0;
  const price = materialPrices.get(resinCode) || 0;
  if (price <= 0) return 0;
  const netW = num(info.net_weight);
  const runnerW = num(info.runner_weight);
  const cav = num(info.cavity) || 1;
  const lossRate = num(info.loss_rate);
  const gramsPerEa = netW + runnerW / cav;
  if (gramsPerEa <= 0) return 0;
  const lossMultiplier = lossRate > 0 ? (1 + lossRate / 100) : 1;
  return (gramsPerEa * price / 1000) * lossMultiplier;
}

function calcPaintCost(info, paintMixMap, materialPrices) {
  let total = 0;
  const pqtys = [num(info.paint_qty_1), num(info.paint_qty_2), num(info.paint_qty_3), num(info.paint_qty_4)];
  const codes = [info.raw_material_code_1, info.raw_material_code_2, info.raw_material_code_3, info.raw_material_code_4];
  for (let c = 0; c < 4; c++) {
    if (pqtys[c] <= 0) continue;
    const code = codes[c + 1] || '';
    if (!code) continue;
    const mix = paintMixMap.get(code);
    if (!mix) continue;
    const mp = materialPrices.get(mix.main_code) || 0;
    const hp = materialPrices.get(mix.hardener_code) || 0;
    const tp = materialPrices.get(mix.thinner_code) || 0;
    const mr = num(mix.main_ratio), hr = num(mix.hardener_ratio), tr = num(mix.thinner_ratio);
    const totalR = mr + hr + tr;
    if (totalR <= 0) continue;
    const blended = (mp * mr + hp * hr + tp * tr) / totalR;
    const lm = num(info.loss_rate) > 0 ? (1 + num(info.loss_rate) / 100) : 1;
    total += (blended * pqtys[c] / 1000) * lm;
  }
  return total;
}

function lookup(code, cpn, map) {
  const k1 = normalizePn(code);
  if (map.has(k1)) return map.get(k1);
  if (cpn) { const k2 = normalizePn(cpn); if (map.has(k2)) return map.get(k2); }
  return 0;
}

async function main() {
  console.log('📊 데이터 로딩...');
  const [refRows, matRows, bomRows, ppRows, opRows, pmRows] = await Promise.all([
    fetchAll('reference_info_master'),
    fetchAll('material_code_master'),
    fetchAll('bom_master'),
    fetchAll('purchase_price_master'),
    fetchAll('outsource_injection_price'),
    fetchAll('paint_mix_ratio_master'),
  ]);
  console.log(`  기준정보=${refRows.length}, 재질=${matRows.length}, BOM=${bomRows.length}`);
  console.log(`  구매단가=${ppRows.length}, 외주사출=${opRows.length}, 도료배합=${pmRows.length}`);

  // Build maps
  const materialPrices = new Map();
  for (const m of matRows) if (m.current_price > 0) materialPrices.set(m.material_code, m.current_price);

  const purchasePrices = new Map();
  for (const p of ppRows) {
    const k = normalizePn(p.item_code);
    if (p.current_price > 0 && !purchasePrices.has(k)) purchasePrices.set(k, p.current_price);
    if (p.customer_pn) { const k2 = normalizePn(p.customer_pn); if (p.current_price > 0 && !purchasePrices.has(k2)) purchasePrices.set(k2, p.current_price); }
  }

  const outsourcePrices = new Map();
  for (const o of opRows) {
    const k = normalizePn(o.item_code);
    if (o.injection_price > 0 && !outsourcePrices.has(k)) outsourcePrices.set(k, o.injection_price);
    if (o.customer_pn) { const k2 = normalizePn(o.customer_pn); if (o.injection_price > 0 && !outsourcePrices.has(k2)) outsourcePrices.set(k2, o.injection_price); }
  }

  const paintMixMap = new Map();
  for (const pm of pmRows) {
    paintMixMap.set(pm.paint_code, pm);
    if (pm.main_code) paintMixMap.set(pm.main_code, pm);
  }

  const productInfoMap = new Map();
  for (const ri of refRows) {
    const k = normalizePn(ri.item_code);
    productInfoMap.set(k, ri);
    if (ri.customer_pn) { const k2 = normalizePn(ri.customer_pn); if (!productInfoMap.has(k2)) productInfoMap.set(k2, ri); }
  }

  const bomRelations = new Map();
  for (const b of bomRows) {
    const pk = normalizePn(b.parent_pn);
    if (!bomRelations.has(pk)) bomRelations.set(pk, []);
    bomRelations.get(pk).push(b);
  }

  console.log(`  Maps: 재질단가=${materialPrices.size}, 구매단가=${purchasePrices.size}, 외주=${outsourcePrices.size}, 도료=${paintMixMap.size}, 품목=${productInfoMap.size}, BOM부모=${bomRelations.size}`);

  // ABC 매출 from Excel
  const wb = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });
  const abcData = XLSX.utils.sheet_to_json(wb.Sheets['ABC 매출'], { header: 1, defval: '' });

  const productQtyMap = new Map();
  let totalRevenue = 0;
  for (let i = 3; i < abcData.length; i++) {
    const r = abcData[i];
    const newPn = str(r[6]) || str(r[0]);
    const price = num(r[8]);
    const janQty = num(r[11]);
    if (janQty <= 0 || !newPn) continue;
    const key = normalizePn(newPn);
    productQtyMap.set(key, (productQtyMap.get(key) || 0) + janQty);
    totalRevenue += price * janQty;
  }
  console.log(`  ABC매출: ${productQtyMap.size}제품, 매출=${(totalRevenue/1e8).toFixed(2)}억`);

  // ── 산출 ──
  function getDescendants(pk, qty) {
    const res = [];
    const q = [{ pn: pk, qty }];
    const visited = new Set();
    while (q.length > 0) {
      const { pn, qty: pq } = q.shift();
      const children = bomRelations.get(pn);
      if (!children) continue;
      for (const c of children) {
        const ck = normalizePn(c.child_pn);
        const vk = `${pn}>${ck}`;
        if (visited.has(vk)) continue;
        visited.add(vk);
        const aq = pq * (num(c.qty) || 1);
        res.push({ childPn: ck, accQty: aq });
        q.push({ pn: ck, qty: aq });
      }
    }
    return res;
  }

  const costAccum = new Map();
  let bomCount = 0, bomMissing = 0;

  const addAccum = (key, info, qty, inj, pnt, purch, outsrc, costType) => {
    const e = costAccum.get(key);
    if (e) { e.totalQty += qty; }
    else costAccum.set(key, { info, totalQty: qty, injPerEa: inj, pntPerEa: pnt, purchPerEa: purch, outsrcPerEa: outsrc, costType });
  };

  const processItem = (info, qty) => {
    const key = normalizePn(info.item_code);
    const st = info.supply_type || '';
    if (st === '구매') {
      const p = lookup(info.item_code, info.customer_pn, purchasePrices);
      if (p > 0) { addAccum(key, info, qty, 0, 0, p, 0, 'purchase'); return true; }
      return false;
    } else if (st.includes('외주')) {
      const pnt = calcPaintCost(info, paintMixMap, materialPrices);
      const p = lookup(info.item_code, info.customer_pn, purchasePrices);
      const o = lookup(info.item_code, info.customer_pn, outsourcePrices);
      if (p > 0 || o > 0) { addAccum(key, info, qty, 0, pnt, p, o, 'outsource'); return true; }
      return false;
    } else {
      const inj = info.net_weight > 0 ? calcInjectionCost(info, materialPrices) : 0;
      const pnt = calcPaintCost(info, paintMixMap, materialPrices);
      if (inj > 0 || pnt > 0) { addAccum(key, info, qty, inj, pnt, 0, 0, 'self'); return true; }
      return false;
    }
  };

  for (const [pc, qty] of productQtyMap) {
    if (qty <= 0) continue;
    let bomKey = null;
    if (bomRelations.has(pc)) bomKey = pc;
    else {
      const pi = productInfoMap.get(pc);
      if (pi) {
        const ik = normalizePn(pi.item_code);
        if (bomRelations.has(ik)) bomKey = ik;
        if (!bomKey && pi.customer_pn) { const ck = normalizePn(pi.customer_pn); if (bomRelations.has(ck)) bomKey = ck; }
      }
    }

    if (!bomKey) {
      const di = productInfoMap.get(pc);
      if (di && processItem(di, qty)) bomCount++;
      else bomMissing++;
      continue;
    }

    bomCount++;
    const pi = productInfoMap.get(pc) || productInfoMap.get(bomKey);
    if (pi) processItem(pi, qty);
    for (const d of getDescendants(bomKey, qty)) {
      const ci = productInfoMap.get(d.childPn);
      if (ci) processItem(ci, d.accQty);
    }
  }

  // Aggregate
  let totalResin = 0, totalPaint = 0, totalPurchase = 0, totalOutsource = 0;
  let cntS = 0, cntP = 0, cntO = 0;

  for (const [, it] of costAccum) {
    const rAmt = it.injPerEa * it.totalQty;
    const pAmt = it.pntPerEa * it.totalQty;
    if (it.costType === 'self') { cntS++; totalResin += rAmt; totalPaint += pAmt; }
    else if (it.costType === 'purchase') { cntP++; totalPurchase += it.purchPerEa * it.totalQty; }
    else if (it.costType === 'outsource') {
      cntO++;
      totalOutsource += Math.max(0, (it.purchPerEa - it.outsrcPerEa) * it.totalQty);
      totalPaint += pAmt;
    }
  }

  const totalStd = totalResin + totalPaint + totalPurchase + totalOutsource;

  console.log(`\n═══ 산출 결과 (1월) ═══`);
  console.log(`  BOM매칭: ${bomCount}, 미매칭: ${bomMissing}, 원가항목: ${costAccum.size} (자작=${cntS}, 구매=${cntP}, 외주=${cntO})`);
  console.log(`  RESIN:  ${(totalResin/1e8).toFixed(4)}억`);
  console.log(`  PAINT:  ${(totalPaint/1e8).toFixed(4)}억`);
  console.log(`  구매:   ${(totalPurchase/1e8).toFixed(4)}억`);
  console.log(`  외주:   ${(totalOutsource/1e8).toFixed(4)}억`);
  console.log(`  합계:   ${(totalStd/1e8).toFixed(4)}억 (${(totalStd/totalRevenue*100).toFixed(1)}%)`);
  console.log(`  매출:   ${(totalRevenue/1e8).toFixed(4)}억`);

  // Targets
  const d2 = XLSX.utils.sheet_to_json(wb.Sheets['NET재료비 현황'], { header: 1, defval: '' });
  const tR = num(d2[3]?.[2]), tN = num(d2[6]?.[2]);
  const tRe = num(d2[7]?.[2]), tPa = num(d2[8]?.[2]), tPu = num(d2[9]?.[2]), tOu = num(d2[10]?.[2]);

  console.log(`\n═══ 목표 ═══`);
  console.log(`  매출: ${(tR/1e8).toFixed(4)}억, NET: ${(tN/1e8).toFixed(4)}억 (${(tN/tR*100).toFixed(1)}%)`);
  console.log(`  RESIN=${(tRe/1e8).toFixed(4)}, PAINT=${(tPa/1e8).toFixed(4)}, 구매=${(tPu/1e8).toFixed(4)}, 외주=${(tOu/1e8).toFixed(4)}`);

  const pct = (a, b) => b === 0 ? 'N/A' : ((a / b - 1) * 100).toFixed(1) + '%';
  console.log(`\n═══ 차이 ═══`);
  console.log(`  매출:  ${pct(totalRevenue, tR)}`);
  console.log(`  RESIN: ${pct(totalResin, tRe)} (${((totalResin-tRe)/1e8).toFixed(4)}억)`);
  console.log(`  PAINT: ${pct(totalPaint, tPa)} (${((totalPaint-tPa)/1e8).toFixed(4)}억)`);
  console.log(`  구매:  ${pct(totalPurchase, tPu)} (${((totalPurchase-tPu)/1e8).toFixed(4)}억)`);
  console.log(`  외주:  ${pct(totalOutsource, tOu)} (${((totalOutsource-tOu)/1e8).toFixed(4)}억)`);
  console.log(`  합계:  ${pct(totalStd, tN)} (${((totalStd-tN)/1e8).toFixed(4)}억)`);

  const ok = Math.abs(totalStd / tN - 1) < 0.05;
  console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'}: 전체 오차 ${pct(totalStd, tN)} (허용: ±5%)`);
}

main().catch(console.error);
