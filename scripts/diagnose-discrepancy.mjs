/**
 * Diagnose PAINT undercount and 구매 overcount
 * Compare our calculation against Excel 품목별재료비 per-item data
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
  const allRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) break;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return allRows;
}

async function main() {
  const wb = XLSX.read(readFileSync(EXCEL_PATH), { type: 'buffer' });

  // ── 1. Excel 품목별재료비에서 per-item 실제 값 추출 ──
  const ws = wb.Sheets['품목별재료비'];
  const d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Known column indices from analyze-material-v2.mjs
  const COL = {
    itemCode: 3, supplyType: 10, lossRate: 11,
    injSellingPrice: 13, materialCost: 15, purchasePrice: 16,
    resinCost: 32, paintCost: 67,
    janQty: 68, janAmt: 81,
  };

  // Build Excel per-item map (key: normalized item code)
  const excelItems = new Map();
  for (let i = 6; i < d.length; i++) {
    const r = d[i];
    if (!r || !r[COL.itemCode]) continue;
    const janQty = num(r[COL.janQty]);
    if (janQty <= 0) continue;

    const code = normalizePn(r[COL.itemCode]);
    excelItems.set(code, {
      code: str(r[COL.itemCode]),
      supplyType: str(r[COL.supplyType]),
      resinPerEa: num(r[COL.resinCost]),
      paintPerEa: num(r[COL.paintCost]),
      materialCost: num(r[COL.materialCost]),
      purchasePrice: num(r[COL.purchasePrice]),
      injSellingPrice: num(r[COL.injSellingPrice]),
      janQty,
      janAmt: num(r[COL.janAmt]),
    });
  }
  console.log(`Excel 품목별재료비: ${excelItems.size}건 (1월 생산 있는 항목)`);

  // ── 2. Supabase 데이터 로드 ──
  const [refRows, ppRows] = await Promise.all([
    fetchAll('reference_info_master'),
    fetchAll('purchase_price_master'),
  ]);

  const refMap = new Map();
  for (const ri of refRows) {
    refMap.set(normalizePn(ri.item_code), ri);
  }

  const ppMap = new Map();
  for (const p of ppRows) {
    ppMap.set(normalizePn(p.item_code), p.current_price);
    if (p.customer_pn) ppMap.set(normalizePn(p.customer_pn), p.current_price);
  }

  // ── 3. 구매 오차 분석 ──
  console.log('\n═══ 구매 오차 분석 ═══');
  console.log('Excel 구매 항목과 우리 구매단가 비교:\n');

  let excelPurchTotal = 0, ourPurchTotal = 0;
  const purchDiffs = [];

  for (const [code, item] of excelItems) {
    if (item.supplyType !== '구매') continue;
    const excelAmt = item.materialCost * item.janQty; // Excel uses materialCost (col15) for 구매
    excelPurchTotal += excelAmt;

    const ourPrice = ppMap.get(code) || 0;
    const ourAmt = ourPrice * item.janQty;
    ourPurchTotal += ourAmt;

    if (Math.abs(ourAmt - excelAmt) > 100) {
      purchDiffs.push({
        code: item.code,
        qty: item.janQty,
        excelPrice: item.materialCost,
        ourPrice,
        excelAmt,
        ourAmt,
        diff: ourAmt - excelAmt,
      });
    }
  }

  console.log(`Excel 구매 합계: ${(excelPurchTotal/1e8).toFixed(4)}억`);
  console.log(`우리 구매 합계 (from purchase_price_master): ${(ourPurchTotal/1e8).toFixed(4)}억`);
  console.log(`차이: ${((ourPurchTotal-excelPurchTotal)/1e8).toFixed(4)}억`);

  purchDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  console.log(`\n차이 있는 항목: ${purchDiffs.length}건 (Top 10):`);
  for (const d of purchDiffs.slice(0, 10)) {
    console.log(`  ${d.code}: qty=${d.qty}, excel단가=${d.excelPrice.toFixed(2)}, 우리단가=${d.ourPrice.toFixed(2)}, diff=${(d.diff/1e4).toFixed(1)}만원`);
  }

  // ── 4. 구매 항목 중 BOM 하위에서 이중 카운트되는 것 확인 ──
  console.log('\n═══ BOM 하위 구매 항목 이중계산 확인 ═══');

  // 구매 supply_type인 reference_info items 체크
  const purchRefItems = refRows.filter(r => r.supply_type === '구매');
  console.log(`reference_info에서 supply_type='구매': ${purchRefItems.length}건`);

  // Check how many of these appear both directly in ABC매출 AND as BOM descendants
  const abcData = XLSX.utils.sheet_to_json(wb.Sheets['ABC 매출'], { header: 1, defval: '' });
  const abcProducts = new Set();
  for (let i = 3; i < abcData.length; i++) {
    const r = abcData[i];
    const newPn = str(r[6]) || str(r[0]);
    if (num(r[11]) > 0 && newPn) abcProducts.add(normalizePn(newPn));
  }

  const bomRows = await fetchAll('bom_master');
  const bomChildren = new Set();
  for (const b of bomRows) bomChildren.add(normalizePn(b.child_pn));

  let directAndBom = 0;
  for (const pi of purchRefItems) {
    const k = normalizePn(pi.item_code);
    if (abcProducts.has(k) && bomChildren.has(k)) directAndBom++;
  }
  console.log(`ABC매출에도 있고 BOM하위에도 있는 구매 품목: ${directAndBom}건`);

  // ── 5. PAINT 부족 분석 ──
  console.log('\n═══ PAINT 부족 분석 ═══');

  let excelPaintTotal = 0;
  let paintItemCount = 0;
  const paintBigItems = [];

  for (const [code, item] of excelItems) {
    if (item.paintPerEa <= 0) continue;
    const paintAmt = item.paintPerEa * item.janQty;
    excelPaintTotal += paintAmt;
    paintItemCount++;

    if (paintAmt > 100000) {
      paintBigItems.push({
        code: item.code,
        type: item.supplyType,
        qty: item.janQty,
        paintPerEa: item.paintPerEa,
        paintAmt,
      });
    }
  }

  console.log(`도장비 > 0인 품목: ${paintItemCount}건`);
  console.log(`Excel 도장비 합계: ${(excelPaintTotal/1e8).toFixed(4)}억`);

  paintBigItems.sort((a, b) => b.paintAmt - a.paintAmt);
  console.log('\n도장비 큰 항목 Top 15:');
  for (const p of paintBigItems.slice(0, 15)) {
    // Check if this item exists in reference_info and has paint data
    const ri = refMap.get(normalizePn(p.code));
    const hasPaintQty = ri ? [num(ri.paint_qty_1), num(ri.paint_qty_2), num(ri.paint_qty_3), num(ri.paint_qty_4)] : [];
    const rawMatCodes = ri ? [str(ri.raw_material_code_1), str(ri.raw_material_code_2), str(ri.raw_material_code_3), str(ri.raw_material_code_4)] : [];
    console.log(`  ${p.code} (${p.type}): qty=${p.qty}, paint/ea=${p.paintPerEa.toFixed(2)}, total=${(p.paintAmt/1e4).toFixed(1)}만원`);
    if (ri) {
      console.log(`    paint_qty=[${hasPaintQty.join(',')}], raw_mat=[${rawMatCodes.join(',')}]`);
    } else {
      console.log(`    ⚠️ reference_info에 없음`);
    }
  }

  // ── 6. Supply type 분포 비교 ──
  console.log('\n═══ Supply Type 분포 ═══');
  const stCount = {};
  for (const [, item] of excelItems) {
    const st = item.supplyType || '(없음)';
    stCount[st] = (stCount[st] || 0) + 1;
  }
  console.log('Excel 품목별재료비:', stCount);

  const refStCount = {};
  for (const ri of refRows) {
    const st = ri.supply_type || '(없음)';
    refStCount[st] = (refStCount[st] || 0) + 1;
  }
  console.log('reference_info_master:', refStCount);

  // ── 7. 구매 항목: Excel materialCost vs purchasePrice 비교 ──
  console.log('\n═══ 구매: Excel materialCost(col15) vs purchasePrice(col16) ═══');
  let sameCount = 0, diffCount = 0;
  for (const [, item] of excelItems) {
    if (item.supplyType !== '구매') continue;
    if (Math.abs(item.materialCost - item.purchasePrice) < 0.01) sameCount++;
    else { diffCount++; if (diffCount <= 3) console.log(`  ${item.code}: materialCost=${item.materialCost}, purchasePrice=${item.purchasePrice}`); }
  }
  console.log(`동일: ${sameCount}건, 상이: ${diffCount}건`);
  console.log('→ 구매 항목에서 materialCost(col15)는 재료비/EA 컬럼');

  // ── 8. 외주 항목 상세 ──
  console.log('\n═══ 외주 항목 상세 ═══');
  let excelOutTotal = 0;
  for (const [code, item] of excelItems) {
    if (!item.supplyType.includes('외주')) continue;
    // Excel 1월매입금액 = (구매단가 - 사출판매가) * 생산량
    excelOutTotal += item.janAmt;
  }
  console.log(`Excel 외주 1월매입금액 합계: ${(excelOutTotal/1e8).toFixed(4)}억`);
}

main().catch(console.error);
