
export interface InventoryItem {
  id: string;
  type: 'warehouse' | 'material' | 'parts' | 'product';
  // Common Fields
  code: string;
  name: string;
  qty: number;
  
  // Specific Fields (Optional based on type)
  spec?: string;
  unit?: string;
  location?: string; // 창고명
  customerPN?: string; // 고객사 P/N
  model?: string; // 차종명
  status?: string; // 품목상태
  unitPrice?: number; // 단가
  amount?: number; // 금액
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

  // Remove BOM if exists
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = splitCSVLine(headerLine).map(h => h.trim());
  
  // Improved Helper to find column index
  // 1. Try to find EXACT match first
  // 2. If not found, try partial match
  const findCol = (keywords: string[]) => {
    // Exact match
    let idx = headers.findIndex(h => keywords.some(k => h === k));
    if (idx !== -1) return idx;
    
    // Partial match (fallback)
    return headers.findIndex(h => keywords.some(k => h.includes(k)));
  };

  const dataRows = lines.slice(1);

  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    if (cols.length < 2) return null;

    let item: InventoryItem = {
      id: `${type}-${index}-${Date.now()}`,
      type,
      code: '',
      name: '',
      qty: 0
    };

    if (type === 'warehouse') {
      // Mapping for Warehouse CSV: 품목유형,품목코드,고객사 P/N,품목명,규격,단위,차종명,품목상태,창고명,재고위치,재고
      const idxCode = findCol(['품목코드']);
      const idxName = findCol(['품목명']);
      const idxCustPN = findCol(['고객사 P/N', 'P/N']);
      const idxSpec = findCol(['규격']);
      const idxUnit = findCol(['단위']);
      const idxModel = findCol(['차종명']);
      const idxStatus = findCol(['품목상태']);
      const idxWh = findCol(['창고명']);
      
      // Crucial: prioritize exact match '재고' to avoid '재고위치'
      const idxQty = headers.indexOf('재고'); 
      const finalIdxQty = idxQty !== -1 ? idxQty : findCol(['수량', '재고']);

      item.code = idxCode > -1 ? cols[idxCode] : '';
      item.name = idxName > -1 ? cols[idxName] : '';
      item.customerPN = idxCustPN > -1 ? cols[idxCustPN] : '';
      item.spec = idxSpec > -1 ? cols[idxSpec] : '';
      item.unit = idxUnit > -1 ? cols[idxUnit] : '';
      item.model = idxModel > -1 ? cols[idxModel] : '';
      item.status = idxStatus > -1 ? cols[idxStatus] : '';
      item.location = idxWh > -1 ? cols[idxWh] : '';
      item.qty = finalIdxQty > -1 ? parseNumber(cols[finalIdxQty]) : 0;
      
    } else if (type === 'material') {
      // Mapping for Material CSV: 재질코드,재질명,단위,창고코드,창고명,현재고
      const idxCode = findCol(['재질코드']);
      const idxName = findCol(['재질명']);
      const idxUnit = findCol(['단위']);
      const idxWh = findCol(['창고명']);
      const idxQty = findCol(['현재고', '수량', '재고']);

      item.code = idxCode > -1 ? cols[idxCode] : '';
      item.name = idxName > -1 ? cols[idxName] : '';
      item.unit = idxUnit > -1 ? cols[idxUnit] : '';
      item.location = idxWh > -1 ? cols[idxWh] : '';
      item.qty = idxQty > -1 ? parseNumber(cols[idxQty]) : 0;

    } else {
      // Generic Mapping for Parts/Product (Fallback or standard)
      const idxCode = findCol(['코드', 'CODE', '품번']);
      const idxName = findCol(['품명', 'NAME', '품목명']);
      const idxSpec = findCol(['규격', 'SPEC']);
      const idxUnit = findCol(['단위', 'UNIT']);
      const idxQty = findCol(['수량', 'QTY', '재고']);
      const idxPrice = findCol(['단가', 'PRICE']);
      const idxAmount = findCol(['금액', 'AMOUNT']);
      const idxLocation = findCol(['창고', 'LOCATION']);

      item.code = idxCode > -1 ? cols[idxCode] : '';
      item.name = idxName > -1 ? cols[idxName] : '';
      item.spec = idxSpec > -1 ? cols[idxSpec] : '';
      item.unit = idxUnit > -1 ? cols[idxUnit] : '';
      item.location = idxLocation > -1 ? cols[idxLocation] : '';
      item.qty = idxQty > -1 ? parseNumber(cols[idxQty]) : 0;
      item.unitPrice = idxPrice > -1 ? parseNumber(cols[idxPrice]) : 0;
      item.amount = idxAmount > -1 ? parseNumber(cols[idxAmount]) : 0;
    }

    // Amount Calculation if missing but price exists
    if (!item.amount && item.unitPrice && item.qty) {
      item.amount = item.unitPrice * item.qty;
    }

    return item;
  }).filter(item => item !== null) as InventoryItem[];
};
