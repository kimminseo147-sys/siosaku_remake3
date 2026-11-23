// [학습] 예측 결과 응답 모양 맞추기 테스트 (2026-11-23): 운영 DB 함수는 run 묶음 없이 평평한 모양으로 돌려줍니다.
import test from 'node:test';
import assert from 'node:assert/strict';
// [학습] routes.mjs가 config.mjs를 읽으므로, 가짜 환경변수를 먼저 넣고 동적으로 불러옵니다(실제 DB 접속 없음).
Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_PUBLISHABLE_KEY: 'pub', SUPABASE_SECRET_KEY: 'sb_secret_test', AUTH_MODE: 'jwt' });
const { normalizeForecastResults } = await import('../backend/routes.mjs');

test('운영 모양(run 묶음 없음) → 화면 모양으로 변환', () => {
  const out = normalizeForecastResults({
    run_id: 'e9bb42a4-d148-4853-accd-ce21e79b7cab', store_code: 'HANAM', forecast_date: '2026-11-24',
    day_type: 'weekday', generated_at: '2026-11-23T14:34:27Z', model_version: 'daytype-ewma-v3.3-recursive-stockoutmarked',
    items: [{ name: '오사카 시오빵', product_id: 'p1', alpha_used: 0.18, history_count: 134, forecast_status: 'ok', predicted_demand_qty: 14.66, closing_zero_observations: 17 }],
  });
  assert.equal(out.run.run_id, 'e9bb42a4-d148-4853-accd-ce21e79b7cab');
  assert.equal(out.run.created_at, '2026-11-23T14:34:27Z');
  assert.equal(out.run.min_history, 6);
  assert.equal(out.run.day_type, 'weekday');
  assert.equal(out.items[0].product_name, '오사카 시오빵');
  assert.equal(out.items[0].predicted_demand_qty, 14.66);
});

test('운영 모양, 실행 기록 없음 → run=null', () => {
  const out = normalizeForecastResults({ items: [], run_id: null, store_code: 'GANGDONG', forecast_date: '2026-11-24' });
  assert.equal(out.run, null);
  assert.deepEqual(out.items, []);
});

test('초안 모양은 그대로', () => {
  const body = { store_code: 'HANAM', forecast_date: '2026-11-24', run: null, items: [] };
  assert.equal(normalizeForecastResults(body), body);
});
