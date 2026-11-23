// [학습] 자동 로그아웃 감시. 마지막 사용 시각을 브라우저(localStorage)에 저장해 두고, 3시간이 지났으면 로그아웃합니다.
// [학습]   localStorage에 저장하므로 브라우저를 닫았다가 다시 열어도 "마지막 사용"이 이어집니다.
// [학습]   사용 = 화면 터치·클릭·키 입력·스크롤. 화면을 켜 두기만 하고 아무것도 안 하면 사용으로 보지 않습니다.
// [학습]   확인 시점: 앱을 열 때, 다른 앱에 갔다가 돌아올 때(화면이 다시 보일 때), 켜 둔 동안 1분마다, 터치할 때.
// [학습] 주의: 이 기능은 화면 쪽 편의 기능입니다. 진짜 보안 경계는 서버의 토큰 검사와 DB 권한입니다.
import { isIdleExpired, shouldSaveActivity } from '../domain/idleLogout.js';

const STORAGE_KEY = 'siosaku.lastActiveAt';
const CHECK_INTERVAL_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

// [학습] localStorage는 일부 환경(사파리 개인정보 보호 모드 등)에서 오류가 날 수 있어 try로 감쌉니다.
function readLastActive() {
  try { return Number(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
}
function markActive(now = Date.now()) {
  try { localStorage.setItem(STORAGE_KEY, String(now)); } catch { /* 저장 못 해도 앱은 동작 */ }
}
function clearActivity() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
}
function isSessionIdleExpired(now = Date.now()) {
  return isIdleExpired(readLastActive(), now);
}

// [학습] 감시 시작. 3시간이 지났으면 onExpire()를 한 번 부릅니다. 반환값은 감시 중지 함수입니다.
function startIdleWatch(onExpire) {
  let lastSaved = 0, fired = false;
  const check = () => {
    if (fired || !isSessionIdleExpired()) return false;
    fired = true; onExpire(); return true;
  };
  const onActivity = () => {
    if (check()) return;                       // 3시간 지난 뒤 첫 터치면 기록을 갱신하지 않고 로그아웃
    const now = Date.now();
    if (shouldSaveActivity(lastSaved, now)) { lastSaved = now; markActive(now); }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };

  if (!readLastActive()) markActive();         // 기록이 없으면(기능 도입 전 로그인) 지금부터 계산
  check();
  ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, onActivity, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', check);
  const timer = setInterval(check, CHECK_INTERVAL_MS);

  return () => {
    ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, onActivity, { capture: true }));
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', check);
    clearInterval(timer);
  };
}

export { startIdleWatch, markActive, clearActivity, isSessionIdleExpired };
