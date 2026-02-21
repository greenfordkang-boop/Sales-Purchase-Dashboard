import React, { useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';
import {
  parseForecastExcel,
  ForecastItem,
  ForecastSummary,
  ForecastUpload,
  ForecastParseResult,
} from '../utils/salesForecastParser';
import { downloadCSV } from '../utils/csvExport';

// ============================================
// Constants
// ============================================
const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const STORAGE_KEY_FORECAST = 'dashboard_forecastData';
const STORAGE_KEY_PREV_FORECAST = 'dashboard_forecastData_prev';
const STORAGE_KEY_PREV_SUMMARY = 'dashboard_forecastData_prev_summary';
const STORAGE_KEY_UPLOADS = 'dashboard_forecastUploads';

// 증감 내역 타입
interface ChangeItem {
  customer: string;
  model: string;
  type: 'increase' | 'decrease' | 'new' | 'removed';
  prevMonthlyQty: number[];  // 이전 월별 수량
  currMonthlyQty: number[];  // 현재 월별 수량
  prevTotalRevenue: number;
  currTotalRevenue: number;
  revenueDiff: number;
  qtyDiff: number;
  description: string;  // 요약 설명
}

const formatBillion = (v: number) => {
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return v.toLocaleString();
};

const formatWon = (v: number) => `₩${Math.round(v).toLocaleString()}`;

// ============================================
// Component
// ============================================
const SalesForecast: React.FC = () => {
  // --- State ---
  const [forecastItems, setForecastItems] = useState<ForecastItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FORECAST);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [summary, setSummary] = useState<ForecastSummary | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FORECAST + '_summary');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [uploads, setUploads] = useState<ForecastUpload[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_UPLOADS);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [prevItems, setPrevItems] = useState<ForecastItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PREV_FORECAST);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [prevSummary, setPrevSummary] = useState<ForecastSummary | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PREV_SUMMARY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [isUploading, setIsUploading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('All');
  const [detailOpen, setDetailOpen] = useState(true);
  const [changeTableOpen, setChangeTableOpen] = useState(true);
  const [customerTableOpen, setCustomerTableOpen] = useState(true);
  const [diffOpen, setDiffOpen] = useState(true);
  const [uploadHistoryOpen, setUploadHistoryOpen] = useState(false);

  // Filters & Sort
  const [filter, setFilter] = useState({
    customer: '', model: '', partNo: '', partName: '', stage: ''
  });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // --- File Upload Handler ---
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.name.match(/\.xlsx?$/i)) {
      alert('엑셀 파일(.xlsx)만 업로드할 수 있습니다.');
      return;
    }

    setIsUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result: ForecastParseResult = parseForecastExcel(buffer, file.name);

      if (result.items.length === 0) {
        alert('파싱된 데이터가 없습니다. 엑셀 파일 형식을 확인해주세요.');
        setIsUploading(false);
        return;
      }

      // Save previous data before overwriting (for diff)
      if (forecastItems.length > 0) {
        setPrevItems(forecastItems);
        localStorage.setItem(STORAGE_KEY_PREV_FORECAST, JSON.stringify(forecastItems));
        if (summary) {
          setPrevSummary(summary);
          localStorage.setItem(STORAGE_KEY_PREV_SUMMARY, JSON.stringify(summary));
        }
      }

      // Save items
      setForecastItems(result.items);
      localStorage.setItem(STORAGE_KEY_FORECAST, JSON.stringify(result.items));

      // Save summary
      setSummary(result.summary);
      localStorage.setItem(STORAGE_KEY_FORECAST + '_summary', JSON.stringify(result.summary));

      // Add upload history
      const newUpload: ForecastUpload = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        uploadDate: new Date().toISOString(),
        ...result.upload,
      };
      const updatedUploads = [newUpload, ...uploads];
      setUploads(updatedUploads);
      localStorage.setItem(STORAGE_KEY_UPLOADS, JSON.stringify(updatedUploads));

      alert(`${result.items.length}개 품목 데이터가 로드되었습니다.\n연간 예상매출: ${formatWon(result.summary.totalRevenue)}`);
    } catch (err) {
      console.error('Forecast Excel parse error:', err);
      alert('파일 파싱 오류: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
    } finally {
      setIsUploading(false);
    }
  }, [uploads]);

  // --- Derived Data ---
  const customers = useMemo(() => {
    const set = new Set(forecastItems.map(i => i.customer));
    return ['All', ...Array.from(set).sort()];
  }, [forecastItems]);

  const filteredByCustomer = useMemo(() => {
    if (selectedCustomer === 'All') return forecastItems;
    return forecastItems.filter(i => i.customer === selectedCustomer);
  }, [forecastItems, selectedCustomer]);

  // Chart data - monthly revenue & qty
  const chartData = useMemo(() => {
    if (filteredByCustomer.length === 0) return [];
    return MONTH_LABELS.map((label, idx) => {
      const revenue = filteredByCustomer.reduce((sum, item) => sum + (item.monthlyRevenue[idx] || 0), 0);
      const qty = filteredByCustomer.reduce((sum, item) => sum + (item.monthlyQty[idx] || 0), 0);
      return { month: label, revenue, qty };
    });
  }, [filteredByCustomer]);

  // Month-over-month change data
  const monthlyChanges = useMemo(() => {
    if (chartData.length < 2) return [];
    return chartData.map((d, idx) => {
      if (idx === 0) return { ...d, revenueChange: 0, revenuePct: 0 };
      const prev = chartData[idx - 1].revenue;
      const change = d.revenue - prev;
      const pct = prev !== 0 ? (change / prev) * 100 : 0;
      return { ...d, revenueChange: change, revenuePct: pct };
    });
  }, [chartData]);

  // Totals for selected customer
  const totals = useMemo(() => {
    const totalRevenue = filteredByCustomer.reduce((s, i) => s + i.totalRevenue, 0);
    const totalQty = filteredByCustomer.reduce((s, i) => s + i.totalQty, 0);
    return { totalRevenue, totalQty, itemCount: filteredByCustomer.length };
  }, [filteredByCustomer]);

  // Customer-level revenue breakdown (1% 미만은 기타 합산)
  const customerRevenue = useMemo(() => {
    const map = new Map<string, number>();
    forecastItems.forEach(item => {
      map.set(item.customer, (map.get(item.customer) || 0) + item.totalRevenue);
    });
    const total = forecastItems.reduce((s, i) => s + i.totalRevenue, 0);
    const sorted = Array.from(map.entries())
      .map(([customer, revenue]) => ({ customer, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    if (total === 0) return sorted;

    const main: typeof sorted = [];
    let etcRevenue = 0;
    for (const item of sorted) {
      if ((item.revenue / total) * 100 >= 1) {
        main.push(item);
      } else {
        etcRevenue += item.revenue;
      }
    }
    if (etcRevenue > 0) {
      main.push({ customer: '기타', revenue: etcRevenue });
    }
    return main;
  }, [forecastItems]);

  // 전기 대비 증감 내역 (고객사+모델 단위 비교)
  const changeItems = useMemo((): ChangeItem[] => {
    if (prevItems.length === 0 || forecastItems.length === 0) return [];

    // 고객사+모델 단위로 집계
    const aggregate = (items: ForecastItem[]) => {
      const map = new Map<string, { customer: string; model: string; monthlyQty: number[]; totalRevenue: number }>();
      items.forEach(item => {
        const key = `${item.customer}||${item.model}`;
        const existing = map.get(key);
        if (existing) {
          item.monthlyQty.forEach((q, i) => { existing.monthlyQty[i] += q; });
          existing.totalRevenue += item.totalRevenue;
        } else {
          map.set(key, {
            customer: item.customer,
            model: item.model,
            monthlyQty: [...item.monthlyQty],
            totalRevenue: item.totalRevenue,
          });
        }
      });
      return map;
    };

    const prevMap = aggregate(prevItems);
    const currMap = aggregate(forecastItems);
    const changes: ChangeItem[] = [];

    // 현재 데이터 기준으로 증감 확인
    currMap.forEach((curr, key) => {
      const prev = prevMap.get(key);
      if (!prev) {
        // 신규 추가
        const totalQty = curr.monthlyQty.reduce((s, q) => s + q, 0);
        if (totalQty > 0 || curr.totalRevenue > 0) {
          changes.push({
            customer: curr.customer,
            model: curr.model,
            type: 'new',
            prevMonthlyQty: new Array(12).fill(0),
            currMonthlyQty: curr.monthlyQty,
            prevTotalRevenue: 0,
            currTotalRevenue: curr.totalRevenue,
            revenueDiff: curr.totalRevenue,
            qtyDiff: totalQty,
            description: `신규 추가 (월평균 ${formatBillion(totalQty / 12)} EA)`,
          });
        }
      } else {
        // 기존 항목 비교
        const qtyDiffs = curr.monthlyQty.map((q, i) => q - prev.monthlyQty[i]);
        const totalQtyDiff = qtyDiffs.reduce((s, d) => s + d, 0);
        const revDiff = curr.totalRevenue - prev.totalRevenue;

        // 의미있는 변화만 (수량 100 이상 또는 매출 1000만원 이상 변동)
        if (Math.abs(totalQtyDiff) >= 100 || Math.abs(revDiff) >= 10_000_000) {
          // 변화가 큰 월 구간 파악
          const changedMonths: string[] = [];
          let i = 0;
          while (i < 12) {
            if (Math.abs(qtyDiffs[i]) >= 50) {
              const startMonth = i + 1;
              let endMonth = startMonth;
              while (i + 1 < 12 && Math.abs(qtyDiffs[i + 1]) >= 50 && Math.sign(qtyDiffs[i + 1]) === Math.sign(qtyDiffs[i])) {
                i++;
                endMonth = i + 1;
              }
              const avgPrev = prev.monthlyQty.slice(startMonth - 1, endMonth).reduce((s, v) => s + v, 0) / (endMonth - startMonth + 1);
              const avgCurr = curr.monthlyQty.slice(startMonth - 1, endMonth).reduce((s, v) => s + v, 0) / (endMonth - startMonth + 1);
              const rangeStr = startMonth === endMonth ? `${startMonth}월` : `${startMonth}~${endMonth}월`;
              const prevK = avgPrev >= 1000 ? `${(avgPrev / 1000).toFixed(1)}K` : Math.round(avgPrev).toLocaleString();
              const currK = avgCurr >= 1000 ? `${(avgCurr / 1000).toFixed(1)}K` : Math.round(avgCurr).toLocaleString();
              changedMonths.push(`${rangeStr} ${prevK} → ${currK}/월`);
            }
            i++;
          }

          const desc = changedMonths.length > 0
            ? changedMonths.join(', ')
            : `연간 ${totalQtyDiff >= 0 ? '+' : ''}${Math.round(totalQtyDiff).toLocaleString()} EA`;

          changes.push({
            customer: curr.customer,
            model: curr.model,
            type: totalQtyDiff >= 0 ? 'increase' : 'decrease',
            prevMonthlyQty: prev.monthlyQty,
            currMonthlyQty: curr.monthlyQty,
            prevTotalRevenue: prev.totalRevenue,
            currTotalRevenue: curr.totalRevenue,
            revenueDiff: revDiff,
            qtyDiff: totalQtyDiff,
            description: desc,
          });
        }
      }
    });

    // 삭제된 항목
    prevMap.forEach((prev, key) => {
      if (!currMap.has(key)) {
        const totalQty = prev.monthlyQty.reduce((s, q) => s + q, 0);
        if (totalQty > 0 || prev.totalRevenue > 0) {
          changes.push({
            customer: prev.customer,
            model: prev.model,
            type: 'removed',
            prevMonthlyQty: prev.monthlyQty,
            currMonthlyQty: new Array(12).fill(0),
            prevTotalRevenue: prev.totalRevenue,
            currTotalRevenue: 0,
            revenueDiff: -prev.totalRevenue,
            qtyDiff: -totalQty,
            description: '삭제됨',
          });
        }
      }
    });

    // 매출 증감 절대값 기준 내림차순 정렬
    return changes.sort((a, b) => Math.abs(b.revenueDiff) - Math.abs(a.revenueDiff));
  }, [forecastItems, prevItems]);

  // Filtered + sorted detail table
  const filteredItems = useMemo(() => {
    let items = filteredByCustomer;

    if (filter.customer) items = items.filter(i => i.customer.toLowerCase().includes(filter.customer.toLowerCase()));
    if (filter.model) items = items.filter(i => i.model.toLowerCase().includes(filter.model.toLowerCase()));
    if (filter.partNo) items = items.filter(i => i.partNo.toLowerCase().includes(filter.partNo.toLowerCase()));
    if (filter.partName) items = items.filter(i => i.partName.toLowerCase().includes(filter.partName.toLowerCase()));
    if (filter.stage) items = items.filter(i => i.stage.toLowerCase().includes(filter.stage.toLowerCase()));

    if (sortConfig) {
      items = [...items].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      });
    }
    return items;
  }, [filteredByCustomer, filter, sortConfig]);

  const filteredTotals = useMemo(() => {
    const rev = filteredItems.reduce((s, i) => s + i.totalRevenue, 0);
    const qty = filteredItems.reduce((s, i) => s + i.totalQty, 0);
    return { revenue: rev, qty };
  }, [filteredItems]);

  // --- Handlers ---
  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' }
    );
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilter(prev => ({ ...prev, [key]: value }));
  };

  const handleDownloadDetail = () => {
    const headers = ['No', '거래선', '차종', '단계', 'P.N', 'NEW P.N', 'Type', '단가', '구분', '부품명',
      '1월수량', '2월수량', '3월수량', '4월수량', '5월수량', '6월수량', '7월수량', '8월수량', '9월수량', '10월수량', '11월수량', '12월수량', '총수량',
      '1월매출', '2월매출', '3월매출', '4월매출', '5월매출', '6월매출', '7월매출', '8월매출', '9월매출', '10월매출', '11월매출', '12월매출', '총매출'];
    const rows = filteredItems.map(item => [
      item.no, item.customer, item.model, item.stage, item.partNo, item.newPartNo, item.type, item.unitPrice, item.category, item.partName,
      ...item.monthlyQty.map(q => Math.round(q)),
      Math.round(item.totalQty),
      ...item.monthlyRevenue.map(r => Math.round(r)),
      Math.round(item.totalRevenue),
    ]);
    const yearLabel = summary?.year || new Date().getFullYear();
    const customerLabel = selectedCustomer === 'All' ? '전체' : selectedCustomer;
    downloadCSV(`매출계획_${yearLabel}_${customerLabel}`, headers, rows);
  };

  const handleDownloadDiff = () => {
    if (changeItems.length === 0) return;
    const prevLabel = prevSummary ? `${prevSummary.revision}(${prevSummary.reportDate})` : '이전';
    const currLabel = summary ? `${summary.revision}(${summary.reportDate})` : '현재';
    const headers = ['구분', '고객사', '모델/차종',
      '이전 1월', '이전 2월', '이전 3월', '이전 4월', '이전 5월', '이전 6월', '이전 7월', '이전 8월', '이전 9월', '이전 10월', '이전 11월', '이전 12월',
      '현재 1월', '현재 2월', '현재 3월', '현재 4월', '현재 5월', '현재 6월', '현재 7월', '현재 8월', '현재 9월', '현재 10월', '현재 11월', '현재 12월',
      '이전 매출', '현재 매출', '매출 증감', '수량 증감', '요약'];
    const rows = changeItems.map(c => [
      c.type === 'increase' ? '증량' : c.type === 'decrease' ? '감량' : c.type === 'new' ? '신규' : '삭제',
      c.customer, c.model,
      ...c.prevMonthlyQty.map(q => Math.round(q)),
      ...c.currMonthlyQty.map(q => Math.round(q)),
      Math.round(c.prevTotalRevenue), Math.round(c.currTotalRevenue), Math.round(c.revenueDiff), Math.round(c.qtyDiff),
      c.description,
    ]);
    downloadCSV(`증감내역_${prevLabel}_vs_${currLabel}`, headers, rows);
  };

  const handleDeleteUpload = (uploadId: string) => {
    if (!window.confirm('이 업로드 이력을 삭제하시겠습니까?')) return;
    const updated = uploads.filter(u => u.id !== uploadId);
    setUploads(updated);
    localStorage.setItem(STORAGE_KEY_UPLOADS, JSON.stringify(updated));
  };

  // --- SortableHeader Component ---
  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: string }) => (
    <th
      className={`px-4 py-3 cursor-pointer hover:bg-slate-100 select-none ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
      onClick={() => handleSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortConfig?.key === sortKey && (
          <span className="text-blue-500">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );

  // ============================================
  // Render
  // ============================================
  return (
    <section className="space-y-6">
      {/* Header + Upload */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800">매출계획 (Sales Forecast)</h2>
          <p className="text-xs text-slate-500 mt-1">
            {summary ? `${summary.year}년 ${summary.revision} | ${summary.reportDate}` : '엑셀 파일을 업로드하세요'}
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <label className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2 ${isUploading ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-blue-100 hover:bg-blue-200 text-blue-700'}`}>
            <span>📊</span> {isUploading ? '파싱 중...' : '엑셀 업로드 (.xlsx)'}
            <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" disabled={isUploading} />
          </label>
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[150px]"
          >
            {customers.map(c => <option key={c} value={c}>{c === 'All' ? '전체 고객사' : c}</option>)}
          </select>
        </div>
      </div>

      {/* Upload History */}
      {uploads.length > 0 && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setUploadHistoryOpen(!uploadHistoryOpen)}
            className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors w-full"
          >
            <svg className={`w-4 h-4 transition-transform ${uploadHistoryOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            업로드 이력 ({uploads.length}건)
          </button>
          {uploadHistoryOpen && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left">업로드 일시</th>
                    <th className="px-4 py-2 text-left">파일명</th>
                    <th className="px-4 py-2 text-left">보고서 정보</th>
                    <th className="px-4 py-2 text-right">연간 예상매출</th>
                    <th className="px-4 py-2 text-right">총 수량</th>
                    <th className="px-4 py-2 text-right">품목 수</th>
                    <th className="px-4 py-2 text-center">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {uploads.map((u, idx) => {
                    const prevUpload = uploads[idx + 1]; // older upload
                    const revenueDiff = prevUpload ? u.totalRevenue - prevUpload.totalRevenue : 0;
                    return (
                      <tr key={u.id} className={idx === 0 ? 'bg-blue-50/50' : 'hover:bg-slate-50'}>
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          {new Date(u.uploadDate).toLocaleString('ko-KR')}
                          {idx === 0 && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-md font-bold">최신</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]" title={u.fileName}>{u.fileName}</td>
                        <td className="px-4 py-2.5 text-slate-600">{u.revision} | {u.reportDate}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                          {formatWon(u.totalRevenue)}
                          {prevUpload && revenueDiff !== 0 && (
                            <span className={`ml-2 text-[10px] font-bold ${revenueDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {revenueDiff > 0 ? '▲' : '▼'} {formatBillion(Math.abs(revenueDiff))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">{Math.round(u.totalQty).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">{u.itemCount}개</td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteUpload(u.id); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            title="삭제"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* No data state */}
      {forecastItems.length === 0 && (
        <div className="bg-white p-16 rounded-3xl border border-slate-200 shadow-sm text-center">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-lg font-bold text-slate-700 mb-2">매출계획 데이터가 없습니다</h3>
          <p className="text-sm text-slate-500 mb-6">
            "2026년 예상매출 보고" 엑셀 파일을 업로드하면<br />
            월별 예상매출 그래프와 상세 테이블이 표시됩니다.
          </p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm cursor-pointer transition-colors">
            <span>📊</span> 엑셀 파일 업로드
            <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      )}

      {/* Metrics Cards */}
      {forecastItems.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">연간 예상매출</p>
              <p className="text-2xl font-black text-blue-600">{formatBillion(totals.totalRevenue)}원</p>
              <p className="text-xs text-slate-400 mt-1">{formatWon(totals.totalRevenue)}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">연간 총 수량</p>
              <p className="text-2xl font-black text-emerald-600">{Math.round(totals.totalQty).toLocaleString()} EA</p>
              <p className="text-xs text-slate-400 mt-1">월평균 {Math.round(totals.totalQty / 12).toLocaleString()} EA</p>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">품목 수</p>
              <p className="text-2xl font-black text-slate-800">{totals.itemCount}개</p>
              <p className="text-xs text-slate-400 mt-1">
                {selectedCustomer === 'All' ? `전체 ${customers.length - 1}개 고객사` : selectedCustomer}
              </p>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">월평균 매출</p>
              <p className="text-2xl font-black text-amber-600">{formatBillion(totals.totalRevenue / 12)}원</p>
              <p className="text-xs text-slate-400 mt-1">{summary?.year}년 예상 기준</p>
            </div>
          </div>

          {/* Monthly Revenue Chart */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
                월별 예상매출 추이 {selectedCustomer !== 'All' && `(${selectedCustomer})`}
              </h3>
            </div>
            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 40, right: 40, bottom: 20, left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#64748b' }} />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={(v) => formatBillion(v)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={(v) => v.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                    cursor={{ fill: '#f8fafc' }}
                    formatter={(value: number, name: string) => [
                      name === '예상매출' ? formatWon(value) : `${Math.round(value).toLocaleString()} EA`,
                      name,
                    ]}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                  <Bar yAxisId="left" name="예상매출" dataKey="revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={32}>
                    <LabelList
                      dataKey="revenue"
                      position="top"
                      formatter={(v: number) => formatBillion(v)}
                      style={{ fontSize: 10, fontWeight: 700, fill: '#3b82f6' }}
                    />
                  </Bar>
                  <Line
                    yAxisId="right"
                    type="monotone"
                    name="예상수량"
                    dataKey="qty"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Revision Diff - 전기 대비 증감내역 */}
          {changeItems.length > 0 && (
            <div className="bg-white p-6 rounded-3xl border border-orange-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setDiffOpen(!diffOpen)}
                  className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-orange-600 transition-colors"
                >
                  <svg className={`w-5 h-5 transition-transform ${diffOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  <span className="w-1 h-5 bg-orange-500 rounded-full"></span>
                  전기 대비 증감내역 ({changeItems.length}건)
                  <span className="text-xs font-normal text-slate-500 ml-2">
                    {prevSummary ? `${prevSummary.revision}` : '이전'} → {summary ? `${summary.revision}` : '현재'}
                  </span>
                </button>
                <button onClick={handleDownloadDiff} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  엑셀 다운로드
                </button>
              </div>
              {diffOpen && (
                <div className="space-y-3">
                  {/* 요약 배지 */}
                  <div className="flex gap-3 flex-wrap mb-2">
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                      증량 {changeItems.filter(c => c.type === 'increase').length}건
                    </span>
                    <span className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-bold">
                      감량 {changeItems.filter(c => c.type === 'decrease').length}건
                    </span>
                    {changeItems.filter(c => c.type === 'new').length > 0 && (
                      <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold">
                        신규 {changeItems.filter(c => c.type === 'new').length}건
                      </span>
                    )}
                    {changeItems.filter(c => c.type === 'removed').length > 0 && (
                      <span className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">
                        삭제 {changeItems.filter(c => c.type === 'removed').length}건
                      </span>
                    )}
                    <span className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold">
                      매출 증감 합계: {(() => {
                        const total = changeItems.reduce((s, c) => s + c.revenueDiff, 0);
                        return `${total >= 0 ? '+' : ''}${formatBillion(total)}원`;
                      })()}
                    </span>
                  </div>

                  {/* 증감 리스트 */}
                  <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">구분</th>
                          <th className="px-4 py-3">고객사</th>
                          <th className="px-4 py-3">모델/차종</th>
                          <th className="px-4 py-3 text-right">수량 증감</th>
                          <th className="px-4 py-3 text-right">매출 증감</th>
                          <th className="px-4 py-3" style={{ minWidth: '300px' }}>변동 내역</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {changeItems.map((c, idx) => (
                          <tr key={`${c.customer}-${c.model}-${idx}`} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                c.type === 'increase' ? 'bg-emerald-100 text-emerald-700' :
                                c.type === 'decrease' ? 'bg-rose-100 text-rose-700' :
                                c.type === 'new' ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                {c.type === 'increase' ? '▲ 증량' : c.type === 'decrease' ? '▼ 감량' : c.type === 'new' ? '★ 신규' : '✕ 삭제'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-800">{c.customer}</td>
                            <td className="px-4 py-3 text-slate-700">{c.model}</td>
                            <td className="px-4 py-3 text-right font-mono">
                              <span className={c.qtyDiff >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                {c.qtyDiff >= 0 ? '+' : ''}{Math.round(c.qtyDiff).toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-bold">
                              <span className={c.revenueDiff >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                {c.revenueDiff >= 0 ? '+' : ''}{formatBillion(c.revenueDiff)}원
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{c.description}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                        <tr>
                          <td colSpan={3} className="px-4 py-3 text-center">합계 ({changeItems.length}건)</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {(() => {
                              const total = changeItems.reduce((s, c) => s + c.qtyDiff, 0);
                              return <span className={total >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{total >= 0 ? '+' : ''}{Math.round(total).toLocaleString()}</span>;
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {(() => {
                              const total = changeItems.reduce((s, c) => s + c.revenueDiff, 0);
                              return <span className={total >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{total >= 0 ? '+' : ''}{formatBillion(total)}원</span>;
                            })()}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Monthly Change Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <button
              onClick={() => setChangeTableOpen(!changeTableOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-amber-600 transition-colors w-full"
            >
              <svg className={`w-5 h-5 transition-transform ${changeTableOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
              월별 매출액 증감 현황
            </button>
            {changeTableOpen && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left">월</th>
                    <th className="px-4 py-3 text-right">예상매출</th>
                    <th className="px-4 py-3 text-right">예상수량</th>
                    <th className="px-4 py-3 text-right">전월 대비 증감액</th>
                    <th className="px-4 py-3 text-right">전월 대비 증감률</th>
                    <th className="px-4 py-3 text-center">추세</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyChanges.map((d, idx) => (
                    <tr key={d.month} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-700">{d.month}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{formatWon(d.revenue)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{Math.round(d.qty).toLocaleString()} EA</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {idx === 0 ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <span className={d.revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {d.revenueChange >= 0 ? '+' : ''}{formatWon(d.revenueChange)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {idx === 0 ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${d.revenuePct >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {d.revenuePct >= 0 ? '+' : ''}{d.revenuePct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {idx === 0 ? (
                          <span className="text-slate-300">-</span>
                        ) : (
                          <div className="inline-flex items-center">
                            <div className={`w-8 h-2 rounded-full ${d.revenuePct >= 5 ? 'bg-emerald-400' : d.revenuePct >= 0 ? 'bg-emerald-200' : d.revenuePct >= -5 ? 'bg-rose-200' : 'bg-rose-400'}`}></div>
                            <span className={`ml-1 text-[10px] font-bold ${d.revenueChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {d.revenueChange >= 0 ? '▲' : '▼'}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-3">합계</td>
                    <td className="px-4 py-3 text-right font-mono">{formatWon(totals.totalRevenue)}</td>
                    <td className="px-4 py-3 text-right font-mono">{Math.round(totals.totalQty).toLocaleString()} EA</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </div>

          {/* Customer Revenue Breakdown (when All selected) */}
          {selectedCustomer === 'All' && customerRevenue.length > 1 && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <button
                onClick={() => setCustomerTableOpen(!customerTableOpen)}
                className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-emerald-600 transition-colors w-full"
              >
                <svg className={`w-5 h-5 transition-transform ${customerTableOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                고객사별 매출 비중
              </button>
              {customerTableOpen && (
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left">순위</th>
                      <th className="px-4 py-3 text-left">고객사</th>
                      <th className="px-4 py-3 text-right">예상매출</th>
                      <th className="px-4 py-3 text-right">비중</th>
                      <th className="px-4 py-3 text-right">누적비중</th>
                      <th className="px-4 py-3 text-left" style={{ width: '25%' }}>비중 그래프</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(() => {
                      let cumPct = 0;
                      const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-orange-500'];
                      return customerRevenue.map((cr, idx) => {
                        const pct = totals.totalRevenue > 0 ? (cr.revenue / totals.totalRevenue) * 100 : 0;
                        cumPct += pct;
                        return (
                          <tr key={cr.customer} className={`hover:bg-slate-50 ${cr.customer === '기타' ? 'bg-slate-50/50 italic' : ''}`}>
                            <td className="px-4 py-3 font-bold text-slate-500">{idx + 1}</td>
                            <td className="px-4 py-3 font-bold text-slate-800">{cr.customer}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{formatWon(cr.revenue)}</td>
                            <td className="px-4 py-3 text-right font-mono text-slate-600">{pct.toFixed(1)}%</td>
                            <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">{cumPct.toFixed(1)}%</td>
                            <td className="px-4 py-3">
                              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${colors[idx % colors.length]} rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          {/* Detail Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setDetailOpen(!detailOpen)}
                className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              >
                <svg className={`w-5 h-5 transition-transform ${detailOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                매출상세 테이블 ({filteredItems.length}건)
              </button>
              <button onClick={handleDownloadDetail} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                엑셀 다운로드
              </button>
            </div>
            {detailOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <SortableHeader label="No" sortKey="no" />
                      <SortableHeader label="거래선" sortKey="customer" />
                      <SortableHeader label="차종" sortKey="model" />
                      <SortableHeader label="단계" sortKey="stage" />
                      <SortableHeader label="P.N" sortKey="partNo" />
                      <SortableHeader label="부품명" sortKey="partName" />
                      <SortableHeader label="Type" sortKey="type" />
                      <SortableHeader label="단가" sortKey="unitPrice" align="right" />
                      <SortableHeader label="총수량" sortKey="totalQty" align="right" />
                      <SortableHeader label="총매출" sortKey="totalRevenue" align="right" />
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2"><input type="text" placeholder="거래선" className="w-full p-1 border rounded text-xs font-normal" value={filter.customer} onChange={(e) => handleFilterChange('customer', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="차종" className="w-full p-1 border rounded text-xs font-normal" value={filter.model} onChange={(e) => handleFilterChange('model', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="단계" className="w-full p-1 border rounded text-xs font-normal" value={filter.stage} onChange={(e) => handleFilterChange('stage', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="P.N" className="w-full p-1 border rounded text-xs font-normal" value={filter.partNo} onChange={(e) => handleFilterChange('partNo', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="부품명" className="w-full p-1 border rounded text-xs font-normal" value={filter.partName} onChange={(e) => handleFilterChange('partName', e.target.value)} /></th>
                      <th className="px-2 py-2" colSpan={4}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => (
                      <tr key={`${item.no}-${item.partNo}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-400 font-mono">{item.no}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            item.stage === '양산' ? 'bg-emerald-100 text-emerald-700' :
                            item.stage === '신규' ? 'bg-blue-100 text-blue-700' :
                            item.stage === '단종' ? 'bg-slate-100 text-slate-500' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {item.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 text-[10px]">{item.partNo}</td>
                        <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={item.partName}>{item.partName}</td>
                        <td className="px-4 py-3 text-slate-500">{item.type}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{item.unitPrice > 0 ? `₩${item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{Math.round(item.totalQty).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{formatWon(item.totalRevenue)}</td>
                      </tr>
                    ))}
                    {filteredItems.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-center">합계 ({filteredItems.length}건)</td>
                      <td className="px-4 py-3 text-right font-mono">{Math.round(filteredTotals.qty).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatWon(filteredTotals.revenue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default SalesForecast;
