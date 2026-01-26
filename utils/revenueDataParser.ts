
export interface RevenueItem {
  id: number;
  year: number; // Added year field
  month: string;
  customer: string;
  model: string;
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
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  // Skip header row
  const dataRows = lines.slice(1);
  
  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    // CSV Structure: Index, Month, Customer, Model, Qty, Amount
    // Example: 1, 01, 한빛티앤아이, JX_FL, 800, "2,482,192"
    
    return {
      id: Date.now() + index + (year * 10000), // Ensure unique ID across years
      year: year,
      month: normalizeMonth(cols[1]), // Normalize month format
      customer: cols[2] || 'Unknown',
      model: cols[3] || '',
      qty: parseNumber(cols[4]),
      amount: parseNumber(cols[5])
    };
  });
};
