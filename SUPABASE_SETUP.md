# Supabase 셋업 가이드

이 프로젝트는 Supabase를 백엔드 데이터베이스로 사용합니다. Supabase가 설정되지 않은 경우, 데이터는 브라우저의 localStorage에 저장됩니다.

## 1. Supabase 프로젝트 생성

1. [Supabase](https://supabase.com)에 가입/로그인
2. "New Project" 클릭
3. 프로젝트 이름, 데이터베이스 비밀번호, 리전 선택 후 생성
4. 프로젝트 생성 완료까지 1-2분 대기

## 2. API 키 확인

1. Supabase 대시보드에서 프로젝트 선택
2. 좌측 메뉴에서 **Settings** → **API** 클릭
3. 다음 값들을 복사:
   - **Project URL** (예: `https://xxxxx.supabase.co`)
   - **anon/public key** (예: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)

## 3. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 입력:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**예시:**
```bash
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjIzOTAyMiwiZXhwIjoxOTMxODE1MDIyfQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

⚠️ **주의**: `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다. 실제 값은 직접 입력해야 합니다.

## 4. 데이터베이스 스키마 생성

1. Supabase 대시보드에서 좌측 메뉴 **SQL Editor** 클릭
2. "New query" 클릭
3. `supabase/schema.sql` 파일의 전체 내용을 복사하여 붙여넣기
4. "Run" 버튼 클릭 (또는 `Ctrl/Cmd + Enter`)
5. 모든 테이블이 성공적으로 생성되었는지 확인

**생성되는 테이블:**
- `sales_data` - 영업 계획/실적 데이터
- `revenue_data` - 매출 실적 데이터
- `purchase_data` - 구매 입고 데이터
- `inventory_data` - 재고 데이터 (기존)
- `inventory_v2` - 재고 데이터 V2 (Resin, Paint, Parts)
- `cr_data` - Cost Reduction 데이터
- `rfq_data` - 견적 요청 데이터

## 5. Row Level Security (RLS) 설정 (선택사항)

개발 환경에서는 RLS를 비활성화해도 되지만, 프로덕션에서는 보안을 위해 활성화하는 것을 권장합니다.

**RLS 비활성화 (개발용):**
- `schema.sql`의 RLS 관련 주석을 해제하지 않으면 기본적으로 비활성화됩니다.

**RLS 활성화 (프로덕션용):**
1. `schema.sql`에서 RLS 관련 주석을 해제
2. Supabase SQL Editor에서 다시 실행

## 6. 확인

1. 개발 서버 재시작:
   ```bash
   npm run dev
   ```

2. 브라우저 콘솔 확인:
   - Supabase가 제대로 연결되면 "✅ Supabase 연결 성공" 메시지가 표시됩니다
   - 연결 실패 시 "Supabase credentials not found. Using localStorage fallback." 경고가 표시됩니다

3. 데이터 업로드 테스트:
   - 대시보드에서 CSV 파일을 업로드해보세요
   - Supabase 대시보드의 **Table Editor**에서 데이터가 저장되었는지 확인할 수 있습니다

## 문제 해결

### "Supabase credentials not found" 경고가 나타나는 경우
- `.env` 파일이 프로젝트 루트에 있는지 확인
- `.env` 파일의 변수명이 정확한지 확인 (`VITE_` 접두사 필수)
- 개발 서버를 재시작했는지 확인

### 테이블이 생성되지 않는 경우
- SQL Editor에서 에러 메시지 확인
- 각 테이블이 이미 존재하는 경우 `CREATE TABLE IF NOT EXISTS` 구문으로 인해 에러 없이 스킵됩니다
- **Table Editor**에서 테이블 목록 확인

### 데이터가 저장되지 않는 경우
- 브라우저 콘솔에서 에러 메시지 확인
- Supabase 대시보드의 **Logs** 메뉴에서 API 요청 로그 확인
- RLS가 활성화되어 있다면 정책을 확인하세요

## 추가 리소스

- [Supabase 공식 문서](https://supabase.com/docs)
- [Supabase JavaScript 클라이언트 가이드](https://supabase.com/docs/reference/javascript/introduction)
