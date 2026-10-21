import { supabase } from "./supabaseClient.js";

const classSelect = document.querySelector("[data-register-class]");
const dateInput = document.querySelector("[data-register-date]");
const subjectSelect = document.querySelector("[data-register-subject]");
const sessionSelect = document.querySelector("[data-register-session]");
const deleteSessionButton = document.querySelector("[data-delete-session]");
const createSessionButton = document.querySelector("[data-create-session]");
const createSessionControls = document.querySelector("[data-register-create-session-controls]");
const rowsContainer = document.querySelector("[data-register-rows]");
const saveButton = document.querySelector("[data-save-register]");
const markAllButton = document.querySelector("[data-mark-all]");
const searchInput = document.querySelector("[data-register-search]");
const saveStatus = document.querySelector("[data-register-save-status]");
const studentCount = document.querySelector("[data-register-student-count]");
const classInfo = document.querySelector("[data-register-class-info]");

const attendanceValues = ["Present", "Absent", "Leave", "Not Marked"];
const avatarClasses = ["avatar-lilac", "avatar-blue", "avatar-peach", "avatar-green", "avatar-yellow", "avatar-pink"];

let teacherId = null;
let students = [];
let attendanceByStudent = new Map();
let loadedSessions = [];
let toastTimer = 0;
let requestVersion = 0;
let attendanceSaveInProgress = false;

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function isStudentActiveOnDate(student, sessionDate) {
  const createdDate = student.created_at?.slice(0, 10);
  const deletedDate = student.deleted_at?.slice(0, 10);
  if (createdDate && createdDate > sessionDate) return false;
  if (deletedDate) return deletedDate >= sessionDate;
  return student.status === "active";
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

function sortStudentsByRollNumber(studentList) {
  return studentList.sort((a, b) =>
    getRollNumberVal(a.roll_number) - getRollNumberVal(b.roll_number)
    || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }),
  );
}

function showToast(message, kind = "success") {
  const toast = document.querySelector("[data-attendance-toast]");
  if (!toast) {
    console.error("Attendance toast element is missing.");
    return;
  }
  toast.textContent = message;
  toast.classList.toggle("is-error", kind === "error");
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function showRowsMessage(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 3;
  cell.className = "register-empty-cell";
  cell.textContent = message;
  row.append(cell);
  rowsContainer.replaceChildren(row);
}

function updateCounts() {
  const counts = Object.fromEntries(attendanceValues.map((status) => [status, 0]));
  students.forEach((student) => {
    const status = attendanceByStudent.get(student.id) ?? "Not Marked";
    counts[status] += 1;
  });
  Object.entries(counts).forEach(([status, count]) => {
    const output = document.querySelector(`[data-count="${status}"]`);
    if (output) output.textContent = String(count);
  });
}

function getVisibleStudents() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  return students.filter((student) =>
    `${student.full_name} ${student.roll_number}`.toLocaleLowerCase().includes(query),
  );
}

function renderRegister() {
  if (!students.length) {
    showRowsMessage("No active students are enrolled in this class.");
    studentCount.textContent = "· 0 students";
    saveButton.disabled = true;
    markAllButton.disabled = true;
    updateCounts();
    return;
  }

  const visibleStudents = getVisibleStudents();
  if (!visibleStudents.length) {
    showRowsMessage("No students match your search.");
  } else {
    const fragment = document.createDocumentFragment();
    visibleStudents.forEach((student, index) => {
      const row = document.createElement("tr");
      row.dataset.studentRow = student.id;

      const identityCell = document.createElement("td");
      const identity = document.createElement("div");
      identity.className = "student-cell";
      const initials = student.full_name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toLocaleUpperCase() ?? "")
        .join("");
      const avatar = document.createElement("span");
      avatar.className = `student-avatar ${avatarClasses[index % avatarClasses.length]}`;
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = initials || "?";
      const nameContainer = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = student.full_name;
      const secondary = document.createElement("small");
      secondary.textContent = "Student";
      nameContainer.append(name, secondary);
      identity.append(avatar, nameContainer);
      identityCell.append(identity);

      const rollCell = document.createElement("td");
      rollCell.textContent = student.roll_number;

      const statusCell = document.createElement("td");
      const group = document.createElement("div");
      group.className = "attendance-choice-group";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", `Attendance status for ${student.full_name}`);
      const savedStatus = attendanceByStudent.get(student.id) ?? "Not Marked";

      ["Present", "Absent", "Leave"].forEach((status) => {
        const label = document.createElement("label");
        label.className = `attendance-choice attendance-choice-${status.toLocaleLowerCase()}`;
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `attendance-${student.id}`;
        input.value = status;
        input.dataset.attendanceStatus = "";
        input.dataset.studentId = student.id;
        input.checked = status === savedStatus;
        label.classList.toggle("is-selected", input.checked);
        const text = document.createElement("span");
        text.textContent = status;
        label.append(input, text);
        group.append(label);

        input.addEventListener("change", () => {
          attendanceByStudent.set(student.id, status);
          group.querySelectorAll(".attendance-choice").forEach((choice) => {
            choice.classList.toggle("is-selected", choice.contains(input));
          });
          saveStatus.textContent = "Unsaved changes";
          updateCounts();
        });
      });
      statusCell.append(group);
      row.append(identityCell, rollCell, statusCell);
      fragment.append(row);
    });
    rowsContainer.replaceChildren(fragment);
  }

  studentCount.textContent = `· ${students.length} ${students.length === 1 ? "student" : "students"}`;
  saveButton.disabled = students.length === 0;
  markAllButton.disabled = students.length === 0;
  updateCounts();
}

async function loadClasses() {
  classSelect.disabled = true;
  classSelect.replaceChildren(new Option("Loading classes…", ""));

  const { data, error } = await supabase
    .from("classes")
    .select("id, name, section, academic_year")
    .eq("teacher_id", teacherId)
    .eq("status", "active")
    .order("academic_year", { ascending: false })
    .order("name")
    .order("section");

  if (error) throw error;

  classSelect.replaceChildren(new Option("Choose a class", ""));
  (data ?? []).forEach((classRow) => {
    const option = new Option(
      `${classRow.name} · ${classRow.section} (${classRow.academic_year})`,
      classRow.id,
    );
    classSelect.append(option);
  });
  classSelect.disabled = false;

  if (!data?.length) {
    classSelect.disabled = true;
    classSelect.replaceChildren(new Option("No active classes available", ""));
    showRowsMessage("Add an active class and students before taking attendance.");
  }
}

async function loadSessions(preferredSessionId = null) {
  const classId = classSelect.value;
  const subjectId = subjectSelect.value;
  const selectedDate = dateInput.value;
  const version = ++requestVersion;

  sessionSelect.disabled = true;
  deleteSessionButton.disabled = true;
  sessionSelect.replaceChildren(new Option("Choose a class and subject first", ""));
  loadedSessions = [];
  createSessionControls.hidden = !classId || !subjectId || !selectedDate;
  createSessionButton.disabled = !classId || !subjectId || !selectedDate;
  students = [];
  attendanceByStudent.clear();
  renderRegister();
  saveButton.disabled = true;
  saveStatus.textContent = "Changes haven’t been saved.";

  if (!classId || !subjectId || !selectedDate) {
    if (classId && !subjectId) {
      sessionSelect.replaceChildren(new Option("Choose a subject first", ""));
      showRowsMessage("Choose a subject to load or create its sessions.");
      studentCount.textContent = "· Select a subject";
    } else {
      sessionSelect.replaceChildren(new Option("Select a class and date", ""));
    }
    createSessionControls.hidden = true;
    deleteSessionButton.disabled = true;
    updateClassInfo();
    return;
  }

  let data;
  try {
    const result = await supabase
      .from("class_sessions")
      .select("id, class_id, subject_id, session_date, title, status, created_by, created_at")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("session_date", selectedDate)
      .eq("created_by", teacherId)
      .neq("status", "cancelled")
      .order("created_at");
    if (version !== requestVersion) return;
    if (result.error) throw result.error;
    data = result.data ?? [];
    loadedSessions = data;
  } catch (error) {
    if (version !== requestVersion) return;
    console.error("Could not load class sessions:", error);
    sessionSelect.replaceChildren(new Option("Sessions unavailable", ""));
    sessionSelect.disabled = true;
    showRowsMessage("Sessions couldn’t be loaded. Check your connection and session access, then try again.");
    studentCount.textContent = "· Sessions unavailable";
    createSessionControls.hidden = false;
    createSessionButton.disabled = false;
    updateClassInfo();
    showToast("Couldn’t load sessions. Please try again.", "error");
    return;
  }

  createSessionControls.hidden = false;
  createSessionButton.disabled = false;
  createSessionButton.textContent = "Create Session";

  if (!data.length) {
    sessionSelect.replaceChildren(new Option("No sessions for this date", ""));
    sessionSelect.disabled = true;
    deleteSessionButton.disabled = true;
    showRowsMessage("No sessions exist for this date yet. Create a session to load the student roster.");
    studentCount.textContent = "· No session";
    updateClassInfo();
    return;
  }

  sessionSelect.replaceChildren(new Option("Choose a session", ""));
  data.forEach((session, index) => {
    sessionSelect.append(new Option(`Lac-${index + 1}`, session.id));
  });
  sessionSelect.disabled = false;
  sessionSelect.value = data.some((session) => session.id === preferredSessionId)
    ? preferredSessionId
    : data[0].id;
  deleteSessionButton.disabled = !sessionSelect.value;
  const selectedIndex = data.findIndex((session) => session.id === sessionSelect.value);
  const selectedSession = {
    ...data[selectedIndex],
    title: `Lac-${selectedIndex + 1}`,
  };
  updateClassInfo(selectedSession);
  await loadRegister();
}

async function loadSubjects(preferredSubjectId = null) {
  const classId = classSelect.value;
  const version = ++requestVersion;

  subjectSelect.disabled = true;
  subjectSelect.replaceChildren(new Option(
    classId ? "Loading subjects…" : "Select a class first",
    "",
  ));
  sessionSelect.disabled = true;
  sessionSelect.replaceChildren(new Option("Choose a subject first", ""));
  deleteSessionButton.disabled = true;
  createSessionControls.hidden = true;
  createSessionButton.disabled = true;
  students = [];
  attendanceByStudent.clear();
  saveButton.disabled = true;
  markAllButton.disabled = true;
  saveStatus.textContent = "Changes haven’t been saved.";
  showRowsMessage("Choose a class and subject to load its sessions.");
  studentCount.textContent = "· Select a subject";
  updateCounts();

  if (!classId) {
    updateClassInfo();
    return;
  }

  const { data, error } = await supabase
    .from("subjects")
    .select("id, name, code")
    .eq("class_id", classId)
    .order("name");
  if (version !== requestVersion) return;
  if (error) throw error;

  subjectSelect.replaceChildren(new Option("Choose a subject", ""));
  (data ?? []).forEach((subject) => {
    subjectSelect.append(new Option(subject.name, subject.id));
  });
  subjectSelect.disabled = !data?.length;

  if (!data?.length) {
    subjectSelect.replaceChildren(new Option("No subjects available", ""));
    showRowsMessage("Add a subject to this class before taking attendance.");
    studentCount.textContent = "· No subjects";
    updateClassInfo();
    return;
  }

  if (preferredSubjectId && data.some((subject) => subject.id === preferredSubjectId)) {
    subjectSelect.value = preferredSubjectId;
    await loadSessions();
  } else {
    updateClassInfo();
  }
}

function updateClassInfo(session = null) {
  const classRow = [...classSelect.options]
    .filter((option) => option.value)
    .map((option) => ({ id: option.value, label: option.textContent }))
    .find((item) => item.id === classSelect.value);
  const content = classInfo.querySelector("span:last-child");
  const icon = classInfo.querySelector(".class-icon");
  content.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = classRow?.label ?? "Select a class";
  const subtitle = document.createElement("small");
  const subjectName = subjectSelect.selectedOptions[0]?.textContent;
  subtitle.textContent = session
    ? `${session.title} · ${session.session_date}`
    : classRow
      ? `${subjectName && subjectSelect.value ? `${subjectName} · ` : ""}${dateInput.value || "Choose a date"}`
      : "Choose a class and date";
  const gradeNumber = classRow?.label.match(/\d+/)?.[0] ?? "—";
  icon.textContent = gradeNumber;
  content.append(title, subtitle);
}

async function loadRegister() {
  const sessionId = sessionSelect.value;
  const classId = classSelect.value;
  const version = ++requestVersion;

  students = [];
  attendanceByStudent.clear();
  saveButton.disabled = true;
  markAllButton.disabled = true;
  saveStatus.textContent = "Changes haven’t been saved.";
  updateCounts();

  if (!sessionId || !classId || !subjectSelect.value) {
    deleteSessionButton.disabled = true;
    deleteSessionButton.disabled = true;
    showRowsMessage("Choose a class, subject, and session to load its roster.");
    studentCount.textContent = "· Select a class, subject, and session";
    return;
  }

  showRowsMessage("Loading sessions, active students, and saved attendance…");

  try {
    const session = loadedSessions.find((item) =>
      item.id === sessionId
      && item.class_id === classId
      && item.subject_id === subjectSelect.value
      && item.session_date === dateInput.value
      && item.created_by === teacherId
      && item.status !== "cancelled",
    );
    if (!session) {
      students = [];
      attendanceByStudent.clear();
      sessionSelect.replaceChildren(new Option("No sessions for this date", ""));
      sessionSelect.disabled = true;
      deleteSessionButton.disabled = true;
      createSessionControls.hidden = false;
      createSessionButton.disabled = false;
      showRowsMessage("No active session exists for this selection. Create a session to take attendance.");
      studentCount.textContent = "· No active session";
      updateClassInfo();
      return;
    }

    const { data: fetchedStudents, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("teacher_id", teacherId)
      .eq("class_id", classId)
      .eq("status", "active")
      .order("roll_number");
    console.log("Fetched students for register:", fetchedStudents, studentError);
    if (version !== requestVersion) return;
    if (studentError) throw studentError;

    const activeStudents = fetchedStudents ?? [];
    // attendance_records has no teacher_id; the selected session is owner-checked above and RLS scopes this query.
    const { data: attendanceData, error: attendanceError } = await supabase
      .from("attendance_records")
      .select("student_id, attendance_status")
      .eq("session_id", session.id);
    if (version !== requestVersion) return;
    if (attendanceError) throw attendanceError;

    attendanceByStudent = new Map(
      (attendanceData ?? []).map((record) => [record.student_id, record.attendance_status]),
    );
    const studentsById = new Map(activeStudents.map((student) => [student.id, student]));
    const historicalStudentIds = [...attendanceByStudent.keys()]
      .filter((studentId) => !studentsById.has(studentId));
    for (let offset = 0; offset < historicalStudentIds.length; offset += 100) {
      const studentIds = historicalStudentIds.slice(offset, offset + 100);
      const { data, error } = await supabase
        .from("students")
        .select("id, class_id, roll_number, full_name, status, created_at, deleted_at")
        .eq("teacher_id", teacherId)
        .in("id", studentIds);
      if (version !== requestVersion) return;
      if (error) throw error;
      (data ?? []).forEach((student) => studentsById.set(student.id, student));
    }

    students = sortStudentsByRollNumber(
      [...studentsById.values()].filter((student) =>
        (student.class_id === classId || attendanceByStudent.has(student.id))
        && isStudentActiveOnDate(student, session.session_date),
      ),
    );
    renderRegister();
    saveStatus.textContent = "Showing saved attendance.";
  } catch (error) {
    if (version !== requestVersion) return;
    console.error("Could not load the attendance register data:", error);
    students = [];
    attendanceByStudent.clear();
    showRowsMessage("Couldn’t load this register. Check your connection and teacher access, then try again.");
    studentCount.textContent = "· Roster unavailable";
    saveButton.disabled = true;
    markAllButton.disabled = true;
    showToast("Couldn’t load attendance data. Please try again.", "error");
  }
}

async function saveAttendance() {
  const sessionId = sessionSelect.value;
  if (attendanceSaveInProgress) return;
  if (!teacherId || !sessionId || !students.length) {
    showToast("Choose a class session with students before saving.", "error");
    return;
  }

  attendanceSaveInProgress = true;
  const buttonLabel = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  saveButton.setAttribute("aria-busy", "true");
  markAllButton.disabled = true;
  const filterControls = [classSelect, dateInput, subjectSelect, sessionSelect];
  const previousDisabledStates = filterControls.map((control) => control.disabled);
  filterControls.forEach((control) => {
    control.disabled = true;
  });
  rowsContainer.querySelectorAll("[data-attendance-status]").forEach((select) => {
    select.disabled = true;
  });
  saveStatus.textContent = "Saving attendance…";
  let savedRecordCount = 0;

  try {
    const records = students.map((student) => {
      const currentStatus = attendanceByStudent.get(student.id);
      const attendanceStatus = !currentStatus || currentStatus === "Not Marked"
        ? "Absent"
        : currentStatus;
      if (!attendanceValues.includes(attendanceStatus)) {
        throw new Error(`Invalid attendance status for student ${student.id}.`);
      }

      return {
        session_id: sessionId,
        student_id: student.id,
        attendance_status: attendanceStatus,
      };
    });

    const studentsById = new Map(students.map((student) => [student.id, student]));
    const currentClassRecords = records.filter((record) =>
      studentsById.get(record.student_id)?.class_id === classSelect.value,
    );
    const historicalRecords = records.filter((record) =>
      studentsById.get(record.student_id)?.class_id !== classSelect.value,
    );

    if (currentClassRecords.length) {
      const { error } = await supabase
        .from("attendance_records")
        .upsert(currentClassRecords, {
          onConflict: "session_id,student_id",
          ignoreDuplicates: false,
        });
      if (error) throw error;
      savedRecordCount += currentClassRecords.length;
    }

    const historicalByStatus = new Map();
    historicalRecords.forEach((record) => {
      if (!historicalByStatus.has(record.attendance_status)) {
        historicalByStatus.set(record.attendance_status, []);
      }
      historicalByStatus.get(record.attendance_status).push(record.student_id);
    });
    for (const [attendanceStatus, studentIds] of historicalByStatus) {
      for (let offset = 0; offset < studentIds.length; offset += 100) {
        const { data, error } = await supabase
          .from("attendance_records")
          .update({ attendance_status: attendanceStatus })
          .eq("session_id", sessionId)
          .in("student_id", studentIds.slice(offset, offset + 100))
          .select("student_id");
        if (error) throw error;
        savedRecordCount += data?.length ?? 0;
      }
    }

    records.forEach((record) => {
      attendanceByStudent.set(record.student_id, record.attendance_status);
    });
    renderRegister();
    console.info(`Attendance saved: ${records.length} records for session ${sessionId}.`);
    saveStatus.textContent = `Saved ${records.length} attendance records at ${new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date())}.`;
    showToast(`Attendance saved for ${records.length} ${records.length === 1 ? "student" : "students"}.`);
  } catch (error) {
    console.error("Could not save attendance:", error);
    saveStatus.textContent = "Attendance could not be saved.";
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
    showToast(
      savedRecordCount > 0
        ? `Attendance was partially saved (${savedRecordCount} records). Reload the register before continuing.`
        : errorMessage.includes("row-level security")
          ? "Supabase denied this save. Check the attendance_records RLS policy for this session and class."
          : errorMessage.includes("invalid attendance status")
            ? "Attendance wasn’t saved because a status value was invalid. Reload the register and try again."
            : "Attendance wasn’t saved. Check your connection and try again.",
      "error",
    );
  } finally {
    attendanceSaveInProgress = false;
    filterControls.forEach((control, index) => {
      control.disabled = previousDisabledStates[index];
    });
    rowsContainer.querySelectorAll("[data-attendance-status]").forEach((select) => {
      select.disabled = false;
    });
    markAllButton.disabled = students.length === 0;
    saveButton.disabled = students.length === 0;
    saveButton.textContent = buttonLabel;
    saveButton.removeAttribute("aria-busy");
  }
}

function initializeControls() {
  dateInput.value = localDateValue();
  document.querySelector("[data-register-date-label]").textContent =
    new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      .format(new Date(`${dateInput.value}T12:00:00`))
      .toLocaleUpperCase();

  classSelect.addEventListener("change", () => {
    runLoadAction(loadSubjects);
  });
  dateInput.addEventListener("change", () => {
    document.querySelector("[data-register-date-label]").textContent =
      dateInput.value
        ? new Intl.DateTimeFormat("en", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })
            .format(new Date(`${dateInput.value}T12:00:00`))
            .toLocaleUpperCase()
        : "ATTENDANCE REGISTER";
    runLoadAction(loadSessions);
  });
  subjectSelect.addEventListener("change", () => {
    runLoadAction(loadSessions);
  });
  sessionSelect.addEventListener("change", () => {
    deleteSessionButton.disabled = !sessionSelect.value;
    runLoadAction(() => {
      const option = sessionSelect.selectedOptions[0];
      const session = option?.value
        ? { title: option.textContent, session_date: dateInput.value }
        : null;
      updateClassInfo(session);
      return loadRegister();
    });
  });
  searchInput.addEventListener("input", () => runLoadAction(renderRegister));
  saveButton.addEventListener("click", () => {
    void saveAttendance().catch(handleSaveError);
  });
  markAllButton.addEventListener("click", () => {
    try {
      students.forEach((student) => attendanceByStudent.set(student.id, "Present"));
      renderRegister();
      saveStatus.textContent = "Unsaved changes";
    } catch (error) {
      handleLoadError(error);
    }
  });
  createSessionButton.addEventListener("click", () => {
    void createSession().catch(handleLoadError);
  });
  deleteSessionButton.addEventListener("click", () => {
    void deleteSession().catch(handleLoadError);
  });
}

async function deleteSession() {
  const sessionId = sessionSelect.value;
  if (!sessionId) {
    showToast("Choose a session to delete.", "error");
    return;
  }
  if (attendanceSaveInProgress) {
    showToast("Wait for attendance saving to finish before deleting this session.", "error");
    return;
  }
  if (!window.confirm("Delete this session and all attendance records linked to it? This cannot be undone.")) {
    return;
  }

  const classId = classSelect.value;
  const subjectId = subjectSelect.value;
  const selectedDate = dateInput.value;
  const controls = [classSelect, dateInput, subjectSelect, createSessionButton];
  const previousDisabledStates = controls.map((control) => control.disabled);
  controls.forEach((control) => {
    control.disabled = true;
  });
  deleteSessionButton.disabled = true;
  deleteSessionButton.setAttribute("aria-busy", "true");

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (user.id !== teacherId) {
      throw new Error("The signed-in account changed. Reload the page and try again.");
    }

    const { data, error } = await supabase
      .from("class_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("session_date", selectedDate)
      .eq("created_by", user.id)
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("The session was not found or could not be deleted.");

    students = [];
    attendanceByStudent.clear();
    await loadSessions();
    showToast("Session and its attendance records deleted.");
  } catch (error) {
    console.error("Could not delete the class session:", error);
    showToast(error instanceof Error ? error.message : "Could not delete the session.", "error");
  } finally {
    controls.forEach((control, index) => {
      control.disabled = previousDisabledStates[index];
    });
    deleteSessionButton.disabled = !sessionSelect.value || sessionSelect.disabled;
    deleteSessionButton.removeAttribute("aria-busy");
  }
}

async function createSession() {
  if (!classSelect.value || !subjectSelect.value || !dateInput.value) {
    showToast("Choose a class, subject, and date before creating a session.", "error");
    return;
  }

  const classId = classSelect.value;
  const subjectId = subjectSelect.value;
  const selectedDate = dateInput.value;
  const filterControls = [classSelect, dateInput, subjectSelect];
  const previousDisabledStates = filterControls.map((control) => control.disabled);
  const previousSessionDisabled = sessionSelect.disabled;
  filterControls.forEach((control) => {
    control.disabled = true;
  });
  sessionSelect.disabled = true;
  let sessionsReloaded = false;
  createSessionButton.disabled = true;
  createSessionButton.setAttribute("aria-busy", "true");
  const previousText = createSessionButton.textContent;
  createSessionButton.textContent = "Creating session…";

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (user.id !== teacherId) {
      throw new Error("The signed-in account changed. Reload the page and try again.");
    }

    const { data: existingSessions, error: existingSessionsError } = await supabase
      .from("class_sessions")
      .select("id")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .eq("session_date", selectedDate)
      .eq("created_by", user.id);
    if (existingSessionsError) throw existingSessionsError;

    const title = `Lac-${(existingSessions ?? []).length + 1}`;

    const { data, error } = await supabase
      .from("class_sessions")
      .insert({
        class_id: classId,
        subject_id: subjectId,
        session_date: selectedDate,
        title,
        start_time: "09:00",
        end_time: "10:00",
        created_by: user.id,
      })
      .select("id, class_id, subject_id, session_date, title, status, created_by, created_at")
      .single();

    if (error) throw error;
    try {
      await loadSessions(data.id);
      sessionsReloaded = true;
    } catch (error) {
      console.error("Session was created but its roster could not be loaded:", error);
      showToast("Session created, but the student roster could not be loaded.", "error");
      return;
    }
    showToast("Session created. The student roster is ready.");
  } catch (error) {
    console.error("Could not create the class session:", error);
    showToast(error instanceof Error ? error.message : "Could not create the class session.", "error");
    createSessionButton.textContent = previousText;
  } finally {
    filterControls.forEach((control, index) => {
      control.disabled = previousDisabledStates[index];
    });
    if (!sessionsReloaded) sessionSelect.disabled = previousSessionDisabled;
    createSessionButton.disabled = false;
    createSessionButton.removeAttribute("aria-busy");
  }
}

function handleLoadError(error) {
  console.error("Could not load the attendance register:", error);
  showRowsMessage("Couldn’t load this register. Check your connection and Supabase RLS policies, then try again.");
  saveButton.disabled = true;
  markAllButton.disabled = true;
  showToast("Couldn’t load attendance data. Please try again.", "error");
}

function handleSaveError(error) {
  console.error("Attendance save action failed unexpectedly:", error);
  saveStatus.textContent = "Attendance could not be saved.";
  showToast("Attendance wasn’t saved. Please try again.", "error");
}

function runLoadAction(action) {
  try {
    Promise.resolve(action()).catch(handleLoadError);
  } catch (error) {
    handleLoadError(error);
  }
}

async function initialize() {
  const requiredElements = [
    ["[data-register-class]", classSelect],
    ["[data-register-date]", dateInput],
    ["[data-register-subject]", subjectSelect],
    ["[data-register-session]", sessionSelect],
    ["[data-delete-session]", deleteSessionButton],
    ["[data-create-session]", createSessionButton],
    ["[data-register-create-session-controls]", createSessionControls],
    ["[data-register-rows]", rowsContainer],
    ["[data-save-register]", saveButton],
    ["[data-mark-all]", markAllButton],
    ["[data-register-search]", searchInput],
    ["[data-register-save-status]", saveStatus],
    ["[data-register-student-count]", studentCount],
    ["[data-register-class-info]", classInfo],
    ["[data-register-date-label]", document.querySelector("[data-register-date-label]")],
    ["[data-attendance-toast]", document.querySelector("[data-attendance-toast]")],
    ...["Present", "Absent", "Leave", "Not Marked"].map((status) => [
      `[data-count="${status}"]`,
      document.querySelector(`[data-count="${status}"]`),
    ]),
  ];
  const missingElements = requiredElements
    .filter(([, element]) => !element)
    .map(([selector]) => selector);
  if (missingElements.length) {
    console.error(`Attendance page is missing required elements: ${missingElements.join(", ")}`);
    return;
  }

  initializeControls();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    if (error) console.error("Could not verify the signed-in teacher:", error);
    window.location.replace("login.html");
    return;
  }

  teacherId = data.user.id;
  await loadClasses();
  if (classSelect.value) await loadSessions();
}

void initialize().catch(handleLoadError);
