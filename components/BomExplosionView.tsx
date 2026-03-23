import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useColumnResize } from '../hooks/useColumnResize';
import MetricCard from './MetricCard';
import {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
  MaterialCodeRecord,
} from '../utils/bomMasterParser';
import { normalizePn } from '../utils/bomDataParser';
import {
  PurchasePrice,
  OutsourcePrice,
  ItemStandardCost,
} from '../utils/standardMaterialParser';
import {
  buildForwardMap,
  buildReverseMap,
  buildRefInfoMap,
  buildSearchIndex,
  searchIndex,
  expandForwardTree,
  expandReversePaths,
  enrichReversePaths,
  flattenTree,
  countTreeMetrics,
  BomTreeNode,
  ReversePath,
  SearchIndexEntry,
  FlatBomRow,
} from '../utils/bomExplosionEngine';
import { downloadCSV } from '../utils/csvExport';
import {
  bomMasterService,
  productCodeService,
  referenceInfoService,
  materialCodeService,
  purchasePriceService,
  outsourceInjPriceService,
  itemStandardCostService,
} from '../services/supabaseService';

// ============================================
// Component
// ============================================

const BomExplosionView: React.FC = () => {
  // --- Column Resize ---
  const fwdResize = useColumnResize([56, 180, 150, 80, 96, 80, 96, 80, 80, 96, 96]);

  // --- Data State ---
  const [bomRecords, setBomRecords] = useState<BomMasterRecord[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCodeRecord[]>([]);
  const [refInfo, setRefInfo] = useState<ReferenceInfoRecord[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCodeRecord[]>([]);
  const [purchasePrices, setPurchasePrices] = useState<PurchasePrice[]>([]);
  const [outsourcePrices, setOutsourcePrices] = useState<OutsourcePrice[]>([]);
  const [stdCosts, setStdCosts] = useState<ItemStandardCost[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Search State ---
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPn, setSelectedPn] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  // --- Mode State ---
  const [mode, setMode] = useState<'forward' | 'reverse'>('forward');

  // --- Tree State ---
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // --- Price Edit State ---
  const [editingPriceKey, setEditingPriceKey] = useState<string>('');
  const [editPriceValue, setEditPriceValue] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // --- Data Load ---
  const loadAllData = useCallback(async () => {
    setLoading(true);
    const [bom, pc, ri, mc, pp, op, sc] = await Promise.all([
      bomMasterService.getAll(),
      productCodeService.getAll(),
      referenceInfoService.getAll(),
      materialCodeService.getAll(),
      purchasePriceService.getAll(),
      outsourceInjPriceService.getAll(),
      itemStandardCostService.getAll(),
    ]);
    setBomRecords(bom);
    setProductCodes(pc);
    setRefInfo(ri);
    setMaterialCodes(mc);
    setPurchasePrices(pp);
    setOutsourcePrices(op);
    setStdCosts(sc);
    setLoading(false);
  }, []);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  // --- Derived Maps (useMemo) ---
  const forwardMap = useMemo(() => buildForwardMap(bomRecords), [bomRecords]);
  const reverseMap = useMemo(() => buildReverseMap(bomRecords), [bomRecords]);
  const refInfoMap = useMemo(() => buildRefInfoMap(refInfo), [refInfo]);
  const searchIdx = useMemo(
    () => buildSearchIndex(bomRecords, productCodes, refInfo),
    [bomRecords, productCodes, refInfo],
  );

  // --- Price Maps ---
  const priceData = useMemo(() => {
    // 재질코드 단가 맵
    const matPriceMap = new Map<string, number>();
    const materialTypeMap = new Map<string, string>();
    for (const mc of materialCodes) {
      if (mc.currentPrice > 0) matPriceMap.set(normalizePn(mc.materialCode), mc.currentPrice);
      materialTypeMap.set(normalizePn(mc.materialCode), mc.materialType || '');
    }
    // 구매단가 맵
    const purchaseMap = new Map<string, number>();
    for (const pp of purchasePrices) {
      if (pp.currentPrice > 0) {
        purchaseMap.set(normalizePn(pp.itemCode), pp.currentPrice);
        if (pp.customerPn) purchaseMap.set(normalizePn(pp.customerPn), pp.currentPrice);
      }
    }
    // 외주사출판매가 맵
    const outsourceMap = new Map<string, number>();
    for (const op of outsourcePrices) {
      if (op.injectionPrice > 0) {
        outsourceMap.set(normalizePn(op.itemCode), op.injectionPrice);
        if (op.customerPn) outsourceMap.set(normalizePn(op.customerPn), op.injectionPrice);
      }
    }
    // 표준재료비 맵
    const stdMap = new Map<string, number>();
    for (const sc of stdCosts) {
      const costVal = sc.material_cost_per_ea || (sc.resin_cost_per_ea + sc.paint_cost_per_ea);
      if (costVal > 0) {
        stdMap.set(normalizePn(sc.item_code), costVal);
        if (sc.customer_pn) stdMap.set(normalizePn(sc.customer_pn), costVal);
      }
    }
    return { matPriceMap, materialTypeMap, purchaseMap, outsourceMap, stdMap };
  }, [materialCodes, purchasePrices, outsourcePrices, stdCosts]);

  // --- getNodePrice: 단가 조회 ---
  const getNodePrice = useCallback((pn: string): { price: number; source: string } => {
    const code = normalizePn(pn);
    const { matPriceMap, materialTypeMap, purchaseMap, outsourceMap, stdMap } = priceData;
    // 1) 표준재료비
    const std = stdMap.get(code);
    if (std && std > 0) return { price: std, source: '표준' };
    // 2) 재질코드 직접
    const dp = matPriceMap.get(code);
    if (dp && dp > 0) return { price: dp, source: '재질' };
    // 3) 구매단가
    const pp = purchaseMap.get(code);
    if (pp && pp > 0) {
      const ri = refInfoMap.get(code);
      if (ri && /외주/.test(ri.supplyType || '')) {
        const op = outsourceMap.get(code) || 0;
        return { price: Math.max(0, pp - op), source: op > 0 ? '외주' : '구매' };
      }
      return { price: pp, source: '구매' };
    }
    // 4) 사출공식: rawMaterialCode + netWeight
    const ri = refInfoMap.get(code);
    if (ri) {
      const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        const matType = materialTypeMap.get(rawNorm) || '';
        if (/PAINT|도료/i.test(matType)) continue;
        const rp = matPriceMap.get(rawNorm);
        if (rp && rp > 0 && ri.netWeight && ri.netWeight > 0) {
          const rw = ri.runnerWeight || 0;
          const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
          const loss = ri.lossRate || 0;
          const wpe = ri.netWeight + rw / cavity;
          const cost = (wpe * rp / 1000) * (1 + loss / 100);
          return { price: cost, source: '사출' };
        }
      }
    }
    return { price: 0, source: '' };
  }, [priceData, refInfoMap]);

  // --- Debounce ---
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // --- Search Results ---
  const searchResults = useMemo(
    () => searchIndex(debouncedQuery, searchIdx),
    [debouncedQuery, searchIdx],
  );

  // --- Click outside to close dropdown ---
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // --- Forward Tree (with customerPn-based fallback for product codes) ---
  const { forwardTree, bomRootPn } = useMemo(() => {
    if (!selectedPn) return { forwardTree: null, bomRootPn: '' };

    const normalizedSelected = normalizePn(selectedPn);

    // 1) Direct expansion: selectedPn이 forwardMap에 있으면 바로 전개
    if (forwardMap.has(normalizedSelected)) {
      const childCount = forwardMap.get(normalizedSelected)?.length || 0;
      console.log(`[BOM전개] 직접전개: ${selectedPn} (children: ${childCount})`);
      return {
        forwardTree: expandForwardTree(selectedPn, forwardMap, refInfoMap),
        bomRootPn: '',
      };
    }

    // 2) CustomerPn fallback: 제품코드(AAA) → 고객P/N → BOM 공정코드(HVS/IBH) 자동 연결
    const pc = productCodes.find(p => normalizePn(p.productCode) === normalizedSelected);
    const selectedRef = refInfoMap.get(normalizedSelected);
    const customerPn = pc?.customerPn || selectedRef?.customerPn;

    if (customerPn) {
      const custNorm = normalizePn(customerPn);
      // 같은 고객P/N을 가진 refInfo 중 forwardMap에 있는 항목 찾기
      const allWithCustPn = refInfo.filter(ri => ri.customerPn && normalizePn(ri.customerPn) === custNorm);
      const bomRoots = allWithCustPn
        .filter(ri => forwardMap.has(normalizePn(ri.itemCode)))
        .sort((a, b) => {
          const aLen = forwardMap.get(normalizePn(a.itemCode))?.length || 0;
          const bLen = forwardMap.get(normalizePn(b.itemCode))?.length || 0;
          return bLen - aLen;
        });

      if (bomRoots.length > 0) {
        const root = bomRoots[0];
        const tree = expandForwardTree(root.itemCode, forwardMap, refInfoMap);
        tree.pn = selectedPn;
        tree.name = pc?.productName || selectedRef?.itemName || tree.name;
        return { forwardTree: tree, bomRootPn: root.itemCode };
      }
    }

    // 3) Fallback: 그대로 전개 (children 없음)
    return {
      forwardTree: expandForwardTree(selectedPn, forwardMap, refInfoMap),
      bomRootPn: '',
    };
  }, [selectedPn, forwardMap, refInfoMap, productCodes, refInfo]);

  // --- Reverse Paths (with customerPn-based fallback) ---
  const reversePaths = useMemo(() => {
    if (!selectedPn) return [];

    let expandPn = selectedPn;
    const normalizedSelected = normalizePn(selectedPn);

    // reverseMap에 없으면 customerPn으로 BOM 코드 찾기
    if (!reverseMap.has(normalizedSelected)) {
      const pc = productCodes.find(p => normalizePn(p.productCode) === normalizedSelected);
      const selectedRef = refInfoMap.get(normalizedSelected);
      const customerPn = pc?.customerPn || selectedRef?.customerPn;

      if (customerPn) {
        const custNorm = normalizePn(customerPn);
        const candidate = refInfo.find(
          ri => ri.customerPn && normalizePn(ri.customerPn) === custNorm && reverseMap.has(normalizePn(ri.itemCode)),
        );
        if (candidate) expandPn = candidate.itemCode;
      }
    }

    const raw = expandReversePaths(expandPn, reverseMap);
    return enrichReversePaths(raw, bomRecords, refInfo, productCodes);
  }, [selectedPn, reverseMap, bomRecords, refInfo, productCodes, refInfoMap]);

  // --- Tree Metrics ---
  const treeMetrics = useMemo(() => {
    if (!forwardTree) return { totalParts: 0, leafCount: 0, maxLevel: 0 };
    return countTreeMetrics(forwardTree);
  }, [forwardTree]);

  // --- Flat rows for CSV ---
  const flatRows = useMemo(() => {
    if (!forwardTree) return [];
    return flattenTree(forwardTree);
  }, [forwardTree]);

  // --- Handlers ---
  const handleSelect = useCallback((entry: SearchIndexEntry) => {
    setSelectedPn(entry.pn);
    setSelectedName(entry.name || entry.pn);
    setQuery(entry.pn);
    setShowDropdown(false);
    setCollapsedNodes(new Set());
  }, []);

  const handleNodeClick = useCallback((pn: string, name: string) => {
    setSelectedPn(pn);
    setSelectedName(name || pn);
    setQuery(pn);
    setCollapsedNodes(new Set());
  }, []);

  const toggleCollapse = useCallback((nodeKey: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  }, []);

  // --- Price Save Handler ---
  const handlePriceSave = useCallback(async (pn: string) => {
    const val = parseFloat(editPriceValue);
    if (isNaN(val) || val < 0) { setEditingPriceKey(''); return; }
    setSavingPrice(true);
    const code = normalizePn(pn);
    // 재질코드에 있으면 materialCodeService, 아니면 purchasePriceService
    const isMaterialCode = materialCodes.some(m => normalizePn(m.materialCode) === code);
    let ok: boolean;
    if (isMaterialCode) {
      ok = await materialCodeService.updatePrice(pn, val);
    } else {
      ok = await purchasePriceService.updatePrice(pn, val);
    }
    setSavingPrice(false);
    setEditingPriceKey('');
    if (ok) {
      // 데이터 리로드
      const [mc, pp] = await Promise.all([
        materialCodeService.getAll(),
        purchasePriceService.getAll(),
      ]);
      setMaterialCodes(mc);
      setPurchasePrices(pp);
    }
  }, [editPriceValue, materialCodes]);

  const handleDownloadForward = useCallback(() => {
    if (!flatRows.length) return;
    const headers = ['레벨', '품번', '품명', '단위소요량', '누적소요량', '부품유형', '협력업체', '공정유형', '조달구분', '단가', '단가출처', '금액'];
    const rows = flatRows.map(r => {
      const { price, source } = getNodePrice(r.pn);
      return [
        r.level, r.pn, r.name, r.unitQty, r.cumulativeQty,
        r.partType, r.supplier, r.processType, r.supplyType,
        Math.round(price), source, Math.round(r.cumulativeQty * price),
      ];
    });
    downloadCSV(`BOM정전개_${selectedPn}`, headers, rows);
  }, [flatRows, selectedPn, getNodePrice]);

  const handleDownloadReverse = useCallback(() => {
    if (!reversePaths.length) return;
    const headers = ['경로번호', '순서', '품번', '품명', '소요량'];
    const rows: (string | number)[][] = [];
    reversePaths.forEach((rp, idx) => {
      rp.path.forEach((node, order) => {
        rows.push([idx + 1, order + 1, node.pn, node.name, node.qty]);
      });
    });
    downloadCSV(`BOM역전개_${selectedPn}`, headers, rows);
  }, [reversePaths, selectedPn]);

  // --- Type label/color helpers ---
  const typeLabel = (t: SearchIndexEntry['type']) => {
    switch (t) {
      case 'product': return '제품';
      case 'part': return '부품';
      case 'material': return '원자재';
    }
  };
  const typeColor = (t: SearchIndexEntry['type']) => {
    switch (t) {
      case 'product': return 'bg-slate-100 text-slate-600';
      case 'part': return 'bg-slate-100 text-slate-600';
      case 'material': return 'bg-slate-100 text-slate-600';
    }
  };

  // --- 누적소요량 산출근거 팝업 ---
  interface AncestorStep {
    pn: string;
    name: string;
    unitQty: number;
    level: number;
  }

  const QtyBreakdownCell: React.FC<{
    node: BomTreeNode;
    ancestors: AncestorStep[];
  }> = ({ node, ancestors }) => {
    const [show, setShow] = useState(false);
    const cellRef = useRef<HTMLTableCellElement>(null);
    const displayQty = Number.isInteger(node.qty) ? node.qty : node.qty.toFixed(4);

    // Lv0 루트노드는 팝업 불필요
    if (node.level === 0) {
      return (
        <td className="px-3 py-2 text-right text-xs font-mono font-bold text-slate-800">
          {displayQty}
        </td>
      );
    }

    // 곱셈 체인: ancestor[0].unitQty × ancestor[1].unitQty × ... × node.unitQty
    const chain = [...ancestors, { pn: node.pn, name: node.name, unitQty: node.unitQty, level: node.level }];

    return (
      <td
        ref={cellRef}
        className="px-3 py-2 text-right text-xs font-mono font-bold text-slate-800 relative cursor-help"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <span className="border-b border-dashed border-slate-400">
          {displayQty}
        </span>
        {show && (
          <div className="absolute z-[100] right-0 top-full mt-1 bg-slate-800 text-white rounded-xl shadow-xl px-4 py-3 min-w-[280px] text-left pointer-events-none">
            <div className="text-[10px] font-bold text-slate-300 mb-2">산출근거 (누적소요량)</div>
            <div className="space-y-1">
              {chain.map((step, i) => {
                const fmtQty = Number.isInteger(step.unitQty) ? step.unitQty : step.unitQty.toFixed(4);
                const shortName = step.name.length > 20 ? step.name.slice(0, 20) + '…' : step.name;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    {i > 0 && <span className="text-slate-400 font-bold">×</span>}
                    <span className="text-slate-300 font-bold">Lv{step.level}</span>
                    <span className="text-slate-300 font-mono truncate max-w-[120px]" title={step.pn}>{step.pn}</span>
                    {shortName && <span className="text-slate-400 truncate max-w-[80px]">({shortName})</span>}
                    <span className="ml-auto text-white font-bold">{fmtQty}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-slate-600 mt-2 pt-2 flex items-center justify-between text-xs">
              <span className="text-slate-400">
                = {chain.map(s => Number.isInteger(s.unitQty) ? s.unitQty : s.unitQty.toFixed(4)).join(' × ')}
              </span>
              <span className="text-white font-bold">{displayQty}</span>
            </div>
          </div>
        )}
      </td>
    );
  };

  // --- Render: Tree Rows (재귀적 flat rendering) ---
  const renderTreeRows = (
    node: BomTreeNode,
    parentKey = '',
    siblingIdx = 0,
    ancestors: AncestorStep[] = [],
  ): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    const nodeKey = `${parentKey}/${node.pn}-${node.level}:${siblingIdx}`;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes.has(nodeKey);

    // 현재 노드까지의 조상 경로 (자식 전달용)
    const currentAncestors: AncestorStep[] = [
      ...ancestors,
      { pn: node.pn, name: node.name, unitQty: node.unitQty, level: node.level },
    ];

    rows.push(
      <tr key={nodeKey} className="hover:bg-slate-50 transition-colors">
        <td className="px-3 py-2 text-center text-slate-400 text-[10px] font-mono">
          Lv{node.level}
        </td>
        <td className="py-2 pr-3" style={{ paddingLeft: `${12 + node.level * 20}px` }}>
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                onClick={() => toggleCollapse(nodeKey)}
                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0"
              >
                <svg className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <span className="w-4 h-4 flex items-center justify-center text-slate-300 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              </span>
            )}
            <button
              onClick={() => handleNodeClick(node.pn, node.name)}
              className="font-mono text-xs text-slate-800 hover:text-slate-900 hover:underline truncate"
              title={`${node.pn} 클릭하여 전개`}
            >
              {node.pn}
            </button>
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap" title={node.name}>
          {node.name}
        </td>
        <td className="px-3 py-2 text-right text-xs font-mono text-slate-600">
          {node.unitQty}
        </td>
        <QtyBreakdownCell node={node} ancestors={ancestors} />
        <td className="px-3 py-2 text-xs text-slate-500">{node.partType}</td>
        <td className="px-3 py-2 text-xs text-slate-500">{node.supplier}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{node.processType || ''}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{node.supplyType || ''}</td>
        {/* 단가 (editable) */}
        {(() => {
          const { price, source } = getNodePrice(node.pn);
          const isEditing = editingPriceKey === nodeKey;
          const cost = node.qty * price;
          return (
            <>
              <td className="px-2 py-2 text-right text-xs font-mono w-24">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={editInputRef}
                      type="number"
                      value={editPriceValue}
                      onChange={(e) => setEditPriceValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handlePriceSave(node.pn);
                        if (e.key === 'Escape') setEditingPriceKey('');
                      }}
                      onBlur={() => handlePriceSave(node.pn)}
                      className="w-20 px-1 py-0.5 border border-slate-300 rounded text-right text-xs outline-none focus:ring-1 focus:ring-slate-400"
                      autoFocus
                      disabled={savingPrice}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingPriceKey(nodeKey);
                      setEditPriceValue(price > 0 ? String(Math.round(price)) : '');
                    }}
                    className={`cursor-pointer hover:bg-slate-50 px-1.5 py-0.5 rounded transition-colors w-full text-right ${
                      price > 0 ? 'text-slate-700' : 'text-slate-300'
                    }`}
                    title={source ? `출처: ${source} — 클릭하여 수정` : '클릭하여 단가 입력'}
                  >
                    {price > 0 ? `₩${Math.round(price).toLocaleString()}` : '-'}
                    {source && <span className="ml-1 text-[9px] text-slate-400">{source}</span>}
                  </button>
                )}
              </td>
              <td className="px-2 py-2 text-right text-xs font-mono text-slate-600 w-24">
                {price > 0 ? `₩${Math.round(cost).toLocaleString()}` : ''}
              </td>
            </>
          );
        })()}
      </tr>,
    );

    if (hasChildren && !isCollapsed) {
      for (let ci = 0; ci < node.children.length; ci++) {
        rows.push(...renderTreeRows(node.children[ci], nodeKey, ci, currentAncestors));
      }
    }

    return rows;
  };

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 mx-auto mb-3" />
          <p className="text-sm text-slate-500">BOM 마스터 데이터 로딩 중...</p>
        </div>
      </div>
    );
  }

  if (bomRecords.length === 0) {
    return (
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center">
        <p className="text-slate-500 mb-2">BOM 마스터 데이터가 없습니다.</p>
        <p className="text-xs text-slate-400">BOM 마스터 탭에서 먼저 데이터를 업로드해주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">BOM 전개 (Explosion)</h2>
            <p className="text-xs text-slate-500 mt-1">
              품번 검색 후 정전개(부모→자식 트리) 또는 역전개(자식→부모 경로 추적)를 확인합니다.
            </p>
          </div>
          <div className="text-xs text-slate-400">
            전체 BOM: {bomRecords.length.toLocaleString()}행 | 검색 인덱스: {searchIdx.length.toLocaleString()}건
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm" ref={searchRef}>
        <div className="relative max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-600">검색</span>
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="품번, 품명, 고객사, 차종으로 검색 (2글자 이상)..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => {
                  if (query.length >= 2) setShowDropdown(true);
                }}
                className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-300 transition-all"
              />
              <svg className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Autocomplete Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-80 overflow-y-auto">
              {/* Group by type */}
              {(['product', 'part', 'material'] as const).map(type => {
                const items = searchResults.filter(r => r.type === type);
                if (items.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0">
                      {typeLabel(type)} ({items.length})
                    </div>
                    {items.map((entry, idx) => (
                      <button
                        key={`${type}-${idx}`}
                        onClick={() => handleSelect(entry)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2 text-xs border-b border-slate-50 last:border-b-0"
                      >
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeColor(entry.type)}`}>
                          {typeLabel(entry.type)}
                        </span>
                        <span className="font-mono text-slate-800 font-bold">{entry.pn}</span>
                        {entry.customerPn && normalizePn(entry.customerPn) !== normalizePn(entry.pn) && (
                          <span className="font-mono text-slate-500 text-[10px]">[{entry.customerPn}]</span>
                        )}
                        <span className="text-slate-600 truncate">{entry.name}</span>
                        {entry.customer && (
                          <span className="text-slate-400 ml-auto flex-shrink-0">({entry.customer})</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {showDropdown && debouncedQuery.length >= 2 && searchResults.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-4 text-center text-sm text-slate-400">
              검색 결과가 없습니다.
            </div>
          )}
        </div>

        {/* Selected Item */}
        {selectedPn && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-slate-500">선택:</span>
            <span className="font-mono font-bold text-slate-800">{selectedPn}</span>
            {selectedName && <span className="text-slate-700">{selectedName}</span>}
            <button
              onClick={() => {
                setSelectedPn('');
                setSelectedName('');
                setQuery('');
              }}
              className="ml-2 text-slate-400 hover:text-red-500 transition-colors"
              title="선택 해제"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Mode Toggle + Results */}
      {selectedPn && (
        <>
          {/* Mode Tabs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('forward')}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === 'forward'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              정전개 (Forward)
            </button>
            <button
              onClick={() => setMode('reverse')}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === 'reverse'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              역전개 (Reverse)
            </button>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="총 하위부품"
              value={`${treeMetrics.totalParts}개`}
              color="blue"
            />
            <MetricCard
              label="리프 자재"
              value={`${treeMetrics.leafCount}개`}
              color="slate"
            />
            <MetricCard
              label="최대 레벨"
              value={`Lv${treeMetrics.maxLevel}`}
              color="rose"
            />
            <MetricCard
              label="역전개 경로"
              value={`${reversePaths.length}개`}
              color="blue"
            />
          </div>

          {/* Forward Explosion Tree */}
          {mode === 'forward' && forwardTree && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1 h-5 bg-slate-800 rounded-full" />
                    정전개 트리 (Forward Explosion)
                  </h3>
                  {bomRootPn && (
                    <p className="text-[11px] text-slate-500 mt-1 ml-4">
                      제품코드 → BOM 자동연결: <span className="font-mono font-bold">{bomRootPn}</span> (고객P/N 기준)
                    </p>
                  )}
                </div>
                <button
                  onClick={handleDownloadForward}
                  className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CSV 다운로드
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="text-xs text-left" style={{ tableLayout: 'fixed', minWidth: fwdResize.widths.reduce((a, b) => a + b, 0) }}>
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      {['레벨','품번 (Part No)','품명','단위수량','누적소요량','부품유형','협력업체','공정','조달','단가','금액'].map((label, ci) => (
                        <th
                          key={ci}
                          className={`px-3 py-2.5 whitespace-nowrap ${ci === 0 ? 'text-center' : ci === 3 || ci === 4 || ci >= 9 ? 'text-right' : ''}`}
                          style={fwdResize.getHeaderStyle(ci)}
                        >
                          {label}
                          <div
                            onMouseDown={e => fwdResize.startResize(ci, e)}
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {renderTreeRows(forwardTree)}
                  </tbody>
                </table>
              </div>

              {forwardTree.children.length === 0 && (
                <div className="text-center py-6 text-sm text-slate-400">
                  이 품번의 하위 BOM이 없습니다. (리프 노드)
                </div>
              )}
            </div>
          )}

          {/* Reverse Explosion Paths */}
          {mode === 'reverse' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-1 h-5 bg-rose-500 rounded-full" />
                  역전개 경로 (Reverse Explosion)
                </h3>
                <button
                  onClick={handleDownloadReverse}
                  className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CSV 다운로드
                </button>
              </div>

              {reversePaths.length > 0 ? (
                <div className="space-y-3">
                  {reversePaths.map((rp, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1 px-4 py-3 bg-slate-50 rounded-xl border border-slate-100 overflow-x-auto"
                    >
                      <span className="text-[10px] font-bold text-slate-400 mr-2 flex-shrink-0">
                        #{idx + 1}
                      </span>
                      {rp.path.map((node, nIdx) => (
                        <React.Fragment key={nIdx}>
                          {nIdx > 0 && (
                            <span className="text-slate-300 mx-1 flex-shrink-0">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                          )}
                          <button
                            onClick={() => handleNodeClick(node.pn, node.name)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors flex-shrink-0"
                          >
                            <span className="font-mono text-xs text-slate-800 font-bold">{node.pn}</span>
                            {node.name && (
                              <span className="text-[10px] text-slate-500">{node.name}</span>
                            )}
                            {node.qty !== 1 && (
                              <span className="text-[10px] text-slate-500 font-bold">x{node.qty}</span>
                            )}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-slate-400">
                  이 품번의 상위 BOM 경로가 없습니다. (최상위 노드)
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BomExplosionView;
