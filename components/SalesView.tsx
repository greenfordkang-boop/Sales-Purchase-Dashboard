
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, PieChart, Pie, Cell } from 'recharts';
import { parseSalesCSV, CustomerSalesData, SalesItem } from '../utils/salesDataParser';
import { parseRevenueCSV, RevenueItem } from '../utils/revenueDataParser';
import { INITIAL_CSV_DATA } from '../data/initialSalesData';
import { INITIAL_REVENUE_CSV } from '../data/initialRevenueData';

const SalesView: React.FC = () => {
  // --- Initialization Helpers (Run once on mount) ---
  
  // 1. Sales Data Initializer
  const getInitialSalesData = (): CustomerSalesData[] => {
    if (typeof window === 'undefined') return parseSalesCSV(INITIAL_CSV_DATA);
    try {
      const stored = localStorage.getItem('dashboard_salesData');
      return stored ? JSON.parse(stored) : parseSalesCSV(INITIAL_CSV_DATA);
    } catch (e) {
      console.error("Failed to load sales data", e);
      return parseSalesCSV(INITIAL_CSV_DATA);
    }
  };

  // 2. Revenue Data Initializer
  const getInitialRevenueData = (): RevenueItem[] => {
    // Helper to generate default mock data if local storage is empty
    const generateDefaultData = () => {
      const data2024 = parseRevenueCSV(INITIAL_REVENUE_CSV, 2024);
      const data2023 = data2024.map(item => ({
        ...item,
        id: item.id + 100000,
        year: 2023,
        amount: Math.floor(item.amount * 0.9),
        qty: Math.floor(item.qty * 0.92)
      }));
      return [...data2023, ...data2024];
    };

    if (typeof window === 'undefined') return generateDefaultData();
    
    try {
      const stored = localStorage.getItem('dashboard_revenueData');
      if (stored) {
        return JSON.parse(stored);
      }
      return generateDefaultData();
    } catch (e) {
      console.error("Failed to load revenue data", e);
      return generateDefaultData();
    }
  };

  // --- State Management with Lazy Initialization ---
  
  // Quantity States
  const [salesData, setSalesData] = useState<CustomerSalesData[]>(getInitialSalesData);
  const [selectedQtyCustomer, setSelectedQtyCustomer] = useState<string>('All');
  const [qtyChartData, setQtyChartData] = useState<any[]>([]);
  const [qtyListOpen, setQtyListOpen] = useState(true);
  const [qtyFilter, setQtyFilter] = useState({
    customer: '', model: '', partNo: '', partName: '', plan: '', actual: ''
  });

  // Revenue States
  const [revenueData, setRevenueData] = useState<RevenueItem[]>(getInitialRevenueData);
  const [selectedRevCustomer, setSelectedRevCustomer] = useState<string>('All');
  const [revChartData, setRevChartData] = useState<any[]>([]);
  const [revListOpen, setRevListOpen] = useState(true);
  const [uploadYear, setUploadYear] = useState<number>(2025);
  const [revFilter, setRevFilter] = useState({
    year: '', month: '', customer: '', model: '', qty: '', amount: ''
  });

  // Year Management (Initialize based on loaded revenueData)
  const [availableYears, setAvailableYears] = useState<number[]>(() => {
    const initialData = getInitialRevenueData();
    const years = Array.from(new Set(initialData.map(d => d.year))).sort();
    return years.length > 0 ? years : [2023, 2024];
  });
  
  const [selectedYears, setSelectedYears] = useState<number[]>(() => {
    const initialData = getInitialRevenueData();
    const years = Array.from(new Set(initialData.map(d => d.year))).sort();
    return years.length > 0 ? years : [2024];
  });

  // --- Persistence Effects (Save on Change) ---
  useEffect(() => {
    localStorage.setItem('dashboard_salesData', JSON.stringify(salesData));
  }, [salesData]);

  useEffect(() => {
    localStorage.setItem('dashboard_revenueData', JSON.stringify(revenueData));
    
    // Update years when data changes
    const years = Array.from(new Set(revenueData.map(d => d.year))).sort();
    setAvailableYears(years);
    
    // If a new year is introduced (e.g. upload), select it if it's not currently selected
    // Note: This logic is simple; sophisticated logic might be needed if we want to preserve complex selections
    // For now, we rely on the upload handler to toggle selection
  }, [revenueData]);


  // --- Derived Data for Quantity ---
  const qtyCustomers = useMemo(() => ['All', ...Array.from(new Set(salesData.map(d => d.customer)))], [salesData]);

  const activeQtyData = useMemo(() => {
    if (selectedQtyCustomer === 'All') {
      const aggregatedMonthly = Array.from({ length: 12 }, (_, i) => ({
        month: `${i + 1}월`,
        plan: 0,
        actual: 0
      }));
      let totalPlan = 0;
      let totalActual = 0;
      let allItems: SalesItem[] = [];

      salesData.forEach(d => {
        d.monthlyData.forEach((m, idx) => {
          aggregatedMonthly[idx].plan += m.plan;
          aggregatedMonthly[idx].actual += m.actual;
        });
        totalPlan += d.totalPlan;
        totalActual += d.totalActual;
        allItems = [...allItems, ...d.items];
      });

      return { monthlyData: aggregatedMonthly, totalPlan, totalActual, items: allItems };
    } else {
      const data = salesData.find(d => d.customer === selectedQtyCustomer);
      return data || { monthlyData: [], totalPlan: 0, totalActual: 0, items: [] };
    }
  }, [selectedQtyCustomer, salesData]);

  const filteredQtyItems = useMemo(() => {
    return activeQtyData.items.filter(item => {
      const matchCustomer = qtyFilter.customer === '' || item.customer.toLowerCase().includes(qtyFilter.customer.toLowerCase());
      const matchModel = qtyFilter.model === '' || (item.model && item.model.toLowerCase().includes(qtyFilter.model.toLowerCase()));
      const matchPartNo = qtyFilter.partNo === '' || (item.partNo && item.partNo.toLowerCase().includes(qtyFilter.partNo.toLowerCase()));
      const matchPartName = qtyFilter.partName === '' || (item.partName && item.partName.toLowerCase().includes(qtyFilter.partName.toLowerCase()));
      const matchPlan = qtyFilter.plan === '' || item.totalPlan.toString().includes(qtyFilter.plan);
      const matchActual = qtyFilter.actual === '' || item.totalActual.toString().includes(qtyFilter.actual);
      return matchCustomer && matchModel && matchPartNo && matchPartName && matchPlan && matchActual;
    });
  }, [activeQtyData.items, qtyFilter]);

  const filteredQtyTotal = useMemo(() => {
    const sums = filteredQtyItems.reduce((acc, item) => ({
      plan: acc.plan + item.totalPlan,
      actual: acc.actual + item.totalActual
    }), { plan: 0, actual: 0 });
    const rate = sums.plan > 0 ? (sums.actual / sums.plan) * 100 : 0;
    return { ...sums, rate };
  }, [filteredQtyItems]);

  useEffect(() => {
    setQtyChartData(activeQtyData.monthlyData);
  }, [activeQtyData]);

  const qtyAchievementRate = activeQtyData.totalPlan > 0 ? (activeQtyData.totalActual / activeQtyData.totalPlan) * 100 : 0;

  // --- Derived Data for Revenue ---
  const revCustomers = useMemo(() => ['All', ...Array.from(new Set(revenueData.map(d => d.customer)))], [revenueData]);

  const activeRevData = useMemo(() => {
    const filtered = revenueData.filter(d => 
      (selectedRevCustomer === 'All' || d.customer === selectedRevCustomer) &&
      selectedYears.includes(d.year)
    );

    const monthMap = new Map<string, any>();
    const yearTotals = new Map<number, number>(); 
    const allMonths = Array.from({ length: 12 }, (_, i) => `${(i + 1).toString().padStart(2, '0')}월`);
    
    allMonths.forEach(m => {
      monthMap.set(m, { month: m });
      selectedYears.forEach(y => {
        monthMap.get(m)[y] = 0;
      });
    });

    filtered.forEach(item => {
      const monthData = monthMap.get(item.month);
      if (monthData) {
        monthData[item.year] = (monthData[item.year] || 0) + item.amount;
      }
      yearTotals.set(item.year, (yearTotals.get(item.year) || 0) + item.amount);
    });

    const chartData = Array.from(monthMap.values());
    const grandTotal = Array.from(yearTotals.values()).reduce((a, b) => a + b, 0);

    return { chartData, totalAmount: grandTotal, items: filtered, yearTotals };
  }, [selectedRevCustomer, revenueData, selectedYears]);

  // Derived Data for Pie Chart (Customer Share)
  const customerShareData = useMemo(() => {
    const shareMap = new Map<string, number>();
    // Aggregate revenue by customer from the currently active data
    activeRevData.items.forEach(item => {
      shareMap.set(item.customer, (shareMap.get(item.customer) || 0) + item.amount);
    });

    // Convert to array and sort by value descending
    let data = Array.from(shareMap.entries()).map(([name, value]) => ({ name, value }));
    data.sort((a, b) => b.value - a.value);

    // Group "Others" if there are many customers (Top 5 + Others)
    if (data.length > 6) {
      const top5 = data.slice(0, 5);
      const othersValue = data.slice(5).reduce((sum, item) => sum + item.value, 0);
      return [...top5, { name: '기타 (Others)', value: othersValue }];
    }
    return data;
  }, [activeRevData.items]);

  const filteredRevItems = useMemo(() => {
    const filtered = activeRevData.items.filter(item => {
      const matchYear = revFilter.year === '' || item.year.toString().includes(revFilter.year);
      const matchMonth = revFilter.month === '' || item.month.includes(revFilter.month);
      const matchCustomer = revFilter.customer === '' || item.customer.toLowerCase().includes(revFilter.customer.toLowerCase());
      const matchModel = revFilter.model === '' || (item.model && item.model.toLowerCase().includes(revFilter.model.toLowerCase()));
      const matchQty = revFilter.qty === '' || item.qty.toString().includes(revFilter.qty);
      const matchAmount = revFilter.amount === '' || item.amount.toString().includes(revFilter.amount.replace(/,/g, ''));
      return matchYear && matchMonth && matchCustomer && matchModel && matchQty && matchAmount;
    });

    return filtered.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.month.localeCompare(a.month);
    });
  }, [activeRevData.items, revFilter]);

  const filteredRevTotal = useMemo(() => {
    return filteredRevItems.reduce((acc, item) => ({
      qty: acc.qty + item.qty,
      amount: acc.amount + item.amount
    }), { qty: 0, amount: 0 });
  }, [filteredRevItems]);

  useEffect(() => {
    setRevChartData(activeRevData.chartData);
  }, [activeRevData]);

  // --- Handlers ---
  const handleQtyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setSalesData(parseSalesCSV(event.target?.result as string));
      reader.readAsText(file);
    }
  };

  const handleRevFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newData = parseRevenueCSV(event.target?.result as string, uploadYear);
        setRevenueData(prev => {
          // Optional: You could check for duplicates here if needed
          return [...prev, ...newData];
        });
        
        // Auto-select the new year
        if (!selectedYears.includes(uploadYear)) {
          setSelectedYears(prev => [...prev, uploadYear].sort());
        }
      };
      reader.readAsText(file);
    }
  };

  const handleQtyFilterChange = (field: keyof typeof qtyFilter, value: string) => setQtyFilter(prev => ({ ...prev, [field]: value }));
  const handleRevFilterChange = (field: keyof typeof revFilter, value: string) => setRevFilter(prev => ({ ...prev, [field]: value }));

  const toggleYear = (year: number) => {
    setSelectedYears(prev => {
      if (prev.includes(year)) {
        if (prev.length === 1) return prev; 
        return prev.filter(y => y !== year).sort();
      } else {
        return [...prev, year].sort();
      }
    });
  };

  const getYearColor = (year: number) => {
    const colors = { 2023: '#94a3b8', 2024: '#3b82f6', 2025: '#10b981', 2026: '#f59e0b', 2022: '#64748b' };
    return (colors as any)[year] || '#6366f1';
  };

  const PIE_COLORS = [
    '#3b82f6', // Blue 500
    '#10b981', // Emerald 500
    '#f59e0b', // Amber 500
    '#ef4444', // Red 500
    '#8b5cf6', // Violet 500
    '#ec4899', // Pink 500
    '#6366f1', // Indigo 500
    '#14b8a6', // Teal 500
    '#94a3b8', // Slate 400 (Others)
  ];

  const formatBillionLabel = (value: number) => {
    if (value === 0) return '';
    return `${(value / 100000000).toFixed(1)}억`;
  };

  return (
    <div className="space-y-12 animate-in slide-in-from-bottom-2 duration-500">
      
      {/* ================= QUANTITY SECTION ================= */}
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">매출수량 현황 (Quantity)</h2>
            <p className="text-xs text-slate-500 mt-1">계획 수량 대비 실적 수량 분석</p>
          </div>
          <div className="flex gap-4 items-center">
            <label className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors">
              📂 수량 CSV 업로드
              <input type="file" accept=".csv" onChange={handleQtyFileUpload} className="hidden" />
            </label>
            <select 
              value={selectedQtyCustomer} 
              onChange={(e) => setSelectedQtyCustomer(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[200px]"
            >
              {qtyCustomers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard 
            label="총 실적 수량 (Total Actual)" 
            value={`${activeQtyData.totalActual.toLocaleString()} EA`} 
            subValue={`계획: ${activeQtyData.totalPlan.toLocaleString()} EA`}
            trend={qtyAchievementRate >= 100 ? 'up' : 'neutral'}
            percentage={parseFloat((qtyAchievementRate - 100).toFixed(1))}
            color="emerald" 
          />
          <MetricCard 
            label="검색된 품목 수" 
            value={`${filteredQtyItems.length}개`} 
            subValue={`총 ${activeQtyData.items.length}개 중`}
            color="slate" 
          />
           <MetricCard 
            label="분석 대상" 
            value={selectedQtyCustomer === 'All' ? '전체 고객사' : selectedQtyCustomer}
            subValue="2024년 데이터"
            color="slate" 
          />
        </div>

        {/* Main Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-black text-slate-800 flex items-center gap-2">
              <span className="w-1 h-5 bg-emerald-600 rounded-full"></span>
              1. 월별 계획수량(Plan) vs 실적수량(Actual) 추이
            </h3>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={qtyChartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#f8fafc' }}
                  formatter={(value: number) => value.toLocaleString()}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                <Bar name="계획수량 (Plan)" dataKey="plan" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar name="실적수량 (Actual)" dataKey="actual" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                <Line type="monotone" name="실적추세" dataKey="actual" stroke="#059669" strokeWidth={3} dot={{r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff'}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-8">
            <button 
              onClick={() => setQtyListOpen(!qtyListOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-4 hover:text-emerald-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${qtyListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              상세 품목 리스트 (Quantity List)
            </button>
            
            {qtyListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[120px]">고객사</th>
                      <th className="px-4 py-3 min-w-[100px]">Model</th>
                      <th className="px-4 py-3 min-w-[100px]">품번</th>
                      <th className="px-4 py-3 min-w-[150px]">품명</th>
                      <th className="px-4 py-3 text-right min-w-[80px]">총계획</th>
                      <th className="px-4 py-3 text-right min-w-[80px]">총실적</th>
                      <th className="px-4 py-3 text-center min-w-[60px]">달성률</th>
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2"><input type="text" placeholder="고객사 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.customer} onChange={(e) => handleQtyFilterChange('customer', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="Model 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.model} onChange={(e) => handleQtyFilterChange('model', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="품번 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partNo} onChange={(e) => handleQtyFilterChange('partNo', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="품명 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partName} onChange={(e) => handleQtyFilterChange('partName', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="계획" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.plan} onChange={(e) => handleQtyFilterChange('plan', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="실적" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.actual} onChange={(e) => handleQtyFilterChange('actual', e.target.value)} /></th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQtyItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.partNo}</td>
                        <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={item.partName}>{item.partName}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500">{item.totalPlan.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{item.totalActual.toLocaleString()}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${
                            item.rate >= 100 ? 'bg-emerald-100 text-emerald-700' :
                            item.rate >= 80 ? 'bg-amber-100 text-amber-700' :
                            'bg-rose-100 text-rose-700'
                          }`}>
                            {item.rate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                     {filteredQtyItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                  {/* Quantity List Footer Summary */}
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-center">합계 (Total)</td>
                      <td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.plan.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.actual.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${
                            filteredQtyTotal.rate >= 100 ? 'bg-emerald-100 text-emerald-700' :
                            filteredQtyTotal.rate >= 80 ? 'bg-amber-100 text-amber-700' :
                            'bg-rose-100 text-rose-700'
                          }`}>
                            {filteredQtyTotal.rate.toFixed(1)}%
                          </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ================= REVENUE SECTION ================= */}
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">매출현황 (금액)</h2>
            <p className="text-xs text-slate-500 mt-1">고객사별 매출 금액 현황 및 년도별 추이 분석</p>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
            {/* Year Selection for Display */}
            <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-200">
              <span className="text-xs font-bold text-slate-500">조회 년도:</span>
              <div className="flex gap-2">
                {availableYears.map(year => (
                  <button
                    key={year}
                    onClick={() => toggleYear(year)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      selectedYears.includes(year) 
                        ? 'text-white shadow-sm' 
                        : 'bg-white text-slate-400 hover:bg-slate-100'
                    }`}
                    style={{ backgroundColor: selectedYears.includes(year) ? getYearColor(year) : undefined }}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload Area */}
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
               <select 
                value={uploadYear}
                onChange={(e) => setUploadYear(Number(e.target.value))}
                className="bg-white border-none text-xs font-bold text-slate-700 rounded-lg py-1.5 px-2 outline-none focus:ring-0 cursor-pointer hover:bg-slate-50"
              >
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년 업로드</option>)}
              </select>
              <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap">
                파일선택
                <input type="file" accept=".csv" onChange={handleRevFileUpload} className="hidden" />
              </label>
            </div>

            <select 
              value={selectedRevCustomer} 
              onChange={(e) => setSelectedRevCustomer(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[150px]"
            >
              {revCustomers.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard 
            label="총 매출 실적 (Amount)" 
            value={`₩${activeRevData.totalAmount.toLocaleString()}`} 
            subValue={selectedYears.length > 1 ? `${selectedYears.join(', ')}년 합계` : `${selectedYears[0]}년 전체`}
            trend="up"
            percentage={0} 
            color="blue" 
          />
          <MetricCard 
            label="검색된 품목 수" 
            value={`${filteredRevItems.length}개`} 
            subValue={`총 ${activeRevData.items.length}개 중`}
            color="slate" 
          />
          <MetricCard 
            label="데이터 기간" 
            value={selectedYears.sort().join(' & ')}
            subValue="선택된 연도 분석"
            color="slate" 
          />
        </div>

        {/* --- REVENUE CHARTS SECTION --- */}
        {/* 1. Monthly Bar Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
            <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
            월별 매출 금액 추이 ({selectedYears.join(', ')})
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revChartData} margin={{ top: 30, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#f8fafc' }}
                  formatter={(value: number) => `₩${value.toLocaleString()}`}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                {selectedYears.map(year => (
                  <Bar 
                    key={year} 
                    name={`${year}년 매출`} 
                    dataKey={year} 
                    fill={getYearColor(year)} 
                    radius={[4, 4, 0, 0]} 
                    barSize={selectedYears.length > 1 ? 20 : 40} 
                  >
                    <LabelList 
                      dataKey={year} 
                      position="top" 
                      formatter={formatBillionLabel}
                      style={{ fill: getYearColor(year), fontSize: '11px', fontWeight: 'bold' }} 
                    />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Customer Share Pie Chart (Separate Card Below Bar Chart) */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <h3 className="font-black text-slate-800 flex items-center gap-2">
              <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
              업체별 매출 점유율 (Top Clients)
            </h3>
            <span className="text-xs text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-lg">
              {selectedYears.join(', ')}년 합계 기준
            </span>
          </div>
          
          <div className="flex flex-col md:flex-row items-center justify-center gap-8">
            <div className="h-[300px] w-full md:w-1/2 min-w-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={customerShareData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    fill="#8884d8"
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${(percent * 100).toFixed(1)}%`}
                    labelLine={false}
                  >
                    {customerShareData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => `₩${value.toLocaleString()}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Custom Legend for Pie Chart */}
            <div className="w-full md:w-1/2 flex flex-col gap-3">
              {customerShareData.map((entry, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-3 h-3 rounded-full shadow-sm" 
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="text-xs font-bold text-slate-700">{entry.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-xs font-black text-slate-800">₩{entry.value.toLocaleString()}</span>
                    <span className="block text-[10px] text-slate-400">
                      {((entry.value / activeRevData.totalAmount) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* --- REVENUE LIST TABLE --- */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="mb-4">
             <button 
              onClick={() => setRevListOpen(!revListOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${revListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              상세 품목 리스트 (Revenue List)
            </button>
          </div>
            
            {revListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[60px]">연도</th>
                      <th className="px-4 py-3 min-w-[60px]">월</th>
                      <th className="px-4 py-3 min-w-[120px]">고객사</th>
                      <th className="px-4 py-3 min-w-[100px]">Model</th>
                      <th className="px-4 py-3 text-right min-w-[80px]">매출수량</th>
                      <th className="px-4 py-3 text-right min-w-[100px]">매출금액</th>
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2"><input type="text" placeholder="연도" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.year} onChange={(e) => handleRevFilterChange('year', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="월" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.month} onChange={(e) => handleRevFilterChange('month', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="고객사" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.customer} onChange={(e) => handleRevFilterChange('customer', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="Model" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.model} onChange={(e) => handleRevFilterChange('model', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={revFilter.qty} onChange={(e) => handleRevFilterChange('qty', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={revFilter.amount} onChange={(e) => handleRevFilterChange('amount', e.target.value)} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRevItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600 font-mono">{item.year}</td>
                        <td className="px-4 py-3 text-slate-600">{item.month}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model}</td>
                        <td className="px-4 py-3 text-right font-mono">{item.qty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">₩{item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                    {filteredRevItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                  {/* Revenue List Footer Summary */}
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-center">합계 (Total)</td>
                      <td className="px-4 py-3 text-right font-mono">{filteredRevTotal.qty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-700">₩{filteredRevTotal.amount.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      </section>
    </div>
  );
};

export default SalesView;
