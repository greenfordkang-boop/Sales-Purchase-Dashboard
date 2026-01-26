
export interface MonthlyStats {
  month: string;
  plan: number;
  actual: number;
  rate: number;
}

export interface SalesItem {
  id: string;
  customer: string;
  model: string;
  partNo: string;
  partName: string;
  totalPlan: number;
  totalActual: number;
  rate: number;
}

export interface CustomerSalesData {
  customer: string;
  monthlyData: MonthlyStats[];
  totalPlan: number;
  totalActual: number;
  items: SalesItem[];
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

export const parseSalesCSV = (csvContent: string): CustomerSalesData[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 3) return [];

  // Data starts from index 2
  const dataRows = lines.slice(2);
  
  const customerMap = new Map<string, CustomerSalesData>();

  dataRows.forEach((line, index) => {
    const cols = splitCSVLine(line);
    const customerName = cols[1];
    if (!customerName) return;

    if (!customerMap.has(customerName)) {
      customerMap.set(customerName, {
        customer: customerName,
        monthlyData: Array.from({ length: 12 }, (_, i) => ({
          month: `${i + 1}월`,
          plan: 0,
          actual: 0,
          rate: 0
        })),
        totalPlan: 0,
        totalActual: 0,
        items: []
      });
    }

    const customerData = customerMap.get(customerName)!;

    // Aggregate monthly data
    let rowTotalPlan = 0;
    let rowTotalActual = 0;

    for (let m = 0; m < 12; m++) {
      const planIdx = 7 + (m * 3);
      const actualIdx = 8 + (m * 3);
      
      const plan = parseNumber(cols[planIdx]);
      const actual = parseNumber(cols[actualIdx]);

      customerData.monthlyData[m].plan += plan;
      customerData.monthlyData[m].actual += actual;
      customerData.totalPlan += plan;
      customerData.totalActual += actual;

      rowTotalPlan += plan;
      rowTotalActual += actual;
    }

    // Add item detail
    // Cols: 2=Model, 3=PartNo, 5=PartName
    // Total Plan and Actual can also be read from columns 43, 44 if available, 
    // but calculating from months ensures consistency.
    customerData.items.push({
      id: `item-${index}`,
      customer: customerName,
      model: cols[2],
      partNo: cols[3],
      partName: cols[5],
      totalPlan: rowTotalPlan,
      totalActual: rowTotalActual,
      rate: rowTotalPlan > 0 ? (rowTotalActual / rowTotalPlan) * 100 : 0
    });
  });

  // Calculate rates for aggregated data
  return Array.from(customerMap.values()).map(data => {
    data.monthlyData.forEach(m => {
      m.rate = m.plan > 0 ? (m.actual / m.plan) * 100 : 0;
    });
    return data;
  });
};
