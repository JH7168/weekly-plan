// Regression test for the notice rich-text editor's DOM-level behavior (load/serialize round-trip)
// against the REAL Modals_Task.html + JS_Main.html content, using the same linkedom+vm harness
// pattern as tests/lazy-modal.test.cjs. Exercises both entry points (신규 등록: wizardNoticeInput,
// 수정: singleEditNotice) directly, without needing the full click-driven UI/server chain.
// node tests/notice-editor-dom.test.cjs <path-to-linkedom> (defaults to "linkedom")
const { parseHTML } = require(process.argv[2] || 'linkedom');
const fs = require('fs'), vm = require('node:vm');

const jsMain = fs.readFileSync('JS_Main.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const taskHtml = fs.readFileSync('Modals_Task.html', 'utf8');
const taskScript = taskHtml.match(/<script>([\s\S]*)<\/script>/)[1];
// Modals_Task.html's own HTML markup (everything except its <script> tag), matching what
// ensureLazyModalLoaded_ inserts into <body> in production.
const taskMarkup = taskHtml.replace(/<script>[\s\S]*<\/script>/, '');

function freshEnv() {
  const { document, window: domWindow } = parseHTML('<html><body>' + taskMarkup + '</body></html>');
  if (!Object.getOwnPropertyDescriptor(domWindow.HTMLInputElement.prototype, 'checked'))
    Object.defineProperty(domWindow.HTMLInputElement.prototype, 'checked', {
      get() { return this.hasAttribute('checked'); },
      set(v) { v ? this.setAttribute('checked', '') : this.removeAttribute('checked'); },
    });
  const sandbox = {
    document,
    google: { script: { run: { withSuccessHandler() { return this; }, withFailureHandler() { return this; } } } },
    performance: { now: () => Date.now() },
    console,
    alert: () => {},
    serverData: { deptList: ['교무기획부'] },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: () => 0,
    clearInterval: () => {},
    // linkedom에는 Selection API가 없어, 드롭다운의 "현재 선택" 판정(getNoticeCurrentFormat_)이
    // 기본값(커서 없음)으로 안전하게 동작하도록 빈 selection을 흉내냅니다.
    getSelection: () => ({ rangeCount: 0, anchorNode: null, removeAllRanges() {}, addRange() {} }),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  // JS_Main.html 먼저(escapeHtmlClient_/renderNoticeRichText_/parseTaskText 등 공용 함수),
  // 그다음 Modals_Task.html의 스크립트(전달사항 편집기 모듈 포함)를 실제 프로덕션과 같은 순서로 실행합니다.
  vm.runInContext(jsMain, ctx);
  vm.runInContext(taskScript, ctx);
  return { ctx, document };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

// ---- 0. 회귀 확인: Modals_Task.html 스크립트 전체가 예외 없이 실행됨(구문/런타임 오류로 인한
//        lazy 로딩 실패 회귀를 이 테스트 하나로 항상 잡아낼 수 있습니다) ----
{
  let threw = null;
  let ctx;
  try { ({ ctx } = freshEnv()); } catch (e) { threw = e; }
  ok(!threw, 'Modals_Task.html 스크립트가 예외 없이 전체 실행됨(switchTo 등 실제 함수로 재정의됨)', threw && threw.message);
  if (ctx) {
    ok(typeof ctx.switchTo === 'function', 'switchTo가 실제 함수로 정의됨(스텁이 아님)');
    ok(typeof ctx.editItemFromDetail === 'function', 'editItemFromDetail이 실제 함수로 정의됨');
    ok(typeof ctx.initNoticeEditor_ === 'function', 'initNoticeEditor_ 정의됨');
    ok(typeof ctx.getNoticeEditorValue_ === 'function', 'getNoticeEditorValue_ 정의됨');
  }
}

// helper: 새 env에서 신규 등록(wizardNoticeInput) 편집기를 초기화하고 raw 텍스트를 로드/직렬화한 뒤 값을 반환
function roundTripWizard(raw) {
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('wizardNoticeInput'); loadNoticeEditorContent_('wizardNoticeInput', ${JSON.stringify(raw)});`, ctx);
  return vm.runInContext(`getNoticeEditorValue_('wizardNoticeInput')`, ctx);
}
// helper: 수정 화면(singleEditNotice) 편집기 경로도 동일하게 검증(실제로는 openSingleEdit 내부에서
// initNoticeEditor_('singleEditNotice')+loadNoticeEditorContent_(...)가 이 순서로 호출됩니다).
function roundTripEdit(raw) {
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('singleEditNotice'); loadNoticeEditorContent_('singleEditNotice', ${JSON.stringify(raw)});`, ctx);
  return vm.runInContext(`getNoticeEditorValue_('singleEditNotice')`, ctx);
}

// ---- 1. 신규 등록: 빈 전달사항 ----
ok(roundTripWizard('') === '', '신규 등록: 빈 전달사항 초기화 후 값도 빈 문자열');

// ---- 2. 신규 등록: 평문 ----
ok(roundTripWizard('오늘 회의가 있습니다.') === '오늘 회의가 있습니다.', '신규 등록: 평문 전달사항 로드/직렬화 round-trip');

// ---- 3. 수정 화면: 기존 평문 데이터 ----
ok(roundTripEdit('평문 전달사항입니다.') === '평문 전달사항입니다.', '수정 화면: 기존 평문 데이터 로드/직렬화 round-trip');

// ---- 4. 수정 화면: 기존 <> 강조 데이터 -> 새 서식으로 승격되어 저장됨(빨강/굵게/15px -> 가장 가까운 프리셋) ----
{
  const out = roundTripEdit('<중요 공지>입니다.');
  ok(out.includes('<strong>') && out.includes('color:#dc2626') && out.includes('중요 공지'),
    '수정 화면: 기존 <> 강조 데이터가 새 서식(strong+color)으로 승격되어 저장됨', out);
}

// ---- 5. 수정 화면: 이미 새 서식으로 저장된 데이터(재수정) -> 항상 같은 정규형(strong이 바깥)으로
//        정리되어 저장되므로, 두 번째 재수정에서도 더 이상 값이 바뀌지 않아야 함(idempotent) ----
{
  const raw = '<span style="color:#c43d3d;font-size:19px"><strong>중요</strong></span> 안내';
  const out1 = roundTripEdit(raw);
  ok(out1.includes('color:#c43d3d') && out1.includes('font-size:19px') && out1.includes('<strong>') && out1.includes('중요'),
    '수정 화면: 이미 새 서식인 데이터도 색상/크기/굵게가 모두 보존됨', out1);
  const out2 = roundTripEdit(out1);
  ok(out2 === out1, '수정 화면: 정규형으로 저장된 데이터는 다시 수정해도 더 이상 바뀌지 않음(idempotent)', { out1, out2 });
}

// ---- 6. 수정 화면: 여러 줄 전달사항 ----
{
  const raw = '첫째 줄\n둘째 줄\n\n넷째 줄(빈 줄 포함)';
  ok(roundTripEdit(raw) === raw, '수정 화면: 여러 줄(빈 줄 포함) 전달사항 round-trip', roundTripEdit(raw));
}

// ---- 7. 신규 등록과 수정 화면이 같은 프로세스(env) 안에서 서로 간섭하지 않음 ----
{
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('wizardNoticeInput'); loadNoticeEditorContent_('wizardNoticeInput', ${JSON.stringify('등록 내용 <강조>')});`, ctx);
  vm.runInContext(`initNoticeEditor_('singleEditNotice'); loadNoticeEditorContent_('singleEditNotice', ${JSON.stringify('수정 내용')});`, ctx);
  const wizardVal = vm.runInContext(`getNoticeEditorValue_('wizardNoticeInput')`, ctx);
  const editVal = vm.runInContext(`getNoticeEditorValue_('singleEditNotice')`, ctx);
  ok(wizardVal.includes('강조') && wizardVal.includes('color:#dc2626'), '동시 사용: 신규 등록 편집기가 자신의 값을 정확히 유지', wizardVal);
  ok(editVal === '수정 내용', '동시 사용: 수정 화면 편집기가 자신의 값을 정확히 유지(서로 섞이지 않음)', editVal);
}

// ---- 8. 드롭다운 렌더(DOM API 기반 리팩터 회귀): 예외 없이 생성되고 구조가 올바름 ----
{
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('wizardNoticeInput'); loadNoticeEditorContent_('wizardNoticeInput', '');`, ctx);
  let threw = null, sizeOptCount = -1, colorItemCount = -1;
  try {
    sizeOptCount = vm.runInContext(`renderNoticeSizeMenu_('wizardNoticeInput').querySelectorAll('.notice-size-option').length`, ctx);
    colorItemCount = vm.runInContext(`renderNoticeColorMenu_('wizardNoticeInput').querySelectorAll('.notice-color-item').length`, ctx);
  } catch (e) { threw = e; }
  ok(!threw, '드롭다운 렌더 함수가 예외 없이 실행됨(DOM API 기반)', threw && threw.message);
  ok(sizeOptCount === 5, '글자 크기 드롭다운: 5단계 옵션이 모두 생성됨');
  ok(colorItemCount === 16, '글자색 드롭다운: 일반8 + 파스텔8 = 16개 스와치가 모두 생성됨');
}

// ---- 9. 회귀: 기존 여러 줄 내용을 편집기에서 다시 편집(Enter)하면 실제 크롬이 만드는 DOM이
//        줄마다 빈 줄을 하나씩 늘리던 버그. 크롬은 flat(<br>로만 나뉜) 내용에서 Enter를 치면
//        "그 지점부터 끝까지"를 새 <div>로 감싸면서, 원래 그 줄을 나누던 <br>까지 그 div의 맨 앞
//        자식으로 함께 끌고 들어온다(재현: 실제 브라우저에서 execCommand('insertParagraph')로
//        확인, linkedom엔 그 API가 없어 여기서는 결과 DOM 구조를 직접 만들어 검증). 직렬화 쪽에서
//        div 경계 줄바꿈과 그 안의 맨 앞 <br>를 이중으로 세지 않아야 한다. ----
{
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('singleEditNotice');`, ctx);
  // 크롬이 "2. 장소: 시청각실" 줄 끝에서 Enter를 두 번(서로 다른 줄에서) 쳤을 때 실제로 만드는 구조.
  vm.runInContext(
    `document.getElementById('singleEditNotice').innerHTML = ` +
      `'1. 일시: 3교시~4교시<br>2. 장소: 시청각실<div><br>3. 대상: 1학년</div><div><br>4. 담당: 김선생</div>';`,
    ctx,
  );
  const out = vm.runInContext(`getNoticeEditorValue_('singleEditNotice')`, ctx);
  const expected = '1. 일시: 3교시~4교시\n2. 장소: 시청각실\n3. 대상: 1학년\n4. 담당: 김선생';
  ok(out === expected, '회귀: 크롬의 "맨 앞 <br> 딸린 div" 구조를 다시 저장해도 빈 줄이 늘지 않음', { out, expected });
}

// ---- 10. 9번과 같은 수정 과정에서도, 원래 있던 '진짜' 빈 줄(전달사항 구분 등)은 그대로 유지되어야
//         함(9번 수정이 실제 빈 줄까지 지워버리는 과잉 교정이 아닌지 확인) ----
{
  const { ctx } = freshEnv();
  vm.runInContext(`initNoticeEditor_('singleEditNotice');`, ctx);
  // "2. 장소" 줄 끝에서 Enter로 새 줄을 추가했지만, 그 뒤에는 원래부터 있던 빈 줄(연속 <br><br>)이
  // div 안쪽(맨 앞이 아닌 위치)에 그대로 남아 있는 구조.
  vm.runInContext(
    `document.getElementById('singleEditNotice').innerHTML = ` +
      `'1. 일시: 3교시~4교시<br>2. 장소: 시청각실<div>2.5. 담당: 김선생<br><br>【전달사항】<br>필기구 지참 바랍니다</div>';`,
    ctx,
  );
  const out = vm.runInContext(`getNoticeEditorValue_('singleEditNotice')`, ctx);
  const expected = '1. 일시: 3교시~4교시\n2. 장소: 시청각실\n2.5. 담당: 김선생\n\n【전달사항】\n필기구 지참 바랍니다';
  ok(out === expected, '회귀: 진짜 빈 줄(전달사항 구분)은 9번 수정 이후에도 그대로 보존됨', { out, expected });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
