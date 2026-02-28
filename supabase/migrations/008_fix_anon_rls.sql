-- ============================================
-- Fix RLS: Allow anon full access to BOM/reference tables
-- (기존 004에서 authenticated만 허용 → anon도 추가)
-- ============================================

CREATE POLICY "Allow anon full access on bom_master"
  ON bom_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on product_code_master"
  ON product_code_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on reference_info_master"
  ON reference_info_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on equipment_master"
  ON equipment_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on material_code_master"
  ON material_code_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on mrp_results"
  ON mrp_results FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on data_quality_issues"
  ON data_quality_issues FOR ALL USING (true) WITH CHECK (true);
