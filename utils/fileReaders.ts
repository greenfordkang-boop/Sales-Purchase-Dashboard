/**
 * fileReaders.ts — 공통 파일 읽기 유틸리티
 * SalesView, PurchaseView, SupplierView 등에 중복 정의된 함수를 통합
 */
import * as XLSX from 'xlsx';

/**
 * Excel(.xlsx/.xls) → CSV 텍스트 변환, CSV/TXT → 그대로 반환
 * (SalesView의 readFileAsCSVText 추출)
 */
export function readFileAsCSVText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const csvText = XLSX.utils.sheet_to_csv(firstSheet);
          resolve(csvText);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve((event.target?.result as string) || '');
      };
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsText(file);
    }
  });
}

/**
 * CSV 인코딩 자동 감지 (UTF-8 → 깨짐 시 EUC-KR 재시도)
 * (PurchaseView/SupplierView의 readCsvWithEncoding 추출 — Promise 래퍼)
 */
export function readCsvWithEncoding(file: File): Promise<string> {
  return new Promise((resolve) => {
    const readAsEncoding = (encoding: string, cb: (text: string) => void) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        cb((event.target?.result as string) || '');
      };
      reader.onerror = () => {
        console.error(`파일 읽기 실패 (${encoding})`);
        cb('');
      };
      reader.readAsText(file, encoding);
    };

    readAsEncoding('utf-8', (utf8Text) => {
      if (!utf8Text) {
        readAsEncoding('euc-kr', (eucKrText) => resolve(eucKrText || ''));
        return;
      }
      const brokenPattern = /�|Ã.|Â./g;
      const brokenMatches = utf8Text.match(brokenPattern);
      const brokenRatio = brokenMatches ? brokenMatches.length / utf8Text.length : 0;

      if (brokenRatio > 0.01) {
        readAsEncoding('euc-kr', (eucKrText) => resolve(eucKrText || utf8Text));
      } else {
        resolve(utf8Text);
      }
    });
  });
}

/**
 * Excel → ArrayBuffer (표준재료비/BOM마스터용)
 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      resolve(event.target?.result as ArrayBuffer);
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsArrayBuffer(file);
  });
}
