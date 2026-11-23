// [학습] 엑셀 일괄 등록 서버 로직. 브라우저가 해석한 날짜별 행을 서버가 다시 검사한 뒤, 날짜마다 bq_register_inventory 1번.
// [학습] 날짜 단위로 저장(그 날짜는 전부 저장되거나 전부 취소). 이미 그날 기록이 있으면 그 날짜 전체를 건너뜀(v1과 같음).
// [학습] 같은 내용을 두 번 올리는 것을 막으려고 날짜별 내용의 해시를 source_checksum으로 보냅니다(DB에 지점+checksum UNIQUE 인덱스가 있음).
import crypto from 'node:crypto';
import { HttpError } from './errors.mjs';
import { callRpc } from './supabaseRest.mjs';
import { requireDate } from './validation.mjs';

const MAX_DAYS = 31, MAX_ITEMS_PER_DAY = 200;
const RECEIPT = ['received', 'not_received', 'unknown'];
const isQtyOrNull = v => v === null || (Number.isInteger(v) && v >= 0 && v <= 100000);

function checkItem(it, date, n) {
  const where = `${date} ${n}번째 행`;
  if (!RECEIPT.includes(it?.receipt_status)) throw new HttpError(422, 'BAD_STATUS', `${where}: 입고 상태 값이 올바르지 않습니다.`);
  if (!isQtyOrNull(it.opening_qty) || !isQtyOrNull(it.closing_qty)) throw new HttpError(422, 'BAD_QTY', `${where}: 수량은 0 이상의 정수이거나 비어 있어야 합니다.`);
  if (it.receipt_status === 'not_received' && (it.opening_qty !== null || it.closing_qty !== null)) throw new HttpError(422, 'BAD_QTY', `${where}: 미입고는 수량을 비워야 합니다.`);
  if (it.receipt_status === 'received' && !(it.opening_qty > 0)) throw new HttpError(422, 'BAD_QTY', `${where}: 입고인데 오픈 수량이 없습니다(오픈 0은 미입고).`);
}

// [학습] body: { fileName, days:[{ date, items:[{ rawLine, productName, receipt_status, opening_qty, closing_qty, label }] }] }
// [학습] 반환: { results:[{ date, status:'saved'|'skipped'|'failed', register?, message? }] }
async function importExcelDays(user, storeCode, body) {
  const fileName = typeof body?.fileName === 'string' ? body.fileName.slice(0, 200) : '엑셀';
  const days = body?.days;
  if (!Array.isArray(days) || !days.length || days.length > MAX_DAYS) throw new HttpError(422, 'BAD_DAYS', `한 번에 1~${MAX_DAYS}일까지 보낼 수 있습니다.`);
  const catalog = await callRpc('bq_get_catalog', { p_actor_user_id: user.id, p_store_code: storeCode });
  const names = new Set(catalog.products.map(p => p.name));

  // [학습] 먼저 전부 검사하고, 문제가 있으면 아무 날짜도 저장하지 않습니다.
  const seenDates = new Set();
  const prepared = days.map(day => {
    const date = requireDate(day?.date, '날짜');
    if (seenDates.has(date)) throw new HttpError(422, 'DUP_DATE', `같은 날짜가 두 번 있습니다: ${date}`);
    seenDates.add(date);
    if (!Array.isArray(day.items) || !day.items.length || day.items.length > MAX_ITEMS_PER_DAY) throw new HttpError(422, 'BAD_ITEMS', `${date}: 상품 행이 없거나 너무 많습니다.`);
    const seen = new Set();
    const items = day.items.map((it, i) => {
      if (!names.has(it?.productName)) throw new HttpError(422, 'UNKNOWN_PRODUCT', `${date}: 사전에 없는 상품 (${it?.productName})`);
      if (seen.has(it.productName)) throw new HttpError(422, 'DUP_PRODUCT', `${date}: 같은 상품이 두 번 있습니다 (${it.productName})`);
      seen.add(it.productName);
      checkItem(it, date, i + 1);
      return { raw_line: String(it.rawLine || it.productName).slice(0, 500), raw_product_name: it.productName,
        receipt_status: it.receipt_status, movement_status: 'none', opening_qty: it.opening_qty, closing_qty: it.closing_qty,
        raw_quantity_label: typeof it.label === 'string' && it.label ? it.label.slice(0, 50) : null };
    });
    const rawPayload = `엑셀 일괄 등록: ${fileName} / ${date}\n` + items.map(x => x.raw_line).join('\n');
    const checksum = 'excel:' + crypto.createHash('sha256').update(JSON.stringify(items.map(x => [x.raw_product_name, x.receipt_status, x.opening_qty, x.closing_qty]))).digest('hex').slice(0, 32) + ':' + date;
    return { date, items, rawPayload, checksum };
  });

  const results = [];
  for (const day of prepared) {
    try {
      const existing = await callRpc('bq_get_inventory_items', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: day.date });
      if (existing.items.length) { results.push({ date: day.date, status: 'skipped', message: `이미 ${existing.items.length}개 상품이 등록된 날짜` }); continue; }
      const register = await callRpc('bq_register_inventory', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: day.date,
        p_source_type: 'excel', p_raw_payload: day.rawPayload, p_items: day.items, p_source_checksum: day.checksum, p_finalize: true });
      results.push({ date: day.date, status: 'saved', register });
    } catch (error) {
      // [학습] 같은 내용을 이미 올린 경우(DB UNIQUE 위반 23505)는 건너뜀으로 표시
      if (error.code === 'DUPLICATE') { results.push({ date: day.date, status: 'skipped', message: '같은 내용을 이미 등록함' }); continue; }
      if (error.status === 401 || error.status === 403) throw error;
      results.push({ date: day.date, status: 'failed', message: error.message });
    }
  }
  return { results };
}

export { importExcelDays };
