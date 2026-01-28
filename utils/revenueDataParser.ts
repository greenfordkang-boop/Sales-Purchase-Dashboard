
export interface RevenueItem {
  id: number;
  year: number; // Added year field
  month: string;
  customer: string;
  model: string;
  // 품목별 매출현황을 위한 추가 필드 (옵션)
  partNo?: string;
  customerPN?: string;
  partName?: string;
  qty: number;
  amount: number;
}

// Helper to split CSV line handling quoted commas
const splitCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

// Helper to parse number string
const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const cleanValue = value.replace(/[",\s]/g, '');
  const num = parseFloat(cleanValue);
  return isNaN(num) ? 0 : num;
};

// 헤더에서 컬럼 인덱스 찾기 (공백/대소문자 무시)
const findCol = (headers: string[], keywords: string[]): number => {
  const normalized = headers.map(h => h.replace(/\s/g, '').toLowerCase());
  for (const kw of keywords) {
    const k = kw.replace(/\s/g, '').toLowerCase();
    const idx = normalized.findIndex(h => h === k || h.includes(k) || k.includes(h));
    if (idx !== -1) return idx;
  }
  return -1;
};

// Helper to normalize month string (e.g., "1" -> "01월", "01" -> "01월", "1월" -> "01월")
const normalizeMonth = (value: string): string => {
  if (!value) return '00월';
  // Remove existing '월' and whitespace
  const cleanValue = value.replace(/월/g, '').trim();
  const num = parseInt(cleanValue, 10);
  
  if (isNaN(num) || num < 1 || num > 12) return value; // Return original if not a valid month number
  
  // Pad with 0 and append '월'
  return `${num.toString().padStart(2, '0')}월`;
};

export const parseRevenueCSV = (csvContent: string, year: number): RevenueItem[] => {
  const cleanText = csvContent.replace(/^\uFEFF/, '');
  const lines = cleanText.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headerValues = splitCSVLine(headerLine);

  // 새 업로더 형식 예시:
  // [빈칸], 매출기간, 고객사, model, 품번, 고객사p/n, 품명, 매출수량, 매출금액
  const headerString = headerValues.join(',');
  const hasKnownHeader =
    /매출기간|고객사|매출수량|매출금액/i.test(headerString);

  let dataStartIndex = hasKnownHeader ? 1 : 0;

  let colMonth: number;
  let colCustomer: number;
  let colModel: number;
  let colPartNo: number;
  let colCustomerPN: number;
  let colPartName: number;
  let colQty: number;
  let colAmount: number;

  if (hasKnownHeader) {
    const h = headerValues;

    const idxMonth = findCol(h, ['매출기간', '기간', '월', 'Month']);
    const idxCustomer = findCol(h, ['고객사', 'Customer']);
    const idxModel = findCol(h, ['model', '모델', '품종', 'Model']);
    const idxPartNo = findCol(h, ['품번', 'PartNo', 'Part No']);
    const idxCustomerPN = findCol(h, ['고객사p/n', '고객사 P/N', 'P/N']);
    const idxPartName = findCol(h, ['품명', '품목명', 'ItemName']);
    const idxQty = findCol(h, ['매출수량', '수량', 'Qty', 'QTY']);
    const idxAmount = findCol(h, ['매출금액', '금액', 'Amount']);

    // 기본 위치 (업로더 규격): [index], 1:기간, 2:고객사, 3:model, 4:품번, 5:고객사p/n, 6:품명, 7:수량, 8:금액
    colMonth = idxMonth >= 0 ? idxMonth : 1;
    colCustomer = idxCustomer >= 0 ? idxCustomer : 2;
    colModel = idxModel >= 0 ? idxModel : 3;
    colPartNo = idxPartNo >= 0 ? idxPartNo : 4;
    colCustomerPN = idxCustomerPN >= 0 ? idxCustomerPN : 5;
    colPartName = idxPartName >= 0 ? idxPartName : 6;
    colQty = idxQty >= 0 ? idxQty : 7;
    colAmount = idxAmount >= 0 ? idxAmount : 8;
  } else {
    // 구(舊) 포맷 호환: Index, Month, Customer, Model, Qty, Amount
    colMonth = 1;
    colCustomer = 2;
    colModel = 3;
    colPartNo = -1;
    colCustomerPN = -1;
    colPartName = -1;
    colQty = 4;
    colAmount = 5;
  }

  const dataRows = lines.slice(dataStartIndex);

  return dataRows
    .map((line, index) => {
      const cols = splitCSVLine(line);
      if (cols.length === 0) return null;

      const monthRaw = cols[colMonth] || '';
      const customer = cols[colCustomer] || 'Unknown';
      const model = cols[colModel] || '';
      const partNo = colPartNo >= 0 ? (cols[colPartNo] || '') : '';
      const customerPN = colCustomerPN >= 0 ? (cols[colCustomerPN] || '') : '';
      const partName = colPartName >= 0 ? (cols[colPartName] || '') : '';
      const qty = parseNumber(cols[colQty]);
      const amount = parseNumber(cols[colAmount]);

      return {
        id: Date.now() + index + year * 10000,
        year,
        month: normalizeMonth(monthRaw),
        customer,
        model,
        partNo: partNo || undefined,
        customerPN: customerPN || undefined,
        partName: partName || undefined,
        qty,
        amount,
      } as RevenueItem;
    })
    .filter((item): item is RevenueItem => item !== null);
};
