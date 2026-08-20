const STORAGE_KEY = "household-budget-entries";

const CATEGORIES = {
  expense: ["食費", "日用品", "住居", "光熱費", "交通", "娯楽", "医療", "衣服", "その他"],
  income: ["給与", "副業", "お小遣い", "その他"],
};

const form = document.getElementById("entry-form");
const dateInput = document.getElementById("entry-date");
const categorySelect = document.getElementById("entry-category");
const amountInput = document.getElementById("entry-amount");
const memoInput = document.getElementById("entry-memo");
const typeButtons = document.querySelectorAll(".type-btn");

const entryList = document.getElementById("entry-list");
const emptyMessage = document.getElementById("empty-message");
const breakdownSection = document.getElementById("breakdown-section");
const breakdownList = document.getElementById("breakdown-list");

const totalIncomeEl = document.getElementById("total-income");
const totalExpenseEl = document.getElementById("total-expense");
const totalBalanceEl = document.getElementById("total-balance");

const currentMonthEl = document.getElementById("current-month");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");

let entries = loadEntries();
let currentType = "expense";
let viewDate = new Date();
viewDate.setDate(1);

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function formatYen(amount) {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function populateCategories() {
  categorySelect.innerHTML = "";
  CATEGORIES[currentType].forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    categorySelect.appendChild(option);
  });
}

function setType(type) {
  currentType = type;
  typeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  populateCategories();
}

function renderMonthLabel() {
  currentMonthEl.textContent = `${viewDate.getFullYear()}年${viewDate.getMonth() + 1}月`;
}

function entriesForCurrentMonth() {
  const key = monthKey(viewDate);
  return entries.filter((e) => e.date.startsWith(key));
}

function render() {
  renderMonthLabel();

  const monthEntries = entriesForCurrentMonth();
  const sorted = [...monthEntries].sort((a, b) => b.date.localeCompare(a.date));

  entryList.innerHTML = "";
  sorted.forEach((entry) => {
    const li = document.createElement("li");
    li.className = `entry-item ${entry.type}`;

    const info = document.createElement("div");
    info.className = "entry-info";

    const category = document.createElement("span");
    category.className = "entry-category";
    category.textContent = entry.category;

    const date = document.createElement("span");
    date.className = "entry-date";
    date.textContent = entry.date;

    info.append(category, date);

    if (entry.memo) {
      const memo = document.createElement("span");
      memo.className = "entry-memo";
      memo.textContent = entry.memo;
      info.appendChild(memo);
    }

    const amount = document.createElement("span");
    amount.className = "entry-amount";
    amount.textContent = `${entry.type === "income" ? "+" : "-"}${formatYen(entry.amount)}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "削除");
    deleteBtn.addEventListener("click", () => deleteEntry(entry.id));

    li.append(info, amount, deleteBtn);
    entryList.appendChild(li);
  });

  emptyMessage.hidden = sorted.length !== 0;

  const income = monthEntries
    .filter((e) => e.type === "income")
    .reduce((sum, e) => sum + e.amount, 0);
  const expense = monthEntries
    .filter((e) => e.type === "expense")
    .reduce((sum, e) => sum + e.amount, 0);

  totalIncomeEl.textContent = formatYen(income);
  totalExpenseEl.textContent = formatYen(expense);
  totalBalanceEl.textContent = formatYen(income - expense);
  totalBalanceEl.classList.toggle("negative", income - expense < 0);

  renderBreakdown(monthEntries, expense);
}

function renderBreakdown(monthEntries, totalExpense) {
  const expenseByCategory = {};
  monthEntries
    .filter((e) => e.type === "expense")
    .forEach((e) => {
      expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
    });

  const items = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);

  breakdownSection.hidden = items.length === 0;
  breakdownList.innerHTML = "";

  items.forEach(([category, amount]) => {
    const percent = totalExpense > 0 ? (amount / totalExpense) * 100 : 0;

    const li = document.createElement("li");
    li.className = "breakdown-item";

    const label = document.createElement("div");
    label.className = "breakdown-label";
    const name = document.createElement("span");
    name.textContent = category;
    const value = document.createElement("span");
    value.textContent = formatYen(amount);
    label.append(name, value);

    const barTrack = document.createElement("div");
    barTrack.className = "breakdown-bar-track";
    const bar = document.createElement("div");
    bar.className = "breakdown-bar";
    bar.style.width = `${percent}%`;
    barTrack.appendChild(bar);

    li.append(label, barTrack);
    breakdownList.appendChild(li);
  });
}

function addEntry(entry) {
  entries.push({ id: crypto.randomUUID(), ...entry });
  saveEntries();
  render();
}

function deleteEntry(id) {
  entries = entries.filter((e) => e.id !== id);
  saveEntries();
  render();
}

typeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setType(btn.dataset.type));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = Number(amountInput.value);
  if (!dateInput.value || !categorySelect.value || !amount || amount <= 0) return;

  addEntry({
    type: currentType,
    date: dateInput.value,
    category: categorySelect.value,
    amount,
    memo: memoInput.value.trim(),
  });

  amountInput.value = "";
  memoInput.value = "";
  amountInput.focus();
});

prevMonthBtn.addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  render();
});

nextMonthBtn.addEventListener("click", () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  render();
});

dateInput.valueAsDate = new Date();
populateCategories();
render();
