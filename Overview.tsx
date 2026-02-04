
import React, { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList, Cell } from 'recharts';
import MetricCard from './MetricCard';
import { parseRevenueCSV, RevenueItem } from '../utils/revenueDataParser';
import { parsePartsCSV, parseMaterialCSV, PurchaseItem } from '../utils/purchaseDataParser';
import { INITIAL_REVENUE_CSV } from '../data/initialRevenueData';
import { INITIAL_PARTS_CSV, INITIAL_MATERIAL_CSV } from '../data/initialPurchaseData';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { revenueService } from '../services/supabaseService';

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
            localStorage.setItem('dashboard_revenueData', JSON.stringify(supabaseData));
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

      // 2. Load Purchase Data from localStorage
      let purchaseItems: any[] = [];
      try {
        const storedPurchase = localStorage.getItem('dashboard_purchaseData');
        if (storedPurchase) {
          purchaseItems = JSON.parse(storedPurchase);
        } else {
          const parts = parsePartsCSV(INITIAL_PARTS_CSV);
          const materials = parseMaterialCSV(INITIAL_MATERIAL_CSV);
          purchaseItems = [...parts, ...materials];
        }
      } catch (e) {
        console.error('Failed to load purchase:', e);
        const parts = parsePartsCSV(INITIAL_PARTS_CSV);
        const materials = parseMaterialCSV(INITIAL_MATERIAL_CSV);
        purchaseItems = [...parts, ...materials];
      }

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
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Summary */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-left">
          <h2 className="text-3xl font-black text-slate-800">영업/구매실 대시보드</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* 월 선택 드롭다운 */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:bg-slate-100 transition-colors"
          >
            {MONTHS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {/* 연도 선택 드롭다운 */}
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:bg-slate-100 transition-colors"
          >
            <option value={2024}>2024년</option>
            <option value={2025}>2025년</option>
            <option value={2026}>2026년</option>
          </select>
          <button
              onClick={handleDownload}
              className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
          >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              데이터 엑셀 다운로드
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

        {/* Top Chart: Sales vs Purchase Only */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-slate-800 flex items-center gap-2">
              <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
              영업(Sales) vs 구매(Purchase) 금액 추이 (년간)
              {selectedMonth !== 'all' && (
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                  {parseInt(selectedMonth)}월 선택됨
                </span>
              )}
            </h3>
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">단위: 원</span>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 12, fontWeight: 700, fill: '#64748b'}}
                />
                <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 11, fill: '#94a3b8'}}
                    tickFormatter={(val) => `${(val/100000000).toFixed(0)}억`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => `₩${value.toLocaleString()}`}
                  cursor={{ fill: '#f8fafc' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />

                <Bar name="영업 매출액" dataKey="sales" radius={[4, 4, 0, 0]} barSize={30}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`sales-${index}`}
                      fill={selectedMonth === 'all' || entry.monthKey === selectedMonth ? '#3b82f6' : '#e2e8f0'}
                      opacity={selectedMonth === 'all' || entry.monthKey === selectedMonth ? 1 : 0.4}
                    />
                  ))}
                </Bar>
                <Bar name="구매 매입액" dataKey="purchase" radius={[4, 4, 0, 0]} barSize={30}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`purchase-${index}`}
                      fill={selectedMonth === 'all' || entry.monthKey === selectedMonth ? '#f43f5e' : '#e2e8f0'}
                      opacity={selectedMonth === 'all' || entry.monthKey === selectedMonth ? 1 : 0.4}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Chart: Purchase Material Ratio (Line Chart) */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
              <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
              월별 매입재료비율 (Purchase Material Ratio)
              {selectedMonth !== 'all' && (
                <span className="ml-2 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                  {parseInt(selectedMonth)}월: {chartData[parseInt(selectedMonth) - 1]?.ratio || 0}%
                </span>
              )}
            </h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 30, right: 30, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 700, fill: '#64748b'}} />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{fontSize: 11, fill: '#94a3b8'}}
                            unit="%"
                            domain={[0, 100]}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: number) => `${value}%`}
                        />
                        <Line
                            type="monotone"
                            dataKey="ratio"
                            name="매입비율"
                            stroke="#f59e0b"
                            strokeWidth={3}
                            dot={(props: any) => {
                              const { cx, cy, payload } = props;
                              const isSelected = selectedMonth !== 'all' && payload.monthKey === selectedMonth;
                              return (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={isSelected ? 10 : 5}
                                  fill={isSelected ? '#f59e0b' : '#f59e0b'}
                                  stroke={isSelected ? '#fff' : '#fff'}
                                  strokeWidth={isSelected ? 4 : 2}
                                  style={{ filter: isSelected ? 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))' : 'none' }}
                                />
                              );
                            }}
                            activeDot={{r: 7}}
                        >
                            <LabelList
                                dataKey="ratio"
                                position="top"
                                offset={10}
                                formatter={(value: number) => `${value.toFixed(1)}%`}
                                style={{ fill: '#d97706', fontSize: '11px', fontWeight: 'bold' }}
                            />
                        </Line>
                        {/* 선택된 월 강조 바 */}
                        {selectedMonth !== 'all' && (
                          <Bar dataKey="ratio" barSize={40} opacity={0.15} radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, index) => (
                              <Cell
                                key={`highlight-${index}`}
                                fill={entry.monthKey === selectedMonth ? '#f59e0b' : 'transparent'}
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
