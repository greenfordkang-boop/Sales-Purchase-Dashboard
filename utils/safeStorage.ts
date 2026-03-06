/**
 * localStorage.setItem의 안전한 래퍼.
 * QuotaExceededError 발생 시 오래된 캐시를 정리하고 재시도.
 * 그래도 실패하면 무시 (앱 기능에 영향 없음 - localStorage는 캐시 용도).
 */

/** 수동 입력 데이터 — quota recovery 시 절대 삭제하지 않음 */
const PROTECTED_KEYS = new Set([
  'dashboard_closingMaterialCost',
  'dashboard_bomConfirmed',
]);

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // 오래된/큰 캐시 항목 정리 후 재시도 (보호 키 제외)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('dashboard_') && k !== key && !PROTECTED_KEYS.has(k)) {
          keysToRemove.push(k);
        }
      }
      // 가장 큰 항목부터 제거
      keysToRemove
        .sort((a, b) => (localStorage.getItem(b)?.length || 0) - (localStorage.getItem(a)?.length || 0))
        .slice(0, 3)
        .forEach(k => localStorage.removeItem(k));

      try {
        localStorage.setItem(key, value);
      } catch {
        // 여전히 실패하면 무시 - Supabase에서 다시 로드 가능
        console.warn(`localStorage 용량 초과로 캐시 저장 건너뜀: ${key}`);
      }
    }
  }
}
