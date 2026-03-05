/**
 * centralUploadHandlers.ts — 16개 업로더의 독립적 핸들러
 * 모달에서 파일 선택 → 파싱 → Supabase 저장까지 완결
 */
import { readFileAsCSVText, readCsvWithEncoding, readFileAsArrayBuffer } from './fileReaders';
import { parseSalesCSV } from './salesDataParser';
import { parseRevenueCSV, parseItemRevenueCSV } from './revenueDataParser';
import { parseRFQCSV } from './rfqDataParser';
import { parseCRCSV } from './crDataParser';
import { parsePartsCSV, parseMaterialCSV } from './purchaseDataParser';
import { parseBomMasterExcel } from './bomMasterParser';
import { parseMaterialMasterExcel, parsePnMappingFromExcel } from './bomDataParser';
import { parseStandardMixFile, parseMaterialPriceFile, parsePaintMixLogFile } from './standardMaterialParser';
import { parseSupplierCSV } from './supplierDataParser';
import { safeSetItem } from './safeStorage';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  salesService,
  revenueService,
  itemRevenueService,
  rfqService,
  crService,
  purchaseService,
  bomMasterService,
  productCodeService,
  referenceInfoService,
  equipmentService,
  dataQualityService,
  materialCodeService,
  paintMixRatioService,
  paintMixLogService,
  inventoryService,
  supplierService,
} from '../services/supabaseService';

export interface UploadResult {
  success: boolean;
  count: number;
  message: string;
}

function dispatchUpdate(detail?: Record<string, unknown>) {
  window.dispatchEvent(
    detail
      ? new CustomEvent('dashboard-data-updated', { detail })
      : new Event('dashboard-data-updated')
  );
}

// ─── 1. 수량 업로드 ───
export async function uploadSalesQty(file: File): Promise<UploadResult> {
  try {
    const csvText = await readFileAsCSVText(file);
    const data = parseSalesCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_salesData', JSON.stringify(data));
    if (isSupabaseConfigured()) await salesService.saveAll(data);
    dispatchUpdate({ type: 'sales' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 2. 매출 업로드 (year 필요) ───
export async function uploadRevenue(file: File, year: number): Promise<UploadResult> {
  try {
    const csvText = await readFileAsCSVText(file);
    const data = parseRevenueCSV(csvText, year);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_revenueData', JSON.stringify(data));
    if (isSupabaseConfigured()) await revenueService.saveByYear(data, year);
    dispatchUpdate({ type: 'revenue' });
    return { success: true, count: data.length, message: `${year}년 ${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 3. 품목별 매출 ───
export async function uploadItemRevenue(file: File): Promise<UploadResult> {
  try {
    const csvText = await readCsvWithEncoding(file);
    const data = parseItemRevenueCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_itemRevenueData', JSON.stringify(data));
    if (isSupabaseConfigured()) await itemRevenueService.saveAll(data);
    dispatchUpdate({ type: 'itemRevenue' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 4. RFQ 업로드 ───
export async function uploadRfq(file: File): Promise<UploadResult> {
  try {
    const csvText = await readFileAsCSVText(file);
    const data = parseRFQCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_rfqData', JSON.stringify(data));
    if (isSupabaseConfigured()) await rfqService.saveAll(data);
    dispatchUpdate({ type: 'rfq' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 5. CR 업로드 (year 필요) ───
export async function uploadCR(file: File, year: number): Promise<UploadResult> {
  try {
    const csvText = await readFileAsCSVText(file);
    const data = parseCRCSV(csvText, year);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_crData', JSON.stringify(data));
    if (isSupabaseConfigured()) await crService.saveByYear(data, year);
    dispatchUpdate({ type: 'cr' });
    return { success: true, count: data.length, message: `${year}년 ${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 6. 부품 입고 (month, year 필요) ───
export async function uploadPartsInbound(file: File, month: string, year: number): Promise<UploadResult> {
  try {
    const csvText = await readCsvWithEncoding(file);
    const data = parsePartsCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    if (isSupabaseConfigured()) await purchaseService.saveByMonthAndCategory(data, month, 'Parts', year);
    dispatchUpdate({ type: 'purchase' });
    return { success: true, count: data.length, message: `${year}년 ${month} 부품 ${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 7. 원재료 입고 (month, year 필요) ───
export async function uploadMaterialInbound(file: File, month: string, year: number): Promise<UploadResult> {
  try {
    const csvText = await readCsvWithEncoding(file);
    const data = parseMaterialCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    if (isSupabaseConfigured()) await purchaseService.saveByMonthAndCategory(data, month, 'Material', year);
    dispatchUpdate({ type: 'purchase' });
    return { success: true, count: data.length, message: `${year}년 ${month} 원재료 ${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 8. BOM 마스터 ───
export async function uploadBomMaster(file: File): Promise<UploadResult> {
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const result = parseBomMasterExcel(buffer);
    const totalCount = result.bom.length + result.productCodes.length +
      result.referenceInfo.length + result.equipment.length +
      result.materialCodes.length + result.qualityIssues.length;
    if (totalCount === 0) return { success: false, count: 0, message: '파싱 결과 없음' };

    if (isSupabaseConfigured()) {
      const saves: Promise<void>[] = [];
      if (result.bom.length > 0) saves.push(bomMasterService.saveAll(result.bom));
      if (result.productCodes.length > 0) saves.push(productCodeService.saveAll(result.productCodes));
      if (result.referenceInfo.length > 0) saves.push(referenceInfoService.saveAll(result.referenceInfo));
      if (result.equipment.length > 0) saves.push(equipmentService.saveAll(result.equipment));
      if (result.materialCodes.length > 0) saves.push(materialCodeService.saveAll(result.materialCodes));
      if (result.qualityIssues.length > 0) saves.push(dataQualityService.saveAll(result.qualityIssues));
      await Promise.all(saves);
    }
    dispatchUpdate({ type: 'bomMaster' });
    return { success: true, count: result.bom.length, message: `BOM ${result.bom.length}건 외 ${totalCount - result.bom.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 9. 자재마스터 ───
export async function uploadMaterialMaster(file: File): Promise<UploadResult> {
  try {
    const buffer = await readFileAsArrayBuffer(file);
    // 1차: 자재마스터 형식, 2차: 표준재료비 형식
    let mappings = parseMaterialMasterExcel(buffer);
    if (mappings.length === 0) mappings = parsePnMappingFromExcel(buffer);
    if (mappings.length === 0) return { success: false, count: 0, message: '품번 매핑 파싱 실패' };

    // 기존 매핑과 병합
    const existingRaw = localStorage.getItem('dashboard_pnMapping');
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        const map = new Map(existing.map((m: any) => [m.internalCode, m]));
        mappings.forEach(m => map.set(m.internalCode, m));
        mappings = Array.from(map.values()) as typeof mappings;
      } catch { /* ignore */ }
    }

    safeSetItem('dashboard_pnMapping', JSON.stringify(mappings));
    dispatchUpdate({ key: 'dashboard_pnMapping', data: mappings });
    return { success: true, count: mappings.length, message: `${mappings.length}건 매핑 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 10. 배합표준서 ───
export async function uploadStandardMix(file: File): Promise<UploadResult> {
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const data = parseStandardMixFile(buffer);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    if (isSupabaseConfigured()) await paintMixRatioService.saveAll(data);
    dispatchUpdate({ type: 'standardMix' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 11. 재질단가 ───
export async function uploadMaterialPrice(file: File): Promise<UploadResult> {
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const data = parseMaterialPriceFile(buffer);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    if (isSupabaseConfigured()) {
      const result = await materialCodeService.updatePrices(data);
      return { success: true, count: data.length, message: `${result.updated}건 갱신, ${result.inserted}건 추가` };
    }
    return { success: true, count: data.length, message: `${data.length}건 파싱 (로컬)` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 12. 배합일지 ───
export async function uploadPaintMixLog(file: File): Promise<UploadResult> {
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const data = parsePaintMixLogFile(buffer);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    if (isSupabaseConfigured()) await paintMixLogService.saveAll(data);
    dispatchUpdate({ type: 'paintMixLog' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 재고 업로드용 로컬 파서 (InventoryView 로직 복제) ───

interface InvMaterialItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  location: string;
  qty: number;
}

interface InvPartsItem {
  id: string;
  itemType?: string;
  code: string;
  customerPN?: string;
  name: string;
  spec?: string;
  unit: string;
  model?: string;
  status?: string;
  location: string;
  storageLocation?: string;
  qty: number;
  unitPrice?: number;
  amount?: number;
}

function parseInvCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
    else { current += char; }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  const merged: string[] = [];
  let idx = 0;
  while (idx < result.length) {
    const val = result[idx];
    if (/^\d+$/.test(val) && idx + 1 < result.length) {
      const next = result[idx + 1];
      if (/^\d{2,3}$/.test(next) || /^\d{2,3}\.\d*$/.test(next)) {
        merged.push(val + ',' + next); idx += 2; continue;
      }
    }
    merged.push(val); idx++;
  }
  return merged;
}

function parseInvNumeric(value: string): number {
  if (!value || typeof value !== 'string') return 0;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseInventoryMaterialCSV(csvText: string): InvMaterialItem[] {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const result: InvMaterialItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseInvCSVLine(lines[i]);
    if (values.length < 5) continue;
    const qtyIndex = values.length - 1;
    const qty = parseInvNumeric(values[qtyIndex]);
    const code = values[qtyIndex - 4] || '';
    if (!code) continue;
    result.push({
      id: `mat-${i}`,
      code,
      name: values[qtyIndex - 2] || '',
      unit: values[qtyIndex - 3] || 'Kg',
      location: values[qtyIndex - 1] || '',
      qty,
    });
  }
  return result;
}

function invFindCol(headers: string[], keywords: string[]): number {
  const norm = headers.map(h => h.replace(/\s/g, '').toLowerCase());
  for (const kw of keywords) {
    const k = kw.replace(/\s/g, '').toLowerCase();
    const idx = norm.findIndex(h => h === k || h.includes(k) || k.includes(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseInventoryPartsCSV(csvText: string): InvPartsItem[] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headerValues = parseInvCSVLine(lines[0].replace(/^\uFEFF/, ''));
  const colItemTypeFirst = invFindCol(headerValues, ['품목유형', '품목 유형', '유형']);
  const hasItemType = colItemTypeFirst >= 0;
  const hasStorageLocation = invFindCol(headerValues, ['재고위치']) >= 0;
  const isNewFormat = hasItemType || hasStorageLocation || headerValues.length >= 10;
  const hasLeadingNo = /^(no|번호|#|\d+)$/i.test((headerValues[0] ?? '').trim());
  const firstCell = (headerValues[0] ?? '').trim();
  const looksLikeDataRow = /^\d+([.,]\d*)?$/.test(firstCell) || (firstCell === '' && headerValues.length > 1);
  const colCode = invFindCol(headerValues, ['품목코드', '코드']);
  const colName = invFindCol(headerValues, ['품목명']);
  const usePositional = looksLikeDataRow || (colCode < 0 && colName < 0);
  const offset = usePositional && headerValues.length >= 12 ? 1 : 0;
  const itemTypeFallbackIdx = headerValues.length >= 12 && hasLeadingNo ? 1 : (headerValues.length >= 11 ? 0 : -1);

  let col: Record<string, number>;
  if (usePositional) {
    col = { itemType: isNewFormat ? 0 + offset : -1, code: 1 + offset, customerPN: 2 + offset, name: 3 + offset, spec: 4 + offset, unit: 5 + offset, model: 6 + offset, status: 7 + offset, location: 8 + offset, storageLocation: 9 + offset, qty: 10 + offset };
  } else {
    const colCustomerPN = invFindCol(headerValues, ['고객사P/N', '고객사 P/N', '고객사p/n']);
    const colSpec = invFindCol(headerValues, ['규격']);
    const colUnit = invFindCol(headerValues, ['단위']);
    const colModel = invFindCol(headerValues, ['차종명']);
    const colStatus = invFindCol(headerValues, ['품목상태', '상태']);
    const colLocation = invFindCol(headerValues, ['창고명']);
    const colStorageLocation = invFindCol(headerValues, ['재고위치']);
    const colQty = headerValues.findIndex((h: string) => h.trim() === '재고') >= 0
      ? headerValues.findIndex((h: string) => h.trim() === '재고')
      : headerValues.length - 1;
    col = {
      itemType: isNewFormat ? (colItemTypeFirst >= 0 ? colItemTypeFirst : itemTypeFallbackIdx) : -1,
      code: colCode >= 0 ? colCode : 1 + offset, customerPN: colCustomerPN >= 0 ? colCustomerPN : 2 + offset,
      name: colName >= 0 ? colName : 3 + offset, spec: colSpec >= 0 ? colSpec : 4 + offset,
      unit: colUnit >= 0 ? colUnit : 5 + offset, model: colModel >= 0 ? colModel : 6 + offset,
      status: colStatus >= 0 ? colStatus : 7 + offset, location: colLocation >= 0 ? colLocation : 8 + offset,
      storageLocation: colStorageLocation >= 0 ? colStorageLocation : -1, qty: colQty,
    };
  }

  const result: InvPartsItem[] = [];
  const startRow = usePositional ? 0 : 1;
  for (let i = startRow; i < lines.length; i++) {
    const values = parseInvCSVLine(lines[i]);
    if (values.length < 2) continue;
    const read = (idx: number, fb: string) => (idx >= 0 && idx < values.length ? values[idx] || '' : fb);
    const code = read(col.code, '');
    const qtyRaw = values.length > 0 ? values[values.length - 1] : '0';
    result.push({
      id: `parts-${i}`,
      itemType: col.itemType >= 0 ? read(col.itemType, '')?.trim() || undefined : undefined,
      code: code.trim(), customerPN: read(col.customerPN, '')?.trim() || undefined,
      name: read(col.name, '').trim(), spec: read(col.spec, '')?.trim() || undefined,
      unit: read(col.unit, 'EA').trim(), model: read(col.model, '')?.trim() || undefined,
      status: read(col.status, '')?.trim() || undefined, location: read(col.location, '').trim(),
      storageLocation: col.storageLocation >= 0 ? read(col.storageLocation, '')?.trim() || undefined : undefined,
      qty: parseInvNumeric(qtyRaw),
    });
  }
  return result;
}

async function uploadInventoryByType(file: File, type: 'resin' | 'paint' | 'parts'): Promise<UploadResult> {
  try {
    const csvText = await readCsvWithEncoding(file);
    let count: number;

    // 기존 재고 데이터 로드
    const existingRaw = localStorage.getItem('dashboard_inventory_v2');
    const inventoryData = existingRaw
      ? JSON.parse(existingRaw)
      : { resin: [], paint: [], parts: [] };

    if (type === 'parts') {
      const data = parseInventoryPartsCSV(csvText);
      if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
      inventoryData.parts = data;
      count = data.length;
    } else {
      const data = parseInventoryMaterialCSV(csvText);
      if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
      inventoryData[type] = data;
      count = data.length;
    }

    safeSetItem('dashboard_inventory_v2', JSON.stringify(inventoryData));
    if (isSupabaseConfigured()) await inventoryService.saveInventoryV2(inventoryData);
    dispatchUpdate({ type: 'inventory' });
    return { success: true, count, message: `${count}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}

// ─── 13. 수지 재고 ───
export async function uploadResinInventory(file: File): Promise<UploadResult> {
  return uploadInventoryByType(file, 'resin');
}

// ─── 14. 도료 재고 ───
export async function uploadPaintInventory(file: File): Promise<UploadResult> {
  return uploadInventoryByType(file, 'paint');
}

// ─── 15. 부품 재고 ───
export async function uploadPartsInventory(file: File): Promise<UploadResult> {
  return uploadInventoryByType(file, 'parts');
}

// ─── 16. 협력사 CSV ───
export async function uploadSupplier(file: File): Promise<UploadResult> {
  try {
    const csvText = await readCsvWithEncoding(file);
    const data = parseSupplierCSV(csvText);
    if (data.length === 0) return { success: false, count: 0, message: '파싱 결과 없음' };
    safeSetItem('dashboard_supplierData', JSON.stringify(data));
    if (isSupabaseConfigured()) await supplierService.saveAll(data);
    dispatchUpdate({ type: 'supplier' });
    return { success: true, count: data.length, message: `${data.length}건 저장` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message || '업로드 실패' };
  }
}
