// [학습] Supabase 연결 설정. 사용처: services/inventoryRepository.js.


// [학습] 연결할 Supabase 프로젝트 주소입니다. 이 파일도 브라우저에서 실행되며 별도 백엔드는 아닙니다.
const DB_URL="https://tpcctqnfrtzfbdktwboa.supabase.co";
// Publishable key는 공개용 식별자입니다. 실제 DB 보호에는 반드시 Supabase RLS가 필요합니다.
// [학습] 공개용 프로젝트 키입니다. 키를 숨기는 대신 인증·DB 권한 정책으로 데이터 접근을 제한해야 합니다.
const DB_PUBLIC_KEY="sb_publishable_SYTAm88X-7Qk2MwGCFIvKA_AC-1opTW";
// [학습] 앞서 HTML에서 로드한 window.supabase로 통신 객체를 한 번 만듭니다. DB 요청 함수들이 이 객체를 공유합니다.
const db=window.supabase.createClient(DB_URL,DB_PUBLIC_KEY);

// [학습] 이 파일의 함수를 외부에서 import할 수 있도록 공개합니다.
export { db };
