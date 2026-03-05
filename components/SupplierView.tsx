import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { safeSetItem } from '../utils/safeStorage';
import { parseSupplierCSV, SupplierItem } from '../utils/supplierDataParser';
import { downloadCSV } from '../utils/csvExport';
import { isSupabaseConfigured } from '../lib/supabase';
import { supplierService } from '../services/supabaseService';

const SupplierView: React.FC = () => {
  // --- Initialization Helpers ---
  const getInitialSupplierData = (): SupplierItem[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('dashboard_supplierData');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Failed to load supplier data", e);
      return [];
    }
  };

  // --- State ---
  const [supplierData, setSupplierData] = useState<SupplierItem[]>(getInitialSupplierData);
  const [supplierListOpen, setSupplierListOpen] = useState(false);
  const [filter, setFilter] = useState({
    companyName: '',
    businessNumber: '',
    ceo: '',
    address: '',
  });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // --- Smart Supabase Load ---
  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;

      try {
        const supabaseData = await supplierService.getAll();
        if (supabaseData && supabaseData.length > 0) {
          setSupplierData(supabaseData);
          safeSetItem('dashboard_supplierData', JSON.stringify(supabaseData));
          console.log(`✅ Supabase에서 협력사 데이터 로드: ${supabaseData.length}개`);
        } else {
          console.log('ℹ️ Supabase 협력사 데이터 없음 - localStorage 유지');
        }
      } catch (err) {
        console.error('Supabase 협력사 로드 실패 - localStorage 유지:', err);
      }
    };

    loadFromSupabase();
  }, []);

  // --- 통합 업로더 모달에서 업로드 후 데이터 새로고침 ---
  useEffect(() => {
    const handler = () => {
      try {
        const stored = localStorage.getItem('dashboard_supplierData');
        if (stored) setSupplierData(JSON.parse(stored));
      } catch { /* ignore */ }
    };
    window.addEventListener('dashboard-data-updated', handler);
    return () => window.removeEventListener('dashboard-data-updated', handler);
  }, []);

  // --- Persistence ---
  useEffect(() => {
    if (supplierData.length > 0) {
      safeSetItem('dashboard_supplierData', JSON.stringify(supplierData));
    }
  }, [supplierData]);

  // --- Derived Data ---
  const filteredSuppliers = useMemo(() => {
    let result = supplierData.filter(item => {
      const matchCompanyName = filter.companyName === '' || item.companyName.toLowerCase().includes(filter.companyName.toLowerCase());
      const matchBusinessNumber = filter.businessNumber === '' || item.businessNumber.includes(filter.businessNumber);
      const matchCEO = filter.ceo === '' || item.ceo.toLowerCase().includes(filter.ceo.toLowerCase());
      const matchAddress = filter.address === '' || item.address.toLowerCase().includes(filter.address.toLowerCase());

      return matchCompanyName && matchBusinessNumber && matchCEO && matchAddress;
    });

    // Apply sorting
    if (sortConfig) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key as keyof SupplierItem];
        const bValue = b[sortConfig.key as keyof SupplierItem];
        if (aValue === bValue) return 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        const aStr = String(aValue).toLowerCase();
        const bStr = String(bValue).toLowerCase();
        if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      // 기본 정렬: 거래처명 오름차순
      result.sort((a, b) => a.companyName.localeCompare(b.companyName));
    }

    return result;
  }, [supplierData, filter, sortConfig]);

  const totalStats = useMemo(() => {
    const total2025 = supplierData.reduce((sum, item) => sum + item.purchaseAmount2025, 0);
    const total2024 = supplierData.reduce((sum, item) => sum + item.purchaseAmount2024, 0);
    const total2023 = supplierData.reduce((sum, item) => sum + item.purchaseAmount2023, 0);
    return { total2025, total2024, total2023, count: supplierData.length };
  }, [supplierData]);

  // --- Handlers ---
  const handleFilterChange = (field: keyof typeof filter, value: string) => {
    setFilter(prev => ({ ...prev, [field]: value }));
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = '';
      return;
    }

    // CSV 인코딩 자동 감지 (UTF-8 우선, 깨지면 EUC-KR 재시도)
    const readCsvWithEncoding = (
      file: File,
      onLoaded: (text: string) => void
    ) => {
      const readAsEncoding = (encoding: string, cb: (text: string) => void) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          cb((event.target?.result as string) || '');
        };
        reader.onerror = () => {
          console.error(`파일 읽기 실패 (${encoding})`);
          cb('');
        };
        reader.readAsText(file, encoding);
      };

      // 1차: UTF-8
      readAsEncoding('utf-8', (utf8Text) => {
        if (!utf8Text) {
          readAsEncoding('euc-kr', (eucKrText) => onLoaded(eucKrText || utf8Text));
          return;
        }

        const brokenPattern = /�|Ã.|Â./g;
        const brokenMatches = utf8Text.match(brokenPattern);
        const brokenRatio = brokenMatches ? brokenMatches.length / utf8Text.length : 0;

        if (brokenRatio > 0.01) {
          readAsEncoding('euc-kr', (eucKrText) => onLoaded(eucKrText || utf8Text));
        } else {
          onLoaded(utf8Text);
        }
      });
    };

    readCsvWithEncoding(file, async (csvText) => {
      try {
        if (!csvText || csvText.trim().length === 0) {
          alert('파일이 비어있거나 읽을 수 없습니다.');
          return;
        }

        console.log('📂 협력사 CSV 파싱 시작...');
        const parsed = parseSupplierCSV(csvText);
        
        if (parsed.length === 0) {
          alert('CSV 파일에서 데이터를 찾을 수 없습니다.\n파일 형식을 확인해주세요.\n\n필요한 컬럼: 거래처명, 사업자등록번호, 대표이사, 주소, 매입액(-VAT) 2025년, 매입액(-VAT) 2024년, 매입액(-VAT) 2023년');
          return;
        }

        console.log(`✅ 협력사 데이터 파싱 완료: ${parsed.length}건`);
        
        setSupplierData(parsed);
        safeSetItem('dashboard_supplierData', JSON.stringify(parsed));

        // Supabase 동기화
        if (isSupabaseConfigured()) {
          try {
            await supplierService.saveAll(parsed);
            console.log(`✅ 협력사 데이터 Supabase 동기화 완료: ${parsed.length}건`);
          } catch (err) {
            console.error('Supabase 동기화 실패:', err);
            alert('데이터는 로컬에 저장되었지만 Supabase 동기화에 실패했습니다.');
          }
        }

        alert(`협력사 데이터 ${parsed.length}건이 업로드되었습니다.`);
      } catch (err) {
        console.error('협력사 데이터 업로드 실패:', err);
        alert('협력사 데이터 업로드에 실패했습니다.\nCSV 형식을 확인해주세요.\n\n필요한 컬럼: 거래처명, 사업자등록번호, 대표이사, 주소, 매입액(-VAT) 2025년, 매입액(-VAT) 2024년, 매입액(-VAT) 2023년');
      }
    });

    e.target.value = '';
  };

  const handleDownload = () => {
    const headers = ['거래처명', '사업자등록번호', '대표이사', '주소', '매입액(-VAT) 2025년', '매입액(-VAT) 2024년', '매입액(-VAT) 2023년'];
    const rows = filteredSuppliers.map(item => [
      item.companyName,
      item.businessNumber,
      item.ceo,
      item.address,
      item.purchaseAmount2025.toLocaleString(),
      item.purchaseAmount2024.toLocaleString(),
      item.purchaseAmount2023.toLocaleString(),
    ]);
    downloadCSV('협력사_관리', headers, rows);
  };

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
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <span className="w-1 h-6 bg-emerald-600 rounded-full"></span>
              협력사 관리
            </h2>
            <p className="text-sm text-slate-500 mt-1">협력사 정보 및 매입액 현황 관리</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-2">
              <span>📂</span> 협력사 CSV 업로드
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={handleDownload}
              className="text-slate-500 hover:text-green-600 text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              엑셀 다운로드
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <MetricCard label="등록된 협력사 수" value={`${totalStats.count}개사`} color="blue" />
          <MetricCard label="2025년 총 매입액" value={`₩${(totalStats.total2025 / 100000000).toFixed(1)}억`} color="emerald" />
          <MetricCard label="2024년 총 매입액" value={`₩${(totalStats.total2024 / 100000000).toFixed(1)}억`} color="slate" />
          <MetricCard label="2023년 총 매입액" value={`₩${(totalStats.total2023 / 100000000).toFixed(1)}억`} color="violet" />
        </div>

        {/* Supplier List */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSupplierListOpen(!supplierListOpen)}
              className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-emerald-600 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${supplierListOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              상세 협력사 리스트 ({filteredSuppliers.length}건)
            </button>
          </div>

          {supplierListOpen && (
            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <SortableHeader label="거래처명" sortKey="companyName" />
                    <SortableHeader label="사업자등록번호" sortKey="businessNumber" />
                    <SortableHeader label="대표이사" sortKey="ceo" />
                    <SortableHeader label="주소" sortKey="address" />
                    <SortableHeader label="매입액(-VAT) 2025년" sortKey="purchaseAmount2025" align="right" />
                    <SortableHeader label="매입액(-VAT) 2024년" sortKey="purchaseAmount2024" align="right" />
                    <SortableHeader label="매입액(-VAT) 2023년" sortKey="purchaseAmount2023" align="right" />
                  </tr>
                  <tr className="bg-slate-50">
                    <th className="px-2 py-2">
                      <input type="text" placeholder="거래처명" className="w-full p-1 border rounded text-xs font-normal" value={filter.companyName} onChange={(e) => handleFilterChange('companyName', e.target.value)} />
                    </th>
                    <th className="px-2 py-2">
                      <input type="text" placeholder="사업자번호" className="w-full p-1 border rounded text-xs font-normal" value={filter.businessNumber} onChange={(e) => handleFilterChange('businessNumber', e.target.value)} />
                    </th>
                    <th className="px-2 py-2">
                      <input type="text" placeholder="대표이사" className="w-full p-1 border rounded text-xs font-normal" value={filter.ceo} onChange={(e) => handleFilterChange('ceo', e.target.value)} />
                    </th>
                    <th className="px-2 py-2">
                      <input type="text" placeholder="주소" className="w-full p-1 border rounded text-xs font-normal" value={filter.address} onChange={(e) => handleFilterChange('address', e.target.value)} />
                    </th>
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"></th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSuppliers.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{item.companyName}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{item.businessNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{item.ceo}</td>
                      <td className="px-4 py-3 text-slate-600">{item.address}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">₩{item.purchaseAmount2025.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">₩{item.purchaseAmount2024.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">₩{item.purchaseAmount2023.toLocaleString()}</td>
                    </tr>
                  ))}
                  {filteredSuppliers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-4xl">🏢</span>
                          <p className="font-medium">데이터가 없습니다.</p>
                          <p className="text-xs">협력사 CSV 파일을 업로드하여 데이터를 추가하세요.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                {filteredSuppliers.length > 0 && (
                  <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-right">합계</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">₩{totalStats.total2025.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-800">₩{totalStats.total2024.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-800">₩{totalStats.total2023.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierView;
