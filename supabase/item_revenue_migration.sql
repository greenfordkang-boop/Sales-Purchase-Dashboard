-- ============================================
-- Item Revenue Data Table Migration SQL
-- 품목별 매출현황 테이블 생성
-- ============================================
-- 
-- 이 SQL은 기존 schema.sql에 이미 포함되어 있지만,
-- 기존 프로젝트에 테이블만 추가하고 싶을 때 사용할 수 있습니다.
--
-- 실행 방법:
-- 1. Supabase 대시보드 → SQL Editor
-- 2. 이 파일의 내용을 복사하여 붙여넣기
-- 3. Run 버튼 클릭

-- ============================================
-- Item Revenue Data Table (품목별 매출현황)
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

-- Updated_at Trigger
DROP TRIGGER IF EXISTS update_item_revenue_data_updated_at ON item_revenue_data;
CREATE TRIGGER update_item_revenue_data_updated_at
  BEFORE UPDATE ON item_revenue_data
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 완료 메시지
-- ============================================
-- 테이블이 성공적으로 생성되었습니다!
-- 이제 품목별 매출현황 데이터를 Supabase에 저장할 수 있습니다.
