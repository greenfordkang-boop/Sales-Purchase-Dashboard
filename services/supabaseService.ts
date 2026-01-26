
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

    if (rows.length > 0) {
      const { error } = await supabase!.from('sales_data').insert(rows);
      if (error) handleError(error, 'sales insert');
    }

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

    return data?.map((row: any) => ({
      id: row.id,
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

    const rows = data.map(item => ({
      year: item.year,
      month: item.month,
      customer: item.customer,
      model: item.model,
      qty: item.qty,
      amount: item.amount
    }));

    if (rows.length > 0) {
      const { error } = await supabase!.from('revenue_data').insert(rows);
      if (error) handleError(error, 'revenue insert');
    }

    localStorage.setItem('dashboard_revenueData', JSON.stringify(data));
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
      qty: item.qty,
      unit_price: item.unitPrice,
      amount: item.amount
    }));

    if (rows.length > 0) {
      const { error } = await supabase!.from('purchase_data').insert(rows);
      if (error) handleError(error, 'purchase insert');
    }

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

    const rows = allItems.map(item => ({
      type: item.type,
      code: item.code,
      name: item.name,
      qty: item.qty,
      spec: item.spec,
      unit: item.unit,
      location: item.location,
      customer_pn: item.customerPN,
      model: item.model,
      status: item.status,
      unit_price: item.unitPrice,
      amount: item.amount
    }));

    if (rows.length > 0) {
      const { error } = await supabase!.from('inventory_data').insert(rows);
      if (error) handleError(error, 'inventory insert');
    }

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

    if (rows.length > 0) {
      const { error } = await supabase!.from('cr_data').insert(rows);
      if (error) handleError(error, 'cr insert');
    }

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
      qty: item.qty,
      unit_price: item.unitPrice,
      amount: item.amount,
      remark: item.remark
    }));

    if (rows.length > 0) {
      const { error } = await supabase!.from('rfq_data').insert(rows);
      if (error) handleError(error, 'rfq insert');
    }

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
      qty: item.qty,
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
        qty: item.qty,
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
