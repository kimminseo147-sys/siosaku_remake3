// [학습] 2차 서버 테스트: 확정·정정·예측 실행·제안 함수 미설치 처리
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMock, USER } from './mockSupabase.mjs';

let mock, child, base;
const PORT = 4198, INV = '11111111-aaaa-bbbb-cccc-111111111111';

before(async () => {
  mock = await startMock();
  child = spawn(process.execPath, ['backend/server.mjs'], {
    env: { ...process.env, SUPABASE_URL: mock.url, SUPABASE_PUBLISHABLE_KEY: 'pub-key', SUPABASE_SECRET_KEY: 'sb_secret_test', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('실행')) resolve(); });
    child.on('exit', code => reject(new Error('server exited ' + code)));
  });
  base = `http://127.0.0.1:${PORT}`;
});
after(() => { child?.kill(); mock?.server.close(); });

const auth = { Authorization: 'Bearer good-token' };
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const lastCall = name => mock.calls.filter(c => c.url.endsWith(name)).at(-1);

test('/api/me: 제안 함수 미설치면 강동·하남 목록 + accessKnown=false', async () => {
  const body = await (await fetch(base + '/api/me', { headers: auth })).json();
  assert.equal(body.accessKnown, false);
  assert.deepEqual(body.stores.map(s => s.code), ['GANGDONG', 'HANAM']);
});

test('확정: 버전을 그대로 전달', async () => {
  const res = await post(`/api/inventory/${INV}/verify`, { expectedVersion: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(lastCall('bq_verify_inventory').body, { p_actor_user_id: USER.id, p_inventory_id: INV, p_expected_version: 1, p_reason: '검증 완료' });
});

test('확정: 버전 충돌은 409, 버전 없으면 422', async () => {
  assert.equal((await post(`/api/inventory/${INV}/verify`, { expectedVersion: 5 })).status, 409);
  assert.equal((await post(`/api/inventory/${INV}/verify`, {})).status, 422);
});

test('확정: DB 업무 규칙 오류는 한국어 422', async () => {
  const res = await post('/api/inventory/22222222-2222-2222-2222-222222222222/verify', { expectedVersion: 1 });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error.message, /오픈·마감 수량/);
});

test('정정: 허용되지 않은 항목·잘못된 수량·사유 없음은 DB에 보내지 않음', async () => {
  const rpcCount = () => mock.calls.filter(c => c.url.startsWith('/rest')).length;
  const before = rpcCount();
  assert.equal((await post(`/api/inventory/${INV}/correct`, { expectedVersion: 1, changes: { review_status: 'verified' }, reason: 'x' })).status, 422);
  assert.equal((await post(`/api/inventory/${INV}/correct`, { expectedVersion: 1, changes: { closing_qty: -1 }, reason: 'x' })).status, 422);
  assert.equal((await post(`/api/inventory/${INV}/correct`, { expectedVersion: 1, changes: { closing_qty: 3 }, reason: '  ' })).status, 422);
  assert.equal((await post(`/api/inventory/${INV}/correct`, { expectedVersion: 1, changes: { receipt_status: 'maybe' }, reason: 'x' })).status, 422);
  assert.equal(rpcCount(), before);
});

test('정정: 정상 요청은 그대로 전달 (null 수량 = 미확인)', async () => {
  const res = await post(`/api/inventory/${INV}/correct`, { expectedVersion: 1, changes: { closing_qty: 4, opening_qty: null }, reason: '오기 정정', reverify: true });
  assert.equal(res.status, 200);
  assert.deepEqual(lastCall('bq_correct_inventory').body, { p_actor_user_id: USER.id, p_inventory_id: INV, p_expected_version: 1, p_changes: { closing_qty: 4, opening_qty: null }, p_change_reason: '오기 정정', p_reverify: true });
});

test('예측 실행: 모델·최소 관측치는 브라우저가 바꿀 수 없음', async () => {
  const res = await post('/api/stores/HANAM/forecasts', { forecastDate: '2026-10-30', p_model_profile: 'item_optimal', p_min_history: 1 });
  assert.equal(res.status, 200);
  const args = lastCall('bq_make_ewma_forecast').body;
  assert.equal(args.p_model_profile, 'operational');
  assert.equal(args.p_min_history, 6);
  assert.equal(args.p_forecast_date, '2026-10-30');
});

test('예측 결과 조회: 제안 함수 미설치면 RPC_MISSING', async () => {
  const res = await fetch(base + '/api/stores/HANAM/forecasts?date=2026-10-30', { headers: auth });
  assert.equal(res.status, 501);
  assert.equal((await res.json()).error.code, 'RPC_MISSING');
});

test('기간 조회: 400일 초과·역순은 422', async () => {
  assert.equal((await fetch(base + '/api/stores/HANAM/inventory-range?from=2025-01-01&to=2026-10-01', { headers: auth })).status, 422);
  assert.equal((await fetch(base + '/api/stores/HANAM/inventory-range?from=2026-10-02&to=2026-10-01', { headers: auth })).status, 422);
});

test('재현 확인 (기존 bq_replay_forecast)', async () => {
  const res = await fetch(base + '/api/forecasts/33333333-3333-3333-3333-333333333333/replay', { headers: auth });
  assert.equal((await res.json())[0].is_equal, true);
});

test('POST 형식 방어: JSON 아님 415, 깨진 JSON 400, 너무 큼 413, UUID 아닌 주소 404', async () => {
  assert.equal((await post(`/api/inventory/${INV}/verify`, 'x', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(`/api/inventory/${INV}/verify`, '{bad')).status, 400);
  assert.equal((await post(`/api/inventory/${INV}/verify`, JSON.stringify({ reason: 'a'.repeat(70000) }))).status, 413);
  assert.equal((await post('/api/inventory/not-a-uuid/verify', { expectedVersion: 1 })).status, 404);
});

test('토큰 없이 쓰기 요청은 401', async () => {
  const res = await fetch(base + `/api/inventory/${INV}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"expectedVersion":1}' });
  assert.equal(res.status, 401);
});
