// [학습] 서버 설정 모듈. .env 파일의 값을 읽고, 서버가 쓸 지점 목록을 정합니다.
// [학습] 이 파일은 서버(Node.js)에서만 실행됩니다. 브라우저로 보내지지 않습니다(server.mjs가 backend/ 요청을 거부).
import fs from 'node:fs';
import path from 'node:path';

// [학습] .env 파일을 한 줄씩 읽어 process.env에 넣습니다. 외부 패키지(dotenv) 없이 같은 일을 합니다.
// [학습] 이미 환경변수로 들어온 값은 덮어쓰지 않습니다(배포 서버에서는 보통 환경변수로 직접 넣기 때문).
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(path.resolve('.env'));

// [학습] 필수 값이 비어 있으면 서버를 시작하지 않고 무엇이 빠졌는지 알려 줍니다.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`.env에 ${name} 값이 없습니다. .env.example을 참고해 채워 주세요.`);
  return value;
}

const config = {
  // [학습] Supabase 프로젝트 주소. 끝의 / 는 지워서 경로를 붙일 때 // 가 생기지 않게 합니다.
  supabaseUrl: required('SUPABASE_URL').replace(/\/+$/, ''),
  // [학습] 공개용 키. 로그인(Auth)에만 쓰며 브라우저에도 전달됩니다. DB 테이블 접근은 DB 쪽 REVOKE로 막혀 있습니다.
  publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  // [학습] 서버 전용 비밀키(service_role 또는 sb_secret_...). 절대 브라우저·GitHub로 보내면 안 됩니다.
  secretKey: required('SUPABASE_SECRET_KEY'),
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
  // [학습] 로그인 방식. 'dev' = 점검용(로그인 없음, 고정 사용자) / 'jwt' = 실제 로그인. 값이 없으면 안전하게 'jwt'.
  authMode: process.env.AUTH_MODE === 'dev' ? 'dev' : 'jwt',
  // [학습] dev 모드에서 모든 요청의 "작업자"로 쓸 Supabase Auth 사용자 ID(UUID).
  // [학습] DB 함수가 수정 이력(inventory_revisions)에 작업자를 반드시 남기기 때문에, 로그인이 없어도 실제 사용자 ID가 필요합니다.
  devActorUserId: process.env.DEV_ACTOR_USER_ID || '',
};

// [학습] dev 모드 안전장치: 이 컴퓨터(127.0.0.1)에서만 실행 허용. 외부에 열면 누구나 고정 사용자 권한으로 수정할 수 있기 때문입니다.
if (config.authMode === 'dev') {
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    throw new Error('AUTH_MODE=dev(로그인 없음)는 HOST=127.0.0.1에서만 실행할 수 있습니다.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.devActorUserId)) {
    throw new Error('AUTH_MODE=dev에는 DEV_ACTOR_USER_ID(Supabase Auth 사용자 UUID)가 필요합니다. README "점검 모드" 참고.');
  }
}

// [학습] DB stores 테이블에 실제로 있는 지점만 둡니다(seed 기준 GANGDONG, HANAM).
// [학습] 이 목록은 "선택지"일 뿐 권한이 아닙니다. 실제 접근 권한은 매 요청마다 DB(user_store_access)가 검사합니다.
const STORES = [
  { code: 'GANGDONG', name: '강동 본점' },
  { code: 'HANAM', name: '하남 신세계' },
  // [학습] 용인점·대전 신세계점은 당분간 제외(팀 결정 2026-11-04). DB stores에도 없습니다.
];

export { config, STORES };
