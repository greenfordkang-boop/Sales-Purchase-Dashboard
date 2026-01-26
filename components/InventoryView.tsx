
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { parseInventoryCSV, InventoryItem } from '../utils/inventoryDataParser';
import { downloadCSV } from '../utils/csvExport';

// Type definition for column configuration
interface ColumnDef {
  key: keyof InventoryItem;
  label: string;
  align?: 'left' | 'center' | 'right';
  format?: (value: any) => string;
  isFilterable?: boolean;
}

// Pivot Configuration Types
interface PivotConfig {
  rowFields: string[];
  colField: string;
  valueField: 'qty';
}

const AVAILABLE_PIVOT_FIELDS = [
  { key: 'model', label: '차종명' },
  { key: 'customerPN', label: '고객사 P/N' },
  { key: 'code', label: '품목코드' },
  { key: 'name', label: '품목명' },
  { key: 'spec', label: '규격' },
  { key: 'unit', label: '단위' },
  { key: 'status', label: '상태' },
  { key: 'location', label: '창고명' },
];

const InventoryView: React.FC = () => {
  // --- Initialization Helpers ---
  const getInitialInventoryData = () => {
    if (typeof window === 'undefined') {
        return { warehouse: [], material: [], parts: [], product: [] };
    }
    try {
      const stored = localStorage.getItem('dashboard_inventoryData');
      if (stored) {
        return JSON.parse(stored);
      }
      return { warehouse: [], material: [], parts: [], product: [] };
    } catch (e) {
      console.error("Failed to load inventory data", e);
      return { warehouse: [], material: [], parts: [], product: [] };
    }
  };

  // --- State ---
  const [inventoryData, setInventoryData] = useState<{
    warehouse: InventoryItem[];
    material: InventoryItem[];
    parts: InventoryItem[];
    product: InventoryItem[];
  }>(getInitialInventoryData);

  // View Mode: 'list' (Existing) or 'pivot' (New)
  const [viewMode, setViewMode] = useState<'list' | 'pivot'>('list');

  // List View State
  const [activeInventoryType, setActiveInventoryType] = useState<'warehouse' | 'material' | 'parts' | 'product'>('warehouse');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [listSortConfig, setListSortConfig] = useState<{ key: keyof InventoryItem; direction: 'asc' | 'desc' } | null>(null);

  // Pivot View State
  const [pivotRows, setPivotRows] = useState<string[]>(['model', 'name']);
  const [pivotCol, setPivotCol] = useState<string>('location');
  
  // Pivot Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('dashboard_inventoryData', JSON.stringify(inventoryData));
  }, [inventoryData]);

  // Reset Filters when type changes
  useEffect(() => {
    setFilterValues({});
    setListSortConfig(null);
  }, [activeInventoryType]);

  // Generic Sorting Helper
  const sortData = <T,>(data: T[], config: { key: keyof T; direction: 'asc' | 'desc' } | null) => {
    if (!config) return data;
    return [...data].sort((a, b) => {
      const aVal = a[config.key];
      const bVal = b[config.key];

      if (aVal === bVal) return 0;
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return config.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      
      if (aStr < bStr) return config.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return config.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // --- Configuration per Type (List View) ---
  const COLUMN_CONFIG: Record<string, ColumnDef[]> = {
    warehouse: [
      { key: 'code', label: '품목코드', isFilterable: true },
      { key: 'customerPN', label: '고객사 P/N', isFilterable: true },
      { key: 'name', label: '품목명', isFilterable: true },
      { key: 'spec', label: '규격', isFilterable: true },
      { key: 'model', label: '차종명', align: 'center', isFilterable: true },
      { key: 'unit', label: '단위', align: 'center' },
      { key: 'status', label: '상태', align: 'center', isFilterable: true },
      { key: 'location', label: '창고명', align: 'center', isFilterable: true },
      { 
        key: 'qty', 
        label: '재고', 
        align: 'right', 
        format: (v) => typeof v === 'number' ? v.toLocaleString() : '0', 
        isFilterable: true 
      },
    ],
    material: [
      { key: 'code', label: '재질코드', isFilterable: true },
      { key: 'name', label: '재질명', isFilterable: true },
      { key: 'unit', label: '단위', align: 'center' },
      { key: 'location', label: '창고명', align: 'center', isFilterable: true },
      { 
        key: 'qty', 
        label: '현재고', 
        align: 'right', 
        format: (v) => typeof v === 'number' ? v.toLocaleString() : '0', 
        isFilterable: true 
      },
    ],
    parts: [
      { key: 'code', label: '부품코드', isFilterable: true },
      { key: 'name', label: '부품명', isFilterable: true },
      { key: 'spec', label: '규격', isFilterable: true },
      { key: 'unit', label: '단위', align: 'center' },
      { key: 'location', label: '보관위치', align: 'center', isFilterable: true },
      { key: 'qty', label: '재고수량', align: 'right', format: (v) => v.toLocaleString(), isFilterable: true },
      { key: 'unitPrice', label: '단가', align: 'right', format: (v) => v ? `₩${v.toLocaleString()}` : '-' },
      { key: 'amount', label: '금액', align: 'right', format: (v) => v ? `₩${v.toLocaleString()}` : '-', isFilterable: true },
    ],
    product: [
      { key: 'code', label: '제품코드', isFilterable: true },
      { key: 'name', label: '제품명', isFilterable: true },
      { key: 'spec', label: '규격', isFilterable: true },
      { key: 'model', label: '모델', align: 'center', isFilterable: true },
      { key: 'unit', label: '단위', align: 'center' },
      { key: 'location', label: '출하창고', align: 'center', isFilterable: true },
      { key: 'qty', label: '제품재고', align: 'right', format: (v) => v.toLocaleString(), isFilterable: true },
      { key: 'amount', label: '재고금액', align: 'right', format: (v) => v ? `₩${v.toLocaleString()}` : '-', isFilterable: true },
    ]
  };

  // --- Derived Data for LIST VIEW ---
  const currentColumns = COLUMN_CONFIG[activeInventoryType];
  const currentInventoryList = inventoryData[activeInventoryType];
  
  const validInventoryItems = useMemo(() => {
    return currentInventoryList.filter(item => item.code && item.code.trim() !== '');
  }, [currentInventoryList]);

  const filteredInventoryList = useMemo(() => {
    const result = validInventoryItems.filter(item => {
      return currentColumns.every(col => {
        if (!col.isFilterable) return true;
        const filterVal = filterValues[col.key];
        if (!filterVal) return true;
        
        const itemVal = item[col.key];
        if (itemVal === undefined || itemVal === null) return false;
        
        return String(itemVal).toLowerCase().includes(filterVal.toLowerCase());
      });
    });
    return sortData(result, listSortConfig);
  }, [validInventoryItems, filterValues, currentColumns, listSortConfig]);

  const totalInventoryQty = filteredInventoryList.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalInventoryAmount = filteredInventoryList.reduce((sum, item) => sum + (item.amount || 0), 0);
  const showAmountMetric = validInventoryItems.some(item => item.amount && item.amount > 0);


  // --- Derived Data for PIVOT VIEW ---
  const pivotData = useMemo(() => {
    const rawData = inventoryData.warehouse.filter(item => item.code && item.code.trim() !== ''); // Use Warehouse Data
    
    // 1. Get Unique Column Values (if colField is selected)
    let colValues: string[] = [];
    if (pivotCol) {
      const distinct = new Set<string>(rawData.map(item => String(item[pivotCol as keyof InventoryItem] || 'N/A')));
      colValues = Array.from(distinct).sort();
    }

    // 2. Group Data
    const groups = new Map<string, any>();

    rawData.forEach(item => {
      // Create Key based on row fields
      const rowKey = pivotRows.map(field => String(item[field as keyof InventoryItem] || '-')).join('||');
      
      if (!groups.has(rowKey)) {
        const initialGroup: any = { _key: rowKey, _count: 0, _totalQty: 0 };
        pivotRows.forEach(field => {
          initialGroup[field] = item[field as keyof InventoryItem] || '-';
        });
        // Initialize column value accumulators
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

    // 3. Sorting
    let rows = Array.from(groups.values());
    if (sortConfig) {
        rows.sort((a, b) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            
            // Numeric Sort for Total
            if (sortConfig.key === '_totalQty') {
                 return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
            }
            
            // String Sort for other fields
            const strA = String(valA || '');
            const strB = String(valB || '');
            return sortConfig.direction === 'asc' 
                ? strA.localeCompare(strB, 'ko') 
                : strB.localeCompare(strA, 'ko');
        });
    }

    return {
      colValues,
      rows,
      grandTotalQty: rawData.reduce((sum, item) => sum + (item.qty || 0), 0)
    };
  }, [inventoryData.warehouse, pivotRows, pivotCol, sortConfig]);


  // --- Handlers ---
  const handleInventoryUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'warehouse' | 'material' | 'parts' | 'product') => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = parseInventoryCSV(event.target?.result as string, type);
            setInventoryData(prev => ({ ...prev, [type]: data }));
            if (viewMode === 'list') setActiveInventoryType(type);
        };
        reader.readAsText(file);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  const togglePivotRow = (fieldKey: string) => {
    setPivotRows(prev => {
      if (prev.includes(fieldKey)) {
        return prev.filter(k => k !== fieldKey);
      } else {
        return [...prev, fieldKey];
      }
    });
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => {
        if (prev && prev.key === key) {
            return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        }
        return { key, direction: 'asc' };
    });
  };

  const handleListSort = (key: keyof InventoryItem) => {
    setListSortConfig(prev => prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  };

  // Download Handlers
  const handleDownloadList = () => {
    const headers = currentColumns.map(col => col.label);
    const rows = filteredInventoryList.map(item => 
      currentColumns.map(col => item[col.key])
    );
    downloadCSV(`재고현황_${activeInventoryType}`, headers, rows);
  };

  const handleDownloadPivot = () => {
    // Headers: Row Fields + Col Values + Total
    const rowHeaders = pivotRows.map(key => AVAILABLE_PIVOT_FIELDS.find(f => f.key === key)?.label || key);
    const headers = [...rowHeaders, ...pivotData.colValues, '합계(Total)'];
    
    // Rows
    const rows = pivotData.rows.map(row => {
      const rowData = pivotRows.map(key => row[key]);
      const colData = pivotData.colValues.map(colVal => row[`_col_${colVal}`] || 0);
      return [...rowData, ...colData, row._totalQty];
    });

    downloadCSV('재고현황_피봇분석', headers, rows);
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      
      {/* Top Header & Navigation */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col xl:flex-row items-center justify-between gap-6 mb-2">
              <div>
                  <h2 className="text-xl font-black text-slate-800">재고 현황 대시보드 (Inventory)</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {viewMode === 'list' 
                      ? '유형별 재고 리스트 및 상세 검색' 
                      : '창고별 재고 데이터 기반 사용자 정의 피봇 분석'}
                  </p>
              </div>

              {/* View Switcher */}
              <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                 <button
                    onClick={() => setViewMode('list')}
                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                        viewMode === 'list' 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                 >
                    📋 재고 현황 리스트
                 </button>
                 <button
                    onClick={() => setViewMode('pivot')}
                    className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                        viewMode === 'pivot' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                 >
                    📊 현재고 (사용자 피봇)
                 </button>
              </div>

              {/* Uploaders (Always Visible for Access) */}
              <div className="flex flex-wrap gap-2 justify-end">
                    {[
                      { type: 'warehouse', label: '창고별', color: 'bg-blue-600' },
                      { type: 'material', label: '원재료', color: 'bg-emerald-600' },
                      { type: 'parts', label: '부품', color: 'bg-amber-600' },
                      { type: 'product', label: '제품', color: 'bg-rose-600' }
                    ].map((item) => (
                        <label key={item.type} className={`${item.color} hover:opacity-90 text-white px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm opacity-80 hover:opacity-100`}>
                          <span>📤 {item.label}</span>
                          <input 
                              type="file" 
                              accept=".csv" 
                              onChange={(e) => handleInventoryUpload(e, item.type as any)} 
                              className="hidden" 
                          />
                        </label>
                    ))}
              </div>
          </div>
      </div>
      
      {/* ======================= LIST VIEW CONTENT ======================= */}
      {viewMode === 'list' && (
        <div className="space-y-6">
          {/* Inventory Metrics */}
          <div className={`grid grid-cols-1 ${showAmountMetric ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
              <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-400">선택된 유형</span>
                    <h3 className="text-lg font-black text-slate-800 mt-1">
                      {activeInventoryType === 'warehouse' && '창고별 재고'}
                      {activeInventoryType === 'material' && '원재료 재고'}
                      {activeInventoryType === 'parts' && '부품 재고'}
                      {activeInventoryType === 'product' && '제품 재고'}
                    </h3>
              </div>
              <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-400">검색된 품목 수</span>
                    <h3 className="text-lg font-black text-slate-800 mt-1">{filteredInventoryList.length.toLocaleString()} Items</h3>
              </div>
              <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-400">검색 재고 수량</span>
                    <h3 className="text-lg font-black text-blue-600 mt-1">{totalInventoryQty.toLocaleString()}</h3>
              </div>
              {showAmountMetric && (
                <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
                      <span className="text-xs font-bold text-slate-400">검색 재고 평가액</span>
                      <h3 className="text-lg font-black text-emerald-600 mt-1">₩{totalInventoryAmount.toLocaleString()}</h3>
                </div>
              )}
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-100 pb-2 mb-4">
                  {/* Internal Tabs */}
                  <div className="flex gap-2">
                        {['warehouse', 'material', 'parts', 'product'].map((type) => (
                            <button
                            key={type}
                            onClick={() => setActiveInventoryType(type as any)}
                            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                                activeInventoryType === type 
                                ? 'bg-slate-800 text-white' 
                                : 'bg-white text-slate-500 hover:bg-slate-100'
                            }`}
                            >
                            {type === 'warehouse' && '창고별'}
                            {type === 'material' && '원재료'}
                            {type === 'parts' && '부품'}
                            {type === 'product' && '제품'}
                            <span className="ml-1 opacity-70">({inventoryData[type as keyof typeof inventoryData].length})</span>
                            </button>
                        ))}
                  </div>
                  
                  <button 
                    onClick={handleDownloadList}
                    className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    엑셀 다운로드
                  </button>
              </div>

              {/* Dynamic Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                          <tr>
                              {currentColumns.map((col) => (
                                  <th 
                                    key={col.key} 
                                    className={`px-4 py-3 min-w-[100px] ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} cursor-pointer hover:bg-slate-100 transition-colors select-none group`}
                                    onClick={() => handleListSort(col.key)}
                                  >
                                      <div className={`flex items-center gap-1 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                        {col.label}
                                        <span className={`text-[10px] ${listSortConfig?.key === col.key ? 'text-blue-600 font-bold' : 'text-slate-300 group-hover:text-slate-400'}`}>
                                            {listSortConfig?.key === col.key 
                                                ? (listSortConfig.direction === 'asc' ? '▲' : '▼') 
                                                : '⇅'
                                            }
                                        </span>
                                      </div>
                                  </th>
                              ))}
                          </tr>
                          <tr className="bg-slate-50">
                              {currentColumns.map((col) => (
                                  <th key={`filter-${col.key}`} className="px-2 py-2">
                                      {col.isFilterable ? (
                                          <input 
                                            type="text" 
                                            placeholder={col.label} 
                                            className={`w-full p-1 border rounded text-xs font-normal ${col.align === 'right' ? 'text-right' : ''}`}
                                            value={filterValues[col.key as string] || ''} 
                                            onChange={(e) => handleFilterChange(col.key as string, e.target.value)} 
                                          />
                                      ) : null}
                                  </th>
                              ))}
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {filteredInventoryList.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50">
                                  {currentColumns.map((col) => {
                                      const val = item[col.key];
                                      const displayVal = col.format ? col.format(val) : val;
                                      return (
                                        <td key={`${item.id}-${col.key}`} className={`px-4 py-3 ${col.key === 'code' ? 'font-mono text-slate-500' : 'text-slate-700'} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}>
                                            {displayVal !== undefined && displayVal !== null ? displayVal : '-'}
                                        </td>
                                      );
                                  })}
                              </tr>
                          ))}
                          {filteredInventoryList.length === 0 && (
                              <tr>
                                  <td colSpan={currentColumns.length} className="px-4 py-12 text-center text-slate-400">
                                      데이터가 없습니다.
                                  </td>
                              </tr>
                          )}
                      </tbody>
                      <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                        <tr>
                          {currentColumns.map((col, index) => {
                            if (index === 0) return <td key="footer-total" className="px-4 py-3 text-center">합계 (Total)</td>;
                            if (col.key === 'qty') {
                               return <td key="footer-qty" className="px-4 py-3 text-right font-mono text-blue-600">{totalInventoryQty.toLocaleString()}</td>;
                            }
                            if (col.key === 'amount') {
                               return <td key="footer-amount" className="px-4 py-3 text-right font-mono text-emerald-600">{showAmountMetric ? `₩${totalInventoryAmount.toLocaleString()}` : '-'}</td>;
                            }
                            return <td key={`footer-${index}`} className="px-4 py-3"></td>;
                          })}
                        </tr>
                      </tfoot>
                  </table>
              </div>
          </div>
        </div>
      )}

      {/* ======================= PIVOT VIEW CONTENT ======================= */}
      {viewMode === 'pivot' && (
         <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
               {/* 1. Pivot Configuration */}
               <div className="flex flex-col xl:flex-row gap-6 mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex-1">
                      <div className="flex items-center gap-2 mb-3">
                          <span className="bg-indigo-100 text-indigo-700 p-1.5 rounded-lg">
                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                          </span>
                          <h3 className="font-bold text-slate-700 text-sm">행(Row) 그룹 선택</h3>
                          <span className="text-xs text-slate-400 font-normal ml-2">* 다중 선택 가능</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {AVAILABLE_PIVOT_FIELDS.map(field => (
                              <button
                                  key={field.key}
                                  onClick={() => togglePivotRow(field.key)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                      pivotRows.includes(field.key)
                                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                                  }`}
                              >
                                  {pivotRows.includes(field.key) && <span className="mr-1">✓</span>}
                                  {field.label}
                              </button>
                          ))}
                      </div>
                  </div>

                  <div className="w-px bg-slate-200 hidden xl:block"></div>

                  <div className="flex-1 xl:max-w-md">
                      <div className="flex items-center gap-2 mb-3">
                          <span className="bg-rose-100 text-rose-700 p-1.5 rounded-lg">
                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                          </span>
                          <h3 className="font-bold text-slate-700 text-sm">열(Column) 기준 선택</h3>
                          <span className="text-xs text-slate-400 font-normal ml-2">* 하나만 선택 가능</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          <button
                              onClick={() => setPivotCol('')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                  pivotCol === ''
                                  ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
                                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                              }`}
                          >
                              사용안함
                          </button>
                          {AVAILABLE_PIVOT_FIELDS.map(field => (
                              <button
                                  key={field.key}
                                  onClick={() => setPivotCol(field.key)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                      pivotCol === field.key
                                      ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
                                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                                  }`}
                              >
                                  {field.label}
                              </button>
                          ))}
                      </div>
                  </div>
               </div>

               {/* 2. Pivot Table Result */}
               {pivotRows.length === 0 ? (
                 <div className="p-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                    <p>분석할 행(Row) 그룹을 하나 이상 선택해주세요.</p>
                 </div>
               ) : inventoryData.warehouse.length === 0 ? (
                 <div className="p-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                    <p>분석할 데이터가 없습니다. 상단에서 <strong>'창고별'</strong> 파일을 먼저 업로드해주세요.</p>
                 </div>
               ) : (
                 <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-sm">
                    {/* Header with Download */}
                    <div className="flex justify-end p-2 border-b border-slate-100 bg-slate-50/50">
                        <button 
                            onClick={handleDownloadPivot}
                            className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-green-50 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            피봇 데이터 다운로드
                        </button>
                    </div>

                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                           <tr>
                              {/* Row Group Headers */}
                              {pivotRows.map(key => (
                                 <th 
                                    key={key} 
                                    onClick={() => handleSort(key)}
                                    className="px-4 py-3 border-r border-slate-200/50 min-w-[100px] cursor-pointer hover:bg-slate-200 transition-colors select-none group"
                                 >
                                    <div className="flex items-center justify-between gap-1">
                                        {AVAILABLE_PIVOT_FIELDS.find(f => f.key === key)?.label}
                                        <span className="text-xs text-slate-400">
                                            {sortConfig?.key === key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                        </span>
                                    </div>
                                 </th>
                              ))}
                              
                              {/* Dynamic Column Headers */}
                              {pivotCol ? (
                                 pivotData.colValues.map(colVal => (
                                    <th key={colVal} className="px-4 py-3 text-right bg-slate-50 border-r border-slate-200/50 min-w-[80px]">
                                       {colVal}
                                    </th>
                                 ))
                              ) : null}

                              {/* Total Header */}
                              <th 
                                 onClick={() => handleSort('_totalQty')}
                                 className="px-4 py-3 text-right bg-slate-200 min-w-[80px] text-slate-800 cursor-pointer hover:bg-slate-300 transition-colors select-none"
                              >
                                  <div className="flex items-center justify-end gap-1">
                                      합계 (Sum)
                                      <span className="text-xs text-slate-500">
                                        {sortConfig?.key === '_totalQty' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                                      </span>
                                  </div>
                              </th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {pivotData.rows.map((row, idx) => (
                              <tr key={idx} className="hover:bg-indigo-50/30">
                                 {/* Row Group Cells */}
                                 {pivotRows.map(key => (
                                    <td key={key} className="px-4 py-3 border-r border-slate-100 font-medium text-slate-700">
                                       {row[key]}
                                    </td>
                                 ))}

                                 {/* Pivot Column Cells */}
                                 {pivotCol ? (
                                    pivotData.colValues.map(colVal => (
                                       <td key={colVal} className="px-4 py-3 text-right border-r border-slate-100 font-mono text-slate-600">
                                          {row[`_col_${colVal}`] ? row[`_col_${colVal}`].toLocaleString() : '-'}
                                       </td>
                                    ))
                                 ) : null}

                                 {/* Total Cell */}
                                 <td className="px-4 py-3 text-right font-bold text-indigo-700 bg-slate-50/50">
                                    {row._totalQty.toLocaleString()}
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                        <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                           <tr>
                              <td colSpan={pivotRows.length} className="px-4 py-3 text-center border-r border-slate-200/50">총계 (Grand Total)</td>
                              {pivotCol ? (
                                 pivotData.colValues.map(colVal => {
                                    const colTotal = pivotData.rows.reduce((sum, r) => sum + (r[`_col_${colVal}`] || 0), 0);
                                    return (
                                       <td key={colVal} className="px-4 py-3 text-right border-r border-slate-200/50 font-mono">{colTotal.toLocaleString()}</td>
                                    );
                                 })
                              ) : null}
                              <td className="px-4 py-3 text-right font-mono text-indigo-700">{pivotData.grandTotalQty.toLocaleString()}</td>
                           </tr>
                        </tfoot>
                    </table>
                 </div>
               )}
            </div>
         </div>
      )}
    </div>
  );
};

export default InventoryView;
