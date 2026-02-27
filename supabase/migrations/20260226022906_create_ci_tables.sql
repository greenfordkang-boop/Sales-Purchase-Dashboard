-- CI KPI Settings (single-row JSON store)
CREATE TABLE IF NOT EXISTS ci_kpi_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prev_year_ci numeric DEFAULT 0,
  prev_year_ci_ratio numeric DEFAULT 0,
  target_ci numeric DEFAULT 0,
  target_ci_ratio numeric DEFAULT 0,
  monthly_ci_target jsonb DEFAULT '[]'::jsonb,
  monthly_ci_actual jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- CI Detail Items
CREATE TABLE IF NOT EXISTS ci_details (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  month integer NOT NULL,
  year integer NOT NULL,
  customer text DEFAULT '',
  production_site text DEFAULT '',
  vehicle_model text DEFAULT '',
  part_code text DEFAULT '',
  part_number text DEFAULT '',
  part_name text DEFAULT '',
  category text DEFAULT '',
  base_price numeric DEFAULT 0,
  current_price numeric DEFAULT 0,
  quantity numeric DEFAULT 0,
  ci_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- CI Upload Records
CREATE TABLE IF NOT EXISTS ci_uploads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  month integer NOT NULL,
  year integer NOT NULL,
  file_name text DEFAULT '',
  upload_date text DEFAULT '',
  total_ci_amount numeric DEFAULT 0,
  total_quantity numeric DEFAULT 0,
  item_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS with public access (matching existing tables pattern)
ALTER TABLE ci_kpi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ci_kpi_settings_all" ON ci_kpi_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ci_details_all" ON ci_details FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ci_uploads_all" ON ci_uploads FOR ALL USING (true) WITH CHECK (true);

-- Index for faster CI detail queries
CREATE INDEX IF NOT EXISTS idx_ci_details_month_year ON ci_details(year, month);
