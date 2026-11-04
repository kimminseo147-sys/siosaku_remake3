// [학습] 날짜 문자열과 요일을 다루는 공통 함수 모음입니다.


// [학습] YYYY-MM-DD 형식과 실제 달력에 존재하는 날짜인지를 함께 검사해 true/false를 반환합니다.
function isValidDay(date){
  // [학습] 정규식: 연도 4자리-월 2자리-일 2자리 형식을 검사합니다. ^와 $는 문자열 전체를 뜻합니다.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return false;
  // [학습] UTC 정오의 날짜를 만들고 다시 YYYY-MM-DD로 바꿔 원문과 비교합니다. 2월 30일처럼 자동 보정된 날짜를 거릅니다.
  const d=new Date(date+"T12:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
}
// [학습] Date 객체를 사용자 기기의 현지 날짜 문자열로 만듭니다. padStart(2,"0")는 1을 01처럼 표시합니다.
const localDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
// [학습] 날짜의 요일 번호를 반환합니다. 일요일 0, 월요일 1, ... 토요일 6입니다.
const dayIndex=s=>new Date(`${s}T12:00:00`).getDay();
// [학습] 요일 번호가 [0,6]에 포함되면 주말입니다. 공휴일은 별도 반영하지 않는 기존 규칙입니다.
const weekend=s=>[0,6].includes(dayIndex(s));

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { isValidDay, localDay, dayIndex, weekend };
