/**
 * Deep dive: paint blended price formula
 * Check if paint_qty is main-only qty (not total blended qty)
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

  // Excel detail columns for DJAXCPCLSPP1
  const ws = wb.Sheets['품목별재료비'];
  const d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Print ALL columns for a specific paint item to understand the formula
  const hdr4 = d[4];
  console.log('═══ 도장 계산 컬럼 (col40-67) ═══');
  for (let c = 40; c < 68; c++) {
    const h = str(hdr4?.[c]).replace(/\r?\n/g, ' ');
    if (h) console.log(`  col${c}: ${h}`);
  }

  // Find DJAXCPCLSPP1
  let targetRow = null;
  for (let i = 6; i < d.length; i++) {
    if (str(d[i][3]) === 'DJAXCPCLSPP1') { targetRow = d[i]; break; }
  }

  if (targetRow) {
    console.log('\n═══ DJAXCPCLSPP1 상세 (col40-67) ═══');
    for (let c = 40; c < 68; c++) {
      const h = str(hdr4?.[c]).replace(/\r?\n/g, ' ');
      const v = targetRow[c];
      if (v !== '' && v !== 0 && v !== undefined) {
        console.log(`  col${c} (${h}): ${v}`);
      }
    }

    // Also check more columns
    console.log('\n모든 non-empty cols:');
    for (let c = 0; c < targetRow.length; c++) {
      const v = targetRow[c];
      const h = str(hdr4?.[c]).replace(/\r?\n/g, ' ');
      if (v !== '' && v !== 0 && v !== undefined && v !== null) {
        console.log(`  col${c} (${h}): ${v}`);
      }
    }
  }

  // Now manually calculate for DJAXCPCLSPP1
  const info = refMap.get('DJAXCPCLSPP1');
  if (info) {
    console.log('\n═══ DJAXCPCLSPP1 수동 계산 ═══');
    const codes = [str(info.raw_material_code_1), str(info.raw_material_code_2)];
    const pqtys = [num(info.paint_qty_1), num(info.paint_qty_2)];
    console.log(`codes: [${codes.join(', ')}]`);
    console.log(`paint_qty: [${pqtys.join(', ')}]`);
    console.log(`loss_rate: ${info.loss_rate}`);

    for (let c = 0; c < 2; c++) {
      const code = codes[c];
      console.log(`\n--- Paint layer ${c+1}: code=${code}, qty=${pqtys[c]}g ---`);

      const mix = paintMixMap.get(code);
      if (!mix) { console.log('  paintMixMap에 없음!'); continue; }

      console.log(`  mix: main=${mix.main_code} (ratio=${mix.main_ratio}), hard=${mix.hardener_code} (ratio=${mix.hardener_ratio}), thin=${mix.thinner_code} (ratio=${mix.thinner_ratio})`);

      const mp = materialPrices.get(mix.main_code) || 0;
      const hp = materialPrices.get(mix.hardener_code) || 0;
      const tp = materialPrices.get(mix.thinner_code) || 0;
      console.log(`  prices: main=${mp}/kg, hard=${hp}/kg, thin=${tp}/kg`);

      const mr = num(mix.main_ratio), hr = num(mix.hardener_ratio), tr = num(mix.thinner_ratio);
      const totalR = mr + hr + tr;

      // Method 1: Current (blended average)
      const blended = (mp * mr + hp * hr + tp * tr) / totalR;
      const lm = num(info.loss_rate) > 0 ? (1 + num(info.loss_rate) / 100) : 1;
      const cost1 = (blended * pqtys[c] / 1000) * lm;
      console.log(`  Method1 (blended avg): blended=${blended.toFixed(2)}/kg, cost=${cost1.toFixed(2)}`);

      // Method 2: paint_qty is main-only weight
      const mainCost = mp * pqtys[c] / 1000;
      const hardCost = hp * (pqtys[c] * hr / mr) / 1000;
      const thinCost = tp * (pqtys[c] * tr / mr) / 1000;
      const cost2 = (mainCost + hardCost + thinCost) * lm;
      console.log(`  Method2 (main-qty basis): main=${mainCost.toFixed(2)}, hard=${hardCost.toFixed(2)}, thin=${thinCost.toFixed(2)}, total=${cost2.toFixed(2)}`);

      // Method 3: Just main material (no hardener/thinner)
      const cost3 = (mp * pqtys[c] / 1000) * lm;
      console.log(`  Method3 (main only): cost=${cost3.toFixed(2)}`);
    }

    // Sum both layers
    const mix0 = paintMixMap.get(codes[0]);
    const mix1 = paintMixMap.get(codes[1]);
    if (mix0 && mix1) {
      const lm = num(info.loss_rate) > 0 ? (1 + num(info.loss_rate) / 100) : 1;

      // Method 2 sum
      let total2 = 0;
      for (let c = 0; c < 2; c++) {
        const mix = c === 0 ? mix0 : mix1;
        const mp = materialPrices.get(mix.main_code) || 0;
        const hp = materialPrices.get(mix.hardener_code) || 0;
        const tp = materialPrices.get(mix.thinner_code) || 0;
        const mr = num(mix.main_ratio), hr = num(mix.hardener_ratio), tr = num(mix.thinner_ratio);
        total2 += (mp * pqtys[c] + hp * pqtys[c] * hr / mr + tp * pqtys[c] * tr / mr) / 1000 * lm;
      }
      console.log(`\nMethod2 sum: ${total2.toFixed(2)} vs Excel: 504.58`);
    }
  }

  // ── Now also check the 품목별재료비 paint calculation columns in detail ──
  console.log('\n═══ 품목별재료비 사출+도장 구간 전체 헤더 (col17-67) ═══');
  for (let c = 17; c < 68; c++) {
    const h4 = str(hdr4?.[c]).replace(/\r?\n/g, ' ');
    const h3 = str(d[3]?.[c]).replace(/\r?\n/g, ' ');
    const h2 = str(d[2]?.[c]).replace(/\r?\n/g, ' ');
    const h1 = str(d[1]?.[c]).replace(/\r?\n/g, ' ');
    const h0 = str(d[0]?.[c]).replace(/\r?\n/g, ' ');
    const label = h4 || h3 || h2 || h1 || h0;
    if (label) console.log(`  col${c}: ${label}${h3 && h3 !== h4 ? ' [row3: '+h3+']' : ''}`);
  }
}

main().catch(console.error);
