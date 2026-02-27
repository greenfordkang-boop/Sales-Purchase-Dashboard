
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { BomRecord } from '../utils/bomDataParser';
import { ForecastItem } from '../utils/salesForecastParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord, BomMasterRecord } from '../utils/bomMasterParser';
import { calculateMRP, MRPResult, MRPMaterialRow } from '../utils/mrpCalculator';
import { downloadCSV } from '../utils/csvExport';

// ============================================================
// Constants
// ============================================================

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const TYPE_COLORS: Record<string, string> = {
  RESIN: '#3b82f6',
  PAINT: '#10b981',
  '구매': '#f59e0b',
  '외주': '#8b5cf6',
};

// ============================================================
// Component
// ============================================================

const MRPView: React.FC = () => {
  const [mrpResult, setMrpResult] = useState<MRPResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [dataSource, setDataSource] = useState<'forecast' | 'revenue'>('forecast');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterText, setFilterText] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<MRPMaterialRow | null>(null);
  const [tableOpen, setTableOpen] = useState(true);

  // --- 데이터 로드 + MRP 계산 ---
  useEffect(() => {
    calculateMRPData();

    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.type === 'bomMaster' || detail?.type === 'forecast') {
        calculateMRPData();
      }
    };
    window.addEventListener('dashboard-data-updated', handleUpdate);
    return () => window.removeEventListener('dashboard-data-updated', handleUpdate);
  }, [dataSource]);

  const calculateMRPData = () => {
    setIsCalculating(true);
    try {
      // Forecast 데이터 로드
      const forecastRaw = localStorage.getItem('dashboard_forecastData');
      const forecastData: ForecastItem[] = forecastRaw ? JSON.parse(forecastRaw) : [];

      // BOM 데이터: bom_master 우선 → 기존 bom_data 폴백
      let bomRecords: BomRecord[] = [];
      const bomMasterRaw = localStorage.getItem('dashboard_bomMasterData');
      if (bomMasterRaw) {
        const masterRecords: BomMasterRecord[] = JSON.parse(bomMasterRaw);
        bomRecords = masterRecords.map(r => ({
          parentPn: r.parentPn,
          childPn: r.childPn,
          level: r.level,
          qty: r.qty,
          childName: r.childName,
          supplier: r.supplier,
          partType: r.partType,
        }));
      } else {
        const bomRaw = localStorage.getItem('dashboard_bomData');
        bomRecords = bomRaw ? JSON.parse(bomRaw) : [];
      }

      // 마스터 데이터 로드
      const pcRaw = localStorage.getItem('dashboard_productCodeMaster');
      const productCodes: ProductCodeRecord[] = pcRaw ? JSON.parse(pcRaw) : [];

      const riRaw = localStorage.getItem('dashboard_referenceInfoMaster');
      const refInfo: ReferenceInfoRecord[] = riRaw ? JSON.parse(riRaw) : [];

      const mcRaw = localStorage.getItem('dashboard_materialCodeMaster');
      const materialCodes: MaterialCodeRecord[] = mcRaw ? JSON.parse(mcRaw) : [];

      if (forecastData.length === 0 || bomRecords.length === 0) {
        setMrpResult(null);
        return;
      }

      const result = calculateMRP(forecastData, bomRecords, productCodes, refInfo, materialCodes);
      setMrpResult(result);
    } catch (err) {
      console.error('MRP 계산 실패:', err);
      setMrpResult(null);
    } finally {
      setIsCalculating(false);
    }
  };

  // --- 파생 데이터 ---
  const typeDistribution = useMemo(() => {
    if (!mrpResult) return [];
    const typeMap = new Map<string, { qty: number; cost: number }>();
    for (const m of mrpResult.materials) {
      const existing = typeMap.get(m.materialType) || { qty: 0, cost: 0 };
      existing.qty += m.requiredQty;
      existing.cost += m.totalCost;
      typeMap.set(m.materialType, existing);
    }
    return Array.from(typeMap.entries()).map(([name, data]) => ({
      name,
      qty: data.qty,
      cost: data.cost,
    }));
  }, [mrpResult]);

  const filteredMaterials = useMemo(() => {
    if (!mrpResult) return [];
    let result = mrpResult.materials;

    if (filterType !== 'All') {
      result = result.filter(m => m.materialType === filterType);
    }
    if (filterText) {
      const f = filterText.toLowerCase();
      result = result.filter(m =>
        m.materialCode.toLowerCase().includes(f) ||
        m.materialName.toLowerCase().includes(f)
      );
    }

    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = (a as any)[sortConfig.key];
        const bVal = (b as any)[sortConfig.key];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      });
    }

    return result;
  }, [mrpResult, filterType, filterText, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' }
    );
  };

  const handleDownload = () => {
    if (!filteredMaterials.length) return;
    const headers = ['자재코드', '자재명', '유형', '총소요량', '단가', '총원가', '관련제품수', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`)];
    const rows = filteredMaterials.map(m => [
      m.materialCode,
      m.materialName,
      m.materialType,
      m.requiredQty,
      m.unitPrice,
      m.totalCost,
      m.parentProducts.length,
      ...m.monthlyQty,
    ]);
    downloadCSV(`MRP_소요량_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows.map(r => r.map(String)));
  };

  // No data state
  if (!mrpResult && !isCalculating) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-gray-400 text-lg mb-2">MRP 데이터가 없습니다</div>
          <div className="text-xs text-gray-400 space-y-1">
            <p>1. BOM 마스터 탭에서 <span className="font-semibold">bom_개정.xlsx</span>를 업로드하세요</p>
            <p>2. 영업현황에서 <span className="font-semibold">매출계획(Forecast)</span>을 업로드하세요</p>
          </div>
        </div>
      </div>
    );
  }

  if (isCalculating) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <div className="text-gray-500">MRP 계산 중...</div>
      </div>
    );
  }

  const { summary, byMonth } = mrpResult!;

  return (
    <div className="space-y-4">
      {/* 메트릭 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard title="총 소요자재" value={summary.totalMaterials.toLocaleString()} suffix="종" />
        <MetricCard
          title="BOM 매칭률"
          value={`${(summary.bomMatchRate * 100).toFixed(1)}`}
          suffix="%"
        />
        <MetricCard title="매칭 제품" value={summary.matchedProducts.toLocaleString()} suffix="건" />
        <MetricCard title="미매칭" value={summary.unmatchedProducts.length.toLocaleString()} suffix="건" />
        <MetricCard
          title="총 소요원가"
          value={summary.totalCost > 0 ? (summary.totalCost / 100000000).toFixed(1) : '0'}
          suffix="억원"
        />
      </div>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 월별 소요량 바차트 */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">월별 소요량</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
              <Tooltip
                formatter={(v: number) => [v.toLocaleString(), '소요량']}
                contentStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="totalQty" fill="#3b82f6" name="소요량" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 자재유형별 파이차트 */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">자재유형별 분포</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={typeDistribution}
                dataKey="qty"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
                style={{ fontSize: 11 }}
              >
                {typeDistribution.map((entry, index) => (
                  <Cell key={index} fill={TYPE_COLORS[entry.name] || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => v.toLocaleString()}
                contentStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 필터 + 다운로드 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-xs"
        >
          <option value="All">전체 유형</option>
          <option value="RESIN">RESIN</option>
          <option value="PAINT">PAINT</option>
          <option value="구매">구매</option>
          <option value="외주">외주</option>
        </select>
        <input
          type="text"
          placeholder="자재코드/자재명 검색..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded text-xs w-48"
        />
        <span className="text-xs text-gray-400">
          {filteredMaterials.length.toLocaleString()}건
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={calculateMRPData}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            재계산
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
          >
            Excel 내보내기
          </button>
        </div>
      </div>

      {/* 상세 테이블 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <button
          onClick={() => setTableOpen(!tableOpen)}
          className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100"
        >
          <span className="text-sm font-semibold text-gray-700">
            자재별 소요량 상세 ({filteredMaterials.length.toLocaleString()}건)
          </span>
          <span className="text-gray-400 text-xs">{tableOpen ? '접기' : '펼치기'}</span>
        </button>

        {tableOpen && (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {[
                    { key: 'materialCode', label: '자재코드' },
                    { key: 'materialName', label: '자재명' },
                    { key: 'materialType', label: '유형' },
                    { key: 'requiredQty', label: '총소요량', align: 'right' },
                    { key: 'unitPrice', label: '단가', align: 'right' },
                    { key: 'totalCost', label: '총원가', align: 'right' },
                    { key: 'parentProducts', label: '관련제품', align: 'right' },
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-3 py-2 text-gray-600 font-medium cursor-pointer hover:bg-gray-100 ${
                        (col as any).align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.label}
                      {sortConfig?.key === col.key && (
                        <span className="ml-1">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredMaterials.slice(0, 300).map((m, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-blue-50 cursor-pointer ${selectedMaterial?.materialCode === m.materialCode ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedMaterial(selectedMaterial?.materialCode === m.materialCode ? null : m)}
                  >
                    <td className="px-3 py-1.5 font-mono text-gray-700">{m.materialCode}</td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-36 truncate">{m.materialName}</td>
                    <td className="px-3 py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
                        backgroundColor: `${TYPE_COLORS[m.materialType] || '#94a3b8'}20`,
                        color: TYPE_COLORS[m.materialType] || '#94a3b8',
                      }}>
                        {m.materialType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{m.requiredQty.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {m.unitPrice > 0 ? m.unitPrice.toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 font-medium">
                      {m.totalCost > 0 ? (m.totalCost / 10000).toFixed(0) + '만' : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{m.parentProducts.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredMaterials.length > 300 && (
              <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                {filteredMaterials.length - 300}건 더 있음
              </div>
            )}
          </div>
        )}
      </div>

      {/* 자재 클릭 → 관련 제품 드릴다운 */}
      {selectedMaterial && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">
              [{selectedMaterial.materialCode}] {selectedMaterial.materialName} - 관련 제품
            </h3>
            <button
              onClick={() => setSelectedMaterial(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              닫기
            </button>
          </div>

          {/* 월별 소요량 바차트 */}
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={selectedMaterial.monthlyQty.map((q, i) => ({ month: `${i + 1}월`, qty: q }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} contentStyle={{ fontSize: 10 }} />
              <Bar dataKey="qty" fill={TYPE_COLORS[selectedMaterial.materialType] || '#3b82f6'} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-2 flex flex-wrap gap-1">
            {selectedMaterial.parentProducts.map((pn, i) => (
              <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-mono">
                {pn}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 미매칭 제품 */}
      {summary.unmatchedProducts.length > 0 && (
        <div className="bg-orange-50 rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-orange-700 mb-2">
            BOM 미매칭 제품 ({summary.unmatchedProducts.length}건)
          </h3>
          <div className="flex flex-wrap gap-1">
            {summary.unmatchedProducts.slice(0, 30).map((pn, i) => (
              <span key={i} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-mono">
                {pn}
              </span>
            ))}
            {summary.unmatchedProducts.length > 30 && (
              <span className="text-xs text-orange-500">...외 {summary.unmatchedProducts.length - 30}건</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MRPView;
