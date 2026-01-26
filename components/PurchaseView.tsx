
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LabelList } from 'recharts';
import { parsePartsCSV, parseMaterialCSV, PurchaseItem } from '../utils/purchaseDataParser';
import { INITIAL_PARTS_CSV, INITIAL_MATERIAL_CSV } from '../data/initialPurchaseData';

const PurchaseView: React.FC = () => {
  // --- Initialization Helpers ---
  const getInitialPurchaseData = (): PurchaseItem[] => {
    if (typeof window === 'undefined') {
        const parts = parsePartsCSV(INITIAL_PARTS_CSV);
        const materials = parseMaterialCSV(INITIAL_MATERIAL_CSV);
        return [...parts, ...materials];
    }
    try {
      const stored = localStorage.getItem('dashboard_purchaseData');
      if (stored) {
        return JSON.parse(stored);
      }
      const parts = parsePartsCSV(INITIAL_PARTS_CSV);
      const materials = parseMaterialCSV(INITIAL_MATERIAL_CSV);
      return [...parts, ...materials];
    } catch (e) {
      console.error("Failed to load purchase data", e);
      return [];
    }
  };

  // --- State ---
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>(getInitialPurchaseData);
  const [activeSubTab, setActiveSubTab] = useState<'inbound' | 'price' | 'cr' | 'supplier'>('inbound');
  
  const [availableYears, setAvailableYears] = useState<number[]>([2026]);
  const [selectedYears, setSelectedYears] = useState<number[]>([2026]);
  const [purchaseListOpen, setPurchaseListOpen] = useState(true);

  // Filters for Inbound Tab
  const [filter, setFilter] = useState({
    date: '',
    type: '', // 부품, 원재료
    supplier: '',
    item: '',
    qty: '',
    amount: ''
  });

  // --- Persistence & Derived Year State ---
  useEffect(() => {
    localStorage.setItem('dashboard_purchaseData', JSON.stringify(purchaseData));
    
    // Update available years based on data
    const years = Array.from(new Set(purchaseData.map(d => d.year))).sort();
    if (years.length > 0) {
      setAvailableYears(years);
      // If currently selected year is not in available, select the latest
      if (selectedYears.length === 0 || !years.includes(selectedYears[0])) {
        setSelectedYears([years[years.length - 1]]);
      }
    }
  }, [purchaseData]);

  // --- Derived Data for INBOUND Charts & List ---
  const activeYearData = useMemo(() => {
    return purchaseData.filter(d => selectedYears.includes(d.year));
  }, [purchaseData, selectedYears]);

  const chartData = useMemo(() => {
    const monthMap = new Map<string, any>();
    const allMonths = Array.from({ length: 12 }, (_, i) => `${(i + 1).toString().padStart(2, '0')}월`);

    allMonths.forEach(m => {
      monthMap.set(m, { month: m, parts: 0, material: 0, total: 0 });
    });

    activeYearData.forEach(item => {
      const entry = monthMap.get(item.month);
      if (entry) {
        if (item.category === 'Parts') {
          entry.parts += item.amount;
        } else {
          entry.material += item.amount;
        }
        entry.total += item.amount;
      }
    });

    return Array.from(monthMap.values());
  }, [activeYearData]);

  const typeShareData = useMemo(() => {
    const partsTotal = activeYearData.filter(d => d.category === 'Parts').reduce((sum, d) => sum + d.amount, 0);
    const materialTotal = activeYearData.filter(d => d.category === 'Material').reduce((sum, d) => sum + d.amount, 0);
    
    return [
      { name: '부품 (Parts)', value: partsTotal },
      { name: '원재료 (Materials)', value: materialTotal }
    ].filter(d => d.value > 0);
  }, [activeYearData]);

  const filteredItems = useMemo(() => {
    return activeYearData.filter(item => {
      const matchDate = filter.date === '' || item.date.includes(filter.date);
      const matchType = filter.type === '' || item.type.includes(filter.type);
      const matchSupplier = filter.supplier === '' || item.supplier.includes(filter.supplier);
      const matchItem = filter.item === '' || (item.itemName && item.itemName.toLowerCase().includes(filter.item.toLowerCase()));
      const matchQty = filter.qty === '' || item.qty.toString().includes(filter.qty);
      const matchAmount = filter.amount === '' || item.amount.toString().includes(filter.amount.replace(/,/g, ''));

      return matchDate && matchType && matchSupplier && matchItem && matchQty && matchAmount;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activeYearData, filter]);

  const filteredTotal = useMemo(() => {
    return filteredItems.reduce((acc, item) => ({
      qty: acc.qty + item.qty,
      amount: acc.amount + item.amount
    }), { qty: 0, amount: 0 });
  }, [filteredItems]);

  const totalPurchaseAmount = activeYearData.reduce((sum, item) => sum + item.amount, 0);

  // --- Derived Data for SUPPLIER Tab ---
  const supplierStats = useMemo(() => {
    const stats = new Map<string, { name: string, totalAmount: number, count: number, items: Set<string> }>();
    purchaseData.forEach(item => {
      if (!stats.has(item.supplier)) {
        stats.set(item.supplier, { name: item.supplier, totalAmount: 0, count: 0, items: new Set() });
      }
      const s = stats.get(item.supplier)!;
      s.totalAmount += item.amount;
      s.count += 1;
      s.items.add(item.itemName);
    });
    return Array.from(stats.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [purchaseData]);

  // --- Derived Data for PRICE Tab ---
  const priceStats = useMemo(() => {
    const map = new Map<string, { code: string, name: string, unit: string, latestPrice: number, maxPrice: number, minPrice: number, supplier: string, date: string }>();
    purchaseData.forEach(item => {
        const key = item.itemName + item.supplier; // Unique per item per supplier
        if(!map.has(key)) {
            map.set(key, { 
                code: item.itemCode, 
                name: item.itemName, 
                unit: item.unit,
                latestPrice: item.unitPrice, 
                maxPrice: item.unitPrice, 
                minPrice: item.unitPrice, 
                supplier: item.supplier, 
                date: item.date 
            });
        } else {
            const current = map.get(key)!;
            current.maxPrice = Math.max(current.maxPrice, item.unitPrice);
            current.minPrice = Math.min(current.minPrice, item.unitPrice);
            if (new Date(item.date) >= new Date(current.date)) {
                current.latestPrice = item.unitPrice;
                current.date = item.date;
                current.supplier = item.supplier; // Should be same
            }
        }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [purchaseData]);


  // --- Handlers ---
  const handlePartsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newParts = parsePartsCSV(event.target?.result as string);
        setPurchaseData(prev => {
          const existingMaterials = prev.filter(d => d.category === 'Material');
          return [...existingMaterials, ...newParts];
        });
      };
      reader.readAsText(file);
    }
  };

  const handleMaterialFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newMaterials = parseMaterialCSV(event.target?.result as string);
        setPurchaseData(prev => {
          const existingParts = prev.filter(d => d.category === 'Parts');
          return [...existingParts, ...newMaterials];
        });
      };
      reader.readAsText(file);
    }
  };

  const handleFilterChange = (field: keyof typeof filter, value: string) => {
    setFilter(prev => ({ ...prev, [field]: value }));
  };

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

  const formatBillionLabel = (value: number) => {
    if (value === 0) return '';
    return `${(value / 100000000).toFixed(1)}억`;
  };

  const PIE_COLORS = ['#6366f1', '#f43f5e']; 

  // --- Sub-menu Definition ---
  const SUB_TABS = [
    { id: 'inbound', label: '구매현황(입고)' },
    // Inventory removed from here
    { id: 'price', label: '단가현황' },
    { id: 'cr', label: 'CR현황' },
    { id: 'supplier', label: '협력사 현황' },
  ];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-1 mb-8 overflow-x-auto">
        {SUB_TABS.map(tab => (
            <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`px-5 py-3 text-sm font-bold transition-all relative whitespace-nowrap ${
                    activeSubTab === tab.id 
                    ? 'text-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
                {tab.label}
                {activeSubTab === tab.id && (
                    <span className="absolute bottom-[-5px] left-0 w-full h-1 bg-indigo-600 rounded-t-full"></span>
                )}
            </button>
        ))}
      </div>

      {/* =================================================================================
          1. INBOUND TAB (Existing View)
         ================================================================================= */}
      {activeSubTab === 'inbound' && (
      <div className="space-y-12">
        {/* Header & Controls */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">구매 입고 현황 (Inbound)</h2>
            <p className="text-xs text-slate-500 mt-1">부품 및 원재료 월별 입고 현황 통합 분석</p>
          </div>
          
          <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
            <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-200">
              <span className="text-xs font-bold text-slate-500">조회 년도:</span>
              <div className="flex gap-2">
                {availableYears.map(year => (
                  <button
                    key={year}
                    onClick={() => toggleYear(year)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      selectedYears.includes(year) 
                        ? 'bg-indigo-500 text-white shadow-sm' 
                        : 'bg-white text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                <span>⚙️ 부품 입고 업로드</span>
                <input type="file" accept=".csv" onChange={handlePartsFileUpload} className="hidden" />
              </label>
              <label className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                <span>🧪 원재료 입고 업로드</span>
                <input type="file" accept=".csv" onChange={handleMaterialFileUpload} className="hidden" />
              </label>
            </div>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard 
            label="총 매입 실적 (Total Purchase)" 
            value={`₩${totalPurchaseAmount.toLocaleString()}`} 
            subValue={selectedYears.length > 1 ? `${selectedYears.join(', ')}년 합계` : `${selectedYears[0]}년 전체`}
            trend="neutral"
            color="slate" 
          />
          <MetricCard 
            label="부품 매입 비중" 
            value={`${typeShareData.length > 0 ? ((typeShareData.find(d => d.name.includes('Parts'))?.value || 0) / totalPurchaseAmount * 100).toFixed(1) : 0}%`}
            subValue="전체 매입액 대비"
            color="blue" 
          />
          <MetricCard 
            label="검색된 입고 건수" 
            value={`${filteredItems.length}건`} 
            subValue="현재 필터 기준"
            color="rose" 
          />
        </div>

        {/* Charts */}
        <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
                    <span className="w-1 h-5 bg-indigo-600 rounded-full"></span>
                    월별 매입 금액 추이 ({selectedYears.join(', ')})
                </h3>
                <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 30, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                        <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        cursor={{ fill: '#f8fafc' }}
                        formatter={(value: number) => `₩${value.toLocaleString()}`}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                        <Bar name="부품 (Parts)" dataKey="parts" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} barSize={40} />
                        <Bar name="원재료 (Materials)" dataKey="material" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40}>
                            <LabelList 
                                dataKey="total" 
                                position="top" 
                                formatter={formatBillionLabel}
                                style={{ fill: '#64748b', fontSize: '11px', fontWeight: 'bold' }} 
                            />
                        </Bar>
                    </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="w-full lg:w-1/3 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6">
                    <span className="w-1 h-5 bg-slate-500 rounded-full"></span>
                    매입 유형별 비중
                </h3>
                <div className="flex-1 min-h-[300px] flex items-center justify-center relative">
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                        <Pie
                            data={typeShareData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${(percent * 100).toFixed(1)}%`}
                        >
                            {typeShareData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
                            ))}
                        </Pie>
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: number) => `₩${value.toLocaleString()}`}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>

        {/* List Table */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="mb-4">
             <button 
              onClick={() => setPurchaseListOpen(!purchaseListOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${purchaseListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              상세 입고 리스트 (Purchase List)
            </button>
          </div>
            
            {purchaseListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 min-w-[90px]">입고일자</th>
                      <th className="px-4 py-3 min-w-[80px]">구분</th>
                      <th className="px-4 py-3 min-w-[80px]">유형</th>
                      <th className="px-4 py-3 min-w-[120px]">발주처</th>
                      <th className="px-4 py-3 min-w-[150px]">품명 (Item Name)</th>
                      <th className="px-4 py-3 text-right min-w-[80px]">입고수량</th>
                      <th className="px-4 py-3 text-right min-w-[100px]">입고금액</th>
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2"><input type="text" placeholder="날짜 검색" className="w-full p-1 border rounded text-xs font-normal" value={filter.date} onChange={(e) => handleFilterChange('date', e.target.value)} /></th>
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2"><input type="text" placeholder="유형" className="w-full p-1 border rounded text-xs font-normal" value={filter.type} onChange={(e) => handleFilterChange('type', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="발주처" className="w-full p-1 border rounded text-xs font-normal" value={filter.supplier} onChange={(e) => handleFilterChange('supplier', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="품명" className="w-full p-1 border rounded text-xs font-normal" value={filter.item} onChange={(e) => handleFilterChange('item', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={filter.qty} onChange={(e) => handleFilterChange('qty', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={filter.amount} onChange={(e) => handleFilterChange('amount', e.target.value)} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600 font-mono">{item.date}</td>
                        <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${
                                item.category === 'Parts' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'
                            }`}>
                                {item.category === 'Parts' ? '부품' : '원재료'}
                            </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{item.type}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{item.supplier}</td>
                        <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={item.itemName}>{item.itemName}</td>
                        <td className="px-4 py-3 text-right font-mono">{item.qty.toLocaleString()} <span className="text-[10px] text-slate-400">{item.unit}</span></td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">₩{item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-center">합계 (Total)</td>
                      <td className="px-4 py-3 text-right font-mono">{filteredTotal.qty.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-indigo-700">₩{filteredTotal.amount.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      </div>
      )}

      {/* =================================================================================
          3. PRICE TAB (Derived Data)
         ================================================================================= */}
      {activeSubTab === 'price' && (
          <div className="space-y-6">
             <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-black text-slate-800 mb-4">품목별 단가 현황 (Unit Price)</h2>
                <p className="text-sm text-slate-500 mb-6">입고 내역을 기반으로 산출된 품목별 최신 단가 및 단가 변동 정보입니다.</p>

                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3">품명 (Item Name)</th>
                                <th className="px-4 py-3">발주처</th>
                                <th className="px-4 py-3 text-center">단위</th>
                                <th className="px-4 py-3 text-right">최신단가</th>
                                <th className="px-4 py-3 text-right">최고단가</th>
                                <th className="px-4 py-3 text-right">최저단가</th>
                                <th className="px-4 py-3 text-right">최근 입고일</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {priceStats.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                                    <td className="px-4 py-3 text-slate-600">{item.supplier}</td>
                                    <td className="px-4 py-3 text-center text-slate-500">{item.unit}</td>
                                    <td className="px-4 py-3 text-right font-bold text-indigo-600">₩{item.latestPrice.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">₩{item.maxPrice.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">₩{item.minPrice.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-400">{item.date}</td>
                                </tr>
                            ))}
                            {priceStats.length === 0 && (
                                <tr><td colSpan={7} className="text-center py-8 text-slate-400">데이터가 없습니다.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
      )}

      {/* =================================================================================
          4. CR TAB (Placeholder)
         ================================================================================= */}
      {activeSubTab === 'cr' && (
         <div className="bg-white p-20 rounded-3xl border border-slate-200 text-center shadow-sm">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
            </div>
            <h3 className="text-xl font-black text-slate-800 mb-2">CR (Cost Reduction) 현황</h3>
            <p className="text-slate-500 max-w-md mx-auto">
                원가 절감 활동 분석 모듈을 준비 중입니다.<br/>
                목표 대비 실적 관리 및 절감 요인 분석 기능을 제공할 예정입니다.
            </p>
         </div>
      )}

      {/* =================================================================================
          5. SUPPLIER TAB (Derived Data)
         ================================================================================= */}
      {activeSubTab === 'supplier' && (
          <div className="space-y-6">
             <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-black text-slate-800 mb-4">협력사 현황 (Supplier Status)</h2>
                <p className="text-sm text-slate-500 mb-6">전체 입고 데이터를 기준으로 집계된 협력사별 거래 현황입니다.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <MetricCard label="등록된 협력사 수" value={`${supplierStats.length}개사`} color="blue" />
                    <MetricCard label="총 거래 규모" value={`₩${totalPurchaseAmount.toLocaleString()}`} color="slate" />
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3">협력사명</th>
                                <th className="px-4 py-3 text-right">총 매입액</th>
                                <th className="px-4 py-3 text-right">점유율</th>
                                <th className="px-4 py-3 text-right">입고 건수</th>
                                <th className="px-4 py-3 text-right">취급 품목 수</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {supplierStats.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-700">₩{item.totalAmount.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">
                                        {totalPurchaseAmount > 0 ? ((item.totalAmount / totalPurchaseAmount) * 100).toFixed(1) : 0}%
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{item.count.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-600">{item.items.size}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
      )}
    </div>
  );
};

export default PurchaseView;
