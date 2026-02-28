/**
 * Final validation: item_standard_cost (Supabase) vs NET재료비 현황 (Excel)
 * Verify all 12 months match
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

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const QTY_KEYS = ['jan_qty','feb_qty','mar_qty','apr_qty','may_qty','jun_qty','jul_qty','aug_qty','sep_qty','oct_qty','nov_qty','dec_qty'];
const AMT_KEYS = ['jan_amt','feb_amt','mar_amt','apr_amt','may_amt','jun_amt','jul_amt','aug_amt','sep_amt','oct_amt','nov_amt','dec_amt'];

async function main() {
  const items = await fetchAll('item_standard_cost');
  console.log(`item_standard_cost: ${items.length}건 from Supabase`);

  const wb = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });
  const d2 = XLSX.utils.sheet_to_json(wb.Sheets['NET재료비 현황'], { header: 1, defval: '' });

  // NET재료비 현황 layout:
  // row3: ABC매출, row6: NET재료비, row7: RESIN, row8: PAINT, row9: 구매, row10: 외주
  // col2: 1월, col3: 2월, ..., col13: 12월

  console.log('\n═══ 월별 교차검증: Supabase item_standard_cost vs NET재료비 현황 ═══\n');
  console.log('월\t\t구분\tSupabase\tExcel\t\t차이%');
  console.log('─'.repeat(80));

  let allPass = true;

  for (let m = 0; m < 12; m++) {
    const qk = QTY_KEYS[m];
    const ak = AMT_KEYS[m];
    const excelCol = m + 2; // col2=1월, col3=2월, ...

    let resin = 0, paint = 0, purchase = 0, outsource = 0;
    for (const it of items) {
      const qty = Number(it[qk]) || 0;
      if (qty <= 0) continue;
      const st = it.supply_type || '';
      if (st === '자작') {
        resin += (Number(it.resin_cost_per_ea) || 0) * qty;
        paint += (Number(it.paint_cost_per_ea) || 0) * qty;
      } else if (st === '구매') {
        purchase += Number(it[ak]) || 0;
      } else if (st.includes('외주')) {
        outsource += Number(it[ak]) || 0;
      }
    }

    const total = resin + paint + purchase + outsource;

    const tResin = num(d2[7]?.[excelCol]);
    const tPaint = num(d2[8]?.[excelCol]);
    const tPurch = num(d2[9]?.[excelCol]);
    const tOutsrc = num(d2[10]?.[excelCol]);
    const tTotal = num(d2[6]?.[excelCol]);

    const pct = (a, b) => b === 0 ? (a === 0 ? '0.0%' : 'N/A') : ((a / b - 1) * 100).toFixed(1) + '%';
    const ok = tTotal > 0 ? Math.abs(total / tTotal - 1) < 0.001 : total === 0;

    if (!ok && tTotal > 0) allPass = false;

    console.log(`${MONTHS[m]}\tRESIN\t${(resin/1e8).toFixed(4)}\t\t${(tResin/1e8).toFixed(4)}\t\t${pct(resin, tResin)}`);
    console.log(`\tPAINT\t${(paint/1e8).toFixed(4)}\t\t${(tPaint/1e8).toFixed(4)}\t\t${pct(paint, tPaint)}`);
    console.log(`\t구매\t${(purchase/1e8).toFixed(4)}\t\t${(tPurch/1e8).toFixed(4)}\t\t${pct(purchase, tPurch)}`);
    console.log(`\t외주\t${(outsource/1e8).toFixed(4)}\t\t${(tOutsrc/1e8).toFixed(4)}\t\t${pct(outsource, tOutsrc)}`);
    console.log(`\t합계\t${(total/1e8).toFixed(4)}\t\t${(tTotal/1e8).toFixed(4)}\t\t${pct(total, tTotal)} ${ok ? '✅' : '❌'}`);
    console.log('');
  }

  console.log(allPass ? '\n✅ ALL MONTHS PASS' : '\n❌ SOME MONTHS FAILED');
}

main().catch(console.error);
