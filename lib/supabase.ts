
import { createClient, User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Using localStorage fallback.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = () => {
  return supabaseUrl && supabaseAnonKey && supabase !== null;
};

// 관리자 이메일
export const ADMIN_EMAIL = 'greenfordkang@gmail.com';

// 보안 설정
export const SECURITY_CONFIG = {
  SESSION_TIMEOUT: 30 * 60 * 1000,    // 30분
  WARNING_BEFORE: 5 * 60 * 1000,      // 만료 5분 전 경고
  ACTIVITY_EVENTS: ['mousedown', 'keydown', 'scroll', 'touchstart'] as const
};

// 사용자 프로필 타입
export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  role: string;
  approved: boolean;
  is_active: boolean;
  last_login?: string;
  created_at: string;
}

// 로그인
export async function signIn(email: string, password: string): Promise<{ success: boolean; error?: string; user?: User; isAdmin?: boolean }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const user = data.user;
    if (!user) throw new Error('User not found');

    // 프로필 로드
    const profile = await loadUserProfile(user.id);

    // 관리자가 아니고 승인되지 않은 경우
    if (email !== ADMIN_EMAIL && profile && !profile.approved) {
      await supabase.auth.signOut();
      return { success: false, error: '관리자 승인 대기 중입니다. 승인 후 로그인이 가능합니다.' };
    }

    // 접근 로그 기록
    await logAccess(user.id, user.email || '', 'login');

    // 마지막 로그인 시간 업데이트
    await supabase.from('user_profiles')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    return { success: true, user, isAdmin: email === ADMIN_EMAIL };
  } catch (e: any) {
    console.error('로그인 실패:', e);
    return { success: false, error: e.message };
  }
}

// 회원가입
export async function signUp(email: string, password: string, displayName?: string): Promise<{ success: boolean; error?: string; message?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || email.split('@')[0] } }
    });
    if (error) throw error;
    return { success: true, message: '회원가입 완료. 관리자 승인 후 로그인 가능합니다.' };
  } catch (e: any) {
    console.error('회원가입 실패:', e);
    return { success: false, error: e.message };
  }
}

// 로그아웃
export async function signOut(userId?: string, userEmail?: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    if (userId && userEmail) {
      await logAccess(userId, userEmail, 'logout');
    }
    await supabase.auth.signOut();
    return { success: true };
  } catch (e: any) {
    console.error('로그아웃 실패:', e);
    return { success: false, error: e.message };
  }
}

// 프로필 로드
export async function loadUserProfile(userId: string): Promise<UserProfile | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('프로필 로드 실패:', e);
    return null;
  }
}

// 세션 체크
export async function checkAuthSession(): Promise<{ user: User | null; profile: UserProfile | null }> {
  if (!supabase) return { user: null, profile: null };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const profile = await loadUserProfile(session.user.id);

      // 비활성화된 계정 체크
      if (profile && !profile.is_active) {
        await supabase.auth.signOut();
        return { user: null, profile: null };
      }

      return { user: session.user, profile };
    }
    return { user: null, profile: null };
  } catch (e) {
    console.error('세션 확인 실패:', e);
    return { user: null, profile: null };
  }
}

// 접근 로그 기록
export async function logAccess(userId: string, userEmail: string, action: string, details?: any): Promise<void> {
  if (!supabase) return;

  try {
    await supabase.from('access_logs').insert({
      user_id: userId,
      user_email: userEmail,
      action,
      details,
      user_agent: navigator.userAgent
    });
  } catch (e) {
    console.warn('접근 로그 기록 실패:', e);
  }
}

// 관리자 확인
export function isAdmin(email?: string): boolean {
  return email === ADMIN_EMAIL;
}

// 전체 사용자 목록 조회 (관리자용)
export async function getAllUsers(): Promise<UserProfile[]> {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('사용자 목록 조회 실패:', e);
    return [];
  }
}

// 사용자 승인 (관리자용)
export async function approveUser(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ approved: true })
      .eq('id', userId);
    if (error) throw error;
    return { success: true };
  } catch (e: any) {
    console.error('사용자 승인 실패:', e);
    return { success: false, error: e.message };
  }
}

// 사용자 거부/비활성화 (관리자용)
export async function rejectUser(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ approved: false, is_active: false })
      .eq('id', userId);
    if (error) throw error;
    return { success: true };
  } catch (e: any) {
    console.error('사용자 거부 실패:', e);
    return { success: false, error: e.message };
  }
}
