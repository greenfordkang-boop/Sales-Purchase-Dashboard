export interface RevenueItem {
  id: number;
  year: number;      // 고객사별 매출현황에서 사용
  month: string;     // "01월" 형식
  customer: string;
  model: string;
  qty: number;
  amount: number;
}

// 품목별 매출 업로더용 타입
export interface ItemRevenueRow {
  id: number;
  period: string;     // 매출기간 (원본 문자열)
  customer: string;   // 고객사
  model: string;      // 품종 / Model
  partNo: string;     // 품번
  customerPN: string; // 고객사 P/N
  partName: string;   // 품명
  qty: number;        // 매출수량
  amount: number;     // 매출금액
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
  const cleanValue = value.replace(/월/g, '').trim();
  const num = parseInt(cleanValue, 10);
  if (isNaN(num) || num < 1 || num > 12) return value;
  return `${num.toString().padStart(2, '0')}월`;
};

// 기존 고객사별 매출현황 CSV 파서
// CSV: Index, Month, Customer, Model, Qty, Amount
export const parseRevenueCSV = (csvContent: string, year: number): RevenueItem[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  // 첫 줄은 헤더라고 가정
  const dataRows = lines.slice(1);

  return dataRows.map((line, index) => {
    const cols = splitCSVLine(line);
    return {
      id: Date.now() + index + year * 10000,
      year,
      month: normalizeMonth(cols[1] || ''),
      customer: cols[2] || 'Unknown',
      model: cols[3] || '',
      qty: parseNumber(cols[4]),
      amount: parseNumber(cols[5])
    };
  });
};

// 품목별 매출 업로더용 CSV 파서
// 업로더: (첫 열 이름 없음), 매출기간, 고객사, model, 품번, 고객사p/n, 품명, 매출수량, 매출금액
export const parseItemRevenueCSV = (csvContent: string): ItemRevenueRow[] => {
  const cleanText = csvContent.replace(/^\uFEFF/, '');
  const lines = cleanText.split('\n').filter(line => line.trim() !== '');
  
  console.log(`📊 품목별 매출 CSV 파싱 시작: ${lines.length}줄`);
  
  if (lines.length < 2) {
    console.warn('품목별 매출 CSV: 데이터가 없습니다 (최소 2줄 필요: 헤더 + 데이터)');
    return [];
  }

  const headerCols = splitCSVLine(lines[0]);
  console.log('📊 헤더 컬럼:', headerCols);
  console.log('📊 헤더 컬럼 수:', headerCols.length);
  
  // 첫 열이 비어있는지 확인 (헤더 또는 첫 데이터 행 기준)
  let offset = 0;
  if (headerCols.length > 0 && headerCols[0]?.trim() === '') {
    offset = 1;
    console.log('📊 첫 열이 비어있음 - offset = 1');
  } else if (lines.length > 1) {
    // 첫 데이터 행 확인
    const firstDataCols = splitCSVLine(lines[1]);
    if (firstDataCols.length > 0 && firstDataCols[0]?.trim() === '') {
      offset = 1;
      console.log('📊 첫 데이터 행의 첫 열이 비어있음 - offset = 1');
    }
  }

  const dataRows = lines.slice(1);
  console.log(`📊 데이터 행 수: ${dataRows.length}`);

  const result = dataRows
    .map((line, index) => {
      const cols = splitCSVLine(line);
      const requiredCols = offset + 8; // offset + 8개 컬럼 필요
      
      if (cols.length < requiredCols) {
        console.warn(`📊 행 ${index + 2} 건너뜀: 컬럼 수 부족 (${cols.length} < ${requiredCols})`, cols);
        return null;
      }

      const base = offset;
      const row = {
        id: Date.now() + index,
        period: cols[base] || '',
        customer: cols[base + 1] || '',
        model: cols[base + 2] || '',
        partNo: cols[base + 3] || '',
        customerPN: cols[base + 4] || '',
        partName: cols[base + 5] || '',
        qty: parseNumber(cols[base + 6]),
        amount: parseNumber(cols[base + 7]),
      };

      // 빈 행 체크 (모든 필드가 비어있으면 제외)
      if (!row.period && !row.customer && !row.model && !row.partNo && row.qty === 0 && row.amount === 0) {
        return null;
      }

      return row;
    })
    .filter((row): row is ItemRevenueRow => row !== null);

  console.log(`✅ 품목별 매출 파싱 완료: ${result.length}건 (총 ${dataRows.length}행 중)`);
  
  if (result.length === 0 && dataRows.length > 0) {
    console.error('📊 파싱된 데이터가 없습니다. CSV 형식을 확인하세요.');
    console.error('📊 예상 형식: (첫 열 비움), 매출기간, 고객사, model, 품번, 고객사p/n, 품명, 매출수량, 매출금액');
  }

  return result;
};

