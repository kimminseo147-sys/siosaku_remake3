// [학습] 카톡 오픈/마감 보고 저장 (Y안: 오픈 저장 → 약 1분 뒤 마감 저장). 서버 업무 로직입니다.
// [학습] 브라우저가 보낸 미리보기 결과를 믿지 않고, 서버가 상품·수량·상태를 다시 검사한 뒤 DB 함수를 부릅니다.
// [학습] 팀 결정(2026-11-04): 이동은 측정 불가 → 항상 'none' / 오픈 보고에 없는 판매 중 상품 = 미입고 /
// [학습]   오픈 0·미입고 = 미입고 / 마감 0·품절 = 0개 / 조건 맞으면 자동 확정 / 이미 있는 줄은 덮어쓰지 않고 비교 후 정정
import { HttpError } from './errors.mjs';
import { callRpc } from './supabaseRest.mjs';
import { requireDate } from './validation.mjs';

const MAX_ITEMS = 200, MAX_TEXT = 20000;

function requireRawText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(422, 'NO_TEXT', '카톡 보고 원문이 비어 있습니다.');
  if (text.length > MAX_TEXT) throw new HttpError(422, 'TEXT_TOO_LONG', '보고 원문이 너무 깁니다.');
  return text;
}
const isQty = v => Number.isInteger(v) && v >= 0 && v <= 100000;
const optLabel = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 50) : null);

// [학습] 상품 이름 → 상품. 화면이 보낸 이름이 DB 상품 목록(표준명)에 정말 있는지 서버가 확인합니다.
async function loadCatalogMap(user, storeCode) {
  const catalog = await callRpc('bq_get_catalog', { p_actor_user_id: user.id, p_store_code: storeCode });
  const byName = new Map(catalog.products.map(p => [p.name, p]));
  return { byName, active: catalog.products.filter(p => p.active) };
}
async function loadDay(user, storeCode, date) {
  const day = await callRpc('bq_get_inventory_items', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: date });
  return new Map(day.items.map(row => [row.name, row]));
}

function requireItems(items, catalogMap, check) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new HttpError(422, 'BAD_ITEMS', `상품 줄은 최대 ${MAX_ITEMS}개입니다.`);
  const seen = new Set();
  return items.map((item, i) => {
    const name = typeof item?.productName === 'string' ? item.productName : '';
    if (!catalogMap.byName.has(name)) throw new HttpError(422, 'UNKNOWN_PRODUCT', `${i + 1}번째 줄: 상품을 선택하세요 (${item?.rawLine || name || '이름 없음'}).`);
    if (seen.has(name)) throw new HttpError(422, 'DUP_PRODUCT', `같은 상품이 두 번 있습니다: ${name}`);
    seen.add(name);
    const rawLine = typeof item.rawLine === 'string' && item.rawLine.trim() ? item.rawLine.trim().slice(0, 500) : name;
    return check({ ...item, productName: name, rawLine }, i);
  });
}

// ── 오픈 보고 ───────────────────────────────────────────────
// [학습] 입력 body: { businessDate, rawText, items:[{ rawLine, productName, notReceived, openingQty, label }] }
// [학습] 반환: { register(DB 결과), autoNotReceived(자동 미입고 상품 수), comparisons(이미 있는 줄의 기존↔새 값), unchanged, absentNow }
async function saveOpeningReport(user, storeCode, body) {
  const date = requireDate(body?.businessDate, '보고 날짜');
  const rawText = requireRawText(body?.rawText);
  const catalog = await loadCatalogMap(user, storeCode);
  const items = requireItems(body?.items, catalog, (item, i) => {
    const notReceived = item.notReceived === true;
    if (!notReceived && !(isQty(item.openingQty) && item.openingQty > 0)) {
      throw new HttpError(422, 'BAD_QTY', `${i + 1}번째 줄: 오픈 수량은 1 이상의 정수여야 합니다(0은 미입고).`);
    }
    return { ...item, notReceived, openingQty: notReceived ? null : item.openingQty, label: optLabel(item.label) };
  });
  const existing = await loadDay(user, storeCode, date);
  const listed = new Set(items.map(it => it.productName));

  const toRegister = [], comparisons = [], unchanged = [];
  for (const it of items) {
    const row = existing.get(it.productName);
    const proposed = it.notReceived
      ? { receipt_status: 'not_received', opening_qty: null, closing_qty: null }
      : { receipt_status: 'received', opening_qty: it.openingQty };
    if (!row) {
      toRegister.push({ raw_line: it.rawLine, raw_product_name: it.productName, opening_qty: proposed.opening_qty,
        receipt_status: proposed.receipt_status, movement_status: 'none', raw_quantity_label: it.label });
      continue;
    }
    const same = row.receipt_status === proposed.receipt_status && row.opening_qty === proposed.opening_qty;
    if (same) { unchanged.push(it.productName); continue; }
    comparisons.push({ name: it.productName, inventory_id: row.inventory_id, inventory_version: row.inventory_version,
      review_status: row.review_status, before: { receipt_status: row.receipt_status, opening_qty: row.opening_qty, closing_qty: row.closing_qty },
      changes: proposed });
  }
  // [학습] 오픈 보고에 없는 판매 중 상품 → 미입고 (이미 그날 줄이 있으면 건드리지 않음)
  let autoNotReceived = 0;
  for (const p of catalog.active) {
    if (listed.has(p.name) || existing.has(p.name)) continue;
    toRegister.push({ raw_line: '(오픈 보고에 없음 → 미입고)', raw_product_name: p.name, receipt_status: 'not_received', movement_status: 'none' });
    autoNotReceived++;
  }
  // [학습] 이전 보고에는 입고로 있었는데 이번 보고에 없는 상품 (자동으로 바꾸지 않고 알려만 줌)
  const absentNow = [...existing.values()].filter(r => r.receipt_status === 'received' && !listed.has(r.name) && r.review_status !== 'rejected').map(r => r.name);

  const register = await callRpc('bq_register_inventory', {
    p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: date, p_source_type: 'kakao',
    p_raw_payload: rawText, p_items: toRegister, p_source_checksum: null, p_finalize: true });
  return { businessDate: date, register, autoNotReceived, comparisons, unchanged, absentNow };
}

// ── 마감 보고 ───────────────────────────────────────────────
// [학습] 입력 body: { businessDate, rawText, items:[{ rawLine, productName, closingQty, label, openingQty? }] }
// [학습]   openingQty: 오픈에 없던 상품을 마감에서 발견했을 때 사용자가 입력한 오픈 수량(선택). 없으면 '확인 필요'로 자동 저장
// [학습] DB에 bq_apply_closing_report(제안 함수)가 있으면 한 번에 처리, 없으면 상품마다 정정으로 대신합니다(mode='fallback').
async function saveClosingReport(user, storeCode, body) {
  const date = requireDate(body?.businessDate, '보고 날짜');
  const rawText = requireRawText(body?.rawText);
  const catalog = await loadCatalogMap(user, storeCode);
  const items = requireItems(body?.items, catalog, (item, i) => {
    if (!isQty(item.closingQty)) throw new HttpError(422, 'BAD_QTY', `${i + 1}번째 줄: 마감 수량은 0 이상의 정수여야 합니다.`);
    if (item.openingQty !== undefined && item.openingQty !== null && !(isQty(item.openingQty) && item.openingQty > 0)) {
      throw new HttpError(422, 'BAD_QTY', `${i + 1}번째 줄: 보충할 오픈 수량은 1 이상의 정수여야 합니다.`);
    }
    return { ...item, label: optLabel(item.label), openingQty: item.openingQty ?? null };
  });

  // [학습] 1단계: 오픈에 없던 상품의 오픈 수량 보충 (사용자가 직접 입력한 경우만)
  const supplemented = [];
  const before = await loadDay(user, storeCode, date);
  const fill = items.filter(it => it.openingQty !== null);
  const newOpenRows = [];
  // [학습] 1단계-B: 오픈에 없던 상품인데 오픈 수량을 모르면 "확인 필요"로 자동 저장 (팀 결정 2026-11-04)
  // [학습]   입고 여부 'unknown' + 마감 수량 + 라벨. 확정 불가 → 판매량·예측 제외. 나중에 정정 가능.
  const needsReview = [];
  const reviewNewRows = [];
  for (const it of items.filter(x => x.openingQty === null)) {
    const row = before.get(it.productName);
    const label = '확인 필요: 오픈 보고에 없던 상품이 마감에 있음';
    if (!row) {
      reviewNewRows.push({ raw_line: it.rawLine, raw_product_name: it.productName, closing_qty: it.closingQty,
        receipt_status: 'unknown', movement_status: 'none', raw_quantity_label: label });
    } else if (row.receipt_status === 'not_received' && row.review_status !== 'rejected') {
      await callRpc('bq_correct_inventory', { p_actor_user_id: user.id, p_inventory_id: row.inventory_id,
        p_expected_version: row.inventory_version, p_changes: { receipt_status: 'unknown', closing_qty: it.closingQty, raw_quantity_label: label },
        p_change_reason: label, p_reverify: false });
    } else continue;
    needsReview.push(it.productName);
  }
  if (reviewNewRows.length) {
    await callRpc('bq_register_inventory', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: date,
      p_source_type: 'kakao', p_raw_payload: '마감 보고: 오픈 보고에 없던 상품 (확인 필요)', p_items: reviewNewRows, p_source_checksum: null, p_finalize: false });
  }
  for (const it of fill) {
    const row = before.get(it.productName);
    if (!row) newOpenRows.push({ raw_line: `(마감 보고 시 오픈 수량 보충) ${it.rawLine}`, raw_product_name: it.productName,
      opening_qty: it.openingQty, receipt_status: 'received', movement_status: 'none' });
    else if (row.receipt_status === 'not_received' && row.review_status !== 'rejected') {
      await callRpc('bq_correct_inventory', { p_actor_user_id: user.id, p_inventory_id: row.inventory_id,
        p_expected_version: row.inventory_version, p_changes: { receipt_status: 'received', opening_qty: it.openingQty },
        p_change_reason: '마감 보고 시 오픈 수량 보충', p_reverify: false });
    } else continue;
    supplemented.push(it.productName);
  }
  if (newOpenRows.length) {
    await callRpc('bq_register_inventory', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: date,
      p_source_type: 'manual', p_raw_payload: '마감 보고 시 오픈 수량 보충', p_items: newOpenRows, p_source_checksum: null, p_finalize: false });
  }

  const closingItems = items.filter(it => !needsReview.includes(it.productName)).map(it => ({ raw_line: it.rawLine, raw_product_name: it.productName, closing_qty: it.closingQty, raw_quantity_label: it.label }));
  // [학습] 2단계-A: 제안 함수가 있으면 한 번에 (전부 성공 아니면 전부 취소)
  try {
    const result = await callRpc('bq_apply_closing_report', { p_actor_user_id: user.id, p_store_code: storeCode,
      p_business_date: date, p_raw_payload: rawText, p_items: closingItems, p_source_type: 'kakao', p_source_checksum: null, p_finalize: true });
    return { businessDate: date, mode: 'function', supplemented, needsReview, failed: [], ...result };
  } catch (error) {
    if (error.code !== 'RPC_MISSING') throw error;
  }
  // [학습] 2단계-B (대체): 원문은 등록 함수로 보관(상품 줄 없이), 마감은 상품마다 정정. 실패한 상품은 failed로 돌려줌.
  await callRpc('bq_register_inventory', { p_actor_user_id: user.id, p_store_code: storeCode, p_business_date: date,
    p_source_type: 'kakao', p_raw_payload: rawText, p_items: [], p_source_checksum: null, p_finalize: false });
  const day = await loadDay(user, storeCode, date);
  const out = { businessDate: date, mode: 'fallback', supplemented, needsReview, applied: 0, verified: 0, pending: 0, details: [], failed: [] };
  for (const it of items.filter(x => !needsReview.includes(x.productName))) {
    const row = day.get(it.productName);
    let status = null, reason = null;
    if (!row) { status = 'no_opening'; reason = '그날 오픈 기록 없음'; }
    else if (row.review_status === 'rejected') { status = 'rejected'; reason = '반려된 기록'; }
    else if (row.receipt_status === 'not_received') { status = 'not_received'; reason = '오픈 보고에 없던 상품(미입고)'; }
    else if (row.closing_qty !== null) { status = 'already_closed'; reason = '이미 마감 있음'; }
    else if (row.opening_qty === null) { status = 'no_opening'; reason = '오픈 수량 없음'; }
    if (status) {
      out.details.push({ raw_product_name: it.productName, status, reason, inventory_id: row?.inventory_id ?? null,
        inventory_version: row?.inventory_version ?? null, existing_closing_qty: row?.closing_qty ?? null, new_closing_qty: it.closingQty });
      continue;
    }
    // [학습] 확정 조건을 미리 계산: 조건이 안 맞는데 재확정을 요청하면 DB가 정정 전체를 거부하기 때문
    const reverify = row.receipt_status === 'received' && row.movement_status === 'none' && row.opening_qty >= it.closingQty;
    const changes = { closing_qty: it.closingQty };
    if (it.label) changes.raw_quantity_label = it.label;
    try {
      const r = await callRpc('bq_correct_inventory', { p_actor_user_id: user.id, p_inventory_id: row.inventory_id,
        p_expected_version: row.inventory_version, p_changes: changes, p_change_reason: '마감 보고 반영', p_reverify: reverify });
      out.applied++; if (r.review_status === 'verified') out.verified++; else out.pending++;
    } catch (error) {
      out.failed.push({ name: it.productName, message: error.message });
    }
  }
  const after = await loadDay(user, storeCode, date);
  out.missing_close = [...after.values()].filter(r => r.receipt_status === 'received' && r.closing_qty === null && r.review_status !== 'rejected').map(r => r.name);
  return out;
}

export { saveOpeningReport, saveClosingReport };
