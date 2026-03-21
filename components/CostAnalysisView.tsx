/**
 * CostAnalysisView — 원가분석 통합 워크벤치 v4
 * 이슈 #1~#9 고도화: byType정확화, 전체정렬, 수율계산, MRP발주, RESIN/PAINT뷰
 */
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useCostAnalysis, CostAnalysisData, ProductCostRow, LeafMaterialRow } from '../hooks/useCostAnalysis';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts';
import { downloadPurchaseOrder, downloadRequiredQtyBreakdown } from '../utils/excelExporter';

type AnalysisMode = 'standard' | 'product' | 'yield' | 'mrp';

const MODE_TABS: { id: AnalysisMode; label: string; desc: string }[] = [
  { id: 'standard', label: '표준재료비', desc: '총괄 요약' },
  { id: 'product', label: '제품별 재료비', desc: '제품 단위 원가' },
  { id: 'yield', label: '자재수율', desc: '소요 vs 입고' },
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

const normCode = (s: string) => s.trim().toUpperCase();

// ============================================================
// Shared: KPICard, EmptyState, MonthSelector, SortHeader, Pagination
// ============================================================
const KPICard: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color = 'slate' }) => {
  const colorMap: Record<string, string> = {
    indigo: 'border-indigo-200 bg-indigo-50', violet: 'border-violet-200 bg-violet-50',
    amber: 'border-amber-200 bg-amber-50', emerald: 'border-emerald-200 bg-emerald-50',
    red: 'border-red-200 bg-red-50', slate: 'border-slate-200 bg-slate-50',
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

const MonthSelector: React.FC<{ selectedMonth: number; setSelectedMonth: (m: number) => void }> = ({ selectedMonth, setSelectedMonth }) => (
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
);

function SortTh<K extends string>({ field, label, sortKey, sortDir, onSort, align = 'right' }: {
  field: K; label: string; sortKey: K; sortDir: string; onSort: (k: K) => void; align?: string;
}) {
  return (
    <th className={`px-3 py-2 text-${align} cursor-pointer hover:text-indigo-600 select-none whitespace-nowrap`}
      onClick={() => onSort(field)}>
      {label} {sortKey === field ? (sortDir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );
}

const Pagination: React.FC<{ page: number; setPage: (p: number) => void; total: number; pageSize: number }> = ({ page, setPage, total, pageSize }) => {
  const totalPages = Math.ceil(total / pageSize);
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 text-xs">
      <span className="text-slate-400">{page * pageSize + 1}~{Math.min((page + 1) * pageSize, total)} / {total}건</span>
      <div className="flex gap-1">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}
          className="px-2 py-1 rounded bg-slate-100 text-slate-500 disabled:opacity-30 hover:bg-slate-200">이전</button>
        <span className="px-2 py-1 text-slate-400">{page + 1}/{totalPages}</span>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}
          className="px-2 py-1 rounded bg-slate-100 text-slate-500 disabled:opacity-30 hover:bg-slate-200">다음</button>
      </div>
    </div>
  );
};

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
  const { costResult, forecastSummary, selectedMonth, setSelectedMonth } = data;

  if (!costResult) return <EmptyState message="매출계획 + BOM 데이터를 업로드하면 표준재료비가 자동 산출됩니다." />;

  const { summary, products } = costResult;
  const ratio = summary.materialRatio * 100;

  const pieData = summary.byType.filter(s => s.amount > 0).map(s => ({
    name: s.name, value: s.amount, color: TYPE_COLORS[s.name] || '#94a3b8',
  }));

  const monthlyData = useMemo(() => {
    if (!forecastSummary) return [];
    return forecastSummary.monthlyRevenue.map((rev, i) => ({
      month: `${i + 1}월`, 매출: rev, 재료비: rev > 0 ? rev * summary.materialRatio : 0,
    }));
  }, [forecastSummary, summary.materialRatio]);

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

  const top10 = useMemo(() =>
    [...products].filter(p => p.materialTotal > 0).sort((a, b) => b.materialTotal - a.materialTotal).slice(0, 10),
  [products]);

  return (
    <div className="space-y-4">
      <MonthSelector selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="총 표준재료비" value={fmt(summary.totalMaterial)} sub={`재료비율 ${ratio.toFixed(1)}%`} color="indigo" />
        {summary.byType.map(t => (
          <KPICard key={t.name} label={t.name} value={fmt(t.amount)}
            sub={`${summary.totalMaterial > 0 ? (t.amount / summary.totalMaterial * 100).toFixed(1) : 0}%`}
            color={t.name === 'RESIN' ? 'violet' : t.name === 'PAINT' ? 'amber' : t.name === '사출' ? 'violet' : t.name === '도장' ? 'amber' : t.name === '외주' ? 'red' : 'emerald'} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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

        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-xs font-bold text-slate-600 mb-2">월별 매출 vs 재료비</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip formatter={(v: number) => `₩${Math.round(v as number).toLocaleString()}`} />
              <Bar dataKey="매출" fill="#c7d2fe" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="매출" position="top" style={{ fontSize: 9, fill: '#64748b' }}
                  formatter={(v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}` : ''} />
              </Bar>
              <Bar dataKey="재료비" fill="#6366f1" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="재료비" position="top" style={{ fontSize: 9, fill: '#4338ca' }}
                  formatter={(v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}` : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
// ProductCostPanel — 제품별 재료비 (이슈 #2: 전체 컬럼 정렬)
// ============================================================
type ProductSortKey = 'pn' | 'name' | 'customer' | 'planQty' | 'materialCost' | 'expectedRevenue' | 'materialTotal' | 'materialRatio' | 'source';
const PRODUCT_STR_KEYS: ProductSortKey[] = ['pn', 'name', 'customer', 'source'];

const ProductCostPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult, selectedMonth, setSelectedMonth } = data;
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<ProductSortKey>('materialTotal');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  if (!costResult) return <EmptyState message="매출계획 + BOM 데이터가 필요합니다." />;

  const { products, summary } = costResult;

  const handleSort = (key: ProductSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(0);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = products.filter(p => p.planQty > 0);
    if (q) list = list.filter(p => p.pn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.customer.toLowerCase().includes(q));
    list.sort((a, b) => {
      if (PRODUCT_STR_KEYS.includes(sortKey)) {
        const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), 'ko');
        return sortDir === 'desc' ? -cmp : cmp;
      }
      return sortDir === 'desc' ? ((b[sortKey] as number) - (a[sortKey] as number)) : ((a[sortKey] as number) - (b[sortKey] as number));
    });
    return list;
  }, [products, search, sortKey, sortDir]);

  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const ratio = summary.materialRatio * 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <MonthSelector selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="품번/품명/거래선 검색"
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="매출(BOM매칭)" value={fmt(summary.totalRevenue)} color="indigo" />
        <KPICard label="재료비 합계" value={fmt(summary.totalMaterial)} color="violet" />
        <KPICard label="재료비율" value={`${ratio.toFixed(1)}%`} color={ratio > 50 ? 'red' : 'emerald'} />
        <KPICard label="산출 제품" value={`${summary.matchedCount}건`} sub={`전체 ${summary.productCount}건`} color="slate" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <SortTh field="pn" label="품번" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="name" label="품명" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="customer" label="거래선" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="planQty" label="수량" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="materialCost" label="단가" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="expectedRevenue" label="매출액" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="materialTotal" label="재료비합계" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="materialRatio" label="재료비율" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="source" label="출처" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
          </tr></thead>
          <tbody>
            {pageData.map(row => (
              <tr key={row.pn} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-indigo-600 whitespace-nowrap">{row.pn}</td>
                <td className="px-3 py-2 truncate max-w-[180px]" title={row.name}>{row.name}</td>
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
        <Pagination page={page} setPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
};

// ============================================================
// YieldPanel — 자재수율 (이슈 #3, #4, #5: 월필터+구입처+수율+전체+정렬)
// ============================================================
type YieldSortKey = 'materialCode' | 'materialName' | 'materialType' | 'supplier' | 'requiredQty' | 'inboundQty' | 'diff' | 'yieldRate' | 'unitPrice' | 'totalCost';
const YIELD_STR_KEYS: YieldSortKey[] = ['materialCode', 'materialName', 'materialType', 'supplier'];

interface YieldRow extends LeafMaterialRow {
  requiredQty: number;
  inboundQty: number;
  diff: number;
  yieldRate: number;
}

/** 소요량 산출근거 팝업 셀 (자재수율 패널) */
const RequiredQtyCell: React.FC<{
  row: YieldRow;
  selectedMonth: number;
}> = ({ row, selectedMonth }) => {
  const [show, setShow] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const open = useCallback(() => {
    clearTimeout(hideTimer.current);
    setShow(true);
  }, []);
  const close = useCallback(() => {
    hideTimer.current = setTimeout(() => setShow(false), 200);
  }, []);

  const breakdown = row.productBreakdown || [];
  const hasBreakdown = breakdown.length > 0;

  return (
    <td className="px-3 py-1.5 text-right font-mono relative"
      onMouseEnter={hasBreakdown ? open : undefined}
      onMouseLeave={hasBreakdown ? close : undefined}>
      <span className={hasBreakdown ? 'border-b border-dashed border-slate-400 cursor-default' : ''}>
        {Math.round(row.requiredQty).toLocaleString()}
      </span>
      {show && hasBreakdown && (
        <div className="absolute z-[100] right-0 top-full mt-1 bg-slate-800 text-white rounded-xl shadow-2xl p-3 min-w-[420px] max-h-[320px] overflow-y-auto text-[11px]"
          onMouseEnter={open} onMouseLeave={close}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-slate-200">소요량 산출근거 — {row.materialName}</span>
            <button onClick={() => downloadRequiredQtyBreakdown(row)}
              className="px-2 py-0.5 bg-indigo-500 hover:bg-indigo-400 rounded text-[10px] font-bold text-white flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Excel
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-600 text-slate-400">
                <th className="text-left py-1 pr-2">제품코드</th>
                <th className="text-left py-1 pr-2">제품명</th>
                <th className="text-right py-1 pr-2">단위소요량</th>
                <th className="text-right py-1 pr-2">{selectedMonth === -1 ? '소요량' : `${selectedMonth + 1}월`}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map(c => {
                const qty = selectedMonth === -1 ? c.totalQty : (c.monthlyQty[selectedMonth] || 0);
                return (
                  <tr key={c.productPn} className="border-b border-slate-700/50 hover:bg-slate-700/50">
                    <td className="py-1 pr-2 font-mono text-indigo-300">{c.productPn}</td>
                    <td className="py-1 pr-2 truncate max-w-[140px] text-slate-300" title={c.productName}>{c.productName}</td>
                    <td className="py-1 pr-2 text-right font-mono text-slate-300">
                      {c.qtyPerUnit < 0.01 ? c.qtyPerUnit.toFixed(4) : c.qtyPerUnit < 1 ? c.qtyPerUnit.toFixed(3) : c.qtyPerUnit.toFixed(2)}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono font-bold text-white">{Math.round(qty).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-500 font-bold text-indigo-300">
                <td className="py-1" colSpan={3}>합계 ({breakdown.length}건)</td>
                <td className="py-1 pr-2 text-right font-mono">{Math.round(row.requiredQty).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </td>
  );
};

const YieldPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult, selectedMonth, setSelectedMonth, purchaseData } = data;
  const [sortKey, setSortKey] = useState<YieldSortKey>('totalCost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  if (!costResult || costResult.leafMaterials.length === 0) {
    return <EmptyState message="BOM 전개 데이터가 필요합니다." />;
  }

  const { leafMaterials, summary } = costResult;

  const handleSort = (key: YieldSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(0);
  };

  // 입고 실적 맵 + 구입처 맵 구성 (실제 입고 데이터 기반)
  const { inboundMap, purchaseSupplierMap } = useMemo(() => {
    const iMap = new Map<string, number[]>();
    const sMap = new Map<string, string>();
    for (const p of purchaseData) {
      const code = normCode(p.itemCode);
      if (!code) continue;
      // 구입처: 최초 등장 업체 사용
      if (p.supplier && !sMap.has(code)) sMap.set(code, p.supplier);
      const monthStr = p.month?.replace(/[^0-9]/g, '') || '';
      const monthIdx = parseInt(monthStr) - 1;
      if (monthIdx < 0 || monthIdx > 11) continue;
      const existing = iMap.get(code) || new Array(12).fill(0);
      existing[monthIdx] += p.qty;
      iMap.set(code, existing);
    }
    return { inboundMap: iMap, purchaseSupplierMap: sMap };
  }, [purchaseData]);

  // 수율 데이터 계산
  const yieldData = useMemo(() => {
    const rows: YieldRow[] = leafMaterials.map(m => {
      const code = normCode(m.materialCode);
      const inbound = inboundMap.get(code) || new Array(12).fill(0);
      const requiredQty = selectedMonth === -1
        ? m.monthlyQty.reduce((s, q) => s + q, 0)
        : m.monthlyQty[selectedMonth] || 0;
      const inboundQty = selectedMonth === -1
        ? inbound.reduce((s, q) => s + q, 0)
        : inbound[selectedMonth] || 0;
      const diff = inboundQty - requiredQty;
      const yieldRate = inboundQty > 0 ? (requiredQty / inboundQty) * 100 : 0;
      // 구입처: 입고실적(실제 납품업체) > 엔진 결과 > 미지정
      const supplier = purchaseSupplierMap.get(code) || m.supplier || '';
      return { ...m, supplier, requiredQty, inboundQty, diff, yieldRate };
    });

    rows.sort((a, b) => {
      if (YIELD_STR_KEYS.includes(sortKey)) {
        const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), 'ko');
        return sortDir === 'desc' ? -cmp : cmp;
      }
      return sortDir === 'desc' ? ((b[sortKey] as number) - (a[sortKey] as number)) : ((a[sortKey] as number) - (b[sortKey] as number));
    });
    return rows;
  }, [leafMaterials, inboundMap, selectedMonth, sortKey, sortDir]);

  // 유형별 소요금액
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of yieldData) {
      map.set(m.materialType, (map.get(m.materialType) || 0) + m.totalCost);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, color: TYPE_COLORS[name] || '#94a3b8' }))
      .sort((a, b) => b.value - a.value);
  }, [yieldData]);

  const totalCost = yieldData.reduce((s, m) => s + m.totalCost, 0);
  const pageData = yieldData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <MonthSelector selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="총 자재 종류" value={`${leafMaterials.length}건`} color="indigo" />
        <KPICard label="총 소요금액 (조달기준)" value={fmt(totalCost)}
          sub={totalCost !== summary.totalMaterial ? `매출매칭 ${fmt(summary.totalMaterial)}` : undefined}
          color="violet" />
        <KPICard label="BOM매칭 제품" value={`${summary.matchedCount}건`} color="emerald" />
        <KPICard label="재료비율" value={`${(summary.materialRatio * 100).toFixed(1)}%`} color={summary.materialRatio > 0.5 ? 'red' : 'emerald'} />
      </div>

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

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <SortTh field="materialCode" label="자재코드" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="materialName" label="자재명" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="materialType" label="유형" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
            <SortTh field="supplier" label="구입처" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortTh field="requiredQty" label="소요량" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="inboundQty" label="입고량" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="diff" label="초과/부족" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="yieldRate" label="수율%" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="unitPrice" label="단가" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortTh field="totalCost" label="소요금액" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          </tr></thead>
          <tbody>
            {pageData.map(m => (
              <tr key={m.materialCode} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono text-indigo-600">{m.materialCode}</td>
                <td className="px-3 py-1.5 truncate max-w-[200px]" title={m.materialName}>{m.materialName}</td>
                <td className="px-3 py-1.5 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeBadgeClass(m.materialType)}`}>{m.materialType}</span>
                </td>
                <td className="px-3 py-1.5 text-slate-500 truncate max-w-[120px]" title={m.supplier}>{m.supplier || '-'}</td>
                <RequiredQtyCell row={m} selectedMonth={selectedMonth} />
                <td className="px-3 py-1.5 text-right font-mono">{m.inboundQty > 0 ? Math.round(m.inboundQty).toLocaleString() : '-'}</td>
                <td className={`px-3 py-1.5 text-right font-mono font-bold ${m.diff > 0 ? 'text-amber-600' : m.diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {m.requiredQty > 0 || m.inboundQty > 0 ? (m.diff > 0 ? '+' : '') + Math.round(m.diff).toLocaleString() : '-'}
                </td>
                <td className={`px-3 py-1.5 text-right font-mono ${m.yieldRate >= 100 ? 'text-emerald-600' : m.yieldRate > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {m.yieldRate > 0 ? `${m.yieldRate.toFixed(0)}%` : '-'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{Math.round(m.unitPrice).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono font-bold">{fmt(m.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} total={yieldData.length} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
};

// ============================================================
// MRPPanel — 자재별/업체별/RESIN/PAINT (이슈 #5~#9)
// ============================================================
type MRPViewMode = 'material' | 'supplier' | 'resin' | 'paint';
type MRPSortKey = 'materialCode' | 'materialName' | 'materialType' | 'unitPrice' | 'totalQty' | 'totalCost' | 'currentStock' | 'orderQty';
const MRP_STR_KEYS: MRPSortKey[] = ['materialCode', 'materialName', 'materialType'];

interface MRPRow extends LeafMaterialRow {
  totalQty: number;
  currentStock: number;
  orderQty: number;
}

const VIEW_TABS: { id: MRPViewMode; label: string }[] = [
  { id: 'material', label: '자재별' },
  { id: 'supplier', label: '업체별' },
  { id: 'resin', label: 'RESIN' },
  { id: 'paint', label: 'PAINT' },
];

const MRPPanel: React.FC<{ data: CostAnalysisData }> = ({ data }) => {
  const { costResult, inventoryItems, purchaseData, selectedMonth, setSelectedMonth } = data;
  const [viewMode, setViewMode] = useState<MRPViewMode>('material');
  const [typeFilter, setTypeFilter] = useState<string>('전체');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<MRPSortKey>('totalCost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  if (!costResult || costResult.leafMaterials.length === 0) {
    return <EmptyState message="BOM 전개 데이터가 필요합니다." />;
  }

  const { leafMaterials, summary } = costResult;
  const totalCost = leafMaterials.reduce((s, m) => s + m.totalCost, 0);

  // 입고 실적에서 구입처 맵 구성
  const purchaseSupplierMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of (purchaseData || [])) {
      const code = normCode(p.itemCode);
      if (code && p.supplier && !map.has(code)) map.set(code, p.supplier);
    }
    return map;
  }, [purchaseData]);

  // 현재고 맵
  const inventoryMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of inventoryItems) {
      const code = normCode(inv.code);
      if (code) map.set(code, (map.get(code) || 0) + inv.qty);
    }
    return map;
  }, [inventoryItems]);

  // MRP 데이터 소스: RESIN/PAINT 탭은 full-depth mrpMaterials, 그 외는 leafMaterials
  const mrpSource = (viewMode === 'resin' || viewMode === 'paint')
    ? (costResult.mrpMaterials || [])
    : leafMaterials;

  // MRP 데이터 (현재고 + 발주량 + 구입처 보강)
  const mrpAll = useMemo(() => {
    return mrpSource.map(m => {
      const code = normCode(m.materialCode);
      const totalQty = m.monthlyQty.reduce((s, q) => s + q, 0);
      const currentStock = inventoryMap.get(code) || 0;
      const orderQty = Math.max(0, totalQty - currentStock);
      // 구입처: 입고실적(실제 납품업체) > 엔진 결과 > 미지정
      const supplier = purchaseSupplierMap.get(code) || m.supplier || '';
      return { ...m, supplier, totalQty, currentStock, orderQty } as MRPRow;
    });
  }, [mrpSource, inventoryMap, purchaseSupplierMap]);

  // 유형 필터 + 뷰모드 필터
  const types = ['전체', ...Array.from(new Set(leafMaterials.map(m => m.materialType)))];

  const filtered = useMemo(() => {
    let list = mrpAll;
    if (viewMode === 'resin') {
      list = list.filter(m => m.materialType === 'RESIN');
    } else if (viewMode === 'paint') {
      list = list.filter(m => m.materialType === 'PAINT');
    } else if (typeFilter !== '전체') {
      list = list.filter(m => m.materialType === typeFilter);
    }

    list.sort((a, b) => {
      if (MRP_STR_KEYS.includes(sortKey)) {
        const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), 'ko');
        return sortDir === 'desc' ? -cmp : cmp;
      }
      return sortDir === 'desc' ? ((b[sortKey] as number) - (a[sortKey] as number)) : ((a[sortKey] as number) - (b[sortKey] as number));
    });
    return list;
  }, [mrpAll, viewMode, typeFilter, sortKey, sortDir]);

  const handleSort = (key: MRPSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(0);
  };

  // 업체별 집계
  const supplierData = useMemo(() => {
    const map = new Map<string, { totalCost: number; materialCount: number; monthlyQty: number[]; materials: MRPRow[]; totalOrderAmount: number }>();
    for (const m of filtered) {
      const supplier = m.supplier || '(미지정)';
      const existing = map.get(supplier) || { totalCost: 0, materialCount: 0, monthlyQty: new Array(12).fill(0), materials: [] as MRPRow[], totalOrderAmount: 0 };
      existing.totalCost += m.totalCost;
      existing.materialCount++;
      existing.materials.push(m);
      existing.totalOrderAmount += m.orderQty * m.unitPrice;
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

  const toggleAllSuppliers = () => {
    if (expandedSuppliers.size === supplierData.length) {
      setExpandedSuppliers(new Set());
    } else {
      setExpandedSuppliers(new Set(supplierData.map(s => s.name)));
    }
  };

  const handleDownloadPO = (supplierName: string, materials: MRPRow[]) => {
    downloadPurchaseOrder(supplierName, materials.map(m => ({
      materialCode: m.materialCode, materialName: m.materialName,
      materialType: m.materialType, unit: m.unit,
      totalRequired: m.totalQty, currentStock: m.currentStock,
      orderQty: m.orderQty, unitPrice: m.unitPrice,
    })));
  };

  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleMaterial = (code: string) => {
    setExpandedMaterials(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const toggleAllMaterials = () => {
    if (expandedMaterials.size === pageData.length) {
      setExpandedMaterials(new Set());
    } else {
      setExpandedMaterials(new Set(pageData.map(m => m.materialCode)));
    }
  };

  // 자재별/RESIN/PAINT 뷰 렌더링
  const renderMaterialTable = () => (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <span className="text-xs font-bold text-slate-600">{filtered.length}개 자재</span>
        <button onClick={toggleAllMaterials}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200">
          {expandedMaterials.size === pageData.length ? '전체 접기' : '전체 펼치기'}
        </button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
          <SortTh field="materialCode" label="자재코드" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
          <th className="px-2 py-2 text-left cursor-pointer hover:text-indigo-600 select-none min-w-[200px]"
            onClick={() => handleSort('materialName')}>
            자재명 {sortKey === 'materialName' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
          </th>
          <SortTh field="materialType" label="유형" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
          <SortTh field="unitPrice" label="단가" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          {Array.from({ length: 12 }, (_, i) => (
            <th key={i} className="px-1.5 py-2 text-right w-14">{i + 1}월</th>
          ))}
          <SortTh field="totalQty" label="합계" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <SortTh field="currentStock" label="현재고" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <SortTh field="orderQty" label="발주량" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
          <SortTh field="totalCost" label="금액" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
        </tr></thead>
        <tbody>
          {pageData.map(m => {
            const isExpanded = expandedMaterials.has(m.materialCode);
            const breakdown = m.productBreakdown || [];
            const hasBreakdown = breakdown.length > 0;
            return (
              <React.Fragment key={m.materialCode}>
                <tr className={`border-b border-slate-50 ${hasBreakdown ? 'hover:bg-indigo-50/50 cursor-pointer' : 'hover:bg-slate-50'} transition-colors`}
                  onClick={hasBreakdown ? () => toggleMaterial(m.materialCode) : undefined}>
                  <td className="px-2 py-1.5 font-mono text-indigo-600 whitespace-nowrap sticky left-0 bg-white">
                    {hasBreakdown && <span className={`inline-block w-3.5 text-indigo-400 text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>}
                    {m.materialCode}
                  </td>
                  <td className="px-2 py-1.5 min-w-[200px]" title={m.materialName}>
                    <span className="block truncate max-w-[200px]">{m.materialName}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${typeBadgeClass(m.materialType)}`}>{m.materialType}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500">{Math.round(m.unitPrice).toLocaleString()}</td>
                  {m.monthlyQty.map((q, i) => (
                    <td key={i} className="px-1.5 py-1.5 text-right font-mono text-[10px]">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{Math.round(m.totalQty).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500">{m.currentStock > 0 ? Math.round(m.currentStock).toLocaleString() : '-'}</td>
                  <td className={`px-2 py-1.5 text-right font-mono font-bold ${m.orderQty > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {m.orderQty > 0 ? Math.round(m.orderQty).toLocaleString() : '-'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{fmt(m.totalCost)}</td>
                </tr>
                {isExpanded && breakdown.map(c => (
                  <tr key={c.productPn} className="border-b border-slate-50 bg-indigo-50/30 hover:bg-indigo-50/60">
                    <td className="pl-7 pr-2 py-1 sticky left-0 bg-indigo-50/30">
                      <span className="font-mono text-violet-600 text-[10px]">{c.productPn}</span>
                    </td>
                    <td className="px-2 py-1 text-slate-500 text-[10px] truncate max-w-[200px]" title={c.productName}>
                      {c.productName}
                      <span className="ml-1.5 text-slate-400">@{c.qtyPerUnit < 1 ? c.qtyPerUnit.toFixed(3) : c.qtyPerUnit.toFixed(2)}/{m.unit}</span>
                    </td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1"></td>
                    {c.monthlyQty.map((q, i) => (
                      <td key={i} className="px-1.5 py-1 text-right font-mono text-[10px] text-slate-500">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                    ))}
                    <td className="px-2 py-1 text-right font-mono text-[10px] font-bold text-slate-600">{Math.round(c.totalQty).toLocaleString()}</td>
                    <td className="px-2 py-1" colSpan={3}></td>
                  </tr>
                ))}
                {isExpanded && breakdown.length > 0 && (
                  <tr className="border-b border-indigo-200 bg-indigo-50/20">
                    <td className="pl-7 pr-2 py-1 sticky left-0 bg-indigo-50/20 text-[10px] text-indigo-500 font-bold" colSpan={2}>
                      {breakdown.length}개 제품 투입
                    </td>
                    <td colSpan={2}></td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const mSum = breakdown.reduce((s, c) => s + (c.monthlyQty[i] || 0), 0);
                      return <td key={i} className="px-1.5 py-1 text-right font-mono text-[10px] text-indigo-500 font-bold">{mSum > 0 ? Math.round(mSum).toLocaleString() : ''}</td>;
                    })}
                    <td className="px-2 py-1 text-right font-mono text-[10px] font-bold text-indigo-600">{Math.round(breakdown.reduce((s, c) => s + c.totalQty, 0)).toLocaleString()}</td>
                    <td className="px-2 py-1 text-center" colSpan={3}>
                      <button onClick={(e) => { e.stopPropagation(); downloadRequiredQtyBreakdown(m); }}
                        className="text-indigo-500 hover:text-indigo-700" title="산출근거 다운로드">
                        <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <Pagination page={page} setPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
    </div>
  );

  // 업체별 뷰 렌더링
  const renderSupplierTable = () => (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <span className="text-xs font-bold text-slate-600">{supplierData.length}개 업체</span>
        <button onClick={toggleAllSuppliers}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200">
          {expandedSuppliers.size === supplierData.length ? '전체 접기' : '전체 펼치기'}
        </button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
          <th className="px-3 py-2 text-left sticky left-0 bg-slate-50">업체명</th>
          <th className="px-3 py-2 text-right">자재수</th>
          {Array.from({ length: 12 }, (_, i) => (
            <th key={i} className="px-1.5 py-2 text-right w-14">{i + 1}월</th>
          ))}
          <th className="px-3 py-2 text-right font-bold">총금액</th>
          <th className="px-3 py-2 text-right">발주금액</th>
          <th className="px-2 py-2 text-center">발주서</th>
        </tr></thead>
        <tbody>
          {supplierData.map(s => {
            const isExpanded = expandedSuppliers.has(s.name);
            return (
              <React.Fragment key={s.name}>
                <tr className="border-b border-slate-100 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                  onClick={() => toggleSupplier(s.name)}>
                  <td className="px-3 py-2 font-bold text-slate-700 sticky left-0 bg-white">
                    <span className={`inline-block w-4 text-indigo-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    {s.name}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{s.materialCount}</td>
                  {s.monthlyQty.map((q, i) => (
                    <td key={i} className="px-1.5 py-2 text-right font-mono text-[10px]">{q > 0 ? Math.round(q).toLocaleString() : ''}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono font-bold">{fmt(s.totalCost)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{s.totalOrderAmount > 0 ? fmt(s.totalOrderAmount) : '-'}</td>
                  <td className="px-2 py-2 text-center">
                    {s.totalOrderAmount > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); handleDownloadPO(s.name, s.materials); }}
                        className="text-indigo-500 hover:text-indigo-700" title="발주서 다운로드">
                        <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
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
                    <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                      {m.orderQty > 0 && <span className="text-red-600">{Math.round(m.orderQty).toLocaleString()}</span>}
                    </td>
                    <td className="px-2 py-1.5"></td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <MonthSelector selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex gap-1">
          {VIEW_TABS.map(tab => (
            <button key={tab.id} onClick={() => { setViewMode(tab.id); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${viewMode === tab.id ? (
                tab.id === 'resin' ? 'bg-indigo-600 text-white' :
                tab.id === 'paint' ? 'bg-amber-600 text-white' :
                'bg-indigo-600 text-white'
              ) : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {tab.label}
            </button>
          ))}
        </div>
        {(viewMode === 'material' || viewMode === 'supplier') && (
          <div className="flex gap-1 flex-wrap">
            {types.map(t => (
              <button key={t} onClick={() => { setTypeFilter(t); setPage(0); }}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold ${typeFilter === t ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="자재 종류" value={`${filtered.length}건`} color="indigo" />
        <KPICard label="총 소요금액" value={fmt(filtered.reduce((s, m) => s + m.totalCost, 0))} color="violet" />
        <KPICard label="업체 수" value={`${supplierData.length}곳`} color="emerald" />
        <KPICard label="발주 필요 금액" value={fmt(filtered.reduce((s, m) => s + m.orderQty * m.unitPrice, 0))} color="red" />
      </div>

      {(viewMode === 'material' || viewMode === 'resin' || viewMode === 'paint') && renderMaterialTable()}
      {viewMode === 'supplier' && renderSupplierTable()}
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
    { label: '입고실적', ok: data.purchaseData.length > 0 },
    { label: '재고', ok: data.inventoryItems.length > 0 },
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
