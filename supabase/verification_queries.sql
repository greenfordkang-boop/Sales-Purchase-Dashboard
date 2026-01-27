-- ============================================
-- 데이터베이스 검증 쿼리
-- Supabase SQL Editor에서 실행하세요
-- ============================================

-- 1. 재고 데이터 확인
-- 재고 데이터 개수 확인
SELECT 
  type,
  COUNT(*) as count
FROM inventory_data
GROUP BY type
ORDER BY type;

-- 최근 업데이트된 재고 데이터 확인
SELECT 
  type,
  COUNT(*) as count,
  MAX(updated_at) as last_updated
FROM inventory_data
GROUP BY type
ORDER BY type;

-- 2. Revenue 데이터 확인
-- 연도별 Revenue 데이터 개수
SELECT 
  year,
  COUNT(*) as count,
  SUM(amount) as total_amount
FROM revenue_data
GROUP BY year
ORDER BY year DESC;

-- 최근 업데이트된 Revenue 데이터 확인
SELECT 
  year,
  COUNT(*) as count,
  MAX(updated_at) as last_updated
FROM revenue_data
GROUP BY year
ORDER BY year DESC;

-- 3. 구매 데이터 확인
-- 카테고리별 구매 데이터 개수
SELECT 
  category,
  COUNT(*) as count
FROM purchase_data
GROUP BY category
ORDER BY category;

-- 최근 업데이트된 구매 데이터 확인
SELECT 
  category,
  COUNT(*) as count,
  MAX(updated_at) as last_updated
FROM purchase_data
GROUP BY category
ORDER BY category;

-- 4. 전체 데이터 일관성 확인
-- 모든 테이블의 데이터 개수 및 최근 업데이트 시간
SELECT 
  'sales_data' as table_name,
  COUNT(*) as row_count,
  MAX(updated_at) as last_updated
FROM sales_data
UNION ALL
SELECT 
  'revenue_data',
  COUNT(*),
  MAX(updated_at)
FROM revenue_data
UNION ALL
SELECT 
  'purchase_data',
  COUNT(*),
  MAX(updated_at)
FROM purchase_data
UNION ALL
SELECT 
  'inventory_data',
  COUNT(*),
  MAX(updated_at)
FROM inventory_data
UNION ALL
SELECT 
  'cr_data',
  COUNT(*),
  MAX(updated_at)
FROM cr_data
UNION ALL
SELECT 
  'rfq_data',
  COUNT(*),
  MAX(updated_at)
FROM rfq_data
ORDER BY table_name;
