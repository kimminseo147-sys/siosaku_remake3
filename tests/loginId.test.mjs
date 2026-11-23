// [학습] 로그인 아이디 → 이메일 변환 테스트 (지점 공용 계정, 2026-11-24)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLoginEmail } from '../frontend/domain/loginId.js';

test('아이디 뒤에 @siosaku.local을 붙임', () => {
  assert.equal(toLoginEmail('siosakuhanam'), 'siosakuhanam@siosaku.local');
  assert.equal(toLoginEmail('siosakugangdong'), 'siosakugangdong@siosaku.local');
});

test('대문자·앞뒤 공백은 정리', () => {
  assert.equal(toLoginEmail('  SiosakuHanam '), 'siosakuhanam@siosaku.local');
});

test('@가 있으면 이메일 그대로 (팀원 개인 계정)', () => {
  assert.equal(toLoginEmail('Team@Example.com'), 'team@example.com');
});

test('빈 값·허용 안 되는 문자는 오류', () => {
  assert.throws(() => toLoginEmail('  '), /아이디를 입력/);
  assert.throws(() => toLoginEmail('hanam!'), /영어 소문자/);
  assert.throws(() => toLoginEmail('하남'), /영어 소문자/);
});
