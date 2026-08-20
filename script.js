const STORAGE_KEY = "household-budget-entries";
const SVG_NS = "http://www.w3.org/2000/svg";

const CATEGORIES = {
  expense: ["食費", "日用品", "住居", "光熱費", "交通", "娯楽", "医療", "衣服", "その他"],
  income: ["給与", "副業", "お小遣い", "その他"],
};

const CATEGORY_COLORS = [
  "#4f46e5", "#0ea5e9", "#16a34a", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#78716c",
];

const form = document.getElementById("entry-form");
const dateInput = document.getElementById("entry-date");
const categorySelect = document.getElementById("entry-category");
const amountInput = document.getElementById("entry-amount");
const memoInput = document.getElementById("entry-memo");
const typeButtons = document.querySelectorAll(".type-btn");

const entryList = document.getElementById("entry-list");
const emptyMessage = document.getElementById("empty-message");

const totalIncomeEl = document.getElementById("total-income");
const totalExpenseEl = document.getElementById("total-expense");
const totalBalanceEl = document.getElementById("total-balance");
const savingsRateEl = document.getElementById("savings-rate");

const currentMonthEl = document.getElementById("current-month");
const prevMonthBtn = document.getElementById("prev-month");
const nextMonthBtn = document.getElementById("next-month");

const donutChart = document.getElementById("donut-chart");
const donutLegend = document.getElementById("donut-legend");
const donutEmpty = document.getElementById("donut-empty");
const trendChart = document.getElementById("trend-chart");

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

function entriesForMonth(date) {
  const key = monthKey(date);
  return entries.filter((e) => e.date.startsWith(key));
}

function sumByType(monthEntries, type) {
  return monthEntries.filter((e) => e.type === type).reduce((sum, e) => sum + e.amount, 0);
}

function render() {
  renderMonthLabel();

  const monthEntries = entriesForMonth(viewDate);
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

  const income = sumByType(monthEntries, "income");
  const expense = sumByType(monthEntries, "expense");
  const balance = income - expense;
  const savingsRate = income > 0 ? (balance / income) * 100 : 0;

  totalIncomeEl.textContent = formatYen(income);
  totalExpenseEl.textContent = formatYen(expense);
  totalBalanceEl.textContent = formatYen(balance);
  totalBalanceEl.classList.toggle("negative", balance < 0);
  savingsRateEl.textContent = `${Math.round(savingsRate)}%`;
  savingsRateEl.classList.toggle("negative", savingsRate < 0);

  renderDonutChart(monthEntries, expense);
  renderTrendChart();
}

function renderDonutChart(monthEntries, totalExpense) {
  const expenseByCategory = {};
  monthEntries
    .filter((e) => e.type === "expense")
    .forEach((e) => {
      expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
    });

  const items = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);

  donutChart.innerHTML = "";
  donutLegend.innerHTML = "";
  donutEmpty.hidden = items.length !== 0;
  donutChart.style.display = items.length === 0 ? "none" : "block";

  if (items.length === 0) return;

  const cx = 60;
  const cy = 60;
  const r = 45;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  items.forEach(([category, amount], i) => {
    const fraction = amount / totalExpense;
    const dash = fraction * circumference;
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width", strokeWidth);
    circle.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
    circle.setAttribute("stroke-dashoffset", -offset);
    circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
    donutChart.appendChild(circle);

    offset += dash;

    const li = document.createElement("li");
    li.className = "legend-item";
    const percent = Math.round(fraction * 100);
    li.innerHTML = `<i class="dot" style="background:${color}"></i><span class="legend-name">${category}</span><span class="legend-value">${formatYen(amount)} (${percent}%)</span>`;
    donutLegend.appendChild(li);
  });
}

function renderTrendChart() {
  trendChart.innerHTML = "";

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth() - i, 1);
    const monthEntries = entriesForMonth(d);
    months.push({
      label: `${d.getMonth() + 1}月`,
      income: sumByType(monthEntries, "income"),
      expense: sumByType(monthEntries, "expense"),
    });
  }

  const maxValue = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));

  const paddingLeft = 8;
  const paddingRight = 8;
  const paddingBottom = 20;
  const chartTop = 8;
  const chartHeight = 180 - chartTop - paddingBottom;
  const chartWidth = 320 - paddingLeft - paddingRight;
  const groupWidth = chartWidth / months.length;
  const barWidth = groupWidth * 0.28;
  const gap = groupWidth * 0.06;

  const baseline = document.createElementNS(SVG_NS, "line");
  baseline.setAttribute("x1", paddingLeft);
  baseline.setAttribute("y1", chartTop + chartHeight);
  baseline.setAttribute("x2", 320 - paddingRight);
  baseline.setAttribute("y2", chartTop + chartHeight);
  baseline.setAttribute("stroke", "#e5e7eb");
  baseline.setAttribute("stroke-width", "1");
  trendChart.appendChild(baseline);

  months.forEach((m, i) => {
    const groupX = paddingLeft + i * groupWidth;
    const incomeHeight = (m.income / maxValue) * chartHeight;
    const expenseHeight = (m.expense / maxValue) * chartHeight;

    const incomeBar = document.createElementNS(SVG_NS, "rect");
    incomeBar.setAttribute("x", groupX + groupWidth / 2 - barWidth - gap / 2);
    incomeBar.setAttribute("y", chartTop + chartHeight - incomeHeight);
    incomeBar.setAttribute("width", barWidth);
    incomeBar.setAttribute("height", incomeHeight);
    incomeBar.setAttribute("rx", "2");
    incomeBar.setAttribute("fill", "#16a34a");
    trendChart.appendChild(incomeBar);

    const expenseBar = document.createElementNS(SVG_NS, "rect");
    expenseBar.setAttribute("x", groupX + groupWidth / 2 + gap / 2);
    expenseBar.setAttribute("y", chartTop + chartHeight - expenseHeight);
    expenseBar.setAttribute("width", barWidth);
    expenseBar.setAttribute("height", expenseHeight);
    expenseBar.setAttribute("rx", "2");
    expenseBar.setAttribute("fill", "#ef4444");
    trendChart.appendChild(expenseBar);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", groupX + groupWidth / 2);
    label.setAttribute("y", 180 - 4);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "9");
    label.setAttribute("fill", "#6b7280");
    label.textContent = m.label;
    trendChart.appendChild(label);
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
