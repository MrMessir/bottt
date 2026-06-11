const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const content = document.getElementById("content");
const profileLine = document.getElementById("profileLine");
const tabs = document.querySelectorAll(".tabs button");
const bottomNavTabs = document.querySelectorAll("#bottomNav button");
const notifyBtn = document.getElementById("notifyBtn");
const pullIndicator = document.getElementById("pullIndicator");
const appShell = document.querySelector(".app-shell");

let telegramId = null;
let bootstrapData = null;
let currentTab = "profile";
let pullInProgress = false;
let touchStartX = null;
let touchStartY = null;
let pullTriggered = false;
let gestureLocked = false;
const TAB_ORDER = ["profile", "grades", "attendance", "homework", "schedule", "rating", "manage"];
const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, button, form")) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return false;
}

function triggerHaptic(kind = "selection") {
  if (!tg?.HapticFeedback) return;
  if (kind === "success") tg.HapticFeedback.notificationOccurred("success");
  else if (kind === "error") tg.HapticFeedback.notificationOccurred("error");
  else tg.HapticFeedback.selectionChanged();
}

function applyTelegramTheme() {
  if (!tg?.themeParams) return;
  const root = document.documentElement;
  const params = tg.themeParams;
  if (params.bg_color) root.style.setProperty("--bg", params.bg_color);
  if (params.text_color) root.style.setProperty("--text", params.text_color);
  if (params.hint_color) root.style.setProperty("--muted", params.hint_color);
  if (params.button_color && params.button_text_color) {
    root.style.setProperty("--tab-active-bg", params.button_color);
  }
  if (params.secondary_bg_color) {
    document.body.style.background = `radial-gradient(circle at 20% 20%, ${params.secondary_bg_color} 0%, ${params.bg_color || "#0b1020"} 50%, ${params.bg_color || "#06070f"} 100%)`;
  }
}

function getTelegramId() {
  const urlId = new URLSearchParams(window.location.search).get("tg_id");
  if (urlId) return urlId;
  return tg?.initDataUnsafe?.user?.id || null;
}

function getAuthHeaders() {
  const headers = { "X-Telegram-Id": String(telegramId) };
  if (tg?.initData) headers["X-Telegram-Init-Data"] = tg.initData;
  return headers;
}

async function apiGet(path) {
  if (!telegramId) throw new Error("Не удалось получить telegram id");
  const response = await fetch(`${apiUrl(path)}?tg_id=${telegramId}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 && text.includes("GitHub Pages")) {
      throw new Error("API бота не настроен. Укажите api-base в index.html");
    }
    throw new Error(text.slice(0, 120) || `HTTP ${response.status}`);
  }
  return response.json();
}

async function apiPost(path, payload) {
  if (!telegramId) throw new Error("Не удалось получить telegram id");
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function renderCards(items, mapper) {
  if (!items.length) return `<p class="muted">Данных пока нет.</p>`;
  return `<div class="grid">${items.map((item, idx) => `<article class="card">${mapper(item, idx)}</article>`).join("")}</div>`;
}

function renderSkeleton(count = 4) {
  content.innerHTML = `
    <div class="grid">
      ${Array.from({ length: count })
        .map(
          () => `
          <article class="card">
            <div class="skeleton"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line" style="width: 45%"></div>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function roleLabel(role) {
  const map = { student: "Студент", starosta: "Староста", teacher: "Преподаватель", admin: "Админ" };
  return map[role] || role;
}

function setupManageActions() {
  const bindForm = (formId, endpoint, payloadFactory) => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".status");
      try {
        const payload = payloadFactory(form);
        await apiPost(endpoint, payload);
        status.textContent = "Готово. Данные синхронизированы с ботом.";
        status.style.color = "#7BFFCF";
        triggerHaptic("success");
        form.reset();
      } catch (err) {
        status.textContent = `Ошибка: ${err.message}`;
        status.style.color = "#FF9EB1";
        triggerHaptic("error");
      }
    });
  };

  bindForm("addGradeForm", "/api/teacher/add-grade", (form) => ({
    student_id: Number(form.student_id.value),
    subject_name: form.subject_name.value.trim(),
    grade: Number(form.grade.value),
    comment: form.comment.value.trim(),
  }));

  bindForm("markAttendForm", "/api/teacher/mark-attendance", (form) => ({
    student_id: Number(form.student_id.value),
    subject_name: form.subject_name.value.trim(),
    status: form.status.value,
  }));

  bindForm("addHomeworkForm", "/api/teacher/add-homework", (form) => ({
    subject_name: form.subject_name.value.trim(),
    description: form.description.value.trim(),
    deadline: form.deadline.value ? new Date(form.deadline.value).toISOString() : "",
  }));

  bindForm("announceForm", "/api/teacher/announce", (form) => ({
    text: form.text.value.trim(),
  }));
}

function renderManageTab() {
  if (!bootstrapData.permissions.can_manage) {
    content.innerHTML = `<p class="muted">Вкладка доступна только старосте, преподавателю и админу.</p>`;
    return;
  }
  const students = bootstrapData.directory.students
    .map((s) => `<option value="${s.id}">${s.full_name}${s.username ? ` (@${s.username})` : ""}</option>`)
    .join("");
  const subjects = bootstrapData.directory.subjects.map((s) => `<option value="${s.name}">${s.name}</option>`).join("");
  content.innerHTML = `
    <div class="grid">
      <form id="addGradeForm" class="card">
        <h3>Добавить оценку</h3>
        <select name="student_id" required>${students}</select>
        <input name="subject_name" list="subjectList" placeholder="Предмет" required />
        <input name="grade" type="number" min="0" max="100" step="0.1" placeholder="Оценка" required />
        <input name="comment" placeholder="Комментарий (опционально)" />
        <button class="primary" type="submit">Сохранить</button>
        <div class="status muted"></div>
      </form>

      <form id="markAttendForm" class="card">
        <h3>Отметить посещаемость</h3>
        <select name="student_id" required>${students}</select>
        <input name="subject_name" list="subjectList" placeholder="Предмет" required />
        <select name="status" required>
          <option value="present">present</option>
          <option value="late">late</option>
          <option value="absent">absent</option>
          <option value="excused">excused</option>
        </select>
        <button class="primary" type="submit">Отметить</button>
        <div class="status muted"></div>
      </form>

      <form id="addHomeworkForm" class="card">
        <h3>Добавить ДЗ</h3>
        <input name="subject_name" list="subjectList" placeholder="Предмет" required />
        <textarea name="description" placeholder="Описание задания" required></textarea>
        <input name="deadline" type="datetime-local" />
        <button class="primary" type="submit">Создать</button>
        <div class="status muted"></div>
      </form>

      <form id="announceForm" class="card">
        <h3>Объявление группе</h3>
        <textarea name="text" placeholder="Текст объявления" required></textarea>
        <button class="primary" type="submit">Отправить</button>
        <div class="status muted"></div>
      </form>
    </div>
    <datalist id="subjectList">${subjects}</datalist>
  `;
  setupManageActions();
}

async function renderTab(tab, options = {}) {
  const { withSkeleton = true } = options;
  try {
    content.classList.add("is-loading");
    if (withSkeleton) renderSkeleton(tab === "manage" ? 2 : 4);
    const profile = bootstrapData.profile;
    if (tab === "profile") {
      content.innerHTML = `
        <div class="grid">
          <article class="card">
            <h3>${profile.full_name}</h3>
            <p>Роль: ${roleLabel(profile.role)}</p>
            <p>Группа: ${profile.group || "не назначена"}</p>
            <p class="muted">Username: ${profile.username || "не указан"}</p>
          </article>
          <article class="card">
            <h3>Средний балл</h3>
            <div class="kpi">${profile.average_grade}</div>
            <p class="muted">Обновляется из общей БД бота в реальном времени</p>
          </article>
        </div>
      `;
      return;
    }

    if (tab === "grades") {
      const rows = await apiGet("/api/grades");
      content.innerHTML = renderCards(rows, (x) => `
        <b>${x.subject}</b><br/>
        Оценка: ${x.grade}<br/>
        Дата: ${new Date(x.created_at).toLocaleString()}<br/>
        ${x.comment ? `Комментарий: ${x.comment}` : '<span class="muted">Без комментария</span>'}
      `);
      return;
    }

    if (tab === "attendance") {
      const rows = await apiGet("/api/attendance");
      content.innerHTML = renderCards(rows, (x) => `
        <b>${x.subject}</b><br/>
        Статус: ${x.status}<br/>
        Дата: ${new Date(x.date).toLocaleDateString()}
      `);
      return;
    }

    if (tab === "homework") {
      const rows = await apiGet("/api/homework");
      content.innerHTML = renderCards(rows, (x) => `
        <b>${x.subject}</b><br/>
        ${x.description}<br/>
        <span class="muted">Дедлайн: ${x.deadline ? new Date(x.deadline).toLocaleString() : "не указан"}</span>
      `);
      return;
    }

    if (tab === "schedule") {
      const rows = await apiGet("/api/schedule");
      content.innerHTML = renderCards(rows, (x) => `
        <b>День ${x.day_of_week}, пара ${x.lesson_number}</b><br/>
        ${x.subject}<br/>
        ${x.is_online ? "Online" : `Кабинет: ${x.classroom || "не указан"}`}
      `);
      return;
    }

    if (tab === "rating") {
      const rows = await apiGet("/api/rating");
      content.innerHTML = renderCards(rows, (x, idx) => `
        <b>${idx + 1}. ${x.name}</b><br/>
        Средний балл: ${x.avg_grade}
      `);
      return;
    }

    if (tab === "manage") {
      renderManageTab();
    }
  } catch (err) {
    content.innerHTML = `<p class="muted">Ошибка: ${err.message}</p>`;
  } finally {
    content.classList.remove("is-loading");
  }
}

function setActiveTab(tab) {
  tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  bottomNavTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
}

async function navigateToTab(tab, options = {}) {
  currentTab = tab;
  setActiveTab(tab);
  triggerHaptic("selection");
  await renderTab(tab, options);
}

function onTabClick(btn) {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;
    await navigateToTab(tab);
  });
}

tabs.forEach((btn) => {
  onTabClick(btn);
});

bottomNavTabs.forEach((btn) => {
  onTabClick(btn);
});

notifyBtn.addEventListener("click", async () => {
  if (!bootstrapData) return;
  const nextEnabled = !bootstrapData.profile.notifications_enabled;
  try {
    const result = await apiPost("/api/toggle-notify", { enabled: nextEnabled });
    bootstrapData.profile.notifications_enabled = result.enabled;
    notifyBtn.textContent = result.enabled ? "🔔" : "🔕";
    triggerHaptic("success");
  } catch (err) {
    triggerHaptic("error");
    tg?.showAlert?.(`Ошибка уведомлений: ${err.message}`);
  }
});

function showPullIndicator(visible) {
  if (!pullIndicator) return;
  pullIndicator.classList.toggle("visible", visible);
}

async function refreshCurrentTab() {
  if (pullInProgress) return;
  pullInProgress = true;
  showPullIndicator(true);
  try {
    bootstrapData = await apiGet("/api/bootstrap");
    const profile = bootstrapData.profile;
    notifyBtn.textContent = profile.notifications_enabled ? "🔔" : "🔕";
    profileLine.textContent = `${profile.full_name} • ${profile.group || "без группы"} • ${roleLabel(profile.role)}`;
    await renderTab(currentTab, { withSkeleton: false });
    triggerHaptic("success");
  } catch (err) {
    triggerHaptic("error");
    tg?.showAlert?.(`Не удалось обновить: ${err.message}`);
  } finally {
    pullInProgress = false;
    setTimeout(() => showPullIndicator(false), 160);
  }
}

function setupGestures() {
  if (!appShell) return;
  appShell.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    pullTriggered = false;
    gestureLocked = isInteractiveTarget(event.target);
  }, { passive: true });

  appShell.addEventListener("touchmove", (event) => {
    if (gestureLocked) return;
    if (touchStartY === null) return;
    const touch = event.changedTouches[0];
    const deltaY = touch.clientY - touchStartY;
    const deltaX = touch.clientX - touchStartX;
    if (!pullTriggered && window.scrollY <= 0 && deltaY > 90 && Math.abs(deltaX) < 30) {
      pullTriggered = true;
      refreshCurrentTab();
    }
  }, { passive: true });

  appShell.addEventListener("touchend", async (event) => {
    if (gestureLocked) {
      touchStartX = null;
      touchStartY = null;
      gestureLocked = false;
      return;
    }
    if (touchStartX === null || touchStartY === null) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    const horizontalSwipe = Math.abs(deltaX) > 70 && Math.abs(deltaY) < 45;
    if (horizontalSwipe) {
      const currentIdx = TAB_ORDER.indexOf(currentTab);
      if (currentIdx >= 0) {
        const nextIdx = deltaX < 0 ? currentIdx + 1 : currentIdx - 1;
        if (nextIdx >= 0 && nextIdx < TAB_ORDER.length) {
          const nextTab = TAB_ORDER[nextIdx];
          await navigateToTab(nextTab);
        }
      }
    }
    touchStartX = null;
    touchStartY = null;
    gestureLocked = false;
  }, { passive: true });
}

async function bootstrap() {
  applyTelegramTheme();
  tg?.onEvent?.("themeChanged", applyTelegramTheme);
  telegramId = getTelegramId();
  if (!telegramId) {
    profileLine.textContent = "Не удалось получить Telegram ID";
    content.innerHTML = `<p class="muted">Открой Mini App из бота, чтобы загрузить данные.</p>`;
    return;
  }
  renderSkeleton(4);
  bootstrapData = await apiGet("/api/bootstrap");
  const profile = bootstrapData.profile;
  notifyBtn.textContent = profile.notifications_enabled ? "🔔" : "🔕";
  profileLine.textContent = `${profile.full_name} • ${profile.group || "без группы"} • ${roleLabel(profile.role)}`;
  setupGestures();
  await navigateToTab("profile");
}

bootstrap().catch((err) => {
  content.innerHTML = `<p class="muted">Ошибка загрузки: ${err.message}</p>`;
});
