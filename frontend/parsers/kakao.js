// [학습] 텍스트 파서. App.jsx가 호출하고 미리보기·오류를 화면에 표시합니다.
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { isValidDay } from '../domain/dates.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { normalizeProduct } from '../domain/products.js';
// [학습] import로 다른 파일의 기능을 가져옵니다. { ... } 안의 이름은 해당 파일이 export한 이름입니다.
import { parseQty } from '../domain/quantity.js';

// [학습] 날짜가 든 문장과 화면의 대체 날짜를 받아 {date,usedFallback}을 반환합니다.
function parseReportDate(text,fallback){
  // [학습] 연·월·일이 모두 있는 형식을 먼저 찾습니다. match는 일치 결과 또는 null을 반환합니다.
  const ymd=String(text).match(/(?:20\d{2})[년.\/-]\s*\d{1,2}[월.\/-]\s*\d{1,2}/);
  // [학습] 추출할 연도·월·일을 저장합니다. let은 이후 값을 바꿀 수 있는 변수 선언입니다.
  let y,m,d;
  // [학습] 숫자 부분만 뽑아 Number로 변환하고 [y,m,d]로 나눠 대입합니다.
  if(ymd){const nums=ymd[0].match(/\d+/g).map(Number);[y,m,d]=nums;}
  else{
    // [학습] 연도가 없으면 11월 1일 형태의 월·일을 찾습니다.
    const kor=String(text).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    // [학습] 11/1, 11-1 등 짧은 형식도 찾습니다.
    const short=String(text).match(/(?:^|\s)(\d{1,2})[.\/\-\s]+(\d{1,2})(?:\s|$)/);
    // [학습] 한글 월·일을 찾았을 때 정규식 캡처 그룹 1·2를 사용합니다.
    if(kor){m=Number(kor[1]);d=Number(kor[2]);}
    // [학습] 그렇지 않으면 짧은 형식의 월·일을 사용합니다.
    else if(short){m=Number(short[1]);d=Number(short[2]);}
    // [학습] 날짜를 찾지 못하면 화면에서 고른 날짜를 쓰고 추정 사용 여부를 표시합니다.
    else return {date:fallback,usedFallback:true};
    // [학습] 월·일만 있으면 대체 날짜의 연도를 사용합니다. 원문에 연도가 있었다는 뜻은 아닙니다.
    y=Number(String(fallback).slice(0,4));
  }
  // [학습] 연·월·일을 YYYY-MM-DD로 조립합니다. 백틱과 ${...}는 문자열 안에 값을 넣는 문법입니다.
  const date=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  // [학습] 실제 날짜가 아니면 date를 null로 반환합니다.
  return {date:isValidDay(date)?date:null,usedFallback:false};
}
// [학습] 원문→보고 유형·날짜·상품 수량·오류 목록을 만드는 함수입니다. 실제 DB 저장은 하지 않습니다.
function parseKakao(text,branch,products,fallbackDate){
  // [학습] 줄바꿈으로 나누고 각 줄의 앞뒤 공백·빈 줄을 제거합니다.
  const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  // [학습] 슬래시가 없고 오픈·마감 등의 단어가 있는 줄을 헤더 후보로 고릅니다. 슬래시 날짜도 제외되는 기존 한계가 있습니다.
  const headers=lines.filter(line=>!line.includes("/")&&/(오픈|마감|입고|17\s*시|17:00|오후\s*5\s*시)/.test(line));
  // [학습] some은 조건을 만족하는 헤더가 하나라도 있는지 검사합니다.
  const hasOpen=headers.some(s=>/오픈|입고/.test(s));
  // [학습] 마감 또는 17시 표현이 있는지 검사합니다.
  const hasClose=headers.some(s=>/마감|17\s*시|17:00|오후\s*5\s*시/.test(s));
  // [학습] 저장 전에 사용자에게 보여줄 오류·검토 사유 배열입니다.
  const issues=[];
  // [학습] 서로 다른 보고 유형이 섞이면 오류를 기록합니다.
  if(hasOpen&&hasClose)issues.push("오픈과 마감이 동시에 감지되었습니다. 보고 한 건씩 입력하세요.");
  // [학습] 보고 유형을 찾지 못해도 오류를 기록합니다.
  if(!hasOpen&&!hasClose)issues.push("오픈 또는 마감 보고 유형을 확인할 수 없습니다.");
  // [학습] 마감이 있으면 remaining, 오픈만 있으면 stock, 둘 다 없으면 null입니다. 오류 목록 확인이 함께 필요합니다.
  const type=hasClose?"remaining":hasOpen?"stock":null;
  // [학습] 17시 보고는 대체 마감으로 표시해 정상 판매량 분석과 구분합니다.
  const estimated=type==="remaining"&&headers.some(s=>/17\s*시|17:00|오후\s*5\s*시/.test(s));
  // [학습] 숫자가 있는 헤더를 우선 사용하고, 없으면 날짜처럼 보이는 다른 줄을 선택합니다.
  const dateLine=headers.find(s=>/\d/.test(s))||lines.find(s=>/\d.*(월|[.\/-])/.test(s))||"";
  // [학습] 함수가 반환한 객체에서 필요한 속성을 꺼내는 구조 분해 문법입니다.
  const {date,usedFallback}=parseReportDate(dateLine,fallbackDate);
  // [학습] 유효 날짜가 없으면 오류 목록에 추가합니다.
  if(!date)issues.push("보고 날짜가 올바르지 않습니다.");
  // [학습] items는 표준 상품명→수량 객체, newProducts는 새 상품 후보 이름 배열입니다.
  const items={},newProducts=[];
  // [학습] 각 줄에서 상품명과 수량을 추출합니다.
  for(const line of lines){
    // [학습] 슬래시 앞을 상품명, 뒤를 수량으로 읽습니다. 해당 형식이 아니면 현재 코드는 그 줄을 건너뜁니다.
    const match=line.match(/^(.+?)\s*\/\s*(.+)$/);if(!match)continue;
    // [학습] 지점과 상품 사전을 사용해 표준 이름을 찾습니다.
    const found=normalizeProduct(match[1],branch,products);
    // [학습] 표준화 실패는 오류 목록에 남긴 뒤 다음 줄로 넘어갑니다.
    if(!found.name){issues.push(`${match[1]}: ${found.reason}`);continue;}
    // [학습] 40+20개, 품절 등 수량 표현을 해석합니다.
    const qty=parseQty(match[2],type);
    // [학습] 해석 불가 수량은 원문과 함께 오류로 남깁니다.
    if(qty===null){issues.push(`${match[1]}: 수량 형식 오류 (${match[2]})`);continue;}
    // [학습] 여러 원문이 같은 표준 상품으로 모이면 임의 합산하지 않고 중복 오류로 처리합니다.
    if(Object.prototype.hasOwnProperty.call(items,found.name)){
      issues.push(`${found.name}: 같은 보고에 중복 상품이 있어 검토가 필요합니다.`);continue;
    }
    // [학습] 정상 상품 수량을 결과에 추가합니다.
    items[found.name]=qty;
    // [학습] 기존 상품 목록과 신규 후보 목록 모두에 없을 때만 새 후보를 추가합니다.
    if(!products.some(p=>p.name===found.name)&&!newProducts.includes(found.name))newProducts.push(found.name);
  }
  // [학습] 최종 상품 객체가 비어 있으면 유효 수량 없음 오류를 추가합니다.
  if(!Object.keys(items).length)issues.push("'상품명 / 20개' 형식의 유효한 수량이 없습니다.");
  // [학습] 해석 결과 전체를 화면에 돌려줍니다. branch는 현재 반환값에 없고 저장 호출부에서 추가합니다.
  return {date,type,items,issues,newProducts,estimated,usedFallback};
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { parseReportDate, parseKakao };
