// [학습] Supabase와 통신하는 서버 모듈. supabase-js 패키지 대신 Node 기본 fetch로 REST 주소를 직접 부릅니다.
// [학습] 이렇게 하면 npm install 없이 실행되고, 어떤 요청이 나가는지 코드에서 그대로 보입니다.
import { config } from './config.mjs';
import { HttpError } from './errors.mjs';

// [학습] 레거시 service_role 키는 JWT(eyJ로 시작)라서 Authorization 헤더에도 넣어야 합니다.
// [학습] 새 sb_secret_ 키는 JWT가 아니므로 apikey 헤더만 보냅니다.
function secretHeaders() {
  const headers = { apikey: config.secretKey, 'Content-Type': 'application/json' };
  if (config.secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.secretKey}`;
  return headers;
}

// [학습] 브라우저가 보낸 Access Token이 진짜인지 Supabase Auth에 물어봅니다.
// [학습] 성공하면 {id, email}을 돌려줍니다. 이 id만 DB 함수의 p_actor_user_id로 사용합니다.
async function verifyAccessToken(token) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new HttpError(502, 'AUTH_UNREACHABLE', '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(401, 'INVALID_TOKEN', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }
  if (!response.ok) throw new HttpError(502, 'AUTH_ERROR', '로그인 확인 중 오류가 발생했습니다.');
  const user = await response.json();
  if (!user?.id) throw new HttpError(401, 'INVALID_TOKEN', '로그인 정보를 확인하지 못했습니다.');
  return { id: user.id, email: user.email || null };
}

// [학습] DB 함수(RPC)를 부릅니다. 예: callRpc('bq_get_catalog', {p_actor_user_id: ..., p_store_code: 'HANAM'})
// [학습] 주소 형식은 POST /rest/v1/rpc/함수이름 이고, 인자는 JSON 본문으로 보냅니다.
async function callRpc(name, args) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: secretHeaders(),
      body: JSON.stringify(args),
    });
  } catch {
    throw new HttpError(502, 'DB_UNREACHABLE', 'DB 서버에 연결하지 못했습니다.');
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw rpcError(response.status, body);
  return body;
}

// [학습] PostgreSQL 오류 코드를 화면에 보여줄 HTTP 오류로 바꿉니다. SQL 원문·스택은 브라우저로 보내지 않습니다.
// [학습] 오류 코드 근거: bq_assert_store_access(42501), VERSION_CONFLICT(40001), 'Store not found' (스키마 v3.0)
function rpcError(status, body) {
  const code = body?.code || '';
  const message = String(body?.message || '');
  // [학습] 서버 로그에는 원인을 남겨 개발자가 확인할 수 있게 합니다.
  console.error(`[rpc] ${status} ${code} ${message}`);
  // [학습] 함수가 DB에 없음(아직 설치 안 된 제안 함수 등). 다른 규칙보다 먼저 확인합니다.
  if (code === 'PGRST202') return new HttpError(501, 'RPC_MISSING', 'DB에 필요한 함수가 없습니다. DB 담당자에게 확인하세요.');
  // [학습] DB 함수가 RAISE EXCEPTION으로 보낸 업무 규칙 오류(P0001)를 이해하기 쉬운 메시지로 바꿉니다.
  for (const [pattern, status, key, text] of BUSINESS_ERRORS) {
    if (pattern.test(message)) return new HttpError(status, key, text);
  }
  if (code === '42501') return new HttpError(403, 'FORBIDDEN', '이 지점에 접근할 권한이 없습니다. 관리자에게 지점 권한을 요청하세요.');
  if (code === '40001') return new HttpError(409, 'VERSION_CONFLICT', '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인하세요.');
  if (/not found/i.test(message)) return new HttpError(404, 'NOT_FOUND', '요청한 지점이나 자료를 찾지 못했습니다.');
  if (status === 401 || status === 403) return new HttpError(500, 'SERVER_KEY', '서버의 DB 키 설정이 올바르지 않습니다.');
  if (code === '23505') return new HttpError(409, 'DUPLICATE', '이미 같은 내용이 등록되어 있습니다.');
  if (code === '23514') return new HttpError(422, 'CHECK_FAILED', '저장 규칙에 맞지 않는 값입니다. (예: 미입고인데 수량이 있음)');
  if (code === '22P02' || code === '22007' || code === '22008') return new HttpError(422, 'INVALID_INPUT', '입력 형식이 올바르지 않습니다.');
  return new HttpError(500, 'DB_ERROR', 'DB 처리 중 오류가 발생했습니다.');
}

// [학습] 근거: 스키마 v3.0의 bq_guard_daily_inventory / bq_verify / bq_correct, 패치 v3.3의 bq_make_ewma_forecast 오류 문구
const BUSINESS_ERRORS = [
  [/Already verified/i, 409, 'ALREADY_VERIFIED', '이미 확정된 기록입니다. 새로고침 후 확인하세요.'],
  [/Unknown receipt cannot be verified/i, 422, 'RECEIPT_UNKNOWN', '입고 여부가 "미확인"이면 확정할 수 없습니다. 먼저 정정하세요.'],
  [/Cannot verify received inventory/i, 422, 'CANNOT_VERIFY', '확정하려면 오픈·마감 수량이 모두 있고, 마감이 오픈보다 크지 않으며, 이동이 "없음"이어야 합니다.'],
  [/Not-received inventory must have NULL/i, 422, 'NOT_RECEIVED_QTY', '미입고 기록은 오픈·마감 수량을 비워야 합니다.'],
  [/Correction reason is required/i, 422, 'REASON_REQUIRED', '수정 사유를 입력하세요.'],
  [/Unsupported correction key|Nonempty changes/i, 422, 'BAD_CHANGES', '수정할 수 없는 항목이 포함되어 있습니다.'],
  [/Incomplete EWMA parameters|EWMA parameters are incomplete/i, 500, 'FORECAST_PARAMS', '예측 파라미터(α)가 DB에 모두 등록되어 있지 않습니다. DB 담당자에게 확인하세요.'],
  [/Already rejected/i, 409, 'ALREADY_REJECTED', '이미 반려된 기록입니다.'],
  [/Rejection reason is required/i, 422, 'REASON_REQUIRED', '반려 사유를 입력하세요.'],
  [/Closing report raw_payload required/i, 422, 'NO_TEXT', '마감 보고 원문이 비어 있습니다.'],
  [/Range too long/i, 422, 'RANGE_TOO_LONG', '조회 기간이 너무 깁니다.'],
];

export { verifyAccessToken, callRpc };
