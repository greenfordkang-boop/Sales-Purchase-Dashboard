import * as XLSX from 'xlsx';

// ============================================
// Types (마스터 테이블 대응)
// ============================================

export interface BomMasterRecord {
  parentPn: string;
  childPn: string;
  level: number;
  qty: number;
  childName: string;
  partType: string;
  supplier: string;
}

export interface ProductCodeRecord {
  productCode: string;
  customerPn: string;
  productName: string;
  customer: string;
  model: string;
  extraData?: Record<string, unknown>;
}

export interface ReferenceInfoRecord {
  itemCode: string;
  customerPn: string;
  itemName: string;
  supplyType: string;
  processType: string;
  netWeight: number;
  runnerWeight: number;
  cavity: number;
  lossRate: number;
  paintQty1: number;
  paintQty2: number;
  paintQty3: number;
  rawMaterialCode1: string;
  rawMaterialCode2: string;
  rawMaterialCode3: string;
  rawMaterialCode4: string;
  extraData?: Record<string, unknown>;
}

export interface EquipmentRecord {
  equipmentCode: string;
  equipmentName: string;
  tonnage: number;
  extraData?: Record<string, unknown>;
}

export interface MaterialCodeRecord {
  materialCode: string;
  materialName: string;
  materialType: string;
  unit: string;
  lossRate: number;
  currentPrice: number;
  extraData?: Record<string, unknown>;
}

export interface DataQualityIssue {
  issueType: string;
  itemCode: string;
  itemName: string;
  fieldName: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  resolved: boolean;
}

export interface BomMasterParseResult {
  bom: BomMasterRecord[];
  productCodes: ProductCodeRecord[];
  referenceInfo: ReferenceInfoRecord[];
  equipment: EquipmentRecord[];
  materialCodes: MaterialCodeRecord[];
  qualityIssues: DataQualityIssue[];
  sheetStats: { name: string; rows: number }[];
}

// ============================================
// Sheet Name Patterns (유연한 시트 매칭)
// ============================================

const SHEET_PATTERNS = {
  bom: /^bom$/i,
  productCode: /제품코드|product.*code/i,
  referenceInfo: /기준정보|reference.*info/i,
  equipment: /설비코드|equipment/i,
  materialCode: /재질코드|material.*code/i,
};

// ============================================
// Header Patterns (기존 bomDataParser 패턴 재사용)
// ============================================

const BOM_HEADERS: Record<string, RegExp> = {
  parentPn: /모품번|parent.*p[\/.]?n|상위품번/i,
  childPn: /자품번|child.*p[\/.]?n|하위품번|자재코드/i,
  level: /레벨|level|lv|단계/i,
  qty: /소요량|수량|qty|quantity|사용량/i,
  childName: /자품명|child.*name|부품명|자재명|품명/i,
  supplier: /협력업체|업체|supplier|vendor|거래처/i,
  partType: /부품유형|유형|type|구분|분류/i,
};

const PRODUCT_CODE_HEADERS: Record<string, RegExp> = {
  productCode: /제품코드|product.*code|품목코드/i,
  customerPn: /고객사.*p.?n|customer.*p.?n|고객.*품번/i,
  productName: /제품명|product.*name|품목명|품명/i,
  customer: /고객사|customer|거래처/i,
  model: /모델|model|품종|차종/i,
};

const REFERENCE_INFO_HEADERS: Record<string, RegExp> = {
  itemCode: /품목코드|item.*code|제품코드/i,
  customerPn: /고객사.*p.?n|customer.*p.?n/i,
  itemName: /품목명|item.*name|품명/i,
  supplyType: /조달구분|supply.*type|조달/i,
  processType: /품목유형|process.*type|유형/i,
  netWeight: /net.*중량|net.*weight|순중량|제품중량/i,
  runnerWeight: /runner.*중량|runner.*weight|런너/i,
  cavity: /cavity|캐비티|cav/i,
  lossRate: /loss.*율|loss.*rate|로스율|손실율/i,
  paintQty1: /paint.*1도|도장량.*1|1도.*도장|도장량1/i,
  paintQty2: /paint.*2도|도장량.*2|2도.*도장|도장량2/i,
  paintQty3: /paint.*3도|도장량.*3|3도.*도장|도장량3/i,
  rawMaterialCode1: /원재료코드1|raw.*material.*1|원재료1/i,
  rawMaterialCode2: /원재료코드2|raw.*material.*2|원재료2/i,
  rawMaterialCode3: /원재료코드3|raw.*material.*3|원재료3/i,
  rawMaterialCode4: /원재료코드4|raw.*material.*4|원재료4/i,
};

const EQUIPMENT_HEADERS: Record<string, RegExp> = {
  equipmentCode: /설비코드|equipment.*code|설비번호/i,
  equipmentName: /설비명|equipment.*name|설비/i,
  tonnage: /톤수|tonnage|ton|톤/i,
};

const MATERIAL_CODE_HEADERS: Record<string, RegExp> = {
  materialCode: /^재질코드$|material.*code/i,
  materialName: /^재질명$|material.*name/i,
  materialType: /^재질분류$|^재질구분$|material.*type/i,
  unit: /^단위$|^unit$/i,
  lossRate: /loss.*율|loss.*rate|^로스율/i,
  currentPrice: /단가|가격|price/i,
};

// ============================================
// Generic header matcher
// ============================================

function matchHeaders(headers: string[], patterns: Record<string, RegExp>): Record<string, number> {
  const mapping: Record<string, number> = {};
  for (const [field, pattern] of Object.entries(patterns)) {
    const idx = headers.findIndex(h => pattern.test(h));
    if (idx !== -1) mapping[field] = idx;
  }
  return mapping;
}

function findHeaderRow(rows: unknown[][], patterns: Record<string, RegExp>, maxRows = 10): number {
  for (let i = 0; i < Math.min(maxRows, rows.length); i++) {
    const row = rows[i].map(c => String(c || '').replace(/\r?\n/g, ' ').trim());
    const matched = Object.values(patterns).filter(p => row.some(h => p.test(h)));
    if (matched.length >= 2) return i;
  }
  return -1;
}

const parseNumVal = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

const strVal = (v: unknown): string => String(v ?? '').trim();

// ============================================
// Individual sheet parsers
// ============================================

export function parseBomSheet(rows: unknown[][]): BomMasterRecord[] {
  const headerIdx = findHeaderRow(rows, BOM_HEADERS);
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(c => strVal(c));
  const m = matchHeaders(headers, BOM_HEADERS);
  if (m.parentPn === undefined || m.childPn === undefined) return [];

  const results: BomMasterRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const parentPn = strVal(r[m.parentPn]);
    const childPn = strVal(r[m.childPn]);
    if (!parentPn || !childPn) continue;

    results.push({
      parentPn,
      childPn,
      level: m.level !== undefined ? parseNumVal(r[m.level]) || 1 : 1,
      qty: m.qty !== undefined ? parseNumVal(r[m.qty]) || 1 : 1,
      childName: m.childName !== undefined ? strVal(r[m.childName]) : '',
      partType: m.partType !== undefined ? strVal(r[m.partType]) : '',
      supplier: m.supplier !== undefined ? strVal(r[m.supplier]) : '',
    });
  }
  return results;
}

export function parseProductCodeSheet(rows: unknown[][]): ProductCodeRecord[] {
  const headerIdx = findHeaderRow(rows, PRODUCT_CODE_HEADERS);
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(c => strVal(c));
  const m = matchHeaders(headers, PRODUCT_CODE_HEADERS);
  if (m.productCode === undefined) return [];

  const results: ProductCodeRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const productCode = strVal(r[m.productCode]);
    if (!productCode) continue;

    results.push({
      productCode,
      customerPn: m.customerPn !== undefined ? strVal(r[m.customerPn]) : '',
      productName: m.productName !== undefined ? strVal(r[m.productName]) : '',
      customer: m.customer !== undefined ? strVal(r[m.customer]) : '',
      model: m.model !== undefined ? strVal(r[m.model]) : '',
    });
  }
  return results;
}

export function parseReferenceInfoSheet(rows: unknown[][]): ReferenceInfoRecord[] {
  const headerIdx = findHeaderRow(rows, REFERENCE_INFO_HEADERS);
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(c => strVal(c));
  const m = matchHeaders(headers, REFERENCE_INFO_HEADERS);
  if (m.itemCode === undefined) return [];

  const results: ReferenceInfoRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const itemCode = strVal(r[m.itemCode]);
    if (!itemCode) continue;

    results.push({
      itemCode,
      customerPn: m.customerPn !== undefined ? strVal(r[m.customerPn]) : '',
      itemName: m.itemName !== undefined ? strVal(r[m.itemName]) : '',
      supplyType: m.supplyType !== undefined ? strVal(r[m.supplyType]) : '',
      processType: m.processType !== undefined ? strVal(r[m.processType]) : '',
      netWeight: m.netWeight !== undefined ? parseNumVal(r[m.netWeight]) : 0,
      runnerWeight: m.runnerWeight !== undefined ? parseNumVal(r[m.runnerWeight]) : 0,
      cavity: m.cavity !== undefined ? parseNumVal(r[m.cavity]) || 1 : 1,
      lossRate: m.lossRate !== undefined ? parseNumVal(r[m.lossRate]) : 0,
      paintQty1: m.paintQty1 !== undefined ? parseNumVal(r[m.paintQty1]) : 0,
      paintQty2: m.paintQty2 !== undefined ? parseNumVal(r[m.paintQty2]) : 0,
      paintQty3: m.paintQty3 !== undefined ? parseNumVal(r[m.paintQty3]) : 0,
      rawMaterialCode1: m.rawMaterialCode1 !== undefined ? strVal(r[m.rawMaterialCode1]) : '',
      rawMaterialCode2: m.rawMaterialCode2 !== undefined ? strVal(r[m.rawMaterialCode2]) : '',
      rawMaterialCode3: m.rawMaterialCode3 !== undefined ? strVal(r[m.rawMaterialCode3]) : '',
      rawMaterialCode4: m.rawMaterialCode4 !== undefined ? strVal(r[m.rawMaterialCode4]) : '',
    });
  }
  return results;
}

export function parseEquipmentSheet(rows: unknown[][]): EquipmentRecord[] {
  const headerIdx = findHeaderRow(rows, EQUIPMENT_HEADERS);
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(c => strVal(c));
  const m = matchHeaders(headers, EQUIPMENT_HEADERS);
  if (m.equipmentCode === undefined) return [];

  const results: EquipmentRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const equipmentCode = strVal(r[m.equipmentCode]);
    if (!equipmentCode) continue;

    results.push({
      equipmentCode,
      equipmentName: m.equipmentName !== undefined ? strVal(r[m.equipmentName]) : '',
      tonnage: m.tonnage !== undefined ? parseNumVal(r[m.tonnage]) : 0,
    });
  }
  return results;
}

export function parseMaterialCodeSheet(rows: unknown[][]): MaterialCodeRecord[] {
  const headerIdx = findHeaderRow(rows, MATERIAL_CODE_HEADERS);
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map(c => strVal(c));
  const m = matchHeaders(headers, MATERIAL_CODE_HEADERS);
  console.log(`[재질코드 파싱] 헤더(row ${headerIdx}):`, headers.filter(Boolean).join(' | '));
  console.log(`[재질코드 파싱] 매칭결과:`, JSON.stringify(m));
  if (m.materialCode === undefined) return [];

  const results: MaterialCodeRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const materialCode = strVal(r[m.materialCode]);
    if (!materialCode) continue;

    results.push({
      materialCode,
      materialName: m.materialName !== undefined ? strVal(r[m.materialName]) : '',
      materialType: m.materialType !== undefined ? strVal(r[m.materialType]) : '',
      unit: m.unit !== undefined ? strVal(r[m.unit]) : '',
      lossRate: m.lossRate !== undefined ? parseNumVal(r[m.lossRate]) : 0,
      currentPrice: m.currentPrice !== undefined ? parseNumVal(r[m.currentPrice]) : 0,
    });
  }
  return results;
}

// ============================================
// 데이터 품질 검사
// ============================================

export function detectDataQualityIssues(
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const matCodeSet = new Set(materialCodes.map(m => m.materialCode.trim().toUpperCase()));

  for (const item of refInfo) {
    // 사출 누락: 자작 + 사출 유형인데 net_weight=0
    const isSelfMade = !item.supplyType || item.supplyType.includes('자작');
    const isInjection = !item.processType || item.processType.includes('사출');

    if (isSelfMade && isInjection && item.netWeight <= 0) {
      issues.push({
        issueType: 'injection_missing',
        itemCode: item.itemCode,
        itemName: item.itemName,
        fieldName: 'netWeight',
        severity: 'warning',
        description: `사출 품목이지만 NET중량이 0입니다.`,
        resolved: false,
      });
    }

    // 도장 누락: 도장 유형인데 paintQty 전부 0
    const isPaint = item.processType?.includes('도장');
    if (isPaint && item.paintQty1 <= 0 && item.paintQty2 <= 0 && item.paintQty3 <= 0) {
      issues.push({
        issueType: 'paint_missing',
        itemCode: item.itemCode,
        itemName: item.itemName,
        fieldName: 'paintQty',
        severity: 'warning',
        description: `도장 품목이지만 도장량(1~3도)이 모두 0입니다.`,
        resolved: false,
      });
    }

    // 원재료코드 누락 (RESIN)
    if (isSelfMade && isInjection && item.netWeight > 0 && !item.rawMaterialCode1) {
      issues.push({
        issueType: 'raw_material_missing',
        itemCode: item.itemCode,
        itemName: item.itemName,
        fieldName: 'rawMaterialCode1',
        severity: 'warning',
        description: `사출 품목이지만 원재료코드1이 없습니다.`,
        resolved: false,
      });
    }

    // 원재료코드가 재질코드 마스터에 없는 경우
    if (item.rawMaterialCode1 && !matCodeSet.has(item.rawMaterialCode1.trim().toUpperCase())) {
      issues.push({
        issueType: 'material_code_not_found',
        itemCode: item.itemCode,
        itemName: item.itemName,
        fieldName: 'rawMaterialCode1',
        severity: 'info',
        description: `원재료코드1 [${item.rawMaterialCode1}]이 재질코드 마스터에 없습니다.`,
        resolved: false,
      });
    }
  }

  return issues;
}

// ============================================
// 통합 파서: Excel 5개 시트 일괄 파싱
// ============================================

export function parseBomMasterExcel(buffer: ArrayBuffer): BomMasterParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  const sheetStats: { name: string; rows: number }[] = [];

  // 시트 이름 매칭
  const findSheet = (pattern: RegExp): string | undefined =>
    sheetNames.find(n => pattern.test(n));

  const readSheet = (name?: string): unknown[][] => {
    if (!name) return [];
    const sheet = workbook.Sheets[name];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  };

  // BOM 시트
  const bomSheetName = findSheet(SHEET_PATTERNS.bom);
  const bomRows = readSheet(bomSheetName);
  const bom = parseBomSheet(bomRows);
  if (bomSheetName) sheetStats.push({ name: bomSheetName, rows: bom.length });

  // 제품코드 시트
  const pcSheetName = findSheet(SHEET_PATTERNS.productCode);
  const pcRows = readSheet(pcSheetName);
  const productCodes = parseProductCodeSheet(pcRows);
  if (pcSheetName) sheetStats.push({ name: pcSheetName, rows: productCodes.length });

  // 기준정보 시트
  const riSheetName = findSheet(SHEET_PATTERNS.referenceInfo);
  const riRows = readSheet(riSheetName);
  const referenceInfo = parseReferenceInfoSheet(riRows);
  if (riSheetName) sheetStats.push({ name: riSheetName, rows: referenceInfo.length });

  // 설비코드 시트
  const eqSheetName = findSheet(SHEET_PATTERNS.equipment);
  const eqRows = readSheet(eqSheetName);
  const equipment = parseEquipmentSheet(eqRows);
  if (eqSheetName) sheetStats.push({ name: eqSheetName, rows: equipment.length });

  // 재질코드 시트
  const mcSheetName = findSheet(SHEET_PATTERNS.materialCode);
  const mcRows = readSheet(mcSheetName);
  const materialCodes = parseMaterialCodeSheet(mcRows);
  if (mcSheetName) sheetStats.push({ name: mcSheetName, rows: materialCodes.length });

  // 데이터 품질 검사
  const qualityIssues = detectDataQualityIssues(referenceInfo, materialCodes);

  console.log(`[BOM 마스터 파싱] BOM: ${bom.length}, 제품코드: ${productCodes.length}, 기준정보: ${referenceInfo.length}, 설비: ${equipment.length}, 재질: ${materialCodes.length}, 품질이슈: ${qualityIssues.length}`);

  return { bom, productCodes, referenceInfo, equipment, materialCodes, qualityIssues, sheetStats };
}

// ============================================
// BOM정보 조립 (BOM + 기준정보 + 재질코드 JOIN)
// ============================================

export interface AssembledBomInfo {
  parentPn: string;
  childPn: string;
  childName: string;
  level: number;
  qty: number;
  supplier: string;
  partType: string;
  netWeight: number;
  runnerWeight: number;
  cavity: number;
  lossRate: number;
  rawMaterialCode1: string;
  materialPrice: number;
  processType: string;
  supplyType: string;
}

export function assembleBomInfo(
  bom: BomMasterRecord[],
  refInfo: ReferenceInfoRecord[],
  materialCodes: MaterialCodeRecord[],
): AssembledBomInfo[] {
  const normalizePn = (pn: string) => pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

  // 기준정보 맵 (itemCode → record)
  const refMap = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    refMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refMap.set(normalizePn(ri.customerPn), ri);
  }

  // 재질코드 가격 맵
  const priceMap = new Map<string, number>();
  for (const mc of materialCodes) {
    if (mc.currentPrice > 0) {
      priceMap.set(normalizePn(mc.materialCode), mc.currentPrice);
    }
  }

  return bom.map(b => {
    const ref = refMap.get(normalizePn(b.childPn)) || refMap.get(normalizePn(b.parentPn));
    const materialPrice = ref?.rawMaterialCode1
      ? (priceMap.get(normalizePn(ref.rawMaterialCode1)) || 0)
      : 0;

    return {
      parentPn: b.parentPn,
      childPn: b.childPn,
      childName: b.childName || ref?.itemName || '',
      level: b.level,
      qty: b.qty,
      supplier: b.supplier,
      partType: b.partType,
      netWeight: ref?.netWeight || 0,
      runnerWeight: ref?.runnerWeight || 0,
      cavity: ref?.cavity || 1,
      lossRate: ref?.lossRate || 0,
      rawMaterialCode1: ref?.rawMaterialCode1 || '',
      materialPrice,
      processType: ref?.processType || '',
      supplyType: ref?.supplyType || '',
    };
  });
}
