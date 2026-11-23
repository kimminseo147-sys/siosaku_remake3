// [학습] 서버 입력 검증 모음. 브라우저에서 한 번 검사했더라도 서버에서 다시 검사합니다(브라우저 값은 조작 가능).
// [학습] 규칙의 근거는 DB 스키마 v3.0입니다. DB도 같은 검사를 하지만, 여기서 먼저 막으면 더 친절한 메시지를 줄 수 있습니다.
import { HttpError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  if (!UUID.test(value || '')) throw new HttpError(422, 'INVALID_ID', `${label} 형식이 올바르지 않습니다.`);
  return value.toLowerCase();
}

// [학습] YYYY-MM-DD 형식이고 실제로 존재하는 날짜인지 확인합니다(예: 2026-02-30 거부).
function requireDate(value, label = '날짜') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new HttpError(422, 'INVALID_DATE', `${label}는 YYYY-MM-DD 형식이어야 합니다.`);
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new HttpError(422, 'INVALID_DATE', `${label}가 존재하지 않는 날짜입니다.`);
  }
  return value;
}

// [학습] 두 날짜 사이 일수. 기간 조회가 너무 길면 서버·DB에 부담이 되므로 상한을 둡니다.
const MAX_RANGE_DAYS = 400;
function requireRange(from, to) {
  requireDate(from, '시작일'); requireDate(to, '종료일');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0) throw new HttpError(422, 'INVALID_RANGE', '종료일이 시작일보다 빠릅니다.');
  if (days > MAX_RANGE_DAYS) throw new HttpError(422, 'RANGE_TOO_LONG', `기간은 최대 ${MAX_RANGE_DAYS}일까지 조회할 수 있습니다.`);
  return { from, to };
}

function requireVersion(value) {
  if (!Number.isInteger(value) || value < 1) throw new HttpError(422, 'INVALID_VERSION', '기록 버전(expectedVersion)이 필요합니다. 새로고침 후 다시 시도하세요.');
  return value;
}

function requireReason(value, { optional = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (optional) return null;
    throw new HttpError(422, 'REASON_REQUIRED', '수정 사유를 입력하세요.');
  }
  if (text.length > 200) throw new HttpError(422, 'REASON_TOO_LONG', '사유는 200자 이내로 입력하세요.');
  return text;
}

// [학습] bq_correct_inventory가 허용하는 키만 통과시킵니다(DB의 'Unsupported correction key' 규칙과 동일).
const CORRECTION_KEYS = ['opening_qty', 'closing_qty', 'receipt_status', 'movement_status', 'raw_quantity_label'];
const RECEIPT = ['received', 'not_received', 'unknown'];
const MOVEMENT = ['none', 'present', 'unknown'];

function requireChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
    throw new HttpError(422, 'NO_CHANGES', '바꿀 내용이 없습니다.');
  }
  const clean = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!CORRECTION_KEYS.includes(key)) throw new HttpError(422, 'BAD_KEY', `수정할 수 없는 항목입니다: ${key}`);
    if (key === 'opening_qty' || key === 'closing_qty') {
      // [학습] null은 "미확인"으로 저장. 숫자는 0 이상의 정수만 허용(0은 실제 수량).
      if (value !== null && !(Number.isInteger(value) && value >= 0 && value <= 100000)) {
        throw new HttpError(422, 'BAD_QTY', '수량은 0 이상의 정수이거나 비워 두어야 합니다.');
      }
    }
    if (key === 'receipt_status' && !RECEIPT.includes(value)) throw new HttpError(422, 'BAD_STATUS', '입고 상태 값이 올바르지 않습니다.');
    if (key === 'movement_status' && !MOVEMENT.includes(value)) throw new HttpError(422, 'BAD_STATUS', '이동 상태 값이 올바르지 않습니다.');
    if (key === 'raw_quantity_label' && value !== null && (typeof value !== 'string' || value.length > 50)) {
      throw new HttpError(422, 'BAD_LABEL', '원문 라벨은 50자 이내 글자여야 합니다.');
    }
    clean[key] = value;
  }
  return clean;
}

export { requireUuid, requireDate, requireRange, requireVersion, requireReason, requireChanges, CORRECTION_KEYS, MAX_RANGE_DAYS };
