
export interface CRItem {
  month: string; // "1월"
  totalSales: number;
  lgSales: number;
  lgCR: number;
  lgDefense: number;
  mtxSales: number;
  mtxCR: number;
  mtxDefense: number;
}

const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const cleanValue = value.replace(/[",\s]/g, '');
  const num = parseFloat(cleanValue);
  return isNaN(num) ? 0 : num;
};

export const parseCRCSV = (csvContent: string): CRItem[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const dataRows = lines.slice(1);
  
  return dataRows.map(line => {
    const cols = line.split(','); // Simple split for this specific numeric CSV
    if (cols.length < 8) return {
        month: cols[0] || '',
        totalSales: 0, lgSales: 0, lgCR: 0, lgDefense: 0, mtxSales: 0, mtxCR: 0, mtxDefense: 0
    };

    return {
      month: cols[0],
      totalSales: parseNumber(cols[1]),
      lgSales: parseNumber(cols[2]),
      lgCR: parseNumber(cols[3]),
      lgDefense: parseNumber(cols[4]),
      mtxSales: parseNumber(cols[5]),
      mtxCR: parseNumber(cols[6]),
      mtxDefense: parseNumber(cols[7]),
    };
  });
};
