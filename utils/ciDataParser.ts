import * as XLSX from 'xlsx';

// ============================================
// Types
// ============================================

export interface CIDetailItem {
  customer: string;        // 고객사
  productionSite: string;  // 양산처
  vehicleModel: string;    // 차종
  partCode: string;        // 부품코드
  partNumber: string;      // 품번
  partName: string;        // 품명
  category: string;        // 품목 (구매/PAINT/RESIN)
  basePrice: number;       // 기준단가
  currentPrice: number;    // 현단가
  quantity: number;        // 수량
  ciAmount: number;        // CI금액
}

export interface CICategorySummary {
  category: string;
  amount: number;
}

export interface CISupplierSummary {
  supplier: string;
  amount: number;
}

export interface CIParseResult {
  month: number;           // 1-12
  year: number;
  details: CIDetailItem[];
  totalCIAmount: number;
  totalQuantity: number;
  byCategory: CICategorySummary[];
  bySupplier: CISupplierSummary[];
  fileName: string;
  uploadDate: string;
}

// ============================================
// Parser
// ============================================

export function parseCIExcel(buffer: ArrayBuffer, fileName: string): CIParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Find the CI detail sheet (e.g., "01월 CI 상세내역")
  const detailSheetName = workbook.SheetNames.find(name => /\d+월\s*CI\s*상세내역/.test(name));
  // Find the CI summary sheet (e.g., "01월 CI금액 집계")
  const summarySheetName = workbook.SheetNames.find(name => /\d+월\s*CI금액\s*집계/.test(name));

  if (!detailSheetName) {
    throw new Error('CI 상세내역 시트를 찾을 수 없습니다.');
  }

  // Extract month from sheet name
  const monthMatch = detailSheetName.match(/(\d+)월/);
  const month = monthMatch ? parseInt(monthMatch[1]) : 1;

  // Extract year from filename (e.g., "2026년 01월 CI실적.xlsx")
  const yearMatch = fileName.match(/(\d{4})년/);
  const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

  // Parse detail sheet
  const detailWs = workbook.Sheets[detailSheetName];
  const details = parseDetailSheet(detailWs);

  // Get totals from detail sheet row 1
  const totalQuantity = getNumericValue(detailWs, 'K1');
  const totalCIAmount = getNumericValue(detailWs, 'L1');

  // Parse summary sheet if available
  let byCategory: CICategorySummary[] = [];
  let bySupplier: CISupplierSummary[] = [];

  if (summarySheetName) {
    const summaryWs = workbook.Sheets[summarySheetName];
    const parsed = parseSummarySheet(summaryWs);
    byCategory = parsed.byCategory;
    bySupplier = parsed.bySupplier;
  } else {
    // Derive from details
    byCategory = deriveCategorySummary(details);
    bySupplier = deriveSupplierSummary(details);
  }

  return {
    month,
    year,
    details,
    totalCIAmount: totalCIAmount || details.reduce((sum, d) => sum + d.ciAmount, 0),
    totalQuantity: totalQuantity || details.reduce((sum, d) => sum + d.quantity, 0),
    byCategory,
    bySupplier,
    fileName,
    uploadDate: new Date().toISOString(),
  };
}

// ============================================
// Detail Sheet Parser
// ============================================

function parseDetailSheet(ws: XLSX.WorkSheet): CIDetailItem[] {
  const items: CIDetailItem[] = [];
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!range) return items;

  // Data starts at row 4 (index 3), headers at row 3
  for (let r = 3; r <= range.e.r; r++) {
    const rowNum = r + 1; // 1-based
    const customer = getCellString(ws, `B${rowNum}`);
    const ciAmount = getNumericValue(ws, `L${rowNum}`);

    // Skip empty rows
    if (!customer && ciAmount === 0) continue;

    items.push({
      customer: customer || '',
      productionSite: getCellString(ws, `C${rowNum}`),
      vehicleModel: getCellString(ws, `D${rowNum}`),
      partCode: getCellString(ws, `E${rowNum}`),
      partNumber: getCellString(ws, `F${rowNum}`),
      partName: getCellString(ws, `G${rowNum}`),
      category: getCellString(ws, `H${rowNum}`),
      basePrice: getNumericValue(ws, `I${rowNum}`),
      currentPrice: getNumericValue(ws, `J${rowNum}`),
      quantity: getNumericValue(ws, `K${rowNum}`),
      ciAmount,
    });
  }

  return items;
}

// ============================================
// Summary Sheet Parser
// ============================================

function parseSummarySheet(ws: XLSX.WorkSheet): {
  byCategory: CICategorySummary[];
  bySupplier: CISupplierSummary[];
} {
  const byCategory: CICategorySummary[] = [];
  const bySupplier: CISupplierSummary[] = [];
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!range) return { byCategory, bySupplier };

  // Category summary (columns B-C)
  for (let r = 1; r <= range.e.r; r++) {
    const rowNum = r + 1;
    const category = getCellString(ws, `B${rowNum}`);
    const amount = getNumericValue(ws, `C${rowNum}`);
    if (category && amount > 0 && category !== '총합계' && category !== '합계' && category !== '품목') {
      byCategory.push({ category, amount });
    }
  }

  // Supplier summary (columns E-F)
  for (let r = 1; r <= range.e.r; r++) {
    const rowNum = r + 1;
    const supplier = getCellString(ws, `E${rowNum}`);
    const amount = getNumericValue(ws, `F${rowNum}`);
    if (supplier && amount > 0 && supplier !== '총합계' && supplier !== '합계' && supplier !== '공급 업체') {
      bySupplier.push({ supplier, amount });
    }
  }

  // Sort by amount desc
  byCategory.sort((a, b) => b.amount - a.amount);
  bySupplier.sort((a, b) => b.amount - a.amount);

  return { byCategory, bySupplier };
}

// ============================================
// Fallback derivers
// ============================================

function deriveCategorySummary(details: CIDetailItem[]): CICategorySummary[] {
  const map = new Map<string, number>();
  for (const d of details) {
    const cat = d.category || '기타';
    map.set(cat, (map.get(cat) || 0) + d.ciAmount);
  }
  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function deriveSupplierSummary(details: CIDetailItem[]): CISupplierSummary[] {
  const map = new Map<string, number>();
  for (const d of details) {
    const sup = d.productionSite || '기타';
    map.set(sup, (map.get(sup) || 0) + d.ciAmount);
  }
  return Array.from(map.entries())
    .map(([supplier, amount]) => ({ supplier, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================
// Helpers
// ============================================

function getCellString(ws: XLSX.WorkSheet, addr: string): string {
  const cell = ws[addr];
  if (!cell) return '';
  const v = cell.v;
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function getNumericValue(ws: XLSX.WorkSheet, addr: string): number {
  const cell = ws[addr];
  if (!cell) return 0;
  const v = cell.v;
  if (v === null || v === undefined || v === '') return 0;
  const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}
