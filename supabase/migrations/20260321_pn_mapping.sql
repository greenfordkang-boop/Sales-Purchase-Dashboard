-- pn_mapping: 자재마스터 (품번 매핑) 영구 저장 테이블
CREATE TABLE IF NOT EXISTS pn_mapping (
  id SERIAL PRIMARY KEY,
  customer_pn TEXT NOT NULL,
  internal_code TEXT NOT NULL,
  part_name TEXT DEFAULT '',
  raw_material_code1 TEXT,
  raw_material_code2 TEXT,
  supply_type TEXT,
  process_type TEXT,
  purchase_unit_price NUMERIC DEFAULT 0,
  material_cost NUMERIC DEFAULT 0,
  injection_cost NUMERIC DEFAULT 0,
  paint_cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_pn, internal_code)
);

-- RLS 설정
ALTER TABLE pn_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_pn_mapping ON pn_mapping;
CREATE POLICY allow_all_pn_mapping ON pn_mapping FOR ALL USING (true) WITH CHECK (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_pn_mapping_customer_pn ON pn_mapping (customer_pn);
CREATE INDEX IF NOT EXISTS idx_pn_mapping_internal_code ON pn_mapping (internal_code);
