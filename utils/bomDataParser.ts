import * as XLSX from 'xlsx';

// ============================================
// Types
// ============================================

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
  status: 'normal' | 'over' | 'under' | 'noData';
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
// BOM 전개 알고리즘
// ============================================

/** 모품번별로 BOM 레코드를 그루핑 */
export const buildBomRelations = (records: BomRecord[]): Map<string, BomRecord[]> => {
  const map = new Map<string, BomRecord[]>();
  for (const rec of records) {
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
const normalizePn = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/** 모품번에서 최하위 leaf 자재까지 재귀 전개 (누적 소요량 곱셈) */
export const expandBomToLeaves = (
  parentPn: string,
  parentQty: number,
  bomRelations: Map<string, BomRecord[]>,
  visited?: Set<string>
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

    if (!grandChildren || grandChildren.length === 0) {
      // leaf 노드
      results.push({
        childPn: child.childPn,
        childName: child.childName,
        supplier: child.supplier,
        totalRequired: requiredQty,
        parentPn,
      });
    } else {
      // 중간 노드: 재귀 전개
      const subLeaves = expandBomToLeaves(child.childPn, requiredQty, bomRelations, new Set(seen));
      results.push(...subLeaves.map(leaf => ({
        ...leaf,
        parentPn,
      })));
    }
  }

  return results;
};
