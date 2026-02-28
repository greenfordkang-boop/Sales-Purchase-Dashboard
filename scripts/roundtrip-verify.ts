/**
 * Round-trip verification: Parse original → Supabase REST upsert → Supabase REST fetch → Excel generate → Compare
 * Uses direct REST API to avoid Vite import.meta.env issues.
 */
import { parseBomMasterExcel } from '../utils/bomMasterParser';
import type {
  BomMasterRecord, ProductCodeRecord, ReferenceInfoRecord,
  EquipmentRecord, MaterialCodeRecord,
} from '../utils/bomMasterParser';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as pathLib from 'path';
import { fileURLToPath } from 'url';

const __dirname = pathLib.dirname(fileURLToPath(import.meta.url));

// Load env
const envContent = fs.readFileSync(pathLib.resolve(__dirname, '../.env.local'), 'utf-8');
const envVars: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SUPABASE_URL = envVars['VITE_SUPABASE_URL'];
// Use service_role key to bypass RLS for INSERT/DELETE
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6c3pjdWt3b3J5YnRvendiZ2F5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQxOTIxMSwiZXhwIjoyMDg0OTk1MjExfQ.mNz_JPbNSiz6wFjPwaHL3KMNK-W7lqGreqnZCxEDiIQ';

const ORIGINAL = '/Users/dongkilkang/Library/Mobile Documents/com~apple~CloudDocs/Projects/bom/bom_개정.xlsx';
const OUTPUT = '/Users/dongkilkang/Library/Mobile Documents/com~apple~CloudDocs/Projects/bom/BOM마스터_통합_검증.xlsx';

// REST helper
async function sbFetch(table: string, method: string, body?: unknown, query = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : '',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${table} failed: ${res.status} ${text}`);
  }
  if (method === 'GET') return res.json() as Promise<unknown[]>;
  return [];
}

// Paginated GET (Supabase default limit=1000)
async function sbFetchAll(table: string, query = ''): Promise<unknown[]> {
  const all: unknown[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const sep = query.includes('?') ? '&' : '?';
    const page = await sbFetch(table, 'GET', undefined, `${query}${sep}limit=${pageSize}&offset=${offset}`) as unknown[];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function sbDelete(table: string) {
  await sbFetch(table, 'DELETE', undefined, '?id=not.is.null');
}

async function sbInsertBatch(table: string, rows: unknown[], batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let retries = 3;
    while (retries > 0) {
      try {
        await sbFetch(table, 'POST', batch);
        break;
      } catch (e) {
        retries--;
        if (retries === 0) throw e;
        console.log(`    Retry ${3 - retries}/3 for ${table} batch ${i}...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (i > 0 && i % 1000 === 0) process.stdout.write(`    ${i}/${rows.length}...\n`);
  }
}

// ========================
// Step 1: Parse original
// ========================
function step1_parse() {
  console.log('\n=== Step 1: Parse original Excel ===');
  const buf = fs.readFileSync(ORIGINAL);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const result = parseBomMasterExcel(ab as ArrayBuffer);
  console.log(`  BOM: ${result.bom.length} rows`);
  console.log(`  제품코드: ${result.productCodes.length} rows`);
  console.log(`  기준정보: ${result.referenceInfo.length} rows`);
  console.log(`  설비코드: ${result.equipment.length} rows`);
  console.log(`  재질코드: ${result.materialCodes.length} rows`);
  return result;
}

// ========================
// Step 2: Save to Supabase via REST
// ========================
async function step2_save(parsed: ReturnType<typeof step1_parse>) {
  console.log('\n=== Step 2: Save to Supabase (REST API) ===');

  // Delete existing
  console.log('  Deleting existing data...');
  await sbDelete('bom_master');
  await sbDelete('product_code_master');
  await sbDelete('reference_info_master');
  await sbDelete('equipment_master');
  await sbDelete('material_code_master');

  // Insert BOM
  const bomRows = parsed.bom.map(b => ({
    parent_pn: b.parentPn, child_pn: b.childPn, level: b.level,
    qty: b.qty, child_name: b.childName, part_type: b.partType, supplier: b.supplier,
  }));
  await sbInsertBatch('bom_master', bomRows);
  console.log(`  BOM inserted: ${bomRows.length}`);

  // Insert 제품코드
  const pcRows = parsed.productCodes.map(p => ({
    product_code: p.productCode, customer_pn: p.customerPn,
    product_name: p.productName, customer: p.customer, model: p.model,
  }));
  await sbInsertBatch('product_code_master', pcRows);
  console.log(`  제품코드 inserted: ${pcRows.length}`);

  // Insert 기준정보
  const riRows = parsed.referenceInfo.map(ri => ({
    item_code: ri.itemCode, customer_pn: ri.customerPn, item_name: ri.itemName,
    spec: ri.spec, customer_name: ri.customerName, variety: ri.variety,
    item_status: ri.itemStatus, item_category: ri.itemCategory,
    process_type: ri.processType, inspection_type: ri.inspectionType,
    product_group: ri.productGroup, supply_type: ri.supplyType, supplier: ri.supplier,
    priority_line_1: ri.priorityLine1, priority_line_2: ri.priorityLine2,
    priority_line_3: ri.priorityLine3, priority_line_4: ri.priorityLine4,
    safety_stock: ri.safetyStock, safety_stock_days: ri.safetyStockDays,
    lot_qty: ri.lotQty, production_per_hour: ri.productionPerHour,
    defect_allowance: ri.defectAllowance, workers: ri.workers,
    processing_time: ri.processingTime, standard_ct: ri.standardCT,
    standard_man_hours: ri.standardManHours, qty_per_box: ri.qtyPerBox,
    raw_material_code_1: ri.rawMaterialCode1, raw_material_code_2: ri.rawMaterialCode2,
    raw_material_code_3: ri.rawMaterialCode3, raw_material_code_4: ri.rawMaterialCode4,
    net_weight: ri.netWeight, runner_weight: ri.runnerWeight,
    net_weight_2: ri.netWeight2, runner_weight_2: ri.runnerWeight2,
    paint_qty_1: ri.paintQty1, paint_qty_2: ri.paintQty2,
    paint_qty_3: ri.paintQty3, paint_qty_4: ri.paintQty4,
    loss_rate: ri.lossRate, cavity: ri.cavity, use_cavity: ri.useCavity,
    product_size_type: ri.productSizeType, gloss_type: ri.glossType, use_yn: ri.useYn,
  }));
  await sbInsertBatch('reference_info_master', riRows);
  console.log(`  기준정보 inserted: ${riRows.length}`);

  // Insert 설비코드
  const eqRows = parsed.equipment.map(eq => ({
    equipment_code: eq.equipmentCode, equipment_name: eq.equipmentName,
    site: eq.site, industry: eq.industry, variety: eq.variety, line: eq.line,
    direct_indirect: eq.directIndirect, tonnage: eq.tonnage,
    daily_hours: eq.dailyHours, daily_minutes: eq.dailyMinutes, daily_seconds: eq.dailySeconds,
    management_no: eq.managementNo, equipment_no: eq.equipmentNo, use_yn: eq.useYn,
  }));
  await sbInsertBatch('equipment_master', eqRows);
  console.log(`  설비코드 inserted: ${eqRows.length}`);

  // Insert 재질코드
  const mcRows = parsed.materialCodes.map(mc => ({
    material_code: mc.materialCode, material_name: mc.materialName,
    material_type: mc.materialType, industry_code: mc.industryCode,
    material_category: mc.materialCategory, paint_category: mc.paintCategory,
    color: mc.color, unit: mc.unit, safety_stock: mc.safetyStock,
    daily_avg_usage: mc.dailyAvgUsage, loss_rate: mc.lossRate,
    valid_days: mc.validDays, order_size: mc.orderSize,
    use_yn: mc.useYn, protected_item: mc.protectedItem,
    current_price: mc.currentPrice,
  }));
  await sbInsertBatch('material_code_master', mcRows);
  console.log(`  재질코드 inserted: ${mcRows.length}`);
}

// ========================
// Step 3: Fetch from Supabase via REST
// ========================
async function step3_fetch() {
  console.log('\n=== Step 3: Fetch from Supabase ===');

  const bomRaw = await sbFetchAll('bom_master', '?select=*&order=created_at') as any[];
  const bomData: BomMasterRecord[] = bomRaw.map(r => ({
    parentPn: r.parent_pn, childPn: r.child_pn, level: r.level,
    qty: r.qty, childName: r.child_name, partType: r.part_type, supplier: r.supplier,
  }));
  console.log(`  BOM: ${bomData.length}`);

  const pcRaw = await sbFetchAll('product_code_master', '?select=*') as any[];
  const pcData: ProductCodeRecord[] = pcRaw.map(r => ({
    productCode: r.product_code, customerPn: r.customer_pn,
    productName: r.product_name, customer: r.customer, model: r.model,
  }));
  console.log(`  제품코드: ${pcData.length}`);

  const riRaw = await sbFetchAll('reference_info_master', '?select=*') as any[];
  const riData: ReferenceInfoRecord[] = riRaw.map(r => ({
    itemCode: r.item_code, customerPn: r.customer_pn, itemName: r.item_name,
    spec: r.spec || '', customerName: r.customer_name || '', variety: r.variety || '',
    itemStatus: r.item_status || '', itemCategory: r.item_category || '',
    processType: r.process_type || '', inspectionType: r.inspection_type || '',
    productGroup: r.product_group || '', supplyType: r.supply_type || '',
    supplier: r.supplier || '',
    priorityLine1: r.priority_line_1 || '', priorityLine2: r.priority_line_2 || '',
    priorityLine3: r.priority_line_3 || '', priorityLine4: r.priority_line_4 || '',
    safetyStock: Number(r.safety_stock) || 0, safetyStockDays: Number(r.safety_stock_days) || 0,
    lotQty: Number(r.lot_qty) || 0, productionPerHour: Number(r.production_per_hour) || 0,
    defectAllowance: Number(r.defect_allowance) || 0, workers: Number(r.workers) || 0,
    processingTime: r.processing_time || '', standardCT: Number(r.standard_ct) || 0,
    standardManHours: Number(r.standard_man_hours) || 0, qtyPerBox: Number(r.qty_per_box) || 0,
    rawMaterialCode1: r.raw_material_code_1 || '', rawMaterialCode2: r.raw_material_code_2 || '',
    rawMaterialCode3: r.raw_material_code_3 || '', rawMaterialCode4: r.raw_material_code_4 || '',
    netWeight: Number(r.net_weight) || 0, runnerWeight: Number(r.runner_weight) || 0,
    netWeight2: Number(r.net_weight_2) || 0, runnerWeight2: Number(r.runner_weight_2) || 0,
    paintQty1: Number(r.paint_qty_1) || 0, paintQty2: Number(r.paint_qty_2) || 0,
    paintQty3: Number(r.paint_qty_3) || 0, paintQty4: Number(r.paint_qty_4) || 0,
    lossRate: Number(r.loss_rate) || 0, cavity: Number(r.cavity) || 1,
    useCavity: Number(r.use_cavity) || 0,
    productSizeType: r.product_size_type || '', glossType: r.gloss_type || '',
    useYn: r.use_yn || 'Y',
  }));
  console.log(`  기준정보: ${riData.length}`);

  const eqRaw = await sbFetchAll('equipment_master', '?select=*') as any[];
  const eqData: EquipmentRecord[] = eqRaw.map(r => ({
    equipmentCode: r.equipment_code, equipmentName: r.equipment_name,
    site: r.site || '', industry: r.industry || '', variety: r.variety || '',
    line: r.line || '', directIndirect: r.direct_indirect || '',
    tonnage: r.tonnage || '', dailyHours: Number(r.daily_hours) || 0,
    dailyMinutes: Number(r.daily_minutes) || 0, dailySeconds: Number(r.daily_seconds) || 0,
    managementNo: r.management_no || '', equipmentNo: r.equipment_no || '',
    useYn: r.use_yn || 'Y',
  }));
  console.log(`  설비코드: ${eqData.length}`);

  const mcRaw = await sbFetchAll('material_code_master', '?select=*') as any[];
  const mcData: MaterialCodeRecord[] = mcRaw.map(r => ({
    industryCode: r.industry_code || '', materialType: r.material_type || '',
    materialCode: r.material_code, materialName: r.material_name || '',
    materialCategory: r.material_category || '', paintCategory: r.paint_category || '',
    color: r.color || '', unit: r.unit || '',
    safetyStock: Number(r.safety_stock) || 0, dailyAvgUsage: Number(r.daily_avg_usage) || 0,
    lossRate: Number(r.loss_rate) || 0, validDays: Number(r.valid_days) || 0,
    orderSize: r.order_size || '', useYn: r.use_yn || 'Y',
    protectedItem: r.protected_item || '', currentPrice: Number(r.current_price) || 0,
  }));
  console.log(`  재질코드: ${mcData.length}`);

  return { bomData, pcData, riData, eqData, mcData };
}

// ========================
// Step 4: Generate Excel
// ========================
function step4_generateExcel(
  bomData: BomMasterRecord[], pcData: ProductCodeRecord[],
  riData: ReferenceInfoRecord[], eqData: EquipmentRecord[], mcData: MaterialCodeRecord[],
) {
  console.log('\n=== Step 4: Generate Excel ===');
  const normalizePn = (pn: string) => pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
  const v = (val: unknown) => (val === 0 || val === '' || val == null) ? '' : val;

  const refMap = new Map<string, ReferenceInfoRecord>();
  for (const ri of riData) {
    refMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refMap.set(normalizePn(ri.customerPn), ri);
  }
  const pcMap = new Map<string, ProductCodeRecord>();
  for (const pc of pcData) pcMap.set(normalizePn(pc.productCode), pc);
  const matNameMap = new Map<string, string>();
  for (const mc of mcData) matNameMap.set(normalizePn(mc.materialCode), mc.materialName);
  const priceMap = new Map<string, number>();
  for (const mc of mcData) if (mc.currentPrice > 0) priceMap.set(normalizePn(mc.materialCode), mc.currentPrice);
  const matName = (code: string) => code ? (matNameMap.get(normalizePn(code)) || '') : '';

  const wb = XLSX.utils.book_new();

  // Sheet 1: BOM
  {
    const hdr = ['No','제품번호','레벨','모품번','자품번','고객사 P/N','자품명','규격','부품유형','단위','소요량','협력업체'];
    const rows: unknown[][] = [hdr];
    let prevProduct = '', curProduct = '';
    bomData.forEach((b, i) => {
      if (b.level === 1) curProduct = b.parentPn;
      const showProduct = curProduct !== prevProduct;
      if (showProduct) prevProduct = curProduct;
      const ref = refMap.get(normalizePn(b.childPn));
      rows.push([i+1, showProduct ? curProduct : '', b.level, b.parentPn, b.childPn,
        ref?.customerPn || '', b.childName, '', b.partType || '', 'EA', b.qty, b.supplier || '']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'BOM');
  }

  // Sheet 2: 제품코드
  {
    const hdr = ['No','제품코드','고객사 PART NO','제품명','고객사','품목유형','사용여부'];
    const rows: unknown[][] = [hdr];
    pcData.forEach((p, i) => rows.push([i+1, p.productCode, p.customerPn, p.productName, p.customer, p.model, 'Y']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '제품코드');
  }

  // Sheet 3: 기준정보
  {
    const hdr = ['No','품목코드','고객사 P/N','품목명','규격','고객사명','품종','품목상태','품목구분','품목유형','검사유형','제품군분류','조달구분','협력업체','우선배정라인1','우선배정라인2','우선배정라인3','우선배정라인4','안전재고','안전재고일수','LOT수량','시간당생산수량','불량허용기준','투입인원(명)','가공시간','표준C/T','표준공수','BOX당수량','원재료코드1','원재료코드2','원재료코드3','원재료코드4','NET중량1','Runner중량1','NET중량2','Runner중량2','1도 표준 Paint량','2도 표준 Paint량','3도 표준 Paint량','4도 표준 Paint량','재료 Loss율','금형Cavity','사용Cavity','제품크기종류','광택종류','사용여부'];
    const rows: unknown[][] = [hdr];
    riData.forEach((ri, i) => rows.push([i+1, ri.itemCode, ri.customerPn, ri.itemName, ri.spec, ri.customerName,
      ri.variety, ri.itemStatus, ri.itemCategory, ri.processType, ri.inspectionType, ri.productGroup,
      ri.supplyType, ri.supplier, ri.priorityLine1, ri.priorityLine2, ri.priorityLine3, ri.priorityLine4,
      v(ri.safetyStock), v(ri.safetyStockDays), v(ri.lotQty), v(ri.productionPerHour),
      v(ri.defectAllowance), v(ri.workers), ri.processingTime, v(ri.standardCT), v(ri.standardManHours), v(ri.qtyPerBox),
      ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4 || '',
      v(ri.netWeight), v(ri.runnerWeight), v(ri.netWeight2), v(ri.runnerWeight2),
      v(ri.paintQty1), v(ri.paintQty2), v(ri.paintQty3), v(ri.paintQty4),
      v(ri.lossRate), v(ri.cavity), v(ri.useCavity), ri.productSizeType, ri.glossType, ri.useYn]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '기준정보');
  }

  // Sheet 4: 설비코드
  {
    const hdr = ['No','설비코드','설비명','사업장','업종','품종','LINE','직/간접구분','설비톤수','일가동시간(HR)','일가동시간(분)','일가동시간(초)','설비관리번호','설비번호','사용여부'];
    const rows: unknown[][] = [hdr];
    eqData.forEach((eq, i) => rows.push([i+1, eq.equipmentCode, eq.equipmentName, eq.site, eq.industry, eq.variety, eq.line,
      eq.directIndirect, eq.tonnage, v(eq.dailyHours), v(eq.dailyMinutes), v(eq.dailySeconds),
      eq.managementNo, eq.equipmentNo, eq.useYn]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '설비코드');
  }

  // Sheet 5: 재질코드
  {
    const hdr = ['No','업종코드','업종명','재질코드','재질명','재질분류','도료구분','색상','단위','안전재고량','일평균사용량','Loss율(%)','유효기간(일)','발주 SIZE','사용여부','보호항목'];
    const rows: unknown[][] = [hdr];
    mcData.forEach((mc, i) => rows.push([i+1, mc.industryCode, mc.materialType, mc.materialCode, mc.materialName, mc.materialCategory,
      mc.paintCategory, mc.color, mc.unit, v(mc.safetyStock), v(mc.dailyAvgUsage),
      v(mc.lossRate), v(mc.validDays), mc.orderSize, mc.useYn, mc.protectedItem]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '재질코드');
  }

  // Sheet 6: BOM정보
  {
    const hdr = ['No','제품번호','고객사','제품코드','고객사 P/N(제품)','제품명','제품유형','레벨','모품번','자품번','고객사 P/N','자품명','규격','부품유형','단위','소요량','협력업체','조달구분','적용설비명','표준C/T','원재료명1','원재료명2','원재료명3','NET중량1','Runner중량1','NET중량2','Runner중량2','1도 표준 Paint량','2도 표준 Paint량','3도 표준 Paint량','재질단가'];
    const rows: unknown[][] = [hdr];
    let curPC = '', prevPC = '', no = 0;
    let curPc: ProductCodeRecord | undefined, curPT = '';
    for (const b of bomData) {
      if (b.partType === '원재료') continue;
      if (b.level === 1) { curPC = b.parentPn; curPc = pcMap.get(normalizePn(b.parentPn)); curPT = refMap.get(normalizePn(b.parentPn))?.processType || ''; }
      const show = curPC !== prevPC; if (show) prevPC = curPC;
      const ref = refMap.get(normalizePn(b.childPn)) || refMap.get(normalizePn(b.parentPn));
      const price = ref?.rawMaterialCode1 ? (priceMap.get(normalizePn(ref.rawMaterialCode1)) || 0) : 0;
      no++;
      rows.push([no, show ? curPC : '', curPc?.customer || '', curPC, curPc?.customerPn || '',
        curPc?.productName || '', curPT, b.level, b.parentPn, b.childPn,
        ref?.customerPn || '', b.childName || ref?.itemName || '', ref?.spec || '',
        b.partType || '', 'EA', b.qty, b.supplier || '', ref?.supplyType || '',
        ref?.priorityLine1 || '', v(ref?.standardCT),
        matName(ref?.rawMaterialCode1 || ''), matName(ref?.rawMaterialCode2 || ''), matName(ref?.rawMaterialCode3 || ''),
        v(ref?.netWeight), v(ref?.runnerWeight), v(ref?.netWeight2), v(ref?.runnerWeight2),
        v(ref?.paintQty1), v(ref?.paintQty2), v(ref?.paintQty3), price > 0 ? price : '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'BOM정보');
  }

  // Sheet 7: Cavity2이상_사출
  {
    const hdr = ['품목코드','고객사 P/N','품목명','사용Cavity','NET중량1(g)','Runner중량1(g)','Runner/Cavity(g)','재료Loss율(%)','소요량(Kg)'];
    const rows: unknown[][] = [hdr];
    for (const ri of riData) {
      const cav = ri.useCavity || ri.cavity;
      if (cav >= 2 && ri.processType?.includes('사출')) {
        const rpc = cav > 0 ? ri.runnerWeight / cav : 0;
        const usage = ((ri.netWeight + rpc) * (1 + ri.lossRate / 100)) / 1000;
        rows.push([ri.itemCode, ri.customerPn, ri.itemName, cav, ri.netWeight, ri.runnerWeight,
          rpc > 0 ? Math.round(rpc * 100) / 100 : '', v(ri.lossRate), usage > 0 ? Math.round(usage * 10000) / 10000 : '']);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Cavity2이상_사출');
  }

  // Sheet 8: 사출_누락정보
  {
    const hdr = ['품목코드','고객사 P/N','품목명','원재료명1','NET중량1(g)','Runner중량1(g)','누락사유'];
    const rows: unknown[][] = [hdr];
    for (const ri of riData) {
      if (!ri.processType?.includes('사출')) continue;
      if (ri.supplyType?.includes('외주') || ri.supplyType?.includes('구매')) continue;
      const reasons: string[] = [];
      if (ri.netWeight <= 0 && ri.runnerWeight <= 0) reasons.push('NET/Runner 중량 모두 0');
      else if (ri.netWeight <= 0) reasons.push('NET중량 0');
      if (!ri.rawMaterialCode1) reasons.push('원재료코드 없음');
      if (reasons.length === 0) continue;
      rows.push([ri.itemCode, ri.customerPn, ri.itemName, matName(ri.rawMaterialCode1), ri.netWeight, ri.runnerWeight, reasons.join(', ')]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '사출_누락정보');
  }

  // Sheet 9: 도장_누락정보
  {
    const hdr = ['품목코드','고객사 P/N','품목명','1도 원재료명','2도 원재료명','3도 원재료명','1도Paint량(g)','2도Paint량(g)','3도Paint량(g)','누락사유'];
    const rows: unknown[][] = [hdr];
    for (const ri of riData) {
      if (!ri.processType?.includes('도장')) continue;
      const reasons: string[] = [];
      if (ri.paintQty1 <= 0 && ri.paintQty2 <= 0 && ri.paintQty3 <= 0) reasons.push('Paint량 모두 0');
      if (!ri.rawMaterialCode1 && !ri.rawMaterialCode2 && !ri.rawMaterialCode3) reasons.push('원재료 전체 없음');
      else {
        if (!ri.rawMaterialCode1 && ri.paintQty1 > 0) reasons.push('1도 원재료 없음');
        if (!ri.rawMaterialCode2 && ri.paintQty2 > 0) reasons.push('2도 원재료 없음');
        if (!ri.rawMaterialCode3 && ri.paintQty3 > 0) reasons.push('3도 원재료 없음');
      }
      if (reasons.length === 0) continue;
      rows.push([ri.itemCode, ri.customerPn, ri.itemName,
        matName(ri.rawMaterialCode1), matName(ri.rawMaterialCode2), matName(ri.rawMaterialCode3),
        v(ri.paintQty1), v(ri.paintQty2), v(ri.paintQty3), reasons.join(', ')]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '도장_누락정보');
  }

  const outBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(OUTPUT, outBuf);
  console.log(`  Saved: ${OUTPUT}`);
}

// ========================
// Step 5: Compare
// ========================
function step5_compare() {
  console.log('\n=== Step 5: Compare original vs generated ===\n');
  const origWb = XLSX.read(fs.readFileSync(ORIGINAL));
  const genWb = XLSX.read(fs.readFileSync(OUTPUT));

  const findHeaders = (data: unknown[][]): string[] => {
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i] as unknown[];
      if (!row || row.length < 3) continue;
      const strs = row.filter(c => typeof c === 'string' && c.length > 1 && c !== 'Column-0');
      if (strs.length >= 3) {
        return row.filter(h => h != null && h !== 'Column-0' && String(h).trim() !== '')
          .map(h => String(h).trim())
          .filter(h => h !== 'No');
      }
    }
    return [];
  };

  const findHeaderRowIdx = (data: unknown[][]): number => {
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i] as unknown[];
      if (!row || row.length < 3) continue;
      const strs = row.filter(c => typeof c === 'string' && c.length > 1 && c !== 'Column-0');
      if (strs.length >= 3) return i;
    }
    return 0;
  };

  // Data sampling: compare values for key columns
  const sampleCompare = (origData: unknown[][], genData: unknown[][], origHdrIdx: number, genHdrIdx: number, keyColIdx: number): { origSet: Set<string>, genSet: Set<string> } => {
    const getKeys = (data: unknown[][], hdrIdx: number, skipFirst: boolean): Set<string> => {
      const s = new Set<string>();
      for (let r = hdrIdx + 1; r < data.length; r++) {
        const row = data[r] as unknown[];
        if (!row) continue;
        const vals = skipFirst ? row.slice(1) : row.filter(v => v != null);
        const key = String(vals[keyColIdx] || '').trim();
        if (key) s.add(key);
      }
      return s;
    };
    return { origSet: getKeys(origData, origHdrIdx, false), genSet: getKeys(genData, genHdrIdx, true) };
  };

  const results: string[] = [];
  let passCount = 0;

  for (const sheetName of origWb.SheetNames) {
    const origWs = origWb.Sheets[sheetName];
    const genWs = genWb.Sheets[sheetName];
    if (!genWs) { results.push(`❌ ${sheetName}: 다운로드에 없음`); continue; }

    const origData = XLSX.utils.sheet_to_json<unknown[]>(origWs, { header: 1 }) as unknown[][];
    const genData = XLSX.utils.sheet_to_json<unknown[]>(genWs, { header: 1 }) as unknown[][];

    const origHeaders = findHeaders(origData);
    const genHeaders = findHeaders(genData).filter(h => h !== '재질단가');
    const origHdrIdx = findHeaderRowIdx(origData);
    const genHdrIdx = findHeaderRowIdx(genData);

    const origRows = origData.length - origHdrIdx - 1;
    const genRows = genData.length - genHdrIdx - 1;
    const rowDiff = genRows - origRows;

    // Header comparison
    const matchCount = origHeaders.filter((h, i) => genHeaders[i] === h).length;
    const colOk = matchCount === origHeaders.length;

    // Key data comparison
    const { origSet, genSet } = sampleCompare(origData, genData, origHdrIdx, genHdrIdx, 0);
    const commonKeys = [...origSet].filter(k => genSet.has(k)).length;
    const keyOverlap = origSet.size > 0 ? Math.round(commonKeys / origSet.size * 100) : 100;

    const rowOk = Math.abs(rowDiff) <= Math.max(10, origRows * 0.05);
    const ok = colOk && rowOk;
    if (ok) passCount++;

    const status = ok ? '✅' : (colOk ? '⚠️' : '❌');
    const rowInfo = rowDiff === 0 ? `${origRows}행` : `${origRows} → ${genRows} (${rowDiff > 0 ? '+' : ''}${rowDiff})`;
    results.push(`${status} ${sheetName}: 헤더 ${matchCount}/${origHeaders.length} | 행수 ${rowInfo} | 키매칭 ${keyOverlap}%`);

    if (!colOk) {
      for (let i = 0; i < Math.max(origHeaders.length, genHeaders.length); i++) {
        const o = origHeaders[i] || '(없음)';
        const g = genHeaders[i] || '(없음)';
        if (o !== g) results.push(`     col${i+1}: "${o}" vs "${g}"`);
      }
    }
  }

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           비교 검증 결과                             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  for (const r of results) console.log('║ ' + r);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ 전체: ${passCount}/${origWb.SheetNames.length} 시트 통과`);
  console.log('╚══════════════════════════════════════════════════════╝');
}

// Main
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  BOM 마스터 라운드트립 검증           ║');
  console.log('║  Parse → Supabase → Fetch → Excel    ║');
  console.log('╚══════════════════════════════════════╝');

  const parsed = step1_parse();
  await step2_save(parsed);
  const { bomData, pcData, riData, eqData, mcData } = await step3_fetch();
  step4_generateExcel(bomData, pcData, riData, eqData, mcData);
  step5_compare();
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
