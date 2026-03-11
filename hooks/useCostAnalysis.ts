/**
 * useCostAnalysis — 원가분석 통합 데이터 로딩 + 계산 훅
 * BomReviewView와 100% 동일한 bomCostEngine 기반
 */
import { useState, useEffect, useMemo } from 'react';
import { ForecastItem } from '../utils/salesForecastParser';
import { BomRecord } from '../utils/bomDataParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from '../utils/bomMasterParser';
import {
  PurchasePrice, OutsourcePrice, PaintMixRatio, ItemStandardCost,
} from '../utils/standardMaterialParser';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  forecastService, bomMasterService, itemRevenueService,
  referenceInfoService, materialCodeService,
  purchasePriceService, outsourceInjPriceService, paintMixRatioService,
  itemStandardCostService, productCodeService,
} from '../services/supabaseService';
import {
  calcAllProductCosts, CostEngineResult, ProductCostRow, LeafMaterialRow, CostEngineSummary,
} from '../utils/bomCostEngine';

// ============================================================
// Types
// ============================================================

export interface CostAnalysisData {
  loading: boolean;

  // BomCostEngine 결과 (BomReviewView 동일 엔진)
  costResult: CostEngineResult | null;

  // Forecast 기본 정보
  forecastSummary: {
    totalQty: number;
    totalRevenue: number;
    itemCount: number;
    customers: number;
    models: number;
    monthlyRevenue: number[];
  } | null;

  // Controls
  selectedMonth: number;  // -1 = all, 0-11 = specific month
  setSelectedMonth: (m: number) => void;
}

// Re-export for panels
export type { ProductCostRow, LeafMaterialRow, CostEngineSummary };

// ============================================================
// Safe helpers
// ============================================================

const safeParseJson = <T>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key) || sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch { return fallback; }
};

// ============================================================
// Hook
// ============================================================

export function useCostAnalysis(): CostAnalysisData {
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(-1); // -1 = all

  // Raw data states
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [bomRecords, setBomRecords] = useState<BomRecord[]>([]);
  const [itemRevenue, setItemRevenue] = useState<ItemRevenueRow[]>([]);
  const [refInfo, setRefInfo] = useState<ReferenceInfoRecord[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCodeRecord[]>([]);
  const [purchasePrices, setPurchasePrices] = useState<PurchasePrice[]>([]);
  const [outsourcePrices, setOutsourcePrices] = useState<OutsourcePrice[]>([]);
  const [paintMixRatios, setPaintMixRatios] = useState<PaintMixRatio[]>([]);
  const [itemStandardCosts, setItemStandardCosts] = useState<ItemStandardCost[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCodeRecord[]>([]);

  // Load all data on mount
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        if (isSupabaseConfigured()) {
          const [fcRes, bomRes, revRes, riRes, mcRes, ppRes, opRes, pmRes, iscRes, pcRes] =
            await Promise.allSettled([
              forecastService.getItems('current'),
              bomMasterService.getAll(),
              itemRevenueService.getAll(),
              referenceInfoService.getAll(),
              materialCodeService.getAll(),
              purchasePriceService.getAll(),
              outsourceInjPriceService.getAll(),
              paintMixRatioService.getAll(),
              itemStandardCostService.getAll(),
              productCodeService.getAll(),
            ]);

          const val = <T>(r: PromiseSettledResult<T[]>): T[] =>
            r.status === 'fulfilled' ? r.value : [];

          setForecast(val(fcRes));
          setBomRecords(val(bomRes) as BomRecord[]);
          setItemRevenue(val(revRes));
          setRefInfo(val(riRes));
          setMaterialCodes(val(mcRes));
          setPurchasePrices(val(ppRes) as PurchasePrice[]);
          setOutsourcePrices(val(opRes) as OutsourcePrice[]);
          setPaintMixRatios(val(pmRes) as PaintMixRatio[]);
          setItemStandardCosts(val(iscRes));
          setProductCodes(val(pcRes) as ProductCodeRecord[]);
        } else {
          setForecast(safeParseJson('dashboard_forecastData', []));
          setBomRecords(safeParseJson('dashboard_bomData', []));
          setItemRevenue(safeParseJson('dashboard_itemRevenueData', []));
          setRefInfo(safeParseJson('dashboard_referenceInfoMaster', []));
          setMaterialCodes(safeParseJson('dashboard_materialCodeMaster', []));
          setPurchasePrices(safeParseJson('dashboard_purchasePriceMaster', []));
          setOutsourcePrices(safeParseJson('dashboard_outsourceInjPrice', []));
          setPaintMixRatios(safeParseJson('dashboard_paintMixRatioMaster', []));
        }
      } catch (err) {
        console.error('[원가분석] 데이터 로드 실패:', err);
      }
      setLoading(false);
    };
    loadAll();

    const onDataUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === 'dashboard_forecastData' && detail?.data) setForecast(detail.data);
      else if (detail?.key === 'dashboard_bomData' && detail?.data) setBomRecords(detail.data);
    };
    window.addEventListener('dashboard-data-updated', onDataUpdate);
    return () => window.removeEventListener('dashboard-data-updated', onDataUpdate);
  }, []);

  // Forecast summary (전체 forecast 기본 정보)
  const forecastSummary = useMemo(() => {
    if (forecast.length === 0) return null;
    const totalQty = forecast.reduce((s, i) => s + (i.totalQty || 0), 0);
    const totalRevenue = forecast.reduce((s, i) => s + (i.totalRevenue || 0), 0);
    const customers = new Set(forecast.map(f => f.customer).filter(Boolean)).size;
    const models = new Set(forecast.map(f => f.model).filter(Boolean)).size;
    const monthlyRevenue = Array(12).fill(0);
    for (const item of forecast) {
      if (item.monthlyRevenue) {
        for (let i = 0; i < 12; i++) monthlyRevenue[i] += Number(item.monthlyRevenue[i]) || 0;
      }
    }
    return { totalQty, totalRevenue, itemCount: forecast.length, customers, models, monthlyRevenue };
  }, [forecast]);

  // BomCostEngine 결과 (BomReviewView 동일 엔진)
  const costResult = useMemo(() => {
    if (forecast.length === 0 || bomRecords.length === 0) return null;
    try {
      return calcAllProductCosts({
        forecastData: forecast,
        bomRecords,
        refInfo,
        materialCodes,
        purchasePrices,
        outsourcePrices,
        paintMixRatios,
        itemStandardCosts,
        productCodes,
        itemRevenue,
        selectedMonth,
      });
    } catch (err) {
      console.error('[원가분석] BOM 원가 계산 실패:', err);
      return null;
    }
  }, [forecast, bomRecords, refInfo, materialCodes, purchasePrices, outsourcePrices, paintMixRatios, itemStandardCosts, productCodes, itemRevenue, selectedMonth]);

  return {
    loading, costResult, forecastSummary,
    selectedMonth, setSelectedMonth,
  };
}
