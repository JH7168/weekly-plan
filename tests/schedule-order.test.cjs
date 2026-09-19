// 일정 표시 순서(Data 시트 I열 '표시순서') 회귀 테스트.
// 핵심 보장: 표시순서 칸이 비어 있으면 예전과 100% 똑같이 '시작일 순 + 같은 날짜는 행 순서'로
// 표시되어야 하고(기존 데이터 보호), 값이 들어 있는 항목만 그 자리로 옮겨져야 합니다.
// node tests/schedule-order.test.cjs
const fs = require('fs');
const vm = require('node:vm');

const code = fs.readFileSync('Code.js', 'utf8');
const helper = code.match(/const SCHEDULE_ORDER_COL_[\s\S]*?\r?\n\}\r?\n/);
if (!helper) { console.log('FAIL scheduleSortKey_ 헬퍼를 Code.js에서 찾지 못했습니다.'); process.exit(1); }
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(helper[0], ctx);
const sortKey = vm.runInContext('scheduleSortKey_', ctx);

const at = (s) => new Date(s + 'T00:00:00').getTime();
const MON = at('2026-09-21'), TUE = at('2026-09-22'), WED = at('2026-09-23');

// Data 시트 한 행(A~I)을 흉내냅니다. order를 주지 않으면 I열이 비어 있는 기존 데이터입니다.
function row(dept, start, text, order) {
  const r = [dept, new Date(start), new Date(start), text, '', '', '', ''];
  if (order !== undefined) r[8] = order;
  return r;
}
// buildWeekResult_가 실제로 쓰는 정렬 규칙과 동일합니다.
function displayOrder(rows) {
  return rows
    .map((r, i) => ({ text: r[3], rowNum: i + 2, sortKey: sortKey(r, r[1].getTime()) }))
    .sort((a, b) => (a.sortKey - b.sortKey) || (a.rowNum - b.rowNum))
    .map((it) => it.text);
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- A. 기존 데이터 보호: 표시순서가 비어 있으면 예전 동작 그대로 ----
{
  const out = displayOrder([row('A', WED, '수'), row('A', MON, '월'), row('A', TUE, '화')]);
  ok(eq(out, ['월', '화', '수']), 'A1. 표시순서가 비면 시작일 순(기존 동작 유지)', out);
}
{
  const out = displayOrder([row('A', WED, '먼저 등록'), row('A', WED, '나중 등록')]);
  ok(eq(out, ['먼저 등록', '나중 등록']), 'A2. 같은 시작일이면 시트 행 순서가 동점 기준(기존 동작 유지)', out);
}
{
  // 잘못된 값(숫자가 아닌 값)이 들어 있어도 시작일로 안전하게 되돌아갑니다.
  const out = displayOrder([row('A', WED, '수', '이상한값'), row('A', MON, '월')]);
  ok(eq(out, ['월', '수']), 'A3. 표시순서 값이 숫자가 아니면 시작일로 안전하게 대체', out);
}

// ---- B. 수동 순서: 날짜가 달라도 원하는 자리로 옮길 수 있어야 함 ----
{
  const out = displayOrder([row('A', MON, '월'), row('A', WED, '수', MON - 1)]);
  ok(eq(out, ['수', '월']), 'B1. 표시순서를 주면 늦은 날짜 항목도 앞으로 올 수 있음', out);
}
{
  const out = displayOrder([row('A', MON, '월', WED + 1), row('A', WED, '수')]);
  ok(eq(out, ['수', '월']), 'B2. 이른 날짜 항목을 뒤로 보낼 수도 있음', out);
}

// ---- C. reorderScheduleItems의 '슬롯 재배분' 방식이 원하는 순서를 정확히 재현하는지 ----
// (서버는 묶음이 쓰던 순서 값들을 모아 오름차순 정렬한 뒤, 새 순서대로 다시 나눠줍니다.)
function applyReorder(rows, newOrderIdx) {
  const keys = rows.map((r) => sortKey(r, r[1].getTime()));
  const slots = keys.slice().sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  newOrderIdx.forEach((origIdx, i) => { rows[origIdx][8] = slots[i]; });
  return rows;
}
{
  const rows = [row('A', MON, '여러날'), row('A', WED, '수1'), row('A', WED, '수2'), row('A', WED, '수3')];
  const out = displayOrder(applyReorder(rows, [1, 2, 3, 0])); // 여러날 항목을 맨 끝으로
  ok(eq(out, ['수1', '수2', '수3', '여러날']), 'C1. 날짜가 다른 항목을 맨 끝으로 옮기기', out);
}
{
  const rows = [row('A', MON, '여러날'), row('A', WED, '수1'), row('A', WED, '수2'), row('A', WED, '수3')];
  const out = displayOrder(applyReorder(rows, [0, 3, 1, 2])); // 수3을 여러날 바로 뒤로
  ok(eq(out, ['여러날', '수3', '수1', '수2']), 'C2. 관련 있는 항목을 원하는 자리로 끼워넣기', out);
}
{
  // 같은 날짜라 기본 순서 값이 겹쳐도, 1ms씩 벌려 순서가 확실히 정해져야 합니다.
  const rows = [row('A', WED, '가'), row('A', WED, '나'), row('A', WED, '다')];
  const out = displayOrder(applyReorder(rows, [2, 0, 1]));
  ok(eq(out, ['다', '가', '나']), 'C3. 같은 날짜끼리도 원하는 순서가 그대로 유지됨', out);
}
{
  // 순서를 바꿔도 묶음이 쓰던 값 범위를 벗어나지 않아야(다른 주 일정과 섞이지 않아야) 합니다.
  const rows = [row('A', MON, '월'), row('A', WED, '수')];
  const before = rows.map((r) => sortKey(r, r[1].getTime()));
  applyReorder(rows, [1, 0]);
  const after = rows.map((r) => Number(r[8]));
  ok(Math.min.apply(null, after) >= Math.min.apply(null, before)
    && Math.max.apply(null, after) <= Math.max.apply(null, before),
    'C4. 새 순서 값이 원래 묶음의 값 범위 안에 머무름(다른 주와 섞이지 않음)', { before, after });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
