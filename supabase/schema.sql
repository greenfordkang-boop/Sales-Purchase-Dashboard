-- Supabase Schema for Sales-Purchase Dashboard
-- Run this SQL in your Supabase SQL Editor to create the required tables

-- ============================================
-- 1. Sales Data Table (영업 계획/실적)
-- ============================================
CREATE TABLE IF NOT EXISTS sales_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer TEXT NOT NULL,
  model TEXT,
  part_no TEXT,
  part_name TEXT,
  total_plan INTEGER DEFAULT 0,
  total_actual INTEGER DEFAULT 0,
  rate NUMERIC(10, 2) DEFAULT 0,
  monthly_data JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_data(customer);

-- ============================================
-- 2. Revenue Data Table (매출 실적)
-- ============================================
CREATE TABLE IF NOT EXISTS revenue_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month TEXT NOT NULL,
  customer TEXT NOT NULL,
  model TEXT,
  qty INTEGER DEFAULT 0,
  amount NUMERIC(15, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_revenue_year ON revenue_data(year);
CREATE INDEX IF NOT EXISTS idx_revenue_customer ON revenue_data(customer);

-- ============================================
-- 2-1. Item Revenue Data Table (품목별 매출현황)
-- ============================================
CREATE TABLE IF NOT EXISTS item_revenue_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period TEXT NOT NULL,           -- 매출기간 (원본 문자열)
  customer TEXT NOT NULL,         -- 고객사
  model TEXT,                     -- 품종 / Model
  part_no TEXT,                   -- 품번
  customer_pn TEXT,               -- 고객사 P/N
  part_name TEXT,                 -- 품명
  qty INTEGER DEFAULT 0,          -- 매출수량
  amount NUMERIC(15, 2) DEFAULT 0, -- 매출금액
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_item_revenue_customer ON item_revenue_data(customer);
CREATE INDEX IF NOT EXISTS idx_item_revenue_model ON item_revenue_data(model);
CREATE INDEX IF NOT EXISTS idx_item_revenue_part_no ON item_revenue_data(part_no);

-- ============================================
-- 3. Purchase Data Table (구매 입고)
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month TEXT NOT NULL,
  date DATE,
  supplier TEXT NOT NULL,
  type TEXT,
  category TEXT CHECK (category IN ('Parts', 'Material')),
  item_code TEXT,
  item_name TEXT NOT NULL,
  spec TEXT,
  unit TEXT,
  qty INTEGER DEFAULT 0,
  unit_price NUMERIC(15, 2) DEFAULT 0,
  amount NUMERIC(15, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_purchase_year ON purchase_data(year);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchase_data(supplier);
CREATE INDEX IF NOT EXISTS idx_purchase_category ON purchase_data(category);

-- ============================================
-- 4. Inventory Data Table (재고)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT CHECK (type IN ('warehouse', 'material', 'parts', 'product')),
  code TEXT,
  name TEXT,
  qty INTEGER DEFAULT 0,
  spec TEXT,
  unit TEXT,
  location TEXT,
  customer_pn TEXT,
  model TEXT,
  status TEXT,
  unit_price NUMERIC(15, 2),
  amount NUMERIC(15, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional: allow inventory uploads even when some rows are missing codes/names.
ALTER TABLE inventory_data
  ALTER COLUMN code DROP NOT NULL,
  ALTER COLUMN name DROP NOT NULL;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_inventory_type ON inventory_data(type);
CREATE INDEX IF NOT EXISTS idx_inventory_code ON inventory_data(code);

-- ============================================
-- 4-1. Inventory V2 Data Table (재고 V2: Resin, Paint, Parts)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_v2 (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT CHECK (type IN ('resin', 'paint', 'parts')) NOT NULL,
  code TEXT,
  name TEXT,
  unit TEXT,
  location TEXT,
  qty INTEGER DEFAULT 0,
  -- Parts-specific fields (nullable)
  customer_pn TEXT,
  spec TEXT,
  model TEXT,
  status TEXT,
  unit_price NUMERIC(15, 2),
  amount NUMERIC(15, 2),
  -- Storage location for parts (재고위치)
  storage_location TEXT,
  -- Item type for parts (품목유형)
  item_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_inventory_v2_type ON inventory_v2(type);
CREATE INDEX IF NOT EXISTS idx_inventory_v2_code ON inventory_v2(code);

-- ============================================
-- 5. CR Data Table (Cost Reduction)
-- ============================================
CREATE TABLE IF NOT EXISTS cr_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL,
  total_sales NUMERIC(15, 2) DEFAULT 0,
  lg_sales NUMERIC(15, 2) DEFAULT 0,
  lg_cr NUMERIC(15, 2) DEFAULT 0,
  lg_defense NUMERIC(10, 4) DEFAULT 0,
  mtx_sales NUMERIC(15, 2) DEFAULT 0,
  mtx_cr NUMERIC(15, 2) DEFAULT 0,
  mtx_defense NUMERIC(10, 4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_cr_month ON cr_data(month);

-- ============================================
-- 6. RFQ Data Table (견적 요청)
-- ============================================
CREATE TABLE IF NOT EXISTS rfq_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  index_no TEXT,
  customer TEXT NOT NULL,
  project_type TEXT,
  project_name TEXT,
  process TEXT,
  status TEXT,
  date_selection DATE,
  date_quotation DATE,
  date_po DATE,
  model TEXT,
  qty INTEGER DEFAULT 0,
  unit_price NUMERIC(15, 2) DEFAULT 0,
  amount NUMERIC(15, 2) DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_rfq_customer ON rfq_data(customer);
CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_data(status);

-- ============================================
-- Row Level Security (RLS) - Optional
-- Enable if you want to restrict access
-- ============================================

-- Enable RLS on all tables (uncomment if needed)
-- ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE revenue_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE item_revenue_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE purchase_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventory_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventory_v2 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cr_data ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE rfq_data ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read/write access (for development)
-- CREATE POLICY "Allow anonymous access" ON sales_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON revenue_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON item_revenue_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON purchase_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON inventory_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON inventory_v2 FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON cr_data FOR ALL USING (true);
-- CREATE POLICY "Allow anonymous access" ON rfq_data FOR ALL USING (true);

-- ============================================
-- Updated_at Trigger Function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables
DROP TRIGGER IF EXISTS update_sales_data_updated_at ON sales_data;
CREATE TRIGGER update_sales_data_updated_at
  BEFORE UPDATE ON sales_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_revenue_data_updated_at ON revenue_data;
CREATE TRIGGER update_revenue_data_updated_at
  BEFORE UPDATE ON revenue_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_purchase_data_updated_at ON purchase_data;
CREATE TRIGGER update_purchase_data_updated_at
  BEFORE UPDATE ON purchase_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_data_updated_at ON inventory_data;
CREATE TRIGGER update_inventory_data_updated_at
  BEFORE UPDATE ON inventory_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cr_data_updated_at ON cr_data;
CREATE TRIGGER update_cr_data_updated_at
  BEFORE UPDATE ON cr_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rfq_data_updated_at ON rfq_data;
CREATE TRIGGER update_rfq_data_updated_at
  BEFORE UPDATE ON rfq_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inventory_v2_updated_at ON inventory_v2;
CREATE TRIGGER update_inventory_v2_updated_at
  BEFORE UPDATE ON inventory_v2
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_item_revenue_data_updated_at ON item_revenue_data;
CREATE TRIGGER update_item_revenue_data_updated_at
  BEFORE UPDATE ON item_revenue_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
