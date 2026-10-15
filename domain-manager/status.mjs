export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
export const time = value => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}) : '아직 없음';
export function elapsed(value, now = Date.now()) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return '기록 없음';
  if (date > now) return '시각 확인 필요';
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) return '1분 미만';
  if (minutes < 60) return minutes + '분';
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + '시간 ' + minutes % 60 + '분' : Math.floor(hours / 24) + '일 ' + hours % 24 + '시간';
}
export function failureCount(record) {
  return Number.isSafeInteger(record.consecutiveFailures) && record.consecutiveFailures >= 0
    ? record.consecutiveFailures + '회' : '집계 전';
}
export function checkNotice(state, now = Date.now()) {
  const checked = Date.parse(state.lastRunAt);
  const stale = !Number.isFinite(checked) || checked > now || now - checked >= STALE_AFTER_MS;
  const text = Number.isFinite(checked)
    ? '마지막 점검: ' + time(state.lastRunAt) + ' (한국 시간) · ' + elapsed(state.lastRunAt, now) + ' 경과'
    : '아직 자동 점검 기록이 없습니다.';
  return {stale,text:text + (stale ? ' · 점검 기록이 없거나 12시간 이상 지났거나 시각이 맞지 않습니다. 실행 기록을 확인하세요.' : '')};
}
export function siteDetails(record, now = Date.now()) {
  return '최근 점검: ' + time(record.lastCheckedAt) +
    '\n마지막 정상 확인: ' + time(record.lastConfirmedAt) +
    '\n정상 확인 후 경과: ' + elapsed(record.lastConfirmedAt, now) +
    '\n연속 실패: ' + failureCount(record) + ' (집계 시작 이후)';
}
