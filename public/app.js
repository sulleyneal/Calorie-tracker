/* Morsel — front of house */
const $ = (id) => document.getElementById(id);

const state = {
  goal: 2000,
  entries: [],
  messages: [],
  pendingText: null, // set while a "same plate?" question is open
  busy: false,
  celebratedToday: false,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const SUGGESTIONS = [
  'Had a cappuccino and an almond croissant',
  'Two eggs, bacon and toast',
  'Salmon poke bowl for lunch',
];

// ── helpers ──────────────────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayLabel(key) {
  const today = keyToDate(todayKey());
  const date = keyToDate(key);
  const diff = Math.round((today - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}
function dayEyebrow(key) {
  const date = keyToDate(key);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`.toUpperCase();
}
function todayEntries() {
  return state.entries.filter((e) => e.dateKey === todayKey());
}
function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ── day summary (chat header) ────────────────────────────────────────
function animateNumber(node, to) {
  const from = Number(node.dataset.value || 0);
  if (from === to) { node.textContent = to.toLocaleString(); return; }
  node.dataset.value = to;
  const start = performance.now();
  const dur = 700;
  (function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

function renderSummary() {
  const today = todayEntries();
  const total = today.reduce((s, e) => s + e.kcal, 0);
  $('todayEyebrow').textContent = dayEyebrow(todayKey());
  animateNumber($('totalNum'), total);
  $('goalBtn').textContent = `${state.goal.toLocaleString()} cal`;
  const pct = Math.min(100, (total / state.goal) * 100);
  const fill = $('progressFill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('over', total > state.goal * 1.08);
  $('mP').textContent = `${today.reduce((s, e) => s + (e.p || 0), 0)}g`;
  $('mC').textContent = `${today.reduce((s, e) => s + (e.c || 0), 0)}g`;
  $('mF').textContent = `${today.reduce((s, e) => s + (e.f || 0), 0)}g`;
}

// ── chat thread ──────────────────────────────────────────────────────
function itemCard(entry) {
  return el('div', 'itemCard', `
    <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" loading="lazy" />
    <div>
      <h3>${esc(entry.name)}</h3>
      <p class="portion">${esc(entry.portion)}</p>
      <p class="stats">
        <span class="kcal">${entry.kcal.toLocaleString()}<small> cal</small></span>
        <span class="macro p"><b>P</b> ${entry.p ?? 0}</span>
        <span class="macro c"><b>C</b> ${entry.c ?? 0}</span>
        <span class="macro f"><b>F</b> ${entry.f ?? 0}</span>
      </p>
    </div>`);
}

function appendMessage(msg) {
  const thread = $('thread');
  if (msg.role === 'user') {
    thread.appendChild(el('div', 'msg user', esc(msg.text)));
  } else {
    // item cards appear before Morsel's remark, like a receipt then a wink
    for (const id of msg.entryIds || []) {
      const entry = state.entries.find((e) => e.id === id);
      if (entry) thread.appendChild(itemCard(entry));
    }
    thread.appendChild(el('div', 'msg bot', esc(msg.text)));
  }
}

function renderThread() {
  const thread = $('thread');
  thread.innerHTML = '';
  for (const msg of state.messages) appendMessage(msg);
  renderSuggestions();
  scrollChat(false);
}

function renderSuggestions() {
  const box = $('suggestions');
  box.innerHTML = '';
  if (state.entries.length || state.messages.length > 1) return;
  for (const s of SUGGESTIONS) {
    const b = el('button', null, esc(s));
    b.onclick = () => { $('logInput').value = s; sendLog(); };
    box.appendChild(b);
  }
}

function scrollChat(smooth = true) {
  const view = $('chatView');
  view.scrollTo({ top: view.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function showTyping() {
  const t = el('div', 'typing', '<i></i><i></i><i></i>');
  t.id = 'typingDots';
  $('thread').appendChild(t);
  scrollChat();
}
function hideTyping() {
  $('typingDots')?.remove();
}

function showConfirmChips(originalText) {
  const row = el('div', 'chipRow');
  row.id = 'confirmRow';
  const yes = el('button', null, 'Add it — second helping 🍽️');
  const no = el('button', null, 'Same plate — skip it');
  yes.onclick = () => { row.remove(); send({ text: originalText, confirm: true, label: 'Yes, add it!' }); };
  no.onclick = () => { row.remove(); send({ skip: true, label: 'Same plate — skip it' }); };
  row.append(yes, no);
  $('thread').appendChild(row);
  scrollChat();
}

// ── journal view ─────────────────────────────────────────────────────
function renderJournal() {
  const view = $('journalView');
  view.innerHTML = '';

  if (!state.entries.length) {
    view.appendChild(el('div', 'emptyJournal',
      `<div class="big">🍓</div>Your journal is empty.<br/>Tell Morsel what you ate and<br/>the pretty pictures will appear here.`));
    return;
  }

  const byDay = new Map();
  for (const entry of state.entries) {
    if (!byDay.has(entry.dateKey)) byDay.set(entry.dateKey, []);
    byDay.get(entry.dateKey).push(entry);
  }
  const days = [...byDay.keys()].sort().reverse();

  for (const key of days) {
    const entries = byDay.get(key);
    const total = entries.reduce((s, e) => s + e.kcal, 0);
    const block = el('section', 'dayBlock');
    block.appendChild(el('div', 'dayHead', `
      <div>
        <p class="eyebrow">${dayEyebrow(key)}</p>
        <h2 class="dayTitle">${dayLabel(key)}</h2>
      </div>
      <p class="dayTotal">${total.toLocaleString()}<small>cal</small></p>`));

    entries.forEach((entry, i) => {
      const row = el('article', 'jEntry' + (i % 2 ? ' flip' : ''));
      row.style.animationDelay = `${Math.min(i * 60, 360)}ms`;
      row.innerHTML = `
        <div class="photoWrap">
          <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" loading="lazy" />
          <button class="del" title="Remove ${esc(entry.name)}">✕</button>
        </div>
        <div class="meta">
          <h3>${esc(entry.name)}</h3>
          <p class="kcal">${entry.kcal.toLocaleString()}<small> cal</small></p>
        </div>`;
      row.querySelector('.del').onclick = () => deleteEntry(entry);
      block.appendChild(row);
    });
    view.appendChild(block);
  }
}

async function deleteEntry(entry) {
  if (!window.confirm(`Remove ${entry.name} (${entry.kcal} cal) from your journal?`)) return;
  const res = await fetch(`/api/entries/${entry.id}`, { method: 'DELETE' });
  if (res.ok) {
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    renderJournal();
    renderSummary();
  }
}

// ── celebration ──────────────────────────────────────────────────────
function celebrate() {
  const layer = $('burstLayer');
  const emojis = ['🍓', '✨', '🎉', '💪', '🌟'];
  for (let i = 0; i < 14; i++) {
    const b = el('span', 'burst', emojis[i % emojis.length]);
    b.style.left = `${8 + Math.random() * 84}%`;
    b.style.bottom = `${5 + Math.random() * 20}%`;
    b.style.setProperty('--spin', `${(Math.random() * 60 - 30).toFixed(0)}deg`);
    b.style.animationDelay = `${Math.random() * 0.45}s`;
    layer.appendChild(b);
    setTimeout(() => b.remove(), 2400);
  }
}

// ── network ──────────────────────────────────────────────────────────
async function send(payload) {
  state.busy = true;
  $('sendBtn').disabled = true;
  if (payload.label || payload.text) {
    appendMessage({ role: 'user', text: payload.label || payload.text });
    scrollChat();
  }
  showTyping();

  try {
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) {
      appendMessage({ role: 'bot', text: data.error || 'Something went sideways — try again?' });
      return;
    }

    const wasUnderGoal = todayEntries().reduce((s, e) => s + e.kcal, 0) < state.goal;
    state.entries.push(...(data.entries || []));
    appendMessage({ role: 'bot', text: data.reply, entryIds: (data.entries || []).map((e) => e.id) });

    if (data.needsConfirm) showConfirmChips(data.originalText);

    renderSummary();
    renderJournal();
    renderSuggestions();
    scrollChat();

    const total = todayEntries().reduce((s, e) => s + e.kcal, 0);
    if (wasUnderGoal && total >= state.goal * 0.95 && total <= state.goal * 1.1 && !state.celebratedToday) {
      state.celebratedToday = true;
      celebrate();
    }
  } catch {
    hideTyping();
    appendMessage({ role: 'bot', text: "I couldn't reach the kitchen — is the server still running?" });
  } finally {
    state.busy = false;
    $('sendBtn').disabled = false;
    $('logInput').focus();
  }
}

function sendLog() {
  const input = $('logInput');
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = '';
  document.getElementById('confirmRow')?.remove();
  send({ text });
}

// ── view switching ───────────────────────────────────────────────────
function setView(view) {
  const chat = view === 'chat';
  $('chatView').hidden = !chat;
  $('journalView').hidden = chat;
  $('composer').style.display = chat ? '' : 'none';
  $('tabChat').setAttribute('aria-selected', chat);
  $('tabJournal').setAttribute('aria-selected', !chat);
  if (chat) scrollChat(false);
}

// ── boot ─────────────────────────────────────────────────────────────
async function init() {
  $('logForm').addEventListener('submit', (e) => { e.preventDefault(); sendLog(); });
  $('tabChat').onclick = () => setView('chat');
  $('tabJournal').onclick = () => setView('journal');
  $('goalBtn').onclick = async () => {
    const answer = prompt('Daily calorie goal:', state.goal);
    const goal = Math.round(Number(answer));
    if (!answer || !Number.isFinite(goal)) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    });
    if (res.ok) { state.goal = goal; renderSummary(); }
  };

  const data = await fetch('/api/state').then((r) => r.json());
  state.goal = data.goal;
  state.entries = data.entries;
  state.messages = data.messages;
  state.celebratedToday = todayEntries().reduce((s, e) => s + e.kcal, 0) >= state.goal;

  renderSummary();
  renderThread();
  renderJournal();
  setView('chat');
}

init();
