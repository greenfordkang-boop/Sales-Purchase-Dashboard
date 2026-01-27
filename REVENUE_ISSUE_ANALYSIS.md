# Revenue 업로더 문제 분석

## 🔍 발견된 문제점

### 문제 1: saveByYear에서 에러를 throw하지 않음
**위치**: `services/supabaseService.ts:233-275`

```typescript
async saveByYear(data: RevenueItem[], year: number): Promise<void> {
  try {
    // ... 삭제 및 삽입 로직
    await insertInBatches('revenue_data', rows, REVENUE_BATCH_SIZE);
    console.log(`✅ Revenue data for year ${year} saved to Supabase (${rows.length} rows)`);
  } catch (error) {
    console.error('Failed to save revenue data by year:', error);
    // Don't throw - localStorage already has the data  ⚠️ 문제!
  }
}
```

**문제**: 
- `insertInBatches`가 실패해도 에러를 throw하지 않음
- `handleRevFileUpload`에서는 성공했다고 가정하고 계속 진행
- 실제로는 Supabase에 데이터가 저장되지 않았을 수 있음

### 문제 2: handleRevFileUpload의 로직 흐름
**위치**: `components/SalesView.tsx:426-475`

```typescript
await revenueService.saveByYear(newData, uploadYear);
console.log(`✅ Supabase 동기화 완료: ${uploadYear}년`);  // 항상 실행됨

// Supabase에서 최신 데이터 재로드
const latestData = await revenueService.getAll();  // 오래된 데이터를 가져올 수 있음
```

**문제**:
- `saveByYear`가 실패해도 성공 메시지가 표시됨
- `getAll()`이 오래된 데이터를 반환할 수 있음

### 문제 3: insertInBatches의 에러 처리
**위치**: `services/supabaseService.ts:33-86`

`insertInBatches`는 내부적으로 에러를 처리하지만, 완전히 실패한 경우에도 계속 진행할 수 있음.

## 💡 해결 방안

### 방안 1: saveByYear에서 에러를 throw하도록 수정
- 실패 시 명확하게 에러를 throw
- handleRevFileUpload에서 에러를 처리

### 방안 2: saveByYear의 반환값으로 성공/실패 여부 확인
- boolean 또는 결과 객체 반환
- handleRevFileUpload에서 결과 확인 후 처리

### 방안 3: saveAll 사용 (전체 데이터 저장)
- saveByYear 대신 saveAll 사용
- 더 단순하고 확실한 방법

## 🎯 권장 해결책

**saveByYear를 수정하여 에러를 제대로 throw하고, handleRevFileUpload에서 에러를 처리하도록 변경**

또는

**saveAll을 사용하여 전체 데이터를 저장하는 방식으로 변경 (더 단순하고 확실)**
