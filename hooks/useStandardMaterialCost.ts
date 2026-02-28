/**
 * useStandardMaterialCost — data loading + state management hook.
 * Extracts all data states and Supabase loading logic from StandardMaterialCostView.
 * Computation useMemos remain in the component (tightly coupled to rendering).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ForecastItem } from '../utils/salesForecastParser';
import { BomRecord, PnMapping } from '../utils/bomDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { PurchaseItemMaster } from '../utils/purchaseSummaryTypes';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import {
  StandardMaterialData,
  PurchasePrice,
  OutsourcePrice,
  PaintMixRatio,
  ItemStandardCost,
} from '../utils/standardMaterialParser';
import { ReferenceInfoRecord, MaterialCodeRecord } from '../utils/bomMasterParser';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  referenceInfoService,
  materialCodeService,
  forecastService,
  bomMasterService,
  itemRevenueService,
  purchaseService,
  purchasePriceService,
  paintMixRatioService,
  outsourceInjPriceService,
  itemStandardCostService,
} from '../services/supabaseService';

// Re-export shared types
export type {
  MaterialCostRow,
  AutoCalcResult,
  MonthlySummaryRow,
  ComparisonRow,
  DiagnosticRow,
  GapAnalysisResult,
  ComparisonData,
  DiagnosticData,
  DataMode,
  ViewMode,
} from '../types/standardMaterialCost';

// ============================================================
// Safe storage helpers
// ============================================================

const safeGet = (key: string): string | null => {
  try { return localStorage.getItem(key) || sessionStorage.getItem(key); } catch { return null; }
};

const safeParseJson = <T>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key) || sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch { return fallback; }
};

// ============================================================
// Hook return type
// ============================================================

export interface UseStandardMaterialCostData {
  // Loading state
  supabaseLoading: boolean;

  // Core data arrays
  forecastData: ForecastItem[];
  itemRevenueData: ItemRevenueRow[];
  bomData: BomRecord[];
  pnMapping: PnMapping[];
  purchaseData: PurchaseItem[];
  itemMasterData: PurchaseItemMaster[];

  // Master reference data
  masterRefInfo: ReferenceInfoRecord[];
  masterMaterialCodes: MaterialCodeRecord[];
  masterPurchasePrices: PurchasePrice[];
  masterOutsourcePrices: OutsourcePrice[];
  masterPaintMixRatios: PaintMixRatio[];
  masterItemStandardCosts: ItemStandardCost[];

  // Excel data
  excelData: StandardMaterialData | null;

  // Setters (for upload handlers in component)
  setForecastData: React.Dispatch<React.SetStateAction<ForecastItem[]>>;
  setItemRevenueData: React.Dispatch<React.SetStateAction<ItemRevenueRow[]>>;
  setBomData: React.Dispatch<React.SetStateAction<BomRecord[]>>;
  setPnMapping: React.Dispatch<React.SetStateAction<PnMapping[]>>;
  setPurchaseData: React.Dispatch<React.SetStateAction<PurchaseItem[]>>;
  setItemMasterData: React.Dispatch<React.SetStateAction<PurchaseItemMaster[]>>;
  setMasterRefInfo: React.Dispatch<React.SetStateAction<ReferenceInfoRecord[]>>;
  setMasterMaterialCodes: React.Dispatch<React.SetStateAction<MaterialCodeRecord[]>>;
  setMasterPurchasePrices: React.Dispatch<React.SetStateAction<PurchasePrice[]>>;
  setMasterOutsourcePrices: React.Dispatch<React.SetStateAction<OutsourcePrice[]>>;
  setMasterPaintMixRatios: React.Dispatch<React.SetStateAction<PaintMixRatio[]>>;
  setMasterItemStandardCosts: React.Dispatch<React.SetStateAction<ItemStandardCost[]>>;
  setExcelData: React.Dispatch<React.SetStateAction<StandardMaterialData | null>>;

  // Actions
  loadAllData: () => void;
}

// ============================================================
// Hook implementation
// ============================================================

export function useStandardMaterialCost(): UseStandardMaterialCostData {
  // --- Core data ---
  const [forecastData, setForecastData] = useState<ForecastItem[]>([]);
  const [itemRevenueData, setItemRevenueData] = useState<ItemRevenueRow[]>([]);
  const [bomData, setBomData] = useState<BomRecord[]>([]);
  const [pnMapping, setPnMapping] = useState<PnMapping[]>([]);
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [itemMasterData, setItemMasterData] = useState<PurchaseItemMaster[]>([]);

  // --- Excel data ---
  const [excelData, setExcelData] = useState<StandardMaterialData | null>(() => {
    try {
      const stored = localStorage.getItem('dashboard_standardMaterial')
        || sessionStorage.getItem('dashboard_standardMaterial');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  // --- Master reference data ---
  const [masterRefInfo, setMasterRefInfo] = useState<ReferenceInfoRecord[]>(
    () => safeParseJson('dashboard_referenceInfoMaster', [])
  );
  const [masterMaterialCodes, setMasterMaterialCodes] = useState<MaterialCodeRecord[]>(
    () => safeParseJson('dashboard_materialCodeMaster', [])
  );
  const [masterPurchasePrices, setMasterPurchasePrices] = useState<PurchasePrice[]>(
    () => safeParseJson('dashboard_purchasePriceMaster', [])
  );
  const [masterOutsourcePrices, setMasterOutsourcePrices] = useState<OutsourcePrice[]>(
    () => safeParseJson('dashboard_outsourceInjPrice', [])
  );
  const [masterPaintMixRatios, setMasterPaintMixRatios] = useState<PaintMixRatio[]>(
    () => safeParseJson('dashboard_paintMixRatioMaster', [])
  );
  const [masterItemStandardCosts, setMasterItemStandardCosts] = useState<ItemStandardCost[]>([]);

  // --- Loading state ---
  const [supabaseLoading, setSupabaseLoading] = useState(false);

  // --- Load from localStorage / global cache ---
  const loadAllData = useCallback(() => {
    const cache = (window as any).__dashboardCache || {};
    const f = safeGet('dashboard_forecastData');
    if (f) try { setForecastData(JSON.parse(f)); } catch { /* */ }
    const ir = safeGet('dashboard_itemRevenueData');
    if (ir) try { setItemRevenueData(JSON.parse(ir)); } catch { /* */ }
    const b = safeGet('dashboard_bomData');
    if (b) try { setBomData(JSON.parse(b)); } catch { /* */ }
    else if (cache.bomData) setBomData(cache.bomData);
    const m = safeGet('dashboard_pnMapping');
    if (m) try { setPnMapping(JSON.parse(m)); } catch { /* */ }
    else if (cache.pnMapping) setPnMapping(cache.pnMapping);
    const p = safeGet('dashboard_purchaseData');
    if (p) try { setPurchaseData(JSON.parse(p)); } catch { /* */ }
    const im = safeGet('dashboard_purchaseItemMaster');
    if (im) try { setItemMasterData(JSON.parse(im)); } catch { /* */ }
    console.log('[표준재료비] 데이터 로드 완료', { bomFromCache: !b && !!cache.bomData, pnFromCache: !m && !!cache.pnMapping });
  }, []);

  // --- Load on mount + Supabase auto-load + cross-tab events ---
  useEffect(() => {
    loadAllData();

    // Supabase 자동 로드 — 병렬 fetch + 한 번에 setState
    const autoLoadFromSupabase = async () => {
      if (!isSupabaseConfigured()) return;
      setSupabaseLoading(true);
      try {
        const cache = (window as any).__dashboardCache || {};
        const needForecast = forecastData.length === 0;
        const needBom = bomData.length === 0 && !cache.bomData;
        const needRevenue = itemRevenueData.length === 0;
        const needPurchase = purchaseData.length === 0;
        const needRefInfo = masterRefInfo.length === 0;
        const needMatCodes = masterMaterialCodes.length === 0;
        const needPurchasePrice = masterPurchasePrices.length === 0;
        const needOutsourcePrice = masterOutsourcePrices.length === 0;
        const needPaintMix = masterPaintMixRatios.length === 0;
        const needItemStdCost = masterItemStandardCosts.length === 0;

        const [fcRes, bomRes, revRes, purRes, riRes, mcRes, ppRes, opRes, pmRes, iscRes] = await Promise.allSettled([
          needForecast ? forecastService.getItems('current') : Promise.resolve([]),
          needBom ? bomMasterService.getAll() : Promise.resolve([]),
          needRevenue ? itemRevenueService.getAll() : Promise.resolve([]),
          needPurchase ? purchaseService.getAll() : Promise.resolve([]),
          needRefInfo ? referenceInfoService.getAll() : Promise.resolve([]),
          needMatCodes ? materialCodeService.getAll() : Promise.resolve([]),
          needPurchasePrice ? purchasePriceService.getAll() : Promise.resolve([]),
          needOutsourcePrice ? outsourceInjPriceService.getAll() : Promise.resolve([]),
          needPaintMix ? paintMixRatioService.getAll() : Promise.resolve([]),
          needItemStdCost ? itemStandardCostService.getAll() : Promise.resolve([]),
        ]);

        // 한 번에 setState — React 18+ 자동 배치로 useMemo 1회만 재계산
        const fc = fcRes.status === 'fulfilled' ? fcRes.value : [];
        const bom = bomRes.status === 'fulfilled' ? bomRes.value : [];
        const rev = revRes.status === 'fulfilled' ? revRes.value : [];
        const pur = purRes.status === 'fulfilled' ? purRes.value : [];
        const ri = riRes.status === 'fulfilled' ? riRes.value : [];
        const mc = mcRes.status === 'fulfilled' ? mcRes.value : [];
        const pp = ppRes.status === 'fulfilled' ? ppRes.value : [];
        const op = opRes.status === 'fulfilled' ? opRes.value : [];
        const pm = pmRes.status === 'fulfilled' ? pmRes.value : [];
        const isc = iscRes.status === 'fulfilled' ? iscRes.value : [];

        if (needForecast && fc.length > 0) setForecastData(fc);
        if (needBom && bom.length > 0) setBomData(bom as BomRecord[]);
        if (needRevenue && rev.length > 0) setItemRevenueData(rev);
        if (needPurchase && pur.length > 0) setPurchaseData(pur);
        if (needRefInfo && ri.length > 0) setMasterRefInfo(ri);
        if (needMatCodes && mc.length > 0) setMasterMaterialCodes(mc);
        if (needPurchasePrice && pp.length > 0) setMasterPurchasePrices(pp as PurchasePrice[]);
        if (needOutsourcePrice && op.length > 0) setMasterOutsourcePrices(op as OutsourcePrice[]);
        if (needPaintMix && pm.length > 0) setMasterPaintMixRatios(pm as PaintMixRatio[]);
        if (needItemStdCost && isc.length > 0) setMasterItemStandardCosts(isc);

        console.log(`[표준재료비] Supabase 병렬 로드 완료: 매출계획 ${fc.length}건, BOM ${bom.length}건, 매출실적 ${rev.length}건, 입고 ${pur.length}건, 기준정보 ${ri.length}건, 재질코드 ${mc.length}건, 구매단가 ${pp.length}건, 외주사출 ${op.length}건, 도료배합 ${pm.length}건, 품목별원가 ${isc.length}건`);
      } catch (err) {
        console.error('[표준재료비] Supabase 자동 로드 실패:', err);
      } finally {
        setSupabaseLoading(false);
      }
    };
    autoLoadFromSupabase();

    // Cross-tab storage events
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('dashboard_')) loadAllData();
    };
    // Same-window custom events (with direct data payload)
    const onDataUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key && detail?.data) {
        const { key, data } = detail;
        if (key === 'dashboard_bomData') setBomData(data);
        else if (key === 'dashboard_pnMapping') setPnMapping(data);
        else if (key === 'dashboard_purchaseData') setPurchaseData(data);
        else if (key === 'dashboard_forecastData') setForecastData(data);
        else if (key === 'dashboard_itemRevenueData') setItemRevenueData(data);
        else if (key === 'dashboard_referenceInfoMaster') setMasterRefInfo(data);
        else if (key === 'dashboard_materialCodeMaster') setMasterMaterialCodes(data);
      } else {
        loadAllData();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('dashboard-data-updated', onDataUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('dashboard-data-updated', onDataUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    supabaseLoading,
    forecastData, setForecastData,
    itemRevenueData, setItemRevenueData,
    bomData, setBomData,
    pnMapping, setPnMapping,
    purchaseData, setPurchaseData,
    itemMasterData, setItemMasterData,
    masterRefInfo, setMasterRefInfo,
    masterMaterialCodes, setMasterMaterialCodes,
    masterPurchasePrices, setMasterPurchasePrices,
    masterOutsourcePrices, setMasterOutsourcePrices,
    masterPaintMixRatios, setMasterPaintMixRatios,
    masterItemStandardCosts, setMasterItemStandardCosts,
    excelData, setExcelData,
    loadAllData,
  };
}
