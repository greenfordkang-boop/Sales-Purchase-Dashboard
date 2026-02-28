/**
 * 재료비.xlsx에서 전체 데이터를 파싱하여 Supabase에 업로드
 * - 품목정보 → reference_info_master
 * - 재질정보 + 재질단가 → material_code_master
 * - BOM → bom_master
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

async function deleteAndInsert(table, rows, batchSize = 500) {
  if (rows.length === 0) return;
  const { error: delErr } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) console.warn(`⚠️ ${table} 삭제 실패:`, delErr.message);

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      console.error(`❌ ${table} insert 실패 (batch ${i}):`, error.message);
      if (i === 0) console.log('Sample row:', JSON.stringify(batch[0]));
      return;
    }
  }
  console.log(`✅ ${table}: ${rows.length}건 저장 완료`);
}

// ── 1. 품목정보 → reference_info_master ──
function parseReferenceInfo(wb) {
  const ws = wb.Sheets['품목정보'];
  if (!ws) { console.log('❌ 품목정보 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  // Header at row 0
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const code = str(r[1]); // 품목코드
    if (!code) continue;
    items.push({
      item_code: code,
      customer_pn: str(r[2]),
      item_name: str(r[3]),
      spec: str(r[4]),
      customer_name: str(r[5]),
      variety: str(r[6]),
      item_status: str(r[7]),
      item_category: str(r[8]),
      process_type: str(r[9]),     // 품목유형
      inspection_type: str(r[10]),
      product_group: str(r[11]),   // 제품군분류
      supply_type: str(r[12]),     // 조달구분
      supplier: str(r[13]),
      priority_line_1: str(r[14]),
      priority_line_2: str(r[15]),
      priority_line_3: str(r[16]),
      priority_line_4: str(r[17]),
      safety_stock: num(r[18]),
      safety_stock_days: num(r[19]),
      lot_qty: num(r[20]),
      production_per_hour: num(r[21]),
      defect_allowance: num(r[22]),
      workers: num(r[23]),
      processing_time: str(r[24]),
      standard_ct: num(r[25]),
      standard_man_hours: num(r[26]),
      qty_per_box: num(r[27]),
      raw_material_code_1: str(r[28]),
      raw_material_code_2: str(r[29]),
      raw_material_code_3: str(r[30]),
      raw_material_code_4: str(r[31]),
      net_weight: num(r[32]),
      runner_weight: num(r[33]),
      net_weight_2: num(r[34]),
      runner_weight_2: num(r[35]),
      paint_qty_1: num(r[36]),
      paint_qty_2: num(r[37]),
      paint_qty_3: num(r[38]),
      paint_qty_4: num(r[39]),
      loss_rate: num(r[40]),
      cavity: num(r[41]) || 1,
      use_cavity: num(r[42]) || 0,
      product_size_type: str(r[43]),
      gloss_type: str(r[44]),
      use_yn: str(r[45]) || 'Y',
    });
  }
  return items;
}

// ── 2. 재질정보 + 재질단가 → material_code_master ──
function parseMaterialCodes(wb) {
  // 재질정보 시트
  const ws = wb.Sheets['재질정보'];
  if (!ws) { console.log('❌ 재질정보 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 재질단가 시트 (단가 조인)
  const wsPrice = wb.Sheets['재질단가'];
  const priceMap = new Map();
  if (wsPrice) {
    const priceData = XLSX.utils.sheet_to_json(wsPrice, { header: 1, defval: '' });
    for (let i = 1; i < priceData.length; i++) {
      const code = str(priceData[i][1]); // 재질코드
      const price = num(priceData[i][10]); // 현재단가
      if (code && price > 0) priceMap.set(code, price);
    }
    console.log(`  재질단가 Map: ${priceMap.size}건`);
  }

  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const code = str(r[3]); // 재질코드
    if (!code) continue;
    const matType = str(r[5]); // 재질분류
    items.push({
      material_code: code,
      material_name: str(r[4]),
      industry_code: str(r[2]),   // 업종명
      material_type: matType,
      material_category: matType,
      paint_category: str(r[6]),  // 도료구분
      color: str(r[7]),
      unit: str(r[8]),
      safety_stock: num(r[9]),
      loss_rate: num(r[11]),
      use_yn: str(r[14]) || 'Y',
      current_price: priceMap.get(code) || 0,
    });
  }
  return items;
}

// ── 3. BOM → bom_master ──
function parseBom(wb) {
  const ws = wb.Sheets['BOM'];
  if (!ws) { console.log('❌ BOM 시트 없음'); return []; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // BOM sheet has: row0=empty, row1=header, row2+=data
  // col1: Column-0 (index), col2: 제품번호, col3: 고객사, col4: 제품코드
  // col5: 고객사P/N, col6: 제품명, col7: 제품유형, col8: 레벨, col9: 모품번
  // col10: 소요량, col11: 모품명, col12: 자품번, col13: 자품명
  // col14: 자재유형, col15: 단위, col16: 자재조달, col17: 협력업체
  const hdr = data[1];
  console.log('  BOM header:', JSON.stringify(hdr?.slice(0, 20)));

  // Find column indices
  const findCol = (kw) => {
    for (let c = 0; c < (hdr?.length || 0); c++) {
      if (str(hdr[c]).includes(kw)) return c;
    }
    return -1;
  };

  const cLevel = findCol('레벨');
  const cParent = findCol('모품번');
  const cChild = findCol('자품번');
  const cChildName = findCol('자품명');
  const cQty = findCol('소요량');
  const cType = findCol('자재유형');
  const cSupplier = findCol('협력업체');

  console.log(`  BOM columns: level=${cLevel}, parent=${cParent}, child=${cChild}, qty=${cQty}`);

  const items = [];
  for (let i = 2; i < data.length; i++) {
    const r = data[i];
    const parent = str(r[cParent]);
    const child = str(r[cChild]);
    if (!parent || !child) continue;
    // Skip if parent === child (self-reference at level 0)
    if (parent === child) continue;

    items.push({
      parent_pn: parent,
      child_pn: child,
      child_name: cChildName >= 0 ? str(r[cChildName]) : '',
      level: cLevel >= 0 ? num(r[cLevel]) : 1,
      qty: cQty >= 0 ? (num(r[cQty]) || 1) : 1,
      part_type: cType >= 0 ? str(r[cType]) : '',
      supplier: cSupplier >= 0 ? str(r[cSupplier]) : '',
    });
  }
  return items;
}

async function main() {
  console.log('📂 재료비.xlsx 로딩...');
  const buf = readFileSync(EXCEL_PATH);
  const wb = XLSX.read(buf, { type: 'buffer' });
  console.log('시트:', wb.SheetNames.join(', '));

  // 1. Reference info
  const refInfo = parseReferenceInfo(wb);
  console.log(`\n품목정보: ${refInfo.length}건`);

  // 2. Material codes
  const matCodes = parseMaterialCodes(wb);
  console.log(`재질코드: ${matCodes.length}건`);

  // 3. BOM
  const bom = parseBom(wb);
  console.log(`BOM: ${bom.length}건`);

  // Import to Supabase
  console.log('\n📤 Supabase 업로드...');
  await deleteAndInsert('reference_info_master', refInfo);
  await deleteAndInsert('material_code_master', matCodes);
  await deleteAndInsert('bom_master', bom, 1000);

  // Verify
  const counts = {};
  for (const t of ['reference_info_master', 'material_code_master', 'bom_master']) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    counts[t] = count;
  }
  console.log('\n📊 검증:', JSON.stringify(counts));
}

main().catch(console.error);
