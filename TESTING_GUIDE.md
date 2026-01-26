# 데이터 동기화 테스트 가이드

## ✅ 확인 완료 사항
- RLS (Row Level Security) 비활성화 확인됨
- 모든 테이블 존재 확인됨

## 테스트 절차

### 1단계: 로컬에서 파일 업로드 테스트

1. **브라우저 개발자 도구 열기** (F12)
2. **Console 탭으로 이동**
3. **파일 업로드 실행**:
   - Sales 데이터 업로드
   - CR 데이터 업로드
   - RFQ 데이터 업로드
   - Revenue 데이터 업로드

4. **콘솔에서 다음 메시지 확인**:
   ```
   ✅ 영업 데이터 Supabase 동기화 완료
   ✅ CR 데이터 Supabase 동기화 완료
   ✅ RFQ 데이터 Supabase 동기화 완료
   ✅ Supabase 동기화 완료: 2025년
   ```

### 2단계: Supabase에서 데이터 확인

1. **Supabase Table Editor로 이동**
2. **각 테이블 확인**:
   - `sales_data` - 업로드한 데이터가 있는지 확인
   - `revenue_data` - 업로드한 데이터가 있는지 확인
   - `cr_data` - 업로드한 데이터가 있는지 확인
   - `rfq_data` - 업로드한 데이터가 있는지 확인

### 3단계: 다른 사용자 환경에서 테스트

1. **다른 컴퓨터/브라우저에서 앱 열기**
   - 또는 시크릿 모드/프라이빗 브라우징 사용
   - 또는 다른 사용자에게 테스트 요청

2. **페이지 로드 시 콘솔 확인**:
   ```
   ✅ Supabase에서 영업 데이터 로드: X개 고객
   ✅ Supabase에서 매출 데이터 로드: X개
   ✅ Supabase에서 CR 데이터 로드: X개
   ✅ Supabase에서 RFQ 데이터 로드: X개
   ```

3. **화면에 데이터가 표시되는지 확인**

### 4단계: 문제 발생 시 확인 사항

#### 문제: 콘솔에 에러 메시지가 표시됨
- **에러 내용 확인**: Network 탭에서 Supabase API 호출 실패 여부 확인
- **환경 변수 확인**: `.env` 파일에 Supabase URL과 Key가 올바른지 확인

#### 문제: 데이터가 업로드되지 않음
- **콘솔 에러 확인**: Supabase 저장 실패 메시지 확인
- **CSV 파일 형식 확인**: 파일 형식이 올바른지 확인
- **Supabase 연결 확인**: `lib/supabase.ts` 파일 확인

#### 문제: 다른 사용자가 데이터를 볼 수 없음
- **페이지 새로고침**: 브라우저 캐시 문제일 수 있음
- **localStorage 확인**: 개발자 도구 > Application > Local Storage에서 데이터 확인
- **Network 탭 확인**: Supabase API 호출이 성공하는지 확인

## 디버깅 쿼리

Supabase SQL Editor에서 다음 쿼리로 데이터 확인:

```sql
-- 모든 테이블의 데이터 개수 확인
SELECT 
  'sales_data' as table_name, 
  COUNT(*) as row_count 
FROM sales_data
UNION ALL
SELECT 'revenue_data', COUNT(*) FROM revenue_data
UNION ALL
SELECT 'purchase_data', COUNT(*) FROM purchase_data
UNION ALL
SELECT 'inventory_data', COUNT(*) FROM inventory_data
UNION ALL
SELECT 'cr_data', COUNT(*) FROM cr_data
UNION ALL
SELECT 'rfq_data', COUNT(*) FROM rfq_data
ORDER BY table_name;
```

```sql
-- 최근 업데이트된 데이터 확인 (각 테이블별)
SELECT 'sales_data' as table_name, updated_at, COUNT(*) 
FROM sales_data 
GROUP BY updated_at
ORDER BY updated_at DESC
LIMIT 5;
```

## 성공 기준

✅ **성공**: 
- 파일 업로드 후 Supabase에 데이터가 저장됨
- 다른 사용자가 페이지를 열면 동일한 데이터가 표시됨
- 콘솔에 성공 메시지가 표시됨

❌ **실패**:
- 파일 업로드 후 Supabase에 데이터가 없음
- 다른 사용자가 데이터를 볼 수 없음
- 콘솔에 에러 메시지가 표시됨

## 추가 확인 사항

1. **Supabase 프로젝트 설정**:
   - API URL과 Anon Key가 올바른지 확인
   - 프로젝트가 활성 상태인지 확인

2. **네트워크 문제**:
   - 방화벽이나 네트워크 제한이 없는지 확인
   - Supabase 서비스 상태 확인: https://status.supabase.com

3. **브라우저 캐시**:
   - 하드 리프레시 (Ctrl+Shift+R 또는 Cmd+Shift+R)
   - 브라우저 캐시 삭제
