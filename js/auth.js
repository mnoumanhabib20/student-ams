import { supabase } from "./supabaseClient.js";

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.replace("login.html");
}

const privatePages = new Set([
  "index.html",
  "dashboard.html",
  "classes.html",
  "students.html",
  "attendance.html",
  "reports.html",
  "settings.html",
]);

const authPages = new Set(["login.html", "signup.html"]);

function currentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function getPostLoginDestination() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) {
    return "dashboard.html";
  }

  const destination = new URL(requested, window.location.origin);
  const page = destination.pathname.split("/").pop();
  return destination.origin === window.location.origin && privatePages.has(page)
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "dashboard.html";
}

function showMessage(element, message, kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("auth-message-error", kind === "error");
  element.classList.toggle("auth-message-success", kind === "success");
}

function showToast(message) {
  let toast = document.querySelector("[data-auth-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "auth-toast auth-message-error";
    toast.dataset.authToast = "";
    toast.setAttribute("role", "alert");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function formatAuthError(error, action) {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("invalid login credentials")) {
    return "That email and password combination wasn’t recognized. Check your details and try again.";
  }
  if (message.includes("email not confirmed")) {
    return "Please confirm your email address using the link we sent you before signing in.";
  }
  if (message.includes("already registered") || message.includes("user already registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (message.includes("password") && (message.includes("least") || message.includes("weak"))) {
    return "Choose a stronger password and try again.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "We couldn’t reach the authentication service. Check your connection and try again.";
  }
  console.error(`Supabase ${action} failed:`, error);
  return `We couldn’t ${action}. Please try again in a moment.`;
}

function setFormBusy(form, isBusy, busyLabel) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (isBusy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function getProfileName(user) {
  return (
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim() ||
    user.email ||
    "Teacher"
  );
}

async function updateTeacherIdentity(user) {
  if (!user) return;

  let fullName = getProfileName(user);
  let institutionName =
    user.user_metadata?.institution_name?.trim() ||
    user.user_metadata?.institution?.trim() ||
    "";
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, institution_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Could not load teacher profile:", error);
  } else if (data) {
    const profileName = data.full_name?.trim();
    if (profileName && profileName.toLocaleLowerCase() !== "new teacher") {
      fullName = profileName;
    }
    institutionName = data.institution_name?.trim() || institutionName;
  }

  const firstName = fullName.split(/\s+/)[0] || "Teacher";
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase())
    .join("");

  document.querySelectorAll("[data-user-name]").forEach((element) => {
    element.textContent = fullName;
  });
  document.querySelectorAll("[data-user-email]").forEach((element) => {
    element.textContent = user.email || "";
  });
  document.querySelectorAll("[data-user-initials]").forEach((element) => {
    element.textContent = initials || "T";
  });
  document.querySelectorAll("[data-user-first-name]").forEach((element) => {
    element.textContent = firstName;
  });
  document.querySelectorAll(".workspace-copy strong").forEach((element) => {
    element.textContent = fullName;
  });
  document.querySelectorAll("#workspace-teacher-name").forEach((element) => {
    element.textContent = fullName;
  });
  document.querySelectorAll("#workspace-institution-name").forEach((element) => {
    element.textContent = institutionName || "School workspace";
  });
  document.querySelectorAll("#workspace-avatar").forEach((element) => {
    element.textContent = initials || "T";
  });
  document.querySelectorAll("[data-sign-out]").forEach((element) => {
    element.setAttribute("aria-label", `Sign out ${fullName}`);
  });
}

function initializeLoginForm() {
  const form = document.querySelector("[data-login-form]");
  const message = document.querySelector("[data-auth-message]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    setFormBusy(form, true, "Signing in…");

    const formData = new FormData(form);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(formData.get("email")).trim(),
        password: String(formData.get("password")),
      });
      if (error) {
        showMessage(message, formatAuthError(error, "sign in"));
        return;
      }
      window.location.replace(getPostLoginDestination());
    } catch (error) {
      showMessage(message, formatAuthError(error, "sign in"));
    } finally {
      setFormBusy(form, false);
    }
  });
}

function initializeSignupForm() {
  const form = document.querySelector("[data-signup-form]");
  const message = document.querySelector("[data-auth-message]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    setFormBusy(form, true, "Creating account…");

    const formData = new FormData(form);
    const fullName = String(formData.get("full_name")).trim();
    try {
      const { data, error } = await supabase.auth.signUp({
        email: String(formData.get("email")).trim(),
        password: String(formData.get("password")),
        options: {
          data: { full_name: fullName },
          emailRedirectTo: new URL("dashboard.html", window.location.href).href,
        },
      });
      if (error) {
        showMessage(message, formatAuthError(error, "create your account"));
        return;
      }

      if (data.session) {
        window.location.replace("dashboard.html");
        return;
      }

      form.reset();
      showMessage(
        message,
        "Your account is ready. Check your inbox to confirm your email, then sign in.",
        "success",
      );
    } catch (error) {
      showMessage(message, formatAuthError(error, "create your account"));
    } finally {
      setFormBusy(form, false);
    }
  });
}

function initializeRecoveryForm() {
  const form = document.querySelector("[data-recovery-form]");
  const message = document.querySelector("[data-recovery-message]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    setFormBusy(form, true, "Sending link…");

    const formData = new FormData(form);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        String(formData.get("email")).trim(),
        { redirectTo: new URL("reset-password.html", window.location.href).href },
      );
      if (error) {
        showMessage(message, formatAuthError(error, "send the recovery email"));
        return;
      }

      showMessage(
        message,
        "If an account exists for that email, a password reset link is on its way.",
        "success",
      );
    } catch (error) {
      showMessage(message, formatAuthError(error, "send the recovery email"));
    } finally {
      setFormBusy(form, false);
    }
  });
}

function initializePasswordUpdateForm() {
  const form = document.querySelector("[data-password-update-form]");
  const message = document.querySelector("[data-auth-message]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;

    const formData = new FormData(form);
    const password = String(formData.get("password"));
    if (password !== String(formData.get("confirm_password"))) {
      showMessage(message, "Those passwords don’t match. Please check and try again.");
      return;
    }

    setFormBusy(form, true, "Updating password…");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showMessage(message, formatAuthError(error, "update your password"));
        return;
      }

      form.reset();
      showMessage(message, "Your password has been updated. You can now sign in.", "success");
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.error("Password updated, but the recovery session could not be closed:", signOutError);
      }
    } catch (error) {
      showMessage(message, formatAuthError(error, "update your password"));
    } finally {
      setFormBusy(form, false);
    }
  });
}

function initializeRecoveryToggle() {
  const toggles = document.querySelectorAll("[data-show-recovery]");
  const loginPanel = document.querySelector("[data-login-panel]");
  const recoveryPanel = document.querySelector("[data-recovery-panel]");
  if (!toggles.length || !loginPanel || !recoveryPanel) return;

  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const showingRecovery = recoveryPanel.hidden;
      loginPanel.hidden = showingRecovery;
      recoveryPanel.hidden = !showingRecovery;
      toggles.forEach((button) => {
        button.textContent = showingRecovery ? "Back to sign in" : "Forgot your password?";
      });
      (showingRecovery
        ? recoveryPanel.querySelector('input[name="email"]')
        : loginPanel.querySelector('input[name="email"]')
      )?.focus();
    });
  });
}

function initializeSignOut() {
  document.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await logout();
      } catch (error) {
        button.disabled = false;
        console.error("Could not sign out:", error);
        showToast("We couldn’t sign you out. Please try again.");
      }
    });
  });
}

function initializeAuth() {
  const page = currentPage();
  const isPrivate = privatePages.has(page);
  const isPublicAuthPage = authPages.has(page);

  initializeLoginForm();
  initializeSignupForm();
  initializeRecoveryForm();
  initializePasswordUpdateForm();
  initializeRecoveryToggle();
  initializeSignOut();

  supabase.auth.onAuthStateChange((event, session) => {
    if (isPrivate && !session) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
      return;
    }
    if (isPublicAuthPage && session) {
      window.location.replace(getPostLoginDestination());
      return;
    }
    if (session?.user) {
      window.setTimeout(() => {
        void updateTeacherIdentity(session.user).catch((error) => {
          console.error("Could not update teacher identity:", error);
        });
      }, 0);
    }
  });

  if (isPrivate || isPublicAuthPage) {
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Could not restore the authentication session:", error);
      }

      const session = data?.session;
      if (isPrivate && !session) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
        return;
      }
      if (isPublicAuthPage && session) {
        window.location.replace(getPostLoginDestination());
        return;
      }
      if (session?.user) {
        void updateTeacherIdentity(session.user).catch((profileError) => {
          console.error("Could not update teacher identity:", profileError);
        });
      }
    }).catch((error) => {
      console.error("Could not restore the authentication session:", error);
      if (isPrivate) window.location.replace("login.html");
    });
  }
}

initializeAuth();
