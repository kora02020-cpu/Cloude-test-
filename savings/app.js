"use strict";

/* ===================== 保存 ===================== */
const STORAGE_KEY = "kotsukotsu-v1";
const HABIT_DAYS = 66;     // Lally et al. (2010): 自動化までの中央値
const MAX_FREEZES = 2;
const ENDOWED = 2;         // 最初から押されている印 (目標設定 + 宣言)
const CARD_SIZE = 10;

function defaultState() {
  return {
    version: 1,
    onboarded: false,
    createdAt: today(),
    profile: { name: "", anchor: "朝のコーヒーを淹れたら", amount: 100, letter: "", sound: true },
    stepUp: null,              // { amount, from }
    lastStepUpOffer: null,
    goals: [],
    activeGoalId: null,
    entries: [],
    rules: [],
    freezes: 0,
    frozenDays: [],
    masu: { unit: 10, picked: [] },
    bonusXp: 0,
    goldDays: [],
    demo: false,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* 保存領域が使えない環境でも動かす */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
}

let state = load();

/* ===================== 日付 ===================== */
function ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today() { return ymd(new Date()); }
function parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function fmtDate(s) { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
const WD = ["日", "月", "火", "水", "木", "金", "土"];

/* ===================== 表示ユーティリティ ===================== */
const $ = (id) => document.getElementById(id);
const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ===================== 集計 ===================== */
// 自分で行動した記録（自動積立以外）が習慣とストリークの対象
const ACTIVE_TYPES = new Set(["checkin", "skip", "roundup", "manual", "masu"]);

function total() { return state.entries.reduce((s, e) => s + e.amount, 0); }
function activeDays() {
  return new Set(state.entries.filter((e) => ACTIVE_TYPES.has(e.type)).map((e) => e.date));
}
function checkedInToday() { return state.entries.some((e) => e.type === "checkin" && e.date === today()); }
function checkinCount() { return state.entries.filter((e) => e.type === "checkin").length; }

function streak() {
  const days = activeDays();
  const frozen = new Set(state.frozenDays);
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);   // 今日まだでも昨日まで続いていれば継続中
  let n = 0;
  while (days.has(d) || frozen.has(d)) {
    if (days.has(d)) n++;
    d = addDays(d, -1);
  }
  return n;
}

// 休んだ日を「おやすみ券」で自動的に埋める（1回の失敗で全部やめてしまう“どうにでもなれ効果”対策）
function applyFreezes() {
  const days = activeDays();
  const frozen = new Set(state.frozenDays);
  const gaps = [];
  let d = addDays(today(), -1);
  for (let i = 0; i < 30; i++) {
    if (days.has(d)) break;
    if (frozen.has(d)) { d = addDays(d, -1); continue; }
    gaps.push(d);
    d = addDays(d, -1);
  }
  const hadStreakBefore = days.has(d);
  if (gaps.length && hadStreakBefore && gaps.length <= state.freezes) {
    state.freezes -= gaps.length;
    state.frozenDays.push(...gaps);
    save();
    return gaps.length;
  }
  return 0;
}

function currentAmount() {
  if (state.stepUp && today() >= state.stepUp.from) {
    state.profile.amount = state.stepUp.amount;
    state.stepUp = null;
    save();
  }
  return state.profile.amount;
}

function xp() {
  let x = state.bonusXp;
  for (const e of state.entries) {
    if (e.type === "checkin") x += 10;
    else if (ACTIVE_TYPES.has(e.type)) x += 5;
  }
  return x;
}
const LEVELS = [
  [0, "貯金はじめ"], [50, "コツコツ見習い"], [150, "先取り上手"], [300, "習慣の職人"],
  [600, "未来を育てる人"], [1000, "マネーマスター"], [1800, "伝説の印帳主"],
];
function level() {
  const x = xp();
  let i = 0;
  while (i + 1 < LEVELS.length && x >= LEVELS[i + 1][0]) i++;
  const next = LEVELS[i + 1];
  return { lv: i + 1, title: LEVELS[i][1], x, next: next ? next[0] : null };
}

function activeGoal() { return state.goals.find((g) => g.id === state.activeGoalId) || state.goals[0] || null; }

/* ===================== 自動積立ルール ===================== */
function isDue(rule, dateStr) {
  const d = parse(dateStr);
  if (rule.freq === "daily") return true;
  if (rule.freq === "weekly") return d.getDay() === Number(rule.day);
  if (rule.freq === "monthly") {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(Number(rule.day), last);
  }
  return false;
}
function runRules() {
  const t = today();
  let added = 0, sum = 0;
  for (const r of state.rules) {
    if (r.paused) { r.lastRun = t; continue; }
    let d = addDays(r.lastRun, 1);
    let guard = 0;
    while (d <= t && guard++ < 400) {
      if (isDue(r, d)) {
        state.entries.push({ id: uid(), date: d, ts: Date.now(), amount: r.amount, type: "rule", note: r.name, goalId: state.activeGoalId });
        added++; sum += r.amount;
      }
      d = addDays(d, 1);
    }
    r.lastRun = t;
  }
  if (added) save();
  return { added, sum };
}
function ruleLabel(r) {
  if (r.freq === "daily") return "毎日";
  if (r.freq === "weekly") return `毎週${WD[r.day]}曜日`;
  return `毎月${r.day}日`;
}

/* ===================== 記録 ===================== */
function addEntry(type, amount, note) {
  amount = Math.round(Number(amount));
  if (!amount || amount <= 0) return null;
  const e = { id: uid(), date: today(), ts: Date.now(), amount, type, note: note || "", goalId: state.activeGoalId };
  state.entries.push(e);
  save();
  return e;
}

/* ===================== ごほうび（予測できない報酬） ===================== */
const PRAISE = [
  ["ナイス先取り", "使う前に貯める。いちばん効果の大きい順番を今日も守れました。"],
  ["今日も印が増えた", "小さな行動を毎日くり返すことが、脳に「いつものこと」として刻まれていきます。"],
  ["未来の自分が喜んでる", "今日の一回が、1年後のあなたへの仕送りになりました。"],
  ["いいリズム", "同じきっかけで同じ行動。これが習慣の正体です。"],
  ["積み上げ中", "金額より回数が大事。続けた日数がそのまま自信になります。"],
  ["貯められる人の行動", "「貯金する人」としての一票を、今日も自分に入れました。"],
];
const FACTS = [
  "習慣が自動化するまでの日数は人によって18〜254日、中央値は約66日といわれます。",
  "人は同じ額でも、得る喜びより失う痛みを約2倍強く感じます。だから連続記録は守りたくなるのです。",
  "ゴールに近づくほど人は頑張る傾向があります（目標勾配効果）。進捗バーを見てみましょう。",
  "未来の自分を具体的に想像した人ほど、貯蓄を選びやすいという研究があります。",
  "報酬が「いつ来るか分からない」とき、脳のドーパミン系はより強く反応します。",
  "月曜日や月初は「新しいスタート」の気分になりやすく、目標行動が増えることが知られています。",
];

function rollReward(amount) {
  const r = Math.random();
  if (r < 0.1) {
    state.bonusXp += 20;
    state.goldDays.push(today());
    save();
    return {
      rare: true, seal: "金", kicker: "レア出現 10%",
      title: "金の印が出ました", text: "今日の印は金色。経験値+20のボーナスです。",
    };
  }
  if (r < 0.32) {
    const extra = Math.max(10, Math.round(amount * 0.5 / 10) * 10);
    return {
      seal: "倍", kicker: "ボーナスチャンス",
      title: `あと${yen(extra)}上乗せする？`, text: "気分が乗っている今がチャンス。もちろんスキップしてもOKです。",
      bonus: extra,
    };
  }
  const [title, text] = pick(PRAISE);
  return { seal: "済", kicker: "今日の印", title, text: text + "\n" + pick(FACTS) };
}

function showReward(rw, after) {
  const card = $("reward-card");
  card.className = "reward-card" + (rw.rare ? " rare" : "");
  card.innerHTML = `
    <div class="reward-seal">${esc(rw.seal)}</div>
    <div class="reward-kicker">${esc(rw.kicker)}</div>
    <div class="reward-title">${esc(rw.title)}</div>
    <p class="reward-text">${esc(rw.text).replace(/\n/g, "<br><br>")}</p>
    <div class="row-btns">
      ${rw.bonus ? `<button class="btn shu" id="rw-bonus">${yen(rw.bonus)}追加する</button><button class="btn ghost" id="rw-close">今日はここまで</button>`
                 : `<button class="btn primary" id="rw-close">閉じる</button>`}
    </div>`;
  $("reward").hidden = false;
  const close = () => { $("reward").hidden = true; after && after(); };
  $("rw-close").onclick = close;
  if (rw.bonus) {
    $("rw-bonus").onclick = () => {
      addEntry("manual", rw.bonus, "ボーナスチャンス");
      state.bonusXp += 5; save();
      coin(); confetti(60);
      toast(`${yen(rw.bonus)}を上乗せしました`);
      close();
    };
  }
  $("rw-close").focus();
}

/* ===================== 演出 ===================== */
let audioCtx = null;
function coin() {
  if (!state.profile.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [1318, 1975].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.4);
    });
  } catch (e) { /* 音が出せない環境 */ }
  try { navigator.vibrate && navigator.vibrate(25); } catch (e) { /* noop */ }
}

function confetti(count) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("confetti"), ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue("--shu"), css.getPropertyValue("--gold"), css.getPropertyValue("--good")].map((c) => c.trim());
  const ps = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .45,
    vx: (Math.random() - .5) * 9, vy: -Math.random() * 11 - 4,
    r: Math.random() * 5 + 3, c: pick(colors), rot: Math.random() * 6, round: Math.random() < .5,
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += .35; p.x += p.vx; p.y += p.vy; p.rot += .15;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (++frame < 110) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ===================== チェックイン ===================== */
let justStamped = false;
function checkin() {
  if (checkedInToday()) { toast("今日の印はもう押してあります。また明日！"); return; }
  const amount = currentAmount();
  const before = level().lv;
  addEntry("checkin", amount, state.profile.anchor);
  const s = streak();
  let extra = "";
  if (s > 0 && s % 7 === 0 && state.freezes < MAX_FREEZES) {
    state.freezes++; save();
    extra = `\n${s}日連続達成！ おやすみ券を1枚もらいました（休んでも連続記録が守られます）。`;
  }
  justStamped = true;
  coin();
  const rw = rollReward(amount);
  if (extra) rw.text += extra;
  confetti(rw.rare ? 160 : 80);
  render();
  const after = level().lv;
  showReward(rw, () => {
    if (after > before) {
      const l = level();
      showReward({ rare: true, seal: "昇", kicker: `レベル${l.lv}`, title: `「${l.title}」になりました`, text: "肩書きは行動の結果です。あなたはもう、貯金を続けられる人です。" });
      confetti(120);
    }
    const stamps = checkinCount() + ENDOWED;
    if (stamps % CARD_SIZE === 0) toast(`印帳カード${stamps / CARD_SIZE}枚目が埋まりました！`);
  });
}

/* ===================== 描画 ===================== */
function render() {
  renderTop();
  renderHome();
  renderLedger();
  renderChallenge();
}

function renderTop() {
  const l = level();
  $("level-chip").textContent = `Lv.${l.lv} ${l.title}`;
}

function renderHome() {
  const t = total();
  $("total-amount").textContent = yen(t);

  const g = activeGoal();
  if (g) {
    const saved = state.entries.filter((e) => !e.goalId || e.goalId === g.id).reduce((s, e) => s + e.amount, 0);
    const pct = Math.min(100, Math.floor((saved / g.target) * 100));
    $("goal-name").textContent = `${g.name}  ${yen(saved)} / ${yen(g.target)}`;
    $("goal-pct").textContent = pct;
    $("goal-bar").style.width = pct + "%";
    const left = Math.max(0, g.target - saved);
    let msg;
    if (pct >= 100) msg = "目標達成！ 次の目標を立てると勢いが続きます。";
    else if (pct >= 75) msg = `ゴール目前。あと${yen(left)}です。`;
    else if (pct >= 50) msg = `折り返しを過ぎました。あと${yen(left)}。`;
    else if (pct >= 25) msg = `4分の1を突破。あと${yen(left)}。`;
    else msg = `最初の一歩が一番大事。あと${yen(left)}。`;
    if (g.deadline && pct < 100) {
      const days = diffDays(today(), g.deadline);
      if (days > 0) msg += ` 期限まで${days}日、1日あたり${yen(Math.ceil(left / days))}ペース。`;
    }
    $("goal-msg").textContent = msg;
  } else {
    $("goal-name").textContent = "目標を設定しましょう";
    $("goal-pct").textContent = 0;
    $("goal-bar").style.width = "0%";
    $("goal-msg").textContent = "";
  }

  const amount = currentAmount();
  $("intention-text").innerHTML = `<b>${esc(state.profile.anchor)}</b>、<b>${yen(amount)}</b>を貯金する`;
  const btn = $("checkin-btn");
  if (checkedInToday()) {
    btn.classList.add("done");
    btn.querySelector(".checkin-main").textContent = "今日の印、押しました";
    btn.querySelector(".checkin-sub").textContent = "また明日、同じきっかけで";
  } else {
    btn.classList.remove("done");
    btn.querySelector(".checkin-main").textContent = "今日の分を貯金した";
    btn.querySelector(".checkin-sub").textContent = `${yen(amount)} ・ タップして印を押す`;
  }

  const s = streak();
  $("streak-num").textContent = s;
  $("freeze-num").textContent = state.freezes;
  const hd = Math.min(HABIT_DAYS, activeDays().size);
  $("habit-num").textContent = hd;
  $("habit-bar").style.width = (hd / HABIT_DAYS * 100) + "%";

  // フレッシュスタート
  const d = new Date();
  let fresh = "";
  if (d.getMonth() === 0 && d.getDate() === 1) fresh = "新年です。1年でいちばん「始めやすい」日。目標を見直してみましょう。";
  else if (d.getDate() === 1) fresh = "新しい月のスタート。区切りの日は新しい習慣を始めやすい日です。";
  else if (d.getDay() === 1) fresh = "月曜日、新しい1週間のスタート。今週もまず1つ目の印から。";
  $("fresh-start").hidden = !fresh;
  $("fresh-start").textContent = fresh;

  renderStepUp(s);
  renderStamps();
  renderFuture();
}

function renderStepUp(s) {
  const card = $("stepup-card");
  const amt = state.profile.amount;
  const recentlyOffered = state.lastStepUpOffer && diffDays(state.lastStepUpOffer, today()) < 14;
  if (state.stepUp) {
    card.hidden = false;
    card.innerHTML = `<p class="stepup-title">ステップアップ予約中</p><div class="muted">${fmtDate(state.stepUp.from)}から1日${yen(state.stepUp.amount)}になります。</div>`;
    return;
  }
  if (s >= 14 && !recentlyOffered) {
    const next = Math.ceil((amt * 1.1) / 10) * 10;
    card.hidden = false;
    card.innerHTML = `
      <p class="stepup-title">2週間続きました。少しだけ増やしてみませんか？</p>
      <div class="muted">今すぐではなく<b>来週の月曜から</b>、1日${yen(amt)} → ${yen(next)}（約+10%）。先に決めておくと、痛みを感じにくくなります。</div>
      <div class="row-btns">
        <button class="btn shu" id="su-yes">来週から${yen(next)}にする</button>
        <button class="btn ghost" id="su-no">今のままでいい</button>
      </div>`;
    $("su-yes").onclick = () => {
      const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7;
      state.stepUp = { amount: next, from: addDays(today(), add) };
      state.lastStepUpOffer = today(); save(); render(); toast("予約しました");
    };
    $("su-no").onclick = () => { state.lastStepUpOffer = today(); save(); render(); };
    return;
  }
  card.hidden = true;
}

function renderStamps() {
  const n = checkinCount() + ENDOWED;
  const cardIdx = Math.floor((n - (justStamped ? 1 : 0)) / CARD_SIZE);
  const start = cardIdx * CARD_SIZE;
  const filled = Math.min(CARD_SIZE, n - start);
  const checkins = state.entries.filter((e) => e.type === "checkin").sort((a, b) => a.ts - b.ts);
  const gold = new Set(state.goldDays);
  $("card-count").textContent = `${cardIdx + 1}枚目`;
  let html = "";
  for (let i = 0; i < CARD_SIZE; i++) {
    const absolute = start + i;
    const rot = ((absolute * 37) % 17) - 8;
    if (i < filled) {
      if (absolute < ENDOWED) {
        html += `<div class="stamp on endowed" style="--rot:${rot}deg;transform:rotate(${rot}deg)">${absolute === 0 ? "目標" : "宣言"}</div>`;
      } else {
        const e = checkins[absolute - ENDOWED];
        const isGold = e && gold.has(e.date);
        const isNew = justStamped && i === filled - 1;
        html += `<div class="stamp on${isGold ? " gold" : ""}${isNew ? " new" : ""}" style="--rot:${rot}deg;transform:rotate(${rot}deg)" title="${e ? e.date : ""}">${isGold ? "金" : "済"}</div>`;
      }
    } else {
      html += `<div class="stamp">${absolute + 1 - ENDOWED > 0 ? absolute + 1 - ENDOWED : ""}</div>`;
    }
  }
  $("stamp-grid").innerHTML = html;
  justStamped = false;
}

function renderFuture() {
  // 直近30日（開始が最近なら開始日から）の平均ペース
  const t = today();
  const span = Math.max(1, Math.min(30, diffDays(state.createdAt, t) + 1));
  const from = addDays(t, -(span - 1));
  const recent = state.entries.filter((e) => e.date >= from).reduce((s, e) => s + e.amount, 0);
  const perDay = recent / span || currentAmount();
  const monthly = perDay * 30.4;
  const base = total();
  const fv = (years) => {
    const r = 0.03 / 12; let v = base;
    for (let i = 0; i < years * 12; i++) v = v * (1 + r) + monthly;
    return v;
  };
  $("f1").textContent = yen(fv(1));
  $("f5").textContent = yen(fv(5));
  $("f10").textContent = yen(fv(10));
  $("future-basis").textContent = `月${yen(monthly)}ペース（直近${span}日の平均）で、年3%で運用した場合の目安です。`;
  const letter = state.profile.letter.trim();
  $("future-letter").hidden = !letter;
  if (letter) $("future-letter").textContent = `1年後の自分へ：「${letter}」`;
}

const TYPE_LABEL = { checkin: "習慣", skip: "我慢", roundup: "おつり", manual: "入金", masu: "100マス", rule: "自動" };
function renderLedger() {
  const list = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  $("ledger-count").textContent = `${list.length}件`;
  $("ledger-empty").hidden = list.length > 0;
  $("ledger").innerHTML = list.slice(0, 300).map((e) => {
    const cls = e.type === "rule" ? "auto" : e.type === "skip" ? "skip" : "";
    return `<div class="ledger-row">
      <span class="d">${e.date.slice(2).replace(/-/g, ".")}</span>
      <span class="n"><span class="tag ${cls}">${TYPE_LABEL[e.type] || ""}</span>${esc(e.note || "")}</span>
      <span class="a">${yen(e.amount)}</span>
      <button class="x" data-del="${e.id}" aria-label="この記録を削除">×</button>
    </div>`;
  }).join("");

  // 直近14日の棒グラフ
  const t = today();
  const sums = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    sums.push([d, state.entries.filter((e) => e.date === d).reduce((s, e) => s + e.amount, 0)]);
  }
  const max = Math.max(1, ...sums.map((x) => x[1]));
  $("week-chart").innerHTML = sums.map(([d, v], i) => `
    <div class="wc-col" title="${d}: ${yen(v)}">
      <div class="wc-bar${v ? "" : " zero"}" style="height:${v ? Math.max(6, v / max * 100) : 3}%"></div>
      ${i % 2 === 1 ? `<span class="wc-lab">${fmtDate(d)}</span>` : ""}
    </div>`).join("");
}

function renderChallenge() {
  // ルール
  $("rule-list").innerHTML = state.rules.length ? state.rules.map((r) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title">${esc(r.name)} ${yen(r.amount)}</div>
        <div class="item-sub">${ruleLabel(r)}に自動で記録${r.paused ? "（一時停止中）" : ""}</div>
      </div>
      <div class="row-btns" style="margin:0">
        <button class="text-btn" data-rule-toggle="${r.id}">${r.paused ? "再開" : "停止"}</button>
        <button class="text-btn" data-rule-del="${r.id}">削除</button>
      </div>
    </div>`).join("") : `<div class="muted">まだルールがありません。例：「給料日に先取り 30,000円」</div>`;

  // マス
  const picked = new Set(state.masu.picked);
  $("masu-unit").value = String(state.masu.unit);
  $("masu-unit").disabled = picked.size > 0;
  $("masu-progress").textContent = `${picked.size} / 100`;
  let html = "";
  for (let i = 1; i <= 100; i++) html += `<button class="masu${picked.has(i) ? " on" : ""}" data-masu="${i}" aria-label="${i}マス目">${i}</button>`;
  $("masu-grid").innerHTML = html;
  $("masu-draw").disabled = picked.size >= 100;

  // 目標
  const g = activeGoal();
  $("goal-list").innerHTML = state.goals.length ? state.goals.map((x) => `
    <div class="item${g && x.id === g.id ? " active" : ""}">
      <div class="item-main">
        <div class="item-title">${esc(x.name)}</div>
        <div class="item-sub">${yen(x.target)}${x.deadline ? ` ・ ${x.deadline}まで` : ""}${g && x.id === g.id ? " ・ いま貯めている目標" : ""}</div>
      </div>
      <div class="row-btns" style="margin:0">
        ${g && x.id === g.id ? "" : `<button class="text-btn" data-goal-use="${x.id}">これにする</button>`}
        <button class="text-btn" data-goal-del="${x.id}">削除</button>
      </div>
    </div>`).join("") : `<div class="muted">目標がありません。</div>`;
}

/* ===================== しくみ ===================== */
const SCIENCE = [
  ["実行意図（if-thenプランニング）", "ホームの「〇〇したら、¥〇〇を貯金する」",
   "「いつ・どこで・何をするか」を事前に決めた人は、目標達成率が大きく上がることが多くの研究で示されています（Gollwitzer）。"],
  ["習慣の積み重ね・小さく始める", "1日¥100からの設定とアンカー行動",
   "すでにある習慣（歯みがき・コーヒー）を合図にして、ごく小さな行動から始めると定着しやすくなります（BJ Fogg「タイニーハビット」）。"],
  ["予測できない報酬とドーパミン", "印を押した後のランダムなごほうびカード・金の印",
   "脳のドーパミン神経は、報酬そのものより「予想外の報酬」に強く反応します（報酬予測誤差）。毎回少しずつ違う演出が、次もやりたい気持ちを作ります。"],
  ["損失回避と連続記録", "◯日連続のカウンター",
   "人は得る喜びより失う痛みを強く感じます（Kahneman & Tversky）。積み上げた連続記録を「失いたくない」気持ちが行動を後押しします。"],
  ["どうにでもなれ効果の防止", "おやすみ券（7日連続ごとに1枚、最大2枚）",
   "一度ルールを破ると「もういいや」と全部やめてしまいがちです。休んでも記録が途切れない保険を用意して、完璧主義による挫折を防ぎます。"],
  ["授かり効果（エンダウド・プログレス）", "印帳カードの最初の2マス",
   "スタンプカードの最初の数マスが埋まっている方が、ゴールまでの到達率が上がることが知られています（Nunes & Drèze）。"],
  ["目標勾配効果", "目標の進捗バーと「あと¥〇〇」",
   "人はゴールに近づくほど努力のペースを上げます（Kivetz）。残りの金額を常に見せて、ラストスパートを促します。"],
  ["未来の自分との接続", "未来の自分の予測額と1年後の自分へのメッセージ",
   "未来の自分を「他人」ではなく自分ごととして感じられるほど、貯蓄を選びやすくなります（Hershfield）。"],
  ["Save More Tomorrow", "2週間続くと出る「来週から+10%」の提案",
   "今すぐではなく「将来から増やす」約束は受け入れやすく、実際の貯蓄率を大きく伸ばしました（Thaler & Benartzi）。"],
  ["フレッシュスタート効果", "月曜・月初・元日のバナー",
   "区切りの日は「新しい自分」を意識しやすく、目標に向けた行動が増えます（Dai, Milkman & Riis）。"],
  ["自己イメージ（アイデンティティ）", "宣言とレベルの肩書き",
   "「貯金する」ではなく「貯金できる人である」と捉えると、行動が一貫しやすくなります。肩書きはその後押しです。"],
  ["痛みの少ない貯め方", "我慢貯金・おつり貯金",
   "使わなかったお金や端数を貯金に回すと「失った」感覚が小さく、続けやすくなります。年間換算で効果も見える化します。"],
  ["仕組み化（デフォルトの力）", "自動積立ルール",
   "最も強力なのは、意思決定そのものをなくすこと。給料日に自動で別口座へ移す設定は、行動経済学で最も効果の大きい手段の一つです。"],
  ["66日の習慣化メーター", "ホームの「/ 66日」",
   "新しい習慣が自動化するまでの中央値は約66日でした（Lally et al., 2010）。ゴールが見えると途中で投げ出しにくくなります。"],
];
function renderScience() {
  $("science-list").innerHTML = SCIENCE.map(([t, w, p]) => `
    <div class="sci"><div class="sci-title">${esc(t)}</div><div class="sci-where">アプリでは：${esc(w)}</div><p>${esc(p)}</p></div>`).join("");
}

/* ===================== モーダル ===================== */
function openModal(html, onMount) {
  $("modal-body").innerHTML = html;
  $("modal").hidden = false;
  onMount && onMount();
  const f = $("modal-body").querySelector("input, select, textarea, button");
  f && f.focus();
}
function closeModal() { $("modal").hidden = true; }

function modalSkip() {
  const presets = [["コンビニコーヒー", 150], ["ペットボトル飲料", 160], ["お菓子", 200], ["ランチ外食", 900], ["タクシー", 1500], ["衝動買い", 3000]];
  openModal(`
    <h3>我慢した分を貯金</h3>
    <p class="lead">買わなかったものを記録すると、その金額がそのまま貯金になります。</p>
    <div class="field"><span class="label">よくある例</span><div class="chips">${presets.map(([n, a]) => `<button class="chip" data-preset="${a}" data-name="${n}">${n} ${yen(a)}</button>`).join("")}</div></div>
    <div class="field"><label for="sk-name">買わなかったもの</label><input id="sk-name" placeholder="例：新作のスニーカー"></div>
    <div class="field"><label for="sk-amt">金額</label><input id="sk-amt" type="number" inputmode="numeric" min="1" placeholder="0"></div>
    <div class="calc" id="sk-calc">週1回なら年間 ¥0</div>
    <div class="row-btns"><button class="btn shu" id="sk-ok">貯金する</button><button class="btn ghost" data-close>やめる</button></div>`, () => {
    const upd = () => { const a = Number($("sk-amt").value) || 0; $("sk-calc").textContent = `週1回なら年間 ${yen(a * 52)} ・ 毎日なら年間 ${yen(a * 365)}`; };
    $("sk-amt").oninput = upd;
    document.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => {
      document.querySelectorAll("[data-preset]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); $("sk-name").value = b.dataset.name; $("sk-amt").value = b.dataset.preset; upd();
    });
    $("sk-ok").onclick = () => {
      const a = Number($("sk-amt").value);
      if (!a || a <= 0) { toast("金額を入力してください"); return; }
      addEntry("skip", a, $("sk-name").value.trim() || "我慢した");
      closeModal(); coin(); confetti(50); render();
      toast(`${yen(a)}を貯金しました。誘惑に勝ちました！`);
    };
  });
}

function modalRoundup() {
  openModal(`
    <h3>おつり貯金</h3>
    <p class="lead">買い物の金額を入れると、切り上げた差額を貯金に回します。</p>
    <div class="field"><label for="ru-amt">支払った金額</label><input id="ru-amt" type="number" inputmode="numeric" min="1" placeholder="例：1,280"></div>
    <div class="field"><span class="label">切り上げ単位</span><div class="chips">
      <button class="chip on" data-unit="100">100円</button><button class="chip" data-unit="500">500円</button><button class="chip" data-unit="1000">1,000円</button></div></div>
    <div class="calc" id="ru-calc">差額 ¥0</div>
    <div class="row-btns"><button class="btn shu" id="ru-ok">差額を貯金</button><button class="btn ghost" data-close>やめる</button></div>`, () => {
    let unit = 100;
    const diff = () => { const a = Number($("ru-amt").value) || 0; let d = Math.ceil(a / unit) * unit - a; if (a && d === 0) d = unit; return d; };
    const upd = () => { const a = Number($("ru-amt").value) || 0; $("ru-calc").textContent = a ? `${yen(a)} → ${yen(a + diff())}　差額 ${yen(diff())}` : "差額 ¥0"; };
    $("ru-amt").oninput = upd;
    document.querySelectorAll("[data-unit]").forEach((b) => b.onclick = () => {
      document.querySelectorAll("[data-unit]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); unit = Number(b.dataset.unit); upd();
    });
    $("ru-ok").onclick = () => {
      const d = diff();
      if (!d) { toast("支払った金額を入力してください"); return; }
      addEntry("roundup", d, `${yen(Number($("ru-amt").value))}の買い物`);
      closeModal(); coin(); confetti(40); render(); toast(`おつり${yen(d)}を貯金しました`);
    };
  });
}

function modalManual() {
  openModal(`
    <h3>自由に入金</h3>
    <p class="lead">臨時収入、ポイント、ボーナスなど。入った瞬間に貯金へ回すのがコツです。</p>
    <div class="field"><label for="mn-amt">金額</label><input id="mn-amt" type="number" inputmode="numeric" min="1"></div>
    <div class="field"><label for="mn-note">メモ</label><input id="mn-note" placeholder="例：メルカリで売れた"></div>
    <div class="row-btns"><button class="btn shu" id="mn-ok">貯金する</button><button class="btn ghost" data-close>やめる</button></div>`, () => {
    $("mn-ok").onclick = () => {
      const a = Number($("mn-amt").value);
      if (!a || a <= 0) { toast("金額を入力してください"); return; }
      addEntry("manual", a, $("mn-note").value.trim() || "入金");
      closeModal(); coin(); confetti(50); render(); toast(`${yen(a)}を貯金しました`);
    };
  });
}

function modalRule() {
  openModal(`
    <h3>自動積立ルール</h3>
    <p class="lead">銀行で設定した自動積立と同じ内容を登録すると、その日に自動で記録されます。</p>
    <div class="field"><label for="rl-name">名前</label><input id="rl-name" value="先取り貯金"></div>
    <div class="field"><label for="rl-amt">金額</label><input id="rl-amt" type="number" inputmode="numeric" min="1" value="30000"></div>
    <div class="field"><label for="rl-freq">頻度</label>
      <select id="rl-freq"><option value="monthly">毎月</option><option value="weekly">毎週</option><option value="daily">毎日</option></select></div>
    <div class="field" id="rl-day-wrap"><label for="rl-day">日付</label><select id="rl-day"></select></div>
    <div class="row-btns"><button class="btn shu" id="rl-ok">登録する</button><button class="btn ghost" data-close>やめる</button></div>`, () => {
    const fill = () => {
      const f = $("rl-freq").value;
      $("rl-day-wrap").hidden = f === "daily";
      if (f === "weekly") { $("rl-day").innerHTML = WD.map((w, i) => `<option value="${i}">${w}曜日</option>`).join(""); $("rl-day").value = "1"; }
      if (f === "monthly") { $("rl-day").innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}日${i === 30 ? "（月末）" : ""}</option>`).join(""); $("rl-day").value = "25"; }
    };
    $("rl-freq").onchange = fill; fill();
    $("rl-ok").onclick = () => {
      const a = Number($("rl-amt").value);
      if (!a || a <= 0) { toast("金額を入力してください"); return; }
      state.rules.push({ id: uid(), name: $("rl-name").value.trim() || "自動積立", amount: Math.round(a), freq: $("rl-freq").value, day: Number($("rl-day").value), lastRun: addDays(today(), -1) });
      const r = runRules();
      save(); closeModal(); render();
      toast(r.added ? `登録しました。今日の分${yen(r.sum)}を記録しました` : "登録しました");
    };
  });
}

function modalGoal(first) {
  openModal(`
    <h3>${first ? "何のために貯めますか？" : "目標を追加"}</h3>
    <p class="lead">具体的な目標があると、お金は「我慢」から「楽しみの準備」に変わります。</p>
    <div class="field"><label for="gl-name">目標の名前</label><input id="gl-name" placeholder="例：沖縄旅行、緊急用の生活費3か月分"></div>
    <div class="field"><label for="gl-amt">目標金額</label><input id="gl-amt" type="number" inputmode="numeric" min="1" placeholder="100000"></div>
    <div class="field"><label for="gl-dl">期限（任意）</label><input id="gl-dl" type="date"></div>
    <div class="row-btns"><button class="btn shu" id="gl-ok">保存</button><button class="btn ghost" data-close>やめる</button></div>`, () => {
    $("gl-ok").onclick = () => {
      const name = $("gl-name").value.trim(), a = Number($("gl-amt").value);
      if (!name || !a) { toast("名前と金額を入力してください"); return; }
      const g = { id: uid(), name, target: Math.round(a), deadline: $("gl-dl").value || "" };
      state.goals.push(g); state.activeGoalId = g.id; save(); closeModal(); render(); toast("目標を設定しました");
    };
  });
}

function modalSettings() {
  openModal(`
    <h3>設定</h3>
    <div class="field"><label for="st-anchor">きっかけ（〇〇したら）</label><input id="st-anchor" value="${esc(state.profile.anchor)}"></div>
    <div class="field"><label for="st-amt">1回の金額</label><input id="st-amt" type="number" inputmode="numeric" min="1" value="${state.profile.amount}"></div>
    <div class="field"><label for="st-letter">1年後の自分へ</label><input id="st-letter" value="${esc(state.profile.letter)}"></div>
    <div class="field"><label><input type="checkbox" id="st-sound" ${state.profile.sound ? "checked" : ""}> 効果音とバイブ</label></div>
    <div class="row-btns"><button class="btn shu" id="st-ok">保存</button><button class="btn ghost" data-close>閉じる</button></div>
    <hr style="border:0;border-top:1px solid var(--rule);margin:20px 0">
    <div class="field"><span class="label">バックアップ</span>
      <div class="row-btns" style="margin:0"><button class="btn" id="st-export">データをコピー</button><button class="btn" id="st-import-open">データを貼り付けて復元</button></div>
      <textarea id="st-data" hidden placeholder="コピーしたデータをここに貼り付け"></textarea>
      <button class="btn primary" id="st-import" hidden>復元する</button>
    </div>
    <div class="field"><span class="label">リセット</span>
      <button class="btn danger" id="st-reset">すべてのデータを消す</button>
      <div id="st-reset-confirm" hidden><p class="muted">本当に消しますか？ この操作は元に戻せません。</p>
        <div class="row-btns" style="margin:0"><button class="btn danger" id="st-reset-yes">消す</button><button class="btn ghost" id="st-reset-no">やめる</button></div></div>
    </div>`, () => {
    $("st-ok").onclick = () => {
      state.profile.anchor = $("st-anchor").value.trim() || state.profile.anchor;
      const a = Number($("st-amt").value); if (a > 0) { state.profile.amount = Math.round(a); state.stepUp = null; }
      state.profile.letter = $("st-letter").value.trim();
      state.profile.sound = $("st-sound").checked;
      save(); closeModal(); render(); toast("保存しました");
    };
    $("st-export").onclick = () => {
      const data = JSON.stringify(state);
      const ta = $("st-data"); ta.hidden = false; ta.value = data;
      navigator.clipboard && navigator.clipboard.writeText(data).then(() => toast("コピーしました"), () => { ta.select(); toast("テキストを選択しました。コピーしてください"); });
    };
    $("st-import-open").onclick = () => { $("st-data").hidden = false; $("st-data").value = ""; $("st-import").hidden = false; $("st-data").focus(); };
    $("st-import").onclick = () => {
      try {
        const obj = JSON.parse($("st-data").value);
        if (!obj || !Array.isArray(obj.entries)) throw new Error();
        state = Object.assign(defaultState(), obj); save(); closeModal(); render(); toast("復元しました");
      } catch (e) { toast("データの形式が正しくありません"); }
    };
    $("st-reset").onclick = () => { $("st-reset-confirm").hidden = false; };
    $("st-reset-no").onclick = () => { $("st-reset-confirm").hidden = true; };
    $("st-reset-yes").onclick = () => { state = defaultState(); save(); closeModal(); render(); onboarding(); };
  });
}

/* ===================== オンボーディング ===================== */
function onboarding() {
  const draft = { goalName: "", target: "", deadline: "", anchor: "朝のコーヒーを淹れたら", amount: 100, name: "", letter: "", sealed: false };
  const anchors = ["朝のコーヒーを淹れたら", "歯みがきをしたら", "帰宅して靴を脱いだら", "お昼ごはんを食べたら", "寝る前にスマホを充電したら"];
  const amounts = [50, 100, 300, 500, 1000];
  const steps = (n) => `<div class="steps">${[0, 1, 2].map((i) => `<span class="${i <= n ? "on" : ""}"></span>`).join("")}</div>`;

  function step1() {
    openModal(`${steps(0)}
      <h3>何のために貯めますか？</h3>
      <p class="lead">ゴールがはっきりしているほど、脳は「我慢」ではなく「楽しみの準備」と感じます。</p>
      <div class="field"><label for="ob-goal">目標</label><input id="ob-goal" placeholder="例：来年の夏の旅行" value="${esc(draft.goalName)}"></div>
      <div class="field"><label for="ob-target">目標金額</label><input id="ob-target" type="number" inputmode="numeric" min="1" placeholder="100000" value="${draft.target}"></div>
      <div class="field"><label for="ob-dl">期限（任意）</label><input id="ob-dl" type="date" value="${draft.deadline}"></div>
      <div class="row-btns"><button class="btn shu" id="ob-next">次へ</button><button class="btn ghost" id="ob-demo">サンプルデータで見てみる</button></div>`, () => {
      $("ob-next").onclick = () => {
        draft.goalName = $("ob-goal").value.trim(); draft.target = Number($("ob-target").value); draft.deadline = $("ob-dl").value;
        if (!draft.goalName || !draft.target) { toast("目標と金額を入力してください"); return; }
        step2();
      };
      $("ob-demo").onclick = loadDemo;
    });
  }
  function step2() {
    openModal(`${steps(1)}
      <h3>いつ貯金しますか？</h3>
      <p class="lead">毎日すでにしている行動を「きっかけ」にします。金額は拍子抜けするくらい小さくてOK。続けることが最優先です。</p>
      <div class="field"><span class="label">きっかけ</span><div class="chips" id="ob-anchors">${anchors.map((a) => `<button class="chip${a === draft.anchor ? " on" : ""}" data-a="${esc(a)}">${esc(a)}</button>`).join("")}</div></div>
      <div class="field"><label for="ob-anchor">自分で書く</label><input id="ob-anchor" value="${esc(draft.anchor)}"></div>
      <div class="field"><span class="label">1回の金額</span><div class="chips" id="ob-amts">${amounts.map((a) => `<button class="chip${a === draft.amount ? " on" : ""}" data-v="${a}">${yen(a)}</button>`).join("")}</div></div>
      <div class="preview-box" id="ob-preview"></div>
      <div class="row-btns"><button class="btn shu" id="ob-next">次へ</button><button class="btn ghost" id="ob-back">戻る</button></div>`, () => {
      const upd = () => { $("ob-preview").innerHTML = `<b>${esc(draft.anchor)}</b>、<b>${yen(draft.amount)}</b>を貯金する。<br><span class="muted">1年続けると ${yen(draft.amount * 365)}</span>`; };
      document.querySelectorAll("#ob-anchors .chip").forEach((b) => b.onclick = () => {
        document.querySelectorAll("#ob-anchors .chip").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        draft.anchor = b.dataset.a; $("ob-anchor").value = draft.anchor; upd();
      });
      $("ob-anchor").oninput = () => { draft.anchor = $("ob-anchor").value.trim() || anchors[0]; upd(); };
      document.querySelectorAll("#ob-amts .chip").forEach((b) => b.onclick = () => {
        document.querySelectorAll("#ob-amts .chip").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        draft.amount = Number(b.dataset.v); upd();
      });
      upd();
      $("ob-next").onclick = step3;
      $("ob-back").onclick = step1;
    });
  }
  function step3() {
    openModal(`${steps(2)}
      <h3>自分に宣言する</h3>
      <p class="lead">「貯金をがんばる」ではなく「貯められる人になる」。自分をどう呼ぶかで行動が変わります。</p>
      <div class="field"><label for="ob-name">あなたの名前（ニックネーム）</label><input id="ob-name" value="${esc(draft.name)}" placeholder="例：さくら"></div>
      <div class="preview-box" id="ob-pledge"></div>
      <div class="field"><label for="ob-letter">1年後の自分へ一言（任意）</label><input id="ob-letter" value="${esc(draft.letter)}" placeholder="例：旅行、思いきり楽しんでね"></div>
      <button class="hanko-btn" id="ob-hanko" aria-label="宣言に印を押す">ここに印</button>
      <p class="muted" style="text-align:center;margin:0 0 14px">タップして宣言に印を押す</p>
      <div class="row-btns"><button class="btn shu" id="ob-done" disabled>はじめる</button><button class="btn ghost" id="ob-back">戻る</button></div>`, () => {
      const upd = () => { draft.name = $("ob-name").value.trim(); $("ob-pledge").innerHTML = `私${draft.name ? `、<b>${esc(draft.name)}</b>` : ""}は、<b>${esc(draft.anchor)}</b>、<b>${yen(draft.amount)}</b>を貯金します。私は未来の自分のためにお金を育てられる人です。`; };
      $("ob-name").oninput = upd; upd();
      $("ob-hanko").onclick = () => {
        draft.sealed = true; $("ob-hanko").classList.add("on"); $("ob-hanko").textContent = (draft.name || "誓").slice(0, 1);
        $("ob-done").disabled = false; coin();
      };
      $("ob-back").onclick = () => { draft.letter = $("ob-letter").value; step2(); };
      $("ob-done").onclick = () => {
        draft.letter = $("ob-letter").value.trim();
        const g = { id: uid(), name: draft.goalName, target: Math.round(draft.target), deadline: draft.deadline };
        Object.assign(state, defaultState(), {
          onboarded: true, createdAt: today(), goals: [g], activeGoalId: g.id,
          profile: { name: draft.name, anchor: draft.anchor, amount: draft.amount, letter: draft.letter, sound: true },
        });
        save(); closeModal(); render(); confetti(120);
        showReward({ seal: "始", kicker: "スタート", title: "印帳カードを作りました", text: "目標設定と宣言で、最初の2つの印はもう押されています。残りは8つ。まずは今日の1回から。" });
      };
    });
  }
  step1();
}

function loadDemo() {
  const t = today();
  const g = { id: uid(), name: "夏の沖縄旅行（サンプル）", target: 120000, deadline: addDays(t, 180) };
  const s = Object.assign(defaultState(), {
    onboarded: true, demo: true, createdAt: addDays(t, -40), goals: [g], activeGoalId: g.id,
    profile: { name: "サンプル", anchor: "朝のコーヒーを淹れたら", amount: 200, letter: "海で思いきり泳いでね", sound: true },
    freezes: 1,
  });
  const notes = ["コンビニコーヒー", "お菓子", "ランチ外食", "衝動買い"];
  for (let i = 40; i >= 1; i--) {
    const d = addDays(t, -i);
    if (i === 17 || i === 29) continue;
    s.entries.push({ id: uid(), date: d, ts: Date.now() - i * 86400000, amount: 200, type: "checkin", note: s.profile.anchor, goalId: g.id });
    if (i % 6 === 0) s.entries.push({ id: uid(), date: d, ts: Date.now() - i * 86400000 + 1, amount: [150, 200, 900, 3000][i % 4], type: "skip", note: notes[i % 4], goalId: g.id });
  }
  s.frozenDays = [addDays(t, -17)];
  s.rules.push({ id: uid(), name: "給料日の先取り", amount: 20000, freq: "monthly", day: 25, lastRun: addDays(t, -41) });
  s.masu.picked = [7, 23, 41, 58, 88];
  s.masu.picked.forEach((n, i) => s.entries.push({ id: uid(), date: addDays(t, -30 + i * 5), ts: Date.now() - (30 - i * 5) * 86400000 + 2, amount: n * 10, type: "masu", note: `${n}マス目`, goalId: g.id }));
  s.goldDays = [addDays(t, -9), addDays(t, -22)];
  state = s;
  runRules();
  save(); closeModal(); render();
  toast("サンプルデータを表示中。設定のリセットで自分用に始められます");
}

/* ===================== イベント ===================== */
function navigate(view) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.nav === view));
  window.scrollTo(0, 0);
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("button");
  if (!el) {
    if (ev.target.id === "modal") closeModal();
    return;
  }
  if (el.dataset.nav) navigate(el.dataset.nav);
  else if (el.dataset.open === "skip") modalSkip();
  else if (el.dataset.open === "roundup") modalRoundup();
  else if (el.dataset.open === "manual") modalManual();
  else if (el.dataset.open === "rule") modalRule();
  else if (el.dataset.open === "goal") modalGoal(false);
  else if ("close" in el.dataset) closeModal();
  else if (el.dataset.del) {
    if (el.dataset.confirm === "1") {
      state.entries = state.entries.filter((e) => e.id !== el.dataset.del); save(); render(); toast("削除しました");
    } else {
      el.dataset.confirm = "1"; el.textContent = "削除"; el.style.color = "var(--shu)"; el.style.fontSize = "12px";
      setTimeout(() => { if (el.isConnected) { el.dataset.confirm = ""; el.textContent = "×"; el.style.color = ""; el.style.fontSize = ""; } }, 3000);
    }
  } else if (el.dataset.ruleDel) {
    state.rules = state.rules.filter((r) => r.id !== el.dataset.ruleDel); save(); render();
  } else if (el.dataset.ruleToggle) {
    const r = state.rules.find((x) => x.id === el.dataset.ruleToggle);
    if (r) { r.paused = !r.paused; r.lastRun = today(); save(); render(); }
  } else if (el.dataset.goalUse) {
    state.activeGoalId = el.dataset.goalUse; save(); render();
  } else if (el.dataset.goalDel) {
    state.goals = state.goals.filter((g) => g.id !== el.dataset.goalDel);
    if (state.activeGoalId === el.dataset.goalDel) state.activeGoalId = state.goals[0] ? state.goals[0].id : null;
    save(); render();
  } else if (el.dataset.masu) {
    masuSave(Number(el.dataset.masu));
  }
});

function masuSave(n) {
  if (state.masu.picked.includes(n)) { toast(`${n}マス目は記録済みです`); return; }
  const amt = n * state.masu.unit;
  showReward({ seal: String(n), kicker: "100マス貯金", title: `${n}マス目：${yen(amt)}`, text: `残り${99 - state.masu.picked.length}マス。貯金したら下のボタンで記録しましょう。`, bonus: null });
  const card = $("reward-card");
  card.querySelector(".row-btns").innerHTML = `<button class="btn shu" id="ms-ok">${yen(amt)}貯金した</button><button class="btn ghost" id="ms-no">あとで</button>`;
  $("ms-ok").onclick = () => {
    state.masu.picked.push(n);
    addEntry("masu", amt, `${n}マス目`);
    $("reward").hidden = true; coin(); confetti(60); render();
    if (state.masu.picked.length === 100) toast("100マス制覇！ おめでとうございます");
  };
  $("ms-no").onclick = () => { $("reward").hidden = true; };
}

$("checkin-btn").addEventListener("click", checkin);
$("open-settings").addEventListener("click", modalSettings);
$("masu-draw").addEventListener("click", () => {
  const picked = new Set(state.masu.picked);
  const left = []; for (let i = 1; i <= 100; i++) if (!picked.has(i)) left.push(i);
  if (left.length) masuSave(pick(left));
});
$("masu-unit").addEventListener("change", (e) => { state.masu.unit = Number(e.target.value); save(); render(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("reward").hidden) $("reward").hidden = true; else closeModal(); }
});

/* ===================== 起動 ===================== */
function boot() {
  renderScience();
  if (!state.onboarded) { render(); onboarding(); return; }
  const rules = runRules();
  const frozen = applyFreezes();
  render();
  if (frozen) toast(`おやすみ券を${frozen}枚使って連続記録を守りました`);
  else if (rules.added) toast(`自動積立 ${yen(rules.sum)}を記録しました`);
}
boot();

// 日付をまたいで開きっぱなしの場合に備える
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); boot(); } }, 60000);
