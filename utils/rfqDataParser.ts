
export interface RFQItem {
  id: string;
  index: string;
  customer: string;
  projectType: string;
  projectName: string;
  process: string;
  status: string;
  dateSelection: string;
  dateQuotation: string;
  datePO: string;
  model: string;
  qty: number;
  unitPrice: number;
  amount: number;
  remark: string;
}

// Helper to parse number string with currency symbols and commas
const parseCurrency = (value: string | undefined): number => {
  if (!value) return 0;
  // Remove ₩, commas, spaces, newlines
  const cleanValue = value.replace(/[₩, \n\r"]/g, '');
  const num = parseFloat(cleanValue);
  return isNaN(num) ? 0 : num;
};

// Robust CSV Line Splitter that handles quoted fields with commas and newlines
export const parseRFQCSV = (csvContent: string): RFQItem[] => {
  const items: RFQItem[] = [];
  
  // Normalize line endings
  let content = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split into lines, but respecting quotes is hard with simple split.
  // We'll process character by character to handle multi-line cells.
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentCell += '"';
        i++;
      } else {
        // Toggle quote status
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Cell separator
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (char === '\n' && !inQuotes) {
      // Row separator
      currentRow.push(currentCell.trim());
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  // Push last row if exists
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  // Skip header (Assuming first row is header)
  const dataRows = rows.slice(1);

  dataRows.forEach((cols, idx) => {
    // Expected Columns based on CSV:
    // 0: 순번, 1: Customer, 2: Project Type, 3: Project Name, 4: Process, 5: Status, 
    // 6: Selection Date, 7: Quote Date, 8: PO Date, 9: Model, 10: Qty, 11: Unit Price, 12: Amount, 13: Remark
    
    if (cols.length < 5) return; // Skip empty or malformed rows

    // Generate a strong unique ID to ensure delete works correctly
    const uniqueId = `rfq-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    items.push({
      id: uniqueId,
      index: cols[0],
      customer: cols[1],
      projectType: cols[2],
      projectName: cols[3],
      process: cols[4],
      status: cols[5],
      dateSelection: cols[6],
      dateQuotation: cols[7],
      datePO: cols[8],
      model: cols[9],
      qty: parseCurrency(cols[10]),
      unitPrice: parseCurrency(cols[11]),
      amount: parseCurrency(cols[12]),
      remark: cols[13] || ''
    });
  });

  return items;
};
