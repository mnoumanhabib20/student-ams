import { supabase } from "./supabaseClient.js";

const dashboard = {
  date: document.querySelector("[data-dashboard-date]"),
  totalStudents: document.querySelector("[data-dashboard-total-students]"),
  present: document.querySelector("[data-dashboard-present]"),
  absent: document.querySelector("[data-dashboard-absent]"),
  leave: document.querySelector("[data-dashboard-leave]"),
  presentLegend: document.querySelector("[data-dashboard-present-legend]"),
  absentLegend: document.querySelector("[data-dashboard-absent-legend]"),
  leaveLegend: document.querySelector("[data-dashboard-leave-legend]"),
  unmarked: document.querySelector("[data-dashboard-unmarked]"),
  totalClasses: document.querySelector("[data-dashboard-total-classes]"),
  rate: document.querySelector("[data-dashboard-rate]"),
  chart: document.querySelector("[data-dashboard-chart]"),
  progress: document.querySelector("[data-dashboard-progress]"),
  status: document.querySelector("[data-dashboard-status]"),
};

let dashboardDate = "";
let midnightRefreshTimer = 0;

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function scheduleMidnightRefresh() {
  window.clearTimeout(midnightRefreshTimer);
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  midnightRefreshTimer = window.setTimeout(() => {
    window.location.reload();
  }, Math.max(0, nextMidnight.getTime() - now.getTime() + 100));
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value);
}

function makeProgressRow(classRow, marked, total, hasSession) {
  const row = document.createElement("div");
  row.className = "progress-row";
  const top = document.createElement("div");
  top.className = "progress-row-top";

  const label = document.createElement("span");
  label.textContent = `${classRow.name} · ${classRow.section}`;
  const count = document.createElement("strong");
  count.textContent = hasSession ? `${marked} / ${total} marked` : "Not scheduled";
  top.append(label, count);

  const track = document.createElement("div");
  track.className = `progress-track${marked === 0 ? " progress-track-empty" : ""}`;
  const bar = document.createElement("span");
  bar.style.width = `${total ? Math.round((marked / total) * 100) : 0}%`;
  track.append(bar);
  row.append(top, track);
  return row;
}

function setDashboardUnavailable(message) {
  const messageText = message instanceof Error ? message.message : String(message);
  console.error(`Could not load dashboard data: ${messageText}`);
  dashboard.status.textContent = "Dashboard data could not be loaded. Check your connection and Supabase access policies.";
  dashboard.progress.replaceChildren();
  const error = document.createElement("p");
  error.className = "subject-error";
  error.textContent = "Couldn’t load today’s class attendance.";
  dashboard.progress.append(error);
}

async function loadDashboard() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) {
    window.location.replace("login.html");
    return;
  }
  const teacherId = authData.user.id;

  const date = new Date();
  const dateValue = localDateValue(date);
  dashboardDate = dateValue;
  scheduleMidnightRefresh();
  dashboard.date.textContent = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date).toLocaleUpperCase();

  const { data: classRows, error: classesError } = await supabase
    .from("classes")
    .select("id, name, section, status")
    .eq("teacher_id", teacherId)
    .order("name", { ascending: true })
    .order("section", { ascending: true });
  if (classesError) throw classesError;

  const allClasses = classRows ?? [];
  const classes = allClasses.filter((classRow) => classRow.status === "active");
  const classIds = classes.map((classRow) => classRow.id);
  if (!classIds.length) {
    renderDashboard([], [], [], [], allClasses.length);
    return;
  }

  const [studentsResult, sessionsResult] = await Promise.all([
    supabase
      .from("students")
      .select("id, class_id")
      .eq("teacher_id", teacherId)
      .eq("status", "active")
      .in("class_id", classIds),
    supabase
      .from("class_sessions")
      .select("id, class_id, session_date, start_time, status")
      .eq("created_by", teacherId)
      .eq("session_date", dateValue)
      .neq("status", "cancelled")
      .in("class_id", classIds)
      .order("start_time", { ascending: false }),
  ]);
  if (studentsResult.error) throw studentsResult.error;
  if (sessionsResult.error) throw sessionsResult.error;

  const sessionsByClass = new Map();
  (sessionsResult.data ?? []).forEach((session) => {
    if (!sessionsByClass.has(session.class_id)) {
      sessionsByClass.set(session.class_id, session);
    }
  });

  const latestSessions = [...sessionsByClass.values()];
  let attendanceRows = [];
  if (latestSessions.length) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("session_id, student_id, attendance_status")
      .in("session_id", latestSessions.map((session) => session.id));
    if (error) throw error;
    attendanceRows = data ?? [];
  }

  renderDashboard(classes, studentsResult.data ?? [], latestSessions, attendanceRows, allClasses.length);
}

function renderDashboard(classes, students, sessions, attendanceRows, totalClasses = classes.length) {
  const studentsByClass = new Map();
  const activeStudentIdsByClass = new Map();
  students.forEach((student) => {
    const classStudents = studentsByClass.get(student.class_id) ?? [];
    classStudents.push(student);
    studentsByClass.set(student.class_id, classStudents);

    const activeIds = activeStudentIdsByClass.get(student.class_id) ?? new Set();
    activeIds.add(student.id);
    activeStudentIdsByClass.set(student.class_id, activeIds);
  });

  const sessionByClass = new Map(sessions.map((session) => [session.class_id, session]));
  const classBySession = new Map(sessions.map((session) => [session.id, session.class_id]));
  const attendanceBySession = new Map();
  attendanceRows.forEach((record) => {
    const classId = classBySession.get(record.session_id);
    const activeStudentIds = activeStudentIdsByClass.get(classId);
    if (!activeStudentIds?.has(record.student_id)) return;
    const records = attendanceBySession.get(record.session_id) ?? new Map();
    records.set(record.student_id, record.attendance_status);
    attendanceBySession.set(record.session_id, records);
  });

  const counts = { Present: 0, Absent: 0, Leave: 0, "Not Marked": 0 };
  const totalStudents = students.length;
  classes.forEach((classRow) => {
    const session = sessionByClass.get(classRow.id);
    const registeredStudents = studentsByClass.get(classRow.id) ?? [];
    const register = session ? attendanceBySession.get(session.id) : null;
    registeredStudents.forEach((student) => {
      const status = register?.get(student.id);
      if (status === "Present" || status === "Absent" || status === "Leave") {
        counts[status] += 1;
      } else {
        counts["Not Marked"] += 1;
      }
    });
  });

  dashboard.totalStudents.textContent = formatCount(totalStudents);
  dashboard.totalClasses.textContent = `${formatCount(totalClasses)} total classes`;
  dashboard.present.textContent = formatCount(counts.Present);
  dashboard.absent.textContent = formatCount(counts.Absent);
  dashboard.leave.textContent = formatCount(counts.Leave);
  dashboard.presentLegend.textContent = formatCount(counts.Present);
  dashboard.absentLegend.textContent = formatCount(counts.Absent);
  dashboard.leaveLegend.textContent = formatCount(counts.Leave);
  dashboard.unmarked.textContent = formatCount(counts["Not Marked"]);

  const percentage = totalStudents ? (counts.Present / totalStudents) * 100 : 0;
  const displayPercentage = `${percentage.toFixed(1)}%`;
  dashboard.rate.textContent = displayPercentage;
  dashboard.chart.setAttribute("aria-label", `${displayPercentage} of active students present`);
  const presentStop = percentage;
  const absentStop = presentStop + (totalStudents ? counts.Absent / totalStudents * 100 : 0);
  const leaveStop = absentStop + (totalStudents ? counts.Leave / totalStudents * 100 : 0);
  dashboard.chart.style.background = `conic-gradient(var(--color-present) 0 ${presentStop}%, var(--color-absent) ${presentStop}% ${absentStop}%, var(--color-leave) ${absentStop}% ${leaveStop}%, #e9edf2 ${leaveStop}% 100%)`;

  dashboard.progress.replaceChildren();
  if (!classes.length) {
    const empty = document.createElement("p");
    empty.className = "subject-empty";
    empty.textContent = "Create an active class to see attendance progress.";
    dashboard.progress.append(empty);
  } else {
    classes.forEach((classRow) => {
      const session = sessionByClass.get(classRow.id);
      const register = session ? attendanceBySession.get(session.id) : null;
      const marked = register
        ? [...register.values()].filter((status) =>
          status === "Present" || status === "Absent" || status === "Leave",
        ).length
        : 0;
      dashboard.progress.append(
        makeProgressRow(
          classRow,
          marked,
          (studentsByClass.get(classRow.id) ?? []).length,
          Boolean(session),
        ),
      );
    });
  }
  dashboard.status.textContent = `Live attendance for ${new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date())}.`;
}

function validateDashboard() {
  return Object.entries(dashboard).every(([name, element]) => {
    if (element) return true;
    console.error(`Dashboard is missing its required element: ${name}`);
    return false;
  });
}

if (validateDashboard()) {
  void loadDashboard().catch(setDashboardUnavailable);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && localDateValue() !== dashboardDate) {
      window.location.reload();
    }
  });
}
