
import React, { useState } from 'react';
import { useGlobalSync } from '../hooks/useSupabaseData';
import { isSupabaseConfigured } from '../lib/supabase';

const SyncStatus: React.FC = () => {
  const { isSyncing, syncMessage, isConfigured, syncToCloud, loadFromCloud } = useGlobalSync();
  const [showDropdown, setShowDropdown] = useState(false);

  const handleSyncToCloud = async () => {
    setShowDropdown(false);
    await syncToCloud();
  };

  const handleLoadFromCloud = async () => {
    setShowDropdown(false);
    if (window.confirm('클라우드 데이터로 로컬 데이터를 덮어씁니다. 계속하시겠습니까?')) {
      await loadFromCloud();
    }
  };

  return (
    <div className="relative">
      {/* Sync Status Indicator */}
      <div className="flex items-center gap-2">
        {/* Status Badge */}
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
          isConfigured
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-amber-500/20 text-amber-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isConfigured
              ? 'bg-emerald-400 animate-pulse'
              : 'bg-amber-400'
          }`}></span>
          {isConfigured ? 'Cloud' : 'Local'}
        </div>

        {/* Sync Button */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={isSyncing}
          className={`p-2 rounded-lg transition-all ${
            isSyncing
              ? 'bg-blue-600/20 text-blue-400'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
          title={isConfigured ? '동기화 옵션' : 'Supabase 미설정'}
        >
          {isSyncing ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      </div>

      {/* Dropdown Menu */}
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          ></div>
          <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="p-3 border-b border-slate-700">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${isConfigured ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className="text-sm font-bold text-white">
                  {isConfigured ? 'Supabase 연결됨' : 'Supabase 미설정'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isConfigured
                  ? '데이터가 클라우드에 자동 저장됩니다.'
                  : '.env 파일에 Supabase 키를 설정하세요.'}
              </p>
            </div>

            {isConfigured ? (
              <div className="p-2 space-y-1">
                <button
                  onClick={handleSyncToCloud}
                  disabled={isSyncing}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <div>
                    <div className="font-medium">클라우드로 업로드</div>
                    <div className="text-xs text-slate-500">로컬 데이터를 서버에 저장</div>
                  </div>
                </button>
                <button
                  onClick={handleLoadFromCloud}
                  disabled={isSyncing}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                  <div>
                    <div className="font-medium">클라우드에서 다운로드</div>
                    <div className="text-xs text-slate-500">서버 데이터로 덮어쓰기</div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-4">
                <p className="text-xs text-slate-400 mb-3">설정 방법:</p>
                <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
                  <li>Supabase 프로젝트 생성</li>
                  <li>.env 파일에 URL과 KEY 입력</li>
                  <li>schema.sql 실행</li>
                  <li>앱 재시작</li>
                </ol>
              </div>
            )}
          </div>
        </>
      )}

      {/* Toast Message */}
      {syncMessage && (
        <div className="fixed bottom-6 right-6 z-[200] animate-slide-up">
          <div className={`px-5 py-3 rounded-xl shadow-2xl font-medium text-sm flex items-center gap-3 ${
            syncMessage.includes('success') || syncMessage.includes('성공')
              ? 'bg-emerald-600 text-white'
              : syncMessage.includes('failed') || syncMessage.includes('실패')
              ? 'bg-rose-600 text-white'
              : 'bg-slate-800 text-white'
          }`}>
            {isSyncing && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {syncMessage}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default SyncStatus;
