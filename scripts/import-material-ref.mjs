/**
 * 재료비.xlsx에서 구매단가/도료배합비율/외주사출판매가 시트를 파싱하여
 * Supabase에 직접 업로드하는 스크립트
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

function findHeaderRow(data, ...keywords) {
  for (let r = 0; r < Math.min(data.length, 10); r++) {
    const row = data[r];
    if (!row) continue;
    const rowStr = row.map(c => str(c).replace(/\s/g, '')).join('|');
    if (keywords.some(kw => rowStr.includes(kw.replace(/\s/g, '')))) return r;
  }
  return -1;
}

function colIndex(row, ...names) {
  for (const name of names) {
    const idx = row.findIndex(c => str(c).replace(/\s/g, '').includes(name.replace(/\s/g, '')));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── 1. 구매단가 ──
function parsePurchasePrice(wb) {
  const ws = wb.Sheets['구매단가'];
  if (!ws) { console.log('❌ 구매단가 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hr = findHeaderRow(data, '품목코드');
  if (hr < 0) { console.log('❌ 구매단가 헤더 못 찾음'); return []; }
  const hdr = data[hr].map(c => str(c));
  const cCode = colIndex(hdr, '품목코드');
  const cCust = colIndex(hdr, '고객사 P/N', '고객사');
  const cName = colIndex(hdr, '품목명');
  const cSupp = colIndex(hdr, '업체명', '협력업체');
  const cPrice = colIndex(hdr, '현재단가');
  const cPrev = colIndex(hdr, '최초단가');

  const items = [];
  for (let i = hr + 1; i < data.length; i++) {
    const row = data[i];
    const code = cCode >= 0 ? str(row[cCode]) : '';
    if (!code) continue;
    items.push({
      item_code: code,
      customer_pn: cCust >= 0 ? str(row[cCust]) : '',
      item_name: cName >= 0 ? str(row[cName]) : '',
      supplier: cSupp >= 0 ? str(row[cSupp]) : '',
      current_price: cPrice >= 0 ? num(row[cPrice]) : 0,
      previous_price: cPrev >= 0 ? num(row[cPrev]) : 0,
    });
  }
  return items;
}

// ── 2. 외주사출 판매가 ──
function parseOutsourcePrice(wb) {
  const ws = wb.Sheets['외주사출 판매가'] || wb.Sheets['외주사출판매가'];
  if (!ws) { console.log('❌ 외주사출 판매가 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hr = findHeaderRow(data, '품목코드');
  if (hr < 0) { console.log('❌ 외주사출 헤더 못 찾음'); return []; }
  const hdr = data[hr].map(c => str(c));
  const cCode = colIndex(hdr, '품목코드');
  const cCust = colIndex(hdr, '고객사');
  const cName = colIndex(hdr, '품목명');
  const cSupp = colIndex(hdr, '협력사', '협력업체');
  const cPrice = colIndex(hdr, '사출단가', '사출판매가');

  const items = [];
  for (let i = hr + 1; i < data.length; i++) {
    const row = data[i];
    const code = cCode >= 0 ? str(row[cCode]) : '';
    if (!code) continue;
    items.push({
      item_code: code,
      customer_pn: cCust >= 0 ? str(row[cCust]) : '',
      item_name: cName >= 0 ? str(row[cName]) : '',
      supplier: cSupp >= 0 ? str(row[cSupp]) : '',
      injection_price: cPrice >= 0 ? num(row[cPrice]) : 0,
    });
  }
  return items;
}

// ── 3. 도료배합비율 ──
function parsePaintMixRatio(wb) {
  const ws = wb.Sheets['도료배합비율'];
  if (!ws) { console.log('❌ 도료배합비율 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hr = findHeaderRow(data, '재질코드', '주제도료');
  if (hr < 0) { console.log('❌ 도료배합 헤더 못 찾음'); return []; }
  const hdr = data[hr].map(c => str(c));

  const cMainCode = colIndex(hdr, '재질코드');
  const cMainDrug = colIndex(hdr, '주제도료');
  const cMainR = colIndex(hdr, '주제비율');
  const cHardCode = colIndex(hdr, '경화제');
  const cHardR = colIndex(hdr, '경화제비율');
  const cThinCode = colIndex(hdr, '희석제');
  const cThinR = colIndex(hdr, '희석제비율');

  const items = [];
  let lastPaintCode = '';
  for (let i = hr + 1; i < data.length; i++) {
    const row = data[i];
    const paintCode = str(row[0]) || lastPaintCode;
    if (!paintCode) continue;
    lastPaintCode = paintCode;
    const mainCode = cMainDrug >= 0 ? str(row[cMainDrug]) : (cMainCode >= 0 ? str(row[cMainCode]) : '');
    if (!mainCode) continue;

    items.push({
      paint_code: paintCode,
      paint_name: '',
      main_ratio: cMainR >= 0 ? num(row[cMainR]) : 100,
      hardener_ratio: cHardR >= 0 ? num(row[cHardR]) : 0,
      thinner_ratio: cThinR >= 0 ? num(row[cThinR]) : 0,
      main_code: mainCode,
      hardener_code: cHardCode >= 0 ? str(row[cHardCode]) : '',
      thinner_code: cThinCode >= 0 ? str(row[cThinCode]) : '',
      main_price: 0,
      hardener_price: 0,
      thinner_price: 0,
    });
  }
  return items;
}

async function insertBatch(table, rows, batchSize = 500) {
  if (rows.length === 0) return;
  // Delete existing data
  const { error: delErr } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) console.warn(`⚠️ ${table} 삭제 실패:`, delErr.message);

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      console.error(`❌ ${table} insert 실패 (batch ${i}):`, error.message);
      return;
    }
  }
  console.log(`✅ ${table}: ${rows.length}건 저장 완료`);
}

async function main() {
  console.log('📂 재료비.xlsx 로딩...');
  const buf = readFileSync(EXCEL_PATH);
  const wb = XLSX.read(buf, { type: 'buffer' });
  console.log('시트 목록:', wb.SheetNames.join(', '));

  const purchase = parsePurchasePrice(wb);
  console.log(`구매단가: ${purchase.length}건`);

  const outsource = parseOutsourcePrice(wb);
  console.log(`외주사출 판매가: ${outsource.length}건`);

  const paintMix = parsePaintMixRatio(wb);
  console.log(`도료배합비율: ${paintMix.length}건`);

  await insertBatch('purchase_price_master', purchase);
  await insertBatch('outsource_injection_price', outsource);
  await insertBatch('paint_mix_ratio_master', paintMix);

  // 검증
  const { count: ppCount } = await supabase.from('purchase_price_master').select('*', { count: 'exact', head: true });
  const { count: opCount } = await supabase.from('outsource_injection_price').select('*', { count: 'exact', head: true });
  const { count: pmCount } = await supabase.from('paint_mix_ratio_master').select('*', { count: 'exact', head: true });
  console.log(`\n📊 검증: 구매단가 ${ppCount}건, 외주사출 ${opCount}건, 도료배합 ${pmCount}건`);
}

main().catch(console.error);
