
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SalesItem, CustomerSalesData, MonthlyStats } from '../utils/salesDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { PurchaseItemMaster, PurchaseMonthlySummary } from '../utils/purchaseSummaryTypes';
import { RevenueItem, ItemRevenueRow } from '../utils/revenueDataParser';
import { SupplierItem } from '../utils/supplierDataParser';
import { InventoryItem } from '../utils/inventoryDataParser';
import { CRItem } from '../utils/crDataParser';
import { RFQItem } from '../utils/rfqDataParser';
import { ForecastItem, ForecastSummary, ForecastUpload } from '../utils/salesForecastParser';
import { BomRecord } from '../utils/bomDataParser';
import { CIDetailItem } from '../utils/ciDataParser';
import {
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
  EquipmentRecord,
  MaterialCodeRecord,
  DataQualityIssue,
} from '../utils/bomMasterParser';

// ============================================
// Helper Functions
// ============================================

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

const insertInBatches = async (table: string, rows: any[], batchSize = 500) => {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let lastError: any = null;
    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt += 1) {
      const { error } = await supabase!
        .from(table)
        .insert(batch, { returning: 'minimal' });
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
          const { error } = await supabase!
            .from(table)
            .insert(row, { returning: 'minimal' });
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
  const pageSize = 1000;
  let from = 0;
  let allRows: any[] = [];

  while (true) {
    let query = supabase!
      .from(table)
      .select('*')
      .order(orderBy, orderOpts || {})
      .range(from, from + pageSize - 1);

    if (extraOrder) {
      query = query.order(extraOrder.column, { ascending: extraOrder.ascending ?? true });
    }

    const { data, error } = await query;
    if (error) { handleError(error, `${table} fetchAll`); break; }
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
      localStorage.setItem('dashboard_salesData', JSON.stringify(data));
      return;
    }

    // Clear existing data and insert new
    const { error: deleteError } = await supabase!
      .from('sales_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) handleError(deleteError, 'sales delete');

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

    await insertInBatches('sales_data', rows);

    // Also save to localStorage as backup
    localStorage.setItem('dashboard_salesData', JSON.stringify(data));
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
      localStorage.setItem('dashboard_revenueData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('revenue_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'revenue delete');

    // localStorage에 먼저 저장 (데이터 손실 방지)
    localStorage.setItem('dashboard_revenueData', JSON.stringify(data));

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      customer: item.customer,
      model: item.model,
      qty: Math.round(item.qty || 0),
      amount: Math.round(item.amount || 0)  // 소수점 값 방지
    }));

    await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE);
  },

  async saveByYear(data: RevenueItem[], year: number): Promise<void> {
    if (!isSupabaseConfigured()) {
      // For localStorage, filter and merge
      const stored = localStorage.getItem('dashboard_revenueData');
      const existing: RevenueItem[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(item => item.year !== year);
      const merged = [...filtered, ...data];
      localStorage.setItem('dashboard_revenueData', JSON.stringify(merged));
      return;
    }

    try {
      // Delete data for the specific year only
      const { error: deleteError } = await supabase!
        .from('revenue_data')
        .delete()
        .eq('year', year);

      if (deleteError) {
        console.error('Error deleting revenue data for year', year, deleteError);
        // Don't throw - continue to insert
      }

      // Insert new data for the year
      const rows = data.map(item => ({
        year: item.year,
        month: item.month,
        customer: item.customer,
        model: item.model || '',
        qty: Math.round(item.qty || 0),
        amount: Math.round(item.amount || 0)
      }));

      await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE);

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
      localStorage.setItem('dashboard_itemRevenueData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('item_revenue_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'itemRevenue delete');

    // localStorage에 먼저 저장 (데이터 손실 방지)
    localStorage.setItem('dashboard_itemRevenueData', JSON.stringify(data));

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

    await insertInBatches('item_revenue_data', rows, REVENUE_BATCH_SIZE);
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
      localStorage.setItem('dashboard_purchaseData', JSON.stringify(data));
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

    localStorage.setItem('dashboard_purchaseData', JSON.stringify(data));
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
      localStorage.setItem('dashboard_purchaseData', JSON.stringify(merged));
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
      localStorage.setItem('dashboard_purchaseData', JSON.stringify(merged));

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
      localStorage.setItem('dashboard_inventoryData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('inventory_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'inventory delete');

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

    await insertInBatches('inventory_data', rows);

    localStorage.setItem('dashboard_inventoryData', JSON.stringify(data));
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
      localStorage.setItem('dashboard_inventory_v2', JSON.stringify(data));
      return;
    }

    try {
      // Delete existing data
      const { error: deleteError } = await supabase!
        .from('inventory_v2')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) {
        console.error('inventory_v2 delete error:', deleteError);
      }

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

      await insertInBatches('inventory_v2', rows);

      // Also save to localStorage
      localStorage.setItem('dashboard_inventory_v2', JSON.stringify(data));
      console.log(`✅ inventory_v2 saved: ${rows.length} rows`);
    } catch (err) {
      console.error('Failed to save inventory_v2 to Supabase:', err);
      // Still save to localStorage
      localStorage.setItem('dashboard_inventory_v2', JSON.stringify(data));
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

    const data = await fetchAllRows('cr_data', 'month');

    return data?.map((row: any) => ({
      month: row.month,
      totalSales: row.total_sales || 0,
      lgSales: row.lg_sales || 0,
      lgCR: row.lg_cr || 0,
      lgDefense: row.lg_defense || 0,
      mtxSales: row.mtx_sales || 0,
      mtxCR: row.mtx_cr || 0,
      mtxDefense: row.mtx_defense || 0
    })) || [];
  },

  async saveAll(data: CRItem[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      localStorage.setItem('dashboard_crData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('cr_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'cr delete');

    const rows = data.map(item => ({
      month: item.month,
      total_sales: item.totalSales,
      lg_sales: item.lgSales,
      lg_cr: item.lgCR,
      lg_defense: item.lgDefense,
      mtx_sales: item.mtxSales,
      mtx_cr: item.mtxCR,
      mtx_defense: item.mtxDefense
    }));

    await insertInBatches('cr_data', rows);

    localStorage.setItem('dashboard_crData', JSON.stringify(data));
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
      localStorage.setItem('dashboard_rfqData', JSON.stringify(data));
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

    localStorage.setItem('dashboard_rfqData', JSON.stringify(data));
  },

  async add(item: RFQItem): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_rfqData');
      const data: RFQItem[] = stored ? JSON.parse(stored) : [];
      data.push(item);
      localStorage.setItem('dashboard_rfqData', JSON.stringify(data));
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
        localStorage.setItem('dashboard_rfqData', JSON.stringify(data));
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
      localStorage.setItem('dashboard_rfqData', JSON.stringify(filtered));
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
      localStorage.setItem('dashboard_supplierData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('supplier_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'supplier delete');

    // localStorage에 먼저 저장 (데이터 손실 방지)
    localStorage.setItem('dashboard_supplierData', JSON.stringify(data));

    const rows = data.map(item => ({
      company_name: item.companyName,
      business_number: item.businessNumber,
      ceo: item.ceo,
      address: item.address,
      purchase_amount_2025: Math.round(item.purchaseAmount2025 || 0),
      purchase_amount_2024: Math.round(item.purchaseAmount2024 || 0),
      purchase_amount_2023: Math.round(item.purchaseAmount2023 || 0),
    }));

    await insertInBatches('supplier_data', rows);
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
    if (!isSupabaseConfigured()) {
      localStorage.setItem('dashboard_purchaseItemMaster', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('purchase_item_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'purchaseItemMaster delete');

    localStorage.setItem('dashboard_purchaseItemMaster', JSON.stringify(data));

    const rows = data.map(item => ({
      part_no: item.partNo,
      cost_type: item.costType,
      purchase_type: item.purchaseType,
      material_type: item.materialType,
      process: item.process,
      customer: item.customer,
    }));

    await insertInBatches('purchase_item_master', rows);
  },

  async upsertBatch(data: PurchaseItemMaster[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseItemMaster');
      const existing: PurchaseItemMaster[] = stored ? JSON.parse(stored) : [];
      const map = new Map(existing.map(i => [i.partNo, i]));
      data.forEach(item => map.set(item.partNo, item));
      localStorage.setItem('dashboard_purchaseItemMaster', JSON.stringify(Array.from(map.values())));
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

export const purchaseSummaryService = {
  async getAll(year?: number): Promise<PurchaseMonthlySummary[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseSummary');
      const all: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
      return year ? all.filter(d => d.year === year) : all;
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
      // Table may not exist – fall back to localStorage
      const stored = localStorage.getItem('dashboard_purchaseSummary');
      const all: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
      return year ? all.filter(d => d.year === year) : all;
    }
  },

  async saveByYearMonth(data: PurchaseMonthlySummary[], year: number, month: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_purchaseSummary');
      const existing: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(d => !(d.year === year && d.month === month));
      const merged = [...filtered, ...data];
      localStorage.setItem('dashboard_purchaseSummary', JSON.stringify(merged));
      return;
    }

    // 해당 년월 데이터 삭제
    const { error: deleteError } = await supabase!
      .from('purchase_monthly_summary')
      .delete()
      .eq('year', year)
      .eq('month', month);

    if (deleteError) console.error('purchaseSummary delete error:', deleteError);

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

    await insertInBatches('purchase_monthly_summary', rows);

    // localStorage도 업데이트
    const stored = localStorage.getItem('dashboard_purchaseSummary');
    const existing: PurchaseMonthlySummary[] = stored ? JSON.parse(stored) : [];
    const filtered = existing.filter(d => !(d.year === year && d.month === month));
    localStorage.setItem('dashboard_purchaseSummary', JSON.stringify([...filtered, ...data]));

    console.log(`✅ Purchase summary ${year}년 ${month} saved: ${rows.length} rows`);
  },

  async saveAll(data: PurchaseMonthlySummary[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      localStorage.setItem('dashboard_purchaseSummary', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('purchase_monthly_summary')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'purchaseSummary delete');

    localStorage.setItem('dashboard_purchaseSummary', JSON.stringify(data));

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

    await insertInBatches('purchase_monthly_summary', rows);
  }
};

// ============================================
// BOM Data Service (자재수율용)
// ============================================

export const bomService = {
  async getAll(): Promise<BomRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_bomData');
      return stored ? JSON.parse(stored) : [];
    }

    const pageSize = 1000;
    let from = 0;
    let allRows: any[] = [];

    while (true) {
      const { data, error } = await supabase!
        .from('bom_data')
        .select('*')
        .order('parent_pn')
        .range(from, from + pageSize - 1);

      if (error) { handleError(error, 'bom getAll'); break; }
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return allRows.map((row: any) => ({
      parentPn: row.parent_pn || '',
      childPn: row.child_pn || '',
      level: row.level || 1,
      qty: Number(row.qty) || 1,
      childName: row.child_name || '',
      supplier: row.supplier || '',
      partType: row.part_type || '',
    }));
  },

  async saveAll(data: BomRecord[]): Promise<void> {
    if (!isSupabaseConfigured()) {
      localStorage.setItem('dashboard_bomData', JSON.stringify(data));
      return;
    }

    const { error: deleteError } = await supabase!
      .from('bom_data')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) handleError(deleteError, 'bom delete');

    localStorage.setItem('dashboard_bomData', JSON.stringify(data));

    const rows = data.map(item => ({
      parent_pn: item.parentPn,
      child_pn: item.childPn,
      level: item.level,
      qty: item.qty,
      child_name: item.childName,
      supplier: item.supplier,
      part_type: item.partType,
    }));

    await insertInBatches('bom_data', rows);
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
    if (!isSupabaseConfigured()) {
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
      console.error('ci_kpi_settings get error:', error);
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
    localStorage.setItem('dashboard_crKpiData', JSON.stringify(data));
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('ci_kpi_settings')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) console.error('ci_kpi_settings delete error:', deleteError);

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

    if (error) console.error('ci_kpi_settings insert error:', error);
    else console.log('✅ CI KPI settings saved');
  }
};

// ============================================
// CI Details Service
// ============================================

export const ciDetailService = {
  async getAll(): Promise<Record<number, CIDetailItem[]>> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_ciDetails');
      return stored ? JSON.parse(stored) : {};
    }

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
  },

  async saveAll(data: Record<number, CIDetailItem[]>): Promise<void> {
    localStorage.setItem('dashboard_ciDetails', JSON.stringify(data));
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('ci_details')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) console.error('ci_details delete error:', deleteError);

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
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_ciUploads');
      return stored ? JSON.parse(stored) : [];
    }

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
  },

  async saveAll(data: CIUploadRecord[]): Promise<void> {
    localStorage.setItem('dashboard_ciUploads', JSON.stringify(data));
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('ci_uploads')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) console.error('ci_uploads delete error:', deleteError);

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
    localStorage.setItem('dashboard_salesData', JSON.stringify(data));
  });
  await loadOne('revenue', async () => {
    const data = await revenueService.getAll();
    const total2026 = data.filter(r => r.year === 2026).reduce((s, r) => s + (r.amount || 0), 0);
    console.log(`📊 revenue downloaded: ${data.length} rows, 2026 total: ${(total2026/100000000).toFixed(1)}억`);
    localStorage.setItem('dashboard_revenueData', JSON.stringify(data));
  });
  await loadOne('itemRevenue', async () => {
    const data = await itemRevenueService.getAll();
    console.log(`📊 itemRevenue downloaded: ${data.length} rows`);
    localStorage.setItem('dashboard_itemRevenueData', JSON.stringify(data));
  });
  await loadOne('purchase', async () => {
    const data = await purchaseService.getAll();
    console.log(`📊 purchase downloaded: ${data.length} rows`);
    localStorage.setItem('dashboard_purchaseData', JSON.stringify(data));
  });
  await loadOne('inventory', async () => {
    const data = await inventoryService.getAll();
    localStorage.setItem('dashboard_inventoryData', JSON.stringify(data));
  });
  await loadOne('inventoryV2', async () => {
    const data = await inventoryService.getInventoryV2();
    if (data) localStorage.setItem('dashboard_inventory_v2', JSON.stringify(data));
  });
  await loadOne('cr', async () => {
    const data = await crService.getAll();
    localStorage.setItem('dashboard_crData', JSON.stringify(data));
  });
  await loadOne('rfq', async () => {
    const data = await rfqService.getAll();
    localStorage.setItem('dashboard_rfqData', JSON.stringify(data));
  });
  await loadOne('supplier', async () => {
    const data = await supplierService.getAll();
    localStorage.setItem('dashboard_supplierData', JSON.stringify(data));
  });
  await loadOne('bom', async () => {
    const data = await bomService.getAll();
    localStorage.setItem('dashboard_bomData', JSON.stringify(data));
  });

  // Forecast data
  await loadOne('forecast', async () => {
    const items = await forecastService.getItems('current');
    localStorage.setItem('dashboard_forecastData', JSON.stringify(items));
    const summary = await forecastService.getSummary('current');
    if (summary) localStorage.setItem('dashboard_forecastData_summary', JSON.stringify(summary));
  });
  await loadOne('forecastPrev', async () => {
    const items = await forecastService.getItems('previous');
    localStorage.setItem('dashboard_forecastData_prev', JSON.stringify(items));
    const summary = await forecastService.getSummary('previous');
    if (summary) localStorage.setItem('dashboard_forecastData_prev_summary', JSON.stringify(summary));
  });
  await loadOne('forecastUploads', async () => {
    const data = await forecastService.getUploads();
    localStorage.setItem('dashboard_forecastUploads', JSON.stringify(data));
  });

  // CI data
  await loadOne('ciKpi', async () => {
    const data = await ciKpiService.get();
    if (data) localStorage.setItem('dashboard_crKpiData', JSON.stringify(data));
  });
  await loadOne('ciDetails', async () => {
    const data = await ciDetailService.getAll();
    if (data && Object.keys(data).length > 0) localStorage.setItem('dashboard_ciDetails', JSON.stringify(data));
  });
  await loadOne('ciUploads', async () => {
    const data = await ciUploadService.getAll();
    if (data.length > 0) localStorage.setItem('dashboard_ciUploads', JSON.stringify(data));
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
    localStorage.setItem(key, JSON.stringify(data));

    if (!isSupabaseConfigured()) return;

    // Delete existing data for this version
    const { error: deleteError } = await supabase!
      .from('forecast_data')
      .delete()
      .eq('version', version);

    if (deleteError) console.error('forecast_data delete error:', deleteError);

    if (data.length === 0) return;

    // Sanitize: filter out rows with null/undefined customer (NOT NULL constraint)
    const validData = data.filter(item => item.customer != null && String(item.customer).trim() !== '');
    if (validData.length < data.length) {
      console.warn(`forecast_data: ${data.length - validData.length} rows filtered (empty customer)`);
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
      localStorage.setItem(key, JSON.stringify(data));
    } else {
      localStorage.removeItem(key);
    }

    if (!isSupabaseConfigured()) return;

    // Delete existing summary for this version
    const { error: deleteError } = await supabase!
      .from('forecast_summary')
      .delete()
      .eq('version', version);

    if (deleteError) console.error('forecast_summary delete error:', deleteError);

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

    const { error } = await supabase!
      .from('forecast_summary')
      .insert(row);

    if (error) console.error('forecast_summary insert error:', error, 'row:', JSON.stringify(row).substring(0, 200));
    else console.log(`✅ Forecast ${version} summary saved`);
  },

  async getUploads(): Promise<ForecastUpload[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_forecastUploads');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase!
      .from('forecast_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('forecast_uploads get error:', error);
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
    localStorage.setItem('dashboard_forecastUploads', JSON.stringify(data));

    if (!isSupabaseConfigured()) return;

    // Delete all and re-insert
    const { error: deleteError } = await supabase!
      .from('forecast_uploads')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) console.error('forecast_uploads delete error:', deleteError);

    if (data.length === 0) return;

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
      return data.map((row: any) => ({
        parentPn: row.parent_pn || '',
        childPn: row.child_pn || '',
        level: row.level || 1,
        qty: Number(row.qty) || 1,
        childName: row.child_name || '',
        partType: row.part_type || '',
        supplier: row.supplier || '',
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_bomMasterData');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: BomMasterRecord[]): Promise<void> {
    try { localStorage.setItem('dashboard_bomMasterData', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for bomMaster, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('bom_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('bom_master delete error:', deleteError);

    const rows = records.map(r => ({
      parent_pn: r.parentPn,
      child_pn: r.childPn,
      level: r.level,
      qty: r.qty,
      child_name: r.childName,
      part_type: r.partType,
      supplier: r.supplier,
    }));

    await insertInBatches('bom_master', rows);
    console.log(`✅ bom_master saved: ${rows.length} rows`);
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
    try { localStorage.setItem('dashboard_productCodeMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for productCode, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('product_code_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('product_code_master delete error:', deleteError);

    const rows = records.map(r => ({
      product_code: r.productCode,
      customer_pn: r.customerPn,
      product_name: r.productName,
      customer: r.customer,
      model: r.model,
    }));

    await insertInBatches('product_code_master', rows);
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
        supplyType: row.supply_type || '',
        processType: row.process_type || '',
        netWeight: Number(row.net_weight) || 0,
        runnerWeight: Number(row.runner_weight) || 0,
        cavity: Number(row.cavity) || 1,
        lossRate: Number(row.loss_rate) || 0,
        paintQty1: Number(row.paint_qty_1) || 0,
        paintQty2: Number(row.paint_qty_2) || 0,
        paintQty3: Number(row.paint_qty_3) || 0,
        rawMaterialCode1: row.raw_material_code_1 || '',
        rawMaterialCode2: row.raw_material_code_2 || '',
        rawMaterialCode3: row.raw_material_code_3 || '',
        rawMaterialCode4: row.raw_material_code_4 || '',
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_referenceInfoMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: ReferenceInfoRecord[]): Promise<void> {
    try { localStorage.setItem('dashboard_referenceInfoMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for referenceInfo, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('reference_info_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('reference_info_master delete error:', deleteError);

    const rows = records.map(r => ({
      item_code: r.itemCode,
      customer_pn: r.customerPn,
      item_name: r.itemName,
      supply_type: r.supplyType,
      process_type: r.processType,
      net_weight: r.netWeight,
      runner_weight: r.runnerWeight,
      cavity: r.cavity,
      loss_rate: r.lossRate,
      paint_qty_1: r.paintQty1,
      paint_qty_2: r.paintQty2,
      paint_qty_3: r.paintQty3,
      raw_material_code_1: r.rawMaterialCode1,
      raw_material_code_2: r.rawMaterialCode2,
      raw_material_code_3: r.rawMaterialCode3,
      raw_material_code_4: r.rawMaterialCode4,
    }));

    await insertInBatches('reference_info_master', rows);
    console.log(`✅ reference_info_master saved: ${rows.length} rows`);
  },
};

// ============================================
// Equipment Master Service (설비코드)
// ============================================

export const equipmentService = {
  async getAll(): Promise<EquipmentRecord[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_equipmentMaster');
      return stored ? JSON.parse(stored) : [];
    }

    const data = await fetchAllRows('equipment_master', 'equipment_code');
    return data.map((row: any) => ({
      equipmentCode: row.equipment_code || '',
      equipmentName: row.equipment_name || '',
      tonnage: Number(row.tonnage) || 0,
    }));
  },

  async saveAll(records: EquipmentRecord[]): Promise<void> {
    try { localStorage.setItem('dashboard_equipmentMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for equipment, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('equipment_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('equipment_master delete error:', deleteError);

    const rows = records.map(r => ({
      equipment_code: r.equipmentCode,
      equipment_name: r.equipmentName,
      tonnage: r.tonnage,
    }));

    await insertInBatches('equipment_master', rows);
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
        materialCode: row.material_code || '',
        materialName: row.material_name || '',
        materialType: row.material_type || '',
        unit: row.unit || '',
        lossRate: Number(row.loss_rate) || 0,
        currentPrice: Number(row.current_price) || 0,
      }));
    } catch {
      const stored = localStorage.getItem('dashboard_materialCodeMaster');
      return stored ? JSON.parse(stored) : [];
    }
  },

  async saveAll(records: MaterialCodeRecord[]): Promise<void> {
    try { localStorage.setItem('dashboard_materialCodeMaster', JSON.stringify(records)); } catch { console.warn('localStorage quota exceeded for materialCode, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('material_code_master')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('material_code_master delete error:', deleteError);

    const rows = records.map(r => ({
      material_code: r.materialCode,
      material_name: r.materialName,
      material_type: r.materialType,
      unit: r.unit,
      loss_rate: r.lossRate,
      current_price: r.currentPrice,
    }));

    await insertInBatches('material_code_master', rows);
    console.log(`✅ material_code_master saved: ${rows.length} rows`);
  },
};

// ============================================
// Data Quality Issues Service (데이터 품질)
// ============================================

export const dataQualityService = {
  async getAll(): Promise<DataQualityIssue[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_dataQualityIssues');
      return stored ? JSON.parse(stored) : [];
    }

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
  },

  async saveAll(issues: DataQualityIssue[]): Promise<void> {
    try { localStorage.setItem('dashboard_dataQualityIssues', JSON.stringify(issues)); } catch { console.warn('localStorage quota exceeded for dataQuality, skipping local cache'); }
    if (!isSupabaseConfigured()) return;

    const { error: deleteError } = await supabase!
      .from('data_quality_issues')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) console.error('data_quality_issues delete error:', deleteError);

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
