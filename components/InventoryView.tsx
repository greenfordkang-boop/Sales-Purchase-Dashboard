
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { parseInventoryCSV, InventoryItem } from '../utils/inventoryDataParser';

// Type definition for column configuration
interface ColumnDef {
  key: keyof InventoryItem;
  label: string;
  align?: 'left' | 'center' | 'right';
  format?: (value: any) => string;
  isFilterable?: boolean;
}

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

  const [activeInventoryType, setActiveInventoryType] = useState<'warehouse' | 'material' | 'parts' | 'product'>('warehouse');
  
  // Dynamic Filter State
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('dashboard_inventoryData', JSON.stringify(inventoryData));
  }, [inventoryData]);

  // Reset Filters when type changes
  useEffect(() => {
    setFilterValues({});
  }, [activeInventoryType]);

  // --- Configuration per Type ---
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

  const currentColumns = COLUMN_CONFIG[activeInventoryType];
  const currentInventoryList = inventoryData[activeInventoryType];
  
  // Validate items: Exclude items with empty code from aggregation and display
  const validInventoryItems = useMemo(() => {
    return currentInventoryList.filter(item => item.code && item.code.trim() !== '');
  }, [currentInventoryList]);

  // Calculate Totals
  const totalInventoryQty = validInventoryItems.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalInventoryAmount = validInventoryItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const showAmountMetric = validInventoryItems.some(item => item.amount && item.amount > 0);

  // --- Handlers ---
  const handleInventoryUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'warehouse' | 'material' | 'parts' | 'product') => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = parseInventoryCSV(event.target?.result as string, type);
            setInventoryData(prev => ({ ...prev, [type]: data }));
            setActiveInventoryType(type);
        };
        reader.readAsText(file);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  // --- Derived Data (Filtering) ---
  const filteredInventoryList = useMemo(() => {
    return validInventoryItems.filter(item => {
      return currentColumns.every(col => {
        if (!col.isFilterable) return true;
        const filterVal = filterValues[col.key];
        if (!filterVal) return true;
        
        const itemVal = item[col.key];
        // Handle number 0 properly (it is falsy in some checks, but valid value here)
        if (itemVal === undefined || itemVal === null) return false;
        
        return String(itemVal).toLowerCase().includes(filterVal.toLowerCase());
      });
    });
  }, [validInventoryItems, filterValues, currentColumns]);

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
              <div>
                  <h2 className="text-xl font-black text-slate-800">현재고 현황 (Inventory Status)</h2>
                  <p className="text-sm text-slate-500 mt-1">유형별 맞춤형 재고 데이터를 관리합니다.</p>
              </div>
              {/* 4 File Uploaders */}
              <div className="flex flex-wrap gap-2">
                    {[
                      { type: 'warehouse', label: '창고별', color: 'bg-blue-600' },
                      { type: 'material', label: '원재료', color: 'bg-emerald-600' },
                      { type: 'parts', label: '부품', color: 'bg-amber-600' },
                      { type: 'product', label: '제품', color: 'bg-rose-600' }
                    ].map((item) => (
                        <label key={item.type} className={`${item.color} hover:opacity-90 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-2 shadow-sm`}>
                          <span>📤 {item.label} 업로드</span>
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
          
          {/* Inventory Metrics */}
          <div className={`grid grid-cols-1 ${showAmountMetric ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 mb-6`}>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-bold text-slate-400">선택된 유형</span>
                    <h3 className="text-lg font-black text-slate-800 mt-1">
                      {activeInventoryType === 'warehouse' && '창고별 재고'}
                      {activeInventoryType === 'material' && '원재료 재고'}
                      {activeInventoryType === 'parts' && '부품 재고'}
                      {activeInventoryType === 'product' && '제품 재고'}
                    </h3>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-bold text-slate-400">총 품목 수</span>
                    <h3 className="text-lg font-black text-slate-800 mt-1">{currentInventoryList.length.toLocaleString()} Items</h3>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-bold text-slate-400">총 재고 수량</span>
                    <h3 className="text-lg font-black text-blue-600 mt-1">{totalInventoryQty.toLocaleString()}</h3>
              </div>
              {showAmountMetric && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <span className="text-xs font-bold text-slate-400">총 재고 평가액</span>
                      <h3 className="text-lg font-black text-emerald-600 mt-1">₩{totalInventoryAmount.toLocaleString()}</h3>
                </div>
              )}
          </div>

          {/* Internal Tabs for Inventory View */}
          <div className="flex gap-2 border-b border-slate-100 pb-2 mb-4">
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

          {/* Dynamic Inventory Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                          {currentColumns.map((col) => (
                              <th key={col.key} className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}>
                                  {col.label}
                              </th>
                          ))}
                      </tr>
                      {/* Filter Row */}
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
                                  데이터가 없습니다. 우측 상단에서 <strong>{
                                    activeInventoryType === 'warehouse' ? '창고별' : 
                                    activeInventoryType === 'material' ? '원재료' :
                                    activeInventoryType === 'parts' ? '부품' : '제품'
                                  }</strong> 파일을 업로드해주세요.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};

export default InventoryView;
