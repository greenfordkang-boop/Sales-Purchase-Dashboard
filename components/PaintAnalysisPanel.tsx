import React, { useState, useMemo, useCallback } from 'react';
import { ReferenceInfoRecord, MaterialCodeRecord } from '../utils/bomMasterParser';
import { PaintMixRatio } from '../utils/standardMaterialParser';
import { normalizePn } from '../utils/bomDataParser';
import { referenceInfoService } from '../services/supabaseService';

// ============================================
// Types
// ============================================

interface PaintAnalysisPanelProps {
  refInfo: ReferenceInfoRecord[];
  materialCodes: MaterialCodeRecord[];
  paintMixRatios: PaintMixRatio[];
  onRefInfoUpdated: (updated: ReferenceInfoRecord[]) => void;
  onClose: () => void;
}

interface PaintItemAnalysis {
  itemCode: string;
  itemName: string;
  processType: string;
  variety: string;             // 차종
  productSizeType: string;     // 제품크기 (소물/대물)
  coatNumber: number;          // 1도, 2도, 3도, 4도 (0 = 원재료코드 없음)
  coatCount: number;           // 해당 품목의 총 도수
  rawCode: string;             // 이 도의 원재료코드 (P-code)
  matchedPaintCode: string;    // 재질코드 (S/X-code)
  matchedMix: PaintMixRatio | null;
  mixCostPerKg: number;
  paintQty: number;            // 이 도의 도장량 (paintQty1~4)
  costPerEa: number;
  matchStatus: 'matched' | 'unmatched_no_raw' | 'unmatched_no_mix';
}

type TabKey = 'overview' | 'unmatched' | 'intake';
type IntakeSortKey = 'itemCode' | 'itemName' | 'coatNumber' | 'paintQty' | 'matchStatus';

const fmtWon = (v: number) => v > 0 ? `₩${Math.round(v).toLocaleString()}` : '—';

// Unique key for per-coat row
const coatKey = (p: PaintItemAnalysis) => `${p.itemCode}_${p.coatNumber}`;

// ============================================
// Component
// ============================================

const PaintAnalysisPanel: React.FC<PaintAnalysisPanelProps> = ({
  refInfo, materialCodes, paintMixRatios, onRefInfoUpdated, onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [intakeFilter, setIntakeFilter] = useState<'all' | 'empty' | 'filled'>('empty');
  const [intakeSort, setIntakeSort] = useState<IntakeSortKey>('itemCode');
  const [intakeSortDir, setIntakeSortDir] = useState<'asc' | 'desc'>('asc');
  const [bulkIntakeValue, setBulkIntakeValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  // 4차 필터
  const [filterVariety, setFilterVariety] = useState('');        // 차종
  const [filterSizeType, setFilterSizeType] = useState('');      // 부품유형(제품크기)
  const [filterMaterialCode, setFilterMaterialCode] = useState(''); // 재질코드
  const [filterItemName, setFilterItemName] = useState('');      // 품목명


  // --- Build maps ---
  const { paintMixMap, pCodeToMixesMap, materialTypeMap } = useMemo(() => {
    // 재질단가 맵: materialCode → currentPrice
    const matPriceMap = new Map<string, number>();
    const mtMap = new Map<string, string>();
    for (const mc of materialCodes) {
      const code = normalizePn(mc.materialCode);
      if (mc.currentPrice > 0) matPriceMap.set(code, mc.currentPrice);
      mtMap.set(code, mc.materialType || '');
    }

    // paintMixRatio에 재질단가 보강
    const pmMap = new Map<string, PaintMixRatio>();
    // P-code(주제도료코드) → 재질코드(S/X) 역매핑 (1:N 지원)
    const pToMixes = new Map<string, PaintMixRatio[]>();
    for (const pmr of paintMixRatios) {
      const enriched = { ...pmr };
      if (enriched.mainPrice <= 0 && enriched.mainCode) {
        enriched.mainPrice = matPriceMap.get(normalizePn(enriched.mainCode)) || 0;
      }
      if (enriched.hardenerPrice <= 0 && enriched.hardenerCode) {
        enriched.hardenerPrice = matPriceMap.get(normalizePn(enriched.hardenerCode)) || 0;
      }
      if (enriched.thinnerPrice <= 0 && enriched.thinnerCode) {
        enriched.thinnerPrice = matPriceMap.get(normalizePn(enriched.thinnerCode)) || 0;
      }
      // 재질코드(S/X) → mix (고유키)
      pmMap.set(normalizePn(enriched.paintCode), enriched);
      // P-code → mix[] (역매핑, 1:N)
      if (enriched.mainCode) {
        const pKey = normalizePn(enriched.mainCode);
        const existing = pToMixes.get(pKey) || [];
        existing.push(enriched);
        pToMixes.set(pKey, existing);
      }
    }
    return { paintMixMap: pmMap, pCodeToMixesMap: pToMixes, materialTypeMap: mtMap };
  }, [paintMixRatios, materialCodes]);

  // --- Match a single raw code against paint mix map ---
  // 반환: mix = 매칭된 배합비, matchedCode = 재질코드(S/X)
  const matchRawCode = useCallback((raw: string): { mix: PaintMixRatio | null; matchedCode: string } => {
    const rawNorm = normalizePn(raw);

    // 1차: 재질코드(S/X)로 직접 매칭 (이미 재질코드가 들어있는 경우)
    const directMix = paintMixMap.get(rawNorm);
    if (directMix) return { mix: directMix, matchedCode: directMix.paintCode };

    // 2차: P-code → 재질코드 역매핑 (배합기준서 기반)
    const pMixes = pCodeToMixesMap.get(rawNorm);
    if (pMixes && pMixes.length > 0) {
      // S-code 우선 (표준 레시피), 없으면 첫 번째 사용
      const sMix = pMixes.find(m => /^S/i.test(m.paintCode));
      const chosen = sMix || pMixes[0];
      return { mix: chosen, matchedCode: chosen.paintCode };
    }

    // 3차: PAINT/도료 타입 + P→S 변환 시도
    if (/^P/i.test(raw.trim())) {
      const sCode = normalizePn('S' + raw.trim().substring(1));
      const sMix = paintMixMap.get(sCode);
      if (sMix) return { mix: sMix, matchedCode: sMix.paintCode };
      // X-code도 시도
      const xCode = normalizePn('X' + raw.trim().substring(1));
      const xMix = paintMixMap.get(xCode);
      if (xMix) return { mix: xMix, matchedCode: xMix.paintCode };
    }

    return { mix: null, matchedCode: '' };
  }, [paintMixMap, pCodeToMixesMap]);

  // --- Analyze all paint items (per-coat) ---
  const paintAnalysis = useMemo((): PaintItemAnalysis[] => {
    // 도장 자작부품만 표시
    const paintItems = refInfo.filter(r =>
      /도장/.test(r.processType || '') &&
      r.supplyType === '자작' &&
      r.itemCategory === '부품'
    );

    const results: PaintItemAnalysis[] = [];

    for (const ri of paintItems) {
      const coats = [
        { num: 1, raw: ri.rawMaterialCode1, qty: ri.paintQty1 },
        { num: 2, raw: ri.rawMaterialCode2, qty: ri.paintQty2 },
        { num: 3, raw: ri.rawMaterialCode3, qty: ri.paintQty3 },
        { num: 4, raw: ri.rawMaterialCode4, qty: ri.paintQty4 },
      ].filter(c => c.raw);

      if (coats.length === 0) {
        results.push({
          itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
          variety: ri.variety || '', productSizeType: ri.productSizeType || '',
          coatNumber: 0, coatCount: 0, rawCode: '',
          matchedPaintCode: '', matchedMix: null,
          mixCostPerKg: 0, paintQty: 0, costPerEa: 0,
          matchStatus: 'unmatched_no_raw',
        });
        continue;
      }

      for (const coat of coats) {
        const { mix, matchedCode } = matchRawCode(coat.raw);
        const mixCostPerKg = mix
          ? (mix.mainRatio / 100) * mix.mainPrice + (mix.hardenerRatio / 100) * mix.hardenerPrice + (mix.thinnerRatio / 100) * mix.thinnerPrice
          : 0;
        const qty = coat.qty || 0;

        results.push({
          itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
          variety: ri.variety || '', productSizeType: ri.productSizeType || '',
          coatNumber: coat.num, coatCount: coats.length, rawCode: coat.raw,
          matchedPaintCode: matchedCode, matchedMix: mix || null,
          mixCostPerKg,
          paintQty: qty,
          costPerEa: qty > 0 && mixCostPerKg > 0 ? mixCostPerKg / qty : 0,
          matchStatus: mix ? 'matched' : 'unmatched_no_mix',
        });
      }
    }

    return results;
  }, [refInfo, matchRawCode]);

  // --- Summary stats ---
  const stats = useMemo(() => {
    // 품목 수 기준 (도 수 아닌)
    const itemSet = new Set(paintAnalysis.map(p => p.itemCode));
    const totalItems = itemSet.size;
    const totalCoats = paintAnalysis.length;
    const matched = paintAnalysis.filter(p => p.matchStatus === 'matched').length;
    const noRaw = paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_raw').length;
    const noMix = paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_mix').length;
    const withQty = paintAnalysis.filter(p => p.paintQty > 0).length;
    const withCost = paintAnalysis.filter(p => p.costPerEa > 0).length;
    const unmatchedRawCodes = new Map<string, { count: number; name: string }>();
    const matNameMap = new Map<string, string>();
    for (const mc of materialCodes) {
      if (mc.materialName) matNameMap.set(normalizePn(mc.materialCode), mc.materialName);
    }
    for (const p of paintAnalysis) {
      if (p.matchStatus === 'unmatched_no_mix' && p.rawCode) {
        const prev = unmatchedRawCodes.get(p.rawCode);
        unmatchedRawCodes.set(p.rawCode, {
          count: (prev?.count || 0) + 1,
          name: prev?.name || matNameMap.get(normalizePn(p.rawCode)) || '',
        });
      }
    }
    return { totalItems, totalCoats, matched, noRaw, noMix, withQty, withCost, unmatchedRawCodes };
  }, [paintAnalysis, materialCodes]);

  // --- Filter options (derived from paintAnalysis) ---
  const filterOptions = useMemo(() => {
    const varieties = new Map<string, number>();
    const sizeTypes = new Map<string, number>();
    const materialCodes = new Map<string, number>();
    for (const p of paintAnalysis) {
      if (p.variety) varieties.set(p.variety, (varieties.get(p.variety) || 0) + 1);
      if (p.productSizeType) sizeTypes.set(p.productSizeType, (sizeTypes.get(p.productSizeType) || 0) + 1);
      if (p.matchedPaintCode) materialCodes.set(p.matchedPaintCode, (materialCodes.get(p.matchedPaintCode) || 0) + 1);
    }
    return {
      varieties: [...varieties.entries()].sort((a, b) => b[1] - a[1]),
      sizeTypes: [...sizeTypes.entries()].sort((a, b) => b[1] - a[1]),
      materialCodes: [...materialCodes.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [paintAnalysis]);

  // --- Filtered/sorted intake list ---
  const intakeList = useMemo(() => {
    let list = [...paintAnalysis];
    // 4차 필터 적용
    if (filterVariety) list = list.filter(p => p.variety === filterVariety);
    if (filterSizeType) list = list.filter(p => p.productSizeType === filterSizeType);
    if (filterMaterialCode) list = list.filter(p => p.matchedPaintCode === filterMaterialCode);
    if (filterItemName) {
      const q = filterItemName.toUpperCase();
      list = list.filter(p => p.itemName.toUpperCase().includes(q));
    }
    // 기존 필터
    if (intakeFilter === 'empty') list = list.filter(p => p.paintQty <= 0);
    else if (intakeFilter === 'filled') list = list.filter(p => p.paintQty > 0);
    if (searchText) {
      const q = searchText.toUpperCase();
      list = list.filter(p => p.itemCode.toUpperCase().includes(q) || p.itemName.toUpperCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (intakeSort === 'itemCode') {
        cmp = a.itemCode.localeCompare(b.itemCode);
        if (cmp === 0) cmp = a.coatNumber - b.coatNumber;
      }
      else if (intakeSort === 'itemName') cmp = a.itemName.localeCompare(b.itemName);
      else if (intakeSort === 'coatNumber') cmp = a.coatNumber - b.coatNumber;
      else if (intakeSort === 'paintQty') cmp = a.paintQty - b.paintQty;
      else if (intakeSort === 'matchStatus') cmp = a.matchStatus.localeCompare(b.matchStatus);
      return intakeSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [paintAnalysis, intakeFilter, intakeSort, intakeSortDir, searchText, filterVariety, filterSizeType, filterMaterialCode, filterItemName]);

  // --- Toggle select ---
  const toggleSelect = useCallback((key: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedItems.size === intakeList.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(intakeList.map(p => coatKey(p))));
    }
  }, [selectedItems.size, intakeList]);

  // --- Bulk save ---
  const handleBulkSave = useCallback(async () => {
    const qty = parseFloat(bulkIntakeValue);
    if (!qty || qty <= 0 || selectedItems.size === 0) return;
    setSaving(true);
    try {
      // Group by itemCode, set each coat's paintQty
      const coatUpdates = new Map<string, Record<string, number>>();
      for (const key of selectedItems) {
        const [code, coatStr] = key.split('_');
        const coatNum = parseInt(coatStr);
        if (!coatNum) continue;
        const existing = coatUpdates.get(code) || {};
        const fieldKey = `paintQty${coatNum}` as 'paintQty1' | 'paintQty2' | 'paintQty3' | 'paintQty4';
        existing[fieldKey] = qty;
        coatUpdates.set(code, existing);
      }
      for (const [code, fields] of coatUpdates) {
        await referenceInfoService.updateFields(code, fields);
      }
      const updated = await referenceInfoService.getAll();
      onRefInfoUpdated(updated);
      setSelectedItems(new Set());
      setBulkIntakeValue('');
    } catch (err) {
      console.error('일괄 저장 오류:', err);
    } finally {
      setSaving(false);
    }
  }, [bulkIntakeValue, selectedItems, onRefInfoUpdated]);

  // --- Individual save ---
  const handleSingleSave = useCallback(async (itemCode: string, coatNumber: number, value: number) => {
    setSaving(true);
    try {
      const fieldKey = `paintQty${coatNumber}` as 'paintQty1' | 'paintQty2' | 'paintQty3' | 'paintQty4';
      await referenceInfoService.updateFields(itemCode, { [fieldKey]: value });
      const updated = await referenceInfoService.getAll();
      onRefInfoUpdated(updated);
    } catch (err) {
      console.error('도장량 저장 오류:', err);
    } finally {
      setSaving(false);
    }
  }, [onRefInfoUpdated]);

  const handleIntakeSort = (key: IntakeSortKey) => {
    if (intakeSort === key) {
      setIntakeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setIntakeSort(key);
      setIntakeSortDir('asc');
    }
  };

  const sortIcon = (key: IntakeSortKey) => intakeSort === key ? (intakeSortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // Unmatched raw codes sorted by count
  const unmatchedRawList = useMemo(() =>
    [...stats.unmatchedRawCodes.entries()].sort((a, b) => b[1].count - a[1].count),
  [stats.unmatchedRawCodes]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-black text-slate-800">도장 분석 대시보드</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold px-2">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          {([
            { key: 'overview' as TabKey, label: '현황 요약' },
            { key: 'unmatched' as TabKey, label: `미매칭 (${stats.noRaw + stats.noMix})` },
            { key: 'intake' as TabKey, label: `개취수량 관리 (${stats.totalCoats - stats.withQty} 미입력)` },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <SummaryCard label="도장 부품" value={stats.totalItems} unit="건" color="slate" />
                <SummaryCard label="총 도수" value={stats.totalCoats} unit="건"
                  sub={`품목당 평균 ${(stats.totalCoats / stats.totalItems).toFixed(1)}도`} color="slate" />
                <SummaryCard label="배합비 매칭" value={stats.matched} unit="건"
                  sub={`${(stats.matched / stats.totalCoats * 100).toFixed(1)}%`} color="emerald" />
                <SummaryCard label="미매칭" value={stats.noRaw + stats.noMix} unit="건"
                  sub={`코드없음 ${stats.noRaw} + 미등록 ${stats.noMix}`} color="rose" />
                <SummaryCard label="도장량 입력" value={stats.withQty} unit="건"
                  sub={`${stats.totalCoats - stats.withQty}건 미입력`} color="purple" />
              </div>

              {/* Match Rate Bar */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3">매칭률 분포 (도별 기준)</h3>
                <div className="h-8 rounded-full overflow-hidden flex bg-slate-200">
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{ width: `${stats.matched / stats.totalCoats * 100}%` }}
                    title={`매칭 ${stats.matched}건`}
                  />
                  <div
                    className="bg-amber-400 transition-all"
                    style={{ width: `${stats.noMix / stats.totalCoats * 100}%` }}
                    title={`코드있으나 미매칭 ${stats.noMix}건`}
                  />
                  <div
                    className="bg-rose-400 transition-all"
                    style={{ width: `${stats.noRaw / stats.totalCoats * 100}%` }}
                    title={`원재료코드 없음 ${stats.noRaw}건`}
                  />
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> 매칭 {(stats.matched / stats.totalCoats * 100).toFixed(1)}%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> 코드미등록 {(stats.noMix / stats.totalCoats * 100).toFixed(1)}%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-400 inline-block" /> 원재료없음 {(stats.noRaw / stats.totalCoats * 100).toFixed(1)}%</span>
                </div>
              </div>

              {/* Cost Distribution */}
              {stats.withCost > 0 && (
                <div className="bg-purple-50 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-purple-700 mb-3">도료비 분포 (산출된 {stats.withCost}건)</h3>
                  <CostDistribution items={paintAnalysis.filter(p => p.costPerEa > 0)} />
                </div>
              )}

              {/* Action Guide */}
              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800 space-y-3">
                <p className="font-bold">개선 가이드</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  {stats.noRaw > 0 && <li><strong>원재료코드 없음 ({stats.noRaw}건)</strong>: 기준정보 엑셀에서 원재료코드를 등록 후 재업로드 필요</li>}
                  {stats.noMix > 0 && <li><strong>배합비 미등록 ({stats.noMix}건, {stats.unmatchedRawCodes.size}개 코드)</strong>: 배합표준서에 해당 도료코드 추가 후 재업로드 필요</li>}
                  {stats.withQty < stats.totalCoats && <li><strong>도장량 미입력 ({stats.totalCoats - stats.withQty}건)</strong>: &ldquo;개취수량 관리&rdquo; 탭에서 도별로 입력 가능</li>}
                </ul>
                {stats.noMix > 0 && (
                  <div className="mt-2 bg-blue-100/60 rounded-lg p-3 text-xs space-y-2">
                    <p className="font-bold text-blue-900">배합비 미등록 해결 방법</p>
                    <div className="space-y-1.5 text-blue-800">
                      <div className="flex gap-2">
                        <span className="shrink-0 font-bold text-blue-600">A.</span>
                        <div><strong>배합표준서 보강</strong> — &ldquo;미매칭&rdquo; 탭에서 미등록 도료코드 {stats.unmatchedRawCodes.size}개를 확인하고, 배합표준서 Excel에 해당 코드의 주제/경화제/신너 비율을 추가한 후 재업로드합니다. <span className="text-blue-500">(근본 해결)</span></div>
                      </div>
                      <div className="flex gap-2">
                        <span className="shrink-0 font-bold text-blue-600">B.</span>
                        <div><strong>기준정보 원재료코드 수정</strong> — 원재료코드가 잘못 등록된 경우, 기준정보 엑셀에서 올바른 도료코드(배합표준서에 있는 코드)로 수정 후 재업로드합니다.</div>
                      </div>
                      <div className="flex gap-2">
                        <span className="shrink-0 font-bold text-blue-600">C.</span>
                        <div><strong>코드 체계 확인</strong> — P코드→S/X코드(재질코드) 자동 변환이 적용됩니다. S코드 우선, X코드 보조로 매칭합니다.</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'unmatched' && (
            <div className="space-y-4">
              {/* Unmatched raw codes */}
              <div className="bg-amber-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-700 mb-2">
                  배합표준서 미등록 도료코드 ({stats.unmatchedRawCodes.size}개)
                </h3>
                <p className="text-xs text-amber-600 mb-3">이 코드들이 배합표준서에 등록되면 매칭률이 향상됩니다.</p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-amber-50">
                      <tr className="text-left border-b border-amber-200">
                        <th className="py-1.5 px-2 font-bold">도료코드</th>
                        <th className="py-1.5 px-2 font-bold">도료명</th>
                        <th className="py-1.5 px-2 font-bold text-right">사용 품목수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedRawList.map(([code, { count, name }]) => (
                        <tr key={code} className="border-b border-amber-100 hover:bg-amber-100/50">
                          <td className="py-1.5 px-2 font-mono">{code}</td>
                          <td className="py-1.5 px-2 text-slate-600">{name || '—'}</td>
                          <td className="py-1.5 px-2 text-right">{count}건</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* No raw code items */}
              <div className="bg-rose-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-700 mb-2">
                  원재료코드 없는 도장품 ({stats.noRaw}건)
                </h3>
                <p className="text-xs text-rose-600 mb-3">기준정보에 원재료코드를 등록해주세요.</p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-rose-50">
                      <tr className="text-left border-b border-rose-200">
                        <th className="py-1.5 px-2 font-bold">품목코드</th>
                        <th className="py-1.5 px-2 font-bold">품목명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_raw').map(p => (
                        <tr key={p.itemCode} className="border-b border-rose-100 hover:bg-rose-100/50">
                          <td className="py-1.5 px-2 font-mono">{p.itemCode}</td>
                          <td className="py-1.5 px-2">{p.itemName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unmatched with raw codes */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-2">
                  원재료코드 있으나 미매칭 ({stats.noMix}건)
                </h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left border-b border-slate-200">
                        <th className="py-1.5 px-2 font-bold">품목코드</th>
                        <th className="py-1.5 px-2 font-bold">품목명</th>
                        <th className="py-1.5 px-2 font-bold">도</th>
                        <th className="py-1.5 px-2 font-bold">원재료코드</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_mix').map(p => (
                        <tr key={coatKey(p)} className="border-b border-slate-100 hover:bg-slate-100/50">
                          <td className="py-1.5 px-2 font-mono">{p.itemCode}</td>
                          <td className="py-1.5 px-2">{p.itemName}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">{p.coatNumber}도</span>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-amber-600">{p.rawCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'intake' && (
            <div className="space-y-3">
              {/* 4차 필터 */}
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-slate-600">필터</span>
                  {(filterVariety || filterSizeType || filterMaterialCode || filterItemName) && (
                    <button
                      onClick={() => { setFilterVariety(''); setFilterSizeType(''); setFilterMaterialCode(''); setFilterItemName(''); }}
                      className="text-[10px] text-rose-500 hover:text-rose-700 font-bold"
                    >
                      전체 초기화
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-0.5 block">차종</label>
                    <select
                      value={filterVariety}
                      onChange={e => setFilterVariety(e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="">전체 ({paintAnalysis.length})</option>
                      {filterOptions.varieties.map(([v, cnt]) => (
                        <option key={v} value={v}>{v} ({cnt})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-0.5 block">부품유형</label>
                    <select
                      value={filterSizeType}
                      onChange={e => setFilterSizeType(e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="">전체</option>
                      {filterOptions.sizeTypes.map(([v, cnt]) => (
                        <option key={v} value={v}>{v} ({cnt})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-0.5 block">재질코드</label>
                    <select
                      value={filterMaterialCode}
                      onChange={e => setFilterMaterialCode(e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="">전체</option>
                      {filterOptions.materialCodes.map(([v, cnt]) => (
                        <option key={v} value={v}>{v} ({cnt})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 mb-0.5 block">품목명</label>
                    <input
                      type="text"
                      placeholder="품목명 검색..."
                      value={filterItemName}
                      onChange={e => setFilterItemName(e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Bulk actions */}
              <div className="bg-purple-50 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-purple-700">일괄 설정:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="개취수량 (EA/kg)"
                      value={bulkIntakeValue}
                      onChange={e => setBulkIntakeValue(e.target.value)}
                      className="w-36 px-3 py-1.5 border-2 border-purple-300 rounded-lg text-sm font-mono focus:border-purple-500 focus:outline-none"
                    />
                    <button
                      onClick={handleBulkSave}
                      disabled={saving || !bulkIntakeValue || selectedItems.size === 0}
                      className="px-4 py-1.5 bg-purple-600 text-white text-sm font-bold rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? '저장중...' : `선택 ${selectedItems.size}건 적용`}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="text"
                      placeholder="품목코드 검색"
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      className="w-36 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
                    />
                    <select
                      value={intakeFilter}
                      onChange={e => setIntakeFilter(e.target.value as typeof intakeFilter)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="all">전체 ({stats.totalCoats})</option>
                      <option value="empty">미입력 ({stats.totalCoats - stats.withQty})</option>
                      <option value="filled">입력됨 ({stats.withQty})</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="max-h-[50vh] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 z-10">
                      <tr className="border-b border-slate-200">
                        <th className="py-2 px-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedItems.size > 0 && selectedItems.size === intakeList.length}
                            onChange={toggleSelectAll}
                            className="w-3.5 h-3.5"
                          />
                        </th>
                        <th onClick={() => handleIntakeSort('itemCode')} className="py-2 px-2 text-left font-bold cursor-pointer hover:bg-slate-100">
                          품목코드{sortIcon('itemCode')}
                        </th>
                        <th onClick={() => handleIntakeSort('itemName')} className="py-2 px-2 text-left font-bold cursor-pointer hover:bg-slate-100">
                          품목명{sortIcon('itemName')}
                        </th>
                        <th onClick={() => handleIntakeSort('coatNumber')} className="py-2 px-2 text-center font-bold cursor-pointer hover:bg-slate-100">
                          도{sortIcon('coatNumber')}
                        </th>
                        <th className="py-2 px-2 text-left font-bold">재질코드</th>
                        <th onClick={() => handleIntakeSort('matchStatus')} className="py-2 px-2 text-center font-bold cursor-pointer hover:bg-slate-100">
                          매칭{sortIcon('matchStatus')}
                        </th>
                        <th className="py-2 px-2 text-right font-bold">배합단가</th>
                        <th onClick={() => handleIntakeSort('paintQty')} className="py-2 px-2 text-right font-bold cursor-pointer hover:bg-slate-100">
                          개취수량{sortIcon('paintQty')}
                        </th>
                        <th className="py-2 px-2 text-right font-bold">도료비/EA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intakeList.map((p, idx) => {
                        // 같은 품목코드의 첫 행인지 확인 (시각적 그룹핑)
                        const prevItem = idx > 0 ? intakeList[idx - 1] : null;
                        const isNewGroup = !prevItem || prevItem.itemCode !== p.itemCode;
                        return (
                          <IntakeRow
                            key={coatKey(p)}
                            item={p}
                            isNewGroup={isNewGroup}
                            selected={selectedItems.has(coatKey(p))}
                            onToggle={() => toggleSelect(coatKey(p))}
                            onSave={handleSingleSave}
                            saving={saving}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                  {intakeList.length === 0 && (
                    <div className="py-12 text-center text-slate-400 text-sm">해당 조건의 품목이 없습니다.</div>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400">
                필터 결과: {intakeList.length}건 / 전체: {stats.totalCoats}건 ({stats.totalItems}개 부품)
                {(filterVariety || filterSizeType || filterMaterialCode || filterItemName) && (
                  <span className="ml-2 text-purple-500 font-bold">
                    [필터: {[filterVariety && `차종=${filterVariety}`, filterSizeType && `유형=${filterSizeType}`, filterMaterialCode && `재질=${filterMaterialCode}`, filterItemName && `품명="${filterItemName}"`].filter(Boolean).join(', ')}]
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// Sub-components
// ============================================

const SummaryCard: React.FC<{
  label: string; value: number; unit: string; sub?: string;
  color: 'slate' | 'emerald' | 'rose' | 'purple';
}> = ({ label, value, unit, sub, color }) => {
  const colorMap = {
    slate: 'bg-slate-50 text-slate-800',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colorMap[color]}`}>
      <div className="text-xs font-bold opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-black">{value.toLocaleString()}<span className="text-sm font-bold ml-1">{unit}</span></div>
      {sub && <div className="text-[10px] mt-1 opacity-60">{sub}</div>}
    </div>
  );
};

const CostDistribution: React.FC<{ items: PaintItemAnalysis[] }> = ({ items }) => {
  if (items.length === 0) return null;
  const costs = items.map(p => p.costPerEa).sort((a, b) => a - b);
  const min = costs[0];
  const max = costs[costs.length - 1];
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  const median = costs[Math.floor(costs.length / 2)];

  // Histogram: 5 bins
  const binCount = 5;
  const binSize = (max - min) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * binSize,
    to: min + (i + 1) * binSize,
    count: 0,
  }));
  for (const c of costs) {
    const idx = Math.min(Math.floor((c - min) / binSize), binCount - 1);
    bins[idx].count++;
  }
  const maxBin = Math.max(...bins.map(b => b.count));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div><span className="text-purple-500">최소</span> <span className="font-mono font-bold">{fmtWon(min)}</span></div>
        <div><span className="text-purple-500">최대</span> <span className="font-mono font-bold">{fmtWon(max)}</span></div>
        <div><span className="text-purple-500">평균</span> <span className="font-mono font-bold">{fmtWon(avg)}</span></div>
        <div><span className="text-purple-500">중앙값</span> <span className="font-mono font-bold">{fmtWon(median)}</span></div>
      </div>
      <div className="flex items-end gap-1 h-16">
        {bins.map((bin, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-purple-400 rounded-t transition-all"
              style={{ height: `${maxBin > 0 ? (bin.count / maxBin) * 48 : 0}px` }}
              title={`${fmtWon(bin.from)} ~ ${fmtWon(bin.to)}: ${bin.count}건`}
            />
            <span className="text-[9px] text-purple-500 font-mono">{bin.count}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-purple-400 font-mono">
        <span>{fmtWon(min)}</span>
        <span>{fmtWon(max)}</span>
      </div>
    </div>
  );
};

const COAT_COLORS = ['', 'bg-blue-50', 'bg-indigo-50', 'bg-violet-50', 'bg-fuchsia-50'];
const COAT_BADGE_COLORS = ['', 'bg-blue-100 text-blue-700', 'bg-indigo-100 text-indigo-700', 'bg-violet-100 text-violet-700', 'bg-fuchsia-100 text-fuchsia-700'];

const IntakeRow: React.FC<{
  item: PaintItemAnalysis;
  isNewGroup: boolean;
  selected: boolean;
  onToggle: () => void;
  onSave: (code: string, coatNumber: number, value: number) => Promise<void>;
  saving: boolean;
}> = ({ item, isNewGroup, selected, onToggle, onSave, saving }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.paintQty || ''));
  const [showTooltip, setShowTooltip] = useState(false);

  const handleSave = async () => {
    const num = parseFloat(value);
    if (!num || num <= 0) return;
    await onSave(item.itemCode, item.coatNumber, num);
    setEditing(false);
  };

  const matchBadge = item.matchStatus === 'matched'
    ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">OK</span>
    : item.matchStatus === 'unmatched_no_raw'
    ? <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 text-[10px] font-bold">코드없음</span>
    : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 text-[10px] font-bold">미등록</span>;

  const costPerEa = item.paintQty > 0 && item.mixCostPerKg > 0 ? item.mixCostPerKg / item.paintQty : 0;

  return (
    <tr className={`border-b hover:bg-slate-50 ${selected ? 'bg-purple-50' : ''} ${isNewGroup ? 'border-t-2 border-t-slate-300' : 'border-slate-100'}`}>
      <td className="py-1.5 px-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="w-3.5 h-3.5" />
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-700">
        {isNewGroup ? item.itemCode : <span className="text-slate-300">〃</span>}
      </td>
      <td className="py-1.5 px-2 text-slate-600 max-w-[180px] truncate">
        {isNewGroup ? item.itemName : ''}
      </td>
      <td className="py-1.5 px-2 text-center">
        {item.coatNumber > 0 ? (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${COAT_BADGE_COLORS[item.coatNumber] || COAT_BADGE_COLORS[1]}`}>
            {item.coatNumber}도
          </span>
        ) : '—'}
      </td>
      <td className="py-1.5 px-2 font-mono text-[10px]">
        {item.matchedPaintCode ? (
          <div>
            <span className="text-slate-700 font-bold">{item.matchedPaintCode}</span>
            {item.rawCode && item.rawCode !== item.matchedPaintCode && (
              <span className="text-slate-400 ml-1">({item.rawCode})</span>
            )}
          </div>
        ) : (
          <span className="text-slate-400">{item.rawCode || '—'}</span>
        )}
      </td>
      <td className="py-1.5 px-2 text-center">{matchBadge}</td>
      <td
        className="py-1.5 px-2 text-right font-mono text-slate-600 relative cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {item.mixCostPerKg > 0 ? fmtWon(item.mixCostPerKg) + '/kg' : '—'}
        {showTooltip && item.matchedMix && (
          <div className="absolute z-50 right-0 top-full mt-1 w-72 bg-slate-800 text-white rounded-xl shadow-2xl p-3 text-[11px] leading-relaxed pointer-events-none">
            <div className="font-bold text-purple-300 mb-2">{item.coatNumber}도 배합단가 산출근거</div>
            <div className="text-slate-300 mb-2">재질코드: <span className="font-mono text-white">{item.matchedPaintCode}</span>{item.rawCode && item.rawCode !== item.matchedPaintCode && <span className="text-slate-500 ml-1">(P: {item.rawCode})</span>}</div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-slate-400 border-b border-slate-600">
                  <th className="text-left py-1">구분</th>
                  <th className="text-right py-1">비율</th>
                  <th className="text-right py-1">단가(/kg)</th>
                  <th className="text-right py-1">금액</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-700">
                  <td className="py-1">주제 <span className="text-slate-500 font-mono">{item.matchedMix.mainCode || '—'}</span></td>
                  <td className="text-right font-mono">{item.matchedMix.mainRatio}%</td>
                  <td className="text-right font-mono">{fmtWon(item.matchedMix.mainPrice)}</td>
                  <td className="text-right font-mono text-emerald-400">{fmtWon(item.matchedMix.mainRatio / 100 * item.matchedMix.mainPrice)}</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-1">경화제 <span className="text-slate-500 font-mono">{item.matchedMix.hardenerCode || '—'}</span></td>
                  <td className="text-right font-mono">{item.matchedMix.hardenerRatio}%</td>
                  <td className="text-right font-mono">{fmtWon(item.matchedMix.hardenerPrice)}</td>
                  <td className="text-right font-mono text-emerald-400">{fmtWon(item.matchedMix.hardenerRatio / 100 * item.matchedMix.hardenerPrice)}</td>
                </tr>
                <tr>
                  <td className="py-1">신너 <span className="text-slate-500 font-mono">{item.matchedMix.thinnerCode || '—'}</span></td>
                  <td className="text-right font-mono">{item.matchedMix.thinnerRatio}%</td>
                  <td className="text-right font-mono">{fmtWon(item.matchedMix.thinnerPrice)}</td>
                  <td className="text-right font-mono text-emerald-400">{fmtWon(item.matchedMix.thinnerRatio / 100 * item.matchedMix.thinnerPrice)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 pt-2 border-t border-slate-600 flex justify-between font-bold">
              <span className="text-purple-300">배합단가</span>
              <span className="text-yellow-300 font-mono">{fmtWon(item.mixCostPerKg)}/kg</span>
            </div>
            {item.paintQty > 0 && (
              <div className="mt-1 flex justify-between text-slate-400">
                <span>도료비/EA = {fmtWon(item.mixCostPerKg)}/kg ÷ {item.paintQty} EA/kg</span>
                <span className="text-yellow-300 font-mono">{fmtWon(costPerEa)}</span>
              </div>
            )}
          </div>
        )}
      </td>
      <td className="py-1.5 px-2 text-right">
        {editing ? (
          <div className="flex items-center gap-1 justify-end">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className="w-20 px-1.5 py-0.5 border border-purple-400 rounded text-right text-xs font-mono"
              autoFocus
            />
            <button onClick={handleSave} disabled={saving} className="text-[10px] text-purple-600 font-bold hover:underline">OK</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-slate-400 hover:underline">X</button>
          </div>
        ) : (
          <span
            onClick={() => { setEditing(true); setValue(String(item.paintQty || '')); }}
            className={`cursor-pointer hover:underline font-mono ${item.paintQty > 0 ? 'text-slate-700' : 'text-rose-400'}`}
          >
            {item.paintQty > 0 ? `${item.paintQty}` : '미입력'}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 text-right font-mono font-bold text-purple-700">
        {costPerEa > 0 ? fmtWon(costPerEa) : '—'}
      </td>
    </tr>
  );
};

export default PaintAnalysisPanel;
