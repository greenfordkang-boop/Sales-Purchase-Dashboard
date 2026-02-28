/**
 * Import per-item standard costs from 품목별재료비 sheet
 * This is the validated Excel output - use directly for dashboard aggregation
 *
 * Table: item_standard_cost
 *   item_code, supply_type, resin_cost_per_ea, paint_cost_per_ea,
 *   material_cost_per_ea, purchase_price_per_ea, injection_price_per_ea,
 *   jan_qty..dec_qty, jan_amt..dec_amt
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

async function main() {
  console.log('📂 Loading 재료비.xlsx...');
  const buf = readFileSync(EXCEL_PATH);
  const wb = XLSX.read(buf, { type: 'buffer' });

  const ws = wb.Sheets['품목별재료비'];
  if (!ws) { console.error('품목별재료비 시트 없음'); return; }
  const d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Column indices (verified from analysis):
  // col3: 품목코드, col4: 고객사P/N, col5: 품목명, col6: 고객사
  // col7: 품종, col9: 품목유형, col10: 조달구분
  // col13: 사출판매가/EA, col15: 재료비/EA, col16: 구매단가/EA
  // col32: 사출 재료비/EA, col67: 도장 재료비/EA
  // col68-79: 1월~12월 생산량 (68=1월, 69=2월, ..., 79=12월)
  // col81-92: 1월~12월 매입금액 (81=1월, 82=2월, ..., 92=12월)
  // col80: 생산량 합계, col93: 매입금액 합계

  const rows = [];
  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    const itemCode = str(r[3]);
    if (!itemCode) continue;

    // Check if any month has production
    let hasProduction = false;
    for (let m = 0; m < 12; m++) {
      if (num(r[68 + m]) > 0) { hasProduction = true; break; }
    }
    // Include even zero-production items if they have per-EA cost data
    const hasCost = num(r[15]) > 0 || num(r[32]) > 0 || num(r[67]) > 0;
    if (!hasProduction && !hasCost) continue;

    const row = {
      item_code: itemCode,
      customer_pn: str(r[4]),
      item_name: str(r[5]),
      customer_name: str(r[6]),
      variety: str(r[7]),
      item_type: str(r[9]),       // 품목유형 (사출, 도장, 조립 etc.)
      supply_type: str(r[10]),    // 조달구분 (자작, 구매, 외주)
      resin_cost_per_ea: num(r[32]),   // 사출 재료비/EA
      paint_cost_per_ea: num(r[67]),   // 도장 재료비/EA
      material_cost_per_ea: num(r[15]),// 재료비/EA (total)
      purchase_price_per_ea: num(r[16]),// 구매단가/EA
      injection_price_per_ea: num(r[13]),// 사출판매가/EA (for outsource)
      // Monthly quantities
      jan_qty: num(r[68]), feb_qty: num(r[69]), mar_qty: num(r[70]),
      apr_qty: num(r[71]), may_qty: num(r[72]), jun_qty: num(r[73]),
      jul_qty: num(r[74]), aug_qty: num(r[75]), sep_qty: num(r[76]),
      oct_qty: num(r[77]), nov_qty: num(r[78]), dec_qty: num(r[79]),
      // Monthly amounts
      jan_amt: num(r[81]), feb_amt: num(r[82]), mar_amt: num(r[83]),
      apr_amt: num(r[84]), may_amt: num(r[85]), jun_amt: num(r[86]),
      jul_amt: num(r[87]), aug_amt: num(r[88]), sep_amt: num(r[89]),
      oct_amt: num(r[90]), nov_amt: num(r[91]), dec_amt: num(r[92]),
      // Totals
      total_qty: num(r[80]),
      total_amt: num(r[93]),
    };

    rows.push(row);
  }

  console.log(`파싱 완료: ${rows.length}건`);

  // Stats
  const byType = {};
  let totalJanAmt = 0;
  for (const r of rows) {
    byType[r.supply_type] = (byType[r.supply_type] || 0) + 1;
    totalJanAmt += r.jan_amt;
  }
  console.log('Supply types:', byType);
  console.log(`1월 매입금액 합계: ${(totalJanAmt/1e8).toFixed(4)}억`);

  // Create table if needed (use SQL migration approach)
  console.log('\n📤 Creating table and uploading...');

  // First try creating table via SQL
  const { error: createErr } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS item_standard_cost (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        item_code TEXT NOT NULL,
        customer_pn TEXT DEFAULT '',
        item_name TEXT DEFAULT '',
        customer_name TEXT DEFAULT '',
        variety TEXT DEFAULT '',
        item_type TEXT DEFAULT '',
        supply_type TEXT DEFAULT '',
        resin_cost_per_ea NUMERIC DEFAULT 0,
        paint_cost_per_ea NUMERIC DEFAULT 0,
        material_cost_per_ea NUMERIC DEFAULT 0,
        purchase_price_per_ea NUMERIC DEFAULT 0,
        injection_price_per_ea NUMERIC DEFAULT 0,
        jan_qty NUMERIC DEFAULT 0, feb_qty NUMERIC DEFAULT 0, mar_qty NUMERIC DEFAULT 0,
        apr_qty NUMERIC DEFAULT 0, may_qty NUMERIC DEFAULT 0, jun_qty NUMERIC DEFAULT 0,
        jul_qty NUMERIC DEFAULT 0, aug_qty NUMERIC DEFAULT 0, sep_qty NUMERIC DEFAULT 0,
        oct_qty NUMERIC DEFAULT 0, nov_qty NUMERIC DEFAULT 0, dec_qty NUMERIC DEFAULT 0,
        jan_amt NUMERIC DEFAULT 0, feb_amt NUMERIC DEFAULT 0, mar_amt NUMERIC DEFAULT 0,
        apr_amt NUMERIC DEFAULT 0, may_amt NUMERIC DEFAULT 0, jun_amt NUMERIC DEFAULT 0,
        jul_amt NUMERIC DEFAULT 0, aug_amt NUMERIC DEFAULT 0, sep_amt NUMERIC DEFAULT 0,
        oct_amt NUMERIC DEFAULT 0, nov_amt NUMERIC DEFAULT 0, dec_amt NUMERIC DEFAULT 0,
        total_qty NUMERIC DEFAULT 0,
        total_amt NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE item_standard_cost ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Allow anon full access on item_standard_cost"
        ON item_standard_cost FOR ALL TO anon USING (true) WITH CHECK (true);
    `
  });
  if (createErr) {
    console.log('Table might already exist or RPC not available, trying direct insert...');
  }

  // Delete existing
  const { error: delErr } = await supabase
    .from('item_standard_cost')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) {
    console.error('테이블이 없습니다. Supabase SQL Editor에서 먼저 생성해주세요.');
    console.log('\nSQL to create table:');
    console.log(`
CREATE TABLE item_standard_cost (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL,
  customer_pn TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  variety TEXT DEFAULT '',
  item_type TEXT DEFAULT '',
  supply_type TEXT DEFAULT '',
  resin_cost_per_ea NUMERIC DEFAULT 0,
  paint_cost_per_ea NUMERIC DEFAULT 0,
  material_cost_per_ea NUMERIC DEFAULT 0,
  purchase_price_per_ea NUMERIC DEFAULT 0,
  injection_price_per_ea NUMERIC DEFAULT 0,
  jan_qty NUMERIC DEFAULT 0, feb_qty NUMERIC DEFAULT 0, mar_qty NUMERIC DEFAULT 0,
  apr_qty NUMERIC DEFAULT 0, may_qty NUMERIC DEFAULT 0, jun_qty NUMERIC DEFAULT 0,
  jul_qty NUMERIC DEFAULT 0, aug_qty NUMERIC DEFAULT 0, sep_qty NUMERIC DEFAULT 0,
  oct_qty NUMERIC DEFAULT 0, nov_qty NUMERIC DEFAULT 0, dec_qty NUMERIC DEFAULT 0,
  jan_amt NUMERIC DEFAULT 0, feb_amt NUMERIC DEFAULT 0, mar_amt NUMERIC DEFAULT 0,
  apr_amt NUMERIC DEFAULT 0, may_amt NUMERIC DEFAULT 0, jun_amt NUMERIC DEFAULT 0,
  jul_amt NUMERIC DEFAULT 0, aug_amt NUMERIC DEFAULT 0, sep_amt NUMERIC DEFAULT 0,
  oct_amt NUMERIC DEFAULT 0, nov_amt NUMERIC DEFAULT 0, dec_amt NUMERIC DEFAULT 0,
  total_qty NUMERIC DEFAULT 0,
  total_amt NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE item_standard_cost ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on item_standard_cost"
  ON item_standard_cost FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX idx_item_standard_cost_item_code ON item_standard_cost(item_code);
CREATE INDEX idx_item_standard_cost_supply_type ON item_standard_cost(supply_type);
    `);
    return;
  }

  // Insert in batches
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('item_standard_cost').insert(batch);
    if (error) {
      console.error(`Insert 실패 (batch ${i}):`, error.message);
      if (i === 0) console.log('Sample:', JSON.stringify(batch[0]).slice(0, 200));
      return;
    }
  }

  console.log(`\n✅ item_standard_cost: ${rows.length}건 저장 완료`);

  // Verify
  const { count } = await supabase
    .from('item_standard_cost')
    .select('*', { count: 'exact', head: true });
  console.log(`DB 건수: ${count}`);

  // Cross-verify with NET재료비 현황
  const ws2 = wb.Sheets['NET재료비 현황'];
  const d2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
  const targets = {
    revenue: num(d2[3]?.[2]),
    net: num(d2[6]?.[2]),
    resin: num(d2[7]?.[2]),
    paint: num(d2[8]?.[2]),
    purchase: num(d2[9]?.[2]),
    outsource: num(d2[10]?.[2]),
  };

  // Aggregate from imported data
  let resin = 0, paint = 0, purchase = 0, outsource = 0;
  for (const r of rows) {
    if (r.supply_type === '자작') {
      resin += r.resin_cost_per_ea * r.jan_qty;
      paint += r.paint_cost_per_ea * r.jan_qty;
    } else if (r.supply_type === '구매') {
      purchase += r.jan_amt;
    } else if (r.supply_type.includes('외주')) {
      outsource += r.jan_amt;
    }
  }

  const total = resin + paint + purchase + outsource;
  const pct = (a, b) => b === 0 ? 'N/A' : ((a / b - 1) * 100).toFixed(1) + '%';

  console.log('\n═══ 검증 (1월 기준) ═══');
  console.log(`  RESIN:  ${(resin/1e8).toFixed(4)}억 vs ${(targets.resin/1e8).toFixed(4)}억 (${pct(resin, targets.resin)})`);
  console.log(`  PAINT:  ${(paint/1e8).toFixed(4)}억 vs ${(targets.paint/1e8).toFixed(4)}억 (${pct(paint, targets.paint)})`);
  console.log(`  구매:   ${(purchase/1e8).toFixed(4)}억 vs ${(targets.purchase/1e8).toFixed(4)}억 (${pct(purchase, targets.purchase)})`);
  console.log(`  외주:   ${(outsource/1e8).toFixed(4)}억 vs ${(targets.outsource/1e8).toFixed(4)}억 (${pct(outsource, targets.outsource)})`);
  console.log(`  합계:   ${(total/1e8).toFixed(4)}억 vs ${(targets.net/1e8).toFixed(4)}억 (${pct(total, targets.net)})`);
}

main().catch(console.error);
