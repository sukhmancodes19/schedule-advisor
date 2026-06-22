const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const appEl = document.getElementById("app");
const minimizeBtn = document.getElementById("minimizeChat");
const chatBubble = document.getElementById("chatBubble");
const boardEl = document.getElementById("board");
const boardColumnsEl = document.getElementById("boardColumns");
const calendarViewEl = document.getElementById("calendarView");
const calendarGridEl = document.getElementById("calendarGrid");
const unscheduledBarEl = document.getElementById("unscheduledBar");
const viewTabs = document.querySelectorAll(".view-tab");

const history = [];

const STORAGE_KEY = "schedule_board_v1";
let tasks = [];
let boardActive = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.tasks)) {
      tasks = saved.tasks;
      boardActive = !!saved.boardActive;
    }
  } catch {
    // ignore corrupt storage
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, boardActive }));
}

// ---------- Markdown rendering ----------

function renderMarkdown(bubble, text) {
  const html = marked.parse(text, { breaks: true });
  bubble.innerHTML = DOMPurify.sanitize(html);
}

function addBubble(role, text) {
  const isAssistant = role.startsWith("assistant");

  const row = document.createElement("div");
  row.className = `msg-row ${isAssistant ? "assistant" : "user"}`;

  if (isAssistant) {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = "🤖";
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  if (isAssistant) {
    renderMarkdown(bubble, text);
  } else {
    bubble.textContent = text;
  }
  row.appendChild(bubble);

  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

// ---------- Schedule block extraction ----------

function extractSchedule(text) {
  const match = text.match(/```schedule\s*([\s\S]*?)```/);
  if (!match) return { cleanText: text, items: null };

  const cleanText = text.replace(match[0], "").trim();
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      return { cleanText, items: parsed };
    }
  } catch {
    // malformed JSON, ignore
  }
  return { cleanText, items: null };
}

function applySchedule(items) {
  tasks = items
    .filter((item) => item && typeof item.title === "string" && item.title.trim())
    .map((item) => ({
      id: crypto.randomUUID(),
      title: item.title.trim(),
      time: typeof item.time === "string" ? item.time.trim() : "",
      description: typeof item.description === "string" ? item.description.trim() : "",
      column: "todo",
    }));
  saveState();
  addOptionsCard();
}

// ---------- Post-schedule view options ----------

function addOptionsCard() {
  const row = document.createElement("div");
  row.className = "msg-row assistant";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = "🤖";
  row.appendChild(avatar);

  const card = document.createElement("div");
  card.className = "options-card";

  const heading = document.createElement("p");
  heading.className = "options-heading";
  heading.textContent = "How would you like to see your schedule? (pick any)";
  card.appendChild(heading);

  const options = [
    { value: "pdf", label: "📄 Make a PDF table" },
    { value: "board", label: "📋 Trello-style board" },
    { value: "calendar", label: "📅 Calendar view" },
  ];

  const checkboxRefs = {};

  options.forEach((opt) => {
    const label = document.createElement("label");
    label.className = "options-checkbox-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = opt.value;

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(opt.label));
    card.appendChild(label);

    checkboxRefs[opt.value] = checkbox;
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "options-confirm-btn";
  confirmBtn.textContent = "Show me";
  card.appendChild(confirmBtn);

  confirmBtn.addEventListener("click", () => {
    const selected = Object.entries(checkboxRefs)
      .filter(([, cb]) => cb.checked)
      .map(([value]) => value);

    if (selected.length === 0) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Done!";
    Object.values(checkboxRefs).forEach((cb) => (cb.disabled = true));

    applyViewSelection(selected);
  });

  row.appendChild(card);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function applyViewSelection(selected) {
  if (selected.includes("pdf")) {
    generateSchedulePDF();
  }

  const wantsBoard = selected.includes("board");
  const wantsCalendar = selected.includes("calendar");

  if (wantsBoard || wantsCalendar) {
    boardActive = true;
    saveState();
    renderBoard();
    showBoard();
    minimizeChat();
    setActiveView(wantsCalendar && !wantsBoard ? "calendar" : "board");
  }
}

function generateSchedulePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const marginX = 14;
  let y = 18;

  doc.setFontSize(18);
  doc.setTextColor(255, 140, 66);
  doc.text("Your Schedule", marginX, y);
  y += 10;

  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);

  const colTime = marginX;
  const colTask = marginX + 38;
  const colDesc = marginX + 100;
  const rowHeight = 9;

  doc.setFont(undefined, "bold");
  doc.text("Time", colTime, y);
  doc.text("Task", colTask, y);
  doc.text("Description", colDesc, y);
  y += 3;
  doc.setDrawColor(230, 230, 230);
  doc.line(marginX, y, 196, y);
  y += 6;
  doc.setFont(undefined, "normal");

  tasks.forEach((task) => {
    const descLines = doc.splitTextToSize(task.description || "-", 95);
    const timeLines = doc.splitTextToSize(task.time || "-", 32);
    const titleLines = doc.splitTextToSize(task.title, 58);
    const lineCount = Math.max(descLines.length, timeLines.length, titleLines.length);
    const blockHeight = lineCount * 5 + 4;

    if (y + blockHeight > 280) {
      doc.addPage();
      y = 18;
    }

    doc.text(timeLines, colTime, y);
    doc.text(titleLines, colTask, y);
    doc.text(descLines, colDesc, y);
    y += blockHeight;
  });

  doc.save("schedule.pdf");
}

// ---------- Emoji matching ----------

const EMOJI_RULES = [
  { keywords: ["gym", "workout", "exercise", "run", "jog", "training", "fitness"], emoji: "🏋️" },
  { keywords: ["email", "inbox", "e-mail"], emoji: "📧" },
  { keywords: ["grocery", "groceries", "shopping", "store", "supermarket"], emoji: "🛒" },
  { keywords: ["doctor", "dentist", "appointment", "clinic", "checkup", "physical"], emoji: "🏥" },
  { keywords: ["family", "kids", "parents", "mom", "dad", "son", "daughter"], emoji: "👨‍👩‍👧" },
  { keywords: ["call", "phone"], emoji: "📞" },
  { keywords: ["meeting", "standup", "sync", "call with"], emoji: "🗓️" },
  { keywords: ["study", "exam", "homework", "class", "lecture", "school"], emoji: "📚" },
  { keywords: ["eat", "lunch", "dinner", "breakfast", "meal", "cook"], emoji: "🍽️" },
  { keywords: ["sleep", "nap", "rest", "bed"], emoji: "😴" },
  { keywords: ["clean", "laundry", "chore", "dishes", "tidy"], emoji: "🧹" },
  { keywords: ["walk", "dog", "pet"], emoji: "🐕" },
  { keywords: ["read", "book"], emoji: "📖" },
  { keywords: ["write", "writing", "report", "essay"], emoji: "✍️" },
  { keywords: ["code", "coding", "dev", "programming", "bug"], emoji: "💻" },
  { keywords: ["budget", "bill", "bank", "pay", "finance", "money"], emoji: "💰" },
  { keywords: ["travel", "flight", "trip", "drive", "commute"], emoji: "🚗" },
  { keywords: ["meditate", "yoga", "mindfulness"], emoji: "🧘" },
  { keywords: ["birthday", "party", "celebrate"], emoji: "🎉" },
];

function getEmoji(title) {
  const lower = title.toLowerCase();
  for (const rule of EMOJI_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.emoji;
  }
  return "📝";
}

const COLOR_OPTIONS = ["orange", "blue", "green", "purple", "pink"];

const COLOR_HEX = {
  orange: "#ff8c42",
  blue: "#4c9aff",
  green: "#2ecc71",
  purple: "#a78bfa",
  pink: "#f472b6",
};

// ---------- Board rendering ----------

function refreshViews() {
  renderBoard();
  if (!calendarViewEl.classList.contains("hidden")) renderCalendar();
}

function renderBoard() {
  ["todo", "doing", "done"].forEach((col) => {
    const container = boardEl.querySelector(`.cards[data-column="${col}"]`);
    container.innerHTML = "";
    const colTasks = tasks.filter((t) => t.column === col);
    boardEl.querySelector(`.count[data-count="${col}"]`).textContent = colTasks.length || "";
    colTasks.forEach((task) => container.appendChild(buildCard(task)));
  });
}

function buildCard(task) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.id = task.id;
  if (task.color) card.dataset.color = task.color;

  card.addEventListener("dragstart", () => {
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
  });

  const title = document.createElement("p");
  title.className = "card-title";
  const emoji = document.createElement("span");
  emoji.className = "card-emoji";
  emoji.textContent = getEmoji(task.title);
  title.appendChild(emoji);
  title.appendChild(document.createTextNode(task.title));
  title.title = "Click to edit";
  title.addEventListener("click", () => editCard(task.id, title));

  card.appendChild(title);

  if (task.time) {
    const time = document.createElement("div");
    time.className = "card-time";
    time.textContent = task.time;
    card.appendChild(time);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const colorBtn = document.createElement("button");
  colorBtn.type = "button";
  colorBtn.className = "color-swatch-btn";
  colorBtn.title = task.color ? `Color: ${task.color}` : "Add color tag";
  const dot = document.createElement("span");
  dot.className = "color-swatch-dot";
  if (task.color) {
    dot.classList.add("has-color");
    dot.style.setProperty("--swatch-color", COLOR_HEX[task.color] || "#fff");
  }
  colorBtn.appendChild(dot);
  colorBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleColorPopover(task.id, colorBtn);
  });

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.textContent = "✎";
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => editCard(task.id, title));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.textContent = "✕";
  delBtn.title = "Delete";
  delBtn.addEventListener("click", () => deleteCard(task.id));

  actions.appendChild(colorBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  card.appendChild(actions);

  return card;
}

function closeColorPopovers() {
  document.querySelectorAll(".color-popover").forEach((el) => el.remove());
}

function toggleColorPopover(id, anchorBtn) {
  const existing = anchorBtn.querySelector(".color-popover");
  closeColorPopovers();
  if (existing) return;

  const popover = document.createElement("div");
  popover.className = "color-popover";

  COLOR_OPTIONS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.style.background = COLOR_HEX[color];
    swatch.title = color;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      setCardColor(id, color);
      closeColorPopovers();
    });
    popover.appendChild(swatch);
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "clear-swatch";
  clearBtn.title = "No color";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setCardColor(id, null);
    closeColorPopovers();
  });
  popover.appendChild(clearBtn);

  anchorBtn.appendChild(popover);
}

document.addEventListener("click", closeColorPopovers);

function setCardColor(id, color) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.color = color;
  saveState();
  refreshViews();
}

function editCard(id, titleEl) {
  if (titleEl.isContentEditable) return;
  titleEl.contentEditable = "true";
  titleEl.focus();
  document.execCommand("selectAll", false, null);

  const finish = () => {
    titleEl.contentEditable = "false";
    const task = tasks.find((t) => t.id === id);
    const newTitle = titleEl.textContent.trim();
    if (task && newTitle) {
      task.title = newTitle;
      saveState();
      refreshViews();
    } else if (task) {
      titleEl.textContent = task.title;
    }
    titleEl.removeEventListener("blur", finish);
    titleEl.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleEl.blur();
    }
    if (e.key === "Escape") {
      const task = tasks.find((t) => t.id === id);
      titleEl.textContent = task ? task.title : "";
      titleEl.blur();
    }
  };

  titleEl.addEventListener("blur", finish);
  titleEl.addEventListener("keydown", onKey);
}

function deleteCard(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveState();
  refreshViews();
}

function addCard(column, titleText) {
  const trimmed = titleText.trim();
  if (!trimmed) return;
  tasks.push({ id: crypto.randomUUID(), title: trimmed, time: "", column });
  saveState();
  refreshViews();
}

function moveCard(id, column) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.column = column;
    saveState();
    refreshViews();
  }
}

function setupAddCardButtons() {
  document.querySelectorAll(".add-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const column = btn.dataset.column;
      if (btn.nextElementSibling && btn.nextElementSibling.classList.contains("add-card-form")) {
        return;
      }
      const form = document.createElement("div");
      form.className = "add-card-form";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Card title...";
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = "Add";

      const submit = () => {
        addCard(column, input.value);
        form.remove();
      };

      confirmBtn.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") form.remove();
      });

      form.appendChild(input);
      form.appendChild(confirmBtn);
      btn.insertAdjacentElement("afterend", form);
      input.focus();
    });
  });
}

function setupDropZones() {
  document.querySelectorAll(".cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const dragging = document.querySelector(".card.dragging");
      if (!dragging) return;
      moveCard(dragging.dataset.id, zone.dataset.column);
    });
  });
}

// ---------- Calendar view ----------

function parseClock(token) {
  const match = token.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3] ? match[3].toLowerCase() : null;
  if (hour > 23 || minute > 59) return null;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function parseTimeRange(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(/-|–|to/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const start = parseClock(parts[0]);
  if (start === null) return null;

  let end = parts.length > 1 ? parseClock(parts[1]) : null;
  if (end === null || end <= start) end = start + 60;

  return { start, end };
}

function formatClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(m / 60);
  const minute = m % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function minutesToInputValue(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(m / 60);
  const minute = m % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function inputValueToMinutes(value) {
  if (!value) return null;
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function buildCalendarGrid() {
  calendarGridEl.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const row = document.createElement("div");
    row.className = "hour-row";
    row.style.top = `${h * 60}px`;
    const label = document.createElement("span");
    label.className = "hour-label";
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? "AM" : "PM";
    label.textContent = `${displayHour} ${suffix}`;
    row.appendChild(label);
    calendarGridEl.appendChild(row);
  }
}

function renderCalendar() {
  buildCalendarGrid();
  unscheduledBarEl.innerHTML = "";

  const unscheduled = [];

  tasks.forEach((task) => {
    const range = parseTimeRange(task.time);
    if (!range) {
      unscheduled.push(task);
      return;
    }

    const event = document.createElement("div");
    event.className = "calendar-event";
    event.dataset.id = task.id;
    if (task.color) event.dataset.color = task.color;
    event.style.top = `${range.start}px`;
    event.style.height = `${Math.max(range.end - range.start, 22)}px`;

    const body = document.createElement("div");
    body.className = "event-body";

    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = `${getEmoji(task.title)} ${task.title}`;
    body.appendChild(title);

    if (range.end - range.start >= 30) {
      const timeLabel = document.createElement("div");
      timeLabel.className = "event-time";
      timeLabel.textContent = task.time;
      body.appendChild(timeLabel);
    }

    event.appendChild(body);

    if (task.image) {
      const thumb = document.createElement("img");
      thumb.className = "event-thumb";
      thumb.src = task.image;
      thumb.alt = "";
      event.appendChild(thumb);
    }

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    event.appendChild(handle);

    setupEventInteractions(event, task, handle);

    calendarGridEl.appendChild(event);
  });

  if (unscheduled.length) {
    const label = document.createElement("span");
    label.className = "unscheduled-label";
    label.textContent = "No time set:";
    unscheduledBarEl.appendChild(label);

    unscheduled.forEach((task) => {
      const chip = document.createElement("span");
      chip.className = "unscheduled-chip";
      chip.textContent = `${getEmoji(task.title)} ${task.title}`;
      chip.style.cursor = "pointer";
      if (task.color) chip.style.borderColor = COLOR_HEX[task.color] || "#e2e8f0";
      chip.addEventListener("click", () => openTaskModal(task.id));
      unscheduledBarEl.appendChild(chip);
    });
  }
}

function setActiveView(view) {
  viewTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  if (view === "calendar") {
    boardColumnsEl.classList.add("hidden");
    calendarViewEl.classList.remove("hidden");
    renderCalendar();
    const body = calendarViewEl.querySelector(".calendar-body");
    body.scrollTop = 7 * 60 - 40;
  } else {
    boardColumnsEl.classList.remove("hidden");
    calendarViewEl.classList.add("hidden");
  }
}

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveView(tab.dataset.view));
});

// ---------- Calendar event interactions (drag move / resize / click) ----------

function setupEventInteractions(eventEl, task, handle) {
  let mode = null; // "move" | "resize"
  let startY = 0;
  let startTop = 0;
  let startHeight = 0;
  let moved = false;

  const onMouseMove = (e) => {
    const delta = Math.round(e.clientY - startY);
    if (Math.abs(delta) > 3) moved = true;

    if (mode === "resize") {
      const newHeight = Math.max(15, startHeight + delta);
      eventEl.style.height = `${newHeight}px`;
    } else if (mode === "move") {
      let newTop = startTop + delta;
      newTop = Math.max(0, Math.min(newTop, 1440 - startHeight));
      eventEl.style.top = `${newTop}px`;
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    eventEl.classList.remove("dragging-event");

    if (moved) {
      const newTop = parseInt(eventEl.style.top, 10);
      const newHeight = parseInt(eventEl.style.height, 10);
      const newStart = Math.round(newTop / 5) * 5;
      const newEnd = Math.round((newTop + newHeight) / 5) * 5;
      task.time = `${formatClock(newStart)} - ${formatClock(newEnd)}`;
      saveState();
      refreshViews();
    } else if (mode === "move") {
      openTaskModal(task.id);
    }

    mode = null;
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    mode = "resize";
    moved = false;
    startY = e.clientY;
    startTop = parseInt(eventEl.style.top, 10);
    startHeight = parseInt(eventEl.style.height, 10);
    eventEl.classList.add("dragging-event");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  eventEl.addEventListener("mousedown", (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    mode = "move";
    moved = false;
    startY = e.clientY;
    startTop = parseInt(eventEl.style.top, 10);
    startHeight = parseInt(eventEl.style.height, 10);
    eventEl.classList.add("dragging-event");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// ---------- Task detail modal ----------

const taskModal = document.getElementById("taskModal");
const modalClose = document.getElementById("modalClose");
const modalColorRow = document.getElementById("modalColorRow");
const modalTitle = document.getElementById("modalTitle");
const modalStart = document.getElementById("modalStart");
const modalEnd = document.getElementById("modalEnd");
const modalDescription = document.getElementById("modalDescription");
const modalImagePreview = document.getElementById("modalImagePreview");
const modalImageImg = document.getElementById("modalImageImg");
const modalImageRemove = document.getElementById("modalImageRemove");
const modalImageInput = document.getElementById("modalImageInput");
const modalDelete = document.getElementById("modalDelete");
const modalSave = document.getElementById("modalSave");

let editingTaskId = null;
let pendingImage = undefined; // undefined = unchanged, null = removed, string = new data URL

function buildModalColorRow(selectedColor) {
  modalColorRow.innerHTML = "";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "clear-swatch";
  clearBtn.title = "No color";
  if (!selectedColor) clearBtn.classList.add("selected");
  clearBtn.addEventListener("click", () => {
    modalColorRow.dataset.selected = "";
    buildModalColorRow(null);
  });
  modalColorRow.appendChild(clearBtn);

  COLOR_OPTIONS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.style.background = COLOR_HEX[color];
    swatch.title = color;
    if (color === selectedColor) swatch.classList.add("selected");
    swatch.addEventListener("click", () => {
      modalColorRow.dataset.selected = color;
      buildModalColorRow(color);
    });
    modalColorRow.appendChild(swatch);
  });

  modalColorRow.dataset.selected = selectedColor || "";
}

function openTaskModal(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  editingTaskId = id;
  pendingImage = undefined;

  modalTitle.value = task.title;
  modalDescription.value = task.description || "";
  buildModalColorRow(task.color || null);

  const range = parseTimeRange(task.time);
  modalStart.value = range ? minutesToInputValue(range.start) : "";
  modalEnd.value = range ? minutesToInputValue(range.end) : "";

  if (task.image) {
    modalImageImg.src = task.image;
    modalImagePreview.classList.remove("hidden");
  } else {
    modalImagePreview.classList.add("hidden");
  }

  taskModal.classList.remove("hidden");
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  editingTaskId = null;
  pendingImage = undefined;
  modalImageInput.value = "";
}

modalClose.addEventListener("click", closeTaskModal);
taskModal.addEventListener("click", (e) => {
  if (e.target === taskModal) closeTaskModal();
});

modalImageInput.addEventListener("change", () => {
  const file = modalImageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingImage = reader.result;
    modalImageImg.src = pendingImage;
    modalImagePreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

modalImageRemove.addEventListener("click", (e) => {
  e.stopPropagation();
  pendingImage = null;
  modalImagePreview.classList.add("hidden");
  modalImageInput.value = "";
});

modalDelete.addEventListener("click", () => {
  if (!editingTaskId) return;
  deleteCard(editingTaskId);
  closeTaskModal();
});

modalSave.addEventListener("click", () => {
  const task = tasks.find((t) => t.id === editingTaskId);
  if (!task) return;

  const newTitle = modalTitle.value.trim();
  if (newTitle) task.title = newTitle;

  task.description = modalDescription.value.trim();
  task.color = modalColorRow.dataset.selected || null;

  const startMin = inputValueToMinutes(modalStart.value);
  const endMin = inputValueToMinutes(modalEnd.value);
  if (startMin !== null && endMin !== null && endMin > startMin) {
    task.time = `${formatClock(startMin)} - ${formatClock(endMin)}`;
  } else if (startMin !== null) {
    task.time = formatClock(startMin);
  }

  if (pendingImage !== undefined) {
    task.image = pendingImage || undefined;
  }

  saveState();
  refreshViews();
  closeTaskModal();
});

// ---------- View switching ----------

function showBoard() {
  boardEl.classList.remove("hidden");
  requestAnimationFrame(() => boardEl.classList.add("visible"));
}

function minimizeChat() {
  appEl.classList.remove("floating");
  appEl.classList.add("app-hidden");
  chatBubble.classList.remove("hidden");
  minimizeBtn.classList.add("hidden");
}

function openFloatingChat() {
  appEl.classList.remove("app-hidden");
  appEl.classList.add("floating");
  chatBubble.classList.add("hidden");
  minimizeBtn.classList.remove("hidden");
  chat.scrollTop = chat.scrollHeight;
}

chatBubble.addEventListener("click", openFloatingChat);
minimizeBtn.addEventListener("click", minimizeChat);

// ---------- Chat submit ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addBubble("user", text);
  history.push({ role: "user", content: text });
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  const loadingBubble = addBubble("assistant loading", "Thinking...");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();

    if (!res.ok) {
      loadingBubble.classList.remove("loading");
      renderMarkdown(loadingBubble, `Error: ${JSON.stringify(data.error)}`);
      return;
    }

    const { cleanText, items } = extractSchedule(data.reply);

    loadingBubble.classList.remove("loading");
    renderMarkdown(loadingBubble, cleanText);
    history.push({ role: "assistant", content: data.reply });

    if (items && items.length) {
      applySchedule(items);
    }
  } catch (err) {
    loadingBubble.classList.remove("loading");
    renderMarkdown(loadingBubble, `Error: ${err.message}`);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
});

// ---------- Init ----------

loadState();
setupAddCardButtons();
setupDropZones();

addBubble("assistant", "Hi! I am your schedule assistant, how can I help you?");

if (boardActive) {
  renderBoard();
  showBoard();
  minimizeChat();
}
