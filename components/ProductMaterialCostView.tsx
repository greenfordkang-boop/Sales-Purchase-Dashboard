import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BomRecord, normalizePn, buildBomRelations, expandBomToLeaves } from '../utils/bomDataParser';
import { ForecastItem } from '../utils/salesForecastParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord, BomMasterRecord } from '../utils/bomMasterParser';
import { bomMasterService, productCodeService, referenceInfoService, materialCodeService, forecastService, itemRevenueService, itemStandardCostService, purchasePriceService, outsourceInjPriceService } from '../services/supabaseService';
import fallbackStandardCosts from '../data/standardMaterialCost.json';
import fallbackMaterialCodes from '../data/materialCodes.json';
import { downloadCSV } from '../utils/csvExport';

// ============================================================
// Types
// ============================================================

interface BomLeaf {
  childPn: string;
  childName: string;
  qty: number;       // BOM 단위소요량
  totalQty: number;  // 누적소요량 (1EA 기준)
  unitPrice: number;
  cost: number;      // totalQty × unitPrice
  priceSource: string;
  depth: number;
  partType: string;
  supplier: string;  // 구입처/협력업체
}

interface ProductRow {
  customer: string;
  model: string;
  stage: string;
  partNo: string;
  newPartNo: string;
  type: string;
  category: string;
  partName: string;
  unitPrice: number;        // 판매단가
  stdMaterialCost: number;  // 표준재료비/EA (item_standard_cost)
  bomMaterialCost: number;  // BOM 전개 재료비/EA
  materialCost: number;     // 최종 표시 재료비 (std 우선)
  materialRatio: number;    // 재료비율 %
  yearlyQty: number;
  yearlyRevenue: number;
  yearlyMaterialCost: number;
  bomLeaves: BomLeaf[];     // BOM 트리 (hover 팝업)
  hasBom: boolean;
  hasStdCost: boolean;
  forecastMonthlyQty: number[];     // 월별 계획 수량 [0..11]
  forecastMonthlyRevenue: number[]; // 월별 계획 매출 [0..11]
  dataQuality: 'high' | 'medium' | 'low'; // 데이터 품질
  paintCost: number;               // 도장재료비 (기준정보 기반)
  processType: string;             // 부품유형 (사출, 도장, 조립 등)
  supplyType: string;              // 조달구분 (자작, 구매, 외주)
  supplier: string;                // 협력업체
}

// ============================================================
// Helpers
// ============================================================

const fmt = (v: number) => v > 0 ? Math.round(v).toLocaleString() : '-';
const fmtPct = (v: number) => v > 0 ? `${v.toFixed(1)}%` : '-';
const fmtWon = (v: number) => {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return Math.round(v).toLocaleString();
};

const MONTH_OPTIONS = [
  { value: 'all', label: '전체 (연간)' },
  { value: '01', label: '1월' }, { value: '02', label: '2월' }, { value: '03', label: '3월' },
  { value: '04', label: '4월' }, { value: '05', label: '5월' }, { value: '06', label: '6월' },
  { value: '07', label: '7월' }, { value: '08', label: '8월' }, { value: '09', label: '9월' },
  { value: '10', label: '10월' }, { value: '11', label: '11월' }, { value: '12', label: '12월' },
];

// ============================================================
// BOM Tree Popup Component
// ============================================================

const BomTreePopup: React.FC<{
  row: ProductRow;
  onClose: () => void;
  onPriceUpdate: (materialCode: string, newPrice: number) => void;
}> = ({ row, onClose, onPriceUpdate }) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [localLeaves, setLocalLeaves] = useState<BomLeaf[]>(() =>
    [...row.bomLeaves].sort((a, b) => b.cost - a.cost)
  );

  if (row.bomLeaves.length === 0 && !row.hasStdCost) return null;

  const totalBomCost = localLeaves.reduce((s, l) => s + l.cost, 0);
  const gapFromStd = row.stdMaterialCost > 0 ? row.stdMaterialCost - totalBomCost : 0;

  const handlePriceClick = (idx: number) => {
    setEditingIdx(idx);
    setEditValue(String(Math.round(localLeaves[idx].unitPrice)));
  };

  const handlePriceSave = (idx: number) => {
    const newPrice = parseFloat(editValue);
    if (isNaN(newPrice) || newPrice < 0) {
      setEditingIdx(null);
      return;
    }
    const leaf = localLeaves[idx];
    // Update local display immediately
    const updated = [...localLeaves];
    updated[idx] = {
      ...leaf,
      unitPrice: newPrice,
      cost: leaf.totalQty * newPrice,
      priceSource: '수동입력',
    };
    setLocalLeaves(updated);
    setEditingIdx(null);
    // Supabase material_code_master 업데이트 → 전체 재계산
    materialCodeService.updatePrice(leaf.childPn, newPrice);
    onPriceUpdate(leaf.childPn, newPrice);
  };

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Enter') handlePriceSave(idx);
    else if (e.key === 'Escape') setEditingIdx(null);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-bold text-lg">{row.partName || row.newPartNo}</div>
              <div className="text-blue-100 text-xs mt-1">{row.newPartNo} | {row.customer} {row.model}</div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl font-bold leading-none">&times;</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
            <div className="bg-white/15 rounded-lg px-3 py-2">
              <div className="text-blue-200 text-[10px]">판매단가</div>
              <div className="font-bold">₩{fmt(row.unitPrice)}</div>
            </div>
            <div className="bg-white/15 rounded-lg px-3 py-2">
              <div className="text-blue-200 text-[10px]">표준재료비</div>
              <div className="font-bold">₩{fmt(row.materialCost)}</div>
            </div>
            <div className="bg-white/15 rounded-lg px-3 py-2">
              <div className="text-blue-200 text-[10px]">재료비율</div>
              <div className="font-bold">{fmtPct(row.materialRatio)}</div>
            </div>
          </div>
        </div>

        {/* BOM 트리 테이블 */}
        <div className="overflow-auto max-h-[50vh]">
          {localLeaves.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-slate-500">
                  <th className="px-3 py-2 text-left">자재코드</th>
                  <th className="px-3 py-2 text-left">자재명</th>
                  <th className="px-3 py-2 text-left">유형</th>
                  <th className="px-3 py-2 text-left">구입처</th>
                  <th className="px-3 py-2 text-right">소요량</th>
                  <th className="px-3 py-2 text-right">단가 <span className="text-[9px] text-blue-400 font-normal">(클릭 수정)</span></th>
                  <th className="px-3 py-2 text-right">금액</th>
                  <th className="px-3 py-2 text-left">단가출처</th>
                </tr>
              </thead>
              <tbody>
                {localLeaves.map((leaf, i) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-blue-50/50">
                      <td className="px-3 py-1.5 font-mono text-[11px]">{leaf.childPn}</td>
                      <td className="px-3 py-1.5 max-w-[160px] truncate">{leaf.childName}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          /원재료/.test(leaf.partType) ? 'bg-blue-100 text-blue-700' :
                          /구매|외주/.test(leaf.partType) ? 'bg-amber-100 text-amber-700' :
                          /도장/.test(leaf.partType) ? 'bg-purple-100 text-purple-700' :
                          leaf.partType ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'
                        }`}>{leaf.partType || '-'}</span>
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 max-w-[100px] truncate" title={leaf.supplier}>
                        {leaf.supplier || '-'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{leaf.totalQty < 1 ? leaf.totalQty.toFixed(4) : fmt(leaf.totalQty)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {editingIdx === i ? (
                          <input
                            type="number"
                            className="w-24 px-1.5 py-0.5 border border-blue-400 rounded text-right text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => handleKeyDown(e, i)}
                            onBlur={() => handlePriceSave(i)}
                            autoFocus
                          />
                        ) : (
                          <span
                            className={`cursor-pointer px-1 py-0.5 rounded hover:bg-blue-100 transition-colors ${
                              leaf.priceSource === '수동입력' ? 'text-purple-700 font-semibold border-b border-dashed border-purple-400' : 'text-slate-700 border-b border-dashed border-slate-300'
                            }`}
                            onClick={() => handlePriceClick(i)}
                            title="클릭하여 단가 수정"
                          >
                            ₩{fmt(leaf.unitPrice)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">₩{fmt(leaf.cost)}</td>
                      <td className="px-3 py-1.5 text-[10px]">
                        <span className={leaf.priceSource === '수동입력' ? 'text-purple-600 font-semibold' : 'text-slate-400'}>
                          {leaf.priceSource}
                        </span>
                      </td>
                    </tr>
                  ))}
                {/* BOM 소계 */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td colSpan={6} className="px-3 py-2 text-right">BOM 전개 소계</td>
                  <td className="px-3 py-2 text-right font-mono">₩{fmt(totalBomCost)}</td>
                  <td></td>
                </tr>
                {/* 가공비 (표준-BOM 차이) */}
                {gapFromStd > 0 && (
                  <tr className="bg-amber-50 text-amber-700">
                    <td colSpan={6} className="px-3 py-2 text-right text-xs">가공/도장 재료비 (표준 - BOM 차이)</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">₩{fmt(gapFromStd)}</td>
                    <td className="px-3 py-2 text-[10px]">추정치</td>
                  </tr>
                )}
                {/* 최종 합계 */}
                <tr className="bg-blue-50 font-bold text-blue-800">
                  <td colSpan={6} className="px-3 py-2 text-right">표준재료비 합계</td>
                  <td className="px-3 py-2 text-right font-mono">₩{fmt(row.materialCost)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          ) : row.hasStdCost ? (
            <div className="p-6 text-center text-slate-500 text-sm">
              <div className="mb-2">BOM 전개 데이터 없음</div>
              <div className="text-xs text-slate-400">표준재료비 ₩{fmt(row.stdMaterialCost)} (item_standard_cost 기준)</div>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-400 text-sm">재료비 데이터 없음</div>
          )}
        </div>

        {/* 푸터 */}
        <div className="bg-slate-50 border-t px-4 py-2 text-[10px] text-slate-400 flex justify-between">
          <span>BOM leaf {localLeaves.length}건 | 단가 클릭 시 수정 가능</span>
          <span>수량 {fmt(row.yearlyQty)} | 재료비 ₩{fmtWon(row.yearlyMaterialCost)}</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Main Component
// ============================================================

const ProductMaterialCostView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [baseRows, setBaseRows] = useState<ProductRow[]>([]);
  const [actualRevenue, setActualRevenue] = useState<ItemRevenueRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof ProductRow; dir: 'asc' | 'desc' }>({ key: 'yearlyMaterialCost', dir: 'desc' });
  const [popupRow, setPopupRow] = useState<ProductRow | null>(null);
  const [filterCust, setFilterCust] = useState('전체');
  const [filterStage, setFilterStage] = useState('전체');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [materialPriceUploading, setMaterialPriceUploading] = useState(false);
  const [materialPriceMsg, setMaterialPriceMsg] = useState('');
  const materialPriceFileRef = useRef<HTMLInputElement>(null);

  // 데이터 로드 + 계산
  useEffect(() => {
    loadData();
    const handler = () => loadData();
    window.addEventListener('dashboard-data-updated', handler);
    return () => window.removeEventListener('dashboard-data-updated', handler);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [forecastData, masterRecords, productCodes, refInfo, materialCodes, revenueData, dbStdCosts, purchasePrices, outsourcePrices] = await Promise.all([
        forecastService.getItems('current'),
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
        materialCodeService.getAll(),
        itemRevenueService.getAll(),
        itemStandardCostService.getAll(),
        purchasePriceService.getAll(),
        outsourceInjPriceService.getAll(),
      ]);

      setActualRevenue(revenueData || []);
      if (forecastData.length === 0) {
        setBaseRows([]);
        setLoading(false);
        return;
      }

      // BOM 관계 구축
      const bomRecords: BomRecord[] = masterRecords.map(r => ({
        parentPn: r.parentPn, childPn: r.childPn, level: r.level,
        qty: r.qty, childName: r.childName, supplier: r.supplier, partType: r.partType,
      }));
      const dedupKey = new Set<string>();
      const deduped: BomRecord[] = [];
      for (const r of bomRecords) {
        const k = `${normalizePn(r.parentPn)}|${normalizePn(r.childPn)}`;
        if (!dedupKey.has(k)) { dedupKey.add(k); deduped.push(r); }
      }
      const bomRelations = buildBomRelations(deduped);

      // P/N 매핑
      const custToInternal = new Map<string, string>();
      const internalToCust = new Map<string, string>();
      for (const pc of productCodes) {
        if (pc.productCode && pc.customerPn) {
          custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
          internalToCust.set(normalizePn(pc.productCode), normalizePn(pc.customerPn));
        }
      }
      for (const ri of refInfo) {
        if (ri.itemCode && ri.customerPn) {
          custToInternal.set(normalizePn(ri.customerPn), normalizePn(ri.itemCode));
          internalToCust.set(normalizePn(ri.itemCode), normalizePn(ri.customerPn));
        }
      }

      // 기준정보 맵
      const refInfoMap = new Map<string, ReferenceInfoRecord>();
      for (const ri of refInfo) {
        refInfoMap.set(normalizePn(ri.itemCode), ri);
        if (ri.customerPn) refInfoMap.set(normalizePn(ri.customerPn), ri);
      }

      // 재질코드 단가 맵
      const mergedMat = [...materialCodes];
      if (materialCodes.filter(m => m.currentPrice > 0).length === 0) {
        const existing = new Set(materialCodes.map(m => m.materialCode.trim().toUpperCase()));
        for (const fb of fallbackMaterialCodes) {
          const k = fb.materialCode.trim().toUpperCase();
          if (!existing.has(k)) { mergedMat.push(fb as MaterialCodeRecord); existing.add(k); }
          else {
            const idx = mergedMat.findIndex(m => m.materialCode.trim().toUpperCase() === k);
            if (idx >= 0 && mergedMat[idx].currentPrice <= 0 && fb.currentPrice > 0)
              mergedMat[idx] = { ...mergedMat[idx], currentPrice: fb.currentPrice };
          }
        }
      }
      const priceMap = new Map<string, number>();
      const unitMap = new Map<string, string>();
      for (const mc of mergedMat) {
        const k = normalizePn(mc.materialCode);
        if (mc.currentPrice > 0) priceMap.set(k, mc.currentPrice);
        if (mc.unit) unitMap.set(k, mc.unit);
      }

      // 재질 타입 맵 (PAINT/RESIN 구분)
      const materialTypeMap = new Map<string, string>();
      for (const mc of mergedMat) {
        materialTypeMap.set(normalizePn(mc.materialCode), mc.materialType || '');
      }

      // 구매단가 맵
      const purchasePriceMap = new Map<string, number>();
      for (const pp of purchasePrices) {
        if (pp.currentPrice > 0) {
          purchasePriceMap.set(normalizePn(pp.itemCode), pp.currentPrice);
          if (pp.customerPn) purchasePriceMap.set(normalizePn(pp.customerPn), pp.currentPrice);
        }
      }

      // 외주사출판매가 맵
      const outsourcePriceMap = new Map<string, number>();
      for (const op of outsourcePrices) {
        if (op.injectionPrice > 0) {
          outsourcePriceMap.set(normalizePn(op.itemCode), op.injectionPrice);
          if (op.customerPn) outsourcePriceMap.set(normalizePn(op.customerPn), op.injectionPrice);
        }
      }

      // 표준재료비 맵 (JSON fallback + DB 우선)
      const stdCostMap = new Map<string, { eaCost: number; processType: string; productName: string }>();
      for (const sc of fallbackStandardCosts) {
        if (sc.eaCost > 0) {
          stdCostMap.set(normalizePn(sc.productCode), sc);
          if (sc.customerPn) stdCostMap.set(normalizePn(sc.customerPn), sc);
        }
      }
      // DB item_standard_cost 우선 적용 (사용자가 재료비.xlsx 업로드 시 반영)
      for (const sc of dbStdCosts) {
        const costVal = (sc as unknown as Record<string, unknown>).material_cost_per_ea as number || 0;
        // P/N 매핑 보강: item_standard_cost의 customer_pn ↔ item_code
        if (sc.customer_pn && sc.item_code) {
          const cpn = normalizePn(sc.customer_pn);
          const icode = normalizePn(sc.item_code);
          if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
          if (!internalToCust.has(icode)) internalToCust.set(icode, cpn);
        }
        if (costVal > 0) {
          const entry = { eaCost: costVal, processType: sc.item_type || '', productName: sc.item_name || '' };
          stdCostMap.set(normalizePn(sc.item_code), entry);
          if (sc.customer_pn) stdCostMap.set(normalizePn(sc.customer_pn), entry);
        }
      }

      // 구매/외주 품목은 BOM에서 항상 leaf로 처리 (하위 BOM 전개 방지)
      const forceLeafPns = new Set<string>();
      for (const ri of refInfo) {
        if (/구매|외주/.test(ri.supplyType || '')) {
          forceLeafPns.add(normalizePn(ri.itemCode));
          if (ri.customerPn) forceLeafPns.add(normalizePn(ri.customerPn));
        }
      }

      // BOM prefix index (fuzzy 매칭용)
      const bomPrefixIndex = new Map<string, string>();
      for (const bk of bomRelations.keys()) {
        for (let len = 8; len <= bk.length; len++) {
          const p = bk.slice(0, len);
          if (!bomPrefixIndex.has(p)) bomPrefixIndex.set(p, bk);
        }
      }

      // leaf 가격 조회
      function getLeafPrice(leafCode: string): { price: number; source: string } {
        const code = normalizePn(leafCode);
        // 1) 표준재료비 EA단가
        const std = stdCostMap.get(code);
        if (std && std.eaCost > 0) return { price: std.eaCost, source: '표준재료비' };
        // 2) 재질코드 직접 (원재료 단가 ₩/kg)
        const dp = priceMap.get(code);
        if (dp && dp > 0) return { price: dp, source: '재질코드' };
        // 3) 구매단가 (외주품은 구매단가-사출판매가=순재료비)
        const pp = purchasePriceMap.get(code);
        if (pp && pp > 0) {
          const riCheck = refInfoMap.get(code);
          if (riCheck && /외주/.test(riCheck.supplyType || '')) {
            const op = outsourcePriceMap.get(code) || 0;
            const netMat = Math.max(0, pp - op);
            return { price: netMat, source: op > 0 ? '외주(구매-사출)' : '구매단가' };
          }
          return { price: pp, source: '구매단가' };
        }
        // 4) rawMaterialCode + netWeight → 사출재료비 공식 적용
        const ri = refInfoMap.get(code);
        if (ri) {
          const rawCodes = [ri.rawMaterialCode1, ri.rawMaterialCode2].filter(Boolean) as string[];
          for (const raw of rawCodes) {
            const rawNorm = normalizePn(raw);
            const matType = materialTypeMap.get(rawNorm) || '';
            if (/PAINT|도료/i.test(matType)) continue;
            const rp = priceMap.get(rawNorm);
            if (rp && rp > 0) {
              const nw = ri.netWeight || 0;
              if (nw > 0) {
                const rw = ri.runnerWeight || 0;
                const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
                const loss = ri.lossRate || 0;
                const weightPerEa = nw + rw / cavity;
                const cost = (weightPerEa * rp / 1000) * (1 + loss / 100);
                return { price: cost, source: `사출(${nw}g)` };
              }
              return { price: rp, source: '원재료' };
            }
          }
        }
        return { price: 0, source: '' };
      }

      // BOM 부모 찾기
      function findBomParent(forecastPn: string): string | null {
        let bomParent = normalizePn(forecastPn);
        if (bomRelations.has(bomParent)) return bomParent;
        const internal = custToInternal.get(bomParent);
        if (internal && bomRelations.has(internal)) return internal;
        const cust = internalToCust.get(bomParent);
        if (cust && bomRelations.has(cust)) return cust;
        // fuzzy
        if (bomParent.length >= 10) {
          for (let pl = bomParent.length - 1; pl >= 8; pl--) {
            const prefix = bomParent.slice(0, pl);
            const candidate = bomPrefixIndex.get(prefix);
            if (candidate && bomRelations.has(candidate)) return candidate;
          }
        }
        return null;
      }

      // dbStdCosts에서 P/N 매핑 보강: item_code ↔ customerPn → refInfoMap도 보강
      for (const sc of dbStdCosts) {
        if (sc.customer_pn && sc.item_code) {
          const cpn = normalizePn(sc.customer_pn);
          const icode = normalizePn(sc.item_code);
          // refInfoMap에 customerPn 키가 없으면 내부코드로 찾아서 추가
          if (!refInfoMap.has(cpn)) {
            const ri = refInfoMap.get(icode);
            if (ri) refInfoMap.set(cpn, ri);
          }
        }
      }

      // 제품별 산출
      const result: ProductRow[] = [];
      let _debugRefMatched = 0, _debugRefMissed = 0;
      for (const f of forecastData) {
        const forecastPn = normalizePn(f.newPartNo || f.partNo);
        const bomParent = findBomParent(forecastPn);
        const hasBom = !!bomParent;

        // BOM 전개
        let bomLeaves: BomLeaf[] = [];
        let bomMaterialCost = 0;
        if (bomParent) {
          const leaves = expandBomToLeaves(bomParent, 1, bomRelations, undefined, 0, 10, forceLeafPns);
          bomLeaves = leaves.map(l => {
            const { price, source } = getLeafPrice(l.childPn);
            // BOM에 유형/구입처가 없으면 기준정보에서 보강
            const leafRef = refInfoMap.get(normalizePn(l.childPn));
            const partType = l.partType || leafRef?.processType || leafRef?.supplyType || '';
            const supplier = l.supplier || leafRef?.supplier || '';
            return {
              childPn: l.childPn,
              childName: l.childName || leafRef?.itemName || '',
              qty: 0,
              totalQty: l.totalRequired,
              unitPrice: price,
              cost: l.totalRequired * price,
              priceSource: source,
              depth: 0,
              partType,
              supplier,
            };
          });
          bomMaterialCost = bomLeaves.reduce((s, l) => s + l.cost, 0);
        }

        // [프로그램 수정] 도장재료비 자동 산입: 기준정보 paintQty × 재질단가
        let paintCost = 0;
        // refInfo 매칭: forecast P/N → 직접 → custToInternal → internalToCust → partNo도 시도
        const productRef = refInfoMap.get(forecastPn)
          || refInfoMap.get(custToInternal.get(forecastPn) || '')
          || refInfoMap.get(internalToCust.get(forecastPn) || '')
          || (f.partNo ? refInfoMap.get(normalizePn(f.partNo)) : undefined)
          || (f.partNo ? refInfoMap.get(custToInternal.get(normalizePn(f.partNo)) || '') : undefined)
          || (f.newPartNo ? refInfoMap.get(custToInternal.get(normalizePn(f.newPartNo)) || '') : undefined);
        if (productRef) _debugRefMatched++; else _debugRefMissed++;
        if (productRef && /도장/i.test(productRef.processType || '')) {
          const rawCodes = [productRef.rawMaterialCode1, productRef.rawMaterialCode2, productRef.rawMaterialCode3, productRef.rawMaterialCode4].filter(Boolean) as string[];
          const paintQtys = [productRef.paintQty1, productRef.paintQty2, productRef.paintQty3, productRef.paintQty4];
          let paintIdx = 0;
          for (const rawCode of rawCodes) {
            const matType = materialTypeMap.get(normalizePn(rawCode)) || '';
            if (/PAINT|도료/i.test(matType)) {
              const paintPrice = priceMap.get(normalizePn(rawCode)) || 0;
              const pqty = paintQtys[paintIdx] || 0;
              if (paintPrice > 0 && pqty > 0) {
                const cost = paintPrice * pqty / 1000; // g→kg 변환
                paintCost += cost;
                bomLeaves.push({
                  childPn: rawCode,
                  childName: `도장재료 ${paintIdx + 1}도`,
                  qty: pqty, totalQty: pqty / 1000,
                  unitPrice: paintPrice, cost,
                  priceSource: `도장 paintQty${paintIdx + 1}`,
                  depth: 0, partType: '도장', supplier: '',
                });
              }
              paintIdx++;
            }
          }
          bomMaterialCost += paintCost;
        }

        // 표준재료비
        const stdEntry = stdCostMap.get(forecastPn)
          || stdCostMap.get(custToInternal.get(forecastPn) || '')
          || stdCostMap.get(internalToCust.get(forecastPn) || '');
        const stdMaterialCost = stdEntry?.eaCost || 0;
        const hasStdCost = stdMaterialCost > 0;

        // [Fix 3] 기준정보 기반 직접 산출 (BOM/stdCost 둘 다 없을 때 3번째 fallback)
        let refInfoCost = 0;
        if (!hasStdCost && bomMaterialCost <= 0 && productRef) {
          const supplyType = productRef.supplyType || '';
          const isPurchase = supplyType === '구매';
          const isOutsource = supplyType.includes('외주');

          if (isPurchase) {
            // 구매: purchasePriceMap에서 조회
            const pp = purchasePriceMap.get(forecastPn)
              || purchasePriceMap.get(custToInternal.get(forecastPn) || '')
              || purchasePriceMap.get(internalToCust.get(forecastPn) || '');
            if (pp && pp > 0) {
              refInfoCost = pp;
              bomLeaves.push({
                childPn: forecastPn, childName: '구매단가 (단가현황)',
                qty: 1, totalQty: 1, unitPrice: pp, cost: pp,
                priceSource: '구매단가', depth: 0, partType: '구매', supplier: productRef.supplier || '',
              });
            }
          } else if (isOutsource) {
            // 외주: 구매단가 - 사출판매가 = 순 재료비
            const pp = purchasePriceMap.get(forecastPn)
              || purchasePriceMap.get(custToInternal.get(forecastPn) || '')
              || purchasePriceMap.get(internalToCust.get(forecastPn) || '');
            const op = outsourcePriceMap.get(forecastPn)
              || outsourcePriceMap.get(custToInternal.get(forecastPn) || '')
              || outsourcePriceMap.get(internalToCust.get(forecastPn) || '');
            if (pp && pp > 0) {
              refInfoCost = Math.max(0, pp - (op || 0));
              bomLeaves.push({
                childPn: forecastPn, childName: '외주재료비 (구매-사출)',
                qty: 1, totalQty: 1, unitPrice: refInfoCost, cost: refInfoCost,
                priceSource: '외주산출', depth: 0, partType: '외주', supplier: productRef.supplier || '',
              });
            }
          } else {
            // 자작: 사출재료비 = (NET중량 + Runner/Cavity) × 원재료단가/1000 × (1+Loss율)
            const nw = productRef.netWeight || 0;
            const rw = productRef.runnerWeight || 0;
            const cavity = (productRef.cavity && productRef.cavity > 0) ? productRef.cavity : 1;
            const lossRate = productRef.lossRate || 0;

            if (nw > 0) {
              const rawCodes = [productRef.rawMaterialCode1, productRef.rawMaterialCode2].filter(Boolean) as string[];
              for (const raw of rawCodes) {
                const rawNorm = normalizePn(raw);
                const matType = materialTypeMap.get(rawNorm) || '';
                if (/PAINT|도료/i.test(matType)) continue; // 도료는 위에서 처리
                const rawPrice = priceMap.get(rawNorm);
                if (rawPrice && rawPrice > 0) {
                  const weightPerEa = nw + rw / cavity;
                  const injCost = (weightPerEa * rawPrice / 1000) * (1 + lossRate / 100);
                  refInfoCost += injCost;
                  bomLeaves.push({
                    childPn: raw, childName: `사출재료 (기준정보)`,
                    qty: nw, totalQty: weightPerEa / 1000,
                    unitPrice: rawPrice, cost: injCost,
                    priceSource: '기준정보 산출', depth: 0, partType: '사출', supplier: '',
                  });
                  break;
                }
              }
            }
            // 도장비는 이미 paintCost에 포함되어 bomMaterialCost에 합산됨 → refInfoCost에 추가
            refInfoCost += paintCost;
          }
        }

        // 최종 재료비: 표준재료비 → BOM전개 → 기준정보 직접산출
        const materialCost = stdMaterialCost > 0 ? stdMaterialCost
          : bomMaterialCost > 0 ? bomMaterialCost
          : refInfoCost;
        const materialRatio = f.unitPrice > 0 && materialCost > 0 ? (materialCost / f.unitPrice) * 100 : 0;

        // 데이터 품질 판정
        const dataQuality: 'high' | 'medium' | 'low' =
          hasStdCost ? 'high'
          : (hasBom && bomMaterialCost > 0) ? 'medium'
          : refInfoCost > 0 ? 'medium'
          : 'low';

        result.push({
          customer: f.customer,
          model: f.model,
          stage: f.stage,
          partNo: f.partNo,
          newPartNo: f.newPartNo,
          type: f.type,
          category: f.category,
          partName: f.partName,
          unitPrice: f.unitPrice,
          stdMaterialCost,
          bomMaterialCost,
          materialCost,
          materialRatio,
          yearlyQty: f.totalQty,
          yearlyRevenue: f.totalRevenue,
          yearlyMaterialCost: materialCost * f.totalQty,
          bomLeaves,
          hasBom,
          hasStdCost,
          forecastMonthlyQty: f.monthlyQty || new Array(12).fill(0),
          forecastMonthlyRevenue: f.monthlyRevenue || new Array(12).fill(0),
          dataQuality,
          paintCost,
          processType: productRef?.processType || '',
          supplyType: productRef?.supplyType || '',
          supplier: productRef?.supplier || '',
        });
      }

      console.log(`[제품별재료비] refInfo 매칭: ${_debugRefMatched}/${_debugRefMatched + _debugRefMissed}건 (${_debugRefMissed}건 미매칭)`);
      console.log(`[제품별재료비] refInfoMap 키 수: ${refInfoMap.size}, custToInternal: ${custToInternal.size}, internalToCust: ${internalToCust.size}`);
      if (_debugRefMissed > 0) {
        const missed = result.filter(r => !r.processType).slice(0, 5);
        console.log(`[제품별재료비] 미매칭 샘플:`, missed.map(r => ({ partNo: r.partNo, newPartNo: r.newPartNo })));
      }
      setBaseRows(result);
    } catch (err) {
      console.error('제품별 재료비 계산 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  // 월별 실적/계획 기반 수량·매출 산출
  const rows = useMemo(() => {
    if (baseRows.length === 0) return [] as ProductRow[];
    const currentMonth = new Date().getMonth(); // 0-based (Jan=0, Feb=1, ...)

    // 실적 데이터 맵: normalizedPN → monthStr('01'..'12') → {qty, amount}
    const revenueMap = new Map<string, Map<string, { qty: number; amount: number }>>();
    for (const ar of actualRevenue) {
      const match = ar.period?.match(/(\d{4})-(\d{1,2})/);
      if (!match) continue;
      const monthStr = match[2].padStart(2, '0');
      const keys = [ar.partNo, ar.customerPN].filter(Boolean).map(k => normalizePn(k));
      for (const key of keys) {
        if (!revenueMap.has(key)) revenueMap.set(key, new Map());
        const monthMap = revenueMap.get(key)!;
        const existing = monthMap.get(monthStr) || { qty: 0, amount: 0 };
        existing.qty += ar.qty || 0;
        existing.amount += ar.amount || 0;
        monthMap.set(monthStr, existing);
      }
    }

    const getActual = (row: ProductRow, monthStr: string) => {
      return revenueMap.get(normalizePn(row.newPartNo || row.partNo))?.get(monthStr)
        || revenueMap.get(normalizePn(row.partNo))?.get(monthStr)
        || null;
    };

    return baseRows.map(row => {
      let qty = 0;
      let revenue = 0;

      if (selectedMonth === 'all') {
        for (let m = 0; m < 12; m++) {
          const monthStr = String(m + 1).padStart(2, '0');
          if (m < currentMonth) {
            // 지난달: 실적 우선, 없으면 계획 fallback
            const actual = getActual(row, monthStr);
            if (actual && actual.qty > 0) {
              qty += actual.qty;
              revenue += actual.amount;
            } else {
              qty += row.forecastMonthlyQty[m] || 0;
              revenue += row.forecastMonthlyRevenue[m] || 0;
            }
          } else {
            // 당월+미래: 계획
            qty += row.forecastMonthlyQty[m] || 0;
            revenue += row.forecastMonthlyRevenue[m] || 0;
          }
        }
      } else {
        const monthIdx = parseInt(selectedMonth, 10) - 1;
        if (monthIdx < currentMonth) {
          // 지난달: 실적 우선
          const actual = getActual(row, selectedMonth);
          if (actual && actual.qty > 0) {
            qty = actual.qty;
            revenue = actual.amount;
          } else {
            qty = row.forecastMonthlyQty[monthIdx] || 0;
            revenue = row.forecastMonthlyRevenue[monthIdx] || 0;
          }
        } else {
          // 당월+미래: 계획
          qty = row.forecastMonthlyQty[monthIdx] || 0;
          revenue = row.forecastMonthlyRevenue[monthIdx] || 0;
        }
      }

      return {
        ...row,
        yearlyQty: qty,
        yearlyRevenue: revenue,
        yearlyMaterialCost: row.materialCost * qty,
      };
    });
  }, [baseRows, selectedMonth, actualRevenue]);

  // 기간 라벨
  const periodLabel = useMemo(() => {
    if (selectedMonth === 'all') return '연간';
    const monthNum = parseInt(selectedMonth, 10);
    const currentMonth = new Date().getMonth() + 1; // 1-based
    const source = monthNum < currentMonth ? '실적' : '계획';
    return `${monthNum}월 (${source})`;
  }, [selectedMonth]);

  // 필터
  const customers = useMemo(() => ['전체', ...Array.from(new Set(rows.map(r => r.customer).filter(Boolean)))], [rows]);
  const stages = useMemo(() => ['전체', ...Array.from(new Set(rows.map(r => r.stage).filter(Boolean)))], [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterCust !== '전체') r = r.filter(x => x.customer === filterCust);
    if (filterStage !== '전체') r = r.filter(x => x.stage === filterStage);
    if (searchText) {
      const f = searchText.toLowerCase();
      r = r.filter(x =>
        x.partNo.toLowerCase().includes(f) ||
        x.newPartNo.toLowerCase().includes(f) ||
        x.partName.toLowerCase().includes(f) ||
        x.category.toLowerCase().includes(f) ||
        x.processType.toLowerCase().includes(f) ||
        x.supplyType.toLowerCase().includes(f) ||
        x.supplier.toLowerCase().includes(f)
      );
    }
    // 정렬
    r = [...r].sort((a, b) => {
      const av = a[sortConfig.key] as number;
      const bv = b[sortConfig.key] as number;
      if (typeof av === 'number' && typeof bv === 'number')
        return sortConfig.dir === 'asc' ? av - bv : bv - av;
      return sortConfig.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return r;
  }, [rows, filterCust, filterStage, searchText, sortConfig]);

  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // 요약
  const summary = useMemo(() => {
    const totalRevenue = rows.reduce((s, r) => s + r.yearlyRevenue, 0);
    const totalMaterial = rows.reduce((s, r) => s + r.yearlyMaterialCost, 0);
    const withCost = rows.filter(r => r.materialCost > 0).length;
    const withBom = rows.filter(r => r.hasBom).length;
    const avgRatio = totalRevenue > 0 ? (totalMaterial / totalRevenue) * 100 : 0;
    return { total: rows.length, totalRevenue, totalMaterial, withCost, withBom, avgRatio };
  }, [rows]);

  // 필터된 행 집계 (subtotal)
  const subtotal = useMemo(() => {
    const qty = filtered.reduce((s, r) => s + r.yearlyQty, 0);
    const revenue = filtered.reduce((s, r) => s + r.yearlyRevenue, 0);
    const material = filtered.reduce((s, r) => s + r.yearlyMaterialCost, 0);
    const ratio = revenue > 0 ? (material / revenue) * 100 : 0;
    return { qty, revenue, material, ratio, count: filtered.length };
  }, [filtered]);

  const handleSort = (key: keyof ProductRow) => {
    setSortConfig(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' }
    );
  };

  const handleDownload = () => {
    const pLabel = selectedMonth === 'all' ? '연간' : `${parseInt(selectedMonth)}월`;
    const headers = ['거래선', '차종', '단계', 'P.N', 'NEW P.N', '품목명', 'Type', '구분', '부품유형', '조달구분', '협력업체', '판매단가', '표준재료비', '재료비율%', `${pLabel}수량`, `${pLabel}매출`, `${pLabel}재료비`, 'BOM', '표준단가'];
    const csvRows = filtered.map(r => [
      r.customer, r.model, r.stage, r.partNo, r.newPartNo, r.partName,
      r.type, r.category, r.processType, r.supplyType, r.supplier,
      String(Math.round(r.unitPrice)), String(Math.round(r.materialCost)), r.materialRatio.toFixed(1),
      String(r.yearlyQty), String(Math.round(r.yearlyRevenue)), String(Math.round(r.yearlyMaterialCost)),
      r.hasBom ? 'O' : 'X', r.hasStdCost ? 'O' : 'X',
    ]);
    downloadCSV(`제품별_재료비_${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows);
  };

  const handleMaterialPriceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // reset input so same file can be re-uploaded
    e.target.value = '';

    setMaterialPriceUploading(true);
    setMaterialPriceMsg('');

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // 헤더 행 자동 탐색
      const codePattern = /재질코드|material.*code/i;
      const pricePattern = /단가|가격|price|현재단가|current.*price/i;

      let headerRowIdx = -1;
      let codeColIdx = -1;
      let priceColIdx = -1;

      for (let ri = 0; ri < Math.min(rows.length, 20); ri++) {
        const row = rows[ri];
        if (!Array.isArray(row)) continue;
        for (let ci = 0; ci < row.length; ci++) {
          const cell = String(row[ci] || '').trim();
          if (codePattern.test(cell)) codeColIdx = ci;
          if (pricePattern.test(cell)) priceColIdx = ci;
        }
        if (codeColIdx >= 0 && priceColIdx >= 0) {
          headerRowIdx = ri;
          break;
        }
        // reset if only partial match on this row
        codeColIdx = -1;
        priceColIdx = -1;
      }

      if (headerRowIdx === -1 || codeColIdx < 0 || priceColIdx < 0) {
        setMaterialPriceMsg('헤더를 찾을 수 없습니다. "재질코드"와 "단가" 컬럼이 필요합니다.');
        setMaterialPriceUploading(false);
        return;
      }

      // 재질코드 → 단가 Map 생성
      const priceFromExcel = new Map<string, number>();
      for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
        const row = rows[ri];
        if (!Array.isArray(row)) continue;
        const code = String(row[codeColIdx] || '').trim().toUpperCase();
        const price = Number(row[priceColIdx]);
        if (code && !isNaN(price) && price > 0) {
          priceFromExcel.set(code, price);
        }
      }

      if (priceFromExcel.size === 0) {
        setMaterialPriceMsg('유효한 단가 데이터가 없습니다.');
        setMaterialPriceUploading(false);
        return;
      }

      // 기존 materialCodes 가져와서 병합
      const existingCodes = await materialCodeService.getAll();
      let updatedCount = 0;
      const merged = existingCodes.map(mc => {
        const key = mc.materialCode.trim().toUpperCase();
        const newPrice = priceFromExcel.get(key);
        if (newPrice !== undefined) {
          updatedCount++;
          return { ...mc, currentPrice: newPrice };
        }
        return mc;
      });

      // 저장
      await materialCodeService.saveAll(merged);

      // 화면 갱신
      await loadData();

      setMaterialPriceMsg(`${priceFromExcel.size}건 중 ${updatedCount}건 단가 업데이트 완료`);
    } catch (err) {
      console.error('재질단가 업로드 오류:', err);
      setMaterialPriceMsg('업로드 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
    } finally {
      setMaterialPriceUploading(false);
    }
  };

  const SortHeader: React.FC<{ label: string; k: keyof ProductRow; align?: string }> = ({ label, k, align = 'left' }) => (
    <th
      className={`px-3 py-2.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 select-none transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => handleSort(k)}
    >
      {label}
      {sortConfig.key === k && (
        <span className="ml-1 text-blue-500">{sortConfig.dir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  if (loading) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">제품별 재료비 계산 중...</div>;
  }

  if (baseRows.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <div className="text-slate-400 text-lg mb-2">데이터 없음</div>
        <div className="text-xs text-slate-400">영업현황에서 매출계획(Forecast)을 먼저 업로드하세요</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">총 제품</div>
          <div className="text-xl font-black text-slate-800">{summary.total}건</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">재료비 산출</div>
          <div className="text-xl font-black text-emerald-600">{summary.withCost}건</div>
          <div className="text-xs text-slate-400">{summary.total > 0 ? ((summary.withCost / summary.total) * 100).toFixed(0) : 0}%</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">BOM 보유</div>
          <div className="text-xl font-black text-blue-600">{summary.withBom}건</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">{periodLabel} 매출</div>
          <div className="text-xl font-black text-slate-800">{fmtWon(summary.totalRevenue)}원</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">{periodLabel} 재료비</div>
          <div className="text-xl font-black text-orange-600">{fmtWon(summary.totalMaterial)}원</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-500">평균 재료비율</div>
          <div className={`text-xl font-black ${summary.avgRatio > 50 ? 'text-red-600' : summary.avgRatio > 40 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {summary.avgRatio.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-blue-300 rounded-lg text-sm bg-blue-50 font-semibold text-blue-700">
          {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={filterCust} onChange={e => { setFilterCust(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          {customers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStage} onChange={e => { setFilterStage(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text" placeholder="P/N 또는 품목명 검색..."
          value={searchText} onChange={e => { setSearchText(e.target.value); setPage(0); }}
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-slate-400">{filtered.length}건</span>
        <button onClick={handleDownload}
          className="px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg hover:bg-emerald-600 transition-colors">
          Excel 내보내기
        </button>
        <button
          onClick={() => materialPriceFileRef.current?.click()}
          disabled={materialPriceUploading}
          className="px-4 py-2 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
        >
          {materialPriceUploading ? '업로드 중...' : '재질단가 업로드'}
        </button>
        <input
          ref={materialPriceFileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleMaterialPriceUpload}
        />
        {materialPriceMsg && (
          <span className={`text-xs font-medium ${materialPriceMsg.includes('실패') || materialPriceMsg.includes('없습니다') ? 'text-red-600' : 'text-blue-600'}`}>
            {materialPriceMsg}
          </span>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 text-[11px]">
              <tr>
                <SortHeader label="거래선" k="customer" />
                <SortHeader label="차종" k="model" />
                <SortHeader label="단계" k="stage" />
                <th className="px-3 py-2.5 text-left whitespace-nowrap">P.N</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">NEW P.N</th>
                <SortHeader label="품목명" k="partName" />
                <SortHeader label="Type" k="type" />
                <SortHeader label="구분" k="category" />
                <SortHeader label="부품유형" k="processType" />
                <SortHeader label="조달" k="supplyType" />
                <SortHeader label="협력업체" k="supplier" />
                <SortHeader label="판매단가" k="unitPrice" align="right" />
                <SortHeader label="재료비/EA" k="materialCost" align="right" />
                <SortHeader label="재료비율" k="materialRatio" align="right" />
                <SortHeader label={`${periodLabel} 수량`} k="yearlyQty" align="right" />
                <SortHeader label={`${periodLabel} 매출액`} k="yearlyRevenue" align="right" />
                <SortHeader label={`${periodLabel} 재료비`} k="yearlyMaterialCost" align="right" />
                <th className="px-2 py-2.5 text-center whitespace-nowrap text-[10px]">품질</th>
              </tr>
            </thead>
            <tbody>
              {/* 집계 행 (subtotal) */}
              <tr className="bg-blue-50 border-b-2 border-blue-200 text-[11px] font-bold text-blue-800 sticky top-[33px] z-10">
                <td colSpan={11} className="px-3 py-2 text-right">
                  집계 ({subtotal.count}건)
                </td>
                <td className="px-3 py-2 text-right font-mono">-</td>
                <td className="px-3 py-2 text-right font-mono">-</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${subtotal.ratio > 50 ? 'text-red-700' : subtotal.ratio > 40 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {subtotal.ratio > 0 ? `${subtotal.ratio.toFixed(1)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmt(subtotal.qty)}</td>
                <td className="px-3 py-2 text-right font-mono">₩{fmtWon(subtotal.revenue)}</td>
                <td className="px-3 py-2 text-right font-mono">₩{fmtWon(subtotal.material)}</td>
                <td></td>
              </tr>
              {paged.map((r, i) => {
                const ratioColor = r.materialRatio > 60 ? 'text-red-600 bg-red-50'
                  : r.materialRatio > 45 ? 'text-amber-600 bg-amber-50'
                  : r.materialRatio > 0 ? 'text-emerald-600' : 'text-slate-300';
                return (
                  <tr key={`${r.partNo}-${i}`} className="border-t border-slate-100 hover:bg-blue-50/30">
                    <td className="px-3 py-2">{r.customer}</td>
                    <td className="px-3 py-2">{r.model}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.stage === '양산' ? 'bg-green-100 text-green-700' :
                        r.stage === '단종' ? 'bg-red-100 text-red-700' :
                        r.stage === '신규' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{r.stage || '-'}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.partNo}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.newPartNo}</td>
                    <td className="px-3 py-2 max-w-[120px] truncate text-[11px]" title={r.partName}>{r.partName || '-'}</td>
                    <td className="px-3 py-2">{r.type || '-'}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">{r.category || '-'}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.processType ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          /사출/.test(r.processType) ? 'bg-blue-100 text-blue-700' :
                          /도장/.test(r.processType) ? 'bg-purple-100 text-purple-700' :
                          /조립/.test(r.processType) ? 'bg-teal-100 text-teal-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{r.processType}</span>
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.supplyType ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.supplyType === '자작' ? 'bg-green-100 text-green-700' :
                          r.supplyType === '구매' ? 'bg-amber-100 text-amber-700' :
                          r.supplyType.includes('외주') ? 'bg-orange-100 text-orange-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{r.supplyType}</span>
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-slate-600 max-w-[100px] truncate" title={r.supplier}>{r.supplier || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.unitPrice)}</td>
                    <td
                      className="px-3 py-2 text-right font-mono font-semibold cursor-pointer hover:bg-blue-100 rounded transition-colors relative group"
                      onClick={() => setPopupRow(r)}
                    >
                      <span className={r.materialCost > 0 ? 'text-blue-700 border-b border-dashed border-blue-400' : 'text-slate-300'}>
                        {r.materialCost > 0 ? `₩${fmt(r.materialCost)}` : '-'}
                      </span>
                      {r.materialCost > 0 && (
                        <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${ratioColor}`}>
                      {fmtPct(r.materialRatio)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.yearlyQty)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.yearlyRevenue > 0 ? `₩${fmtWon(r.yearlyRevenue)}` : '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.yearlyMaterialCost > 0 ? `₩${fmtWon(r.yearlyMaterialCost)}` : '-'}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        r.dataQuality === 'high' ? 'bg-emerald-500' :
                        r.dataQuality === 'medium' ? 'bg-amber-400' : 'bg-red-400'
                      }`} title={
                        r.dataQuality === 'high' ? '표준재료비 등록' :
                        r.dataQuality === 'medium' ? 'BOM 전개만 (표준재료비 미등록)' : '재료비 데이터 없음'
                      } />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-3 border-t border-slate-100">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30">이전</button>
            <span className="text-xs text-slate-500">{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30">다음</button>
          </div>
        )}
      </div>

      {/* BOM 트리 팝업 */}
      {popupRow && (
        <BomTreePopup
          row={popupRow}
          onClose={() => setPopupRow(null)}
          onPriceUpdate={() => {
            // 단가 수정 후 전체 재계산
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default ProductMaterialCostView;
