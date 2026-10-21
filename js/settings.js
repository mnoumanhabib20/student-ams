import { supabase } from "./supabaseClient.js";

const form = document.querySelector("[data-settings-form]");
const nameInput = document.querySelector("[data-settings-name]");
const institutionInput = document.querySelector("[data-settings-institution]");
const attendanceTargetInput = document.querySelector("[data-settings-attendance-target]");
const submitButton = document.querySelector("[data-settings-submit]");
let teacherId = null;
let toastTimer = 0;
let profileAvailable = true;

function attendanceTargetStorageKey(userId) {
  return `attendify:attendance-target:${userId}`;
}

function getSavedAttendanceTarget(userId) {
  const stored = window.localStorage.getItem(attendanceTargetStorageKey(userId));
  if (stored === null) return 75;
  const target = Number(stored);
  return Number.isFinite(target) && target >= 0 && target <= 100 ? target : 75;
}

function formatAccountCreatedAt(createdAt) {
  if (!createdAt) return "Not available";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function showToast(message, isError = false) {
  const toast = document.querySelector("[data-settings-toast]");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function setError(message = "") {
  const error = document.querySelector("[data-settings-error]");
  error.textContent = message;
  error.hidden = !message;
}

async function loadSettings() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) {
    window.location.replace("login.html");
    return false;
  }
  teacherId = user.id;
  document.querySelector("[data-settings-email]").textContent = user.email || "Not available";
  document.querySelector("[data-settings-id]").textContent = user.id;
  document.querySelector("[data-settings-created]").textContent =
    formatAccountCreatedAt(user.created_at);

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, institution_name")
    .eq("id", teacherId)
    .maybeSingle();
  if (error) {
    profileAvailable = false;
    console.warn("Could not load teacher profile; using account metadata:", error.message);
  } else {
    profileAvailable = Boolean(profile);
  }
  nameInput.value =
    profile?.full_name?.trim() ||
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim() ||
    "";
  institutionInput.value =
    profile?.institution_name?.trim() ||
    user.user_metadata?.institution_name?.trim() ||
    "";
  attendanceTargetInput.value = String(getSavedAttendanceTarget(user.id));
  return true;
}

async function saveSettings(event) {
  event.preventDefault();
  setError();
  const fullName = nameInput.value.trim();
  const institutionName = institutionInput.value.trim();
  const attendanceTarget = Number(attendanceTargetInput.value);
  if (!fullName) {
    setError("Display name is required.");
    nameInput.focus();
    return;
  }
  if (!Number.isFinite(attendanceTarget) || attendanceTarget < 0 || attendanceTarget > 100) {
    setError("Attendance target must be between 0 and 100.");
    attendanceTargetInput.focus();
    return;
  }

  submitButton.disabled = true;
  const previousText = submitButton.textContent;
  submitButton.textContent = "Saving…";
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user || user.id !== teacherId) {
      window.location.replace("login.html");
      return;
    }

    let savedName = fullName;
    let savedInstitution = institutionName;
    if (profileAvailable) {
      const { data, error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, institution_name: institutionName })
        .eq("id", teacherId)
        .select("full_name, institution_name")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        savedName = data.full_name || fullName;
        savedInstitution = data.institution_name || "";
      } else {
        profileAvailable = false;
      }
    }

    if (!profileAvailable) {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName, institution_name: institutionName },
      });
      if (error) throw error;
    }

    window.localStorage.setItem(
      attendanceTargetStorageKey(teacherId),
      String(attendanceTarget),
    );
    nameInput.value = savedName;
    institutionInput.value = savedInstitution;
    document.querySelectorAll("[data-user-name]").forEach((element) => {
      element.textContent = savedName;
    });
    document.querySelectorAll("#workspace-teacher-name").forEach((element) => {
      element.textContent = savedName;
    });
    document.querySelectorAll("#workspace-institution-name").forEach((element) => {
      element.textContent = savedInstitution || "School workspace";
    });
    const initials = savedName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toLocaleUpperCase())
      .join("") || "T";
    document.querySelectorAll("#workspace-avatar").forEach((element) => {
      element.textContent = initials;
    });
    showToast("Profile settings saved.");
  } catch (error) {
    console.error("Could not save teacher settings:", error);
    const message = error instanceof Error ? error.message : "Could not save settings.";
    setError(message);
    showToast("Couldn’t save your settings.", true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = previousText;
  }
}

async function initialize() {
  const required = [
    ["[data-settings-form]", form],
    ["[data-settings-name]", nameInput],
    ["[data-settings-institution]", institutionInput],
    ["[data-settings-attendance-target]", attendanceTargetInput],
    ["[data-settings-submit]", submitButton],
    ["[data-settings-error]", document.querySelector("[data-settings-error]")],
    ["[data-settings-toast]", document.querySelector("[data-settings-toast]")],
  ];
  const missing = required.filter(([, element]) => !element).map(([selector]) => selector);
  if (missing.length) throw new Error(`Settings page is missing: ${missing.join(", ")}`);
  form.addEventListener("submit", (event) => {
    saveSettings(event).catch((error) => {
      console.error("Could not save teacher settings:", error);
      const message = error instanceof Error ? error.message : "Could not save settings.";
      setError(message);
      showToast("Couldn’t save your settings.", true);
    });
  });
  try {
    const authenticated = await loadSettings();
    if (!authenticated) return;
  } catch (error) {
    console.error("Could not load teacher settings:", error);
    const email = document.querySelector("[data-settings-email]");
    const accountId = document.querySelector("[data-settings-id]");
    const created = document.querySelector("[data-settings-created]");
    if (email.textContent === "Loading…") email.textContent = "Unavailable";
    if (accountId.textContent === "Loading…") accountId.textContent = "Unavailable";
    if (created.textContent === "Loading…") created.textContent = "Unavailable";
    setError("Settings could not be loaded. Check your connection and reload this page.");
    submitButton.disabled = true;
  }
}

void initialize().catch((error) => {
  console.error("Could not initialize teacher settings:", error);
  submitButton.disabled = true;
});
