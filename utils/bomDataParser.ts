import * as XLSX from 'xlsx';

// ============================================
// Types
// ============================================

/** 고객사 P/N ↔ 내부 품목코드 매핑 */
export interface PnMapping {
  customerPn: string;  // 고객사 P/N (매출 partNo에 해당)
  internalCode: string; // 내부 품목코드 (BOM parentPn / 구매 itemCode에 해당)
  partName: string;
  rawMaterialCode1?: string; // 원재료코드1
  rawMaterialCode2?: string; // 원재료코드2
  supplyType?: string;        // 조달구분: '자작' | '외주' | '구매'
  processType?: string;       // 품목유형: '사출' | '조립' | '도장'
  purchaseUnitPrice?: number; // 구매단가
  materialCost?: number;      // 재료비 (총 자재비 단가)
  injectionCost?: number;     // 사출재료비 단가 (RESIN)
  paintCost?: number;         // 도장재료비 단가 (PAINT)
}

export interface BomRecord {
  parentPn: string;   // 모품번
  childPn: string;    // 자품번
  level: number;      // 레벨
  qty: number;        // 소요량 (1개 모품 기준)
  childName: string;  // 자품명
  supplier: string;   // 협력업체
  partType: string;   // 부품유형
}

export interface YieldRow {
  childPn: string;          // 자재 품번
  childName: string;        // 자재 품명
  supplier: string;         // 협력업체
  parentProducts: string[]; // 관련 모품번 리스트
  standardReq: number;      // 표준소요량
  inputQty: number;         // 투입수량
  yieldRate: number;        // 수율(%)
  diff: number;             // 차이(투입-표준)
  status: 'normal' | 'over' | 'under' | 'noMatch' | 'otherPeriod' | 'zeroInput' | 'rawMatch';
}

// ============================================
// CSV Helpers (기존 purchaseDataParser 패턴)
// ============================================

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

const parseNum = (value: string | undefined): number => {
  if (!value) return 0;
  const clean = value.replace(/[",\s]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

// ============================================
// 컬럼명 매칭 (유연한 헤더 인식)
// ============================================

const HEADER_PATTERNS: Record<string, RegExp> = {
  parentPn: /모품번|parent.*p[\/.]?n|상위품번|모품목/i,
  childPn: /자품번|child.*p[\/.]?n|하위품번|자품목|자재코드|부품코드/i,
  level: /레벨|level|lv|단계/i,
  qty: /소요량|수량|qty|quantity|사용량|usage/i,
  childName: /자품명|child.*name|부품명|자재명|품명/i,
  supplier: /협력업체|업체|supplier|vendor|거래처/i,
  partType: /부품유형|유형|type|구분|분류/i,
};

const matchHeader = (headers: string[]): Record<string, number> => {
  const mapping: Record<string, number> = {};

  for (const [field, pattern] of Object.entries(HEADER_PATTERNS)) {
    const idx = headers.findIndex(h => pattern.test(h));
    if (idx !== -1) mapping[field] = idx;
  }

  return mapping;
};

// ============================================
// BOM CSV 파서
// ============================================

export const parseBomCSV = (csvContent: string): BomRecord[] => {
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const mapping = matchHeader(headers);

  // 최소 필수 컬럼: parentPn, childPn
  if (mapping.parentPn === undefined || mapping.childPn === undefined) {
    console.warn('BOM CSV: 필수 컬럼(모품번, 자품번)을 찾을 수 없습니다. 헤더:', headers);
    return [];
  }

  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    if (cols.length < 2) return null;

    const parentPn = cols[mapping.parentPn] || '';
    const childPn = cols[mapping.childPn] || '';
    if (!parentPn || !childPn) return null;

    return {
      parentPn,
      childPn,
      level: mapping.level !== undefined ? parseNum(cols[mapping.level]) || 1 : 1,
      qty: mapping.qty !== undefined ? parseNum(cols[mapping.qty]) || 1 : 1,
      childName: mapping.childName !== undefined ? (cols[mapping.childName] || '') : '',
      supplier: mapping.supplier !== undefined ? (cols[mapping.supplier] || '') : '',
      partType: mapping.partType !== undefined ? (cols[mapping.partType] || '') : '',
    };
  }).filter((r): r is BomRecord => r !== null);
};

// ============================================
// BOM Excel 파서 (xlsx 라이브러리 활용)
// ============================================

export const parseBomExcel = (buffer: ArrayBuffer): BomRecord[] => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => String(h).trim());
  const mapping = matchHeader(headers);

  if (mapping.parentPn === undefined || mapping.childPn === undefined) {
    console.warn('BOM Excel: 필수 컬럼(모품번, 자품번)을 찾을 수 없습니다. 헤더:', headers);
    return [];
  }

  return rows.slice(1).map(cols => {
    const parentPn = String(cols[mapping.parentPn] || '').trim();
    const childPn = String(cols[mapping.childPn] || '').trim();
    if (!parentPn || !childPn) return null;

    return {
      parentPn,
      childPn,
      level: mapping.level !== undefined ? parseNum(String(cols[mapping.level])) || 1 : 1,
      qty: mapping.qty !== undefined ? parseNum(String(cols[mapping.qty])) || 1 : 1,
      childName: mapping.childName !== undefined ? String(cols[mapping.childName] || '').trim() : '',
      supplier: mapping.supplier !== undefined ? String(cols[mapping.supplier] || '').trim() : '',
      partType: mapping.partType !== undefined ? String(cols[mapping.partType] || '').trim() : '',
    };
  }).filter((r): r is BomRecord => r !== null);
};

// ============================================
// 품번 매핑 파서 (표준재료비 엑셀 → 고객사P/N ↔ 내부코드)
// ============================================

/**
 * 표준재료비 엑셀의 '품목별재료비' 시트에서 품번 매핑 추출
 * col3: 품목코드(내부), col4: 고객사 P/N, col5: 품목명
 */
export const parsePnMappingFromExcel = (buffer: ArrayBuffer): PnMapping[] => {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // '품목별재료비' 시트 찾기
  const sheetName = workbook.SheetNames.find(n => n.includes('품목별재료비')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // 헤더 행 탐색: '품목코드' 포함된 행 찾기
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i].map((c: any) => String(c).replace(/\r?\n/g, ' ').trim());
    if (row.some((c: string) => /품목코드/.test(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map((c: any) => String(c).replace(/\r?\n/g, ' ').trim());
  const codeIdx = headers.findIndex((h: string) => /품목코드/.test(h));
  const custPnIdx = headers.findIndex((h: string) => /고객사.*P.?N/i.test(h));
  const nameIdx = headers.findIndex((h: string) => /품목명/.test(h));

  if (codeIdx === -1 || custPnIdx === -1) return [];

  const results: PnMapping[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const internalCode = String(rows[i][codeIdx] || '').trim();
    const customerPn = String(rows[i][custPnIdx] || '').trim();
    if (!internalCode || !customerPn) continue;

    results.push({
      customerPn,
      internalCode,
      partName: nameIdx !== -1 ? String(rows[i][nameIdx] || '').trim() : '',
    });
  }

  return results;
};

// ============================================
// 자재마스터 통합 파서 (품목 마스터 시트)
// ============================================

/**
 * 자재마스터 엑셀의 '품목 마스터' 시트에서 품번 매핑 추출
 * 품목코드(A), 고객사P/N(B), 품목명(C), 원재료코드1(M), 원재료코드2(N)
 */
export const parseMaterialMasterExcel = (buffer: ArrayBuffer): PnMapping[] => {
  const workbook = XLSX.read(buffer, { type: 'array' });

  // '품목 마스터' 시트 찾기
  const sheetName = workbook.SheetNames.find(n => /품목.*마스터/i.test(n)) || workbook.SheetNames[1] || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  // 헤더 행 탐색
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i].map((c: any) => String(c).replace(/\r?\n/g, ' ').trim());
    if (row.some((c: string) => /품목코드/.test(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = rows[headerIdx].map((c: any) => String(c).replace(/\r?\n/g, ' ').trim());
  const codeIdx = headers.findIndex((h: string) => /^품목코드$/.test(h));
  const custPnIdx = headers.findIndex((h: string) => /고객사.*P.?N/i.test(h));
  const nameIdx = headers.findIndex((h: string) => /품목명/.test(h));
  const rawCode1Idx = headers.findIndex((h: string) => /원재료코드1/.test(h));
  const rawCode2Idx = headers.findIndex((h: string) => /원재료코드2/.test(h));
  const supplyTypeIdx = headers.findIndex((h: string) => /조달구분/.test(h));
  const processTypeIdx = headers.findIndex((h: string) => /품목유형/.test(h));
  const purchasePriceIdx = headers.findIndex((h: string) => /구매단가/.test(h));
  const materialCostIdx = headers.findIndex((h: string) => /^재료비$/.test(h));
  const injectionCostIdx = headers.findIndex((h: string) => /사출.*재료비|사출비/i.test(h));
  const paintCostIdx = headers.findIndex((h: string) => /도장.*재료비|도장비/i.test(h));

  if (codeIdx === -1) return [];

  const parseNumVal = (v: unknown): number => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const results: PnMapping[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const internalCode = String(rows[i][codeIdx] || '').trim();
    if (!internalCode) continue;

    const customerPn = custPnIdx !== -1 ? String(rows[i][custPnIdx] || '').trim() : '';
    const rawCode1 = rawCode1Idx !== -1 ? String(rows[i][rawCode1Idx] || '').trim() : '';
    const rawCode2 = rawCode2Idx !== -1 ? String(rows[i][rawCode2Idx] || '').trim() : '';
    const supplyType = supplyTypeIdx !== -1 ? String(rows[i][supplyTypeIdx] || '').trim() : '';
    const processType = processTypeIdx !== -1 ? String(rows[i][processTypeIdx] || '').trim() : '';
    const purchaseUnitPrice = purchasePriceIdx !== -1 ? parseNumVal(rows[i][purchasePriceIdx]) : 0;
    const matCost = materialCostIdx !== -1 ? parseNumVal(rows[i][materialCostIdx]) : 0;
    const injCost = injectionCostIdx !== -1 ? parseNumVal(rows[i][injectionCostIdx]) : 0;
    const pntCost = paintCostIdx !== -1 ? parseNumVal(rows[i][paintCostIdx]) : 0;

    results.push({
      customerPn,
      internalCode,
      partName: nameIdx !== -1 ? String(rows[i][nameIdx] || '').trim() : '',
      ...(rawCode1 ? { rawMaterialCode1: rawCode1 } : {}),
      ...(rawCode2 ? { rawMaterialCode2: rawCode2 } : {}),
      ...(supplyType ? { supplyType } : {}),
      ...(processType ? { processType } : {}),
      ...(purchaseUnitPrice > 0 ? { purchaseUnitPrice } : {}),
      ...(matCost > 0 ? { materialCost: matCost } : {}),
      ...(injCost > 0 ? { injectionCost: injCost } : {}),
      ...(pntCost > 0 ? { paintCost: pntCost } : {}),
    });
  }

  return results;
};

// ============================================
// BOM 전개 알고리즘
// ============================================

/** 모품번별로 BOM 레코드를 그루핑 */
export const buildBomRelations = (records: BomRecord[]): Map<string, BomRecord[]> => {
  const map = new Map<string, BomRecord[]>();
  const seen = new Set<string>();
  for (const rec of records) {
    const dedupKey = `${normalizePn(rec.parentPn)}|${normalizePn(rec.childPn)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const list = map.get(rec.parentPn) || [];
    list.push(rec);
    map.set(rec.parentPn, list);
  }
  return map;
};

interface LeafResult {
  childPn: string;
  childName: string;
  supplier: string;
  totalRequired: number;
  parentPn: string;
}

/** 품번 정규화 (공백, 하이픈, 대소문자 통일) */
export const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/** 모품번에서 leaf 자재까지 재귀 전개 (누적 소요량 곱셈, maxDepth 제한) */
export const expandBomToLeaves = (
  parentPn: string,
  parentQty: number,
  bomRelations: Map<string, BomRecord[]>,
  visited?: Set<string>,
  depth: number = 0,
  maxDepth: number = 10,
): LeafResult[] => {
  const seen = visited || new Set<string>();
  const normalizedParent = normalizePn(parentPn);
  if (seen.has(normalizedParent)) return []; // 순환참조 방지
  seen.add(normalizedParent);

  const children = bomRelations.get(normalizedParent);
  if (!children || children.length === 0) {
    return [];
  }

  const results: LeafResult[] = [];
  for (const child of children) {
    const requiredQty = parentQty * child.qty;
    const normalizedChild = normalizePn(child.childPn);
    const grandChildren = bomRelations.get(normalizedChild);

    // 원재료/구매 부품은 항상 leaf 노드로 처리 (타 제품 BOM 교차 전개 방지)
    const isLeafType = /원재료|구매/.test(child.partType || '');
    if (!grandChildren || grandChildren.length === 0 || depth + 1 >= maxDepth || isLeafType) {
      // leaf 노드 또는 최대 깊이 도달
      results.push({
        childPn: child.childPn,
        childName: child.childName,
        supplier: child.supplier,
        totalRequired: requiredQty,
        parentPn,
      });
    } else {
      // 중간 노드: 재귀 전개
      const subLeaves = expandBomToLeaves(child.childPn, requiredQty, bomRelations, new Set(seen), depth + 1, maxDepth);
      results.push(...subLeaves.map(leaf => ({
        ...leaf,
        parentPn,
      })));
    }
  }

  return results;
};
