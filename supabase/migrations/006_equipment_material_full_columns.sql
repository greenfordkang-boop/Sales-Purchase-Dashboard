-- ============================================
-- 설비코드 마스터: 원본 15컬럼 전체 지원 확장
-- 기존 3필드 → 14필드 (No 제외)
-- ============================================

ALTER TABLE equipment_master
  ADD COLUMN IF NOT EXISTS site TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS variety TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS line TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS direct_indirect TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_hours NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_minutes NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_seconds NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS management_no TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS equipment_no TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS use_yn TEXT DEFAULT 'Y';

-- tonnage 컬럼 타입 변경: NUMERIC → TEXT (원본에 텍스트 값 포함)
ALTER TABLE equipment_master ALTER COLUMN tonnage TYPE TEXT USING tonnage::TEXT;

-- ============================================
-- 재질코드 마스터: 원본 16컬럼 전체 지원 확장
-- 기존 6필드 → 15필드 (No 제외, +단가 유지)
-- ============================================

ALTER TABLE material_code_master
  ADD COLUMN IF NOT EXISTS industry_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS material_category TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS paint_category TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS safety_stock NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_avg_usage NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_days NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_size TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS use_yn TEXT DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS protected_item TEXT DEFAULT '';
