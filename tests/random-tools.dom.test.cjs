// Test-only DOM dependency; never included in the GAS application.
// node tests/random-tools.dom.test.cjs <path-to-linkedom>
const { parseHTML } = require(process.argv[2] || "linkedom");
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const markup = fs.readFileSync("Modals_Convenience.html", "utf8"),
  tools = fs.readFileSync("Random_Tools.html", "utf8");
const { document, window } = parseHTML(
  "<html><body>" + markup + "</body></html>",
);
if (
  !Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")
)
  Object.defineProperty(window.HTMLInputElement.prototype, "checked", {
    get() {
      return this.hasAttribute("checked");
    },
    set(v) {
      v ? this.setAttribute("checked", "") : this.removeAttribute("checked");
    },
  });
const timers = [];
// 자리뽑기 복사/인쇄 검증용 기록장(복사된 내용과 인쇄 호출 횟수를 확인합니다).
const clipboard = { text: "", items: null };
const printed = { count: 0 };
// 클립보드 HTML 형식(한글 붙여넣기용)을 검증하기 위한 최소 스텁입니다.
class FakeBlob {
  constructor(parts, options) {
    this.text = parts.join("");
    this.type = (options && options.type) || "";
  }
}
class FakeClipboardItem {
  constructor(map) {
    this.map = map;
  }
}
const ctx = vm.createContext({
  document,
  Blob: FakeBlob,
  ClipboardItem: FakeClipboardItem,
  window: {
    matchMedia: () => ({ matches: false }),
    print: () => {
      printed.count++;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    ClipboardItem: FakeClipboardItem,
  },
  crypto: require("node:crypto").webcrypto,
  setTimeout: (fn) => timers.push(fn),
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  navigator: {
    clipboard: {
      writeText: async (t) => {
        clipboard.text = t;
        clipboard.items = null;
      },
      write: async (items) => {
        clipboard.items = items[0].map;
        clipboard.text = items[0].map["text/plain"].text;
      },
    },
  },
  console,
  openMod: () => {},
  closeMod: () => {},
});
for (const s of [markup, tools])
  for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g))
    vm.runInContext(m[1], ctx);
let groups = 0;
const $ = (id) => document.getElementById(id),
  steps = {
    roulette: "Roulette",
    shuffle: "Shuffle",
    dice: "Dice",
    rps: "Rps",
    numberpick: "NumberPick",
    bracket: "Bracket",
    seat: "Seat",
    ladder: "Ladder",
  };
function open(t) {
  vm.runInContext(`openConvenienceTool('${t}')`, ctx);
}
function root(t) {
  return $("convenienceStep" + steps[t]);
}
function input(t, key, value) {
  $("rt-" + t + "-" + key).value = String(value);
}
function act(t, a, attrs = {}) {
  let b = [...root(t).querySelectorAll('[data-action="' + a + '"]')].find((b) =>
    Object.entries(attrs).every(([k, v]) => b.dataset[k] === String(v)),
  );
  assert(b, `${t} ${a} button`);
  assert(!b.disabled, `${t} ${a} enabled`);
  root(t).onclick({ target: b });
}
function finish() {
  while (timers.length) timers.shift()();
}
function result(t) {
  return $("rt-" + t + "-result").textContent;
}
function msg(t) {
  return $("rt-" + t + "-message").textContent;
}
function reset(t) {
  act(t, "reset");
  act(t, "confirm");
}
function test(name, fn) {
  fn();
  groups++;
  console.log("PASS " + name);
}
test("all 8 tools initialize lazily",()=>{for(const t in steps)assert.equal(root(t).innerHTML,"");});
const rangeTools=["roulette","shuffle","rps","ladder"];
function range(t,start,end,missing=""){input(t,"start",start);input(t,"end",end);input(t,"missing",missing);root(t).oninput();}
// 자리뽑기는 '입력·설정 / 결과' 공용 구성이 아니라 단계형 전용 화면이라 아래 공통 흐름에서 제외합니다.
for(const t of Object.keys(steps).filter(t=>t!=="seat"))test(t+": run/reset/reentry/rerun",()=>{
 open(t);
 if(rangeTools.includes(t)){assert(!root(t).querySelector("textarea[id$=names]"));range(t,1,5,"2,4");assert($("rt-"+t+"-preview").textContent.includes("3명"));}
 if(t==="ladder")input(t,"ends","발표,기록,정리");
 act(t,"run");finish();assert.equal(msg(t),"");
 const saved=result(t);act(t,"back");open(t);assert.equal(result(t),saved);
 act(t,"run");if(root(t).querySelector('[data-action=confirm]'))act(t,"confirm");finish();
 act(t,"focus");assert(root(t).classList.contains("rt-focus"));act(t,"focus");
 reset(t);assert(result(t).includes("설정 후"));
});
for(const t of rangeTools)test(t+": invalid/empty/all absent and limits",()=>{
 open(t);
 for(const values of [["",5,""],[6,5,""],[1,5,"1-5"],[1,5,"6"],[1,5,"a"],[1,5,"4-2"],[0,5,""],[1.5,5,""]]){
 range(t,...values);act(t,"run");assert(msg(t));
 }
 const max=t==="ladder"?12:t==="bracket"?32:t==="seat"?144:200;
 range(t,1,max);if(t==="seat"){input(t,"rows",12);input(t,"cols",12);}
 if(t==="ladder")input(t,"ends",Array.from({length:max},(_,i)=>String(i)).join(","));
 act(t,"run");finish();assert.equal(msg(t),"");
 reset(t);
});
test("roulette real numbers with gaps, winner exclusion and chip removal",()=>{
 open("roulette");range("roulette",10,14,"11");
 $("rt-roulette-exclude").checked=true;act("roulette","run");finish();
 assert.deepEqual([...root("roulette").querySelectorAll("svg text")].map(e=>e.textContent),["10","12","13","14"]);
 const first=$("rt-roulette-win").textContent;act("roulette","run");finish();assert.notEqual($("rt-roulette-win").textContent,first);
 assert.equal(root("roulette").querySelectorAll("svg text").length,3);
 const remainingNumber=root('roulette').querySelector('[data-action=remove]').dataset.number;
 act("roulette","remove",{number:remainingNumber});assert($("rt-roulette-missing").value.includes(remainingNumber));reset("roulette");
});
test("number picker omissions apply with and without replacement",()=>{
 open("numberpick");input("numberpick","min",1);input("numberpick","max",6);input("numberpick","missing","2, 4-5");input("numberpick","count",3);act("numberpick","run");finish();
 assert.deepEqual([...root("numberpick").querySelectorAll(".rt-ball")].map(e=>Number(e.textContent)).sort((a,b)=>a-b),[1,3,6]);
 input("numberpick","count",4);act("numberpick","run");assert(msg("numberpick").includes("중복"));
 $("rt-numberpick-dup").checked=true;input("numberpick","count",200);act("numberpick","run");finish();
 assert([...root("numberpick").querySelectorAll(".rt-ball")].every(e=>[1,3,6].includes(Number(e.textContent))));
 reset("numberpick");
});
// ===== 자리뽑기(단계형 자리배치) =====
// 흐름: STEP1 자리 만들기 → 2 제외 좌석 → 3 지정석 → 4 학생 번호 → 5 배치·이름·출력
function seatPage(){const p=root("seat").querySelector(".rt-seat-page:not([hidden])");return p?Number(p.dataset.step):0;}
function seatMake(rows,cols){input("seat","rows",rows);input("seat","cols",cols);act("seat","seat-build");}
function seatGo(n){act("seat","seat-goto",{step:n});}
function seatNums(start,end,missing=""){
 seatGo(4);
 input("seat","start",start);input("seat","end",end);input("seat","missing",missing);
 root("seat").oninput({target:$("rt-seat-missing")});
}
function seatCells(){return [...root("seat").querySelectorAll('[data-action="seat-cell"]')];}
// 화면은 교사 시점(뒷줄이 위)으로 그려지므로, DOM 순서가 아니라 좌석 번호(data-index)로 찾습니다.
function seatCellAt(i){
 const el=seatCells().find(c=>c.dataset.index===String(i));
 assert(el,`좌석 ${i}`);
 return el;
}
function seatNumberAt(i){
 const el=seatCellAt(i).querySelector(".rt-seat-number");
 return el?el.textContent.trim():(seatCellAt(i).querySelector(".rt-seat-x")?"✕":"");
}
function seatPanel(){return $("rt-seat-panel"+seatPage());}
function seatPick(i){act("seat","seat-cell",{index:i});}       // 좌석을 먼저 고르고
function seatDo(action){act("seat",action);}                    // 그 좌석에 대한 할 일을 고릅니다
function nameInputs(){return [...root("seat").querySelectorAll('#rt-seat-names input[data-number]')];}
function typeName(number,value){
 const input=nameInputs().find(i=>i.dataset.number===String(number));
 assert(input,`${number}번 이름칸`);
 input.value=value;
 $("rt-seat-names").oninput({target:input});
}
// 배치까지 한 번에 진행하는 준비 함수
function seatReady(rows,cols,start,end,missing=""){
 open("seat");seatMake(rows,cols);seatNums(start,end,missing);
 act("seat","seat-next");act("seat","seat-assign");
}
test("seat: STEP1에서 자리를 만들면 STEP2로 넘어가고 교탁·좌석이 보인다",()=>{
 open("seat");
 assert.equal(seatPage(),1);
 seatMake(4,6);
 assert.equal(seatPage(),2);                       // 만들자마자 다음 단계
 assert.equal(seatCells().length,24);
 assert(root("seat").textContent.includes("교탁"));
 assert.equal(String($("rt-seat-grid2").style.getPropertyValue("--seat-cols")),"6");
});
test("seat: 진행 표시가 현재 단계를 알려주고 이전 단계로 돌아갈 수 있다",()=>{
 open("seat");seatMake(3,3);
 const chips=()=>[...root("seat").querySelectorAll(".rt-seat-progress li")].map(li=>li.className);
 assert.equal(chips()[1],"is-now");                // STEP2 활성
 assert.equal(chips()[0],"is-done");               // STEP1 완료
 assert.equal(chips()[3],"");                      // 아직 안 간 단계
 act("seat","seat-next");assert.equal(seatPage(),3);
 act("seat","seat-prev");assert.equal(seatPage(),2);
 seatGo(1);assert.equal(seatPage(),1);             // 진행 표시 클릭으로 되돌아가기
});
test("seat: STEP2는 누르면 바로 빠지고 다시 누르면 되살아난다",()=>{
 open("seat");seatMake(2,2);
 assert(seatPanel().hidden,"2단계엔 선택 창이 뜨지 않는다");
 seatPick(0);                                       // 누르는 즉시 제외
 assert(seatCellAt(0).className.includes("is-off"));
 assert.equal(seatNumberAt(0),"✕");
 assert(msg("seat").includes("뺐습니다"));
 seatPick(0);                                       // 다시 누르면 되살아남
 assert(!seatCellAt(0).className.includes("is-off"));
 assert(msg("seat").includes("되살렸습니다"));
});
test("seat: STEP3은 좌석을 누르면 번호를 넣는 작은 창이 열린다",()=>{
 open("seat");seatMake(2,2);seatGo(3);
 assert(seatPanel().hidden,"처음엔 닫혀 있음");
 seatPick(1);
 assert(!seatPanel().hidden,"좌석을 누르면 열림");
 assert(seatPanel().querySelector(".rt-seat-pop"),"작은 창");
 assert(seatPanel().textContent.includes("1행 2열"),"어느 자리인지 알려줌");
 assert($("rt-seat-fixnumber"),"번호 입력칸");
 input("seat","fixnumber",3);seatDo("seat-fix-apply");
 assert(seatCellAt(1).className.includes("is-fixed"));
 assert(seatPanel().hidden,"지정하면 창이 닫힘");
 seatPick(1);                                       // 지정석을 다시 누르면 기존 번호가 채워짐
 assert.equal($("rt-seat-fixnumber").value,"3");
 assert(seatPanel().querySelector('[data-action="seat-fix-clear"]'),"해제 버튼");
 seatDo("seat-fix-clear");
 assert(!seatCellAt(1).className.includes("is-fixed"));
 seatPick(0);seatDo("seat-cancel");                 // 취소하면 아무 일도 없음
 assert(seatPanel().hidden);
 assert(!seatCellAt(0).className.includes("is-fixed"));
});
test("seat: 좌석 카드에 행·열 글자를 표시하지 않고 속성으로만 남긴다",()=>{
 open("seat");seatMake(2,3);
 const cell=seatCellAt(0);
 assert.equal(cell.querySelector("small"),null,"행·열 문구 없음");
 assert.equal(cell.dataset.row,"1");
 assert.equal(cell.dataset.col,"1");
});
test("seat: 지정석은 빼지 못하고, 뺀 자리는 지정석으로 쓸 수 없다",()=>{
 open("seat");seatMake(2,2);
 seatGo(3);seatPick(0);input("seat","fixnumber",2);seatDo("seat-fix-apply");
 seatGo(2);seatPick(0);                             // 2단계에서 빼려 하면 막힘
 assert(msg("seat").includes("지정석"));
 assert(!seatCellAt(0).className.includes("is-off"));
 seatPick(3);                                       // 다른 자리는 정상적으로 빠짐
 assert(seatCellAt(3).className.includes("is-off"));
 seatGo(3);seatPick(3);                             // 뺀 자리는 지정석으로 못 씀
 assert(msg("seat").includes("뺀 자리"));
 assert(seatPanel().hidden);
});
test("seat: STEP4는 좌석 수와 학생 수를 비교해 알려준다",()=>{
 open("seat");seatMake(4,6);
 seatNums(1,22);                                    // 24자리 · 22명
 assert($("rt-seat-summary").textContent.includes("자리가 2개 많아요"));
 act("seat","seat-next");                           // 수가 안 맞으면 다음 단계로 못 감
 assert(msg("seat").includes("자리가 2개 남습니다"));
 assert.equal(seatPage(),4);
 seatNums(1,24);
 assert($("rt-seat-summary").textContent.includes("배치 가능"));
 act("seat","seat-next");
 assert.equal(seatPage(),5);
});
test("seat: 제외석·지정석·궐번을 지켜 배치한다",()=>{
 open("seat");seatMake(2,3);
 seatPick(5);                                       // 6자리 중 1자리 제외(누르면 바로)
 seatGo(3);seatPick(0);input("seat","fixnumber",7);seatDo("seat-fix-apply");
 seatNums(1,7,"3, 6");                               // 1~7번 중 3·6번 궐번 → 1,2,4,5,7번 5명
 act("seat","seat-next");act("seat","seat-assign");
 assert.equal(seatNumberAt(0),"7");                  // 지정석 유지
 assert.equal(seatNumberAt(5),"✕");                  // 제외석 유지
 const placed=seatCells().map(c=>seatNumberAt(c.dataset.index)).filter(v=>v!=="✕");
 assert.deepEqual(placed.map(Number).sort((a,b)=>a-b),[1,2,4,5,7]);
 assert.deepEqual(nameInputs().map(i=>i.dataset.number),["1","2","4","5","7"]);
});
test("seat: 이름은 일부만 넣어도 되고 다시 배치해도 번호를 따라간다",()=>{
 seatReady(2,2,1,4);
 seatGo(3);seatPick(0);input("seat","fixnumber",2);seatDo("seat-fix-apply");
 seatGo(4);act("seat","seat-next");act("seat","seat-assign");
 typeName(2,"김민수");typeName(4,"이서준");
 act("seat","seat-names-apply");
 assert(root("seat").textContent.includes("김민수"));
 assert.equal(root("seat").querySelectorAll(".rt-seat-name").length,2); // 안 넣은 번호는 번호만
 act("seat","seat-reassign");
 assert.equal(seatNumberAt(0),"2");                  // 지정석은 그대로
 assert(root("seat").textContent.includes("김민수"));
 assert(root("seat").textContent.includes("이서준"));
 typeName(4,"박서윤");act("seat","seat-names-apply");
 assert(root("seat").textContent.includes("박서윤"));
 assert(!root("seat").textContent.includes("이서준"));
});
test("seat: 교사 시점 — 뒷줄이 위, 1행이 교탁 바로 위에 오고 좌우는 그대로",()=>{
 seatReady(3,2,1,6);
 const order=seatCells().map(c=>c.dataset.row+"-"+c.dataset.col);
 assert.deepEqual(order,["3-1","3-2","2-1","2-2","1-1","1-2"]);
 const board=root("seat").querySelector(".rt-seat-page:not([hidden]) .rt-seat-board");
 const kids=[...board.children].map(e=>e.className);
 assert(kids.indexOf("rt-seats")<kids.indexOf("rt-podium"),"교탁이 좌석표 아래");
 act("seat","seat-print");
 const mount=$("rtSeatPrint");
 const printOrder=[...mount.querySelectorAll(".rt-print-seat .n")].map(e=>e.textContent.trim());
 const screenOrder=seatCells().map(c=>seatNumberAt(c.dataset.index)+"번");
 assert.deepEqual(printOrder,screenOrder);
 assert(mount.innerHTML.indexOf("rt-print-grid")<mount.innerHTML.indexOf("rt-print-podium"),"인쇄도 교탁이 아래");
 finish();
});
test("seat: 복사는 교탁·번호·이름·제외석을 담고 버튼 글자는 담지 않는다",()=>{
 open("seat");seatMake(2,2);
 seatPick(3);
 seatNums(1,3);act("seat","seat-next");act("seat","seat-assign");
 typeName(1,"김민수");act("seat","seat-names-apply");
 clipboard.text="";clipboard.items=null;
 act("seat","seat-copy"); // 클립보드 스텁은 동기로 호출되므로 바로 확인할 수 있습니다.
 assert(clipboard.text.includes("[교탁]"));
 assert(clipboard.text.includes("사용 안함"));
 assert(clipboard.text.includes("김민수"));
 assert(!clipboard.text.includes("자리 배치 시작"));
 assert(!clipboard.text.includes("이용방법"));
 assert(clipboard.items,"HTML 형식도 함께 복사");
 const html=clipboard.items["text/html"].text;
 assert(html.includes("<table"));
 assert(html.includes("교탁"));
 assert(html.includes("김민수"));
 assert(html.includes("사용 안함"));
});
test("seat: 하단 글귀가 화면·복사·인쇄에 함께 들어간다",()=>{
 seatReady(2,2,1,4);
 const memo="우리 아이들의 예쁜 이름을 불러 주세요.";
 $("rt-seat-memo").value=memo;
 root("seat").oninput({target:$("rt-seat-memo")});
 assert.equal($("rt-seat-memoview").textContent,memo);
 clipboard.text="";clipboard.items=null;
 act("seat","seat-copy");
 assert(clipboard.text.trim().endsWith(memo),"글귀는 교탁 다음(맨 끝)");
 assert(clipboard.items["text/html"].text.includes(memo));
 act("seat","seat-print");
 const mount=$("rtSeatPrint");
 assert(mount.querySelector(".rt-print-memo").textContent.includes(memo));
 assert(mount.innerHTML.indexOf("rt-print-podium")<mount.innerHTML.indexOf("rt-print-memo"),"글귀는 교탁 아래");
 finish();
 $("rt-seat-memo").value="";
 root("seat").oninput({target:$("rt-seat-memo")});
 assert.equal($("rt-seat-memoview").style.display,"none");
 act("seat","seat-print");
 assert.equal($("rtSeatPrint").querySelector(".rt-print-memo"),null);
 finish();
});
test("seat: 인쇄는 자리표만 별도 영역으로 만들고 끝나면 정리한다",()=>{
 seatReady(2,2,1,4);
 typeName(1,"김민수");act("seat","seat-names-apply");
 const before=printed.count;
 act("seat","seat-print");
 assert.equal(printed.count,before+1);
 const mount=$("rtSeatPrint");
 assert(mount.textContent.includes("자리 배치표"));
 assert(mount.textContent.includes("교탁"));
 assert(mount.textContent.includes("김민수"));
 assert(!mount.textContent.includes("이용방법"));
 assert(document.body.classList.contains("rt-seat-printing"));
 finish();
 assert.equal($("rtSeatPrint"),null);
 assert(!document.body.classList.contains("rt-seat-printing"));
});
test("seat: 전체 초기화는 자리·제외석·지정석·이름을 모두 지운다",()=>{
 seatReady(2,2,1,4);
 typeName(1,"김민수");act("seat","seat-names-apply");
 assert(root("seat").textContent.includes("김민수"));
 reset("seat");
 assert.equal(seatPage(),1);                        // 1단계부터 다시
 assert.equal(seatCells().length,0);
 assert(!root("seat").textContent.includes("김민수"));
});
test("seat: 이름이 길어도 잘리지 않고 저장된다",()=>{
 seatReady(2,2,1,4);
 typeName(1,"김민수박서윤이서준");act("seat","seat-names-apply");
 assert(root("seat").textContent.includes("김민수박서윤이서준"));
});
test("ladder omitted numbers, mismatch, deterministic paths and cancel",()=>{
 open("ladder");range("ladder",1,5,"2,4");input("ladder","ends","발표,기록");act("ladder","run");assert(msg("ladder").includes("개수"));
 input("ladder","ends","발표,기록,정리");act("ladder","run");
 assert.deepEqual([...root("ladder").querySelectorAll('[data-action=path]')].map(e=>e.textContent),["1번","3번","5번"]);
 act("ladder","path",{index:0});finish();act("ladder","all");const original=result("ladder");act("ladder","all");assert.equal(result("ladder"),original);
 act("ladder","focus");act("ladder","run");assert(!root("ladder").classList.contains("rt-focus"));act("ladder","cancel");assert.equal(result("ladder"),original);reset("ladder");
});
test("single student shuffle; modal reentry retains range",()=>{
 open("shuffle");range("shuffle",7,7);act("shuffle","run");assert(result("shuffle").includes("7번"));
 vm.runInContext("closeConvenienceMod();openConvenienceMod();",ctx);open("shuffle");assert.equal($("rt-shuffle-start").value,"7");reset("shuffle");
});
test("dice unchanged: six dice, coin results, history",()=>{
 open("dice");input("dice","count",6);for(let i=0;i<6;i++){act("dice","run");finish();}assert.equal(root("dice").querySelectorAll(".rt-die").length,6);assert.equal(root("dice").querySelectorAll("li").length,5);
 const select=$("rt-dice-mode");select.querySelector('[value=dice]').selected=false;select.querySelector('[value=coin]').selected=true;act("dice","run");finish();assert.equal(root("dice").querySelectorAll(".rt-coin").length,6);reset("dice");
});
test('bracket class preset, selection, fewer classes and reset',()=>{
 open('bracket');assert.equal(root('bracket').querySelectorAll('input[type=checkbox]:checked').length,8);
 $('rt-bracket-class-8').checked=false;act('bracket','bracket-fill');assert($('rt-bracket-class-8').checked);
 act('bracket','run');assert(result('bracket').includes('8반'));
 for(let n=2;n<=8;n++)$('rt-bracket-class-'+n).checked=false;
 act('bracket','run');assert(msg('bracket').includes('2개'));
 for(let n=2;n<=5;n++)$('rt-bracket-class-'+n).checked=true;
 act('bracket','run');act('bracket','confirm');assert(result('bracket').includes('부전승'));assert(!result('bracket').includes('8반'));reset('bracket');
});
test('bracket team input, validation, advancement, reentry and mode preservation',()=>{
 open('bracket');act('bracket','bracket-teams');
 for(const raw of ['', '청팀', '청팀,청팀',Array.from({length:33},(_,i)=>'팀'+i).join(',')]){input('bracket','teams',raw);act('bracket','run');assert(msg('bracket'));}
 input('bracket','teams','청팀,백팀\n도전팀\n희망팀');act('bracket','run');assert.equal(msg('bracket'),'');assert(result('bracket').includes('청팀'));
 const btn=[...root('bracket').querySelectorAll('[data-action=winner]')].find(b=>!b.disabled);root('bracket').onclick({target:btn});assert(root('bracket').querySelector('[aria-pressed=true][data-action=winner]'));
 const saved=result('bracket');act('bracket','bracket-classes');assert.equal(result('bracket'),saved);act('bracket','bracket-teams');assert($('rt-bracket-teams').value.includes('청팀'));
 act('bracket','back');open('bracket');assert.equal($('rt-bracket-teams-panel').style.display,'block');assert.equal(result('bracket'),saved);reset('bracket');
 assert.equal($('rt-bracket-teams').value,'');assert.equal(root('bracket').querySelectorAll('input[type=checkbox]:checked').length,8);
});
console.log(groups+" DOM interaction groups passed");
