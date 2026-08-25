// 전역 변수로 선언하여 시트 접근 최적화
const SS = SpreadsheetApp.getActiveSpreadsheet();
const TZ = "GMT+9";

// 한영고 로고 파비콘 주소: GitHub 저장소(logo.png)를 jsDelivr CDN으로 서빙 (.png 확장자·정확한 content-type).
const FAVICON_URL = 'https://cdn.jsdelivr.net/gh/JH7168/weekly-plan@main/logo.png';

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

function verifyAdminPassword(pw) {
  return pw === ADMIN_PASSWORD;
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
//  - 13:30 이전 : [오늘 점심, 오늘 저녁]
//  - 13:30~18:15: [오늘 저녁, 다음 등교일 점심]
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
  if (hm < 1330) {
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
    return { label: mealLabel_(s.date, s.meal), items: items, status: status, holidayName: holidayName };
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

/**
 * 데이터 통합 조회 (가장 안정적이고 빠른 버전)
 */
function getCombinedData(year, month, week) {
  // 클라이언트 <select>의 value는 문자열로 넘어오므로(예: "2026"), 이후 계산이 꼬이지 않도록 숫자로 변환합니다.
  year = Number(year);
  month = Number(month);
  week = Number(week);
  const res = { schedule: [], noticeItems: [], list: [], rangeText: "" };

  const mondays = getWeekMondaysForMonth_(year, month);
  const weekStart = mondays[week - 1] || mondays[0] || new Date(year, month - 1, 1);
  weekStart.setHours(0,0,0,0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23,59,59,999);
  
  const sTime = weekStart.getTime();
  const eTime = weekEnd.getTime();
  res.rangeText = Utilities.formatDate(weekStart, TZ, "yyyy-MM-dd") + " ~ " + Utilities.formatDate(weekEnd, TZ, "yyyy-MM-dd");
  res.sTime = sTime;
  
  // 모든 시트 데이터를 가져온 후 헤더 행을 제외하고 메모리 처리 (빈 시트 방어 로직)
  // 여러 사용자가 짧은 시간에 같은 주를 반복 조회하는 경우가 많아 캐시로 재요청을 줄입니다.
  const rawSchVals = getCachedSheetValues_("학사일정표", 600);
  const schVals = rawSchVals.length > 1 ? rawSchVals.slice(1) : [];

  const rawNotVals = getCachedSheetValues_("Notice", 1800);
  const notVals = rawNotVals.length > 1 ? rawNotVals.slice(1) : [];

  const rawDatVals = getCachedSheetValues_("Data", 1800);
  const datVals = rawDatVals.length > 1 ? rawDatVals.slice(1) : [];
  
  const schMap = new Map();
  schVals.forEach(r => { 
    if (r[0] instanceof Date) {
      schMap.set(Utilities.formatDate(r[0], TZ, "yyyyMMdd"), r[1]); 
    }
  });
  
  const daysArr = ["일", "월", "화", "수", "목", "금", "토"];
  for (let i = 0; i < 5; i++) {
    let cur = new Date(weekStart);
    cur.setDate(weekStart.getDate() + i);
    res.schedule.push({ 
      date: (cur.getMonth()+1)+"/"+cur.getDate()+"("+daysArr[cur.getDay()]+")", 
      content: schMap.get(Utilities.formatDate(cur, TZ, "yyyyMMdd")) || "" 
    });
  }
  
  // 전달사항 처리 (학년 필터링은 클라이언트에서 처리하므로 학년 태그를 함께 내려줍니다)
  notVals.forEach(r => {
    if (!(r[0] instanceof Date && r[1] instanceof Date)) return;
    if (r[0].getTime() <= eTime && r[1].getTime() >= sTime) {
      const linesHtml = String(r[2]).split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => `<div class="notice-line">${line}</div>`)
        .join("");

      if (linesHtml) {
        res.noticeItems.push({ html: linesHtml, grades: r[4] || '' });
      }
    }
  });

  const deptMap = {};
  datVals.forEach(r => {
    if (!(r[1] instanceof Date) || !(r[2] instanceof Date)) return;
    const st = r[1].getTime();
    const et = r[2].getTime();

    if (st <= eTime && et >= sTime) {
      if (!deptMap[r[0]]) deptMap[r[0]] = [];
      deptMap[r[0]].push({ date: formatSimple(r[1], r[2]), time: st, st: st, et: et, text: r[3], grades: r[5] || '' });
    }
  });
  
  res.list = Object.keys(deptMap).map(name => {
    const items = deptMap[name].sort((a,b) => a.time - b.time);
    return { name, items, first: items[0].time };
  }).sort((a,b) => a.first - b.first);
  
  return res;
}

function getDeptList() {
  const s = SS.getSheetByName("Index");
  if (!s) return [];
  const lastRow = s.getLastRow();
  if (lastRow < 1) return [];
  // Index 시트는 헤더 없이 1행부터 바로 부서명이 들어있습니다.
  return s.getRange(1, 1, lastRow, 1).getValues().flat().filter(String);
}

// weeks(반복 주차 수)가 2 이상이면 7일 간격으로 동일한 내용을 여러 번 등록합니다 (최대 20주, 매주 반복 등록용).
// grades: 대상 학년을 콤마로 구분한 문자열 (예: "1,2,3", "1"). 빈 값이면 학년 필터와 무관하게 항상 표시됩니다.
function saveRangeToSheet(s, e, dept, text, author, weeks, grades) {
  try {
    const sParts = s.split('-');
    const startDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0);

    const eParts = e ? e.split('-') : sParts;
    const endDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 0, 0, 0);

    const repeatCount = Math.max(1, Math.min(20, Number(weeks) || 1));
    const rows = [];
    for (let i = 0; i < repeatCount; i++) {
      const sd = new Date(startDate); sd.setDate(sd.getDate() + i * 7);
      const ed = new Date(endDate); ed.setDate(ed.getDate() + i * 7);
      rows.push([dept, sd, ed, text, author || '', grades || '']);
    }

    const sheet = SS.getSheetByName("Data");
    if (!sheet) throw new Error('"Data" 시트를 찾을 수 없습니다.');
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    invalidateSheetCache_("Data");
    return true;
  } catch (err) {
    console.error("saveRangeToSheet 오류: " + err.toString());
    throw new Error("업무 저장 중 오류가 발생했습니다: " + err.message);
  }
}

function saveNoticeToSheet(s, e, text, author, weeks, grades) {
  try {
    const sParts = s.split('-');
    const startDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0);

    const eParts = e ? e.split('-') : sParts;
    const endDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 0, 0, 0);

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
  }
}

function processBulkDelete(type, rowNums) {
  const sheetName = type === 'notice' ? "Notice" : "Data";
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return false;
  rowNums.sort((a, b) => b - a);
  rowNums.forEach(num => sheet.deleteRow(num));
  invalidateSheetCache_(sheetName);
  return true;
}

function formatSimple(s, e) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const sS = (s.getMonth()+1)+"/"+s.getDate()+"("+days[s.getDay()]+")";
  const eS = (e.getMonth()+1)+"/"+e.getDate()+"("+days[e.getDay()]+")";
  return sS === eS ? sS : sS + " ~ " + eS;
}

function getItemsForDelete(type, year, month, week, dept) {
  const sheetName = type === 'notice' ? "Notice" : "Data";
  const vals = getCachedSheetValues_(sheetName, 1800);
  if (vals.length === 0) return [];

  const startMonth = new Date(year, month - 1, 1).getTime();
  const endMonth = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  
  const [sIdx, eIdx, tIdx, gIdx] = (type === 'notice') ? [0, 1, 2, 4] : [1, 2, 3, 5];
  const MAX_LEN = 20;

  return vals.map((row, i) => ({ row, i }))
    .filter(obj => {
      const row = obj.row;
      if (!(row[sIdx] instanceof Date && row[eIdx] instanceof Date)) return false;
      const rowStartTime = row[sIdx].getTime();
      const rowEndTime = row[eIdx].getTime();
      const isMatchDate = rowStartTime <= endMonth && rowEndTime >= startMonth;
      return type === 'data' ? (isMatchDate && row[0] === dept) : isMatchDate;
    })
    .reverse()
    .map(obj => {
      const originalText = obj.row[tIdx] || "";
      const displayContent = originalText.length > MAX_LEN ? originalText.substring(0, MAX_LEN) + "..." : originalText;
      const grades = obj.row[gIdx] || "";

      const startDate = obj.row[sIdx];
      const endDate = obj.row[eIdx];

      return {
        rowNum: obj.i + 1,
        fullText: originalText,
        grades: grades,
        display: (type === 'notice') ? displayContent : `[${obj.row[0]}] ${displayContent}`,
        date: Utilities.formatDate(startDate, TZ, "M/d") +
              (Utilities.formatDate(startDate, TZ, "M/d") === Utilities.formatDate(endDate, TZ, "M/d") ?
              "" : " ~ " + Utilities.formatDate(endDate, TZ, "M/d")),
        isoStart: Utilities.formatDate(startDate, TZ, "yyyy-MM-dd"),
        isoEnd: Utilities.formatDate(endDate, TZ, "yyyy-MM-dd")
      };
    });
}

function updateRowContent(type, rowNum, newText, newStart, newEnd, newAuthor, newGrades) {
  try {
    const sheetName = (type === 'notice') ? "Notice" : "Data";
    const sheet = SS.getSheetByName(sheetName);
    if (!sheet) throw new Error("시트를 찾을 수 없습니다.");

    const row = Number(rowNum);
    const startDate = new Date(newStart);
    const endDate = new Date(newEnd);
    startDate.setHours(0,0,0,0);
    endDate.setHours(0,0,0,0);

    if (type === 'notice') {
      sheet.getRange(row, 1, 1, 5).setValues([[startDate, endDate, newText, newAuthor || '', newGrades || '']]);
    } else {
      sheet.getRange(row, 2, 1, 5).setValues([[startDate, endDate, newText, newAuthor || '', newGrades || '']]);
    }
    invalidateSheetCache_(sheetName);

    return true;
  } catch (e) {
    console.error("수정 오류: " + e.toString());
    return false;
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