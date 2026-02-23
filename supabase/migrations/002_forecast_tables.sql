-- ============================================
-- Forecast Data Tables (매출계획)
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- 1. Forecast Items (매출계획 품목별 데이터)
CREATE TABLE IF NOT EXISTS forecast_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL DEFAULT 'current',  -- 'current' or 'previous'
  no INTEGER,
  customer TEXT NOT NULL,
  model TEXT,
  stage TEXT,
  part_no TEXT,
  new_part_no TEXT,
  type TEXT,
  unit_price NUMERIC(15, 2) DEFAULT 0,
  category TEXT,
  part_name TEXT,
  monthly_qty JSONB DEFAULT '[]'::jsonb,
  total_qty INTEGER DEFAULT 0,
  monthly_revenue JSONB DEFAULT '[]'::jsonb,
  total_revenue NUMERIC(15, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecast_data_version ON forecast_data(version);
CREATE INDEX IF NOT EXISTS idx_forecast_data_customer ON forecast_data(customer);

-- 2. Forecast Summary (매출계획 요약)
CREATE TABLE IF NOT EXISTS forecast_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL DEFAULT 'current',  -- 'current' or 'previous'
  report_date TEXT,
  year INTEGER,
  revision TEXT,
  monthly_qty_totals JSONB DEFAULT '[]'::jsonb,
  monthly_revenue_totals JSONB DEFAULT '[]'::jsonb,
  total_qty INTEGER DEFAULT 0,
  total_revenue NUMERIC(15, 2) DEFAULT 0,
  prev_revenue_totals JSONB,
  revenue_diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecast_summary_version ON forecast_summary(version);

-- 3. Forecast Uploads (업로드 이력)
CREATE TABLE IF NOT EXISTS forecast_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_id TEXT NOT NULL,
  file_name TEXT,
  upload_date TEXT,
  report_date TEXT,
  revision TEXT,
  year INTEGER,
  total_revenue NUMERIC(15, 2) DEFAULT 0,
  total_qty INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecast_uploads_year ON forecast_uploads(year);

-- Triggers
DROP TRIGGER IF EXISTS update_forecast_data_updated_at ON forecast_data;
CREATE TRIGGER update_forecast_data_updated_at
  BEFORE UPDATE ON forecast_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_forecast_summary_updated_at ON forecast_summary;
CREATE TRIGGER update_forecast_summary_updated_at
  BEFORE UPDATE ON forecast_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
