import { supabase } from "./supabaseClient.js";

const elements = {
  list: document.querySelector("[data-classes-list]"),
  loading: document.querySelector("[data-class-loading]"),
  empty: document.querySelector("[data-class-empty]"),
  search: document.querySelector("[data-class-search]"),
  classDialog: document.querySelector("[data-class-dialog]"),
  classForm: document.querySelector("[data-class-form]"),
  subjectDialog: document.querySelector("[data-subject-dialog]"),
  subjectForm: document.querySelector("[data-subject-form]"),
  subjectList: document.querySelector("[data-subject-list]"),
  toast: document.querySelector("[data-class-toast]"),
};

const iconClasses = [
  "class-icon-lilac",
  "class-icon-blue",
  "class-icon-peach",
  "class-icon-green",
  "class-icon-yellow",
  "class-icon-pink",
];

let teacherId = null;
let classes = [];
let selectedView = "active";
let selectedSubjectClass = null;
let toastTimer = 0;
let classSaveInProgress = false;
let subjectSaveInProgress = false;

function showToast(message, kind = "success") {
  if (!elements.toast) {
    console.error("Class page toast element is missing.");
    return;
  }

  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", kind === "error");
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4500);
}

function setFormError(selector, message = "") {
  const errorElement = document.querySelector(selector);
  if (!errorElement) {
    console.error(`Class form error element is missing: ${selector}`);
    return;
  }

  errorElement.textContent = message;
  errorElement.hidden = !message;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showOperationError(context, error, formErrorSelector = null) {
  const message = errorMessage(error);
  console.error(`${context}: ${message}`);

  let userMessage = `Couldn’t ${context}. Please try again.`;
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate key") || normalized.includes("unique constraint")) {
    userMessage = "A class or subject with those details already exists.";
  } else if (normalized.includes("row-level security") || normalized.includes("permission denied")) {
    userMessage = "Supabase denied this change. Verify your sign-in and the table’s RLS policies.";
  } else if (normalized.includes("network") || normalized.includes("fetch")) {
    userMessage = "Couldn’t reach Supabase. Check your connection and try again.";
  }

  if (formErrorSelector) setFormError(formErrorSelector, userMessage);
  showToast(userMessage, "error");
}

function makeElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function classSearchText(classRow) {
  const subjectNames = Array.isArray(classRow.subjects)
    ? classRow.subjects.map((subject) => subject.name)
    : [];
  return [
    classRow.name,
    classRow.section,
    classRow.academic_year,
    classRow.description ?? "",
    ...subjectNames,
  ].join(" ").toLocaleLowerCase();
}

function getVisibleClasses() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  return classes.filter((classRow) =>
    classRow.status === selectedView && classSearchText(classRow).includes(query),
  );
}

function openClassForm(classRow = null) {
  const form = elements.classForm;
  form.reset();
  setFormError("[data-class-form-error]");
  form.dataset.classId = classRow?.id ?? "";
  document.querySelector("#class-dialog-title").textContent = classRow ? "Edit class" : "Add a class";
  form.elements.namedItem("name").value = classRow?.name ?? "";
  form.elements.namedItem("section").value = classRow?.section ?? "";
  form.elements.namedItem("academic_year").value = classRow?.academic_year ?? "";
  form.elements.namedItem("description").value = classRow?.description ?? "";
  elements.classDialog.showModal();
  form.elements.namedItem("name").focus();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function buildClassCard(classRow, index) {
  const card = makeElement("article", "class-card class-management-card");
  const header = makeElement("div", "class-card-header");
  const icon = makeElement("span", `class-icon ${iconClasses[index % iconClasses.length]}`);
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = classRow.name.match(/\d+/)?.[0] ?? classRow.name.slice(0, 2).toLocaleUpperCase();
  header.append(
    icon,
    makeElement(
      "span",
      `badge ${classRow.status === "active" ? "badge-present" : "badge-neutral"}`,
      classRow.status === "active" ? "Active" : "Archived",
    ),
  );

  const grade = makeElement("p", "class-grade");
  grade.append(
    document.createTextNode(classRow.name),
    makeElement("span", "", "·"),
    document.createTextNode(classRow.section),
  );
  const title = makeElement("h2", "", `${classRow.name} · ${classRow.section}`);
  const year = makeElement("p", "class-card-meta", `Academic year ${classRow.academic_year}`);
  const description = makeElement(
    "p",
    "class-description",
    classRow.description?.trim() || "No description added.",
  );
  const subjects = Array.isArray(classRow.subjects) ? classRow.subjects : null;
  const subjectPreview = makeElement(
    "p",
    "class-subject-preview",
    subjects === null
      ? "Subject list unavailable"
      : subjects.length
        ? subjects.slice(0, 3).map((subject) => subject.name).join(" · ") +
          (subjects.length > 3 ? ` +${subjects.length - 3}` : "")
        : "No subjects added yet",
  );

  const footer = makeElement("div", "class-card-footer");
  const counts = makeElement("span", "class-card-counts");
  counts.append(
    makeElement(
      "span",
      "",
      classRow.studentCount === null ? "Student count unavailable" : `${classRow.studentCount} students`,
    ),
    makeElement("span", "", subjects === null ? "Subject count unavailable" : `${subjects.length} subjects`),
  );
  footer.append(counts);

  const actions = makeElement("div", "class-card-actions");
  const subjectsButton = makeElement("button", "button button-secondary", "Manage subjects");
  subjectsButton.type = "button";
  subjectsButton.addEventListener("click", () => {
    void loadSubjectsForClass(classRow).catch((error) => showOperationError("load subjects", error));
  });

  const editButton = makeElement("button", "button button-secondary", "Edit");
  editButton.type = "button";
  editButton.addEventListener("click", () => {
    try {
      openClassForm(classRow);
    } catch (error) {
      showOperationError("open class editor", error);
    }
  });

  const deleteButton = makeElement("button", "button button-danger", "Delete");
  deleteButton.type = "button";
  deleteButton.setAttribute("aria-label", `Delete ${classRow.name} ${classRow.section}`);
  deleteButton.addEventListener("click", () => {
    void deleteClass(classRow, deleteButton);
  });

  const archiveButton = makeElement(
    "button",
    "button button-quiet",
    classRow.status === "active" ? "Archive" : "Reactivate",
  );
  archiveButton.type = "button";
  archiveButton.addEventListener("click", () => {
    void updateClassStatus(classRow, classRow.status === "active" ? "archived" : "active")
      .catch((error) => showOperationError("update class status", error));
  });

  actions.append(subjectsButton, editButton, deleteButton, archiveButton);
  card.append(header, grade, title, year, description, subjectPreview, footer, actions);
  return card;
}

function renderClasses() {
  const visibleClasses = getVisibleClasses();
  const activeCount = classes.filter((classRow) => classRow.status === "active").length;
  const archivedCount = classes.length - activeCount;

  document.querySelector("[data-active-count]").textContent = String(activeCount);
  document.querySelector("[data-archived-count]").textContent = String(archivedCount);
  document.querySelector("[data-results-label]").textContent =
    `${visibleClasses.length} ${visibleClasses.length === 1 ? "class" : "classes"} ${selectedView}`;

  elements.list.replaceChildren();
  visibleClasses.forEach((classRow, index) => elements.list.append(buildClassCard(classRow, index)));

  const isEmpty = visibleClasses.length === 0;
  elements.list.hidden = isEmpty;
  elements.empty.hidden = !isEmpty;
  if (!isEmpty) return;

  const hasClasses = classes.length > 0;
  const hasSearch = Boolean(elements.search.value.trim());
  const title = document.querySelector("[data-empty-title]");
  const copy = document.querySelector("[data-empty-copy]");
  const action = document.querySelector("[data-empty-action]");

  title.textContent = hasSearch
    ? "No matching classes"
    : selectedView === "archived"
      ? "No archived classes"
      : hasClasses
        ? "No active classes"
        : "No classes yet";
  copy.textContent = hasSearch
    ? "Try another search or switch to your active classes."
    : selectedView === "archived"
      ? "Archived classes will appear here."
      : hasClasses
        ? "Reactivate an archived class or add a new class to get started."
        : "Add your first class to start organizing subjects and students.";
  action.hidden = hasSearch || (selectedView === "archived" && hasClasses);
}

async function getTeacher() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

function renderLoadError(error) {
  const message = errorMessage(error);
  console.error(`Could not load classes: ${message}`);
  elements.loading.hidden = true;
  elements.list.hidden = true;
  elements.empty.hidden = false;
  document.querySelector("[data-empty-title]").textContent = "Couldn’t load classes";
  document.querySelector("[data-empty-copy]").textContent =
    "There was a problem loading classes from Supabase. Check your connection and access policies, then try again.";
  document.querySelector("[data-empty-action]").hidden = true;
  showToast(`Couldn’t load classes: ${message}`, "error");
}

async function loadClasses() {
  elements.loading.hidden = false;
  elements.list.replaceChildren(elements.loading);
  elements.list.hidden = false;
  elements.empty.hidden = true;

  try {
    const user = await getTeacher();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    teacherId = user.id;

    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .eq("teacher_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const classRows = data ?? [];
    const studentsByClass = new Map();
    const subjectsByClass = new Map();
    let studentCountsAvailable = true;
    let subjectsAvailable = true;

    if (classRows.length > 0) {
      const classIds = classRows.map((classRow) => classRow.id);
      const [studentsRequest, subjectsRequest] = await Promise.allSettled([
        supabase
          .from("students")
          .select("id, class_id")
          .eq("teacher_id", user.id)
          .eq("status", "active")
          .in("class_id", classIds),
        supabase
          .from("subjects")
          .select("id, class_id, name, code")
          .in("class_id", classIds),
      ]);

      const studentsResult = studentsRequest.status === "fulfilled"
        ? studentsRequest.value
        : { data: null, error: studentsRequest.reason };
      const subjectsResult = subjectsRequest.status === "fulfilled"
        ? subjectsRequest.value
        : { data: null, error: subjectsRequest.reason };

      if (studentsResult.error) {
        studentCountsAvailable = false;
        console.error(`Could not load class student counts: ${errorMessage(studentsResult.error)}`);
      } else {
        (studentsResult.data ?? []).forEach((student) => {
          const rows = studentsByClass.get(student.class_id) ?? [];
          rows.push(student);
          studentsByClass.set(student.class_id, rows);
        });
      }

      if (subjectsResult.error) {
        subjectsAvailable = false;
        console.error(`Could not load class subjects: ${errorMessage(subjectsResult.error)}`);
      } else {
        (subjectsResult.data ?? []).forEach((subject) => {
          const rows = subjectsByClass.get(subject.class_id) ?? [];
          rows.push(subject);
          subjectsByClass.set(subject.class_id, rows);
        });
      }
    }

    classes = classRows.map((classRow) => ({
      ...classRow,
      studentCount: studentCountsAvailable
        ? (studentsByClass.get(classRow.id) ?? []).length
        : null,
      subjects: subjectsAvailable ? (subjectsByClass.get(classRow.id) ?? []) : null,
    }));
    elements.loading.hidden = true;
    renderClasses();
  } catch (error) {
    renderLoadError(error);
  }
}

async function saveClass(event) {
  event.preventDefault();
  if (classSaveInProgress) return;
  setFormError("[data-class-form-error]");

  const submit = document.querySelector("[data-class-submit]");
  const form = elements.classForm;
  const isEditing = Boolean(form.dataset.classId);
  classSaveInProgress = true;
  submit.disabled = true;
  submit.textContent = isEditing ? "Saving…" : "Adding…";

  try {
    const user = await getTeacher();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (teacherId && user.id !== teacherId) {
      throw new Error("The signed-in account changed. Reload the page and try again.");
    }
    teacherId = user.id;

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      section: String(formData.get("section") ?? "").trim(),
      academic_year: String(formData.get("academic_year") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      teacher_id: user.id,
    };
    if (!payload.name || !payload.section || !payload.academic_year) {
      setFormError("[data-class-form-error]", "Class name, section, and academic year are required.");
      return;
    }

    let query = supabase.from("classes");
    if (isEditing) {
      query = query
        .update(payload)
        .eq("id", form.dataset.classId)
        .eq("teacher_id", user.id);
    } else {
      query = query.insert(payload);
    }

    const { error } = await query;
    if (error) throw error;

    closeDialog(elements.classDialog);
    showToast(isEditing ? "Class details updated." : "Class added.");
    await loadClasses();
  } catch (error) {
    const message = errorMessage(error);
    console.error(`Could not save class: ${message}`);
    setFormError("[data-class-form-error]", message);
    showToast(message, "error");
  } finally {
    classSaveInProgress = false;
    submit.disabled = false;
    submit.textContent = "Save class";
  }
}

async function updateClassStatus(classRow, status) {
  const user = await getTeacher();
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  if (user.id !== teacherId) throw new Error("The signed-in account changed. Reload the page and try again.");

  const { error } = await supabase
    .from("classes")
    .update({ status })
    .eq("id", classRow.id)
    .eq("teacher_id", user.id);
  if (error) throw error;

  showToast(status === "archived" ? "Class archived." : "Class reactivated.");
  await loadClasses();
}

async function deleteClass(classRow, button) {
  if (button.disabled) return;
  const confirmed = window.confirm(
    "Are you sure you want to delete this class? This will permanently delete all associated subjects, students, and attendance records.",
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const user = await getTeacher();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (user.id !== teacherId) {
      throw new Error("The signed-in account changed. Reload the page and try again.");
    }

    const { data, error } = await supabase
      .from("classes")
      .delete()
      .eq("id", classRow.id)
      .eq("teacher_id", user.id)
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("The class was not found or could not be deleted.");

    showToast("Class and associated records deleted.");
    await loadClasses();
  } catch (error) {
    showOperationError("delete class", error);
  } finally {
    button.disabled = false;
  }
}

function renderSubjects(subjects) {
  elements.subjectList.replaceChildren();
  if (!subjects.length) {
    elements.subjectList.append(makeElement("p", "subject-empty", "No subjects yet. Add the first subject for this class."));
    return;
  }

  subjects.forEach((subject) => {
    const item = makeElement("div", "subject-list-item");
    const identity = makeElement("span", "subject-list-identity");
    identity.append(
      makeElement("strong", "", subject.name),
      makeElement("small", "", subject.code || "No subject code"),
    );
    const edit = makeElement("button", "button button-secondary subject-edit-button", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      try {
        const form = elements.subjectForm;
        form.dataset.subjectId = subject.id;
        form.elements.namedItem("name").value = subject.name;
        form.elements.namedItem("code").value = subject.code ?? "";
        document.querySelector("[data-subject-submit]").textContent = "Save subject";
        form.elements.namedItem("name").focus();
      } catch (error) {
        showOperationError("open subject editor", error);
      }
    });

    const actions = makeElement("div", "subject-list-actions");
    const deleteButton = makeElement("button", "button button-danger subject-edit-button", "Delete");
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${subject.name}`);
    deleteButton.addEventListener("click", () => {
      void deleteSubject(subject, deleteButton);
    });
    actions.append(edit, deleteButton);
    item.append(identity, actions);
    elements.subjectList.append(item);
  });
}

async function fetchSubjectsForClass(classRow) {
  const user = await getTeacher();
  if (!user) {
    window.location.replace("login.html");
    return null;
  }
  if (user.id !== teacherId) {
    throw new Error("The signed-in account changed. Reload the page and try again.");
  }

  const { data, error } = await supabase
    .from("subjects")
    .select("id, class_id, name, code, created_at")
    .eq("class_id", classRow.id)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function loadSubjectsForClass(classRow) {
  selectedSubjectClass = classRow;
  const form = elements.subjectForm;
  form.reset();
  form.dataset.subjectId = "";
  document.querySelector("[data-subject-class-name]").textContent =
    `${classRow.name} · ${classRow.section} · ${classRow.academic_year}`;
  document.querySelector("[data-subject-submit]").textContent = "Add subject";
  setFormError("[data-subject-form-error]");
  elements.subjectList.replaceChildren(makeElement("p", "subject-empty", "Loading subjects…"));
  elements.subjectDialog.showModal();

  const subjects = await fetchSubjectsForClass(classRow);
  if (subjects) {
    classRow.subjects = subjects;
    renderSubjects(subjects);
  }
}

async function deleteSubject(subject, button) {
  if (!selectedSubjectClass || button.disabled) return;
  const confirmed = window.confirm(
    "Are you sure you want to delete this subject? Associated attendance sessions will also be removed.",
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const user = await getTeacher();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (user.id !== teacherId) {
      throw new Error("The signed-in account changed. Reload the page and try again.");
    }

    const { data, error } = await supabase
      .from("subjects")
      .delete()
      .eq("id", subject.id)
      .eq("class_id", selectedSubjectClass.id)
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("The subject was not found or could not be deleted.");

    if (Array.isArray(selectedSubjectClass.subjects)) {
      selectedSubjectClass.subjects = selectedSubjectClass.subjects.filter(
        (item) => item.id !== subject.id,
      );
    }
    renderSubjects(
      Array.isArray(selectedSubjectClass.subjects)
        ? selectedSubjectClass.subjects
        : [],
    );
    showToast("Subject and associated sessions deleted.");
    await loadClasses();
  } catch (error) {
    showOperationError("delete subject", error);
  } finally {
    button.disabled = false;
  }
}

async function saveSubject(event) {
  event.preventDefault();
  if (subjectSaveInProgress) return;
  setFormError("[data-subject-form-error]");
  if (!selectedSubjectClass) return;

  const form = elements.subjectForm;
  const isEditing = Boolean(form.dataset.subjectId);
  const submit = document.querySelector("[data-subject-submit]");
  subjectSaveInProgress = true;
  submit.disabled = true;
  submit.textContent = isEditing ? "Saving…" : "Adding…";

  try {
    const user = await getTeacher();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    if (user.id !== teacherId) throw new Error("The signed-in account changed. Reload the page and try again.");

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      code: String(formData.get("code") ?? "").trim() || null,
    };
    if (!payload.name) {
      setFormError("[data-subject-form-error]", "Subject name is required.");
      return;
    }

    let query = supabase.from("subjects");
    if (isEditing) {
      query = query
        .update(payload)
        .eq("id", form.dataset.subjectId)
        .eq("class_id", selectedSubjectClass.id);
    } else {
      query = query.insert({ ...payload, class_id: selectedSubjectClass.id });
    }

    const { error } = await query;
    if (error) throw error;

    form.reset();
    form.dataset.subjectId = "";
    submit.textContent = "Add subject";
    showToast(isEditing ? "Subject updated." : "Subject added.");
    await loadSubjectsForClass(selectedSubjectClass);
    await loadClasses();
  } catch (error) {
    showOperationError("save subject", error, "[data-subject-form-error]");
  } finally {
    subjectSaveInProgress = false;
    submit.disabled = false;
    submit.textContent = form.dataset.subjectId ? "Save subject" : "Add subject";
  }
}

function validatePage() {
  const required = [
    ["[data-classes-list]", elements.list],
    ["[data-class-loading]", elements.loading],
    ["[data-class-empty]", elements.empty],
    ["[data-class-search]", elements.search],
    ["[data-class-dialog]", elements.classDialog],
    ["[data-class-form]", elements.classForm],
    ["[data-subject-dialog]", elements.subjectDialog],
    ["[data-subject-form]", elements.subjectForm],
    ["[data-subject-list]", elements.subjectList],
    ["[data-class-toast]", elements.toast],
    ["[data-active-count]", document.querySelector("[data-active-count]")],
    ["[data-archived-count]", document.querySelector("[data-archived-count]")],
    ["[data-results-label]", document.querySelector("[data-results-label]")],
    ["[data-empty-title]", document.querySelector("[data-empty-title]")],
    ["[data-empty-copy]", document.querySelector("[data-empty-copy]")],
    ["[data-empty-action]", document.querySelector("[data-empty-action]")],
    ["[data-class-submit]", document.querySelector("[data-class-submit]")],
    ["[data-subject-submit]", document.querySelector("[data-subject-submit]")],
    ["[data-subject-class-name]", document.querySelector("[data-subject-class-name]")],
    ["[data-class-form-error]", document.querySelector("[data-class-form-error]")],
    ["[data-subject-form-error]", document.querySelector("[data-subject-form-error]")],
    ["[data-close-subject-dialog]", document.querySelector("[data-close-subject-dialog]")],
    ["[data-open-class-form]", document.querySelector("[data-open-class-form]")],
    ["[data-close-class-dialog]", document.querySelector("[data-close-class-dialog]")],
    ["[data-class-view]", document.querySelector("[data-class-view]")],
  ];
  const missing = required.filter(([, element]) => !element).map(([selector]) => selector);
  if (missing.length) {
    console.error(`Classes page is missing required elements: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

function initializeControls() {
  document.querySelectorAll("[data-open-class-form], [data-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        openClassForm();
      } catch (error) {
        showOperationError("open class form", error);
      }
    });
  });
  document.querySelectorAll("[data-close-class-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(elements.classDialog));
  });
  document.querySelector("[data-close-subject-dialog]").addEventListener("click", () => {
    closeDialog(elements.subjectDialog);
  });
  elements.classForm.addEventListener("submit", (event) => {
    void saveClass(event);
  });
  elements.subjectForm.addEventListener("submit", (event) => {
    void saveSubject(event);
  });
  elements.search.addEventListener("input", () => {
    try {
      renderClasses();
    } catch (error) {
      showOperationError("filter classes", error);
    }
  });
  document.querySelectorAll("[data-class-view]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        selectedView = button.dataset.classView;
        document.querySelectorAll("[data-class-view]").forEach((tab) => {
          const isActive = tab === button;
          tab.classList.toggle("is-active", isActive);
          tab.setAttribute("aria-pressed", String(isActive));
        });
        renderClasses();
      } catch (error) {
        showOperationError("change class view", error);
      }
    });
  });
}

async function initialize() {
  if (!validatePage()) return;
  initializeControls();
  await loadClasses();
}

void initialize().catch((error) => {
  const message = errorMessage(error);
  console.error(`Could not initialize class management: ${message}`);
  renderLoadError(error);
});
