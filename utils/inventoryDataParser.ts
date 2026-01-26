
export interface InventoryItem {
  id: string;
  type: 'warehouse' | 'material' | 'parts' | 'product';
  code: string;
  name: string;
  spec?: string;
  unit?: string;
  location?: string; // 창고명
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

export const parseInventoryCSV = (csvContent: string, type: 'warehouse' | 'material' | 'parts' | 'product'): InventoryItem[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  
  // Basic Header Mapping Strategy
  const findColIndex = (keywords: string[]) => {
    return headers.findIndex(h => keywords.some(k => h.includes(k)));
  };

  const idxCode = findColIndex(['코드', 'CODE', '품번']);
  const idxName = findColIndex(['품명', 'NAME', '품목명', '자재명']);
  const idxSpec = findColIndex(['규격', 'SPEC']);
  const idxUnit = findColIndex(['단위', 'UNIT']);
  const idxQty = findColIndex(['수량', 'QTY', '재고']);
  const idxPrice = findColIndex(['단가', 'PRICE']);
  const idxAmount = findColIndex(['금액', 'AMOUNT']);
  const idxLocation = findColIndex(['창고', 'LOCATION']);

  const dataRows = lines.slice(1);

  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    if (cols.length < 2) return null;

    return {
      id: `${type}-${index}-${Date.now()}`,
      type,
      code: idxCode > -1 ? cols[idxCode] : '',
      name: idxName > -1 ? cols[idxName] : 'Unknown',
      spec: idxSpec > -1 ? cols[idxSpec] : '',
      unit: idxUnit > -1 ? cols[idxUnit] : '',
      location: idxLocation > -1 ? cols[idxLocation] : (type === 'warehouse' ? cols[0] : ''), // Fallback for warehouse file if header is simple
      qty: idxQty > -1 ? parseNumber(cols[idxQty]) : 0,
      unitPrice: idxPrice > -1 ? parseNumber(cols[idxPrice]) : 0,
      amount: idxAmount > -1 ? parseNumber(cols[idxAmount]) : 0,
    };
  }).filter(item => item !== null) as InventoryItem[];
};
