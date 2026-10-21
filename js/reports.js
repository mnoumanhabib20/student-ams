import { supabase } from "./supabaseClient.js";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const classSelect = document.querySelector("[data-report-class]");
const subjectSelect = document.querySelector("[data-report-subject]");
const fromInput = document.querySelector("[data-report-from]");
const toInput = document.querySelector("[data-report-to]");
const rowsElement = document.querySelector("[data-report-rows]");
const description = document.querySelector("[data-report-description]");
const exportButton = document.querySelector("#export-excel-btn");
const thresholdLabels = document.querySelectorAll("[data-report-threshold]");
const legendTargets = document.querySelectorAll("[data-legend-target]");
const sessionCountElement = document.querySelector("[data-report-sessions]");
const studentCountElement = document.querySelector("[data-report-students]");
const calendarDialog = document.querySelector("[data-report-calendar]");
const calendarGrid = document.querySelector("[data-calendar-grid]");
const calendarMonthLabel = document.querySelector("[data-calendar-month]");
const calendarPreviousButton = document.querySelector("[data-calendar-previous]");
const calendarNextButton = document.querySelector("[data-calendar-next]");

let teacherId = null;
let reportRows = [];
let reportClassName = "";
let reportSubjectName = "";
let reportSessionCount = 0;
let reportSessionsByDate = new Map();
let attendanceTarget = 75;
let requestVersion = 0;
let calendarStudent = null;
let calendarMonth = null;
let calendarMinimumMonth = null;
let calendarMaximumMonth = null;
let exportToastTimer = 0;

const avatarClasses = [
  "avatar-lilac",
  "avatar-blue",
  "avatar-peach",
  "avatar-green",
  "avatar-yellow",
  "avatar-pink",
];

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function attendanceTargetStorageKey(userId) {
  return `attendify:attendance-target:${userId}`;
}

function loadAttendanceTarget(userId) {
  const stored = window.localStorage.getItem(attendanceTargetStorageKey(userId));
  const target = stored === null ? 75 : Number(stored);
  return Number.isFinite(target) && target >= 0 && target <= 100 ? target : 75;
}

function getRollNumberVal(rollStr) {
  if (!rollStr) return 0;
  let str = rollStr.toString().trim();
  if (str.length > 2) {
    str = str.slice(-2);
  }
  const num = parseInt(str.replace(/\D/g, ""), 10);
  return Number.isNaN(num) ? 0 : num;
}

function isStudentActiveOnDate(student, date) {
  const createdDate = student.created_at?.slice(0, 10);
  const deletedDate = (student.deleted_at ?? (
    student.status === "inactive" ? student.updated_at : null
  ))?.slice(0, 10);
  if (createdDate && createdDate > date) return false;
  if (deletedDate) return deletedDate >= date;
  return student.status !== "inactive";
}

function overlapsActiveWindow(student, dateFrom, dateTo) {
  const createdDate = student.created_at?.slice(0, 10);
  const deletedDate = (student.deleted_at ?? (
    student.status === "inactive" ? student.updated_at : null
  ))?.slice(0, 10);
  if (createdDate && createdDate > dateTo) return false;
  if (deletedDate) return deletedDate >= dateFrom;
  return student.status !== "inactive";
}

function showRowsMessage(message) {
  reportRows = [];
  reportSessionCount = 0;
  reportSessionsByDate = new Map();
  exportButton.disabled = true;
  sessionCountElement.textContent = "—";
  studentCountElement.textContent = "—";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.className = "register-empty-cell";
  cell.textContent = message;
  row.append(cell);
  rowsElement.replaceChildren(row);
}

async function fetchAllRows(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadClasses() {
  const { data, error } = await supabase
    .from("classes")
    .select("id, name, section, academic_year")
    .eq("teacher_id", teacherId)
    .order("academic_year", { ascending: false })
    .order("name")
    .order("section");
  if (error) throw error;

  classSelect.replaceChildren(new Option("Choose a class", ""));
  (data ?? []).forEach((classRow) => {
    classSelect.append(new Option(
      `${classRow.name} · ${classRow.section} (${classRow.academic_year})`,
      classRow.id,
    ));
  });
  classSelect.disabled = !data?.length;
  if (!data?.length) {
    classSelect.replaceChildren(new Option("No classes available", ""));
    subjectSelect.replaceChildren(new Option("No classes available", ""));
    subjectSelect.disabled = true;
    showRowsMessage("Add a class to view student attendance.");
  }
}

function clearReport(message) {
  description.textContent = message;
  showRowsMessage(message);
}

async function loadSubjects() {
  const classId = classSelect.value;
  const requestId = ++requestVersion;
  subjectSelect.disabled = true;
  subjectSelect.replaceChildren(
    new Option(classId ? "Loading subjects…" : "Choose a class first", ""),
  );
  if (!classId) {
    clearReport("Choose a class, subject, and date range to view attendance.");
    return;
  }

  clearReport("Choose a subject and date range to load attendance.");
  const { data, error } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("class_id", classId)
    .order("name");
  if (error) throw error;
  if (requestId !== requestVersion || classId !== classSelect.value) return;

  subjectSelect.replaceChildren(new Option("Choose a subject", ""));
  (data ?? []).forEach((subject) => {
    subjectSelect.append(new Option(subject.name, subject.id));
  });
  subjectSelect.disabled = !data?.length;
  if (!data?.length) clearReport("No subjects are set up for this class.");
}

function getAttendanceStatus(percentage) {
  if (Math.abs(percentage - attendanceTarget) < 0.000001) return "Exactly on target";
  return percentage > attendanceTarget ? "Above target" : "Below target";
}

function getInitials(fullName) {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("") || "?";
}

function renderReport(rows, sessions, dateFrom, dateTo) {
  reportRows = rows.sort((a, b) =>
    getRollNumberVal(a.roll_number) - getRollNumberVal(b.roll_number)
    || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }),
  );
  reportSessionCount = sessions.length;
  reportSessionsByDate = new Map();
  sessions.forEach(({ session_date }) => {
    reportSessionsByDate.set(
      session_date,
      (reportSessionsByDate.get(session_date) ?? 0) + 1,
    );
  });
  sessionCountElement.textContent = String(sessions.length);
  studentCountElement.textContent = String(rows.length);

  if (!rows.length) {
    const message = sessions.length
      ? "No records found for this period"
      : "No attendance sessions found in this date range";
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 7;
    emptyCell.className = "register-empty-cell";
    emptyCell.textContent = message;
    emptyRow.append(emptyCell);
    rowsElement.replaceChildren(emptyRow);
    exportButton.disabled = true;
  } else {
    const fragment = document.createDocumentFragment();
    reportRows.forEach((student) => {
      const status = getAttendanceStatus(student.percentage);
      const statusClass = status === "Above target"
        ? "above"
        : status === "Exactly on target"
          ? "equal"
          : "below";
      const row = document.createElement("tr");
      row.className = `attendance-row attendance-${statusClass}`;

      const studentCell = document.createElement("td");
      const identity = document.createElement("div");
      identity.className = "report-student-cell";
      const avatar = document.createElement("span");
      avatar.className = `student-avatar ${avatarClasses[student.full_name.length % avatarClasses.length]}`;
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = getInitials(student.full_name);
      const identityCopy = document.createElement("span");
      identityCopy.className = "report-student-copy";
      const name = document.createElement("strong");
      name.textContent = student.full_name;
      const detail = document.createElement("small");
      detail.textContent =
        `${student.sessionsHeld} ${student.sessionsHeld === 1 ? "session" : "sessions"} held`;
      identityCopy.append(name, detail);
      identity.append(avatar, identityCopy);
      studentCell.append(identity);

      const rollCell = document.createElement("td");
      rollCell.textContent = student.roll_number;

      const presentCell = document.createElement("td");
      presentCell.className = "px-4 py-3 text-center font-bold text-emerald-600";
      presentCell.textContent = String(student.present);
      const absentCell = document.createElement("td");
      absentCell.className = "px-4 py-3 text-center font-bold text-rose-600";
      absentCell.textContent = String(student.absent);
      const leaveCell = document.createElement("td");
      leaveCell.className = "px-4 py-3 text-center font-bold text-amber-600";
      leaveCell.textContent = String(student.leave);

      const percentageCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `attendance-percentage-badge attendance-badge-${statusClass}`;
      const symbol = status === "Above target" ? "↑" : status === "Below target" ? "↓" : "—";
      badge.textContent = `${symbol} ${student.percentage.toFixed(1)}%`;
      badge.setAttribute("aria-label", `${student.percentage.toFixed(1)} percent, ${status}`);
      percentageCell.append(badge);

      const actionCell = document.createElement("td");
      const calendarButton = document.createElement("button");
      calendarButton.className = "button button-secondary report-calendar-button";
      calendarButton.type = "button";
      calendarButton.dataset.calendarStudent = student.id;
      calendarButton.setAttribute("aria-label", `View attendance calendar for ${student.full_name}`);
      calendarButton.textContent = "View calendar";
      actionCell.append(calendarButton);

      row.append(
        studentCell,
        rollCell,
        presentCell,
        absentCell,
        leaveCell,
        percentageCell,
        actionCell,
      );
      fragment.append(row);
    });
    rowsElement.replaceChildren(fragment);
    exportButton.disabled = false;
  }

  description.textContent =
    `${reportClassName} · ${reportSubjectName} · ${dateFrom} to ${dateTo} · Target ${attendanceTarget}%`;
}

function dateFromValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateToValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function compareMonths(first, second) {
  return first.getFullYear() * 12 + first.getMonth()
    - (second.getFullYear() * 12 + second.getMonth());
}

function monthDateLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderCalendarMonth() {
  if (!calendarStudent || !calendarMonth) return;

  calendarMonthLabel.textContent = monthDateLabel(calendarMonth);
  calendarPreviousButton.disabled = compareMonths(calendarMonth, calendarMinimumMonth) <= 0;
  calendarNextButton.disabled = compareMonths(calendarMonth, calendarMaximumMonth) >= 0;
  calendarGrid.setAttribute(
    "aria-label",
    `Attendance calendar for ${calendarStudent.full_name}, ${monthDateLabel(calendarMonth)}`,
  );

  const fragment = document.createDocumentFragment();
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((weekday) => {
    const heading = document.createElement("span");
    heading.className = "calendar-weekday";
    heading.setAttribute("role", "columnheader");
    heading.textContent = weekday;
    fragment.append(heading);
  });

  const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const dayCount = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const cellCount = Math.ceil((leadingDays + dayCount) / 7) * 7;
  const rangeStart = fromInput.value;
  const rangeEnd = toInput.value;

  for (let index = 0; index < cellCount; index += 1) {
    const dayNumber = index - leadingDays + 1;
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day";
    dayCell.setAttribute("role", "gridcell");

    if (dayNumber < 1 || dayNumber > dayCount) {
      dayCell.classList.add("calendar-day-empty");
      dayCell.setAttribute("aria-hidden", "true");
      fragment.append(dayCell);
      continue;
    }

    const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), dayNumber);
    const dateValue = dateToValue(date);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const sessionsOnDate = isStudentActiveOnDate(calendarStudent, dateValue)
      ? reportSessionsByDate.get(dateValue) ?? 0
      : 0;
    const statuses = calendarStudent.attendanceByDate.get(dateValue) ?? [];
    const counts = {
      Present: statuses.filter((status) => status === "Present").length,
      Absent: statuses.filter((status) => status === "Absent").length,
      Leave: statuses.filter((status) => status === "Leave").length,
    };
    const hasUnmarked = statuses.length < sessionsOnDate
      || statuses.includes("Not Marked");
    const presentStatuses = ["Present", "Absent", "Leave"].filter((status) => counts[status] > 0);
    const isInRange = dateValue >= rangeStart && dateValue <= rangeEnd;

    const dateNumber = document.createElement("span");
    dateNumber.className = "calendar-day-number";
    dateNumber.textContent = String(dayNumber);
    dayCell.append(dateNumber);

    if (isInRange && sessionsOnDate > 0) {
      const lectureCount = document.createElement("span");
      lectureCount.className = "calendar-day-lecture-count";
      lectureCount.textContent = `${sessionsOnDate} ${sessionsOnDate === 1 ? "Lacture" : "Lactures"}`;
      dayCell.append(lectureCount);
    }

    if (!isInRange || sessionsOnDate === 0 || isWeekend) {
      dayCell.classList.add("calendar-day-disabled");
      if (isWeekend) dayCell.classList.add("calendar-day-weekend");
      const dayDescription = isWeekend ? "weekend" : "no session";
      const lectureDescription = sessionsOnDate > 0
        ? `, ${sessionsOnDate} ${sessionsOnDate === 1 ? "Lacture" : "Lactures"}`
        : "";
      dayCell.setAttribute(
        "aria-label",
        `${date.toLocaleDateString()}, ${dayDescription}${lectureDescription}`,
      );
      fragment.append(dayCell);
      continue;
    }

    const completeStatus = !hasUnmarked && presentStatuses.length === 1
      ? presentStatuses[0]
      : null;
    const statusClasses = {
      Present: "calendar-day-present",
      Absent: "calendar-day-absent",
      Leave: "calendar-day-leave",
    };
    if (completeStatus) {
      dayCell.classList.add(statusClasses[completeStatus]);
    } else {
      dayCell.classList.add("calendar-day-disabled");
      if (presentStatuses.length > 1 || (presentStatuses.length && hasUnmarked)) {
        dayCell.classList.add("calendar-day-mixed");
      }
    }

    const statusParts = [
      counts.Present ? `P ${counts.Present}` : "",
      counts.Absent ? `A ${counts.Absent}` : "",
      counts.Leave ? `L ${counts.Leave}` : "",
      hasUnmarked ? "Not marked" : "",
    ].filter(Boolean);
    const statusLabel = completeStatus ?? (statusParts.length ? statusParts.join(" · ") : "Not marked");
    const statusText = document.createElement("span");
    statusText.className = "calendar-day-status";
    statusText.textContent = completeStatus ?? (statusParts.join(" · ") || "Not marked");
    dayCell.append(statusText);
    dayCell.setAttribute(
      "aria-label",
      `${date.toLocaleDateString()}: ${statusLabel}; ${sessionsOnDate} ${sessionsOnDate === 1 ? "Lacture" : "Lactures"}`,
    );
    dayCell.title = `${statusLabel} · ${sessionsOnDate} ${sessionsOnDate === 1 ? "Lacture" : "Lactures"}`;
    fragment.append(dayCell);
  }

  calendarGrid.replaceChildren(fragment);
}

function openStudentCalendar(student) {
  calendarStudent = student;
  calendarMinimumMonth = monthStart(dateFromValue(fromInput.value));
  calendarMaximumMonth = monthStart(dateFromValue(toInput.value));
  calendarMonth = new Date(calendarMinimumMonth);

  calendarDialog.querySelector("[data-calendar-student-name]").textContent = student.full_name;
  calendarDialog.querySelector("[data-calendar-roll-number]").textContent = student.roll_number;
  calendarDialog.querySelector("[data-calendar-sessions]").textContent =
    String(student.sessionsHeld);
  calendarDialog.querySelector("[data-calendar-present]").textContent = String(student.present);
  calendarDialog.querySelector("[data-calendar-absent]").textContent = String(student.absent);
  calendarDialog.querySelector("[data-calendar-leave]").textContent = String(student.leave);
  calendarDialog.querySelector("[data-calendar-percentage]").textContent =
    `${student.percentage.toFixed(1)}%`;

  renderCalendarMonth();
  if (!calendarDialog.open) calendarDialog.showModal();
  calendarDialog.querySelector("[data-calendar-close]").focus();
}

async function loadStudentAttendance() {
  const classId = classSelect.value;
  const subjectId = subjectSelect.value;
  const dateFrom = fromInput.value;
  const dateTo = toInput.value;
  const requestId = ++requestVersion;
  if (!classId || !subjectId || !dateFrom || !dateTo) {
    clearReport("Choose a class, subject, and date range to view attendance.");
    return;
  }
  if (dateFrom > dateTo) {
    clearReport("The start date must be on or before the end date.");
    return;
  }

  reportClassName = classSelect.selectedOptions[0]?.textContent ?? "";
  reportSubjectName = subjectSelect.selectedOptions[0]?.textContent ?? "";
  description.textContent = "Loading attendance…";
  rowsElement.setAttribute("aria-busy", "true");
  const loadingRow = document.createElement("tr");
  const loadingCell = document.createElement("td");
  loadingCell.colSpan = 7;
  loadingCell.className = "register-empty-cell";
  loadingCell.textContent = "Loading students, sessions, and attendance…";
  loadingRow.append(loadingCell);
  rowsElement.replaceChildren(loadingRow);

  let fetchStep = "active students";
  try {
    const classStudents = await fetchAllRows(() =>
      supabase
        .from("students")
        .select("*")
        .eq("teacher_id", teacherId)
        .eq("class_id", classId)
        .order("roll_number"),
    );
    classStudents.sort((a, b) =>
      getRollNumberVal(a.roll_number) - getRollNumberVal(b.roll_number)
      || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }),
    );

    fetchStep = "class sessions";
    const fetchedSessions = await fetchAllRows(() =>
      supabase
        .from("class_sessions")
        .select("id, session_date, class_id, subject_id, status")
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .order("session_date")
        .order("id"),
    );
    const sessions = fetchedSessions
      .map((session) => ({
        ...session,
        session_date: String(session.session_date ?? "").slice(0, 10),
      }))
      .filter((session) =>
        session.status !== "cancelled"
        && session.session_date >= dateFrom
        && session.session_date <= dateTo,
      );

    if (!sessions.length) {
      if (requestId !== requestVersion) return;
      renderReport([], sessions, dateFrom, dateTo);
      return;
    }

    fetchStep = "attendance records";
    const attendance = [];
    for (let offset = 0; offset < sessions.length; offset += 100) {
      const sessionIds = sessions.slice(offset, offset + 100).map((session) => session.id);
      attendance.push(...await fetchAllRows(() =>
        supabase
          .from("attendance_records")
          .select("session_id, student_id, attendance_status")
          .in("session_id", sessionIds),
      ));
    }

    if (requestId !== requestVersion) return;

    fetchStep = "historical student details";
    const studentById = new Map(classStudents.map((student) => [student.id, student]));
    const historicalStudentIds = [...new Set(attendance.map((record) => record.student_id))]
      .filter((studentId) => !studentById.has(studentId));
    for (let offset = 0; offset < historicalStudentIds.length; offset += 100) {
      const studentIds = historicalStudentIds.slice(offset, offset + 100);
      const historicalStudents = await fetchAllRows(() =>
        supabase
          .from("students")
          .select("*")
          .eq("teacher_id", teacherId)
          .in("id", studentIds),
      );
      historicalStudents.forEach((student) => studentById.set(student.id, student));
    }

    const participantIds = new Set(attendance.map((record) => record.student_id));
    const eligibleStudents = [...studentById.values()].filter((student) =>
      overlapsActiveWindow(student, dateFrom, dateTo)
      && (student.class_id === classId || participantIds.has(student.id)),
    );
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const studentStats = new Map(eligibleStudents.map((student) => [
      student.id,
      {
        ...student,
        present: 0,
        absent: 0,
        leave: 0,
        sessionsHeld: sessions.filter((session) =>
          isStudentActiveOnDate(student, session.session_date),
        ).length,
        attendanceByDate: new Map(),
      },
    ]));
    attendance.forEach((record) => {
      const student = studentStats.get(record.student_id);
      const session = sessionById.get(record.session_id);
      if (!student || !session || !isStudentActiveOnDate(student, session.session_date)) return;
      if (record.attendance_status === "Present") student.present += 1;
      if (record.attendance_status === "Absent") student.absent += 1;
      if (record.attendance_status === "Leave") student.leave += 1;
      if (!student.attendanceByDate.has(session.session_date)) {
        student.attendanceByDate.set(session.session_date, []);
      }
      student.attendanceByDate.get(session.session_date).push(record.attendance_status);
    });

    const rows = [...studentStats.values()]
      .filter((student) => student.sessionsHeld > 0)
      .map((student) => ({
        ...student,
        percentage: (student.present / student.sessionsHeld) * 100,
      }))
      .sort((a, b) =>
        getRollNumberVal(a.roll_number) - getRollNumberVal(b.roll_number)
        || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }),
      );
    renderReport(rows, sessions, dateFrom, dateTo);
  } catch (error) {
    if (requestId !== requestVersion) return;
    console.error("Supabase Report Fetch Error:", error);
    console.error("Report fetch context:", {
      step: fetchStep,
      classId,
      subjectId,
      dateFrom,
      dateTo,
    });
    clearReport("No records found for this period");
  } finally {
    if (requestId === requestVersion) rowsElement.setAttribute("aria-busy", "false");
  }
}

function showExportToast(message, isError = false) {
  let toast = document.querySelector("[data-report-export-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "class-toast";
    toast.dataset.reportExportToast = "";
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }

  toast.classList.toggle("is-error", isError);
  toast.setAttribute("role", isError ? "alert" : "status");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(exportToastTimer);
  exportToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function getFilenamePart(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "class";
}

function exportReport() {
  try {
    if (
      !XLSX?.utils?.aoa_to_sheet
      || !XLSX.utils.book_new
      || !XLSX.utils.book_append_sheet
      || !XLSX.write
    ) {
      throw new Error("The Excel export library did not load correctly. Refresh the page and try again.");
    }

    if (!reportRows.length) {
      throw new Error("There is no attendance data to export for the selected filters.");
    }

    const selectedClass = classSelect.selectedOptions[0]?.textContent?.trim();
    const selectedSubject = subjectSelect.selectedOptions[0]?.textContent?.trim();
    const dateFrom = fromInput.value;
    const dateTo = toInput.value;
    if (!selectedClass || !selectedSubject || !dateFrom || !dateTo || dateFrom > dateTo) {
      throw new Error("Select a class, subject, and valid date range before exporting.");
    }

    const headers = [
      "Student Name",
      "Roll Number",
      "Present",
      "Absent",
      "Leave",
      "Attendance %",
      "Status",
    ];
    const studentRows = reportRows.map((student) => [
      student.full_name,
      student.roll_number,
      student.present,
      student.absent,
      student.leave,
      student.percentage / 100,
      getAttendanceStatus(student.percentage),
    ]);
    const averageAttendance = reportRows.reduce(
      (total, student) => total + student.percentage,
      0,
    ) / reportRows.length;
    const generatedAt = new Date();
    const timestamp = [
      generatedAt.getHours(),
      generatedAt.getMinutes(),
      generatedAt.getSeconds(),
    ].map((part) => String(part).padStart(2, "0")).join("");
    const generatedDate = localDateValue(generatedAt);
    const worksheetData = [
      ["Attendify Pro - Attendance Report"],
      ["Class", selectedClass],
      ["Subject", selectedSubject],
      ["Date Range", `${dateFrom} to ${dateTo}`],
      ["Required Target %", attendanceTarget / 100],
      [],
      headers,
      ...studentRows,
      [
        "SUMMARY",
        `Total Students: ${reportRows.length}`,
        `Total Sessions: ${reportSessionCount}`,
        "",
        "",
        averageAttendance / 100,
        "Class Average Attendance %",
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    const targetCell = ws.B5;
    if (targetCell) targetCell.z = "0.0%";
    studentRows.forEach((_, index) => {
      const percentageCell = ws[XLSX.utils.encode_cell({ r: 7 + index, c: 5 })];
      if (percentageCell) percentageCell.z = "0.0%";
    });
    const averageCell = ws[XLSX.utils.encode_cell({ r: 7 + studentRows.length, c: 5 })];
    if (averageCell) averageCell.z = "0.0%";
    ws["!cols"] = [
      { wch: 30 },
      { wch: Math.max(18, selectedClass.length + 2) },
      { wch: Math.max(18, selectedSubject.length + 2) },
      { wch: 15 },
      { wch: 14 },
      { wch: 15 },
      { wch: 26 },
    ];
    ws["!autofilter"] = {
      ref: `A7:G${6 + studentRows.length}`,
    };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
    const filename =
      `attendance-report-${getFilenamePart(selectedClass)}-${generatedDate}-${timestamp}.xlsx`;
    const workbookData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const workbookBlob = new Blob([workbookData], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const downloadUrl = URL.createObjectURL(workbookBlob);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = filename;
    downloadLink.hidden = true;
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showExportToast("Excel report downloaded successfully");
  } catch (error) {
    console.error("Could not export attendance report:", error);
    showExportToast(
      error instanceof Error
        ? error.message
        : "The Excel report could not be downloaded. Please try again.",
      true,
    );
  }
}

async function initialize() {
  const required = [
    ["[data-report-class]", classSelect],
    ["[data-report-subject]", subjectSelect],
    ["[data-report-from]", fromInput],
    ["[data-report-to]", toInput],
    ["[data-report-rows]", rowsElement],
    ["[data-report-description]", description],
    ["#export-excel-btn", exportButton],
    ["[data-report-sessions]", sessionCountElement],
    ["[data-report-students]", studentCountElement],
    ["[data-report-calendar]", calendarDialog],
    ["[data-calendar-grid]", calendarGrid],
    ["[data-calendar-month]", calendarMonthLabel],
    ["[data-calendar-previous]", calendarPreviousButton],
    ["[data-calendar-next]", calendarNextButton],
    ["[data-calendar-close]", calendarDialog?.querySelector("[data-calendar-close]")],
    ["[data-calendar-student-name]", calendarDialog?.querySelector("[data-calendar-student-name]")],
    ["[data-calendar-roll-number]", calendarDialog?.querySelector("[data-calendar-roll-number]")],
    ["[data-calendar-sessions]", calendarDialog?.querySelector("[data-calendar-sessions]")],
    ["[data-calendar-present]", calendarDialog?.querySelector("[data-calendar-present]")],
    ["[data-calendar-absent]", calendarDialog?.querySelector("[data-calendar-absent]")],
    ["[data-calendar-leave]", calendarDialog?.querySelector("[data-calendar-leave]")],
    ["[data-calendar-percentage]", calendarDialog?.querySelector("[data-calendar-percentage]")],
  ];
  const missing = required.filter(([, element]) => !element).map(([selector]) => selector);
  if (missing.length) throw new Error(`Reports page is missing: ${missing.join(", ")}`);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  teacherId = user.id;
  attendanceTarget = loadAttendanceTarget(user.id);
  [...thresholdLabels, ...legendTargets].forEach((label) => {
    label.textContent = `${attendanceTarget}%`;
  });

  const today = new Date();
  fromInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  toInput.value = localDateValue(today);

  await loadClasses();
  rowsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-student]");
    if (!button) return;
    const student = reportRows.find((row) => row.id === button.dataset.calendarStudent);
    if (student) openStudentCalendar(student);
  });
  calendarPreviousButton.addEventListener("click", () => {
    if (!calendarMonth || compareMonths(calendarMonth, calendarMinimumMonth) <= 0) return;
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendarMonth();
  });
  calendarNextButton.addEventListener("click", () => {
    if (!calendarMonth || compareMonths(calendarMonth, calendarMaximumMonth) >= 0) return;
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendarMonth();
  });
  calendarDialog.querySelector("[data-calendar-close]").addEventListener("click", () => {
    calendarDialog.close();
  });
  calendarDialog.addEventListener("click", (event) => {
    if (event.target === calendarDialog) calendarDialog.close();
  });
  classSelect.addEventListener("change", () => {
    const selectedClassId = classSelect.value;
    loadSubjects().catch((error) => {
      if (selectedClassId !== classSelect.value) return;
      console.error("Could not load report subjects:", error);
      subjectSelect.replaceChildren(new Option("Subjects unavailable", ""));
      subjectSelect.disabled = true;
      clearReport("Subjects could not be loaded. Check your connection or access, then try again.");
    });
  });
  subjectSelect.addEventListener("change", () => {
    void loadStudentAttendance();
  });
  [fromInput, toInput].forEach((input) => {
    input.addEventListener("change", () => {
      void loadStudentAttendance();
    });
  });
}

exportButton?.addEventListener("click", exportReport);

void initialize().catch((error) => {
  console.error("Could not initialize student attendance:", error);
  showRowsMessage("Student attendance could not be loaded. Check your connection or access, then reload.");
  classSelect.replaceChildren(new Option("Attendance unavailable", ""));
  classSelect.disabled = true;
});
