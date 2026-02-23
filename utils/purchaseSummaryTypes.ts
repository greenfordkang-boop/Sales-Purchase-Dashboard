
export interface PurchaseItemMaster {
  id?: string;
  partNo: string;         // 도번
  costType: string;       // 재료비구분
  purchaseType: string;   // 구입구분
  materialType: string;   // 재료구분
  process: string;        // 공정
  customer: string;       // 고객사
}

export interface PurchaseMonthlySummary {
  id?: string;
  year: number;
  month: string;          // 1월, 2월 ...
  supplier: string;       // 매입처
  partNo: string;         // 도번
  partName: string;       // 품명
  spec: string;           // 규격
  unit: string;           // 단위
  salesQty: number;       // 매출수량
  closingQty: number;     // 마감수량
  unitPrice: number;      // 단가
  amount: number;         // 금액
  location: string;       // 사용처
  costType: string;       // 재료비구분
  purchaseType: string;   // 구입구분
  materialType: string;   // 재료구분
  process: string;        // 공정
  customer: string;       // 고객사
  remark: string;         // 비고
  closingMonth: string;   // 마감월
}

// CSV 파서 헬퍼: 콤마 포함 셀 처리
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

const parseNum = (v: string | undefined): number => {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[",\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

/**
 * 매입종합집계 CSV 파서
 * 컬럼: 구분(월),매입처,도번,품명,규격,단위,매출수량,마감수량,단가,금액,사용처,재료비구분,구입구분,재료구분,공정,고객사,비고
 */
export const parsePurchaseSummaryCSV = (
  csvContent: string,
  year: number,
  masterMap?: Map<string, PurchaseItemMaster>
): PurchaseMonthlySummary[] => {
  const lines = csvContent.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const dataRows = lines.slice(1);
  return dataRows.map(line => {
    const c = splitCSVLine(line);
    if (c.length < 10) return null;

    const partNo = c[2] || '';
    const master = masterMap?.get(partNo);

    return {
      year,
      month: c[0] || '',
      supplier: c[1] || '',
      partNo,
      partName: c[3] || '',
      spec: c[4] || '',
      unit: c[5] || '',
      salesQty: parseNum(c[6]),
      closingQty: parseNum(c[7]),
      unitPrice: parseNum(c[8]),
      amount: parseNum(c[9]),
      location: c[10] || master?.costType || '',
      costType: c[11] || master?.costType || '',
      purchaseType: c[12] || master?.purchaseType || '',
      materialType: c[13] || master?.materialType || '',
      process: c[14] || master?.process || '',
      customer: c[15] || master?.customer || '',
      remark: c[16] || '',
      closingMonth: c[17] || '',
    };
  }).filter(Boolean) as PurchaseMonthlySummary[];
};
