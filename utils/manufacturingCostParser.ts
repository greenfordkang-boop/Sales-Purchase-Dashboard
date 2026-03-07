/**
 * manufacturingCostParser.ts — 제조원가 Excel 통합 파서
 * 「8. 제조원가_20260228.xlsx」 6개 시트를 한 번에 파싱하여
 * BOM, 품목기준정보, 원재료단가, 부품구매단가, 재질코드, 도료배합기준 데이터를 추출
 */
import * as XLSX from 'xlsx';
import { BomRecord, normalizePn } from './bomDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord } from './bomMasterParser';
import { PurchasePrice, PaintMixRatio } from './standardMaterialParser';

// ============================================
// Types
// ============================================

export interface ManufacturingCostData {
  bomRecords: BomRecord[];
  refInfo: ReferenceInfoRecord[];
  purchasePrices: PurchasePrice[];
  materialCodes: MaterialCodeRecord[];
  paintMixRatios: PaintMixRatio[];
  bomCostMap: Map<string, number>;  // childPn → 재료비(원/EA)
  productList: { code: string; name: string; customer: string }[];
}

// ============================================
// Helpers
// ============================================

const parseNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

const str = (v: unknown): string => String(v ?? '').trim();

/** 시트 이름 매칭 — 여러 패턴 중 첫 번째 매칭 반환 */
const findSheet = (wb: XLSX.WorkBook, patterns: RegExp[]): XLSX.WorkSheet | null => {
  for (const pat of patterns) {
    const name = wb.SheetNames.find(n => pat.test(n));
    if (name && wb.Sheets[name]) return wb.Sheets[name];
  }
  return null;
};

/** 헤더 행 탐색 (첫 10행 내에서 특정 키워드 포함 행 찾기) */
const findHeaderRow = (rows: unknown[][], keywords: string[], maxScan = 10): number => {
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    const cells = (rows[i] || []).map(c => str(c).replace(/\r?\n/g, ' '));
    if (keywords.every(kw => cells.some(c => c.includes(kw)))) return i;
    // 일부 키워드만 포함돼도 헤더 가능 (최소 2개 매칭)
    if (keywords.length > 2) {
      const matched = keywords.filter(kw => cells.some(c => c.includes(kw)));
      if (matched.length >= Math.min(3, keywords.length)) return i;
    }
  }
  return -1;
};

/** 헤더 내 특정 패턴의 컬럼 인덱스 */
const findCol = (headers: string[], pattern: RegExp): number =>
  headers.findIndex(h => pattern.test(h));

// ============================================
// 1a. BOM 시트 파서
// ============================================

function parseBomSheet(wb: XLSX.WorkBook): { bomRecords: BomRecord[]; bomCostMap: Map<string, number>; productList: ManufacturingCostData['productList'] } {
  const sheet = findSheet(wb, [/^BOM$/i, /BOM/i, /제조원가.*BOM/i]);
  if (!sheet) return { bomRecords: [], bomCostMap: new Map(), productList: [] };

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['모품번', '자재도번']);
  if (headerIdx === -1) return { bomRecords: [], bomCostMap: new Map(), productList: [] };

  const headers = (rows[headerIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));

  const colParent = findCol(headers, /모품번/);
  const colChild = findCol(headers, /자재도번/);
  const colLevel = findCol(headers, /레벨/);
  const colQty = findCol(headers, /소요량/);
  const colChildName = findCol(headers, /자재명/);
  const colPartType = findCol(headers, /부품유형/);
  const colUseYn = findCol(headers, /사용유무/);
  const colMaterialCost = findCol(headers, /^재료비$/);
  const colProductCode = findCol(headers, /제품코드/);
  const colCustomer = findCol(headers, /고객사/);
  const colVariety = findCol(headers, /품종/);
  const colSupplyType = findCol(headers, /조달구분/);

  if (colParent === -1 || colChild === -1) return { bomRecords: [], bomCostMap: new Map(), productList: [] };

  const bomRecords: BomRecord[] = [];
  const bomCostMap = new Map<string, number>();
  const productSet = new Map<string, { code: string; name: string; customer: string }>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // 사용유무 'N' 스킵
    if (colUseYn !== -1 && str(row[colUseYn]).toUpperCase() === 'N') continue;

    const parentPn = str(row[colParent]);
    const childPn = str(row[colChild]);
    if (!parentPn || !childPn) continue;

    // Level 0 self-reference 스킵 (root 정의일 뿐)
    const level = colLevel !== -1 ? parseNum(row[colLevel]) : 1;
    if (level === 0 && normalizePn(parentPn) === normalizePn(childPn)) continue;

    const qty = colQty !== -1 ? parseNum(row[colQty]) : 1;
    const childName = colChildName !== -1 ? str(row[colChildName]) : '';
    const partType = colPartType !== -1 ? str(row[colPartType]) : '';
    const supplyType = colSupplyType !== -1 ? str(row[colSupplyType]) : '';

    bomRecords.push({
      parentPn,
      childPn,
      level: level || 1,
      qty: qty || 1,
      childName,
      supplier: '',  // BOM 시트에는 업체 없음 — 이후 enrichment
      partType: partType || supplyType,
    });

    // 재료비 맵 (childPn → 원/EA)
    if (colMaterialCost !== -1) {
      const cost = parseNum(row[colMaterialCost]);
      if (cost > 0) bomCostMap.set(normalizePn(childPn), cost);
    }

    // 제품 목록 수집 (Level 0 또는 Level 1의 모품번)
    if (level <= 1 && colProductCode !== -1) {
      const code = str(row[colProductCode]);
      if (code && !productSet.has(code)) {
        productSet.set(code, {
          code,
          name: childName || parentPn,
          customer: colCustomer !== -1 ? str(row[colCustomer]) : '',
        });
      }
    }
  }

  return { bomRecords, bomCostMap, productList: [...productSet.values()] };
}

// ============================================
// 1b. 품목기준정보 시트 파서
// ============================================

function parseRefInfoSheet(wb: XLSX.WorkBook): ReferenceInfoRecord[] {
  const sheet = findSheet(wb, [/품목기준정보/i, /기준정보/i, /품목.*마스터/i]);
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['품목코드']);
  if (headerIdx === -1) return [];

  const headers = (rows[headerIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));

  const col = (pat: RegExp) => findCol(headers, pat);
  const cItemCode = col(/^품목코드$/);
  const cCustPn = col(/고객사.*P.?N/i);
  const cItemName = col(/품목명/);
  const cSpec = col(/규격/);
  const cCustomer = col(/고객사명|고객사$/);
  const cVariety = col(/품종/);
  const cItemStatus = col(/품목상태/);
  const cItemCategory = col(/품목구분/);
  const cProcessType = col(/품목유형/);
  const cInspType = col(/검사유형/);
  const cProductGroup = col(/제품군/);
  const cSupplyType = col(/조달구분/);
  const cSupplier = col(/협력업체/);
  const cLine1 = col(/우선배정라인1/);
  const cLine2 = col(/우선배정라인2/);
  const cLine3 = col(/우선배정라인3/);
  const cLine4 = col(/우선배정라인4/);
  const cSafetyStock = col(/안전재고$/);
  const cSafetyDays = col(/안전재고일/);
  const cLotQty = col(/LOT수량/i);
  const cProdPerHr = col(/시간당.*생산/);
  const cDefect = col(/불량.*허용/);
  const cWorkers = col(/투입인원/);
  const cProcTime = col(/가공시간/);
  const cStdCT = col(/표준C.?T/i);
  const cStdManHours = col(/표준공수/);
  const cQtyPerBox = col(/BOX당/i);
  const cRaw1 = col(/원재료코드1/);
  const cRaw2 = col(/원재료코드2/);
  const cRaw3 = col(/원재료코드3/);
  const cRaw4 = col(/원재료코드4/);
  const cNetW1 = col(/NET중량1|NET중량$/i);
  const cRunnerW1 = col(/Runner중량1|Runner중량$/i);
  const cNetW2 = col(/NET중량2/i);
  const cRunnerW2 = col(/Runner중량2/i);
  const cPaint1 = col(/1도.*Paint|Paint.*1도/i);
  const cPaint2 = col(/2도.*Paint|Paint.*2도/i);
  const cPaint3 = col(/3도.*Paint|Paint.*3도/i);
  const cPaint4 = col(/4도.*Paint|Paint.*4도/i);
  const cLossRate = col(/Loss율|로스율/i);
  const cCavity = col(/금형.*Cavity|Cavity$/i);
  const cUseCavity = col(/사용.*Cavity/i);
  const cSizeType = col(/제품크기/);
  const cGloss = col(/광택/);
  const cUseYn = col(/사용여부/);

  if (cItemCode === -1) return [];

  const results: ReferenceInfoRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const itemCode = str(r[cItemCode]);
    if (!itemCode) continue;

    results.push({
      itemCode,
      customerPn: cCustPn !== -1 ? str(r[cCustPn]) : '',
      itemName: cItemName !== -1 ? str(r[cItemName]) : '',
      spec: cSpec !== -1 ? str(r[cSpec]) : '',
      customerName: cCustomer !== -1 ? str(r[cCustomer]) : '',
      variety: cVariety !== -1 ? str(r[cVariety]) : '',
      itemStatus: cItemStatus !== -1 ? str(r[cItemStatus]) : '',
      itemCategory: cItemCategory !== -1 ? str(r[cItemCategory]) : '',
      processType: cProcessType !== -1 ? str(r[cProcessType]) : '',
      inspectionType: cInspType !== -1 ? str(r[cInspType]) : '',
      productGroup: cProductGroup !== -1 ? str(r[cProductGroup]) : '',
      supplyType: cSupplyType !== -1 ? str(r[cSupplyType]) : '',
      supplier: cSupplier !== -1 ? str(r[cSupplier]) : '',
      priorityLine1: cLine1 !== -1 ? str(r[cLine1]) : '',
      priorityLine2: cLine2 !== -1 ? str(r[cLine2]) : '',
      priorityLine3: cLine3 !== -1 ? str(r[cLine3]) : '',
      priorityLine4: cLine4 !== -1 ? str(r[cLine4]) : '',
      safetyStock: cSafetyStock !== -1 ? parseNum(r[cSafetyStock]) : 0,
      safetyStockDays: cSafetyDays !== -1 ? parseNum(r[cSafetyDays]) : 0,
      lotQty: cLotQty !== -1 ? parseNum(r[cLotQty]) : 0,
      productionPerHour: cProdPerHr !== -1 ? parseNum(r[cProdPerHr]) : 0,
      defectAllowance: cDefect !== -1 ? parseNum(r[cDefect]) : 0,
      workers: cWorkers !== -1 ? parseNum(r[cWorkers]) : 0,
      processingTime: cProcTime !== -1 ? str(r[cProcTime]) : '',
      standardCT: cStdCT !== -1 ? parseNum(r[cStdCT]) : 0,
      standardManHours: cStdManHours !== -1 ? parseNum(r[cStdManHours]) : 0,
      qtyPerBox: cQtyPerBox !== -1 ? parseNum(r[cQtyPerBox]) : 0,
      rawMaterialCode1: cRaw1 !== -1 ? str(r[cRaw1]) : '',
      rawMaterialCode2: cRaw2 !== -1 ? str(r[cRaw2]) : '',
      rawMaterialCode3: cRaw3 !== -1 ? str(r[cRaw3]) : '',
      rawMaterialCode4: cRaw4 !== -1 ? str(r[cRaw4]) : '',
      netWeight: cNetW1 !== -1 ? parseNum(r[cNetW1]) : 0,
      runnerWeight: cRunnerW1 !== -1 ? parseNum(r[cRunnerW1]) : 0,
      netWeight2: cNetW2 !== -1 ? parseNum(r[cNetW2]) : 0,
      runnerWeight2: cRunnerW2 !== -1 ? parseNum(r[cRunnerW2]) : 0,
      paintQty1: cPaint1 !== -1 ? parseNum(r[cPaint1]) : 0,
      paintQty2: cPaint2 !== -1 ? parseNum(r[cPaint2]) : 0,
      paintQty3: cPaint3 !== -1 ? parseNum(r[cPaint3]) : 0,
      paintQty4: cPaint4 !== -1 ? parseNum(r[cPaint4]) : 0,
      lossRate: cLossRate !== -1 ? parseNum(r[cLossRate]) : 0,
      cavity: cCavity !== -1 ? parseNum(r[cCavity]) : 0,
      useCavity: cUseCavity !== -1 ? parseNum(r[cUseCavity]) : 0,
      productSizeType: cSizeType !== -1 ? str(r[cSizeType]) : '',
      glossType: cGloss !== -1 ? str(r[cGloss]) : '',
      useYn: cUseYn !== -1 ? str(r[cUseYn]) : 'Y',
    });
  }

  return results;
}

// ============================================
// 1c. 원재료단가 시트 파서
// ============================================

function parseRawMaterialPriceSheet(wb: XLSX.WorkBook): PurchasePrice[] {
  const sheet = findSheet(wb, [/원재료단가/i, /원재료.*단가/i, /재질단가/i]);
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['재질코드']);
  if (headerIdx === -1) return [];

  const headers = (rows[headerIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));
  const cCode = findCol(headers, /재질코드/);
  const cName = findCol(headers, /재질명/);
  const cSupplier = findCol(headers, /업체명|협력업체|거래처/);
  const cPrice = findCol(headers, /현재단가|단가/);
  const cPrevPrice = findCol(headers, /전월단가/);

  if (cCode === -1) return [];

  const results: PurchasePrice[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const itemCode = str(r[cCode]);
    if (!itemCode) continue;

    results.push({
      itemCode,
      customerPn: '',
      itemName: cName !== -1 ? str(r[cName]) : '',
      supplier: cSupplier !== -1 ? str(r[cSupplier]) : '',
      currentPrice: cPrice !== -1 ? parseNum(r[cPrice]) : 0,
      previousPrice: cPrevPrice !== -1 ? parseNum(r[cPrevPrice]) : 0,
    });
  }

  return results;
}

// ============================================
// 1d. 부품구매단가 시트 파서
// ============================================

function parsePartsPurchasePriceSheet(wb: XLSX.WorkBook): PurchasePrice[] {
  const sheet = findSheet(wb, [/부품구매단가/i, /부품.*단가/i, /구매단가/i]);
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['품목코드']);
  if (headerIdx === -1) {
    // fallback: 어떤 코드 컬럼이든 찾기
    const fallbackIdx = findHeaderRow(rows, ['코드']);
    if (fallbackIdx === -1) return [];
    // use fallback
  }
  const hIdx = headerIdx !== -1 ? headerIdx : findHeaderRow(rows, ['코드']);
  if (hIdx === -1) return [];

  const headers = (rows[hIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));
  const cCode = findCol(headers, /품목코드|품번/);
  const cCustPn = findCol(headers, /고객사.*P.?N/i);
  const cName = findCol(headers, /품목명|품명/);
  const cSupplier = findCol(headers, /업체명|협력업체|거래처/);
  const cPrice = findCol(headers, /현재단가|단가/);
  const cPrevPrice = findCol(headers, /전월단가/);

  if (cCode === -1) return [];

  const results: PurchasePrice[] = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const itemCode = str(r[cCode]);
    if (!itemCode) continue;

    results.push({
      itemCode,
      customerPn: cCustPn !== -1 ? str(r[cCustPn]) : '',
      itemName: cName !== -1 ? str(r[cName]) : '',
      supplier: cSupplier !== -1 ? str(r[cSupplier]) : '',
      currentPrice: cPrice !== -1 ? parseNum(r[cPrice]) : 0,
      previousPrice: cPrevPrice !== -1 ? parseNum(r[cPrevPrice]) : 0,
    });
  }

  return results;
}

// ============================================
// 1e. 재질코드 시트 파서
// ============================================

function parseMaterialCodeSheet(wb: XLSX.WorkBook): MaterialCodeRecord[] {
  const sheet = findSheet(wb, [/^재질코드$/i, /재질.*코드/i]);
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['재질코드']);
  if (headerIdx === -1) return [];

  const headers = (rows[headerIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));
  const cIndustryCode = findCol(headers, /업종코드/);
  const cMaterialType = findCol(headers, /업종명/);
  const cCode = findCol(headers, /재질코드/);
  const cName = findCol(headers, /재질명/);
  const cCategory = findCol(headers, /재질분류/);
  const cPaintCat = findCol(headers, /도료구분/);
  const cColor = findCol(headers, /색상/);
  const cUnit = findCol(headers, /단위/);
  const cSafetyStock = findCol(headers, /안전재고/);
  const cDailyAvg = findCol(headers, /일평균/);
  const cLossRate = findCol(headers, /Loss율|로스율/i);
  const cValidDays = findCol(headers, /유효기간/);
  const cOrderSize = findCol(headers, /발주.*SIZE/i);
  const cUseYn = findCol(headers, /사용여부/);
  const cProtected = findCol(headers, /보호항목/);
  const cPrice = findCol(headers, /단가/);

  if (cCode === -1) return [];

  const results: MaterialCodeRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const materialCode = str(r[cCode]);
    if (!materialCode) continue;

    results.push({
      industryCode: cIndustryCode !== -1 ? str(r[cIndustryCode]) : '',
      materialType: cMaterialType !== -1 ? str(r[cMaterialType]) : '',
      materialCode,
      materialName: cName !== -1 ? str(r[cName]) : '',
      materialCategory: cCategory !== -1 ? str(r[cCategory]) : '',
      paintCategory: cPaintCat !== -1 ? str(r[cPaintCat]) : '',
      color: cColor !== -1 ? str(r[cColor]) : '',
      unit: cUnit !== -1 ? str(r[cUnit]) : '',
      safetyStock: cSafetyStock !== -1 ? parseNum(r[cSafetyStock]) : 0,
      dailyAvgUsage: cDailyAvg !== -1 ? parseNum(r[cDailyAvg]) : 0,
      lossRate: cLossRate !== -1 ? parseNum(r[cLossRate]) : 0,
      validDays: cValidDays !== -1 ? parseNum(r[cValidDays]) : 0,
      orderSize: cOrderSize !== -1 ? str(r[cOrderSize]) : '',
      useYn: cUseYn !== -1 ? str(r[cUseYn]) : 'Y',
      protectedItem: cProtected !== -1 ? str(r[cProtected]) : '',
      currentPrice: cPrice !== -1 ? parseNum(r[cPrice]) : 0,
    });
  }

  return results;
}

// ============================================
// 1f. 도료배합기준 시트 파서
// ============================================

function parsePaintMixSheet(wb: XLSX.WorkBook): PaintMixRatio[] {
  const sheet = findSheet(wb, [/도료배합기준/i, /배합기준/i, /배합표준/i]);
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rows, ['도료코드']);
  if (headerIdx === -1) return [];

  const headers = (rows[headerIdx] || []).map(c => str(c).replace(/\r?\n/g, ' '));
  const cPaintCode = findCol(headers, /도료코드/);
  const cPaintName = findCol(headers, /도료명/);
  const cMainRatio = findCol(headers, /주제.*비율|주제율/i);
  const cHardenerRatio = findCol(headers, /경화제.*비율|경화제율/i);
  const cThinnerRatio = findCol(headers, /신너.*비율|신너율|시너.*비율/i);
  const cMainCode = findCol(headers, /주제.*코드/i);
  const cHardenerCode = findCol(headers, /경화제.*코드/i);
  const cThinnerCode = findCol(headers, /신너.*코드|시너.*코드/i);
  const cMainPrice = findCol(headers, /주제.*단가/i);
  const cHardenerPrice = findCol(headers, /경화제.*단가/i);
  const cThinnerPrice = findCol(headers, /신너.*단가|시너.*단가/i);

  if (cPaintCode === -1) return [];

  const results: PaintMixRatio[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const paintCode = str(r[cPaintCode]);
    if (!paintCode) continue;

    results.push({
      paintCode,
      paintName: cPaintName !== -1 ? str(r[cPaintName]) : '',
      mainRatio: cMainRatio !== -1 ? parseNum(r[cMainRatio]) : 0,
      hardenerRatio: cHardenerRatio !== -1 ? parseNum(r[cHardenerRatio]) : 0,
      thinnerRatio: cThinnerRatio !== -1 ? parseNum(r[cThinnerRatio]) : 0,
      mainCode: cMainCode !== -1 ? str(r[cMainCode]) : '',
      hardenerCode: cHardenerCode !== -1 ? str(r[cHardenerCode]) : '',
      thinnerCode: cThinnerCode !== -1 ? str(r[cThinnerCode]) : '',
      mainPrice: cMainPrice !== -1 ? parseNum(r[cMainPrice]) : 0,
      hardenerPrice: cHardenerPrice !== -1 ? parseNum(r[cHardenerPrice]) : 0,
      thinnerPrice: cThinnerPrice !== -1 ? parseNum(r[cThinnerPrice]) : 0,
    });
  }

  return results;
}

// ============================================
// 통합 파서 (메인 export)
// ============================================

export function parseManufacturingCostExcel(buffer: ArrayBuffer): ManufacturingCostData {
  const wb = XLSX.read(buffer, { type: 'array' });

  console.log('[제조원가 파서] 시트 목록:', wb.SheetNames);

  // 1a. BOM
  const { bomRecords, bomCostMap, productList } = parseBomSheet(wb);
  console.log(`[제조원가 파서] BOM: ${bomRecords.length}건, 재료비맵: ${bomCostMap.size}건, 제품: ${productList.length}개`);

  // 1b. 품목기준정보
  const refInfo = parseRefInfoSheet(wb);
  console.log(`[제조원가 파서] 품목기준정보: ${refInfo.length}건`);

  // 1c + 1d. 단가 (원재료 + 부품 구매)
  const rawPrices = parseRawMaterialPriceSheet(wb);
  const partPrices = parsePartsPurchasePriceSheet(wb);
  const purchasePrices = [...rawPrices, ...partPrices];
  console.log(`[제조원가 파서] 단가: 원재료 ${rawPrices.length}건 + 부품 ${partPrices.length}건 = ${purchasePrices.length}건`);

  // 1e. 재질코드
  const materialCodes = parseMaterialCodeSheet(wb);
  console.log(`[제조원가 파서] 재질코드: ${materialCodes.length}건`);

  // 1f. 도료배합기준
  const paintMixRatios = parsePaintMixSheet(wb);
  console.log(`[제조원가 파서] 도료배합기준: ${paintMixRatios.length}건`);

  return {
    bomRecords,
    refInfo,
    purchasePrices,
    materialCodes,
    paintMixRatios,
    bomCostMap,
    productList,
  };
}
