/**
 * excelExporter.ts — 카테고리별 전용 다운로드 함수
 * 다운로드한 .xlsx 파일을 다시 업로드하면 100% 파싱되도록
 * 업로드 파서가 인식하는 한글 헤더를 그대로 사용
 */
import * as XLSX from 'xlsx';
import type { ProductInfoItem, PurchasePrice, OutsourcePrice, PaintMixRatio, MaterialPrice } from './standardMaterialParser';
import type { MaterialCodeRecord } from './bomMasterParser';
import type { ItemRevenueRow } from './revenueDataParser';

function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** (1) 품목정보 다운로드 */
export function downloadProductInfo(data: ProductInfoItem[]) {
  const headers = [
    '품목코드', '고객사 P/N', '품목명', '품목구분', '품목유형', '조달구분',
    'NET중량', 'Runner중량', '금형Cavity',
    '1도 표준 Paint량', '2도 표준 Paint량', '3도 표준 Paint량', '4도 표준 Paint량',
    '원재료코드1', '원재료코드2', '원재료코드3', '원재료코드4',
    'Loss율', 'LOT수량',
  ];
  const rows = data.map(d => [
    d.itemCode, d.customerPn, d.itemName, d.itemType, d.processType, d.supplyType,
    d.netWeight, d.runnerWeight, d.cavity,
    d.paintQty1, d.paintQty2, d.paintQty3, d.paintQty4,
    d.rawMaterialCode1, d.rawMaterialCode2, d.rawMaterialCode3, d.rawMaterialCode4,
    d.lossRate, d.lotQty,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '품목정보');
  saveWorkbook(wb, '품목정보.xlsx');
}

/** (2) 구매단가 다운로드 */
export function downloadPurchasePrice(data: PurchasePrice[]) {
  const headers = ['품목코드', '고객사 P/N', '품목명', '업체명', '현재단가', '최초단가'];
  const rows = data.map(d => [
    d.itemCode, d.customerPn, d.itemName, d.supplier, d.currentPrice, d.previousPrice,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '구매단가');
  saveWorkbook(wb, '구매단가.xlsx');
}

/** (3) 외주사출판매가 다운로드 */
export function downloadOutsourcePrice(data: OutsourcePrice[]) {
  const headers = ['품목코드', '고객사 P/N', '품목명', '협력업체', '사출판매가'];
  const rows = data.map(d => [
    d.itemCode, d.customerPn, d.itemName, d.supplier, d.injectionPrice,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '외주사출판매가');
  saveWorkbook(wb, '외주사출판매가.xlsx');
}

/** (4) 재질정보 다운로드 */
export function downloadMaterialCode(data: MaterialCodeRecord[]) {
  const headers = [
    '업종코드', '업종명', '재질코드', '재질명', '재질분류', '도료구분', '색상',
    '단위', '안전재고량', '일평균사용량', 'Loss율', '유효기간', '발주 SIZE',
    '사용여부', '보호항목', '단가',
  ];
  const rows = data.map(d => [
    d.industryCode, d.materialType, d.materialCode, d.materialName,
    d.materialCategory, d.paintCategory, d.color, d.unit,
    d.safetyStock, d.dailyAvgUsage, d.lossRate, d.validDays, d.orderSize,
    d.useYn, d.protectedItem, d.currentPrice,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '재질정보');
  saveWorkbook(wb, '재질정보.xlsx');
}

/** (5) 재질단가 다운로드 (currentPrice > 0 필터된 데이터 전용) */
export function downloadMaterialPrice(data: MaterialCodeRecord[]) {
  const headers = ['재질코드', '재질명', '품목유형', '현재단가', '전월단가'];
  const rows = data.map(d => [
    d.materialCode, d.materialName,
    d.materialCategory?.includes('도장') ? '도장' : (d.materialCategory?.includes('사출') ? '사출' : ''),
    d.currentPrice, 0,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '재질단가');
  saveWorkbook(wb, '재질단가.xlsx');
}

/** (6) 도료배합비율 다운로드 */
export function downloadPaintMixRatio(data: PaintMixRatio[]) {
  const headers = [
    '도료코드', '도료명', '주제코드', '주제비율', '경화제코드', '경화제비율',
    '희석제코드', '희석제비율',
  ];
  const rows = data.map(d => [
    d.paintCode, d.paintName, d.mainCode, d.mainRatio,
    d.hardenerCode, d.hardenerRatio, d.thinnerCode, d.thinnerRatio,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '도료배합비율');
  saveWorkbook(wb, '도료배합비율.xlsx');
}

/** (7) 품목매출현황 다운로드 */
export function downloadItemRevenue(data: ItemRevenueRow[]) {
  const headers = ['기간', '거래선', '차종', '품번', '고객사 P/N', '품명', '수량', '금액'];
  const rows = data.map(d => [
    d.period, d.customer, d.model, d.partNo, d.customerPN, d.partName, d.qty, d.amount,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '품목매출현황');
  saveWorkbook(wb, '품목매출현황.xlsx');
}
