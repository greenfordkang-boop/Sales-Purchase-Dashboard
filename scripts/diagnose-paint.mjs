/**
 * Diagnose paint cost calculation:
 * Test whether paint_qty maps to codes[c] or codes[c+1]
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
const normalizePn = (pn) => String(pn || '').trim().toUpperCase().replace(/[\s\-\.]/g, '');

async function fetchAll(table) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from(table).select('*').range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function main() {
  const wb = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });

  // Load Supabase data
  const [refRows, matRows, pmRows] = await Promise.all([
    fetchAll('reference_info_master'),
    fetchAll('material_code_master'),
    fetchAll('paint_mix_ratio_master'),
  ]);

  const materialPrices = new Map();
  for (const m of matRows) if (m.current_price > 0) materialPrices.set(m.material_code, m.current_price);

  const paintMixMap = new Map();
  for (const pm of pmRows) {
    paintMixMap.set(pm.paint_code, pm);
    if (pm.main_code) paintMixMap.set(pm.main_code, pm);
  }

  const refMap = new Map();
  for (const ri of refRows) refMap.set(normalizePn(ri.item_code), ri);

  // Excel 품목별재료비 - items with paint
  const ws = wb.Sheets['품목별재료비'];
  const d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Also get the detail paint columns from Excel
  // Let's check what columns 33-66 contain (사출 재료비 detail)
  const hdr4 = d[4];
  console.log('═══ 품목별재료비 도장 관련 컬럼 (row4 headers) ═══');
  for (let c = 55; c < 70; c++) {
    const h = str(hdr4?.[c]).replace(/\r?\n/g, ' ');
    if (h) console.log(`  col${c}: ${h}`);
  }

  // Check row 5 (sub-headers)
  const hdr5 = d[5];
  console.log('\nrow5 sub-headers:');
  for (let c = 55; c < 70; c++) {
    const h = str(hdr5?.[c]).replace(/\r?\n/g, ' ');
    if (h) console.log(`  col${c}: ${h}`);
  }

  // ── Paint calc with two approaches ──
  function calcPaintOffset(info, offset) {
    let total = 0;
    const pqtys = [num(info.paint_qty_1), num(info.paint_qty_2), num(info.paint_qty_3), num(info.paint_qty_4)];
    const codes = [str(info.raw_material_code_1), str(info.raw_material_code_2), str(info.raw_material_code_3), str(info.raw_material_code_4)];
    for (let c = 0; c < 4; c++) {
      if (pqtys[c] <= 0) continue;
      const code = codes[c + offset] || '';
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

  // Test on items with paint
  console.log('\n═══ 도장비 계산 비교: offset=0 vs offset=1 ═══');
  let totalExcel = 0, totalOff0 = 0, totalOff1 = 0;
  let itemsCompared = 0;

  const details = [];

  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    if (!r || !r[3]) continue;
    const paintPerEa = num(r[67]); // col67: 도장 재료비 per EA
    const janQty = num(r[68]);
    if (paintPerEa <= 0 || janQty <= 0) continue;

    const code = normalizePn(r[3]);
    const info = refMap.get(code);
    if (!info) continue;

    const off0 = calcPaintOffset(info, 0);
    const off1 = calcPaintOffset(info, 1);

    totalExcel += paintPerEa * janQty;
    totalOff0 += off0 * janQty;
    totalOff1 += off1 * janQty;
    itemsCompared++;

    const diff0 = Math.abs(off0 - paintPerEa);
    const diff1 = Math.abs(off1 - paintPerEa);

    if (paintPerEa > 100 && details.length < 20) {
      details.push({
        code: str(r[3]),
        excel: paintPerEa,
        off0: off0,
        off1: off1,
        match0: diff0 < 1,
        match1: diff1 < 1,
        netW: num(info.net_weight),
        codes: [str(info.raw_material_code_1), str(info.raw_material_code_2), str(info.raw_material_code_3), str(info.raw_material_code_4)],
        pqtys: [num(info.paint_qty_1), num(info.paint_qty_2), num(info.paint_qty_3), num(info.paint_qty_4)],
      });
    }
  }

  console.log(`비교 항목: ${itemsCompared}건`);
  console.log(`Excel 도장비: ${(totalExcel/1e8).toFixed(4)}억`);
  console.log(`offset=0 합계: ${(totalOff0/1e8).toFixed(4)}억 (diff: ${((totalOff0/totalExcel-1)*100).toFixed(1)}%)`);
  console.log(`offset=1 합계: ${(totalOff1/1e8).toFixed(4)}억 (diff: ${((totalOff1/totalExcel-1)*100).toFixed(1)}%)`);

  console.log('\n상세 비교 (Top 20):');
  for (const d of details) {
    const m0 = d.match0 ? '✅' : '❌';
    const m1 = d.match1 ? '✅' : '❌';
    console.log(`  ${d.code}: excel=${d.excel.toFixed(2)}, off0=${d.off0.toFixed(2)}${m0}, off1=${d.off1.toFixed(2)}${m1}, netW=${d.netW}`);
    console.log(`    codes=[${d.codes.join(',')}], pqtys=[${d.pqtys.join(',')}]`);
  }

  // ── Also check: how many paint items don't match with EITHER offset ──
  console.log('\n═══ 매칭 안 되는 항목 분석 ═══');
  let match0 = 0, match1 = 0, noMatch = 0, noInfo = 0;
  const noMatchItems = [];

  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    if (!r || !r[3]) continue;
    const paintPerEa = num(r[67]);
    const janQty = num(r[68]);
    if (paintPerEa <= 0 || janQty <= 0) continue;

    const code = normalizePn(r[3]);
    const info = refMap.get(code);
    if (!info) { noInfo++; continue; }

    const off0 = calcPaintOffset(info, 0);
    const off1 = calcPaintOffset(info, 1);
    const d0 = Math.abs(off0 - paintPerEa);
    const d1 = Math.abs(off1 - paintPerEa);

    if (d0 < 1) match0++;
    else if (d1 < 1) match1++;
    else {
      noMatch++;
      if (noMatchItems.length < 5) noMatchItems.push({
        code: str(r[3]),
        excel: paintPerEa,
        off0, off1,
        codes: [str(info.raw_material_code_1), str(info.raw_material_code_2), str(info.raw_material_code_3), str(info.raw_material_code_4)],
        pqtys: [num(info.paint_qty_1), num(info.paint_qty_2), num(info.paint_qty_3), num(info.paint_qty_4)],
        netW: num(info.net_weight),
      });
    }
  }

  console.log(`offset=0 매칭: ${match0}건`);
  console.log(`offset=1 매칭: ${match1}건`);
  console.log(`둘 다 안맞음: ${noMatch}건`);
  console.log(`reference_info 없음: ${noInfo}건`);

  if (noMatchItems.length > 0) {
    console.log('\n매칭 안 되는 샘플:');
    for (const n of noMatchItems) {
      console.log(`  ${n.code}: excel=${n.excel.toFixed(2)}, off0=${n.off0.toFixed(2)}, off1=${n.off1.toFixed(2)}`);
      console.log(`    codes=[${n.codes.join(',')}], pqtys=[${n.pqtys.join(',')}], netW=${n.netW}`);
    }
  }

  // ── Smart approach: use c+1 when net_weight > 0, c+0 otherwise ──
  console.log('\n═══ Smart offset (c+1 if injection, c+0 if no injection) ═══');
  let totalSmart = 0;
  let smartMatch = 0, smartMiss = 0;
  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    if (!r || !r[3]) continue;
    const paintPerEa = num(r[67]);
    const janQty = num(r[68]);
    if (paintPerEa <= 0 || janQty <= 0) continue;
    const code = normalizePn(r[3]);
    const info = refMap.get(code);
    if (!info) continue;
    const hasInjection = num(info.net_weight) > 0;
    const off = hasInjection ? 1 : 0;
    const calc = calcPaintOffset(info, off);
    totalSmart += calc * janQty;
    if (Math.abs(calc - paintPerEa) < 1) smartMatch++;
    else smartMiss++;
  }
  console.log(`Smart 합계: ${(totalSmart/1e8).toFixed(4)}억 (diff: ${((totalSmart/totalExcel-1)*100).toFixed(1)}%)`);
  console.log(`Smart 매칭: ${smartMatch}건, 미매칭: ${smartMiss}건`);

  // ── Also check: use paintMixMap-based detection ──
  console.log('\n═══ PaintMixMap-based: try code first, fallback to code+1 ═══');
  function calcPaintSmart(info) {
    let total = 0;
    const pqtys = [num(info.paint_qty_1), num(info.paint_qty_2), num(info.paint_qty_3), num(info.paint_qty_4)];
    const codes = [str(info.raw_material_code_1), str(info.raw_material_code_2), str(info.raw_material_code_3), str(info.raw_material_code_4)];
    for (let c = 0; c < 4; c++) {
      if (pqtys[c] <= 0) continue;
      // Try c first (direct mapping), then c+1 (injection offset)
      let code = codes[c] || '';
      let mix = code ? paintMixMap.get(code) : null;
      if (!mix && codes[c + 1]) {
        code = codes[c + 1];
        mix = paintMixMap.get(code);
      }
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

  let totalPmSmart = 0, pmMatch = 0, pmMiss = 0;
  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    if (!r || !r[3]) continue;
    const paintPerEa = num(r[67]);
    const janQty = num(r[68]);
    if (paintPerEa <= 0 || janQty <= 0) continue;
    const code = normalizePn(r[3]);
    const info = refMap.get(code);
    if (!info) continue;
    const calc = calcPaintSmart(info);
    totalPmSmart += calc * janQty;
    if (Math.abs(calc - paintPerEa) < 1) pmMatch++;
    else pmMiss++;
  }
  console.log(`PaintMix-smart 합계: ${(totalPmSmart/1e8).toFixed(4)}억 (diff: ${((totalPmSmart/totalExcel-1)*100).toFixed(1)}%)`);
  console.log(`PaintMix-smart 매칭: ${pmMatch}건, 미매칭: ${pmMiss}건`);
}

main().catch(console.error);
