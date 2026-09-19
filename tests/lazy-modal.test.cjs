// Verifies the lazy-modal loading mechanism (openConvenienceMod/openConvenienceTool/openResubMod
// stubs added to JS_Main.html) against the REAL Modals_Convenience.html + Random_Tools.html +
// Modals_Resub.html content, using a mock google.script.run that mirrors Code.js's
// getLazyModalHtml(key) whitelist behavior. No real browser/GAS needed.
// node tests/lazy-modal.test.cjs <path-to-linkedom> (defaults to "linkedom")
const { parseHTML } = require(process.argv[2] || 'linkedom');
const fs = require('fs'), vm = require('node:vm');

const jsMain = fs.readFileSync('JS_Main.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const read = (f) => fs.readFileSync(f, 'utf8');

// Whitelist mirrors Code.js's LAZY_MODAL_FILES_ exactly (same keys, same bundling).
const LAZY_FILES = {
  convenience: read('Modals_Convenience.html') + '\n' + read('Random_Tools.html'),
  resub: read('Modals_Resub.html'),
  task: read('Modals_Task.html'),
  admin: read('Modals_Admin.html'),
  teacherLookup: read('Modals_TeacherLookup.html'),
  audi: read('Audi_System.html'),
};

function freshEnv() {
  const skeleton = `<html><body>
    <div id="loadingOverlay" style="display:none"><span id="loadingText"></span></div>
    <div id="customAlertMod" class="modal"><span id="alertMsg"></span><button id="alertOkBtn"></button><button id="alertCancelBtn"></button></div>
  </body></html>`;
  const { document, window: domWindow } = parseHTML(skeleton);
  if (!Object.getOwnPropertyDescriptor(domWindow.HTMLInputElement.prototype, 'checked'))
    Object.defineProperty(domWindow.HTMLInputElement.prototype, 'checked', {
      get() { return this.hasAttribute('checked'); },
      set(v) { v ? this.setAttribute('checked', '') : this.removeAttribute('checked'); },
    });

  const serverCalls = [];
  const allServerCalls = []; // 모든 서버 함수명 호출 로그(중복 호출 여부 확인용, 예: getStudentCountStatus)
  let nextBehavior = null; // (key) => 'ok' | 'fail', mocks a network/server outcome
  // 이 스위트는 지연 로딩 "메커니즘"(서버 호출 횟수/DOM 삽입/재사용/실패복구)만 검증합니다.
  // Task/Admin/TeacherLookup/Audi가 내부적으로 호출하는 다른 실제 서버 함수(getStudentCountStatus 등)는
  // 이 프로젝트의 범위가 아니므로, getLazyModalHtml 외의 모든 호출은 일반 Proxy로 조용히 성공 처리합니다.
  const runner = (onSuccess, onFailure) => new Proxy({}, {
    get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => runner(fn, onFailure);
      if (prop === 'withFailureHandler') return (fn) => runner(onSuccess, fn);
      if (prop === 'getLazyModalHtml') return (key) => {
        serverCalls.push(key);
        const mode = (nextBehavior && nextBehavior(key)) || 'ok';
        setTimeout(() => {
          if (mode === 'fail') { onFailure && onFailure(new Error('네트워크 오류(모의)')); return; }
          if (!LAZY_FILES[key]) { onFailure && onFailure(new Error('허용되지 않은 화면입니다.')); return; } // Code.js의 화이트리스트 거부를 흉내냄
          onSuccess && onSuccess(LAZY_FILES[key]);
        }, 5);
      };
      // 배열을 기대하고 바로 .find/.forEach 등을 쓰는 내부 호출(getAudiBookings 등)이 있어,
      // 그런 함수들만 undefined 대신 빈 배열로 응답해 mock 데이터 형태 불일치로 죽지 않게 합니다.
      const ARRAY_SHAPED = new Set(['getAudiBookings']);
      return (..._args) => {
        allServerCalls.push(prop);
        setTimeout(() => onSuccess && onSuccess(ARRAY_SHAPED.has(prop) ? [] : undefined), 0);
      };
    },
  });

  // sandbox.window를 sandbox 자기 자신으로 만들어, 실제 브라우저처럼 "window.foo = ..."와
  // 전역 식별자 foo가 항상 같은 객체를 가리키도록 합니다(2차에서 추가한 lazyEntry_가
  // window[fnName] = function(){...} 형태로 스텁을 등록하기 때문에 꼭 필요합니다).
  const sandbox = {
    document,
    google: { script: { run: runner(null, null) } },
    performance: { now: () => Date.now() },
    console,
    alert: () => {},
    serverData: { deptList: ['교무기획부', '1학년부'] }, // Modals_Task.html의 부서 버튼 렌더링용
    addEventListener: () => {}, // Modals_Task/Admin의 top-level window.addEventListener('dragover'/'load' 등) 안전 처리
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: () => 0,
    clearInterval: () => {},
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  // linkedom(테스트 DOM)은 실제 브라우저와 달리 동적으로 만든 <script> 요소를 자동 실행하지 않으므로,
  // appendChild를 가로채 <script>가 body에 붙을 때 그 내용을 vm 컨텍스트에서 직접 실행해 브라우저 동작을 흉내냅니다.
  // (프로덕션 코드 자체는 실제 브라우저의 표준 동작으로 정상 실행되며, 이건 테스트 하네스 전용 보정입니다.)
  const origAppendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = (node) => {
    const result = origAppendChild(node);
    if (node.tagName === 'SCRIPT' && node.textContent) vm.runInContext(node.textContent, ctx);
    return result;
  };
  // JS_Main.html의 스크립트를 실행해 g, toggleLoading, openMod/closeMod, 지연 로딩 스텁, showAlert 등을 정의합니다.
  vm.runInContext(jsMain, ctx);
  return {
    ctx, document,
    getCalls: () => serverCalls,
    getAllServerCalls: () => allServerCalls,
    setBehavior: (fn) => { nextBehavior = fn; },
  };
}

function flush(ms) { return new Promise((r) => setTimeout(r, ms)); }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } }

(async () => {
  // ---- 1. openConvenienceMod: 첫 클릭은 로딩+오픈, 두 번째 클릭은 서버 재호출 없이 즉시 오픈 ----
  {
    const env = freshEnv();
    ok(env.document.getElementById('convenienceMod') === null, '로드 전: #convenienceMod가 DOM에 없음');
    vm.runInContext('openConvenienceMod();', env.ctx);
    ok(env.getCalls().length === 1, '첫 클릭: getLazyModalHtml 서버 호출 1회 발생');
    await flush(30);
    const mod = env.document.getElementById('convenienceMod');
    ok(!!mod, '로드 후: #convenienceMod가 DOM에 삽입됨');
    ok(mod.style.display === 'flex', '로드 후: 모달이 실제로 열림(display:flex)');
    ok(!!env.ctx.window.ClassroomTools, 'Random_Tools의 ClassroomTools가 함께 로드됨');
    ok(env.document.getElementById('convenienceStep1').style.display === 'flex', 'convenienceStep1(홈 화면)이 정상 표시됨');

    mod.style.display = 'none';
    vm.runInContext('openConvenienceMod();', env.ctx);
    ok(env.getCalls().length === 1, '두 번째 클릭: 서버 재호출 없음(캐시 재사용)');
    await flush(0);
    ok(env.document.getElementById('convenienceMod').style.display === 'flex', '두 번째 클릭: 즉시 다시 열림');
  }

  // ---- 2. 로딩 중 연속 클릭 -> 서버 호출 1회만, DOM 중복 삽입 없음 ----
  {
    const env = freshEnv();
    for (let i = 0; i < 5; i++) vm.runInContext('openConvenienceMod();', env.ctx);
    ok(env.getCalls().length === 1, '로딩 중 5연타: 서버 호출은 여전히 1회');
    await flush(30);
    ok(env.document.querySelectorAll('#convenienceMod').length === 1, '로딩 중 5연타 후: #convenienceMod가 정확히 1개만 삽입됨');
  }

  // ---- 3. plannerOpenQr 패턴: openConvenienceMod(); openConvenienceTool('qr'); 연속 호출 ----
  {
    const env = freshEnv();
    vm.runInContext("openConvenienceMod(); openConvenienceTool('qr');", env.ctx);
    ok(env.getCalls().length === 1, "plannerOpenQr 패턴: 두 스텁이 같은 로딩을 공유해 서버 호출 1회만 발생");
    await flush(30);
    const qrStep = env.document.getElementById('convenienceStepQr');
    ok(!!qrStep && qrStep.style.display === 'block', 'QR 화면으로 정상 전환됨(openConvenienceTool 순서가 보존됨)');
  }

  // ---- 4. 실패 처리: 계속 실패하면 DOM 미삽입, 이후 클릭에서 재시도 가능 ----
  //        (자동 1회 재시도가 있어 첫 클릭만으로 서버 호출이 2회 발생함 — 아래 4b에서 별도 검증)
  {
    const env = freshEnv();
    env.setBehavior(() => 'fail');
    vm.runInContext('openResubMod();', env.ctx);
    await flush(60); // 자동 재시도(내부적으로 다시 getLazyModalHtml 호출)까지 끝나길 기다립니다.
    ok(env.getCalls().length === 2, '계속 실패: 자동 재시도까지 포함해 서버 호출 2회 발생');
    ok(env.document.getElementById('resubMod') === null, '실패 시: DOM이 깨진 상태로 남지 않음(삽입 안 됨)');

    env.setBehavior(() => 'ok');
    vm.runInContext('openResubMod();', env.ctx);
    ok(env.getCalls().length === 3, '자동 재시도까지 모두 실패한 뒤 사용자가 다시 누르면: 새 서버 호출이 또 발생함');
    await flush(30);
    ok(!!env.document.getElementById('resubMod'), '재시도 성공: 결보강 모달 DOM 삽입 확인');
  }

  // ---- 4b. 자동 재시도: 첫 시도만 실패하고 재시도가 성공하면, 사용자가 다시 누르지 않아도 정상 로드됨 ----
  {
    const env = freshEnv();
    let callNum = 0;
    env.setBehavior(() => { callNum++; return callNum === 1 ? 'fail' : 'ok'; }); // 1번째만 실패, 2번째(자동 재시도)는 성공
    vm.runInContext('openAdminLogin();', env.ctx);
    await flush(60);
    ok(env.getCalls().length === 2, '자동 재시도: 서버 호출이 실패 1회 + 자동 재시도 1회로 총 2회');
    ok(!!env.document.getElementById('adminLoginMod'), '자동 재시도 성공: 사용자가 다시 누르지 않아도 모달이 정상 삽입됨');
    ok(env.document.getElementById('adminLoginMod').style.display === 'flex', '자동 재시도 성공: 모달이 실제로 열림');
  }

  // ---- 5. 보안: 화이트리스트에 없는 key는 거부됨(임의 파일 접근 불가) ----
  {
    const env = freshEnv();
    let rejected = false;
    env.ctx.google.script.run
      .withSuccessHandler(() => {})
      .withFailureHandler(() => { rejected = true; })
      .getLazyModalHtml('../../Code');
    await flush(10);
    ok(rejected, '화이트리스트에 없는 key는 실패 처리됨(임의 파일 접근 불가)');
    for (const badKey of ['Index', 'CSS', '../../Code']) {
      const env2 = freshEnv();
      let r2 = false;
      env2.ctx.google.script.run.withSuccessHandler(() => {}).withFailureHandler(() => { r2 = true; }).getLazyModalHtml(badKey);
      await flush(10);
      ok(r2, `getLazyModalHtml('${badKey}')도 거부됨`);
    }
  }

  // ---- 6. Task: 첫 진입(switchTo)은 서버 호출 1회, DOM 삽입, 이후 재사용 ----
  {
    const env = freshEnv();
    ok(env.document.getElementById('workMod') === null, '로드 전: #workMod가 DOM에 없음');
    vm.runInContext("switchTo('workMod');", env.ctx);
    ok(env.getCalls().length === 1, 'Task 첫 진입: 서버 호출 1회');
    await flush(30);
    ok(!!env.document.getElementById('workMod'), 'Task 로드 후: #workMod DOM 삽입 확인');
    await flush(60); // switchTo 내부에 openMod(t)를 50ms 지연 호출하는 setTimeout이 있어 추가로 기다립니다.
    ok(env.document.getElementById('workMod').style.display === 'flex', 'Task 로드 후: workMod가 실제로 열림');

    // 다른 진입 함수(editItemFromDetail 등)도 같은 key를 공유해, 이미 로드된 뒤에는 서버 재호출이 없어야 함.
    env.ctx.currentDetailIdx = 0;
    vm.runInContext('window.calendarItemDetails = window.calendarItemDetails || [{}];', env.ctx);
    try { vm.runInContext('editItemFromDetail(0);', env.ctx); } catch (e) { /* 내부 데이터 부재로 인한 예외는 무시: 서버 재호출 여부만 확인 */ }
    ok(env.getCalls().length === 1, 'Task: editItemFromDetail 등 다른 진입 함수도 서버 재호출 없이 같은 로드를 재사용');
  }

  // ---- 7. Admin: 5개 진입 함수가 같은 key를 공유(서버 호출 1회만), 각자 정상 오픈 ----
  {
    const env = freshEnv();
    ok(env.document.getElementById('adminLoginMod') === null, '로드 전: #adminLoginMod가 DOM에 없음');
    vm.runInContext('openAdminLogin();', env.ctx);
    ok(env.getCalls().length === 1, 'Admin 첫 진입(openAdminLogin): 서버 호출 1회');
    await flush(30);
    ok(!!env.document.getElementById('adminLoginMod'), 'Admin 로드 후: #adminLoginMod DOM 삽입 확인');
    ok(env.document.getElementById('adminLoginMod').style.display === 'flex', 'Admin 로드 후: adminLoginMod가 열림');

    // 같은 파일 안의 다른 진입점(현황판)을 열어도 서버 재호출이 없어야 함.
    vm.runInContext('openStudentCountMod();', env.ctx);
    ok(env.getCalls().length === 1, 'Admin: openStudentCountMod는 이미 로드된 admin을 재사용(서버 재호출 없음)');
    await flush(10);
    ok(!!env.document.getElementById('studentCountMod'), 'Admin: studentCountMod도 정상 삽입됨(같은 파일)');
    ok(env.document.getElementById('studentCountMod').style.display === 'flex', 'Admin: studentCountMod가 열림');
    // 3차 회귀 테스트: 죽은 preloadStudentCountStatus(window load 훅)를 정리했으므로,
    // 현황판 첫 진입에서 getStudentCountStatus는 openStudentCountMod 자신의 fetch 1번만 발생해야 함(중복 없음).
    const gscsCalls = env.getAllServerCalls().filter((n) => n === 'getStudentCountStatus');
    ok(gscsCalls.length === 1, 'Admin: 현황판 첫 진입 시 getStudentCountStatus 서버 호출이 정확히 1회(죽은 preload와 중복 없음)');
  }

  // ---- 8. TeacherLookup: 첫 진입 서버 호출 1회, DOM 삽입, 재진입 시 재호출 없음 ----
  {
    const env = freshEnv();
    ok(env.document.getElementById('tlPassMod') === null, '로드 전: #tlPassMod가 DOM에 없음');
    vm.runInContext('tlOpenPasswordMod();', env.ctx);
    ok(env.getCalls().length === 1, 'TeacherLookup 첫 진입: 서버 호출 1회');
    await flush(30);
    ok(!!env.document.getElementById('tlPassMod'), 'TeacherLookup 로드 후: #tlPassMod DOM 삽입 확인');
    ok(env.document.getElementById('tlPassMod').style.display === 'flex', 'TeacherLookup 로드 후: tlPassMod가 열림');

    env.document.getElementById('tlPassMod').style.display = 'none';
    vm.runInContext('tlOpenPasswordMod();', env.ctx);
    ok(env.getCalls().length === 1, 'TeacherLookup 재진입: 서버 재호출 없이 즉시 오픈');
    await flush(0);
    ok(env.document.getElementById('tlPassMod').style.display === 'flex', 'TeacherLookup 재진입: 다시 열림 확인');
  }

  // ---- 9. Audi: 첫 진입 서버 호출 1회, DOM 삽입 ----
  {
    const env = freshEnv();
    ok(env.document.getElementById('audiWeeklyMod') === null, '로드 전: #audiWeeklyMod가 DOM에 없음');
    vm.runInContext('openAudiWeekly();', env.ctx);
    ok(env.getCalls().length === 1, 'Audi 첫 진입: 서버 호출 1회');
    await flush(30);
    ok(!!env.document.getElementById('audiWeeklyMod'), 'Audi 로드 후: #audiWeeklyMod DOM 삽입 확인');
  }

  // ---- 10. 서로 다른 모달(key)의 동시 로딩: 상태/컨테이너/스크립트 삽입이 서로 간섭하지 않음 ----
  {
    const env = freshEnv();
    vm.runInContext("switchTo('workMod'); openAdminLogin(); tlOpenPasswordMod(); openAudiWeekly();", env.ctx);
    ok(
      env.getCalls().sort().join(',') === ['admin', 'audi', 'task', 'teacherLookup'].join(','),
      '서로 다른 key 동시 클릭: 각 key당 정확히 1회씩만 서버 호출'
    );
    await flush(30);
    ok(!!env.document.getElementById('workMod'), '동시 로딩 후: Task DOM 정상 삽입');
    ok(!!env.document.getElementById('adminLoginMod'), '동시 로딩 후: Admin DOM 정상 삽입');
    ok(!!env.document.getElementById('tlPassMod'), '동시 로딩 후: TeacherLookup DOM 정상 삽입');
    ok(!!env.document.getElementById('audiWeeklyMod'), '동시 로딩 후: Audi DOM 정상 삽입');
    ['workMod', 'adminLoginMod', 'tlPassMod', 'audiWeeklyMod'].forEach((id) => {
      ok(env.document.querySelectorAll('#' + id).length === 1, id + ': 정확히 1개만 존재(중복 삽입 없음)');
    });
  }

  // ---- 11. 1차 기능(Convenience/Resub)이 2차 작업 후에도 정상 동작하는지 회귀 확인 ----
  {
    const env = freshEnv();
    vm.runInContext('openConvenienceMod();', env.ctx);
    await flush(30);
    ok(!!env.document.getElementById('convenienceMod'), '1차 회귀 확인: 편의 기능 여전히 정상 로드');
    vm.runInContext('openResubMod();', env.ctx);
    await flush(30);
    ok(!!env.document.getElementById('resubMod'), '1차 회귀 확인: 결보강 여전히 정상 로드');

    // TeacherLookup을 결보강보다 먼저 여는 순서에서도 rsSupportDataLoaded 등 공유 변수가 깨지지 않는지 확인
    // (결보강을 지연 로딩으로 바꾸며 발견한 잠재 버그의 회귀 테스트: 이제 JS_Main.html에 선언되어 있어야 함)
    const env2 = freshEnv();
    let threw = null;
    try { vm.runInContext('tlOpenPasswordMod();', env2.ctx); } catch (e) { threw = e; }
    ok(!threw, 'TeacherLookup을 Resub보다 먼저 열어도 rsSupportDataLoaded 참조로 인한 오류가 없음');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
