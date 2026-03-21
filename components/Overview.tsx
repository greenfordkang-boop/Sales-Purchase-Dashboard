
import React, { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList, Cell } from 'recharts';
import MetricCard from './MetricCard';
import { safeSetItem } from '../utils/safeStorage';
import { parseRevenueCSV, RevenueItem } from '../utils/revenueDataParser';
import { parsePartsCSV, parseMaterialCSV, PurchaseItem } from '../utils/purchaseDataParser';
import { INITIAL_REVENUE_CSV } from '../data/initialRevenueData';
import { INITIAL_PARTS_CSV, INITIAL_MATERIAL_CSV } from '../data/initialPurchaseData';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { revenueService, purchaseService } from '../services/supabaseService';

const MONTHS = [
  { value: 'all', label: '전체 (누적)' },
  { value: '01', label: '1월' },
  { value: '02', label: '2월' },
  { value: '03', label: '3월' },
  { value: '04', label: '4월' },
  { value: '05', label: '5월' },
  { value: '06', label: '6월' },
  { value: '07', label: '7월' },
  { value: '08', label: '8월' },
  { value: '09', label: '9월' },
  { value: '10', label: '10월' },
  { value: '11', label: '11월' },
  { value: '12', label: '12월' },
];

const Overview: React.FC = () => {
  const [year, setYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [chartData, setChartData] = useState<any[]>([]);
  const [rawSalesData, setRawSalesData] = useState<any[]>([]);
  const [rawPurchaseData, setRawPurchaseData] = useState<any[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalSales: 0,
    totalPurchase: 0,
    profitMargin: 0,
    purchaseRatio: 0,
    salesYoY: 0,
    purchaseYoY: 0,
    profitYoY: 0
  });

  // --- Load from localStorage ONLY (NO AUTO SUPABASE - prevents data loss) ---
  // Supabase는 영업현황 페이지에서 "클라우드 업로드/다운로드" 버튼으로만 사용

  // 데이터 로드 (최초 1회)
  useEffect(() => {
    const loadData = async () => {
      // 1. Load Sales Data - Supabase 우선, 없으면 localStorage
      let salesItems: any[] = [];
      try {
        if (isSupabaseConfigured()) {
          const supabaseData = await revenueService.getAll();
          if (supabaseData && supabaseData.length > 0) {
            salesItems = supabaseData;
            safeSetItem('dashboard_revenueData', JSON.stringify(supabaseData));
          }
        }
        if (salesItems.length === 0) {
          const storedSales = localStorage.getItem('dashboard_revenueData');
          if (storedSales) {
            salesItems = JSON.parse(storedSales);
          } else {
            salesItems = parseRevenueCSV(INITIAL_REVENUE_CSV, 2024);
          }
        }
      } catch (e) {
        console.error('Failed to load sales:', e);
        const storedSales = localStorage.getItem('dashboard_revenueData');
        salesItems = storedSales ? JSON.parse(storedSales) : parseRevenueCSV(INITIAL_REVENUE_CSV, 2024);
      }

      // 2. Load Purchase Data - Supabase 우선, 없으면 localStorage
      let purchaseItems: any[] = [];
      try {
        if (isSupabaseConfigured()) {
          const supabaseData = await purchaseService.getAll();
          if (supabaseData && supabaseData.length > 0) {
            purchaseItems = supabaseData;
            safeSetItem('dashboard_purchaseData', JSON.stringify(supabaseData));
          }
        }
        if (purchaseItems.length === 0) {
          const storedPurchase = localStorage.getItem('dashboard_purchaseData');
          if (storedPurchase) {
            purchaseItems = JSON.parse(storedPurchase);
          } else {
            const parts = parsePartsCSV(INITIAL_PARTS_CSV);
            const materials = parseMaterialCSV(INITIAL_MATERIAL_CSV);
            purchaseItems = [...parts, ...materials];
          }
        }
      } catch (e) {
        console.error('Failed to load purchase:', e);
        const storedPurchase = localStorage.getItem('dashboard_purchaseData');
        purchaseItems = storedPurchase ? JSON.parse(storedPurchase) : [...parsePartsCSV(INITIAL_PARTS_CSV), ...parseMaterialCSV(INITIAL_MATERIAL_CSV)];
      }

      // Diagnostic logging for data sync verification
      const rev2026 = salesItems.filter((r: any) => r.year === 2026).reduce((s: number, r: any) => s + (r.amount || 0), 0);
      console.log(`📊 Overview loaded: ${salesItems.length} revenue rows, 2026 total: ${(rev2026/100000000).toFixed(1)}억, purchase: ${purchaseItems.length} rows`);

      setRawSalesData(salesItems);
      setRawPurchaseData(purchaseItems);
    };

    loadData();
  }, []);

  // 월별 집계 및 메트릭 계산 (year, selectedMonth 변경 시)
  useEffect(() => {
    if (rawSalesData.length === 0 && rawPurchaseData.length === 0) return;

    // 3. Aggregate by Month for the selected Year
    const monthlyStats = Array.from({ length: 12 }, (_, i) => {
      const monthStr = `${(i + 1).toString().padStart(2, '0')}월`;
      return { month: monthStr, monthKey: (i + 1).toString().padStart(2, '0'), sales: 0, purchase: 0, ratio: 0, profit: 0 };
    });

    // 전년도 데이터 집계 (YoY 계산용)
    const prevYearStats = Array.from({ length: 12 }, (_, i) => {
      return { sales: 0, purchase: 0 };
    });

    // Sum Sales (현재 연도)
    rawSalesData.forEach(item => {
      if (item.year === year) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          monthlyStats[monthIdx].sales += item.amount;
        }
      }
      // 전년도 데이터
      if (item.year === year - 1) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          prevYearStats[monthIdx].sales += item.amount;
        }
      }
    });

    // Sum Purchase (현재 연도)
    rawPurchaseData.forEach(item => {
      if (item.year === year) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          monthlyStats[monthIdx].purchase += item.amount;
        }
      }
      // 전년도 데이터
      if (item.year === year - 1) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          prevYearStats[monthIdx].purchase += item.amount;
        }
      }
    });

    // Calculate Ratios & Profit
    monthlyStats.forEach(stat => {
      stat.profit = stat.sales - stat.purchase;
      stat.ratio = stat.sales > 0 ? parseFloat(((stat.purchase / stat.sales) * 100).toFixed(1)) : 0;
    });

    setChartData(monthlyStats);

    // Update Summary Metrics (선택된 월에 따라)
    let currentSales = 0;
    let currentPurchase = 0;
    let prevSales = 0;
    let prevPurchase = 0;

    if (selectedMonth === 'all') {
      // 전체 누적
      monthlyStats.forEach((stat, idx) => {
        currentSales += stat.sales;
        currentPurchase += stat.purchase;
        prevSales += prevYearStats[idx].sales;
        prevPurchase += prevYearStats[idx].purchase;
      });
    } else {
      // 특정 월
      const monthIdx = parseInt(selectedMonth) - 1;
      currentSales = monthlyStats[monthIdx].sales;
      currentPurchase = monthlyStats[monthIdx].purchase;
      prevSales = prevYearStats[monthIdx].sales;
      prevPurchase = prevYearStats[monthIdx].purchase;
    }

    const currentProfit = currentSales - currentPurchase;
    const prevProfit = prevSales - prevPurchase;
    const margin = currentSales > 0 ? (currentProfit / currentSales) * 100 : 0;
    const pRatio = currentSales > 0 ? (currentPurchase / currentSales) * 100 : 0;

    // YoY 계산
    const salesYoY = prevSales > 0 ? ((currentSales - prevSales) / prevSales) * 100 : 0;
    const purchaseYoY = prevPurchase > 0 ? ((currentPurchase - prevPurchase) / prevPurchase) * 100 : 0;
    const profitYoY = prevProfit > 0 ? ((currentProfit - prevProfit) / prevProfit) * 100 : (currentProfit > 0 ? 100 : 0);

    setSummaryMetrics({
      totalSales: currentSales,
      totalPurchase: currentPurchase,
      profitMargin: parseFloat(margin.toFixed(1)),
      purchaseRatio: parseFloat(pRatio.toFixed(1)),
      salesYoY: parseFloat(salesYoY.toFixed(1)),
      purchaseYoY: parseFloat(purchaseYoY.toFixed(1)),
      profitYoY: parseFloat(profitYoY.toFixed(1))
    });
  }, [year, selectedMonth, rawSalesData, rawPurchaseData]);

  const handleDownload = () => {
    const headers = ['월(Month)', '매출액(Sales)', '매입액(Purchase)', '매입비율(%)', '이익금(Profit)'];
    const rows = chartData.map(item => [
      item.month,
      item.sales,
      item.purchase,
      `${item.ratio}%`,
      item.profit
    ]);
    downloadCSV(`${year}년_영업구매_종합현황`, headers, rows);
  };

  const formatCurrency = (val: number) => {
    if (val >= 100000000) return `₩${(val / 100000000).toFixed(1)}억`;
    return `₩${(val / 1000000).toFixed(0)}백만`;
  };

  // 기간 레이블 생성
  const getPeriodLabel = () => {
    if (selectedMonth === 'all') {
      return `${year}년 누계`;
    }
    return `${year}년 ${parseInt(selectedMonth)}월`;
  };

  // YoY 비교 기간 레이블
  const getYoYLabel = () => {
    if (selectedMonth === 'all') {
      return `전년 대비`;
    }
    return `전년 동월 대비`;
  };

  return (
    <div className="space-y-6">
      {/* Header — clean, minimal */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Overview</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">영업/구매 종합현황</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer hover:border-gray-300 transition-colors"
          >
            {MONTHS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 focus:outline-none focus:border-gray-400 cursor-pointer hover:border-gray-300 transition-colors"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
          </select>
          <button
              onClick={handleDownload}
              className="text-gray-400 hover:text-gray-600 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-[13px] font-medium"
          >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Export
          </button>
        </div>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
            label="총 매출 실적 (Sales)"
            value={formatCurrency(summaryMetrics.totalSales)}
            subValue={getPeriodLabel()}
            trend={summaryMetrics.salesYoY >= 0 ? "up" : "down"}
            percentage={Math.abs(summaryMetrics.salesYoY)}
            color="blue"
        />
        <MetricCard
            label="총 매입 실적 (Purchase)"
            value={formatCurrency(summaryMetrics.totalPurchase)}
            subValue={getPeriodLabel()}
            trend={summaryMetrics.purchaseYoY <= 0 ? "up" : "down"}
            percentage={Math.abs(summaryMetrics.purchaseYoY)}
            color="rose"
        />
        <MetricCard
            label="한계이익 (Marginal Profit)"
            value={formatCurrency(summaryMetrics.totalSales - summaryMetrics.totalPurchase)}
            subValue={`이익률 ${summaryMetrics.profitMargin}%`}
            trend={summaryMetrics.profitYoY >= 0 ? "up" : "down"}
            percentage={Math.abs(summaryMetrics.profitYoY)}
            color={summaryMetrics.profitMargin > 0 ? "emerald" : "rose"}
        />
        <MetricCard
            label="평균 매입율 (Cost Ratio)"
            value={`${summaryMetrics.purchaseRatio}%`}
            subValue="매출 대비 매입 비중"
            percentage={Math.abs(summaryMetrics.purchaseRatio - 70)}
            trend={summaryMetrics.purchaseRatio < 70 ? "up" : "down"}
            color="amber"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6">

        {/* Top Chart: Sales vs Purchase */}
        <div className="bg-white p-8 rounded-2xl border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-[15px] font-semibold text-gray-900">Sales vs Purchase</h3>
              <p className="text-[12px] text-gray-400 mt-0.5">영업 매출 / 구매 매입 월별 추이{selectedMonth !== 'all' ? ` — ${parseInt(selectedMonth)}월` : ''}</p>
            </div>
            <span className="text-[11px] text-gray-400">Unit: KRW</span>
          </div>
          <div className="h-[380px] w-full">
            <ResponsiveContainer minWidth={0} width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f3f4f6" />
                <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 11, fontWeight: 500, fill: '#9ca3af'}}
                />
                <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 11, fill: '#d1d5db'}}
                    tickFormatter={(val) => `${(val/100000000).toFixed(0)}억`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '10px', border: '1px solid #f3f4f6', boxShadow: '0 4px 20px rgb(0 0 0 / 0.08)', fontSize: '13px' }}
                  formatter={(value: number) => `₩${value.toLocaleString()}`}
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ paddingTop: '16px', fontSize: '12px', fontWeight: 500, color: '#6b7280' }} />

                <Bar name="Sales" dataKey="sales" fill="#1a1a2e" radius={[3, 3, 0, 0]} barSize={24}>
                  <LabelList dataKey="sales" position="top" formatter={(v: number) => v > 0 ? `${(v/1e8).toFixed(1)}억` : ''} style={{ fontSize: 10, fontWeight: 600, fill: '#6b7280' }} />
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`sales-${index}`}
                      fill={selectedMonth === 'all' || entry.monthKey === selectedMonth ? '#1a1a2e' : '#e5e7eb'}
                      opacity={selectedMonth === 'all' || entry.monthKey === selectedMonth ? 1 : 0.5}
                    />
                  ))}
                </Bar>
                <Bar name="Purchase" dataKey="purchase" fill="#d1d5db" radius={[3, 3, 0, 0]} barSize={24}>
                  <LabelList dataKey="purchase" position="top" formatter={(v: number) => v > 0 ? `${(v/1e8).toFixed(1)}억` : ''} style={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`purchase-${index}`}
                      fill={selectedMonth === 'all' || entry.monthKey === selectedMonth ? '#d1d5db' : '#f3f4f6'}
                      opacity={selectedMonth === 'all' || entry.monthKey === selectedMonth ? 1 : 0.5}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Chart: Purchase Material Ratio */}
        <div className="bg-white p-8 rounded-2xl border border-gray-100">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900">Cost Ratio</h3>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  월별 매입재료비율
                  {selectedMonth !== 'all' ? ` — ${parseInt(selectedMonth)}월: ${chartData[parseInt(selectedMonth) - 1]?.ratio || 0}%` : ''}
                </p>
              </div>
            </div>
            <div className="h-[280px] w-full">
                <ResponsiveContainer minWidth={0} width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 30, right: 20, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 500, fill: '#9ca3af'}} />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{fontSize: 11, fill: '#d1d5db'}}
                            unit="%"
                            domain={[0, 100]}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '10px', border: '1px solid #f3f4f6', boxShadow: '0 4px 20px rgb(0 0 0 / 0.08)', fontSize: '13px' }}
                            formatter={(value: number) => `${value}%`}
                        />
                        <Line
                            type="monotone"
                            dataKey="ratio"
                            name="Cost Ratio"
                            stroke="#1a1a2e"
                            strokeWidth={2}
                            dot={(props: any) => {
                              const { cx, cy, payload } = props;
                              const isSelected = selectedMonth !== 'all' && payload.monthKey === selectedMonth;
                              return (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={isSelected ? 6 : 3}
                                  fill={isSelected ? '#1a1a2e' : '#1a1a2e'}
                                  stroke="#fff"
                                  strokeWidth={isSelected ? 3 : 2}
                                />
                              );
                            }}
                            activeDot={{r: 5, fill: '#1a1a2e', stroke: '#fff', strokeWidth: 2}}
                        >
                            <LabelList
                                dataKey="ratio"
                                position="top"
                                offset={10}
                                formatter={(value: number) => `${value.toFixed(1)}%`}
                                style={{ fill: '#6b7280', fontSize: '10px', fontWeight: 600 }}
                            />
                        </Line>
                        {selectedMonth !== 'all' && (
                          <Bar dataKey="ratio" barSize={40} opacity={0.08} radius={[3, 3, 0, 0]}>
                            {chartData.map((entry, index) => (
                              <Cell
                                key={`highlight-${index}`}
                                fill={entry.monthKey === selectedMonth ? '#1a1a2e' : 'transparent'}
                              />
                            ))}
                          </Bar>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
