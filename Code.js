// 전역 변수로 선언하여 시트 접근 최적화
const SS = SpreadsheetApp.getActiveSpreadsheet();
const TZ = "GMT+9";

// 한영고 로고 파비콘 주소: GitHub 저장소(logo.png)를 jsDelivr CDN으로 서빙 (.png 확장자·정확한 content-type).
const FAVICON_URL = 'https://cdn.jsdelivr.net/gh/JH7168/weekly-plan@main/logo2.png';

// --- 시트 조회 캐싱 (여러 교사가 동시에 같은 시트를 반복 조회할 때 매번 전체를 다시 읽지 않도록) ---
// CacheService는 스크립트 단위로 공유되어(모든 사용자 공통) 여기서 캐싱하면 실제 체감 효과가 큽니다.
// Date 셀은 JSON으로 오가면서 문자열로 바뀌어버리므로, replacer/reviver로 감싸서 Date를 그대로 복원합니다.
function getCachedSheetValues_(sheetName, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sheetvals_' + sheetName;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached, (key, value) => {
        if (value && typeof value === 'object' && value.__isDate) return new Date(value.iso);
        return value;
      });
    } catch (e) {
      // 캐시가 손상됐으면 무시하고 시트에서 새로 읽습니다.
    }
  }

  const sheet = SS.getSheetByName(sheetName);
  const values = sheet ? sheet.getDataRange().getValues() : [];
  try {
    const json = JSON.stringify(values, function (key, value) {
      // JSON.stringify는 Date를 만나면 이미 toISOString()으로 바꿔서 value로 넘기므로,
      // 원본이 Date였는지는 this[key](변환 전 원본 값)로 확인해야 합니다.
      if (this[key] instanceof Date) return { __isDate: true, iso: this[key].toISOString() };
      return value;
    });
    cache.put(cacheKey, json, ttlSeconds);
  } catch (e) {
    // 100KB 제한 초과 등으로 캐싱 자체가 실패해도 조회 결과는 그대로 반환합니다.
    console.error('시트 캐시 저장 실패(' + sheetName + '): ' + e.toString());
  }
  return values;
}

function invalidateSheetCache_(sheetName) {
  CacheService.getScriptCache().remove('sheetvals_' + sheetName);
}

// 사용자가 입력한 텍스트를 HTML에 그대로 끼워 넣기 전에 이스케이프합니다. (저장형 XSS 방지)
// 전달사항/부서 업무 내용은 시트에 저장된 원본 그대로(줄바꿈 포함) 화면에 표시되므로,
// 화면에 보여주기 직전(getCombinedData)에만 이스케이프해 저장 데이터 자체는 원문을 유지합니다.
function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 사람이 시트를 직접 수정하면(예: 학사일정표에서 일정 이동) 해당 시트 캐시를 즉시 비워
// 앱에 바로 반영되도록 합니다. (단순 onEdit 트리거는 수동 편집 시 자동 실행됩니다.)
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const name = e.range.getSheet().getName();
    invalidateSheetCache_(name);
    // 전체시간표는 별도 캐시 키를 쓰므로 함께 비워줍니다.
    if (name === '전체시간표') CacheService.getScriptCache().remove('timetable_values_bgs');
  } catch (err) {
    // 편집 자체를 방해하지 않도록 오류는 조용히 무시합니다.
  }
}

// 캐시를 즉시 전부 비웁니다. (편집기에서 수동 실행하면 변경 사항을 곧바로 반영시킬 수 있습니다.)
function refreshCaches() {
  ['학사일정표', 'Notice', 'Data', '시청각실예약'].forEach(invalidateSheetCache_);
  CacheService.getScriptCache().remove('timetable_values_bgs'); // 전체 시간표 캐시도 함께 비웁니다.
  return '캐시를 모두 비웠습니다.';
}

// --- 관리자 자료실 (서식/학교생활기록부 자료 업로드·다운로드) ---
const ADMIN_PASSWORD = 'HY4312';
const MATERIALS_FOLDER_NAME = '주간계획서_자료실';
const SCHEDULE_ATTACHMENTS_FOLDER_NAME = '주간계획서_일정첨부';
const SCHEDULE_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024;
const SCHEDULE_ATTACHMENT_EXTENSIONS = [
  'hwp', 'hwpx', 'xls', 'xlsx', 'xlsm', 'csv',
  'doc', 'docx', 'ppt', 'pptx', 'pdf', 'txt', 'zip',
  'jpg', 'jpeg', 'png', 'gif'
];

function verifyAdminPassword(pw) {
  return pw === ADMIN_PASSWORD;
}

const STUDENT_COUNT_PROPERTY = 'student_count_status';
const STUDENT_COUNT_HISTORY_PROPERTY = 'student_count_history';

function normalizeStudentCountEntry_(data) {
  data = data || {};
  const grade1 = Math.max(0, parseInt(data.grade1 != null ? data.grade1 : (data.g1 != null ? data.g1 : data.grade1Count), 10) || 0);
  const grade2 = Math.max(0, parseInt(data.grade2 != null ? data.grade2 : (data.g2 != null ? data.g2 : data.grade2Count), 10) || 0);
  const grade3 = Math.max(0, parseInt(data.grade3 != null ? data.grade3 : (data.g3 != null ? data.g3 : data.grade3Count), 10) || 0);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) ? String(data.date) : '';
  return {
    date: date,
    dateLabel: date ? date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1. $2. $3.') : '',
    grade1: grade1,
    grade2: grade2,
    grade3: grade3,
    total: grade1 + grade2 + grade3,
    savedAt: String(data.savedAt || ''),
    id: String(data.id || data.savedAt || [date, grade1, grade2, grade3].join('_'))
  };
}

function getStudentCountHistory_() {
  const props = PropertiesService.getScriptProperties();
  let history = [];
  try {
    const stored = JSON.parse(props.getProperty(STUDENT_COUNT_HISTORY_PROPERTY) || '[]');
    if (Array.isArray(stored)) history = stored.map(normalizeStudentCountEntry_).filter(item => item.date);
  } catch (e) {}
  // 첫 버전의 단일 현황도 항상 병합하여 이력 저장 방식 전환 중 누락되지 않게 합니다.
  try {
    const legacy = normalizeStudentCountEntry_(JSON.parse(props.getProperty(STUDENT_COUNT_PROPERTY) || '{}'));
    const alreadyIncluded = history.some(item =>
      item.date === legacy.date && item.grade1 === legacy.grade1 && item.grade2 === legacy.grade2 && item.grade3 === legacy.grade3
    );
    if (legacy.date && !alreadyIncluded) history.push(legacy);
  } catch (e) {}
  return history;
}

function getStudentCountStatus() {
  const history = getStudentCountHistory_();
  // 최신 항목을 복사한 뒤 이력을 붙여 순환 참조로 최신 행이 누락되지 않게 합니다.
  const latest = history.length ? Object.assign({}, history[history.length - 1]) : normalizeStudentCountEntry_({});
  latest.history = history.slice().reverse();
  return latest;
}

function saveStudentCountStatus(pw, payload) {
  if (!verifyAdminPassword(String(pw || ''))) return { success: false, message: '관리자 비밀번호가 올바르지 않습니다.' };
  payload = payload || {};
  const date = String(payload.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, message: '기준일을 정확히 입력해주세요.' };
  const values = [payload.grade1, payload.grade2, payload.grade3].map(value => Number(value));
  if (values.some(value => !Number.isInteger(value) || value < 0)) {
    return { success: false, message: '학년별 인원은 0명 이상의 정수로 입력해주세요.' };
  }
  const entryId = String(payload.entryId || '').trim();
  const entry = {
    id: entryId || Utilities.getUuid(), date: date,
    grade1: values[0], grade2: values[1], grade3: values[2], savedAt: new Date().toISOString()
  };
  const history = getStudentCountHistory_();
  if (entryId) {
    const editIndex = history.findIndex(item => item.id === entryId);
    if (editIndex < 0) return { success: false, message: '수정할 이력을 찾지 못했습니다. 화면을 다시 열어주세요.' };
    entry.savedAt = history[editIndex].savedAt || entry.savedAt;
    history[editIndex] = entry;
  } else {
    history.push(entry);
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(STUDENT_COUNT_HISTORY_PROPERTY, JSON.stringify(history.slice(-100)));
  props.setProperty(STUDENT_COUNT_PROPERTY, JSON.stringify(history[history.length - 1]));
  return { success: true, data: getStudentCountStatus() };
}

function deleteStudentCountStatus(pw, entryId) {
  if (!verifyAdminPassword(String(pw || ''))) return { success: false, message: '관리자 비밀번호가 올바르지 않습니다.' };
  entryId = String(entryId || '').trim();
  const history = getStudentCountHistory_();
  const next = history.filter(item => item.id !== entryId);
  if (next.length === history.length) return { success: false, message: '삭제할 이력을 찾지 못했습니다.' };
  const props = PropertiesService.getScriptProperties();
  props.setProperty(STUDENT_COUNT_HISTORY_PROPERTY, JSON.stringify(next));
  if (next.length) props.setProperty(STUDENT_COUNT_PROPERTY, JSON.stringify(next[next.length - 1]));
  else props.deleteProperty(STUDENT_COUNT_PROPERTY);
  return { success: true, data: getStudentCountStatus() };
}

// 교사별 시간표 조회(개인용 조회 도구)를 가볍게 잠그는 비밀번호. 실제 관리자 권한과는 무관합니다.
const LOOKUP_PASSWORD = 'PY4312';

function verifyLookupPassword(pw) {
  return pw === LOOKUP_PASSWORD;
}

function getMaterialsFolder_() {
  const folders = DriveApp.getFoldersByName(MATERIALS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(MATERIALS_FOLDER_NAME);
}

// 각 자료 슬롯의 업로드 여부/파일명만 가볍게 내려줍니다 (다운로드 화면·관리자 화면 공용).
function getMaterialsStatus() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const result = {};
  Object.keys(props).forEach(key => {
    if (key.indexOf('material_') !== 0) return;
    try {
      const data = JSON.parse(props[key]);
      result[key.substring('material_'.length)] = { fileName: data.fileName };
    } catch (e) {
      // 손상된 값은 무시합니다.
    }
  });
  return result;
}

// --- 급식 식단 (NEIS 나이스 급식식단정보 오픈API) ---
// 한영고등학교(전남 여수) 기준. 인증키 없이는 조회가 막혀 있어 발급받은 키를 사용합니다.
const NEIS_KEY = '84a9408cb89e4077b87574fd8606dd52';
const NEIS_ATPT = 'Q10';        // 전남교육청
const NEIS_SCHUL = '7140217';   // 한영고등학교

// NEIS에서 from~to 기간의 급식을 가져와 { 'yyyyMMdd': { '중식':[...], '석식':[...] } } 형태로 반환합니다.
// 알레르기 번호(괄호)는 제거하고 메뉴 이름만 남깁니다. 하루치는 자주 안 바뀌므로 캐시로 호출을 줄입니다.
function fetchMeals_(fromYmd, toYmd) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'meals_' + fromYmd + '_' + toYmd;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = 'https://open.neis.go.kr/hub/mealServiceDietInfo'
    + '?KEY=' + NEIS_KEY + '&Type=json'
    + '&ATPT_OFCDC_SC_CODE=' + NEIS_ATPT
    + '&SD_SCHUL_CODE=' + NEIS_SCHUL
    + '&MLSV_FROM_YMD=' + fromYmd + '&MLSV_TO_YMD=' + toYmd
    + '&pSize=100';

  const out = {};
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    const rows = json.mealServiceDietInfo[1].row; // 데이터 없으면 여기서 예외 → 빈 객체 반환
    rows.forEach(r => {
      const ymd = r.MLSV_YMD;
      const meal = r.MMEAL_SC_NM; // 조식/중식/석식
      const items = String(r.DDISH_NM)
        .split(/<br\s*\/?>/i)
        .map(s => s.replace(/\([0-9.\s]*\)/g, '').trim()) // 알레르기 번호 제거
        .filter(s => s.length);
      if (!out[ymd]) out[ymd] = {};
      out[ymd][meal] = items;
    });
  } catch (e) {
    // 데이터가 없거나 조회 실패 시 빈 결과로 처리합니다.
  }

  cache.put(cacheKey, JSON.stringify(out), 6 * 60 * 60); // 6시간 캐시
  return out;
}

// '8. 25.(화) 점심' 형식의 라벨을 만듭니다. (년도 제외, 중식=점심 / 석식=저녁)
function mealLabel_(dateObj, meal) {
  const m = Number(Utilities.formatDate(dateObj, TZ, 'M'));
  const day = Number(Utilities.formatDate(dateObj, TZ, 'd'));
  const wkArr = ['월', '화', '수', '목', '금', '토', '일']; // 'u': 1=월 ~ 7=일
  const wk = wkArr[Number(Utilities.formatDate(dateObj, TZ, 'u')) - 1];
  const kind = (meal === '중식') ? '점심' : '저녁';
  return '<' + m + '. ' + day + '.(' + wk + ') ' + kind + '>';
}

// NEIS 학사일정에서 from~to 기간의 공휴일을 { 'yyyyMMdd': '공휴일명' } 으로 반환합니다.
function fetchHolidays_(fromYmd, toYmd) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'holiday_' + fromYmd + '_' + toYmd;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = 'https://open.neis.go.kr/hub/SchoolSchedule'
    + '?KEY=' + NEIS_KEY + '&Type=json'
    + '&ATPT_OFCDC_SC_CODE=' + NEIS_ATPT
    + '&SD_SCHUL_CODE=' + NEIS_SCHUL
    + '&AA_FROM_YMD=' + fromYmd + '&AA_TO_YMD=' + toYmd
    + '&pSize=100';

  const out = {};
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    const rows = json.SchoolSchedule[1].row;
    rows.forEach(r => {
      // SBTR_DD_SC_NM === '공휴일' 인 날만 공휴일로 취급합니다. (방학·재량휴업일 등은 제외)
      if (r.SBTR_DD_SC_NM === '공휴일') out[r.AA_YMD] = r.EVENT_NM || '공휴일';
    });
  } catch (e) {
    // 데이터 없거나 실패 시 빈 결과.
  }

  cache.put(cacheKey, JSON.stringify(out), 6 * 60 * 60);
  return out;
}

// 결보강 계획서에서 날짜 추천/선택 시 공휴일을 자동으로 제외하기 위해 fetchHolidays_를 그대로 공개합니다.
// from/to는 'yyyyMMdd' 형식입니다. (급식 카드가 쓰는 형식과 동일)
function getHolidaysInRange(fromYmd, toYmd) {
  return fetchHolidays_(fromYmd, toYmd);
}

// 토/일 여부 ('u': 6=토, 7=일)
function isWeekend_(d) {
  const u = Number(Utilities.formatDate(d, TZ, 'u'));
  return u === 6 || u === 7;
}
// 주어진 날짜가 주말이면 다음 평일(월)로 밀어 반환합니다. (공휴일은 밀지 않음 → '공휴일'로 표시)
function schoolDayOnOrAfter_(d) {
  let x = new Date(d.getTime());
  while (isWeekend_(x)) x = new Date(x.getTime() + 24 * 60 * 60 * 1000);
  return x;
}
// 주어진 날짜 '이후' 첫 평일을 반환합니다. (금요일의 다음 등교일 = 월요일)
function nextSchoolDay_(d) {
  let x = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  while (isWeekend_(x)) x = new Date(x.getTime() + 24 * 60 * 60 * 1000);
  return x;
}

// 현재 시각(한국시간) 기준으로 점심/저녁 두 카드를 반환합니다.
//  - 13:00 이전 : [오늘 점심, 오늘 저녁]
//  - 13:00~18:15: [오늘 저녁, 다음 등교일 점심]
//  - 18:15 이후 : [다음 등교일 점심, 다음 등교일 저녁]
//  주말은 건너뛰어 다음 등교일(예: 금요일 → 월요일)을 사용합니다.
//  각 카드: { label, items:[...], status:'ok'|'holiday'|'none', holidayName }
function getMealCards() {
  const now = new Date();
  let hm = Number(Utilities.formatDate(now, TZ, 'HHmm')); // 예: 1330
  if (isWeekend_(now)) hm = 0; // 주말에 열면 다음 등교일의 점심/저녁을 보여줍니다.

  const date0 = schoolDayOnOrAfter_(now); // 오늘(평일) 또는 다음 등교일
  const date1 = nextSchoolDay_(date0);    // date0 다음 등교일

  let slots;
  if (hm < 1300) {
    slots = [{ date: date0, meal: '중식' }, { date: date0, meal: '석식' }];
  } else if (hm < 1815) {
    slots = [{ date: date0, meal: '석식' }, { date: date1, meal: '중식' }];
  } else {
    slots = [{ date: date1, meal: '중식' }, { date: date1, meal: '석식' }];
  }

  const ymds = slots.map(s => Utilities.formatDate(s.date, TZ, 'yyyyMMdd'));
  const sorted = ymds.slice().sort();
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  const meals = fetchMeals_(from, to);
  const holidays = fetchHolidays_(from, to);

  return slots.map((s, i) => {
    const ymd = ymds[i];
    const items = (meals[ymd] && meals[ymd][s.meal]) ? meals[ymd][s.meal] : [];
    let status = 'ok', holidayName = '';
    if (items.length === 0) {
      if (holidays[ymd]) { status = 'holiday'; holidayName = holidays[ymd]; }
      else { status = 'none'; }
    }
    return {
      label: mealLabel_(s.date, s.meal), dateKey: ymd, meal: s.meal,
      items: items, status: status, holidayName: holidayName
    };
  });
}

// 현재 끼니부터 '앞으로' count개의 끼니(점심→저녁→다음 등교일 점심…)를 반환합니다.
// 시작점이 항상 '지금 보여줄 한 끼'라서, 지난 날짜/지난 끼니(예: 저녁 시간대의 오늘 점심)는 자연히 빠집니다.
function getUpcomingMealCards(count) {
  count = Math.max(1, Math.min(30, Number(count) || 14));
  const now = new Date();
  let hm = Number(Utilities.formatDate(now, TZ, 'HHmm'));
  if (isWeekend_(now)) hm = 0;

  const date0 = schoolDayOnOrAfter_(now);
  const date1 = nextSchoolDay_(date0);
  let d, meal;
  if (hm < 1300) { d = date0; meal = '중식'; }
  else if (hm < 1815) { d = date0; meal = '석식'; }
  else { d = date1; meal = '중식'; }

  const slots = [];
  let cur = new Date(d);
  for (let i = 0; i < count; i++) {
    slots.push({ date: new Date(cur), meal: meal });
    if (meal === '중식') { meal = '석식'; }
    else { meal = '중식'; cur = nextSchoolDay_(cur); }
  }

  const ymds = slots.map(s => Utilities.formatDate(s.date, TZ, 'yyyyMMdd'));
  const from = ymds[0], to = ymds[ymds.length - 1];
  const meals = fetchMeals_(from, to);
  const holidays = fetchHolidays_(from, to);

  return slots.map((s, i) => {
    const ymd = ymds[i];
    const items = (meals[ymd] && meals[ymd][s.meal]) ? meals[ymd][s.meal] : [];
    let status = 'ok', holidayName = '';
    if (items.length === 0) {
      if (holidays[ymd]) { status = 'holiday'; holidayName = holidays[ymd]; }
      else { status = 'none'; }
    }
    return {
      label: mealLabel_(s.date, s.meal), dateKey: ymd, meal: s.meal,
      items: items, status: status, holidayName: holidayName
    };
  });
}

// slotKey에 해당하는 파일을 Drive에 저장하고, 기존 파일이 있으면 휴지통으로 보냅니다.
function uploadMaterial(slotKey, base64Data, fileName, mimeType) {
  try {
    const props = PropertiesService.getScriptProperties();
    const existingRaw = props.getProperty('material_' + slotKey);

    const folder = getMaterialsFolder_();
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = folder.createFile(blob);

    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        DriveApp.getFileById(existing.fileId).setTrashed(true);
      } catch (e) {
        // 기존 파일을 찾지 못해도 새 파일 업로드는 그대로 진행합니다.
      }
    }

    props.setProperty('material_' + slotKey, JSON.stringify({ fileId: file.getId(), fileName: fileName }));
    return { success: true, fileName: fileName };
  } catch (e) {
    console.error('자료 업로드 오류: ' + e.toString());
    return { success: false, message: e.message || e.toString() };
  }
}

function deleteMaterial(slotKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('material_' + slotKey);
    if (raw) {
      const data = JSON.parse(raw);
      try { DriveApp.getFileById(data.fileId).setTrashed(true); } catch (e) {}
      props.deleteProperty('material_' + slotKey);
    }
    return true;
  } catch (e) {
    console.error('자료 삭제 오류: ' + e.toString());
    return false;
  }
}

// 다운로드 시 파일 내용을 base64로 인코딩해 반환합니다 (Drive 공유 설정 없이 앱 안에서만 내려받도록).
function getMaterialContent(slotKey) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('material_' + slotKey);
    if (!raw) return { success: false };
    const data = JSON.parse(raw);
    const file = DriveApp.getFileById(data.fileId);
    const blob = file.getBlob();
    return {
      success: true,
      fileName: data.fileName,
      mimeType: blob.getContentType(),
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    console.error('자료 다운로드 오류: ' + e.toString());
    return { success: false };
  }
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  const now = new Date();

  // 한영고 로고 아이콘(파비콘) 주소. setFaviconUrl은 .png 등 실제 이미지 확장자 주소만 받으므로
  // GitHub 저장소의 로고를 CDN(jsDelivr)으로 서빙합니다. (모든 사용자 공통)
  const faviconUrl = FAVICON_URL;
  template.faviconUrl = faviconUrl; // Index.html 홈화면/아이콘 링크에 사용

  // 초기 UI 구성에 필요한 최소 데이터만 전달 (속도 향상의 핵심)
  template.initialData = {
    deptList: getDeptList(),
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1
  };

  const output = template.evaluate()
      .setTitle('주간 계획서')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // 브라우저 탭/북마크/바탕화면 바로가기 아이콘을 한영고 로고로 (모든 사용자 공통).
  // 파비콘 주소가 잘못되어도 앱 자체는 반드시 정상 로드되도록 예외를 삼킵니다.
  try {
    if (faviconUrl) output.setFaviconUrl(faviconUrl);
  } catch (e) {
    console.error('파비콘 설정 실패(앱 로드에는 영향 없음): ' + e);
  }

  return output;
}

// 한 주(월~금 5일) 중 수요일이 속한 달을 그 주의 '소속 달'로 봅니다. (클라이언트 upWeeks()와 동일한 규칙)
// 예: 6/29(월)~7/3(금) 주는 수요일이 7/1이라 "7월 1주차"가 됩니다.
function getWeekMondaysForMonth_(year, month) {
  // 클라이언트에서 문자열로 넘어올 수 있어(예: "2026"), 아래 getFullYear()와의 엄격 비교(===)가
  // 항상 실패하지 않도록 숫자로 명시 변환합니다.
  year = Number(year);
  month = Number(month);
  const mondays = [];
  let probe = new Date(year, month - 1, 1);
  probe.setDate(probe.getDate() - 10);
  for (let i = 0; i < 60; i++) {
    if (probe.getDay() === 1) {
      const wed = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate() + 2);
      if (wed.getFullYear() === year && wed.getMonth() === month - 1) {
        mondays.push(new Date(probe.getFullYear(), probe.getMonth(), probe.getDate()));
      }
    }
    probe.setDate(probe.getDate() + 1);
  }
  return mondays;
}

// 연간행사(학사일정표) 항목에 붙는 '세부 내용'을 저장할 때 쓰는 예약 부서명입니다.
// 이 부서명으로 Data 시트에 저장된 행은 부서 업무 목록에는 나오지 않고, 학사일정표의 '명칭'(작성자 열)과
// 매칭해 연간행사 팝업의 상세/전달사항/첨부/링크로만 사용됩니다. (부서 업무와 동일한 코드 재사용)
const ANNUAL_DEPT_ = '__연간행사__';

// 한 주(월요일 시작)에 대한 연간 행사/부서별 업무를 계산합니다.
// getCombinedData(주간 조회, 모바일용)와 getMonthlyCombinedData(월간 조회, PC용)가 공통으로 사용합니다.
function buildWeekResult_(weekStart, schMap, datVals) {
  weekStart = new Date(weekStart);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23, 59, 59, 999);
  const sTime = weekStart.getTime();
  const eTime = weekEnd.getTime();

  const daysArr = ["일", "월", "화", "수", "목", "금", "토"];
  const schedule = [];
  for (let i = 0; i < 5; i++) {
    const cur = new Date(weekStart);
    cur.setDate(weekStart.getDate() + i);
    schedule.push({
      date: (cur.getMonth()+1)+"/"+cur.getDate()+"("+daysArr[cur.getDay()]+")",
      content: schMap.get(Utilities.formatDate(cur, TZ, "yyyyMMdd")) || ""
    });
  }

  const deptMap = {};
  const annualDetails = []; // 연간행사(학사일정표 명칭)에 붙는 세부: {name, st, et, text, attachments, links, rowNum}
  datVals.forEach((r, dataIdx) => {
    if (!(r[1] instanceof Date) || !(r[2] instanceof Date)) return;
    const st = r[1].getTime();
    const et = r[2].getTime();
    if (st <= eTime && et >= sTime) {
      if (r[0] === ANNUAL_DEPT_) {
        // 연간행사 세부: 명칭은 col5(author)에 저장해 학사일정표 명칭과 매칭합니다.
        annualDetails.push({
          name: String(r[4] || ''), st: st, et: et,
          text: escapeHtml_(r[3]), rawText: String(r[3] || ''),
          attachments: parseScheduleAttachments_(r[6]), links: parseScheduleLinks_(r[7]), rowNum: dataIdx + 2
        });
        return; // 부서 업무 목록에는 넣지 않습니다.
      }
      if (!deptMap[r[0]]) deptMap[r[0]] = [];
      deptMap[r[0]].push({
        date: formatSimple(r[1], r[2]), time: st, st: st, et: et,
        text: escapeHtml_(r[3]), grades: r[5] || '',
        attachments: parseScheduleAttachments_(r[6]), links: parseScheduleLinks_(r[7]), rowNum: dataIdx + 2
      });
    }
  });
  const list = Object.keys(deptMap).map(name => {
    const items = deptMap[name].sort((a,b) => a.time - b.time);
    return { name, items, first: items[0].time };
  }).sort((a,b) => {
    const oa = deptOrderIndex_(a.name), ob = deptOrderIndex_(b.name);
    if (oa !== ob) return oa - ob;
    return a.first - b.first;
  });

  return {
    schedule, list, annualDetails, sTime, eTime,
    rangeText: Utilities.formatDate(weekStart, TZ, "yyyy-MM-dd") + " ~ " + Utilities.formatDate(weekEnd, TZ, "yyyy-MM-dd")
  };
}

// 화면에 필요한 학사일정표/Data 두 시트만 읽습니다. (별도 전달사항 영역 제거로 Notice 조회 제외)
function readScheduleSheets_() {
  // 여러 사용자가 짧은 시간에 같은 주/달을 반복 조회하는 경우가 많아 캐시로 재요청을 줄입니다.
  const rawSchVals = getCachedSheetValues_("학사일정표", 600);
  const schVals = rawSchVals.length > 1 ? rawSchVals.slice(1) : [];
  const rawDatVals = getCachedSheetValues_("Data", 1800);
  const datVals = rawDatVals.length > 1 ? rawDatVals.slice(1) : [];

  const schMap = new Map();
  schVals.forEach(r => {
    if (r[0] instanceof Date) schMap.set(Utilities.formatDate(r[0], TZ, "yyyyMMdd"), r[1]);
  });

  return { schMap, datVals };
}

function getScheduleAttachmentsFolder_() {
  const folders = DriveApp.getFoldersByName(SCHEDULE_ATTACHMENTS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(SCHEDULE_ATTACHMENTS_FOLDER_NAME);
}

function parseScheduleAttachments_(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const list = Array.isArray(data) ? data : [data]; // 기존 단일 첨부 JSON도 계속 지원합니다.
    return list.filter(item => item && item.fileId && item.fileName).map(item => ({
      fileId: String(item.fileId),
      fileName: String(item.fileName),
      mimeType: String(item.mimeType || ''),
      // 예전 첨부에는 권한 값이 없으므로 기존 동작(둘 다 허용)을 유지합니다.
      allowView: item.allowView === undefined ? true : item.allowView === true,
      allowDownload: item.allowDownload === undefined ? true : item.allowDownload === true
    }));
  } catch (e) {
    return [];
  }
}

// 일정 링크(이름+주소)를 안전하게 파싱합니다. http/https 주소만 허용합니다.
function parseScheduleLinks_(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const list = Array.isArray(data) ? data : [data];
    return list.filter(item => item && item.url).map(item => {
      const url = String(item.url).trim();
      const name = String(item.name || '').trim() || url;
      return { name: name, url: url };
    }).filter(item => /^https?:\/\//i.test(item.url));
  } catch (e) {
    return [];
  }
}

// 저장용: 클라이언트가 보낸 링크 배열을 정제해 JSON 문자열로 만듭니다.(http/https만, 최대 20개)
function buildScheduleLinksJson_(links) {
  const list = Array.isArray(links) ? links : [];
  const clean = list.map(item => {
    const url = String((item && item.url) || '').trim();
    let name = String((item && item.name) || '').trim();
    if (!name) name = url;
    return { name: name.slice(0, 100), url: url };
  }).filter(item => /^https?:\/\//i.test(item.url)).slice(0, 20);
  return clean.length ? JSON.stringify(clean) : '';
}

function scheduleFileExtension_(name) {
  const match = String(name || '').trim().match(/\.([^.\\/]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function buildScheduleDownloadName_(displayName, originalName) {
  const original = String(originalName || '').trim();
  const originalExt = scheduleFileExtension_(original);
  if (!originalExt || SCHEDULE_ATTACHMENT_EXTENSIONS.indexOf(originalExt) === -1) {
    throw new Error('지원하지 않는 파일 형식입니다. 한글, Excel, Word, PDF, 이미지 파일 등을 올려주세요.');
  }
  let name = String(displayName || '').trim() || original;
  name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '');
  if (!name) name = original;
  const requestedExt = scheduleFileExtension_(name);
  if (!requestedExt) name += '.' + originalExt;
  else if (requestedExt !== originalExt) throw new Error('파일 확장자는 원본과 같아야 합니다: .' + originalExt);
  return name;
}

function createScheduleAttachment_(payload) {
  if (!payload || !payload.base64 || !payload.originalName) return null;
  const estimatedBytes = Math.floor(String(payload.base64).length * 3 / 4);
  if (estimatedBytes > SCHEDULE_ATTACHMENT_MAX_BYTES) throw new Error('첨부파일은 30MB 이하로 올려주세요.');
  const fileName = buildScheduleDownloadName_(payload.displayName, payload.originalName);
  const mimeType = String(payload.mimeType || 'application/octet-stream');
  const bytes = Utilities.base64Decode(payload.base64);
  if (bytes.length > SCHEDULE_ATTACHMENT_MAX_BYTES) throw new Error('첨부파일은 30MB 이하로 올려주세요.');
  const file = getScheduleAttachmentsFolder_().createFile(Utilities.newBlob(bytes, mimeType, fileName));
  return {
    fileId: file.getId(), fileName: fileName, mimeType: mimeType,
    allowView: payload.allowView === true,
    allowDownload: payload.allowDownload !== false
  };
}

function createScheduleAttachments_(payloads) {
  const list = Array.isArray(payloads) ? payloads : (payloads ? [payloads] : []);
  const totalEstimated = list.reduce((sum, item) => sum + Math.floor(String(item && item.base64 || '').length * 3 / 4), 0);
  if (totalEstimated > SCHEDULE_ATTACHMENT_MAX_BYTES) throw new Error('첨부파일 전체 용량은 30MB 이하로 올려주세요.');
  const created = [];
  try {
    list.forEach(payload => {
      const attachment = createScheduleAttachment_(payload);
      if (attachment) created.push(attachment);
    });
    return created;
  } catch (e) {
    created.forEach(item => { try { DriveApp.getFileById(item.fileId).setTrashed(true); } catch (cleanupErr) {} });
    throw e;
  }
}

function trashScheduleAttachmentIfUnused_(fileId) {
  if (!fileId) return;
  const sheet = SS.getSheetByName('Data');
  if (sheet && sheet.getLastRow() >= 2 && sheet.getLastColumn() >= 7) {
    const refs = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues().flat();
    const stillUsed = refs.some(raw => {
      return parseScheduleAttachments_(raw).some(data => data.fileId === fileId);
    });
    if (stillUsed) return;
  }
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
}

/**
 * 데이터 통합 조회 - 한 주(모바일 조회 화면에서 사용)
 */
function getCombinedData(year, month, week) {
  // 클라이언트 <select>의 value는 문자열로 넘어오므로(예: "2026"), 이후 계산이 꼬이지 않도록 숫자로 변환합니다.
  year = Number(year);
  month = Number(month);
  week = Number(week);

  const mondays = getWeekMondaysForMonth_(year, month);
  const weekStart = mondays[week - 1] || mondays[0] || new Date(year, month - 1, 1);

  const { schMap, datVals } = readScheduleSheets_();
  const wr = buildWeekResult_(weekStart, schMap, datVals);

  return { schedule: wr.schedule, list: wr.list, annualDetails: wr.annualDetails, sTime: wr.sTime, rangeText: wr.rangeText };
}

// getWeekMondaysForMonth_는 "그 주 수요일이 속한 달"을 기준으로 주차를 정확히 한 달에만 배정합니다
// (등록/수정 화면의 "N월 M주차" 표기용). 하지만 달력 화면은 그렇게 딱 자르면 8/31(월)~9/4(금) 같은 경계
// 주간이 8월/9월 어느 쪽에도 하루씩 걸쳐 있는데 한쪽 달에서만 보이는 문제가 있습니다.
// 이 함수는 대신 "그 주(월~금)가 이 달과 하루라도 겹치면" 포함시켜, 8월 달력에도 9월 달력에도
// 8/31~9/4 주가 함께 보이도록 합니다(달력 화면 전용, 주차 번호 매기기에는 쓰지 않습니다).
function getOverlappingWeekMondays_(year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999); // 그 달의 마지막 날 23:59:59.999

  // 이 달 1일이 속한 주의 월요일부터 탐색을 시작합니다.
  const probe = new Date(monthStart);
  const day = probe.getDay(); // 0=일, 1=월, ... 6=토
  const diffToMonday = (day === 0) ? -6 : (1 - day);
  probe.setDate(probe.getDate() + diffToMonday);
  probe.setHours(0, 0, 0, 0);

  const mondays = [];
  for (let i = 0; i < 8; i++) { // 한 달이 걸칠 수 있는 최대 주차 수보다 넉넉하게
    if (probe.getTime() > monthEnd.getTime()) break;
    const friEnd = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate() + 4, 23, 59, 59, 999);
    if (friEnd.getTime() >= monthStart.getTime()) mondays.push(new Date(probe));
    probe.setDate(probe.getDate() + 7);
  }
  return mondays;
}

/**
 * 데이터 통합 조회 - 한 달(PC 조회 화면에서 사용). 그 달과 하루라도 겹치는 주차들을 전부 계산해
 * 배열로 내려줍니다(8/31(월)~9/4(금) 같은 경계 주간은 8월/9월 달력 모두에 나타납니다).
 */
function getMonthlyCombinedData(year, month) {
  year = Number(year);
  month = Number(month);

  const mondays = getOverlappingWeekMondays_(year, month);
  // 첫 화면의 '전주·이번주·다음주' 3주 표시가 달 경계에서도 되도록, 그 달 주차들의 앞뒤에 인접 주 1개씩 더 포함합니다.
  // (예: 9월 1주차가 8/31~9/4일 때, 그 앞의 8월 4주차(8/24~)도 함께 내려줍니다.)
  if (mondays.length > 0) {
    const prevMon = new Date(mondays[0]); prevMon.setDate(prevMon.getDate() - 7); mondays.unshift(prevMon);
    const nextMon = new Date(mondays[mondays.length - 1]); nextMon.setDate(nextMon.getDate() + 7); mondays.push(nextMon);
  }
  const { schMap, datVals } = readScheduleSheets_();

  const weeks = mondays.map(weekStart => {
    const wr = buildWeekResult_(weekStart, schMap, datVals);
    // 이 주가 "진짜 소속된" 달/주차 번호를 구합니다(수요일 기준 — 등록/수정 화면과 같은 규칙).
    // 지금 보고 있는 달(month)과 다를 수 있습니다: 예) 8월 달력에 곁다리로 보이는 8/31~9/4 주는
    // 실제로는 "9월 1주차"이므로, 화면에도 "8월 n주차"가 아니라 "9월 1주차"로 표시되어야 합니다.
    const wed = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 2);
    const owningYear = wed.getFullYear();
    const owningMonth = wed.getMonth() + 1;
    const owningMondays = getWeekMondaysForMonth_(owningYear, owningMonth);
    const weekNum = owningMondays.findIndex(m => m.getTime() === weekStart.getTime()) + 1;
    return {
      weekNum: weekNum || 1, owningYear, owningMonth,
      schedule: wr.schedule, list: wr.list, annualDetails: wr.annualDetails, sTime: wr.sTime, rangeText: wr.rangeText
    };
  });

  return { year, month, weeks };
}

// 부서별 업무 표시 순서: 지정된 부서는 이 순서대로, 목록에 없는 부서는 맨 뒤에 등록 시간순으로 표시합니다.
const DEPT_ORDER_ = [
  "교무기획부", "교육과정부", "교육연구부", "학생안전부", "방과후활동부",
  "융합과학정보부", "체육인성부", "진로상담부", "보건실",
  "1학년부", "2학년부", "3학년부", "행정실", "급식실"
];
function deptOrderIndex_(name) {
  const idx = DEPT_ORDER_.indexOf(name);
  return idx === -1 ? DEPT_ORDER_.length : idx;
}

function getDeptList() {
  const s = SS.getSheetByName("Index");
  // Index 시트는 헤더 없이 1행부터 바로 부서명이 들어있습니다.
  const names = (s && s.getLastRow() >= 1)
    ? s.getRange(1, 1, s.getLastRow(), 1).getValues().flat().filter(String)
    : [];
  // 고정 순서(DEPT_ORDER_)에 있는 부서는 Index 시트에 아직 없어도 항상 선택지에 포함합니다
  // (예: 새로 추가한 '급식실'을 시트 편집 없이 바로 쓸 수 있게). 중복은 제거합니다.
  const seen = {};
  const merged = [];
  names.concat(DEPT_ORDER_).forEach(n => {
    const name = String(n).trim();
    if (name && !seen[name]) { seen[name] = true; merged.push(name); }
  });
  // 노출 순서는 시트 순서가 아니라 지정된 고정 순서(DEPT_ORDER_)를 따릅니다.
  return merged.sort((a, b) => deptOrderIndex_(a) - deptOrderIndex_(b));
}

// weeks(반복 주차 수)가 2 이상이면 7일 간격으로 동일한 내용을 여러 번 등록합니다 (최대 20주, 매주 반복 등록용).
// grades: 대상 학년을 콤마로 구분한 문자열 (예: "1,2,3", "1"). 빈 값이면 학년 필터와 무관하게 항상 표시됩니다.
// "yyyy-MM-dd" 문자열을 Date로 안전하게 변환합니다. 형식이 잘못됐으면(빈 문자열 등)
// 조용히 "Invalid Date"를 만드는 대신 바로 에러를 던져 잘못된 데이터가 시트에 저장되지 않게 합니다.
function parseYmd_(s) {
  const parts = String(s || '').split('-');
  if (parts.length !== 3) throw new Error('날짜 형식이 올바르지 않습니다: ' + s);
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  const date = new Date(y, m - 1, d, 0, 0, 0);
  if (isNaN(date.getTime())) throw new Error('날짜 형식이 올바르지 않습니다: ' + s);
  return date;
}

function saveRangeToSheet(s, e, dept, text, author, weeks, grades, attachmentPayloads, links) {
  const lock = LockService.getScriptLock();
  let newAttachments = [];
  try {
    lock.waitLock(10000);
  } catch (e2) {
    throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  }

  try {
    const startDate = parseYmd_(s);
    const endDate = e ? parseYmd_(e) : startDate;

    const repeatCount = Math.max(1, Math.min(20, Number(weeks) || 1));
    newAttachments = createScheduleAttachments_(attachmentPayloads);
    const attachmentJson = newAttachments.length ? JSON.stringify(newAttachments) : '';
    const linksJson = buildScheduleLinksJson_(links);
    const rows = [];
    for (let i = 0; i < repeatCount; i++) {
      const sd = new Date(startDate); sd.setDate(sd.getDate() + i * 7);
      const ed = new Date(endDate); ed.setDate(ed.getDate() + i * 7);
      rows.push([dept, sd, ed, text, author || '', grades || '', attachmentJson, linksJson]);
    }

    const sheet = SS.getSheetByName("Data");
    if (!sheet) throw new Error('"Data" 시트를 찾을 수 없습니다.');
    if (sheet.getRange(1, 7).getValue() !== '첨부파일') sheet.getRange(1, 7).setValue('첨부파일');
    if (sheet.getRange(1, 8).getValue() !== '링크') sheet.getRange(1, 8).setValue('링크');
    // 락으로 보호된 구간 안에서 getLastRow()를 다시 읽어, 다른 사용자가 그 사이 추가한 행과 겹치지 않게 합니다.
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    invalidateSheetCache_("Data");
    return true;
  } catch (err) {
    newAttachments.forEach(item => { try { DriveApp.getFileById(item.fileId).setTrashed(true); } catch (cleanupErr) {} });
    console.error("saveRangeToSheet 오류: " + err.toString());
    throw new Error("업무 저장 중 오류가 발생했습니다: " + err.message);
  } finally {
    lock.releaseLock();
  }
}

// ===== 연간행사 세부(상세/전달사항/첨부/링크) — 부서 업무 저장 로직을 그대로 재사용 =====
// 명칭(name)은 학사일정표에서 오는 값이라 그대로 col5(author)에 보관해, 나중에 매칭합니다.
function saveAnnualDetail(name, start, end, text, attachmentPayloads, links) {
  return saveRangeToSheet(start, end, ANNUAL_DEPT_, text, String(name || ''), 1, '', attachmentPayloads, links);
}
// 세부 수정: 명칭(col5)을 유지해야 매칭이 깨지지 않으므로, 전용 함수로 author=name을 항상 넣어 저장합니다.
function updateAnnualDetail(rowNum, name, start, end, text, attachmentAction, links) {
  return updateRowContent('data', rowNum, text, start, end, String(name || ''), '', attachmentAction, links);
}

function saveNoticeToSheet(s, e, text, author, weeks, grades) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e2) {
    throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  }

  try {
    const startDate = parseYmd_(s);
    const endDate = e ? parseYmd_(e) : startDate;

    const repeatCount = Math.max(1, Math.min(20, Number(weeks) || 1));
    const rows = [];
    for (let i = 0; i < repeatCount; i++) {
      const sd = new Date(startDate); sd.setDate(sd.getDate() + i * 7);
      const ed = new Date(endDate); ed.setDate(ed.getDate() + i * 7);
      rows.push([sd, ed, text, author || '', grades || '']);
    }

    const sheet = SS.getSheetByName("Notice");
    if (!sheet) throw new Error('"Notice" 시트를 찾을 수 없습니다.');
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    invalidateSheetCache_("Notice");
    return true;
  } catch (err) {
    console.error("saveNoticeToSheet 오류: " + err.toString());
    throw new Error("전달사항 저장 중 오류가 발생했습니다: " + err.message);
  } finally {
    lock.releaseLock();
  }
}

function processBulkDelete(type, rowNums) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("다른 삭제 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  }

  try {
    const sheetName = type === 'notice' ? "Notice" : "Data";
    const sheet = SS.getSheetByName(sheetName);
    if (!sheet) return false;

    // 헤더 행(1행)과 현재 시트 범위를 벗어난 행 번호는 무시해, 스키마 손상이나
    // "행 번호가 이미 밀려버린" 상태에서의 엉뚱한 삭제를 막습니다.
    const lastRow = sheet.getLastRow();
    const validRows = (rowNums || [])
      .map(Number)
      .filter(num => Number.isInteger(num) && num >= 2 && num <= lastRow);

    const attachmentIds = type === 'data' && sheet.getLastColumn() >= 7
      ? validRows.flatMap(num => parseScheduleAttachments_(sheet.getRange(num, 7).getValue())).map(a => a.fileId)
      : [];
    validRows.sort((a, b) => b - a); // 아래에서 위로 지워야 앞 행 삭제가 뒤 행 번호에 영향을 주지 않습니다.
    validRows.forEach(num => {
      try {
        sheet.deleteRow(num);
      } catch (rowErr) {
        // 한 행 삭제가 실패해도(예: 동시 편집으로 행이 이미 사라짐) 나머지 행 삭제는 계속 진행합니다.
        console.error("행 삭제 실패(행 " + num + "): " + rowErr.toString());
      }
    });

    invalidateSheetCache_(sheetName);
    attachmentIds.forEach(trashScheduleAttachmentIfUnused_);
    return true;
  } catch (err) {
    console.error("processBulkDelete 오류: " + err.toString());
    throw new Error("삭제 중 오류가 발생했습니다: " + err.message);
  } finally {
    lock.releaseLock();
  }
}

function formatSimple(s, e) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const sS = (s.getMonth()+1)+"/"+s.getDate()+"("+days[s.getDay()]+")";
  const eS = (e.getMonth()+1)+"/"+e.getDate()+"("+days[e.getDay()]+")";
  return sS === eS ? sS : sS + " ~ " + eS;
}

function getItemsForDelete(type, year, month, week, dept) {
  const sheetName = type === 'notice' ? "Notice" : "Data";
  // 여기서 반환하는 rowNum은 곧바로 processBulkDelete/updateRowContent에서 실제 시트 행을
  // 지우거나 덮어쓰는 데 쓰입니다. 캐시(최대 30분 stale)를 쓰면 그 사이 다른 사용자가
  // 행을 추가/삭제했을 때 엉뚱한 행을 건드리게 되므로, 이 목록만은 항상 최신 값을 읽습니다.
  const sheet = SS.getSheetByName(sheetName);
  const vals = sheet ? sheet.getDataRange().getValues() : [];
  if (vals.length === 0) return [];

  // "9월"의 주차들은 달력상 9월 1일~30일과 정확히 일치하지 않습니다(예: "9월 1주차"는 수요일 기준으로
  // 8/31(월)~9/4(금)). 그래서 달력 월 경계로만 거르면 8/31처럼 앞뒤로 걸친 날짜가 목록에서 빠져
  // 수정/삭제할 수 없는 문제가 있었습니다. 조회 화면(getCombinedData)과 같은 기준으로, 그 달에 속한
  // 주차들의 첫 월요일 ~ 마지막 금요일 전체를 기본 범위로 잡습니다.
  // 또한 선택한 주차 기준으로 최소 2주 전까지는 항상 나오도록, 둘 중 더 이른 날짜를 시작점으로 씁니다.
  const weekMondays = getWeekMondaysForMonth_(year, month);
  let rangeStart, rangeEnd;
  if (weekMondays.length > 0) {
    const selectedIdx = Math.max(0, Math.min(weekMondays.length - 1, Number(week) - 1 || 0));
    const selectedMonday = weekMondays[selectedIdx];
    const twoWeeksBefore = new Date(selectedMonday.getFullYear(), selectedMonday.getMonth(), selectedMonday.getDate() - 14).getTime();
    rangeStart = Math.min(weekMondays[0].getTime(), twoWeeksBefore);
    const lastMonday = weekMondays[weekMondays.length - 1];
    rangeEnd = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + 4, 23, 59, 59, 999).getTime();
  } else {
    // 혹시 주차를 하나도 못 찾으면(있을 수 없지만) 달력 월 경계로 대체합니다.
    rangeStart = new Date(year, month - 1, 1).getTime();
    rangeEnd = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  }

  const [sIdx, eIdx, tIdx, gIdx] = (type === 'notice') ? [0, 1, 2, 4] : [1, 2, 3, 5];
  const MAX_LEN = 20;

  return vals.map((row, i) => ({ row, i }))
    .filter(obj => {
      const row = obj.row;
      if (!(row[sIdx] instanceof Date && row[eIdx] instanceof Date)) return false;
      const rowStartTime = row[sIdx].getTime();
      const rowEndTime = row[eIdx].getTime();
      const isMatchDate = rowStartTime <= rangeEnd && rowEndTime >= rangeStart;
      return type === 'data' ? (isMatchDate && row[0] === dept) : isMatchDate;
    })
    .reverse()
    .map(obj => {
      const originalText = obj.row[tIdx] || "";
      const displayContent = originalText.length > MAX_LEN ? originalText.substring(0, MAX_LEN) + "..." : originalText;
      const grades = obj.row[gIdx] || "";
      const attachments = type === 'data' ? parseScheduleAttachments_(obj.row[6]) : [];
      const links = type === 'data' ? parseScheduleLinks_(obj.row[7]) : [];

      const startDate = obj.row[sIdx];
      const endDate = obj.row[eIdx];

      // display는 수정/삭제 목록 화면에 innerHTML로 그대로 꽂혀 들어가므로 반드시 이스케이프합니다.
      // (이스케이프하지 않으면 내용에 '<' 같은 글자가 섞였을 때 그 항목만 화면이 깨져 버튼이 눌리지 않게 됩니다.)
      // fullText는 수정 입력창의 값으로만 쓰이므로 원문 그대로 둡니다.
      // 부서 업무는 이미 "[부서명] 수정/삭제" 화면 제목으로 부서가 나와 있으므로, 항목마다 다시
      // "[부서명]"을 붙이지 않습니다.
      const escapedDisplay = escapeHtml_(displayContent);
      return {
        rowNum: obj.i + 1,
        fullText: originalText,
        grades: grades,
        attachments: attachments,
        links: links,
        display: escapedDisplay,
        date: Utilities.formatDate(startDate, TZ, "M/d") +
              (Utilities.formatDate(startDate, TZ, "M/d") === Utilities.formatDate(endDate, TZ, "M/d") ?
              "" : " ~ " + Utilities.formatDate(endDate, TZ, "M/d")),
        isoStart: Utilities.formatDate(startDate, TZ, "yyyy-MM-dd"),
        isoEnd: Utilities.formatDate(endDate, TZ, "yyyy-MM-dd")
      };
    });
}

function updateRowContent(type, rowNum, newText, newStart, newEnd, newAuthor, newGrades, attachmentAction, links) {
  const lock = LockService.getScriptLock();
  let createdAttachments = [];
  try {
    lock.waitLock(10000);
  } catch (e) {
    console.error("수정 오류: 락 획득 실패");
    return false;
  }

  try {
    const sheetName = (type === 'notice') ? "Notice" : "Data";
    const sheet = SS.getSheetByName(sheetName);
    if (!sheet) throw new Error("시트를 찾을 수 없습니다.");

    const row = Number(rowNum);
    if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) {
      throw new Error("대상 행을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.");
    }

    const startDate = parseYmd_(newStart);
    const endDate = parseYmd_(newEnd);

    if (type === 'notice') {
      sheet.getRange(row, 1, 1, 5).setValues([[startDate, endDate, newText, newAuthor || '', newGrades || '']]);
    } else {
      const oldAttachments = parseScheduleAttachments_(sheet.getRange(row, 7).getValue());
      let nextAttachments = oldAttachments.slice();
      const mode = attachmentAction && attachmentAction.mode ? attachmentAction.mode : 'keep';
      if (mode === 'sync') {
        const oldById = {};
        oldAttachments.forEach(item => { oldById[item.fileId] = item; });
        const requestedExisting = Array.isArray(attachmentAction.existing) ? attachmentAction.existing : [];
        const existingPlans = requestedExisting.map(requested => {
          const old = oldById[String(requested.fileId || '')];
          if (!old) throw new Error('기존 첨부파일 정보가 변경되었습니다. 화면을 새로고침해주세요.');
          return {
            old: old,
            renamed: buildScheduleDownloadName_(requested.fileName, old.fileName),
            allowView: requested.allowView === true,
            allowDownload: requested.allowDownload !== false
          };
        });
        createdAttachments = createScheduleAttachments_(attachmentAction.newFiles);
        nextAttachments = existingPlans.map(plan => {
          if (plan.renamed !== plan.old.fileName) DriveApp.getFileById(plan.old.fileId).setName(plan.renamed);
          return {
            fileId: plan.old.fileId, fileName: plan.renamed, mimeType: plan.old.mimeType || '',
            allowView: plan.allowView, allowDownload: plan.allowDownload
          };
        });
        nextAttachments = nextAttachments.concat(createdAttachments);
      } else if (mode === 'remove') {
        nextAttachments = [];
      } else if (mode === 'replace') {
        createdAttachments = createScheduleAttachments_(attachmentAction.file ? [attachmentAction.file] : []);
        nextAttachments = createdAttachments.slice();
      } else if (mode === 'rename' && oldAttachments[0]) {
        const old = oldAttachments[0];
        const renamed = buildScheduleDownloadName_(attachmentAction.displayName, old.fileName);
        DriveApp.getFileById(old.fileId).setName(renamed);
        nextAttachments[0] = {
          fileId: old.fileId, fileName: renamed, mimeType: old.mimeType || '',
          allowView: old.allowView, allowDownload: old.allowDownload
        };
      }
      if (sheet.getRange(1, 7).getValue() !== '첨부파일') sheet.getRange(1, 7).setValue('첨부파일');
      if (sheet.getRange(1, 8).getValue() !== '링크') sheet.getRange(1, 8).setValue('링크');
      sheet.getRange(row, 2, 1, 7).setValues([[
        startDate, endDate, newText, newAuthor || '', newGrades || '',
        nextAttachments.length ? JSON.stringify(nextAttachments) : '',
        buildScheduleLinksJson_(links)
      ]]);
      const nextIds = nextAttachments.map(item => item.fileId);
      oldAttachments.filter(item => nextIds.indexOf(item.fileId) === -1).forEach(item => trashScheduleAttachmentIfUnused_(item.fileId));
    }
    invalidateSheetCache_(sheetName);

    return true;
  } catch (e) {
    createdAttachments.forEach(item => { try { DriveApp.getFileById(item.fileId).setTrashed(true); } catch (cleanupErr) {} });
    console.error("수정 오류: " + e.toString());
    return false;
  } finally {
    lock.releaseLock();
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * [속도 최적화 및 스타일 병합] 전체시간표 시트의 값과 배경색 데이터를 캐싱하여 한 번에 반환
 */
function getTimetableFromSheet() {
  try {
    // getBackgrounds()가 특히 느리고, 이 화면을 가장 많이들 열어보므로 캐시 효과가 큽니다.
    // (전체시간표는 이 앱 안에서 수정하는 기능이 아직 없어 무효화 트리거가 없으므로 TTL을 짧게 잡습니다.)
    const cache = CacheService.getScriptCache();
    const cacheKey = 'timetable_values_bgs';
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* 캐시가 손상됐으면 새로 읽습니다. */ }
    }

    // 외부 ID를 호출하지 않고, 내 메인 스프레드시트(SS)의 "전체시간표" 탭을 바로 읽도록 최적화했습니다.
    const sheet = SS.getSheetByName("전체시간표");
    if (!sheet) return null;

    const range = sheet.getDataRange();
    const values = range.getValues();
    const backgrounds = range.getBackgrounds();
    const result = { values: values, backgrounds: backgrounds };

    try {
      cache.put(cacheKey, JSON.stringify(result), 1800);
    } catch (e) {
      console.error('전체시간표 캐시 저장 실패: ' + e.toString());
    }
    return result;
  } catch (e) {
    console.error("내부 시간표 파일 연결 실패: " + e.toString());
    return null;
  }
}

/**
 * 결보강 계획서의 추천 로직에 필요한 보조 시트 2개("교과", "담임교사")를 한 번에 읽어옵니다.
 * "담임교사" 시트는 아직 없을 수 있어(향후 추가 예정) 없으면 null로 반환합니다.
 */
function getResubSupportData() {
  const result = { subjectRoster: null, homeroom: null };

  try {
    const subjectSheet = SS.getSheetByName("교과");
    if (subjectSheet) {
      result.subjectRoster = subjectSheet.getDataRange().getValues();
    }
  } catch (e) {
    console.error("교과 시트 읽기 실패: " + e.toString());
  }

  try {
    const homeroomSheet = SS.getSheetByName("담임교사");
    if (homeroomSheet) {
      result.homeroom = homeroomSheet.getDataRange().getValues();
    }
  } catch (e) {
    console.error("담임교사 시트 읽기 실패: " + e.toString());
  }

  return result;
}

// 현재 전체시간표가 실제로 적용되는 기간(학기 시작~방학식 등)을 저장/조회합니다.
// 결보강 계획서에서 이 기간 밖의 날짜는 추천하지 않도록 사용됩니다.
function getScheduleValidRange() {
  const props = PropertiesService.getScriptProperties();
  return {
    from: props.getProperty('scheduleValidFrom') || null,
    to: props.getProperty('scheduleValidTo') || null
  };
}

function setScheduleValidRange(from, to) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('scheduleValidFrom', from);
  props.setProperty('scheduleValidTo', to);
  return { success: true };
}

// --- 아래부터 시청각실 전용 예약 로직 추가 ---

// 지정된 날짜 배열에 해당하는 시청각실 예약 데이터를 가져옵니다.
function getAudiBookings(dateArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("시청각실예약");

  // 시트가 없으면 자동으로 생성하고 헤더를 작성합니다.
  if (!sheet) {
    sheet = ss.insertSheet("시청각실예약");
    sheet.appendRow(["Date", "Period", "Purpose", "Manager"]);
  }

  // 예약 자체의 중복 방지는 저장할 때 락+실시간 조회로 보장되므로, 여기(조회용)는
  // 짧은 TTL로만 캐싱해 부담을 줄입니다.
  const data = getCachedSheetValues_("시청각실예약", 120);
  let bookings = [];
  
  for (let i = 1; i < data.length; i++) {
    // 저장된 날짜를 문자열 YYYY-MM-DD 형태로 안전하게 비교
    let rDate = data[i][0];
    if (rDate instanceof Date) {
      let m = String(rDate.getMonth() + 1).padStart(2, '0');
      let d = String(rDate.getDate()).padStart(2, '0');
      rDate = `${rDate.getFullYear()}-${m}-${d}`;
    } else {
      rDate = String(rDate);
    }

    if (dateArray.includes(rDate)) {
      bookings.push({
        date: rDate,
        period: data[i][1],
        purpose: data[i][2],
        manager: data[i][3]
      });
    }
  }
  return bookings;
}

// 다수의 예약을 한 번에 저장합니다.
// 여러 교사가 동시에 예약할 수 있어, "중복 확인 → 저장" 사이를 락으로 감싸 이중 예약을 막습니다.
function saveMultipleAudiBookings(slots, purpose, manager) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, msg: "❌ 다른 예약이 처리 중입니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("시청각실예약");
    if (!sheet) {
      sheet = ss.insertSheet("시청각실예약");
      sheet.appendRow(["Date", "Period", "Purpose", "Manager"]);
    }

    const data = sheet.getDataRange().getValues();

    // 먼저 중복이 하나라도 있는지 검사합니다.
    for (let s = 0; s < slots.length; s++) {
      for (let i = 1; i < data.length; i++) {
        let rDate = data[i][0];
        if (rDate instanceof Date) {
          let m = String(rDate.getMonth() + 1).padStart(2, '0');
          let d = String(rDate.getDate()).padStart(2, '0');
          rDate = `${rDate.getFullYear()}-${m}-${d}`;
        } else {
          rDate = String(rDate);
        }

        if (rDate === slots[s].date && data[i][1] === slots[s].period) {
          return { success: false, msg: `❌ [${slots[s].date} ${slots[s].period}] 이미 예약된 시간입니다.\n새로고침 후 다시 시도해주세요.` };
        }
      }
    }

    // 중복이 없다면 전부 저장합니다.
    slots.forEach(slot => {
      sheet.appendRow([slot.date, slot.period, purpose, manager]);
    });

    invalidateSheetCache_("시청각실예약");
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// 다수의 예약을 찾아 한 번에 삭제합니다.
// ===== 건의함 (시스템 발전 제안) =====
// 사용자는 제목+내용으로 제안을 제출하고, 관리자는 관리자 패널에서 목록(작성일+제목)을 보고
// 제목을 눌러 상세 내용을 확인합니다. 전용 "건의함" 시트(작성일시/제목/내용)에 저장합니다.
function submitSuggestion(title, content, version) {
  title = String(title || '').trim();
  content = String(content || '').trim();
  version = String(version || '').trim(); // 예: "PC" / "모바일" / "PC, 모바일"
  if (!title) return { success: false, msg: "제목을 입력해주세요." };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, msg: "잠시 후 다시 시도해주세요." }; }
  try {
    let sheet = SS.getSheetByName("건의함");
    if (!sheet) {
      sheet = SS.insertSheet("건의함");
      sheet.appendRow(["작성일시", "제목", "내용", "구분"]);
    }
    sheet.appendRow([new Date(), title, content, version]);
    invalidateSheetCache_("건의함");
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// 관리자용: 저장된 건의 목록을 최신순으로 반환합니다. (제목/내용은 화면 표시용으로 이스케이프)
function getSuggestions() {
  let sheet = SS.getSheetByName("건의함");
  if (!sheet) {
    sheet = SS.insertSheet("건의함");
    sheet.appendRow(["작성일시", "제목", "내용"]);
    return [];
  }
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const d = data[i][0];
    let dateLabel = '';
    if (d instanceof Date) {
      dateLabel = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
    } else {
      dateLabel = String(d || '');
    }
    out.push({
      row: i + 1,
      dateLabel: dateLabel,
      title: escapeHtml_(String(data[i][1] || '')),
      content: escapeHtml_(String(data[i][2] || '')),
      version: escapeHtml_(String(data[i][3] || ''))
    });
  }
  out.reverse(); // 최신 건의가 위로 오도록
  return out;
}

// 관리자용: 처리 완료된 건의를 행 번호로 삭제합니다.
function deleteSuggestion(rowNum) {
  rowNum = parseInt(rowNum, 10);
  if (!rowNum || rowNum < 2) return { success: false };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { success: false, msg: "잠시 후 다시 시도해주세요." }; }
  try {
    const sheet = SS.getSheetByName("건의함");
    if (!sheet) return { success: false };
    if (rowNum > sheet.getLastRow()) return { success: false };
    sheet.deleteRow(rowNum);
    invalidateSheetCache_("건의함");
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function deleteMultipleAudiBookingsFromSheet(slotsToDelete) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, msg: "❌ 다른 예약이 처리 중입니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("시청각실예약");
    if (!sheet) return { success: false };

    const data = sheet.getDataRange().getValues();
    let rowsToDelete = [];

    // 아래에서 위로 찾아서 행 번호 수집 (여러 행 삭제 시 인덱스가 밀리는 현상 방지)
    for (let i = data.length - 1; i >= 1; i--) {
      let rDate = data[i][0];
      if (rDate instanceof Date) {
        let m = String(rDate.getMonth() + 1).padStart(2, '0');
        let d = String(rDate.getDate()).padStart(2, '0');
        rDate = `${rDate.getFullYear()}-${m}-${d}`;
      } else {
        rDate = String(rDate);
      }

      // 넘겨받은 삭제 대상 배열에 현재 행의 날짜/교시가 포함되어 있는지 검사
      let isMatch = slotsToDelete.some(slot => slot.date === rDate && slot.period === data[i][1]);
      if (isMatch) {
        rowsToDelete.push(i + 1);
      }
    }

    // 수집된 행 일괄 삭제 (역순으로 정렬되어 있으므로 안전하게 삭제 가능)
    rowsToDelete.forEach(rNum => {
      sheet.deleteRow(rNum);
    });

    invalidateSheetCache_("시청각실예약");
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// 일정 상세보기의 다운로드 요청은 해당 Data 행이 실제로 그 파일을 참조하는지 확인한 뒤에만 반환합니다.
function getScheduleAttachmentContent(rowNum, fileId, action) {
  try {
    const sheet = SS.getSheetByName('Data');
    const row = Number(rowNum);
    if (!sheet || !Number.isInteger(row) || row < 2 || row > sheet.getLastRow() || sheet.getLastColumn() < 7) {
      return { success: false, message: '첨부파일 정보를 찾을 수 없습니다.' };
    }
    const attachment = parseScheduleAttachments_(sheet.getRange(row, 7).getValue())
      .find(item => item.fileId === String(fileId || ''));
    if (!attachment) {
      return { success: false, message: '첨부파일 정보가 변경되었습니다.' };
    }
    const requestedAction = action === 'view' ? 'view' : 'download';
    if (requestedAction === 'view' && !attachment.allowView) {
      return { success: false, message: '등록자가 간편 뷰어 사용을 허용하지 않은 파일입니다.' };
    }
    if (requestedAction === 'download' && !attachment.allowDownload) {
      return { success: false, message: '등록자가 다운로드를 허용하지 않은 파일입니다.' };
    }
    const blob = DriveApp.getFileById(attachment.fileId).getBlob();
    return {
      success: true,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    console.error('일정 첨부 다운로드 오류: ' + e.toString());
    return { success: false, message: '첨부파일을 불러오지 못했습니다.' };
  }
}

// 첨부파일을 '뷰어(구글 드라이브 미리보기)'로 열기 위한 URL을 돌려줍니다.
// 앱은 이미 첨부를 누구나 다운로드할 수 있으므로, 미리보기가 되도록 '링크가 있는 사람 보기'로 열어둡니다.
// (검증: 다운로드와 동일하게 rowNum+fileId가 실제 등록된 첨부일 때만 처리합니다.)
function getScheduleAttachmentViewUrl(rowNum, fileId) {
  try {
    const sheet = SS.getSheetByName('Data');
    const row = Number(rowNum);
    if (!sheet || !Number.isInteger(row) || row < 2 || row > sheet.getLastRow() || sheet.getLastColumn() < 7) {
      return { success: false, message: '첨부파일 정보를 찾을 수 없습니다.' };
    }
    const attachment = parseScheduleAttachments_(sheet.getRange(row, 7).getValue())
      .find(item => item.fileId === String(fileId || ''));
    if (!attachment) {
      return { success: false, message: '첨부파일 정보가 변경되었습니다.' };
    }
    if (!attachment.allowView) {
      return { success: false, message: '등록자가 간편 뷰어 사용을 허용하지 않은 파일입니다.' };
    }
    try {
      DriveApp.getFileById(attachment.fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {}
    return { success: true, fileName: attachment.fileName, url: 'https://drive.google.com/file/d/' + attachment.fileId + '/view' };
  } catch (e) {
    console.error('일정 첨부 뷰어 URL 오류: ' + e.toString());
    return { success: false, message: '미리보기를 열지 못했습니다.' };
  }
}
