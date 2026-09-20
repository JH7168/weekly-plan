const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  cp = require("node:child_process");
const source = fs.readFileSync("Random_Tools.html", "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx = vm.createContext({
  crypto: require("node:crypto").webcrypto,
  window: {},
  console,
});
vm.runInContext(script + "\nthis.R=ClassroomRandom;", ctx);
const R = ctx.R;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("PASS " + name);
}
const plain = (x) => JSON.parse(JSON.stringify(x));
test("blank / too many / long input validation", () => {
  for (const x of ["", Array(201).fill("a").join(","), "x".repeat(61)])
    assert.throws(() => R.list(x));
});
test("newline/comma parser and duplicate identity", () =>
  assert.deepEqual(plain(R.list("가,나\n다,가")), ["가", "나", "다", "가"]));
test("shuffle 1 / 200: no loss, original preserved", () => {
  for (const n of [1, 200]) {
    const a = Array.from({ length: n }, (_, i) => i);
    assert.deepEqual(
      [...R.shuffle(a)].sort((a, b) => a - b),
      a,
    );
  }
});
test("random bounds and rejection sampling", () => {
  for (const n of [1, 2, 6, 200, 4294967296])
    for (let i = 0; i < 100; i++) {
      const x = R.int(n);
      assert(x >= 0 && x < n);
    }
  for (const n of [0, -1, 1.5, 4294967297]) assert.throws(() => R.int(n));
  let calls = 0;
  const orig = ctx.crypto;
  ctx.crypto = {
    getRandomValues: (a) => {
      a[0] = calls++ === 0 ? 4294967295 : 4;
    },
  };
  assert.equal(R.int(6), 4);
  assert.equal(calls, 2);
  ctx.crypto = orig;
});
test("roulette pointer alignment across repeated 2/20/200 spins", () => {
  for (const n of [2, 20, 200]) {
    let previous = 0;
    for (let i = 0; i < 100; i++) {
      const idx = R.int(n);
      previous = R.wheelRotation(previous, idx, n);
      const pointed = Math.floor(((360 - (previous % 360)) % 360) / (360 / n));
      assert.equal(pointed, idx);
    }
  }
});
test("dice 1 and 6 range / coin both sides", () => {
  for (const n of [1, 6])
    for (let k = 0; k < 100; k++) {
      const a = Array.from({ length: n }, () => R.int(6) + 1);
      assert(a.every((v) => v >= 1 && v <= 6));
      assert(a.reduce((x, y) => x + y, 0) >= n);
    }
  assert([0, 1].includes(R.int(2)));
});
test("RPS complete winner/draw cases", () => {
  assert.equal(R.rpsWinner(["가위", "보"]), "가위");
  assert.equal(R.rpsWinner(["바위", "가위"]), "바위");
  assert.equal(R.rpsWinner(["바위", "보"]), "보");
  assert.equal(R.rpsWinner(["보", "보"]), null);
  assert.equal(R.rpsWinner(["가위", "바위", "보"]), null);
});
test("number invalid ranges / limits", () => {
  for (const args of [
    [2, 1, 1, false],
    [1, 2, 3, false],
    [1, 2, 0, false],
    [1, 2, 201, true],
    [NaN, 3, 1, false],
    [1.2, 3, 1, false],
    [-1e9 - 1, 1, 1, false],
  ])
    assert.throws(() => R.numbers(...args));
});
test("number full range unique / repeated / huge range bounded memory", () => {
  assert.deepEqual(
    [...R.numbers(-10, 10, 21, false)].sort((a, b) => a - b),
    Array.from({ length: 21 }, (_, i) => i - 10),
  );
  assert.deepEqual(plain(R.numbers(3, 3, 6, true)), [3, 3, 3, 3, 3, 3]);
  assert.equal(new Set(R.numbers(-1e9, 1e9, 200, false)).size, 200);
});
for (const n of [2, 4, 5, 8, 9, 32])
  test(`bracket ${n}: byes, full advancement, winner change`, () => {
    const names = Array.from({ length: n }, (_, i) => "선수" + i),
      b = R.bracket(names);
    assert.equal(
      b.rounds[0].flatMap((m) => m.players).filter(Boolean).length,
      n,
    );
    assert.equal(
      new Set(
        b.rounds[0]
          .flatMap((m) => m.players)
          .filter(Boolean)
          .map((p) => p.id),
      ).size,
      n,
    );
    for (const m of b.rounds[0])
      if (!m.players[1]) assert.equal(m.winner, m.players[0]);
    for (let r = 0; r < b.rounds.length; r++)
      b.rounds[r].forEach((m, i) => {
        if (m.players.every(Boolean)) assert(R.advance(b, r, i, 0));
      });
    assert(b.rounds.at(-1)[0].winner);
    const at = b.rounds[0].findIndex((m) => m.players.every(Boolean));
    R.advance(b, 0, at, 1);
    if (b.rounds.length > 1) assert.equal(b.rounds.at(-1)[0].winner, null);
  });
test("seatPlan: 좌석 수와 학생 수가 맞아야 배치되고, 모든 학생이 정확히 한 자리에 앉는다", () => {
  const students = [1, 2, 3, 4, 5, 6];
  const out = R.seatPlan(2, 3, [], [], students);
  assert.equal(out.length, 6);
  assert.deepEqual(plain(out).sort((a, b) => a - b), students);
  // 자리가 남거나 모자라면 무엇을 해야 하는지 알려주며 거절합니다.
  assert.throws(() => R.seatPlan(2, 4, [], [], students), /자리가 2개 많습니다/);
  assert.throws(() => R.seatPlan(2, 2, [], [], students), /학생이 2명 많습니다/);
  assert.throws(() => R.seatPlan(0, 3, [], [], students));
  assert.throws(() => R.seatPlan(13, 1, [], [], students));
});
test("seatPlan: 제외석은 비우고, 남은 자리 수가 학생 수와 맞으면 배치된다", () => {
  const students = [1, 2, 3, 4];
  const out = R.seatPlan(2, 3, [1, 4], [], students);
  assert.equal(out[1], null);
  assert.equal(out[4], null);
  assert.deepEqual(plain(out).filter((n) => n != null).sort((a, b) => a - b), students);
  assert.throws(() => R.seatPlan(2, 3, [99], [], students), /자리 구조에 없습니다/);
});
test("seatPlan: 지정석은 그 번호가 그 자리에 앉고 랜덤 대상에서 빠진다", () => {
  const students = [1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 20; i++) {
    const out = R.seatPlan(2, 3, [], [[0, 3], [5, 1]], students);
    assert.equal(out[0], 3);
    assert.equal(out[5], 1);
    assert.deepEqual(plain(out).sort((a, b) => a - b), students);
  }
});
test("seatPlan: 잘못된 지정석은 이유를 알려주며 거절한다", () => {
  const students = [1, 2, 3, 4];
  assert.throws(() => R.seatPlan(2, 2, [], [[0, 9]], students), /번호 범위에 없거나 궐번/);
  assert.throws(() => R.seatPlan(2, 2, [], [[0, 1], [1, 1]], students), /두 자리에 지정/);
  assert.throws(() => R.seatPlan(2, 3, [0], [[0, 1]], students), /지정석으로 쓸 수 없습니다/);
  assert.throws(() => R.seatPlan(2, 2, [], [[99, 1]], students), /자리 구조에 없습니다/);
});
test("seatPlan: 궐번을 뺀 학생만 배치된다", () => {
  const students = [1, 2, 3, 5, 6, 7]; // 4번이 궐번
  const out = R.seatPlan(2, 3, [], [], students);
  assert.equal(out.includes(4), false);
  assert.deepEqual(plain(out).sort((a, b) => a - b), students);
});
for (const n of [2, 5, 12])
  test(`ladder ${n}: adjacency, bijection, fixed generation`, () => {
    for (let k = 0; k < 100; k++) {
      const b = R.ladder(n),
        paths = Array.from({ length: n }, (_, i) => R.trace(b, i));
      assert.equal(new Set(paths.map((p) => p.end)).size, n);
      for (const r of b.rungs)
        assert(
          !b.rungs.some(
            (q) => q !== r && q.row === r.row && Math.abs(q.col - r.col) <= 1,
          ),
        );
      assert.deepEqual(
        plain(paths),
        plain(Array.from({ length: n }, (_, i) => R.trace(b, i))),
      );
    }
  });
test("ladder bounds", () => {
  for (const n of [1, 13, NaN]) assert.throws(() => R.ladder(n));
});
test("all script blocks parse", () => {
  for (const file of fs.readdirSync(".").filter((f) => f.endsWith(".html"))) {
    for (const m of fs
      .readFileSync(file, "utf8")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      if (m[1].includes("<?")) continue;
      new vm.Script(m[1], { filename: file });
    }
  }
});
test("protected QR/calculator/timer HTML+JS identical to HEAD", () => {
  const old = cp
      .execFileSync("git", ["show", "HEAD:Modals_Convenience.html"], {
        encoding: "utf8",
      })
      .replace(/\r/g, ""),
    now = fs.readFileSync("Modals_Convenience.html", "utf8").replace(/\r/g, "");
  // 두 경계 모두 텍스트 마커가 아니라 실제 구조(요소 id, 유일한 </script> 위치)를 기준으로 잡습니다.
  // 룰렛 등 8개 도구가 Random_Tools.html로 분리된 뒤로는 QR~타이머 뒤에 "룰렛 돌리기" 주석/코드가
  // 더 이상 이 파일에 없어서, 그 문자열로 경계를 찾으면 old/now가 서로 다른 길이로 잘려 항상 실패했습니다.
  for (const s of [old, now])
    assert(
      s.indexOf('<div id="convenienceStepRoulette"') > s.indexOf('<div id="convenienceStepQr"'),
      "convenienceStepQr/Roulette 요소를 찾지 못했습니다.",
    );
  const htmlStart = '      <div id="convenienceStepQr"',
    htmlEnd = '      <div id="convenienceStepRoulette"';
  assert.equal(
    now.slice(now.indexOf(htmlStart), now.indexOf(htmlEnd)),
    old.slice(old.indexOf(htmlStart), old.indexOf(htmlEnd)),
  );
  const jsStart = "  // ===== QR코드 만들기";
  assert.equal(
    now.slice(now.indexOf(jsStart), now.lastIndexOf("</script>")).trim(),
    old.slice(old.indexOf(jsStart), old.lastIndexOf("</script>")).trim(),
  );
});
test("no new external dependencies or API calls", () =>
  assert(!/google\.script\.run|fetch\(|https?:\/\/|<img|base64/.test(source)));
test('participant range + duplicate omissions + excluded range',()=>{
 assert.deepEqual(plain(R.participants(1,8,'2, 2, 4-6')),['1번','3번','7번','8번']);
 assert.equal(R.participants(1,30,'4,8,12-14').length,25);
 for(const args of [[0,4,''],[5,1,''],[1,5,'6'],[1,5,'1-5'],[1,5,'4-2'],[1,201,'']])assert.throws(()=>R.participants(...args));
});
test('numbers exclusions preserve valid pool including negative values',()=>{
 assert.deepEqual([...R.numbers(1,8,4,false,'2,4-6')].sort((a,b)=>a-b),[1,3,7,8]);
 assert.deepEqual([...R.numbers(-3,1,2,false,'-2-0')].sort((a,b)=>a-b),[-3,1]);
 assert.throws(()=>R.numbers(1,3,1,true,'1-3'));
 assert.throws(()=>R.numbers(1,3,3,false,'2'));
});
test('every valid rank maps to exactly one non-omitted number',()=>{
 const original=ctx.crypto;
 try {const values=[];for(let i=0;i<5;i++){ctx.crypto={getRandomValues:a=>{a[0]=i;}};values.push(R.numbers(1,9,1,true,'1,3,4,8')[0]);}
 assert.deepEqual(values,[2,5,6,7,9]);}finally{ctx.crypto=original;}
});
console.log(`${passed} test groups passed`);
