// [학습] 서버 /api 호출 도우미. 모든 요청에 로그인 토큰을 붙이고, 오류 응답을 한국어 메시지로 바꿉니다.
import { getAccessToken, isDevMode } from './authService.js';

// [학습] status(401, 403 …)를 함께 담아, 화면이 "로그인 다시" 같은 처리를 구분할 수 있게 합니다.
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// [학습] GET·POST 공통 처리. body가 있으면 JSON으로 보냅니다.
async function request(method, path, body) {
  const token = await getAccessToken();
  const dev = !token && await isDevMode();
  if (!token && !dev) throw new ApiError(401, 'NO_TOKEN', '로그인이 필요합니다.');
  // [학습] 점검 모드에서는 Authorization 헤더 없이 보냅니다.
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', '서버에 연결하지 못했습니다. 인터넷 연결과 서버 실행 여부를 확인하세요.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error?.code || 'HTTP', data?.error?.message || `요청 실패 (${response.status})`);
  return data;
}

const apiGet = path => request('GET', path);
const apiPost = (path, body) => request('POST', path, body ?? {});

export { apiGet, apiPost, ApiError };
