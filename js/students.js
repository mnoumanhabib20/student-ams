import { supabase } from "./supabaseClient.js";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const rowsElement = document.querySelector("[data-student-rows]");
const searchInput = document.querySelector("[data-student-search]");
const classFilter = document.querySelector("[data-student-class-filter]");
const studentDialog = document.querySelector("[data-student-dialog]");
const studentForm = document.querySelector("[data-student-form]");
const importDialog = document.querySelector("[data-import-dialog]");
const importForm = document.querySelector("[data-import-form]");

let teacherId = null;
let classes = [];
let students = [];
let toastTimer = 0;
let studentSaveInProgress = false;
let editingStudentId = null;

const avatarClasses = ["avatar-lilac", "avatar-blue", "avatar-peach", "avatar-green", "avatar-yellow", "avatar-pink"];

function showToast(message, kind = "success") {
  const toast = document.querySelector("[data-student-toast]");
  if (!toast) {
    console.error("Student page toast element is missing.");
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

function setFormError(message = "") {
  const element = document.querySelector("[data-student-form-error]");
  if (!element) {
    console.error("Student form error element is missing.");
    return;
  }
  element.textContent = message;
  element.hidden = !message;
}

function showRowsMessage(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.className = "register-empty-cell";
  cell.textContent = message;
  row.append(cell);
  rowsElement.replaceChildren(row);
}

function runStudentAction(action, context) {
  try {
    Promise.resolve(action()).catch((error) => {
      console.error(`${context} failed:`, error);
      showToast(`Couldn’t ${context}. Please try again.`, "error");
    });
  } catch (error) {
    console.error(`${context} failed:`, error);
    showToast(`Couldn’t ${context}. Please try again.`, "error");
  }
}

function classLabel(classId) {
  const classRow = classes.find((item) => item.id === classId);
  return classRow ? `${classRow.name} · ${classRow.section}` : "Class unavailable";
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

function visibleStudents() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  return students.filter((student) => {
    const matchesClass = !classFilter.value || student.class_id === classFilter.value;
    const matchesSearch =
      `${student.full_name} ${student.roll_number} ${classLabel(student.class_id)}`
        .toLocaleLowerCase()
        .includes(query);
    return matchesClass && matchesSearch;
  }).sort((a, b) =>
    getRollNumberVal(a.roll_number) - getRollNumberVal(b.roll_number)
    || String(a.roll_number).localeCompare(String(b.roll_number), undefined, { numeric: true }),
  );
}

function renderStudents() {
  const visible = visibleStudents();
  document.querySelector("[data-student-count]").textContent = `· ${students.length} records`;
  document.querySelector("[data-student-footer]").textContent =
    `Showing ${visible.length} of ${students.length} students`;

  if (!visible.length) {
    showRowsMessage(students.length ? "No students match your search or class filter." : "No students yet. Add a student to get started.");
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((student) => {
    const row = document.createElement("tr");
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
    avatar.className = `student-avatar ${avatarClasses[student.full_name.length % avatarClasses.length]}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials || "?";
    const names = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = student.full_name;
    const email = document.createElement("small");
    email.textContent = student.email || "Student";
    names.append(name, email);
    identity.append(avatar, names);
    identityCell.append(identity);

    const rollCell = document.createElement("td");
    rollCell.textContent = student.roll_number;
    const classCell = document.createElement("td");
    classCell.textContent = classLabel(student.class_id);
    const statusCell = document.createElement("td");
    const active = student.status === "active";
    const badge = document.createElement("span");
    badge.className = `badge ${active ? "badge-present" : "badge-neutral"}`;
    badge.textContent = active ? "Active" : "Inactive";
    statusCell.append(badge);

    const actionCell = document.createElement("td");
    actionCell.className = "student-actions";
    const editButton = document.createElement("button");
    editButton.className = "button button-secondary student-status-button student-row-action";
    editButton.type = "button";
    editButton.title = "Edit student";
    editButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16z"/></svg>';
    editButton.setAttribute("aria-label", `Edit ${student.full_name}`);
    editButton.addEventListener("click", () => {
      runStudentAction(() => openStudentForm(student), "open student editor");
    });
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-danger student-status-button student-row-action";
    deleteButton.type = "button";
    deleteButton.title = "Delete student";
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5"/></svg>';
    deleteButton.setAttribute("aria-label", `Delete ${student.full_name}`);
    deleteButton.disabled = student.status !== "active";
    if (deleteButton.disabled) deleteButton.title = "Student is already inactive";
    deleteButton.addEventListener("click", () => {
      void deleteStudent(student, deleteButton);
    });
    actionCell.append(editButton, deleteButton);
    row.append(identityCell, rollCell, classCell, statusCell, actionCell);
    fragment.append(row);
  });

  rowsElement.replaceChildren(fragment);
}

function populateClassSelect(classIdForEdit = "") {
  const activeClasses = classes.filter((classRow) => classRow.status === "active");

  classFilter.replaceChildren(new Option("All classes", ""));
  classes.forEach((classRow) => {
    classFilter.append(new Option(`${classRow.name} · ${classRow.section}`, classRow.id));
  });

  populateFormClassSelect(classIdForEdit);
  const importClass = document.querySelector("[data-import-class]");
  importClass.replaceChildren(new Option("Choose a class", ""));
  activeClasses.forEach((classRow) => {
    importClass.append(new Option(`${classRow.name} · ${classRow.section}`, classRow.id));
  });
  importClass.disabled = activeClasses.length === 0;
  document.querySelector("[data-open-student-form]").disabled = activeClasses.length === 0;
  document.querySelector("[data-open-import-dialog]").disabled = activeClasses.length === 0;
}

function populateFormClassSelect(classIdForEdit = "") {
  const formClassSelect = studentForm.elements.namedItem("class_id");
  formClassSelect.replaceChildren(new Option("Choose a class", ""));
  const selectableClasses = classes.filter(
    (classRow) => classRow.status === "active" || classRow.id === classIdForEdit,
  );
  selectableClasses.forEach((classRow) => {
    formClassSelect.append(new Option(`${classRow.name} · ${classRow.section}`, classRow.id));
  });
  formClassSelect.disabled = selectableClasses.length === 0;
}

function openStudentForm(student = null) {
  studentForm.reset();
  setFormError();
  editingStudentId = student?.id ?? null;
  document.querySelector("#student-dialog-title").textContent = student ? "Edit student" : "Add a student";
  document.querySelector("[data-student-submit]").textContent = student ? "Save changes" : "Save student";
  populateFormClassSelect(student?.class_id ?? "");
  if (student) {
    studentForm.elements.namedItem("full_name").value = student.full_name;
    studentForm.elements.namedItem("roll_number").value = student.roll_number;
    studentForm.elements.namedItem("email").value = student.email ?? "";
    studentForm.elements.namedItem("description").value = student.description ?? "";
    studentForm.elements.namedItem("class_id").value = student.class_id;
  }
  studentDialog.showModal();
  studentForm.elements.namedItem("full_name").focus();
}

async function saveStudent(event) {
  event.preventDefault();
  if (studentSaveInProgress) return;
  setFormError();
  const formData = new FormData(studentForm);
  const payload = {
    class_id: String(formData.get("class_id")),
    full_name: String(formData.get("full_name")).trim(),
    roll_number: String(formData.get("roll_number")).trim(),
    email: String(formData.get("email") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
  };
  if (!payload.full_name || !payload.roll_number || !payload.class_id) {
    setFormError("Full name, roll number, and class are required.");
    return;
  }

  const submit = document.querySelector("[data-student-submit]");
  studentSaveInProgress = true;
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    let query = supabase.from("students");
    if (editingStudentId) {
      query = query
        .update(payload)
        .eq("id", editingStudentId)
        .eq("teacher_id", teacherId);
    } else {
      query = query.insert({ ...payload, teacher_id: teacherId, status: "active" });
    }
    const { error } = await query;
    if (error) throw error;
    studentDialog.close();
    showToast(editingStudentId ? "Student updated." : "Student added.");
    editingStudentId = null;
    await loadStudents();
  } catch (error) {
    console.error("Could not save student:", error);
    const detail = error.message?.toLowerCase().includes("duplicate")
      ? "That roll number is already in use in this class."
      : error.message?.toLowerCase().includes("row-level security")
        ? "Supabase denied this change. Confirm that you own the selected class."
        : "Couldn’t save this student. Check the connection and try again.";
    setFormError(detail);
    showToast(detail, "error");
  } finally {
    studentSaveInProgress = false;
    submit.disabled = false;
    submit.textContent = editingStudentId ? "Save changes" : "Save student";
  }
}

function normalizeHeader(header) {
  return header.replace(/^\uFEFF/, "").trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function readExcelWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The Excel file could not be read."));
    });
    reader.addEventListener("load", () => {
      try {
        resolve(XLSX.read(reader.result, { type: "array" }));
      } catch (error) {
        reject(error);
      }
    });
    reader.readAsArrayBuffer(file);
  });
}

function resolveImportClass(classValue, fallbackClassId) {
  const activeClasses = classes.filter((classRow) => classRow.status === "active");
  const value = String(classValue ?? "").trim().toLocaleLowerCase();
  if (!value) {
    return activeClasses.find((classRow) => classRow.id === fallbackClassId) ?? null;
  }

  const matches = activeClasses.filter((classRow) => {
    const fullLabel = `${classRow.name} · ${classRow.section}`.toLocaleLowerCase();
    return fullLabel === value || classRow.name.trim().toLocaleLowerCase() === value;
  });
  return matches.length === 1
    ? matches[0]
    : activeClasses.find((classRow) => classRow.id === fallbackClassId) ?? null;
}

async function readClassStudentRollNumbers(classId) {
  const rollNumbers = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("students")
      .select("roll_number")
      .eq("teacher_id", teacherId)
      .eq("class_id", classId)
      .order("roll_number")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    (data ?? []).forEach((student) => rollNumbers.add(student.roll_number.trim().toLocaleLowerCase()));
    if (!data || data.length < pageSize) break;
  }
  return rollNumbers;
}

function setImportMessage(message, isError = false) {
  const element = document.querySelector("[data-import-message]");
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.hidden = !message;
}

function downloadStudentExcelTemplate() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Roll_Number", "Email", "Description"],
  ]);
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Import instructions"],
    ["Name and Roll_Number are required; other fields are optional."],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  XLSX.writeFile(workbook, "attendify-students-template.xlsx");
}

function exportStudentsToExcel() {
  const rows = visibleStudents().map((student) => ({
    name: student.full_name,
    roll_number: student.roll_number,
    email: student.email ?? "",
    description: student.description ?? "",
    class: classLabel(student.class_id),
    status: student.status,
  }));
  if (!rows.length) {
    showToast("There are no students to export.", "error");
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["name", "roll_number", "email", "description", "class", "status"],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
  XLSX.writeFile(workbook, "attendify-students.xlsx");
}

async function importStudents(event) {
  event.preventDefault();
  const submit = document.querySelector("[data-import-submit]");
  if (submit.disabled) return;
  setImportMessage("");

  const classId = String(new FormData(importForm).get("class_id") ?? "");
  const file = document.querySelector("[data-import-file]").files[0];
  if (!classId || !file) {
    setImportMessage("Choose a class and Excel workbook.", true);
    return;
  }
  if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
    setImportMessage("Choose an Excel workbook (.xlsx or .xls) smaller than 10 MB.", true);
    return;
  }

  submit.disabled = true;
  const previousLabel = submit.textContent;
  submit.textContent = "Importing…";
  let importedCount = 0;
  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) {
      window.location.replace("login.html");
      return;
    }
    teacherId = authData.user.id;

    const workbook = await readExcelWorkbook(file);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("The workbook does not contain a worksheet.");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (rows.length < 2) throw new Error("The workbook must include a header row and at least one student.");

    const headers = rows[0].map((header) => normalizeHeader(String(header)));
    const nameIndex = headers.findIndex((header) => ["name", "fullname", "studentname"].includes(header));
    const rollIndex = headers.findIndex((header) => ["roll", "rollnumber", "rollno"].includes(header));
    if (nameIndex < 0 || rollIndex < 0) {
      throw new Error("The first worksheet must contain Name and Roll_Number headers.");
    }
    const classIndex = headers.indexOf("class");

    if (!classes.some((classRow) => classRow.id === classId && classRow.status === "active")) {
      throw new Error("Choose one of your active classes before importing students.");
    }

    const seenRollNumbers = new Map();
    const existingRollNumbersByClass = new Map();
    const insertRows = [];
    const skipped = [];
    for (const [index, cells] of rows.slice(1).entries()) {
      const fullName = String(cells[nameIndex] ?? "").trim();
      const rollNumber = String(cells[rollIndex] ?? "").trim();
      const classValue = classIndex >= 0 ? cells[classIndex] : "";
      const rowNumber = index + 2;
      if (!fullName || !rollNumber) {
        skipped.push(`Row ${rowNumber}: name or roll number is empty.`);
        continue;
      }

      const classRow = resolveImportClass(classValue, classId);
      if (!classRow) {
        skipped.push(`Row ${rowNumber}: no active class is available.`);
        continue;
      }

      const normalizedRoll = rollNumber.toLocaleLowerCase();
      if (!existingRollNumbersByClass.has(classRow.id)) {
        existingRollNumbersByClass.set(
          classRow.id,
          await readClassStudentRollNumbers(classRow.id),
        );
      }
      const classRollNumbers = existingRollNumbersByClass.get(classRow.id);
      let seenForClass = seenRollNumbers.get(classRow.id);
      if (!seenForClass) {
        seenForClass = new Set();
        seenRollNumbers.set(classRow.id, seenForClass);
      }
      if (classRollNumbers.has(normalizedRoll) || seenForClass.has(normalizedRoll)) {
        skipped.push(`Row ${rowNumber}: roll number ${rollNumber} is duplicated.`);
        continue;
      }
      seenForClass.add(normalizedRoll);
      insertRows.push({
        teacher_id: teacherId,
        class_id: classRow.id,
        full_name: fullName,
        roll_number: rollNumber,
        status: "active",
      });
    }

    if (!insertRows.length) {
      const detail = skipped.slice(0, 3).join(" ");
      setImportMessage(`No students were imported. ${detail}`, true);
      return;
    }

    for (let offset = 0; offset < insertRows.length; offset += 100) {
      const batch = insertRows.slice(offset, offset + 100);
      const { error } = await supabase.from("students").insert(batch);
      if (error) {
        throw new Error(
          `${importedCount} students imported before an insert failed: ${error.message}`,
        );
      }
      importedCount += batch.length;
    }

    await loadStudents();
    importForm.reset();
    importDialog.close();
    const skippedCount = skipped.length;
    showToast(`Successfully imported ${importedCount} students`);
    if (skippedCount) console.warn("Skipped student spreadsheet rows:", skipped);
  } catch (error) {
    console.error("Could not bulk import students:", error);
    if (importedCount) await loadStudents();
    const message = error instanceof Error ? error.message : "Could not import students.";
    setImportMessage(
      importedCount
        ? `${message} Refresh the roster to see the ${importedCount} students already imported.`
        : message,
      true,
    );
    showToast("Couldn’t import the workbook. Review the import message and try again.", "error");
  } finally {
    submit.disabled = false;
    submit.textContent = previousLabel;
  }
}

async function deleteStudent(student, button) {
  if (button.disabled) return;
  const confirmed = window.confirm(
    `Mark ${student.full_name} (${student.roll_number}) as inactive? Their existing attendance history will be preserved.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const { data, error } = await supabase
      .from("students")
      .update({
        status: "inactive",
        deleted_at: new Date().toISOString(),
      })
      .eq("id", student.id)
      .eq("teacher_id", teacherId)
      .eq("status", "active")
      .is("deleted_at", null)
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("The student was not found or is already inactive.");
    console.info(`Student ${student.id} marked inactive; attendance history retained.`);
    showToast("Student marked inactive. Attendance history has been preserved.");
    await loadStudents();
  } catch (error) {
    console.error("Could not delete student:", error);
    showToast(error instanceof Error ? error.message : "Couldn’t delete this student.", "error");
  } finally {
    button.disabled = false;
  }
}

async function loadStudents() {
  rowsElement.setAttribute("aria-busy", "true");
  showRowsMessage("Loading student roster…");
  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) {
      window.location.replace("login.html");
      return;
    }
    const user = authData.user;
    teacherId = user.id;

    const [{ data: classData, error: classError }, { data: studentData, error: studentError }] =
      await Promise.all([
        supabase
          .from("classes")
          .select("id, name, section, academic_year, status")
          .eq("teacher_id", user.id)
          .order("academic_year", { ascending: false })
          .order("name"),
        supabase
          .from("students")
          .select("*, classes!students_class_owner_fkey(name, section)")
          .eq("teacher_id", user.id)
          .order("full_name"),
      ]);
    if (classError) throw classError;
    if (studentError) throw studentError;

    classes = classData ?? [];
    students = studentData ?? [];
    populateClassSelect();
    renderStudents();
  } catch (error) {
    console.error("Could not load students:", error);
    showRowsMessage("Couldn’t load the student roster. Check your connection and Supabase RLS policies.");
    document.querySelector("[data-student-footer]").textContent = "Student roster unavailable";
    showToast("Couldn’t load students. Please try again.", "error");
  } finally {
    rowsElement.setAttribute("aria-busy", "false");
  }
}

async function initialize() {
  const requiredElements = [
    ["[data-student-rows]", rowsElement],
    ["[data-student-search]", searchInput],
    ["[data-student-class-filter]", classFilter],
    ["[data-student-dialog]", studentDialog],
    ["[data-student-form]", studentForm],
    ["[data-import-dialog]", importDialog],
    ["[data-import-form]", importForm],
    ["[data-open-student-form]", document.querySelector("[data-open-student-form]")],
    ["[data-student-count]", document.querySelector("[data-student-count]")],
    ["[data-student-footer]", document.querySelector("[data-student-footer]")],
    ["[data-student-submit]", document.querySelector("[data-student-submit]")],
    ["[data-student-form-error]", document.querySelector("[data-student-form-error]")],
    ["[data-student-toast]", document.querySelector("[data-student-toast]")],
    ["[data-close-student-dialog]", document.querySelector("[data-close-student-dialog]")],
    ["[data-open-import-dialog]", document.querySelector("[data-open-import-dialog]")],
    ["[data-download-student-template]", document.querySelector("[data-download-student-template]")],
    ["[data-export-students]", document.querySelector("[data-export-students]")],
    ["[data-close-import-dialog]", document.querySelector("[data-close-import-dialog]")],
    ["[data-import-class]", document.querySelector("[data-import-class]")],
    ["[data-import-file]", document.querySelector("[data-import-file]")],
    ["[data-import-submit]", document.querySelector("[data-import-submit]")],
    ["[data-import-message]", document.querySelector("[data-import-message]")],
  ];
  const missingElements = requiredElements
    .filter(([, element]) => !element)
    .map(([selector]) => selector);
  if (missingElements.length) {
    console.error(`Student page is missing required elements: ${missingElements.join(", ")}`);
    return;
  }

  document.querySelector("[data-open-student-form]").addEventListener("click", () => {
    runStudentAction(openStudentForm, "open student form");
  });
  document.querySelectorAll("[data-close-student-dialog]").forEach((button) => {
    button.addEventListener("click", () => studentDialog.close());
  });
  document.querySelector("[data-open-import-dialog]").addEventListener("click", () => {
    runStudentAction(() => {
      importForm.reset();
      setImportMessage("");
      const preferredClassId = classFilter.value || classes.find((row) => row.status === "active")?.id;
      if (preferredClassId) document.querySelector("[data-import-class]").value = preferredClassId;
      importDialog.showModal();
    }, "open Excel import");
  });
  document.querySelector("[data-download-student-template]").addEventListener("click", () => {
    runStudentAction(downloadStudentExcelTemplate, "download Excel template");
  });
  document.querySelector("[data-export-students]").addEventListener("click", () => {
    runStudentAction(exportStudentsToExcel, "export students");
  });
  document.querySelectorAll("[data-close-import-dialog]").forEach((button) => {
    button.addEventListener("click", () => importDialog.close());
  });
  importForm.addEventListener("submit", (event) => {
    runStudentAction(() => importStudents(event), "import students");
  });
  studentForm.addEventListener("submit", (event) => {
    runStudentAction(() => saveStudent(event), "save student");
  });
  searchInput.addEventListener("input", () => runStudentAction(renderStudents, "filter students"));
  classFilter.addEventListener("change", () => runStudentAction(renderStudents, "filter students"));

  await loadStudents();
}

void initialize().catch((error) => {
  console.error("Could not initialize the student page:", error);
  showRowsMessage("Couldn’t initialize the student roster. Reload the page and try again.");
});
