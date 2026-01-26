
import React, { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts';
import MetricCard from './MetricCard';
import { parseRevenueCSV, RevenueItem } from '../utils/revenueDataParser';
import { parsePartsCSV, parseMaterialCSV, PurchaseItem } from '../utils/purchaseDataParser';
import { INITIAL_REVENUE_CSV } from '../data/initialRevenueData';
import { INITIAL_PARTS_CSV, INITIAL_MATERIAL_CSV } from '../data/initialPurchaseData';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { revenueService, purchaseService } from '../services/supabaseService';

const Overview: React.FC = () => {
  const [year, setYear] = useState<number>(2026);
  const [chartData, setChartData] = useState<any[]>([]);
  const [summaryMetrics, setSummaryMetrics] = useState({
    totalSales: 0,
    totalPurchase: 0,
    profitMargin: 0,
    purchaseRatio: 0
  });

  // --- Load from Supabase on Mount ---
  const [revenueData, setRevenueData] = useState<RevenueItem[]>([]);
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    const loadFromSupabase = async () => {
      try {
        if (isSupabaseConfigured()) {
          console.log('Overview: Loading data from Supabase...');
          const [revenue, purchase] = await Promise.all([
            revenueService.getAll(),
            purchaseService.getAll()
          ]);
          
          if (revenue && revenue.length > 0) {
            setRevenueData(revenue);
            localStorage.setItem('dashboard_revenueData', JSON.stringify(revenue));
            console.log('Overview: Revenue data loaded from Supabase:', revenue.length, 'items');
          } else {
            // Supabase에 데이터가 없으면 localStorage 확인
            const stored = localStorage.getItem('dashboard_revenueData');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed && parsed.length > 0) {
                setRevenueData(parsed);
                console.log('Overview: Revenue data loaded from localStorage:', parsed.length, 'items');
              } else {
                setRevenueData([]);
              }
            } else {
              setRevenueData([]);
            }
          }

          if (purchase && purchase.length > 0) {
            setPurchaseData(purchase);
            localStorage.setItem('dashboard_purchaseData', JSON.stringify(purchase));
            console.log('Overview: Purchase data loaded from Supabase:', purchase.length, 'items');
          } else {
            // Supabase에 데이터가 없으면 localStorage 확인
            const stored = localStorage.getItem('dashboard_purchaseData');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed && parsed.length > 0) {
                setPurchaseData(parsed);
                console.log('Overview: Purchase data loaded from localStorage:', parsed.length, 'items');
              } else {
                setPurchaseData([]);
              }
            } else {
              setPurchaseData([]);
            }
          }
        } else {
          // Supabase가 설정되지 않았으면 localStorage에서 로드
          console.log('Overview: Supabase not configured, loading from localStorage');
          const storedRevenue = localStorage.getItem('dashboard_revenueData');
          const storedPurchase = localStorage.getItem('dashboard_purchaseData');
          
          if (storedRevenue) {
            const parsed = JSON.parse(storedRevenue);
            if (parsed && parsed.length > 0) {
              setRevenueData(parsed);
            } else {
              setRevenueData([]);
            }
          } else {
            setRevenueData([]);
          }

          if (storedPurchase) {
            const parsed = JSON.parse(storedPurchase);
            if (parsed && parsed.length > 0) {
              setPurchaseData(parsed);
            } else {
              setPurchaseData([]);
            }
          } else {
            setPurchaseData([]);
          }
        }
      } catch (err) {
        console.error('Overview: Failed to load data:', err);
        // 에러 발생 시 localStorage에서 로드
        const storedRevenue = localStorage.getItem('dashboard_revenueData');
        const storedPurchase = localStorage.getItem('dashboard_purchaseData');
        
        if (storedRevenue) {
          try {
            const parsed = JSON.parse(storedRevenue);
            if (parsed && parsed.length > 0) {
              setRevenueData(parsed);
            }
          } catch (e) {
            console.error('Failed to parse revenue data:', e);
          }
        }
        
        if (storedPurchase) {
          try {
            const parsed = JSON.parse(storedPurchase);
            if (parsed && parsed.length > 0) {
              setPurchaseData(parsed);
            }
          } catch (e) {
            console.error('Failed to parse purchase data:', e);
          }
        }
      } finally {
        setIsDataLoaded(true);
      }
    };

    loadFromSupabase();

    // 데이터 업데이트 감지 (다른 탭 또는 같은 탭에서 업데이트된 경우)
    const handleDataUpdate = async () => {
      if (isSupabaseConfigured()) {
        try {
          const [revenue, purchase] = await Promise.all([
            revenueService.getAll(),
            purchaseService.getAll()
          ]);
          
          if (revenue && revenue.length > 0) {
            setRevenueData(revenue);
            localStorage.setItem('dashboard_revenueData', JSON.stringify(revenue));
            console.log('Overview: Revenue data refreshed from Supabase');
          }
          
          if (purchase && purchase.length > 0) {
            setPurchaseData(purchase);
            localStorage.setItem('dashboard_purchaseData', JSON.stringify(purchase));
            console.log('Overview: Purchase data refreshed from Supabase');
          }
        } catch (err) {
          console.error('Overview: Failed to refresh data:', err);
        }
      } else {
        // Supabase가 없으면 localStorage에서 다시 로드
        const storedRevenue = localStorage.getItem('dashboard_revenueData');
        const storedPurchase = localStorage.getItem('dashboard_purchaseData');
        
        if (storedRevenue) {
          try {
            const parsed = JSON.parse(storedRevenue);
            if (parsed && parsed.length > 0) {
              setRevenueData(parsed);
            }
          } catch (e) {
            console.error('Failed to parse revenue data:', e);
          }
        }
        
        if (storedPurchase) {
          try {
            const parsed = JSON.parse(storedPurchase);
            if (parsed && parsed.length > 0) {
              setPurchaseData(parsed);
            }
          } catch (e) {
            console.error('Failed to parse purchase data:', e);
          }
        }
      }
    };

    // 다른 탭에서 업데이트된 경우 감지
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dashboard_revenueData' || e.key === 'dashboard_purchaseData') {
        handleDataUpdate();
      }
    };

    // 같은 탭에서 업데이트된 경우 감지 (커스텀 이벤트)
    const handleCustomStorageEvent = () => {
      handleDataUpdate();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('revenueDataUpdated', handleCustomStorageEvent);
    window.addEventListener('purchaseDataUpdated', handleCustomStorageEvent);
    
    // 주기적으로 Supabase에서 데이터 확인 (30초마다)
    const intervalId = setInterval(() => {
      if (isSupabaseConfigured()) {
        handleDataUpdate();
      }
    }, 30000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('revenueDataUpdated', handleCustomStorageEvent);
      window.removeEventListener('purchaseDataUpdated', handleCustomStorageEvent);
      clearInterval(intervalId);
    };
  }, []);

  // --- Data Loading & Aggregation ---
  useEffect(() => {
    if (!isDataLoaded) return; // 데이터 로드 완료 전에는 실행하지 않음

    // 1. Use loaded revenue data
    const salesItems = revenueData || [];

    // 2. Use loaded purchase data
    const purchaseItems = purchaseData || [];

    // 3. Aggregate by Month for the selected Year
    const monthlyStats = Array.from({ length: 12 }, (_, i) => {
      const monthStr = `${(i + 1).toString().padStart(2, '0')}월`;
      return { month: monthStr, sales: 0, purchase: 0, ratio: 0, profit: 0 };
    });

    let yearTotalSales = 0;
    let yearTotalPurchase = 0;

    // Sum Sales
    salesItems.forEach(item => {
      if (item.year === year) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          monthlyStats[monthIdx].sales += item.amount;
          yearTotalSales += item.amount;
        }
      }
    });

    // Sum Purchase
    purchaseItems.forEach(item => {
      if (item.year === year) {
        const monthIdx = parseInt(item.month.replace('월', '')) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          monthlyStats[monthIdx].purchase += item.amount;
          yearTotalPurchase += item.amount;
        }
      }
    });

    // Calculate Ratios & Profit
    monthlyStats.forEach(stat => {
      stat.profit = stat.sales - stat.purchase;
      // Purchase Ratio = (Purchase / Sales) * 100
      stat.ratio = stat.sales > 0 ? parseFloat(((stat.purchase / stat.sales) * 100).toFixed(1)) : 0;
    });

    setChartData(monthlyStats);

    // Update Summary Metrics
    const profit = yearTotalSales - yearTotalPurchase;
    const margin = yearTotalSales > 0 ? (profit / yearTotalSales) * 100 : 0;
    const pRatio = yearTotalSales > 0 ? (yearTotalPurchase / yearTotalSales) * 100 : 0;

    setSummaryMetrics({
      totalSales: yearTotalSales,
      totalPurchase: yearTotalPurchase,
      profitMargin: parseFloat(margin.toFixed(1)),
      purchaseRatio: parseFloat(pRatio.toFixed(1))
    });

  }, [year, revenueData, purchaseData, isDataLoaded]);

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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Summary */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-left">
          <h2 className="text-3xl font-black text-slate-800 mb-2">영업/구매실 대시보드</h2>
          <p className="text-slate-500 max-w-2xl leading-relaxed">
            실시간 데이터 연동을 통해 영업 수주액과 자재 매입액을 통합 분석합니다.<br/>
            <span className="text-xs text-blue-500 font-bold">* 데이터 출처: 영업현황 및 구매현황 업로드 자료</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl">
                <span className="text-xs font-bold text-slate-500 pl-2">분석 년도:</span>
                {[2023, 2024, 2025, 2026].map(y => (
                    <button
                        key={y}
                        onClick={() => setYear(y)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${year === y ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-200'}`}
                    >
                        {y}
                    </button>
                ))}
            </div>
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
            subValue={`${year}년 누계`} 
            trend="up" 
            percentage={12.5} 
            color="blue" 
        />
        <MetricCard 
            label="총 매입 실적 (Purchase)" 
            value={formatCurrency(summaryMetrics.totalPurchase)} 
            subValue={`${year}년 누계`} 
            trend={summaryMetrics.purchaseRatio > 80 ? "up" : "neutral"} 
            color="rose" 
        />
        <MetricCard 
            label="한계이익 (Marginal Profit)" 
            value={formatCurrency(summaryMetrics.totalSales - summaryMetrics.totalPurchase)} 
            subValue={`이익률 ${summaryMetrics.profitMargin}%`} 
            trend={summaryMetrics.profitMargin > 0 ? "up" : "down"}
            percentage={summaryMetrics.profitMargin} 
            color={summaryMetrics.profitMargin > 0 ? "emerald" : "rose"} 
        />
        <MetricCard 
            label="평균 매입율 (Cost Ratio)" 
            value={`${summaryMetrics.purchaseRatio}%`} 
            subValue="매출 대비 매입 비중" 
            percentage={summaryMetrics.purchaseRatio - 70} 
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
                
                <Bar name="영업 매출액" dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar name="구매 매입액" dataKey="purchase" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={30} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Chart: Purchase Material Ratio (Line Chart) */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
              <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
              월별 매입재료비율 (Purchase Material Ratio)
            </h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 30, right: 30, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 700, fill: '#64748b'}} />
                        <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fontSize: 11, fill: '#94a3b8'}} 
                            unit="%" 
                            domain={[0, 100]} // Keep scale reasonable
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
                            dot={{r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2}}
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
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
