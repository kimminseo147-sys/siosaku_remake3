// [학습] 수량 문자열 해석과 숫자 유효성 검사. 표시·파싱·수동 입력 함수의 실패 처리 방식이 서로 다릅니다.


// [학습] 표시용 숫자 포맷: 1000을 1,000으로 만듭니다. 현재 || 0 때문에 null·빈값도 0으로 표시되는 점을 구분해 읽으세요.
const fmt=v=>Number(v||0).toLocaleString("ko-KR");
// [학습] JavaScript가 정확히 표현할 수 있는 안전한 정수인지, 0 이상인지 검사합니다. 음수·소수는 false입니다.
const validQty=v=>Number.isSafeInteger(v)&&v>=0;
// [학습] 카카오톡 수량 해석 함수입니다. raw는 원문, type은 stock(오픈) 또는 remaining(마감). 실패하면 null을 반환합니다.
function parseQty(raw,type){
  // [학습] 공백과 진열·보관 문구를 제거해 수량 해석에 사용할 문자열을 만듭니다.
  const str=String(raw??"").replace(/\s|진열|보관/g,"");
  // [학습] 마감의 품절·소진·완판을 수량 0으로 해석합니다. 원문의 상태는 별도 반환하지 않는 기존 동작입니다.
  if(type==="remaining"&&/^(품절|소진|완판)$/.test(str))return 0;
  // [학습] 미입고·입고없음도 0으로 바뀝니다. 명시적 미입고와 단순 수량 0이 합쳐지는 기존 한계가 있습니다.
  if(type==="stock"&&/^(미입고|입고없음)$/.test(str))return 0;
  // [학습] 숫자, 선택적인 개 단위, +로 연결한 숫자만 허용합니다. 예: 20, 20개, 40+20개.
  if(!/^\d+(?:개)?(?:\+\d+(?:개)?)*$/.test(str))return null;
  // [학습] 개를 지우고 +로 나눈 뒤 각 조각을 Number로 숫자화합니다. "40+20개" → [40,20].
  const parts=str.replace(/개/g,"").split("+").map(Number);
  // [학습] reduce는 배열을 누적 계산합니다. 초기값 0에서 각 숫자를 더해 총수량을 구합니다.
  const sum=parts.reduce((s,v)=>s+v,0);
  // [학습] 합계도 안전한 정수인지 검사한 후 반환합니다.
  return validQty(sum)?sum:null;
}
// [학습] 수동 입력용입니다. 공란은 null, 올바른 숫자는 정수, 잘못된 값은 throw로 오류를 발생시킵니다.
function optionalQty(raw){
  // [학습] 미기록은 0과 구분해 null로 표현합니다.
  if(raw===""||raw===undefined||raw===null)return null;
  // [학습] 앞뒤 공백을 제거하고 숫자로만 구성됐는지 확인합니다. throw된 오류는 화면의 try/catch가 처리합니다.
  const str=String(raw).trim();if(!/^\d+$/.test(str))throw new Error(`수량은 0 이상의 정수만 허용합니다: ${str}`);
  // [학습] 문자열을 숫자로 바꾼 뒤 안전한 범위인지 다시 확인합니다.
  const num=Number(str);if(!validQty(num))throw new Error("수량이 허용 범위를 초과했습니다.");
  // [학습] 검증을 통과한 숫자를 호출한 쪽에 돌려줍니다.
  return num;
}

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { fmt, validQty, parseQty, optionalQty };
