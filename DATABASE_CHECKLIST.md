# 데이터베이스 동기화 문제 해결 체크리스트

## 발견된 문제점

### 1. 코드 문제 (수정 완료 ✅)
- **SalesView.tsx**: Sales, CR, RFQ 데이터를 Supabase에서 로드하지 않음
- **파일 업로드 핸들러**: Sales, CR, RFQ 업로드 시 Supabase 저장 누락

### 2. 수정 사항

#### ✅ SalesView.tsx 수정
- 모든 데이터 타입(Sales, Revenue, CR, RFQ)을 Supabase에서 로드하도록 `useEffect` 수정
- 파일 업로드 핸들러에 Supabase 저장 로직 추가

## 데이터베이스 확인 사항

### 1. 테이블 존재 확인
Supabase Table Editor에서 다음 테이블들이 존재하는지 확인:
- [ ] `sales_data`
- [ ] `revenue_data`
- [ ] `purchase_data`
- [ ] `inventory_data`
- [ ] `cr_data`
- [ ] `rfq_data`

### 2. Row Level Security (RLS) 확인
**중요**: RLS가 활성화되어 있으면 모든 사용자가 데이터를 볼 수 없습니다!

Supabase SQL Editor에서 다음 쿼리 실행:
```sql
-- RLS 상태 확인
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('sales_data', 'revenue_data', 'purchase_data', 'inventory_data', 'cr_data', 'rfq_data');
```

**RLS가 활성화되어 있는 경우**:
- RLS를 비활성화하거나
- 모든 사용자에게 접근을 허용하는 정책을 생성해야 합니다

```sql
-- 옵션 1: RLS 비활성화 (개발 환경)
ALTER TABLE sales_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE cr_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_data DISABLE ROW LEVEL SECURITY;

-- 옵션 2: 모든 사용자 접근 허용 정책 생성 (프로덕션 권장)
-- (RLS가 활성화된 경우)
CREATE POLICY "Allow all operations" ON sales_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON revenue_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON purchase_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON inventory_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON cr_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations" ON rfq_data FOR ALL USING (true) WITH CHECK (true);
```

### 3. 데이터 확인
각 테이블에 데이터가 있는지 확인:
```sql
SELECT 'sales_data' as table_name, COUNT(*) as row_count FROM sales_data
UNION ALL
SELECT 'revenue_data', COUNT(*) FROM revenue_data
UNION ALL
SELECT 'purchase_data', COUNT(*) FROM purchase_data
UNION ALL
SELECT 'inventory_data', COUNT(*) FROM inventory_data
UNION ALL
SELECT 'cr_data', COUNT(*) FROM cr_data
UNION ALL
SELECT 'rfq_data', COUNT(*) FROM rfq_data;
```

### 4. Supabase 연결 설정 확인
`.env` 파일 또는 환경 변수에서 Supabase 설정 확인:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 테스트 절차

### 1. 로컬에서 테스트
1. 파일 업로드 실행
2. 브라우저 콘솔에서 다음 메시지 확인:
   - `✅ 영업 데이터 Supabase 동기화 완료`
   - `✅ CR 데이터 Supabase 동기화 완료`
   - `✅ RFQ 데이터 Supabase 동기화 완료`
   - `✅ Supabase에서 영업 데이터 로드: X개 고객`
   - `✅ Supabase에서 CR 데이터 로드: X개`
   - `✅ Supabase에서 RFQ 데이터 로드: X개`

### 2. 다른 사용자 환경에서 테스트
1. 다른 컴퓨터/브라우저에서 앱 열기
2. 페이지 로드 시 Supabase에서 데이터가 자동으로 로드되는지 확인
3. 콘솔에서 로드 메시지 확인

### 3. 데이터 일치 확인
1. 로컬에서 파일 업로드
2. Supabase Table Editor에서 데이터 확인
3. 다른 사용자 화면에서 동일한 데이터가 표시되는지 확인

## 문제 해결 가이드

### 문제: 다른 사용자가 데이터를 볼 수 없음
1. **RLS 확인**: 가장 흔한 원인입니다. 위의 RLS 확인 절차를 따르세요.
2. **Supabase 연결 확인**: 환경 변수가 올바르게 설정되어 있는지 확인
3. **콘솔 에러 확인**: 브라우저 개발자 도구에서 에러 메시지 확인
4. **네트워크 확인**: Supabase API 호출이 성공하는지 Network 탭에서 확인

### 문제: 데이터가 저장되지 않음
1. **콘솔 에러 확인**: Supabase 저장 실패 메시지 확인
2. **권한 확인**: Supabase에서 테이블에 INSERT 권한이 있는지 확인
3. **데이터 형식 확인**: 업로드한 CSV 파일 형식이 올바른지 확인

## 추가 권장 사항

1. **실시간 동기화**: 필요시 Supabase Realtime을 사용하여 실시간 동기화 구현
2. **에러 처리 개선**: 사용자에게 명확한 에러 메시지 표시
3. **동기화 상태 표시**: UI에 동기화 상태 표시 (예: "동기화 중...", "동기화 완료")
