// [학습] 정정 폼 변환·확정 가능 여부·판매 분석 집계 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrection, canVerify } from '../frontend/domain/inventoryRows.js';
import { summarizeRange } from '../frontend/domain/salesStats.js';

const row = { opening_qty: 20, closing_qty: 3, receipt_status: 'received', movement_status: 'none', review_status: 'pending', observed_sales_qty: null };
const form = over => ({ opening_qty: '20', closing_qty: '3', receipt_status: 'received', movement_status: 'none', raw_quantity_label: '', reason: '정정', ...over });

test('정정: 바뀐 항목만, 빈칸은 null', () => {
  assert.deepEqual(buildCorrection(row, form({ closing_qty: '4' })).changes, { closing_qty: 4 });
  assert.deepEqual(buildCorrection(row, form({ opening_qty: '' })).changes, { opening_qty: null });
});
test('정정: 0은 0으로 (null과 다름)', () => assert.deepEqual(buildCorrection(row, form({ closing_qty: '0' })).changes, { closing_qty: 0 }));
test('정정: 미입고인데 수량 있음 → 오류', () => assert.ok(buildCorrection(row, form({ receipt_status: 'not_received' })).errors.length));
test('정정: 사유 없음·변경 없음·소수 → 오류', () => {
  assert.ok(buildCorrection(row, form({ closing_qty: '4', reason: ' ' })).errors.some(e => e.includes('사유')));
  assert.ok(buildCorrection(row, form({})).errors.some(e => e.includes('바뀐')));
  assert.ok(buildCorrection(row, form({ closing_qty: '2.5' })).errors.length);
});
test('확정 가능 여부: DB 규칙과 같음', () => {
  assert.equal(canVerify(row), true);
  assert.equal(canVerify({ ...row, closing_qty: 30 }), false);
  assert.equal(canVerify({ ...row, movement_status: 'unknown' }), false);
  assert.equal(canVerify({ ...row, receipt_status: 'unknown' }), false);
  assert.equal(canVerify({ ...row, receipt_status: 'not_received', opening_qty: null, closing_qty: null }), true);
  assert.equal(canVerify({ ...row, review_status: 'verified' }), false);
});
test('판매 분석: 확정 판매량만 집계, 토·일은 주말', () => {
  const v = (date, sales, close = 1, extra = {}) => ({ business_date: date, product_id: 'p1', name: '오사카 시오빵', observed_sales_qty: sales, closing_qty: close, receipt_status: 'received', review_status: 'verified', ...extra });
  const r = summarizeRange([
    v('2026-10-30', 10), v('2026-10-31', 20, 0), // 금, 토(마감 0)
    v('2026-11-01', null, 1, { review_status: 'pending' }),
    v('2026-11-02', null, null, { receipt_status: 'not_received' }),
  ]);
  const p = r.byProduct[0];
  assert.deepEqual([p.total, p.days, p.wkTotal, p.weTotal, p.stockouts], [30, 2, 10, 20, 1]);
  assert.deepEqual([r.quality.used, r.quality.pending, r.quality.notReceived, r.days], [2, 1, 1, 4]);
});
