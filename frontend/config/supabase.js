// [학습] 로그인(Supabase Auth) 전용 연결 설정. 사용처: services/authService.js
// [학습] v1과 달리 이 객체로 DB 테이블을 읽거나 쓰지 않습니다. 데이터는 모두 서버 /api를 거칩니다.
// [학습] 프로젝트 주소·공개키는 코드에 적지 않고 서버의 /api/config에서 받아옵니다(.env 한곳에서 관리).
// [학습] npm 패키지 @supabase/supabase-js에서 가져옵니다(예전: CDN이 만든 전역 변수 window.supabase).
import { createClient } from '@supabase/supabase-js';

let configPromise = null, clientPromise = null;

// [학습] 서버 설정(로그인 방식 authMode 포함)을 한 번만 받아 옵니다.
function getServerConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then(r => { if (!r.ok) throw new Error('서버 설정을 불러오지 못했습니다. 서버가 실행 중인지 확인하세요.'); return r.json(); })
      .catch(e => { configPromise = null; throw e; });
  }
  return configPromise;
}

// [학습] 로그인용 클라이언트. 점검 모드(authMode='dev')에서는 만들지 않습니다.
function getAuthClient() {
  if (!clientPromise) {
    clientPromise = getServerConfig()
      .then(cfg => createClient(cfg.supabaseUrl, cfg.publishableKey))
      .catch(e => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

const isDevMode = async () => (await getServerConfig()).authMode === 'dev';

export { getAuthClient, getServerConfig, isDevMode };
