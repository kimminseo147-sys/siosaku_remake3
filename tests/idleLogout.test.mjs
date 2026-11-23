// [학습] 자동 로그아웃 판단 테스트 (3시간, 2026-11-24)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_LIMIT_MS, isIdleExpired, shouldSaveActivity } from '../frontend/domain/idleLogout.js';

const H = 60 * 60 * 1000;
const T = Date.parse('2026-11-24T09:00:00+09:00');

test('기준은 3시간', () => assert.equal(IDLE_LIMIT_MS, 3 * H));

test('3시간 미만이면 유지, 3시간 이상이면 로그아웃', () => {
  assert.equal(isIdleExpired(T, T + 3 * H - 1), false);
  assert.equal(isIdleExpired(T, T + 3 * H), true);
  assert.equal(isIdleExpired(T, T + 10 * H), true);
});

test('기록 없음·잘못된 값·시계가 뒤로 간 경우는 로그아웃하지 않음', () => {
  assert.equal(isIdleExpired(null, T), false);
  assert.equal(isIdleExpired('abc', T), false);
  assert.equal(isIdleExpired(0, T), false);
  assert.equal(isIdleExpired(T + H, T), false);
});

test('저장된 문자열 시각도 처리 (localStorage는 문자열로 저장)', () => {
  assert.equal(isIdleExpired(String(T), T + 4 * H), true);
});

test('사용 기록은 1분에 한 번만 저장', () => {
  assert.equal(shouldSaveActivity(0, T), true);
  assert.equal(shouldSaveActivity(T, T + 59 * 1000), false);
  assert.equal(shouldSaveActivity(T, T + 60 * 1000), true);
});
