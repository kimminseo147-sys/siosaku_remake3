import { BRANCHES } from '../config/catalog.js';
import { isValidDay } from '../domain/dates.js';

// 본문에 명시된 알려진 지점만 비교합니다. 지점이 없으면 선택 지점을 사용합니다.
export function inspectReportContext(text, branch, selectedDate, reportDate) {
  const compact = value => value.replace(/\s/g, '');
  const lines = String(text).split(/\r?\n/).map(compact);
  const reportedBranches = BRANCHES.filter(name => lines.some(line =>
    line === compact(name) || line === compact(name) + '점'
  ));
  const warnings = [];
  const issues = [];
  if (!BRANCHES.includes(branch)) issues.push('개별 지점을 먼저 선택하세요.');
  if (!isValidDay(selectedDate)) issues.push('달력에서 올바른 날짜를 선택하세요.');
  if (reportedBranches.length > 1) issues.push('여러 지점의 보고가 감지되었습니다. 한 지점씩 입력하세요.');
  if (reportDate && reportDate !== selectedDate) {
    warnings.push(`선택 날짜 ${selectedDate}와 본문 날짜 ${reportDate}가 다릅니다. 저장 날짜는 ${reportDate}입니다.`);
  }
  if (reportedBranches.length === 1 && reportedBranches[0] !== branch) {
    warnings.push(`본문 지점 ${reportedBranches[0]}와 선택 지점 ${branch}이 다릅니다. 저장 지점은 ${branch}입니다.`);
  }
  return { selectedBranch: branch, selectedDate, warnings, issues };
}
