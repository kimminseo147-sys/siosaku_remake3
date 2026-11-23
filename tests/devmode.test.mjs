// [학습] 점검 모드(AUTH_MODE=dev, 로그인 없음) 테스트
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMock } from './mockSupabase.mjs';

const DEV = 'dddddddd-0000-4000-8000-000000000001';
let mock, child, base;

function startServer(env) {
  return spawn(process.execPath, ['backend/server.mjs'], {
    env: { ...process.env, SUPABASE_URL: mock.url, SUPABASE_PUBLISHABLE_KEY: 'pub-key', SUPABASE_SECRET_KEY: 'sb_secret_test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const exitCode = proc => new Promise(resolve => proc.on('exit', code => resolve(code)));

before(async () => {
  mock = await startMock();
  child = startServer({ AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: DEV, PORT: '4197' });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('실행')) resolve(); });
    child.on('exit', code => reject(new Error('server exited ' + code)));
  });
  base = 'http://127.0.0.1:4197';
});
after(() => { child?.kill(); mock?.server.close(); });

test('설정 응답에 authMode=dev', async () => {
  assert.equal((await (await fetch(base + '/api/config')).json()).authMode, 'dev');
});

test('토큰 없이 조회 가능, 작업자는 고정 사용자', async () => {
  const res = await fetch(base + '/api/stores/HANAM/inventory?date=2026-10-29');
  assert.equal(res.status, 200);
  const call = mock.calls.filter(c => c.url.endsWith('bq_get_inventory_items')).at(-1);
  assert.equal(call.body.p_actor_user_id, DEV);
});

test('다른 토큰을 보내도 작업자는 고정 사용자', async () => {
  await fetch(base + '/api/stores/HANAM/catalog', { headers: { Authorization: 'Bearer good-token' } });
  assert.equal(mock.calls.filter(c => c.url.endsWith('bq_get_catalog')).at(-1).body.p_actor_user_id, DEV);
});

test('외부 공개 주소(HOST=0.0.0.0)로는 시작 거부', async () => {
  const code = await exitCode(startServer({ AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: DEV, HOST: '0.0.0.0', PORT: '4196' }));
  assert.notEqual(code, 0);
});

test('DEV_ACTOR_USER_ID 없으면 시작 거부', async () => {
  const code = await exitCode(startServer({ AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: '', PORT: '4195' }));
  assert.notEqual(code, 0);
});

test('AUTH_MODE 미설정이면 로그인 필요(jwt)로 동작', async () => {
  const proc = startServer({ PORT: '4194', AUTH_MODE: '' });
  await new Promise(r => proc.stdout.on('data', d => String(d).includes('실행') && r()));
  assert.equal((await fetch('http://127.0.0.1:4194/api/me')).status, 401);
  proc.kill();
});

// [학습] Render 배포 환경(RENDER=true)에서는 기본 주소가 0.0.0.0이 되므로, 점검 모드로는 켜지지 않아야 합니다.
test('Render 환경(RENDER=true)에서 점검 모드는 시작 거부', async () => {
  const code = await exitCode(startServer({ AUTH_MODE: 'dev', DEV_ACTOR_USER_ID: DEV, RENDER: 'true', PORT: '4189' }));
  assert.notEqual(code, 0);
});
