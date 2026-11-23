// [학습] v2 화면. ① 로그인 후 사용 ② 데이터는 서버 /api로만 ③ 재고는 상품마다 한 줄
// [학습] (2026-11-23) Vite로 전환: 브라우저 안 Babel 대신 Vite가 JSX를 미리 변환·묶어(build) 줍니다.
// [학습]   그래서 React·Supabase·엑셀 도구도 CDN <script>가 아니라 npm 패키지를 import로 가져옵니다.
// [학습]   화면 시작(createRoot)은 main.jsx로 옮겼고, 이 파일은 App 컴포넌트를 내보내기(export)만 합니다.
// [학습] JSX가 없는 계산 코드는 domain/, 서버 호출은 services/에 있습니다.
// [학습] npm 패키지 react에서 가져옵니다(예전: CDN이 만든 전역 변수 React에서 꺼냄).
import React, { useState, useEffect, useMemo } from 'react';
import { localDay } from './domain/dates.js';
import { RECEIPT, MOVEMENT, REVIEW, showQty, rowStatus, summarizeRows, buildCorrection, canVerify, verifiableAfter } from './domain/inventoryRows.js';
import { parseReport } from './parsers/kakaoReport.js';
import { analyzeExcelRows } from './parsers/excelImport.js';
import { summarizeRange } from './domain/salesStats.js';
import { signIn, signOut, getAccessToken, onAuthChange, isDevMode } from './services/authService.js';
import { importExcelDays, loadMe, loadCatalog, loadInventory, loadInventoryRange, verifyRow, correctRow, rejectRow, runForecast, loadForecastResults, replayForecast, saveOpeningReport, saveClosingReport } from './services/inventoryRepository.js';

const DAY = 86400000;
const isMissingRpc = err => err?.code === 'RPC_MISSING';
const fmtQty2 = v => (v === null || v === undefined ? '–' : Number(v).toFixed(2));

// ── 로그인 ─────────────────────────────────────────────────
function LoginPanel({ onDone }) {
  const [loginId, setLoginId] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await signIn(loginId, password); onDone(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="wrap"><section className="panel login">
    <h2>로그인</h2>
    <p className="subtle">지점 아이디와 비밀번호로 로그인하세요. 계정·비밀번호는 관리자에게 문의하세요.</p>
    {error && <div className="notice error">⚠️ {error}</div>}
    <form onSubmit={submit} className="loginform">
      <label className="field"><span>아이디</span><input id="login-id" className="control" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={loginId} onChange={e => setLoginId(e.target.value)} /></label>
      <label className="field"><span>비밀번호</span><input id="login-password" className="control" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="btn full" type="submit" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
    </form>
  </section></main>;
}

const Badge = ({ status }) => <span className={`badge ${status.tone}`} title={status.note}>{status.label}</span>;

// ── 정정 폼 (한 줄) ─────────────────────────────────────────
// [학습] 저장하면 DB가 이 줄을 '검토 대기'로 되돌리고 버전을 1 올립니다. 이력(inventory_revisions)에 사유가 남습니다.
function CorrectionForm({ row, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    opening_qty: row.opening_qty ?? '', closing_qty: row.closing_qty ?? '',
    receipt_status: row.receipt_status, movement_status: row.movement_status,
    raw_quantity_label: '', reason: '', reverify: false,
  });
  const [errors, setErrors] = useState([]);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const notReceived = form.receipt_status === 'not_received';
  function submit() {
    const result = buildCorrection(row, notReceived ? { ...form, opening_qty: '', closing_qty: '' } : form);
    setErrors(result.errors);
    if (!result.errors.length) onSubmit(result.changes, form.reason.trim(), form.reverify);
  }
  const id = row.inventory_id;
  return <div className="correction">
    <div className="grid-fields">
      <div className="field"><label htmlFor={`o-${id}`}>오픈</label><input id={`o-${id}`} className="control" inputMode="numeric" disabled={notReceived} value={notReceived ? '' : form.opening_qty} onChange={e => set('opening_qty', e.target.value)} placeholder="비우면 미확인" /></div>
      <div className="field"><label htmlFor={`c-${id}`}>마감</label><input id={`c-${id}`} className="control" inputMode="numeric" disabled={notReceived} value={notReceived ? '' : form.closing_qty} onChange={e => set('closing_qty', e.target.value)} placeholder="비우면 미확인" /></div>
      <div className="field"><label htmlFor={`r-${id}`}>입고</label><select id={`r-${id}`} className="control" value={form.receipt_status} onChange={e => set('receipt_status', e.target.value)}>{Object.entries(RECEIPT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor={`m-${id}`}>이동</label><select id={`m-${id}`} className="control" value={form.movement_status} onChange={e => set('movement_status', e.target.value)}>{Object.entries(MOVEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor={`l-${id}`}>원문 라벨 (선택)</label><input id={`l-${id}`} className="control" maxLength={50} value={form.raw_quantity_label} onChange={e => set('raw_quantity_label', e.target.value)} placeholder="예: 품절, 완판" /></div>
      <div className="field"><label htmlFor={`s-${id}`}>수정 사유 (필수)</label><input id={`s-${id}`} className="control" maxLength={200} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="예: 마감보고 수량 오기 정정" /></div>
    </div>
    <label className="subtle" style={{ display: 'block', margin: '8px 0' }}><input id={`v-${id}`} type="checkbox" checked={form.reverify} onChange={e => set('reverify', e.target.checked)} /> 정정 후 바로 확정 (조건이 맞을 때만 DB가 허용)</label>
    {errors.length > 0 && <div className="notice error">{errors.join('\n')}</div>}
    <div className="row"><button className="btn small" disabled={busy} onClick={submit}>정정 저장</button><button className="btn secondary small" disabled={busy} onClick={onCancel}>취소</button></div>
  </div>;
}

// ── 카톡 보고 입력 (Y안: 오픈 붙여넣기 → 저장, 약 1분 뒤 마감 붙여넣기 → 저장) ─────────────
// [학습] 미리보기에서 막는 것: 17시 보고, 날짜 오류, 지점 불일치, 수량 형식 오류, 사전에 없는 상품(고르거나 빼기),
// [학습]   중복 상품, (마감) 오픈에 없던 상품(오픈 수량 입력하거나 빼기). 경고만 하는 것: 날짜 대체, 마감 누락 상품.
const SKIP = '__skip__';
const receiptText = r => r.receipt_status === 'not_received' ? '미입고' : `오픈 ${showQty(r.opening_qty)} · 마감 ${showQty(r.closing_qty)}`;

function ReportPanel({ storeCode, products, defaultDate, busy, setBusy, onSaved, onError, onMessage }) {
  const [type, setType] = useState('opening');
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null), [dayRows, setDayRows] = useState([]);
  const [choices, setChoices] = useState({}), [result, setResult] = useState(null);
  const [fixed, setFixed] = useState({});
  const choose = (row, patch) => setChoices(prev => ({ ...prev, [row]: { ...prev[row], ...patch } }));
  const reset = () => { setParsed(null); setChoices({}); setResult(null); setFixed({}); };

  async function check() {
    setResult(null); setFixed({});
    const p = parseReport(text, { expectedType: type, storeCode, products, fallbackDate: defaultDate });
    setChoices({}); setParsed(p);
    if (p.date) {
      try { setDayRows((await loadInventory(storeCode, p.date)).items); } catch (err) { setDayRows([]); onError(err); }
    }
  }

  // [학습] 줄마다 최종 상품·저장 여부·막는 이유를 계산합니다.
  const byName = new Map(dayRows.map(r => [r.name, r]));
  const lines = (parsed?.lines || []).map(line => {
    const c = choices[line.row] || {};
    const skipped = c.productName === SKIP;
    const productName = skipped ? null : (line.product?.name || c.productName || null);
    const day = productName ? byName.get(productName) : null;
    const closeOnly = type === 'closing' && productName && (!day || day.receipt_status === 'not_received' || day.opening_qty === null) && day?.review_status !== 'rejected';
    const fillOpen = closeOnly ? Number(c.openingQty) : null;
    let block = null;
    if (!skipped) {
      if (line.error) block = line.error;
      else if (!productName) block = '사전에 없는 상품명: 기존 상품을 고르거나 이 줄을 빼세요';
      else if (line.duplicate) block = '같은 상품이 두 번 있습니다';
      // [학습] 오픈에 없던 상품: 막지 않음. 오픈 수량을 입력하면 보충, 비우면 "확인 필요"로 저장(팀 결정)
      else if (closeOnly && String(choices[line.row]?.openingQty ?? '').trim() !== '' && !(Number.isInteger(fillOpen) && fillOpen > 0)) block = '오픈 수량은 1 이상의 정수로 입력하거나 비워 두세요';
    }
    return { ...line, skipped, productName, day, closeOnly, fillOpen, block };
  });
  const kept = lines.filter(l => !l.skipped);
  const listed = new Set(kept.map(l => l.productName));
  const blocked = !parsed || parsed.issues.length > 0 || lines.some(l => l.block) || kept.length === 0;
  const autoNotReceived = type === 'opening' ? products.filter(p => p.active && !listed.has(p.name) && !byName.has(p.name)).length : 0;
  const missingClose = type === 'closing' ? dayRows.filter(r => r.receipt_status === 'received' && r.opening_qty !== null && r.closing_qty === null && r.review_status !== 'rejected' && !listed.has(r.name)).map(r => r.name) : [];

  async function save() {
    setBusy(true);
    try {
      const payload = { businessDate: parsed.date, rawText: text, items: kept.map(l => type === 'opening'
        ? { rawLine: l.rawLine, productName: l.productName, notReceived: l.notReceived, openingQty: l.qty, label: l.label }
        : { rawLine: l.rawLine, productName: l.productName, closingQty: l.qty, label: l.label, ...(l.closeOnly && l.fillOpen > 0 ? { openingQty: l.fillOpen } : {}) }) };
      const res = type === 'opening' ? await saveOpeningReport(storeCode, payload) : await saveClosingReport(storeCode, payload);
      setResult({ type, ...res });
      setDayRows((await loadInventory(storeCode, parsed.date)).items);
      onMessage(`${parsed.date} ${type === 'opening' ? '오픈' : '마감'} 보고를 저장했습니다.`);
      onSaved(parsed.date);
    } catch (err) { onError(err); }
    finally { setBusy(false); }
  }

  // [학습] 이미 있던 줄을 새 값으로 정정 (A8). 확정 조건이 맞을 때만 재확정을 요청합니다.
  async function applyFix(key, row, changes) {
    setBusy(true);
    try {
      await correctRow(row, changes, '보고 재입력', verifiableAfter({ movement_status: 'none', ...row }, changes), { storeCode, businessDate: result.businessDate });
      setFixed(prev => ({ ...prev, [key]: true }));
      setDayRows((await loadInventory(storeCode, result.businessDate)).items);
      onMessage(`${key}: 새 값으로 정정했습니다.`);
      onSaved(result.businessDate);
    } catch (err) { onError(err); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <h2>💬 카톡 보고 입력</h2>
    <div className="row" style={{ marginBottom: 8 }}>
      {[['opening', '오픈 보고'], ['closing', '마감 보고']].map(([k, label]) =>
        <button key={k} className={`btn small ${type === k ? '' : 'secondary'}`} onClick={() => { setType(k); reset(); }}>{label}</button>)}
      <span className="subtle">오픈을 먼저 저장한 뒤 마감을 저장하세요. 날짜가 없으면 위에서 선택한 {defaultDate}를 씁니다.</span>
    </div>
    <textarea id="report-text" className="control" style={{ width: '100%', minHeight: 130 }} value={text} placeholder={type === 'opening' ? '11월 5일 오픈\n오사카 시오빵 / 20개\n멜론 시오빵 / 10개' : '11월 5일 마감\n오사카 시오빵 / 3개\n멜론 시오빵 / 품절'}
      onChange={e => { setText(e.target.value); reset(); }} />
    <button className="btn full" style={{ marginTop: 8 }} disabled={busy || !text.trim()} onClick={check}>보고 내용 확인</button>

    {parsed && !result && <div style={{ marginTop: 12 }}>
      <div className="tags"><span className="tag">{parsed.date || '날짜 오류'}</span><span className="tag">{type === 'opening' ? '오픈' : '마감'}</span><span className="tag">{kept.length}개 상품</span></div>
      {parsed.warnings.length > 0 && <div className="notice">{parsed.warnings.join('\n')}</div>}
      {parsed.issues.length > 0 && <div className="notice error">{parsed.issues.join('\n')}</div>}
      <div className="tablebox"><table className="data">
        <thead><tr><th>상품 (원문)</th><th>{type === 'opening' ? '오픈' : '마감'}</th><th>확인</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.row} className={l.skipped ? 'skipped' : ''}>
          <td>{l.product ? l.product.name : <select id={`pick-${l.row}`} className="control" value={choices[l.row]?.productName || ''} onChange={e => choose(l.row, { productName: e.target.value })}>
            <option value="">상품 선택…</option><option value={SKIP}>이 줄 빼기</option>
            {[...products].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ko')).map(p => <option key={p.product_id} value={p.name}>{p.name}{p.active ? '' : ' (판매 종료)'}</option>)}
          </select>}<div className="subtle">{l.rawLine}</div></td>
          <td className="num">{l.error ? '–' : type === 'opening' ? (l.notReceived ? '미입고' : l.qty) : `${l.qty}${l.label ? ` (${l.label})` : ''}`}</td>
          <td>{l.skipped ? <span className="badge muted">빼고 저장</span> : l.block ? <span className="badge bad">{l.block}</span> : l.closeOnly && !(l.fillOpen > 0) ? <span className="badge warn">오픈에 없던 상품 → 확인 필요로 저장</span> : <span className="badge good">OK</span>}
            {l.closeOnly && !l.skipped && <div className="row" style={{ marginTop: 4 }}>
              <input id={`fill-${l.row}`} className="control" style={{ width: 90 }} inputMode="numeric" placeholder="오픈 수량(알면)" value={choices[l.row]?.openingQty || ''} onChange={e => choose(l.row, { openingQty: e.target.value })} />
              <button className="btn secondary small" onClick={() => choose(l.row, { productName: SKIP })}>이 줄 빼기</button></div>}
            {(l.error || l.duplicate) && !l.skipped && <button className="btn secondary small" style={{ marginLeft: 4 }} onClick={() => choose(l.row, { productName: SKIP })}>이 줄 빼기</button>}
            {l.day && l.day.receipt_status === 'received' && (type === 'opening' || l.day.closing_qty !== null) && <div className="subtle">이미 기록 있음: {receiptText(l.day)} → 저장 후 비교</div>}
          </td></tr>)}</tbody>
      </table></div>
      {autoNotReceived > 0 && <p className="subtle">보고에 없는 판매 중 상품 {autoNotReceived}종은 그날 미입고로 저장됩니다.</p>}
      {missingClose.length > 0 && <div className="notice">오픈에는 있는데 이 마감 보고에 없는 상품 {missingClose.length}개: {missingClose.join(', ')}{'\n'}기재 누락이면 마감 보고를 고쳐 주세요. 그대로 저장하면 "마감 누락"으로 남고 판매량에서 빠집니다.</div>}
      <button className="btn green full" disabled={busy || blocked} onClick={save}>{blocked ? '위 문제를 해결해야 저장할 수 있습니다' : `${type === 'opening' ? '오픈' : '마감'} 보고 저장`}</button>
    </div>}

    {result && <ReportResult result={result} dayRows={dayRows} fixed={fixed} busy={busy} onFix={applyFix} onDone={() => { setText(''); reset(); }} />}
  </section>;
}

function ReportResult({ result, dayRows, fixed, busy, onFix, onDone }) {
  const byId = new Map(dayRows.map(r => [r.inventory_id, r]));
  if (result.type === 'opening') {
    const r = result.register;
    return <div style={{ marginTop: 12 }}>
      <div className="notice good">오픈 저장: 새 줄 {r.matched_names}개 (확정 {r.verified} · 대기 {r.pending}) · 자동 미입고 {result.autoNotReceived}종{result.unchanged.length ? ` · 같은 값이라 건너뜀 ${result.unchanged.length}개` : ''}</div>
      {result.comparisons.length > 0 && <>
        <h3>이미 기록이 있어 바꾸지 않은 상품 ({result.comparisons.length})</h3>
        {result.comparisons.map(c => { const row = byId.get(c.inventory_id) || { ...c.before, inventory_id: c.inventory_id, inventory_version: c.inventory_version };
          return <div className="summaryline" key={c.name}><span><b>{c.name}</b> 기존 {receiptText(c.before)} → 새 값 {c.changes.receipt_status === 'not_received' ? '미입고' : `오픈 ${c.changes.opening_qty}`}</span>
            {fixed[c.name] ? <span className="badge good">정정함</span> : <button className="btn small" disabled={busy} onClick={() => onFix(c.name, row, c.changes)}>새 값으로 정정</button>}</div>; })}
      </>}
      {result.skippedRejected?.length > 0 && <div className="notice">반려된 기록이라 바꾸지 않은 상품: {result.skippedRejected.join(', ')}. 반려 기록은 정정할 수 없습니다.</div>}
      {result.absentNow.length > 0 && <div className="notice">이전 보고에는 있었는데 이번 보고에 없는 상품: {result.absentNow.join(', ')}. 자동으로 바꾸지 않았습니다. 필요하면 표에서 정정하세요.</div>}
      <button className="btn secondary small" onClick={onDone}>새 보고 입력</button>
    </div>;
  }
  const closed = (result.details || []).filter(d => d.status === 'already_closed');
  const others = (result.details || []).filter(d => d.status !== 'already_closed');
  return <div style={{ marginTop: 12 }}>
    <div className="notice good">마감 반영 {result.applied}개 (확정 {result.verified} · 대기 {result.pending}){result.supplemented?.length ? ` · 오픈 수량 보충 ${result.supplemented.length}개` : ''}{result.mode === 'fallback' ? '\n(마감 반영 DB 함수 미설치: 상품마다 정정으로 저장했습니다)' : ''}</div>
    {result.needsReview?.length > 0 && <div className="notice">확인 필요로 저장 {result.needsReview.length}개 (오픈 보고에 없던 상품): {result.needsReview.join(', ')} — 판매량·예측에서 빠집니다. 오픈 수량을 알게 되면 표에서 정정하세요.</div>}
    {result.failed?.length > 0 && <div className="notice error">저장 실패 {result.failed.length}개: {result.failed.map(f => `${f.name}(${f.message})`).join(', ')}{'\n'}같은 마감 보고를 다시 저장하면 이미 반영된 상품은 건너뛰고 실패한 상품만 다시 시도합니다.</div>}
    {closed.length > 0 && <><h3>이미 마감이 있어 바꾸지 않은 상품 ({closed.length})</h3>
      {closed.map(d => { const row = byId.get(d.inventory_id); return <div className="summaryline" key={d.raw_product_name}><span><b>{d.raw_product_name}</b> 기존 마감 {d.existing_closing_qty} → 새 값 {d.new_closing_qty}</span>
        {fixed[d.raw_product_name] ? <span className="badge good">정정함</span> : row && <button className="btn small" disabled={busy} onClick={() => onFix(d.raw_product_name, row, { closing_qty: d.new_closing_qty })}>새 값으로 정정</button>}</div>; })}</>}
    {others.length > 0 && <div className="notice">저장하지 않은 상품: {others.map(d => `${d.raw_product_name}(${d.reason})`).join(', ')}</div>}
    {result.missing_close?.length > 0 && <div className="notice">마감 누락 {result.missing_close.length}개: {result.missing_close.join(', ')} — 판매량 계산에서 빠집니다.</div>}
    <button className="btn secondary small" onClick={onDone}>새 보고 입력</button>
  </div>;
}

// ── 엑셀 일괄 등록 ─────────────────────────────────────────
// [학습] 전처리 엑셀(시트 "재고 데이터": 날짜·상품명·오픈재고·잔여재고)을 날짜별로 저장합니다.
// [학습] 한 행이라도 문제가 있는 날짜는 통째로 빼고(격리), 이미 기록이 있는 날짜는 서버가 건너뜁니다.
// [학습] 카톡 입력과 달리 "보고에 없는 상품 = 미입고" 자동 줄은 만들지 않습니다(엑셀에는 미입고가 0으로 직접 적혀 있음).
function ExcelPanel({ storeCode, products, busy, setBusy, onDone, onError, onMessage }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(''), [to, setTo] = useState(localDay(new Date(Date.now() - DAY)));
  const [file, setFile] = useState(null), [choices, setChoices] = useState({});
  const [progress, setProgress] = useState(null), [results, setResults] = useState(null);

  async function readFile(f) {
    setResults(null); setChoices({}); setFile(null);
    try {
      // [학습] 엑셀 도구(xlsx)는 크기가 커서, 파일을 고를 때 처음 한 번만 불러옵니다(동적 import). 첫 화면이 그만큼 빨라집니다.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
      const sheet = wb.Sheets['재고 데이터'] || wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('엑셀 시트가 없습니다.');
      setFile({ name: f.name, rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }), parseDateCode: v => XLSX.SSF.parse_date_code(v) });
    } catch (err) { onError(err); }
  }

  const analysis = useMemo(() => {
    if (!file) return null;
    try { return analyzeExcelRows(file.rows, { products, from, to, nameChoices: choices, parseDateCode: file.parseDateCode }); }
    catch (err) { return { error: err.message }; }
  }, [file, products, from, to, choices]);

  async function save() {
    const days = analysis.days;
    if (!window.confirm(`${days.length}일을 등록합니다. 이미 기록이 있는 날짜는 건너뜁니다. 계속할까요?`)) return;
    setBusy(true); setResults(null);
    const all = [];
    try {
      for (let i = 0; i < days.length; i += 31) {
        setProgress(`${Math.min(i + 31, days.length)} / ${days.length}일 저장 중…`);
        const res = await importExcelDays(storeCode, file.name, days.slice(i, i + 31));
        all.push(...res.results);
      }
      onMessage(`엑셀 등록 완료: 저장 ${all.filter(r => r.status === 'saved').length}일 · 건너뜀 ${all.filter(r => r.status === 'skipped').length}일 · 실패 ${all.filter(r => r.status === 'failed').length}일`);
      onDone();
    } catch (err) { onError(err); }
    finally { setResults(all); setProgress(null); setBusy(false); }
  }

  if (!open) return <section className="panel"><button className="btn secondary small" onClick={() => setOpen(true)}>📗 엑셀 일괄 등록 열기</button></section>;
  const a = analysis;
  return <section className="panel">
    <div className="row" style={{ justifyContent: 'space-between' }}><h2>📗 엑셀 일괄 등록</h2><button className="btn secondary small" onClick={() => setOpen(false)}>닫기</button></div>
    <p className="subtle">시트 "재고 데이터"의 날짜·상품명·오픈재고·잔여재고 열을 읽습니다. 오픈 0 = 미입고, 잔여 0·품절 = 품절(0개), 오픈 공란 = 입고 여부 미확인, 오픈 0인데 잔여 있음 = 확인 필요. 기존 날짜는 덮어쓰지 않습니다.</p>
    <div className="grid-fields">
      <div className="field"><label htmlFor="xl-from">시작일 (선택)</label><input id="xl-from" type="date" className="control" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="field"><label htmlFor="xl-to">마지막 날짜</label><input id="xl-to" type="date" className="control" value={to} onChange={e => setTo(e.target.value)} /></div>
    </div>
    <label className="fileinput" style={{ marginTop: 8 }}>엑셀 파일 선택 (.xlsx, .xls)
      <input id="xl-file" hidden type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
    </label>
    {a?.error && <div className="notice error">{a.error}</div>}
    {a && !a.error && <div style={{ marginTop: 12 }}>
      <h3>등록 전 검증 · {file.name}</h3>
      <div className="metrics">
        <div className="metric"><strong>{a.days.length}</strong><span>등록할 날짜</span></div>
        <div className="metric"><strong>{a.blocked.length}</strong><span>문제가 있어 뺀 날짜</span></div>
        <div className="metric"><strong>{a.counts.rows}</strong><span>상품 행</span></div>
        <div className="metric"><strong>{a.counts.notReceived}</strong><span>미입고 행</span></div>
      </div>
      <div className="subtle" style={{ marginTop: 8 }}>확인 필요(오픈 0·마감 있음) {a.counts.needsReview} · 오픈 미확인 {a.counts.missingOpen} · 마감 누락 {a.counts.missingClose} · 품절 {a.counts.stockout} · 마감 &gt; 오픈 {a.counts.closeOverOpen} · 기간 밖 {a.counts.outside} · 빈 행 {a.counts.empty}{a.counts.skippedByChoice ? ` · 뺀 이름의 행 ${a.counts.skippedByChoice}` : ''}</div>
      {a.unmatchedNames.length > 0 && <div className="notice error" style={{ marginTop: 10 }}>사전에 없는 상품명 {a.unmatchedNames.length}개 — 이름마다 상품을 고르거나 빼세요. 고르기 전까지 그 이름이 있는 날짜는 등록되지 않습니다.
        {a.unmatchedNames.map(u => <div className="row" key={u.name} style={{ marginTop: 6 }}><span style={{ minWidth: 140 }}>{u.name} ({u.rows}행)</span>
          <select id={`xl-pick-${u.name}`} className="control grow" value={choices[u.name] || ''} onChange={e => setChoices(prev => ({ ...prev, [u.name]: e.target.value }))}>
            <option value="">상품 선택…</option><option value="__skip__">이 이름의 행 빼기</option>
            {[...products].sort((x, y) => (y.active - x.active) || x.name.localeCompare(y.name, 'ko')).map(p => <option key={p.product_id} value={p.name}>{p.name}{p.active ? '' : ' (판매 종료)'}</option>)}
          </select></div>)}
      </div>}
      {a.blocked.length > 0 && <div className="notice" style={{ marginTop: 10 }}>뺀 날짜 {a.blocked.length}일{'\n'}{a.blocked.slice(0, 8).map(b => `${b.date}: ${[...new Set(b.reasons)].slice(0, 3).join(', ')}`).join('\n')}{a.blocked.length > 8 ? '\n…' : ''}</div>}
      {a.warnings.length > 0 && <div className="notice" style={{ marginTop: 10 }}>검토 내용 {a.warnings.length}건{'\n'}{a.warnings.slice(0, 8).join('\n')}{a.warnings.length > 8 ? '\n…' : ''}</div>}
      <button className="btn green full" style={{ marginTop: 10 }} disabled={busy || !a.days.length} onClick={save}>{progress || `${a.days.length}일 등록 (기존 날짜는 건너뜀)`}</button>
    </div>}
    {results && results.length > 0 && <div className="notice" style={{ marginTop: 10 }}>저장 {results.filter(r => r.status === 'saved').length}일 · 건너뜀 {results.filter(r => r.status === 'skipped').length}일 · 실패 {results.filter(r => r.status === 'failed').length}일
      {results.filter(r => r.status === 'failed').slice(0, 8).map(r => `\n${r.date}: ${r.message}`).join('')}</div>}
  </section>;
}

// ── 재고 기록 탭 ────────────────────────────────────────────
function RecordTab({ storeCode, canEdit, targetIds, products, onError, onMessage }) {
  const catalogCount = products.length;
  // [학습] 기본 날짜는 어제. 오늘 마감 보고는 저녁 이후에 들어오기 때문입니다.
  const [date, setDate] = useState(localDay(new Date(Date.now() - DAY)));
  const [inventory, setInventory] = useState(null), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''), [onlyTargets, setOnlyTargets] = useState(false);
  // [학습] editing: { id, mode: 'correct' | 'reject' } — 한 번에 한 줄만 펼칩니다.
  const [editing, setEditing] = useState(null), [rejectReason, setRejectReason] = useState('');
  const toggle = (id, mode) => { setRejectReason(''); setEditing(editing?.id === id && editing.mode === mode ? null : { id, mode }); };

  async function refresh() {
    setBusy(true); setEditing(null);
    try { setInventory(await loadInventory(storeCode, date)); }
    catch (err) { setInventory(null); onError(err); }
    finally { setBusy(false); }
  }
  useEffect(() => { refresh(); }, [storeCode, date]);

  // [학습] 쓰기 작업 공통 처리: 성공하면 메시지 후 새로고침. 409(다른 사람이 먼저 수정)여도 새로고침해서 최신 값을 보여줌
  async function act(action, success) {
    setBusy(true);
    try { await action(); onMessage(success); }
    catch (err) { onError(err); }
    await refresh();
  }

  const rows = inventory?.items || [];
  const shown = rows.filter(r => r.name.includes(search.trim()) && (!onlyTargets || targetIds.has(r.product_id)));
  const summary = summarizeRows(rows);

  return <>
  {canEdit && <ReportPanel storeCode={storeCode} products={products} defaultDate={date} busy={busy} setBusy={setBusy}
    onSaved={d => { if (d === date) refresh(); else setDate(d); }} onError={onError} onMessage={onMessage} />}
  {canEdit && <ExcelPanel storeCode={storeCode} products={products} busy={busy} setBusy={setBusy} onDone={refresh} onError={onError} onMessage={onMessage} />}
  <section className="panel">
    <h2>날짜별 재고 (상품마다 한 줄)</h2>
    <div className="row" style={{ marginBottom: 10 }}>
      <input id="record-date" className="control" type="date" value={date} disabled={busy} onChange={e => setDate(e.target.value)} />
      <button className="btn secondary small" disabled={busy} onClick={refresh}>⟳ 새로고침</button>
      <span className="subtle">{busy ? '처리 중…' : inventory ? `${inventory.branch} · ${inventory.record_date}` : ''}</span>
    </div>
    {!canEdit && <div className="notice">이 지점은 조회 권한(viewer)이라 확정·정정 버튼이 보이지 않습니다.</div>}

    {inventory && <div className="metrics">
      <div className="metric"><strong>{summary.total}</strong><span>등록된 상품 줄{catalogCount ? ` / 전체 ${catalogCount}종` : ''}</span></div>
      <div className="metric"><strong>{summary.verified}</strong><span>확정</span></div>
      <div className="metric"><strong>{summary.pending}</strong><span>검토 대기</span></div>
      <div className="metric"><strong>{summary.sales}</strong><span>확정 판매량 합계(개)</span></div>
    </div>}

    <div className="row" style={{ margin: '12px 0 10px' }}>
      <input id="record-search" className="control grow" placeholder="상품명 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <label className="subtle"><input id="only-targets" type="checkbox" checked={onlyTargets} onChange={e => setOnlyTargets(e.target.checked)} /> 예측 대상 10종만</label>
    </div>

    {inventory && rows.length === 0 && <p>이 날짜에 등록된 재고가 없습니다.</p>}
    {shown.length > 0 && <div className="tablebox"><table className="data">
      <thead><tr><th>상품명</th><th>오픈</th><th>마감</th><th>판매량</th><th>입고</th><th>이동</th><th>상태</th>{canEdit && <th>작업</th>}</tr></thead>
      <tbody>{shown.map(row => {
        const status = rowStatus(row);
        return <React.Fragment key={row.inventory_id}>
          <tr>
            <td>{row.name}{targetIds.has(row.product_id) && <span className="tag" style={{ marginLeft: 6 }}>예측</span>}</td>
            <td className="num">{showQty(row.opening_qty)}</td>
            <td className="num">{showQty(row.closing_qty)}</td>
            <td className="num">{showQty(row.observed_sales_qty)}</td>
            <td>{RECEIPT[row.receipt_status] || row.receipt_status}</td>
            <td>{MOVEMENT[row.movement_status] || row.movement_status}</td>
            <td><Badge status={status} />{status.note && <div className="subtle">{status.note}</div>}</td>
            {canEdit && <td className="actions">
              {canVerify(row) && <button className="btn green small" disabled={busy} onClick={() => act(() => verifyRow(row), `${row.name}: 확정했습니다.`)}>확정</button>}
              {row.review_status !== 'rejected' && <button className="btn secondary small" disabled={busy} onClick={() => toggle(row.inventory_id, 'correct')}>정정</button>}
              {row.review_status !== 'rejected' && <button className="btn red small" disabled={busy} onClick={() => toggle(row.inventory_id, 'reject')}>반려</button>}
            </td>}
          </tr>
          {editing?.id === row.inventory_id && editing.mode === 'correct' && <tr><td colSpan={canEdit ? 8 : 7}>
            <CorrectionForm row={row} busy={busy} onCancel={() => setEditing(null)}
              onSubmit={(changes, reason, reverify) => act(() => correctRow(row, changes, reason, reverify, { storeCode, businessDate: inventory?.record_date || date }), `${row.name}: 정정했습니다.${reverify ? ' (재확정)' : ' 검토 대기로 바뀌었습니다.'}`)} />
          </td></tr>}
          {editing?.id === row.inventory_id && editing.mode === 'reject' && <tr><td colSpan={canEdit ? 8 : 7}>
            {/* [학습] 반려: 날짜·지점·상품을 잘못 넣은 줄을 판매량·예측에서 뺍니다. 사유는 이력에 남습니다. */}
            <div className="correction"><div className="row">
              <input id={`rj-${row.inventory_id}`} className="control grow" maxLength={200} placeholder="반려 사유 (예: 11/4 보고를 11/5로 잘못 저장)" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <button className="btn red small" disabled={busy || !rejectReason.trim()} onClick={() => act(() => rejectRow(row, rejectReason.trim()), `${row.name}: 반려했습니다. 판매량·예측에서 빠집니다.`)}>반려 확정</button>
              <button className="btn secondary small" disabled={busy} onClick={() => setEditing(null)}>취소</button>
            </div></div>
          </td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table></div>}
    <p className="smallprint">'–'는 미확인(NULL)이고 0과 다릅니다. 판매량은 DB가 확정(verified)된 줄에만 계산한 값(오픈 − 마감)입니다. 확정 버튼은 오픈·마감이 모두 있고 마감 ≤ 오픈, 이동 없음인 줄(또는 수량 없는 미입고)에만 보입니다.</p>
  </section>
  </>;
}

// ── 판매 분석 탭 ────────────────────────────────────────────
function StatsTab({ storeCode, onError }) {
  const [from, setFrom] = useState(localDay(new Date(Date.now() - 60 * DAY)));
  const [to, setTo] = useState(localDay(new Date(Date.now() - DAY)));
  const [data, setData] = useState(null), [missing, setMissing] = useState(false), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setMissing(false);
    try { setData(await loadInventoryRange(storeCode, from, to)); }
    catch (err) { setData(null); if (isMissingRpc(err)) setMissing(true); else onError(err); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [storeCode]);
  const report = useMemo(() => data ? summarizeRange(data.items) : null, [data]);
  const top = report?.byProduct[0]?.total || 1;
  return <>
    <section className="panel">
      <h2>📊 판매 분석</h2>
      <div className="row">
        <label className="subtle">시작 <input id="stats-from" className="control" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="subtle">종료 <input id="stats-to" className="control" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn small" disabled={busy} onClick={load}>{busy ? '조회 중…' : '조회'}</button>
      </div>
      <p className="subtle" style={{ marginTop: 8 }}>기록이 하나도 없는 날은 휴무일로 셉니다(팀 결정). 판매량은 DB가 확정한 줄의 관측 판매량(오픈 − 마감)만 합산합니다. 검토 대기·반려·미입고·조건 미충족 줄은 빠집니다. 최대 400일.</p>
      {missing && <div className="notice">기간 조회 DB 함수(bq_get_inventory_range)가 아직 설치되지 않았습니다. 초안: database/proposals/001_read_rpcs_PROPOSAL_DO_NOT_RUN.sql (팀원 3 검토 후 설치)</div>}
      {report && <div className="metrics">
        <div className="metric"><strong>{report.days}</strong><span>보고 날짜 · 휴무 {data ? Math.round((Date.parse(data.to) - Date.parse(data.from)) / DAY) + 1 - report.days : 0}일</span></div>
        <div className="metric"><strong>{report.quality.used}</strong><span>집계에 쓴 상품·일</span></div>
        <div className="metric"><strong>{report.quality.pending}</strong><span>검토 대기(미집계)</span></div>
        <div className="metric"><strong>{report.quality.notReceived + report.quality.excluded + report.quality.rejected}</strong><span>미입고·제외·반려</span></div>
      </div>}
    </section>
    {report && <>
      <section className="panel"><h2>🥇 상품별 관측 판매량</h2>
        {report.byProduct.length === 0 ? <p>확정된 기록이 없습니다.</p> : report.byProduct.slice(0, 30).map((p, i) => <div key={p.product_id} style={{ marginBottom: 11 }}>
          <div className="summaryline" style={{ border: 0, padding: '2px 0' }}><span>{i + 1}. {p.name}</span><b>{p.total}개 <span className="subtle">/ {p.days}일</span></b></div>
          <div className="bar"><i style={{ width: `${100 * p.total / top}%` }} /></div></div>)}
      </section>
      <section className="panel"><h2>📅 평일·주말 평균</h2>
        <p className="subtle">주말 = 토·일. 공휴일은 반영하지 않았습니다(예측 모델은 등록된 공휴일을 주말로 봅니다).</p>
        <div className="tablebox"><table className="data"><thead><tr><th>상품</th><th>평일 평균</th><th>주말 평균</th><th>평일 표본</th><th>주말 표본</th></tr></thead><tbody>
          {report.byProduct.map(p => <tr key={p.product_id}><td>{p.name}</td><td className="num">{p.wkN ? (p.wkTotal / p.wkN).toFixed(1) : '–'}</td><td className="num">{p.weN ? (p.weTotal / p.weN).toFixed(1) : '–'}</td><td className="num">{p.wkN}</td><td className="num">{p.weN}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel"><h2>⚠️ 마감 0 (품절 의심)</h2><p className="subtle">마감 0은 품절 가능성을 뜻할 뿐, 실제 놓친 수요는 알 수 없습니다.</p>
        {report.byProduct.filter(p => p.stockouts > 0).sort((a, b) => b.stockouts / b.days - a.stockouts / a.days).slice(0, 15).map(p =>
          <div className="summaryline" key={p.product_id}><span>{p.name}</span><b>{p.stockouts}/{p.days}일 ({(p.stockouts / p.days * 100).toFixed(0)}%)</b></div>)}
      </section>
    </>}
  </>;
}

// ── 수요 예측 탭 ────────────────────────────────────────────
// [학습] 예측 계산은 DB 함수(EWMA v3.3)가 합니다. 이 화면은 실행 요청과 결과 표시만 합니다. 수식은 화면에 없습니다.
function ForecastTab({ storeCode, canEdit, targets, onError, onMessage }) {
  const [date, setDate] = useState(localDay(new Date(Date.now() + DAY)));
  const [result, setResult] = useState(null), [missing, setMissing] = useState(false);
  const [lastRun, setLastRun] = useState(null), [replay, setReplay] = useState(null), [busy, setBusy] = useState(false);
  const isPast = date <= localDay(new Date());

  async function load() {
    setBusy(true); setMissing(false); setReplay(null);
    try { setResult(await loadForecastResults(storeCode, date)); }
    catch (err) { setResult(null); if (isMissingRpc(err)) setMissing(true); else onError(err); }
    finally { setBusy(false); }
  }
  useEffect(() => { setLastRun(null); load(); }, [storeCode, date]);

  async function run() {
    const note = isPast ? '\n(지난 날짜: 과거 시점 검증용 실행입니다)' : '';
    if (!window.confirm(`${date} 예측을 실행할까요?${note}\n실행할 때마다 새 기록이 쌓이며 지울 수 없습니다.`)) return;
    setBusy(true);
    try {
      const summary = await runForecast(storeCode, date);
      setLastRun(summary);
      onMessage(`예측 실행 완료: ${summary.products_processed}개 상품`);
      // [학습] 결과 조회 함수(제안)가 없으면, 기존 bq_replay_forecast로 상품별 저장값만이라도 보여줍니다.
      try { setResult(await loadForecastResults(storeCode, date)); setMissing(false); }
      catch (err) { if (!isMissingRpc(err)) throw err; setMissing(true); setReplay(await replayForecast(summary.run_id)); }
    } catch (err) { onError(err); }
    finally { setBusy(false); }
  }

  async function check() {
    const runId = result?.run?.run_id || lastRun?.run_id;
    if (!runId) return;
    setBusy(true);
    try { setReplay(await replayForecast(runId)); } catch (err) { onError(err); } finally { setBusy(false); }
  }

  const items = result?.items || [];
  return <section className="panel">
    <h2>🧮 예상 판매수요 (EWMA v3.3)</h2>
    <div className="row">
      <label className="subtle">예측일 <input id="forecast-date" className="control" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <button className="btn secondary small" disabled={busy} onClick={load}>결과 조회</button>
      {canEdit && <button className="btn small" disabled={busy} onClick={run}>{busy ? '처리 중…' : '예측 실행'}</button>}
    </div>
    {isPast && <div className="notice" style={{ marginTop: 10 }}>지난 날짜입니다. 이 날짜의 예측은 과거 시점 검증용이며, 그날 이후 데이터는 계산에 쓰이지 않습니다.</div>}
    <p className="subtle" style={{ marginTop: 8 }}>값은 소수 2자리 예상 판매수요이며 생산량·발주량이 아닙니다. 마감 0이 포함된 관측은 실제 수요보다 작을 수 있습니다.</p>

    {lastRun && <div className="notice good">실행 {lastRun.model_version} · {lastRun.day_type === 'weekend' ? '주말' : '평일'} 그룹 · 학습 관측 중 마감 0 {lastRun.closing_zero_training_observations ?? '–'}건</div>}
    {missing && <div className="notice">예측 결과 조회 DB 함수(bq_get_forecast_results)가 아직 설치되지 않았습니다. 예측을 실행하면 저장된 값만 간단히 보여드립니다. 초안: database/proposals/001_read_rpcs_PROPOSAL_DO_NOT_RUN.sql</div>}

    {result && !result.run && <p>이 날짜의 예측 실행 기록이 없습니다.{canEdit ? ' "예측 실행"을 눌러 만드세요.' : ''}</p>}
    {result?.run && <>
      <div className="subtle" style={{ margin: '8px 0' }}>실행 {String(result.run.created_at).slice(0, 16).replace('T', ' ')} · {result.run.model_version} · {result.run.day_type === 'weekend' ? '주말' : '평일'} 그룹 · 최소 관측 {result.run.min_history}건</div>
      <div className="tablebox"><table className="data">
        <thead><tr><th>상품</th><th>예상 판매수요</th><th>α</th><th>관측치</th><th>마감 0</th><th>상태</th></tr></thead>
        <tbody>{items.map(it => <tr key={it.product_id}>
          <td>{it.product_name}</td>
          <td className="num"><b>{it.forecast_status === 'ok' ? fmtQty2(it.predicted_demand_qty) : '미생성'}</b></td>
          <td className="num">{it.alpha_used}</td>
          <td className="num">{it.history_count}</td>
          <td className="num">{it.closing_zero_observations}</td>
          <td>{it.forecast_status === 'ok' ? <span className="badge good">ok</span> : <span className="badge warn">관측치 부족 ({it.history_count}/{result.run.min_history})</span>}</td>
        </tr>)}</tbody>
      </table></div>
      <button className="btn secondary small" style={{ marginTop: 8 }} disabled={busy} onClick={check}>저장값 재현 확인</button>
    </>}

    {replay && <div style={{ marginTop: 12 }}>
      <h3>저장값 재현 확인 (bq_replay_forecast)</h3>
      {replay.map(r => <div className="summaryline" key={r.product_name}><span>{r.product_name}</span><span><b>{r.stored_qty === null ? '미생성' : fmtQty2(r.stored_qty)}</b> {r.is_equal ? <span className="badge good">재현 일치</span> : <span className="badge bad">불일치 {fmtQty2(r.replayed_qty)}</span>}</span></div>)}
    </div>}

    {!result?.run && !replay && <>
      <h3 style={{ marginTop: 12 }}>예측 대상 상품 {targets.length}종</h3>
      {targets.map(p => <div className="summaryline" key={p.product_id}><span>{p.name}</span><span className="subtle">{p.product_code}</span></div>)}
    </>}
  </section>;
}

// ── 앱 ─────────────────────────────────────────────────────
function App() {
  const [authState, setAuthState] = useState('checking');
  // [학습] devMode=true: 점검 모드(로그인 없음). 로그인 화면·로그아웃 버튼을 숨깁니다.
  const [devMode, setDevMode] = useState(false);
  const [me, setMe] = useState(null), [storeCode, setStoreCode] = useState('HANAM'), [tab, setTab] = useState('record');
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');

  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      try {
        if (await isDevMode()) { setDevMode(true); setAuthState('in'); return; }
        setAuthState((await getAccessToken()) ? 'in' : 'out');
        unsubscribe = await onAuthChange(isIn => setAuthState(isIn ? 'in' : 'out'));
      } catch (e) { setError(e.message); setAuthState('out'); }
    })();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authState !== 'in') { setMe(null); return; }
    loadMe().then(data => {
      setMe(data);
      // [학습] 권한 있는 지점 목록에 현재 선택 지점이 없으면 첫 지점으로 바꿉니다.
      if (data.stores.length && !data.stores.some(s => s.code === storeCode)) setStoreCode(data.stores[0].code);
    }).catch(handleError);
  }, [authState]);

  useEffect(() => {
    if (!me) return;
    setCatalog(null);
    loadCatalog(storeCode).then(setCatalog).catch(handleError);
  }, [me, storeCode]);

  function handleError(err) {
    setMessage('');
    if (err?.status === 401) { setAuthState('out'); setError('로그인이 만료되었습니다. 다시 로그인해 주세요.'); return; }
    setError(err?.message || String(err));
  }
  const showMessage = text => { setError(''); setMessage(text); };

  const targets = useMemo(() => (catalog?.products || []).filter(p => p.is_forecast_target), [catalog]);
  const targetIds = useMemo(() => new Set(targets.map(p => p.product_id)), [targets]);
  const store = me?.stores.find(s => s.code === storeCode);
  // [학습] 역할을 알면(제안 함수 설치 후) viewer에게 쓰기 버튼을 숨깁니다. 모르면 보여주고 DB가 403으로 막습니다.
  const canEdit = !me?.accessKnown || ['editor', 'admin'].includes(store?.role);

  if (authState === 'checking') return <div className="wrap"><div className="panel">로그인 상태를 확인하는 중입니다…</div></div>;

  return <>
    <header className="hero">
      <h1>🍞 시오사쿠 재고관리</h1>
      <div className="muted-hero">{me ? `${me.user.email || '로그인 사용자'} · ${store?.name || storeCode}${store?.role ? ` (${store.role})` : ''}` : '로그인이 필요합니다'}</div>
      {me && <div className="row" style={{ marginTop: 11 }}>
        <select id="store-select" className="control grow" value={storeCode} onChange={e => { setStoreCode(e.target.value); setError(''); setMessage(''); }}>
          {me.stores.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        {!devMode && <button className="btn secondary small" onClick={() => signOut().catch(handleError)}>로그아웃</button>}
      </div>}
    </header>

    {authState === 'out' ? <>
      {error && <div className="wrap" style={{ paddingBottom: 0 }}><div className="notice error">⚠️ {error}</div></div>}
      <LoginPanel onDone={() => { setError(''); setAuthState('in'); }} />
    </> : <>
      <nav className="nav">
        {[['record', '📋 재고 기록'], ['stats', '📊 판매 분석'], ['forecast', '🧮 수요 예측']].map(([k, label]) =>
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setError(''); setMessage(''); }}>{label}</button>)}
      </nav>
      <main className="wrap">
        {devMode && <div className="notice">점검 모드: 로그인 없이 .env의 고정 사용자로 동작합니다. 수정 이력에도 이 사용자가 작업자로 남습니다.</div>}
        {error && <div className="notice error">⚠️ {error}</div>}
        {message && <div className="notice good">✅ {message}</div>}
        {me && me.stores.length === 0 && <div className="notice">접근 권한이 있는 지점이 없습니다. 관리자에게 지점 권한을 요청하세요.</div>}
        {me && me.stores.length > 0 && <>
          {tab === 'record' && <RecordTab key={storeCode} storeCode={storeCode} canEdit={canEdit} targetIds={targetIds} products={catalog?.products || []} onError={handleError} onMessage={showMessage} />}
          {tab === 'stats' && <StatsTab key={storeCode} storeCode={storeCode} onError={handleError} />}
          {tab === 'forecast' && <ForecastTab key={storeCode} storeCode={storeCode} canEdit={canEdit} targets={targets} onError={handleError} onMessage={showMessage} />}
        </>}
        <div className="smallprint" style={{ textAlign: 'center', marginTop: 22 }}>시오사쿠 재고관리 v2 · Bridge-Q DB v3.3 연동 · 강동·하남</div>
      </main>
    </>}
  </>;
}

export default App;
