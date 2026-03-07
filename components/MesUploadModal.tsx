/**
 * MesUploadModal — MES 마스터 데이터 개별 업로드 모달
 * 6개 데이터 유형별 파일 업로드/건수 표시
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadResult,
  uploadMesProductInfo,
  uploadMesMaterialCode,
  uploadMesPurchasePrice,
  uploadMesMaterialPrice,
  uploadMesPaintMixRatio,
  uploadMesOutsourcePrice,
} from '../utils/centralUploadHandlers';
import {
  materialCodeService,
  purchasePriceService,
  paintMixRatioService,
  outsourceInjPriceService,
  productInfoService,
} from '../services/supabaseService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type ItemStatus = 'idle' | 'uploading' | 'success' | 'error';

interface MesItemConfig {
  key: string;
  label: string;
  color: string;
  handler: (file: File) => Promise<UploadResult>;
  loadCount: () => Promise<number>;
}

const MES_ITEMS: MesItemConfig[] = [
  {
    key: 'productInfo', label: '품목정보', color: 'emerald',
    handler: uploadMesProductInfo,
    loadCount: async () => (await productInfoService.getAll()).length,
  },
  {
    key: 'materialCode', label: '재질정보', color: 'amber',
    handler: uploadMesMaterialCode,
    loadCount: async () => (await materialCodeService.getAll()).length,
  },
  {
    key: 'purchasePrice', label: '구매단가', color: 'blue',
    handler: uploadMesPurchasePrice,
    loadCount: async () => (await purchasePriceService.getAll()).length,
  },
  {
    key: 'materialPrice', label: '재질단가', color: 'orange',
    handler: uploadMesMaterialPrice,
    loadCount: async () => (await materialCodeService.getAll()).filter(m => m.currentPrice > 0).length,
  },
  {
    key: 'paintMix', label: '도료배합비율', color: 'pink',
    handler: uploadMesPaintMixRatio,
    loadCount: async () => (await paintMixRatioService.getAll()).length,
  },
  {
    key: 'outsource', label: '외주사출판매가', color: 'teal',
    handler: uploadMesOutsourcePrice,
    loadCount: async () => (await outsourceInjPriceService.getAll()).length,
  },
];

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', badge: 'bg-pink-100 text-pink-700' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700' },
};

const MesUploadModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, { status: ItemStatus; message: string }>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ESC 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 모달 열릴 때 건수 로드
  useEffect(() => {
    if (!isOpen) return;
    MES_ITEMS.forEach(async (item) => {
      try {
        const count = await item.loadCount();
        setCounts(prev => ({ ...prev, [item.key]: count }));
      } catch {
        setCounts(prev => ({ ...prev, [item.key]: 0 }));
      }
    });
  }, [isOpen]);

  const setRef = useCallback((key: string) => (el: HTMLInputElement | null) => {
    inputRefs.current[key] = el;
  }, []);

  const handleUpload = async (item: MesItemConfig, file: File) => {
    setStatuses(prev => ({ ...prev, [item.key]: { status: 'uploading', message: '업로드 중...' } }));
    try {
      const result = await item.handler(file);
      setStatuses(prev => ({
        ...prev,
        [item.key]: {
          status: result.success ? 'success' : 'error',
          message: result.success ? `완료 (${result.message})` : result.message,
        },
      }));
      // 건수 갱신
      if (result.success) {
        try {
          const count = await item.loadCount();
          setCounts(prev => ({ ...prev, [item.key]: count }));
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      setStatuses(prev => ({ ...prev, [item.key]: { status: 'error', message: e.message || '실패' } }));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-purple-50">
          <div>
            <h2 className="text-base font-bold text-slate-800">MES 마스터 데이터 업로드</h2>
            <p className="text-xs text-slate-500 mt-0.5">각 파일을 개별 업로드하여 마스터 데이터를 갱신합니다.</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors text-lg font-bold"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-2">
          {MES_ITEMS.map((item, idx) => {
            const colors = COLOR_MAP[item.color] || COLOR_MAP.emerald;
            const st = statuses[item.key];
            const count = counts[item.key] ?? 0;

            return (
              <div
                key={item.key}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${colors.border} ${colors.bg} transition-all`}
              >
                {/* 번호 + 라벨 */}
                <span className={`text-xs font-bold ${colors.text} w-4 shrink-0`}>{idx + 1}.</span>
                <span className={`text-sm font-semibold ${colors.text} w-28 shrink-0 truncate`}>{item.label}</span>

                {/* 건수 */}
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge} shrink-0`}>
                  {count.toLocaleString()}건
                </span>

                {/* 업로드 버튼 */}
                <button
                  onClick={() => inputRefs.current[item.key]?.click()}
                  disabled={st?.status === 'uploading'}
                  className="ml-auto h-7 px-3 text-[11px] font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {st?.status === 'uploading' ? '처리중...' : '파일 선택'}
                </button>
                <input
                  ref={setRef(item.key)}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(item, file);
                    e.target.value = '';
                  }}
                />

                {/* 상태 표시 */}
                <div className="w-40 shrink-0 text-right">
                  {st?.status === 'uploading' && (
                    <span className="flex items-center justify-end gap-1 text-blue-600 text-[11px]">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                      </svg>
                      처리중
                    </span>
                  )}
                  {st?.status === 'success' && (
                    <span className="flex items-center justify-end gap-1 text-emerald-600 text-[11px] font-medium truncate" title={st.message}>
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      {st.message}
                    </span>
                  )}
                  {st?.status === 'error' && (
                    <span className="flex items-center justify-end gap-1 text-rose-500 text-[11px] font-medium truncate" title={st.message}>
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                      {st.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">MES에서 추출한 엑셀 파일(.xlsx)을 업로드하세요</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default MesUploadModal;
