// 전역 변수로 선언하여 시트 접근 최적화
const SS = SpreadsheetApp.getActiveSpreadsheet();
const TZ = "GMT+9";

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  const now = new Date();

  // 초기 UI 구성에 필요한 최소 데이터만 전달 (속도 향상의 핵심)
  template.initialData = {
    deptList: getDeptList(),
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1
  };

  return template.evaluate()
      .setTitle('주간 계획서')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 데이터 통합 조회 (가장 안정적이고 빠른 버전)
 */
function getCombinedData(year, month, week) {
  const res = { schedule: [], notice: "", list: [], rangeText: "" };
  
  const firstDay = new Date(year, month - 1, 1);
  const diffToMonday = (firstDay.getDay() === 0) ? 1 : (1 - firstDay.getDay());
  const weekStart = new Date(year, month - 1, 1 + diffToMonday + (week - 1) * 7);
  weekStart.setHours(0,0,0,0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23,59,59,999);
  
  const sTime = weekStart.getTime();
  const eTime = weekEnd.getTime();
  res.rangeText = Utilities.formatDate(weekStart, TZ, "yyyy-MM-dd") + " ~ " + Utilities.formatDate(weekEnd, TZ, "yyyy-MM-dd");
  res.sTime = sTime;
  
  // 모든 시트 데이터를 가져온 후 헤더 행을 제외하고 메모리 처리 (빈 시트 방어 로직)
  const rawSchVals = SS.getSheetByName("학사일정표")?.getDataRange().getValues() || [];
  const schVals = rawSchVals.length > 1 ? rawSchVals.slice(1) : [];
  
  const rawNotVals = SS.getSheetByName("Notice")?.getDataRange().getValues() || [];
  const notVals = rawNotVals.length > 1 ? rawNotVals.slice(1) : [];
  
  const rawDatVals = SS.getSheetByName("Data")?.getDataRange().getValues() || [];
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
  
  // 전달사항 처리
  let noticeBlocks = [];
  notVals.forEach(r => {
    if (!(r[0] instanceof Date && r[1] instanceof Date)) return;
    if (r[0].getTime() <= eTime && r[1].getTime() >= sTime) {
      const linesHtml = String(r[2]).split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => `<div class="notice-line">${line}</div>`)
        .join("");
      
      if (linesHtml) {
        noticeBlocks.push(linesHtml);
      }
    }
  });

  res.notice = noticeBlocks.join('<div style="height: 15px;"></div>') || "전달사항이 없습니다.";
  
  const deptMap = {};
  datVals.forEach(r => {
    if (!(r[1] instanceof Date) || !(r[2] instanceof Date)) return;
    const st = r[1].getTime();
    const et = r[2].getTime();
    
    if (st <= eTime && et >= sTime) {
      if (!deptMap[r[0]]) deptMap[r[0]] = [];
      deptMap[r[0]].push({ date: formatSimple(r[1], r[2]), time: st, st: st, et: et, text: r[3] });
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

function saveRangeToSheet(s, e, dept, text) {
  const sParts = s.split('-');
  const startDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0);
  
  const eParts = e ? e.split('-') : sParts;
  const endDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 0, 0, 0);
  
  SS.getSheetByName("Data").appendRow([dept, startDate, endDate, text]); 
  return true; 
}

function saveNoticeToSheet(s, e, text) { 
  const sParts = s.split('-');
  const startDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0);
  
  const eParts = e ? e.split('-') : sParts;
  const endDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 0, 0, 0);
  
  SS.getSheetByName("Notice").appendRow([startDate, endDate, text]); 
  return true; 
}

function processBulkDelete(type, rowNums) {
  const sheetName = type === 'notice' ? "Notice" : "Data";
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return false;
  rowNums.sort((a, b) => b - a);
  rowNums.forEach(num => sheet.deleteRow(num));
  return true;
}

function formatSimple(s, e) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const sS = (s.getMonth()+1)+"/"+s.getDate()+"("+days[s.getDay()]+")";
  const eS = (e.getMonth()+1)+"/"+e.getDate()+"("+days[e.getDay()]+")";
  return sS === eS ? sS : sS + " ~ " + eS;
}

function getItemsForDelete(type, year, month, week, dept) {
  const sheet = SS.getSheetByName(type === 'notice' ? "Notice" : "Data");
  if (!sheet) return [];
  const vals = sheet.getDataRange().getValues();
  
  const startMonth = new Date(year, month - 1, 1).getTime();
  const endMonth = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  
  const [sIdx, eIdx, tIdx] = (type === 'notice') ? [0, 1, 2] : [1, 2, 3];
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
      
      const startDate = obj.row[sIdx];
      const endDate = obj.row[eIdx];

      return {
        rowNum: obj.i + 1,
        fullText: originalText,
        display: (type === 'notice') ? displayContent : `[${obj.row[0]}] ${displayContent}`,
        date: Utilities.formatDate(startDate, TZ, "M/d") + 
              (Utilities.formatDate(startDate, TZ, "M/d") === Utilities.formatDate(endDate, TZ, "M/d") ? 
              "" : " ~ " + Utilities.formatDate(endDate, TZ, "M/d")),
        isoStart: Utilities.formatDate(startDate, TZ, "yyyy-MM-dd"),
        isoEnd: Utilities.formatDate(endDate, TZ, "yyyy-MM-dd")
      };
    });
}

function updateRowContent(type, rowNum, newText, newStart, newEnd) {
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
      sheet.getRange(row, 1, 1, 3).setValues([[startDate, endDate, newText]]);
    } else {
      sheet.getRange(row, 2, 1, 3).setValues([[startDate, endDate, newText]]);
    }
    
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
    // 외부 ID를 호출하지 않고, 내 메인 스프레드시트(SS)의 "전체시간표" 탭을 바로 읽도록 최적화했습니다.
    const sheet = SS.getSheetByName("전체시간표");
    if (!sheet) return null;
    
    const range = sheet.getDataRange();
    const values = range.getValues();
    const backgrounds = range.getBackgrounds();
    
    return {
      values: values,
      backgrounds: backgrounds
    };
  } catch (e) {
    console.error("내부 시간표 파일 연결 실패: " + e.toString());
    return null;
  }
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
  
  const data = sheet.getDataRange().getValues();
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

// 시청각실 예약을 시트에 저장합니다. 중복을 방지합니다.
function saveAudiBookingToSheet(date, period, purpose, manager) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("시청각실예약");
  if (!sheet) {
    sheet = ss.insertSheet("시청각실예약");
    sheet.appendRow(["Date", "Period", "Purpose", "Manager"]);
  }
  
  // 중복 예약 검증 (동일한 날짜, 동일한 교시)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let rDate = data[i][0];
    if (rDate instanceof Date) {
      let m = String(rDate.getMonth() + 1).padStart(2, '0');
      let d = String(rDate.getDate()).padStart(2, '0');
      rDate = `${rDate.getFullYear()}-${m}-${d}`;
    } else {
      rDate = String(rDate);
    }
    
    if (rDate === date && data[i][1] === period) {
      return {success: false, msg: "❌ 이미 다른 분이 예약한 시간입니다. 새로고침 후 다시 확인해주세요."};
    }
  }
  
  // 안전하게 데이터 저장
  sheet.appendRow([date, period, purpose, manager]);
  return {success: true};
}

// 다수의 예약을 한 번에 저장합니다.
function saveMultipleAudiBookings(slots, purpose, manager) {
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
        return {success: false, msg: `❌ [${slots[s].date} ${slots[s].period}] 이미 예약된 시간입니다.\n새로고침 후 다시 시도해주세요.`};
      }
    }
  }
  
  // 중복이 없다면 전부 저장합니다.
  slots.forEach(slot => {
    sheet.appendRow([slot.date, slot.period, purpose, manager]);
  });
  
  return {success: true};
}

// 예약된 시청각실 일정을 찾아 삭제합니다.
function deleteAudiBookingFromSheet(date, period) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("시청각실예약");
  if (!sheet) return {success: false};
  
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    let rDate = data[i][0];
    if (rDate instanceof Date) {
      let m = String(rDate.getMonth() + 1).padStart(2, '0');
      let d = String(rDate.getDate()).padStart(2, '0');
      rDate = `${rDate.getFullYear()}-${m}-${d}`;
    } else {
      rDate = String(rDate);
    }
    
    if (rDate === date && data[i][1] === period) {
      sheet.deleteRow(i + 1); // 배열 인덱스는 0부터 시작하므로 +1
      return {success: true};
    }
  }
  return {success: false};
}

// 다수의 예약을 찾아 한 번에 삭제합니다.
function deleteMultipleAudiBookingsFromSheet(slotsToDelete) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("시청각실예약");
  if (!sheet) return {success: false};
  
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
  
  return {success: true};
}