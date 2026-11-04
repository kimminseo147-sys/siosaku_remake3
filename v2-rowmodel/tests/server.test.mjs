// [학습] 서버 통합 테스트: 가짜 Supabase를 띄우고 실제 server.mjs를 자식 프로세스로 실행해 HTTP로 확인합니다.
// [학습] 실행: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMock, USER } from './mockSupabase.mjs';

let mock, child, base;
const PORT = 4199;

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

const get = (path, token) => fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('공개 설정에는 비밀키가 없다', async () => {
  const body = await (await get('/api/config')).json();
  assert.equal(body.publishableKey, 'pub-key');
  assert.ok(!JSON.stringify(body).includes('sb_secret_test'));
});

test('토큰 없이 데이터 API를 부르면 401', async () => {
  assert.equal((await get('/api/me')).status, 401);
  assert.equal((await get('/api/stores/HANAM/inventory?date=2026-10-29')).status, 401);
});

test('잘못된 토큰은 401', async () => {
  assert.equal((await get('/api/me', 'bad-token')).status, 401);
});

test('토큰에서 확인한 사용자 ID만 DB 함수에 전달한다', async () => {
  const res = await get('/api/stores/HANAM/inventory?date=2026-10-29&p_actor_user_id=attacker', 'good-token');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.length, 2);
  const call = mock.calls.filter(c => c.url.endsWith('bq_get_inventory_items')).at(-1);
  assert.deepEqual(call.body, { p_actor_user_id: USER.id, p_store_code: 'HANAM', p_business_date: '2026-10-29' });
  assert.equal(call.headers.apikey, 'sb_secret_test');
  assert.equal(call.headers.authorization, undefined);
});

test('권한 없는 지점(42501)은 403과 한국어 메시지', async () => {
  const res = await get('/api/stores/GANGDONG/catalog', 'good-token');
  assert.equal(res.status, 403);
  assert.match((await res.json()).error.message, /권한/);
});

test('모르는 지점 코드는 DB에 보내지 않고 404', async () => {
  const before = mock.calls.length;
  assert.equal((await get('/api/stores/YONGIN/catalog', 'good-token')).status, 404);
  assert.equal(mock.calls.filter(c => c.url.startsWith('/rest')).length, mock.calls.slice(0, before).filter(c => c.url.startsWith('/rest')).length);
});

test('날짜 형식·존재하지 않는 날짜는 422', async () => {
  assert.equal((await get('/api/stores/HANAM/inventory?date=2026-02-30', 'good-token')).status, 422);
  assert.equal((await get('/api/stores/HANAM/inventory?date=20261029', 'good-token')).status, 422);
  assert.equal((await get('/api/stores/HANAM/inventory', 'good-token')).status, 422);
});

test('쓰기 요청 방식은 허용하지 않는다', async () => {
  const res = await fetch(base + '/api/stores/HANAM/inventory?date=2026-10-29', { method: 'POST', headers: { Authorization: 'Bearer good-token' } });
  assert.equal(res.status, 405);
});

test('서버 코드·.env·테스트 파일은 브라우저로 제공하지 않는다', async () => {
  for (const p of ['/backend/config.mjs', '/.env', '/.env.example', '/tests/mockSupabase.mjs', '/%2e%2e/AGENTS.md']) {
    assert.ok([403, 404].includes((await get(p)).status), p);
  }
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/frontend/App.jsx')).status, 200);
});
