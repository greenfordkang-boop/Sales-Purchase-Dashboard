
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import MetricCard from './MetricCard';
import { safeSetItem } from '../utils/safeStorage';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, PieChart, Pie, Cell } from 'recharts';
import { parseSalesCSV, CustomerSalesData, SalesItem } from '../utils/salesDataParser';
import { parseCRCSV, CRItem } from '../utils/crDataParser';
import { parseRFQCSV, RFQItem } from '../utils/rfqDataParser';
import { parseRevenueCSV, parseItemRevenueCSV, RevenueItem, ItemRevenueRow } from '../utils/revenueDataParser';
import { INITIAL_CSV_DATA } from '../data/initialSalesData';
import { INITIAL_CR_CSV } from '../data/initialCRData';
import { INITIAL_RFQ_CSV } from '../data/initialRfqData';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { salesService, crService, rfqService, revenueService, itemRevenueService } from '../services/supabaseService';
import SalesForecast from './SalesForecast';
import type { ForecastItem, ForecastSummary } from '../utils/salesForecastParser';
import { useColumnResize } from '../hooks/useColumnResize';

// Options for Dropdowns
const RFQ_PROCESS_OPTIONS = ['I', 'I/S', 'I/S/A', 'I/S/P', 'I/S/P/A', '선행', '기타'];
const RFQ_STATUS_OPTIONS = ['양산', '수주', '수주 검토', '개발', '개발 Drop', '가격 검토', '가격 분석', '수주 실패', '수주 포기', '진행중'];

// Month Filter Options
const MONTH_OPTIONS = [
  { value: 'all', label: '전체 (누적)' },
  { value: '01', label: '1월' }, { value: '02', label: '2월' }, { value: '03', label: '3월' },
  { value: '04', label: '4월' }, { value: '05', label: '5월' }, { value: '06', label: '6월' },
  { value: '07', label: '7월' }, { value: '08', label: '8월' }, { value: '09', label: '9월' },
  { value: '10', label: '10월' }, { value: '11', label: '11월' }, { value: '12', label: '12월' },
];

// Excel/CSV 파일을 CSV 텍스트로 변환
const readFileAsCSVText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const csvText = XLSX.utils.sheet_to_csv(firstSheet);
          resolve(csvText);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve((event.target?.result as string) || '');
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsText(file);
    }
  });
};

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


  // 3. CR Data Initializer
  const getInitialCRData = (): CRItem[] => {
    if (typeof window === 'undefined') return parseCRCSV(INITIAL_CR_CSV, 2025);
    try {
      const stored = localStorage.getItem('dashboard_crData');
      if (stored) {
        const parsed: CRItem[] = JSON.parse(stored);
        // Backward compat: add year=2025 if missing
        return parsed.map(item => ({ ...item, year: item.year || 2025 }));
      }
      return parseCRCSV(INITIAL_CR_CSV, 2025);
    } catch (e) {
        return parseCRCSV(INITIAL_CR_CSV, 2025);
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

  // 5. Revenue Data Initializer
  const getInitialRevenueData = (): RevenueItem[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('dashboard_revenueData');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Failed to load revenue data", e);
      return [];
    }
  };

  // --- State Management ---
  const [activeSubTab, setActiveSubTab] = useState<'forecast' | 'sales' | 'unitprice' | 'cr'>('forecast');

  // Quantity States
  const [salesData, setSalesData] = useState<CustomerSalesData[]>(getInitialSalesData);
  const [selectedQtyCustomer, setSelectedQtyCustomer] = useState<string>('All');
  const [selectedQtyMonth, setSelectedQtyMonth] = useState<string>('all');
  const [qtyChartData, setQtyChartData] = useState<any[]>([]);
  const [qtyListOpen, setQtyListOpen] = useState(true);
  const [qtyFilter, setQtyFilter] = useState({
    customer: '', model: '', partNo: '', partName: '', plan: '', actual: ''
  });
  const [qtySortConfig, setQtySortConfig] = useState<{ key: keyof SalesItem; direction: 'asc' | 'desc' } | null>(null);


  // CR States
  const [crData, setCrData] = useState<CRItem[]>(getInitialCRData);
  const [isEditingCR, setIsEditingCR] = useState(false);
  const [selectedCRYear, setSelectedCRYear] = useState<number>(new Date().getFullYear());

  // RFQ States
  const [rfqData, setRfqData] = useState<RFQItem[]>(getInitialRFQData);
  const [rfqListOpen, setRfqListOpen] = useState(true);
  const [isEditingRFQ, setIsEditingRFQ] = useState(false);
  const [rfqFilter, setRfqFilter] = useState({
    customer: '', project: '', status: '', model: '', type: ''
  });
  const [rfqSortConfig, setRfqSortConfig] = useState<{ key: keyof RFQItem; direction: 'asc' | 'desc' } | null>(null);

  // Revenue States (고객사별 매출현황)
  const [revenueData, setRevenueData] = useState<RevenueItem[]>(getInitialRevenueData);
  const [selectedRevenueYear, setSelectedRevenueYear] = useState<number>(2026);
  const [selectedRevenueMonth, setSelectedRevenueMonth] = useState<string>('all');
  const [selectedRevenueCustomer, setSelectedRevenueCustomer] = useState<string>('All');
  const [revenueListOpen, setRevenueListOpen] = useState(false);
  const [revenueFilter, setRevenueFilter] = useState({
    month: '', customer: '', model: '', qty: '', amount: ''
  });
  const [revenueSortConfig, setRevenueSortConfig] = useState<{ key: keyof RevenueItem; direction: 'asc' | 'desc' } | null>(null);
  const [isUploadingRevenue, setIsUploadingRevenue] = useState(false);

  // 매출계획 데이터 (forecast) - 계획 대비 실적 비교용
  const [forecastItems, setForecastItems] = useState<ForecastItem[]>([]);
  const [forecastSummary, setForecastSummary] = useState<ForecastSummary | null>(null);

  // 매출계획 데이터 로드 (탭 전환 시마다 최신 데이터 반영)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dashboard_forecastData');
      if (stored) setForecastItems(JSON.parse(stored));
      else setForecastItems([]);
      const storedSummary = localStorage.getItem('dashboard_forecastData_summary');
      if (storedSummary) setForecastSummary(JSON.parse(storedSummary));
      else setForecastSummary(null);
    } catch { /* ignore */ }
  }, [activeSubTab]);

  // 품목별 매출현황 필터/정렬/접기 상태
  const [itemRevenueListOpen, setItemRevenueListOpen] = useState(false);
  const [itemRevenueFilter, setItemRevenueFilter] = useState({
    model: '', partNo: '', customerPN: '', partName: '', qty: '', amount: ''
  });
  const [itemRevenueSortConfig, setItemRevenueSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // 품목별 매출현황용 데이터 (별도 업로더)
  const getInitialItemRevenueData = (): ItemRevenueRow[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('dashboard_itemRevenueData');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };
  const [itemRevenueData, setItemRevenueData] = useState<ItemRevenueRow[]>(getInitialItemRevenueData);

  // Unit Price States (단가현황)
  const [priceSortConfig, setPriceSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [priceFilter, setPriceFilter] = useState({ model: '', customer: '' });

  // --- Smart Supabase Load: 다중 사용자 동기화 ---
  // Supabase에 데이터가 있으면 사용, 없으면 localStorage 유지 (데이터 손실 방지)
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;

      try {
        // 1. Sales 데이터 로드
        try {
          const supabaseSales = await salesService.getAll();
          if (supabaseSales && supabaseSales.length > 0) {
            setSalesData(supabaseSales);
            safeSetItem('dashboard_salesData', JSON.stringify(supabaseSales));
            console.log(`✅ Supabase에서 영업 데이터 로드: ${supabaseSales.length}개 고객`);
          } else {
            console.log('ℹ️ Supabase 영업 데이터 없음 - localStorage 유지');
          }
        } catch (err) {
          console.error('Supabase 영업 데이터 로드 실패:', err);
        }

        // 2. CR 데이터 로드
        try {
          const supabaseCR = await crService.getAll();
          if (supabaseCR && supabaseCR.length > 0) {
            // Backward compat: ensure year field exists
            const withYear = supabaseCR.map(item => ({ ...item, year: item.year || 2025 }));
            setCrData(withYear);
            safeSetItem('dashboard_crData', JSON.stringify(withYear));
            console.log(`✅ Supabase에서 CR 데이터 로드: ${withYear.length}개`);
          } else {
            console.log('ℹ️ Supabase CR 데이터 없음 - localStorage 유지');
          }
        } catch (err) {
          console.error('Supabase CR 데이터 로드 실패:', err);
        }

        // 3. RFQ 데이터 로드
        try {
          const supabaseRFQ = await rfqService.getAll();
          if (supabaseRFQ && supabaseRFQ.length > 0) {
            setRfqData(supabaseRFQ);
            safeSetItem('dashboard_rfqData', JSON.stringify(supabaseRFQ));
            console.log(`✅ Supabase에서 RFQ 데이터 로드: ${supabaseRFQ.length}개`);
          } else {
            console.log('ℹ️ Supabase RFQ 데이터 없음 - localStorage 유지');
          }
        } catch (err) {
          console.error('Supabase RFQ 데이터 로드 실패:', err);
        }

        // 4. Revenue 데이터 로드 (고객사별 매출현황)
        try {
          const supabaseRevenue = await revenueService.getAll();
          if (supabaseRevenue && supabaseRevenue.length > 0) {
            setRevenueData(supabaseRevenue);
            safeSetItem('dashboard_revenueData', JSON.stringify(supabaseRevenue));
            console.log(`✅ Supabase에서 매출 데이터 로드: ${supabaseRevenue.length}개`);
          } else {
            console.log('ℹ️ Supabase 매출 데이터 없음 - localStorage 유지');
          }
        } catch (err) {
          console.error('Supabase 매출 데이터 로드 실패:', err);
        }

        // 5. Item Revenue 데이터 로드 (품목별 매출현황)
        try {
          const supabaseItemRevenue = await itemRevenueService.getAll();
          if (supabaseItemRevenue && supabaseItemRevenue.length > 0) {
            setItemRevenueData(supabaseItemRevenue);
            safeSetItem('dashboard_itemRevenueData', JSON.stringify(supabaseItemRevenue));
            console.log(`✅ Supabase에서 품목별 매출 데이터 로드: ${supabaseItemRevenue.length}개`);
          } else {
            console.log('ℹ️ Supabase 품목별 매출 데이터 없음 - localStorage 유지');
          }
        } catch (err) {
          console.error('Supabase 품목별 매출 데이터 로드 실패:', err);
        }
      } catch (err) {
        console.error('Supabase 전체 로드 실패 - localStorage 유지:', err);
      }
    };

    loadFromSupabase();
  }, []);

  // --- Persistence Effects (localStorage 저장) ---
  useEffect(() => {
    safeSetItem('dashboard_salesData', JSON.stringify(salesData));
  }, [salesData]);


  useEffect(() => {
    safeSetItem('dashboard_crData', JSON.stringify(crData));
  }, [crData]);

  useEffect(() => {
    safeSetItem('dashboard_rfqData', JSON.stringify(rfqData));
  }, [rfqData]);

  useEffect(() => {
    safeSetItem('dashboard_revenueData', JSON.stringify(revenueData));
  }, [revenueData]);

  useEffect(() => {
    safeSetItem('dashboard_itemRevenueData', JSON.stringify(itemRevenueData));
  }, [itemRevenueData]);

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


  // CR Derived
  const crYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const dataYears = crData.map(d => d.year);
    const years = Array.from(new Set([currentYear, ...dataYears])).sort((a, b) => b - a);
    return years;
  }, [crData]);

  const crTableData = useMemo(() => {
    const yearData = crData.filter(d => d.year === selectedCRYear);
    const months = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
    const emptyItem = { year: selectedCRYear, month: '', totalSales: 0, lgSales: 0, lgCR: 0, lgDefense: 0, mtxSales: 0, mtxCR: 0, mtxDefense: 0 };
    const mapped = months.map(m => yearData.find(d => d.month === m) || { ...emptyItem, month: m });
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
  }, [crData, selectedCRYear]);

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

  // Revenue Derived (고객사별 매출현황)
  const revenueYears = useMemo(() => {
    const years = Array.from(new Set(revenueData.map(d => d.year))).sort((a, b) => (b as number) - (a as number));
    return years.length > 0 ? years : [2026];
  }, [revenueData]);

  const revenueCustomers = useMemo(() => {
    const yearData = revenueData.filter(d => d.year === selectedRevenueYear);
    return ['All', ...Array.from(new Set(yearData.map(d => d.customer))).sort()];
  }, [revenueData, selectedRevenueYear]);

  const filteredRevenueData = useMemo(() => {
    let result = revenueData.filter(d => d.year === selectedRevenueYear);

    // 월 필터 적용
    if (selectedRevenueMonth !== 'all') {
      result = result.filter(d => d.month === `${selectedRevenueMonth}월` || d.month === `${parseInt(selectedRevenueMonth)}월`);
    }

    if (selectedRevenueCustomer !== 'All') {
      result = result.filter(d => d.customer === selectedRevenueCustomer);
    }

    // Apply filters (구매 리스트와 동일한 방식으로 개선)
    result = result.filter(item => {
      const matchMonth = revenueFilter.month === '' || item.month.includes(revenueFilter.month);
      const matchCustomer = revenueFilter.customer === '' || item.customer.toLowerCase().includes(revenueFilter.customer.toLowerCase());
      const matchModel = revenueFilter.model === '' || item.model.toLowerCase().includes(revenueFilter.model.toLowerCase());
      const matchQty = revenueFilter.qty === '' || item.qty.toString().includes(revenueFilter.qty.replace(/,/g, ''));
      const matchAmount = revenueFilter.amount === '' || item.amount.toString().includes(revenueFilter.amount.replace(/,/g, ''));

      return matchMonth && matchCustomer && matchModel && matchQty && matchAmount;
    });

    // Apply sorting
    if (revenueSortConfig) {
      result.sort((a, b) => {
        const aValue = a[revenueSortConfig.key];
        const bValue = b[revenueSortConfig.key];
        if (aValue === bValue) return 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return revenueSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        if (aStr < bStr) return revenueSortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return revenueSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      // 기본 정렬: 날짜 내림차순 (최신순)
      result.sort((a, b) => {
        const aMonth = parseInt(a.month.replace('월', '')) || 0;
        const bMonth = parseInt(b.month.replace('월', '')) || 0;
        return bMonth - aMonth;
      });
    }

    return result;
  }, [revenueData, selectedRevenueYear, selectedRevenueMonth, selectedRevenueCustomer, revenueFilter, revenueSortConfig]);

  const revenueMetrics = useMemo(() => {
    let yearData = revenueData.filter(d => d.year === selectedRevenueYear);
    // 월 필터 적용
    if (selectedRevenueMonth !== 'all') {
      yearData = yearData.filter(d => d.month === `${selectedRevenueMonth}월` || d.month === `${parseInt(selectedRevenueMonth)}월`);
    }
    const filtered = selectedRevenueCustomer === 'All' ? yearData : yearData.filter(d => d.customer === selectedRevenueCustomer);

    const totalAmount = filtered.reduce((sum, d) => sum + d.amount, 0);
    const totalQty = filtered.reduce((sum, d) => sum + d.qty, 0);
    const uniqueCustomers = new Set(filtered.map(d => d.customer)).size;
    const uniqueModels = new Set(filtered.map(d => d.model)).size;

    // 매출계획 데이터에서 월별 계획금액 계산
    const forecastYear = forecastSummary?.year;
    const hasForecast = forecastItems.length > 0 && forecastYear === selectedRevenueYear;
    const planMonthlyMap = new Map<number, number>(); // monthIndex (0-11) → planAmount
    if (hasForecast) {
      const filteredForecast = selectedRevenueCustomer === 'All'
        ? forecastItems
        : forecastItems.filter(fi => fi.customer === selectedRevenueCustomer);
      filteredForecast.forEach(fi => {
        fi.monthlyRevenue.forEach((rev, idx) => {
          planMonthlyMap.set(idx, (planMonthlyMap.get(idx) || 0) + rev);
        });
      });
    }

    // 월 라벨 통일 함수 ("01월" / "1월" → "1월")
    const normalizeMonth = (m: string) => {
      const num = parseInt(m.replace('월', ''));
      return `${num}월`;
    };

    // Monthly chart data (실적 + 계획)
    const monthlyMap = new Map<string, { month: string; amount: number; qty: number; planAmount: number }>();
    filtered.forEach(d => {
      const key = normalizeMonth(d.month);
      const existing = monthlyMap.get(key) || { month: key, amount: 0, qty: 0, planAmount: 0 };
      existing.amount += d.amount;
      existing.qty += d.qty;
      monthlyMap.set(key, existing);
    });

    // 계획 데이터 병합 (실적이 없는 월에도 계획이 있으면 추가)
    if (hasForecast) {
      for (let m = 0; m < 12; m++) {
        const planAmt = planMonthlyMap.get(m) || 0;
        if (planAmt <= 0) continue;
        if (selectedRevenueMonth !== 'all') {
          const filterMonth = parseInt(selectedRevenueMonth);
          if (m + 1 !== filterMonth) continue;
        }
        const monthLabel = `${m + 1}월`;
        const existing = monthlyMap.get(monthLabel) || { month: monthLabel, amount: 0, qty: 0, planAmount: 0 };
        existing.planAmount = planAmt;
        monthlyMap.set(monthLabel, existing);
      }
    }

    const chartData = Array.from(monthlyMap.values())
      .sort((a, b) => parseInt(a.month.replace('월', '')) - parseInt(b.month.replace('월', '')))
      .map(d => ({ ...d, achieveRate: d.planAmount > 0 ? (d.amount / d.planAmount) * 100 : 0 }));

    // 계획 총액
    const totalPlanAmount = hasForecast
      ? (selectedRevenueMonth !== 'all'
        ? (planMonthlyMap.get(parseInt(selectedRevenueMonth) - 1) || 0)
        : Array.from(planMonthlyMap.values()).reduce((s, v) => s + v, 0))
      : 0;

    // Customer breakdown
    const customerMap = new Map<string, number>();
    filtered.forEach(d => customerMap.set(d.customer, (customerMap.get(d.customer) || 0) + d.amount));
    const customerBreakdown = Array.from(customerMap.entries())
      .map(([customer, amount]) => ({ customer, amount, share: totalAmount > 0 ? (amount / totalAmount) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);

    return { totalAmount, totalQty, uniqueCustomers, uniqueModels, chartData, customerBreakdown, totalPlanAmount, hasForecast };
  }, [revenueData, selectedRevenueYear, selectedRevenueMonth, selectedRevenueCustomer, forecastItems, forecastSummary]);

  // 품목별 매출현황 (별도 업로더 기준, Model/품번/품명 집계)
  const itemRevenueStats = useMemo(() => {
    let filtered = [...itemRevenueData];

    if (selectedRevenueCustomer !== 'All') {
      filtered = filtered.filter(d => d.customer === selectedRevenueCustomer);
    }

    const map = new Map<string, {
      model: string;
      partNo: string;
      customerPN: string;
      partName: string;
      qty: number;
      amount: number;
    }>();

    filtered.forEach(d => {
      const key = `${d.model}|${d.partNo}|${d.partName}`;
      if (!map.has(key)) {
        map.set(key, {
          model: d.model,
          partNo: d.partNo,
          customerPN: d.customerPN,
          partName: d.partName,
          qty: 0,
          amount: 0,
        });
      }
      const item = map.get(key)!;
      item.qty += d.qty;
      item.amount += d.amount;
    });

    let items = Array.from(map.values());
    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
    let withShare = items.map(i => ({
      ...i,
      share: totalAmount > 0 ? (i.amount / totalAmount) * 100 : 0,
    }));

    // Apply filters
    withShare = withShare.filter(item => {
      const matchModel = itemRevenueFilter.model === '' || item.model.toLowerCase().includes(itemRevenueFilter.model.toLowerCase());
      const matchPartNo = itemRevenueFilter.partNo === '' || item.partNo.toLowerCase().includes(itemRevenueFilter.partNo.toLowerCase());
      const matchCustomerPN = itemRevenueFilter.customerPN === '' || (item.customerPN || '').toLowerCase().includes(itemRevenueFilter.customerPN.toLowerCase());
      const matchPartName = itemRevenueFilter.partName === '' || item.partName.toLowerCase().includes(itemRevenueFilter.partName.toLowerCase());
      const matchQty = itemRevenueFilter.qty === '' || item.qty.toString().includes(itemRevenueFilter.qty.replace(/,/g, ''));
      const matchAmount = itemRevenueFilter.amount === '' || item.amount.toString().includes(itemRevenueFilter.amount.replace(/,/g, ''));

      return matchModel && matchPartNo && matchCustomerPN && matchPartName && matchQty && matchAmount;
    });

    // Apply sorting
    if (itemRevenueSortConfig) {
      withShare.sort((a, b) => {
        const aValue = a[itemRevenueSortConfig.key as keyof typeof a];
        const bValue = b[itemRevenueSortConfig.key as keyof typeof b];
        if (aValue === bValue) return 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return itemRevenueSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        if (aStr < bStr) return itemRevenueSortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return itemRevenueSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      // 기본 정렬: 매출금액 내림차순
      withShare.sort((a, b) => b.amount - a.amount);
    }

    return { items: withShare, totalAmount, totalQty };
  }, [itemRevenueData, selectedRevenueCustomer, itemRevenueFilter, itemRevenueSortConfig]);

  const revenueTotal = useMemo(() => {
    const totalAmount = filteredRevenueData.reduce((sum, d) => sum + d.amount, 0);
    const totalQty = filteredRevenueData.reduce((sum, d) => sum + d.qty, 0);
    return { totalAmount, totalQty };
  }, [filteredRevenueData]);

  // --- Derived Data for PRICE Tab (단가현황) ---
  // 고객사별 매출현황 데이터(선택된 연도)만 사용
  const yearFilteredRevenueData = useMemo(() => {
    return revenueData.filter(d => d.year === selectedRevenueYear);
  }, [revenueData, selectedRevenueYear]);

  const priceStats = useMemo(() => {
    const map = new Map<string, {
      model: string;
      customer: string;
      latestPrice: number;
      maxPrice: number;
      minPrice: number;
      avgPrice: number;
      totalQty: number;
      count: number;
      latestMonth: string;
    }>();

    yearFilteredRevenueData.forEach(item => {
      if (item.qty === 0) return; // Skip zero quantity items
      const unitPrice = item.amount / item.qty;
      const key = `${item.model}_${item.customer}`;

      if (!map.has(key)) {
        map.set(key, {
          model: item.model,
          customer: item.customer,
          latestPrice: unitPrice,
          maxPrice: unitPrice,
          minPrice: unitPrice,
          avgPrice: unitPrice,
          totalQty: item.qty,
          count: 1,
          latestMonth: item.month
        });
      } else {
        const current = map.get(key)!;
        current.maxPrice = Math.max(current.maxPrice, unitPrice);
        current.minPrice = Math.min(current.minPrice, unitPrice);
        current.totalQty += item.qty;
        current.count += 1;
        // Update latest if this month is more recent
        if (item.month > current.latestMonth) {
          current.latestPrice = unitPrice;
          current.latestMonth = item.month;
        }
      }
    });

    // Calculate average price
    const result = Array.from(map.values()).map(item => ({
      ...item,
      avgPrice: item.totalQty > 0 ? (yearFilteredRevenueData
        .filter(d => d.model === item.model && d.customer === item.customer)
        .reduce((sum, d) => sum + d.amount, 0)) / item.totalQty : 0
    }));

    // Apply filters
    let filtered = result.filter(item =>
      (priceFilter.model === '' || item.model.toLowerCase().includes(priceFilter.model.toLowerCase())) &&
      (priceFilter.customer === '' || item.customer.toLowerCase().includes(priceFilter.customer.toLowerCase()))
    );

    // Apply sorting
    if (priceSortConfig) {
      filtered.sort((a, b) => {
        const aVal = a[priceSortConfig.key as keyof typeof a];
        const bVal = b[priceSortConfig.key as keyof typeof b];
        if (aVal === bVal) return 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return priceSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        if (aStr < bStr) return priceSortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return priceSortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      filtered.sort((a, b) => a.model.localeCompare(b.model));
    }

    return filtered;
  }, [yearFilteredRevenueData, priceSortConfig, priceFilter]);

  // --- Handlers (Supabase sync handled by Persistence Effects) ---
  const handleQtyFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const csvText = await readFileAsCSVText(file);
        const parsed = parseSalesCSV(csvText);
        setSalesData(parsed);
        if (isSupabaseConfigured()) {
          salesService.saveAll(parsed)
            .then(() => console.log('✅ 영업 데이터 Supabase 동기화 완료'))
            .catch(err => console.error('Supabase 동기화 실패:', err));
        }
      } catch (err) {
        console.error('파일 읽기 실패:', err);
        alert('파일을 읽는데 실패했습니다. CSV 또는 Excel 형식을 확인해주세요.');
      }
    }
    e.target.value = '';
  };
  const handleCRFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const csvText = await readFileAsCSVText(file);
        const parsed = parseCRCSV(csvText, selectedCRYear);
        setCrData(prev => {
          const otherYears = prev.filter(d => d.year !== selectedCRYear);
          return [...otherYears, ...parsed];
        });
        if (isSupabaseConfigured()) {
          crService.saveByYear(parsed, selectedCRYear)
            .then(() => console.log(`✅ ${selectedCRYear}년 CR 데이터 Supabase 동기화 완료`))
            .catch(err => console.error('Supabase 동기화 실패:', err));
        }
      } catch (err) {
        console.error('파일 읽기 실패:', err);
        alert('파일을 읽는데 실패했습니다. CSV 또는 Excel 형식을 확인해주세요.');
      }
    }
    e.target.value = '';
  };
  const handleRfqFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const csvText = await readFileAsCSVText(file);
        const parsed = parseRFQCSV(csvText);
        setRfqData(parsed);
        if (isSupabaseConfigured()) {
          rfqService.saveAll(parsed)
            .then(() => console.log('✅ RFQ 데이터 Supabase 동기화 완료'))
            .catch(err => console.error('Supabase 동기화 실패:', err));
        }
      } catch (err) {
        console.error('파일 읽기 실패:', err);
        alert('파일을 읽는데 실패했습니다. CSV 또는 Excel 형식을 확인해주세요.');
      }
    }
    e.target.value = '';
  };

  // Revenue Upload Handler (고객사별 매출현황)
  const handleRevenueFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploadingRevenue(true);
      try {
        const csvText = await readFileAsCSVText(file);
        const parsed = parseRevenueCSV(csvText, selectedRevenueYear);

        setRevenueData(prev => {
          const otherYears = prev.filter(d => d.year !== selectedRevenueYear);
          return [...otherYears, ...parsed];
        });

        if (isSupabaseConfigured()) {
          await revenueService.saveByYear(parsed, selectedRevenueYear);
          console.log(`✅ ${selectedRevenueYear}년 매출 데이터 Supabase 동기화 완료 (${parsed.length}건)`);
        }

        alert(`${selectedRevenueYear}년 매출 데이터 ${parsed.length}건이 업로드되었습니다.`);
      } catch (err) {
        console.error('매출 데이터 업로드 실패:', err);
        alert('매출 데이터 업로드에 실패했습니다. CSV 또는 Excel 형식을 확인해주세요.');
      } finally {
        setIsUploadingRevenue(false);
      }
    }
    e.target.value = '';
  };

  // 품목별 매출 업로드 핸들러 (CSV 인코딩 감지 + Excel 지원)
  const handleItemRevenueFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = '';
      return;
    }

    const processItemRevenue = async (csvText: string) => {
      if (!csvText || csvText.trim().length === 0) {
        alert('파일이 비어있거나 읽을 수 없습니다.');
        return;
      }

      console.log('📂 품목별 매출 파싱 시작...');
      const parsed = parseItemRevenueCSV(csvText);

      if (parsed.length === 0) {
        alert('파일에서 데이터를 찾을 수 없습니다.\n파일 형식을 확인해주세요.\n\n필요한 컬럼: (첫 열 비움), 매출기간, 고객사, model, 품번, 고객사p/n, 품명, 매출수량, 매출금액');
        return;
      }

      console.log(`✅ 품목별 매출 데이터 파싱 완료: ${parsed.length}건`);
      setItemRevenueData(parsed);
      safeSetItem('dashboard_itemRevenueData', JSON.stringify(parsed));

      if (isSupabaseConfigured()) {
        try {
          await itemRevenueService.saveAll(parsed);
          console.log(`✅ 품목별 매출 데이터 Supabase 동기화 완료: ${parsed.length}건`);
        } catch (err) {
          console.error('Supabase 동기화 실패:', err);
          alert('데이터는 로컬에 저장되었지만 Supabase 동기화에 실패했습니다.');
        }
      }

      alert(`품목별 매출 데이터 ${parsed.length}건이 업로드되었습니다.`);
    };

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // Excel: XLSX 라이브러리가 인코딩 자동 처리
      try {
        const csvText = await readFileAsCSVText(file);
        await processItemRevenue(csvText);
      } catch (err) {
        console.error('Excel 파일 읽기 실패:', err);
        alert('Excel 파일을 읽는데 실패했습니다.');
      }
    } else {
      // CSV: 인코딩 자동 감지 (UTF-8 우선, 깨지면 EUC-KR 재시도)
      const readCsvWithEncoding = (f: File, onLoaded: (text: string) => void) => {
        const readAsEncoding = (encoding: string, cb: (text: string) => void) => {
          const reader = new FileReader();
          reader.onload = (event) => cb((event.target?.result as string) || '');
          reader.onerror = () => { console.error(`파일 읽기 실패 (${encoding})`); cb(''); };
          reader.readAsText(f, encoding);
        };
        readAsEncoding('utf-8', (utf8Text) => {
          if (!utf8Text) { readAsEncoding('euc-kr', (t) => onLoaded(t || utf8Text)); return; }
          const brokenPattern = /�|Ã.|Â./g;
          const brokenMatches = utf8Text.match(brokenPattern);
          const brokenRatio = brokenMatches ? brokenMatches.length / utf8Text.length : 0;
          if (brokenRatio > 0.01) {
            readAsEncoding('euc-kr', (t) => onLoaded(t || utf8Text));
          } else {
            onLoaded(utf8Text);
          }
        });
      };

      readCsvWithEncoding(file, async (csvText) => {
        try {
          await processItemRevenue(csvText);
        } catch (err) {
          console.error('품목별 매출 데이터 업로드 실패:', err);
          alert('품목별 매출 데이터 업로드에 실패했습니다.\nCSV/Excel 형식을 확인해주세요.');
        }
      });
    }

    e.target.value = '';
  };

  // Revenue Filter/Sort Handlers
  const handleRevenueFilterChange = (field: keyof typeof revenueFilter, value: string) => {
    setRevenueFilter(prev => ({ ...prev, [field]: value }));
  };

  const handleRevenueSort = (key: keyof RevenueItem) => {
    setRevenueSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  // Item Revenue Filter/Sort Handlers
  const handleItemRevenueFilterChange = (field: keyof typeof itemRevenueFilter, value: string) => {
    setItemRevenueFilter(prev => ({ ...prev, [field]: value }));
  };

  const handleItemRevenueSort = (key: string) => {
    setItemRevenueSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  // Revenue Download Handler
  const handleDownloadRevenue = () => {
    const headers = ['월', '고객사', 'Model', '매출수량', '매출금액'];
    const rows = filteredRevenueData.map(item => [
      item.month,
      item.customer,
      item.model,
      item.qty,
      item.amount
    ]);
    downloadCSV(`매출현황_${selectedRevenueYear}_${selectedRevenueCustomer}`, headers, rows);
  };

  // Revenue Copy Handler (클립보드 복사)
  const handleCopyRevenue = async () => {
    const headers = ['월', '고객사', 'Model', '매출수량', '매출금액'];
    const rows = filteredRevenueData.map(item =>
      [item.month, item.customer, item.model, item.qty.toLocaleString(), item.amount.toLocaleString()].join('\t')
    );
    const text = [headers.join('\t'), ...rows].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      alert(`${filteredRevenueData.length}건의 데이터가 클립보드에 복사되었습니다.`);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert(`${filteredRevenueData.length}건의 데이터가 클립보드에 복사되었습니다.`);
    }
  };

  // Price Tab Handlers (단가현황)
  const handlePriceSort = (key: string) => {
    setPriceSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const handlePriceFilterChange = (field: keyof typeof priceFilter, value: string) => {
    setPriceFilter(prev => ({ ...prev, [field]: value }));
  };

  const handleDownloadPrice = () => {
    const headers = ['Model', '고객사', '최신단가', '최고단가', '최저단가', '평균단가', '총수량', '거래횟수', '최근월'];
    const rows = priceStats.map(item => [
      item.model,
      item.customer,
      Math.round(item.latestPrice),
      Math.round(item.maxPrice),
      Math.round(item.minPrice),
      Math.round(item.avgPrice),
      item.totalQty,
      item.count,
      item.latestMonth
    ]);
    downloadCSV(`영업_단가현황`, headers, rows);
  };

  const handleCopyPrice = async () => {
    const headers = ['Model', '고객사', '최신단가', '최고단가', '최저단가', '평균단가', '총수량', '거래횟수', '최근월'];
    const rows = priceStats.map(item =>
      [
        item.model,
        item.customer,
        Math.round(item.latestPrice).toLocaleString(),
        Math.round(item.maxPrice).toLocaleString(),
        Math.round(item.minPrice).toLocaleString(),
        Math.round(item.avgPrice).toLocaleString(),
        item.totalQty.toLocaleString(),
        item.count,
        item.latestMonth
      ].join('\t')
    );
    const text = [headers.join('\t'), ...rows].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      alert(`${priceStats.length}건의 단가 데이터가 클립보드에 복사되었습니다.`);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert(`${priceStats.length}건의 단가 데이터가 클립보드에 복사되었습니다.`);
    }
  };

  const handleCrChange = (month: string, field: keyof CRItem, value: string) => {
    const numValue = parseFloat(value); const finalVal = isNaN(numValue) ? 0 : numValue;
    setCrData(prev => {
      const exists = prev.some(item => item.year === selectedCRYear && item.month === month);
      if (exists) {
        return prev.map(item => (item.year === selectedCRYear && item.month === month) ? { ...item, [field]: finalVal } : item);
      }
      // crData에 해당 년도/월이 없으면 새로 추가
      const newItem: CRItem = { year: selectedCRYear, month, totalSales: 0, lgSales: 0, lgCR: 0, lgDefense: 0, mtxSales: 0, mtxCR: 0, mtxDefense: 0, [field]: finalVal };
      return [...prev, newItem];
    });
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
  const handleQtySort = (key: keyof SalesItem) => {
    setQtySortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  const handleQtyFilterChange = (field: keyof typeof qtyFilter, value: string) => setQtyFilter(prev => ({ ...prev, [field]: value }));
  const handleRfqFilterChange = (field: keyof typeof rfqFilter, value: string) => setRfqFilter(prev => ({ ...prev, [field]: value }));

  // Downloads
  const handleDownloadQty = () => { const headers = ['고객사', 'Model', '품번', '품명', '총계획', '총실적', '달성률(%)']; const rows = filteredQtyItems.map(item => [item.customer, item.model, item.partNo, item.partName, item.totalPlan, item.totalActual, item.rate.toFixed(1)]); downloadCSV(`매출수량_현황_${selectedQtyCustomer}`, headers, rows); };
  const handleDownloadRfq = () => { const headers = ['순번', '고객사', '제품군', '프로젝트명', '공정단계', '현상태', '시작일', '견적일', '최초주문일', 'Model', '월평균수량', '예상단가', '예상매출', '비고']; const rows = filteredRfqItems.map(item => [item.index, item.customer, item.projectType, item.projectName, item.process, item.status, item.dateSelection, item.dateQuotation, item.datePO, item.model, item.qty, item.unitPrice, item.amount, item.remark]); downloadCSV(`RFQ_현황`, headers, rows); };

  // Helper
  const SUB_TABS = [{ id: 'forecast', label: '매출계획' }, { id: 'sales', label: '매출현황' }, { id: 'unitprice', label: '단가현황' }, { id: 'cr', label: 'CR현황' }];

  // Column resize hooks
  const qtyResize = useColumnResize([120, 120, 120, 200, 100, 100, 80]);
  const revenueResize = useColumnResize([80, 120, 120, 120, 150]);
  const itemRevenueResize = useColumnResize([120, 120, 120, 200, 120, 130, 80]);
  const rfqResize = useColumnResize([60, 100, 80, 120, 80, 80, 90, 90, 90, 100, 90, 90, 110, 120]);
  const salesPriceResize = useColumnResize([120, 120, 100, 100, 100, 100, 100, 80]);

  // Helper component for table headers
  const SortableHeader = <T,>({ label, sortKey, align = 'left', currentSort, onSort, style, onResizeStart }: { label: string, sortKey: keyof T | string, align?: string, currentSort: { key: keyof T | string, direction: 'asc' | 'desc' } | null, onSort: (key: keyof T | string) => void, style?: React.CSSProperties, onResizeStart?: (e: React.MouseEvent) => void }) => (
    <th
        className={`px-4 py-3 min-w-[${String(sortKey) === 'index' ? '50px' : '100px'}] ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group`}
        style={style}
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
        {onResizeStart && <div onMouseDown={onResizeStart} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />}
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


      {activeSubTab === 'forecast' && <SalesForecast />}

      {activeSubTab === 'sales' && (
      <section className="space-y-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div><h2 className="text-xl font-black text-slate-800">1.판매계획 대비 실적</h2></div>
          <div className="flex gap-4 items-center">
            <label className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2"><span>📂</span> 수량 업로드 (CSV/Excel)<input type="file" accept=".csv,.xlsx,.xls" onChange={handleQtyFileUpload} className="hidden" /></label>
            <select value={selectedQtyMonth} onChange={(e) => setSelectedQtyMonth(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[120px]">
              {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={selectedQtyCustomer} onChange={(e) => setSelectedQtyCustomer(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[150px]">{qtyCustomers.map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">총 실적 수량 (TOTAL ACTUAL)</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-black text-emerald-500">{activeQtyData.totalActual.toLocaleString()} EA</p>
                <p className="text-xs text-slate-400 mt-1">계획: {activeQtyData.totalPlan.toLocaleString()} EA</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-600">{qtyAchievementRate.toFixed(1)}%</p>
                <div className="w-24 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(qtyAchievementRate, 100)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">검색된 품목 수</p>
            <p className="text-3xl font-black text-slate-800">{filteredQtyItems.length}개</p>
            <p className="text-xs text-slate-400 mt-1">총 {activeQtyData.items.length}개 중</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">분석 대상</p>
            <p className="text-3xl font-black text-slate-800">{selectedQtyCustomer === 'All' ? '전체 고객사' : selectedQtyCustomer}</p>
            <p className="text-xs text-slate-400 mt-1">2024년 데이터</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-8"><h3 className="font-black text-slate-800 flex items-center gap-2"><span className="w-1 h-5 bg-blue-600 rounded-full"></span>1. 월별 계획수량(Plan) vs 실적수량(Actual) 추이</h3></div>
          <div className="h-[400px] w-full">
            <ResponsiveContainer minWidth={0} width="100%" height="100%">
              <ComposedChart data={qtyChartData} margin={{ top: 40, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 500, fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#94a3b8'}} tickFormatter={(value) => value.toLocaleString()} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }} cursor={{ fill: '#f8fafc' }} formatter={(value: number) => value.toLocaleString()} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                <Bar name="계획수량 (Plan)" dataKey="plan" fill="#d1d5db" radius={[4, 4, 0, 0]} barSize={25}>
                  <LabelList dataKey="plan" position="top" formatter={(value: number) => value >= 100000000 ? `${(value / 100000000).toFixed(1)}억` : value >= 10000 ? `${(value / 10000).toFixed(1)}만` : value.toLocaleString()} style={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
                </Bar>
                <Bar name="실적수량 (Actual)" dataKey="actual" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25}>
                  <LabelList dataKey="actual" position="top" formatter={(value: number) => value >= 100000000 ? `${(value / 100000000).toFixed(1)}억` : value >= 10000 ? `${(value / 10000).toFixed(1)}만` : value.toLocaleString()} style={{ fontSize: 10, fontWeight: 600, fill: '#10b981' }} />
                </Bar>
                <Line type="monotone" name="실적추세" dataKey="actual" stroke="#10b981" strokeWidth={2} dot={{r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff'}} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4"><button onClick={() => setQtyListOpen(!qtyListOpen)} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-emerald-600 transition-colors"><svg className={`w-5 h-5 transition-transform ${qtyListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>상세 품목 리스트 (Quantity List)</button><button onClick={handleDownloadQty} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>엑셀 다운로드</button></div>
            {qtyListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left" style={qtyResize.getTableStyle()}>
                  <colgroup>{qtyResize.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                        <SortableHeader label="고객사" sortKey="customer" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(0)} onResizeStart={e => qtyResize.startResize(0, e)} />
                        <SortableHeader label="Model" sortKey="model" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(1)} onResizeStart={e => qtyResize.startResize(1, e)} />
                        <SortableHeader label="품번" sortKey="partNo" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(2)} onResizeStart={e => qtyResize.startResize(2, e)} />
                        <SortableHeader label="품명" sortKey="partName" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(3)} onResizeStart={e => qtyResize.startResize(3, e)} />
                        <SortableHeader label="총계획" sortKey="totalPlan" align="right" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(4)} onResizeStart={e => qtyResize.startResize(4, e)} />
                        <SortableHeader label="총실적" sortKey="totalActual" align="right" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(5)} onResizeStart={e => qtyResize.startResize(5, e)} />
                        <SortableHeader label="달성률" sortKey="rate" align="center" currentSort={qtySortConfig} onSort={handleQtySort} style={qtyResize.getHeaderStyle(6)} onResizeStart={e => qtyResize.startResize(6, e)} />
                    </tr>
                    <tr className="bg-slate-50"><th className="px-2 py-2"><input type="text" placeholder="고객사 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.customer} onChange={(e) => handleQtyFilterChange('customer', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="Model 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.model} onChange={(e) => handleQtyFilterChange('model', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="품번 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partNo} onChange={(e) => handleQtyFilterChange('partNo', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="품명 검색" className="w-full p-1 border rounded text-xs font-normal" value={qtyFilter.partName} onChange={(e) => handleQtyFilterChange('partName', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="계획" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.plan} onChange={(e) => handleQtyFilterChange('plan', e.target.value)} /></th><th className="px-2 py-2"><input type="text" placeholder="실적" className="w-full p-1 border rounded text-xs font-normal text-right" value={qtyFilter.actual} onChange={(e) => handleQtyFilterChange('actual', e.target.value)} /></th><th className="px-2 py-2"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredQtyItems.length > 0 && (
                      <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                        <td colSpan={4} className="px-3 py-2 text-right">집계 ({filteredQtyItems.length}건)</td>
                        <td className="px-3 py-2 text-right font-mono">{filteredQtyTotal.plan.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">{filteredQtyTotal.actual.toLocaleString()}</td>
                        <td className="px-3 py-2 text-center"><span className={`px-2 py-1 rounded-md font-bold text-[10px] ${filteredQtyTotal.rate >= 100 ? 'bg-emerald-100 text-emerald-700' : filteredQtyTotal.rate >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{filteredQtyTotal.rate.toFixed(1)}%</span></td>
                      </tr>
                    )}
                    {filteredQtyItems.map((item) => (<tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td><td className="px-4 py-3 text-slate-600">{item.model}</td><td className="px-4 py-3 font-mono text-slate-500">{item.partNo}</td><td className="px-4 py-3 text-slate-600 truncate max-w-[200px]" title={item.partName}>{item.partName}</td><td className="px-4 py-3 text-right font-mono text-slate-500">{item.totalPlan.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono font-bold text-slate-800">{item.totalActual.toLocaleString()}</td><td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-md font-bold text-[10px] ${item.rate >= 100 ? 'bg-emerald-100 text-emerald-700' : item.rate >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{item.rate.toFixed(1)}%</span></td></tr>))}
                     {filteredQtyItems.length === 0 && (<tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">데이터가 없습니다.</td></tr>)}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200"><tr><td colSpan={4} className="px-4 py-3 text-center">합계 (Total)</td><td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.plan.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono">{filteredQtyTotal.actual.toLocaleString()}</td><td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-md font-bold text-[10px] ${filteredQtyTotal.rate >= 100 ? 'bg-emerald-100 text-emerald-700' : filteredQtyTotal.rate >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{filteredQtyTotal.rate.toFixed(1)}%</span></td></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* =================================================================================
            2. 고객사별 매출현황 (Customer Revenue Status) - CSV Uploader Section
           ================================================================================= */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="font-black text-slate-800 flex items-center gap-2"><span className="w-1 h-5 bg-blue-600 rounded-full"></span>2. 고객사별 매출현황</h3>
              <p className="text-xs text-slate-500 mt-1">고객사별 월별 매출금액 및 수량 현황</p>
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              <label className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2 ${isUploadingRevenue ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-amber-100 hover:bg-amber-200 text-amber-700'}`}>
                <span>📂</span> {isUploadingRevenue ? '업로드 중...' : '매출 업로드 (CSV/Excel)'}
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleRevenueFileUpload} className="hidden" disabled={isUploadingRevenue} />
              </label>
              <select
                value={selectedRevenueMonth}
                onChange={(e) => setSelectedRevenueMonth(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[120px]"
              >
                {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select
                value={selectedRevenueYear}
                onChange={(e) => setSelectedRevenueYear(parseInt(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[100px]"
              >
                {revenueYears.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select
                value={selectedRevenueCustomer}
                onChange={(e) => setSelectedRevenueCustomer(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 min-w-[150px]"
              >
                {revenueCustomers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Revenue Metrics Cards */}
          <div className={`grid grid-cols-1 ${revenueMetrics.hasForecast ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 mb-6`}>
            <div className="bg-gradient-to-br from-blue-50 to-white p-6 rounded-2xl border border-blue-100 shadow-sm">
              <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">총 매출실적</p>
              <p className="text-3xl font-black text-blue-600">
                {revenueMetrics.totalAmount >= 100000000
                  ? `${(revenueMetrics.totalAmount / 100000000).toFixed(1)}억`
                  : `${(revenueMetrics.totalAmount / 10000).toFixed(0)}만`}원
              </p>
              <p className="text-xs text-slate-400 mt-1">{selectedRevenueYear}년 {selectedRevenueCustomer === 'All' ? '전체' : selectedRevenueCustomer}</p>
            </div>
            {revenueMetrics.hasForecast && (
              <div className="bg-gradient-to-br from-amber-50 to-white p-6 rounded-2xl border border-amber-100 shadow-sm">
                <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2">매출계획</p>
                <p className="text-3xl font-black text-amber-600">
                  {revenueMetrics.totalPlanAmount >= 100000000
                    ? `${(revenueMetrics.totalPlanAmount / 100000000).toFixed(1)}억`
                    : `${(revenueMetrics.totalPlanAmount / 10000).toFixed(0)}만`}원
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  달성률 {revenueMetrics.totalPlanAmount > 0 ? ((revenueMetrics.totalAmount / revenueMetrics.totalPlanAmount) * 100).toFixed(1) : '0.0'}%
                </p>
              </div>
            )}
            <div className="bg-gradient-to-br from-emerald-50 to-white p-6 rounded-2xl border border-emerald-100 shadow-sm">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">총 매출수량</p>
              <p className="text-3xl font-black text-emerald-600">{revenueMetrics.totalQty.toLocaleString()} EA</p>
              <p className="text-xs text-slate-400 mt-1">{revenueMetrics.uniqueModels}개 모델</p>
            </div>
            <div className="bg-gradient-to-br from-violet-50 to-white p-6 rounded-2xl border border-violet-100 shadow-sm">
              <p className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-2">고객사 / 데이터 수</p>
              <p className="text-3xl font-black text-violet-600">{revenueMetrics.uniqueCustomers}개사</p>
              <p className="text-xs text-slate-400 mt-1">{filteredRevenueData.length}건 데이터</p>
            </div>
          </div>

          {/* Revenue Monthly Chart */}
          {revenueMetrics.chartData.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                월별 매출 추이 {revenueMetrics.hasForecast && <span className="text-xs font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">계획 vs 실적</span>}
              </h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer minWidth={0} width="100%" height="100%">
                  <ComposedChart data={revenueMetrics.chartData} margin={{ top: 40, right: 30, bottom: 20, left: 30 }}>
                    <defs>
                      <linearGradient id="gradPlan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0.45} />
                      </linearGradient>
                      <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500, fill: '#64748b' }} />
                    <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(value) => `${(value / 100000000).toFixed(1)}억`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      formatter={(value: number, name: string) => {
                        if (name === '달성률') return [`${(value as number).toFixed(1)}%`, name];
                        return [`₩${Math.round(value).toLocaleString()}`, name];
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px', fontSize: '12px', fontWeight: 600 }} />
                    <Bar yAxisId="left" name="매출계획" dataKey="planAmount" fill="url(#gradPlan)" radius={[6, 6, 0, 0]} barSize={28} hide={!revenueMetrics.hasForecast}>
                      <LabelList dataKey="planAmount" position="top" formatter={(value: number) => value > 0 ? `${(value / 100000000).toFixed(1)}억` : ''} style={{ fontSize: 9, fontWeight: 500, fill: '#7c3aed' }} />
                    </Bar>
                    <Bar yAxisId="left" name="매출실적" dataKey="amount" fill="url(#gradActual)" radius={[6, 6, 0, 0]} barSize={28}>
                      <LabelList dataKey="amount" position="top" formatter={(value: number) => value > 0 ? `${(value / 100000000).toFixed(1)}억` : ''} style={{ fontSize: 10, fontWeight: 600, fill: '#1d4ed8' }} />
                      {revenueMetrics.hasForecast && (
                        <LabelList dataKey="achieveRate" position="top" offset={18} formatter={(value: number) => value > 0 ? `${value.toFixed(1)}%` : ''} style={{ fontSize: 9, fontWeight: 700, fill: '#dc2626' }} />
                      )}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Customer Breakdown (Top 5) */}
          {revenueMetrics.customerBreakdown.length > 0 && selectedRevenueCustomer === 'All' && (
            <div className="mb-6">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-violet-500 rounded-full"></span>
                고객사별 매출 비중 (Top 5)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {revenueMetrics.customerBreakdown.slice(0, 5).map((item, idx) => (
                  <div key={item.customer} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-500">#{idx + 1}</span>
                      <span className="text-xs font-bold text-blue-600">{item.share.toFixed(1)}%</span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm truncate" title={item.customer}>{item.customer}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {item.amount >= 100000000
                        ? `${(item.amount / 100000000).toFixed(1)}억`
                        : `${(item.amount / 10000).toFixed(0)}만`}원
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revenue Data Table */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setRevenueListOpen(!revenueListOpen)}
                className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              >
                <svg className={`w-5 h-5 transition-transform ${revenueListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                상세 매출 리스트 ({filteredRevenueData.length}건)
              </button>
              <button
                onClick={handleDownloadRevenue}
                className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                엑셀 다운로드
              </button>
            </div>

            {revenueListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left" style={revenueResize.getTableStyle()}>
                  <colgroup>{revenueResize.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <SortableHeader<RevenueItem> label="월" sortKey="month" currentSort={revenueSortConfig} onSort={handleRevenueSort} style={revenueResize.getHeaderStyle(0)} onResizeStart={e => revenueResize.startResize(0, e)} />
                      <SortableHeader<RevenueItem> label="고객사" sortKey="customer" currentSort={revenueSortConfig} onSort={handleRevenueSort} style={revenueResize.getHeaderStyle(1)} onResizeStart={e => revenueResize.startResize(1, e)} />
                      <SortableHeader<RevenueItem> label="Model" sortKey="model" currentSort={revenueSortConfig} onSort={handleRevenueSort} style={revenueResize.getHeaderStyle(2)} onResizeStart={e => revenueResize.startResize(2, e)} />
                      <SortableHeader<RevenueItem> label="매출수량" sortKey="qty" align="right" currentSort={revenueSortConfig} onSort={handleRevenueSort} style={revenueResize.getHeaderStyle(3)} onResizeStart={e => revenueResize.startResize(3, e)} />
                      <SortableHeader<RevenueItem> label="매출금액" sortKey="amount" align="right" currentSort={revenueSortConfig} onSort={handleRevenueSort} style={revenueResize.getHeaderStyle(4)} onResizeStart={e => revenueResize.startResize(4, e)} />
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2">
                        <input type="text" placeholder="월" className="w-full p-1 border rounded text-xs font-normal" value={revenueFilter.month} onChange={(e) => handleRevenueFilterChange('month', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="고객사" className="w-full p-1 border rounded text-xs font-normal" value={revenueFilter.customer} onChange={(e) => handleRevenueFilterChange('customer', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="Model" className="w-full p-1 border rounded text-xs font-normal" value={revenueFilter.model} onChange={(e) => handleRevenueFilterChange('model', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={revenueFilter.qty} onChange={(e) => handleRevenueFilterChange('qty', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={revenueFilter.amount} onChange={(e) => handleRevenueFilterChange('amount', e.target.value)} />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRevenueData.length > 0 && (
                      <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                        <td colSpan={3} className="px-3 py-2 text-right">집계 ({filteredRevenueData.length}건)</td>
                        <td className="px-3 py-2 text-right font-mono">{revenueTotal.totalQty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">₩{revenueTotal.totalAmount.toLocaleString()}</td>
                      </tr>
                    )}
                    {filteredRevenueData.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-600">{item.month}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{item.customer}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{item.qty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">₩{item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                    {filteredRevenueData.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl">📊</span>
                            <p className="font-medium">데이터가 없습니다.</p>
                            <p className="text-xs">CSV 파일을 업로드하여 매출 데이터를 추가하세요.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {filteredRevenueData.length > 0 && (
                    <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 text-center">합계 (Total)</td>
                        <td className="px-4 py-3 text-right font-mono">{revenueTotal.totalQty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-blue-600">₩{revenueTotal.totalAmount.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

        {/* =================================================================================
            3. 품목별 매출현황 (Item Revenue Status) - 별도 블럭
           ================================================================================= */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="font-black text-slate-800 flex items-center gap-2"><span className="w-1 h-5 bg-emerald-600 rounded-full"></span>3. 품목별 매출현황</h3>
              <p className="text-xs text-slate-500 mt-1">품목별 매출금액 및 수량 현황 (CSV/Excel 업로드)</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                <span>📂</span> 품목별 매출 업로드 (CSV/Excel)
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleItemRevenueFileUpload} className="hidden" />
              </label>
              <select
                value={selectedRevenueCustomer}
                onChange={(e) => setSelectedRevenueCustomer(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 min-w-[150px]"
              >
                {revenueCustomers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Item Revenue Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gradient-to-br from-emerald-50 to-white p-6 rounded-2xl border border-emerald-100 shadow-sm">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">총 매출금액</p>
              <p className="text-3xl font-black text-emerald-600">
                {itemRevenueStats.totalAmount >= 100000000
                  ? `${(itemRevenueStats.totalAmount / 100000000).toFixed(1)}억`
                  : `${(itemRevenueStats.totalAmount / 10000).toFixed(0)}만`}원
              </p>
              <p className="text-xs text-slate-400 mt-1">{selectedRevenueCustomer === 'All' ? '전체 고객사' : selectedRevenueCustomer}</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-white p-6 rounded-2xl border border-blue-100 shadow-sm">
              <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">총 매출수량</p>
              <p className="text-3xl font-black text-blue-600">{itemRevenueStats.totalQty.toLocaleString()} EA</p>
              <p className="text-xs text-slate-400 mt-1">{itemRevenueStats.items.length}개 품목</p>
            </div>
            <div className="bg-gradient-to-br from-violet-50 to-white p-6 rounded-2xl border border-violet-100 shadow-sm">
              <p className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-2">데이터 수</p>
              <p className="text-3xl font-black text-violet-600">{itemRevenueStats.items.length}건</p>
              <p className="text-xs text-slate-400 mt-1">품목별 집계 데이터</p>
            </div>
          </div>

          {/* Item Revenue Table */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setItemRevenueListOpen(!itemRevenueListOpen)}
                className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-emerald-600 transition-colors"
              >
                <svg className={`w-5 h-5 transition-transform ${itemRevenueListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                상세 품목별 매출 리스트 ({itemRevenueStats.items.length}건)
              </button>
            </div>

            {itemRevenueListOpen && (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left" style={itemRevenueResize.getTableStyle()}>
                  <colgroup>{itemRevenueResize.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <SortableHeader label="Model" sortKey="model" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(0)} onResizeStart={e => itemRevenueResize.startResize(0, e)} />
                      <SortableHeader label="품번" sortKey="partNo" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(1)} onResizeStart={e => itemRevenueResize.startResize(1, e)} />
                      <SortableHeader label="고객사 P/N" sortKey="customerPN" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(2)} onResizeStart={e => itemRevenueResize.startResize(2, e)} />
                      <SortableHeader label="품명" sortKey="partName" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(3)} onResizeStart={e => itemRevenueResize.startResize(3, e)} />
                      <SortableHeader label="매출수량" sortKey="qty" align="right" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(4)} onResizeStart={e => itemRevenueResize.startResize(4, e)} />
                      <SortableHeader label="매출금액" sortKey="amount" align="right" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(5)} onResizeStart={e => itemRevenueResize.startResize(5, e)} />
                      <SortableHeader label="비중(%)" sortKey="share" align="right" currentSort={itemRevenueSortConfig} onSort={handleItemRevenueSort} style={itemRevenueResize.getHeaderStyle(6)} onResizeStart={e => itemRevenueResize.startResize(6, e)} />
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2">
                        <input type="text" placeholder="Model" className="w-full p-1 border rounded text-xs font-normal" value={itemRevenueFilter.model} onChange={(e) => handleItemRevenueFilterChange('model', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="품번" className="w-full p-1 border rounded text-xs font-normal" value={itemRevenueFilter.partNo} onChange={(e) => handleItemRevenueFilterChange('partNo', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="고객사 P/N" className="w-full p-1 border rounded text-xs font-normal" value={itemRevenueFilter.customerPN} onChange={(e) => handleItemRevenueFilterChange('customerPN', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="품명" className="w-full p-1 border rounded text-xs font-normal" value={itemRevenueFilter.partName} onChange={(e) => handleItemRevenueFilterChange('partName', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={itemRevenueFilter.qty} onChange={(e) => handleItemRevenueFilterChange('qty', e.target.value)} />
                      </th>
                      <th className="px-2 py-2">
                        <input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={itemRevenueFilter.amount} onChange={(e) => handleItemRevenueFilterChange('amount', e.target.value)} />
                      </th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itemRevenueStats.items.length > 0 && (
                      <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                        <td colSpan={4} className="px-3 py-2 text-right">집계 ({itemRevenueStats.items.length}건)</td>
                        <td className="px-3 py-2 text-right font-mono">{itemRevenueStats.totalQty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">₩{itemRevenueStats.totalAmount.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">100.0%</td>
                      </tr>
                    )}
                    {itemRevenueStats.items.map((item, idx) => (
                      <tr key={`${item.model}-${item.partNo}-${idx}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-700">{item.model}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{item.partNo || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.customerPN || '-'}</td>
                        <td className="px-4 py-3 text-slate-700 truncate max-w-[240px]" title={item.partName}>{item.partName || '-'}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">{item.qty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">₩{item.amount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{item.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {itemRevenueStats.items.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl">📊</span>
                            <p className="font-medium">데이터가 없습니다.</p>
                            <p className="text-xs">품목별 매출 CSV/Excel 파일을 업로드하여 데이터를 추가하세요.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {itemRevenueStats.items.length > 0 && (
                    <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-right">합계</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">
                          {itemRevenueStats.totalQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-800">
                          ₩{itemRevenueStats.totalAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">100.0%</td>
                      </tr>
                    </tfoot>
                  )}
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
                        <span>⚙️ RFQ 업로드 (CSV/Excel)</span>
                        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleRfqFileUpload} className="hidden" />
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
                            <ResponsiveContainer minWidth={0} width="100%" height="100%">
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

                        <table className="w-full text-xs text-left whitespace-nowrap" style={rfqResize.getTableStyle()}>
                            <colgroup>{rfqResize.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                                <tr>
                                    {isEditingRFQ && <th className="px-2 py-3 min-w-[30px] text-center sticky left-0 bg-slate-50 z-10">삭제</th>}
                                    <SortableHeader label="순번" sortKey="index" align="center" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(0)} onResizeStart={e => rfqResize.startResize(0, e)} />
                                    <SortableHeader label="고객사" sortKey="customer" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(1)} onResizeStart={e => rfqResize.startResize(1, e)} />
                                    <SortableHeader label="제품군" sortKey="projectType" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(2)} onResizeStart={e => rfqResize.startResize(2, e)} />
                                    <SortableHeader label="프로젝트명" sortKey="projectName" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(3)} onResizeStart={e => rfqResize.startResize(3, e)} />
                                    <SortableHeader label="공정단계" sortKey="process" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(4)} onResizeStart={e => rfqResize.startResize(4, e)} />
                                    <SortableHeader label="현상태" sortKey="status" align="center" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(5)} onResizeStart={e => rfqResize.startResize(5, e)} />
                                    <SortableHeader label="시작일" sortKey="dateSelection" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(6)} onResizeStart={e => rfqResize.startResize(6, e)} />
                                    <SortableHeader label="견적일" sortKey="dateQuotation" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(7)} onResizeStart={e => rfqResize.startResize(7, e)} />
                                    <SortableHeader label="최초주문일" sortKey="datePO" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(8)} onResizeStart={e => rfqResize.startResize(8, e)} />
                                    <SortableHeader label="Model" sortKey="model" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(9)} onResizeStart={e => rfqResize.startResize(9, e)} />
                                    <SortableHeader label="월평균수량" sortKey="qty" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(10)} onResizeStart={e => rfqResize.startResize(10, e)} />
                                    <SortableHeader label="예상단가" sortKey="unitPrice" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(11)} onResizeStart={e => rfqResize.startResize(11, e)} />
                                    <SortableHeader label="예상매출" sortKey="amount" align="right" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(12)} onResizeStart={e => rfqResize.startResize(12, e)} />
                                    <SortableHeader label="비고" sortKey="remark" currentSort={rfqSortConfig} onSort={handleRfqSort} style={rfqResize.getHeaderStyle(13)} onResizeStart={e => rfqResize.startResize(13, e)} />
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
                                {filteredRfqItems.length > 0 && (
                                  <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                                    {isEditingRFQ && <td className="px-2 py-2"></td>}
                                    <td colSpan={10} className="px-3 py-2 text-right">집계 ({filteredRfqItems.length}건)</td>
                                    <td className="px-3 py-2 text-right font-mono">{filteredRfqItems.reduce((s, r) => s + r.qty, 0).toLocaleString()}</td>
                                    <td className="px-3 py-2"></td>
                                    <td className="px-3 py-2 text-right font-mono">{filteredRfqItems.reduce((s, r) => s + r.amount, 0).toLocaleString()}</td>
                                    <td className="px-3 py-2"></td>
                                  </tr>
                                )}
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
                  <div className="flex items-center gap-2">
                     <select
                        value={selectedCRYear}
                        onChange={(e) => setSelectedCRYear(parseInt(e.target.value))}
                        className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-blue-400"
                     >
                        {crYears.map(y => <option key={y} value={y}>{y}년</option>)}
                     </select>
                     <button
                        onClick={() => {
                          if (isEditingCR) {
                            // 편집 종료 시 해당 년도 데이터 Supabase에 저장
                            const yearData = crData.filter(d => d.year === selectedCRYear);
                            if (isSupabaseConfigured()) {
                              crService.saveByYear(yearData, selectedCRYear)
                                .then(() => console.log(`✅ ${selectedCRYear}년 CR 데이터 저장 완료`))
                                .catch(err => console.error('CR 저장 실패:', err));
                            }
                          }
                          setIsEditingCR(!isEditingCR);
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${isEditingCR ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                     >
                        {isEditingCR ? '💾 편집 종료 (저장)' : '✏️ 실적 직접 입력'}
                     </button>
                     <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
                        <span>📁 CR 데이터 업로드 (CSV/Excel)</span>
                        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleCRFileUpload} className="hidden" />
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

      {/* =================================================================================
          단가현황 TAB (Unit Price Status)
         ================================================================================= */}
      {activeSubTab === 'unitprice' && (
         <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
               <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                  <div>
                     <h3 className="font-black text-slate-800 flex items-center gap-2">
                        <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
                        품목별 단가 현황 (Unit Price)
                     </h3>
                     <p className="text-sm text-slate-500 mt-1">매출 내역을 기반으로 산출된 품목별 최신 단가 및 단가 변동 정보입니다.</p>
                  </div>
                  <div className="flex gap-2">
                     <button
                        onClick={handleCopyPrice}
                        className="text-slate-500 hover:text-blue-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                     >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        복사
                     </button>
                     <button
                        onClick={handleDownloadPrice}
                        className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                     >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        엑셀 다운로드
                     </button>
                  </div>
               </div>

               {/* Metrics */}
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-xl border border-blue-100">
                     <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">등록 품목 수</p>
                     <p className="text-2xl font-black text-blue-600">{priceStats.length}개</p>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-50 to-white p-4 rounded-xl border border-emerald-100">
                     <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">고객사 수</p>
                     <p className="text-2xl font-black text-emerald-600">{new Set(priceStats.map(p => p.customer)).size}개사</p>
                  </div>
                  <div className="bg-gradient-to-br from-violet-50 to-white p-4 rounded-xl border border-violet-100">
                     <p className="text-xs font-bold text-violet-500 uppercase tracking-wider mb-1">총 거래 수량</p>
                     <p className="text-2xl font-black text-violet-600">{priceStats.reduce((sum, p) => sum + p.totalQty, 0).toLocaleString()} EA</p>
                  </div>
               </div>

               {/* Table */}
               <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-xs text-left" style={salesPriceResize.getTableStyle()}>
                     <colgroup>{salesPriceResize.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                     <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                        <tr>
                           <th
                              className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(0)}
                              onClick={() => handlePriceSort('model')}
                           >
                              <div className="flex items-center gap-1">
                                 Model (품종)
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'model' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'model' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(0, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(1)}
                              onClick={() => handlePriceSort('customer')}
                           >
                              <div className="flex items-center gap-1">
                                 고객사
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'customer' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'customer' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(1, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(2)}
                              onClick={() => handlePriceSort('latestPrice')}
                           >
                              <div className="flex items-center justify-end gap-1">
                                 최신단가
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'latestPrice' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'latestPrice' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(2, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(3)}
                              onClick={() => handlePriceSort('maxPrice')}
                           >
                              <div className="flex items-center justify-end gap-1">
                                 최고단가
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'maxPrice' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'maxPrice' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(3, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(4)}
                              onClick={() => handlePriceSort('minPrice')}
                           >
                              <div className="flex items-center justify-end gap-1">
                                 최저단가
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'minPrice' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'minPrice' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(4, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(5)}
                              onClick={() => handlePriceSort('avgPrice')}
                           >
                              <div className="flex items-center justify-end gap-1">
                                 평균단가
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'avgPrice' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'avgPrice' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(5, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th
                              className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                              style={salesPriceResize.getHeaderStyle(6)}
                              onClick={() => handlePriceSort('totalQty')}
                           >
                              <div className="flex items-center justify-end gap-1">
                                 총수량
                                 <span className={`text-[10px] ${priceSortConfig?.key === 'totalQty' ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
                                    {priceSortConfig?.key === 'totalQty' ? (priceSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                 </span>
                              </div>
                              <div onMouseDown={e => salesPriceResize.startResize(6, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                           <th className="px-4 py-3 text-right" style={salesPriceResize.getHeaderStyle(7)}>
                              최근월
                              <div onMouseDown={e => salesPriceResize.startResize(7, e)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400" />
                           </th>
                        </tr>
                        <tr className="bg-slate-50">
                           <th className="px-2 py-2">
                              <input
                                 type="text"
                                 placeholder="Model 검색"
                                 className="w-full p-1 border rounded text-xs font-normal"
                                 value={priceFilter.model}
                                 onChange={(e) => handlePriceFilterChange('model', e.target.value)}
                              />
                           </th>
                           <th className="px-2 py-2">
                              <input
                                 type="text"
                                 placeholder="고객사 검색"
                                 className="w-full p-1 border rounded text-xs font-normal"
                                 value={priceFilter.customer}
                                 onChange={(e) => handlePriceFilterChange('customer', e.target.value)}
                              />
                           </th>
                           <th colSpan={6}></th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {priceStats.length > 0 && (
                          <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                            <td colSpan={2} className="px-3 py-2 text-right">집계 ({priceStats.length}건)</td>
                            <td className="px-3 py-2 text-right font-mono">{Math.round(priceStats.reduce((s, p) => s + p.latestPrice, 0) / priceStats.length).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono">{Math.round(Math.max(...priceStats.map(p => p.maxPrice))).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono">{Math.round(Math.min(...priceStats.map(p => p.minPrice))).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono">{Math.round(priceStats.reduce((s, p) => s + p.avgPrice, 0) / priceStats.length).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono">{priceStats.reduce((s, p) => s + p.totalQty, 0).toLocaleString()}</td>
                            <td className="px-3 py-2"></td>
                          </tr>
                        )}
                        {priceStats.map((item, idx) => (
                           <tr key={idx} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-800">{item.model}</td>
                              <td className="px-4 py-3 text-slate-600">{item.customer}</td>
                              <td className="px-4 py-3 text-right font-bold text-blue-600">₩{Math.round(item.latestPrice).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-rose-500">₩{Math.round(item.maxPrice).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-emerald-500">₩{Math.round(item.minPrice).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-slate-600">₩{Math.round(item.avgPrice).toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-600">{item.totalQty.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-400">{item.latestMonth}</td>
                           </tr>
                        ))}
                        {priceStats.length === 0 && (
                           <tr>
                              <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                                 <div className="flex flex-col items-center gap-2">
                                    <span className="text-4xl">💰</span>
                                    <p className="font-medium">단가 데이터가 없습니다.</p>
                                    <p className="text-xs">매출현황에서 CSV 파일을 업로드하면 단가가 자동 계산됩니다.</p>
                                 </div>
                              </td>
                           </tr>
                        )}
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
