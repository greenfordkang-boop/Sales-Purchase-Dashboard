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
  rawCodes: string[];
  matchedPaintCode: string;
  matchedMix: PaintMixRatio | null;
  mixCostPerKg: number;
  paintIntake: number;
  costPerEa: number;
  matchStatus: 'matched' | 'unmatched_no_raw' | 'unmatched_no_mix';
}

type TabKey = 'overview' | 'unmatched' | 'intake';
type IntakeSortKey = 'itemCode' | 'itemName' | 'processType' | 'paintIntake' | 'matchStatus';

const fmtWon = (v: number) => v > 0 ? `₩${Math.round(v).toLocaleString()}` : '—';

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

  // --- Build maps ---
  const { paintMixMap, materialTypeMap } = useMemo(() => {
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
      pmMap.set(normalizePn(enriched.paintCode), enriched);
      if (enriched.mainCode) pmMap.set(normalizePn(enriched.mainCode), enriched);
    }
    return { paintMixMap: pmMap, materialTypeMap: mtMap };
  }, [paintMixRatios, materialCodes]);

  // --- Analyze all paint items ---
  const paintAnalysis = useMemo((): PaintItemAnalysis[] => {
    // 외주도장은 제외 (구매단가로 처리되므로 도장산출 불필요)
    const paintItems = refInfo.filter(r =>
      /도장/.test(r.processType || '') && !/외주/.test(r.supplyType || '')
    );
    return paintItems.map(ri => {
      const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4].filter(Boolean);

      if (rawCodes.length === 0) {
        return {
          itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
          rawCodes: [], matchedPaintCode: '', matchedMix: null,
          mixCostPerKg: 0, paintIntake: ri.paintIntake || 0, costPerEa: 0,
          matchStatus: 'unmatched_no_raw' as const,
        };
      }

      // 1차: PAINT/도료 타입 코드로 매칭
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        const matType = materialTypeMap.get(rawNorm) || '';
        if (!/PAINT|도료/i.test(matType)) continue;
        const mix = paintMixMap.get(rawNorm);
        if (!mix) continue;
        const mixCostPerKg = (mix.mainRatio / 100) * mix.mainPrice + (mix.hardenerRatio / 100) * mix.hardenerPrice + (mix.thinnerRatio / 100) * mix.thinnerPrice;
        const intake = ri.paintIntake || 0;
        return {
          itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
          rawCodes, matchedPaintCode: raw, matchedMix: mix,
          mixCostPerKg, paintIntake: intake, costPerEa: intake > 0 ? mixCostPerKg / intake : 0,
          matchStatus: 'matched' as const,
        };
      }

      // 2차: rawCode 직접 매칭 (materialType 무관) + P→S 변환
      for (const raw of rawCodes) {
        const rawNorm = normalizePn(raw);
        let mix = paintMixMap.get(rawNorm);
        if (!mix && /^P/.test(raw.trim().toUpperCase())) {
          const sCode = normalizePn('S' + raw.trim().substring(1));
          mix = paintMixMap.get(sCode);
        }
        if (!mix) continue;
        const mixCostPerKg = (mix.mainRatio / 100) * mix.mainPrice + (mix.hardenerRatio / 100) * mix.hardenerPrice + (mix.thinnerRatio / 100) * mix.thinnerPrice;
        const intake = ri.paintIntake || 0;
        return {
          itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
          rawCodes, matchedPaintCode: raw, matchedMix: mix,
          mixCostPerKg, paintIntake: intake, costPerEa: intake > 0 ? mixCostPerKg / intake : 0,
          matchStatus: 'matched' as const,
        };
      }

      return {
        itemCode: ri.itemCode, itemName: ri.itemName, processType: ri.processType,
        rawCodes, matchedPaintCode: '', matchedMix: null,
        mixCostPerKg: 0, paintIntake: ri.paintIntake || 0, costPerEa: 0,
        matchStatus: 'unmatched_no_mix' as const,
      };
    });
  }, [refInfo, paintMixMap, materialTypeMap]);

  // --- Summary stats ---
  const stats = useMemo(() => {
    const total = paintAnalysis.length;
    const matched = paintAnalysis.filter(p => p.matchStatus === 'matched').length;
    const noRaw = paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_raw').length;
    const noMix = paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_mix').length;
    const withIntake = paintAnalysis.filter(p => p.paintIntake > 0).length;
    const withCost = paintAnalysis.filter(p => p.costPerEa > 0).length;
    const unmatchedRawCodes = new Map<string, { count: number; name: string }>();
    const matNameMap = new Map<string, string>();
    for (const mc of materialCodes) {
      if (mc.materialName) matNameMap.set(normalizePn(mc.materialCode), mc.materialName);
    }
    for (const p of paintAnalysis) {
      if (p.matchStatus === 'unmatched_no_mix') {
        for (const raw of p.rawCodes) {
          const prev = unmatchedRawCodes.get(raw);
          unmatchedRawCodes.set(raw, {
            count: (prev?.count || 0) + 1,
            name: prev?.name || matNameMap.get(normalizePn(raw)) || '',
          });
        }
      }
    }
    return { total, matched, noRaw, noMix, withIntake, withCost, unmatchedRawCodes };
  }, [paintAnalysis]);

  // --- Filtered/sorted intake list ---
  const intakeList = useMemo(() => {
    let list = [...paintAnalysis];
    if (intakeFilter === 'empty') list = list.filter(p => p.paintIntake <= 0);
    else if (intakeFilter === 'filled') list = list.filter(p => p.paintIntake > 0);
    if (searchText) {
      const q = searchText.toUpperCase();
      list = list.filter(p => p.itemCode.toUpperCase().includes(q) || p.itemName.toUpperCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (intakeSort === 'itemCode') cmp = a.itemCode.localeCompare(b.itemCode);
      else if (intakeSort === 'itemName') cmp = a.itemName.localeCompare(b.itemName);
      else if (intakeSort === 'processType') cmp = a.processType.localeCompare(b.processType);
      else if (intakeSort === 'paintIntake') cmp = a.paintIntake - b.paintIntake;
      else if (intakeSort === 'matchStatus') cmp = a.matchStatus.localeCompare(b.matchStatus);
      return intakeSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [paintAnalysis, intakeFilter, intakeSort, intakeSortDir, searchText]);

  // --- Toggle select ---
  const toggleSelect = useCallback((code: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedItems.size === intakeList.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(intakeList.map(p => p.itemCode)));
    }
  }, [selectedItems.size, intakeList]);

  // --- Bulk save ---
  const handleBulkSave = useCallback(async () => {
    const intake = parseFloat(bulkIntakeValue);
    if (!intake || intake <= 0 || selectedItems.size === 0) return;
    setSaving(true);
    try {
      const codes = [...selectedItems];
      for (const code of codes) {
        await referenceInfoService.updateFields(code, { paintIntake: intake });
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

  // --- Individual intake save ---
  const handleSingleIntakeSave = useCallback(async (itemCode: string, value: number) => {
    setSaving(true);
    try {
      await referenceInfoService.updateFields(itemCode, { paintIntake: value });
      const updated = await referenceInfoService.getAll();
      onRefInfoUpdated(updated);
    } catch (err) {
      console.error('개취수량 저장 오류:', err);
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
            { key: 'intake' as TabKey, label: `개취수량 관리 (${stats.total - stats.withIntake} 미입력)` },
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard label="전체 도장품" value={stats.total} unit="건" color="slate" />
                <SummaryCard label="배합비 매칭" value={stats.matched} unit="건"
                  sub={`${(stats.matched / stats.total * 100).toFixed(1)}%`} color="emerald" />
                <SummaryCard label="미매칭" value={stats.noRaw + stats.noMix} unit="건"
                  sub={`코드없음 ${stats.noRaw} + 미등록 ${stats.noMix}`} color="rose" />
                <SummaryCard label="개취수량 입력" value={stats.withIntake} unit="건"
                  sub={`${stats.total - stats.withIntake}건 미입력`} color="purple" />
              </div>

              {/* Match Rate Bar */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3">매칭률 분포</h3>
                <div className="h-8 rounded-full overflow-hidden flex bg-slate-200">
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{ width: `${stats.matched / stats.total * 100}%` }}
                    title={`매칭 ${stats.matched}건`}
                  />
                  <div
                    className="bg-amber-400 transition-all"
                    style={{ width: `${stats.noMix / stats.total * 100}%` }}
                    title={`코드있으나 미매칭 ${stats.noMix}건`}
                  />
                  <div
                    className="bg-rose-400 transition-all"
                    style={{ width: `${stats.noRaw / stats.total * 100}%` }}
                    title={`원재료코드 없음 ${stats.noRaw}건`}
                  />
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> 매칭 {(stats.matched / stats.total * 100).toFixed(1)}%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> 코드미등록 {(stats.noMix / stats.total * 100).toFixed(1)}%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-400 inline-block" /> 원재료없음 {(stats.noRaw / stats.total * 100).toFixed(1)}%</span>
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
                  {stats.withIntake < stats.total && <li><strong>개취수량 미입력 ({stats.total - stats.withIntake}건)</strong>: &ldquo;개취수량 관리&rdquo; 탭에서 일괄 입력 가능</li>}
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
                        <div><strong>코드 체계 확인</strong> — P코드↔S코드 변환이 자동 적용되므로, 변환 불가한 코드 체계(예: 접두사가 다른 경우)는 배합표준서에 직접 등록이 필요합니다.</div>
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
                        <th className="py-1.5 px-2 font-bold">원재료코드</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paintAnalysis.filter(p => p.matchStatus === 'unmatched_no_mix').map(p => (
                        <tr key={p.itemCode} className="border-b border-slate-100 hover:bg-slate-100/50">
                          <td className="py-1.5 px-2 font-mono">{p.itemCode}</td>
                          <td className="py-1.5 px-2">{p.itemName}</td>
                          <td className="py-1.5 px-2 font-mono text-amber-600">{p.rawCodes.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'intake' && (
            <div className="space-y-4">
              {/* Bulk actions */}
              <div className="bg-purple-50 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-purple-700">일괄 설정:</span>
                    <input
                      type="number"
                      step="1"
                      min="1"
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
                      placeholder="품목코드/품명 검색"
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      className="w-48 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
                    />
                    <select
                      value={intakeFilter}
                      onChange={e => setIntakeFilter(e.target.value as typeof intakeFilter)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="all">전체 ({stats.total})</option>
                      <option value="empty">미입력 ({stats.total - stats.withIntake})</option>
                      <option value="filled">입력됨 ({stats.withIntake})</option>
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
                        <th onClick={() => handleIntakeSort('matchStatus')} className="py-2 px-2 text-center font-bold cursor-pointer hover:bg-slate-100">
                          매칭{sortIcon('matchStatus')}
                        </th>
                        <th className="py-2 px-2 text-right font-bold">주제(%)</th>
                        <th className="py-2 px-2 text-right font-bold">경화제(%)</th>
                        <th className="py-2 px-2 text-right font-bold">신너(%)</th>
                        <th className="py-2 px-2 text-right font-bold">총중량(%)</th>
                        <th className="py-2 px-2 text-right font-bold">배합단가</th>
                        <th onClick={() => handleIntakeSort('paintIntake')} className="py-2 px-2 text-right font-bold cursor-pointer hover:bg-slate-100">
                          개취수량{sortIcon('paintIntake')}
                        </th>
                        <th className="py-2 px-2 text-right font-bold">도료비/EA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intakeList.map(p => (
                        <IntakeRow
                          key={p.itemCode}
                          item={p}
                          selected={selectedItems.has(p.itemCode)}
                          onToggle={() => toggleSelect(p.itemCode)}
                          onSave={handleSingleIntakeSave}
                          saving={saving}
                        />
                      ))}
                    </tbody>
                  </table>
                  {intakeList.length === 0 && (
                    <div className="py-12 text-center text-slate-400 text-sm">해당 조건의 품목이 없습니다.</div>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-400">
                표시: {intakeList.length}건 / 전체 도장품: {stats.total}건
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

const IntakeRow: React.FC<{
  item: PaintItemAnalysis;
  selected: boolean;
  onToggle: () => void;
  onSave: (code: string, value: number) => Promise<void>;
  saving: boolean;
}> = ({ item, selected, onToggle, onSave, saving }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.paintIntake || ''));
  const [showTooltip, setShowTooltip] = useState(false);

  const handleSave = async () => {
    const num = parseFloat(value);
    if (!num || num <= 0) return;
    await onSave(item.itemCode, num);
    setEditing(false);
  };

  const matchBadge = item.matchStatus === 'matched'
    ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">OK</span>
    : item.matchStatus === 'unmatched_no_raw'
    ? <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 text-[10px] font-bold">코드없음</span>
    : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 text-[10px] font-bold">미등록</span>;

  const costPerEa = item.paintIntake > 0 ? item.mixCostPerKg / item.paintIntake : 0;

  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${selected ? 'bg-purple-50' : ''}`}>
      <td className="py-1.5 px-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="w-3.5 h-3.5" />
      </td>
      <td className="py-1.5 px-2 font-mono text-slate-700">{item.itemCode}</td>
      <td className="py-1.5 px-2 text-slate-600 max-w-[200px] truncate">{item.itemName}</td>
      <td className="py-1.5 px-2 text-center">{matchBadge}</td>
      <td className="py-1.5 px-2 text-right font-mono text-slate-600">
        {item.matchedMix ? `${item.matchedMix.mainRatio}` : '—'}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-slate-600">
        {item.matchedMix ? `${item.matchedMix.hardenerRatio}` : '—'}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-slate-600">
        {item.matchedMix ? `${item.matchedMix.thinnerRatio}` : '—'}
      </td>
      <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-700">
        {item.matchedMix
          ? `${(item.matchedMix.mainRatio + item.matchedMix.hardenerRatio + item.matchedMix.thinnerRatio).toFixed(1)}`
          : '—'}
      </td>
      <td
        className="py-1.5 px-2 text-right font-mono text-slate-600 relative cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {item.mixCostPerKg > 0 ? fmtWon(item.mixCostPerKg) + '/kg' : '—'}
        {showTooltip && item.matchedMix && (
          <div className="absolute z-50 right-0 top-full mt-1 w-72 bg-slate-800 text-white rounded-xl shadow-2xl p-3 text-[11px] leading-relaxed pointer-events-none">
            <div className="font-bold text-purple-300 mb-2">배합단가 산출근거</div>
            <div className="text-slate-300 mb-2">도료코드: <span className="font-mono text-white">{item.matchedPaintCode}</span></div>
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
            {item.paintIntake > 0 && (
              <div className="mt-1 flex justify-between text-slate-400">
                <span>도료비/EA = {fmtWon(item.mixCostPerKg)}/kg ÷ {item.paintIntake} EA/kg</span>
                <span className="text-yellow-300 font-mono">{fmtWon(item.mixCostPerKg / item.paintIntake)}</span>
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
              step="1"
              min="1"
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
            onClick={() => { setEditing(true); setValue(String(item.paintIntake || '')); }}
            className={`cursor-pointer hover:underline font-mono ${item.paintIntake > 0 ? 'text-slate-700' : 'text-rose-400'}`}
          >
            {item.paintIntake > 0 ? `${item.paintIntake}` : '미입력'}
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
