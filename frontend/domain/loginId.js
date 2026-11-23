// [학습] 로그인 아이디 → Supabase 로그인용 이메일 변환 (2026-11-24 팀장 결정: 지점 공용 계정, 포스기처럼 아이디로 로그인)
// [학습] Supabase Auth는 이메일(또는 전화번호)로만 로그인할 수 있어서, 직원이 입력한 아이디 뒤에 가짜 주소를 붙입니다.
// [학습]   siosakuhanam → siosakuhanam@siosaku.local  (실제 메일함 없음. 계정은 관리자가 "Auto Confirm"으로 만듦)
// [학습]   '@'가 들어 있으면 이메일로 보고 그대로 씁니다(팀원 개인 계정용).
const LOGIN_EMAIL_DOMAIN = 'siosaku.local';
const LOGIN_ID_PATTERN = /^[a-z0-9._-]+$/;

function toLoginEmail(input) {
  const value = String(input ?? '').trim().toLowerCase();
  if (!value) throw new Error('아이디를 입력하세요.');
  if (value.includes('@')) return value;
  if (!LOGIN_ID_PATTERN.test(value)) throw new Error('아이디는 영어 소문자·숫자와 . _ - 만 쓸 수 있습니다.');
  return `${value}@${LOGIN_EMAIL_DOMAIN}`;
}

export { toLoginEmail, LOGIN_EMAIL_DOMAIN };
