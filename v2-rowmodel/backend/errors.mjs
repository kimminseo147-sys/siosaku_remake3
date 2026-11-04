// [학습] HTTP 상태코드와 화면용 메시지를 함께 담는 오류 클래스입니다.
// [학습] throw new HttpError(403, 'FORBIDDEN', '...') 처럼 던지면 server.mjs가 그대로 JSON 응답으로 바꿉니다.
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export { HttpError };
