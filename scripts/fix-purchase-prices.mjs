/**
 * Fix purchase_price_master: re-import with correct column (col12 = 현재단가)
 * Bug was: colIndex matched col10 '현재단가구분' (text) instead of col12 '현재단가' (number)
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
  const buf = readFileSync(EXCEL_PATH);
  const wb = XLSX.read(buf, { type: 'buffer' });

  // 구매단가 시트 파싱
  const ws = wb.Sheets['구매단가'];
  if (!ws) { console.log('구매단가 시트 없음'); return; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Print header for verification
  const hdr = data[0];
  console.log('구매단가 시트 헤더:');
  for (let c = 0; c < (hdr?.length || 0); c++) {
    const h = str(hdr[c]);
    if (h) console.log(`  col${c}: ${h}`);
  }

  // Sample row for verification
  const sample = data[1];
  console.log('\nSample row (row1):');
  for (let c = 0; c < (sample?.length || 0); c++) {
    if (sample[c] !== '' && sample[c] !== undefined) {
      console.log(`  col${c} (${str(hdr[c])}): ${sample[c]}`);
    }
  }

  // Parse rows with CORRECT column indices
  // col1: 품목코드, col2: 고객사P/N, col3: 품목명, col4: 규격
  // col8: 조달구분, col9: 협력업체
  // col10: 현재단가구분 (TEXT - "정단가" etc)
  // col11: 최초단가 (NUMBER)
  // col12: 현재단가 (NUMBER) ← THIS IS THE CORRECT ONE
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const code = str(r[1]);
    if (!code) continue;
    const currentPrice = num(r[12]); // col12: 현재단가 (CORRECT!)
    rows.push({
      item_code: code,
      customer_pn: str(r[2]),
      item_name: str(r[3]),
      supplier: str(r[9]),
      current_price: currentPrice,
    });
  }

  console.log(`\n파싱 완료: ${rows.length}건`);

  // Verify: count rows with price > 0
  const withPrice = rows.filter(r => r.current_price > 0);
  console.log(`단가 > 0: ${withPrice.length}건`);
  console.log('Sample prices:', rows.slice(0, 5).map(r => `${r.item_code}: ${r.current_price}`));

  // Delete existing and re-insert
  const { error: delErr } = await supabase
    .from('purchase_price_master')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) console.warn('삭제 실패:', delErr.message);

  // Insert in batches
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('purchase_price_master').insert(batch);
    if (error) {
      console.error(`Insert 실패 (batch ${i}):`, error.message);
      return;
    }
  }
  console.log(`\npurchase_price_master: ${rows.length}건 저장 완료`);

  // Verify
  const { count } = await supabase
    .from('purchase_price_master')
    .select('*', { count: 'exact', head: true });
  console.log(`DB 건수: ${count}`);

  // Verify prices are not 0
  const { data: sampleData } = await supabase
    .from('purchase_price_master')
    .select('item_code, current_price')
    .gt('current_price', 0)
    .limit(5);
  console.log('DB sample (price>0):', sampleData);
}

main().catch(console.error);
