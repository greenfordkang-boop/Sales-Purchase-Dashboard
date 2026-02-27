-- ============================================
-- BOM 마스터 테이블 (파란색 5개 탭 + MRP 결과 + 데이터 품질)
-- ============================================

-- 1. BOM 마스터 (BOM 시트)
CREATE TABLE IF NOT EXISTS bom_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_pn TEXT NOT NULL,
  child_pn TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  qty NUMERIC DEFAULT 1,
  child_name TEXT DEFAULT '',
  part_type TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bom_master_parent ON bom_master(parent_pn);
CREATE INDEX IF NOT EXISTS idx_bom_master_child ON bom_master(child_pn);

-- 2. 제품코드 마스터 (제품코드 시트)
CREATE TABLE IF NOT EXISTS product_code_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_code TEXT NOT NULL UNIQUE,
  customer_pn TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  model TEXT DEFAULT '',
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_code_customer_pn ON product_code_master(customer_pn);

-- 3. 기준정보 마스터 (기준정보 시트)
CREATE TABLE IF NOT EXISTS reference_info_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  customer_pn TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  supply_type TEXT DEFAULT '',
  process_type TEXT DEFAULT '',
  net_weight NUMERIC DEFAULT 0,
  runner_weight NUMERIC DEFAULT 0,
  cavity INTEGER DEFAULT 1,
  loss_rate NUMERIC DEFAULT 0,
  paint_qty_1 NUMERIC DEFAULT 0,
  paint_qty_2 NUMERIC DEFAULT 0,
  paint_qty_3 NUMERIC DEFAULT 0,
  raw_material_code_1 TEXT DEFAULT '',
  raw_material_code_2 TEXT DEFAULT '',
  raw_material_code_3 TEXT DEFAULT '',
  raw_material_code_4 TEXT DEFAULT '',
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ref_info_customer_pn ON reference_info_master(customer_pn);

-- 4. 설비코드 마스터 (설비코드 시트)
CREATE TABLE IF NOT EXISTS equipment_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_code TEXT NOT NULL UNIQUE,
  equipment_name TEXT DEFAULT '',
  tonnage NUMERIC DEFAULT 0,
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 재질코드 마스터 (재질코드 시트)
CREATE TABLE IF NOT EXISTS material_code_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code TEXT NOT NULL UNIQUE,
  material_name TEXT DEFAULT '',
  material_type TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  loss_rate NUMERIC DEFAULT 0,
  current_price NUMERIC DEFAULT 0,
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_code_type ON material_code_master(material_type);

-- 6. MRP 결과 (계산 결과 저장)
CREATE TABLE IF NOT EXISTS mrp_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT DEFAULT '',
  material_type TEXT DEFAULT '',
  required_qty NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  parent_products JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mrp_year_month ON mrp_results(year, month);
CREATE INDEX IF NOT EXISTS idx_mrp_material ON mrp_results(material_code);

-- 7. 데이터 품질 이슈 (파란→빨간 탭 대체)
CREATE TABLE IF NOT EXISTS data_quality_issues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_type TEXT NOT NULL,
  item_code TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  field_name TEXT DEFAULT '',
  severity TEXT DEFAULT 'warning',
  description TEXT DEFAULT '',
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dq_type ON data_quality_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_dq_resolved ON data_quality_issues(resolved);

-- RLS 정책
ALTER TABLE bom_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_code_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_info_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_code_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_issues ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 접근 허용
CREATE POLICY "Allow authenticated access to bom_master"
  ON bom_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to product_code_master"
  ON product_code_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to reference_info_master"
  ON reference_info_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to equipment_master"
  ON equipment_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to material_code_master"
  ON material_code_master FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to mrp_results"
  ON mrp_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to data_quality_issues"
  ON data_quality_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
