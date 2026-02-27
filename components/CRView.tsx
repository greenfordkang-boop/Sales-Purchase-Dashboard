import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { parseCIExcel, CIDetailItem, CIParseResult } from '../utils/ciDataParser';
import { ForecastSummary } from '../utils/salesForecastParser';
import { ciKpiService, ciDetailService, ciUploadService } from '../services/supabaseService';
import { isSupabaseConfigured } from '../lib/supabase';

// ============================================
// Constants & Types
// ============================================

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const STORAGE_KEY_CR_KPI = 'dashboard_crKpiData';
const STORAGE_KEY_CI_DETAILS = 'dashboard_ciDetails';
const STORAGE_KEY_CI_UPLOADS = 'dashboard_ciUploads';
const STORAGE_KEY_FORECAST_SUMMARY = 'dashboard_forecastData_summary';

interface CRKpiData {
  prevYearCI: number;         // 2025년 실적 CI금액 (백만원)
  prevYearCIRatio: number;    // 2025년 실적 CI비율 (%)
  targetCI: number;           // 2026년 목표 CI금액 (백만원)
  targetCIRatio: number;      // 2026년 목표 CI비율 (%)
  monthlyCITarget: number[];  // CI 금액 월별 목표 (백만원) [12]
  monthlyCIActual: number[];  // CI 금액 월별 실적 (백만원) [12]
}

interface CIUploadRecord {
  id: string;
  month: number;
  year: number;
  fileName: string;
  uploadDate: string;
  totalCIAmount: number;
  totalQuantity: number;
  itemCount: number;
}

const defaultKpiData: CRKpiData = {
  prevYearCI: 74.5,
  prevYearCIRatio: 0.33,
  targetCI: 44.5,
  targetCIRatio: 0.36,
  monthlyCITarget: Array(12).fill(0),
  monthlyCIActual: Array(12).fill(0),
};

// ============================================
// Helpers
// ============================================

const fmt = (v: number, decimals = 1): string => {
  if (v === 0) return '-';
  return v.toFixed(decimals);
};

const fmtPct = (v: number): string => {
  if (v === 0 || !isFinite(v)) return '-';
  return v.toFixed(2) + '%';
};

const fmtWon = (v: number): string => {
  if (v === 0) return '-';
  return '₩' + Math.round(v).toLocaleString();
};

const fmtMillion = (v: number): string => {
  if (v === 0) return '-';
  return v.toFixed(1);
};

// ============================================
// Component
// ============================================

const CRView: React.FC = () => {
  // --- KPI State ---
  const [kpiData, setKpiData] = useState<CRKpiData>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CR_KPI);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return { ...defaultKpiData };
  });

  // --- CI Details State ---
  const [ciDetailsByMonth, setCiDetailsByMonth] = useState<Record<number, CIDetailItem[]>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CI_DETAILS);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return {};
  });

  // --- Upload Records ---
  const [uploads, setUploads] = useState<CIUploadRecord[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CI_UPLOADS);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  });

  // --- Upload state ---
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // --- Detail view state ---
  const [detailMonth, setDetailMonth] = useState<number | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailSortConfig, setDetailSortConfig] = useState<{ key: keyof CIDetailItem; direction: 'asc' | 'desc' } | null>(null);
  const [detailFilterCategory, setDetailFilterCategory] = useState<string>('all');
  const [detailFilterCustomer, setDetailFilterCustomer] = useState<string>('all');
  const [detailOpen, setDetailOpen] = useState(true);

  // --- Editing state for KPI table ---
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // --- Forecast data (매출계획) ---
  const forecastSummary = useMemo<ForecastSummary | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FORECAST_SUMMARY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return null;
  }, []);

  // Monthly 매출계획 in 백만원
  const monthlySalesPlan = useMemo(() => {
    if (!forecastSummary?.monthlyRevenueTotals) return Array(12).fill(0);
    return forecastSummary.monthlyRevenueTotals.map(v => v / 1_000_000);
  }, [forecastSummary]);

  // --- Persist to localStorage + Supabase ---
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    localStorage.setItem(STORAGE_KEY_CR_KPI, JSON.stringify(kpiData));
    ciKpiService.save(kpiData).catch(e => console.error('CI KPI save error:', e));
  }, [kpiData]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    localStorage.setItem(STORAGE_KEY_CI_DETAILS, JSON.stringify(ciDetailsByMonth));
    ciDetailService.saveAll(ciDetailsByMonth).catch(e => console.error('CI details save error:', e));
  }, [ciDetailsByMonth]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    localStorage.setItem(STORAGE_KEY_CI_UPLOADS, JSON.stringify(uploads));
    ciUploadService.saveAll(uploads).catch(e => console.error('CI uploads save error:', e));
  }, [uploads]);

  // --- Load from Supabase on mount ---
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      initialLoadDone.current = true;
      return;
    }
    (async () => {
      try {
        const [kpi, details, uploadRecords] = await Promise.all([
          ciKpiService.get(),
          ciDetailService.getAll(),
          ciUploadService.getAll(),
        ]);
        if (kpi) setKpiData(kpi);
        if (details && Object.keys(details).length > 0) setCiDetailsByMonth(details);
        if (uploadRecords && uploadRecords.length > 0) setUploads(uploadRecords);
      } catch (e) {
        console.error('CI data load from Supabase error:', e);
      } finally {
        initialLoadDone.current = true;
      }
    })();
  }, []);

  // ============================================
  // Computed values (CI금액 목표 = CI비율 목표 × 매출계획)
  // ============================================

  const salesPlanCumulative = monthlySalesPlan.reduce((s: number, v: number) => s + v, 0);

  // CI 금액 목표: CI비율 목표 × 매출계획에서 자동 계산
  const computedMonthlyCITarget = useMemo(() => {
    if (kpiData.targetCIRatio > 0 && salesPlanCumulative > 0) {
      return monthlySalesPlan.map(mp => parseFloat((kpiData.targetCIRatio / 100 * mp).toFixed(2)));
    }
    return kpiData.monthlyCITarget;
  }, [kpiData.targetCIRatio, salesPlanCumulative, monthlySalesPlan, kpiData.monthlyCITarget]);

  const computedTargetCI = useMemo(() => {
    if (kpiData.targetCIRatio > 0 && salesPlanCumulative > 0) {
      return parseFloat((kpiData.targetCIRatio / 100 * salesPlanCumulative).toFixed(1));
    }
    return kpiData.targetCI;
  }, [kpiData.targetCIRatio, salesPlanCumulative, kpiData.targetCI]);

  // CI 금액 누계
  const ciTargetCumulative = computedMonthlyCITarget.reduce((s, v) => s + v, 0);
  const ciActualCumulative = kpiData.monthlyCIActual.reduce((s, v) => s + v, 0);

  // CI 비율(%) = CI금액(백만원) / 매출계획(백만원) × 100
  const monthlyCIRatioTarget = computedMonthlyCITarget.map((ci, i) =>
    monthlySalesPlan[i] > 0 ? (ci / monthlySalesPlan[i]) * 100 : 0
  );
  const monthlyCIRatioActual = kpiData.monthlyCIActual.map((ci, i) =>
    monthlySalesPlan[i] > 0 ? (ci / monthlySalesPlan[i]) * 100 : 0
  );
  // 달성률 = 실적비율 / 목표비율 × 100
  const monthlyAchievement = monthlyCIRatioActual.map((actual, i) =>
    monthlyCIRatioTarget[i] > 0 ? (actual / monthlyCIRatioTarget[i]) * 100 : 0
  );

  // 누계 비율
  const ciRatioTargetCumulative = salesPlanCumulative > 0 ? (ciTargetCumulative / salesPlanCumulative) * 100 : 0;
  const ciRatioActualCumulative = salesPlanCumulative > 0 ? (ciActualCumulative / salesPlanCumulative) * 100 : 0;
  const achievementCumulative = ciRatioTargetCumulative > 0 ? (ciRatioActualCumulative / ciRatioTargetCumulative) * 100 : 0;

  // ============================================
  // CI Detail data
  // ============================================

  const allCIDetails = useMemo(() => {
    const result: (CIDetailItem & { month: number })[] = [];
    for (const [monthStr, items] of Object.entries(ciDetailsByMonth) as [string, CIDetailItem[]][]) {
      const m = parseInt(monthStr);
      for (const item of (items || [])) {
        result.push({ ...item, month: m });
      }
    }
    return result;
  }, [ciDetailsByMonth]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set(allCIDetails.map(d => d.category).filter(Boolean));
    return ['all', ...Array.from(cats)];
  }, [allCIDetails]);

  const uniqueCustomers = useMemo(() => {
    const custs = new Set(allCIDetails.map(d => d.customer).filter(Boolean));
    return ['all', ...Array.from(custs)];
  }, [allCIDetails]);

  const filteredDetails = useMemo(() => {
    let data = allCIDetails;

    if (detailMonth !== 'all') {
      data = data.filter(d => d.month === detailMonth);
    }
    if (detailFilterCategory !== 'all') {
      data = data.filter(d => d.category === detailFilterCategory);
    }
    if (detailFilterCustomer !== 'all') {
      data = data.filter(d => d.customer === detailFilterCustomer);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      data = data.filter(d =>
        d.partName.toLowerCase().includes(term) ||
        d.partNumber.toLowerCase().includes(term) ||
        d.partCode.toLowerCase().includes(term) ||
        d.customer.toLowerCase().includes(term) ||
        d.productionSite.toLowerCase().includes(term) ||
        d.vehicleModel.toLowerCase().includes(term)
      );
    }

    if (detailSortConfig) {
      const { key, direction } = detailSortConfig;
      data = [...data].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return direction === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }

    return data;
  }, [allCIDetails, detailMonth, detailFilterCategory, detailFilterCustomer, searchTerm, detailSortConfig]);

  // Chart data
  const chartData = useMemo(() => {
    return MONTHS.map((label, i) => ({
      month: label,
      목표: computedMonthlyCITarget[i],
      실적: kpiData.monthlyCIActual[i],
      매출계획: monthlySalesPlan[i] > 0 ? parseFloat((monthlySalesPlan[i] / 100).toFixed(1)) : 0,
    }));
  }, [kpiData, monthlySalesPlan]);

  const categoryChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of allCIDetails) {
      const cat = d.category || '기타';
      map.set(cat, (map.get(cat) || 0) + d.ciAmount);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [allCIDetails]);

  // ============================================
  // Handlers
  // ============================================

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError('');

    try {
      const buffer = await file.arrayBuffer();
      const result = parseCIExcel(buffer, file.name);

      // Update CI details for this month
      setCiDetailsByMonth(prev => ({
        ...prev,
        [result.month]: result.details,
      }));

      // Update monthly actual (in 백만원)
      const ciAmountMillions = result.totalCIAmount / 1_000_000;
      setKpiData(prev => {
        const newActual = [...prev.monthlyCIActual];
        newActual[result.month - 1] = parseFloat(ciAmountMillions.toFixed(2));
        return { ...prev, monthlyCIActual: newActual };
      });

      // Add upload record
      const newUpload: CIUploadRecord = {
        id: `ci-${result.year}-${result.month}-${Date.now()}`,
        month: result.month,
        year: result.year,
        fileName: file.name,
        uploadDate: new Date().toISOString(),
        totalCIAmount: result.totalCIAmount,
        totalQuantity: result.totalQuantity,
        itemCount: result.details.length,
      };
      setUploads(prev => [newUpload, ...prev.filter(u => !(u.year === result.year && u.month === result.month))]);

    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Excel 파싱에 실패했습니다.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  }, []);

  const handleKpiEdit = (cellId: string, currentValue: number) => {
    setEditingCell(cellId);
    setEditValue(currentValue === 0 ? '' : String(currentValue));
  };

  const handleKpiEditSave = (cellId: string) => {
    const val = parseFloat(editValue) || 0;
    setEditingCell(null);

    // Parse cellId: e.g., "target-1" (target month 1), "actual-5", "prevCI", "targetCI", etc.
    if (cellId === 'prevCI') {
      setKpiData(prev => ({ ...prev, prevYearCI: val }));
    } else if (cellId === 'targetCI') {
      setKpiData(prev => ({ ...prev, targetCI: val }));
    } else if (cellId === 'prevCIRatio') {
      setKpiData(prev => ({ ...prev, prevYearCIRatio: val }));
    } else if (cellId === 'targetCIRatio') {
      // CI비율 목표 변경 → CI금액 목표 & 월별 목표 자동 연동
      // CI금액 = CI비율(%) / 100 × 매출계획(백만원)
      const newTargetCI = salesPlanCumulative > 0
        ? parseFloat((val / 100 * salesPlanCumulative).toFixed(1))
        : 0;
      // 월별 목표: 매출계획 비중에 따라 배분
      const newMonthlyTarget = monthlySalesPlan.map(mp =>
        salesPlanCumulative > 0
          ? parseFloat((val / 100 * mp).toFixed(2))
          : 0
      );
      setKpiData(prev => ({
        ...prev,
        targetCIRatio: val,
        targetCI: newTargetCI,
        monthlyCITarget: newMonthlyTarget,
      }));
    } else if (cellId.startsWith('target-')) {
      const month = parseInt(cellId.split('-')[1]);
      setKpiData(prev => {
        const newTarget = [...prev.monthlyCITarget];
        newTarget[month] = val;
        return { ...prev, monthlyCITarget: newTarget };
      });
    } else if (cellId.startsWith('actual-')) {
      const month = parseInt(cellId.split('-')[1]);
      setKpiData(prev => {
        const newActual = [...prev.monthlyCIActual];
        newActual[month] = val;
        return { ...prev, monthlyCIActual: newActual };
      });
    }
  };

  const handleDistributeTarget = () => {
    if (computedTargetCI <= 0) return;
    const monthly = parseFloat((computedTargetCI / 12).toFixed(2));
    setKpiData(prev => ({
      ...prev,
      monthlyCITarget: Array(12).fill(monthly),
    }));
  };

  const handleDetailSort = (key: keyof CIDetailItem) => {
    setDetailSortConfig(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  };

  // ============================================
  // Render helpers
  // ============================================

  const EditableCell = ({ cellId, value, className = '', isPercent = false }: {
    cellId: string; value: number; className?: string; isPercent?: boolean;
  }) => {
    if (editingCell === cellId) {
      return (
        <input
          type="number"
          step="0.01"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => handleKpiEditSave(cellId)}
          onKeyDown={e => { if (e.key === 'Enter') handleKpiEditSave(cellId); if (e.key === 'Escape') setEditingCell(null); }}
          autoFocus
          className="w-full px-1 py-0.5 text-right text-xs border border-blue-400 rounded bg-white outline-none"
        />
      );
    }
    const display = isPercent ? fmtPct(value) : fmtMillion(value);
    return (
      <span
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${className}`}
        onClick={() => handleKpiEdit(cellId, value)}
        title="클릭하여 수정"
      >
        {display}
      </span>
    );
  };

  const SortableHeader = ({ label, sortKey, align = 'left' }: {
    label: string; sortKey: keyof CIDetailItem; align?: string;
  }) => (
    <th
      className={`px-3 py-2.5 text-xs font-bold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => handleDetailSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <span className={`text-[10px] ${detailSortConfig?.key === sortKey ? 'text-blue-600 font-bold' : 'text-slate-300'}`}>
          {detailSortConfig?.key === sortKey ? (detailSortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </div>
    </th>
  );

  const PIE_COLORS = ['#6366f1', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-6">

      {/* ================================================================
          1. KPI Summary Table (스크린샷 매칭)
         ================================================================ */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-800">CR (Cost Reduction) 현황</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              매출계획: {forecastSummary ? `${forecastSummary.revision} (${forecastSummary.reportDate})` : '매출계획 데이터 없음 - 영업현황에서 업로드 필요'}
            </p>
          </div>
          <button
            onClick={handleDistributeTarget}
            className="text-xs text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors font-medium"
            title="연간 목표를 12개월 균등분배"
          >
            목표 균등분배
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-cyan-100">
                <th rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold min-w-[100px]">KPI항목</th>
                <th rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold min-w-[70px]">2025년<br/>실적</th>
                <th rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold min-w-[70px]">2026년<br/>목표</th>
                <th rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold min-w-[50px]">항목</th>
                <th colSpan={12} className="border border-slate-300 px-3 py-2 text-center font-bold">월별 실적</th>
                <th rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold min-w-[70px]">누계</th>
              </tr>
              <tr className="bg-cyan-100">
                {MONTHS.map(m => (
                  <th key={m} className="border border-slate-300 px-2 py-1.5 text-center font-bold min-w-[65px]">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* CI 금액 - 목표 */}
              <tr className="hover:bg-slate-50">
                <td rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  CI 금액
                  <div className="text-[10px] text-slate-400 font-normal">(백만원)</div>
                </td>
                <td rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  <EditableCell cellId="prevCI" value={kpiData.prevYearCI} />
                </td>
                <td rowSpan={2} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  <EditableCell cellId="targetCI" value={computedTargetCI} />
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-center font-bold bg-slate-50">목표</td>
                {computedMonthlyCITarget.map((v, i) => (
                  <td key={i} className="border border-slate-300 px-1 py-1.5 text-right">
                    <EditableCell cellId={`target-${i}`} value={v} />
                  </td>
                ))}
                <td className="border border-slate-300 px-2 py-1.5 text-right font-bold bg-slate-50">
                  {fmtMillion(ciTargetCumulative)}
                </td>
              </tr>
              {/* CI 금액 - 실적 */}
              <tr className="hover:bg-slate-50">
                <td className="border border-slate-300 px-2 py-1.5 text-center font-bold bg-slate-50">실적</td>
                {kpiData.monthlyCIActual.map((v, i) => (
                  <td key={i} className="border border-slate-300 px-1 py-1.5 text-right">
                    <EditableCell cellId={`actual-${i}`} value={v} />
                  </td>
                ))}
                <td className="border border-slate-300 px-2 py-1.5 text-right font-bold bg-blue-50 text-blue-700">
                  {fmtMillion(ciActualCumulative)}
                </td>
              </tr>

              {/* 빈 줄 구분 */}
              <tr><td colSpan={17} className="border border-slate-300 h-1 bg-slate-100"></td></tr>

              {/* CI 비율(%) - 목표 */}
              <tr className="hover:bg-slate-50">
                <td rowSpan={3} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  CI 비율 (%)
                </td>
                <td rowSpan={3} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  <EditableCell cellId="prevCIRatio" value={kpiData.prevYearCIRatio} isPercent />
                </td>
                <td rowSpan={3} className="border border-slate-300 px-3 py-2 text-center font-bold bg-slate-50">
                  <EditableCell cellId="targetCIRatio" value={kpiData.targetCIRatio} isPercent />
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-center font-bold bg-slate-50">목표</td>
                {monthlyCIRatioTarget.map((v, i) => (
                  <td key={i} className="border border-slate-300 px-1 py-1.5 text-right text-slate-600">
                    {fmtPct(v)}
                  </td>
                ))}
                <td className="border border-slate-300 px-2 py-1.5 text-right font-bold bg-slate-50">
                  {fmtPct(ciRatioTargetCumulative)}
                </td>
              </tr>
              {/* CI 비율(%) - 실적 */}
              <tr className="hover:bg-slate-50">
                <td className="border border-slate-300 px-2 py-1.5 text-center font-bold bg-slate-50">실적</td>
                {monthlyCIRatioActual.map((v, i) => (
                  <td key={i} className="border border-slate-300 px-1 py-1.5 text-right text-slate-700 font-medium">
                    {fmtPct(v)}
                  </td>
                ))}
                <td className="border border-slate-300 px-2 py-1.5 text-right font-bold bg-blue-50 text-blue-700">
                  {fmtPct(ciRatioActualCumulative)}
                </td>
              </tr>
              {/* CI 비율(%) - 달성률 */}
              <tr className="hover:bg-slate-50">
                <td className="border border-slate-300 px-2 py-1.5 text-center font-bold text-red-600 bg-slate-50">달성률</td>
                {monthlyAchievement.map((v, i) => (
                  <td key={i} className={`border border-slate-300 px-1 py-1.5 text-right font-bold ${
                    v >= 100 ? 'text-emerald-600' : v > 0 ? 'text-red-600' : 'text-slate-400'
                  }`}>
                    {fmtPct(v)}
                  </td>
                ))}
                <td className={`border border-slate-300 px-2 py-1.5 text-right font-bold ${
                  achievementCumulative >= 100 ? 'text-emerald-600 bg-emerald-50' : achievementCumulative > 0 ? 'text-red-600 bg-red-50' : 'bg-slate-50'
                }`}>
                  {fmtPct(achievementCumulative)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================
          2. CI 실적 업로드 & 요약 차트
         ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Area */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-black text-slate-800 mb-4">CI 실적 업로드</h3>
          <label className={`flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
            isUploading ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
          }`}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
            {isUploading ? (
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-xs text-blue-600">파싱 중...</p>
              </div>
            ) : (
              <div className="text-center">
                <svg className="w-8 h-8 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xs text-slate-500 font-medium">CI실적 Excel 파일 업로드</p>
                <p className="text-[10px] text-slate-400 mt-1">월별 CI실적.xlsx</p>
              </div>
            )}
          </label>
          {uploadError && (
            <p className="text-xs text-red-500 mt-2">{uploadError}</p>
          )}

          {/* Upload History */}
          {uploads.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-bold text-slate-600">업로드 이력</h4>
              {uploads.slice(0, 5).map(u => (
                <div key={u.id} className="flex items-center justify-between text-[10px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  <div>
                    <span className="font-medium text-slate-700">{u.month}월</span>
                    <span className="ml-2">{u.fileName}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-blue-600">{fmtWon(u.totalCIAmount)}</div>
                    <div>{new Date(u.uploadDate).toLocaleDateString('ko-KR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Monthly Chart */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-black text-slate-800 mb-4">CI 금액 월별 추이 (백만원)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 12, border: '1px solid #e2e8f0' }}
                formatter={(v: number) => [`${(v as number).toFixed(1)} 백만원`]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="목표" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="실적" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category Pie Chart */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-black text-slate-800 mb-4">품목별 CI 실적</h3>
          {categoryChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    style={{ fontSize: 10 }}
                  >
                    {categoryChartData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [fmtWon(v as number)]} contentStyle={{ fontSize: 11, borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {categoryChartData.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-slate-600">{item.name}</span>
                    </div>
                    <span className="font-bold text-slate-800">{fmtWon(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-slate-400 text-xs">
              CI 실적 데이터를 업로드해주세요
            </div>
          )}
        </div>
      </div>

      {/* ================================================================
          3. CI 상세 리스트
         ================================================================ */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
          onClick={() => setDetailOpen(!detailOpen)}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black text-slate-800">CI 상세 리스트</h2>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredDetails.length}건
            </span>
          </div>
          <svg className={`w-5 h-5 text-slate-400 transition-transform ${detailOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {detailOpen && (
          <>
            {/* Filters */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-3">
              {/* Month Filter */}
              <select
                value={detailMonth === 'all' ? 'all' : String(detailMonth)}
                onChange={e => setDetailMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="all">전체 월</option>
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>

              {/* Category Filter */}
              <select
                value={detailFilterCategory}
                onChange={e => setDetailFilterCategory(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="all">전체 품목</option>
                {uniqueCategories.filter(c => c !== 'all').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Customer Filter */}
              <select
                value={detailFilterCustomer}
                onChange={e => setDetailFilterCustomer(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="all">전체 고객사</option>
                {uniqueCustomers.filter(c => c !== 'all').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder="품명, 품번, 부품코드, 고객사, 양산처, 차종 검색..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 placeholder-slate-400"
                />
              </div>

              {/* Total */}
              <div className="text-xs text-slate-500">
                CI 합계: <span className="font-bold text-blue-700">{fmtWon(filteredDetails.reduce((s, d) => s + d.ciAmount, 0))}</span>
              </div>
            </div>

            {/* Table */}
            {filteredDetails.length > 0 ? (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 text-center text-xs font-bold text-slate-600 w-10">#</th>
                      {detailMonth === 'all' && <th className="px-3 py-2.5 text-center text-xs font-bold text-slate-600">월</th>}
                      <SortableHeader label="고객사" sortKey="customer" />
                      <SortableHeader label="양산처" sortKey="productionSite" />
                      <SortableHeader label="차종" sortKey="vehicleModel" />
                      <SortableHeader label="부품코드" sortKey="partCode" />
                      <SortableHeader label="품번" sortKey="partNumber" />
                      <SortableHeader label="품명" sortKey="partName" />
                      <SortableHeader label="품목" sortKey="category" />
                      <SortableHeader label="기준단가" sortKey="basePrice" align="right" />
                      <SortableHeader label="현단가" sortKey="currentPrice" align="right" />
                      <th className="px-3 py-2.5 text-xs font-bold text-slate-600 text-right">CI율(%)</th>
                      <SortableHeader label="수량" sortKey="quantity" align="right" />
                      <SortableHeader label="CI금액" sortKey="ciAmount" align="right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDetails.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                        {detailMonth === 'all' && (
                          <td className="px-3 py-2 text-center">
                            <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {(item as CIDetailItem & { month: number }).month}월
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2 font-medium text-slate-800">{item.customer}</td>
                        <td className="px-3 py-2 text-slate-600">{item.productionSite}</td>
                        <td className="px-3 py-2 text-slate-600">{item.vehicleModel}</td>
                        <td className="px-3 py-2 font-mono text-slate-600 text-[10px]">{item.partCode}</td>
                        <td className="px-3 py-2 font-mono text-slate-600 text-[10px]">{item.partNumber}</td>
                        <td className="px-3 py-2 text-slate-700">{item.partName}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            item.category === 'PAINT' ? 'bg-purple-100 text-purple-700' :
                            item.category === 'RESIN' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {item.category}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{item.basePrice > 0 ? item.basePrice.toLocaleString() : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{item.currentPrice > 0 ? item.currentPrice.toLocaleString() : '-'}</td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${
                          item.basePrice > 0 && item.currentPrice > 0
                            ? ((item.basePrice - item.currentPrice) / item.basePrice * 100) >= 0 ? 'text-emerald-600' : 'text-red-600'
                            : 'text-slate-400'
                        }`}>
                          {item.basePrice > 0 && item.currentPrice > 0
                            ? ((item.basePrice - item.currentPrice) / item.basePrice * 100).toFixed(2) + '%'
                            : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700 font-medium">{item.quantity.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">{fmtWon(item.ciAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                    <tr>
                      <td colSpan={detailMonth === 'all' ? 12 : 11} className="px-3 py-2.5 text-right font-bold text-slate-700">
                        합계
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-700">
                        {filteredDetails.reduce((s, d) => s + d.quantity, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-blue-700">
                        {fmtWon(filteredDetails.reduce((s, d) => s + d.ciAmount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm font-medium">CI 상세 데이터가 없습니다</p>
                <p className="text-xs mt-1">CI 실적 Excel 파일을 업로드하면 상세 내역이 표시됩니다.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CRView;
