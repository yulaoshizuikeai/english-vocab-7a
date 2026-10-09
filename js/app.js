/**
 * 主控制器模块
 * 负责数据加载、状态机流转、视图切换、DOM 交互与 4 秒停留控制
 */

import { calculateSM2, predictIntervals, LEECH_THRESHOLD } from './sm2.js';
import {
  loadSM2Store,
  saveSM2Store,
  getCardProgress,
  loadSettings,
  saveSettings,
  loadHistoryStore,
  recordReviewHistory,
  loadAchievements,
  saveAchievements
} from './storage.js';
import { playPronunciation } from './audio.js';

// 学习记录目标定义（客观学术规范）
const ACHIEVEMENT_DEFINITIONS = [
  {
    id: "first_word",
    name: "初次测评",
    desc: "在系统中完成首个单词的学习自测",
    icon: `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`,
    check: (stats) => stats.totalReviews >= 1
  },
  {
    id: "review_10",
    name: "初见成效",
    desc: "累计完成 10 次单词复习",
    icon: `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
    check: (stats) => stats.totalReviews >= 10
  },
  {
    id: "review_50",
    name: "稳步推进",
    desc: "累计完成 50 次单词复习",
    icon: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
    check: (stats) => stats.totalReviews >= 50
  },
  {
    id: "review_100",
    name: "百词巩固",
    desc: "累计完成 100 次词汇自测与评估",
    icon: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
    check: (stats) => stats.totalReviews >= 100
  },
  {
    id: "master_10",
    name: "基础掌握",
    desc: "达成 10 个词汇的连续正确记忆 (复习轮次 ≥ 2)",
    icon: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
    check: (stats) => stats.masteredCount >= 10
  },
  {
    id: "master_50",
    name: "词汇中坚",
    desc: "达成 50 个核心词汇的深度掌握",
    icon: `<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>`,
    check: (stats) => stats.masteredCount >= 50
  },
  {
    id: "master_unit",
    name: "单元结课",
    desc: "完整掌握任意单一单元的全部考纲词汇",
    icon: `<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
    check: (stats) => stats.hasFullUnitMastered
  },
  {
    id: "streak_3days",
    name: "连续学习",
    desc: "连续 3 天记录并完成复习打卡",
    icon: `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
    check: (stats) => stats.maxStreakDays >= 3
  },
  {
    id: "daily_target_20",
    name: "高效日标",
    desc: "单日完成 20 词以上的集中自测",
    icon: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
    check: (stats) => stats.todayReviewCount >= 20
  },
  {
    id: "hard_overcome",
    name: "难点突破",
    desc: "克服 5 个曾遗忘或低EF的难词并成功复习",
    icon: `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
    check: (stats) => stats.overcomeLapsesCount >= 5
  }
];

// 数据存储
let VOCAB_DATABASE = [];
let PHRASE_DATABASE = [];

// 会话状态
let currentSettings = loadSettings();
let sessionQueue = [];
let sessionTotalCount = 0;
let sessionMasteredCount = 0;
let isRevealed = false;
let currentCard = null;
let stayTimerInterval = null;
let isStayLocked = false;

// 提示消息浮层
function showToast(msg) {
  const toast = document.getElementById('notionToast');
  if (!toast) return;
  document.getElementById('toastMessageText').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// 加载外部数据
async function initData() {
  try {
    const [vocabRes, phrasesRes] = await Promise.all([
      fetch('data/vocab-7a.json'),
      fetch('data/phrases-7a.json')
    ]);
    VOCAB_DATABASE = await vocabRes.json();
    PHRASE_DATABASE = await phrasesRes.json();

    document.getElementById('totalVocabCountText').textContent = VOCAB_DATABASE.length;
    document.getElementById('totalPhrasesCountText').textContent = PHRASE_DATABASE.length;
    document.getElementById('totalMasteredCap').textContent = VOCAB_DATABASE.length;

    initUnitSelector();
    initEventListeners();
    initTheme();
    startNewSession();
  } catch (err) {
    console.error('Failed to load dataset:', err);
    showToast('数据文件加载失败，请检查网络或刷新页面');
  }
}

// 初始化单元选择器
function initUnitSelector() {
  const unitSelectorEl = document.getElementById('unitSelector');
  unitSelectorEl.innerHTML = '';
  for (let u = 1; u <= 8; u++) {
    const chip = document.createElement('div');
    chip.className = 'unit-chip' + (currentSettings.selectedUnits.includes(u) ? ' selected' : '');
    chip.textContent = 'Unit ' + u;
    chip.dataset.unit = u;
    chip.addEventListener('click', function() {
      const val = parseInt(this.dataset.unit, 10);
      if (currentSettings.selectedUnits.includes(val)) {
        if (currentSettings.selectedUnits.length > 1) {
          currentSettings.selectedUnits = currentSettings.selectedUnits.filter(x => x !== val);
          this.classList.remove('selected');
        }
      } else {
        currentSettings.selectedUnits.push(val);
        this.classList.add('selected');
      }
      saveSettings(currentSettings);
      startNewSession();
    });
    unitSelectorEl.appendChild(chip);
  }
}

// 统计重点难词
function getLeechCards() {
  const store = loadSM2Store();
  return VOCAB_DATABASE.filter(w => {
    const p = store[w.id];
    return p && (p.lapses >= LEECH_THRESHOLD || p.isLeech);
  });
}

function updateLeechCountBadge() {
  const leeches = getLeechCards();
  const badge = document.getElementById('navLeechBadge');
  if (badge) {
    badge.textContent = leeches.length;
    badge.style.display = leeches.length > 0 ? 'inline-block' : 'none';
  }
}

// 目标达成状态检查
function checkAndAwardAchievements() {
  const store = loadSM2Store();
  const history = loadHistoryStore();
  const unlockedStore = loadAchievements();

  let totalReviews = 0;
  let masteredCount = 0;
  let overcomeLapsesCount = 0;

  Object.values(store).forEach(c => {
    totalReviews += (c.totalReviews || 0);
    if (c.repetitions >= 2 && c.efactor >= 2.2) masteredCount++;
    if (c.lapses >= 1 && c.repetitions >= 2 && c.interval >= 3) overcomeLapsesCount++;
  });

  let hasFullUnitMastered = false;
  for (let u = 1; u <= 8; u++) {
    const unitWords = VOCAB_DATABASE.filter(w => w.unit === u);
    if (unitWords.length === 0) continue;
    const allDone = unitWords.every(w => {
      const p = store[w.id];
      return p && p.repetitions >= 2;
    });
    if (allDone) {
      hasFullUnitMastered = true;
      break;
    }
  }

  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const todayReviewCount = history[todayKey] || 0;

  let maxStreakDays = 0;
  let currentStreak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if ((history[k] || 0) > 0) {
      currentStreak++;
      if (currentStreak > maxStreakDays) maxStreakDays = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const stats = {
    totalReviews,
    masteredCount,
    overcomeLapsesCount,
    hasFullUnitMastered,
    todayReviewCount,
    maxStreakDays
  };

  let newUnlockedName = null;
  ACHIEVEMENT_DEFINITIONS.forEach(ach => {
    if (!unlockedStore[ach.id]) {
      if (ach.check(stats)) {
        unlockedStore[ach.id] = { unlockedAt: new Date().toISOString() };
        newUnlockedName = ach.name;
      }
    }
  });

  if (newUnlockedName) {
    saveAchievements(unlockedStore);
    showToast('已达成目标：' + newUnlockedName);
    renderAchievements();
  }
}

// 会话队列调度
function startNewSession() {
  const mode = currentSettings.mode;
  let candidates = [];

  if (mode === 'phrases') {
    candidates = PHRASE_DATABASE.filter(p => currentSettings.selectedUnits.includes(p.unit)).map(p => ({
      id: p.id,
      unit: p.unit,
      unitTitle: p.unitTitle,
      word: p.phrase,
      phonetic: '',
      pos: 'phrase',
      meaning: p.meaning,
      phrase: p.example,
      root: '课文核心短语搭配'
    }));
  } else if (mode === 'leech') {
    candidates = getLeechCards();
  } else if (mode === 'due') {
    const store = loadSM2Store();
    const now = Date.now();
    candidates = VOCAB_DATABASE.filter(w => currentSettings.selectedUnits.includes(w.unit)).filter(w => {
      const p = store[w.id];
      return p && p.dueDate && p.dueDate <= now;
    });
  } else if (mode === 'batch10' || mode === 'batch15' || mode === 'batch20') {
    const limit = mode === 'batch10' ? 10 : (mode === 'batch15' ? 15 : 20);
    const store = loadSM2Store();
    const unmastered = VOCAB_DATABASE.filter(w => currentSettings.selectedUnits.includes(w.unit))
      .filter(w => !store[w.id] || store[w.id].repetitions < 2);
    candidates = unmastered.slice(0, limit);
    if (candidates.length === 0) {
      candidates = VOCAB_DATABASE.filter(w => currentSettings.selectedUnits.includes(w.unit)).slice(0, limit);
    }
  } else {
    // 默认单元全量模式
    candidates = VOCAB_DATABASE.filter(w => currentSettings.selectedUnits.includes(w.unit));
  }

  sessionQueue = [...candidates];
  sessionTotalCount = sessionQueue.length;
  sessionMasteredCount = 0;

  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('flashcard').style.display = 'flex';
  document.getElementById('ratingContainer').classList.remove('active');
  resetStayLock();

  loadNextCard();
}

function resetStayLock() {
  if (stayTimerInterval) {
    clearInterval(stayTimerInterval);
    stayTimerInterval = null;
  }
  isStayLocked = false;
  setRatingButtonsDisabled(false);
}

function setRatingButtonsDisabled(disabled) {
  const btns = document.querySelectorAll('.rate-btn');
  btns.forEach(b => b.disabled = disabled);
}

function loadNextCard() {
  resetStayLock();

  if (sessionQueue.length === 0) {
    showSessionComplete();
    return;
  }

  currentCard = sessionQueue[0];
  isRevealed = false;

  const cardEl = document.getElementById('flashcard');
  cardEl.classList.remove('revealed');
  document.getElementById('ratingContainer').classList.remove('active');

  document.getElementById('cardUnitTag').textContent = currentCard.unitTitle;
  const p = getCardProgress(currentCard.id);
  document.getElementById('cardSm2Tag').textContent = '已记:' + p.repetitions + '次 · 间隔:' + p.interval + '天 · 遗忘:' + (p.lapses || 0) + '次 · EF:' + p.efactor;

  const leechBadgeEl = document.getElementById('cardLeechTag');
  if (p.lapses >= LEECH_THRESHOLD || p.isLeech) {
    leechBadgeEl.classList.add('active');
  } else {
    leechBadgeEl.classList.remove('active');
  }

  document.getElementById('wordText').textContent = currentCard.word;
  document.getElementById('phoneticText').textContent = currentCard.phonetic || '';
  document.getElementById('posText').textContent = currentCard.pos || '';
  document.getElementById('meaningText').textContent = currentCard.meaning;
  document.getElementById('phraseText').textContent = currentCard.phrase;
  document.getElementById('rootText').textContent = currentCard.root || '考纲核心词汇，结合搭配短语加深理解';

  // 预测下一次间隔显示
  const { hardDays, goodDays, easyDays } = predictIntervals(p);
  document.getElementById('hardIntervalText').textContent = hardDays + '天 · 键 2';
  document.getElementById('goodIntervalText').textContent = goodDays + '天 · 键 3';
  document.getElementById('easyIntervalText').textContent = easyDays + '天 · 键 4';

  updateProgressDisplay();
  renderHeatmap();
  renderAchievements();
  updateLeechCountBadge();

  if (currentSettings.autoPronounce) {
    playPronunciation(currentCard.word);
  }
}

function revealCard() {
  if (isRevealed) return;
  isRevealed = true;
  document.getElementById('flashcard').classList.add('revealed');
  document.getElementById('ratingContainer').classList.add('active');

  if (currentCard) {
    setTimeout(() => {
      playPronunciation(currentCard.word);
    }, 150);
  }

  // 固化 4 秒自然沉淀（无多余弹窗，按钮禁用 4 秒后激活）
  isStayLocked = true;
  setRatingButtonsDisabled(true);
  let remainingSeconds = 4;

  stayTimerInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds <= 0) {
      clearInterval(stayTimerInterval);
      stayTimerInterval = null;
      isStayLocked = false;
      setRatingButtonsDisabled(false);
    }
  }, 1000);
}

function handleRating(quality) {
  if (!currentCard || !isRevealed || isStayLocked) return;

  const updated = calculateSM2(getCardProgress(currentCard.id), quality);
  const store = loadSM2Store();
  store[currentCard.id] = updated;
  saveSM2Store(store);

  recordReviewHistory();
  checkAndAwardAchievements();
  updateLeechCountBadge();

  if (quality < 3) {
    const card = sessionQueue.shift();
    sessionQueue.push(card);
  } else {
    sessionQueue.shift();
    sessionMasteredCount++;
  }

  loadNextCard();
}

function updateProgressDisplay() {
  const remaining = sessionQueue.length;
  const done = sessionMasteredCount;
  const total = sessionTotalCount;
  document.getElementById('sessionProgressText').textContent = done + ' / ' + total;
  document.getElementById('retryCountText').textContent = remaining;
  document.getElementById('masteredCountText').textContent = done;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressBarFill').style.width = pct + '%';
}

function showSessionComplete() {
  document.getElementById('flashcard').style.display = 'none';
  document.getElementById('ratingContainer').classList.remove('active');
  resetStayLock();
  document.getElementById('completeCard').style.display = 'block';
  document.getElementById('completeDesc').textContent = '选定的 ' + sessionTotalCount + ' 条词汇已全部完成本轮记忆与循环巩固。';
  document.getElementById('progressBarFill').style.width = '100%';
  renderHeatmap();
  renderAchievements();
  updateLeechCountBadge();
}

// 渲染学习记录热力图
function renderHeatmap() {
  const history = loadHistoryStore();
  const sm2Store = loadSM2Store();
  const gridEl = document.getElementById('heatmapGrid');
  gridEl.innerHTML = '';
  const tooltipEl = document.getElementById('heatmapTooltip');

  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  document.getElementById('todayReviewCount').textContent = history[todayKey] || 0;

  let last30Count = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    last30Count += (history[k] || 0);
  }
  document.getElementById('periodTotalCount').textContent = last30Count;

  let masteredCount = 0;
  Object.values(sm2Store).forEach(c => {
    if (c.repetitions >= 2) masteredCount++;
  });
  document.getElementById('totalMasteredCount').textContent = masteredCount;

  const totalDays = 150;
  for (let i = totalDays - 1; i >= 0; i--) {
    const dateObj = new Date();
    dateObj.setDate(today.getDate() - i);
    const dateStr = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
    const count = history[dateStr] || 0;

    let heatLevel = 0;
    if (count > 0 && count <= 5) heatLevel = 1;
    else if (count > 5 && count <= 15) heatLevel = 2;
    else if (count > 15 && count <= 30) heatLevel = 3;
    else if (count > 30) heatLevel = 4;

    const cell = document.createElement('div');
    cell.className = 'heat-cell heat-' + heatLevel;
    cell.dataset.date = dateStr;
    cell.dataset.count = count;

    cell.addEventListener('mouseenter', function(e) {
      tooltipEl.textContent = dateStr + ' : ' + count + ' 次复习';
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = (e.pageX + 8) + 'px';
      tooltipEl.style.top = (e.pageY - 28) + 'px';
    });
    cell.addEventListener('mouseleave', function() {
      tooltipEl.style.display = 'none';
    });

    gridEl.appendChild(cell);
  }
}

// 渲染重点难词视图
function renderLeechView() {
  const leeches = getLeechCards();
  const tbody = document.getElementById('leechTableBody');
  const emptyBox = document.getElementById('leechEmptyBox');
  tbody.innerHTML = '';

  document.getElementById('leechCountOverview').textContent = leeches.length + ' 词需要加强巩固';

  if (leeches.length === 0) {
    emptyBox.style.display = 'block';
    return;
  }
  emptyBox.style.display = 'none';

  leeches.forEach((w, idx) => {
    const p = getCardProgress(w.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">${idx + 1}</td>
      <td style="font-weight: 600; color: var(--text);">${w.word}</td>
      <td style="color: var(--text-sub); font-size: 12px; font-family: var(--font-mono);">${w.phonetic || ''}</td>
      <td>
        <div style="font-weight: 500;">${w.meaning}</div>
        <div style="font-size: 11.5px; color: var(--tag-blue-color); margin-top: 3px;">${w.root || ''}</div>
      </td>
      <td style="font-family: var(--font-mono); font-weight: 600; color: var(--tag-red-color);">${p.lapses} 次</td>
      <td style="font-family: var(--font-mono); font-size: 11px;">${p.efactor}</td>
      <td>
        <button class="nav-btn" style="padding: 2px 6px; font-size: 11px;" data-reset-id="${w.id}">恢复重测</button>
      </td>
    `;
    tr.querySelector('[data-reset-id]').addEventListener('click', () => resetLeechCard(w.id));
    tbody.appendChild(tr);
  });
}

function resetLeechCard(cardId) {
  const store = loadSM2Store();
  if (store[cardId]) {
    store[cardId].lapses = 0;
    store[cardId].efactor = 2.5;
    store[cardId].repetitions = 0;
    store[cardId].isLeech = false;
    saveSM2Store(store);
    showToast('该词已重置初始复习参数');
    renderLeechView();
    updateLeechCountBadge();
  }
}

// 渲染学习记录目标列表
function renderAchievements() {
  const unlocked = loadAchievements();
  const gridEl = document.getElementById('achieveGrid');
  gridEl.innerHTML = '';

  let unlockedCount = 0;
  const totalCount = ACHIEVEMENT_DEFINITIONS.length;

  ACHIEVEMENT_DEFINITIONS.forEach(ach => {
    const isDone = !!unlocked[ach.id];
    if (isDone) unlockedCount++;

    const card = document.createElement('div');
    card.className = 'achieve-card ' + (isDone ? 'unlocked' : 'locked');
    card.innerHTML = `
      <div class="achieve-icon-box">
        <svg viewBox="0 0 24 24">${ach.icon}</svg>
      </div>
      <div class="achieve-body">
        <div class="achieve-title-row">
          <span class="achieve-name">${ach.name}</span>
          <span class="achieve-status-tag ${isDone ? 'done' : 'todo'}">${isDone ? '已达成' : '未达成'}</span>
        </div>
        <div class="achieve-desc">${ach.desc}</div>
        <div class="achieve-meta">${isDone ? '达成时间: ' + unlocked[ach.id].unlockedAt.slice(0, 10) : '达成条件尚未满足'}</div>
      </div>
    `;
    gridEl.appendChild(card);
  });

  const pct = Math.round((unlockedCount / totalCount) * 100);
  document.getElementById('achieveRatioText').textContent = unlockedCount + ' / ' + totalCount + ' (' + pct + '%)';
  document.getElementById('achieveProgressFill').style.width = pct + '%';
  document.getElementById('navAchieveBadge').textContent = unlockedCount + '/' + totalCount;
}

// 单元词组表格渲染
function renderPhrasesTable() {
  const query = (document.getElementById('searchPhrasesBox').value || '').trim().toLowerCase();
  const selectedUnit = document.getElementById('phraseUnitFilter').value;
  const tbody = document.getElementById('phrasesTableBody');
  tbody.innerHTML = '';

  const filtered = PHRASE_DATABASE.filter(p => {
    if (selectedUnit !== 'all' && String(p.unit) !== selectedUnit) return false;
    if (!query) return true;
    return p.phrase.toLowerCase().includes(query) ||
           p.meaning.includes(query) ||
           p.example.toLowerCase().includes(query) ||
           p.unitTitle.toLowerCase().includes(query);
  });

  filtered.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">${idx + 1}</td>
      <td style="font-weight: 600; color: var(--text);">${p.phrase}</td>
      <td style="font-weight: 500; color: var(--text);">${p.meaning}</td>
      <td style="font-size: 12.5px; color: var(--text-sub); line-height: 1.45;">${p.example}</td>
      <td style="font-size: 11px; color: var(--text-sub);"><span class="unit-chip" style="padding: 1px 5px; font-size: 10.5px;">Unit ${p.unit}</span></td>
      <td>
        <button class="nav-btn" style="padding: 2px 6px; font-size: 11px;" data-speak="${p.phrase}">发音</button>
      </td>
    `;
    tr.querySelector('[data-speak]').addEventListener('click', () => playPronunciation(p.phrase));
    tbody.appendChild(tr);
  });
}

// 词库清单渲染
function renderVocabTable() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const tbody = document.getElementById('vocabTableBody');
  tbody.innerHTML = '';

  const filtered = VOCAB_DATABASE.filter(w => {
    if (!query) return true;
    return w.word.toLowerCase().includes(query) ||
           w.meaning.includes(query) ||
           w.phrase.toLowerCase().includes(query) ||
           w.unitTitle.toLowerCase().includes(query);
  });

  filtered.forEach((w, idx) => {
    const tr = document.createElement('tr');
    const p = getCardProgress(w.id);
    const isLeech = p.lapses >= LEECH_THRESHOLD || p.isLeech;
    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">${idx + 1}</td>
      <td style="font-weight: 600; color: var(--text);">${w.word} ${isLeech ? '<span class="card-leech-label active" style="font-size:9.5px; padding:0 3px;">难词</span>' : ''}</td>
      <td style="color: var(--text-sub); font-size: 12px; font-family: var(--font-mono);">${w.phonetic || ''}</td>
      <td style="font-style: italic; color: var(--text-muted); font-size: 12px;">${w.pos || ''}</td>
      <td>
        <div style="font-weight: 500;">${w.meaning}</div>
        <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">${w.phrase || ''}</div>
        <div style="font-size: 11px; color: var(--tag-blue-color); margin-top: 2px;">${w.root || ''}</div>
      </td>
      <td style="font-size: 11px; color: var(--text-sub);"><span class="unit-chip" style="padding: 1px 5px; font-size: 10.5px;">${w.unitTitle.split(' ')[0]} ${w.unitTitle.split(' ')[1]}</span></td>
      <td><span class="sm2-badge">复习:${p.repetitions} · 遗忘:${p.lapses || 0}</span></td>
      <td>
        <button class="nav-btn" style="padding: 2px 6px; font-size: 11px;" data-speak="${w.word}">发音</button>
      </td>
    `;
    tr.querySelector('[data-speak]').addEventListener('click', () => playPronunciation(w.word));
    tbody.appendChild(tr);
  });
}

// 主题切换
function initTheme() {
  const saved = localStorage.getItem('theme_pref');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

// 事件绑定
function initEventListeners() {
  document.getElementById('selectAllUnitsBtn').addEventListener('click', function() {
    currentSettings.selectedUnits = [1, 2, 3, 4, 5, 6, 7, 8];
    document.querySelectorAll('.unit-chip[data-unit]').forEach(c => c.classList.add('selected'));
    saveSettings(currentSettings);
    startNewSession();
  });

  document.getElementById('clearUnitsBtn').addEventListener('click', function() {
    currentSettings.selectedUnits = [1];
    document.querySelectorAll('.unit-chip[data-unit]').forEach(c => {
      if (c.dataset.unit === '1') c.classList.add('selected');
      else c.classList.remove('selected');
    });
    saveSettings(currentSettings);
    startNewSession();
  });

  const modeSelectEl = document.getElementById('modeSelect');
  modeSelectEl.value = currentSettings.mode || 'unit';
  modeSelectEl.addEventListener('change', function() {
    currentSettings.mode = this.value;
    saveSettings(currentSettings);
    startNewSession();
  });

  const voiceAccentSelectEl = document.getElementById('voiceAccentSelect');
  voiceAccentSelectEl.value = currentSettings.voiceAccent || '2';
  voiceAccentSelectEl.addEventListener('change', function() {
    currentSettings.voiceAccent = this.value;
    saveSettings(currentSettings);
  });

  const autoPronounceToggleEl = document.getElementById('autoPronounceToggle');
  autoPronounceToggleEl.checked = currentSettings.autoPronounce !== false;
  autoPronounceToggleEl.addEventListener('change', function() {
    currentSettings.autoPronounce = this.checked;
    saveSettings(currentSettings);
  });

  document.getElementById('themeToggleBtn').addEventListener('click', function() {
    const curr = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = curr === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme_pref', next);
  });

  document.getElementById('flashcard').addEventListener('click', function(e) {
    if (e.target.closest('#pronounceBtn')) return;
    revealCard();
  });

  document.getElementById('pronounceBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    if (currentCard) playPronunciation(currentCard.word);
  });

  document.getElementById('btnAgain').addEventListener('click', () => handleRating(1));
  document.getElementById('btnHard').addEventListener('click', () => handleRating(3));
  document.getElementById('btnGood').addEventListener('click', () => handleRating(4));
  document.getElementById('btnEasy').addEventListener('click', () => handleRating(5));

  document.getElementById('nextBatchBtn').addEventListener('click', startNewSession);
  document.getElementById('resetCurrentBatchBtn').addEventListener('click', startNewSession);
  document.getElementById('restartSessionBtn').addEventListener('click', startNewSession);

  document.getElementById('startLeechSessionBtn').addEventListener('click', function() {
    currentSettings.mode = 'leech';
    modeSelectEl.value = 'leech';
    saveSettings(currentSettings);
    document.getElementById('tabReciteBtn').click();
    startNewSession();
  });

  // 快捷键支持
  window.addEventListener('keydown', function(e) {
    if (document.getElementById('reciteView').style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (!isRevealed) revealCard();
    } else if (isRevealed && !isStayLocked && (e.key === '1' || e.code === 'Digit1')) {
      e.preventDefault();
      handleRating(1);
    } else if (isRevealed && !isStayLocked && (e.key === '2' || e.code === 'Digit2')) {
      e.preventDefault();
      handleRating(3);
    } else if (isRevealed && !isStayLocked && (e.key === '3' || e.code === 'Digit3')) {
      e.preventDefault();
      handleRating(4);
    } else if (isRevealed && !isStayLocked && (e.key === '4' || e.code === 'Digit4')) {
      e.preventDefault();
      handleRating(5);
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (currentCard) playPronunciation(currentCard.word);
    }
  });

  // 标签页切换
  const tabReciteBtn = document.getElementById('tabReciteBtn');
  const tabLeechBtn = document.getElementById('tabLeechBtn');
  const tabAchievementsBtn = document.getElementById('tabAchievementsBtn');
  const tabPhrasesBtn = document.getElementById('tabPhrasesBtn');
  const tabListBtn = document.getElementById('tabListBtn');

  const reciteView = document.getElementById('reciteView');
  const leechView = document.getElementById('leechView');
  const achievementsView = document.getElementById('achievementsView');
  const phrasesView = document.getElementById('phrasesView');
  const listView = document.getElementById('listView');
  const controlPanel = document.getElementById('controlPanel');
  const heatmapSection = document.getElementById('heatmapSection');

  function hideAllTabs() {
    [tabReciteBtn, tabLeechBtn, tabAchievementsBtn, tabPhrasesBtn, tabListBtn].forEach(b => b.classList.remove('active'));
    [reciteView, leechView, achievementsView, phrasesView, listView, controlPanel, heatmapSection].forEach(v => v.style.display = 'none');
  }

  tabPhrasesBtn.addEventListener('click', function() {
    hideAllTabs();
    tabPhrasesBtn.classList.add('active');
    phrasesView.style.display = 'block';
    renderPhrasesTable();
  });

  tabReciteBtn.addEventListener('click', function() {
    hideAllTabs();
    tabReciteBtn.classList.add('active');
    reciteView.style.display = 'block';
    controlPanel.style.display = 'block';
    heatmapSection.style.display = 'block';
    renderHeatmap();
    updateLeechCountBadge();
  });

  tabLeechBtn.addEventListener('click', function() {
    hideAllTabs();
    tabLeechBtn.classList.add('active');
    leechView.style.display = 'flex';
    renderLeechView();
  });

  tabAchievementsBtn.addEventListener('click', function() {
    hideAllTabs();
    tabAchievementsBtn.classList.add('active');
    achievementsView.style.display = 'flex';
    renderAchievements();
  });

  tabListBtn.addEventListener('click', function() {
    hideAllTabs();
    tabListBtn.classList.add('active');
    listView.style.display = 'block';
    renderVocabTable();
  });

  document.getElementById('searchPhrasesBox').addEventListener('input', renderPhrasesTable);
  document.getElementById('phraseUnitFilter').addEventListener('change', renderPhrasesTable);
  document.getElementById('searchBox').addEventListener('input', renderVocabTable);
}

// 启动应用
document.addEventListener('DOMContentLoaded', initData);
