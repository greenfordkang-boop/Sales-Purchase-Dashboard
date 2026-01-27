# 데이터베이스 검증 가이드

## 🔍 문제 해결 완료

### 수정 사항
1. **재고관리 업로더**: Supabase 저장 완료 후 최신 데이터 재로드
2. **영업현황 Revenue**: Supabase 저장 완료 후 최신 데이터 재로드
3. **구매현황 업로더**: Supabase 저장 완료 후 최신 데이터 재로드

### 핵심 변경
- 업로드 후 **Supabase 저장 완료를 기다림** (async/await)
- 저장 완료 후 **Supabase에서 최신 데이터를 다시 로드**
- 모든 사용자가 **동일한 Supabase 데이터**를 보도록 보장

## 📊 데이터베이스 확인 쿼리

### 1. 재고 데이터 확인
```sql
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
```

### 2. Revenue 데이터 확인
```sql
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
```

### 3. 구매 데이터 확인
```sql
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
```

### 4. 전체 데이터 일관성 확인
```sql
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
```

## 🧪 테스트 절차

### 1. 재고관리 테스트
1. **로컬에서 파일 업로드**
2. **콘솔 확인**:
   ```
   ✅ warehouse 재고 Supabase 동기화 완료
   ✅ Supabase에서 최신 재고 데이터 재로드 완료
   ```
3. **다른 컴퓨터에서 확인**:
   - 페이지 로드 시 Supabase에서 데이터 로드
   - 동일한 데이터가 표시되는지 확인

### 2. 영업현황 Revenue 테스트
1. **2023년 데이터 업로드**
2. **콘솔 확인**:
   ```
   ✅ 2023년 데이터 저장 완료: X개 항목
   ✅ Supabase 동기화 완료: 2023년
   ✅ Supabase에서 최신 매출 데이터 재로드 완료: X개
   ```
3. **2024년 데이터 업로드**
4. **다른 컴퓨터에서 확인**:
   - 2023년, 2024년 데이터가 모두 표시되는지 확인
   - 데이터가 동일한지 확인

### 3. 구매현황 테스트
1. **Parts 파일 업로드**
2. **콘솔 확인**:
   ```
   ✅ 부품 데이터 Supabase 동기화 완료
   ✅ Supabase에서 최신 구매 데이터 재로드 완료: X개
   ```
3. **다른 컴퓨터에서 확인**:
   - 동일한 데이터가 표시되는지 확인

## ⚠️ 문제 발생 시 확인 사항

### 문제: 여전히 데이터가 다름
1. **브라우저 캐시 삭제**: Ctrl+Shift+Delete
2. **하드 리프레시**: Ctrl+Shift+R (또는 Cmd+Shift+R)
3. **localStorage 확인**: 개발자 도구 > Application > Local Storage
4. **Supabase 데이터 확인**: 위의 SQL 쿼리 실행
5. **콘솔 에러 확인**: 개발자 도구 > Console

### 문제: Supabase 저장 실패
1. **네트워크 확인**: 인터넷 연결 확인
2. **Supabase 연결 확인**: 환경 변수 확인
3. **콘솔 에러 확인**: 구체적인 에러 메시지 확인
4. **RLS 확인**: Row Level Security 비활성화 확인

## ✅ 성공 기준

- ✅ 파일 업로드 후 Supabase 저장 완료 메시지 표시
- ✅ Supabase에서 최신 데이터 재로드 완료 메시지 표시
- ✅ 다른 컴퓨터에서 동일한 데이터 표시
- ✅ Supabase Table Editor에서 데이터 확인 가능
- ✅ 콘솔에 에러 없음
