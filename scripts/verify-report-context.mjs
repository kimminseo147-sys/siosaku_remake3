import assert from 'node:assert/strict';
import { parseKakao } from '../frontend/parsers/kakao.js';
import { inspectReportContext } from '../frontend/parsers/reportContext.js';
import { analyzeExcelRows } from '../frontend/parsers/excel.js';

const branch='하남 신세계';
const rows=[['갈릭 시오빵',5,5],['멜론 시오빵',8,4],['명란 시오빵',7,6],['불닭 시오빵',6,5],['앙버터 크림 시오빵',7,7],['야끼소바 시오빵',6,6],['오사카 시오빵',20,17],['우유 시오빵',5,1],['쪽파 시오빵',4,3]];
for(const [label,type,index] of [['오픈','stock',1],['마감','remaining',2]]){
  const text=`${branch}\n10월 26일 ${label}\n`+rows.map(row=>`${row[0]} / ${row[index]}개`).join('\n');
  const report=parseKakao(text,branch,[],'2026-10-26');
  assert.equal(report.type,type);
  assert.equal(report.date,'2026-10-26');
  assert.deepEqual(report.issues,[]);
  assert.equal(Object.keys(report.items).length,9);
  assert.equal(report.items['메론 시오빵'],rows[1][index]);
  assert.equal(inspectReportContext(text,branch,'2026-10-26',report.date).warnings.length,0);
  assert.equal(inspectReportContext(text,'강동 본점','2026-10-25',report.date).warnings.length,2);
}
assert.equal(inspectReportContext('하남 신세계점',branch,'2026-10-26','2026-10-26').warnings.length,0);
assert.equal(inspectReportContext('하남 신세계\n용인점',branch,'2026-10-26','2026-10-26').issues.length,1);
assert.equal(inspectReportContext('',branch,'잘못된 날짜',null).issues.length,1);
assert.equal(parseKakao('오픈\n명란 시오빵 / 7개',branch,[],'2026-10-26').usedFallback,true);
const preview=analyzeExcelRows([['날짜','상품명','오픈재고','잔여재고'],...rows.map(r=>['2026-10-26',...r])],branch,'2026-10-26',[],[]);
assert.equal(preview.newRecords.length,1);
const items=Object.values(preview.newRecords[0].items);
assert.equal(items.length,9);
assert.equal(items.reduce((sum,item)=>sum+item.stock-item.remaining,0),14);
console.log('통과: 오픈·마감 예시, 별칭, 날짜·지점 불일치, 여러 지점, 날짜 누락, Excel 9행·판매량 14개');
