// [학습] 테스트용 가짜 Supabase. 실제 DB 없이 서버의 권한·오류 처리를 확인하려고 만듭니다. 운영 코드에서는 쓰지 않습니다.
import http from 'node:http';

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'tester@example.com' };
const CATALOG = { store_code: 'HANAM', products: [
  { product_id: 'p1', product_code: 'P001', name: '오사카 시오빵', active: true, is_forecast_target: true, lifecycle_status: '판매', aliases: ['시오빵'] },
  { product_id: 'p2', product_code: 'P002', name: '쇼쿠판', active: true, is_forecast_target: false, lifecycle_status: '판매', aliases: [] },
] };
const INVENTORY = { branch: '하남 신세계', store_code: 'HANAM', record_date: '2026-10-29', items: [
  { inventory_id: 'aaaaaaaa-1111-4111-8111-000000000001', inventory_version: 1, product_id: 'p1', name: '오사카 시오빵', opening_qty: 20, closing_qty: 0, receipt_status: 'received', movement_status: 'none', review_status: 'verified', observed_sales_qty: 20 },
  { inventory_id: 'aaaaaaaa-1111-4111-8111-000000000002', inventory_version: 1, product_id: 'p2', name: '쇼쿠판', opening_qty: null, closing_qty: null, receipt_status: 'not_received', movement_status: 'none', review_status: 'pending', observed_sales_qty: null },
] };

// [학습] options.rpc: { 함수이름: (args, calls) => [상태코드, 본문] } — 특정 함수의 응답을 테스트마다 바꿉니다(설치된 운영 DB 흉내 등).
// [학습] options.inventory: bq_get_inventory_items가 돌려줄 하루치 재고(기본값 INVENTORY)
function startMock(options = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (req.url.startsWith('/auth/v1/token')) return send(200, { access_token: 'good-token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
      if (req.url === '/auth/v1/user') return req.headers.authorization === 'Bearer good-token' ? send(200, USER) : send(401, { msg: 'invalid JWT' });
      if (req.url.startsWith('/rest/v1/rpc/')) {
        const args = body ? JSON.parse(body) : {};
        if (args.p_store_code === 'GANGDONG') return send(403, { code: '42501', message: 'Forbidden: user has no viewer access to store' });
        const name = req.url.slice('/rest/v1/rpc/'.length);
        if (options.rpc?.[name]) return send(...options.rpc[name](args, calls));
        if (req.url.endsWith('bq_get_catalog')) return send(200, CATALOG);
        if (req.url.endsWith('bq_get_inventory_items')) return send(200, options.inventory || INVENTORY);
        // [학습] 제안 함수는 "아직 설치 안 됨" 상태를 흉내냅니다(PostgREST의 PGRST202).
        if (/bq_list_my_stores|bq_get_inventory_range|bq_get_forecast_results|bq_apply_closing_report|bq_reject_inventory/.test(req.url)) return send(404, { code: 'PGRST202', message: 'Could not find the function' });
        if (req.url.endsWith('bq_verify_inventory')) {
          if (args.p_expected_version !== 1) return send(409, { code: '40001', message: 'VERSION_CONFLICT expected 2, actual 1' });
          if (args.p_inventory_id === '22222222-2222-2222-2222-222222222222') return send(400, { code: 'P0001', message: 'Cannot verify received inventory without valid counts and no movement' });
          return send(200, { inventory_id: args.p_inventory_id, inventory_version: 2, review_status: 'verified', observed_sales_qty: 17 });
        }
        if (req.url.endsWith('bq_correct_inventory')) return send(200, { inventory_id: args.p_inventory_id, inventory_version: 2, review_status: args.p_reverify ? 'verified' : 'pending', observed_sales_qty: null });
        if (req.url.endsWith('bq_make_ewma_forecast')) return send(200, { run_id: '33333333-3333-3333-3333-333333333333', store_code: 'HANAM', forecast_date: args.p_forecast_date, day_type: 'weekday', model_profile: 'operational', model_version: 'daytype-ewma-v3.3-recursive-stockoutmarked', products_processed: 1, closing_zero_training_observations: 2 });
        if (req.url.endsWith('bq_register_inventory')) return send(200, { import_id: 'imp', rows: (args.p_items || []).length, matched_names: (args.p_items || []).length, verified: 0, pending: 0, unmatched: 0, conflict: 0 });
        if (req.url.endsWith('bq_replay_forecast')) return send(200, [{ product_name: '오사카 시오빵', stored_qty: 14.1, replayed_qty: 14.1, is_equal: true }]);
      }
      send(404, { message: 'mock: unknown' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

export { startMock, USER, INVENTORY };
