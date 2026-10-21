import "../../js/auth.js";

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
const sidebarBackdrop = document.querySelector(".sidebar-backdrop");

function setSidebarOpen(isOpen) {
  if (!sidebar || !sidebarToggle || !sidebarBackdrop) return;

  sidebar.classList.toggle("is-open", isOpen);
  sidebarBackdrop.classList.toggle("is-visible", isOpen);
  sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("navigation-open", isOpen);
}

sidebarToggle?.addEventListener("click", () => {
  setSidebarOpen(!sidebar?.classList.contains("is-open"));
});

sidebarBackdrop?.addEventListener("click", () => setSidebarOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSidebarOpen(false);
});

function initializeIcons() {
  if (!window.lucide?.createIcons) {
    console.error("Lucide icon library failed to load.");
    return;
  }

  window.lucide.createIcons();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeIcons, { once: true });
} else {
  initializeIcons();
}

const pageName = window.location.pathname.split("/").pop() || "index.html";
const currentPage = pageName === "dashboard.html" ? "index.html" : pageName;
document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
  if (link.dataset.page === currentPage) link.setAttribute("aria-current", "page");
});

const currentDate = document.querySelector("[data-current-date]");
if (currentDate) {
  currentDate.textContent = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

document.querySelectorAll(".notification-button").forEach((button) => {
  button.addEventListener("click", () => {
    let notice = document.querySelector("[data-notification-notice]");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "class-toast";
      notice.dataset.notificationNotice = "";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.append(notice);
    }
    notice.textContent = "You’re all caught up. No new notifications.";
    notice.hidden = false;
    window.clearTimeout(notice.hideTimer);
    notice.hideTimer = window.setTimeout(() => {
      notice.hidden = true;
    }, 3500);
  });
});
