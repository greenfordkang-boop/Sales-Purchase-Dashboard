/**
 * CostAnalysisView — 원가분석 통합 워크벤치 v3
 * BomReviewView와 100% 동일한 bomCostEngine 기반
 */
import React, { useState, useMemo } from 'react';
import { useCostAnalysis, CostAnalysisData, ProductCostRow, LeafMaterialRow } from '../hooks/useCostAnalysis';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

type AnalysisMode = 'standard' | 'product' | 'yield' | 'mrp';

const MODE_TABS: { id: AnalysisMode; label: string; desc: string }[] = [
  { id: 'standard', label: '표준재료비', desc: '총괄 요약' },
  { id: 'product', label: '제품별 재료비', desc: '제품 단위 원가' },
  { id: 'yield', label: '자재수율', desc: '유형별 소요' },
  { id: 'mrp', label: 'MRP', desc: '자재별/업체별' },
];

const fmt = (n: number) => {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (Math.abs(n) >= 1e4) return `${Math.round(n / 1e4)}만`;
  return Math.round(n).toLocaleString();
};

const TYPE_COLORS: Record<string, string> = { RESIN: '#6366f1', PAINT: '#f59e0b', '구매': '#10b981', '외주': '#ef4444', '사출': '#8b5cf6', '도장': '#f97316' };

const typeBadgeClass = (t: string) =>
  t === 'RESIN' ? 'bg-indigo-100 text-indigo-700' :
  t === '사출' ? 'bg-violet-100 text-violet-700' :
  t === 'PAINT' ? 'bg-amber-100 text-amber-700' :
  t === '도장' ? 'bg-orange-100 text-orange-700' :
  t === '외주' ? 'bg-blue-100 text-blue-700' :
  'bg-emerald-100 text-emerald-700';

// ============================================================
// KPICard
// ============================================================
const KPICard: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color = 'slate' }) => {
  const colorMap: Record<string, string> = {
    indigo: 'border-indigo-200 bg-indigo-50',
    violet: 'border-violet-200 bg-violet-50',
    amber: 'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    red: 'border-red-200 bg-red-50',
    slate: 'border-slate-200 bg-slate-50',
  };
  return (
    <div className={`rounded-xl border p-3 ${colorMap[color] || colorMap.slate}`}>
      <div className="text-[10px] font-bold text-slate-500">{label}</div>
      <div className="text-base font-black text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
};

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-center justify-center py-20 text-sm text-slate-400">{message}</div>
);

// ============================================================
// ForecastSummaryBar
// ============================================================
const ForecastSummaryBar: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { forecastSummary, loading, costResult } = data;

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-4 border border-indigo-100 animate-pulse">
        <div className="h-6 bg-indigo-200 rounded w-1/3 mb-2" />
        <div className="h-4 bg-indigo-100 rounded w-2/3" />
      </div>
    );
  }

  if (!forecastSummary) {
    return (
      <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
        <div className="flex items-center gap-2 text-amber-700">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          <span className="text-sm font-bold">매출계획 데이터가 없습니다. 영업현황 &gt; 매출계획에서 업로드해주세요.</span>
        </div>
      </div>
    );
  }

  const s = forecastSummary;
  const summary = costResult?.summary;
  const matchedRevenue = summary?.totalRevenue || 0;
  const materialRatio = summary ? summary.materialRatio * 100 : 0;
  const maxMonthly = Math.max(...s.monthlyRevenue, 1);
  const currentMonth = new Date().getMonth();
  const ytdRevenue = s.monthlyRevenue.slice(0, currentMonth + 1).reduce((a, b) => a + b, 0);
  const progressRate = s.totalRevenue > 0 ? (ytdRevenue / s.totalRevenue * 100) : 0;

  return (
    <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-violet-50 rounded-2xl p-5 border border-indigo-100">
      <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 justify-between">
        <div className="flex items-center gap-5 flex-wrap">
          <div>
            <div className="text-[10px] text-indigo-500 font-bold">매출(BOM매칭)</div>
            <div className="text-lg font-black text-indigo-800">{fmt(matchedRevenue > 0 ? matchedRevenue : s.totalRevenue)}</div>
            {matchedRevenue > 0 && matchedRevenue < s.totalRevenue && (
              <div className="text-[9px] text-slate-400">전체 {fmt(s.totalRevenue)}</div>
            )}
          </div>
          <div className="w-px h-8 bg-indigo-200" />
          {summary && (
            <>
              <div>
                <div className="text-[10px] text-violet-500 font-bold">표준재료비</div>
                <div className="text-base font-black text-violet-700">{fmt(summary.totalMaterial)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 font-bold">재료비율</div>
                <div className={`text-sm font-bold ${materialRatio > 50 ? 'text-red-600' : materialRatio > 40 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {materialRatio.toFixed(1)}%
                </div>
              </div>
              <div className="w-px h-8 bg-indigo-200" />
            </>
          )}
          <div>
            <div className="text-[10px] text-slate-500 font-bold">BOM제품</div>
            <div className="text-sm font-bold text-slate-700">{summary?.matchedCount || 0}건</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-bold">거래선</div>
            <div className="text-sm font-bold text-slate-700">{s.customers}</div>
          </div>
          <div>
            <div className="text-[10px] text-emerald-600 font-bold">YTD</div>
            <div className="text-sm font-bold text-emerald-700">{progressRate.toFixed(0)}%</div>
          </div>
        </div>

        {/* 월별 미니바 */}
        <div className="flex items-end gap-0.5 h-10">
          {s.monthlyRevenue.map((rev, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div
                className={`w-3 rounded-t-sm transition-all ${i <= currentMonth ? 'bg-indigo-400' : 'bg-slate-200'}`}
                style={{ height: `${Math.max(2, (rev / maxMonthly) * 32)}px` }}
                title={`${i + 1}월: ${fmt(rev)}`}
              />
              <span className="text-[8px] text-slate-400">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// StandardCostPanel — 표준재료비 요약
// ============================================================
const StandardCostPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult, forecastSummary } = data;

  if (!costResult) return <EmptyState message="매출계획 + BOM 데이터를 업로드하면 표준재료비가 자동 산출됩니다." />;

  const { summary, products } = costResult;
  const ratio = summary.materialRatio * 100;

  // 유형별 파이차트 데이터
  const pieData = summary.byType.filter(s => s.amount > 0).map(s => ({
    name: s.name, value: s.amount, color: TYPE_COLORS[s.name] || '#94a3b8',
  }));

  // 월별 재료비 (forecast 월별 매출 × 비율)
  const monthlyData = useMemo(() => {
    if (!forecastSummary) return [];
    return forecastSummary.monthlyRevenue.map((rev, i) => ({
      month: `${i + 1}월`,
      매출: rev,
      재료비: rev > 0 ? rev * summary.materialRatio : 0,
    }));
  }, [forecastSummary, summary.materialRatio]);

  // 출처별 집계
  const bySource = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const row of products) {
      if (row.materialCost <= 0) continue;
      const src = row.source || '기타';
      const existing = map.get(src) || { count: 0, total: 0 };
      existing.count++;
      existing.total += row.materialTotal;
      map.set(src, existing);
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [products]);

  // Top 10 제품
  const top10 = useMemo(() =>
    [...products].filter(p => p.materialTotal > 0).sort((a, b) => b.materialTotal - a.materialTotal).slice(0, 10),
  [products]);

  return (
    <div className="space-y-4">
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="총 표준재료비" value={fmt(summary.totalMaterial)} sub={`재료비율 ${ratio.toFixed(1)}%`} color="indigo" />
        {summary.byType.map(t => (
          <KPICard key={t.name} label={t.name} value={fmt(t.amount)}
            sub={`${summary.totalMaterial > 0 ? (t.amount / summary.totalMaterial * 100).toFixed(1) : 0}%`}
            color={t.name === 'RESIN' ? 'violet' : t.name === 'PAINT' ? 'amber' : 'emerald'} />
        ))}
      </div>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 유형별 파이 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold text-slate-600 mb-2">유형별 구성</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            {pieData.map(d => (
              <span key={d.name} className="text-[10px] flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name} {fmt(d.value)}
              </span>
            ))}
          </div>
        </div>

        {/* 월별 매출 vs 재료비 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold text-slate-600 mb-2">월별 매출 vs 재료비</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip formatter={(v: number) => `₩${Math.round(v as number).toLocaleString()}`} />
              <Bar dataKey="매출" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
              <Bar dataKey="재료비" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 출처별 요약 + Top 10 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold text-slate-600 mb-3">단가 출처별</h3>
          {bySource.map(s => (
            <div key={s.name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-xs font-bold text-slate-600">{s.name}</span>
              <span className="text-xs text-slate-500">{s.count}건 / {fmt(s.total)}</span>
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4 overflow-x-auto">
          <h3 className="text-xs font-bold text-slate-600 mb-2">재료비 Top 10</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200 text-slate-500">
              <th className="px-2 py-1.5 text-left">품번</th>
              <th className="px-2 py-1.5 text-left">품명</th>
              <th className="px-2 py-1.5 text-right">수량</th>
              <th className="px-2 py-1.5 text-right">단가</th>
              <th className="px-2 py-1.5 text-right">매출액</th>
              <th className="px-2 py-1.5 text-right">재료비합계</th>
              <th className="px-2 py-1.5 text-right">재료비율</th>
            </tr></thead>
            <tbody>
              {top10.map(row => (
                <tr key={row.pn} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-mono text-indigo-600">{row.pn}</td>
                  <td className="px-2 py-1.5 truncate max-w-[150px]">{row.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.planQty.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{Math.round(row.materialCost).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500">{row.expectedRevenue > 0 ? fmt(row.expectedRevenue) : '-'}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{fmt(row.materialTotal)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.materialRatio.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// ProductCostPanel — 제품별 재료비
// ============================================================
const ProductCostPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult, selectedMonth, setSelectedMonth } = data;
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'materialTotal' | 'materialCost' | 'materialRatio'>('materialTotal');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (!costResult) return <EmptyState message="매출계획 + BOM 데이터가 필요합니다." />;

  const { products, summary } = costResult;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = products.filter(p => p.planQty > 0);
    if (q) list = list.filter(p => p.pn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.customer.toLowerCase().includes(q));
    list.sort((a, b) => sortDir === 'desc' ? (b[sortKey] - a[sortKey]) : (a[sortKey] - b[sortKey]));
    return list;
  }, [products, search, sortKey, sortDir]);

  const ratio = summary.materialRatio * 100;

  return (
    <div className="space-y-4">
      {/* 월별 선택 + 검색 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setSelectedMonth(-1)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${selectedMonth === -1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            전체
          </button>
          {Array.from({ length: 12 }, (_, i) => (
            <button key={i} onClick={() => setSelectedMonth(i)}
              className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${selectedMonth === i ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {i + 1}월
            </button>
          ))}
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="품번/품명/거래선 검색"
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="매출(BOM매칭)" value={fmt(summary.totalRevenue)} color="indigo" />
        <KPICard label="재료비 합계" value={fmt(summary.totalMaterial)} color="violet" />
        <KPICard label="재료비율" value={`${ratio.toFixed(1)}%`} color={ratio > 50 ? 'red' : 'emerald'} />
        <KPICard label="산출 제품" value={`${summary.matchedCount}건`} sub={`전체 ${summary.productCount}건`} color="slate" />
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <th className="px-3 py-2 text-left">품번</th>
            <th className="px-3 py-2 text-left">품명</th>
            <th className="px-3 py-2 text-left">거래선</th>
            <th className="px-3 py-2 text-right">수량</th>
            <th className="px-3 py-2 text-right cursor-pointer hover:text-indigo-600" onClick={() => handleSort('materialCost')}>
              단가 {sortKey === 'materialCost' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
            </th>
            <th className="px-3 py-2 text-right">매출액</th>
            <th className="px-3 py-2 text-right cursor-pointer hover:text-indigo-600" onClick={() => handleSort('materialTotal')}>
              재료비합계 {sortKey === 'materialTotal' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
            </th>
            <th className="px-3 py-2 text-right cursor-pointer hover:text-indigo-600" onClick={() => handleSort('materialRatio')}>
              재료비율 {sortKey === 'materialRatio' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
            </th>
            <th className="px-3 py-2 text-center">출처</th>
          </tr></thead>
          <tbody>
            {filtered.slice(0, 100).map(row => (
              <tr key={row.pn} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-indigo-600 whitespace-nowrap">{row.pn}</td>
                <td className="px-3 py-2 truncate max-w-[180px]">{row.name}</td>
                <td className="px-3 py-2 text-slate-500">{row.customer}</td>
                <td className="px-3 py-2 text-right font-mono">{row.planQty.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{Math.round(row.materialCost).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">{row.expectedRevenue > 0 ? fmt(row.expectedRevenue) : '-'}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{fmt(row.materialTotal)}</td>
                <td className="px-3 py-2 text-right font-mono">{row.materialRatio > 0 ? `${row.materialRatio.toFixed(1)}%` : '-'}</td>
                <td className="px-3 py-2 text-center">
                  {row.source && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    row.source === '구매' ? 'bg-emerald-100 text-emerald-700' :
                    row.source === '사출' ? 'bg-indigo-100 text-indigo-700' :
                    row.source === '도장' ? 'bg-violet-100 text-violet-700' :
                    row.source === '외주' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{row.source}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {/* 합계 행 */}
          <tfoot><tr className="bg-indigo-50 border-t-2 border-indigo-200 font-bold text-xs">
            <td className="px-3 py-2" colSpan={3}>합계 ({filtered.length}건)</td>
            <td className="px-3 py-2 text-right font-mono">{filtered.reduce((s, r) => s + r.planQty, 0).toLocaleString()}</td>
            <td className="px-3 py-2 text-right">-</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(filtered.reduce((s, r) => s + r.expectedRevenue, 0))}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(filtered.reduce((s, r) => s + r.materialTotal, 0))}</td>
            <td className="px-3 py-2 text-right font-mono">{ratio.toFixed(1)}%</td>
            <td className="px-3 py-2"></td>
          </tr></tfoot>
        </table>
        {filtered.length > 100 && (
          <div className="text-center py-2 text-xs text-slate-400">상위 100건 표시 (전체 {filtered.length}건)</div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// YieldPanel — 자재수율 (유형별 소요)
// ============================================================
const YieldPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult } = data;

  if (!costResult || costResult.leafMaterials.length === 0) {
    return <EmptyState message="BOM 전개 데이터가 필요합니다." />;
  }

  const { leafMaterials, summary } = costResult;

  // 유형별 소요금액 집계
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of leafMaterials) {
      map.set(m.materialType, (map.get(m.materialType) || 0) + m.totalCost);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, color: TYPE_COLORS[name] || '#94a3b8' }))
      .sort((a, b) => b.value - a.value);
  }, [leafMaterials]);

  const totalCost = leafMaterials.reduce((s, m) => s + m.totalCost, 0);
  const top50 = leafMaterials.slice(0, 50);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="총 자재 종류" value={`${leafMaterials.length}건`} color="indigo" />
        <KPICard label="총 소요금액 (조달기준)" value={fmt(totalCost)}
          sub={totalCost !== summary.totalMaterial ? `매출매칭 ${fmt(summary.totalMaterial)}` : undefined}
          color="violet" />
        <KPICard label="BOM매칭 제품" value={`${summary.matchedCount}건`} color="emerald" />
        <KPICard label="재료비율" value={`${(summary.materialRatio * 100).toFixed(1)}%`} color={summary.materialRatio > 0.5 ? 'red' : 'emerald'} />
      </div>

      {/* 유형별 소요금액 차트 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="text-xs font-bold text-slate-600 mb-2">유형별 소요금액</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={byType} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fontWeight: 'bold' }} width={50} />
            <Tooltip formatter={(v: number) => `₩${Math.round(v as number).toLocaleString()}`} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {byType.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 자재 소요량 테이블 (Top 50) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <th className="px-3 py-2 text-left">자재코드</th>
            <th className="px-3 py-2 text-left">자재명</th>
            <th className="px-3 py-2 text-center">유형</th>
            <th className="px-3 py-2 text-right">소요량</th>
            <th className="px-3 py-2 text-right">단가</th>
            <th className="px-3 py-2 text-right">소요금액</th>
          </tr></thead>
          <tbody>
            {top50.map(m => (
              <tr key={m.materialCode} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono text-indigo-600">{m.materialCode}</td>
                <td className="px-3 py-1.5 truncate max-w-[200px]">{m.materialName}</td>
                <td className="px-3 py-1.5 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeBadgeClass(m.materialType)}`}>{m.materialType}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{Math.round(m.monthlyQty.reduce((s, q) => s + q, 0)).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono">{Math.round(m.unitPrice).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono font-bold">{fmt(m.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {leafMaterials.length > 50 && (
          <div className="text-center py-2 text-xs text-slate-400">상위 50건 표시 (전체 {leafMaterials.length}건)</div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// MRPPanel — 자재별/업체별 소요량 (12개월)
// ============================================================
const MRPPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult } = data;
  const [viewMode, setViewMode] = useState<'material' | 'supplier'>('material');
  const [typeFilter, setTypeFilter] = useState<string>('전체');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

  if (!costResult || costResult.leafMaterials.length === 0) {
    return <EmptyState message="BOM 전개 데이터가 필요합니다." />;
  }

  const { leafMaterials, summary } = costResult;
  const totalCost = leafMaterials.reduce((s, m) => s + m.totalCost, 0);

  // 유형 필터
  const types = ['전체', ...Array.from(new Set(leafMaterials.map(m => m.materialType)))];
  const filtered = typeFilter === '전체' ? leafMaterials : leafMaterials.filter(m => m.materialType === typeFilter);

  // 업체별 집계 (상세 자재 목록 포함)
  const supplierData = useMemo(() => {
    const map = new Map<string, { totalCost: number; materialCount: number; monthlyQty: number[]; materials: typeof filtered }>();
    for (const m of filtered) {
      const supplier = m.supplier || '(미지정)';
      const existing = map.get(supplier) || { totalCost: 0, materialCount: 0, monthlyQty: new Array(12).fill(0), materials: [] as typeof filtered };
      existing.totalCost += m.totalCost;
      existing.materialCount++;
      existing.materials.push(m);
      for (let i = 0; i < 12; i++) existing.monthlyQty[i] += m.monthlyQty[i] || 0;
      map.set(supplier, existing);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [filtered]);

  const toggleSupplier = (name: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* 모드 전환 + 필터 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex gap-1">
          <button onClick={() => setViewMode('material')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${viewMode === 'material' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            자재별
          </button>
          <button onClick={() => setViewMode('supplier')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${viewMode === 'supplier' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            업체별
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold ${typeFilter === t ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="자재 종류" value={`${filtered.length}건`} color="indigo" />
        <KPICard label="총 소요금액 (조달기준)" value={fmt(totalCost)}
          sub={totalCost !== summary.totalMaterial ? `매출매칭 ${fmt(summary.totalMaterial)}` : undefined}
          color="violet" />
        <KPICard label="BOM매칭 제품" value={`${summary.matchedCount}건`} color="emerald" />
        <KPICard label="업체 수" value={`${supplierData.length}곳`} color="slate" />
      </div>

      {/* 자재별 테이블 */}
      {viewMode === 'material' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <th className="px-2 py-2 text-left sticky left-0 bg-slate-50">자재코드</th>
              <th className="px-2 py-2 text-left">자재명</th>
              <th className="px-2 py-2 text-center">유형</th>
              <th className="px-2 py-2 text-right">단가</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className="px-1.5 py-2 text-right w-14">{i + 1}월</th>
              ))}
              <th className="px-2 py-2 text-right font-bold">합계</th>
              <th className="px-2 py-2 text-right">금액</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 80).map(m => (
                <tr key={m.materialCode} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-mono text-indigo-600 whitespace-nowrap sticky left-0 bg-white">{m.materialCode}</td>
                  <td className="px-2 py-1.5 truncate max-w-[120px]">{m.materialName}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                      m.materialType === 'RESIN' ? 'bg-indigo-100 text-indigo-700' :
                      m.materialType === 'PAINT' ? 'bg-amber-100 text-amber-700' :
                      m.materialType === '외주' ? 'bg-blue-100 text-blue-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>{m.materialType}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500">{Math.round(m.unitPrice).toLocaleString()}</td>
                  {m.monthlyQty.map((q, i) => (
                    <td key={i} className="px-1.5 py-1.5 text-right font-mono text-[10px]">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{Math.round(m.monthlyQty.reduce((s, q) => s + q, 0)).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{fmt(m.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 80 && (
            <div className="text-center py-2 text-xs text-slate-400">상위 80건 표시 (전체 {filtered.length}건)</div>
          )}
        </div>
      )}

      {/* 업체별 테이블 (펼침 가능) */}
      {viewMode === 'supplier' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <th className="px-3 py-2 text-left sticky left-0 bg-slate-50">업체명</th>
              <th className="px-3 py-2 text-right">자재수</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className="px-1.5 py-2 text-right w-14">{i + 1}월</th>
              ))}
              <th className="px-3 py-2 text-right font-bold">총금액</th>
            </tr></thead>
            <tbody>
              {supplierData.map(s => {
                const isExpanded = expandedSuppliers.has(s.name);
                return (
                  <React.Fragment key={s.name}>
                    {/* 업체 요약 행 */}
                    <tr
                      className="border-b border-slate-100 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                      onClick={() => toggleSupplier(s.name)}
                    >
                      <td className="px-3 py-2 font-bold text-slate-700 sticky left-0 bg-white">
                        <span className={`inline-block w-4 text-indigo-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {s.name}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{s.materialCount}</td>
                      {s.monthlyQty.map((q, i) => (
                        <td key={i} className="px-1.5 py-2 text-right font-mono text-[10px]">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono font-bold">{fmt(s.totalCost)}</td>
                    </tr>
                    {/* 상세 자재 행 */}
                    {isExpanded && s.materials
                      .sort((a, b) => b.totalCost - a.totalCost)
                      .map(m => (
                      <tr key={m.materialCode} className="border-b border-slate-50 bg-slate-50/50 hover:bg-slate-100/50">
                        <td className="pl-9 pr-2 py-1.5 sticky left-0 bg-slate-50/50">
                          <span className="font-mono text-indigo-600 text-[10px]">{m.materialCode}</span>
                          <span className="ml-1.5 text-slate-500 truncate">{m.materialName}</span>
                          <span className={`ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold ${typeBadgeClass(m.materialType)}`}>{m.materialType}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-400 text-[10px]">@{Math.round(m.unitPrice).toLocaleString()}</td>
                        {m.monthlyQty.map((q, i) => (
                          <td key={i} className="px-1.5 py-1.5 text-right font-mono text-[10px] text-slate-500">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-mono text-[10px] font-bold text-slate-600">{fmt(m.totalCost)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ============================================================
// DataQualityBar
// ============================================================
const DataQualityBar: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const result = data.costResult;
  const items = [
    { label: '매출계획', ok: !!data.forecastSummary },
    { label: 'BOM', ok: (result?.summary.productCount || 0) > 0 },
    { label: 'BOM매칭', ok: (result?.summary.matchedCount || 0) > 0 },
    { label: '자재수', ok: (result?.leafMaterials.length || 0) > 0 },
  ];
  const okCount = items.filter(i => i.ok).length;

  return (
    <div className="bg-white rounded-xl p-3 border border-slate-200 flex items-center gap-3 text-xs flex-wrap">
      <span className="font-bold text-slate-600">데이터</span>
      {items.map(item => (
        <span key={item.label} className={`px-2 py-0.5 rounded-full font-bold ${item.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {item.ok ? '✓' : '✗'} {item.label}
        </span>
      ))}
      <div className="ml-auto font-bold text-slate-500">{okCount}/{items.length}</div>
    </div>
  );
};

// ============================================================
// Main Component
// ============================================================
const CostAnalysisView: React.FC = () => {
  const [mode, setMode] = useState<AnalysisMode>('standard');
  const data = useCostAnalysis();

  return (
    <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-500">
      <ForecastSummaryBar data={data} />

      <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              mode === tab.id
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
            {mode === tab.id && (
              <div className="text-[10px] font-normal mt-0.5 opacity-80">{tab.desc}</div>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {data.loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3" />
              <div className="text-xs text-slate-400">데이터 로딩 중...</div>
            </div>
          </div>
        ) : (
          <>
            {mode === 'standard' && <StandardCostPanel data={data} />}
            {mode === 'product' && <ProductCostPanel data={data} />}
            {mode === 'yield' && <YieldPanel data={data} />}
            {mode === 'mrp' && <MRPPanel data={data} />}
          </>
        )}
      </div>

      <DataQualityBar data={data} />
    </div>
  );
};

export default CostAnalysisView;
