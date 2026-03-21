/**
 * useCostAnalysis — 원가분석 통합 데이터 로딩 + 계산 훅
 * BomReviewView와 100% 동일한 bomCostEngine 기반
 */
import { useState, useEffect, useMemo } from 'react';
import { ForecastItem } from '../utils/salesForecastParser';
import { BomRecord, PnMapping } from '../utils/bomDataParser';
import { ItemRevenueRow } from '../utils/revenueDataParser';
import { ReferenceInfoRecord, MaterialCodeRecord, ProductCodeRecord } from '../utils/bomMasterParser';
import {
  PurchasePrice, OutsourcePrice, PaintMixRatio, ItemStandardCost,
} from '../utils/standardMaterialParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { InventoryItem } from '../utils/inventoryDataParser';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  forecastService, bomMasterService, itemRevenueService,
  referenceInfoService, materialCodeService,
  purchasePriceService, outsourceInjPriceService, paintMixRatioService,
  itemStandardCostService, productCodeService,
  purchaseService, inventoryService, pnMappingService,
} from '../services/supabaseService';
import {
  calcAllProductCosts, CostEngineResult, ProductCostRow, LeafMaterialRow, CostEngineSummary, ProductContribution,
  buildPriceData, buildRefInfoMap,
} from '../utils/bomCostEngine';
import { verifyResinMaterial, printVerificationReport } from '../utils/mrpVerifier';

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

  // 입고실적 (자재수율 계산용)
  purchaseData: PurchaseItem[];

  // 재고 데이터 (MRP 발주량 산출용)
  inventoryItems: InventoryItem[];

  // Controls
  selectedMonth: number;  // -1 = all, 0-11 = specific month
  setSelectedMonth: (m: number) => void;
}

// Re-export for panels
export type { ProductCostRow, LeafMaterialRow, CostEngineSummary, PurchaseItem, InventoryItem };

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
  const [purchaseData, setPurchaseData] = useState<PurchaseItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [pnMapping, setPnMapping] = useState<PnMapping[]>([]);

  // Load all data on mount
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        if (isSupabaseConfigured()) {
          const [fcRes, bomRes, revRes, riRes, mcRes, ppRes, opRes, pmRes, iscRes, pcRes, purchRes, invRes, pnRes] =
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
              purchaseService.getAll(),
              inventoryService.getAll(),
              pnMappingService.getAll(),
            ]);

          const val = <T>(r: PromiseSettledResult<T[]>): T[] =>
            r.status === 'fulfilled' ? r.value : [];

          // 실패한 서비스 로그
          const names = ['forecast', 'bomMaster', 'itemRevenue', 'refInfo', 'materialCodes', 'purchasePrices', 'outsourcePrices', 'paintMixRatios', 'itemStandardCosts', 'productCodes', 'purchase', 'inventory', 'pnMapping'];
          [fcRes, bomRes, revRes, riRes, mcRes, ppRes, opRes, pmRes, iscRes, pcRes, purchRes, invRes, pnRes].forEach((r, i) => {
            if (r.status === 'rejected') console.error(`[원가분석] ${names[i]} 로드 실패:`, r.reason);
          });

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
          setPurchaseData(val(purchRes) as PurchaseItem[]);

          // inventoryService.getAll() returns InventoryData (not array)
          if (invRes.status === 'fulfilled') {
            const inv = invRes.value as any;
            const flat: InventoryItem[] = [
              ...(inv.warehouse || []),
              ...(inv.material || []),
              ...(inv.parts || []),
              ...(inv.product || []),
            ];
            setInventoryItems(flat);
          }

          // pnMapping: Supabase에서 로드 (fallback: localStorage)
          const pnData = val(pnRes) as PnMapping[];
          setPnMapping(pnData.length > 0 ? pnData : safeParseJson<PnMapping[]>('dashboard_pnMapping', []));
        } else {
          setForecast(safeParseJson('dashboard_forecastData', []));
          setBomRecords(safeParseJson('dashboard_bomData', []));
          setItemRevenue(safeParseJson('dashboard_itemRevenueData', []));
          setRefInfo(safeParseJson('dashboard_referenceInfoMaster', []));
          setMaterialCodes(safeParseJson('dashboard_materialCodeMaster', []));
          setPurchasePrices(safeParseJson('dashboard_purchasePriceMaster', []));
          setOutsourcePrices(safeParseJson('dashboard_outsourceInjPrice', []));
          setPaintMixRatios(safeParseJson('dashboard_paintMixRatioMaster', []));
          setPurchaseData(safeParseJson('dashboard_purchaseData', []));
          setPnMapping(safeParseJson<PnMapping[]>('dashboard_pnMapping', []));
          const invStored = safeParseJson<any>('dashboard_inventoryData', { warehouse: [], material: [], parts: [], product: [] });
          setInventoryItems([
            ...(invStored.warehouse || []),
            ...(invStored.material || []),
            ...(invStored.parts || []),
            ...(invStored.product || []),
          ]);
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
      else if (detail?.key === 'dashboard_purchaseData' && detail?.data) setPurchaseData(detail.data);
      else if (detail?.key === 'dashboard_pnMapping' && detail?.data) setPnMapping(detail.data);
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
      const result = calcAllProductCosts({
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
        pnMapping,
        selectedMonth,
      });
      return result;
    } catch (err) {
      console.error('[원가분석] BOM 원가 계산 실패:', err);
      return null;
    }
  }, [forecast, bomRecords, refInfo, materialCodes, purchasePrices, outsourcePrices, paintMixRatios, itemStandardCosts, productCodes, itemRevenue, pnMapping, selectedMonth]);

  // 검증 유틸: 브라우저 콘솔에서 window.__verifyMRP('RESIN코드') 호출
  useMemo(() => {
    if (!costResult) return;
    const priceData = buildPriceData(materialCodes, purchasePrices, outsourcePrices, itemStandardCosts);
    const refInfoMap = buildRefInfoMap(refInfo);
    (window as any).__verifyMRP = (code?: string) => {
      if (!code) {
        // RESIN 목록 출력
        const resins = costResult.leafMaterials
          .filter(m => m.materialType === 'RESIN')
          .sort((a, b) => b.totalCost - a.totalCost)
          .slice(0, 20);
        console.log('RESIN 자재 목록 (Top 20):');
        console.table(resins.map(m => ({
          코드: m.materialCode,
          자재명: m.materialName,
          단가: Math.round(m.unitPrice),
          총소요량: Math.round(m.monthlyQty.reduce((s, q) => s + q, 0)),
          금액: Math.round(m.totalCost),
          제품수: m.productBreakdown?.length || 0,
        })));
        console.log('사용법: __verifyMRP("자재코드") 로 상세 검증');
        return;
      }
      const report = verifyResinMaterial(
        code, costResult, bomRecords, refInfoMap, priceData.matPriceMap, priceData.materialTypeMap,
      );
      printVerificationReport(report);
      return report;
    };
    console.log('[MRP검증] window.__verifyMRP() 준비 완료. 인수 없이 호출하면 RESIN 목록 표시.');
  }, [costResult, bomRecords, refInfo, materialCodes, purchasePrices, outsourcePrices, itemStandardCosts]);

  return {
    loading, costResult, forecastSummary,
    purchaseData, inventoryItems,
    selectedMonth, setSelectedMonth,
  };
}
