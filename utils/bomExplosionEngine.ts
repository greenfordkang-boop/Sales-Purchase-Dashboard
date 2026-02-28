import { normalizePn } from './bomDataParser';
import type {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
} from './bomMasterParser';

// ============================================
// Types
// ============================================

export interface BomTreeNode {
  pn: string;
  name: string;
  level: number;
  qty: number;        // 누적 소요량
  unitQty: number;    // 단위 소요량 (BOM상)
  partType: string;
  supplier: string;
  children: BomTreeNode[];
  netWeight?: number;
  cavity?: number;
  processType?: string;
  supplyType?: string;
}

export interface ReversePath {
  path: { pn: string; name: string; qty: number }[];
}

export interface SearchIndexEntry {
  pn: string;
  name: string;
  customer: string;
  model: string;
  customerPn: string;
  type: 'product' | 'part' | 'material';
  displayText: string;
}

// ============================================
// Map Builders
// ============================================

/** parentPn -> children 그루핑 (정전개용, 중복 제거) */
export function buildForwardMap(
  bomRecords: BomMasterRecord[],
): Map<string, BomMasterRecord[]> {
  const map = new Map<string, BomMasterRecord[]>();
  const seen = new Set<string>();
  for (const rec of bomRecords) {
    const key = normalizePn(rec.parentPn);
    const dedupKey = `${key}|${normalizePn(rec.childPn)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const list = map.get(key) || [];
    list.push(rec);
    map.set(key, list);
  }
  return map;
}

/** childPn -> parents 그루핑 (역전개용) */
export function buildReverseMap(
  bomRecords: BomMasterRecord[],
): Map<string, BomMasterRecord[]> {
  const map = new Map<string, BomMasterRecord[]>();
  for (const rec of bomRecords) {
    const key = normalizePn(rec.childPn);
    const list = map.get(key) || [];
    list.push(rec);
    map.set(key, list);
  }
  return map;
}

// ============================================
// Forward Explosion (정전개)
// ============================================

export function expandForwardTree(
  pn: string,
  forwardMap: Map<string, BomMasterRecord[]>,
  refInfoMap?: Map<string, ReferenceInfoRecord>,
  parentQty = 1,
  depth = 0,
  maxDepth = 10,
  visited: Set<string> = new Set(),
): BomTreeNode {
  const normalizedPn = normalizePn(pn);
  const children = forwardMap.get(normalizedPn) || [];
  const ref = refInfoMap?.get(normalizedPn);

  // 현재 노드의 이름: children의 첫 번째 childName에서 가져오거나 ref에서 가져옴
  // 최상위 노드는 forwardMap에서 parentPn으로 등록됨
  const nameFromRef = ref?.itemName || '';
  const nameFromBom = children.length > 0 ? '' : '';

  // 자기 자신의 이름을 알기 위해 reverseMap에서도 찾을 수 있지만,
  // 여기서는 ref 정보 우선, 없으면 빈 문자열
  const nodeName = nameFromRef || nameFromBom;

  const node: BomTreeNode = {
    pn,
    name: nodeName,
    level: depth,
    qty: parentQty,
    unitQty: parentQty,
    partType: '',
    supplier: '',
    children: [],
    ...(ref ? {
      netWeight: ref.netWeight || undefined,
      cavity: ref.cavity || undefined,
      processType: ref.processType || undefined,
      supplyType: ref.supplyType || undefined,
    } : {}),
  };

  if (depth >= maxDepth || visited.has(normalizedPn)) {
    return node;
  }

  visited.add(normalizedPn);

  for (const child of children) {
    const childNorm = normalizePn(child.childPn);
    const cumulativeQty = parentQty * child.qty;

    const childRef = refInfoMap?.get(childNorm);

    // 원재료/구매 부품은 항상 leaf 노드로 처리 (타 제품 BOM 교차 전개 방지)
    const isLeafType = /원재료|구매/.test(child.partType || '');

    let childNode: BomTreeNode;
    if (isLeafType) {
      childNode = {
        pn: child.childPn,
        name: child.childName || childRef?.itemName || '',
        level: depth + 1,
        qty: cumulativeQty,
        unitQty: child.qty,
        partType: child.partType || '',
        supplier: child.supplier || '',
        children: [],
        ...(childRef ? {
          netWeight: childRef.netWeight || undefined,
          cavity: childRef.cavity || undefined,
          processType: childRef.processType || undefined,
          supplyType: childRef.supplyType || undefined,
        } : {}),
      };
    } else {
      childNode = expandForwardTree(
        child.childPn,
        forwardMap,
        refInfoMap,
        cumulativeQty,
        depth + 1,
        maxDepth,
        new Set(visited),
      );
    }

    // child 정보 업데이트
    childNode.name = child.childName || childRef?.itemName || childNode.name;
    childNode.unitQty = child.qty;
    childNode.partType = child.partType || '';
    childNode.supplier = child.supplier || '';

    if (childRef) {
      childNode.netWeight = childRef.netWeight || undefined;
      childNode.cavity = childRef.cavity || undefined;
      childNode.processType = childRef.processType || undefined;
      childNode.supplyType = childRef.supplyType || undefined;
    }

    // 조달=자작이면 협력업체 공란 처리
    if (childNode.supplyType && /자작/.test(childNode.supplyType)) {
      childNode.supplier = '';
    }

    node.children.push(childNode);
  }

  return node;
}

// ============================================
// Reverse Explosion (역전개)
// ============================================

export function expandReversePaths(
  pn: string,
  reverseMap: Map<string, BomMasterRecord[]>,
  maxDepth = 10,
): ReversePath[] {
  const results: ReversePath[] = [];

  function dfs(
    currentPn: string,
    currentPath: { pn: string; name: string; qty: number }[],
    visited: Set<string>,
    depth: number,
  ) {
    const normalizedCurrent = normalizePn(currentPn);
    const parents = reverseMap.get(normalizedCurrent);

    if (!parents || parents.length === 0 || depth >= maxDepth) {
      // 최상위 도달 또는 깊이 제한
      if (currentPath.length > 1) {
        results.push({ path: [...currentPath].reverse() });
      }
      return;
    }

    for (const parent of parents) {
      const parentNorm = normalizePn(parent.parentPn);
      if (visited.has(parentNorm)) continue;

      const newVisited = new Set(visited);
      newVisited.add(parentNorm);

      dfs(
        parent.parentPn,
        [...currentPath, { pn: parent.parentPn, name: '', qty: parent.qty }],
        newVisited,
        depth + 1,
      );
    }

    // 부모가 있지만 모두 visited인 경우에도 경로 저장
    const allVisited = parents.every(p => visited.has(normalizePn(p.parentPn)));
    if (allVisited && currentPath.length > 1) {
      results.push({ path: [...currentPath].reverse() });
    }
  }

  dfs(pn, [{ pn, name: '', qty: 1 }], new Set([normalizePn(pn)]), 0);

  return results;
}

// ============================================
// Search Index
// ============================================

export function buildSearchIndex(
  bomRecords: BomMasterRecord[],
  productCodes: ProductCodeRecord[],
  refInfo: ReferenceInfoRecord[],
): SearchIndexEntry[] {
  // 제품코드 맵: productCode(정규화) -> record
  const productMap = new Map<string, ProductCodeRecord>();
  for (const pc of productCodes) {
    productMap.set(normalizePn(pc.productCode), pc);
    if (pc.customerPn) productMap.set(normalizePn(pc.customerPn), pc);
  }

  // 기준정보 맵: itemCode(정규화) -> record
  const refMap = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    refMap.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) refMap.set(normalizePn(ri.customerPn), ri);
  }

  // forwardMap으로 leaf 여부 판별
  const forwardMap = buildForwardMap(bomRecords);

  // 모든 유니크 P/N 수집 (parent + child + productCode + refInfo)
  const pnSet = new Set<string>();
  const pnOriginal = new Map<string, string>(); // normalized -> original
  const pnName = new Map<string, string>();       // normalized -> name

  for (const rec of bomRecords) {
    const parentNorm = normalizePn(rec.parentPn);
    const childNorm = normalizePn(rec.childPn);

    if (!pnSet.has(parentNorm)) {
      pnSet.add(parentNorm);
      pnOriginal.set(parentNorm, rec.parentPn);
    }
    if (!pnSet.has(childNorm)) {
      pnSet.add(childNorm);
      pnOriginal.set(childNorm, rec.childPn);
      pnName.set(childNorm, rec.childName);
    }
  }

  // productCodes도 검색 인덱스에 추가 (BOM에 없는 제품코드도 검색 가능)
  for (const pc of productCodes) {
    const norm = normalizePn(pc.productCode);
    if (!pnSet.has(norm)) {
      pnSet.add(norm);
      pnOriginal.set(norm, pc.productCode);
      if (pc.productName) pnName.set(norm, pc.productName);
    }
    // customerPn도 별도 엔트리로 추가 (고객사 P/N으로 직접 검색 가능)
    if (pc.customerPn) {
      const custNorm = normalizePn(pc.customerPn);
      if (!pnSet.has(custNorm)) {
        pnSet.add(custNorm);
        pnOriginal.set(custNorm, pc.customerPn);
        if (pc.productName) pnName.set(custNorm, pc.productName);
      }
    }
  }

  // refInfo의 customerPn도 추가 (BOM에 없지만 검색 가능하게)
  for (const ri of refInfo) {
    const norm = normalizePn(ri.itemCode);
    if (!pnSet.has(norm)) {
      pnSet.add(norm);
      pnOriginal.set(norm, ri.itemCode);
      if (ri.itemName) pnName.set(norm, ri.itemName);
    }
    if (ri.customerPn) {
      const custNorm = normalizePn(ri.customerPn);
      if (!pnSet.has(custNorm)) {
        pnSet.add(custNorm);
        pnOriginal.set(custNorm, ri.customerPn);
        if (ri.itemName) pnName.set(custNorm, ri.itemName);
      }
    }
  }

  const entries: SearchIndexEntry[] = [];

  for (const norm of pnSet) {
    const original = pnOriginal.get(norm) || '';
    const pc = productMap.get(norm);
    const ri = refMap.get(norm);
    const hasChildren = forwardMap.has(norm);
    const isChild = !hasChildren && !pc;

    // type 분류
    let type: 'product' | 'part' | 'material';
    if (pc) {
      type = 'product';
    } else if (isChild) {
      type = 'material';
    } else {
      type = 'part';
    }

    const name = pnName.get(norm) || ri?.itemName || pc?.productName || '';
    const customer = pc?.customer || ri?.customerName || '';
    const model = pc?.model || '';
    const customerPn = ri?.customerPn || pc?.customerPn || '';

    const displayParts = [original];
    if (name) displayParts.push(name);
    if (customerPn && normalizePn(customerPn) !== norm) displayParts.push(`[${customerPn}]`);
    if (customer) displayParts.push(`(${customer})`);
    if (model) displayParts.push(model);

    entries.push({
      pn: original,
      name,
      customer,
      model,
      customerPn,
      type,
      displayText: displayParts.join(' '),
    });
  }

  // type별 정렬: product -> part -> material
  const typeOrder = { product: 0, part: 1, material: 2 };
  entries.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  const withCustPn = entries.filter(e => e.customerPn);
  console.log(`[BOM검색] 인덱스 빌드: ${entries.length}건 (customerPn 있는 항목: ${withCustPn.length}건, refInfo: ${refInfo.length}건, productCodes: ${productCodes.length}건)`);
  if (withCustPn.length > 0) {
    console.log(`[BOM검색] customerPn 샘플:`, withCustPn.slice(0, 5).map(e => `${e.pn} → [${e.customerPn}]`));
  }

  return entries;
}

// ============================================
// Search Function
// ============================================

export function searchIndex(
  query: string,
  index: SearchIndexEntry[],
  limit = 20,
): SearchIndexEntry[] {
  if (!query || query.length < 2) return [];

  const q = query.toLowerCase();
  const qNorm = normalizePn(query);

  const scored: { entry: SearchIndexEntry; score: number }[] = [];

  for (const entry of index) {
    let score = 0;
    const entryPnNorm = normalizePn(entry.pn);
    const custPnNorm = entry.customerPn ? normalizePn(entry.customerPn) : '';

    // P/N 정확 매치
    if (entryPnNorm === qNorm) {
      score = 100;
    }
    // 고객사 P/N 정확 매치
    else if (custPnNorm && custPnNorm === qNorm) {
      score = 95;
    }
    // P/N 시작 매치
    else if (entryPnNorm.startsWith(qNorm)) {
      score = 80;
    }
    // 고객사 P/N 시작 매치
    else if (custPnNorm && custPnNorm.startsWith(qNorm)) {
      score = 75;
    }
    // P/N 포함 매치
    else if (entryPnNorm.includes(qNorm)) {
      score = 60;
    }
    // 고객사 P/N 포함 매치
    else if (custPnNorm && custPnNorm.includes(qNorm)) {
      score = 55;
    }
    // 품명 포함 매치
    else if (entry.name.toLowerCase().includes(q)) {
      score = 40;
    }
    // 고객사 매치
    else if (entry.customer.toLowerCase().includes(q)) {
      score = 30;
    }
    // 차종 매치
    else if (entry.model.toLowerCase().includes(q)) {
      score = 20;
    }
    // displayText 전체 매치
    else if (entry.displayText.toLowerCase().includes(q)) {
      score = 10;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // 점수 내림차순 정렬, 같은 점수면 type 순서
  const typeOrder = { product: 0, part: 1, material: 2 };
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return typeOrder[a.entry.type] - typeOrder[b.entry.type];
  });

  return scored.slice(0, limit).map(s => s.entry);
}

// ============================================
// Utility: Build refInfoMap for tree expansion
// ============================================

export function buildRefInfoMap(
  refInfo: ReferenceInfoRecord[],
): Map<string, ReferenceInfoRecord> {
  const map = new Map<string, ReferenceInfoRecord>();
  for (const ri of refInfo) {
    map.set(normalizePn(ri.itemCode), ri);
    if (ri.customerPn) map.set(normalizePn(ri.customerPn), ri);
  }
  return map;
}

// ============================================
// Utility: Flatten tree for CSV export
// ============================================

export interface FlatBomRow {
  level: number;
  pn: string;
  name: string;
  unitQty: number;
  cumulativeQty: number;
  partType: string;
  supplier: string;
  processType: string;
  supplyType: string;
}

export function flattenTree(node: BomTreeNode): FlatBomRow[] {
  const rows: FlatBomRow[] = [];

  function walk(n: BomTreeNode) {
    rows.push({
      level: n.level,
      pn: n.pn,
      name: n.name,
      unitQty: n.unitQty,
      cumulativeQty: n.qty,
      partType: n.partType,
      supplier: n.supplier,
      processType: n.processType || '',
      supplyType: n.supplyType || '',
    });
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return rows;
}

// ============================================
// Utility: Count tree metrics
// ============================================

export function countTreeMetrics(node: BomTreeNode): {
  totalParts: number;
  leafCount: number;
  maxLevel: number;
} {
  const uniqueParts = new Set<string>();
  const uniqueLeaves = new Set<string>();
  let maxLevel = 0;

  function walk(n: BomTreeNode) {
    if (n.level > 0) uniqueParts.add(n.pn);
    if (n.children.length === 0 && n.level > 0) uniqueLeaves.add(n.pn);
    if (n.level > maxLevel) maxLevel = n.level;
    for (const child of n.children) walk(child);
  }

  walk(node);
  return { totalParts: uniqueParts.size, leafCount: uniqueLeaves.size, maxLevel };
}

// ============================================
// Utility: Enrich reverse paths with names
// ============================================

export function enrichReversePaths(
  paths: ReversePath[],
  bomRecords: BomMasterRecord[],
  refInfo: ReferenceInfoRecord[],
  productCodes: ProductCodeRecord[],
): ReversePath[] {
  // name lookup maps
  const nameMap = new Map<string, string>();

  for (const rec of bomRecords) {
    const childNorm = normalizePn(rec.childPn);
    if (rec.childName && !nameMap.has(childNorm)) {
      nameMap.set(childNorm, rec.childName);
    }
  }
  for (const ri of refInfo) {
    const norm = normalizePn(ri.itemCode);
    if (ri.itemName && !nameMap.has(norm)) {
      nameMap.set(norm, ri.itemName);
    }
  }
  for (const pc of productCodes) {
    const norm = normalizePn(pc.productCode);
    if (pc.productName && !nameMap.has(norm)) {
      nameMap.set(norm, pc.productName);
    }
  }

  return paths.map(p => ({
    path: p.path.map(node => ({
      ...node,
      name: node.name || nameMap.get(normalizePn(node.pn)) || '',
    })),
  }));
}
