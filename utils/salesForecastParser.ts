import * as XLSX from 'xlsx';

// ============================================
// Types
// ============================================

export interface ForecastItem {
  no: number;
  customer: string;      // 거래선
  model: string;         // 차종
  stage: string;         // 단계 (양산/단종/신규 등)
  partNo: string;        // P.N
  newPartNo: string;     // NEW P.N
  type: string;          // Type (버튼/터치 등)
  unitPrice: number;     // 변경단가
  category: string;      // 구분 (PANEL/KNOB/REAR 등)
  partName: string;      // 부품명
  monthlyQty: number[];  // 1~12월 계획 수량
  totalQty: number;      // 계획 합계
  monthlyRevenue: number[]; // 1~12월 매출
  totalRevenue: number;  // 매출 합계
}

export interface ForecastSummary {
  reportDate: string;      // 보고 날짜 (e.g., "3차 보고 : 26년 02월 20일")
  year: number;            // 연도 (e.g., 2026)
  revision: string;        // Rev 번호
  monthlyQtyTotals: number[];    // 월별 수량 합계
  monthlyRevenueTotals: number[]; // 월별 매출 합계
  totalQty: number;
  totalRevenue: number;
  // 이전 기준 대비 (있으면)
  prevRevenueTotals?: number[];   // 이전 보고 기준 분기별
  revenueDiff?: number[];         // 증감
}

export interface ForecastUpload {
  id: string;
  fileName: string;
  uploadDate: string;
  reportDate: string;
  revision: string;
  year: number;
  totalRevenue: number;
  totalQty: number;
  itemCount: number;
}

export interface ForecastParseResult {
  items: ForecastItem[];
  summary: ForecastSummary;
  upload: Omit<ForecastUpload, 'id' | 'uploadDate'>;
}

// ============================================
// Parser
// ============================================

/**
 * Parse the forecast Excel file.
 * Detects the most recent year sheet (e.g., "26년 예상매출")
 * and extracts all item-level data.
 */
export function parseForecastExcel(buffer: ArrayBuffer, fileName: string): ForecastParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Find the target sheet - prefer the most recent year
  const yearSheets = workbook.SheetNames
    .filter(name => /^\d{2}년 예상매출$/.test(name))
    .sort((a, b) => {
      const yearA = parseInt(a);
      const yearB = parseInt(b);
      return yearB - yearA; // descending - most recent first
    });

  if (yearSheets.length === 0) {
    throw new Error('예상매출 시트를 찾을 수 없습니다. (예: "26년 예상매출")');
  }

  const targetSheet = yearSheets[0];
  const ws = workbook.Sheets[targetSheet];
  const yearPrefix = parseInt(targetSheet);
  const fullYear = yearPrefix + 2000;

  // Extract report info from B2
  const b2 = getCellValue(ws, 'B2') as string || '';
  const reportDateMatch = b2.match(/(\d+차 보고\s*:\s*\d+년\s*\d+월\s*\d+일)/);
  const reportDate = reportDateMatch ? reportDateMatch[1] : b2;
  const revMatch = fileName.match(/Rev\.?\s*(\d+)/i) || b2.match(/(\d+)차/);
  const revision = revMatch ? `Rev.${revMatch[1]}` : 'Rev.1';

  // Extract monthly totals from row 8 (summary row)
  const monthlyQtyTotals: number[] = [];
  const monthlyRevenueTotals: number[] = [];
  const qtyCols = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];
  const revCols = ['AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN'];

  for (const col of qtyCols) {
    monthlyQtyTotals.push(getNumericValue(ws, `${col}8`));
  }
  for (const col of revCols) {
    monthlyRevenueTotals.push(getNumericValue(ws, `${col}8`));
  }

  const totalQty = getNumericValue(ws, 'X8');
  const totalRevenue = getNumericValue(ws, 'AO8');

  // Extract previous report comparison data if available (Row 3 = previous, Row 4 = current)
  let prevRevenueTotals: number[] | undefined;
  let revenueDiff: number[] | undefined;
  const prevQ1 = getNumericValue(ws, 'AD3');
  if (prevQ1 > 0) {
    prevRevenueTotals = [
      getNumericValue(ws, 'AD3'), // 1Q
      getNumericValue(ws, 'AE3'), // 2Q
      getNumericValue(ws, 'AF3'), // 3Q
      getNumericValue(ws, 'AG3'), // 4Q
    ];
    const currQtrs = [
      getNumericValue(ws, 'AD4'),
      getNumericValue(ws, 'AE4'),
      getNumericValue(ws, 'AF4'),
      getNumericValue(ws, 'AG4'),
    ];
    revenueDiff = currQtrs.map((c, i) => c - (prevRevenueTotals![i] || 0));
  }

  // Parse individual items starting from row 11
  const items: ForecastItem[] = [];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  for (let r = 10; r <= range.e.r; r++) { // row index 10 = Excel row 11
    const no = getNumericValue(ws, `B${r + 1}`);
    const customer = getCellValue(ws, `C${r + 1}`) as string;

    // Skip empty rows or section headers
    if (!customer || !no || no === 0) continue;

    const monthlyQty: number[] = [];
    const monthlyRev: number[] = [];

    for (const col of qtyCols) {
      monthlyQty.push(getNumericValue(ws, `${col}${r + 1}`));
    }
    for (const col of revCols) {
      monthlyRev.push(getNumericValue(ws, `${col}${r + 1}`));
    }

    const itemTotalQty = getNumericValue(ws, `X${r + 1}`);
    const itemTotalRev = getNumericValue(ws, `AO${r + 1}`);

    // Skip items with zero total (both qty and revenue)
    if (itemTotalQty === 0 && itemTotalRev === 0) continue;

    items.push({
      no,
      customer,
      model: (getCellValue(ws, `D${r + 1}`) as string) || '',
      stage: (getCellValue(ws, `E${r + 1}`) as string) || '',
      partNo: (getCellValue(ws, `F${r + 1}`) as string) || '',
      newPartNo: (getCellValue(ws, `G${r + 1}`) as string) || '',
      type: (getCellValue(ws, `H${r + 1}`) as string) || '',
      unitPrice: getNumericValue(ws, `I${r + 1}`),
      category: (getCellValue(ws, `J${r + 1}`) as string) || '',
      partName: (getCellValue(ws, `K${r + 1}`) as string) || '',
      monthlyQty,
      totalQty: itemTotalQty,
      monthlyRevenue: monthlyRev,
      totalRevenue: itemTotalRev,
    });
  }

  const summary: ForecastSummary = {
    reportDate,
    year: fullYear,
    revision,
    monthlyQtyTotals,
    monthlyRevenueTotals,
    totalQty,
    totalRevenue,
    prevRevenueTotals,
    revenueDiff,
  };

  const upload: Omit<ForecastUpload, 'id' | 'uploadDate'> = {
    fileName,
    reportDate,
    revision,
    year: fullYear,
    totalRevenue,
    totalQty,
    itemCount: items.length,
  };

  return { items, summary, upload };
}

// ============================================
// Helpers
// ============================================

function getCellValue(ws: XLSX.WorkSheet, addr: string): string | number | null {
  const cell = ws[addr];
  if (!cell) return null;
  return cell.v !== undefined ? cell.v : null;
}

function getNumericValue(ws: XLSX.WorkSheet, addr: string): number {
  const val = getCellValue(ws, addr);
  if (val === null || val === undefined || val === '') return 0;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}
