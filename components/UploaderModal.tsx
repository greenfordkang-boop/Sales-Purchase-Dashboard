/**
 * UploaderModal — 통합 업로더 모달
 * 16개 업로더를 2-column 레이아웃으로 한 화면에 표시
 * RPA(UiPath) 최적화: data-uploader 속성으로 셀렉터 타겟팅
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadResult,
  uploadSalesQty,
  uploadRevenue,
  uploadItemRevenue,
  uploadRfq,
  uploadCR,
  uploadPartsInbound,
  uploadMaterialInbound,
  uploadBomMaster,
  uploadMaterialMaster,
  uploadStandardMix,
  uploadMaterialPrice,
  uploadPaintMixLog,
  uploadResinInventory,
  uploadPaintInventory,
  uploadPartsInventory,
  uploadSupplier,
} from '../utils/centralUploadHandlers';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface UploaderState {
  status: UploadStatus;
  message: string;
  completedAt?: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i); // e.g. 2024~2028
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const STORAGE_KEY = 'uploader-states-sales-purchase';
const loadPersistedStates = (): Record<string, UploaderState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(parsed)) {
        if (parsed[key].status === 'uploading') parsed[key] = { status: 'idle', message: '' };
      }
      return parsed;
    }
  } catch {}
  return {};
};
const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const UploaderModal: React.FC<Props> = ({ isOpen, onClose }) => {
  // 파라미터 상태
  const [revenueYear, setRevenueYear] = useState(CURRENT_YEAR);
  const [crYear, setCrYear] = useState(CURRENT_YEAR);
  const [partsMonth, setPartsMonth] = useState(`${new Date().getMonth() + 1}월`);
  const [partsYear, setPartsYear] = useState(CURRENT_YEAR);
  const [materialMonth, setMaterialMonth] = useState(`${new Date().getMonth() + 1}월`);
  const [materialYear, setMaterialYear] = useState(CURRENT_YEAR);

  // 업로드 상태 (16개) — localStorage에서 복원
  const [states, setStates] = useState<Record<string, UploaderState>>(loadPersistedStates);

  // file input refs
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ESC 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const setRef = useCallback((id: string) => (el: HTMLInputElement | null) => {
    inputRefs.current[id] = el;
  }, []);

  const updateState = (id: string, state: UploaderState) => {
    const finalState = (state.status === 'success' || state.status === 'error')
      ? { ...state, completedAt: new Date().toISOString() }
      : state;
    setStates(prev => {
      const next = { ...prev, [id]: finalState };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleUpload = async (
    id: string,
    file: File,
    handler: (file: File) => Promise<UploadResult>
  ) => {
    updateState(id, { status: 'uploading', message: '업로드 중...' });
    try {
      const result = await handler(file);
      updateState(id, {
        status: result.success ? 'success' : 'error',
        message: result.message,
      });
    } catch (e: any) {
      updateState(id, { status: 'error', message: e.message || '실패' });
    }
  };

  const triggerInput = (id: string) => {
    inputRefs.current[id]?.click();
  };

  const onFileChange = (id: string, handler: (file: File) => Promise<UploadResult>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(id, file, handler);
      e.target.value = '';
    };

  if (!isOpen) return null;

  const getState = (id: string): UploaderState => states[id] || { status: 'idle', message: '' };

  const StatusBadge = ({ id }: { id: string }) => {
    const s = getState(id);
    if (s.status === 'idle') return null;
    if (s.status === 'uploading') {
      return (
        <span className="flex items-center gap-1 text-blue-600 text-[11px]" data-upload-status="uploading">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          처리중
        </span>
      );
    }
    if (s.status === 'success') {
      return (
        <span className="flex items-center gap-1 text-emerald-600 text-[11px] font-medium" data-upload-status="success">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          {s.message}
          {s.completedAt && <span className="text-gray-400 font-normal ml-0.5">{formatTime(s.completedAt)}</span>}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-rose-500 text-[11px] font-medium" data-upload-status="error" title={s.message}>
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
        {s.message}
        {s.completedAt && <span className="text-rose-300 font-normal ml-0.5">{formatTime(s.completedAt)}</span>}
      </span>
    );
  };

  const FormatBadge = ({ format }: { format: 'CSV' | 'XLS' }) => (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
      format === 'CSV' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {format}
    </span>
  );

  const SelectYear = ({ value, onChange, testId }: { value: number; onChange: (v: number) => void; testId: string }) => (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="h-6 text-[11px] bg-slate-100 border border-slate-300 rounded px-1 appearance-none cursor-pointer"
      data-uploader-param={testId}
    >
      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );

  const SelectMonth = ({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-6 text-[11px] bg-slate-100 border border-slate-300 rounded px-1 appearance-none cursor-pointer"
      data-uploader-param={testId}
    >
      {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  );

  const SelectMonthYear = ({ month, year, onMonthChange, onYearChange, idPrefix }: {
    month: string; year: number; onMonthChange: (v: string) => void; onYearChange: (v: number) => void; idPrefix: string;
  }) => (
    <span className="flex items-center gap-0.5">
      <SelectYear value={year} onChange={onYearChange} testId={`${idPrefix}-year`} />
      <SelectMonth value={month} onChange={onMonthChange} testId={`${idPrefix}-month`} />
    </span>
  );

  const FileBtn = ({ id, accept }: { id: string; accept: string }) => (
    <button
      onClick={() => triggerInput(id)}
      className="h-6 px-2.5 text-[11px] font-semibold bg-slate-800 text-white rounded hover:bg-slate-700 transition-colors whitespace-nowrap"
      data-uploader={id}
    >
      파일선택
    </button>
  );

  // 업로더 행 렌더 — 고정 너비로 파일선택 버튼 정렬
  const Row = ({ id, label, format, accept, handler, params }: {
    id: string;
    label: string;
    format: 'CSV' | 'XLS';
    accept: string;
    handler: (file: File) => Promise<UploadResult>;
    params?: React.ReactNode;
  }) => (
    <div className="flex items-center h-7 gap-2" data-uploader-row={id}>
      <span className="text-[12px] font-medium text-slate-700 w-[72px] shrink-0 truncate" title={label}>{label}</span>
      <span className="flex items-center gap-1 w-[110px] shrink-0">{params}</span>
      <FormatBadge format={format} />
      <span className="shrink-0">
        <FileBtn id={id} accept={accept} />
      </span>
      <input
        ref={setRef(id)}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onFileChange(id, handler)}
        data-uploader-input={id}
      />
      <span className="flex-1 min-w-0 truncate text-right">
        <StatusBadge id={id} />
      </span>
    </div>
  );

  const csvAccept = '.csv,.txt,.xlsx,.xls';
  const xlsAccept = '.xlsx,.xls';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[880px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-base font-bold text-slate-800">데이터 업로더</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
          >
            &times;
          </button>
        </div>

        {/* Body — 2 column grid */}
        <div className="grid grid-cols-2 gap-x-6 px-5 py-4">
          {/* ── 왼쪽: 영업 + 재고 ── */}
          <div className="space-y-3">
            {/* 영업현황 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">영업현황</span>
              </div>
              <div className="space-y-1.5">
                <Row id="sales-qty" label="수량 업로드" format="CSV" accept={csvAccept}
                  handler={uploadSalesQty} />
                <Row id="sales-revenue" label="매출 업로드" format="CSV" accept={csvAccept}
                  handler={(f) => uploadRevenue(f, revenueYear)}
                  params={<SelectYear value={revenueYear} onChange={setRevenueYear} testId="revenue-year" />} />
                <Row id="sales-item-revenue" label="품목별매출" format="CSV" accept={csvAccept}
                  handler={uploadItemRevenue} />
                <Row id="sales-rfq" label="RFQ" format="CSV" accept={csvAccept}
                  handler={uploadRfq} />
                <Row id="sales-cr" label="CR 업로드" format="CSV" accept={csvAccept}
                  handler={(f) => uploadCR(f, crYear)}
                  params={<SelectYear value={crYear} onChange={setCrYear} testId="cr-year" />} />
              </div>
            </div>

            {/* 재고관리 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">재고관리</span>
              </div>
              <div className="space-y-1.5">
                <Row id="inv-resin" label="수지 재고" format="CSV" accept={csvAccept}
                  handler={uploadResinInventory} />
                <Row id="inv-paint" label="도료 재고" format="CSV" accept={csvAccept}
                  handler={uploadPaintInventory} />
                <Row id="inv-parts" label="부품 재고" format="CSV" accept={csvAccept}
                  handler={uploadPartsInventory} />
              </div>
            </div>
          </div>

          {/* ── 오른쪽: 구매 + 협력사 ── */}
          <div className="space-y-3">
            {/* 구매현황 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">구매현황</span>
              </div>
              <div className="space-y-1.5">
                <Row id="purch-parts" label="부품 입고" format="CSV" accept={csvAccept}
                  handler={(f) => uploadPartsInbound(f, partsMonth, partsYear)}
                  params={<SelectMonthYear month={partsMonth} year={partsYear}
                    onMonthChange={setPartsMonth} onYearChange={setPartsYear} idPrefix="parts-inbound" />} />
                <Row id="purch-material" label="원재료 입고" format="CSV" accept={csvAccept}
                  handler={(f) => uploadMaterialInbound(f, materialMonth, materialYear)}
                  params={<SelectMonthYear month={materialMonth} year={materialYear}
                    onMonthChange={setMaterialMonth} onYearChange={setMaterialYear} idPrefix="material-inbound" />} />
                <Row id="purch-bom" label="BOM마스터" format="XLS" accept={xlsAccept}
                  handler={uploadBomMaster} />
                <Row id="purch-material-master" label="자재마스터" format="XLS" accept={xlsAccept}
                  handler={uploadMaterialMaster} />
                <Row id="purch-std-mix" label="배합표준서" format="XLS" accept={xlsAccept}
                  handler={uploadStandardMix} />
                <Row id="purch-mat-price" label="재질단가" format="XLS" accept={xlsAccept}
                  handler={uploadMaterialPrice} />
                <Row id="purch-mix-log" label="배합일지" format="XLS" accept={xlsAccept}
                  handler={uploadPaintMixLog} />
              </div>
            </div>

            {/* 협력사관리 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">협력사관리</span>
              </div>
              <div className="space-y-1.5">
                <Row id="supplier" label="협력사" format="CSV" accept={csvAccept}
                  handler={uploadSupplier} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400">
          파일 선택 시 자동으로 파싱 및 저장됩니다 &middot; RPA: <code className="bg-slate-200 px-1 rounded">data-uploader</code> 속성 사용
        </div>
      </div>
    </div>
  );
};

export default UploaderModal;
