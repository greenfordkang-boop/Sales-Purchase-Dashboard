/**
 * Shared types for Standard Material Cost module.
 * Used by useStandardMaterialCost hook and StandardMaterialCostView component.
 */

export interface MaterialCostRow {
  id: string;
  childPn: string;        // 자재 품번
  childName: string;      // 자재명
  supplier: string;       // 협력업체
  materialType: string;   // RESIN / PAINT / 구매 / 외주
  parentProducts: string[];
  standardReq: number;    // 표준소요량 (BOM 전개)
  avgUnitPrice: number;   // 평균 단가 (입고 기준)
  standardCost: number;   // 표준재료비 = standardReq × avgUnitPrice
  actualQty: number;      // 실제 투입수량
  actualCost: number;     // 실적재료비 (입고 금액)
  diff: number;           // 차이 (표준 - 실적)
  diffRate: number;       // 차이율
}

export interface AutoCalcResult {
  rows: MaterialCostRow[];
  totalStandard: number;
  totalActual: number;
  byType: { name: string; standard: number; actual: number }[];
  forecastRevenue: number;  // 매출계획 금액
  standardRatio: number;    // 표준재료비율
  actualRatio: number;      // 실적재료비율
  matchRate: number;        // BOM 매칭율
  debug: { forecastItems: number; bomProducts: number; bomMissing: number; materials: number; purchaseMatched: number; calcSource?: string };
  costByPn?: Map<string, number>;  // 제품 P/N별 EA단가 (BOM진단 연동용)
}

export interface MonthlySummaryRow {
  month: string;           // 'Jan', 'Feb', ...
  monthKr: string;         // '01월', '02월', ...
  revenue: number;         // 매출액
  standardCost: number;    // 표준재료비
  actualCost: number;      // 실적재료비
  diff: number;            // 차이금액 (표준 - 실적)
  standardRatio: number;   // 표준재료비율
  actualRatio: number;     // 실적재료비율
  achievementRate: number; // 달성율
}

export interface ComparisonRow {
  itemCode: string;
  itemName: string;
  supplyType: string;    // 자작/구매/외주/미분류
  stdQty: number;        // 표준수량
  stdUnitPrice: number;  // 표준단가 (원/EA)
  stdAmount: number;     // 표준금액
  actQty: number;        // 실적수량
  actUnitPrice: number;  // 실적단가
  actAmount: number;     // 실적금액
  diffAmount: number;    // 차이 (표준-실적, 양수=절감)
  diffRate: number;      // 차이율%
  absDiffAmount: number; // |차이| (정렬용)
  matchStatus: 'matched' | 'std-only' | 'act-only';
}

export interface DiagnosticRow {
  customerPn: string;
  internalCode: string;
  itemName: string;
  supplyType: string;
  processType: string;
  hasForecast: boolean;
  forecastQty: number;
  forecastRevenue: number;     // 매출금액
  hasPnMapping: boolean;
  hasBom: boolean;             // BOM 존재 여부
  bomChildCount: number;       // BOM 리프 수
  hasUnitCost: boolean;
  unitCostPerEa: number;
  injectionCost: number;
  paintCost: number;
  purchasePrice: number;
  stdAmount: number;
  materialRatio: number;       // 재료비율 (stdAmount / forecastRevenue)
  breakPoint: string;
  breakLevel: 0 | 1 | 2 | 3 | 4;  // 4: 비율이상 추가
}

export interface GapAnalysisResult {
  exResin: number; exPaint: number; exPurchase: number; exOutsource: number; exTotal: number;
  autoResin: number; autoPaint: number; autoOutsource: number; autoInhouse: number; autoTotal: number;
  matchedPartsAmt: number; unmatchedPartsAmt: number; matchedPartsCount: number; unmatchedPartsCount: number;
  matchedOutsourceAmt: number; unmatchedOutsourceAmt: number; matchedInhouseAmt: number; unmatchedInhouseAmt: number;
  topUnmatched: [string, { name: string; amount: number; count: number; supplyType: string }][];
  accuracy: number;
}

export interface ComparisonData {
  rows: ComparisonRow[];
  totalMatched: number;
  totalRows: number;
  totalStd: number;
  totalAct: number;
  totalGap: number;
  supplyTypes: string[];
}

export interface DiagnosticData {
  rows: DiagnosticRow[];
  totalProducts: number;
  forecastProducts: number;
  okCount: number;
  ratioIssueCount: number;
  forecastMissCount: number;
  pnMissCount: number;
  costMissCount: number;
  noBomCount: number;
  noCostCount: number;
  noBomBySupply: Record<string, number>;
  bomHitCount: number;
  totalStdAmount: number;
  totalRevenue: number;
  overallRatio: number;
  correctedStdAmount: number;
  correctedRatio: number;
  extrapolatedStd: number;
  unmatchedCount: number;
  coverageRate: number;
}

export type DataMode = 'auto' | 'excel' | 'master';
export type ViewMode = 'summary' | 'items' | 'comparison' | 'diagnostic' | 'analysis';
