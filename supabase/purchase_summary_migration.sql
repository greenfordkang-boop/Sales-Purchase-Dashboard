-- Migration: Purchase Item Master + Monthly Summary
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Purchase Item Master (구매 품목기준정보)
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_item_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  part_no TEXT UNIQUE NOT NULL,
  cost_type TEXT,
  purchase_type TEXT,
  material_type TEXT,
  process TEXT,
  customer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pim_part_no ON purchase_item_master(part_no);
CREATE INDEX IF NOT EXISTS idx_pim_customer ON purchase_item_master(customer);
CREATE INDEX IF NOT EXISTS idx_pim_process ON purchase_item_master(process);

-- ============================================
-- 2. Purchase Monthly Summary (매입종합집계)
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_monthly_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month TEXT NOT NULL,
  supplier TEXT NOT NULL,
  part_no TEXT NOT NULL,
  part_name TEXT,
  spec TEXT,
  unit TEXT,
  sales_qty NUMERIC(15,2) DEFAULT 0,
  closing_qty NUMERIC(15,2) DEFAULT 0,
  unit_price NUMERIC(15,4) DEFAULT 0,
  amount NUMERIC(15,2) DEFAULT 0,
  location TEXT,
  cost_type TEXT,
  purchase_type TEXT,
  material_type TEXT,
  process TEXT,
  customer TEXT,
  remark TEXT,
  closing_month TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, month, supplier, part_no)
);

CREATE INDEX IF NOT EXISTS idx_pms_year ON purchase_monthly_summary(year);
CREATE INDEX IF NOT EXISTS idx_pms_month ON purchase_monthly_summary(month);
CREATE INDEX IF NOT EXISTS idx_pms_supplier ON purchase_monthly_summary(supplier);
CREATE INDEX IF NOT EXISTS idx_pms_part_no ON purchase_monthly_summary(part_no);
CREATE INDEX IF NOT EXISTS idx_pms_customer ON purchase_monthly_summary(customer);
CREATE INDEX IF NOT EXISTS idx_pms_process ON purchase_monthly_summary(process);

-- ============================================
-- 3. Triggers
-- ============================================
DROP TRIGGER IF EXISTS update_purchase_item_master_updated_at ON purchase_item_master;
CREATE TRIGGER update_purchase_item_master_updated_at
  BEFORE UPDATE ON purchase_item_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_purchase_monthly_summary_updated_at ON purchase_monthly_summary;
CREATE TRIGGER update_purchase_monthly_summary_updated_at
  BEFORE UPDATE ON purchase_monthly_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. RLS Policies (enable for authenticated users)
-- ============================================
ALTER TABLE purchase_item_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_monthly_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read purchase_item_master" ON purchase_item_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated write purchase_item_master" ON purchase_item_master
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read purchase_monthly_summary" ON purchase_monthly_summary
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated write purchase_monthly_summary" ON purchase_monthly_summary
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
