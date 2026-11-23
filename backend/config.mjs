// [학습] 서버 설정 모듈. 환경변수(.env)의 값을 읽고, 서버가 쓸 지점 목록을 정합니다.
// [학습] 이 파일은 서버(Node.js)에서만 실행됩니다. 브라우저로 보내지 않습니다(화면용 dist/ 폴더만 제공).

// [학습] .env 파일은 이 코드가 아니라 Node가 직접 읽습니다. package.json의 실행 명령에 붙은
// [학습]   --env-file-if-exists=.env 옵션 덕분입니다(Node 22 기본 기능, 예전 loadEnvFile 함수 대체).
// [학습]   이미 환경변수로 들어온 값이 .env보다 우선합니다 → Render에서는 대시보드의 환경변수가 쓰입니다.

// [학습] 필수 값이 비어 있으면 서버를 시작하지 않고 무엇이 빠졌는지 알려 줍니다.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name} 값이 없습니다. .env.example을 참고해 .env를 채우고 npm start(또는 npm run dev)로 실행하세요.`);
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
  // [학습] 접속을 받을 주소. 127.0.0.1 = 내 컴퓨터에서만 / 0.0.0.0 = 외부에서도 접속 가능.
  // [학습]   Render는 환경변수 RENDER=true를 넣어 주므로, 그때만 기본값을 0.0.0.0으로 바꿉니다.
  host: process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1'),
  // [학습] npm run build가 만든 화면 파일 폴더(Vite 결과물). 테스트에서는 STATIC_DIR로 바꿀 수 있습니다.
  staticDir: process.env.STATIC_DIR || 'dist',
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
