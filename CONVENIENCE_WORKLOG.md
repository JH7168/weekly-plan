# 편의 기능 작업 로그

## 최신 추가 변경 — 반별 / 팀별 대진

- 대진표만 번호 범위 입력을 제거하고 `반별 대진` / `팀별 대진`으로 분리.
- 반별 기본값: 1반~8반 전체 선택. `1반~8반 채우기` 버튼으로 복구, 미참가 반 체크 해제 지원.
- 팀별: 팀명 줄바꿈/쉼표 입력, 2~32팀. 중복 팀명은 혼동 방지를 위해 안내하고 생성 중단.
- 모드 전환으로 기존 대진·결과를 지우지 않으며, 대진 생성 때 기존 확인 절차 유지.
- 승자 진출, 부전승, 재진입 보존과 초기화 동작 유지. 다른 도구는 번호 범위·궐번 방식 유지.

## 최신 추가 변경 — 번호 범위 / 궐번

- 이름 입력을 시작 번호·끝 번호·궐번 설정으로 교체. 순서/룰렛/가위바위보/대진/자리/사다리에 동일 적용.
- 궐번은 `4, 8, 12-14` 형태로 입력하며 중복 궐번은 한 번만 제외. 실제 참가 인원과 번호를 미리 표시.
- 숫자 추첨기도 궐번을 지원하며, 중복 추첨에서도 궐번을 제외. 남은 번호 수 기준으로 개수 검증.
- 사다리의 결과/역할만 직접 입력 유지. 주사위·동전, QR·계산기·타이머는 변경 없음.
- 룰렛 표시는 목록 순번이 아니라 실제 번호. 당첨 번호 제외와 궐번 설정은 분리.
- 아래 기존 이름 기반 DOM 테스트는 번호 범위 입력 기준으로 갱신. 알고리즘 26묶음 + DOM 21묶음.

## 최신 상태 — 2026-09-16 랜덤·추첨 도구 개선

아래의 이전 10종 작업 기록보다 이 절이 우선합니다.

- 랜덤 도구 7개를 개선하고 사다리타기를 추가: 총 11개 카드, 태블릿 4+4+3 / 모바일 2열.
- `Random_Tools.html`: 공통 CSS, 순수 알고리즘 `ClassroomRandom`, 화면 컨트롤러 `ClassroomTools`.
- `Modals_Convenience.html`: 기존 기기 프레임·진입 함수 유지. 랜덤 화면은 빈 컨테이너에서 첫 진입 시 생성하며 세션 입력을 보존.
- `Index.html`: 기존 편의 기능 바로 다음에 새 모듈 포함.
- QR/계산기/타이머 HTML 및 로직은 HEAD 원본과 동일함을 자동 검증. 서버 코드·데이터 형식 변경 없음.
- crypto rejection sampling, Fisher–Yates, 큰 숫자 범위에서도 메모리를 과도하게 사용하지 않는 부분 셔플.
- 룰렛 반복 회전 정렬 / 당첨 제외 / 중복 정리, 순서 복사, 주사위·동전 기록, 가위바위보 그룹·승패, 숫자 정렬.
- 토너먼트 승자 진출 및 하위 경기 결과 무효화, 좌석·빈 좌석 고정, 사다리 실제 SVG 경로와 고정된 일대일 결과.
- 초기화·대진/사다리 재생성은 화면 안 확인·취소. 브라우저 네이티브 confirm은 내장 브라우저에서 응답 문제를 일으켜 사용하지 않음.
- 결과 크게 보기, 입력 검증, HTML 이스케이프, 중복 클릭 잠금, reduced-motion 지원.

### 검증

- `node tests/random-tools.test.cjs`: 23개 알고리즘·구문·보호 코드 테스트 묶음.
- `node tests/random-tools.dom.test.cjs <linkedom 경로>`: 21개 DOM 상호작용 테스트 묶음.
- 테스트 전용 linkedom은 임시 폴더에 설치. 앱 의존성/배포 파일에는 포함하지 않음.
- 실제 테스트 웹앱: 8개 도구 정상 실행, 룰렛 2/20개, 숫자 범위 오류·정렬, 대진 승자 진출, 빈 좌석 고정, 사다리 경로·전체 결과, 초기화 확인·취소 확인.
- 1024×768 태블릿 및 390×844 모바일 화면 점검. QR 생성, 계산기 2+3=5, 타이머 시작·카운트다운·정지 확인.
- QR 파일 다운로드/이미지 복사 및 실물 모바일 기기 테스트는 별도 확인 필요. 운영 일정 데이터의 등록·삭제는 테스트 목적으로 수행하지 않음.

### 사용 한계 / 배포

- 입력은 현재 페이지 세션에서만 유지하며 새로고침하면 초기화. 서버 저장 없음.
- 목록 최대 200개, 대진 32명, 사다리 2~12명, 좌석 행·열 각각 1~12, 주사위/동전 1~6개.
- 전용 인쇄/이미지 내보내기는 추가하지 않음. 결과 크게 보기와 텍스트 복사를 제공.
- 테스트 웹앱에 반영하는 작업이며 운영 최종 배포와 GitHub 업로드는 별도 요청 때 진행.

---

## 이전 10종 구현 기록 (참고용)

시작: 2026-09-16 새벽. 사용자가 자는 동안 최대한 끝까지 진행하는 장시간 작업.
재개 시 이 파일을 먼저 읽고, "다음 작업"부터 이어서 진행할 것.

## 현재 목표
1. 편의 기능 메인 화면(갤럭시 탭 프레임) 완성도 개선
2. 신규 7개 기능(룰렛/랜덤순서/주사위동전/가위바위보/숫자추첨/토너먼트/자리뽑기)을
   placeholder가 아니라 실제 동작하는 클라이언트 전용 기능으로 구현
3. 기존 3개(QR/계산기/타이머)와 디자인·동작 통일
4. 테스트 후 clasp push, 최종 보고

## 파일
- `Modals_Convenience.html` — 편의 기능 모달 전체 (HTML + JS)
- `CSS.html` — `#convenienceMod .convenience-*` 블록 (라인 379 부근부터)
- `Index.html` — 편의 기능 버튼(수정 대상 아님, 참고만)

## 작업 순서 및 진행 상태

- [x] 0. 공통 유틸(escapeHtml, parseListInput, shuffleArray) 추가 — Modals_Convenience.html <script> 상단
- [x] 1. 룰렛 돌리기 (conic-gradient 휠 + 범례 + 스핀 애니메이션) — HTML+JS 완료, CSS 대기
- [x] 2. 랜덤 순서 정하기 (Fisher-Yates 셔플 + 순위 리스트 + 복사) — HTML+JS 완료, CSS 대기
- [x] 3. 주사위/동전 던지기 (모드 전환 + 개수 선택 + 최근 기록) — HTML+JS 완료, CSS 대기
- [x] 4. 가위바위보 추첨 (2명 이상, 2-move 승자 판정, 3-move/동일은 무승부) — HTML+JS 완료, CSS 대기
- [x] 5. 숫자 추첨기 (최소/최대/개수/중복허용) — HTML+JS 완료, CSS 대기
- [x] 6. 토너먼트 대진표 (부전승 균등 분배, 라운드별 시각화) — HTML+JS 완료, CSS 대기
- [x] 7. 자리뽑기 (행×열 그리드, 초과 인원 경고) — HTML+JS 완료, CSS 대기
- [x] 8. openConvenienceTool 라우팅 전면 교체 (soon 화면 완전 제거, CONVENIENCE_TOOL_ELEMENT_ID/RESET 테이블 방식으로 재구성)
- [x] 10. Node 유닛테스트: 계산기/타이머 기존 16개 재확인 통과 + 신규 7개 기능 122개 신규 테스트 전부 통과
      (테스트 파일: scratchpad/new_features_test.js + scratchpad/dom_stub.js, 재사용 가능)
- [x] 9. CSS: 메인 화면 카드(아이콘 38→48px, 행간격 8→14px로 하단 여백 문제 완화) +
      룰렛/셔플/주사위동전/가위바위보/숫자추첨/대진표/자리뽑기 전용 CSS 전부 추가, 모바일 오버라이드도 추가
- [x] 11. clasp push 완료 (오전 1:14, 카드 크기 조정 포함 최종 버전까지 반영됨)
- [x] 12. 최종 보고 작성 완료 — **작업 완료**

## 최종 상태 (2026-09-16 새벽 작업 완료)
- 10개 기능(QR/계산기/타이머 + 룰렛/랜덤순서/주사위동전/가위바위보/숫자추첨/대진표/자리뽑기) 전부 실제 동작.
- 검증: getElementById 참조 45개 전부 실제 HTML id와 일치, onclick 함수 23개 전부 정의 확인,
  Node 유닛테스트 총 138개(계산기·타이머 16개 + 신규 7종 122개) 전부 통과.
- clasp push로 HEAD 테스트 배포까지 반영 완료. GitHub 커밋/운영 배포는 기존 워크플로대로
  사용자 확인 후 진행 예정(아직 안 함).
- 남은 이슈: 실제 브라우저 화면으로 시각적 확인은 못 함(구글 로그인 제약, 매 턴 동일 사유) —
  아침에 사용자가 직접 확인 필요.

## 재개가 필요하다면
- 이 작업은 완료 상태이므로 재개할 필요 없음. 추가 요청이 오면 이 로그를 참고해 시작점으로 삼을 것.
- 테스트 명령: `node scratchpad/calc_timer_test.js scratchpad/conv_script.js` +
  `node scratchpad/new_features_test.js scratchpad/conv_script.js`
  (스크립트 추출: Modals_Convenience.html의 `<script>...</script>` 내용을 conv_script.js로 저장 후 실행)
- 배포 명령: `npx clasp push --force` (weekly-plan 디렉토리에서)

## 지금까지 확인된 사실
- 새 HTML 요소 id 규칙: convenienceStep{Roulette,Shuffle,Dice,Rps,NumberPick,Bracket,Seat}
- 카드 10개 onclick은 모두 openConvenienceTool('roulette'|'shuffle'|'dice'|'rps'|'numberpick'|'bracket'|'seat')로 이미 연결됨(지난 턴에 작업)
- CONVENIENCE_TOOL_RESET 객체가 각 도구의 reset*Tool()을 모아 openConvenienceMod()에서 한 번에 초기화
- 아직 새 도구 전용 CSS 클래스가 정의되어 있지 않음: convenience-textarea, convenience-split(기존 QR용 재사용 가능),
  convenience-roulette-wrap/wheel/pointer, convenience-legend(-item/-dot), convenience-big-result,
  convenience-rank-wrap/list/row/badge/name, convenience-tab-row/tab-btn, convenience-count-row/dice-count-btn,
  convenience-dice-faces/.dice-face/.dice-roll-anim, convenience-coin/.coin-flip-anim, convenience-history(-label),
  convenience-rps-picks/-pick/-emoji, convenience-form-row, convenience-checkbox-row, convenience-number-result/-ball,
  convenience-bracket(-round/-match/vs), convenience-seat-podium/-board/-seat(.is-empty)/-warning, convenience-tool-actions
  → 지금 이 클래스들을 CSS.html의 #convenienceMod 블록에 전부 추가해야 화면이 정상적으로 보임(현재는 스타일 없이 렌더링됨).

## 중단 시 재개 방법
1. 이 파일의 체크박스를 보고 어디까지 됐는지 확인
2. `Modals_Convenience.html`의 `<script>` 블록에서 마지막으로 정의된 함수 확인
3. Node 테스트(`scratchpad/calc_timer_test.js` 및 이번에 추가하는 신규 테스트 파일)를 돌려서
   현재 코드가 깨져있지 않은지 먼저 확인 후 이어서 작업
4. 끝나면 반드시 `npx clasp push --force`로 배포

## 회귀 위험 / 주의
- 기존 QR/계산기/타이머 `<script>` 로직은 절대 수정하지 않는다 (그대로 재사용)
- 모바일 CSS(`@media max-width:640px`)는 카드 마크업이 바뀌면 함께 확인 필요
- 사용자 입력(이름 등)은 전부 `escapeHtml()`로 이스케이프해서 innerHTML에 삽입 (XSS 방지)
