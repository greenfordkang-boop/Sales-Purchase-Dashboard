
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, PieChart, Pie, Cell } from 'recharts';
import { parseSalesCSV, CustomerSalesData, SalesItem } from '../utils/salesDataParser';
import { parseRevenueCSV, RevenueItem } from '../utils/revenueDataParser';
import { parseCRCSV, CRItem } from '../utils/crDataParser';
import { parseRFQCSV, RFQItem } from '../utils/rfqDataParser';
import { INITIAL_CSV_DATA } from '../data/initialSalesData';
import { INITIAL_REVENUE_CSV } from '../data/initialRevenueData';
import { INITIAL_CR_CSV } from '../data/initialCRData';
import { INITIAL_RFQ_CSV } from '../data/initialRfqData';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { salesService, revenueService, crService, rfqService } from '../services/supabaseService';

// Options for Dropdowns
const RFQ_PROCESS_OPTIONS = ['I', 'I/S', 'I/S/A', 'I/S/P', 'I/S/P/A', '선행', '기타'];
const RFQ_STATUS_OPTIONS = ['양산', '수주', '수주 검토', '개발', '개발 Drop', '가격 검토', '가격 분석', '수주 실패', '수주 포기', '진행중'];

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
    // 초기 데이터 생성은 Supabase와 localStorage 모두에 데이터가 없을 때만 실행
    // Supabase에 데이터가 있으면 Supabase에서 로드하므로 여기서는 빈 배열 반환
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('dashboard_revenueData');
      if (stored) {
        const parsed = JSON.parse(stored);
        // localStorage에 데이터가 있으면 사용 (Supabase에서 로드된 데이터일 수 있음)
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      }
      // localStorage에도 없으면 빈 배열 반환 (Supabase에서 로드될 예정)
      return [];
    } catch (e) {
      console.error("Failed to load revenue data", e);
      return [];
    }
  };

  // 3. CR Data Initializer
  const getInitialCRData = (): CRItem[] => {
    if (typeof window === 'undefined') return parseCRCSV(INITIAL_CR_CSV);
    try {
      const stored = localStorage.getItem('dashboard_crData');
      return stored ? JSON.parse(stored) : parseCRCSV(INITIAL_CR_CSV);
    } catch (e) {
        return parseCRCSV(INITIAL_CR_CSV);
    }
  };

  // 4. RFQ Data Initializer
  const getInitialRFQData = (): RFQItem[] => {
    if (typeof window === 'undefined') return parseRFQCSV(INITIAL_RFQ_CSV);
    try {
      const stored = localStorage.getItem('dashboard_rfqData');
      return stored ? JSON.parse(stored) : parseRFQCSV(INITIAL_RFQ_CSV);
    } catch (e) {
      return parseRFQCSV(INITIAL_RFQ_CSV);
    }
  };

  // --- State Management ---
  const [activeSubTab, setActiveSubTab] = useState<'yearly' | 'sales' | 'rfq' | 'cr'>('yearly');

  // Quantity States
  const [salesData, setSalesData] = useState<CustomerSalesData[]>(getInitialSalesData);
  const [selectedQtyCustomer, setSelectedQtyCustomer] = useState<string>('All');
  const [qtyChartData, setQtyChartData] = useState<any[]>([]);
  const [qtyListOpen, setQtyListOpen] = useState(true);
  const [qtyFilter, setQtyFilter] = useState({
    customer: '', model: '', partNo: '', partName: '', plan: '', actual: ''
  });
  const [qtySortConfig, setQtySortConfig] = useState<{ key: keyof SalesItem; direction: 'asc' | 'desc' } | null>(null);

  // Revenue States
  const [revenueData, setRevenueData] = useState<RevenueItem[]>(getInitialRevenueData);
  const [selectedRevCustomer, setSelectedRevCustomer] = useState<string>('All');
  const [revChartData, setRevChartData] = useState<any[]>([]);
  const [revListOpen, setRevListOpen] = useState(true);
  const [uploadYear, setUploadYear] = useState<number>(2025);
  const [revFilter, setRevFilter] = useState({
    year: '', month: '', customer: '', model: '', qty: '', amount: ''
  });
  const [revSortConfig, setRevSortConfig] = useState<{ key: keyof RevenueItem; direction: 'asc' | 'desc' } | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([2023, 2024]);
  const [selectedYears, setSelectedYears] = useState<number[]>([2024]);

  // CR States
  const [crData, setCrData] = useState<CRItem[]>(getInitialCRData);
  const [isEditingCR, setIsEditingCR] = useState(false);

  // RFQ States
  const [rfqData, setRfqData] = useState<RFQItem[]>(getInitialRFQData);
  const [rfqListOpen, setRfqListOpen] = useState(true);
  const [isEditingRFQ, setIsEditingRFQ] = useState(false);
  const [rfqFilter, setRfqFilter] = useState({
    customer: '', project: '', status: '', model: '', type: ''
  });
  const [rfqSortConfig, setRfqSortConfig] = useState<{ key: keyof RFQItem; direction: 'asc' | 'desc' } | null>(null);

  // --- NO AUTO SUPABASE LOAD - Use localStorage only, manual sync via Cloud button ---
  // Supabase 자동 로드 제거 - 데이터 손실 방지
  // "클라우드에서 다운로드" 버튼으로만 Supabase 데이터 사용

  // --- Persistence Effects (localStorage ONLY - NO AUTO SUPABASE) ---
  // Supabase는 "클라우드로 업로드" 버튼으로만 저장
  useEffect(() => {
    localStorage.setItem('dashboard_salesData', JSON.stringify(salesData));
  }, [salesData]);

  useEffect(() => {
    localStorage.setItem('dashboard_revenueData', JSON.stringify(revenueData));
    const years = Array.from(new Set(revenueData.map(d => d.year))).sort();
    setAvailableYears(years.length > 0 ? years : [2023, 2024]);
  }, [revenueData]);

  useEffect(() => {
    localStorage.setItem('dashboard_crData', JSON.stringify(crData));
  }, [crData]);

  useEffect(() => {
    localStorage.setItem('dashboard_rfqData', JSON.stringify(rfqData));
  }, [rfqData]);

  // --- Derived Data ---
  
  // Generic Sorting Helper
  const sortData = <T,>(data: T[], config: { key: keyof T; direction: 'asc' | 'desc' } | null) => {
    if (!config) return data;
    return [...data].sort((a, b) => {
      const aVal = a[config.key];
      const bVal = b[config.key];

      if (aVal === bVal) return 0;
      
      // Check if numbers (including formatted strings potentially, but data is usually clean here)
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return config.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      
      if (aStr < bStr) return config.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return config.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Quantity Derived
  const qtyCustomers = useMemo(() => ['All', ...Array.from(new Set(salesData.map(d => d.customer)))], [salesData]);
  const activeQtyData = useMemo(() => {
    if (selectedQtyCustomer === 'All') {
      const aggregatedMonthly = Array.from({ length: 12 }, (_, i) => ({ month: `${i + 1}월`, plan: 0, actual: 0 }));
      let totalPlan = 0, totalActual = 0, allItems: SalesItem[] = [];
      salesData.forEach(d => {
        d.monthlyData.forEach((m, idx) => { aggregatedMonthly[idx].plan += m.plan; aggregatedMonthly[idx].actual += m.actual; });
        totalPlan += d.totalPlan; totalActual += d.totalActual; allItems = [...allItems, ...d.items];
      });
      return { monthlyData: aggregatedMonthly, totalPlan, totalActual, items: allItems };
    } else {
      const data = salesData.find(d => d.customer === selectedQtyCustomer);
      return data || { monthlyData: [], totalPlan: 0, totalActual: 0, items: [] };
    }
  }, [selectedQtyCustomer, salesData]);
  useEffect(() => { setQtyChartData(activeQtyData.monthlyData); }, [activeQtyData]);
  const qtyAchievementRate = activeQtyData.totalPlan > 0 ? (activeQtyData.totalActual / activeQtyData.totalPlan) * 100 : 0;
  
  const filteredQtyItems = useMemo(() => {
    let result = activeQtyData.items.filter(item => 
      (qtyFilter.customer === '' || item.customer.toLowerCase().includes(qtyFilter.customer.toLowerCase())) &&
      (qtyFilter.model === '' || (item.model && item.model.toLowerCase().includes(qtyFilter.model.toLowerCase()))) &&
      (qtyFilter.partNo === '' || (item.partNo && item.partNo.toLowerCase().includes(qtyFilter.partNo.toLowerCase()))) &&
      (qtyFilter.partName === '' || (item.partName && item.partName.toLowerCase().includes(qtyFilter.partName.toLowerCase()))) &&
      (qtyFilter.plan === '' || item.totalPlan.toString().includes(qtyFilter.plan)) &&
      (qtyFilter.actual === '' || item.totalActual.toString().includes(qtyFilter.actual))
    );
    return sortData(result, qtySortConfig);
  }, [activeQtyData.items, qtyFilter, qtySortConfig]);

  const filteredQtyTotal = useMemo(() => {
    const sums = filteredQtyItems.reduce((acc, item) => ({ plan: acc.plan + item.totalPlan, actual: acc.actual + item.totalActual }), { plan: 0, actual: 0 });
    return { ...sums, rate: sums.plan > 0 ? (sums.actual / sums.plan) * 100 : 0 };
  }, [filteredQtyItems]);

  // Revenue Derived
  const revCustomers = useMemo(() => ['All', ...Array.from(new Set(revenueData.map(d => d.customer)))], [revenueData]);
  const activeRevData = useMemo(() => {
    const filtered = revenueData.filter(d => (selectedRevCustomer === 'All' || d.customer === selectedRevCustomer) && selectedYears.includes(d.year));
    const monthMap = new Map<string, any>();
    const yearTotals = new Map<number, number>(); 
    Array.from({ length: 12 }, (_, i) => `${(i + 1).toString().padStart(2, '0')}월`).forEach(m => {
      monthMap.set(m, { month: m });
      selectedYears.forEach(y => { monthMap.get(m)[y] = 0; });
    });
    filtered.forEach(item => {
      const monthData = monthMap.get(item.month);
      if (monthData) monthData[item.year] = (monthData[item.year] || 0) + item.amount;
      yearTotals.set(item.year, (yearTotals.get(item.year) || 0) + item.amount);
    });
    return { chartData: Array.from(monthMap.values()), totalAmount: Array.from(yearTotals.values()).reduce((a, b) => a + b, 0), items: filtered, yearTotals };
  }, [selectedRevCustomer, revenueData, selectedYears]);
  useEffect(() => { setRevChartData(activeRevData.chartData); }, [activeRevData]);
  const customerShareData = useMemo(() => {
    const shareMap = new Map<string, number>();
    activeRevData.items.forEach(item => shareMap.set(item.customer, (shareMap.get(item.customer) || 0) + item.amount));
    let data = Array.from(shareMap.entries()).map(([name, value]) => ({ name, value }));
    data.sort((a, b) => b.value - a.value);
    if (data.length > 6) {
      const top5 = data.slice(0, 5);
      const othersValue = data.slice(5).reduce((sum, item) => sum + item.value, 0);
      return [...top5, { name: '기타 (Others)', value: othersValue }];
    }
    return data;
  }, [activeRevData.items]);
  
  const filteredRevItems = useMemo(() => {
    let result = activeRevData.items.filter(item => 
      (revFilter.year === '' || item.year.toString().includes(revFilter.year)) &&
      (revFilter.month === '' || item.month.includes(revFilter.month)) &&
      (revFilter.customer === '' || item.customer.toLowerCase().includes(revFilter.customer.toLowerCase())) &&
      (revFilter.model === '' || (item.model && item.model.toLowerCase().includes(revFilter.model.toLowerCase()))) &&
      (revFilter.qty === '' || item.qty.toString().includes(revFilter.qty)) &&
      (revFilter.amount === '' || item.amount.toString().includes(revFilter.amount.replace(/,/g, '')))
    );
    // Apply sorting
    if (revSortConfig) {
      result = sortData(result, revSortConfig);
    } else {
      // Default sorting by Year Desc, Month Asc
      result.sort((a, b) => b.year !== a.year ? b.year - a.year : b.month.localeCompare(a.month));
    }
    return result;
  }, [activeRevData.items, revFilter, revSortConfig]);

  const filteredRevTotal = useMemo(() => filteredRevItems.reduce((acc, item) => ({ qty: acc.qty + item.qty, amount: acc.amount + item.amount }), { qty: 0, amount: 0 }), [filteredRevItems]);

  // CR Derived
  const crTableData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    const mapped = months.map(m => crData.find(d => d.month === m) || { month: m, totalSales: 0, lgSales: 0, lgCR: 0, lgDefense: 0, mtxSales: 0, mtxCR: 0, mtxDefense: 0 });
    const total = mapped.reduce((acc, cur) => ({
        month: '합계',
        totalSales: acc.totalSales + cur.totalSales,
        lgSales: acc.lgSales + cur.lgSales,
        lgCR: acc.lgCR + cur.lgCR,
        lgDefense: acc.lgDefense + cur.lgDefense, 
        mtxSales: acc.mtxSales + cur.mtxSales,
        mtxCR: acc.mtxCR + cur.mtxCR,
        mtxDefense: acc.mtxDefense + cur.mtxDefense
    }), { month: '합계', totalSales: 0, lgSales: 0, lgCR: 0, lgDefense: 0, mtxSales: 0, mtxCR: 0, mtxDefense: 0 });
    if (mapped.length > 0) { total.lgDefense = Math.round(total.lgDefense / mapped.length); total.mtxDefense = Math.round(total.mtxDefense / mapped.length); }
    return { monthly: mapped, total };
  }, [crData]);

  // RFQ Derived
  const rfqMetrics = useMemo(() => {
    const totalProjects = rfqData.length;
    const totalAmount = rfqData.reduce((sum, item) => sum + item.amount, 0);
    const wonProjects = rfqData.filter(d => d.status.includes('양산') || d.status.includes('수주')).length;
    const lostProjects = rfqData.filter(d => d.status.includes('실패') || d.status.includes('포기') || d.status.includes('Drop')).length;
    const winRate = (wonProjects + lostProjects) > 0 ? (wonProjects / (wonProjects + lostProjects)) * 100 : 0;
    
    // Status Distribution for Chart
    const statusCounts = new Map<string, number>();
    rfqData.forEach(d => statusCounts.set(d.status, (statusCounts.get(d.status) || 0) + 1));
    const chartData = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));

    return { totalProjects, totalAmount, winRate, chartData };
  }, [rfqData]);

  // Unique Customers for Dropdown (DataList)
  const uniqueRfqCustomers = useMemo(() => {
    return Array.from(new Set(rfqData.map(item => item.customer).filter(c => c && c.trim() !== ''))).sort();
  }, [rfqData]);

  const filteredRfqItems = useMemo(() => {
    let result = rfqData.filter(item => 
      (rfqFilter.customer === '' || item.customer.toLowerCase().includes(rfqFilter.customer.toLowerCase())) &&
      (rfqFilter.project === '' || item.projectName.toLowerCase().includes(rfqFilter.project.toLowerCase())) &&
      (rfqFilter.status === '' || item.status.includes(rfqFilter.status)) &&
      (rfqFilter.model === '' || item.model.toLowerCase().includes(rfqFilter.model.toLowerCase())) &&
      (rfqFilter.type === '' || item.projectType.toLowerCase().includes(rfqFilter.type.toLowerCase()))
    );

    if (rfqSortConfig) {
        result.sort((a, b) => {
            const aValue = a[rfqSortConfig.key];
            const bValue = b[rfqSortConfig.key];

            if (aValue === bValue) return 0;

            // Handle special case for 'index' which might be numeric string
            if (rfqSortConfig.key === 'index') {
                const aNum = parseInt(String(aValue), 10);
                const bNum = parseInt(String(bValue), 10);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return rfqSortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
                }
            }

            // Normal number comparison
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return rfqSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
            }

            // String comparison
            const aStr = String(aValue).toLowerCase();
            const bStr = String(bValue).toLowerCase();
            
            if (aStr < bStr) return rfqSortConfig.direction === 'asc' ? -1 : 1;
            if (aStr > bStr) return rfqSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }
    return result;
  }, [rfqData, rfqFilter, rfqSortConfig]);

  // --- Handlers (Supabase sync handled by Persistence Effects) ---
  const handleQtyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const parsed = parseSalesCSV(event.target?.result as string);
        setSalesData(parsed);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };
  const handleRevFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const newData = parseRevenueCSV(event.target?.result as string, uploadYear);
          
          // Update local state
          setRevenueData(prev => {
            const filtered = prev.filter(d => d.year !== uploadYear);
            return [...filtered, ...newData];
          });
          
          if (!selectedYears.includes(uploadYear)) {
            setSelectedYears(prev => [...prev, uploadYear].sort());
          }

          // Save to Supabase if configured
          if (isSupabaseConfigured()) {
            try {
              await revenueService.saveByYear(newData, uploadYear);
              console.log(`✅ Revenue data for year ${uploadYear} saved to Supabase successfully`);
              
              // Supabase 저장 후 전체 데이터를 다시 로드하여 확실하게 동기화
              const allData = await revenueService.getAll();
              if (allData && allData.length > 0) {
                setRevenueData(allData);
                localStorage.setItem('dashboard_revenueData', JSON.stringify(allData));
                const years = Array.from(new Set(allData.map(d => d.year))).sort();
                setAvailableYears(years.length > 0 ? years : [2023, 2024]);
                console.log(`✅ Revenue data reloaded from Supabase: ${allData.length} items, years: ${years.join(', ')}`);
                
                // 다른 컴포넌트(Overview)에 데이터 업데이트 알림
                window.dispatchEvent(new CustomEvent('revenueDataUpdated'));
              }
            } catch (err) {
              console.error('❌ Failed to save revenue data to Supabase:', err);
              alert(`데이터 저장 중 오류가 발생했습니다: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          } else {
            // If Supabase not configured, just save to localStorage (already done by useEffect)
            console.log('Supabase not configured, data saved to localStorage only');
            // localStorage 업데이트 알림
            window.dispatchEvent(new Event('storage'));
          }
        } catch (error) {
          console.error('Error processing file upload:', error);
          alert(`파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };
  const handleCRFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const parsed = parseCRCSV(event.target?.result as string);
        setCrData(parsed);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };
  const handleRfqFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const parsed = parseRFQCSV(event.target?.result as string);
        setRfqData(parsed);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleCrChange = (month: string, field: keyof CRItem, value: string) => {
    const numValue = parseFloat(value); const finalVal = isNaN(numValue) ? 0 : numValue;
    setCrData(prev => prev.map(item => item.month === month ? { ...item, [field]: finalVal } : item));
  };

  // RFQ Edit Handlers
  const handleRfqChange = (id: string, field: keyof RFQItem, value: string) => {
    setRfqData(prev => prev.map(item => {
        if (item.id === id) {
            let parsedValue: string | number = value;
            if (field === 'qty' || field === 'unitPrice' || field === 'amount') {
                const num = parseFloat(value.replace(/,/g, ''));
                parsedValue = isNaN(num) ? 0 : num;
            }
            return { ...item, [field]: parsedValue };
        }
        return item;
    }));
  };

  const handleAddRfqRow = () => {
    const newId = `rfq-new-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newItem: RFQItem = {
        id: newId,
        index: (rfqData.length + 1).toString(),
        customer: '',
        projectType: '',
        projectName: '',
        process: 'I/S/P/A',
        status: '진행중',
        dateSelection: '',
        dateQuotation: '',
        datePO: '',
        model: '',
        qty: 0,
        unitPrice: 0,
        amount: 0,
        remark: ''
    };
    setRfqData(prev => [newItem, ...prev]);
  };

  const handleDeleteRfqRow = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event bubbling
    if(window.confirm('정말 이 항목을 삭제하시겠습니까?')) {
        setRfqData(prev => prev.filter(item => String(item.id) !== String(id)));
    }
  };

  // Sorting Handlers
  const handleRfqSort = (key: keyof RFQItem) => {
    setRfqSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };
  const handleRevSort = (key: keyof RevenueItem) => {
    setRevSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };
  const handleQtySort = (key: keyof SalesItem) => {
    setQtySortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  const handleQtyFilterChange = (field: keyof typeof qtyFilter, value: string) => setQtyFilter(prev => ({ ...prev, [field]: value }));
  const handleRevFilterChange = (field: keyof typeof revFilter, value: string) => setRevFilter(prev => ({ ...prev, [field]: value }));
  const handleRfqFilterChange = (field: keyof typeof rfqFilter, value: string) => setRfqFilter(prev => ({ ...prev, [field]: value }));
  const toggleYear = (year: number) => { setSelectedYears(prev => prev.includes(year) ? (prev.length === 1 ? prev : prev.filter(y => y !== year).sort()) : [...prev, year].sort()); };

  // Downloads
  const handleDownloadQty = () => { const headers = ['고객사', 'Model', '품번', '품명', '총계획', '총실적', '달성률(%)']; const rows = filteredQtyItems.map(item => [item.customer, item.model, item.partNo, item.partName, item.totalPlan, item.totalActual, item.rate.toFixed(1)]); downloadCSV(`매출수량_현황_${selectedQtyCustomer}`, headers, rows); };
  const handleDownloadRev = () => { const headers = ['연도', '월', '고객사', 'Model', '매출수량', '매출금액']; const rows = filteredRevItems.map(item => [item.year, item.month, item.customer, item.model, item.qty, item.amount]); downloadCSV(`매출금액_현황`, headers, rows); };
  const handleDownloadRfq = () => { const headers = ['순번', '고객사', '제품군', '프로젝트명', '공정단계', '현상태', '시작일', '견적일', '최초주문일', 'Model', '월평균수량', '예상단가', '예상매출', '비고']; const rows = filteredRfqItems.map(item => [item.index, item.customer, item.projectType, item.projectName, item.process, item.status, item.dateSelection, item.dateQuotation, item.datePO, item.model, item.qty, item.unitPrice, item.amount, item.remark]); downloadCSV(`RFQ_현황`, headers, rows); };

  // Helper
  const getYearColor = (year: number) => { const colors:any = { 2023: '#94a3b8', 2024: '#3b82f6', 2025: '#10b981', 2026: '#f59e0b', 2022: '#64748b' }; return colors[year] || '#6366f1'; };
  const formatBillionLabel = (value: number) => value === 0 ? '' : `${(value / 100000000).toFixed(1)}억`;
  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#94a3b8'];
  const SUB_TABS = [{ id: 'yearly', label: '년도별 매출현황' }, { id: 'sales', label: '매출현황' }, { id: 'rfq', label: 'RFQ 현황' }, { id: 'cr', label: 'CR 현황' }];

  // Helper component for table headers
  const SortableHeader = <T,>({ label, sortKey, align = 'left', currentSort, onSort }: { label: string, sortKey: keyof T, align?: string, currentSort: { key: keyof T, direction: 'asc' | 'desc' } | null, onSort: (key: keyof T) => void }) => (
    <th 
        className={`px-4 py-3 min-w-[${String(sortKey) === 'index' ? '50px' : '100px'}] ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group`}
        onClick={() => onSort(sortKey)}
    >
        <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'}`}>
            {label}
            <span className={`text-[10px] ${currentSort?.key === sortKey ? 'text-blue-600 font-bold' : 'text-slate-300 group-hover:text-slate-400'}`}>
                {currentSort?.key === sortKey 
                    ? (currentSort.direction === 'asc' ? '▲' : '▼') 
                    : '⇅'
                }
            </span>
        </div>
    </th>
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-1 border-b border-slate-200 pb-1 mb-8 overflow-x-auto">
        {SUB_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveSubTab(tab.id as any)} className={`px-5 py-3 text-sm font-bold transition-all relative whitespace-nowrap ${activeSubTab === tab.id ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                {tab.label} {activeSubTab === tab.id && (<span className="absolute bottom-[-5px] left-0 w-full h-1 bg-blue-600 rounded-t-full"></span>)}
            </button>
        ))}
      </div>

      {activeSubTab === 'yearly' && (
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div><h2 className="text-xl font-black text-slate-800">년도별 매출현황 (Yearly Revenue)</h2><p className="text-xs text-slate-500 mt-1">고객사별 매출 금액 현황 및 년도별 추이 분석</p></div>
          <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
            <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-3 border border-slate-200">
              <span className="text-xs font-bold text-slate-500">조회 년도:</span>
              <div className="flex gap-2">{availableYears.map(year => (<button key={year} onClick={() => toggleYear(year)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${selectedYears.includes(year) ? 'text-white shadow-sm' : 'bg-white text-slate-400 hover:bg-slate-100'}`} style={{ backgroundColor: selectedYears.includes(year) ? getYearColor(year) : undefined }}>{year}</button>))}</div>
            </div>
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
               <select value={uploadYear} onChange={(e) => setUploadYear(Number(e.target.value))} className="bg-white border-none text-xs font-bold text-slate-700 rounded-lg py-1.5 px-2 outline-none focus:ring-0 cursor-pointer hover:bg-slate-50">
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년 업로드</option>)}
              </select>
              <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap">파일선택<input type="file" accept=".csv" onChange={handleRevFileUpload} className="hidden" /></label>
            </div>
            <select value={selectedRevCustomer} onChange={(e) => setSelectedRevCustomer(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[150px]">{revCustomers.map(c => (<option key={c} value={c}>{c}</option>))}</select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard label="총 매출 실적 (Amount)" value={`₩${activeRevData.totalAmount.toLocaleString()}`} subValue={selectedYears.length > 1 ? `${selectedYears.join(', ')}년 합계` : `${selectedYears[0]}년 전체`} trend="up" percentage={0} color="blue" />
          <MetricCard label="검색된 품목 수" value={`${filteredRevItems.length}개`} subValue={`총 ${activeRevData.items.length}개 중`} color="slate" />
          <MetricCard label="데이터 기간" value={selectedYears.sort().join(' & ')} subValue="선택된 연도 분석" color="slate" />
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6"><span className="w-1 h-5 bg-blue-600 rounded-full"></span>월별 매출 금액 추이 ({selectedYears.join(', ')})</h3>
          <div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={revChartData} margin={{ top: 30, right: 20, bottom: 20, left: 20 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500}} /><YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} /><Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f8fafc' }} formatter={(value: number) => `₩${value.toLocaleString()}`} /><Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />{selectedYears.map(year => (<Bar key={year} name={`${year}년 매출`} dataKey={year} fill={getYearColor(year)} radius={[4, 4, 0, 0]} barSize={selectedYears.length > 1 ? 20 : 40}><LabelList dataKey={year} position="top" formatter={formatBillionLabel} style={{ fill: getYearColor(year), fontSize: '11px', fontWeight: 'bold' }} /></Bar>))}</BarChart></ResponsiveContainer></div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4"><h3 className="font-black text-slate-800 flex items-center gap-2"><span className="w-1 h-5 bg-amber-500 rounded-full"></span>업체별 매출 점유율 (Top Clients)</h3><span className="text-xs text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-lg">{selectedYears.join(', ')}년 합계 기준</span></div>
          <div className="flex flex-col md:flex-row items-center justify-center gap-8">
            <div className="h-[300px] w-full md:w-1/2 min-w-[300px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={customerShareData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} fill="#8884d8" paddingAngle={2} dataKey="value" label={({ name, percent }) => `${(percent * 100).toFixed(1)}%`} labelLine={false}>{customerShareData.map((entry, index) => (<Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />))}</Pie><Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} formatter={(value: number) => `₩${value.toLocaleString()}`} /></PieChart></ResponsiveContainer></div>
            <div className="w-full md:w-1/2 flex flex-col gap-3">{customerShareData.map((entry, index) => (<div key={index} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="text-xs font-bold text-slate-700">{entry.name}</span></div><div className="text-right"><span className="block text-xs font-black text-slate-800">₩{entry.value.toLocaleString()}</span><span className="block text-[10px] text-slate-400">{((entry.value / activeRevData.totalAmount) * 100).toFixed(1)}%</span></div></div>))}</div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-4"><button onClick={() => setRevListOpen(!revListOpen)} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"><svg className={`w-5 h-5 transition-transform ${revListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>상세 품목 리스트 (Revenue List)</button><button onClick={handleDownloadRev} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>엑셀 다운로드</button></div>
            {revListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                        <SortableHeader label="연도" sortKey="year" currentSort={revSortConfig} onSort={handleRevSort} />
                        <SortableHeader label="월" sortKey="month" currentSort={revSortConfig} onSort={handleRevSort} />
                        <SortableHeader label="고객사" sortKey="customer" currentSort={revSortConfig} onSort={handleRevSort} />
                        <SortableHeader label="Model" sortKey="model" currentSort={revSortConfig} onSort={handleRevSort} />
                        <SortableHeader label="매출수량" sortKey="qty" align="right" currentSort={revSortConfig} onSort={handleRevSort} />
                        <SortableHeader label="매출금액" sortKey="amount" align="right" currentSort={revSortConfig} onSort={handleRevSort} />
                    </tr>
                    <tr className="bg-slate-50"><th className="px-2 py-2"><input type="text" placeholder="연도" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.year} onChange={(e) => handleRevFilterChange('year', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="월" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.month} onChange={(e) => handleRevFilterChange('month', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="고객사" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.customer} onChange={(e) => handleRevFilterChange('customer', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="Model" className="w-full p-1 border rounded text-xs font-normal" value={revFilter.model} onChange={(e) => handleRevFilterChange('model', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={revFilter.qty} onChange={(e) => handleRevFilterChange('qty', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={revFilter.amount} onChange={(e) => handleRevFilterChange('amount', e.target.value)} /></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRevItems.map((item) => (<tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-3 text-slate-600 font-mono">{item.year}</td><td className="px-4 py-3 text-slate-600">{item.month}</td><td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td><td className="px-4 py-3 text-slate-600">{item.model}</td><td className="px-4 py-3 text-right font-mono">{item.qty.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono font-bold text-blue-600">₩{item.amount.toLocaleString()}</td></tr>))}
                    {filteredRevItems.length === 0 && (<tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>)}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200"><tr><td colSpan={4} className="px-4 py-3 text-center">합계 (Total)</td><td className="px-4 py-3 text-right font-mono">{filteredRevTotal.qty.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono text-blue-700">₩{filteredRevTotal.amount.toLocaleString()}</td></tr></tfoot>
                </table>
              </div>
            )}
        </div>
      </section>
      )}

      {activeSubTab === 'sales' && (
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div><h2 className="text-xl font-black text-slate-800">매출현황 (Sales Status)</h2><p className="text-xs text-slate-500 mt-1">계획 수량 대비 실적 수량 상세 분석</p></div>
          <div className="flex gap-4 items-center"><label className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors">📂 수량 CSV 업로드<input type="file" accept=".csv" onChange={handleQtyFileUpload} className="hidden" /></label><select value={selectedQtyCustomer} onChange={(e) => setSelectedQtyCustomer(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[200px]">{qtyCustomers.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><MetricCard label="총 실적 수량 (Total Actual)" value={`${activeQtyData.totalActual.toLocaleString()} EA`} subValue={`계획: ${activeQtyData.totalPlan.toLocaleString()} EA`} trend={qtyAchievementRate >= 100 ? 'up' : 'neutral'} percentage={parseFloat((qtyAchievementRate - 100).toFixed(1))} color="emerald" /><MetricCard label="검색된 품목 수" value={`${filteredQtyItems.length}개`} subValue={`총 ${activeQtyData.items.length}개 중`} color="slate" /><MetricCard label="분석 대상" value={selectedQtyCustomer === 'All' ? '전체 고객사' : selectedQtyCustomer} subValue="2024년 데이터" color="slate" /></div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-8"><h3 className="font-black text-slate-800 flex items-center gap-2"><span className="w-1 h-5 bg-emerald-600 rounded-full"></span>1. 월별 계획수량(Plan) vs 실적수량(Actual) 추이</h3></div>
          <div className="h-[400px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={qtyChartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500}} /><YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} /><Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f8fafc' }} formatter={(value: number) => value.toLocaleString()} /><Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} /><Bar name="계획수량 (Plan)" dataKey="plan" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={30} /><Bar name="실적수량 (Actual)" dataKey="actual" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} /><Line type="monotone" name="실적추세" dataKey="actual" stroke="#059669" strokeWidth={3} dot={{r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff'}} /></ComposedChart></ResponsiveContainer></div>
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4"><button onClick={() => setQtyListOpen(!qtyListOpen)} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-emerald-600 transition-colors"><svg className={`w-5 h-5 transition-transform ${qtyListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>상세 품목 리스트 (Quantity List)</button><button onClick={handleDownloadQty} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>엑셀 다운로드</button></div>
            {qtyListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                        <SortableHeader label="고객사" sortKey="customer" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="Model" sortKey="model" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="품번" sortKey="partNo" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="품명" sortKey="partName" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="총계획" sortKey="totalPlan" align="right" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="총실적" sortKey="totalActual" align="right" currentSort={qtySortConfig} onSort={handleQtySort} />
                        <SortableHeader label="달성률" sortKey="rate" align="center" currentSort={qtySortConfig} onSort={handleQtySort} />
                    </tr>
                    <tr className="bg-slate-50"><th className="px-2 py-2"><input type="text" placeholder="고객사 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.customer} onChange={(e) => handleQtyFilterChange('customer', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="Model 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.model} onChange={(e) => handleQtyFilterChange('model', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="품번 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partNo} onChange={(e) => handleQtyFilterChange('partNo', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="품명 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partName} onChange={(e) => handleQtyFilterChange('partName', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="계획" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.plan} onChange={(e) => handleQtyFilterChange('plan', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="실적" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.actual} onChange={(e) => handleQtyFilterChange('actual', e.target.value)} /></th><th className="px-2 py-2"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQtyItems.map((item) => (<tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td><td className="px-4 py-3 text-slate-600">{item.model}</td><td className="px-4 py-3 font-mono text-slate-500">{item.partNo}</td><td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={item.partName}>{item.partName}</td><td className="px-4 py-3 text-right font-mono text-slate-500">{item.totalPlan.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{item.totalActual.toLocaleString()}</td><td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-md font-bold text-[10px] ${item.rate >= 100 ? 'bg-emerald-100 text-emerald-700' : item.rate >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{item.rate.toFixed(1)}%</span></td></tr>))}
                     {filteredQtyItems.length === 0 && (<tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>)}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200"><tr><td colSpan={4} className="px-4 py-3 text-center">합계 (Total)</td><td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.plan.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.actual.toLocaleString()}</td><td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-md font-bold text-[10px] ${filteredQtyTotal.rate >= 100 ? 'bg-emerald-100 text-emerald-700' : filteredQtyTotal.rate >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{filteredQtyTotal.rate.toFixed(1)}%</span></td></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {/* =================================================================================
          3. RFQ TAB (Fully Implemented with Edit and Enhanced Table)
         ================================================================================= */}
      {activeSubTab === 'rfq' && (
         <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-slate-800">RFQ 현황 (Request for Quotation)</h2>
                    <p className="text-xs text-slate-500 mt-1">신규 프로젝트 수주 및 견적 진행 현황 관리</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsEditingRFQ(!isEditingRFQ)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${isEditingRFQ ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                        {isEditingRFQ ? '💾 편집 종료 (저장)' : '✏️ 직접 입력/수정'}
                    </button>
                    {isEditingRFQ && (
                        <button
                            onClick={handleAddRfqRow}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2"
                        >
                            ➕ 행 추가
                        </button>
                    )}
                    <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                        <span>⚙️ RFQ CSV 업로드</span>
                        <input type="file" accept=".csv" onChange={handleRfqFileUpload} className="hidden" />
                    </label>
                </div>
            </div>

            {/* RFQ Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <MetricCard label="전체 프로젝트 수" value={`${rfqMetrics.totalProjects}건`} color="slate" />
                <MetricCard label="총 예상 매출액" value={`₩${(rfqMetrics.totalAmount / 100000000).toFixed(1)}억`} subValue="전체 안건 합계" color="blue" />
                <MetricCard label="수주 성공율 (Win Rate)" value={`${rfqMetrics.winRate.toFixed(1)}%`} subValue="양산/수주 확정 기준" trend={rfqMetrics.winRate > 30 ? 'up' : 'neutral'} color="emerald" />
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div className="flex-1">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">상태별 분포</p>
                        <div className="h-24 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={rfqMetrics.chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                    <XAxis 
                                        dataKey="status" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{fontSize: 10, fill: '#64748b', fontWeight: 'bold'}} 
                                        interval={0}
                                    />
                                    <Bar dataKey="count" radius={[4, 4, 4, 4]} barSize={30}>
                                        {rfqMetrics.chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.status.includes('양산') ? '#10b981' : entry.status.includes('실패') || entry.status.includes('포기') ? '#ef4444' : '#f59e0b'} />
                                        ))}
                                    </Bar>
                                    <Tooltip cursor={{fill: 'transparent'}} contentStyle={{fontSize: '10px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            {/* RFQ List Table */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <button onClick={() => setRfqListOpen(!rfqListOpen)} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors">
                        <svg className={`w-5 h-5 transition-transform ${rfqListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        상세 리스트 (RFQ List)
                    </button>
                    <button onClick={handleDownloadRfq} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        엑셀 다운로드
                    </button>
                </div>

                {rfqListOpen && (
                    <div className="overflow-x-auto border border-slate-200 rounded-2xl pb-4">
                        {/* Datalist for Customer Autocomplete */}
                        <datalist id="customer-list">
                            {uniqueRfqCustomers.map(c => <option key={c} value={c} />)}
                        </datalist>

                        <table className="w-full text-xs text-left whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                                <tr>
                                    {isEditingRFQ && <th className="px-2 py-3 min-w-[30px] text-center sticky left-0 bg-slate-50 z-10">삭제</th>}
                                    <SortableHeader label="순번" sortKey="index" align="center" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="고객사" sortKey="customer" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="제품군" sortKey="projectType" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="프로젝트명" sortKey="projectName" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="공정단계" sortKey="process" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="현상태" sortKey="status" align="center" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="시작일" sortKey="dateSelection" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="견적일" sortKey="dateQuotation" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="최초주문일" sortKey="datePO" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="Model" sortKey="model" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="월평균수량" sortKey="qty" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="예상단가" sortKey="unitPrice" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="예상매출" sortKey="amount" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                    <SortableHeader label="비고" sortKey="remark" currentSort={rfqSortConfig} onSort={handleRfqSort} />
                                </tr>
                                <tr className="bg-slate-50">
                                    {isEditingRFQ && <th className="px-2 py-2 sticky left-0 bg-slate-50 z-10"></th>}
                                    <th className="px-2 py-2"></th>
                                    <th className="px-2 py-2"><input type="text" placeholder="고객사" className="w-full p-1 border rounded text-xs font-normal" value={rfqFilter.customer} onChange={(e) => handleRfqFilterChange('customer', e.target.value)} /></th>
                                    <th className="px-2 py-2"><input type="text" placeholder="제품군" className="w-full p-1 border rounded text-xs font-normal" value={rfqFilter.type} onChange={(e) => handleRfqFilterChange('type', e.target.value)} /></th>
                                    <th className="px-2 py-2"><input type="text" placeholder="프로젝트" className="w-full p-1 border rounded text-xs font-normal" value={rfqFilter.project} onChange={(e) => handleRfqFilterChange('project', e.target.value)} /></th>
                                    <th className="px-2 py-2"></th>
                                    <th className="px-2 py-2"><input type="text" placeholder="상태" className="w-full p-1 border rounded text-xs font-normal text-center" value={rfqFilter.status} onChange={(e) => handleRfqFilterChange('status', e.target.value)} /></th>
                                    <th className="px-2 py-2" colSpan={3}></th>
                                    <th className="px-2 py-2"><input type="text" placeholder="모델" className="w-full p-1 border rounded text-xs font-normal" value={rfqFilter.model} onChange={(e) => handleRfqFilterChange('model', e.target.value)} /></th>
                                    <th className="px-2 py-2" colSpan={4}></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredRfqItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50">
                                        {isEditingRFQ && (
                                            <td className="px-2 py-3 text-center sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                                <button 
                                                    type="button"
                                                    onClick={(e) => handleDeleteRfqRow(item.id, e)} 
                                                    className="bg-rose-50 text-rose-500 hover:bg-rose-100 hover:text-rose-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs transition-colors" 
                                                    title="삭제"
                                                >
                                                    ✕
                                                </button>
                                            </td>
                                        )}
                                        <td className="px-4 py-3 text-center text-slate-400 font-mono">
                                            {isEditingRFQ ? (
                                                <input type="text" value={item.index} onChange={(e) => handleRfqChange(item.id, 'index', e.target.value)} className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.index}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-slate-800">
                                            {isEditingRFQ ? (
                                                <input 
                                                    type="text" 
                                                    list="customer-list"
                                                    value={item.customer} 
                                                    onChange={(e) => handleRfqChange(item.id, 'customer', e.target.value)} 
                                                    className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" 
                                                />
                                            ) : item.customer}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">
                                            {isEditingRFQ ? (
                                                <input type="text" value={item.projectType} onChange={(e) => handleRfqChange(item.id, 'projectType', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.projectType}
                                        </td>
                                        <td className="px-4 py-3 text-slate-700">
                                            {isEditingRFQ ? (
                                                <input type="text" value={item.projectName} onChange={(e) => handleRfqChange(item.id, 'projectName', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.projectName}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">
                                            {isEditingRFQ ? (
                                                <select 
                                                    value={item.process} 
                                                    onChange={(e) => handleRfqChange(item.id, 'process', e.target.value)} 
                                                    className="w-full bg-white border border-blue-200 rounded px-1 py-0.5"
                                                >
                                                    <option value="">선택</option>
                                                    {RFQ_PROCESS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                </select>
                                            ) : item.process}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {isEditingRFQ ? (
                                                <select
                                                    value={item.status} 
                                                    onChange={(e) => handleRfqChange(item.id, 'status', e.target.value)} 
                                                    className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5"
                                                >
                                                    <option value="">선택</option>
                                                    {RFQ_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                </select>
                                            ) : (
                                                <span className={`px-2 py-1 rounded-md font-bold text-[10px] ${
                                                    item.status.includes('양산') || item.status.includes('수주') ? 'bg-emerald-100 text-emerald-700' :
                                                    item.status.includes('실패') || item.status.includes('포기') || item.status.includes('Drop') ? 'bg-rose-100 text-rose-700' :
                                                    item.status.includes('검토') || item.status.includes('분석') ? 'bg-amber-100 text-amber-700' :
                                                    'bg-slate-100 text-slate-600'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                            {isEditingRFQ ? (
                                                <input type="date" value={item.dateSelection} onChange={(e) => handleRfqChange(item.id, 'dateSelection', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.dateSelection}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                            {isEditingRFQ ? (
                                                <input type="date" value={item.dateQuotation} onChange={(e) => handleRfqChange(item.id, 'dateQuotation', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.dateQuotation}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                            {isEditingRFQ ? (
                                                <input type="date" value={item.datePO} onChange={(e) => handleRfqChange(item.id, 'datePO', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.datePO}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 font-mono">
                                            {isEditingRFQ ? (
                                                <input type="text" value={item.model} onChange={(e) => handleRfqChange(item.id, 'model', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.model}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {isEditingRFQ ? (
                                                <input type="number" value={item.qty} onChange={(e) => handleRfqChange(item.id, 'qty', e.target.value)} className="w-full text-right bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.qty.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-500">
                                            {isEditingRFQ ? (
                                                <input type="number" value={item.unitPrice} onChange={(e) => handleRfqChange(item.id, 'unitPrice', e.target.value)} className="w-full text-right bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : `₩${item.unitPrice.toLocaleString()}`}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">
                                            {isEditingRFQ ? (
                                                <input type="number" value={item.amount} onChange={(e) => handleRfqChange(item.id, 'amount', e.target.value)} className="w-full text-right bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : `₩${item.amount.toLocaleString()}`}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-400 truncate max-w-[200px]" title={item.remark}>
                                            {isEditingRFQ ? (
                                                <input type="text" value={item.remark} onChange={(e) => handleRfqChange(item.id, 'remark', e.target.value)} className="w-full bg-white border border-blue-200 rounded px-1 py-0.5" />
                                            ) : item.remark}
                                        </td>
                                    </tr>
                                ))}
                                {filteredRfqItems.length === 0 && (
                                    <tr><td colSpan={isEditingRFQ ? 15 : 14} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
         </div>
      )}

      {/* =================================================================================
          4. CR TAB (Detailed View with Edit Support)
         ================================================================================= */}
      {activeSubTab === 'cr' && (
         <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
               {/* Header and Controls */}
               <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                  <div>
                     <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                        CR (Cost Reduction) 현황
                        <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded">단위: 백만원</span>
                     </h2>
                     <p className="text-sm text-slate-500 mt-1">고객사별 CR 목표 대비 달성률 및 VI 비율 분석 (월별 상세)</p>
                  </div>
                  <div className="flex gap-2">
                     <button
                        onClick={() => setIsEditingCR(!isEditingCR)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${isEditingCR ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                     >
                        {isEditingCR ? '💾 편집 종료 (저장)' : '✏️ 실적 직접 입력'}
                     </button>
                     <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                        <span>📁 CR 데이터 업로드 (CSV)</span>
                        <input type="file" accept=".csv" onChange={handleCRFileUpload} className="hidden" />
                     </label>
                  </div>
               </div>

               {/* CR Table */}
               <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
                  <table className="w-full text-xs text-center border-collapse">
                     <thead className="bg-[#fcf8e3] text-slate-800 font-bold border-b-2 border-slate-300">
                        <tr>
                           <th colSpan={2} className="px-4 py-3 border-r border-slate-300 bg-[#f0f0d0]">구분</th>
                           {crTableData.monthly.map(item => (
                              <th key={item.month} className="px-2 py-3 border-r border-slate-300 min-w-[60px]">{item.month}</th>
                           ))}
                           <th className="px-4 py-3 bg-[#f0f0d0]">합계</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                        {/* 1. 전체 가공 매출액 */}
                        <tr className="hover:bg-slate-50">
                           <td rowSpan={10} className="px-4 py-3 border-r border-slate-300 font-bold bg-white w-[100px]">매출<br/>CR</td>
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-slate-50 text-left pl-4">전체 가공 매출액</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.totalSales}
                                        onChange={(e) => handleCrChange(item.month, 'totalSales', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                 ) : item.totalSales.toLocaleString()}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold bg-slate-50">{crTableData.total.totalSales.toLocaleString()}</td>
                        </tr>
                        {/* 2. LG 매출액 */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4">LG 매출액</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-slate-600">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.lgSales}
                                        onChange={(e) => handleCrChange(item.month, 'lgSales', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                 ) : item.lgSales.toLocaleString()}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold">{crTableData.total.lgSales.toLocaleString()}</td>
                        </tr>
                        {/* 3. LG 인하금액 */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4">LG 인하금액합계</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-slate-600">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.lgCR}
                                        onChange={(e) => handleCrChange(item.month, 'lgCR', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                 ) : item.lgCR.toFixed(1)}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold">{crTableData.total.lgCR.toFixed(1)}</td>
                        </tr>
                        {/* 4. LG VI율 (Calculated) */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4 text-emerald-600">LG VI율</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-emerald-500 font-medium">
                                 {item.lgSales > 0 ? ((item.lgCR / item.lgSales) * 100).toFixed(2) : '0.00'}%
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold text-emerald-600">
                              {crTableData.total.lgSales > 0 ? ((crTableData.total.lgCR / crTableData.total.lgSales) * 100).toFixed(2) : '0.00'}%
                           </td>
                        </tr>
                        {/* 5. MTX 매출액 */}
                        <tr className="hover:bg-slate-50 border-t border-slate-200">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4">MTX 매출액</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-slate-600">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.mtxSales}
                                        onChange={(e) => handleCrChange(item.month, 'mtxSales', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                 ) : item.mtxSales.toLocaleString()}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold">{crTableData.total.mtxSales.toLocaleString()}</td>
                        </tr>
                        {/* 6. MTX 인하금액 */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4">MTX 인하금액합계</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-slate-600">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.mtxCR}
                                        onChange={(e) => handleCrChange(item.month, 'mtxCR', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
                                    />
                                 ) : item.mtxCR.toFixed(1)}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold">{crTableData.total.mtxCR.toFixed(1)}</td>
                        </tr>
                        {/* 7. MTX VI율 */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4 text-emerald-600">MTX VI율</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-emerald-500 font-medium">
                                 {item.mtxSales > 0 ? ((item.mtxCR / item.mtxSales) * 100).toFixed(2) : '0.00'}%
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold text-emerald-600">
                              {crTableData.total.mtxSales > 0 ? ((crTableData.total.mtxCR / crTableData.total.mtxSales) * 100).toFixed(2) : '0.00'}%
                           </td>
                        </tr>
                        {/* 8. Total VI Rate */}
                        <tr className="bg-slate-50 font-bold">
                           <td className="px-2 py-3 border-r border-slate-200 text-left pl-4 border-y-2 border-slate-300">A. 매출 VI율</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 border-y-2 border-slate-300">
                                 {item.totalSales > 0 ? (((item.lgCR + item.mtxCR) / item.totalSales) * 100).toFixed(2) : '0.00'}%
                              </td>
                           ))}
                           <td className="px-2 py-3 border-y-2 border-slate-300">
                              {crTableData.total.totalSales > 0 ? (((crTableData.total.lgCR + crTableData.total.mtxCR) / crTableData.total.totalSales) * 100).toFixed(2) : '0.00'}%
                           </td>
                        </tr>
                        {/* 9. LG Defense Rate */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4 text-rose-600">LG VI 방어 달성율</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-rose-500 font-bold">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.lgDefense}
                                        onChange={(e) => handleCrChange(item.month, 'lgDefense', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500 text-rose-500 font-bold"
                                    />
                                 ) : `${item.lgDefense}%`}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold text-rose-600">{crTableData.total.lgDefense}%</td>
                        </tr>
                        {/* 10. MTX Defense Rate */}
                        <tr className="hover:bg-slate-50">
                           <td className="px-2 py-3 border-r border-slate-200 font-bold bg-white text-left pl-4 text-rose-600">MTX VI 방어 달성율</td>
                           {crTableData.monthly.map((item, i) => (
                              <td key={i} className="px-2 py-3 border-r border-slate-200 text-rose-500 font-bold">
                                 {isEditingCR ? (
                                    <input 
                                        type="number" 
                                        value={item.mtxDefense}
                                        onChange={(e) => handleCrChange(item.month, 'mtxDefense', e.target.value)}
                                        className="w-full text-center bg-white border border-blue-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500 text-rose-500 font-bold"
                                    />
                                 ) : `${item.mtxDefense}%`}
                              </td>
                           ))}
                           <td className="px-2 py-3 font-bold text-rose-600">{crTableData.total.mtxDefense}%</td>
                        </tr>
                     </tbody>
                  </table>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};

export default SalesView;
