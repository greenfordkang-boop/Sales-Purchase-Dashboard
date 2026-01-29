
import React, { useState, useEffect } from 'react';
import { DashboardTab } from './types';
import Overview from './components/Overview';
import SalesView from './components/SalesView';
import PurchaseView from './components/PurchaseView';
import InventoryView from './components/InventoryView';
import SupplierView from './components/SupplierView';
import SyncStatus from './components/SyncStatus';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>(DashboardTab.OVERVIEW);

  useEffect(() => {
    const authStatus = sessionStorage.getItem('isDashboardAuth');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Updated password to SSAT2026 as requested
    if (password === 'SSAT2026') {
      setIsAuthenticated(true);
      sessionStorage.setItem('isDashboardAuth', 'true');
    } else {
      setLoginError(true);
      setTimeout(() => setLoginError(false), 2000);
    }
  };

  const handleLogout = () => {
    if (window.confirm('로그아웃 하시겠습니까?')) {
      setIsAuthenticated(false);
      sessionStorage.removeItem('isDashboardAuth');
      setPassword('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a1128] text-white p-6">
        <div className="w-full max-w-md bg-slate-900/50 p-10 rounded-3xl border border-slate-800 shadow-2xl backdrop-blur-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black mb-2 tracking-tight">영업/구매 통합 관리 시스템</h1>
            <p className="text-slate-500 text-sm font-medium">Access Password Required</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`w-full bg-black/40 border ${loginError ? 'border-rose-500 animate-shake' : 'border-slate-700'} rounded-2xl p-4 text-center text-xl font-bold tracking-widest outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
            />
            <button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-black text-lg transition-all shadow-lg active:scale-[0.98]"
            >
              시스템 접속
            </button>
          </form>
          <p className="mt-8 text-center text-slate-600 text-xs">
            © 2024 Integrated Business Dashboard. All rights reserved.
          </p>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: DashboardTab.OVERVIEW, label: '종합현황' },
    { id: DashboardTab.SALES, label: '영업현황' },
    { id: DashboardTab.PURCHASE, label: '구매현황' },
    { id: DashboardTab.INVENTORY, label: '재고관리' },
    { id: DashboardTab.SUPPLIER, label: '협력사관리' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7f9] overflow-x-hidden">
      {/* Navigation Bar - Dark Theme */}
      <nav className="bg-[#0a1128] text-white px-6 py-2 flex items-center justify-between sticky top-0 z-[100] border-b border-slate-800">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h1 className="text-lg font-black tracking-tight border-r border-slate-700 pr-4 mr-2">ERP DASHBOARD</h1>
          </div>
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button 
                key={tab.id} 
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <SyncStatus />
          <span className="text-xs text-slate-400 font-medium">ADMIN (Manager)</span>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-rose-500 transition-colors p-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
        <div className="space-y-6">
          {activeTab === DashboardTab.OVERVIEW && <Overview />}
          {activeTab === DashboardTab.SALES && <SalesView />}
          {activeTab === DashboardTab.PURCHASE && <PurchaseView />}
          {activeTab === DashboardTab.INVENTORY && <InventoryView />}
          {activeTab === DashboardTab.SUPPLIER && <SupplierView />}
        </div>
      </main>

      <footer className="py-6 px-10 text-center text-slate-400 text-xs font-medium">
        통합 시스템 연동 버전: v1.1.0 (Supabase) | 최종 업데이트: {new Date().toLocaleDateString()}
      </footer>
    </div>
  );
};

export default App;
