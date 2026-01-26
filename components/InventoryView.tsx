
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { parseInventoryCSV, InventoryItem } from '../utils/inventoryDataParser';

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
  
  // Filter State
  const [inventoryFilter, setInventoryFilter] = useState({
    code: '',
    name: '',
    spec: '',
    location: '',
    qty: '',
    amount: ''
  });

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('dashboard_inventoryData', JSON.stringify(inventoryData));
  }, [inventoryData]);

  // Reset Filter when type changes
  useEffect(() => {
    setInventoryFilter({
      code: '',
      name: '',
      spec: '',
      location: '',
      qty: '',
      amount: ''
    });
  }, [activeInventoryType]);

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

  const handleInventoryFilterChange = (field: keyof typeof inventoryFilter, value: string) => {
    setInventoryFilter(prev => ({ ...prev, [field]: value }));
  };

  // --- Derived Data ---
  const currentInventoryList = inventoryData[activeInventoryType];
  const totalInventoryAmount = currentInventoryList.reduce((sum, item) => sum + item.amount, 0);
  const totalInventoryQty = currentInventoryList.reduce((sum, item) => sum + item.qty, 0);

  const filteredInventoryList = useMemo(() => {
    return currentInventoryList.filter(item => {
      const matchCode = inventoryFilter.code === '' || (item.code && item.code.toLowerCase().includes(inventoryFilter.code.toLowerCase()));
      const matchName = inventoryFilter.name === '' || (item.name && item.name.toLowerCase().includes(inventoryFilter.name.toLowerCase()));
      const matchSpec = inventoryFilter.spec === '' || (item.spec && item.spec.toLowerCase().includes(inventoryFilter.spec.toLowerCase()));
      const matchLocation = inventoryFilter.location === '' || (item.location && item.location.toLowerCase().includes(inventoryFilter.location.toLowerCase()));
      const matchQty = inventoryFilter.qty === '' || item.qty.toString().includes(inventoryFilter.qty.replace(/,/g, ''));
      const matchAmount = inventoryFilter.amount === '' || item.amount.toString().includes(inventoryFilter.amount.replace(/,/g, ''));
      return matchCode && matchName && matchSpec && matchLocation && matchQty && matchAmount;
    });
  }, [currentInventoryList, inventoryFilter]);

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
              <div>
                  <h2 className="text-xl font-black text-slate-800">현재고 현황 (Inventory Status)</h2>
                  <p className="text-sm text-slate-500 mt-1">유형별 재고 데이터를 업로드하여 관리합니다.</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-bold text-slate-400">총 재고 평가액</span>
                    <h3 className="text-lg font-black text-emerald-600 mt-1">₩{totalInventoryAmount.toLocaleString()}</h3>
              </div>
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

          {/* Inventory Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr>
                          <th className="px-4 py-3">품목코드</th>
                          <th className="px-4 py-3">품명 (Item Name)</th>
                          <th className="px-4 py-3">규격 (Spec)</th>
                          <th className="px-4 py-3 text-center">단위</th>
                          {activeInventoryType === 'warehouse' && <th className="px-4 py-3">창고명</th>}
                          <th className="px-4 py-3 text-right">재고수량</th>
                          <th className="px-4 py-3 text-right">평가단가</th>
                          <th className="px-4 py-3 text-right">재고금액</th>
                      </tr>
                      <tr className="bg-slate-50">
                          <th className="px-2 py-2"><input type="text" placeholder="코드" className="w-full p-1 border rounded text-xs font-normal" value={inventoryFilter.code} onChange={(e) => handleInventoryFilterChange('code', e.target.value)} /></th>
                          <th className="px-2 py-2"><input type="text" placeholder="품명" className="w-full p-1 border rounded text-xs font-normal" value={inventoryFilter.name} onChange={(e) => handleInventoryFilterChange('name', e.target.value)} /></th>
                          <th className="px-2 py-2"><input type="text" placeholder="규격" className="w-full p-1 border rounded text-xs font-normal" value={inventoryFilter.spec} onChange={(e) => handleInventoryFilterChange('spec', e.target.value)} /></th>
                          <th className="px-2 py-2"></th>
                          {activeInventoryType === 'warehouse' && <th className="px-2 py-2"><input type="text" placeholder="창고" className="w-full p-1 border rounded text-xs font-normal" value={inventoryFilter.location} onChange={(e) => handleInventoryFilterChange('location', e.target.value)} /></th>}
                          <th className="px-2 py-2"><input type="text" placeholder="수량" className="w-full p-1 border rounded text-xs font-normal text-right" value={inventoryFilter.qty} onChange={(e) => handleInventoryFilterChange('qty', e.target.value)} /></th>
                          <th className="px-2 py-2"></th>
                          <th className="px-2 py-2"><input type="text" placeholder="금액" className="w-full p-1 border rounded text-xs font-normal text-right" value={inventoryFilter.amount} onChange={(e) => handleInventoryFilterChange('amount', e.target.value)} /></th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                      {filteredInventoryList.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono text-slate-500">{item.code || '-'}</td>
                              <td className="px-4 py-3 font-medium text-slate-800 truncate max-w-[200px]" title={item.name}>{item.name}</td>
                              <td className="px-4 py-3 text-slate-500 truncate max-w-[150px]">{item.spec || '-'}</td>
                              <td className="px-4 py-3 text-center text-slate-500">{item.unit || '-'}</td>
                              {activeInventoryType === 'warehouse' && <td className="px-4 py-3 text-slate-600 font-bold">{item.location}</td>}
                              <td className="px-4 py-3 text-right font-mono">{item.qty.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-slate-500">₩{item.unitPrice.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-700">₩{item.amount.toLocaleString()}</td>
                          </tr>
                      ))}
                      {filteredInventoryList.length === 0 && (
                          <tr>
                              <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                                  데이터가 없습니다. 우측 상단에서 해당 유형의 파일을 업로드해주세요.
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
