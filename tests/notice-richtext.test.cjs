// Verifies the notice rich-text renderer/sanitizer (JS_Main.html: renderNoticeRichText_/sanitizeNoticeStyle_)
// against the REAL project file. Pure string logic, no DOM needed.
const fs = require('fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const jsMain = fs.readFileSync('JS_Main.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const sandbox = {
  console,
  document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
  google: { script: { run: { withSuccessHandler() { return this; }, withFailureHandler() { return this; } } } },
  performance: { now: () => Date.now() },
  setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  addEventListener: () => {}, matchMedia: () => ({ matches: false }),
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(jsMain, ctx); // window.onload 대입만 하고 실행은 안 하므로 안전

// escapeHtml_와 동일한 방식으로 서버가 escape한 문자열을 흉내냅니다.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function render(raw) {
  return vm.runInContext('renderNoticeRichText_(' + JSON.stringify(esc(raw)) + ')', ctx);
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// ---- A. 평문 ----
{
  const out = render('오늘 회의가 있습니다.');
  ok(out === '오늘 회의가 있습니다.', 'A. 평문은 그대로 표시', out);
}

// ---- B. 옛 <> 강조 데이터 (하위 호환) ----
{
  const out = render('<중요 공지>입니다.');
  ok(out === '<span style="color:#dc2626; font-weight:800; font-size:15px;">중요 공지</span>입니다.', 'B. 옛 <> 데이터는 기존과 동일하게(빨강+굵게+15px) 렌더링', out);
}

// ---- C. 새 서식 데이터 ----
{
  const out = render('<strong>굵게</strong> <em>기울임</em> <u>밑줄</u>');
  ok(out === '<strong>굵게</strong> <em>기울임</em> <u>밑줄</u>', 'C1. 새 strong/em/u 태그 복원', out);
}
{
  const out = render('<span style="color:#c43d3d">빨강 글씨</span>');
  ok(out === '<span style="color:#c43d3d">빨강 글씨</span>', 'C2. 새 span color 태그 복원', out);
}
{
  const out = render('<span style="font-size:19px">큰 글씨</span>');
  ok(out === '<span style="font-size:19px">큰 글씨</span>', 'C3. 새 span font-size 태그 복원', out);
}
{
  const out = render('<span style="color:#c43d3d;font-size:19px"><strong>중요</strong></span>');
  ok(out === '<span style="color:#c43d3d;font-size:19px"><strong>중요</strong></span>', 'C4. 색상+크기+굵게 중첩 조합', out);
}
{
  const out = render('<strong><em><u>굵게+기울임+밑줄</u></em></strong>');
  ok(out === '<strong><em><u>굵게+기울임+밑줄</u></em></strong>', 'C5. 굵게+기울임+밑줄 3중 중첩', out);
}

// ---- D. 새/옛 데이터 동시 존재 (같은 문서 안에서도) ----
{
  const out = render('<strong>새 서식</strong>과 <옛 강조>가 함께');
  ok(
    out === '<strong>새 서식</strong>과 <span style="color:#dc2626; font-weight:800; font-size:15px;">옛 강조</span>가 함께',
    'D. 새 태그와 옛 <> 강조가 한 문서에 섞여 있어도 각자 올바르게 렌더링',
    out
  );
}

// ---- E. 안전성(sanitize): 화이트리스트 밖 태그/속성은 절대 복원되지 않음 ----
{
  const out = render('<script>alert(1)</script>');
  ok(!out.includes('<script>'), 'E1. <script> 태그는 절대 실제 태그로 복원되지 않음(문자로만 남거나 옛 강조 스타일로만 표시)', out);
  ok(!/onerror|onclick|javascript:/i.test(out) || out.includes('&lt;') === false, 'E1b. 위험 속성/스킴 문자열 자체는 그대로 텍스트일 뿐 속성으로 해석되지 않음');
}
{
  const out = render('<span style="color:red;background:url(javascript:alert(1))">위험</span>');
  ok(!out.includes('background'), 'E2. 화이트리스트 밖 CSS 속성(background)은 제거됨', out);
  ok(!out.includes('javascript:'), 'E2b. javascript: 스킴 문자열이 style 속성에 남지 않음', out);
  ok(!out.includes('color:red'), 'E2c. named color(red)는 hex 형식이 아니라서 제거됨(hex만 허용)', out);
}
{
  const out = render('<span style="color:#ffffff;onmouseover:alert(1)">위험2</span>');
  ok(!out.includes('onmouseover'), 'E3. 화이트리스트 밖 속성명(onmouseover)은 제거됨', out);
  ok(out.includes('color:#ffffff'), 'E3b. 같이 있는 정상 속성(color)은 유지됨', out);
}
{
  const out = render('<img src=x onerror=alert(1)>');
  ok(!out.includes('<img'), 'E4. <img> 태그는 절대 복원되지 않음', out);
}
{
  const out = render('<iframe src="javascript:alert(1)"></iframe>');
  ok(!out.includes('<iframe'), 'E5. <iframe> 태그는 절대 복원되지 않음', out);
}

// ---- F. 줄바꿈 유지 ----
{
  const out = render('여러 줄\n둘째 줄');
  ok(out === '여러 줄\n둘째 줄', 'F. 줄바꿈(\\n)은 그대로 유지됨(white-space:pre-wrap과 함께 동작)', out);
}

// ---- G. 새 에디터에서 <, >를 일반 문자로 입력한 경우(serializeNoticeToStorage_가 저장 시 &lt;/&gt;
//         글자 그대로 한 번 더 감싸 저장하므로, 옛 <내용> 강조 정규식과 절대 혼동되지 않아야 함) ----
{
  // serializeNoticeToStorage_가 저장했을 원문을 그대로 흉내냅니다: 사용자가 입력한 '<','>'는
  // 저장 시 이미 리터럴 "&lt;"/"&gt;" 문자열로 한 번 감싸져 있습니다.
  const out = render('&lt;괄호테스트&gt; 그냥 텍스트');
  ok(out === '&lt;괄호테스트&gt; 그냥 텍스트', 'G1. 새로 입력한 <,>는 옛 강조 스타일 없이 완전한 일반 문자로 표시됨', out);
  ok(!out.includes('dc2626'), 'G1b. 새로 입력한 <,>에는 옛 강조 색상이 전혀 적용되지 않음', out);
}
{
  // 같은 문서 안에 진짜 옛 <> 강조 데이터와, 새로 입력한 리터럴 <,>가 함께 있어도 각자 올바르게 구분됨
  const out = render('<진짜 옛 강조>와 &lt;그냥 문자&gt;가 함께');
  ok(
    out === '<span style="color:#dc2626; font-weight:800; font-size:15px;">진짜 옛 강조</span>와 &lt;그냥 문자&gt;가 함께',
    'G2. 옛 <> 강조 데이터와 새로 입력한 리터럴 <,>가 한 문서에 섞여 있어도 각자 올바르게 렌더링',
    out
  );
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
