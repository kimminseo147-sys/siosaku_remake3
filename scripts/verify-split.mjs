import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as quantity from '../frontend/domain/quantity.js';
import * as inventory from '../frontend/domain/inventory.js';
import * as kakao from '../frontend/parsers/kakao.js';
import * as excel from '../frontend/parsers/excel.js';
import * as analytics from '../frontend/domain/analytics.js';
import * as forecasting from '../frontend/domain/forecasting.js';

// [학습] 원본을 줄 배열로 읽어 분리 전 함수들을 재현합니다. 보관 파일은 테스트 기준이므로 수정하지 않습니다.
const lines = fs.readFileSync('reference/original.html', 'utf8').split(/\r?\n/);
const block = (start, end) => lines.slice(start - 1, end).map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n');
// [학습] 새로 넣은 설명 주석만 제거한 뒤 비교합니다. 원래 주석·실행 코드는 비교 대상에 그대로 남습니다.
const withoutLearningComments = text => text.replace(/^[ \t]*(?:\/\/ \[학습\][^\n]*|\/\* \[학습\][^\n]*\*\/|\{\/\* \[학습\][^\n]*\*\/\}|<!-- \[학습\][^\n]*-->)\r?\n/gm, '');
// [학습] vm은 원본 함수를 분리본과 이름 충돌 없이 실행할 별도 JavaScript 문맥을 만듭니다.
const original = vm.createContext({ structuredClone, Date });
vm.runInContext(block(46, 305), original);
const clone = value => JSON.parse(JSON.stringify(value));
let cases = 0;
// [학습] 같은 입력을 원본과 분리본에 전달하고 JSON 형태로 바꾼 결과가 같은지 검사합니다.
function compare(name, implementation, args) {
  original.args = structuredClone(args);
  const before = vm.runInContext(`${name}(...args)`, original);
  const after = implementation(...structuredClone(args));
  assert.deepEqual(clone(after), clone(before), name);
  cases++;
}
// [학습] 일반 수량·상태 문구·빈값·음수·소수를 대표 사례로 검사합니다. 기존 규칙의 정당성을 증명하는 검사는 아닙니다.
for (const [value, type] of [['40+20개','stock'],['미입고','stock'],['품절','remaining'],['','stock'],['-1','stock'],['1.5','stock']]) {
  compare('parseQty', quantity.parseQty, [value, type]);
}
// [학습] 정상·누락·오픈 0·마감 초과의 판매량 결과가 원본과 같은지 확인합니다.
for (const item of [{stock:40,remaining:10},{stock:null,remaining:0},{stock:0,remaining:0},{stock:2,remaining:4}]) {
  compare('observedSales', inventory.observedSales, [item, {}]);
}
// [학습] 파싱·집계·예측·보고 갱신에 사용할 최소 상품·재고 데이터입니다. 실제 DB에는 연결하지 않습니다.
const products = [{name:'명란 시오빵',aliases:[]}];
compare('parseKakao', kakao.parseKakao, ['11월 1일 오픈\n명란 시오빵/20개', '하남 신세계', products, '2026-11-01']);
compare('parseKakao', kakao.parseKakao, ['오픈\n마감\n명란 시오빵 / 품절', '하남 신세계', products, '2026-11-01']);
compare('analyzeExcelRows', excel.analyzeExcelRows, [[['날짜','상품명','오픈재고','잔여재고'],['2026-11-01','명란 시오빵',40,10]],'하남 신세계','2026-11-01',[],products]);
const records = [{date:'2026-10-25',branch:'하남 신세계',items:{'명란 시오빵':{stock:40,remaining:10}}}];
compare('summarize', analytics.summarize, [records,products]);
compare('predict', forecasting.predict, [records,'2026-11-01',['명란 시오빵'],products]);
compare('updateReport', inventory.updateReport, [records[0],{date:'2026-10-25',branch:'하남 신세계',type:'remaining',items:{'명란 시오빵':5},estimated:false},true]);

// JSX와 화면 상태 코드는 import 추가와 DB 반복문 추출 외에 원본과 동일해야 한다.
const expectedApp = block(368,611).replace(block(467,471), '        await insertRecordsInBatches(toInsert);');
assert.ok(withoutLearningComments(fs.readFileSync('frontend/App.jsx','utf8')).includes(expectedApp));
assert.ok(!fs.readFileSync('frontend/App.jsx','utf8').includes('db.from('));
assert.ok(withoutLearningComments(fs.readFileSync('frontend/services/inventoryRepository.js','utf8')).includes(block(467,471)));
assert.equal(withoutLearningComments(fs.readFileSync('frontend/styles/main.css','utf8')).trimEnd(),block(8,29));
// [학습] 최초 추출 도구를 가상 파일 시스템에서 실행해 주석 추가 전 파일을 메모리에 재현합니다. 실제 파일은 덮어쓰지 않습니다.
const expectedFiles = new Map();
vm.runInNewContext(fs.readFileSync('scripts/split-source.mjs','utf8').split('\n').slice(2).join('\n'), {
  fs: { readFileSync: fs.readFileSync, mkdirSync: () => {}, writeFileSync: (name, body) => expectedFiles.set(name,body) },
  path,
});
for (const [name, expected] of expectedFiles) {
  assert.equal(withoutLearningComments(fs.readFileSync(name,'utf8')), expected, `${name}: 설명 주석 외의 변경이 있습니다.`);
}
// [학습] 하위 폴더까지 재귀적으로 순회해 소스 파일 목록을 만듭니다.
function walk(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory,entry.name)) : [path.join(directory,entry.name)]);
}
// [학습] Node의 --check로 일반 JS 문법을 검사하고 import 대상 파일의 존재도 확인합니다. JSX 컴파일 검사는 별개입니다.
for(const filename of walk('frontend').filter(name=>name.endsWith('.js'))){
  execFileSync(process.execPath,['--check',filename]);
  const content=fs.readFileSync(filename,'utf8');
  for(const match of content.matchAll(/from ['"](.+?)['"]/g)){
    assert.ok(fs.existsSync(path.resolve(path.dirname(filename),match[1])),`누락된 import: ${filename}: ${match[1]}`);
  }
}
for(const match of fs.readFileSync('frontend/App.jsx','utf8').matchAll(/from ['"](.+?)['"]/g)){
  assert.ok(fs.existsSync(path.resolve(match[1])),`진입 파일 import 누락: ${match[1]}`);
}
console.log(`통과: 원본/분리본 결과 비교 ${cases}건, ${expectedFiles.size}개 파일의 주석 외 코드 보존, JS 문법 및 import 경로 검사`);
console.log('브라우저 JSX 실행 및 실제 Supabase 읽기·쓰기 검증은 포함하지 않았습니다.');
