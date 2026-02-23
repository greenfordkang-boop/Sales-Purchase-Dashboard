
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { PurchaseItemMaster, PurchaseMonthlySummary, parsePurchaseSummaryCSV } from '../utils/purchaseSummaryTypes';
import { isSupabaseConfigured } from '../lib/supabase';
import { purchaseSummaryService, purchaseItemMasterService } from '../services/supabaseService';
import { downloadCSV } from '../utils/csvExport';
import { parseInitialItemMaster, parseInitialSummary } from '../data/initialPurchaseSummaryData';

const CHART_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#ef4444', '#3b82f6'];

const PurchaseSummaryView: React.FC = () => {
  // --- State ---
  const [summaryData, setSummaryData] = useState<PurchaseMonthlySummary[]>([]);
  const [masterData, setMasterData] = useState<PurchaseItemMaster[]>([]);
  const [masterMap, setMasterMap] = useState<Map<string, PurchaseItemMaster>>(new Map());
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [selectedMonth, setSelectedMonth] = useState<string>('All');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterProcess, setFilterProcess] = useState('All');
  const [filterCustomer, setFilterCustomer] = useState('All');
  const [filterCostType, setFilterCostType] = useState('All');

  // Sort
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Upload
  const [uploadMonth, setUploadMonth] = useState('');
  const [uploadYear, setUploadYear] = useState(2025);
  const [uploading, setUploading] = useState(false);

  // Table collapse
  const [collapsedSuppliers, setCollapsedSuppliers] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);

  // Dual scrollbar sync
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const scrollSourceRef = useRef<'top' | 'table' | null>(null);

  // Column resize
  const COLUMNS = [
    { key: 'month', label: '구분', defaultWidth: 60 },
    { key: 'supplier', label: '매입처', defaultWidth: 130 },
    { key: 'partNo', label: '도번', defaultWidth: 120 },
    { key: 'partName', label: '품명', defaultWidth: 180 },
    { key: 'spec', label: '규격', defaultWidth: 100 },
    { key: 'unit', label: '단위', defaultWidth: 50 },
    { key: 'salesQty', label: '매출수량', defaultWidth: 80 },
    { key: 'closingQty', label: '마감수량', defaultWidth: 80 },
    { key: 'unitPrice', label: '단가', defaultWidth: 90 },
    { key: 'amount', label: '금액', defaultWidth: 110 },
    { key: 'location', label: '사용처', defaultWidth: 80 },
    { key: 'costType', label: '재료비구분', defaultWidth: 80 },
    { key: 'purchaseType', label: '구입구분', defaultWidth: 80 },
    { key: 'materialType', label: '재료구분', defaultWidth: 80 },
    { key: 'process', label: '공정', defaultWidth: 80 },
    { key: 'customer', label: '고객사', defaultWidth: 80 },
  ];
  const [columnWidths, setColumnWidths] = useState<number[]>(() => COLUMNS.map(c => c.defaultWidth));
  const resizingCol = useRef<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const totalTableWidth = columnWidths.reduce((s, w) => s + w, 0);

  const onResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colIndex;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[colIndex];

    const onMouseMove = (ev: MouseEvent) => {
      if (resizingCol.current === null) return;
      const diff = ev.clientX - resizeStartX.current;
      const newWidth = Math.max(30, resizeStartWidth.current + diff);
      setColumnWidths(prev => {
        const next = [...prev];
        next[resizingCol.current!] = newWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  useEffect(() => {
    const top = topScrollRef.current;
    const table = tableScrollRef.current;
    if (!top || !table) return;

    const onTopScroll = () => {
      if (scrollSourceRef.current === 'table') return;
      scrollSourceRef.current = 'top';
      table.scrollLeft = top.scrollLeft;
      requestAnimationFrame(() => { scrollSourceRef.current = null; });
    };
    const onTableScroll = () => {
      if (scrollSourceRef.current === 'top') return;
      scrollSourceRef.current = 'table';
      top.scrollLeft = table.scrollLeft;
      requestAnimationFrame(() => { scrollSourceRef.current = null; });
    };

    top.addEventListener('scroll', onTopScroll);
    table.addEventListener('scroll', onTableScroll);
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      table.removeEventListener('scroll', onTableScroll);
    };
  }, [loading]);

  // --- Load Data ---
  useEffect(() => {
    const DATA_VERSION = 'v2_3624';  // Bump this when built-in data changes

    const load = async () => {
      setLoading(true);
      try {
        let summary: PurchaseMonthlySummary[] = [];
        let master: PurchaseItemMaster[] = [];

        // Try Supabase first
        try {
          [summary, master] = await Promise.all([
            purchaseSummaryService.getAll(),
            purchaseItemMasterService.getAll()
          ]);
        } catch (err) {
          console.warn('Supabase load failed, trying localStorage:', err);
        }

        // Check data version - force refresh if stale
        const cachedVersion = localStorage.getItem('dashboard_purchaseSummary_version');
        const needsRefresh = cachedVersion !== DATA_VERSION;

        // Fallback to built-in initial data
        if (summary.length === 0) {
          if (!needsRefresh) {
            const stored = localStorage.getItem('dashboard_purchaseSummary');
            if (stored) summary = JSON.parse(stored);
          }
          if (summary.length === 0 || needsRefresh) {
            summary = parseInitialSummary();
            localStorage.setItem('dashboard_purchaseSummary', JSON.stringify(summary));
            localStorage.setItem('dashboard_purchaseSummary_version', DATA_VERSION);
            console.log(`Loaded ${summary.length} initial summary rows (${DATA_VERSION})`);
          }
        }

        if (master.length === 0) {
          if (!needsRefresh) {
            const stored = localStorage.getItem('dashboard_purchaseItemMaster');
            if (stored) master = JSON.parse(stored);
          }
          if (master.length === 0 || needsRefresh) {
            master = parseInitialItemMaster();
            localStorage.setItem('dashboard_purchaseItemMaster', JSON.stringify(master));
            console.log(`Loaded ${master.length} initial master items (${DATA_VERSION})`);
          }
        }

        setSummaryData(summary);
        setMasterData(master);
        const map = new Map(master.map(m => [m.partNo, m]));
        setMasterMap(map);

        // Auto-detect year
        if (summary.length > 0) {
          const years = Array.from(new Set(summary.map(d => d.year)));
          setSelectedYear(Math.max(...years));
        }
      } catch (err) {
        console.error('Load purchase summary failed:', err);
      }
      setLoading(false);
    };
    load();
  }, []);

  // --- Filtered Data ---
  const filteredData = useMemo(() => {
    let data = summaryData.filter(d => d.year === selectedYear);
    if (selectedMonth !== 'All') data = data.filter(d => d.month === selectedMonth);
    if (filterSupplier) data = data.filter(d => d.supplier.includes(filterSupplier));
    if (filterProcess !== 'All') data = data.filter(d => d.process === filterProcess);
    if (filterCustomer !== 'All') data = data.filter(d => d.customer === filterCustomer);
    if (filterCostType !== 'All') data = data.filter(d => d.costType === filterCostType);
    return data;
  }, [summaryData, selectedYear, selectedMonth, filterSupplier, filterProcess, filterCustomer, filterCostType]);

  // --- Sort ---
  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = (a as any)[sortConfig.key];
      const bVal = (b as any)[sortConfig.key];
      if (aVal === bVal) return 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortConfig.direction === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [filteredData, sortConfig]);

  // --- Available filter values ---
  const yearData = useMemo(() => summaryData.filter(d => d.year === selectedYear), [summaryData, selectedYear]);
  const availableYears = useMemo(() => {
    const years = Array.from(new Set(summaryData.map(d => d.year))).sort();
    return years.length > 0 ? years : [2025];
  }, [summaryData]);
  const availableMonths = useMemo(() => {
    return Array.from(new Set(yearData.map(d => d.month))).sort();
  }, [yearData]);
  const availableProcesses = useMemo(() => Array.from(new Set(yearData.map(d => d.process).filter(Boolean))).sort(), [yearData]);
  const availableCustomers = useMemo(() => Array.from(new Set(yearData.map(d => d.customer).filter(Boolean))).sort(), [yearData]);
  const availableCostTypes = useMemo(() => Array.from(new Set(yearData.map(d => d.costType).filter(Boolean))).sort(), [yearData]);

  // --- Grouped by supplier ---
  const groupedBySupplier = useMemo(() => {
    const map = new Map<string, PurchaseMonthlySummary[]>();
    sortedData.forEach(d => {
      if (!map.has(d.supplier)) map.set(d.supplier, []);
      map.get(d.supplier)!.push(d);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sortedData]);

  // --- Summary Metrics ---
  const metrics = useMemo(() => {
    const totalAmount = filteredData.reduce((s, d) => s + d.amount, 0);
    const totalQty = filteredData.reduce((s, d) => s + d.closingQty, 0);
    const supplierCount = new Set(filteredData.map(d => d.supplier)).size;
    const partCount = new Set(filteredData.map(d => d.partNo)).size;
    return { totalAmount, totalQty, supplierCount, partCount };
  }, [filteredData]);

  // --- Chart Data ---
  const monthlyChartData = useMemo(() => {
    const allMonths = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const map = new Map<string, number>();
    allMonths.forEach(m => map.set(m, 0));
    yearData.forEach(d => {
      map.set(d.month, (map.get(d.month) || 0) + d.amount);
    });
    return allMonths.map(m => ({ month: m, amount: map.get(m) || 0 }));
  }, [yearData]);

  const processChartData = useMemo(() => {
    const map = new Map<string, number>();
    filteredData.forEach(d => {
      if (d.process) map.set(d.process, (map.get(d.process) || 0) + d.amount);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredData]);

  const customerChartData = useMemo(() => {
    const map = new Map<string, number>();
    filteredData.forEach(d => {
      if (d.customer) map.set(d.customer, (map.get(d.customer) || 0) + d.amount);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredData]);

  // --- Handlers ---
  const toggleSupplier = (supplier: string) => {
    setCollapsedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' }
    );
  };

  const formatAmount = (v: number) => {
    if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}만`;
    return v.toLocaleString();
  };

  const formatNum = (v: number) => v.toLocaleString();

  // --- CSV Upload Handler ---
  const handleCSVUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadMonth) return;

    setUploading(true);
    try {
      const text = await file.text();
      const parsed = parsePurchaseSummaryCSV(text, uploadYear, masterMap);
      // 업로드 월과 매칭
      const monthFiltered = parsed.map(d => ({ ...d, month: uploadMonth, year: uploadYear }));

      if (monthFiltered.length === 0) {
        alert('파싱된 데이터가 없습니다. CSV 형식을 확인해주세요.');
        setUploading(false);
        return;
      }

      await purchaseSummaryService.saveByYearMonth(monthFiltered, uploadYear, uploadMonth);

      // Reload
      const fresh = await purchaseSummaryService.getAll();
      setSummaryData(fresh);
      alert(`✅ ${uploadYear}년 ${uploadMonth} 데이터 ${monthFiltered.length}건 업로드 완료`);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('업로드 실패: ' + (err as Error).message);
    }
    setUploading(false);
    e.target.value = '';
  }, [uploadMonth, uploadYear, masterMap]);

  // --- Master CSV Upload ---
  const handleMasterUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { alert('데이터 없음'); setUploading(false); return; }

      const masters: PurchaseItemMaster[] = lines.slice(1).map(line => {
        const c = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
        return {
          partNo: c[0] || '',
          costType: c[1] || '',
          purchaseType: c[2] || '',
          materialType: c[3] || '',
          process: c[4] || '',
          customer: c[5] || '',
        };
      }).filter(m => m.partNo);

      await purchaseItemMasterService.upsertBatch(masters);

      const fresh = await purchaseItemMasterService.getAll();
      setMasterData(fresh);
      setMasterMap(new Map(fresh.map(m => [m.partNo, m])));
      alert(`✅ 품목기준정보 ${masters.length}건 업로드 완료`);
    } catch (err) {
      alert('업로드 실패: ' + (err as Error).message);
    }
    setUploading(false);
    e.target.value = '';
  }, []);

  // --- Excel Download ---
  const handleDownload = () => {
    const headers = ['구분(월)', '매입처', '도번', '품명', '규격', '단위', '매출수량', '마감수량', '단가', '금액', '사용처', '재료비구분', '구입구분', '재료구분', '공정', '고객사', '비고'];
    const rows = sortedData.map(d => [
      d.month, d.supplier, d.partNo, d.partName, d.spec, d.unit,
      d.salesQty, d.closingQty, d.unitPrice, d.amount,
      d.location, d.costType, d.purchaseType, d.materialType, d.process, d.customer, d.remark
    ]);
    downloadCSV(`매입종합집계_${selectedYear}`, headers, rows);
  };

  // --- Sort Icon ---
  const SortIcon = ({ columnKey }: { columnKey: string }) => (
    <span className="ml-0.5 text-[10px] text-slate-400">
      {sortConfig?.key === columnKey ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full"></div>
        <span className="ml-3 text-slate-500">매입종합집계 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">매입종합집계</h2>
            <p className="text-xs text-slate-500 mt-1">
              MES 입고 실적 기반 월별 매입 현황 ({selectedYear}년)
              {masterData.length > 0 && <span className="ml-2 text-indigo-500">품목기준정보: {masterData.length.toLocaleString()}건</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleDownload} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-colors">
              CSV 다운로드
            </button>
            <button onClick={() => setShowUpload(!showUpload)} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold rounded-xl transition-colors">
              {showUpload ? '업로드 닫기' : '데이터 업로드'}
            </button>
          </div>
        </div>

        {/* Upload Panel */}
        {showUpload && (
          <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 매입실적 업로드 */}
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <h4 className="text-sm font-bold text-slate-700 mb-2">매입실적 CSV 업로드</h4>
                <div className="flex items-center gap-2 mb-2">
                  <select value={uploadYear} onChange={e => setUploadYear(Number(e.target.value))} className="px-3 py-1.5 border rounded-lg text-xs bg-white">
                    {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                  <select value={uploadMonth} onChange={e => setUploadMonth(e.target.value)} className="px-3 py-1.5 border rounded-lg text-xs bg-white">
                    <option value="">월 선택</option>
                    {['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <input type="file" accept=".csv" onChange={handleCSVUpload} disabled={uploading || !uploadMonth}
                  className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 disabled:opacity-50" />
                <p className="text-[10px] text-slate-400 mt-1">컬럼: 구분,매입처,도번,품명,규격,단위,매출수량,마감수량,단가,금액,사용처,재료비구분,구입구분,재료구분,공정,고객사,비고</p>
              </div>
              {/* 품목기준정보 업로드 */}
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <h4 className="text-sm font-bold text-slate-700 mb-2">품목기준정보 CSV 업로드</h4>
                <input type="file" accept=".csv" onChange={handleMasterUpload} disabled={uploading}
                  className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-amber-50 file:text-amber-600 hover:file:bg-amber-100 disabled:opacity-50" />
                <p className="text-[10px] text-slate-400 mt-1">컬럼: 도번,재료비구분,구입구분,재료구분,공정,고객사</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="총 매입금액" value={formatAmount(metrics.totalAmount)} unit="원" />
        <MetricCard label="총 마감수량" value={formatNum(metrics.totalQty)} unit="건" />
        <MetricCard label="매입처" value={metrics.supplierCount.toString()} unit="개사" />
        <MetricCard label="품목수" value={metrics.partCount.toString()} unit="종" />
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="px-3 py-2 border rounded-xl text-xs font-bold bg-white">
            {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="px-3 py-2 border rounded-xl text-xs font-bold bg-white">
            <option value="All">전체 월</option>
            {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} placeholder="매입처 검색..."
            className="px-3 py-2 border rounded-xl text-xs w-40 bg-white" />
          <select value={filterProcess} onChange={e => setFilterProcess(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
            <option value="All">전체 공정</option>
            {availableProcesses.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
            <option value="All">전체 고객사</option>
            {availableCustomers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterCostType} onChange={e => setFilterCostType(e.target.value)} className="px-3 py-2 border rounded-xl text-xs bg-white">
            <option value="All">전체 재료비구분</option>
            {availableCostTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-xs text-slate-400 ml-auto">{filteredData.length.toLocaleString()}건</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly Amount Bar Chart */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-700 mb-3">월별 매입금액 ({selectedYear}년)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => formatAmount(v)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${(v as number).toLocaleString()}원`, '매입금액']} />
              <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Process Pie Chart */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 mb-3">공정별 매입비중</h3>
          {processChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={processChartData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius={80} innerRadius={40} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false} fontSize={10}>
                  {processChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${(v as number).toLocaleString()}원`, '금액']} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate-400 text-xs py-20">데이터 없음</p>}
        </div>
      </div>

      {/* Customer Bar Chart */}
      {customerChartData.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 mb-3">고객사별 매입금액</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={customerChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tickFormatter={(v: number) => formatAmount(v)} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${(v as number).toLocaleString()}원`, '매입금액']} />
              <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Detail Table - Grouped by Supplier */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">매입종합집계 상세</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setCollapsedSuppliers(new Set())} className="text-[10px] px-2 py-1 bg-slate-100 rounded-lg hover:bg-slate-200 text-slate-600">
              전체 펼치기
            </button>
            <button onClick={() => setCollapsedSuppliers(new Set(groupedBySupplier.map(([s]) => s)))} className="text-[10px] px-2 py-1 bg-slate-100 rounded-lg hover:bg-slate-200 text-slate-600">
              전체 접기
            </button>
          </div>
        </div>

        <style>{`
          .scrollbar-visible::-webkit-scrollbar { height: 10px; width: 8px; }
          .scrollbar-visible::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 5px; }
          .scrollbar-visible::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 5px; min-width: 40px; }
          .scrollbar-visible::-webkit-scrollbar-thumb:hover { background: #64748b; }
          .scrollbar-visible { scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9; }
        `}</style>
        {/* Top scrollbar */}
        <div ref={topScrollRef} className="overflow-x-auto scrollbar-visible" style={{ overflowY: 'hidden' }}>
          <div style={{ width: totalTableWidth, height: '1px' }} />
        </div>

        <div ref={tableScrollRef} className="overflow-x-auto scrollbar-visible" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <table className="text-xs" style={{ width: totalTableWidth, tableLayout: 'fixed' }}>
            <colgroup>
              {columnWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="border-b border-slate-200">
                {COLUMNS.map((col, i) => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    className="py-2.5 px-2 text-left font-bold text-slate-600 cursor-pointer hover:bg-slate-100 whitespace-nowrap select-none relative"
                    style={{ width: columnWidths[i] }}>
                    {col.label}<SortIcon columnKey={col.key} />
                    <div
                      onMouseDown={e => onResizeStart(e, i)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400/50 active:bg-indigo-500/50"
                      style={{ zIndex: 20 }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedBySupplier.length === 0 ? (
                <tr><td colSpan={16} className="text-center py-16 text-slate-400">데이터가 없습니다. CSV를 업로드하거나 Supabase에서 데이터를 확인해주세요.</td></tr>
              ) : (
                groupedBySupplier.map(([supplier, items]) => {
                  const isCollapsed = collapsedSuppliers.has(supplier);
                  const subtotal = items.reduce((s, d) => s + d.amount, 0);
                  const subQty = items.reduce((s, d) => s + d.closingQty, 0);

                  return (
                    <React.Fragment key={supplier}>
                      {/* Supplier Group Header */}
                      <tr onClick={() => toggleSupplier(supplier)}
                        className="bg-indigo-50/50 border-y border-indigo-100 cursor-pointer hover:bg-indigo-50 transition-colors">
                        <td colSpan={7} className="py-2 px-2 font-bold text-indigo-700">
                          <span className="mr-1 text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
                          {supplier}
                          <span className="ml-2 text-[10px] font-normal text-slate-500">({items.length}건)</span>
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-indigo-700">{subQty.toLocaleString()}</td>
                        <td className="py-2 px-2"></td>
                        <td className="py-2 px-2 text-right font-bold text-indigo-700">{subtotal.toLocaleString()}</td>
                        <td colSpan={6}></td>
                      </tr>
                      {/* Detail Rows */}
                      {!isCollapsed && items.map((d, idx) => (
                        <tr key={`${d.partNo}-${idx}`} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.month}</td>
                          <td className="py-1.5 px-2 text-slate-700 truncate overflow-hidden">{d.supplier}</td>
                          <td className="py-1.5 px-2 font-mono text-slate-600 truncate overflow-hidden">{d.partNo}</td>
                          <td className="py-1.5 px-2 text-slate-700 truncate overflow-hidden" title={d.partName}>{d.partName}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.spec}</td>
                          <td className="py-1.5 px-2 text-center text-slate-500 truncate overflow-hidden">{d.unit}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 truncate overflow-hidden">{d.salesQty ? d.salesQty.toLocaleString() : ''}</td>
                          <td className="py-1.5 px-2 text-right font-semibold text-slate-700 truncate overflow-hidden">{d.closingQty.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 truncate overflow-hidden">{d.unitPrice.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right font-semibold text-slate-800 truncate overflow-hidden">{d.amount.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.location}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.costType}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.purchaseType}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.materialType}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.process}</td>
                          <td className="py-1.5 px-2 text-slate-500 truncate overflow-hidden">{d.customer}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
            {/* Grand Total Footer */}
            {filteredData.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-bold">
                  <td colSpan={7} className="py-2.5 px-2">합계</td>
                  <td className="py-2.5 px-2 text-right">{metrics.totalQty.toLocaleString()}</td>
                  <td className="py-2.5 px-2"></td>
                  <td className="py-2.5 px-2 text-right">{metrics.totalAmount.toLocaleString()}</td>
                  <td colSpan={6} className="py-2.5 px-2 text-right text-slate-300">
                    {metrics.supplierCount}개사 / {metrics.partCount}종
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default PurchaseSummaryView;
