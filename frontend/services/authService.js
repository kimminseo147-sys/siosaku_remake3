// [학습] 로그인·로그아웃·토큰 꺼내기. 화면(App.jsx)은 Supabase를 직접 모르고 이 함수들만 씁니다.
import { getAuthClient, isDevMode } from '../config/supabase.js';

// [학습] 이메일·비밀번호 로그인. 계정은 관리자가 Supabase 대시보드에서 만들어 줍니다(회원가입 화면 없음).
async function signIn(email, password) {
  const auth = (await getAuthClient()).auth;
  const { error } = await auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.' : error.message);
}

async function signOut() {
  await (await getAuthClient()).auth.signOut();
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
