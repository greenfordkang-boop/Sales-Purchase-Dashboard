
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { safeSetItem } from '../utils/safeStorage';
import { SalesItem, CustomerSalesData, MonthlyStats } from '../utils/salesDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { PurchaseItemMaster, PurchaseMonthlySummary } from '../utils/purchaseSummaryTypes';
import { RevenueItem, ItemRevenueRow } from '../utils/revenueDataParser';
import { SupplierItem } from '../utils/supplierDataParser';
import { InventoryItem } from '../utils/inventoryDataParser';
import { CRItem } from '../utils/crDataParser';
import { RFQItem } from '../utils/rfqDataParser';
import { ForecastItem, ForecastSummary, ForecastUpload } from '../utils/salesForecastParser';
import { BomRecord, normalizePn } from '../utils/bomDataParser';
import { CIDetailItem } from '../utils/ciDataParser';
import {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
  EquipmentRecord,
  MaterialCodeRecord,
  DataQualityIssue,
} from '../utils/bomMasterParser';
import type { PurchasePrice, OutsourcePrice, PaintMixRatio, ItemStandardCost, PaintMixLog, MaterialPrice } from '../utils/standardMaterialParser';

// ============================================
// Helper Functions
// ============================================

// 테이블 미존재 시 반복 404 방지용 캐시
const _missingTables = new Set<string>();

const isTableMissing = (table: string) => _missingTables.has(table);

const checkTableError = (error: any, table: string): boolean => {
  // 404 = 테이블 미존재, 42P01 = relation does not exist
  const status = error?.code === '42P01' || error?.message?.includes('relation') ||
    (typeof error?.status === 'number' && error.status === 404);
  if (status) _missingTables.add(table);
  return status;
};

const handleError = (error: any, operation: string) => {
  console.error(`Supabase ${operation} error:`, error);
  throw error;
};

const BATCH_DELAY_MS = 50;
const MAX_BATCH_RETRIES = 3;

const shouldRetryBatch = (error: any) => {
  const status = typeof error?.status === 'number' ? error.status : undefined;
  if (status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }
  const message = String(error?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('timeout') || message.includes('gateway');
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const insertInBatches = async (table: string, rows: any[], batchSize = 500, onConflict?: string) => {
  if (rows.length === 0 || isTableMissing(table)) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let lastError: any = null;
    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt += 1) {
      const { error } = onConflict
        ? await supabase!.from(table).upsert(batch, { onConflict })
        : await supabase!.from(table).insert(batch);
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      if (!shouldRetryBatch(error) || attempt === MAX_BATCH_RETRIES) {
        break;
      }
      await sleep(BATCH_DELAY_MS * attempt);
    }
    if (lastError) {
      let failedRows = 0;
      let lastRowError: any = null;
      for (const row of batch) {
        let rowError: any = null;
        for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt += 1) {
          const { error } = onConflict
            ? await supabase!.from(table).upsert(row, { onConflict })
            : await supabase!.from(table).insert(row);
          if (!error) {
            rowError = null;
            break;
          }
          rowError = error;
          if (!shouldRetryBatch(error) || attempt === MAX_BATCH_RETRIES) {
            break;
          }
          await sleep(BATCH_DELAY_MS * attempt);
        }
        if (rowError) {
          failedRows += 1;
          lastRowError = rowError;
        }
      }
      if (failedRows === batch.length) {
        handleError(lastRowError || lastError, `${table} insert batch`);
      } else if (failedRows > 0) {
        console.warn(`Supabase ${table} insert batch partially failed: ${failedRows}/${batch.length} rows skipped.`);
      }
    }
    if (i + batchSize < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
};

const REVENUE_BATCH_SIZE = 200;

// Paginated fetch helper - Supabase default limit is 1000 rows
const fetchAllRows = async (
  table: string,
  orderBy: string,
  orderOpts?: { ascending?: boolean },
  extraOrder?: { column: string; ascending?: boolean }
): Promise<any[]> => {
  if (isTableMissing(table)) return [];

  const pageSize = 1000;
  let from = 0;
  let allRows: any[] = [];

  while (true) {
    let lastError: any = null;
    let data: any[] | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      let query = supabase!
        .from(table)
        .select('*')
        .order(orderBy, orderOpts || {})
        .range(from, from + pageSize - 1);

      if (extraOrder) {
        query = query.order(extraOrder.column, { ascending: extraOrder.ascending ?? true });
      }

      const result = await query;
      if (result.error) {
        if (checkTableError(result.error, table)) return allRows.length > 0 ? allRows : [];
        lastError = result.error;
        if (attempt < 3) await sleep(500 * attempt);
        continue;
      }
      data = result.data;
      lastError = null;
      break;
    }

    if (lastError) {
      handleError(lastError, `${table} fetchAll (page ${from})`);
      break;
    }
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
};

// ============================================
// Sales Data Service
// ============================================

export const salesService = {
  async getAll(): Promise<CustomerSalesData[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_salesData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('sales_data', 'customer');

    // Group by customer
    const customerMap = new Map<string, CustomerSalesData>();

    data?.forEach((row: any) => {
      if (!customerMap.has(row.customer)) {
        customerMap.set(row.customer, {
          customer: row.customer,
          monthlyData: row.monthly_data || [],
          totalPlan: 0,
          totalActual: 0,
          items: []
        });
      }

      const customerData = customerMap.get(row.customer)!;
      customerData.totalPlan += row.total_plan || 0;
      customerData.totalActual += row.total_actual || 0;

      customerData.items.push({
        id: row.id,
        customer: row.customer,
        model: row.model || '',
        partNo: row.part_no || '',
        partName: row.part_name || '',
        totalPlan: row.total_plan || 0,
        totalActual: row.total_actual || 0,
        rate: row.rate || 0
      });
    });

    return Array.from(customerMap.values());
  },

  async saveAll(data: CustomerSalesData[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_salesData', JSON.stringify(data));
      return;
    }

    // 기존 데이터 전체 삭제 후 새 데이터 삽입 (이전 업로드 잔존 데이터 방지)
    try {
      const { error } = await supabase!.from('sales_data').delete().neq('customer', '');
      if (error && !checkTableError(error, 'sales_data')) {
        console.warn('sales_data 기존 데이터 삭제 실패:', error);
      }
    } catch (err) {
      console.warn('sales_data 삭제 중 오류:', err);
    }

    const rows = data.flatMap(customer =>
      customer.items.map(item => ({
        customer: item.customer,
        model: item.model,
        part_no: item.partNo,
        part_name: item.partName,
        total_plan: item.totalPlan,
        total_actual: item.totalActual,
        rate: item.rate,
        monthly_data: customer.monthlyData
      }))
    );

    await insertInBatches('sales_data', rows, 500, 'customer,part_no');

    // Also save to localStorage as backup
    safeSetItem('dashboard_salesData', JSON.stringify(data));
  }
};

// ============================================
// Revenue Data Service
// ============================================

export const revenueService = {
  async getAll(): Promise<RevenueItem[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_revenueData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('revenue_data', 'year', { ascending: false }, { column: 'month', ascending: true });

    return data?.map((row: any, index: number) => ({
      id: typeof row.id === 'number' ? row.id : (Date.now() + index),
      year: typeof row.year === 'number' ? row.year : Number(row.year) || 0,
      month: row.month,
      customer: row.customer,
      model: row.model || '',
      qty: Number(row.qty) || 0,
      amount: Number(row.amount) || 0
    })) || [];
  },

  async saveAll(data: RevenueItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_revenueData', JSON.stringify(data));
      return;
    }

    // localStorage에 먼저 저장 (데이터 손실 방지)
    safeSetItem('dashboard_revenueData', JSON.stringify(data));

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      customer: item.customer,
      model: item.model,
      qty: Math.round(item.qty || 0),
      amount: Math.round(item.amount || 0)  // 소수점 값 방지
    }));

    await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE, 'year,month,customer,model');
  },

  async saveByYear(data: RevenueItem[], year: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      // For localStorage, filter and merge
      const stored = localStorage.getItem('dashboard_revenueData');
      const existing: RevenueItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => item.year !== year);
      const merged = [...filtered, ...data];
      safeSetItem('dashboard_revenueData', JSON.stringify(merged));
      return;
    }

    try {
      const rows = data.map(item => ({
        year: item.year,
        month: item.month,
        customer: item.customer,
        model: item.model || '',
        qty: Math.round(item.qty || 0),
        amount: Math.round(item.amount || 0)
      }));

      await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE, 'year,month,customer,model');

      // ⚠️ DO NOT reload from Supabase - prevents data loss
      // localStorage는 SalesView.tsx에서 이미 올바르게 업데이트됨
      console.log(`✅ Revenue data for year ${year} saved to Supabase (${rows.length} rows)`);
    } catch (error) {
      console.error('Failed to save revenue data by year:', error);
      // Don't throw - localStorage already has the data
    }
  }
};

// ============================================
// Item Revenue Data Service (품목별 매출현황)
// ============================================

export const itemRevenueService = {
  async getAll(): Promise<ItemRevenueRow[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_itemRevenueData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('item_revenue_data', 'period', { ascending: false }, { column: 'customer', ascending: true });

    return data?.map((row: any, index: number) => ({
      id: typeof row.id === 'number' ? row.id : (Date.now() + index),
      period: row.period || '',
      customer: row.customer || '',
      model: row.model || '',
      partNo: row.part_no || '',
      customerPN: row.customer_pn || '',
      partName: row.part_name || '',
      qty: Number(row.qty) || 0,
      amount: Number(row.amount) || 0
    })) || [];
  },

  async saveAll(data: ItemRevenueRow[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_itemRevenueData', JSON.stringify(data));
      return;
    }

    // localStorage에 먼저 저장 (데이터 손실 방지)
    safeSetItem('dashboard_itemRevenueData', JSON.stringify(data));

    const rows = data.map(item => ({
      period: item.period,
      customer: item.customer,
      model: item.model,
      part_no: item.partNo,
      customer_pn: item.customerPN,
      part_name: item.partName,
      qty: Math.round(item.qty || 0),
      amount: Math.round(item.amount || 0)
    }));

    await insertInBatches('item_revenue_data', rows, REVENUE_BATCH_SIZE, 'period,part_no,customer');
  }
};

// ============================================
// Purchase Data Service
// ============================================

export const purchaseService = {
  async getAll(): Promise<PurchaseItem[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('purchase_data', 'date', { ascending: false });

    return data?.map((row: any) => ({
      id: row.id,
      year: typeof row.year === 'number' ? row.year : Number(row.year) || 0,
      month: row.month,
      date: row.date,
      supplier: row.supplier,
      type: row.type || '',
      category: row.category as 'Parts' | 'Material',
      itemCode: row.item_code || '',
      itemName: row.item_name,
      spec: row.spec || '',
      unit: row.unit || '',
      qty: Number(row.qty) || 0,
      unitPrice: Number(row.unit_price) || 0,
      amount: Number(row.amount) || 0
    })) || [];
  },

  async saveAll(data: PurchaseItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_purchaseData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('purchase_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'purchase delete');

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      date: item.date,
      supplier: item.supplier,
      type: item.type,
      category: item.category,
      item_code: item.itemCode,
      item_name: item.itemName,
      spec: item.spec,
      unit: item.unit,
      qty: Math.round(item.qty || 0),
      unit_price: item.unitPrice,
      amount: item.amount
    }));

    await insertInBatches('purchase_data', rows);

    safeSetItem('dashboard_purchaseData', JSON.stringify(data));
  },

  // 월별/카테고리별 데이터 저장 (기존 해당 월/카테고리 데이터만 삭제 후 새 데이터 추가)
  async saveByMonthAndCategory(data: PurchaseItem[], month: string, category: 'Parts' | 'Material', year: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      // localStorage 처리: 해당 월/카테고리 데이터만 삭제 후 새 데이터 추가
      const stored = localStorage.getItem('dashboard_purchaseData');
      const existing: PurchaseItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => 
        !(item.month === month && item.category === category && item.year === year)
      );
      const merged = [...filtered, ...data];
      safeSetItem('dashboard_purchaseData', JSON.stringify(merged));
      return;
    }

    try {
      // Supabase에서 해당 월/카테고리/연도 데이터만 삭제
      const { error: deleteError } = await supabase!
        .from('purchase_data')
        .delete()
        .eq('month', month)
        .eq('category', category)
        .eq('year', year);

      if (deleteError) {
        console.error('Error deleting purchase data for month/category:', deleteError);
        // Don't throw - continue to insert
      }

      // 새 데이터 삽입
      const rows = data.map(item => ({
        year: item.year,
        month: item.month,
        date: item.date,
        supplier: item.supplier,
        type: item.type,
        category: item.category,
        item_code: item.itemCode,
        item_name: item.itemName,
        spec: item.spec,
        unit: item.unit,
        qty: Math.round(item.qty || 0),
        unit_price: item.unitPrice,
        amount: item.amount
      }));

      await insertInBatches('purchase_data', rows);

      // localStorage도 업데이트
      const stored = localStorage.getItem('dashboard_purchaseData');
      const existing: PurchaseItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => 
        !(item.month === month && item.category === category && item.year === year)
      );
      const merged = [...filtered, ...data];
      safeSetItem('dashboard_purchaseData', JSON.stringify(merged));

      console.log(`✅ Purchase data for ${year}년 ${month} ${category} saved to Supabase (${rows.length} rows)`);
    } catch (error) {
      console.error('Failed to save purchase data by month/category:', error);
      // localStorage는 이미 업데이트됨
    }
  }
};

// ============================================
// Inventory Data Service
// ============================================

interface InventoryData {
  warehouse: InventoryItem[];
  material: InventoryItem[];
  parts: InventoryItem[];
  product: InventoryItem[];
}

// New Inventory V2 Types (Resin, Paint, Parts)
interface MaterialItemV2 {
  id: string;
  code: string;
  name: string;
  unit: string;
  location: string;
  qty: number;
}

interface PartsItemV2 {
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
  storageLocation?: string;
  itemType?: string;
}

interface InventoryDataV2 {
  resin: MaterialItemV2[];
  paint: MaterialItemV2[];
  parts: PartsItemV2[];
}

export const inventoryService = {
  async getAll(): Promise<InventoryData> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_inventoryData');
      return stored ? JSON.parse(stored) : { warehouse: [], material: [], parts: [], product: [] };
    }

    // Supabase의 기본 max_rows 제한(보통 1,000행)을 우회하기 위해
    // 1,000행 단위로 모든 재고 행을 페이징 로드합니다.
    const pageSize = 1000;
    let from = 0;
    let allRows: any[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase!
        .from('inventory_data')
        .select('*')
        .order('code')
        .range(from, from + pageSize - 1);

      if (error) {
        handleError(error, 'inventory getAll');
        break;
      }

      if (!data || data.length === 0) break;

      allRows = allRows.concat(data);

      if (data.length < pageSize) break; // 마지막 페이지
      from += pageSize;
    }

    const result: InventoryData = { warehouse: [], material: [], parts: [], product: [] };

    allRows.forEach((row: any) => {
      const item: InventoryItem = {
        id: row.id,
        type: row.type,
        code: row.code,
        name: row.name,
        qty: row.qty || 0,
        spec: row.spec,
        unit: row.unit,
        location: row.location,
        customerPN: row.customer_pn,
        model: row.model,
        status: row.status,
        unitPrice: row.unit_price,
        amount: row.amount
      };

      if (result[row.type as keyof InventoryData]) {
        result[row.type as keyof InventoryData].push(item);
      }
    });

    return result;
  },

  async saveAll(data: InventoryData): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_inventoryData', JSON.stringify(data));
      return;
    }

    const allItems = [
      ...data.warehouse,
      ...data.material,
      ...data.parts,
      ...data.product
    ];

    let invalidRows = 0;
    const rows = allItems.map(item => ({
      type: item.type,
      code: item.code,
      name: item.name,
      qty: Math.round(item.qty || 0),
      spec: item.spec,
      unit: item.unit,
      location: item.location,
      customer_pn: item.customerPN,
      model: item.model,
      status: item.status,
      unit_price: item.unitPrice,
      amount: item.amount
    })).filter(row => {
      const hasCode = typeof row.code === 'string' && row.code.trim().length > 0;
      const hasName = typeof row.name === 'string' && row.name.trim().length > 0;
      if (!hasCode || !hasName) {
        invalidRows += 1;
        return false;
      }
      return true;
    });

    if (invalidRows > 0) {
      console.warn(`Inventory upload skipped ${invalidRows} rows without code or name.`);
    }

    await insertInBatches('inventory_data', rows, 500, 'type,code');

    safeSetItem('dashboard_inventoryData', JSON.stringify(data));
  },

  // ============================================
  // Inventory V2 (Resin, Paint, Parts) Methods
  // ============================================
  async getInventoryV2(): Promise<InventoryDataV2> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_inventory_v2');
      return stored ? JSON.parse(stored) : { resin: [], paint: [], parts: [] };
    }

    try {
      // Load from inventory_v2 table
      const pageSize = 1000;
      let from = 0;
      let allRows: any[] = [];

      while (true) {
        const { data, error } = await supabase!
          .from('inventory_v2')
          .select('*')
          .order('code')
          .range(from, from + pageSize - 1);

        if (error) {
          console.error('inventory_v2 getAll error:', error);
          break;
        }

        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      const result: InventoryDataV2 = { resin: [], paint: [], parts: [] };

      allRows.forEach((row: any) => {
        const type = row.type as 'resin' | 'paint' | 'parts';
        if (type === 'resin' || type === 'paint') {
          result[type].push({
            id: row.id,
            code: row.code,
            name: row.name,
            unit: row.unit || 'Kg',
            location: row.location || '',
            qty: row.qty || 0
          });
        } else if (type === 'parts') {
          result.parts.push({
            id: row.id,
            code: row.code,
            customerPN: row.customer_pn,
            name: row.name,
            spec: row.spec,
            model: row.model,
            unit: row.unit || 'EA',
            status: row.status,
            location: row.location || '',
            qty: row.qty || 0,
            unitPrice: row.unit_price,
            amount: row.amount,
            storageLocation: row.storage_location,
            itemType: row.item_type
          });
        }
      });

      return result;
    } catch (err) {
      console.error('Failed to load inventory_v2 from Supabase:', err);
      const stored = localStorage.getItem('dashboard_inventory_v2');
      return stored ? JSON.parse(stored) : { resin: [], paint: [], parts: [] };
    }
  },

  async saveInventoryV2(data: InventoryDataV2): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_inventory_v2', JSON.stringify(data));
      return;
    }

    try {
      // Prepare rows
      const rows: any[] = [];

      // Resin items
      data.resin.forEach(item => {
        if (item.code && item.code.trim()) {
          rows.push({
            type: 'resin',
            code: item.code,
            name: item.name,
            unit: item.unit || 'Kg',
            location: item.location,
            qty: Math.round(item.qty || 0)
          });
        }
      });

      // Paint items
      data.paint.forEach(item => {
        if (item.code && item.code.trim()) {
          rows.push({
            type: 'paint',
            code: item.code,
            name: item.name,
            unit: item.unit || 'Kg',
            location: item.location,
            qty: Math.round(item.qty || 0)
          });
        }
      });

      // Parts items
      data.parts.forEach(item => {
        if (item.code && item.code.trim()) {
          rows.push({
            type: 'parts',
            code: item.code,
            customer_pn: item.customerPN,
            name: item.name,
            spec: item.spec,
            model: item.model,
            unit: item.unit || 'EA',
            status: item.status,
            location: item.location,
            qty: Math.round(item.qty || 0),
            unit_price: item.unitPrice,
            amount: item.amount,
            storage_location: item.storageLocation,
            item_type: item.itemType
          });
        }
      });

      await insertInBatches('inventory_v2', rows, 500, 'type,code');

      // Also save to localStorage
      safeSetItem('dashboard_inventory_v2', JSON.stringify(data));
      console.log(`✅ inventory_v2 upserted: ${rows.length} rows`);
    } catch (err) {
      console.error('Failed to save inventory_v2 to Supabase:', err);
      // Still save to localStorage
      safeSetItem('dashboard_inventory_v2', JSON.stringify(data));
    }
  }
};

// ============================================
// CR Data Service
// ============================================

export const crService = {
  async getAll(): Promise<CRItem[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_crData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('cr_data', 'year', { ascending: true }, { column: 'month', ascending: true });

    return data
      ?.map((row: any) => ({
        year: typeof row.year === 'number' ? row.year : Number(row.year) || 2025,
        month: row.month,
        totalSales: row.total_sales || 0,
        lgSales: row.lg_sales || 0,
        lgCR: row.lg_cr || 0,
        lgDefense: row.lg_defense || 0,
        mtxSales: row.mtx_sales || 0,
        mtxCR: row.mtx_cr || 0,
        mtxDefense: row.mtx_defense || 0
      }))
      .filter((item: any) => item.month && item.month.trim() !== '') || [];
  },

  async saveAll(data: CRItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_crData', JSON.stringify(data));
      return;
    }

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      total_sales: item.totalSales,
      lg_sales: item.lgSales,
      lg_cr: item.lgCR,
      lg_defense: item.lgDefense,
      mtx_sales: item.mtxSales,
      mtx_cr: item.mtxCR,
      mtx_defense: item.mtxDefense
    }));

    await insertInBatches('cr_data', rows, 500, 'year,month');

    safeSetItem('dashboard_crData', JSON.stringify(data));
  },

  async saveByYear(data: CRItem[], year: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_crData');
      const existing: CRItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => item.year !== year);
      const merged = [...filtered, ...data];
      safeSetItem('dashboard_crData', JSON.stringify(merged));
      return;
    }

    try {
      const rows = data.map(item => ({
        year: item.year,
        month: item.month,
        total_sales: item.totalSales,
        lg_sales: item.lgSales,
        lg_cr: item.lgCR,
        lg_defense: item.lgDefense,
        mtx_sales: item.mtxSales,
        mtx_cr: item.mtxCR,
        mtx_defense: item.mtxDefense
      }));

      await insertInBatches('cr_data', rows, 500, 'year,month');

      // Update localStorage with merged data
      const stored = localStorage.getItem('dashboard_crData');
      const existing: CRItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => item.year !== year);
      const merged = [...filtered, ...data];
      safeSetItem('dashboard_crData', JSON.stringify(merged));
    } catch (err) {
      console.error('CR saveByYear error:', err);
      throw err;
    }
  }
};

// ============================================
// RFQ Data Service
// ============================================

export const rfqService = {
  async getAll(): Promise<RFQItem[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_rfqData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('rfq_data', 'created_at', { ascending: false });

    return data?.map((row: any) => ({
      id: row.id,
      index: row.index_no || '',
      customer: row.customer,
      projectType: row.project_type || '',
      projectName: row.project_name || '',
      process: row.process || '',
      status: row.status || '',
      dateSelection: row.date_selection || '',
      dateQuotation: row.date_quotation || '',
      datePO: row.date_po || '',
      model: row.model || '',
      qty: row.qty || 0,
      unitPrice: row.unit_price || 0,
      amount: row.amount || 0,
      remark: row.remark || ''
    })) || [];
  },

  async saveAll(data: RFQItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_rfqData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('rfq_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'rfq delete');

    const rows = data.map(item => ({
      index_no: item.index,
      customer: item.customer,
      project_type: item.projectType,
      project_name: item.projectName,
      process: item.process,
      status: item.status,
      date_selection: item.dateSelection || null,
      date_quotation: item.dateQuotation || null,
      date_po: item.datePO || null,
      model: item.model,
      qty: Math.round(item.qty || 0),
      unit_price: item.unitPrice,
      amount: item.amount,
      remark: item.remark
    }));

    await insertInBatches('rfq_data', rows);

    safeSetItem('dashboard_rfqData', JSON.stringify(data));
  },

  async add(item: RFQItem): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_rfqData');
      const data: RFQItem[] = stored ? JSON.parse(stored) : [];
      data.push(item);
      safeSetItem('dashboard_rfqData', JSON.stringify(data));
      return;
    }

    const { error } = await supabase!.from('rfq_data').insert({
      index_no: item.index,
      customer: item.customer,
      project_type: item.projectType,
      project_name: item.projectName,
      process: item.process,
      status: item.status,
      date_selection: item.dateSelection || null,
      date_quotation: item.dateQuotation || null,
      date_po: item.datePO || null,
      model: item.model,
      qty: Math.round(item.qty || 0),
      unit_price: item.unitPrice,
      amount: item.amount,
      remark: item.remark
    });

    if (error) handleError(error, 'rfq add');
  },

  async update(item: RFQItem): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_rfqData');
      const data: RFQItem[] = stored ? JSON.parse(stored) : [];
      const index = data.findIndex(d => d.id === item.id);
      if (index !== -1) {
        data[index] = item;
        safeSetItem('dashboard_rfqData', JSON.stringify(data));
      }
      return;
    }

    const { error } = await supabase!
      .from('rfq_data')
      .update({
        index_no: item.index,
        customer: item.customer,
        project_type: item.projectType,
        project_name: item.projectName,
        process: item.process,
        status: item.status,
        date_selection: item.dateSelection || null,
        date_quotation: item.dateQuotation || null,
        date_po: item.datePO || null,
        model: item.model,
        qty: Math.round(item.qty || 0),
        unit_price: item.unitPrice,
        amount: item.amount,
        remark: item.remark
      })
      .eq('id', item.id);

    if (error) handleError(error, 'rfq update');
  },

  async delete(id: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_rfqData');
      const data: RFQItem[] = stored ? JSON.parse(stored) : [];
      const filtered = data.filter(d => d.id !== id);
      safeSetItem('dashboard_rfqData', JSON.stringify(filtered));
      return;
    }

    const { error } = await supabase!
      .from('rfq_data')
      .delete()
      .eq('id', id);

    if (error) handleError(error, 'rfq delete');
  }
};

// ============================================
// Supplier Data Service (협력사 관리)
// ============================================

export const supplierService = {
  async getAll(): Promise<SupplierItem[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_supplierData');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('supplier_data', 'company_name');

    return data?.map((row: any, index: number) => ({
      id: row.id || `supplier-${Date.now()}-${index}`,
      companyName: row.company_name || '',
      businessNumber: row.business_number || '',
      ceo: row.ceo || '',
      address: row.address || '',
      purchaseAmount2025: row.purchase_amount_2025 || 0,
      purchaseAmount2024: row.purchase_amount_2024 || 0,
      purchaseAmount2023: row.purchase_amount_2023 || 0,
    })) || [];
  },

  async saveAll(data: SupplierItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetItem('dashboard_supplierData', JSON.stringify(data));
      return;
    }

    // localStorage에 먼저 저장 (데이터 손실 방지)
    safeSetItem('dashboard_supplierData', JSON.stringify(data));

    const rows = data.map(item => ({
      company_name: item.companyName,
      business_number: item.businessNumber,
      ceo: item.ceo,
      address: item.address,
      purchase_amount_2025: Math.round(item.purchaseAmount2025 || 0),
      purchase_amount_2024: Math.round(item.purchaseAmount2024 || 0),
      purchase_amount_2023: Math.round(item.purchaseAmount2023 || 0),
    }));

    await insertInBatches('supplier_data', rows, 500, 'company_name');
  }
};

// ============================================
// Purchase Item Master Service (품목기준정보)
// ============================================

export const purchaseItemMasterService = {
  async getAll(): Promise<PurchaseItemMaster[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseItemMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const pageSize = 1000;
      let from = 0;
      let allRows: any[] = [];

      while (true) {
        const { data, error } = await supabase!
          .from('purchase_item_master')
          .select('*')
          .order('part_no')
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return allRows.map((row: any) => ({
        id: row.id,
        partNo: row.part_no || '',
        costType: row.cost_type || '',
        purchaseType: row.purchase_type || '',
        materialType: row.material_type || '',
        process: row.process || '',
        customer: row.customer || '',
      }));
    } catch {
      // Table may not exist – fall back to localStorage
      const stored = localStorage.getItem('dashboard_purchaseItemMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async getMap(): Promise<Map<string, PurchaseItemMaster>> {
    const items = await this.getAll();
    const map = new Map<string, PurchaseItemMaster>();
    items.forEach(item => map.set(item.partNo, item));
    return map;
  },

  async saveAll(data: PurchaseItemMaster[]): Promise<void> {
    safeSetItem('dashboard_purchaseItemMaster', JSON.stringify(data));
    if (!isSupabaseConfigured() || isTableMissing('purchase_item_master')) return;

    const rows = data.map(item => ({
      part_no: item.partNo,
      cost_type: item.costType,
      purchase_type: item.purchaseType,
      material_type: item.materialType,
      process: item.process,
      customer: item.customer,
    }));

    await insertInBatches('purchase_item_master', rows, 500, 'part_no');
  },

  async upsertBatch(data: PurchaseItemMaster[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseItemMaster');
      const existing: PurchaseItemMaster[] = stored ? JSON.parse(stored) : [];
      const map = new Map(existing.map(i => [i.partNo, i]));
      data.forEach(item => map.set(item.partNo, item));
      safeSetItem('dashboard_purchaseItemMaster', JSON.stringify(Array.from(map.values())));
      return;
    }

    const rows = data.map(item => ({
      part_no: item.partNo,
      cost_type: item.costType,
      purchase_type: item.purchaseType,
      material_type: item.materialType,
      process: item.process,
      customer: item.customer,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase!
        .from('purchase_item_master')
        .upsert(batch, { onConflict: 'part_no' });

      if (error) console.error('purchaseItemMaster upsert error:', error);
      if (i + 500 < rows.length) await sleep(BATCH_DELAY_MS);
    }
  }
};

// ============================================
// Purchase Monthly Summary Service (매입종합집계)
// ============================================

function getPurchaseSummaryFromLocal(year?: number): PurchaseMonthlySummary[] {
  const stored = localStorage.getItem('dashboard_purchaseSummary');
  const all: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
  return year ? all.filter(d => d.year === year) : all;
}

export const purchaseSummaryService = {
  async getAll(year?: number): Promise<PurchaseMonthlySummary[]> {
    if (!isSupabaseConfigured() || isTableMissing('purchase_monthly_summary')) {
      return getPurchaseSummaryFromLocal(year);
    }

    try {
      const pageSize = 1000;
      let from = 0;
      let allRows: any[] = [];

      while (true) {
        let query = supabase!
          .from('purchase_monthly_summary')
          .select('*')
          .order('month')
          .order('supplier')
          .range(from, from + pageSize - 1);

        if (year) query = query.eq('year', year);

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return allRows.map((row: any) => ({
        id: row.id,
        year: row.year,
        month: row.month || '',
        supplier: row.supplier || '',
        partNo: row.part_no || '',
        partName: row.part_name || '',
        spec: row.spec || '',
        unit: row.unit || '',
        salesQty: Number(row.sales_qty) || 0,
        closingQty: Number(row.closing_qty) || 0,
        unitPrice: Number(row.unit_price) || 0,
        amount: Number(row.amount) || 0,
        location: row.location || '',
        costType: row.cost_type || '',
        purchaseType: row.purchase_type || '',
        materialType: row.material_type || '',
        process: row.process || '',
        customer: row.customer || '',
        remark: row.remark || '',
        closingMonth: row.closing_month || '',
      }));
    } catch {
      _missingTables.add('purchase_monthly_summary');
      return getPurchaseSummaryFromLocal(year);
    }
  },

  async saveByYearMonth(data: PurchaseMonthlySummary[], year: number, month: string): Promise<void> {
    // localStorage 항상 업데이트
    const stored = localStorage.getItem('dashboard_purchaseSummary');
    const existing: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
    const filtered = existing.filter(d => !(d.year === year && d.month === month));
    safeSetItem('dashboard_purchaseSummary', JSON.stringify([...filtered, ...data]));

    if (!isSupabaseConfigured() || isTableMissing('purchase_monthly_summary')) return;

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      supplier: item.supplier,
      part_no: item.partNo,
      part_name: item.partName,
      spec: item.spec,
      unit: item.unit,
      sales_qty: item.salesQty,
      closing_qty: item.closingQty,
      unit_price: item.unitPrice,
      amount: item.amount,
      location: item.location,
      cost_type: item.costType,
      purchase_type: item.purchaseType,
      material_type: item.materialType,
      process: item.process,
      customer: item.customer,
      remark: item.remark,
      closing_month: item.closingMonth,
    }));

    await insertInBatches('purchase_monthly_summary', rows, 500, 'year,month,supplier,part_no');
  },

  async saveAll(data: PurchaseMonthlySummary[]): Promise<void> {
    safeSetItem('dashboard_purchaseSummary', JSON.stringify(data));

    if (!isSupabaseConfigured() || isTableMissing('purchase_monthly_summary')) return;

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      supplier: item.supplier,
      part_no: item.partNo,
      part_name: item.partName,
      spec: item.spec,
      unit: item.unit,
      sales_qty: item.salesQty,
      closing_qty: item.closingQty,
      unit_price: item.unitPrice,
      amount: item.amount,
      location: item.location,
      cost_type: item.costType,
      purchase_type: item.purchaseType,
      material_type: item.materialType,
      process: item.process,
      customer: item.customer,
      remark: item.remark,
      closing_month: item.closingMonth,
    }));

    await insertInBatches('purchase_monthly_summary', rows, 500, 'year,month,supplier,part_no');
  }
};

// ============================================
// BOM Data Service (자재수율용)
// ============================================

export const bomService = {
  async getAll(): Promise<BomRecord[]> {
    if (!isSupabaseConfigured() || isTableMissing('bom_data')) {
      const stored = localStorage.getItem('dashboard_bomData');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('bom_data', 'parent_pn');
      return data.map((row: any) => ({
        parentPn: row.parent_pn || '',
        childPn: row.child_pn || '',
        level: row.level || 1,
        qty: Number(row.qty) || 1,
        childName: row.child_name || '',
        supplier: row.supplier || '',
        partType: row.part_type || '',
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_bomData');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(data: BomRecord[]): Promise<void> {
    safeSetItem('dashboard_bomData', JSON.stringify(data));
    if (!isSupabaseConfigured() || isTableMissing('bom_data')) return;

    const rows = data.map(item => ({
      parent_pn: item.parentPn,
      child_pn: item.childPn,
      level: item.level,
      qty: item.qty,
      child_name: item.childName,
      supplier: item.supplier,
      part_type: item.partType,
    }));

    await insertInBatches('bom_data', rows, 500, 'parent_pn,child_pn');
  },
};

// ============================================
// CI KPI Settings Service
// ============================================

interface CIKpiRow {
  prev_year_ci: number;
  prev_year_ci_ratio: number;
  target_ci: number;
  target_ci_ratio: number;
  monthly_ci_target: number[];
  monthly_ci_actual: number[];
}

export interface CRKpiData {
  prevYearCI: number;
  prevYearCIRatio: number;
  targetCI: number;
  targetCIRatio: number;
  monthlyCITarget: number[];
  monthlyCIActual: number[];
}

export const ciKpiService = {
  async get(): Promise<CRKpiData | null> {
    if (!isSupabaseConfigured() || isTableMissing('ci_kpi_settings')) {
      const stored = localStorage.getItem('dashboard_crKpiData');
      return stored ? JSON.parse(stored) : null;
    }

    const { data, error } = await supabase!
      .from('ci_kpi_settings')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      checkTableError(error, 'ci_kpi_settings');
      return null;
    }

    if (!data) return null;
    return {
      prevYearCI: Number(data.prev_year_ci) || 0,
      prevYearCIRatio: Number(data.prev_year_ci_ratio) || 0,
      targetCI: Number(data.target_ci) || 0,
      targetCIRatio: Number(data.target_ci_ratio) || 0,
      monthlyCITarget: Array.isArray(data.monthly_ci_target) ? data.monthly_ci_target : [],
      monthlyCIActual: Array.isArray(data.monthly_ci_actual) ? data.monthly_ci_actual : [],
    };
  },

  async save(data: CRKpiData): Promise<void> {
    safeSetItem('dashboard_crKpiData', JSON.stringify(data));
    if (!isSupabaseConfigured() || isTableMissing('ci_kpi_settings')) return;

    const { error: deleteError } = await supabase!
      .from('ci_kpi_settings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      if (checkTableError(deleteError, 'ci_kpi_settings')) return;
    }

    const row: CIKpiRow = {
      prev_year_ci: data.prevYearCI,
      prev_year_ci_ratio: data.prevYearCIRatio,
      target_ci: data.targetCI,
      target_ci_ratio: data.targetCIRatio,
      monthly_ci_target: Array.isArray(data.monthlyCITarget) ? data.monthlyCITarget : [],
      monthly_ci_actual: Array.isArray(data.monthlyCIActual) ? data.monthlyCIActual : [],
    };

    const { error } = await supabase!
      .from('ci_kpi_settings')
      .insert(row);

    if (error) checkTableError(error, 'ci_kpi_settings');
    else console.log('✅ CI KPI settings saved');
  }
};

// ============================================
// CI Details Service
// ============================================

export const ciDetailService = {
  async getAll(): Promise<Record<number, CIDetailItem[]>> {
    if (!isSupabaseConfigured() || isTableMissing('ci_details')) {
      const stored = localStorage.getItem('dashboard_ciDetails');
      return stored ? JSON.parse(stored) : {};
    }

    try {
    const data = await fetchAllRows('ci_details', 'month');
    if (!data || data.length === 0) return {};

    const byMonth: Record<number, CIDetailItem[]> = {};
    data.forEach((row: any) => {
      const m = row.month;
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push({
        customer: row.customer || '',
        productionSite: row.production_site || '',
        vehicleModel: row.vehicle_model || '',
        partCode: row.part_code || '',
        partNumber: row.part_number || '',
        partName: row.part_name || '',
        category: row.category || '',
        basePrice: Number(row.base_price) || 0,
        currentPrice: Number(row.current_price) || 0,
        quantity: Number(row.quantity) || 0,
        ciAmount: Number(row.ci_amount) || 0,
      });
    });
    return byMonth;
    } catch {
      const stored = localStorage.getItem('dashboard_ciDetails');
      return stored ? JSON.parse(stored) : {};
    }
  },

  async saveAll(data: Record<number, CIDetailItem[]>): Promise<void> {
    safeSetItem('dashboard_ciDetails', JSON.stringify(data));
    if (!isSupabaseConfigured() || isTableMissing('ci_details')) return;

    const { error: deleteError } = await supabase!
      .from('ci_details')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      if (checkTableError(deleteError, 'ci_details')) return;
    }

    const rows: any[] = [];
    for (const [monthStr, items] of Object.entries(data) as [string, CIDetailItem[]][]) {
      const month = parseInt(monthStr);
      for (const item of (items || [])) {
        rows.push({
          month,
          year: new Date().getFullYear(),
          customer: item.customer,
          production_site: item.productionSite,
          vehicle_model: item.vehicleModel,
          part_code: item.partCode,
          part_number: item.partNumber,
          part_name: item.partName,
          category: item.category,
          base_price: item.basePrice,
          current_price: item.currentPrice,
          quantity: item.quantity,
          ci_amount: item.ciAmount,
        });
      }
    }

    if (rows.length > 0) {
      await insertInBatches('ci_details', rows);
      console.log(`✅ CI details saved: ${rows.length} items`);
    }
  }
};

// ============================================
// CI Uploads Service
// ============================================

export interface CIUploadRecord {
  id: string;
  month: number;
  year: number;
  fileName: string;
  uploadDate: string;
  totalCIAmount: number;
  totalQuantity: number;
  itemCount: number;
}

export const ciUploadService = {
  async getAll(): Promise<CIUploadRecord[]> {
    if (!isSupabaseConfigured() || isTableMissing('ci_uploads')) {
      const stored = localStorage.getItem('dashboard_ciUploads');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('ci_uploads', 'month');
      return data?.map((row: any) => ({
        id: row.id,
        month: row.month,
        year: row.year,
        fileName: row.file_name || '',
        uploadDate: row.upload_date || '',
        totalCIAmount: Number(row.total_ci_amount) || 0,
        totalQuantity: Number(row.total_quantity) || 0,
        itemCount: row.item_count || 0,
      })) || [];
    } catch {
      const stored = localStorage.getItem('dashboard_ciUploads');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(data: CIUploadRecord[]): Promise<void> {
    safeSetItem('dashboard_ciUploads', JSON.stringify(data));
    if (!isSupabaseConfigured() || isTableMissing('ci_uploads')) return;

    const { error: deleteError } = await supabase!
      .from('ci_uploads')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      if (checkTableError(deleteError, 'ci_uploads')) return;
    }

    const rows = data.map(item => ({
      month: item.month,
      year: item.year,
      file_name: item.fileName,
      upload_date: item.uploadDate,
      total_ci_amount: item.totalCIAmount,
      total_quantity: item.totalQuantity,
      item_count: item.itemCount,
    }));

    if (rows.length > 0) {
      await insertInBatches('ci_uploads', rows);
      console.log(`✅ CI uploads saved: ${rows.length} records`);
    }
  }
};

// ============================================
// Utility: Check if Supabase has data & Auto-sync
// ============================================

export const checkAndAutoSync = async (): Promise<{ action: 'synced_up' | 'synced_down' | 'none'; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { action: 'none', message: 'Supabase not configured' };
  }

  try {
    // Check if Supabase has any data (quick check on sales_data)
    const { count, error } = await supabase!
      .from('sales_data')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('checkAndAutoSync: count error', error);
      return { action: 'none', message: `Check failed: ${error.message}` };
    }

    const supabaseHasData = (count || 0) > 0;

    // Check if localStorage has any data
    const localKeys = [
      'dashboard_salesData', 'dashboard_revenueData', 'dashboard_itemRevenueData',
      'dashboard_purchaseData', 'dashboard_inventoryData', 'dashboard_inventory_v2',
      'dashboard_crData', 'dashboard_rfqData', 'dashboard_supplierData',
      'dashboard_forecastData', 'dashboard_bomData'
    ];
    const localHasData = localKeys.some(key => {
      const val = localStorage.getItem(key);
      if (!val) return false;
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.length > 0;
        if (typeof parsed === 'object') return Object.values(parsed).some((v: any) => Array.isArray(v) && v.length > 0);
        return false;
      } catch { return false; }
    });

    if (!supabaseHasData && localHasData) {
      // Supabase empty, localStorage has data → sync UP only when cloud is completely empty
      console.log('Auto-sync: Supabase empty, pushing localStorage to cloud...');
      const result = await syncAllDataToSupabase();
      return { action: 'synced_up', message: result.message };
    }

    // Do NOT auto sync-down. Use manual "클라우드에서 다운로드" button instead.
    return { action: 'none', message: supabaseHasData ? 'Supabase has data' : 'No data to sync' };
  } catch (error: any) {
    console.error('checkAndAutoSync error:', error);
    return { action: 'none', message: `Auto-sync error: ${error.message}` };
  }
};

// ============================================
// Utility: Sync All Data to Supabase
// ============================================

export const syncAllDataToSupabase = async (): Promise<{ success: boolean; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase is not configured. Data is stored locally.' };
  }

  const errors: string[] = [];
  let syncedCount = 0;

  // Helper: sync one service independently so failures don't block others
  const syncOne = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      syncedCount++;
      console.log(`✅ ${name} synced`);
    } catch (err: any) {
      console.error(`❌ ${name} sync failed:`, err);
      errors.push(name);
    }
  };

  // Get all data from localStorage
  const salesData = localStorage.getItem('dashboard_salesData');
  const revenueData = localStorage.getItem('dashboard_revenueData');
  const itemRevenueData = localStorage.getItem('dashboard_itemRevenueData');
  const purchaseData = localStorage.getItem('dashboard_purchaseData');
  const inventoryData = localStorage.getItem('dashboard_inventoryData');
  const inventoryV2Data = localStorage.getItem('dashboard_inventory_v2');
  const crData = localStorage.getItem('dashboard_crData');
  const rfqData = localStorage.getItem('dashboard_rfqData');
  const supplierData = localStorage.getItem('dashboard_supplierData');

  // Sync each data type independently (with row count logging)
  if (salesData) {
    const parsed = JSON.parse(salesData);
    console.log(`📤 sales uploading: ${parsed.length} customers, ${parsed.reduce((s: number, c: any) => s + (c.items?.length || 0), 0)} items`);
    await syncOne('sales', () => salesService.saveAll(parsed));
  }
  if (revenueData) {
    const parsed = JSON.parse(revenueData);
    const total2026 = parsed.filter((r: any) => r.year === 2026).reduce((s: number, r: any) => s + (r.amount || 0), 0);
    console.log(`📤 revenue uploading: ${parsed.length} rows, 2026 total: ${(total2026/100000000).toFixed(1)}억`);
    await syncOne('revenue', () => revenueService.saveAll(parsed));
  }
  if (itemRevenueData) await syncOne('itemRevenue', () => itemRevenueService.saveAll(JSON.parse(itemRevenueData)));
  if (purchaseData) await syncOne('purchase', () => purchaseService.saveAll(JSON.parse(purchaseData)));
  if (inventoryData) await syncOne('inventory', () => inventoryService.saveAll(JSON.parse(inventoryData)));
  if (inventoryV2Data) await syncOne('inventoryV2', () => inventoryService.saveInventoryV2(JSON.parse(inventoryV2Data)));
  if (crData) await syncOne('cr', () => crService.saveAll(JSON.parse(crData)));
  if (rfqData) await syncOne('rfq', () => rfqService.saveAll(JSON.parse(rfqData)));
  if (supplierData) await syncOne('supplier', () => supplierService.saveAll(JSON.parse(supplierData)));

  // BOM data
  const bomData = localStorage.getItem('dashboard_bomData');
  if (bomData) await syncOne('bom', () => bomService.saveAll(JSON.parse(bomData)));

  // Forecast data
  const forecastData = localStorage.getItem('dashboard_forecastData');
  const forecastSummaryData = localStorage.getItem('dashboard_forecastData_summary');
  const forecastPrevData = localStorage.getItem('dashboard_forecastData_prev');
  const forecastPrevSummaryData = localStorage.getItem('dashboard_forecastData_prev_summary');
  const forecastUploadsData = localStorage.getItem('dashboard_forecastUploads');

  if (forecastData) await syncOne('forecast', () => forecastService.saveItems(JSON.parse(forecastData), 'current'));
  if (forecastSummaryData) await syncOne('forecastSummary', () => forecastService.saveSummary(JSON.parse(forecastSummaryData), 'current'));
  if (forecastPrevData) await syncOne('forecastPrev', () => forecastService.saveItems(JSON.parse(forecastPrevData), 'previous'));
  if (forecastPrevSummaryData) await syncOne('forecastPrevSummary', () => forecastService.saveSummary(JSON.parse(forecastPrevSummaryData), 'previous'));
  if (forecastUploadsData) await syncOne('forecastUploads', () => forecastService.saveUploads(JSON.parse(forecastUploadsData)));

  // CI data
  const ciKpiData = localStorage.getItem('dashboard_crKpiData');
  const ciDetailsData = localStorage.getItem('dashboard_ciDetails');
  const ciUploadsData = localStorage.getItem('dashboard_ciUploads');

  if (ciKpiData) await syncOne('ciKpi', () => ciKpiService.save(JSON.parse(ciKpiData)));
  if (ciDetailsData) await syncOne('ciDetails', () => ciDetailService.saveAll(JSON.parse(ciDetailsData)));
  if (ciUploadsData) await syncOne('ciUploads', () => ciUploadService.saveAll(JSON.parse(ciUploadsData)));

  if (errors.length === 0) {
    return { success: true, message: `동기화 완료! (${syncedCount}개 항목)` };
  }
  return { success: false, message: `동기화 부분 완료: ${syncedCount}개 성공, ${errors.length}개 실패 (${errors.join(', ')})` };
};

// ============================================
// Utility: Load All Data from Supabase
// ============================================

export const loadAllDataFromSupabase = async (): Promise<{ success: boolean; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase is not configured. Using local data.' };
  }

  const errors: string[] = [];
  let loadedCount = 0;

  const loadOne = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      loadedCount++;
    } catch (err: any) {
      console.error(`❌ ${name} load failed:`, err);
      errors.push(name);
    }
  };

  // Load each data type independently (with row count logging)
  await loadOne('sales', async () => {
    const data = await salesService.getAll();
    console.log(`📊 sales downloaded: ${data.length} customers, ${data.reduce((s, c) => s + (c.items?.length || 0), 0)} items`);
    safeSetItem('dashboard_salesData', JSON.stringify(data));
  });
  await loadOne('revenue', async () => {
    const data = await revenueService.getAll();
    const total2026 = data.filter(r => r.year === 2026).reduce((s, r) => s + (r.amount || 0), 0);
    console.log(`📊 revenue downloaded: ${data.length} rows, 2026 total: ${(total2026/100000000).toFixed(1)}억`);
    safeSetItem('dashboard_revenueData', JSON.stringify(data));
  });
  await loadOne('itemRevenue', async () => {
    const data = await itemRevenueService.getAll();
    console.log(`📊 itemRevenue downloaded: ${data.length} rows`);
    safeSetItem('dashboard_itemRevenueData', JSON.stringify(data));
  });
  await loadOne('purchase', async () => {
    const data = await purchaseService.getAll();
    console.log(`📊 purchase downloaded: ${data.length} rows`);
    safeSetItem('dashboard_purchaseData', JSON.stringify(data));
  });
  await loadOne('inventory', async () => {
    const data = await inventoryService.getAll();
    safeSetItem('dashboard_inventoryData', JSON.stringify(data));
  });
  await loadOne('inventoryV2', async () => {
    const data = await inventoryService.getInventoryV2();
    if (data) safeSetItem('dashboard_inventory_v2', JSON.stringify(data));
  });
  await loadOne('cr', async () => {
    const data = await crService.getAll();
    safeSetItem('dashboard_crData', JSON.stringify(data));
  });
  await loadOne('rfq', async () => {
    const data = await rfqService.getAll();
    safeSetItem('dashboard_rfqData', JSON.stringify(data));
  });
  await loadOne('supplier', async () => {
    const data = await supplierService.getAll();
    safeSetItem('dashboard_supplierData', JSON.stringify(data));
  });
  await loadOne('bom', async () => {
    const data = await bomService.getAll();
    safeSetItem('dashboard_bomData', JSON.stringify(data));
  });

  // Forecast data
  await loadOne('forecast', async () => {
    const items = await forecastService.getItems('current');
    safeSetItem('dashboard_forecastData', JSON.stringify(items));
    const summary = await forecastService.getSummary('current');
    if (summary) safeSetItem('dashboard_forecastData_summary', JSON.stringify(summary));
  });
  await loadOne('forecastPrev', async () => {
    const items = await forecastService.getItems('previous');
    safeSetItem('dashboard_forecastData_prev', JSON.stringify(items));
    const summary = await forecastService.getSummary('previous');
    if (summary) safeSetItem('dashboard_forecastData_prev_summary', JSON.stringify(summary));
  });
  await loadOne('forecastUploads', async () => {
    const data = await forecastService.getUploads();
    safeSetItem('dashboard_forecastUploads', JSON.stringify(data));
  });

  // CI data
  await loadOne('ciKpi', async () => {
    const data = await ciKpiService.get();
    if (data) safeSetItem('dashboard_crKpiData', JSON.stringify(data));
  });
  await loadOne('ciDetails', async () => {
    const data = await ciDetailService.getAll();
    if (data && Object.keys(data).length > 0) safeSetItem('dashboard_ciDetails', JSON.stringify(data));
  });
  await loadOne('ciUploads', async () => {
    const data = await ciUploadService.getAll();
    if (data.length > 0) safeSetItem('dashboard_ciUploads', JSON.stringify(data));
  });

  if (errors.length === 0) {
    return { success: true, message: `다운로드 완료! (${loadedCount}개 항목)` };
  }
  return { success: false, message: `다운로드 부분 완료: ${loadedCount}개 성공, ${errors.length}개 실패 (${errors.join(', ')})` };
};

// ============================================
// Forecast Data Service (매출계획)
// ============================================

export const forecastService = {
  async getItems(version: 'current' | 'previous' = 'current'): Promise<ForecastItem[]> {
    const key = version === 'current' ? 'dashboard_forecastData' : 'dashboard_forecastData_prev';

    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const pageSize = 1000;
      let from = 0;
      let allRows: any[] = [];

      while (true) {
        const { data, error } = await supabase!
          .from('forecast_data')
          .select('*')
          .eq('version', version)
          .order('no')
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      const items = allRows.map((row: any) => ({
        no: row.no || 0,
        customer: row.customer || '',
        model: row.model || '',
        stage: row.stage || '',
        partNo: row.part_no || '',
        newPartNo: row.new_part_no || '',
        type: row.type || '',
        unitPrice: Number(row.unit_price) || 0,
        category: row.category || '',
        partName: row.part_name || '',
        monthlyQty: row.monthly_qty || [],
        totalQty: Number(row.total_qty) || 0,
        monthlyRevenue: row.monthly_revenue || [],
        totalRevenue: Number(row.total_revenue) || 0,
      }));

      // Supabase 0건이지만 localStorage에 데이터가 있으면 localStorage 우선 사용 (데이터 유실 복구)
      if (items.length === 0) {
        const stored = localStorage.getItem(key);
        const local: ForecastItem[] = stored ? JSON.parse(stored) : [];
        if (local.length > 0) {
          console.warn(`⚠️ forecast ${version}: Supabase 0건, localStorage ${local.length}건 → localStorage 사용`);
          return local;
        }
      }

      const total = items.reduce((s, i) => s + i.totalRevenue, 0);
      console.log(`📊 forecast ${version} loaded: ${items.length}개, 총매출: ${(total/1e8).toFixed(1)}억`);
      return items;
    } catch {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveItems(data: ForecastItem[], version: 'current' | 'previous' = 'current'): Promise<void> {
    const key = version === 'current' ? 'dashboard_forecastData' : 'dashboard_forecastData_prev';
    safeSetItem(key, JSON.stringify(data));

    if (!isSupabaseConfigured()) return;

    // Sanitize: filter out rows with null/undefined customer (NOT NULL constraint)
    const validData = data.filter(item => item.customer != null && String(item.customer).trim() !== '');
    if (validData.length < data.length) {
      console.warn(`forecast_data: ${data.length - validData.length} rows filtered (empty customer)`);
    }

    // Safety: do NOT delete existing data if there's nothing valid to insert
    if (validData.length === 0) {
      console.warn(`forecast_data ${version}: 유효 데이터 0건 → Supabase 삭제 건너뜀 (데이터 보호)`);
      return;
    }

    const rows = validData.map(item => ({
      version,
      no: typeof item.no === 'number' ? item.no : 0,
      customer: String(item.customer).trim(),
      model: item.model || '',
      stage: item.stage || '',
      part_no: item.partNo || '',
      new_part_no: item.newPartNo || '',
      type: item.type || '',
      unit_price: Number(item.unitPrice) || 0,
      category: item.category || '',
      part_name: item.partName || '',
      monthly_qty: Array.isArray(item.monthlyQty) ? item.monthlyQty : [],
      total_qty: Math.round(Number(item.totalQty) || 0),
      monthly_revenue: Array.isArray(item.monthlyRevenue) ? item.monthlyRevenue : [],
      total_revenue: Number(item.totalRevenue) || 0,
    }));

    // Delete existing data for this version (only after validating insert data exists)
    const { error: deleteError } = await supabase!
      .from('forecast_data')
      .delete()
      .eq('version', version);

    if (deleteError) {
      console.error('forecast_data delete error:', deleteError);
      // Delete failed — still try to insert (upsert pattern)
    }

    const inputTotal = rows.reduce((s, r) => s + (Number(r.total_revenue) || 0), 0);
    await insertInBatches('forecast_data', rows);

    // Verify: count actual rows in Supabase after insert
    const { count } = await supabase!
      .from('forecast_data')
      .select('*', { count: 'exact', head: true })
      .eq('version', version);
    console.log(`✅ Forecast ${version} items: 입력 ${rows.length}개 → DB ${count}개, 총매출: ${(inputTotal/1e8).toFixed(1)}억`);
  },

  async getSummary(version: 'current' | 'previous' = 'current'): Promise<ForecastSummary | null> {
    if (!isSupabaseConfigured()) {
      const key = version === 'current' ? 'dashboard_forecastData_summary' : 'dashboard_forecastData_prev_summary';
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : null;
    }

    const { data, error } = await supabase!
      .from('forecast_summary')
      .select('*')
      .eq('version', version)
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows found
      console.error('forecast_summary get error:', error);
      return null;
    }

    return data ? {
      reportDate: data.report_date || '',
      year: data.year || 0,
      revision: data.revision || '',
      monthlyQtyTotals: data.monthly_qty_totals || [],
      monthlyRevenueTotals: data.monthly_revenue_totals || [],
      totalQty: data.total_qty || 0,
      totalRevenue: Number(data.total_revenue) || 0,
      prevRevenueTotals: data.prev_revenue_totals || undefined,
      revenueDiff: data.revenue_diff || undefined,
    } : null;
  },

  async saveSummary(data: ForecastSummary | null, version: 'current' | 'previous' = 'current'): Promise<void> {
    const key = version === 'current' ? 'dashboard_forecastData_summary' : 'dashboard_forecastData_prev_summary';
    if (data) {
      safeSetItem(key, JSON.stringify(data));
    } else {
      localStorage.removeItem(key);
    }

    if (!isSupabaseConfigured()) return;

    // null = 의도적 삭제 요청이 아니면 삭제하지 않음
    if (!data) return;

    const row = {
      version,
      report_date: data.reportDate || '',
      year: typeof data.year === 'number' ? data.year : parseInt(String(data.year)) || 0,
      revision: data.revision || '',
      monthly_qty_totals: Array.isArray(data.monthlyQtyTotals) ? data.monthlyQtyTotals : [],
      monthly_revenue_totals: Array.isArray(data.monthlyRevenueTotals) ? data.monthlyRevenueTotals : [],
      total_qty: Math.round(Number(data.totalQty) || 0),
      total_revenue: Number(data.totalRevenue) || 0,
      prev_revenue_totals: Array.isArray(data.prevRevenueTotals) ? data.prevRevenueTotals : null,
      revenue_diff: Array.isArray(data.revenueDiff) ? data.revenueDiff : null,
    };

    // Delete existing summary for this version (only after validating new data)
    const { error: deleteError } = await supabase!
      .from('forecast_summary')
      .delete()
      .eq('version', version);

    if (deleteError) console.error('forecast_summary delete error:', deleteError);

    const { error } = await supabase!
      .from('forecast_summary')
      .insert(row);

    if (error) console.error('forecast_summary insert error:', error, 'row:', JSON.stringify(row).substring(0, 200));
    else console.log(`✅ Forecast ${version} summary saved`);
  },

  async getUploads(): Promise<ForecastUpload[]> {
    if (!isSupabaseConfigured() || isTableMissing('forecast_uploads')) {
      const stored = localStorage.getItem('dashboard_forecastUploads');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase!
      .from('forecast_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      checkTableError(error, 'forecast_uploads');
      return [];
    }

    return data?.map((row: any) => ({
      id: row.upload_id || row.id,
      fileName: row.file_name || '',
      uploadDate: row.upload_date || '',
      reportDate: row.report_date || '',
      revision: row.revision || '',
      year: row.year || 0,
      totalRevenue: Number(row.total_revenue) || 0,
      totalQty: row.total_qty || 0,
      itemCount: row.item_count || 0,
    })) || [];
  },

  async saveUploads(data: ForecastUpload[]): Promise<void> {
    safeSetItem('dashboard_forecastUploads', JSON.stringify(data));

    if (!isSupabaseConfigured()) return;

    // Safety: don't delete if nothing to insert
    if (data.length === 0) return;

    // Delete all and re-insert
    const { error: deleteError } = await supabase!
      .from('forecast_uploads')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) console.error('forecast_uploads delete error:', deleteError);

    const rows = data.map((item, idx) => ({
      upload_id: item.id || `upload_${Date.now()}_${idx}`,
      file_name: item.fileName || '',
      upload_date: item.uploadDate || '',
      report_date: item.reportDate || '',
      revision: item.revision || '',
      year: typeof item.year === 'number' ? item.year : parseInt(String(item.year)) || 0,
      total_revenue: Number(item.totalRevenue) || 0,
      total_qty: Math.round(Number(item.totalQty) || 0),
      item_count: Math.round(Number(item.itemCount) || 0),
    }));

    await insertInBatches('forecast_uploads', rows);
    console.log(`✅ Forecast uploads saved: ${rows.length} records`);
  },

  async deleteUpload(uploadId: string): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const { error } = await supabase!
      .from('forecast_uploads')
      .delete()
      .eq('upload_id', uploadId);

    if (error) console.error('forecast_uploads delete error:', error);
  }
};

// ============================================
// BOM Master Service (BOM 마스터 - 파란색 탭)
// ============================================

export const bomMasterService = {
  async getAll(): Promise<BomMasterRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_bomMasterData');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('bom_master', 'parent_pn');
      const records = data.map((row: any) => ({
        parentPn: row.parent_pn || '',
        childPn: row.child_pn || '',
        level: row.level || 1,
        qty: Number(row.qty) || 1,
        childName: row.child_name || '',
        partType: row.part_type || '',
        supplier: row.supplier || '',
      }));
      if (records.length > 0) {
        console.log(`✅ bom_master 로드: ${records.length}건 (Supabase)`);
        try { safeSetItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { /* ignore */ }
      } else {
        console.warn('⚠️ bom_master Supabase 응답 0건 — localStorage 폴백 시도');
        const stored = localStorage.getItem('dashboard_bomMasterData');
        if (stored) {
          const cached = JSON.parse(stored) as BomMasterRecord[];
          if (cached.length > 0) {
            console.log(`📦 bom_master localStorage 캐시: ${cached.length}건`);
            return cached;
          }
        }
      }
      return records;
    } catch (err) {
      console.error('❌ bom_master 로드 실패:', err);
      const stored = localStorage.getItem('dashboard_bomMasterData');
      if (stored) {
        const cached = JSON.parse(stored) as BomMasterRecord[];
        console.log(`📦 bom_master localStorage 폴백: ${cached.length}건`);
        return cached;
      }
      return [];
    }
  },

  async saveAll(records: BomMasterRecord[]): Promise<void> {
    if (!isSupabaseConfigured() || isTableMissing('bom_master')) {
      try { safeSetItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { /* ignore */ }
      return;
    }

    // 1) Backup user-edited fields (supplier, child_name, part_type, qty)
    interface BomBackup { supplier: string; childName: string; partType: string; qty: number; }
    const backupMap = new Map<string, BomBackup>();
    try {
      const { data: existing } = await supabase!
        .from('bom_master')
        .select('parent_pn, child_pn, supplier, child_name, part_type, qty');
      if (existing) {
        for (const row of existing) {
          const key = `${(row.parent_pn || '').trim().toUpperCase()}|${(row.child_pn || '').trim().toUpperCase()}`;
          backupMap.set(key, {
            supplier: row.supplier || '',
            childName: row.child_name || '',
            partType: row.part_type || '',
            qty: Number(row.qty) || 1,
          });
        }
      }
    } catch (e) { console.warn('bom_master backup failed, proceeding without:', e); }

    // 2) Merge: 엑셀 파서가 빈 값이면 백업 복원
    const mergeStr = (uploaded: string, backed: string) => uploaded && uploaded.trim() ? uploaded : backed;
    const rows = records.map(r => {
      const key = `${r.parentPn.trim().toUpperCase()}|${r.childPn.trim().toUpperCase()}`;
      const bk = backupMap.get(key);
      return {
        parent_pn: r.parentPn,
        child_pn: r.childPn,
        level: r.level,
        qty: r.qty > 0 ? r.qty : (bk?.qty || 1),
        child_name: mergeStr(r.childName, bk?.childName || ''),
        part_type: mergeStr(r.partType, bk?.partType || ''),
        supplier: mergeStr(r.supplier, bk?.supplier || ''),
      };
    });

    // 3) UPSERT
    await insertInBatches('bom_master', rows, 500, 'parent_pn,child_pn');

    // 4) localStorage: 기존 + 업로드 병합
    const localExisting: BomMasterRecord[] = (() => {
      try { const s = localStorage.getItem('dashboard_bomMasterData'); return s ? JSON.parse(s) : []; }
      catch { return []; }
    })();
    const localMap = new Map<string, BomMasterRecord>();
    for (const r of localExisting) {
      const k = `${(r.parentPn || '').trim().toUpperCase()}|${(r.childPn || '').trim().toUpperCase()}`;
      localMap.set(k, r);
    }
    for (const row of rows) {
      const k = `${row.parent_pn.trim().toUpperCase()}|${row.child_pn.trim().toUpperCase()}`;
      localMap.set(k, { parentPn: row.parent_pn, childPn: row.child_pn, level: row.level, qty: row.qty, childName: row.child_name, partType: row.part_type, supplier: row.supplier });
    }
    try { safeSetItem('dashboard_bomMasterData', JSON.stringify([...localMap.values()])); } catch { /* ignore */ }
    console.log(`✅ bom_master upserted: ${rows.length} rows (${backupMap.size} backups)`);
  },

  /** BOM 소요량(qty) 업데이트 */
  async updateQty(parentPn: string, childPn: string, newQty: number): Promise<boolean> {
    if (!isSupabaseConfigured() || isTableMissing('bom_master')) {
      // localStorage fallback
      const stored = localStorage.getItem('dashboard_bomMasterData');
      if (stored) {
        const records = JSON.parse(stored) as Array<{ parentPn: string; childPn: string; qty: number; [k: string]: unknown }>;
        let found = false;
        for (const r of records) {
          if (r.parentPn === parentPn && r.childPn === childPn) {
            r.qty = newQty;
            found = true;
          }
        }
        if (found) {
          try { safeSetItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { /* ignore */ }
          return true;
        }
      }
      return false;
    }

    try {
      const { error } = await supabase!
        .from('bom_master')
        .update({ qty: newQty })
        .eq('parent_pn', parentPn)
        .eq('child_pn', childPn);
      if (error) {
        console.error('bomMasterService.updateQty error:', error);
        return false;
      }
      // localStorage도 동기화
      const stored = localStorage.getItem('dashboard_bomMasterData');
      if (stored) {
        const records = JSON.parse(stored);
        for (const r of records) {
          if (r.parentPn === parentPn && r.childPn === childPn) r.qty = newQty;
        }
        try { safeSetItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { /* ignore */ }
      }
      return true;
    } catch (e) {
      console.error('bomMasterService.updateQty exception:', e);
      return false;
    }
  },

  /** BOM 레코드 필드 업데이트 (childName, partType, supplier, qty 등) */
  async updateRecord(
    parentPn: string,
    childPn: string,
    updates: Partial<{ childName: string; partType: string; supplier: string; qty: number }>,
  ): Promise<boolean> {
    // localStorage 업데이트
    const stored = localStorage.getItem('dashboard_bomMasterData');
    if (stored) {
      const records = JSON.parse(stored) as BomMasterRecord[];
      let found = false;
      const nParent = normalizePn(parentPn);
      const nChild = normalizePn(childPn);
      for (const r of records) {
        if (normalizePn(r.parentPn) === nParent && normalizePn(r.childPn) === nChild) {
          if (updates.childName !== undefined) r.childName = updates.childName;
          if (updates.partType !== undefined) r.partType = updates.partType;
          if (updates.supplier !== undefined) r.supplier = updates.supplier;
          if (updates.qty !== undefined) r.qty = updates.qty;
          found = true;
        }
      }
      if (found) {
        try { safeSetItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { /* ignore */ }
      }
    }

    if (!isSupabaseConfigured() || isTableMissing('bom_master')) return true;

    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.childName !== undefined) dbUpdates.child_name = updates.childName;
      if (updates.partType !== undefined) dbUpdates.part_type = updates.partType;
      if (updates.supplier !== undefined) dbUpdates.supplier = updates.supplier;
      if (updates.qty !== undefined) dbUpdates.qty = updates.qty;

      const { error } = await supabase!
        .from('bom_master')
        .update(dbUpdates)
        .eq('parent_pn', parentPn)
        .eq('child_pn', childPn);
      if (error) {
        console.error('bomMasterService.updateRecord error:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('bomMasterService.updateRecord exception:', e);
      return false;
    }
  },
};

// ============================================
// Product Code Master Service (제품코드)
// ============================================

export const productCodeService = {
  async getAll(): Promise<ProductCodeRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_productCodeMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('product_code_master', 'product_code');
      return data.map((row: any) => ({
        productCode: row.product_code || '',
        customerPn: row.customer_pn || '',
        productName: row.product_name || '',
        customer: row.customer || '',
        model: row.model || '',
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_productCodeMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: ProductCodeRecord[]): Promise<void> {
    try { safeSetItem('dashboard_productCodeMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for productCode, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('product_code_master')) return;

    const rows = records.map(r => ({
      product_code: r.productCode,
      customer_pn: r.customerPn,
      product_name: r.productName,
      customer: r.customer,
      model: r.model,
    }));

    await insertInBatches('product_code_master', rows, 500, 'product_code');
    console.log(`✅ product_code_master saved: ${rows.length} rows`);
  },
};

// ============================================
// Reference Info Master Service (기준정보)
// ============================================

export const referenceInfoService = {
  async getAll(): Promise<ReferenceInfoRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_referenceInfoMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('reference_info_master', 'item_code');
      return data.map((row: any) => ({
        itemCode: row.item_code || '',
        customerPn: row.customer_pn || '',
        itemName: row.item_name || '',
        spec: row.spec || '',
        customerName: row.customer_name || '',
        variety: row.variety || '',
        itemStatus: row.item_status || '',
        itemCategory: row.item_category || '',
        processType: row.process_type || '',
        inspectionType: row.inspection_type || '',
        productGroup: row.product_group || '',
        supplyType: row.supply_type || '',
        supplier: row.supplier || '',
        priorityLine1: row.priority_line_1 || '',
        priorityLine2: row.priority_line_2 || '',
        priorityLine3: row.priority_line_3 || '',
        priorityLine4: row.priority_line_4 || '',
        safetyStock: Number(row.safety_stock) || 0,
        safetyStockDays: Number(row.safety_stock_days) || 0,
        lotQty: Number(row.lot_qty) || 0,
        productionPerHour: Number(row.production_per_hour) || 0,
        defectAllowance: Number(row.defect_allowance) || 0,
        workers: Number(row.workers) || 0,
        processingTime: row.processing_time || '',
        standardCT: Number(row.standard_ct) || 0,
        standardManHours: Number(row.standard_man_hours) || 0,
        qtyPerBox: Number(row.qty_per_box) || 0,
        rawMaterialCode1: row.raw_material_code_1 || '',
        rawMaterialCode2: row.raw_material_code_2 || '',
        rawMaterialCode3: row.raw_material_code_3 || '',
        rawMaterialCode4: row.raw_material_code_4 || '',
        netWeight: Number(row.net_weight) || 0,
        runnerWeight: Number(row.runner_weight) || 0,
        netWeight2: Number(row.net_weight_2) || 0,
        runnerWeight2: Number(row.runner_weight_2) || 0,
        paintQty1: Number(row.paint_qty_1) || 0,
        paintQty2: Number(row.paint_qty_2) || 0,
        paintQty3: Number(row.paint_qty_3) || 0,
        paintQty4: Number(row.paint_qty_4) || 0,
        lossRate: Number(row.loss_rate) || 0,
        cavity: Number(row.cavity) || 1,
        useCavity: Number(row.use_cavity) || 0,
        productSizeType: row.product_size_type || '',
        glossType: row.gloss_type || '',
        useYn: row.use_yn || 'Y',
        paintIntake: Number(row.paint_intake) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_referenceInfoMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: ReferenceInfoRecord[]): Promise<void> {
    if (!isSupabaseConfigured() || isTableMissing('reference_info_master')) {
      try { safeSetItem('dashboard_referenceInfoMaster', JSON.stringify(records)); } catch {}
      return;
    }

    // 1) 수동 입력값 백업 (개취수량·사출근거·공급유형·외주처 등)
    interface RefBackup { paint_intake: number; net_weight: number; runner_weight: number; net_weight_2: number; runner_weight_2: number; cavity: number; loss_rate: number; supply_type: string; supplier: string; paint_qty_1: number; paint_qty_2: number; paint_qty_3: number; paint_qty_4: number; }
    const backupMap = new Map<string, RefBackup>();
    try {
      const { data: allExisting } = await supabase!
        .from('reference_info_master')
        .select('item_code, paint_intake, net_weight, runner_weight, net_weight_2, runner_weight_2, cavity, loss_rate, supply_type, supplier, paint_qty_1, paint_qty_2, paint_qty_3, paint_qty_4');
      for (const row of (allExisting || [])) {
        const key = row.item_code as string;
        if (!key) continue;
        const b: RefBackup = {
          paint_intake: Number(row.paint_intake) || 0,
          net_weight: Number(row.net_weight) || 0,
          runner_weight: Number(row.runner_weight) || 0,
          net_weight_2: Number(row.net_weight_2) || 0,
          runner_weight_2: Number(row.runner_weight_2) || 0,
          cavity: Number(row.cavity) || 0,
          loss_rate: Number(row.loss_rate) || 0,
          supply_type: (row.supply_type as string) || '',
          supplier: (row.supplier as string) || '',
          paint_qty_1: Number(row.paint_qty_1) || 0,
          paint_qty_2: Number(row.paint_qty_2) || 0,
          paint_qty_3: Number(row.paint_qty_3) || 0,
          paint_qty_4: Number(row.paint_qty_4) || 0,
        };
        if (b.paint_intake || b.net_weight || b.runner_weight || b.net_weight_2 || b.runner_weight_2 || b.cavity > 1 || b.loss_rate || b.supply_type || b.supplier) {
          backupMap.set(key, b);
        }
      }
      if (backupMap.size > 0) console.log(`[refInfo] 수동입력값 백업: ${backupMap.size}건`);
    } catch { /* 백업 실패해도 진행 */ }

    // 2) 백업 병합: 업로드 데이터가 0/빈값이면 백업값 복원
    const mergeNum = (uploaded: number, backed: number) => uploaded > 0 ? uploaded : backed;
    const mergeStr = (uploaded: string, backed: string) => uploaded && uploaded.trim() ? uploaded : backed;
    const rows = records.map(r => {
      const bk = backupMap.get(r.itemCode);
      return {
        item_code: r.itemCode,
        customer_pn: r.customerPn,
        item_name: r.itemName,
        spec: r.spec,
        customer_name: r.customerName,
        variety: r.variety,
        item_status: r.itemStatus,
        item_category: r.itemCategory,
        process_type: r.processType,
        inspection_type: r.inspectionType,
        product_group: r.productGroup,
        supply_type: bk ? mergeStr(r.supplyType, bk.supply_type) : r.supplyType,
        supplier: bk ? mergeStr(r.supplier, bk.supplier) : r.supplier,
        priority_line_1: r.priorityLine1,
        priority_line_2: r.priorityLine2,
        priority_line_3: r.priorityLine3,
        priority_line_4: r.priorityLine4,
        safety_stock: r.safetyStock,
        safety_stock_days: r.safetyStockDays,
        lot_qty: r.lotQty,
        production_per_hour: r.productionPerHour,
        defect_allowance: r.defectAllowance,
        workers: r.workers,
        processing_time: r.processingTime,
        standard_ct: r.standardCT,
        standard_man_hours: r.standardManHours,
        qty_per_box: r.qtyPerBox,
        raw_material_code_1: r.rawMaterialCode1,
        raw_material_code_2: r.rawMaterialCode2,
        raw_material_code_3: r.rawMaterialCode3,
        raw_material_code_4: r.rawMaterialCode4,
        net_weight: bk ? mergeNum(r.netWeight, bk.net_weight) : r.netWeight,
        runner_weight: bk ? mergeNum(r.runnerWeight, bk.runner_weight) : r.runnerWeight,
        net_weight_2: bk ? mergeNum(r.netWeight2, bk.net_weight_2) : r.netWeight2,
        runner_weight_2: bk ? mergeNum(r.runnerWeight2, bk.runner_weight_2) : r.runnerWeight2,
        paint_qty_1: bk ? mergeNum(0, bk.paint_qty_1) : 0,
        paint_qty_2: bk ? mergeNum(0, bk.paint_qty_2) : 0,
        paint_qty_3: bk ? mergeNum(0, bk.paint_qty_3) : 0,
        paint_qty_4: bk ? mergeNum(0, bk.paint_qty_4) : 0,
        loss_rate: bk ? mergeNum(r.lossRate, bk.loss_rate) : r.lossRate,
        cavity: bk ? mergeNum(r.cavity, bk.cavity) : r.cavity,
        use_cavity: r.useCavity,
        product_size_type: r.productSizeType,
        gloss_type: r.glossType,
        use_yn: r.useYn,
        paint_intake: bk ? mergeNum(r.paintIntake, bk.paint_intake) : r.paintIntake,
      };
    });

    // 3) UPSERT
    await insertInBatches('reference_info_master', rows, 500, 'item_code');

    // 4) localStorage: 기존 + 업로드 병합
    const localExisting: ReferenceInfoRecord[] = (() => {
      try { const s = localStorage.getItem('dashboard_referenceInfoMaster'); return s ? JSON.parse(s) : []; }
      catch { return []; }
    })();
    const localMap = new Map<string, ReferenceInfoRecord>();
    for (const r of localExisting) localMap.set(r.itemCode, r);
    const mergedRecords = records.map(r => {
      const bk = backupMap.get(r.itemCode);
      if (!bk) return r;
      return {
        ...r,
        paintIntake: mergeNum(r.paintIntake, bk.paint_intake),
        netWeight: mergeNum(r.netWeight, bk.net_weight),
        runnerWeight: mergeNum(r.runnerWeight, bk.runner_weight),
        netWeight2: mergeNum(r.netWeight2, bk.net_weight_2),
        runnerWeight2: mergeNum(r.runnerWeight2, bk.runner_weight_2),
        cavity: mergeNum(r.cavity, bk.cavity),
        lossRate: mergeNum(r.lossRate, bk.loss_rate),
      };
    });
    for (const r of mergedRecords) localMap.set(r.itemCode, r);
    try { safeSetItem('dashboard_referenceInfoMaster', JSON.stringify([...localMap.values()])); } catch {}

    console.log(`✅ reference_info_master upserted: ${rows.length} rows` + (backupMap.size > 0 ? ` (수동입력 ${backupMap.size}건 복원)` : ''));
  },

  /** 개별 레코드의 중량/캐비티/Loss 등 부분 업데이트 */
  async updateFields(itemCode: string, fields: Partial<{
    netWeight: number; runnerWeight: number; cavity: number; lossRate: number;
    netWeight2: number; runnerWeight2: number; paintIntake: number;
    paintQty1: number; paintQty2: number; paintQty3: number; paintQty4: number;
    supplyType: string; supplier: string;
  }>): Promise<boolean> {
    const normCode = itemCode.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');
    // localStorage 업데이트
    const stored = localStorage.getItem('dashboard_referenceInfoMaster');
    if (stored) {
      const records: ReferenceInfoRecord[] = JSON.parse(stored);
      const idx = records.findIndex(r =>
        r.itemCode.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode
      );
      if (idx >= 0) {
        Object.assign(records[idx], fields);
        try { safeSetItem('dashboard_referenceInfoMaster', JSON.stringify(records)); } catch {}
      }
    }

    if (!isSupabaseConfigured() || isTableMissing('reference_info_master')) return true;

    const dbFields: Record<string, number | string> = {};
    if (fields.netWeight !== undefined) dbFields.net_weight = fields.netWeight;
    if (fields.runnerWeight !== undefined) dbFields.runner_weight = fields.runnerWeight;
    if (fields.cavity !== undefined) dbFields.cavity = fields.cavity;
    if (fields.lossRate !== undefined) dbFields.loss_rate = fields.lossRate;
    if (fields.netWeight2 !== undefined) dbFields.net_weight_2 = fields.netWeight2;
    if (fields.runnerWeight2 !== undefined) dbFields.runner_weight_2 = fields.runnerWeight2;
    if (fields.paintIntake !== undefined) dbFields.paint_intake = fields.paintIntake;
    if (fields.paintQty1 !== undefined) dbFields.paint_qty_1 = fields.paintQty1;
    if (fields.paintQty2 !== undefined) dbFields.paint_qty_2 = fields.paintQty2;
    if (fields.paintQty3 !== undefined) dbFields.paint_qty_3 = fields.paintQty3;
    if (fields.paintQty4 !== undefined) dbFields.paint_qty_4 = fields.paintQty4;
    if (fields.supplyType !== undefined) dbFields.supply_type = fields.supplyType;
    if (fields.supplier !== undefined) dbFields.supplier = fields.supplier;

    try {
      // exact match 시도
      let { data } = await supabase!
        .from('reference_info_master')
        .select('item_code')
        .eq('item_code', itemCode)
        .limit(1);
      // 정규화 비교 fallback (item_code → customer_pn 순)
      let actualItemCode = itemCode;
      if (!data || data.length === 0) {
        // customer_pn으로 시도 (BOM 품번이 customer_pn인 경우)
        const { data: custMatch } = await supabase!
          .from('reference_info_master')
          .select('item_code')
          .eq('customer_pn', itemCode)
          .limit(1);
        if (custMatch && custMatch.length > 0) {
          actualItemCode = custMatch[0].item_code;
        } else {
          // 전체 정규화 비교 fallback
          const { data: all } = await supabase!
            .from('reference_info_master')
            .select('item_code, customer_pn');
          const match = all?.find(r =>
            r.item_code.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode ||
            (r.customer_pn && r.customer_pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode)
          );
          if (match) actualItemCode = match.item_code;
        }
      } else {
        actualItemCode = data[0].item_code;
      }

      const { error } = await supabase!
        .from('reference_info_master')
        .update(dbFields)
        .eq('item_code', actualItemCode);
      if (error) { console.error('기준정보 업데이트 실패:', error.message); return false; }
      console.log(`✅ 기준정보 업데이트: ${actualItemCode}`, dbFields);
      return true;
    } catch (err) { console.error('기준정보 업데이트 오류:', err); return false; }
  },

  /** 품목정보 업로드 데이터 → reference_info_master 중량 필드 벌크 동기화 */
  async syncWeightFromProductInfo(items: import('../utils/standardMaterialParser').ProductInfoItem[]): Promise<number> {
    if (!isSupabaseConfigured() || isTableMissing('reference_info_master')) return 0;
    let count = 0;
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map(async (item) => {
        if (!item.itemCode) return false;
        const fields: Record<string, number | string> = {
          net_weight: item.netWeight,
          runner_weight: item.runnerWeight,
          net_weight_2: item.netWeight2 ?? 0,
          runner_weight_2: item.runnerWeight2 ?? 0,
          cavity: item.cavity || 1,
          use_cavity: item.useCavity ?? 0,
          loss_rate: item.lossRate,
          paint_qty_1: item.paintQty1,
          paint_qty_2: item.paintQty2,
          paint_qty_3: item.paintQty3,
          paint_qty_4: item.paintQty4,
        };
        if (item.processType) fields.process_type = item.processType;
        if (item.supplyType) fields.supply_type = item.supplyType;
        const { error } = await supabase!
          .from('reference_info_master')
          .update(fields)
          .eq('item_code', item.itemCode);
        return !error;
      });
      const results = await Promise.all(promises);
      count += results.filter(Boolean).length;
    }
    console.log(`✅ reference_info_master 중량 동기화: ${count}/${items.length}건`);
    return count;
  },

  /** localStorage에 저장된 개취수량(paintIntake) 값을 Supabase로 복구 */
  async recoverPaintIntakeFromLocal(): Promise<number> {
    if (!isSupabaseConfigured() || isTableMissing('reference_info_master')) return 0;
    try {
      const stored = localStorage.getItem('dashboard_referenceInfoMaster');
      if (!stored) return 0;
      const local: ReferenceInfoRecord[] = JSON.parse(stored);
      const toRecover = local.filter(r => (r.paintIntake || 0) > 0);
      if (toRecover.length === 0) return 0;

      console.log(`[recoverPaintIntake] localStorage에서 paintIntake > 0 항목 ${toRecover.length}건 발견`);

      let recovered = 0;
      const BATCH = 50;
      for (let i = 0; i < toRecover.length; i += BATCH) {
        const batch = toRecover.slice(i, i + BATCH);
        for (const r of batch) {
          const { error } = await supabase!
            .from('reference_info_master')
            .update({ paint_intake: r.paintIntake })
            .eq('item_code', r.itemCode);
          if (!error) recovered++;
        }
      }
      console.log(`✅ [recoverPaintIntake] Supabase 복구 완료: ${recovered}/${toRecover.length}건`);
      return recovered;
    } catch (err) {
      console.error('[recoverPaintIntake] 복구 실패:', err);
      return 0;
    }
  },
};

// ============================================
// Equipment Master Service (설비코드)
// ============================================

export const equipmentService = {
  async getAll(): Promise<EquipmentRecord[]> {
    if (!isSupabaseConfigured() || isTableMissing('equipment_master')) {
      const stored = localStorage.getItem('dashboard_equipmentMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('equipment_master', 'equipment_code');
      return data.map((row: any) => ({
        equipmentCode: row.equipment_code || '',
        equipmentName: row.equipment_name || '',
        site: row.site || '',
        industry: row.industry || '',
        variety: row.variety || '',
        line: row.line || '',
        directIndirect: row.direct_indirect || '',
        tonnage: row.tonnage || '',
        dailyHours: Number(row.daily_hours) || 0,
        dailyMinutes: Number(row.daily_minutes) || 0,
        dailySeconds: Number(row.daily_seconds) || 0,
        managementNo: row.management_no || '',
        equipmentNo: row.equipment_no || '',
        useYn: row.use_yn || 'Y',
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_equipmentMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: EquipmentRecord[]): Promise<void> {
    try { safeSetItem('dashboard_equipmentMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for equipment, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('equipment_master')) return;

    const rows = records.map(r => ({
      equipment_code: r.equipmentCode,
      equipment_name: r.equipmentName,
      site: r.site,
      industry: r.industry,
      variety: r.variety,
      line: r.line,
      direct_indirect: r.directIndirect,
      tonnage: r.tonnage,
      daily_hours: r.dailyHours,
      daily_minutes: r.dailyMinutes,
      daily_seconds: r.dailySeconds,
      management_no: r.managementNo,
      equipment_no: r.equipmentNo,
      use_yn: r.useYn,
    }));

    await insertInBatches('equipment_master', rows, 500, 'equipment_code');
    console.log(`✅ equipment_master saved: ${rows.length} rows`);
  },
};

// ============================================
// Material Code Master Service (재질코드)
// ============================================

export const materialCodeService = {
  async getAll(): Promise<MaterialCodeRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_materialCodeMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('material_code_master', 'material_code');
      return data.map((row: any) => ({
        industryCode: row.industry_code || '',
        materialType: row.material_type || '',
        materialCode: row.material_code || '',
        materialName: row.material_name || '',
        materialCategory: row.material_category || '',
        paintCategory: row.paint_category || '',
        color: row.color || '',
        unit: row.unit || '',
        safetyStock: Number(row.safety_stock) || 0,
        dailyAvgUsage: Number(row.daily_avg_usage) || 0,
        lossRate: Number(row.loss_rate) || 0,
        validDays: Number(row.valid_days) || 0,
        orderSize: row.order_size || '',
        useYn: row.use_yn || 'Y',
        protectedItem: row.protected_item || '',
        currentPrice: Number(row.current_price) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_materialCodeMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: MaterialCodeRecord[]): Promise<void> {
    if (!isSupabaseConfigured() || isTableMissing('material_code_master')) {
      try { safeSetItem('dashboard_materialCodeMaster', JSON.stringify(records)); } catch {}
      return;
    }

    // 1) 수동 입력 단가 백업
    const priceBackup = new Map<string, number>();
    try {
      const { data: existing } = await supabase!
        .from('material_code_master')
        .select('material_code, current_price')
        .gt('current_price', 0);
      if (existing) {
        for (const row of existing) {
          if (row.material_code && row.current_price > 0) {
            priceBackup.set(row.material_code, Number(row.current_price));
          }
        }
      }
      if (priceBackup.size > 0) console.log(`[matCode] 단가 백업: ${priceBackup.size}건`);
    } catch { /* 백업 실패해도 진행 */ }

    // 2) Merge + UPSERT
    const rows = records.map(r => {
      const savedPrice = priceBackup.get(r.materialCode) || 0;
      return {
        industry_code: r.industryCode,
        material_type: r.materialType,
        material_code: r.materialCode,
        material_name: r.materialName,
        material_category: r.materialCategory,
        paint_category: r.paintCategory,
        color: r.color,
        unit: r.unit,
        safety_stock: r.safetyStock,
        daily_avg_usage: r.dailyAvgUsage,
        loss_rate: r.lossRate,
        valid_days: r.validDays,
        order_size: r.orderSize,
        use_yn: r.useYn,
        protected_item: r.protectedItem,
        current_price: r.currentPrice > 0 ? r.currentPrice : savedPrice,
      };
    });

    await insertInBatches('material_code_master', rows, 500, 'material_code');

    // 3) localStorage: 기존 + 업로드 병합
    const localExisting: MaterialCodeRecord[] = (() => {
      try { const s = localStorage.getItem('dashboard_materialCodeMaster'); return s ? JSON.parse(s) : []; }
      catch { return []; }
    })();
    const localMap = new Map<string, MaterialCodeRecord>();
    for (const r of localExisting) localMap.set(r.materialCode, r);
    const mergedRecords = records.map(r => ({
      ...r,
      currentPrice: r.currentPrice > 0 ? r.currentPrice : (priceBackup.get(r.materialCode) || 0),
    }));
    for (const r of mergedRecords) localMap.set(r.materialCode, r);
    try { safeSetItem('dashboard_materialCodeMaster', JSON.stringify([...localMap.values()])); } catch {}

    console.log(`✅ material_code_master upserted: ${rows.length} rows` + (priceBackup.size > 0 ? ` (단가 ${priceBackup.size}건 복원)` : ''));
  },

  /** 개별 재질코드의 current_price만 업데이트 */
  async updatePrice(materialCode: string, newPrice: number): Promise<boolean> {
    if (!isSupabaseConfigured() || isTableMissing('material_code_master')) {
      // localStorage fallback
      const stored = localStorage.getItem('dashboard_materialCodeMaster');
      if (stored) {
        const records: MaterialCodeRecord[] = JSON.parse(stored);
        const idx = records.findIndex(r => r.materialCode.trim().toUpperCase() === materialCode.trim().toUpperCase());
        if (idx >= 0) {
          records[idx].currentPrice = newPrice;
          try { safeSetItem('dashboard_materialCodeMaster', JSON.stringify(records)); } catch { /* ignore */ }
          return true;
        }
      }
      return false;
    }

    try {
      const { error } = await supabase!
        .from('material_code_master')
        .update({ current_price: newPrice })
        .eq('material_code', materialCode);
      if (error) {
        console.error('재질단가 업데이트 실패:', error.message);
        return false;
      }
      console.log(`✅ 재질단가 업데이트: ${materialCode} → ₩${newPrice}`);
      return true;
    } catch (err) {
      console.error('재질단가 업데이트 오류:', err);
      return false;
    }
  },

  /** 재질단가 데이터로 material_code_master 단가 일괄 갱신 (기존 레코드 upsert) */
  async updatePrices(prices: MaterialPrice[]): Promise<{ updated: number; inserted: number }> {
    let updated = 0;
    let inserted = 0;

    if (!isSupabaseConfigured() || isTableMissing('material_code_master')) {
      // localStorage fallback
      const stored = localStorage.getItem('dashboard_materialCodeMaster');
      const records: MaterialCodeRecord[] = stored ? JSON.parse(stored) : [];
      const codeMap = new Map(records.map((r, i) => [r.materialCode.trim().toUpperCase(), i]));
      for (const p of prices) {
        if (!p.materialCode || p.currentPrice <= 0) continue;
        const key = p.materialCode.trim().toUpperCase();
        const idx = codeMap.get(key);
        if (idx !== undefined) {
          records[idx].currentPrice = p.currentPrice;
          updated++;
        } else {
          records.push({
            industryCode: '', materialType: p.materialType || '', materialCode: p.materialCode,
            materialName: p.materialName || '', materialCategory: '', paintCategory: '',
            color: '', unit: '', safetyStock: 0, dailyAvgUsage: 0, lossRate: 0,
            validDays: 0, orderSize: '', useYn: 'Y', protectedItem: '',
            currentPrice: p.currentPrice,
          });
          inserted++;
        }
      }
      try { safeSetItem('dashboard_materialCodeMaster', JSON.stringify(records)); } catch { /* */ }
      return { updated, inserted };
    }

    // Supabase: batch upsert using upsert on material_code
    const rows = prices
      .filter(p => p.materialCode && p.currentPrice > 0)
      .map(p => ({
        material_code: p.materialCode,
        material_name: p.materialName || '',
        material_type: p.materialType || '',
        current_price: p.currentPrice,
        price_source: 'material_price_file',
        price_updated_at: new Date().toISOString(),
      }));

    // Update existing records' prices
    for (const row of rows) {
      const { data, error } = await supabase!
        .from('material_code_master')
        .update({ current_price: row.current_price, price_source: row.price_source, price_updated_at: row.price_updated_at })
        .eq('material_code', row.material_code)
        .select('material_code');
      if (!error && data && data.length > 0) {
        updated++;
      } else if (!error && (!data || data.length === 0)) {
        // Record doesn't exist - insert new
        const { error: insErr } = await supabase!
          .from('material_code_master')
          .insert({
            material_code: row.material_code,
            material_name: row.material_name,
            material_type: row.material_type,
            current_price: row.current_price,
            price_source: row.price_source,
            price_updated_at: row.price_updated_at,
            use_yn: 'Y',
          });
        if (!insErr) inserted++;
      }
    }

    console.log(`✅ material_code_master 단가 갱신: ${updated}건 업데이트, ${inserted}건 신규`);
    return { updated, inserted };
  },
};

// ============================================
// Data Quality Issues Service (데이터 품질)
// ============================================

export const dataQualityService = {
  async getAll(): Promise<DataQualityIssue[]> {
    if (!isSupabaseConfigured() || isTableMissing('data_quality_issues')) {
      const stored = localStorage.getItem('dashboard_dataQualityIssues');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('data_quality_issues', 'issue_type');
      return data.map((row: any) => ({
        issueType: row.issue_type || '',
        itemCode: row.item_code || '',
        itemName: row.item_name || '',
        fieldName: row.field_name || '',
        severity: row.severity || 'warning',
        description: row.description || '',
        resolved: row.resolved || false,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_dataQualityIssues');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(issues: DataQualityIssue[]): Promise<void> {
    try { safeSetItem('dashboard_dataQualityIssues', JSON.stringify(issues)); } catch { console.warn('localStorage quota exceeded for dataQuality, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('data_quality_issues')) return;

    const { error: deleteError } = await supabase!
      .from('data_quality_issues')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError && checkTableError(deleteError, 'data_quality_issues')) return;

    const rows = issues.map(i => ({
      issue_type: i.issueType,
      item_code: i.itemCode,
      item_name: i.itemName,
      field_name: i.fieldName,
      severity: i.severity,
      description: i.description,
      resolved: i.resolved,
    }));

    await insertInBatches('data_quality_issues', rows);
    console.log(`✅ data_quality_issues saved: ${rows.length} rows`);
  },
};

// ============================================
// Purchase Price Master Service (구매단가)
// ============================================

export const purchasePriceService = {
  async getAll(): Promise<PurchasePrice[]> {
    if (!isSupabaseConfigured() || isTableMissing('purchase_price_master')) {
      const stored = localStorage.getItem('dashboard_purchasePriceMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('purchase_price_master', 'item_code');
      return data.map((row: any) => ({
        itemCode: row.item_code || '',
        customerPn: row.customer_pn || '',
        itemName: row.item_name || '',
        supplier: row.supplier || '',
        currentPrice: Number(row.current_price) || 0,
        previousPrice: Number(row.previous_price) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_purchasePriceMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: PurchasePrice[]): Promise<void> {
    if (!isSupabaseConfigured() || isTableMissing('purchase_price_master')) {
      try { safeSetItem('dashboard_purchasePriceMaster', JSON.stringify(records)); } catch {}
      return;
    }

    // 1) 수동 입력 단가 백업
    const priceBackup = new Map<string, { current: number; previous: number }>();
    try {
      const { data: existing } = await supabase!
        .from('purchase_price_master')
        .select('item_code, current_price, previous_price')
        .gt('current_price', 0);
      if (existing) {
        for (const row of existing) {
          if (row.item_code) {
            priceBackup.set(row.item_code, {
              current: Number(row.current_price) || 0,
              previous: Number(row.previous_price) || 0,
            });
          }
        }
      }
      if (priceBackup.size > 0) console.log(`[purchasePrice] 단가 백업: ${priceBackup.size}건`);
    } catch { /* 백업 실패해도 진행 */ }

    // 2) Merge + UPSERT
    const rows = records.map(r => {
      const bk = priceBackup.get(r.itemCode);
      return {
        item_code: r.itemCode,
        customer_pn: r.customerPn,
        item_name: r.itemName,
        supplier: r.supplier,
        current_price: r.currentPrice > 0 ? r.currentPrice : (bk?.current || 0),
        previous_price: r.previousPrice > 0 ? r.previousPrice : (bk?.previous || 0),
      };
    });

    await insertInBatches('purchase_price_master', rows, 500, 'item_code,supplier');

    // 3) localStorage: 기존 + 업로드 병합
    const localExisting: PurchasePrice[] = (() => {
      try { const s = localStorage.getItem('dashboard_purchasePriceMaster'); return s ? JSON.parse(s) : []; }
      catch { return []; }
    })();
    const localMap = new Map<string, PurchasePrice>();
    for (const r of localExisting) localMap.set(`${r.itemCode}|${r.supplier}`, r);
    const mergedRecords = records.map(r => {
      const bk = priceBackup.get(r.itemCode);
      return {
        ...r,
        currentPrice: r.currentPrice > 0 ? r.currentPrice : (bk?.current || 0),
        previousPrice: r.previousPrice > 0 ? r.previousPrice : (bk?.previous || 0),
      };
    });
    for (const r of mergedRecords) localMap.set(`${r.itemCode}|${r.supplier}`, r);
    try { safeSetItem('dashboard_purchasePriceMaster', JSON.stringify([...localMap.values()])); } catch {}

    console.log(`✅ purchase_price_master upserted: ${rows.length} rows` + (priceBackup.size > 0 ? ` (단가 ${priceBackup.size}건 복원)` : ''));
  },

  /** 개별 구매단가 업데이트 (item_code 기준) */
  async updatePrice(itemCode: string, newPrice: number): Promise<boolean> {
    if (!isSupabaseConfigured() || isTableMissing('purchase_price_master')) {
      const stored = localStorage.getItem('dashboard_purchasePriceMaster');
      if (stored) {
        const records: PurchasePrice[] = JSON.parse(stored);
        const idx = records.findIndex(r => r.itemCode.trim().toUpperCase() === itemCode.trim().toUpperCase());
        if (idx >= 0) {
          records[idx].previousPrice = records[idx].currentPrice;
          records[idx].currentPrice = newPrice;
          try { safeSetItem('dashboard_purchasePriceMaster', JSON.stringify(records)); } catch { /* ignore */ }
          return true;
        }
      }
      return false;
    }
    try {
      const { error } = await supabase!
        .from('purchase_price_master')
        .update({ current_price: newPrice })
        .eq('item_code', itemCode);
      if (error) {
        console.error('구매단가 업데이트 실패:', error.message);
        return false;
      }
      console.log(`✅ 구매단가 업데이트: ${itemCode} → ₩${newPrice}`);
      return true;
    } catch (err) {
      console.error('구매단가 업데이트 오류:', err);
      return false;
    }
  },
};

// ============================================
// Paint Mix Ratio Master Service (도료배합비율)
// ============================================

export const paintMixRatioService = {
  async getAll(): Promise<PaintMixRatio[]> {
    if (!isSupabaseConfigured() || isTableMissing('paint_mix_ratio_master')) {
      const stored = localStorage.getItem('dashboard_paintMixRatioMaster');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('paint_mix_ratio_master', 'paint_code');
      return data.map((row: any) => ({
        paintCode: row.paint_code || '',
        paintName: row.paint_name || '',
        mainRatio: Number(row.main_ratio) || 100,
        hardenerRatio: Number(row.hardener_ratio) || 0,
        thinnerRatio: Number(row.thinner_ratio) || 0,
        mainCode: row.main_code || '',
        hardenerCode: row.hardener_code || '',
        thinnerCode: row.thinner_code || '',
        mainPrice: Number(row.main_price) || 0,
        hardenerPrice: Number(row.hardener_price) || 0,
        thinnerPrice: Number(row.thinner_price) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_paintMixRatioMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: PaintMixRatio[]): Promise<void> {
    try { safeSetItem('dashboard_paintMixRatioMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for paintMixRatio, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('paint_mix_ratio_master')) return;

    const rows = records.map(r => ({
      paint_code: r.paintCode,
      paint_name: r.paintName,
      main_ratio: r.mainRatio,
      hardener_ratio: r.hardenerRatio,
      thinner_ratio: r.thinnerRatio,
      main_code: r.mainCode,
      hardener_code: r.hardenerCode,
      thinner_code: r.thinnerCode,
      main_price: r.mainPrice,
      hardener_price: r.hardenerPrice,
      thinner_price: r.thinnerPrice,
    }));

    await insertInBatches('paint_mix_ratio_master', rows, 500, 'paint_code');
    console.log(`✅ paint_mix_ratio_master saved: ${rows.length} rows`);
  },
};

// ============================================
// Outsource Injection Price Service (외주사출판매가)
// ============================================

export const outsourceInjPriceService = {
  async getAll(): Promise<OutsourcePrice[]> {
    if (!isSupabaseConfigured() || isTableMissing('outsource_injection_price')) {
      const stored = localStorage.getItem('dashboard_outsourceInjPrice');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('outsource_injection_price', 'item_code');
      return data.map((row: any) => ({
        itemCode: row.item_code || '',
        customerPn: row.customer_pn || '',
        itemName: row.item_name || '',
        supplier: row.supplier || '',
        injectionPrice: Number(row.injection_price) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_outsourceInjPrice');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: OutsourcePrice[]): Promise<void> {
    try { safeSetItem('dashboard_outsourceInjPrice', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for outsourceInjPrice, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('outsource_injection_price')) return;

    const rows = records.map(r => ({
      item_code: r.itemCode,
      customer_pn: r.customerPn,
      item_name: r.itemName,
      supplier: r.supplier,
      injection_price: r.injectionPrice,
    }));

    await insertInBatches('outsource_injection_price', rows, 500, 'item_code,supplier');
    console.log(`✅ outsource_injection_price saved: ${rows.length} rows`);
  },
};

// ── paint_mix_log (배합일지) ──
export const paintMixLogService = {
  async getAll(): Promise<PaintMixLog[]> {
    if (!isSupabaseConfigured() || isTableMissing('paint_mix_log')) {
      const stored = localStorage.getItem('dashboard_paintMixLog');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('paint_mix_log', 'mix_date');
      return data.map((row: any) => ({
        mixNo: row.mix_no || '',
        mixDate: row.mix_date || '',
        paintCode: row.paint_code || '',
        paintName: row.paint_name || '',
        mainQty: Number(row.main_qty) || 0,
        mainRatio: Number(row.main_ratio) || 0,
        hardenerQty: Number(row.hardener_qty) || 0,
        hardenerRatio: Number(row.hardener_ratio) || 0,
        thinnerQty: Number(row.thinner_qty) || 0,
        thinnerRatio: Number(row.thinner_ratio) || 0,
        totalQty: Number(row.total_qty) || 0,
        wasteQty: Number(row.waste_qty) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_paintMixLog');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: PaintMixLog[]): Promise<void> {
    try { safeSetItem('dashboard_paintMixLog', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for paintMixLog, skipping local cache'); }
    if (!isSupabaseConfigured() || isTableMissing('paint_mix_log')) return;

    const rows = records.map(r => ({
      mix_no: r.mixNo,
      mix_date: r.mixDate,
      paint_code: r.paintCode,
      paint_name: r.paintName,
      main_qty: r.mainQty,
      main_ratio: r.mainRatio,
      hardener_qty: r.hardenerQty,
      hardener_ratio: r.hardenerRatio,
      thinner_qty: r.thinnerQty,
      thinner_ratio: r.thinnerRatio,
      total_qty: r.totalQty,
      waste_qty: r.wasteQty,
    }));

    await insertInBatches('paint_mix_log', rows, 500, 'mix_no');
    console.log(`✅ paint_mix_log saved: ${rows.length} rows`);
  },
};

// ── item_standard_cost (품목별 표준원가) ──
export const itemStandardCostService = {
  async getAll(): Promise<ItemStandardCost[]> {
    if (!isSupabaseConfigured() || isTableMissing('item_standard_cost')) {
      const stored = localStorage.getItem('dashboard_itemStandardCost');
      return stored ? JSON.parse(stored) : [];
    }

    try {
      const data = await fetchAllRows('item_standard_cost', 'item_code');
      return data as ItemStandardCost[];
    } catch {
      const stored = localStorage.getItem('dashboard_itemStandardCost');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: ItemStandardCost[]): Promise<void> {
    // Skip localStorage for large datasets
    if (!isSupabaseConfigured() || isTableMissing('item_standard_cost')) return;

    await insertInBatches('item_standard_cost', records, 500, 'item_code');
    console.log(`✅ item_standard_cost saved: ${records.length} rows`);
  },

  /** 개별 품목의 resin_cost_per_ea (사출재료비) 업데이트 (UPSERT: 없으면 INSERT) */
  async updateResinCost(itemCode: string, resinCost: number): Promise<boolean> {
    const normCode = itemCode.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

    // localStorage도 항상 동시 업데이트 (즉시 반영용)
    try {
      const stored = localStorage.getItem('dashboard_itemStandardCost');
      if (stored) {
        const records: ItemStandardCost[] = JSON.parse(stored);
        const idx = records.findIndex(r =>
          r.item_code.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode
        );
        if (idx >= 0) {
          records[idx].resin_cost_per_ea = resinCost;
          records[idx].material_cost_per_ea = resinCost + records[idx].paint_cost_per_ea;
          safeSetItem('dashboard_itemStandardCost', JSON.stringify(records));
        } else {
          // localStorage에도 신규 레코드 추가
          const newRec: ItemStandardCost = {
            item_code: itemCode, customer_pn: '', item_name: '', customer_name: '',
            variety: '', item_type: '', supply_type: '',
            resin_cost_per_ea: resinCost, paint_cost_per_ea: 0, material_cost_per_ea: resinCost,
            purchase_price_per_ea: 0, injection_price_per_ea: 0,
            jan_qty: 0, feb_qty: 0, mar_qty: 0, apr_qty: 0, may_qty: 0, jun_qty: 0,
            jul_qty: 0, aug_qty: 0, sep_qty: 0, oct_qty: 0, nov_qty: 0, dec_qty: 0,
            jan_amt: 0, feb_amt: 0, mar_amt: 0, apr_amt: 0, may_amt: 0, jun_amt: 0,
            jul_amt: 0, aug_amt: 0, sep_amt: 0, oct_amt: 0, nov_amt: 0, dec_amt: 0,
            total_qty: 0, total_amt: 0,
          };
          records.push(newRec);
          safeSetItem('dashboard_itemStandardCost', JSON.stringify(records));
        }
      }
    } catch { /* localStorage 실패는 무시 */ }

    if (!isSupabaseConfigured() || isTableMissing('item_standard_cost')) return true;

    try {
      // exact match 시도
      let { data } = await supabase!
        .from('item_standard_cost')
        .select('item_code, paint_cost_per_ea')
        .eq('item_code', itemCode)
        .limit(1);
      // exact match 실패 → 정규화 비교
      if (!data || data.length === 0) {
        const { data: all } = await supabase!
          .from('item_standard_cost')
          .select('item_code, paint_cost_per_ea');
        const match = all?.find(r =>
          r.item_code.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode
        );
        if (match) data = [match];
      }

      if (data && data.length > 0) {
        // 기존 레코드 UPDATE
        const record = data[0];
        const paintCost = record.paint_cost_per_ea || 0;
        const materialCost = resinCost + paintCost;
        const { error } = await supabase!
          .from('item_standard_cost')
          .update({ resin_cost_per_ea: resinCost, material_cost_per_ea: materialCost })
          .eq('item_code', record.item_code);
        if (error) { console.error('표준재료비 업데이트 실패:', error.message); return false; }
        console.log(`✅ 표준재료비 UPDATE: ${record.item_code} → ₩${Math.round(resinCost)}`);
      } else {
        // 레코드 없음 → INSERT 신규 생성
        const { error } = await supabase!
          .from('item_standard_cost')
          .insert({
            item_code: itemCode, customer_pn: '', item_name: '', customer_name: '',
            variety: '', item_type: '', supply_type: '',
            resin_cost_per_ea: resinCost, paint_cost_per_ea: 0, material_cost_per_ea: resinCost,
            purchase_price_per_ea: 0, injection_price_per_ea: 0,
            jan_qty: 0, feb_qty: 0, mar_qty: 0, apr_qty: 0, may_qty: 0, jun_qty: 0,
            jul_qty: 0, aug_qty: 0, sep_qty: 0, oct_qty: 0, nov_qty: 0, dec_qty: 0,
            jan_amt: 0, feb_amt: 0, mar_amt: 0, apr_amt: 0, may_amt: 0, jun_amt: 0,
            jul_amt: 0, aug_amt: 0, sep_amt: 0, oct_amt: 0, nov_amt: 0, dec_amt: 0,
            total_qty: 0, total_amt: 0,
          });
        if (error) { console.error('표준재료비 INSERT 실패:', error.message); return false; }
        console.log(`✅ 표준재료비 INSERT: ${itemCode} → ₩${Math.round(resinCost)}`);
      }
      return true;
    } catch (err) { console.error('표준재료비 업데이트 오류:', err); return false; }
  },

  /** BOM 전개 소계를 material_cost_per_ea로 직접 저장 (resin/paint 분리 없이 전체 재료비 덮어쓰기) */
  async updateMaterialCostPerEa(itemCode: string, materialCost: number): Promise<boolean> {
    const normCode = itemCode.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

    // localStorage 동시 업데이트 (즉시 반영용)
    try {
      const stored = localStorage.getItem('dashboard_itemStandardCost');
      if (stored) {
        const records: ItemStandardCost[] = JSON.parse(stored);
        const idx = records.findIndex(r =>
          r.item_code.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode
        );
        if (idx >= 0) {
          records[idx].material_cost_per_ea = materialCost;
          safeSetItem('dashboard_itemStandardCost', JSON.stringify(records));
        } else {
          const newRec: ItemStandardCost = {
            item_code: itemCode, customer_pn: '', item_name: '', customer_name: '',
            variety: '', item_type: '', supply_type: '',
            resin_cost_per_ea: 0, paint_cost_per_ea: 0, material_cost_per_ea: materialCost,
            purchase_price_per_ea: 0, injection_price_per_ea: 0,
            jan_qty: 0, feb_qty: 0, mar_qty: 0, apr_qty: 0, may_qty: 0, jun_qty: 0,
            jul_qty: 0, aug_qty: 0, sep_qty: 0, oct_qty: 0, nov_qty: 0, dec_qty: 0,
            jan_amt: 0, feb_amt: 0, mar_amt: 0, apr_amt: 0, may_amt: 0, jun_amt: 0,
            jul_amt: 0, aug_amt: 0, sep_amt: 0, oct_amt: 0, nov_amt: 0, dec_amt: 0,
            total_qty: 0, total_amt: 0,
          };
          records.push(newRec);
          safeSetItem('dashboard_itemStandardCost', JSON.stringify(records));
        }
      }
    } catch { /* localStorage 실패는 무시 */ }

    if (!isSupabaseConfigured() || isTableMissing('item_standard_cost')) return true;

    try {
      // exact match 시도
      let { data } = await supabase!
        .from('item_standard_cost')
        .select('item_code')
        .eq('item_code', itemCode)
        .limit(1);
      // exact match 실패 → 정규화 비교
      if (!data || data.length === 0) {
        const { data: all } = await supabase!
          .from('item_standard_cost')
          .select('item_code');
        const match = all?.find(r =>
          r.item_code.trim().toUpperCase().replace(/[\s\-_\.]+/g, '') === normCode
        );
        if (match) data = [match];
      }

      if (data && data.length > 0) {
        const record = data[0];
        const { error } = await supabase!
          .from('item_standard_cost')
          .update({ material_cost_per_ea: materialCost })
          .eq('item_code', record.item_code);
        if (error) { console.error('표준재료비(전체) 업데이트 실패:', error.message); return false; }
        console.log(`✅ 표준재료비(전체) UPDATE: ${record.item_code} → ₩${Math.round(materialCost)}`);
      } else {
        const { error } = await supabase!
          .from('item_standard_cost')
          .insert({
            item_code: itemCode, customer_pn: '', item_name: '', customer_name: '',
            variety: '', item_type: '', supply_type: '',
            resin_cost_per_ea: 0, paint_cost_per_ea: 0, material_cost_per_ea: materialCost,
            purchase_price_per_ea: 0, injection_price_per_ea: 0,
            jan_qty: 0, feb_qty: 0, mar_qty: 0, apr_qty: 0, may_qty: 0, jun_qty: 0,
            jul_qty: 0, aug_qty: 0, sep_qty: 0, oct_qty: 0, nov_qty: 0, dec_qty: 0,
            jan_amt: 0, feb_amt: 0, mar_amt: 0, apr_amt: 0, may_amt: 0, jun_amt: 0,
            jul_amt: 0, aug_amt: 0, sep_amt: 0, oct_amt: 0, nov_amt: 0, dec_amt: 0,
            total_qty: 0, total_amt: 0,
          });
        if (error) { console.error('표준재료비(전체) INSERT 실패:', error.message); return false; }
        console.log(`✅ 표준재료비(전체) INSERT: ${itemCode} → ₩${Math.round(materialCost)}`);
      }
      return true;
    } catch (err) { console.error('표준재료비(전체) 업데이트 오류:', err); return false; }
  },
};

// ============================================
// Product Info Service (품목정보)
// ============================================

export const productInfoService = {
  async getAll(): Promise<import('../utils/standardMaterialParser').ProductInfoItem[]> {
    const stored = localStorage.getItem('dashboard_productInfo');
    return stored ? JSON.parse(stored) : [];
  },

  async saveAll(records: import('../utils/standardMaterialParser').ProductInfoItem[]): Promise<void> {
    try { safeSetItem('dashboard_productInfo', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for productInfo, skipping local cache'); }
    console.log(`✅ productInfo saved: ${records.length} rows (localStorage)`);
  },
};

// ============================================
// Review Status Service (BOM 검토 체크박스)
// ============================================

export interface ReviewStatusRow {
  production: boolean;
  development: boolean;
  sales: boolean;
  purchase: boolean;
}

export type ReviewStatusMap = Record<string, ReviewStatusRow>;

const REVIEW_LS_KEY = 'dashboard_bomReviewStatus';

export const reviewStatusService = {
  async getAll(): Promise<ReviewStatusMap> {
    if (!isSupabaseConfigured() || isTableMissing('bom_review_status')) {
      const stored = localStorage.getItem(REVIEW_LS_KEY);
      return stored ? JSON.parse(stored) : {};
    }

    try {
      const rows = await fetchAllRows('bom_review_status', 'item_code');
      const map: ReviewStatusMap = {};
      for (const r of rows) {
        map[r.item_code] = {
          production: !!r.production,
          development: !!r.development,
          sales: !!r.sales,
          purchase: !!r.purchase,
        };
      }
      // localStorage에 백업
      try { safeSetItem(REVIEW_LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
      return map;
    } catch {
      const stored = localStorage.getItem(REVIEW_LS_KEY);
      return stored ? JSON.parse(stored) : {};
    }
  },

  async upsertOne(itemCode: string, status: ReviewStatusRow): Promise<void> {
    if (!isSupabaseConfigured()) { console.warn('[ReviewStatus] Supabase 미설정'); return; }
    if (isTableMissing('bom_review_status')) { console.warn('[ReviewStatus] 테이블 missing 캐시됨'); return; }

    try {
      const { error } = await supabase!
        .from('bom_review_status')
        .upsert(
          {
            item_code: itemCode,
            production: status.production,
            development: status.development,
            sales: status.sales,
            purchase: status.purchase,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'item_code', ignoreDuplicates: false },
        );
      if (error) {
        console.error('[ReviewStatus] upsert 에러:', error);
        checkTableError(error, 'bom_review_status');
      } else {
        console.log(`[ReviewStatus] upsert 성공: ${itemCode}`);
      }
    } catch (e) {
      console.error('[ReviewStatus] upsert 실패:', e);
    }
  },

  async saveAll(map: ReviewStatusMap): Promise<void> {
    try { safeSetItem(REVIEW_LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }

    if (!isSupabaseConfigured() || isTableMissing('bom_review_status')) return;

    const rows = Object.entries(map).map(([itemCode, s]) => ({
      item_code: itemCode,
      production: s.production,
      development: s.development,
      sales: s.sales,
      purchase: s.purchase,
      updated_at: new Date().toISOString(),
    }));
    await insertInBatches('bom_review_status', rows, 500, 'item_code');
  },
};
