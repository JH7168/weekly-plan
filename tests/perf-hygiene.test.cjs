// 3차 성능 정리(죽은 preload/init 코드 제거, Font Awesome 경량화, 교육기관 로고 네트워크 최적화)를
// 정적 파일 내용으로 검증합니다. 실제 브라우저/네트워크 없이도 회귀를 잡을 수 있는 항목만 다룹니다.
const fs = require('fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
    passed++;
  } catch (e) {
    console.log('FAIL ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}
const read = (f) => fs.readFileSync(f, 'utf8');

test('Modals_Admin.html: 죽은 preloadStudentCountStatus/window load 훅이 제거됨', () => {
  const src = read('Modals_Admin.html');
  assert.ok(!/function\s+preloadStudentCountStatus/.test(src), 'preloadStudentCountStatus 함수가 남아있음');
  assert.ok(!/addEventListener\(\s*['"]load['"]/.test(src), "window.addEventListener('load', ...)가 남아있음");
  // openStudentCountMod는 여전히 자체적으로 fetch해야 함(기능 유지 확인)
  assert.ok(/function openStudentCountMod/.test(src) && /getStudentCountStatus\(\)/.test(src));
});

test('Modals_Resub.html: 죽은 DOMContentLoaded 훅이 제거되고 스크롤 리스너 기능은 유지됨', () => {
  const src = read('Modals_Resub.html');
  assert.ok(!/addEventListener\(\s*['"]DOMContentLoaded['"]/.test(src), "document.addEventListener('DOMContentLoaded', ...)가 남아있음");
  assert.ok(/#resubMod \.modal-content/.test(src) && /rs-date-dropdown/.test(src), '날짜 드롭다운 스크롤 숨김 로직 자체는 남아있어야 함(기능 삭제 금지)');
});

test('7개 지연 로딩 파일: window.onload / addEventListener(load) 죽은 훅이 전혀 없음', () => {
  const files = ['Modals_Convenience.html', 'Random_Tools.html', 'Modals_Resub.html', 'Modals_Task.html', 'Modals_Admin.html', 'Modals_TeacherLookup.html', 'Audi_System.html'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/window\.onload\s*=/.test(src), f + '에 window.onload가 있음(초기 페이지 로딩 후에는 절대 실행되지 않음)');
    assert.ok(!/addEventListener\(\s*['"]load['"]/.test(src), f + '에 addEventListener("load", ...)가 있음');
  }
});

test('Index.html: Font Awesome이 all.min.css 대신 fontawesome.min.css + solid.min.css로 교체됨', () => {
  const src = read('Index.html');
  assert.ok(!/font-awesome\/6\.0\.0\/css\/all\.min\.css/.test(src), 'all.min.css가 여전히 참조됨');
  assert.ok(/font-awesome\/6\.0\.0\/css\/fontawesome\.min\.css/.test(src), 'fontawesome.min.css(core) 참조가 없음');
  assert.ok(/font-awesome\/6\.0\.0\/css\/solid\.min\.css/.test(src), 'solid.min.css 참조가 없음');
});

test('프로젝트 전체: far(regular)/fab(brands) 아이콘 클래스가 전혀 쓰이지 않음(solid 단독 교체가 안전한 전제)', () => {
  const files = fs.readdirSync('.').filter((f) => f.endsWith('.html'));
  for (const f of files) {
    const src = read(f);
    // class="... far ..." / class="... fab ..." 형태만 검사(fa-bars 같은 fa- 아이콘명의 부분 문자열 오탐 방지)
    const farMatch = src.match(/class="[^"]*\bfar\b[^"]*"/);
    const fabMatch = src.match(/class="[^"]*\bfab\b[^"]*"/);
    assert.ok(!farMatch, f + '에서 far(regular) 아이콘 클래스 발견: ' + (farMatch && farMatch[0]));
    assert.ok(!fabMatch, f + '에서 fab(brands) 아이콘 클래스 발견: ' + (fabMatch && fabMatch[0]));
  }
});

test('Index.html: 교육기관 로고 5개 img 구조(도메인/로딩 우선순위) 유지', () => {
  const src = read('Index.html');
  const imgs = [...src.matchAll(/<img\s+src="([^"]+)"[^>]*>/g)];
  assert.equal(imgs.length, 5, '교육기관 로고 img 태그 개수가 5개가 아님');
  const domains = imgs.map((m) => new URL(m[1]).hostname);
  assert.deepEqual(domains, ['www.jge.go.kr', 'www.jge.go.kr', 'www.jnstudy.kr', 'star.moe.go.kr', 'stas.moe.go.kr']);
  // 캐러셀에서 처음부터 보이는 4장은 eager(또는 기본값), 회전 후에야 보이는 5번째(stas)만 lazy
  const loadingAttrs = imgs.map((m) => (m[0].match(/loading="(\w+)"/) || [, 'auto'])[1]);
  assert.deepEqual(loadingAttrs, ['eager', 'eager', 'eager', 'eager', 'lazy']);
});

test('Index.html: 교육기관 로고 4개 도메인에 dns-prefetch가 있음(preconnect 아님 — 도메인당 이미지 1장뿐이라 과도한 사전 연결 지양)', () => {
  const src = read('Index.html');
  for (const host of ['www.jge.go.kr', 'www.jnstudy.kr', 'star.moe.go.kr', 'stas.moe.go.kr']) {
    assert.ok(
      src.includes(`<link rel="dns-prefetch" href="https://${host}">`),
      host + '에 대한 dns-prefetch가 없음'
    );
    assert.ok(
      !new RegExp(`rel="preconnect" href="https://${host}"`).test(src),
      host + '에 불필요한 preconnect가 추가됨(단일 이미지 도메인에는 과함)'
    );
  }
});

test('escapeHtmlClient_: Task를 전혀 로드하지 않은 상태(모바일 초기 렌더링과 동일 조건)에서도 정상 동작함', () => {
  // 4차 최종 검증: 1차에서 발견·수정한 "모바일 연간 행사 렌더링이 escapeHtmlClient_ 미정의로 깨질 뻔한" 문제의
  // 회귀 테스트입니다. Modals_Task.html의 <script>는 전혀 실행하지 않고 JS_Main.html만 실행해,
  // Task를 한 번도 열지 않은 사용자의 첫 페이지 로딩 상태를 그대로 재현합니다.
  const jsMain = read('JS_Main.html').match(/<script>([\s\S]*)<\/script>/)[1];
  const sandbox = {
    console,
    document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    google: { script: { run: { withSuccessHandler() { return this; }, withFailureHandler() { return this; } } } },
    performance: { now: () => Date.now() },
    setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    addEventListener: () => {}, matchMedia: () => ({ matches: false }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(jsMain, sandbox); // window.onload 대입만 할 뿐 실행은 안 하므로 안전
  const result = vm.runInContext("escapeHtmlClient_('<b>공휴일 & 행사</b>')", sandbox);
  assert.equal(result, '&lt;b&gt;공휴일 &amp; 행사&lt;/b&gt;');
});

console.log('\n' + passed + ' passed');
