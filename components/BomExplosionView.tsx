import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import MetricCard from './MetricCard';
import {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
} from '../utils/bomMasterParser';
import { normalizePn } from '../utils/bomDataParser';
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
} from '../services/supabaseService';

// ============================================
// Component
// ============================================

const BomExplosionView: React.FC = () => {
  // --- Data State ---
  const [bomRecords, setBomRecords] = useState<BomMasterRecord[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCodeRecord[]>([]);
  const [refInfo, setRefInfo] = useState<ReferenceInfoRecord[]>([]);
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

  // --- Data Load ---
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const [bom, pc, ri] = await Promise.all([
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
      ]);
      setBomRecords(bom);
      setProductCodes(pc);
      setRefInfo(ri);
      setLoading(false);
    };
    loadData();
  }, []);

  // --- Derived Maps (useMemo) ---
  const forwardMap = useMemo(() => buildForwardMap(bomRecords), [bomRecords]);
  const reverseMap = useMemo(() => buildReverseMap(bomRecords), [bomRecords]);
  const refInfoMap = useMemo(() => buildRefInfoMap(refInfo), [refInfo]);
  const searchIdx = useMemo(
    () => buildSearchIndex(bomRecords, productCodes, refInfo),
    [bomRecords, productCodes, refInfo],
  );

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

  // --- Forward Tree ---
  const forwardTree = useMemo(() => {
    if (!selectedPn) return null;
    return expandForwardTree(selectedPn, forwardMap, refInfoMap);
  }, [selectedPn, forwardMap, refInfoMap]);

  // --- Reverse Paths ---
  const reversePaths = useMemo(() => {
    if (!selectedPn) return [];
    const raw = expandReversePaths(selectedPn, reverseMap);
    return enrichReversePaths(raw, bomRecords, refInfo, productCodes);
  }, [selectedPn, reverseMap, bomRecords, refInfo, productCodes]);

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

  const handleDownloadForward = useCallback(() => {
    if (!flatRows.length) return;
    const headers = ['레벨', '품번', '품명', '단위소요량', '누적소요량', '부품유형', '협력업체', '공정유형', '조달구분'];
    const rows = flatRows.map(r => [
      r.level,
      r.pn,
      r.name,
      r.unitQty,
      r.cumulativeQty,
      r.partType,
      r.supplier,
      r.processType,
      r.supplyType,
    ]);
    downloadCSV(`BOM정전개_${selectedPn}`, headers, rows);
  }, [flatRows, selectedPn]);

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
      case 'product': return 'bg-blue-100 text-blue-700';
      case 'part': return 'bg-amber-100 text-amber-700';
      case 'material': return 'bg-emerald-100 text-emerald-700';
    }
  };

  // --- Render: Tree Rows (재귀적 flat rendering) ---
  const renderTreeRows = (node: BomTreeNode, parentKey = '', siblingIdx = 0): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    const nodeKey = `${parentKey}/${node.pn}-${node.level}:${siblingIdx}`;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes.has(nodeKey);

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
                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors flex-shrink-0"
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
              className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline truncate"
              title={`${node.pn} 클릭하여 전개`}
            >
              {node.pn}
            </button>
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-700 truncate max-w-[200px]" title={node.name}>
          {node.name}
        </td>
        <td className="px-3 py-2 text-right text-xs font-mono text-slate-600">
          {node.unitQty}
        </td>
        <td className="px-3 py-2 text-right text-xs font-mono font-bold text-slate-800">
          {Number.isInteger(node.qty) ? node.qty : node.qty.toFixed(4)}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{node.partType}</td>
        <td className="px-3 py-2 text-xs text-slate-500">{node.supplier}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{node.processType || ''}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{node.supplyType || ''}</td>
      </tr>,
    );

    if (hasChildren && !isCollapsed) {
      for (let ci = 0; ci < node.children.length; ci++) {
        rows.push(...renderTreeRows(node.children[ci], nodeKey, ci));
      }
    }

    return rows;
  };

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3" />
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
            <h2 className="text-xl font-black text-slate-800">BOM 전개 (Explosion)</h2>
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
                className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
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
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors flex items-center gap-2 text-xs border-b border-slate-50 last:border-b-0"
                      >
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeColor(entry.type)}`}>
                          {typeLabel(entry.type)}
                        </span>
                        <span className="font-mono text-indigo-600 font-bold">{entry.pn}</span>
                        {entry.customerPn && normalizePn(entry.customerPn) !== normalizePn(entry.pn) && (
                          <span className="font-mono text-violet-500 text-[10px]">[{entry.customerPn}]</span>
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
            <span className="font-mono font-bold text-indigo-600">{selectedPn}</span>
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
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              정전개 (Forward)
            </button>
            <button
              onClick={() => setMode('reverse')}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === 'reverse'
                  ? 'bg-indigo-600 text-white shadow-sm'
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
                <h3 className="font-black text-slate-800 flex items-center gap-2">
                  <span className="w-1 h-5 bg-indigo-600 rounded-full" />
                  정전개 트리 (Forward Explosion)
                </h3>
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
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-center w-14">레벨</th>
                      <th className="px-3 py-2.5 min-w-[180px]">품번 (Part No)</th>
                      <th className="px-3 py-2.5 min-w-[150px]">품명</th>
                      <th className="px-3 py-2.5 text-right w-20">단위수량</th>
                      <th className="px-3 py-2.5 text-right w-24">누적소요량</th>
                      <th className="px-3 py-2.5 w-20">부품유형</th>
                      <th className="px-3 py-2.5 w-24">협력업체</th>
                      <th className="px-3 py-2.5 w-20">공정</th>
                      <th className="px-3 py-2.5 w-20">조달</th>
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
                <h3 className="font-black text-slate-800 flex items-center gap-2">
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
                            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors flex-shrink-0"
                          >
                            <span className="font-mono text-xs text-indigo-600 font-bold">{node.pn}</span>
                            {node.name && (
                              <span className="text-[10px] text-slate-500">{node.name}</span>
                            )}
                            {node.qty !== 1 && (
                              <span className="text-[10px] text-amber-600 font-bold">x{node.qty}</span>
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
