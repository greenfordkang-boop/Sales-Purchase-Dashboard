
export interface PurchaseItem {
  id: string;
  year: number;
  month: string; // '01월', '02월' ...
  date: string; // 'YYYY-MM-DD'
  supplier: string;
  type: string; // '부품', '원재료', '도장', '사출' etc.
  category: 'Parts' | 'Material'; // High level category for filtering
  itemCode: string;
  itemName: string;
  spec?: string;
  unit: string;
  qty: number;
  unitPrice: number;
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

// Helper to extract year and month from YYYY-MM-DD
const parseDateInfo = (dateStr: string) => {
  if (!dateStr) return { year: new Date().getFullYear(), month: '01월' };
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10) || new Date().getFullYear();
  const monthStr = parts[1] || '1';
  const month = `${parseInt(monthStr, 10).toString().padStart(2, '0')}월`;
  return { year, month };
};

// Parser for Parts CSV
// Columns: Index, 입고일자(1), 발주처(2), ..., 부품코드(5), ..., 부품명(7), 규격(8), 단위(9), 자재유형(10), ..., 입고수량(14), ..., 단가(19), 금액(20)
export const parsePartsCSV = (csvContent: string): PurchaseItem[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const dataRows = lines.slice(1);
  
  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    // Safety check for empty lines or bad rows
    if (cols.length < 15) return null;

    const dateStr = cols[1];
    const { year, month } = parseDateInfo(dateStr);

    return {
      id: `part-${index}-${Date.now()}`,
      year,
      month,
      date: dateStr,
      supplier: cols[2],
      type: cols[10] || '부품', // 자재유형 column
      category: 'Parts',
      itemCode: cols[5],
      itemName: cols[7],
      spec: cols[8],
      unit: cols[9],
      qty: parseNumber(cols[14]), // 입고수량
      unitPrice: parseNumber(cols[19]), // 단가
      amount: parseNumber(cols[20]) // 금액
    };
  }).filter(item => item !== null) as PurchaseItem[];
};

// Parser for Material CSV
// Columns: Index, 입고일자(1), 원재료종류(2), 발주처(3), 재질코드(4), 재질명(5), 단위(6), ..., 입고수량(8), ..., 단가(13), 금액(14)
export const parseMaterialCSV = (csvContent: string): PurchaseItem[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const dataRows = lines.slice(1);
  
  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    if (cols.length < 10) return null;

    const dateStr = cols[1];
    const { year, month } = parseDateInfo(dateStr);

    return {
      id: `mat-${index}-${Date.now()}`,
      year,
      month,
      date: dateStr,
      supplier: cols[3],
      type: cols[2], // 원재료종류 column
      category: 'Material',
      itemCode: cols[4],
      itemName: cols[5],
      spec: '', // Material CSV doesn't have spec column in the sample
      unit: cols[6],
      qty: parseNumber(cols[8]), // 입고수량
      unitPrice: parseNumber(cols[13]), // 단가
      amount: parseNumber(cols[14]) // 금액
    };
  }).filter(item => item !== null) as PurchaseItem[];
};
