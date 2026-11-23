// [학습] 자동 로그아웃 판단 (2026-11-24 팀장 결정: 3시간 동안 사용하지 않으면 로그아웃)
// [학습] 브라우저 기능(localStorage·이벤트)이 없는 순수 계산만 둡니다. 실제 감시는 services/idleSession.js가 합니다.
const IDLE_LIMIT_MS = 3 * 60 * 60 * 1000;      // 3시간
const ACTIVITY_SAVE_INTERVAL_MS = 60 * 1000;    // 사용 기록은 1분에 한 번만 저장(터치마다 저장하지 않음)

// [학습] 마지막 사용 시각(ms)에서 limit 이상 지났으면 true.
// [학습]   기록이 없거나 이상한 값이면 false: 이 기능이 생기기 전부터 로그인해 있던 사람을 바로 내보내지 않기 위함.
// [학습]   휴대폰 시계가 뒤로 바뀌어 now < 마지막 사용이면 지난 시간이 음수라 false.
function isIdleExpired(lastActiveAt, now, limit = IDLE_LIMIT_MS) {
  const last = Number(lastActiveAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  return now - last >= limit;
}

// [학습] 마지막으로 저장한 뒤 1분이 지났으면 다시 저장합니다.
function shouldSaveActivity(lastSavedAt, now, interval = ACTIVITY_SAVE_INTERVAL_MS) {
  return !lastSavedAt || now - lastSavedAt >= interval;
}

export { IDLE_LIMIT_MS, ACTIVITY_SAVE_INTERVAL_MS, isIdleExpired, shouldSaveActivity };
