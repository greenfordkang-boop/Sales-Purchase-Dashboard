
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SalesItem, CustomerSalesData, MonthlyStats } from '../utils/salesDataParser';
import { PurchaseItem } from '../utils/purchaseDataParser';
import { RevenueItem } from '../utils/revenueDataParser';
import { InventoryItem } from '../utils/inventoryDataParser';
import { CRItem } from '../utils/crDataParser';
import { RFQItem } from '../utils/rfqDataParser';

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

// ============================================
// Sales Data Service
// ============================================

export const salesService = {
  async getAll(): Promise<CustomerSalesData[]> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_salesData');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase!
      .from('sales_data')
      .select('*')
      .order('customer');

    if (error) handleError(error, 'sales getAll');

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

    const { data, error } = await supabase!
      .from('revenue_data')
      .select('*')
      .order('year', { ascending: false })
      .order('month');

    if (error) handleError(error, 'revenue getAll');

    return data?.map((row: any, index: number) => ({
      id: typeof row.id === 'number' ? row.id : (Date.now() + index),
      year: row.year,
      month: row.month,
      customer: row.customer,
      model: row.model || '',
      qty: row.qty || 0,
      amount: row.amount || 0
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
      // Delete data for the specific year
      const { error: deleteError } = await supabase!
        .from('revenue_data')
        .delete()
        .eq('year', year);

      if (deleteError) {
        console.error('Error deleting revenue data for year', year, deleteError);
        handleError(deleteError, 'revenue delete by year');
      }

      // Insert new data for the year
      const rows = data.map(item => ({
        year: item.year,
        month: item.month,
        customer: item.customer,
        model: item.model || '',
        qty: item.qty || 0,
        amount: item.amount || 0
      }));

      await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE);

      // Reload all data from Supabase to update localStorage
      const allData = await this.getAll();
      localStorage.setItem('dashboard_revenueData', JSON.stringify(allData));
      console.log(`Revenue data for year ${year} saved to Supabase successfully`);
    } catch (error) {
      console.error('Failed to save revenue data by year:', error);
      throw error;
    }
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

    const { data, error } = await supabase!
      .from('purchase_data')
      .select('*')
      .order('date', { ascending: false });

    if (error) handleError(error, 'purchase getAll');

    return data?.map((row: any) => ({
      id: row.id,
      year: row.year,
      month: row.month,
      date: row.date,
      supplier: row.supplier,
      type: row.type || '',
      category: row.category as 'Parts' | 'Material',
      itemCode: row.item_code || '',
      itemName: row.item_name,
      spec: row.spec || '',
      unit: row.unit || '',
      qty: row.qty || 0,
      unitPrice: row.unit_price || 0,
      amount: row.amount || 0
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

export const inventoryService = {
  async getAll(): Promise<InventoryData> {
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem('dashboard_inventoryData');
      return stored ? JSON.parse(stored) : { warehouse: [], material: [], parts: [], product: [] };
    }

    const { data, error } = await supabase!
      .from('inventory_data')
      .select('*')
      .order('code');

    if (error) handleError(error, 'inventory getAll');

    const result: InventoryData = { warehouse: [], material: [], parts: [], product: [] };

    data?.forEach((row: any) => {
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

    const { data, error } = await supabase!
      .from('cr_data')
      .select('*')
      .order('month');

    if (error) handleError(error, 'cr getAll');

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

    const { data, error } = await supabase!
      .from('rfq_data')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) handleError(error, 'rfq getAll');

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
// Utility: Sync All Data to Supabase
// ============================================

export const syncAllDataToSupabase = async (): Promise<{ success: boolean; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase is not configured. Data is stored locally.' };
  }

  try {
    // Get all data from localStorage
    const salesData = localStorage.getItem('dashboard_salesData');
    const revenueData = localStorage.getItem('dashboard_revenueData');
    const purchaseData = localStorage.getItem('dashboard_purchaseData');
    const inventoryData = localStorage.getItem('dashboard_inventoryData');
    const crData = localStorage.getItem('dashboard_crData');
    const rfqData = localStorage.getItem('dashboard_rfqData');

    // Sync each data type
    if (salesData) await salesService.saveAll(JSON.parse(salesData));
    if (revenueData) await revenueService.saveAll(JSON.parse(revenueData));
    if (purchaseData) await purchaseService.saveAll(JSON.parse(purchaseData));
    if (inventoryData) await inventoryService.saveAll(JSON.parse(inventoryData));
    if (crData) await crService.saveAll(JSON.parse(crData));
    if (rfqData) await rfqService.saveAll(JSON.parse(rfqData));

    return { success: true, message: 'All data synced to Supabase successfully!' };
  } catch (error: any) {
    return { success: false, message: `Sync failed: ${error.message}` };
  }
};

// ============================================
// Utility: Load All Data from Supabase
// ============================================

export const loadAllDataFromSupabase = async (): Promise<{ success: boolean; message: string }> => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase is not configured. Using local data.' };
  }

  try {
    // Load all data from Supabase and save to localStorage
    const salesData = await salesService.getAll();
    const revenueData = await revenueService.getAll();
    const purchaseData = await purchaseService.getAll();
    const inventoryData = await inventoryService.getAll();
    const crData = await crService.getAll();
    const rfqData = await rfqService.getAll();

    localStorage.setItem('dashboard_salesData', JSON.stringify(salesData));
    localStorage.setItem('dashboard_revenueData', JSON.stringify(revenueData));
    localStorage.setItem('dashboard_purchaseData', JSON.stringify(purchaseData));
    localStorage.setItem('dashboard_inventoryData', JSON.stringify(inventoryData));
    localStorage.setItem('dashboard_crData', JSON.stringify(crData));
    localStorage.setItem('dashboard_rfqData', JSON.stringify(rfqData));

    return { success: true, message: 'All data loaded from Supabase successfully!' };
  } catch (error: any) {
    return { success: false, message: `Load failed: ${error.message}` };
  }
};
