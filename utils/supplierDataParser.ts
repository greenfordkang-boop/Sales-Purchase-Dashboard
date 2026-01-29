// 협력사 데이터 파서
// CSV 형식: 거래처명, 사업자등록번호, 대표이사, 주소, 매입액(-VAT) 2025년, 매입액(-VAT) 2024년, 매입액(-VAT) 2023년

export interface SupplierItem {
  id: string;
  companyName: string;        // 거래처명
  businessNumber: string;     // 사업자등록번호
  ceo: string;               // 대표이사
  address: string;           // 주소
  purchaseAmount2025: number; // 매입액(-VAT) 2025년
  purchaseAmount2024: number; // 매입액(-VAT) 2024년
  purchaseAmount2023: number; // 매입액(-VAT) 2023년
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

// Helper to parse number string (removes commas and spaces)
const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const cleanValue = value.replace(/[",\s]/g, '');
  const num = parseFloat(cleanValue);
  return isNaN(num) ? 0 : num;
};

export const parseSupplierCSV = (csvContent: string): SupplierItem[] => {
  const cleanText = csvContent.replace(/^\uFEFF/, '');
  const lines = cleanText.split('\n').filter(line => line.trim() !== '');
  
  console.log(`📊 협력사 CSV 파싱 시작: ${lines.length}줄`);
  
  if (lines.length < 2) {
    console.warn('협력사 CSV: 데이터가 없습니다 (최소 2줄 필요: 헤더 + 데이터)');
    return [];
  }

  // 첫 줄은 헤더로 간주
  const headerCols = splitCSVLine(lines[0]);
  console.log('📊 헤더 컬럼:', headerCols);
  
  // 헤더에서 컬럼 인덱스 찾기
  const findCol = (headers: string[], keywords: string[]): number => {
    const normalized = headers.map(h => h.replace(/\s/g, '').toLowerCase());
    for (const kw of keywords) {
      const k = kw.replace(/\s/g, '').toLowerCase();
      const idx = normalized.findIndex(h => h === k || h.includes(k) || k.includes(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colCompanyName = findCol(headerCols, ['거래처명', '회사명', 'company', '거래처']);
  const colBusinessNumber = findCol(headerCols, ['사업자등록번호', '사업자번호', 'business', '등록번호']);
  const colCEO = findCol(headerCols, ['대표이사', '대표', 'ceo', '대표자']);
  const colAddress = findCol(headerCols, ['주소', 'address', '소재지']);
  const col2025 = findCol(headerCols, ['2025', '2025년', '매입액2025']);
  const col2024 = findCol(headerCols, ['2024', '2024년', '매입액2024']);
  const col2023 = findCol(headerCols, ['2023', '2023년', '매입액2023']);

  // 위치 기반 매핑 (헤더를 찾지 못한 경우)
  const usePositional = colCompanyName < 0 && colBusinessNumber < 0;
  const col = usePositional ? {
    companyName: 0,
    businessNumber: 1,
    ceo: 2,
    address: 3,
    amount2025: 4,
    amount2024: 5,
    amount2023: 6,
  } : {
    companyName: colCompanyName >= 0 ? colCompanyName : 0,
    businessNumber: colBusinessNumber >= 0 ? colBusinessNumber : 1,
    ceo: colCEO >= 0 ? colCEO : 2,
    address: colAddress >= 0 ? colAddress : 3,
    amount2025: col2025 >= 0 ? col2025 : 4,
    amount2024: col2024 >= 0 ? col2024 : 5,
    amount2023: col2023 >= 0 ? col2023 : 6,
  };

  console.log('📊 컬럼 매핑:', col);

  const dataRows = lines.slice(1);
  console.log(`📊 데이터 행 수: ${dataRows.length}`);

  const result = dataRows
    .map((line, index) => {
      const cols = splitCSVLine(line);
      if (cols.length < 4) {
        console.warn(`📊 행 ${index + 2} 건너뜀: 컬럼 수 부족 (${cols.length})`);
        return null;
      }

      const companyName = (cols[col.companyName] || '').trim();
      if (!companyName) {
        return null; // 거래처명이 없으면 제외
      }

      const item: SupplierItem = {
        id: `supplier-${Date.now()}-${index}`,
        companyName,
        businessNumber: (cols[col.businessNumber] || '').trim(),
        ceo: (cols[col.ceo] || '').trim(),
        address: (cols[col.address] || '').trim(),
        purchaseAmount2025: parseNumber(cols[col.amount2025]),
        purchaseAmount2024: parseNumber(cols[col.amount2024]),
        purchaseAmount2023: parseNumber(cols[col.amount2023]),
      };

      return item;
    })
    .filter((row): row is SupplierItem => row !== null);

  console.log(`✅ 협력사 파싱 완료: ${result.length}건 (총 ${dataRows.length}행 중)`);
  
  if (result.length === 0 && dataRows.length > 0) {
    console.error('📊 파싱된 데이터가 없습니다. CSV 형식을 확인하세요.');
    console.error('📊 예상 형식: 거래처명, 사업자등록번호, 대표이사, 주소, 매입액(-VAT) 2025년, 매입액(-VAT) 2024년, 매입액(-VAT) 2023년');
  }

  return result;
};
