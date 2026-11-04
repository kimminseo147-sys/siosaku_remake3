// [학습] /api 요청을 처리하는 모듈. "어떤 주소 → 어떤 DB 함수"를 한곳에서 볼 수 있게 모았습니다.
// [학습] 표시 규칙:
// [학습]   (기존) = 인수인계 DB에 이미 있는 함수.  (제안) = database/proposals/ 초안. 팀원 3이 설치하기 전에는
// [학습]   "DB에 필요한 함수가 없습니다"(500 RPC_MISSING)를 돌려주고, 화면은 이를 안내 문구로 바꿉니다.
import { config, STORES } from './config.mjs';
import { HttpError } from './errors.mjs';
import { verifyAccessToken, callRpc } from './supabaseRest.mjs';
import { requireUuid, requireDate, requireRange, requireVersion, requireReason, requireChanges } from './validation.mjs';
import { saveOpeningReport, saveClosingReport } from './reports.mjs';
import { importExcelDays } from './excelImport.mjs';

// [학습] 요청 헤더 "Authorization: Bearer <토큰>"에서 토큰을 꺼내 검증합니다.
// [학습] 브라우저가 보낸 사용자 ID 값은 받지 않습니다. 토큰에서 확인한 ID만 사용합니다.
async function requireUser(request) {
  // [학습] 점검 모드: 토큰을 보지 않고 .env의 고정 사용자로 처리합니다(로그인 기능은 나중에 AUTH_MODE=jwt로 켭니다).
  if (config.authMode === 'dev') return { id: config.devActorUserId, email: '점검용 고정 사용자', dev: true };
  const header = request.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, 'NO_TOKEN', '로그인이 필요합니다.');
  return verifyAccessToken(match[1]);
}

// [학습] 주소에 들어온 지점 코드가 서버 목록(강동·하남)에 있는지 확인합니다. 모르는 값은 DB까지 보내지 않습니다.
function requireStore(code) {
  const store = STORES.find(s => s.code === code);
  if (!store) throw new HttpError(404, 'UNKNOWN_STORE', '알 수 없는 지점입니다.');
  return store;
}

const S = '([A-Z_]+)';            // 지점 코드
const ID = '([0-9a-fA-F-]{36})';  // UUID

const routes = [
  // ── 공개 ───────────────────────────────────────────────
  // [학습] 로그인 화면이 Supabase Auth에 접속할 때 쓸 공개 정보. 비밀키는 절대 포함하지 않습니다.
  { method: 'GET', path: '^/api/config$', auth: false,
    handle: () => ({ authMode: config.authMode, supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey }) },

  // ── 사용자·지점 ─────────────────────────────────────────
  // [학습] (제안) bq_list_my_stores로 내 권한이 있는 지점만 돌려줍니다.
  // [학습] 함수가 아직 없으면 서버 목록(강동·하남)을 돌려주고 accessKnown=false로 알려 줍니다.
  { method: 'GET', path: '^/api/me$', auth: true,
    handle: async ({ user }) => {
      try {
        const mine = await callRpc('bq_list_my_stores', { p_actor_user_id: user.id });
        const stores = (mine || [])
          .filter(m => STORES.some(s => s.code === m.store_code))
          .map(m => ({ code: m.store_code, name: m.display_name, role: m.access_role }));
        return { user, stores, accessKnown: true };
      } catch (error) {
        if (error.code !== 'RPC_MISSING') throw error;
        return { user, stores: STORES.map(s => ({ ...s, role: null })), accessKnown: false };
      }
    } },

  // ── 상품·재고 조회 ──────────────────────────────────────
  // [학습] (기존) 상품 85종 + 별칭 + 예측 대상 여부
  { method: 'GET', path: `^/api/stores/${S}/catalog$`, auth: true,
    handle: ({ user, params }) => callRpc('bq_get_catalog', { p_actor_user_id: user.id, p_store_code: requireStore(params[0]).code }) },

  // [학습] (기존) 하루치 재고(상품마다 한 줄)
  { method: 'GET', path: `^/api/stores/${S}/inventory$`, auth: true,
    handle: ({ user, params, query }) => callRpc('bq_get_inventory_items', {
      p_actor_user_id: user.id, p_store_code: requireStore(params[0]).code, p_business_date: requireDate(query.get('date')) }) },

  // [학습] (제안) 기간 재고 — 판매 분석용
  { method: 'GET', path: `^/api/stores/${S}/inventory-range$`, auth: true,
    handle: ({ user, params, query }) => {
      const { from, to } = requireRange(query.get('from'), query.get('to'));
      return callRpc('bq_get_inventory_range', { p_actor_user_id: user.id, p_store_code: requireStore(params[0]).code, p_from: from, p_to: to });
    } },

  // ── 재고 검증·정정 (editor 이상, 권한은 DB가 검사) ───────────
  // [학습] (기존) pending → verified. 버전이 다르면 409(다른 사람이 먼저 수정).
  { method: 'POST', path: `^/api/inventory/${ID}/verify$`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_verify_inventory', {
      p_actor_user_id: user.id,
      p_inventory_id: requireUuid(params[0], '재고 ID'),
      p_expected_version: requireVersion(body?.expectedVersion),
      p_reason: requireReason(body?.reason, { optional: true }) || '검증 완료' }) },

  // [학습] (기존) 수량·상태 정정. DB는 정정하면 항상 pending으로 되돌리고, reverify=true면 바로 재검증합니다.
  { method: 'POST', path: `^/api/inventory/${ID}/correct$`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_correct_inventory', {
      p_actor_user_id: user.id,
      p_inventory_id: requireUuid(params[0], '재고 ID'),
      p_expected_version: requireVersion(body?.expectedVersion),
      p_changes: requireChanges(body?.changes),
      p_change_reason: requireReason(body?.reason),
      p_reverify: body?.reverify === true }) },

  // [학습] (제안) 반려: 날짜·지점·상품을 잘못 넣은 줄을 판매량·예측에서 뺌. 사유 필수.
  { method: 'POST', path: `^/api/inventory/${ID}/reject$`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_reject_inventory', {
      p_actor_user_id: user.id,
      p_inventory_id: requireUuid(params[0], '재고 ID'),
      p_expected_version: requireVersion(body?.expectedVersion),
      p_reason: requireReason(body?.reason) }) },

  // ── 카톡 보고 저장 (Y안) ─────────────────────────────────
  // [학습] (기존) 오픈 보고 → bq_register_inventory. 판매 중인데 보고에 없는 상품은 미입고 줄로 함께 저장.
  { method: 'POST', path: `^/api/stores/${S}/reports/opening$`, auth: true,
    handle: ({ user, params, body }) => saveOpeningReport(user, requireStore(params[0]).code, body) },
  // [학습] (제안 우선, 없으면 기존 정정으로 대체) 마감 보고 → bq_apply_closing_report
  { method: 'POST', path: `^/api/stores/${S}/reports/closing$`, auth: true,
    handle: ({ user, params, body }) => saveClosingReport(user, requireStore(params[0]).code, body) },

  // [학습] (기존) 엑셀 일괄 등록 → 날짜마다 bq_register_inventory. 본문이 커서 이 주소만 1MB까지 허용(브라우저가 31일씩 나눠 보냄).
  { method: 'POST', path: `^/api/stores/${S}/imports/excel$`, auth: true, maxBody: 1024 * 1024,
    handle: ({ user, params, body }) => importExcelDays(user, requireStore(params[0]).code, body) },

  // ── 수요 예측 ───────────────────────────────────────────
  // [학습] (기존) 예측 실행. 모델·최소 관측치는 명세 기본값(operational, 6)을 그대로 씁니다. 브라우저가 바꿀 수 없습니다.
  // [학습] 실행할 때마다 새 실행 기록이 쌓입니다(DB가 삭제·수정 금지).
  { method: 'POST', path: `^/api/stores/${S}/forecasts$`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_make_ewma_forecast', {
      p_actor_user_id: user.id, p_store_code: requireStore(params[0]).code,
      p_forecast_date: requireDate(body?.forecastDate, '예측일'),
      p_model_profile: 'operational', p_min_history: 6 }) },

  // [학습] (제안) 예측일의 가장 최근 operational 실행 결과
  { method: 'GET', path: `^/api/stores/${S}/forecasts$`, auth: true,
    handle: ({ user, params, query }) => callRpc('bq_get_forecast_results', {
      p_actor_user_id: user.id, p_store_code: requireStore(params[0]).code, p_forecast_date: requireDate(query.get('date'), '예측일') }) },

  // [학습] (기존) 저장된 예측을 스냅샷으로 다시 계산해 같은지 확인(검증 화면용)
  { method: 'GET', path: `^/api/forecasts/${ID}/replay$`, auth: true,
    handle: ({ user, params }) => callRpc('bq_replay_forecast', { p_actor_user_id: user.id, p_run_id: requireUuid(params[0], '예측 실행 ID') }) },
].map(r => ({ ...r, pattern: new RegExp(r.path) }));

// [학습] 요청 주소와 맞는 route를 찾아 실행합니다. 같은 주소에 GET/POST가 따로 있을 수 있어 둘 다 비교합니다.
async function handleApi(request, url, readBody) {
  const matches = routes.filter(r => r.pattern.test(url.pathname));
  if (!matches.length) throw new HttpError(404, 'NO_ROUTE', '없는 API 주소입니다.');
  const route = matches.find(r => r.method === request.method);
  if (!route) throw new HttpError(405, 'METHOD', '허용되지 않는 요청 방식입니다.');
  const params = url.pathname.match(route.pattern).slice(1);
  const user = route.auth ? await requireUser(request) : null;
  const body = route.method === 'POST' ? await readBody(route.maxBody) : null;
  return route.handle({ user, params, query: url.searchParams, body });
}

export { handleApi };
