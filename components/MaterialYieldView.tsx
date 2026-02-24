
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { BomRecord, YieldRow, parseBomCSV, parseBomExcel, buildBomRelations, expandBomToLeaves } from '../utils/bomDataParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { bomService } from '../services/supabaseService';

const STATUS_COLORS: Record<YieldRow['status'], string> = {
  normal: '#10b981',
  over: '#ef4444',
  under: '#f59e0b',
  noData: '#94a3b8',
};

const STATUS_LABELS: Record<YieldRow['status'], string> = {
  normal: '정상',
  over: '과투입',
  under: '미달',
  noData: '데이터없음',
};

const MaterialYieldView: React.FC = () => {
  // --- State ---
  const [bomData, setBomData] = useState<BomRecord[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>('All');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterPn, setFilterPn] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [tableOpen, setTableOpen] = useState(true);

  // --- Load BOM from localStorage ---
  useEffect(() => {
    const stored = localStorage.getItem('dashboard_bomData');
    if (stored) {
      try { setBomData(JSON.parse(stored)); } catch { /* ignore */ }
    }
  }, []);

  // --- Smart Supabase Load ---
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;
      try {
        const data = await bomService.getAll();
        if (data && data.length > 0) {
          setBomData(data);
          localStorage.setItem('dashboard_bomData', JSON.stringify(data));
        }
      } catch (err) {
        console.error('BOM Supabase 로드 실패:', err);
      }
    };
    loadFromSupabase();
  }, []);

  // --- Load Sales & Purchase from localStorage ---
  const itemRevenueData = useMemo<ItemRevenueRow[]>(() => {
    try {
      const stored = localStorage.getItem('dashboard_itemRevenueData');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }, []);

  const purchaseData = useMemo<PurchaseItem[]>(() => {
    try {
      const stored = localStorage.getItem('dashboard_purchaseData');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }, []);

  // --- Available Years ---
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    purchaseData.forEach(d => years.add(d.year));
    itemRevenueData.forEach(d => {
      const m = d.period?.match(/(\d{4})/);
      if (m) years.add(parseInt(m[1]));
    });
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort();
  }, [purchaseData, itemRevenueData]);

  // --- period에서 월 추출 ---
  const extractMonth = (period: string): string | null => {
    if (!period) return null;
    // "2025-01" or "01" or "1월" or "01월"
    const dashMatch = period.match(/\d{4}-(\d{1,2})/);
    if (dashMatch) return dashMatch[1].padStart(2, '0') + '월';
    const monthMatch = period.match(/^(\d{1,2})$/);
    if (monthMatch) return monthMatch[1].padStart(2, '0') + '월';
    const kwolMatch = period.match(/(\d{1,2})월/);
    if (kwolMatch) return kwolMatch[1].padStart(2, '0') + '월';
    return null;
  };

  // --- 품번 정규화 (공백, 하이픈, 대소문자 통일) ---
  const normalizePn = (pn: string): string =>
    pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

  // --- 수율 계산 (핵심 로직) ---
  const { yieldRows, bomMissingCount } = useMemo(() => {
    if (bomData.length === 0) return { yieldRows: [] as YieldRow[], bomMissingCount: 0 };

    // BOM relations를 정규화된 키로 빌드
    const rawRelations = buildBomRelations(bomData);
    const bomRelations = new Map<string, typeof bomData>();
    for (const [key, val] of rawRelations) {
      bomRelations.set(normalizePn(key), val);
    }

    // 1) 매출 데이터를 partNo별로 집계 (연도/월 필터 적용)
    const salesByPart = new Map<string, number>();
    itemRevenueData.forEach(row => {
      // 연도 필터
      const yearMatch = row.period?.match(/(\d{4})/);
      if (yearMatch && parseInt(yearMatch[1]) !== selectedYear) return;

      // 월 필터
      if (selectedMonth !== 'All') {
        const month = extractMonth(row.period);
        if (month && month !== selectedMonth) return;
      }

      const pn = normalizePn(row.partNo || '');
      if (!pn) return;
      salesByPart.set(pn, (salesByPart.get(pn) || 0) + (row.qty || 0));
    });

    // 2) BOM 전개 → 자재별 표준소요량
    interface ChildAccum {
      childName: string;
      supplier: string;
      totalRequired: number;
      parentProducts: Set<string>;
    }
    const childMap = new Map<string, ChildAccum>();
    let missingCount = 0;

    for (const [partNo, salesQty] of salesByPart) {
      if (!bomRelations.has(partNo)) {
        missingCount++;
        continue;
      }
      const leaves = expandBomToLeaves(partNo, salesQty, bomRelations);
      for (const leaf of leaves) {
        const normalizedChild = normalizePn(leaf.childPn);
        const existing = childMap.get(normalizedChild);
        if (existing) {
          existing.totalRequired += leaf.totalRequired;
          existing.parentProducts.add(partNo);
        } else {
          childMap.set(normalizedChild, {
            childName: leaf.childName,
            supplier: leaf.supplier,
            totalRequired: leaf.totalRequired,
            parentProducts: new Set([partNo]),
          });
        }
      }
    }

    // 3) 구매입고를 itemCode별로 집계 (연도/월 필터 적용, 정규화)
    const inputByCode = new Map<string, number>();
    purchaseData.forEach(item => {
      if (item.year !== selectedYear) return;
      if (selectedMonth !== 'All' && item.month !== selectedMonth) return;
      const code = normalizePn(item.itemCode || '');
      if (!code) return;
      inputByCode.set(code, (inputByCode.get(code) || 0) + (item.qty || 0));
    });

    // 4) 매칭하여 수율 산출 (정규화된 키로 매칭)
    const rows: YieldRow[] = [];
    for (const [childPn, accum] of childMap) {
      const inputQty = inputByCode.get(normalizePn(childPn)) || 0;
      const standardReq = accum.totalRequired;
      let yieldRate = 0;
      let status: YieldRow['status'] = 'noData';

      if (standardReq > 0 && inputQty > 0) {
        yieldRate = (inputQty / standardReq) * 100;
        if (yieldRate >= 95 && yieldRate <= 105) status = 'normal';
        else if (yieldRate > 105) status = 'over';
        else status = 'under';
      } else if (inputQty === 0) {
        status = 'noData';
      }

      rows.push({
        childPn,
        childName: accum.childName,
        supplier: accum.supplier,
        parentProducts: Array.from(accum.parentProducts),
        standardReq: Math.round(standardReq * 100) / 100,
        inputQty,
        yieldRate: Math.round(yieldRate * 10) / 10,
        diff: Math.round((inputQty - standardReq) * 100) / 100,
        status,
      });
    }

    return { yieldRows: rows, bomMissingCount: missingCount };
  }, [bomData, itemRevenueData, purchaseData, selectedYear, selectedMonth]);

  // --- Filtered & Sorted rows ---
  const displayRows = useMemo(() => {
    let result = yieldRows.filter(row => {
      if (filterPn && !row.childPn.toLowerCase().includes(filterPn.toLowerCase())) return false;
      if (filterName && !row.childName.toLowerCase().includes(filterName.toLowerCase())) return false;
      if (filterSupplier && !row.supplier.toLowerCase().includes(filterSupplier.toLowerCase())) return false;
      if (filterStatus !== 'All' && row.status !== filterStatus) return false;
      return true;
    });

    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal || '').toLowerCase();
        const bStr = String(bVal || '').toLowerCase();
        if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [yieldRows, filterPn, filterName, filterSupplier, filterStatus, sortConfig]);

  // --- Summary Metrics ---
  const metrics = useMemo(() => {
    const total = yieldRows.length;
    const avgYield = total > 0
      ? yieldRows.filter(r => r.status !== 'noData').reduce((s, r) => s + r.yieldRate, 0) /
        (yieldRows.filter(r => r.status !== 'noData').length || 1)
      : 0;
    const overCount = yieldRows.filter(r => r.status === 'over').length;
    const noDataCount = yieldRows.filter(r => r.status === 'noData').length;
    return { total, avgYield, overCount, noDataCount };
  }, [yieldRows]);

  // --- Chart Data ---
  const deviationChartData = useMemo(() => {
    return [...yieldRows]
      .filter(r => r.status !== 'noData')
      .sort((a, b) => Math.abs(b.yieldRate - 100) - Math.abs(a.yieldRate - 100))
      .slice(0, 15)
      .map(r => ({
        name: r.childPn.length > 12 ? r.childPn.slice(0, 12) + '...' : r.childPn,
        deviation: Math.round((r.yieldRate - 100) * 10) / 10,
        fill: r.status === 'over' ? '#ef4444' : r.status === 'under' ? '#f59e0b' : '#10b981',
      }));
  }, [yieldRows]);

  const statusPieData = useMemo(() => {
    const counts: Record<string, number> = { normal: 0, over: 0, under: 0, noData: 0 };
    yieldRows.forEach(r => counts[r.status]++);
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({
        name: STATUS_LABELS[k as YieldRow['status']],
        value: v,
        color: STATUS_COLORS[k as YieldRow['status']],
      }));
  }, [yieldRows]);

  // --- Handlers ---
  const handleBomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      // CSV: 인코딩 자동 감지
      const readAsEncoding = (encoding: string): Promise<string> =>
        new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = ev => resolve((ev.target?.result as string) || '');
          reader.readAsText(file, encoding);
        });

      let text = await readAsEncoding('utf-8');
      const broken = (text.match(/�|Ã.|Â./g) || []).length / text.length;
      if (broken > 0.01) text = await readAsEncoding('euc-kr');

      const records = parseBomCSV(text);
      if (records.length === 0) {
        alert('BOM CSV 파싱 실패: 필수 컬럼(모품번, 자품번)을 확인해주세요.');
        e.target.value = '';
        return;
      }
      saveBomData(records);
    } else {
      // Excel
      const buffer = await file.arrayBuffer();
      const records = parseBomExcel(buffer);
      if (records.length === 0) {
        alert('BOM 엑셀 파싱 실패: 필수 컬럼(모품번, 자품번)을 확인해주세요.');
        e.target.value = '';
        return;
      }
      saveBomData(records);
    }

    e.target.value = '';
  };

  const saveBomData = async (records: BomRecord[]) => {
    setBomData(records);
    localStorage.setItem('dashboard_bomData', JSON.stringify(records));

    if (isSupabaseConfigured()) {
      try {
        await bomService.saveAll(records);
        console.log(`BOM Supabase 동기화 완료: ${records.length}건`);
      } catch (err) {
        console.error('BOM Supabase 동기화 실패:', err);
      }
    }

    alert(`BOM 데이터 ${records.length}건이 업로드되었습니다.`);
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const handleDownload = () => {
    const headers = ['자재품번', '자재품명', '협력업체', '관련제품', '표준소요량', '투입수량', '수율(%)', '차이', '상태'];
    const rows = displayRows.map(r => [
      r.childPn,
      r.childName,
      r.supplier,
      r.parentProducts.join('; '),
      r.standardReq,
      r.inputQty,
      r.yieldRate,
      r.diff,
      STATUS_LABELS[r.status],
    ]);
    downloadCSV(`자재수율_${selectedYear}_${selectedMonth}`, headers, rows);
  };

  // --- SortableHeader ---
  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: string }) => (
    <th
      className={`px-4 py-3 min-w-[80px] ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group`}
      onClick={() => handleSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {label}
        <span className={`text-[10px] ${sortConfig?.key === sortKey ? 'text-blue-600 font-bold' : 'text-slate-300 group-hover:text-slate-400'}`}>
          {sortConfig?.key === sortKey ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </div>
    </th>
  );

  // --- Status Badge ---
  const StatusBadge = ({ status }: { status: YieldRow['status'] }) => {
    const styles: Record<YieldRow['status'], string> = {
      normal: 'bg-emerald-100 text-emerald-700',
      over: 'bg-red-100 text-red-700',
      under: 'bg-amber-100 text-amber-700',
      noData: 'bg-slate-100 text-slate-500',
    };
    return (
      <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${styles[status]}`}>
        {STATUS_LABELS[status]}
      </span>
    );
  };

  // --- BOM 미업로드 상태 ---
  if (bomData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-2">자재수율 (Material Yield)</h2>
          <p className="text-sm text-slate-500 mb-6">BOM 데이터를 업로드하면 매출 대비 자재 투입 수율을 분석합니다.</p>

          <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-slate-600 font-bold mb-2">BOM 데이터를 업로드해주세요</p>
            <p className="text-xs text-slate-400 mb-6">엑셀(.xlsx, .xls) 또는 CSV 파일을 지원합니다.<br/>필수 컬럼: 모품번, 자품번 (소요량, 자품명, 협력업체 등 선택)</p>
            <label className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold cursor-pointer transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              BOM 파일 업로드
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleBomFileUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // --- 메인 렌더링 ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800">자재수율 (Material Yield)</h2>
          <p className="text-xs text-slate-500 mt-1">
            BOM {bomData.length}건 등록
            {bomMissingCount > 0 && <span className="text-amber-500 ml-2">{bomMissingCount}개 제품 BOM 미등록</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 연도/월 필터 */}
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-200">
            <span className="text-xs font-bold text-slate-500">조회:</span>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 min-w-[100px]"
            >
              <option value="All">전체 (누적)</option>
              {Array.from({ length: 12 }, (_, i) => {
                const m = `${(i + 1).toString().padStart(2, '0')}월`;
                return <option key={m} value={m}>{m}</option>;
              })}
            </select>
            <div className="flex gap-2">
              {availableYears.map(year => (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    selectedYear === year ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          {/* BOM 재업로드 */}
          <label className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            BOM 재업로드
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleBomFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="분석 자재 수" value={`${metrics.total}개`} subValue="BOM 기준 leaf 자재" color="blue" />
        <MetricCard
          label="평균 수율"
          value={`${metrics.avgYield.toFixed(1)}%`}
          subValue="데이터 있는 자재 기준"
          color={metrics.avgYield >= 95 && metrics.avgYield <= 105 ? 'emerald' : 'amber'}
        />
        <MetricCard label="과투입 자재" value={`${metrics.overCount}개`} subValue=">105% 투입" color="rose" />
        <MetricCard label="미투입 자재" value={`${metrics.noDataCount}개`} subValue="투입수량 0 또는 미매칭" color="slate" />
      </div>

      {/* Charts */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 수율 편차 Bar Chart */}
        <div className="flex-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
            <span className="w-1 h-5 bg-indigo-600 rounded-full"></span>
            수율 편차 Top 15 (100% 기준)
          </h3>
          {deviationChartData.length > 0 ? (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deviationChartData} layout="vertical" margin={{ top: 10, right: 30, bottom: 10, left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value > 0 ? '+' : ''}${value}%`, '편차']}
                  />
                  <Bar dataKey="deviation" radius={[0, 4, 4, 0]} barSize={16}>
                    {deviationChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[320px] flex items-center justify-center text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
        </div>

        {/* 상태 분포 Pie Chart */}
        <div className="w-full lg:w-1/3 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
            <span className="w-1 h-5 bg-slate-500 rounded-full"></span>
            상태 분포
          </h3>
          {statusPieData.length > 0 ? (
            <div className="flex-1 min-h-[300px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {statusPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`${value}개`, '자재 수']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTableOpen(!tableOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${tableOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              자재수율 상세 ({displayRows.length}건)
            </button>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="All">전체 상태</option>
              <option value="normal">정상 (95~105%)</option>
              <option value="over">과투입 (&gt;105%)</option>
              <option value="under">미달 (&lt;95%)</option>
              <option value="noData">데이터없음</option>
            </select>
          </div>
          <button
            onClick={handleDownload}
            className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            엑셀 다운로드
          </button>
        </div>

        {tableOpen && (
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <SortableHeader label="자재품번" sortKey="childPn" />
                  <SortableHeader label="자재품명" sortKey="childName" />
                  <SortableHeader label="협력업체" sortKey="supplier" />
                  <th className="px-4 py-3 min-w-[120px]">관련제품</th>
                  <SortableHeader label="표준소요량" sortKey="standardReq" align="right" />
                  <SortableHeader label="투입수량" sortKey="inputQty" align="right" />
                  <SortableHeader label="수율(%)" sortKey="yieldRate" align="right" />
                  <SortableHeader label="차이" sortKey="diff" align="right" />
                  <SortableHeader label="상태" sortKey="status" align="center" />
                </tr>
                <tr className="bg-slate-50">
                  <th className="px-2 py-2">
                    <input type="text" placeholder="품번" className="w-full p-1 border rounded text-xs font-normal" value={filterPn} onChange={e => setFilterPn(e.target.value)} />
                  </th>
                  <th className="px-2 py-2">
                    <input type="text" placeholder="품명" className="w-full p-1 border rounded text-xs font-normal" value={filterName} onChange={e => setFilterName(e.target.value)} />
                  </th>
                  <th className="px-2 py-2">
                    <input type="text" placeholder="업체" className="w-full p-1 border rounded text-xs font-normal" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} />
                  </th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.childPn}</td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[180px]" title={row.childName}>{row.childName}</td>
                    <td className="px-4 py-3 text-slate-600">{row.supplier}</td>
                    <td className="px-4 py-3 text-slate-500 text-[10px] truncate max-w-[120px]" title={row.parentProducts.join(', ')}>
                      {row.parentProducts.slice(0, 3).join(', ')}
                      {row.parentProducts.length > 3 && ` +${row.parentProducts.length - 3}`}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{row.standardReq.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.inputQty.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${
                      row.status === 'normal' ? 'text-emerald-600' :
                      row.status === 'over' ? 'text-red-600' :
                      row.status === 'under' ? 'text-amber-600' : 'text-slate-400'
                    }`}>
                      {row.status === 'noData' ? '-' : `${row.yieldRate}%`}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${row.diff > 0 ? 'text-red-500' : row.diff < 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                      {row.status === 'noData' ? '-' : row.diff > 0 ? `+${row.diff.toLocaleString()}` : row.diff.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      {yieldRows.length === 0 ? '매출 데이터와 BOM을 매칭할 수 없습니다.' : '필터 조건에 맞는 데이터가 없습니다.'}
                    </td>
                  </tr>
                )}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-center">합계 ({displayRows.length}건)</td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.standardReq, 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.inputQty, 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-indigo-700">
                      {(() => {
                        const totalStd = displayRows.reduce((s, r) => s + r.standardReq, 0);
                        const totalInput = displayRows.reduce((s, r) => s + r.inputQty, 0);
                        return totalStd > 0 ? `${((totalInput / totalStd) * 100).toFixed(1)}%` : '-';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{displayRows.reduce((s, r) => s + r.diff, 0).toLocaleString()}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MaterialYieldView;
