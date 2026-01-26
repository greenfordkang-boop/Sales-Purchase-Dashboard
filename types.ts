
export enum DashboardTab {
  OVERVIEW = 'overview',
  SALES = 'sales',
  PURCHASE = 'purchase',
  INVENTORY = 'inventory',
  SUPPLIER = 'supplier'
}

export interface Metric {
  label: string;
  value: string | number;
  change?: number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface SalesRecord {
  id: string;
  date: string;
  customer: string;
  item: string;
  quantity: number;
  amount: number;
  status: 'completed' | 'pending' | 'cancelled';
}

export interface PurchaseRecord {
  id: string;
  date: string;
  supplier: string;
  item: string;
  quantity: number;
  amount: number;
  leadTime: number;
  status: 'received' | 'ordered' | 'delayed';
}

export interface MonthlyData {
  month: string;
  sales: number;
  purchase: number;
  target: number;
}
