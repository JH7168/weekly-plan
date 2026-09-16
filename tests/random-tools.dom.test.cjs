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
const ctx = vm.createContext({
  document,
  window: { matchMedia: () => ({ matches: false }) },
  crypto: require("node:crypto").webcrypto,
  setTimeout: (fn) => timers.push(fn),
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  navigator: { clipboard: { writeText: async () => {} } },
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
const rangeTools=["roulette","shuffle","rps","seat","ladder"];
function range(t,start,end,missing=""){input(t,"start",start);input(t,"end",end);input(t,"missing",missing);root(t).oninput();}
for(const t of Object.keys(steps))test(t+": run/reset/reentry/rerun",()=>{
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
 open("numberpick");input("numberpick","min",1);input("numberpick","max",6);input("numberpick","missing","2, 4-5");input("numberpick","count",3);act("numberpick","run");
 assert.deepEqual([...root("numberpick").querySelectorAll(".rt-ball")].map(e=>Number(e.textContent)).sort((a,b)=>a-b),[1,3,6]);
 input("numberpick","count",4);act("numberpick","run");assert(msg("numberpick").includes("중복"));
 $("rt-numberpick-dup").checked=true;input("numberpick","count",200);act("numberpick","run");
 assert([...root("numberpick").querySelectorAll(".rt-ball")].every(e=>[1,3,6].includes(Number(e.textContent))));
 reset("numberpick");
});
test("seat pins keep their number; removed pinned number is rejected",()=>{
 open("seat");range("seat",1,4);input("seat","rows",2);input("seat","cols",2);act("seat","run");act("seat","pin",{index:0});
 const pinned=root("seat").querySelector('[data-index="0"] span').textContent;act("seat","run");assert.equal(root("seat").querySelector('[data-index="0"] span').textContent,pinned);
 input("seat","missing",parseInt(pinned));act("seat","run");assert(msg("seat").includes("고정"));reset("seat");
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
