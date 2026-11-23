// [학습] 로그인·로그아웃·토큰 꺼내기. 화면(App.jsx)은 Supabase를 직접 모르고 이 함수들만 씁니다.
import { getAuthClient, isDevMode } from '../config/supabase.js';
import { toLoginEmail } from '../domain/loginId.js';
import { markActive, clearActivity } from './idleSession.js';

// [학습] 아이디(또는 이메일)·비밀번호 로그인. 계정은 관리자가 Supabase 대시보드에서 만들어 줍니다(회원가입 화면 없음).
// [학습]   아이디는 toLoginEmail로 이메일 형태로 바꿔서 보냅니다(예: siosakuhanam → siosakuhanam@siosaku.local).
async function signIn(loginId, password) {
  const email = toLoginEmail(loginId);
  const auth = (await getAuthClient()).auth;
  const { error } = await auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? '아이디 또는 비밀번호가 올바르지 않습니다.' : error.message);
  markActive();   // [학습] 자동 로그아웃 3시간 계산을 로그인 시각부터 새로 시작
}

// [학습] 로그아웃: 이 기기만 로그아웃합니다(scope: 'local').
// [학습]   supabase-js 기본값('global')은 같은 계정으로 로그인한 "모든 기기"를 로그아웃시킵니다.
// [학습]   지점 공용 계정이라 한 직원이 로그아웃(또는 자동 로그아웃)하면 다른 직원 폰까지 튕기므로 local로 지정합니다.
async function signOut() {
  clearActivity();
  await (await getAuthClient()).auth.signOut({ scope: 'local' });
}

// [학습] 현재 Access Token. 만료가 가까우면 supabase-js가 자동으로 새로 발급합니다. 로그인 전이면 null.
async function getAccessToken() {
  // [학습] 점검 모드: 토큰이 없어도 되므로 null. 서버가 고정 사용자로 처리합니다.
  if (await isDevMode()) return null;
  const { data } = await (await getAuthClient()).auth.getSession();
  return data.session?.access_token || null;
}

// [학습] 로그인/로그아웃이 일어날 때마다 callback(로그인 여부)을 부릅니다. 반환값은 구독 해제 함수입니다.
async function onAuthChange(callback) {
  const { data } = (await getAuthClient()).auth.onAuthStateChange((_event, session) => callback(!!session));
  return () => data.subscription.unsubscribe();
}

export { signIn, signOut, getAccessToken, onAuthChange, isDevMode };
