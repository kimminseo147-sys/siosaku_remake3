// [학습] /api 요청을 처리하는 Express 라우터. "어떤 주소 → 어떤 DB 함수"를 한곳에서 볼 수 있게 모았습니다.
// [학습] Express 라우터 = app.get('/주소', 처리함수)처럼 주소·방식별로 처리 함수를 등록하는 묶음입니다.
// [학습]   (2026-11-23) 예전에는 정규식 표를 직접 비교했지만, 같은 표를 Express 방식으로 등록하도록 바꿨습니다.
// [학습] 표시 규칙:
// [학습]   (기존) = 인수인계 DB에 이미 있는 함수.  (제안) = database/proposals/ 초안. 팀원 3이 설치하기 전에는
// [학습]   "DB에 필요한 함수가 없습니다"(500 RPC_MISSING)를 돌려주고, 화면은 이를 안내 문구로 바꿉니다.
import express from 'express';
import { config, STORES } from './config.mjs';
import { HttpError } from './errors.mjs';
import { verifyAccessToken, callRpc } from './supabaseRest.mjs';
import { requireUuid, requireDate, requireRange, requireVersion, requireReason, requireChanges } from './validation.mjs';
import { saveOpeningReport, saveClosingReport } from './reports.mjs';
import { importExcelDays } from './excelImport.mjs';

// [학습] 예측 결과 응답 모양 맞추기 (2026-11-23 발견).
// [학습]   초안(proposals/001): { run:{run_id, created_at, min_history, ...}|null, items:[{product_name, ...}] }
// [학습]   운영 DB에 설치된 함수: { run_id|null, generated_at, day_type, model_version, items:[{name, ...}] } (run 묶음 없음)
// [학습]   화면은 run 묶음을 보고 표를 그리므로, 운영 모양이 오면 초안 모양으로 바꿉니다. 초안 모양이면 그대로 둡니다.
// [학습]   min_history는 운영 응답에 없어서, 예측 실행 주소가 고정으로 보내는 값(6)을 씁니다.
const FORECAST_MIN_HISTORY = 6;
function normalizeForecastResults(body) {
  if (!body || 'run' in body) return body;
  const items = (body.items || []).map(it => ({ ...it, product_name: it.product_name ?? it.name }));
  const run = body.run_id ? {
    run_id: body.run_id, model_version: body.model_version, day_type: body.day_type,
    min_history: body.min_history ?? FORECAST_MIN_HISTORY, created_at: body.created_at ?? body.generated_at,
  } : null;
  return { store_code: body.store_code, forecast_date: body.forecast_date, run, items: run ? items : [] };
}

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

// [학습] 주소 안의 :store(지점 코드), :id(UUID) 자리. 형식이 안 맞으면 아래 router.param에서 404로 막습니다.
const S = ':store';
const ID = ':id';

const routes = [
  // ── 공개 ───────────────────────────────────────────────
  // [학습] 로그인 화면이 Supabase Auth에 접속할 때 쓸 공개 정보. 비밀키는 절대 포함하지 않습니다.
  { method: 'GET', path: '/config', auth: false,
    handle: () => ({ authMode: config.authMode, supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey }) },

  // ── 사용자·지점 ─────────────────────────────────────────
  // [학습] (제안) bq_list_my_stores로 내 권한이 있는 지점만 돌려줍니다.
  // [학습] 함수가 아직 없으면 서버 목록(강동·하남)을 돌려주고 accessKnown=false로 알려 줍니다.
  { method: 'GET', path: '/me', auth: true,
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
  { method: 'GET', path: `/stores/${S}/catalog`, auth: true,
    handle: ({ user, params }) => callRpc('bq_get_catalog', { p_actor_user_id: user.id, p_store_code: requireStore(params.store).code }) },

  // [학습] (기존) 하루치 재고(상품마다 한 줄)
  { method: 'GET', path: `/stores/${S}/inventory`, auth: true,
    handle: ({ user, params, query }) => callRpc('bq_get_inventory_items', {
      p_actor_user_id: user.id, p_store_code: requireStore(params.store).code, p_business_date: requireDate(query.date) }) },

  // [학습] (제안) 기간 재고 — 판매 분석용
  { method: 'GET', path: `/stores/${S}/inventory-range`, auth: true,
    handle: ({ user, params, query }) => {
      const { from, to } = requireRange(query.from, query.to);
      return callRpc('bq_get_inventory_range', { p_actor_user_id: user.id, p_store_code: requireStore(params.store).code, p_from: from, p_to: to });
    } },

  // ── 재고 검증·정정 (editor 이상, 권한은 DB가 검사) ───────────
  // [학습] (기존) pending → verified. 버전이 다르면 409(다른 사람이 먼저 수정).
  { method: 'POST', path: `/inventory/${ID}/verify`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_verify_inventory', {
      p_actor_user_id: user.id,
      p_inventory_id: requireUuid(params.id, '재고 ID'),
      p_expected_version: requireVersion(body?.expectedVersion),
      p_reason: requireReason(body?.reason, { optional: true }) || '검증 완료' }) },

  // [학습] (기존) 수량·상태 정정. DB는 정정하면 항상 pending으로 되돌리고, reverify=true면 바로 재검증합니다.
  // [학습] C-1 결정(2026-11-06): 반려(rejected)된 줄은 정정 금지. DB 함수는 반려 줄도 pending으로 되돌릴 수 있어서
  // [학습]   서버가 먼저 그 줄의 현재 상태를 조회해 막습니다. 그래서 본문에 storeCode·businessDate가 필요합니다.
  // [학습]   확인과 정정 사이에 누가 반려하면 버전이 바뀌므로 DB가 VERSION_CONFLICT(409)로 막습니다.
  { method: 'POST', path: `/inventory/${ID}/correct`, auth: true,
    handle: async ({ user, params, body }) => {
      const inventoryId = requireUuid(params.id, '재고 ID');
      const expectedVersion = requireVersion(body?.expectedVersion);
      const changes = requireChanges(body?.changes);
      const reason = requireReason(body?.reason);
      const storeCode = requireStore(body?.storeCode).code;
      const businessDate = requireDate(body?.businessDate, '기록 날짜');
      const day = await callRpc('bq_get_inventory_items', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: businessDate });
      const row = (day?.items || []).find(r => r.inventory_id === inventoryId);
      if (!row) throw new HttpError(404, 'ROW_NOT_FOUND', '이 지점·날짜에서 해당 기록을 찾지 못했습니다. 새로고침 후 다시 시도하세요.');
      if (row.review_status === 'rejected') throw new HttpError(409, 'REJECTED_LOCKED', '반려된 기록은 정정할 수 없습니다. 필요하면 올바른 날짜·지점으로 새로 입력하세요.');
      return callRpc('bq_correct_inventory', {
        p_actor_user_id: user.id, p_inventory_id: inventoryId, p_expected_version: expectedVersion,
        p_changes: changes, p_change_reason: reason, p_reverify: body?.reverify === true });
    } },

  // [학습] (제안) 반려: 날짜·지점·상품을 잘못 넣은 줄을 판매량·예측에서 뺌. 사유 필수.
  { method: 'POST', path: `/inventory/${ID}/reject`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_reject_inventory', {
      p_actor_user_id: user.id,
      p_inventory_id: requireUuid(params.id, '재고 ID'),
      p_expected_version: requireVersion(body?.expectedVersion),
      p_reason: requireReason(body?.reason) }) },

  // ── 카톡 보고 저장 (Y안) ─────────────────────────────────
  // [학습] (기존) 오픈 보고 → bq_register_inventory. 판매 중인데 보고에 없는 상품은 미입고 줄로 함께 저장.
  { method: 'POST', path: `/stores/${S}/reports/opening`, auth: true,
    handle: ({ user, params, body }) => saveOpeningReport(user, requireStore(params.store).code, body) },
  // [학습] 마감 보고 → bq_apply_closing_report (함수가 없으면 대체 저장 없이 500 CLOSING_RPC_MISSING)
  { method: 'POST', path: `/stores/${S}/reports/closing`, auth: true,
    handle: ({ user, params, body }) => saveClosingReport(user, requireStore(params.store).code, body) },

  // [학습] (기존) 엑셀 일괄 등록 → 날짜마다 bq_register_inventory. 본문이 커서 이 주소만 1MB까지 허용(브라우저가 31일씩 나눠 보냄).
  { method: 'POST', path: `/stores/${S}/imports/excel`, auth: true, maxBody: 1024 * 1024,
    handle: ({ user, params, body }) => importExcelDays(user, requireStore(params.store).code, body) },

  // ── 수요 예측 ───────────────────────────────────────────
  // [학습] (기존) 예측 실행. 모델·최소 관측치는 명세 기본값(operational, 6)을 그대로 씁니다. 브라우저가 바꿀 수 없습니다.
  // [학습] 실행할 때마다 새 실행 기록이 쌓입니다(DB가 삭제·수정 금지).
  { method: 'POST', path: `/stores/${S}/forecasts`, auth: true,
    handle: ({ user, params, body }) => callRpc('bq_make_ewma_forecast', {
      p_actor_user_id: user.id, p_store_code: requireStore(params.store).code,
      p_forecast_date: requireDate(body?.forecastDate, '예측일'),
      p_model_profile: 'operational', p_min_history: FORECAST_MIN_HISTORY }) },

  // [학습] (제안) 예측일의 가장 최근 operational 실행 결과
  // [학습] (2026-11-23) 실제 설치된 함수는 초안과 모양이 달라 normalizeForecastResults로 화면이 쓰는 모양에 맞춥니다.
  { method: 'GET', path: `/stores/${S}/forecasts`, auth: true,
    handle: async ({ user, params, query }) => normalizeForecastResults(await callRpc('bq_get_forecast_results', {
      p_actor_user_id: user.id, p_store_code: requireStore(params.store).code, p_forecast_date: requireDate(query.date, '예측일') })) },

  // [학습] (기존) 저장된 예측을 스냅샷으로 다시 계산해 같은지 확인(검증 화면용)
  { method: 'GET', path: `/forecasts/${ID}/replay`, auth: true,
    handle: ({ user, params }) => callRpc('bq_replay_forecast', { p_actor_user_id: user.id, p_run_id: requireUuid(params.id, '예측 실행 ID') }) },
];

// [학습] 주소 자리(:store, :id)의 형식 검사. 예전 정규식 표와 같은 규칙이고, 안 맞으면 "없는 주소"(404)로 봅니다.
// [학습]   Express 5는 주소 안에 정규식을 못 쓰므로 router.param으로 따로 검사합니다.
const PARAM_RULES = { store: /^[A-Z_]+$/, id: /^[0-9a-fA-F-]{36}$/ };

// [학습] 로그인 확인 미들웨어. 미들웨어 = (req, res, next) 형태로 처리 함수 앞에 끼워 넣는 단계입니다.
async function authenticate(req, _res, next) {
  req.user = await requireUser(req);
  next();
}

// [학습] POST 본문(JSON) 읽기 미들웨어. express.json()이 본문을 읽어 req.body에 넣어 줍니다.
// [학습]   JSON이 아닌 요청(415)은 express.json이 그냥 건너뛰므로 먼저 직접 막습니다.
// [학습]   깨진 JSON(400)·너무 큰 본문(413)은 express.json이 오류를 내고, app.mjs의 오류 처리기가 한국어로 바꿉니다.
const MAX_BODY = 64 * 1024;
function jsonBody(limit = MAX_BODY) {
  const parse = express.json({ limit, type: 'application/json' });
  return (req, res, next) => {
    if (!req.is('application/json')) return next(new HttpError(415, 'JSON_ONLY', 'JSON 형식으로 보내야 합니다.'));
    parse(req, res, next);
  };
}

// [학습] 응답 보내기. 보안 헤더 두 개를 붙여 JSON으로 보냅니다(예전 sendJson과 같음).
function sendJson(res, status, body) {
  res.status(status).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).json(body);
}

// [학습] 위 routes 표를 Express 라우터에 등록합니다. 순서: 로그인 확인 → 본문 읽기 → 처리 함수 (예전과 같은 순서).
function createApiRouter() {
  const router = express.Router();
  for (const [name, rule] of Object.entries(PARAM_RULES)) {
    router.param(name, (_req, _res, next, value) => next(rule.test(value) ? undefined : new HttpError(404, 'NO_ROUTE', '없는 API 주소입니다.')));
  }
  for (const route of routes) {
    const steps = [];
    if (route.auth) steps.push(authenticate);
    if (route.method === 'POST') steps.push(jsonBody(route.maxBody));
    steps.push(async (req, res) => {
      const result = await route.handle({ user: req.user || null, params: req.params, query: req.query, body: req.method === 'POST' ? req.body : null });
      sendJson(res, 200, result);
    });
    router[route.method.toLowerCase()](route.path, ...steps);
  }
  // [학습] 주소는 맞는데 방식(GET/POST)이 다르면 405. 같은 주소에 GET·POST가 둘 다 있을 수 있어 등록이 끝난 뒤에 붙입니다.
  for (const path of new Set(routes.map(r => r.path))) {
    router.all(path, () => { throw new HttpError(405, 'METHOD', '허용되지 않는 요청 방식입니다.'); });
  }
  // [학습] 어디에도 맞지 않는 /api 주소는 404
  router.use(() => { throw new HttpError(404, 'NO_ROUTE', '없는 API 주소입니다.'); });
  return router;
}

export { createApiRouter, sendJson, normalizeForecastResults };
