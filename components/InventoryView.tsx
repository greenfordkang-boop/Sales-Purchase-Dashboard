
import React, { useState, useEffect, useMemo } from 'react';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { inventoryService } from '../services/supabaseService';

// Material Item Type (Resin/Paint)
interface MaterialItem {
  id: string;
  code: string;      // 재질코드
  name: string;      // 재질명
  unit: string;      // 단위
  location: string;  // 창고명
  qty: number;       // 현재고
}

// Parts/Warehouse Item Type
interface InventoryItem {
  id: string;
  code: string;
  customerPN?: string;
  name: string;
  spec?: string;
  model?: string;
  unit: string;
  status?: string;
  location: string;
  qty: number;
  unitPrice?: number;
  amount?: number;
}

// Helper: Parse numeric value - handles comma as thousands separator
const parseNumericValue = (value: string): number => {
  if (!value || typeof value !== 'string') return 0;
  // Remove all commas and trim whitespace
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

// Helper: Parse CSV line - SIMPLE approach
// Handles: quoted fields, thousands separators in numbers
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));

  // Post-process: merge split numbers (e.g., ["1", "234.00"] -> ["1,234.00"])
  // Only merge from the END of array (where qty column should be)
  const merged: string[] = [];
  let i = 0;

  while (i < result.length) {
    const val = result[i];

    // Only try to merge if: pure digits AND next exists AND next looks like continuation
    if (/^\d+$/.test(val) && i + 1 < result.length) {
      const next = result[i + 1];
      // Check if next is: 3 digits, OR 3+ digits with decimal, OR 2-3 digits with decimal
      if (/^\d{2,3}$/.test(next) || /^\d{2,3}\.\d*$/.test(next)) {
        // Merge them
        merged.push(val + ',' + next);
        i += 2;
        continue;
      }
    }

    merged.push(val);
    i++;
  }

  return merged;
};

// Parse Material CSV (Resin/Paint)
// CSV 형식: 재질코드, 재질명, 단위, 창고명, 현재고 (5컬럼)
// 또는: index, 재질코드, 재질명, 단위, 창고명, 현재고 (6컬럼)
const parseMaterialCSV = (csvText: string): MaterialItem[] => {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    console.warn('CSV 파일에 데이터가 없습니다.');
    return [];
  }

  // 헤더 분석으로 컬럼 수 확인
  const headerValues = parseCSVLine(lines[0]);
  console.log('📋 CSV Header:', headerValues);
  console.log('📋 Total lines:', lines.length - 1);

  const result: MaterialItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);

    // 최소 5개 컬럼 필요
    if (values.length < 5) {
      console.warn(`Line ${i}: 컬럼 부족 (${values.length}개)`, values);
      continue;
    }

    // 인덱스 컬럼 감지: 첫 값이 순수 숫자이고 컬럼이 6개 이상
    const firstVal = values[0];
    const isFirstNumeric = /^\d+$/.test(firstVal);
    const hasIndexColumn = isFirstNumeric && values.length >= 6;
    const offset = hasIndexColumn ? 1 : 0;

    // 마지막 값이 qty (숫자여야 함)
    const qtyIndex = values.length - 1;
    const qtyRaw = values[qtyIndex];
    const qty = parseNumericValue(qtyRaw);

    // 컬럼 매핑 (끝에서부터 역순으로)
    const locationIndex = qtyIndex - 1;
    const unitIndex = qtyIndex - 2;
    const nameIndex = qtyIndex - 3;
    const codeIndex = qtyIndex - 4;

    const code = values[codeIndex] || '';
    if (!code) continue;

    const item: MaterialItem = {
      id: `mat-${i}`,
      code: code,
      name: values[nameIndex] || '',
      unit: values[unitIndex] || 'Kg',
      location: values[locationIndex] || '',
      qty: qty
    };

    // 첫 3줄 디버그 출력
    if (i <= 3) {
      console.log(`📋 Line ${i}:`, { raw: values, parsed: item, qtyRaw });
    }

    result.push(item);
  }

  console.log(`✅ 파싱 완료: ${result.length}개 항목, 총 수량: ${result.reduce((s, x) => s + x.qty, 0).toLocaleString()}`);
  return result;
};

// Parse Parts CSV (existing warehouse format)
const parsePartsCSV = (csvText: string): InventoryItem[] => {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const result: InventoryItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length >= 5 && values[0]) {
      result.push({
        id: `parts-${i}`,
        code: values[0] || '',
        customerPN: values[1] || '',
        name: values[2] || '',
        spec: values[3] || '',
        model: values[4] || '',
        unit: values[5] || 'EA',
        status: values[6] || '',
        location: values[7] || '',
        qty: parseNumericValue(values[8]),
        unitPrice: parseNumericValue(values[9]),
        amount: parseNumericValue(values[10])
      });
    }
  }
  return result;
};

const InventoryView: React.FC = () => {
  // --- Sub Tab State ---
  const [activeSubTab, setActiveSubTab] = useState<'resin' | 'paint' | 'parts'>('resin');

  // --- Initialization Helpers ---
  const getInitialData = () => {
    if (typeof window === 'undefined') {
      return { resin: [], paint: [], parts: [] };
    }
    try {
      const stored = localStorage.getItem('dashboard_inventory_v2');
      if (stored) {
        return JSON.parse(stored);
      }
      return { resin: [], paint: [], parts: [] };
    } catch (e) {
      console.error("Failed to load inventory data", e);
      return { resin: [], paint: [], parts: [] };
    }
  };

  // --- State ---
  const [inventoryData, setInventoryData] = useState<{
    resin: MaterialItem[];
    paint: MaterialItem[];
    parts: InventoryItem[];
  }>(getInitialData);

  // Filter & Sort States
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Parts Pivot View State
  const [partsViewMode, setPartsViewMode] = useState<'list' | 'pivot'>('list');
  const [pivotRows, setPivotRows] = useState<string[]>(['model', 'name']);
  const [pivotCol, setPivotCol] = useState<string>('location');
  const [pivotSortConfig, setPivotSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Pivot Field Options
  const PIVOT_FIELDS = [
    { key: 'model', label: '차종명' },
    { key: 'customerPN', label: '고객사 P/N' },
    { key: 'code', label: '품목코드' },
    { key: 'name', label: '품목명' },
    { key: 'spec', label: '규격' },
    { key: 'unit', label: '단위' },
    { key: 'status', label: '상태' },
    { key: 'location', label: '창고명' },
  ];

  // --- Persistence ---
  useEffect(() => {
    const hasData = inventoryData.resin.length > 0 ||
                   inventoryData.paint.length > 0 ||
                   inventoryData.parts.length > 0;
    if (hasData) {
      localStorage.setItem('dashboard_inventory_v2', JSON.stringify(inventoryData));
    }
  }, [inventoryData]);

  // --- Smart Supabase Load ---
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;
      try {
        // Load from inventory_v2 table if exists
        const supabaseData = await inventoryService.getInventoryV2?.();
        if (supabaseData && (supabaseData.resin?.length > 0 || supabaseData.paint?.length > 0 || supabaseData.parts?.length > 0)) {
          setInventoryData(supabaseData);
          localStorage.setItem('dashboard_inventory_v2', JSON.stringify(supabaseData));
          console.log('✅ Supabase에서 재고 데이터 로드');
        }
      } catch (err) {
        console.log('ℹ️ Supabase 재고 데이터 없음 - localStorage 유지');
      }
    };
    loadFromSupabase();
  }, []);

  // --- Handlers ---
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'resin' | 'paint' | 'parts') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const csvText = event.target?.result as string;
        let data: any[];

        if (type === 'parts') {
          data = parsePartsCSV(csvText);
        } else {
          data = parseMaterialCSV(csvText);
        }

        const updatedData = { ...inventoryData, [type]: data };
        setInventoryData(updatedData);
        localStorage.setItem('dashboard_inventory_v2', JSON.stringify(updatedData));

        // Supabase sync
        if (isSupabaseConfigured()) {
          try {
            await inventoryService.saveInventoryV2?.(updatedData);
            console.log(`✅ ${type} 재고 Supabase 동기화 완료`);
          } catch (err) {
            console.error('Supabase 동기화 실패:', err);
          }
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  // Reset filters when tab changes
  useEffect(() => {
    setFilterValues({});
    setSortConfig(null);
  }, [activeSubTab]);

  // --- Derived Data ---
  const filteredResinData = useMemo(() => {
    let result = inventoryData.resin.filter(item => item.code && item.code.trim() !== '');

    // Apply filters
    if (filterValues.code) result = result.filter(item => item.code.toLowerCase().includes(filterValues.code.toLowerCase()));
    if (filterValues.name) result = result.filter(item => item.name.toLowerCase().includes(filterValues.name.toLowerCase()));
    if (filterValues.location) result = result.filter(item => item.location.toLowerCase().includes(filterValues.location.toLowerCase()));
    if (filterValues.qty) result = result.filter(item => String(item.qty).includes(filterValues.qty));

    // Apply sorting
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key as keyof MaterialItem];
        const bVal = b[sortConfig.key as keyof MaterialItem];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc'
          ? String(aVal).localeCompare(String(bVal), 'ko')
          : String(bVal).localeCompare(String(aVal), 'ko');
      });
    }

    return result;
  }, [inventoryData.resin, filterValues, sortConfig]);

  const filteredPaintData = useMemo(() => {
    let result = inventoryData.paint.filter(item => item.code && item.code.trim() !== '');

    if (filterValues.code) result = result.filter(item => item.code.toLowerCase().includes(filterValues.code.toLowerCase()));
    if (filterValues.name) result = result.filter(item => item.name.toLowerCase().includes(filterValues.name.toLowerCase()));
    if (filterValues.location) result = result.filter(item => item.location.toLowerCase().includes(filterValues.location.toLowerCase()));
    if (filterValues.qty) result = result.filter(item => String(item.qty).includes(filterValues.qty));

    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key as keyof MaterialItem];
        const bVal = b[sortConfig.key as keyof MaterialItem];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc'
          ? String(aVal).localeCompare(String(bVal), 'ko')
          : String(bVal).localeCompare(String(aVal), 'ko');
      });
    }

    return result;
  }, [inventoryData.paint, filterValues, sortConfig]);

  const filteredPartsData = useMemo(() => {
    let result = inventoryData.parts.filter(item => item.code && item.code.trim() !== '');

    if (filterValues.code) result = result.filter(item => item.code.toLowerCase().includes(filterValues.code.toLowerCase()));
    if (filterValues.customerPN) result = result.filter(item => (item.customerPN || '').toLowerCase().includes(filterValues.customerPN.toLowerCase()));
    if (filterValues.name) result = result.filter(item => item.name.toLowerCase().includes(filterValues.name.toLowerCase()));
    if (filterValues.spec) result = result.filter(item => (item.spec || '').toLowerCase().includes(filterValues.spec.toLowerCase()));
    if (filterValues.model) result = result.filter(item => (item.model || '').toLowerCase().includes(filterValues.model.toLowerCase()));
    if (filterValues.status) result = result.filter(item => (item.status || '').toLowerCase().includes(filterValues.status.toLowerCase()));
    if (filterValues.location) result = result.filter(item => item.location.toLowerCase().includes(filterValues.location.toLowerCase()));
    if (filterValues.qty) result = result.filter(item => String(item.qty).includes(filterValues.qty));

    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key as keyof InventoryItem];
        const bVal = b[sortConfig.key as keyof InventoryItem];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc'
          ? String(aVal || '').localeCompare(String(bVal || ''), 'ko')
          : String(bVal || '').localeCompare(String(aVal || ''), 'ko');
      });
    }

    return result;
  }, [inventoryData.parts, filterValues, sortConfig]);

  // --- Pivot Data for Parts ---
  const pivotData = useMemo(() => {
    const rawData = inventoryData.parts.filter(item => item.code && item.code.trim() !== '');

    // Get unique column values
    let colValues: string[] = [];
    if (pivotCol) {
      const distinct = new Set<string>(rawData.map(item => String(item[pivotCol as keyof InventoryItem] || 'N/A')));
      colValues = Array.from(distinct).sort();
    }

    // Group data
    const groups = new Map<string, any>();
    rawData.forEach(item => {
      const rowKey = pivotRows.map(field => String(item[field as keyof InventoryItem] || '-')).join('||');

      if (!groups.has(rowKey)) {
        const initialGroup: any = { _key: rowKey, _count: 0, _totalQty: 0 };
        pivotRows.forEach(field => {
          initialGroup[field] = item[field as keyof InventoryItem] || '-';
        });
        colValues.forEach(cv => initialGroup[`_col_${cv}`] = 0);
        groups.set(rowKey, initialGroup);
      }

      const group = groups.get(rowKey);
      group._count += 1;
      group._totalQty += (item.qty || 0);

      if (pivotCol) {
        const colVal = String(item[pivotCol as keyof InventoryItem] || 'N/A');
        group[`_col_${colVal}`] = (group[`_col_${colVal}`] || 0) + (item.qty || 0);
      }
    });

    // Apply sorting
    let rows = Array.from(groups.values());
    if (pivotSortConfig) {
      rows.sort((a, b) => {
        const valA = a[pivotSortConfig.key];
        const valB = b[pivotSortConfig.key];
        if (pivotSortConfig.key === '_totalQty') {
          return pivotSortConfig.direction === 'asc' ? valA - valB : valB - valA;
        }
        const strA = String(valA || '');
        const strB = String(valB || '');
        return pivotSortConfig.direction === 'asc'
          ? strA.localeCompare(strB, 'ko')
          : strB.localeCompare(strA, 'ko');
      });
    }

    return {
      colValues,
      rows,
      grandTotalQty: rawData.reduce((sum, item) => sum + (item.qty || 0), 0)
    };
  }, [inventoryData.parts, pivotRows, pivotCol, pivotSortConfig]);

  // Pivot Handlers
  const togglePivotRow = (fieldKey: string) => {
    setPivotRows(prev => prev.includes(fieldKey) ? prev.filter(k => k !== fieldKey) : [...prev, fieldKey]);
  };

  const handlePivotSort = (key: string) => {
    setPivotSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  const handleDownloadPivot = () => {
    const rowHeaders = pivotRows.map(key => PIVOT_FIELDS.find(f => f.key === key)?.label || key);
    const headers = [...rowHeaders, ...pivotData.colValues, '합계(Total)'];
    const rows = pivotData.rows.map(row => {
      const rowData = pivotRows.map(key => row[key]);
      const colData = pivotData.colValues.map(colVal => row[`_col_${colVal}`] || 0);
      return [...rowData, ...colData, row._totalQty];
    });
    downloadCSV('부품재고_피봇분석', headers, rows);
  };

  // --- Download Handlers ---
  const handleDownloadResin = () => {
    const headers = ['재질코드', '재질명', '단위', '창고명', '현재고'];
    const rows = filteredResinData.map(item => [item.code, item.name, item.unit, item.location, item.qty]);
    downloadCSV('Resin_재고현황', headers, rows);
  };

  const handleDownloadPaint = () => {
    const headers = ['재질코드', '재질명', '단위', '창고명', '현재고'];
    const rows = filteredPaintData.map(item => [item.code, item.name, item.unit, item.location, item.qty]);
    downloadCSV('도료_재고현황', headers, rows);
  };

  const handleDownloadParts = () => {
    const headers = ['품목코드', '고객사 P/N', '품목명', '규격', '차종명', '단위', '상태', '창고명', '재고'];
    const rows = filteredPartsData.map(item => [
      item.code, item.customerPN, item.name, item.spec, item.model,
      item.unit, item.status, item.location, item.qty
    ]);
    downloadCSV('부품_창고별재고', headers, rows);
  };

  // --- Totals ---
  const resinTotal = filteredResinData.reduce((sum, item) => sum + item.qty, 0);
  const paintTotal = filteredPaintData.reduce((sum, item) => sum + item.qty, 0);
  const partsTotal = filteredPartsData.reduce((sum, item) => sum + item.qty, 0);

  // --- Sub Tabs Config ---
  const SUB_TABS = [
    { id: 'resin', label: 'Resin 재고', color: 'blue' },
    { id: 'paint', label: '도료 재고', color: 'emerald' },
    { id: 'parts', label: '부품재고(창고별재고)', color: 'violet' }
  ];

  // Sortable Header Component
  const SortableHeader = ({ label, sortKey, align = 'left' }: { label: string; sortKey: string; align?: string }) => (
    <th
      className={`px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors select-none group ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
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

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">

      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-800">재고 현황 (Inventory)</h2>
            <p className="text-sm text-slate-500 mt-1">Resin, 도료, 부품 재고 현황 관리</p>
          </div>

          {/* Sub Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {SUB_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeSubTab === tab.id
                    ? `bg-white text-${tab.color}-600 shadow-sm`
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* =========================== RESIN TAB =========================== */}
      {activeSubTab === 'resin' && (
        <div className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">등록 품목</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{inventoryData.resin.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">검색 결과</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{filteredResinData.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">총 재고량</span>
              <h3 className="text-lg font-black text-blue-600 mt-1">{resinTotal.toLocaleString()} Kg</h3>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
                Resin 재고 리스트
              </h3>
              <div className="flex items-center gap-2">
                <label className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1">
                  <span>📤 CSV 업로드</span>
                  <input type="file" accept=".csv" onChange={(e) => handleUpload(e, 'resin')} className="hidden" />
                </label>
                <button onClick={handleDownloadResin} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  엑셀 다운로드
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <SortableHeader label="재질코드" sortKey="code" />
                    <SortableHeader label="재질명" sortKey="name" />
                    <SortableHeader label="단위" sortKey="unit" align="center" />
                    <SortableHeader label="창고명" sortKey="location" align="center" />
                    <SortableHeader label="현재고" sortKey="qty" align="right" />
                  </tr>
                  <tr className="bg-slate-50">
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"><input type="text" placeholder="재질코드" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.code || ''} onChange={(e) => handleFilterChange('code', e.target.value)} /></th>
                    <th className="px-2 py-2"><input type="text" placeholder="재질명" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.name || ''} onChange={(e) => handleFilterChange('name', e.target.value)} /></th>
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"><input type="text" placeholder="창고명" className="w-full p-1 border rounded text-xs font-normal text-center" value={filterValues.location || ''} onChange={(e) => handleFilterChange('location', e.target.value)} /></th>
                    <th className="px-2 py-2"><input type="text" placeholder="현재고" className="w-full p-1 border rounded text-xs font-normal text-right" value={filterValues.qty || ''} onChange={(e) => handleFilterChange('qty', e.target.value)} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResinData.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-center text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{item.code}</td>
                      <td className="px-4 py-3 text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.unit}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.location}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">{item.qty.toLocaleString()}</td>
                    </tr>
                  ))}
                  {filteredResinData.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">데이터가 없습니다. CSV를 업로드해주세요.</td></tr>
                  )}
                </tbody>
                {filteredResinData.length > 0 && (
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-center">합계 (Total)</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-600">{resinTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================== PAINT TAB =========================== */}
      {activeSubTab === 'paint' && (
        <div className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">등록 품목</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{inventoryData.paint.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">검색 결과</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{filteredPaintData.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">총 재고량</span>
              <h3 className="text-lg font-black text-emerald-600 mt-1">{paintTotal.toLocaleString()} Kg</h3>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <span className="w-1 h-5 bg-emerald-600 rounded-full"></span>
                도료 재고 리스트
              </h3>
              <div className="flex items-center gap-2">
                <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1">
                  <span>📤 CSV 업로드</span>
                  <input type="file" accept=".csv" onChange={(e) => handleUpload(e, 'paint')} className="hidden" />
                </label>
                <button onClick={handleDownloadPaint} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  엑셀 다운로드
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <SortableHeader label="재질코드" sortKey="code" />
                    <SortableHeader label="재질명" sortKey="name" />
                    <SortableHeader label="단위" sortKey="unit" align="center" />
                    <SortableHeader label="창고명" sortKey="location" align="center" />
                    <SortableHeader label="현재고" sortKey="qty" align="right" />
                  </tr>
                  <tr className="bg-slate-50">
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"><input type="text" placeholder="재질코드" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.code || ''} onChange={(e) => handleFilterChange('code', e.target.value)} /></th>
                    <th className="px-2 py-2"><input type="text" placeholder="재질명" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.name || ''} onChange={(e) => handleFilterChange('name', e.target.value)} /></th>
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"><input type="text" placeholder="창고명" className="w-full p-1 border rounded text-xs font-normal text-center" value={filterValues.location || ''} onChange={(e) => handleFilterChange('location', e.target.value)} /></th>
                    <th className="px-2 py-2"><input type="text" placeholder="현재고" className="w-full p-1 border rounded text-xs font-normal text-right" value={filterValues.qty || ''} onChange={(e) => handleFilterChange('qty', e.target.value)} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPaintData.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-center text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{item.code}</td>
                      <td className="px-4 py-3 text-slate-800">{item.name}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.unit}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{item.location}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{item.qty.toLocaleString()}</td>
                    </tr>
                  ))}
                  {filteredPaintData.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">데이터가 없습니다. CSV를 업로드해주세요.</td></tr>
                  )}
                </tbody>
                {filteredPaintData.length > 0 && (
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-center">합계 (Total)</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{paintTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================== PARTS TAB =========================== */}
      {activeSubTab === 'parts' && (
        <div className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">등록 품목</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{inventoryData.parts.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">검색 결과</span>
              <h3 className="text-lg font-black text-slate-800 mt-1">{filteredPartsData.length.toLocaleString()} Items</h3>
            </div>
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400">총 재고수량</span>
              <h3 className="text-lg font-black text-violet-600 mt-1">{partsTotal.toLocaleString()} EA</h3>
            </div>
            {/* View Mode Toggle */}
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                <button onClick={() => setPartsViewMode('list')} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${partsViewMode === 'list' ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-400'}`}>리스트</button>
                <button onClick={() => setPartsViewMode('pivot')} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${partsViewMode === 'pivot' ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-400'}`}>피봇분석</button>
              </div>
            </div>
          </div>

          {/* List View */}
          {partsViewMode === 'list' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-slate-800 flex items-center gap-2">
                  <span className="w-1 h-5 bg-violet-600 rounded-full"></span>
                  부품재고 (창고별재고) 리스트
                </h3>
                <div className="flex items-center gap-2">
                  <label className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1">
                    <span>📤 CSV 업로드</span>
                    <input type="file" accept=".csv" onChange={(e) => handleUpload(e, 'parts')} className="hidden" />
                  </label>
                  <button onClick={handleDownloadParts} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    엑셀 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <SortableHeader label="품목코드" sortKey="code" />
                      <SortableHeader label="고객사 P/N" sortKey="customerPN" />
                      <SortableHeader label="품목명" sortKey="name" />
                      <SortableHeader label="규격" sortKey="spec" />
                      <SortableHeader label="차종명" sortKey="model" align="center" />
                      <SortableHeader label="단위" sortKey="unit" align="center" />
                      <SortableHeader label="상태" sortKey="status" align="center" />
                      <SortableHeader label="창고명" sortKey="location" align="center" />
                      <SortableHeader label="재고" sortKey="qty" align="right" />
                    </tr>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-2"><input type="text" placeholder="품목코드" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.code || ''} onChange={(e) => handleFilterChange('code', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="고객사 P/N" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.customerPN || ''} onChange={(e) => handleFilterChange('customerPN', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="품목명" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.name || ''} onChange={(e) => handleFilterChange('name', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="규격" className="w-full p-1 border rounded text-xs font-normal" value={filterValues.spec || ''} onChange={(e) => handleFilterChange('spec', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="차종명" className="w-full p-1 border rounded text-xs font-normal text-center" value={filterValues.model || ''} onChange={(e) => handleFilterChange('model', e.target.value)} /></th>
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2"><input type="text" placeholder="상태" className="w-full p-1 border rounded text-xs font-normal text-center" value={filterValues.status || ''} onChange={(e) => handleFilterChange('status', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="창고명" className="w-full p-1 border rounded text-xs font-normal text-center" value={filterValues.location || ''} onChange={(e) => handleFilterChange('location', e.target.value)} /></th>
                      <th className="px-2 py-2"><input type="text" placeholder="재고" className="w-full p-1 border rounded text-xs font-normal text-right" value={filterValues.qty || ''} onChange={(e) => handleFilterChange('qty', e.target.value)} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPartsData.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-slate-600">{item.code}</td>
                        <td className="px-4 py-3 text-slate-600">{item.customerPN || '-'}</td>
                        <td className="px-4 py-3 text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-slate-600">{item.spec || '-'}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{item.model || '-'}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{item.unit}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{item.status || '-'}</td>
                        <td className="px-4 py-3 text-center text-slate-600">{item.location}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-violet-600">{item.qty.toLocaleString()}</td>
                      </tr>
                    ))}
                    {filteredPartsData.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">데이터가 없습니다. CSV를 업로드해주세요.</td></tr>
                    )}
                  </tbody>
                  {filteredPartsData.length > 0 && (
                    <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                      <tr>
                        <td colSpan={8} className="px-4 py-3 text-center">합계 (Total)</td>
                        <td className="px-4 py-3 text-right font-mono text-violet-600">{partsTotal.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Pivot View */}
          {partsViewMode === 'pivot' && (
            <div className="space-y-4">
              {/* Pivot Config */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                  <div className="flex-1">
                    <span className="text-xs font-bold text-slate-500 block mb-2">행(Rows) - 그룹화 기준</span>
                    <div className="flex flex-wrap gap-2">
                      {PIVOT_FIELDS.filter(f => f.key !== pivotCol).map(field => (
                        <button key={field.key} onClick={() => togglePivotRow(field.key)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${pivotRows.includes(field.key) ? 'bg-violet-100 text-violet-700 border border-violet-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                          {field.label} {pivotRows.includes(field.key) && `(${pivotRows.indexOf(field.key) + 1})`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-500 block mb-2">열(Column) - 피봇 기준</span>
                    <select value={pivotCol} onChange={(e) => setPivotCol(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 bg-white">
                      {PIVOT_FIELDS.filter(f => !pivotRows.includes(f.key)).map(field => (
                        <option key={field.key} value={field.key}>{field.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Pivot Table */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-black text-slate-800 flex items-center gap-2">
                    <span className="w-1 h-5 bg-violet-600 rounded-full"></span>
                    피봇 분석 테이블
                    <span className="text-xs font-normal text-slate-400 ml-2">({pivotData.rows.length.toLocaleString()} 그룹)</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <label className="bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1">
                      <span>📤 CSV 업로드</span>
                      <input type="file" accept=".csv" onChange={(e) => handleUpload(e, 'parts')} className="hidden" />
                    </label>
                    <button onClick={handleDownloadPivot} className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      엑셀 다운로드
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                        {pivotRows.map(key => (
                          <th key={key} className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100" onClick={() => handlePivotSort(key)}>
                            {PIVOT_FIELDS.find(f => f.key === key)?.label || key}
                            <span className={`ml-1 text-[10px] ${pivotSortConfig?.key === key ? 'text-violet-600' : 'text-slate-300'}`}>
                              {pivotSortConfig?.key === key ? (pivotSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                            </span>
                          </th>
                        ))}
                        {pivotData.colValues.map(colVal => (
                          <th key={colVal} className="px-4 py-3 text-right bg-violet-50 text-violet-700">{colVal}</th>
                        ))}
                        <th className="px-4 py-3 text-right bg-slate-100 cursor-pointer hover:bg-slate-200" onClick={() => handlePivotSort('_totalQty')}>
                          합계
                          <span className={`ml-1 text-[10px] ${pivotSortConfig?.key === '_totalQty' ? 'text-violet-600' : 'text-slate-300'}`}>
                            {pivotSortConfig?.key === '_totalQty' ? (pivotSortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pivotData.rows.map((row, idx) => (
                        <tr key={row._key || idx} className="hover:bg-slate-50">
                          {pivotRows.map(key => (
                            <td key={key} className="px-4 py-2 text-slate-700">{row[key] || '-'}</td>
                          ))}
                          {pivotData.colValues.map(colVal => (
                            <td key={colVal} className="px-4 py-2 text-right font-mono text-violet-600">
                              {(row[`_col_${colVal}`] || 0).toLocaleString()}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-right font-mono font-bold text-slate-800 bg-slate-50">
                            {(row._totalQty || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {pivotData.rows.length === 0 && (
                        <tr><td colSpan={pivotRows.length + pivotData.colValues.length + 1} className="px-4 py-12 text-center text-slate-400">데이터가 없습니다.</td></tr>
                      )}
                    </tbody>
                    {pivotData.rows.length > 0 && (
                      <tfoot className="bg-violet-100 font-bold text-violet-800 border-t-2 border-violet-200">
                        <tr>
                          <td colSpan={pivotRows.length} className="px-4 py-3 text-center">총계 (Grand Total)</td>
                          {pivotData.colValues.map(colVal => (
                            <td key={colVal} className="px-4 py-3 text-right font-mono">
                              {pivotData.rows.reduce((sum, row) => sum + (row[`_col_${colVal}`] || 0), 0).toLocaleString()}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right font-mono">{pivotData.grandTotalQty.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InventoryView;
