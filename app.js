const DB_NAME = "nhac-thuoc-an-lanh-db";
const DB_VERSION = 1;
const LEGACY_STORAGE_KEY = "medicine-reminder-vi-v1";
const SNOOZE_MINUTES = 10;
const dayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

let db;
let state = {
  meds: [],
  records: {},
  snoozes: {},
  settings: {
    migratedLegacy: false,
  },
};
let activeView = "home";
let alertOccurrence = null;
let alarmAudio = null;
let toastTimer = null;

const els = {
  dateLine: document.querySelector("#dateLine"),
  shortDateText: document.querySelector("#shortDateText"),
  clockText: document.querySelector("#clockText"),
  nextDoseMeta: document.querySelector("#nextDoseMeta"),
  homeTitle: document.querySelector("#homeTitle"),
  upcomingList: document.querySelector("#upcomingList"),
  medicineList: document.querySelector("#medicineList"),
  medicineForm: document.querySelector("#medicineForm"),
  medicineId: document.querySelector("#medicineId"),
  medicineName: document.querySelector("#medicineName"),
  medicineDose: document.querySelector("#medicineDose"),
  medicineNotes: document.querySelector("#medicineNotes"),
  medicinePhoto: document.querySelector("#medicinePhoto"),
  medicinePhotoData: document.querySelector("#medicinePhotoData"),
  photoPreview: document.querySelector("#photoPreview"),
  removePhotoBtn: document.querySelector("#removePhotoBtn"),
  timeInputs: document.querySelector("#timeInputs"),
  addTimeBtn: document.querySelector("#addTimeBtn"),
  resetFormBtn: document.querySelector("#resetFormBtn"),
  deleteMedicineBtn: document.querySelector("#deleteMedicineBtn"),
  dayGrid: document.querySelector("#dayGrid"),
  notificationBtn: document.querySelector("#notificationBtn"),
  testAlarmBtn: document.querySelector("#testAlarmBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importFile: document.querySelector("#importFile"),
  alarmDialog: document.querySelector("#alarmDialog"),
  alarmTitle: document.querySelector("#alarmTitle"),
  alarmDose: document.querySelector("#alarmDose"),
  alarmNotes: document.querySelector("#alarmNotes"),
  alarmPhoto: document.querySelector("#alarmPhoto"),
  alarmTakenBtn: document.querySelector("#alarmTakenBtn"),
  alarmSnoozeBtn: document.querySelector("#alarmSnoozeBtn"),
  toast: document.querySelector("#toast"),
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("meds")) {
        database.createObjectStore("meds", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllMeds() {
  return requestToPromise(tx("meds").getAll());
}

async function putMed(med) {
  return requestToPromise(tx("meds", "readwrite").put(med));
}

async function deleteMed(id) {
  return requestToPromise(tx("meds", "readwrite").delete(id));
}

async function getMeta(key, fallback) {
  const row = await requestToPromise(tx("meta").get(key));
  return row ? row.value : fallback;
}

async function setMeta(key, value) {
  return requestToPromise(tx("meta", "readwrite").put({ key, value }));
}

async function loadState() {
  state.meds = await getAllMeds();
  state.records = await getMeta("records", {});
  state.snoozes = await getMeta("snoozes", {});
  state.settings = await getMeta("settings", { migratedLegacy: false });

  if (!state.settings.migratedLegacy) {
    await migrateLegacyData();
  }
}

async function saveMetaState() {
  await Promise.all([
    setMeta("records", state.records),
    setMeta("snoozes", state.snoozes),
    setMeta("settings", state.settings),
  ]);
}

async function migrateLegacyData() {
  const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (saved) {
    try {
      const legacy = JSON.parse(saved);
      if (Array.isArray(legacy.meds)) {
        await Promise.all(
          legacy.meds.map((med) =>
            putMed({
              ...med,
              photoData: med.photoData || "",
              active: med.active !== false,
            })
          )
        );
        state.meds = await getAllMeds();
      }
      state.records = legacy.records || state.records;
      state.snoozes = legacy.snoozes || state.snoozes;
    } catch {
      // Ignore old broken localStorage data.
    }
  }
  state.settings.migratedLegacy = true;
  await saveMetaState();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeLabel(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function longDate(date = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeOccurrenceId(dayKey, medId, time) {
  return `${dayKey}|${medId}|${time}`;
}

function occurrenceDate(day, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(day);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function getOccurrencesForDate(day) {
  const key = dateKey(day);
  const weekday = day.getDay();

  return state.meds
    .filter((med) => med.active !== false && med.days.includes(weekday))
    .flatMap((med) =>
      med.times.map((time) => {
        const id = makeOccurrenceId(key, med.id, time);
        const dueAt = occurrenceDate(day, time);
        const snoozedUntil = state.snoozes[id] ? new Date(state.snoozes[id]) : null;
        const effectiveDueAt = snoozedUntil && snoozedUntil > dueAt ? snoozedUntil : dueAt;
        return {
          id,
          med,
          dateKey: key,
          time,
          dueAt,
          effectiveDueAt,
          taken: Boolean(state.records[id]),
          snoozedUntil,
        };
      })
    )
    .sort((a, b) => a.effectiveDueAt - b.effectiveDueAt || a.med.name.localeCompare(b.med.name, "vi"));
}

function getUpcomingOccurrences(daysAhead = 10) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const occurrences = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    occurrences.push(...getOccurrencesForDate(day));
  }
  return occurrences.sort((a, b) => a.effectiveDueAt - b.effectiveDueAt);
}

function getVisibleUpcoming(now = new Date()) {
  const earliest = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  return getUpcomingOccurrences()
    .filter((item) => !item.taken && item.effectiveDueAt >= earliest)
    .slice(0, 12);
}

function getStatus(occurrence, now = new Date()) {
  if (occurrence.effectiveDueAt <= now) return "overdue";
  const minutesAway = (occurrence.effectiveDueAt - now) / 60000;
  if (minutesAway <= 60) return "soon";
  return "upcoming";
}

function distanceText(target, now = new Date()) {
  const diffMs = target - now;
  const minutes = Math.max(0, Math.ceil(Math.abs(diffMs) / 60000));
  const hours = Math.floor(minutes / 60);
  const leftMinutes = minutes % 60;
  if (diffMs <= 0) {
    if (minutes < 1) return "Đến giờ";
    return `Trễ ${hours ? `${hours} giờ ` : ""}${leftMinutes} phút`;
  }
  if (hours === 0) return `Còn ${leftMinutes} phút`;
  return `Còn ${hours} giờ ${leftMinutes} phút`;
}

function render() {
  const now = new Date();
  els.clockText.textContent = timeLabel(now);
  els.dateLine.textContent = longDate(now);
  els.shortDateText.textContent = longDate(now);
  renderHome(now);
  renderMedicineList();
  updateIcons();
}

function renderHome(now) {
  const upcoming = getVisibleUpcoming(now);
  const next = upcoming[0];

  if (!next) {
    els.homeTitle.textContent = "Chưa có lịch sắp tới";
    els.nextDoseMeta.textContent = "Vào Thêm lịch để tạo nhắc uống thuốc.";
    els.upcomingList.innerHTML = emptyState("calendar-plus", "Chưa có lịch nào trong 10 ngày tới.");
    return;
  }

  els.homeTitle.textContent = `${next.med.name} - ${next.med.dose}`;
  els.nextDoseMeta.textContent = `${dateLabel(next.effectiveDueAt, now)} lúc ${timeLabel(next.effectiveDueAt)} - ${distanceText(next.effectiveDueAt, now)}`;
  els.upcomingList.innerHTML = upcoming.map((item) => renderDoseCard(item, now)).join("");
}

function renderDoseCard(item, now) {
  const status = getStatus(item, now);
  const statusText = {
    overdue: "Quá giờ",
    soon: "Sắp đến giờ",
    upcoming: "Sắp tới",
  }[status];
  const photo = item.med.photoData
    ? `<img class="dose-photo" src="${item.med.photoData}" alt="Ảnh ${escapeHtml(item.med.name)}" />`
    : `<div class="photo-placeholder" aria-hidden="true"><i data-lucide="pill"></i></div>`;

  return `
    <article class="dose-card ${status}" data-id="${item.id}">
      ${photo}
      <div class="dose-main">
        <div class="dose-time">${timeLabel(item.effectiveDueAt)}</div>
        <h3>${escapeHtml(item.med.name)}</h3>
        <p>${escapeHtml(item.med.dose)}</p>
        <p class="card-text">${dateLabel(item.effectiveDueAt, now)} - ${distanceText(item.effectiveDueAt, now)}</p>
        ${item.med.notes ? `<p class="card-text">${escapeHtml(item.med.notes)}</p>` : ""}
        <span class="status-pill">${statusText}</span>
      </div>
      <div class="card-actions">
        <button class="mini-button primary" type="button" data-action="take" data-id="${item.id}">
          <i data-lucide="check"></i>
          <span>Đã uống</span>
        </button>
        <button class="mini-button" type="button" data-action="snooze" data-id="${item.id}">
          <i data-lucide="clock-3"></i>
          <span>10 phút</span>
        </button>
      </div>
    </article>
  `;
}

function renderMedicineList() {
  if (!state.meds.length) {
    els.medicineList.innerHTML = emptyState("pill", "Chưa có lịch thuốc nào.");
    return;
  }

  els.medicineList.innerHTML = state.meds
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    .map((med) => {
      const photo = med.photoData
        ? `<img class="med-photo" src="${med.photoData}" alt="Ảnh ${escapeHtml(med.name)}" />`
        : `<div class="photo-placeholder" aria-hidden="true"><i data-lucide="pill"></i></div>`;
      return `
        <article class="medicine-card" data-id="${med.id}">
          ${photo}
          <div class="medicine-main">
            <h3>${escapeHtml(med.name)}</h3>
            <p>${escapeHtml(med.dose)}</p>
            <p>${med.times.join(", ")} - ${med.days.length === 7 ? "Mỗi ngày" : med.days.map((day) => dayLabels[day]).join(", ")}</p>
            <span class="status-pill">${med.active === false ? "Đang tắt" : "Đang bật"}</span>
          </div>
          <div class="card-actions">
            <button class="mini-button" type="button" data-action="edit-med" data-id="${med.id}">
              <i data-lucide="pencil"></i>
              <span>Sửa</span>
            </button>
            <button class="mini-button ${med.active === false ? "" : "danger"}" type="button" data-action="toggle-med" data-id="${med.id}">
              <i data-lucide="${med.active === false ? "play" : "pause"}"></i>
              <span>${med.active === false ? "Bật" : "Tắt"}</span>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function dateLabel(date, now = new Date()) {
  const target = dateKey(date);
  const today = dateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (target === today) return "Hôm nay";
  if (target === dateKey(tomorrow)) return "Ngày mai";
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function emptyState(icon, text) {
  return `
    <div class="empty-state">
      <i data-lucide="${icon}"></i>
      <p>${text}</p>
    </div>
  `;
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${view}View`);
  });
}

function addTimeInput(value = "08:00") {
  const row = document.createElement("div");
  row.className = "time-input-row";
  row.innerHTML = `
    <input type="time" class="time-input" value="${value}" required />
    <button class="icon-button" type="button" title="Xóa giờ" data-action="remove-time">
      <i data-lucide="x"></i>
    </button>
  `;
  els.timeInputs.append(row);
  updateIcons();
}

function resetForm(shouldFocus = true) {
  els.medicineForm.reset();
  els.medicineId.value = "";
  els.medicinePhotoData.value = "";
  els.timeInputs.innerHTML = "";
  addTimeInput("08:00");
  els.deleteMedicineBtn.hidden = true;
  els.removePhotoBtn.hidden = true;
  els.dayGrid.querySelectorAll("input").forEach((input) => {
    input.checked = true;
  });
  renderPhotoPreview("");
  if (shouldFocus) els.medicineName.focus();
}

function renderPhotoPreview(dataUrl) {
  if (!dataUrl) {
    els.photoPreview.classList.add("empty");
    els.photoPreview.innerHTML = `<i data-lucide="image"></i><span>Chưa có ảnh</span>`;
    els.removePhotoBtn.hidden = true;
    updateIcons();
    return;
  }

  els.photoPreview.classList.remove("empty");
  els.photoPreview.innerHTML = `<img src="${dataUrl}" alt="Ảnh thuốc đang chọn" />`;
  els.removePhotoBtn.hidden = false;
}

function collectFormData() {
  const times = [...els.timeInputs.querySelectorAll(".time-input")]
    .map((input) => input.value)
    .filter(Boolean)
    .sort();
  const uniqueTimes = [...new Set(times)];
  const days = [...els.dayGrid.querySelectorAll("input:checked")].map((input) => Number(input.value));

  if (!uniqueTimes.length) throw new Error("Vui lòng chọn ít nhất một giờ nhắc.");
  if (!days.length) throw new Error("Vui lòng chọn ít nhất một ngày nhắc.");

  const existing = state.meds.find((med) => med.id === els.medicineId.value);
  return {
    id: els.medicineId.value || makeId(),
    name: els.medicineName.value.trim(),
    dose: els.medicineDose.value.trim(),
    notes: els.medicineNotes.value.trim(),
    times: uniqueTimes,
    days,
    photoData: els.medicinePhotoData.value,
    active: existing ? existing.active !== false : true,
    updatedAt: new Date().toISOString(),
  };
}

async function saveMedicine(event) {
  event.preventDefault();
  try {
    const med = collectFormData();
    await putMed(med);
    state.meds = await getAllMeds();
    resetForm(false);
    switchView("home");
    render();
    showToast("Đã lưu lịch nhắc.");
  } catch (error) {
    showToast(error.message || "Chưa lưu được lịch nhắc.");
  }
}

function editMedicine(id) {
  const med = state.meds.find((item) => item.id === id);
  if (!med) return;

  switchView("manage");
  els.medicineId.value = med.id;
  els.medicineName.value = med.name;
  els.medicineDose.value = med.dose;
  els.medicineNotes.value = med.notes || "";
  els.medicinePhotoData.value = med.photoData || "";
  els.timeInputs.innerHTML = "";
  med.times.forEach((time) => addTimeInput(time));
  els.dayGrid.querySelectorAll("input").forEach((input) => {
    input.checked = med.days.includes(Number(input.value));
  });
  renderPhotoPreview(med.photoData || "");
  els.deleteMedicineBtn.hidden = false;
  els.medicineName.focus();
}

async function deleteCurrentMedicine() {
  const id = els.medicineId.value;
  if (!id) return;

  const med = state.meds.find((item) => item.id === id);
  const confirmed = window.confirm(`Xóa lịch thuốc "${med?.name || ""}"?`);
  if (!confirmed) return;

  await deleteMed(id);
  Object.keys(state.records).forEach((key) => {
    if (key.includes(`|${id}|`)) delete state.records[key];
  });
  Object.keys(state.snoozes).forEach((key) => {
    if (key.includes(`|${id}|`)) delete state.snoozes[key];
  });
  await saveMetaState();
  state.meds = await getAllMeds();
  resetForm(false);
  render();
  showToast("Đã xóa lịch thuốc.");
}

async function toggleMedicine(id) {
  const med = state.meds.find((item) => item.id === id);
  if (!med) return;
  med.active = med.active === false;
  med.updatedAt = new Date().toISOString();
  await putMed(med);
  state.meds = await getAllMeds();
  render();
  showToast(med.active ? "Đã bật nhắc thuốc." : "Đã tắt nhắc thuốc.");
}

async function handleTake(occurrenceId) {
  const occurrence = findOccurrence(occurrenceId);
  if (!occurrence) {
    if (alertOccurrence?.id === occurrenceId) {
      stopAlarm();
      closeAlarm();
      showToast("Đã tắt chuông thử.");
    }
    return;
  }

  state.records[occurrence.id] = {
    takenAt: new Date().toISOString(),
    medName: occurrence.med.name,
    dose: occurrence.med.dose,
    scheduledTime: occurrence.time,
  };
  delete state.snoozes[occurrence.id];
  await saveMetaState();
  stopAlarm();
  closeAlarm();
  render();
  showToast(`Đã ghi nhận ${occurrence.med.name}.`);
}

async function handleSnooze(occurrenceId) {
  const occurrence = findOccurrence(occurrenceId);
  if (!occurrence) {
    if (alertOccurrence?.id === occurrenceId) {
      stopAlarm();
      closeAlarm();
      showToast("Đã tắt chuông thử.");
    }
    return;
  }

  const until = new Date(Date.now() + SNOOZE_MINUTES * 60000);
  state.snoozes[occurrence.id] = until.toISOString();
  await saveMetaState();
  stopAlarm();
  closeAlarm();
  render();
  showToast(`Sẽ nhắc lại lúc ${timeLabel(until)}.`);
}

function findOccurrence(id) {
  return getUpcomingOccurrences(2).find((item) => item.id === id) || getOccurrencesForDate(new Date()).find((item) => item.id === id);
}

function checkDueReminders() {
  if (alertOccurrence || els.alarmDialog.open) return;

  const now = new Date();
  const due = getOccurrencesForDate(now).find((item) => {
    if (item.taken) return false;
    if (item.effectiveDueAt > now) return false;
    return (now - item.effectiveDueAt) / 60000 <= 12 * 60;
  });

  if (due) openAlarm(due);
}

function openAlarm(occurrence) {
  alertOccurrence = occurrence;
  els.alarmTitle.textContent = occurrence.med.name;
  els.alarmDose.textContent = occurrence.med.dose;
  els.alarmNotes.textContent = occurrence.med.notes || "Kiểm tra đúng thuốc trước khi uống.";
  els.alarmTakenBtn.dataset.id = occurrence.id;
  els.alarmSnoozeBtn.dataset.id = occurrence.id;

  if (occurrence.med.photoData) {
    els.alarmPhoto.src = occurrence.med.photoData;
    els.alarmPhoto.hidden = false;
  } else {
    els.alarmPhoto.hidden = true;
    els.alarmPhoto.removeAttribute("src");
  }

  if (!els.alarmDialog.open) els.alarmDialog.showModal();
  startAlarm(occurrence);
  updateIcons();
}

function closeAlarm() {
  alertOccurrence = null;
  if (els.alarmDialog.open) els.alarmDialog.close();
}

function startAlarm(occurrence) {
  playAlarmPattern();
  if ("vibrate" in navigator) navigator.vibrate([280, 120, 280, 120, 700]);
  sendNotification(occurrence);
}

function playAlarmPattern() {
  stopAlarm();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = new AudioContext();
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  gain.gain.value = 0.0001;
  gain.connect(context.destination);
  oscillator.type = "triangle";
  oscillator.frequency.value = 820;
  oscillator.connect(gain);
  oscillator.start();

  let active = true;
  const pulse = () => {
    if (!active) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  };
  pulse();
  const interval = window.setInterval(pulse, 1100);

  alarmAudio = {
    stop() {
      active = false;
      window.clearInterval(interval);
      oscillator.stop();
      context.close();
    },
  };
}

function stopAlarm() {
  if (alarmAudio) {
    alarmAudio.stop();
    alarmAudio = null;
  }
  if ("vibrate" in navigator) navigator.vibrate(0);
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("Trình duyệt này chưa hỗ trợ thông báo.");
    return;
  }
  const result = await Notification.requestPermission();
  showToast(result === "granted" ? "Đã bật thông báo." : "Chưa bật được thông báo.");
}

function sendNotification(occurrence) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("Đến giờ uống thuốc", {
    body: `${occurrence.med.name} - ${occurrence.med.dose}`,
    tag: occurrence.id,
    requireInteraction: true,
  });
}

async function handlePhoto(file) {
  if (!file) return;
  try {
    const dataUrl = await resizeImage(file, 900, 0.78);
    els.medicinePhotoData.value = dataUrl;
    renderPhotoPreview(dataUrl);
    showToast("Đã thêm ảnh thuốc.");
  } catch {
    showToast("Chưa đọc được ảnh thuốc.");
  }
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    meds: state.meds,
    records: state.records,
    snoozes: state.snoozes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lich-thuoc-${dateKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.meds)) throw new Error("bad data");
      await Promise.all(imported.meds.map((med) => putMed({ ...med, id: med.id || makeId() })));
      state.records = imported.records || {};
      state.snoozes = imported.snoozes || {};
      await saveMetaState();
      state.meds = await getAllMeds();
      resetForm(false);
      render();
      showToast("Đã nhập dữ liệu.");
    } catch {
      showToast("File dữ liệu không hợp lệ.");
    }
  };
  reader.readAsText(file);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateIcons() {
  window.lucide?.createIcons();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.medicineForm.addEventListener("submit", saveMedicine);
  els.addTimeBtn.addEventListener("click", () => addTimeInput("08:00"));
  els.resetFormBtn.addEventListener("click", () => resetForm());
  els.deleteMedicineBtn.addEventListener("click", deleteCurrentMedicine);
  els.notificationBtn.addEventListener("click", requestNotifications);
  els.exportBtn.addEventListener("click", exportData);
  els.testAlarmBtn.addEventListener("click", () => {
    openAlarm({
      id: `sample-${Date.now()}`,
      med: {
        name: "Thuốc mẫu",
        dose: "1 viên",
        notes: "Đây là chuông thử.",
        photoData: "",
      },
    });
  });

  els.timeInputs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='remove-time']");
    if (!button) return;
    if (els.timeInputs.querySelectorAll(".time-input-row").length === 1) {
      showToast("Cần giữ ít nhất một giờ nhắc.");
      return;
    }
    button.closest(".time-input-row").remove();
  });

  els.upcomingList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "take") handleTake(button.dataset.id);
    if (button.dataset.action === "snooze") handleSnooze(button.dataset.id);
  });

  els.medicineList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-med") editMedicine(button.dataset.id);
    if (button.dataset.action === "toggle-med") toggleMedicine(button.dataset.id);
  });

  els.medicinePhoto.addEventListener("change", (event) => {
    const [file] = event.target.files;
    handlePhoto(file);
    event.target.value = "";
  });

  els.removePhotoBtn.addEventListener("click", () => {
    els.medicinePhotoData.value = "";
    renderPhotoPreview("");
  });

  els.importFile.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importData(file);
    event.target.value = "";
  });

  els.alarmTakenBtn.addEventListener("click", () => handleTake(els.alarmTakenBtn.dataset.id));
  els.alarmSnoozeBtn.addEventListener("click", () => handleSnooze(els.alarmSnoozeBtn.dataset.id));
  els.alarmDialog.addEventListener("cancel", (event) => event.preventDefault());
}

async function init() {
  if (!("indexedDB" in window)) {
    showToast("Trình duyệt này không hỗ trợ IndexedDB.");
    return;
  }
  db = await openDb();
  await loadState();
  bindEvents();
  resetForm(false);
  render();
  registerServiceWorker();
  window.setInterval(() => {
    render();
    checkDueReminders();
  }, 5000);
  checkDueReminders();
}

init().catch(() => {
  showToast("Không khởi động được dữ liệu lịch thuốc.");
});
