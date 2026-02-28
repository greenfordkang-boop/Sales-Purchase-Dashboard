
import React, { useState, useEffect, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { DashboardTab } from './types';
import Overview from './components/Overview';
import SalesView from './components/SalesView';
import PurchaseView from './components/PurchaseView';
import InventoryView from './components/InventoryView';
import SupplierView from './components/SupplierView';
import SyncStatus from './components/SyncStatus';
import UserGuideModal from './components/UserGuideModal';
import {
  signIn,
  signUp,
  signOut,
  checkAuthSession,
  logAccess,
  isAdmin,
  getAllUsers,
  approveUser,
  rejectUser,
  ADMIN_EMAIL,
  SECURITY_CONFIG,
  UserProfile
} from './lib/supabase';
import { checkAndAutoSync } from './services/supabaseService';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // 로그인 폼 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // 대시보드 상태
  const [activeTab, setActiveTab] = useState<DashboardTab | 'admin'>(DashboardTab.OVERVIEW);
  const [showGuide, setShowGuide] = useState(false);

  // 관리자 패널 상태
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // 세션 타이머
  const [sessionTimer, setSessionTimer] = useState<NodeJS.Timeout | null>(null);
  const [warningTimer, setWarningTimer] = useState<NodeJS.Timeout | null>(null);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  // 세션 타이머 리셋
  const resetSessionTimer = useCallback(() => {
    setLastActivity(Date.now());

    if (sessionTimer) clearTimeout(sessionTimer);
    if (warningTimer) clearTimeout(warningTimer);

    // 경고 타이머 (만료 5분 전)
    const newWarningTimer = setTimeout(() => {
      if (currentUser) {
        const remaining = Math.ceil(SECURITY_CONFIG.WARNING_BEFORE / 60000);
        if (window.confirm(`세션이 ${remaining}분 후 만료됩니다. 연장하시겠습니까?`)) {
          resetSessionTimer();
          if (currentUser) logAccess(currentUser.id, currentUser.email || '', 'session_extended');
        }
      }
    }, SECURITY_CONFIG.SESSION_TIMEOUT - SECURITY_CONFIG.WARNING_BEFORE);

    // 세션 만료 타이머
    const newSessionTimer = setTimeout(() => {
      if (currentUser) {
        alert('세션이 만료되었습니다. 다시 로그인해주세요.');
        handleLogout(true);
      }
    }, SECURITY_CONFIG.SESSION_TIMEOUT);

    setWarningTimer(newWarningTimer);
    setSessionTimer(newSessionTimer);
  }, [currentUser, sessionTimer, warningTimer]);

  // 활동 감지
  useEffect(() => {
    if (!currentUser) return;

    const handleActivity = () => {
      if (Date.now() - lastActivity > 60000) {
        resetSessionTimer();
      }
    };

    SECURITY_CONFIG.ACTIVITY_EVENTS.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      SECURITY_CONFIG.ACTIVITY_EVENTS.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [currentUser, lastActivity, resetSessionTimer]);

  // 초기 세션 체크
  useEffect(() => {
    const initAuth = async () => {
      const { user, profile } = await checkAuthSession();
      if (user && profile) {
        // 관리자가 아니고 승인되지 않은 경우
        if (user.email !== ADMIN_EMAIL && !profile.approved) {
          setIsAuthenticated(false);
        } else {
          setCurrentUser(user);
          setUserProfile(profile);
          setIsAuthenticated(true);
          resetSessionTimer();
          logAccess(user.id, user.email || '', 'session_restored');

          // Auto-sync on session restore
          checkAndAutoSync().then(syncResult => {
            console.log('Session restore auto-sync:', syncResult);
          }).catch(err => {
            console.error('Session restore auto-sync failed:', err);
          });
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  // 로그인 핸들러
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    const result = await signIn(email, password);

    if (result.success && result.user) {
      setCurrentUser(result.user);
      const profile = await checkAuthSession();
      setUserProfile(profile.profile);
      setIsAuthenticated(true);
      resetSessionTimer();

      // Auto-sync: push localStorage to Supabase if cloud is empty, or pull from cloud
      checkAndAutoSync().then(syncResult => {
        console.log('Auto-sync result:', syncResult);
      }).catch(err => {
        console.error('Auto-sync failed:', err);
      });
    } else {
      setLoginError(result.error || '로그인에 실패했습니다.');
    }

    setLoginLoading(false);
  };

  // 회원가입 핸들러
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    if (password.length < 6) {
      setLoginError('비밀번호는 최소 6자 이상이어야 합니다.');
      setLoginLoading(false);
      return;
    }

    const result = await signUp(email, password, displayName);

    if (result.success) {
      alert(result.message);
      setIsSignUpMode(false);
      setEmail('');
      setPassword('');
      setDisplayName('');
    } else {
      setLoginError(result.error || '회원가입에 실패했습니다.');
    }

    setLoginLoading(false);
  };

  // 로그아웃 핸들러
  const handleLogout = async (isAutoLogout = false) => {
    if (isAutoLogout || window.confirm('로그아웃 하시겠습니까?')) {
      if (currentUser) {
        await signOut(currentUser.id, currentUser.email || '');
      }
      setIsAuthenticated(false);
      setCurrentUser(null);
      setUserProfile(null);
      if (sessionTimer) clearTimeout(sessionTimer);
      if (warningTimer) clearTimeout(warningTimer);
    }
  };

  // 관리자 패널: 사용자 목록 로드
  const loadUsers = async () => {
    setUsersLoading(true);
    const userList = await getAllUsers();
    setUsers(userList);
    setUsersLoading(false);
  };

  // 관리자 패널: 사용자 승인
  const handleApproveUser = async (userId: string) => {
    if (!window.confirm('이 사용자를 승인하시겠습니까?')) return;
    const result = await approveUser(userId);
    if (result.success) {
      alert('사용자가 승인되었습니다.');
      loadUsers();
    } else {
      alert('승인 실패: ' + result.error);
    }
  };

  // 관리자 패널: 사용자 거부
  const handleRejectUser = async (userId: string) => {
    if (!window.confirm('이 사용자를 거부/비활성화하시겠습니까?')) return;
    const result = await rejectUser(userId);
    if (result.success) {
      alert('처리되었습니다.');
      loadUsers();
    } else {
      alert('처리 실패: ' + result.error);
    }
  };

  // 관리자 탭 선택 시 사용자 목록 로드
  useEffect(() => {
    if (activeTab === 'admin' && isAdmin(currentUser?.email)) {
      loadUsers();
    }
  }, [activeTab, currentUser]);

  // 로딩 화면
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-400">세션 확인 중...</p>
        </div>
      </div>
    );
  }

  // 로그인 화면
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="w-full max-w-md bg-white/5 backdrop-blur-xl p-10 rounded-3xl border border-white/10 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">신성오토텍</h1>
            <p className="text-emerald-400 text-sm font-medium tracking-wide">
              {isSignUpMode ? '계정 등록' : '영업/구매 대시보드'}
            </p>
          </div>

          <form onSubmit={isSignUpMode ? handleSignUp : handleLogin} className="space-y-4">
            {isSignUpMode && (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="이름 (선택사항)"
                className="w-full bg-white/10 border border-white/20 rounded-xl p-4 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일 주소"
              className="w-full bg-white/10 border border-white/20 rounded-xl p-4 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUpMode ? '비밀번호 (6자 이상)' : '비밀번호'}
              className="w-full bg-white/10 border border-white/20 rounded-xl p-4 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              required
            />

            {loginError && (
              <p className="text-rose-400 text-sm text-center">{loginError}</p>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 py-4 rounded-xl font-bold text-lg text-white transition-all shadow-lg"
            >
              {loginLoading ? '처리 중...' : isSignUpMode ? '계정 생성' : '시스템 접속'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUpMode(!isSignUpMode);
                setLoginError('');
              }}
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              {isSignUpMode ? '← 로그인으로 돌아가기' : '계정 등록 →'}
            </button>
          </div>

          <p className="mt-6 text-center text-slate-600 text-xs">
            🔒 Supabase Auth 보안 인증
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

  // 관리자 패널 렌더링
  const renderAdminPanel = () => {
    const pendingUsers = users.filter(u => !u.approved && u.email !== ADMIN_EMAIL);
    const approvedUsers = users.filter(u => u.approved || u.email === ADMIN_EMAIL);

    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-slate-800">👑 관리자 패널 - 사용자 관리</h2>

        {/* 승인 대기 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></span>
            승인 대기 중 ({pendingUsers.length}명)
          </h3>
          {usersLoading ? (
            <p className="text-slate-400">로딩 중...</p>
          ) : pendingUsers.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2">✅</div>
              <p>승인 대기 중인 사용자가 없습니다</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">이메일</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">이름</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">가입일</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map(user => (
                    <tr key={user.id} className="border-b border-slate-100 bg-amber-50">
                      <td className="py-3 px-4 font-medium">{user.email}</td>
                      <td className="py-3 px-4">{user.display_name || '-'}</td>
                      <td className="py-3 px-4">{new Date(user.created_at).toLocaleDateString('ko-KR')}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleApproveUser(user.id)}
                          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg mr-2 transition-colors"
                        >
                          ✓ 승인
                        </button>
                        <button
                          onClick={() => handleRejectUser(user.id)}
                          className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          ✕ 거부
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 승인된 사용자 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-3 h-3 bg-emerald-500 rounded-full"></span>
            승인된 사용자 ({approvedUsers.length}명)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">이메일</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">이름</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">역할</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-600">마지막 로그인</th>
                  <th className="text-center py-3 px-4 font-semibold text-slate-600">상태</th>
                </tr>
              </thead>
              <tbody>
                {approvedUsers.map(user => (
                  <tr key={user.id} className="border-b border-slate-100">
                    <td className="py-3 px-4 font-medium">
                      {user.email}
                      {user.email === ADMIN_EMAIL && (
                        <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">관리자</span>
                      )}
                    </td>
                    <td className="py-3 px-4">{user.display_name || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full">{user.role || 'viewer'}</span>
                    </td>
                    <td className="py-3 px-4">{user.last_login ? new Date(user.last_login).toLocaleString('ko-KR') : '-'}</td>
                    <td className="py-3 px-4 text-center">
                      {user.email === ADMIN_EMAIL ? (
                        <span className="text-amber-500">👑</span>
                      ) : (
                        <button
                          onClick={() => handleRejectUser(user.id)}
                          className="text-xs text-rose-500 hover:bg-rose-50 px-2 py-1 rounded transition-colors"
                        >
                          비활성화
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7f9] overflow-x-hidden">
      {/* Navigation Bar */}
      <nav className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between sticky top-0 z-[100] border-b border-slate-800">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5">
              <div className="w-1 h-4 bg-emerald-400 rounded-full opacity-70"></div>
              <div className="w-1 h-5 bg-emerald-500 rounded-full"></div>
              <div className="w-1 h-4 bg-emerald-400 rounded-full opacity-70"></div>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">신성오토텍</h1>
              <p className="text-[10px] text-emerald-400 font-medium tracking-wider">SALES & PURCHASE</p>
            </div>
          </div>
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
            {isAdmin(currentUser?.email) && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === 'admin'
                    ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg'
                    : 'bg-gradient-to-r from-red-600/20 to-red-700/20 text-red-400 hover:from-red-600/30 hover:to-red-700/30'
                }`}
              >
                👑 관리자
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <SyncStatus />
          <button
            onClick={() => setShowGuide(true)}
            className="text-slate-400 hover:text-emerald-400 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            title="사용설명서"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <span className="text-xs text-slate-400 font-medium">
            {userProfile?.display_name || currentUser?.email?.split('@')[0]}
            {isAdmin(currentUser?.email) && ' (관리자)'}
          </span>
          <button
            onClick={() => handleLogout(false)}
            className="text-slate-400 hover:text-rose-500 transition-colors p-2"
            title="로그아웃"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
        <div className="space-y-6">
          {activeTab === DashboardTab.OVERVIEW && <Overview />}
          {activeTab === DashboardTab.SALES && <SalesView />}
          {activeTab === DashboardTab.PURCHASE && <PurchaseView />}
          {activeTab === DashboardTab.INVENTORY && <InventoryView />}
          {activeTab === DashboardTab.SUPPLIER && <SupplierView />}
          {activeTab === 'admin' && isAdmin(currentUser?.email) && renderAdminPanel()}
        </div>
      </main>

      <UserGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />

      <footer className="py-6 px-10 text-center text-slate-400 text-xs font-medium">
        신성오토텍 영업/구매 대시보드 v2.0.0 (Supabase Auth) | 최종 업데이트: {new Date().toLocaleDateString()}
      </footer>
    </div>
  );
};

export default App;
