import * as pdfjsLib from 'pdfjs-dist';

// Worker 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * 도면에서 추출한 BOM 항목
 */
export interface DrawingBomItem {
  partNo: string;
  partName: string;
  qty: number;
  itemNo: number;    // Part List 순번
  rawText: string;   // 원본 텍스트 라인
}

/**
 * BOM 비교 분석 결과
 */
export interface BomCompareResult {
  /** 도면에 있고 BOM에도 있음 (일치) */
  matched: {
    drawingItem: DrawingBomItem;
    bomChildPn: string;
    bomChildName: string;
    bomQty: number;
    qtyMatch: boolean;
  }[];
  /** 도면에 있지만 BOM에 없음 (누락) */
  missingInBom: DrawingBomItem[];
  /** BOM에 있지만 도면에 없음 (초과) */
  extraInBom: {
    childPn: string;
    childName: string;
    qty: number;
  }[];
  /** 분석 요약 */
  summary: {
    drawingItemCount: number;
    bomItemCount: number;
    matchedCount: number;
    missingCount: number;
    extraCount: number;
    qtyMismatchCount: number;
    matchRate: number;
  };
  /** 추출된 전체 텍스트 (디버그용) */
  rawText: string;
}

/** PDF 텍스트 아이템 (위치 포함) */
interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PDF에서 위치 기반 텍스트 추출 (테이블 구조 보존)
 */
export async function extractTextFromPdf(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const allItems: TextItem[] = [];
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height || Math.abs(item.transform[3]) || 10,
      }));
    allItems.push(...items);

    // 같은 Y좌표 기준으로 행 구성 (Y값 반올림 그룹핑)
    const rows = groupByRows(items);
    const lines = rows.map(row =>
      row.sort((a, b) => a.x - b.x).map(t => t.str).join('\t')
    );
    pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n===PAGE===\n');
}

/** Y좌표 기준으로 같은 행의 텍스트 그룹핑 */
function groupByRows(items: TextItem[], tolerance = 4): TextItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y); // 위 → 아래
  const rows: TextItem[][] = [];
  let currentRow: TextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= tolerance) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  rows.push(currentRow);
  return rows;
}

/**
 * Part List 테이블 영역만 추출
 * 도면의 Part List 헤더를 감지하고 그 이후의 테이블 행만 파싱
 */
export function extractBomFromText(text: string): DrawingBomItem[] {
  const items: DrawingBomItem[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\n/);

  // 1단계: Part List 헤더 행 찾기
  let partListStart = -1;
  let headerColumns: { noIdx: number; pnIdx: number; nameIdx: number; qtyIdx: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    // Part List 헤더 감지 패턴들
    if (
      /PART\s*LIST/i.test(line) ||
      /PARTS\s*LIST/i.test(line) ||
      /부품\s*(목록|리스트)/i.test(line) ||
      /품\s*번.*품\s*명.*수\s*량/i.test(line) ||
      // 테이블 헤더: NO + PART NO (or 품번) + NAME (or 품명) + QTY (or 수량)
      (/\bNO\b/.test(line) && (/PART\s*(NO|NUMBER|CODE)/.test(line) || /품\s*번/.test(line)))
    ) {
      // 헤더 열 위치 파악 (탭 구분)
      const cols = lines[i].split('\t');
      headerColumns = detectHeaderColumns(cols);
      partListStart = i + 1;
      break;
    }
  }

  // Part List 헤더를 찾은 경우: 테이블 행만 파싱
  if (partListStart >= 0 && headerColumns) {
    for (let i = partListStart; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // 다른 섹션 시작 감지 (테이블 끝)
      if (/^(NOTE|NOTES|주기|비고란|REVISION|REV\.|DRAWN|CHECKED|APPROVED|일반\s*공차)/i.test(line)) break;
      if (/===PAGE===/.test(line)) break;

      const cols = line.split('\t');
      const parsed = parsePartListRow(cols, headerColumns);
      if (parsed && !seen.has(normalize(parsed.partNo))) {
        seen.add(normalize(parsed.partNo));
        items.push(parsed);
      }
    }
  }

  // Part List 헤더를 못 찾은 경우: 행 기반 휴리스틱 추출
  if (items.length === 0) {
    for (const line of lines) {
      if (/===PAGE===/.test(line)) continue;
      const cols = line.split('\t');
      // 최소 3열 이상이고, 첫 열이 번호(숫자)이고, 품번 패턴이 포함된 행
      if (cols.length >= 3) {
        const firstCol = cols[0].trim();
        if (/^\d{1,3}$/.test(firstCol)) {
          // 번호 + 품번 + ... 구조로 추정
          const pnCandidate = findPartNoInCols(cols.slice(1));
          if (pnCandidate) {
            const pn = pnCandidate.pn;
            if (!seen.has(normalize(pn))) {
              seen.add(normalize(pn));
              const qty = findQtyInCols(cols);
              const name = findNameInCols(cols, pn);
              items.push({
                partNo: pn,
                partName: name,
                qty,
                itemNo: parseInt(firstCol),
                rawText: line.substring(0, 200),
              });
            }
          }
        }
      }
    }
  }

  // 최후 수단: 전체에서 품번 패턴만 추출 (Part List가 전혀 감지되지 않은 경우)
  if (items.length === 0) {
    const partNoPattern = /[A-Z][A-Z0-9\-_\.]{5,}/gi;
    let itemNo = 1;
    for (const line of lines) {
      if (/===PAGE===/.test(line)) continue;
      const matches = line.match(partNoPattern);
      if (!matches) continue;
      for (const match of matches) {
        const pn = match.trim().toUpperCase();
        if (seen.has(normalize(pn))) continue;
        if (isNoiseToken(pn)) continue;
        seen.add(normalize(pn));
        items.push({
          partNo: pn,
          partName: '',
          qty: 1,
          itemNo: itemNo++,
          rawText: line.trim().substring(0, 200),
        });
      }
    }
  }

  return items;
}

/** 헤더 열에서 NO, PART NO, NAME, QTY 위치 감지 */
function detectHeaderColumns(cols: string[]): { noIdx: number; pnIdx: number; nameIdx: number; qtyIdx: number } | null {
  let noIdx = -1, pnIdx = -1, nameIdx = -1, qtyIdx = -1;

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i].trim().toUpperCase();
    if (/^(NO\.?|번호|ITEM\s*NO|#)$/i.test(c) && noIdx < 0) noIdx = i;
    else if (/PART\s*(NO|NUMBER|CODE|P\/N)|품\s*번|자재\s*코드|DRAWING/i.test(c) && pnIdx < 0) pnIdx = i;
    else if (/PART\s*NAME|품\s*명|자재\s*명|DESCRIPTION|명칭|NAME/i.test(c) && nameIdx < 0) nameIdx = i;
    else if (/QTY|수\s*량|Q'TY|QUANTITY|EA/i.test(c) && qtyIdx < 0) qtyIdx = i;
  }

  // 최소한 품번 열은 있어야 함
  if (pnIdx < 0) return null;
  return { noIdx, pnIdx, nameIdx, qtyIdx };
}

/** Part List 테이블 행 파싱 */
function parsePartListRow(
  cols: string[],
  header: { noIdx: number; pnIdx: number; nameIdx: number; qtyIdx: number }
): DrawingBomItem | null {
  const pnRaw = cols[header.pnIdx]?.trim() || '';
  if (!pnRaw) return null;

  const pn = pnRaw.toUpperCase();
  // 품번 유효성: 최소 4자, 영문+숫자 포함
  if (pn.length < 4) return null;
  if (!/[A-Z]/.test(pn) || !/[0-9]/.test(pn)) return null;
  if (isNoiseToken(pn)) return null;

  const itemNo = header.noIdx >= 0 ? parseInt(cols[header.noIdx]?.trim() || '0') || 0 : 0;
  const partName = header.nameIdx >= 0 ? (cols[header.nameIdx]?.trim() || '') : '';
  let qty = 1;
  if (header.qtyIdx >= 0) {
    const qtyStr = cols[header.qtyIdx]?.trim() || '';
    const parsed = parseInt(qtyStr);
    if (!isNaN(parsed) && parsed > 0) qty = parsed;
  }

  return {
    partNo: pn,
    partName,
    qty,
    itemNo,
    rawText: cols.join(' | ').substring(0, 200),
  };
}

/** 열 배열에서 품번 패턴 찾기 */
function findPartNoInCols(cols: string[]): { pn: string; idx: number } | null {
  for (let i = 0; i < cols.length; i++) {
    const val = cols[i].trim().toUpperCase();
    if (val.length >= 4 && /[A-Z]/.test(val) && /[0-9]/.test(val) && !isNoiseToken(val)) {
      return { pn: val, idx: i };
    }
  }
  return null;
}

/** 열 배열에서 수량 찾기 (작은 정수) */
function findQtyInCols(cols: string[]): number {
  // 뒤에서부터 탐색 (수량은 보통 뒤쪽에 위치)
  for (let i = cols.length - 1; i >= 0; i--) {
    const val = cols[i].trim();
    if (/^\d{1,4}$/.test(val)) {
      const num = parseInt(val);
      if (num > 0 && num < 10000) return num;
    }
  }
  return 1;
}

/** 열 배열에서 품명 찾기 (품번이 아닌 텍스트 열) */
function findNameInCols(cols: string[], pn: string): string {
  for (const col of cols) {
    const val = col.trim();
    if (!val || val === pn || /^\d{1,4}$/.test(val)) continue;
    // 한글 또는 영문 2자 이상의 설명 텍스트
    if (/[가-힣]/.test(val) || (val.length > 3 && /[A-Za-z\s]/.test(val) && val.toUpperCase() !== pn)) {
      return val;
    }
  }
  return '';
}

/** 노이즈 토큰 필터 (날짜, 버전, 일반 키워드 등) */
function isNoiseToken(pn: string): boolean {
  const upper = pn.toUpperCase();
  if (/^\d{4}[-\/]\d{2}/.test(upper)) return true;
  if (/^(REV|VER|DATE|SCALE|SHEET|DRAWN|CHECK|APPRO|TITLE|MATER|TOLER|FINISH|WEIGHT|PROJEC|SURFAC|GENERA|UNLES)/i.test(upper)) return true;
  if (/^(PART\s*LIST|PARTS|DESCRIPTION|QUANTITY|REMARK|MATERIAL)/i.test(upper)) return true;
  // 너무 일반적인 패턴 (숫자만, 영문만 등)
  if (/^[A-Z]+$/.test(upper) && upper.length < 8) return true;
  if (/^\d+$/.test(upper)) return true;
  return false;
}

/**
 * 품번 정규화 (비교용)
 */
const normalize = (pn: string): string =>
  pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

/**
 * 도면 BOM과 현재 BOM 트리 비교 분석
 */
export function compareBomWithDrawing(
  drawingItems: DrawingBomItem[],
  bomChildren: { childPn: string; childName: string; qty: number }[]
): BomCompareResult {
  const matched: BomCompareResult['matched'] = [];
  const missingInBom: DrawingBomItem[] = [];
  const matchedBomPns = new Set<string>();

  // 도면 항목 → BOM 매칭
  for (const di of drawingItems) {
    const diNorm = normalize(di.partNo);
    let found = false;

    for (const bc of bomChildren) {
      const bcNorm = normalize(bc.childPn);
      // 정확 매칭 또는 포함 관계 (부분 일치 허용)
      if (
        diNorm === bcNorm ||
        (diNorm.length >= 6 && bcNorm.length >= 6 && (diNorm.includes(bcNorm) || bcNorm.includes(diNorm)))
      ) {
        if (!matchedBomPns.has(bcNorm)) {
          matched.push({
            drawingItem: di,
            bomChildPn: bc.childPn,
            bomChildName: bc.childName,
            bomQty: bc.qty,
            qtyMatch: di.qty === bc.qty,
          });
          matchedBomPns.add(bcNorm);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      missingInBom.push(di);
    }
  }

  // BOM에 있지만 도면에 없는 항목
  const extraInBom = bomChildren
    .filter(bc => !matchedBomPns.has(normalize(bc.childPn)))
    .map(bc => ({ childPn: bc.childPn, childName: bc.childName, qty: bc.qty }));

  const qtyMismatchCount = matched.filter(m => !m.qtyMatch).length;
  const matchRate = bomChildren.length > 0
    ? Math.round((matched.length / bomChildren.length) * 100)
    : 0;

  return {
    matched,
    missingInBom,
    extraInBom,
    summary: {
      drawingItemCount: drawingItems.length,
      bomItemCount: bomChildren.length,
      matchedCount: matched.length,
      missingCount: missingInBom.length,
      extraCount: extraInBom.length,
      qtyMismatchCount,
      matchRate,
    },
    rawText: '',
  };
}
