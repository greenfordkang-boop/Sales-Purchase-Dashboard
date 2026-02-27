
import * as XLSX from 'xlsx';

// ============================================================
// Types
// ============================================================

/** 표준재료비 현황 시트 - 종합 요약 */
export interface StandardMaterialSummary {
  year: number;
  month: string; // '01월', '02월' ...

  // 매출
  abcSales: number;        // ABC 매출액
  reportedSales: number;   // 영업 매출액(보고)

  // 표준
  standardTotal: number;   // 표준재료비 합계
  standardResin: number;
  standardPaint: number;
  standardPurchase: number; // 구매
  standardOutsource: number; // 외주

  // 비율
  standardRatio: number;       // 표준재료비율
  resinRatio: number;
  paintRatio: number;
  purchaseRatio: number;
  outsourceRatio: number;

  // 실적
  actualTotal: number;
  actualResin: number;
  actualPaint: number;
  actualPurchase: number;
  actualOutsource: number;

  // 실적 비율
  actualRatio: number;
  actualResinRatio: number;
  actualPaintRatio: number;
  actualPurchaseRatio: number;
  actualOutsourceRatio: number;

  // 재고
  productInventory: number;  // 제품 재고금액
  partsInventory: number;    // 부품 재고금액
  inventoryRatio: number;    // 매출 대비 재고율

  // 목표
  targetTotalRatio: number;     // 전체 목표 (49.1%)
  targetPurchaseRatio: number;  // 구매팀 목표 (26.5%)
}

/** 품목별재료비 - 개별 품목 */
export interface StandardMaterialItem {
  id: string;
  itemCode: string;        // 품목코드
  customerPn: string;      // 고객사 P/N
  itemName: string;        // 품목명
  customer: string;        // 고객사
  model: string;           // 품종
  itemType: string;        // 품목구분 (제품/부품)
  processType: string;     // 품목유형 (사출/도장/조립)
  supplyType: string;      // 조달구분 (자작/외주)
  productionLossRate: number; // 생산 Loss율
  purchaseCompany: string; // 구매업체
  injectionPrice: number;  // 사출판매가
  materialCost: number;    // 재료비
  purchasePrice: number;   // 구매단가

  // 사출 재료비
  injectionCost: number;   // 사출 재료비 합계
  resin1Spec: string;
  resin1Cost: number;
  resin2Spec: string;
  resin2Cost: number;

  // 도장 재료비
  paintCost: number;       // 도장 재료비 합계
  paint1Spec: string;
  paint1Cost: number;
  paint2Spec: string;
  paint2Cost: number;
  paint3Spec: string;
  paint3Cost: number;

  // 월별 생산량 (1-12)
  monthlyProduction: number[];
  totalProduction: number;

  // 월별 매입금액 (1-12)
  monthlyAmount: number[];
  totalAmount: number;
}

/** ABC 매출 품목 */
export interface AbcSalesItem {
  id: string;
  itemCode: string;
  no: number;
  customer: string;     // 거래선
  model: string;        // 차종
  stage: string;        // 단계
  partNumber: string;   // P.N
  newPartNumber: string;
  unitPrice: number;    // 단가
  category: string;     // 구분
  partName: string;     // 부품명
  monthlyPlan: number[];   // 1-12월 계획
  totalPlan: number;
  monthlySales: number[];  // 1-12월 매출액
  totalSales: number;
}

/** 품목정보 시트 - 물리 스펙 */
export interface ProductInfoItem {
  itemCode: string;        // 품목코드
  customerPn: string;      // 고객사 P/N
  itemName: string;        // 품목명
  itemType: string;        // 품목구분
  processType: string;     // 품목유형 (사출/도장/조립)
  supplyType: string;      // 조달구분 (자작/외주)
  netWeight: number;       // NET중량 (g)
  runnerWeight: number;    // Runner중량 (g)
  cavity: number;          // Cavity
  paintQty1: number;       // 1도 Paint량 (g)
  paintQty2: number;       // 2도 Paint량 (g)
  paintQty3: number;       // 3도 Paint량 (g)
  rawMaterialCode1: string; // 원재료코드1 (사출)
  rawMaterialCode2: string; // 원재료코드2 (사출)
  rawMaterialCode3: string; // 원재료코드3 (도장1도)
  rawMaterialCode4: string; // 원재료코드4 (도장2도)
  lossRate: number;        // Loss율 (%)
}

/** 재질단가 시트 - 원재료 kg당 표준단가 */
export interface MaterialPrice {
  materialCode: string;    // 재질코드
  materialName: string;    // 재질명
  materialType: string;    // 구분 (RESIN/PAINT)
  currentPrice: number;    // 현재단가 (원/kg)
  previousPrice: number;   // 전월단가
}

/** 구매단가 시트 - 부품별 현재단가 */
export interface PurchasePrice {
  itemCode: string;        // 품목코드
  customerPn: string;      // 고객사 P/N
  itemName: string;        // 품목명
  supplier: string;        // 협력업체
  currentPrice: number;    // 현재단가 (원)
  previousPrice: number;   // 전월단가
}

/** 외주사출 판매가 시트 */
export interface OutsourcePrice {
  itemCode: string;        // 품목코드
  customerPn: string;      // 고객사 P/N
  itemName: string;        // 품목명
  supplier: string;        // 협력업체
  injectionPrice: number;  // 사출판매가 (원)
}

/** 도료배합비율 시트 */
export interface PaintMixRatio {
  paintCode: string;       // 도료코드
  paintName: string;       // 도료명
  mainRatio: number;       // 주제 비율 (%)
  hardenerRatio: number;   // 경화제 비율 (%)
  thinnerRatio: number;    // 신너 비율 (%)
  mainCode: string;        // 주제 코드
  hardenerCode: string;    // 경화제 코드
  thinnerCode: string;     // 신너 코드
  mainPrice: number;       // 주제 단가 (원/kg)
  hardenerPrice: number;   // 경화제 단가 (원/kg)
  thinnerPrice: number;    // 신너 단가 (원/kg)
}

/** 파싱된 전체 결과 */
export interface StandardMaterialData {
  summary: StandardMaterialSummary;
  items: StandardMaterialItem[];
  abcSales: AbcSalesItem[];
  year: number;
  month: string;
  uploadDate: string;
  // 참조 데이터 (재료비.xlsx 추가 시트)
  productInfo?: ProductInfoItem[];
  materialPrices?: MaterialPrice[];
  purchasePrices?: PurchasePrice[];
  outsourcePrices?: OutsourcePrice[];
  paintMixRatios?: PaintMixRatio[];
}

// ============================================================
// Parser helpers
// ============================================================

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).trim();
};

// ============================================================
// Sheet parsers
// ============================================================

/** 표준재료비 현황 시트 파싱 */
function parseSummarySheet(ws: XLSX.WorkSheet): Omit<StandardMaterialSummary, 'year' | 'month'> {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Row indices (0-based from the sheet data)
  // Row 2: headers (구분, '', 1월~12월, 합계)
  // Row 3: ABC 매출액
  // Row 4: 영업 매출액
  // Row 6: 표준재료비
  // Row 7-10: RESIN, PAINT, 구매, 외주
  // Row 11-15: 비율들
  // Row 17: 실적재료비
  // Row 18-21: 실적 RESIN, PAINT, 구매, 외주
  // Row 22-26: 실적 비율들
  // Row 28-30: 재고

  // 1월 데이터는 col index 2 (C열)
  const col = 2; // 1월 column

  // 목표치 파싱
  let targetTotalRatio = 0.491;
  let targetPurchaseRatio = 0.265;
  const targetStr1 = str(data[11]?.[3]);
  const targetStr2 = str(data[12]?.[3]);
  const m1 = targetStr1.match(/([\d.]+)%/);
  const m2 = targetStr2.match(/([\d.]+)%/);
  if (m1) targetTotalRatio = parseFloat(m1[1]) / 100;
  if (m2) targetPurchaseRatio = parseFloat(m2[1]) / 100;

  return {
    abcSales: num(data[3]?.[col]),
    reportedSales: num(data[4]?.[col]),

    standardTotal: num(data[6]?.[col]),
    standardResin: num(data[7]?.[col]),
    standardPaint: num(data[8]?.[col]),
    standardPurchase: num(data[9]?.[col]),
    standardOutsource: num(data[10]?.[col]),

    standardRatio: num(data[11]?.[col]),
    resinRatio: num(data[12]?.[col]),
    paintRatio: num(data[13]?.[col]),
    purchaseRatio: num(data[14]?.[col]),
    outsourceRatio: num(data[15]?.[col]),

    actualTotal: num(data[17]?.[col]),
    actualResin: num(data[18]?.[col]),
    actualPaint: num(data[19]?.[col]),
    actualPurchase: num(data[20]?.[col]),
    actualOutsource: num(data[21]?.[col]),

    actualRatio: num(data[22]?.[col]),
    actualResinRatio: num(data[23]?.[col]),
    actualPaintRatio: num(data[24]?.[col]),
    actualPurchaseRatio: num(data[25]?.[col]),
    actualOutsourceRatio: num(data[26]?.[col]),

    productInventory: num(data[28]?.[col]),
    partsInventory: num(data[29]?.[col]),
    inventoryRatio: num(data[30]?.[col]),

    targetTotalRatio,
    targetPurchaseRatio,
  };
}

/** 품목별재료비 시트 파싱 */
function parseItemsSheet(ws: XLSX.WorkSheet): StandardMaterialItem[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: StandardMaterialItem[] = [];

  // Header is row 4 (0-indexed), data starts at row 5
  for (let i = 5; i < data.length; i++) {
    const row = data[i];
    const itemCode = str(row[3]);
    if (!itemCode) continue;

    const monthlyProduction: number[] = [];
    const monthlyAmount: number[] = [];
    for (let m = 0; m < 12; m++) {
      monthlyProduction.push(num(row[68 + m]));
      monthlyAmount.push(num(row[81 + m]));
    }

    items.push({
      id: `smi-${i}-${Date.now()}`,
      itemCode,
      customerPn: str(row[4]),
      itemName: str(row[5]),
      customer: str(row[6]),
      model: str(row[7]),
      itemType: str(row[8]),
      processType: str(row[9]),
      supplyType: str(row[10]),
      productionLossRate: num(row[11]),
      purchaseCompany: str(row[12]),
      injectionPrice: num(row[13]),
      materialCost: num(row[15]),
      purchasePrice: num(row[16]),

      injectionCost: num(row[32]),
      resin1Spec: str(row[18]),
      resin1Cost: num(row[24]),
      resin2Spec: str(row[25]),
      resin2Cost: num(row[31]),

      paintCost: num(row[67]),
      paint1Spec: str(row[37]),
      paint1Cost: num(row[46]),
      paint2Spec: str(row[47]),
      paint2Cost: num(row[56]),
      paint3Spec: str(row[57]),
      paint3Cost: num(row[66]),

      monthlyProduction,
      totalProduction: num(row[80]),
      monthlyAmount,
      totalAmount: num(row[93]),
    });
  }

  return items;
}

/** ABC 매출 시트 파싱 */
function parseAbcSalesSheet(ws: XLSX.WorkSheet): AbcSalesItem[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: AbcSalesItem[] = [];

  // Header row 2 (0-indexed), data starts at row 3
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const itemCode = str(row[0]);
    if (!itemCode) continue;

    const monthlyPlan: number[] = [];
    const monthlySales: number[] = [];
    for (let m = 0; m < 12; m++) {
      monthlyPlan.push(num(row[11 + m]));
      monthlySales.push(num(row[24 + m]));
    }

    items.push({
      id: `abc-${i}-${Date.now()}`,
      itemCode,
      no: num(row[1]),
      customer: str(row[2]),
      model: str(row[3]),
      stage: str(row[4]),
      partNumber: str(row[5]),
      newPartNumber: str(row[6]),
      unitPrice: num(row[8]),
      category: str(row[9]),
      partName: str(row[10]),
      monthlyPlan,
      totalPlan: num(row[23]),
      monthlySales,
      totalSales: num(row[36]),
    });
  }

  return items;
}

// ============================================================
// Reference sheet parsers (재료비.xlsx 추가 시트)
// ============================================================

/** 헤더 행 + 컬럼 맵 찾기 공통 함수 */
function findHeaderAndColMap(data: unknown[][], ...searchTerms: string[]): { headerRow: number; colMap: Record<string, number> } {
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i] as unknown[];
    for (let j = 0; j < (row?.length || 0); j++) {
      const cell = str(row[j]);
      if (searchTerms.some(t => cell.includes(t))) {
        const colMap: Record<string, number> = {};
        for (let k = 0; k < row.length; k++) {
          const h = str(row[k]);
          if (h) colMap[h] = k;
        }
        return { headerRow: i, colMap };
      }
    }
  }
  return { headerRow: -1, colMap: {} };
}

/** 컬럼 인덱스 찾기 (부분 매칭) */
function findCol(colMap: Record<string, number>, ...names: string[]): number {
  for (const n of names) {
    for (const [key, idx] of Object.entries(colMap)) {
      if (key.includes(n)) return idx;
    }
  }
  return -1;
}

/** 품목정보 시트 파싱
 * 실제 구조: 품목코드, 고객사 P/N, 품목명, ..., 원재료코드1~4(col28-31),
 *            NET중량1(col32), Runner중량1(col33), ...,
 *            1도 표준 Paint량(col36), 2도(37), 3도(38), 4도(39),
 *            금형Cavity(col41), ...
 */
function parseProductInfoSheet(ws: XLSX.WorkSheet): ProductInfoItem[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: ProductInfoItem[] = [];

  const { headerRow, colMap } = findHeaderAndColMap(data, '품목코드');
  if (headerRow < 0) return items;

  const cItemCode = findCol(colMap, '품목코드');
  const cCustPn = findCol(colMap, '고객사 P/N', '고객사');
  const cName = findCol(colMap, '품목명');
  const cItemType = findCol(colMap, '품목구분');
  const cProcessType = findCol(colMap, '품목유형');
  const cSupplyType = findCol(colMap, '조달구분');
  const cNetWeight = findCol(colMap, 'NET중량');
  const cRunner = findCol(colMap, 'Runner중량');
  const cCavity = findCol(colMap, '금형Cavity', 'Cavity');
  const cPaint1 = findCol(colMap, '1도 표준 Paint량', '1도');
  const cPaint2 = findCol(colMap, '2도 표준 Paint량', '2도');
  const cPaint3 = findCol(colMap, '3도 표준 Paint량', '3도');
  const cRaw1 = findCol(colMap, '원재료코드1');
  const cRaw2 = findCol(colMap, '원재료코드2');
  const cRaw3 = findCol(colMap, '원재료코드3');
  const cRaw4 = findCol(colMap, '원재료코드4');
  const cLoss = findCol(colMap, 'Loss', 'loss율');

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const itemCode = cItemCode >= 0 ? str(row[cItemCode]) : '';
    if (!itemCode) continue;

    items.push({
      itemCode,
      customerPn: cCustPn >= 0 ? str(row[cCustPn]) : '',
      itemName: cName >= 0 ? str(row[cName]) : '',
      itemType: cItemType >= 0 ? str(row[cItemType]) : '',
      processType: cProcessType >= 0 ? str(row[cProcessType]) : '',
      supplyType: cSupplyType >= 0 ? str(row[cSupplyType]) : '',
      netWeight: cNetWeight >= 0 ? num(row[cNetWeight]) : 0,
      runnerWeight: cRunner >= 0 ? num(row[cRunner]) : 0,
      cavity: cCavity >= 0 ? num(row[cCavity]) : 1,
      paintQty1: cPaint1 >= 0 ? num(row[cPaint1]) : 0,
      paintQty2: cPaint2 >= 0 ? num(row[cPaint2]) : 0,
      paintQty3: cPaint3 >= 0 ? num(row[cPaint3]) : 0,
      rawMaterialCode1: cRaw1 >= 0 ? str(row[cRaw1]) : '',
      rawMaterialCode2: cRaw2 >= 0 ? str(row[cRaw2]) : '',
      rawMaterialCode3: cRaw3 >= 0 ? str(row[cRaw3]) : '',
      rawMaterialCode4: cRaw4 >= 0 ? str(row[cRaw4]) : '',
      lossRate: cLoss >= 0 ? num(row[cLoss]) : 0,
    });
  }

  return items;
}

/** 재질단가 시트 파싱
 * 실제 구조: (공백), 재질코드, 재질명, 단위, 품목유형, 재질분류, 업체코드, 업체명, 단가구분, 최초단가, 현재단가
 * 품목유형='사출' or '도장'으로 RESIN/PAINT 분류
 */
function parseMaterialPriceSheet(ws: XLSX.WorkSheet): MaterialPrice[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: MaterialPrice[] = [];

  const { headerRow, colMap } = findHeaderAndColMap(data, '재질코드');
  if (headerRow < 0) return items;

  const cCode = findCol(colMap, '재질코드');
  const cName = findCol(colMap, '재질명');
  // 품목유형='사출'/'도장' 또는 재질분류='사출재료'/'도장재료'로 분류
  const cProcessType = findCol(colMap, '품목유형');
  const cCategory = findCol(colMap, '재질분류');
  const cCurrent = findCol(colMap, '현재단가');
  const cPrev = findCol(colMap, '최초단가');

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const code = cCode >= 0 ? str(row[cCode]) : '';
    if (!code) continue;

    // 유형 판정: 품목유형 → 재질분류 순으로 체크
    let mType = '';
    const processType = cProcessType >= 0 ? str(row[cProcessType]) : '';
    const category = cCategory >= 0 ? str(row[cCategory]) : '';
    if (processType.includes('사출') || category.includes('사출')) mType = 'RESIN';
    else if (processType.includes('도장') || category.includes('도장')) mType = 'PAINT';

    items.push({
      materialCode: code,
      materialName: cName >= 0 ? str(row[cName]) : '',
      materialType: mType,
      currentPrice: cCurrent >= 0 ? num(row[cCurrent]) : 0,
      previousPrice: cPrev >= 0 ? num(row[cPrev]) : 0,
    });
  }

  return items;
}

/** 구매단가 시트 파싱
 * 실제 구조: 품목코드, 고객사 P/N, 품목명, 규격, 단위, 품목유형, 검사유형, 업체코드, 업체명, 현재단가구분, 최초단가, 현재단가
 */
function parsePurchasePriceSheet(ws: XLSX.WorkSheet): PurchasePrice[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: PurchasePrice[] = [];

  const { headerRow, colMap } = findHeaderAndColMap(data, '품목코드');
  if (headerRow < 0) return items;

  const cCode = findCol(colMap, '품목코드');
  const cCustPn = findCol(colMap, '고객사 P/N', '고객사');
  const cName = findCol(colMap, '품목명');
  const cSupplier = findCol(colMap, '업체명', '협력업체');
  const cCurrent = findCol(colMap, '현재단가');
  const cPrev = findCol(colMap, '최초단가');

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const code = cCode >= 0 ? str(row[cCode]) : '';
    if (!code) continue;

    items.push({
      itemCode: code,
      customerPn: cCustPn >= 0 ? str(row[cCustPn]) : '',
      itemName: cName >= 0 ? str(row[cName]) : '',
      supplier: cSupplier >= 0 ? str(row[cSupplier]) : '',
      currentPrice: cCurrent >= 0 ? num(row[cCurrent]) : 0,
      previousPrice: cPrev >= 0 ? num(row[cPrev]) : 0,
    });
  }

  return items;
}

/** 외주사출판매가 시트 파싱
 * 실제 구조: (row0: 번호), row1: 헤더(품목코드, 협력사, 고객사 P/N, 품목명, 사출단가), row2+: 데이터
 */
function parseOutsourcePriceSheet(ws: XLSX.WorkSheet): OutsourcePrice[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: OutsourcePrice[] = [];

  const { headerRow, colMap } = findHeaderAndColMap(data, '품목코드');
  if (headerRow < 0) return items;

  const cCode = findCol(colMap, '품목코드');
  const cCustPn = findCol(colMap, '고객사 P/N', '고객사');
  const cName = findCol(colMap, '품목명');
  const cSupplier = findCol(colMap, '협력사', '협력업체');
  const cPrice = findCol(colMap, '사출단가', '사출판매가');

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const code = cCode >= 0 ? str(row[cCode]) : '';
    if (!code) continue;

    items.push({
      itemCode: code,
      customerPn: cCustPn >= 0 ? str(row[cCustPn]) : '',
      itemName: cName >= 0 ? str(row[cName]) : '',
      supplier: cSupplier >= 0 ? str(row[cSupplier]) : '',
      injectionPrice: cPrice >= 0 ? num(row[cPrice]) : 0,
    });
  }

  return items;
}

/** 도료배합비율 시트 파싱
 * 실제 구조: row0-1: 번호행, row2: 헤더
 * col0=품목코드(도료), col1=번호, col2=재질코드(주제), col3=재질명(주제), col4=단위,
 * col5=주제도료코드, col6=주제도료명, col7=주제비율,
 * col8=경화제코드, col9=경화제명, col10=경화제비율,
 * col11=희석제코드, col12=희석제명, col13=희석제비율,
 * col14=점도상한, col15=점도하한, col16=Paint사용량
 *
 * 같은 품목코드에 여러 행(번호1,2,3...) → 여러 도료 조합
 * 여기서는 각 행을 개별 PaintMixRatio로 저장하고 paintCode=col0
 */
function parsePaintMixSheet(ws: XLSX.WorkSheet): PaintMixRatio[] {
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const items: PaintMixRatio[] = [];

  const { headerRow, colMap } = findHeaderAndColMap(data, '재질코드', '주제도료');
  if (headerRow < 0) return items;

  const cMainCode = findCol(colMap, '재질코드');
  const cMainName = findCol(colMap, '재질명');
  const cMainDrugCode = findCol(colMap, '주제도료');
  const cMainDrugName = findCol(colMap, '주제도료명');
  const cMainR = findCol(colMap, '주제비율');
  const cHardCode = findCol(colMap, '경화제');
  const cHardName = findCol(colMap, '경화제명');
  const cHardR = findCol(colMap, '경화제비율');
  const cThinCode = findCol(colMap, '희석제');
  const cThinName = findCol(colMap, '희석제명');
  const cThinR = findCol(colMap, '희석제비율');

  // col0 = 품목코드(도료코드), col1 = 번호
  // 같은 도료코드에 여러 행이 가능
  let lastPaintCode = '';

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    // col0이 비어있으면 이전 paintCode 사용
    const paintCode = str(row[0]) || lastPaintCode;
    if (!paintCode) continue;
    lastPaintCode = paintCode;

    const mainCode = cMainDrugCode >= 0 ? str(row[cMainDrugCode]) : (cMainCode >= 0 ? str(row[cMainCode]) : '');
    if (!mainCode) continue;

    items.push({
      paintCode,
      paintName: cMainDrugName >= 0 ? str(row[cMainDrugName]) : (cMainName >= 0 ? str(row[cMainName]) : ''),
      mainRatio: cMainR >= 0 ? num(row[cMainR]) : 100,
      hardenerRatio: cHardR >= 0 ? num(row[cHardR]) : 0,
      thinnerRatio: cThinR >= 0 ? num(row[cThinR]) : 0,
      mainCode,
      hardenerCode: cHardCode >= 0 ? str(row[cHardCode]) : '',
      thinnerCode: cThinCode >= 0 ? str(row[cThinCode]) : '',
      // 단가는 재질단가 시트에서 조회 → 여기서는 0
      mainPrice: 0,
      hardenerPrice: 0,
      thinnerPrice: 0,
    });
  }

  return items;
}

// ============================================================
// Main parser
// ============================================================

/** 표준재료비 엑셀 파일 전체 파싱 (12개 시트 지원) */
export function parseStandardMaterialExcel(
  workbook: XLSX.WorkBook,
  year: number,
  month: string
): StandardMaterialData {
  const summarySheet = workbook.Sheets['표준재료비 현황'] || workbook.Sheets['NET재료비 현황'];
  const itemsSheet = workbook.Sheets['품목별재료비'];
  const abcSheet = workbook.Sheets['ABC 매출'];

  const summaryBase = summarySheet
    ? parseSummarySheet(summarySheet)
    : getEmptySummary();

  const summary: StandardMaterialSummary = {
    ...summaryBase,
    year,
    month,
  };

  const items = itemsSheet ? parseItemsSheet(itemsSheet) : [];
  const abcSales = abcSheet ? parseAbcSalesSheet(abcSheet) : [];

  // 참조 시트 파싱 (없으면 undefined)
  const productInfoSheet = workbook.Sheets['품목정보'];
  const materialPriceSheet = workbook.Sheets['재질단가'];
  const purchasePriceSheet = workbook.Sheets['구매단가'];
  const outsourcePriceSheet = workbook.Sheets['외주사출 판매가'] || workbook.Sheets['외주사출판매가'];
  const paintMixSheet = workbook.Sheets['도료배합비율'];

  const productInfo = productInfoSheet ? parseProductInfoSheet(productInfoSheet) : undefined;
  const materialPrices = materialPriceSheet ? parseMaterialPriceSheet(materialPriceSheet) : undefined;
  const purchasePrices = purchasePriceSheet ? parsePurchasePriceSheet(purchasePriceSheet) : undefined;
  const outsourcePrices = outsourcePriceSheet ? parseOutsourcePriceSheet(outsourcePriceSheet) : undefined;
  const paintMixRatios = paintMixSheet ? parsePaintMixSheet(paintMixSheet) : undefined;

  const refCounts = [productInfo, materialPrices, purchasePrices, outsourcePrices, paintMixRatios].filter(Boolean);
  if (refCounts.length > 0) {
    console.log(`[표준재료비 파서] 참조시트 파싱: 품목정보 ${productInfo?.length ?? 0}건, 재질단가 ${materialPrices?.length ?? 0}건, 구매단가 ${purchasePrices?.length ?? 0}건, 외주사출 ${outsourcePrices?.length ?? 0}건, 도료배합 ${paintMixRatios?.length ?? 0}건`);
  }

  return {
    summary,
    items,
    abcSales,
    year,
    month,
    uploadDate: new Date().toISOString(),
    productInfo,
    materialPrices,
    purchasePrices,
    outsourcePrices,
    paintMixRatios,
  };
}

function getEmptySummary(): Omit<StandardMaterialSummary, 'year' | 'month'> {
  return {
    abcSales: 0, reportedSales: 0,
    standardTotal: 0, standardResin: 0, standardPaint: 0, standardPurchase: 0, standardOutsource: 0,
    standardRatio: 0, resinRatio: 0, paintRatio: 0, purchaseRatio: 0, outsourceRatio: 0,
    actualTotal: 0, actualResin: 0, actualPaint: 0, actualPurchase: 0, actualOutsource: 0,
    actualRatio: 0, actualResinRatio: 0, actualPaintRatio: 0, actualPurchaseRatio: 0, actualOutsourceRatio: 0,
    productInventory: 0, partsInventory: 0, inventoryRatio: 0,
    targetTotalRatio: 0.491, targetPurchaseRatio: 0.265,
  };
}
