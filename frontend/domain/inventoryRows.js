// [학습] 재고 한 줄(DB 응답)을 화면 표시용 정보로 바꾸는 순수 함수 모음. React도 서버도 모릅니다.
// [학습] 판매량은 여기서 계산하지 않습니다. DB가 verified 행에만 만들어 주는 observed_sales_qty를 그대로 씁니다.

const RECEIPT = { received: '입고', not_received: '미입고', unknown: '미확인' };
const MOVEMENT = { none: '없음', present: '있음', unknown: '미확인' };
const REVIEW = { pending: '검토 대기', verified: '확정', rejected: '반려' };

// [학습] 0과 NULL을 구분해 표시합니다. NULL(미확인)은 '–', 0은 '0'.
const showQty = value => (value === null || value === undefined ? '–' : String(value));

// [학습] 이 줄이 판매량·예측 학습에 쓰이는지, 아니라면 왜인지 알려 줍니다. tone은 배지 색 구분용입니다.
function rowStatus(row) {
  if (row.review_status === 'rejected') return { label: '반려', tone: 'bad', note: '검토에서 제외된 기록' };
  if (row.receipt_status === 'not_received') return { label: '미입고', tone: 'muted', note: '수량 없음(판매 0과 다름)' };
  if (row.review_status === 'pending' && row.receipt_status === 'unknown') return { label: '확인 필요', tone: 'warn', note: '입고 여부 미확인(오픈 수량 없음) · 판매량·예측 제외' };
  if (row.review_status === 'pending') return { label: '검토 대기', tone: 'warn', note: '확정 전이라 판매량·예측에 미반영' };
  if (row.observed_sales_qty !== null && row.observed_sales_qty !== undefined) {
    return row.closing_qty === 0
      ? { label: '확정 · 품절 의심', tone: 'warn', note: '마감 0: 실제 수요가 판매량보다 클 수 있음' }
      : { label: '확정', tone: 'good', note: '' };
  }
  // [학습] verified인데 판매량이 비어 있는 경우: DB 생성식의 조건(입고·이동·수량) 중 하나가 맞지 않음
  if (row.receipt_status === 'unknown') return { label: '확정 · 제외', tone: 'muted', note: '입고 여부 미확인' };
  if (row.movement_status !== 'none') return { label: '확정 · 제외', tone: 'muted', note: '지점 간 이동 있음/미확인' };
  if (row.opening_qty === null) return { label: '확정 · 제외', tone: 'muted', note: '오픈 수량 없음' };
  if (row.closing_qty === null) return { label: '확정 · 제외', tone: 'muted', note: '마감 수량 없음' };
  return { label: '확정 · 제외', tone: 'muted', note: '마감 > 오픈' };
}

// [학습] 하루치 요약: 전체 줄 수, 상태별 개수, 확정 판매량 합계
function summarizeRows(rows) {
  const count = { total: rows.length, verified: 0, pending: 0, rejected: 0, notReceived: 0, sales: 0, stockoutSuspect: 0 };
  for (const row of rows) {
    if (row.review_status === 'verified') count.verified++;
    if (row.review_status === 'pending') count.pending++;
    if (row.review_status === 'rejected') count.rejected++;
    if (row.receipt_status === 'not_received') count.notReceived++;
    if (typeof row.observed_sales_qty === 'number') count.sales += row.observed_sales_qty;
    if (row.review_status === 'verified' && row.closing_qty === 0) count.stockoutSuspect++;
  }
  return count;
}

export { RECEIPT, MOVEMENT, REVIEW, showQty, rowStatus, summarizeRows };

// ── v2 2차 추가: 정정 폼 ──────────────────────────────────────
// [학습] 폼 입력값(문자열)을 DB 정정 형식으로 바꾸고, 원래 값과 달라진 항목만 돌려줍니다.
// [학습] 반환: { changes, errors[] }. errors가 있으면 서버로 보내지 않습니다(서버·DB도 같은 규칙으로 한 번 더 검사).
function parseQtyInput(text) {
  const t = String(text ?? '').trim();
  if (t === '') return { value: null };
  if (!/^\d+$/.test(t)) return { error: '수량은 0 이상의 정수로 입력하거나 비워 두세요.' };
  return { value: Number(t) };
}

function buildCorrection(row, form) {
  const errors = [];
  const open = parseQtyInput(form.opening_qty), close = parseQtyInput(form.closing_qty);
  if (open.error) errors.push(`오픈: ${open.error}`);
  if (close.error) errors.push(`마감: ${close.error}`);
  const next = {
    opening_qty: open.value ?? null, closing_qty: close.value ?? null,
    receipt_status: form.receipt_status, movement_status: form.movement_status,
  };
  // [학습] DB CHECK 규칙: 미입고면 오픈·마감 모두 NULL이어야 함
  if (next.receipt_status === 'not_received' && (next.opening_qty !== null || next.closing_qty !== null)) {
    errors.push('미입고로 바꾸려면 오픈·마감 수량을 비워야 합니다.');
  }
  if (next.opening_qty !== null && next.closing_qty !== null && next.closing_qty > next.opening_qty) {
    errors.push('마감이 오픈보다 큽니다. 이대로 저장하면 확정할 수 없습니다.');
  }
  const changes = {};
  for (const key of Object.keys(next)) if (next[key] !== row[key]) changes[key] = next[key];
  // [학습] 원문 라벨(품절/완판 등)은 조회 응답에 현재 값이 없어 비교할 수 없습니다. 입력했을 때만 보냅니다.
  const label = String(form.raw_quantity_label ?? '').trim();
  if (label) changes.raw_quantity_label = label;
  if (!String(form.reason ?? '').trim()) errors.push('수정 사유를 입력하세요.');
  if (!Object.keys(changes).length) errors.push('바뀐 내용이 없습니다.');
  return { changes, errors };
}

// [학습] 확정 버튼을 보여줄지: pending이면서 DB 확정 조건을 미리 만족하는 줄만. (DB가 최종 판단)
function canVerify(row) {
  if (row.review_status !== 'pending') return false;
  if (row.receipt_status === 'not_received') return row.opening_qty === null && row.closing_qty === null;
  return row.receipt_status === 'received' && row.movement_status === 'none'
    && row.opening_qty !== null && row.closing_qty !== null && row.opening_qty >= row.closing_qty;
}

// [학습] 정정을 적용한 "뒤의 줄"이 확정 조건을 만족하는지. 만족하지 않는데 재확정을 요청하면 DB가 정정 전체를 거부합니다.
function verifiableAfter(row, changes) {
  const next = { ...row, ...changes, review_status: 'pending' };
  return canVerify(next);
}

export { buildCorrection, canVerify, parseQtyInput, verifiableAfter };
