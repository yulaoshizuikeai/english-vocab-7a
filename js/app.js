/**
 * 主控制器模块 V3.0
 * 负责全学段数据加载、多册切换、双层分类筛选、状态机流转、视图切换、DOM 交互与 2 秒停留控制
 */

import { calculateSM2, predictIntervals, LEECH_THRESHOLD } from './sm2.js';
import {
  initStorageEngine,
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
import {
  downloadFile,
  exportBackupJSON,
  importBackupJSON,
  buildAIDiagnosticPrompt
} from './export.js';

// 册别基础配置
const BOOKS_CONFIG = [
  { id: '7a', title: '七年级上册 (7A)', shortTitle: '7A 七上', units: 8 },
  { id: '7b', title: '七年级下册 (7B)', shortTitle: '7B 七下', units: 8 },
  { id: '8a', title: '八年级上册 (8A)', shortTitle: '8A 八上', units: 8 },
  { id: '8b', title: '八年级下册 (8B)', shortTitle: '8B 八下', units: 8 },
  { id: '9',  title: '九年级全册 (9A/9B)', shortTitle: '9年级全册', units: 6 }
];

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

// 数据存储与内存缓存
let VOCAB_DATABASE = [];
let PHRASE_DATABASE = [];
let GRAMMAR_APPENDIX = null;
const BOOK_CACHE = {
  vocab: {},
  phrases: {}
};

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

function getActiveBookConfig() {
  const bId = currentSettings.activeBook || '7a';
  return BOOKS_CONFIG.find(b => b.id === bId) || BOOKS_CONFIG[0];
}

// 加载指定册别的数据
async function loadBookData(bookId) {
  if (BOOK_CACHE.vocab[bookId] && BOOK_CACHE.phrases[bookId]) {
    VOCAB_DATABASE = BOOK_CACHE.vocab[bookId];
    PHRASE_DATABASE = BOOK_CACHE.phrases[bookId];
    return;
  }

  const [vocabRes, phrasesRes] = await Promise.all([
    fetch(`data/vocab-${bookId}.json`),
    fetch(`data/phrases-${bookId}.json`)
  ]);

  VOCAB_DATABASE = await vocabRes.json();
  PHRASE_DATABASE = await phrasesRes.json();

  BOOK_CACHE.vocab[bookId] = VOCAB_DATABASE;
  BOOK_CACHE.phrases[bookId] = PHRASE_DATABASE;
}

// 切换册别
async function switchBook(bookId) {
  try {
    currentSettings.activeBook = bookId;
    const cfg = getActiveBookConfig();

    // 纠正当前选中单元 (确保在 1..cfg.units 范围内)
    currentSettings.selectedUnits = currentSettings.selectedUnits
      .filter(u => u >= 1 && u <= cfg.units);
    if (currentSettings.selectedUnits.length === 0) {
      currentSettings.selectedUnits = [1];
    }
    saveSettings(currentSettings);

    await loadBookData(bookId);

    // 更新界面状态
    renderBookSelector();
    initUnitSelector();
    updateHeaderCounters();
    updatePhraseFilterDropdown();

    // 重新开启会话
    startNewSession();
  } catch (err) {
    console.error('切换册别失败:', err);
    showToast('加载册别数据失败，请重试');
  }
}

function updateHeaderCounters() {
  const totalVocabEl = document.getElementById('totalVocabCountText');
  if (totalVocabEl) totalVocabEl.textContent = VOCAB_DATABASE.length;

  const totalPhrasesEl = document.getElementById('totalPhrasesCountText');
  if (totalPhrasesEl) totalPhrasesEl.textContent = PHRASE_DATABASE.length;

  const capEl = document.getElementById('totalMasteredCap');
  if (capEl) capEl.textContent = VOCAB_DATABASE.length;
}

// 加载外部数据入口
async function initData() {
  try {
    await initStorageEngine();
    currentSettings = loadSettings();

    // 确保 activeBook 有效
    if (!BOOKS_CONFIG.some(b => b.id === currentSettings.activeBook)) {
      currentSettings.activeBook = '7a';
    }

    await loadBookData(currentSettings.activeBook);

    updateHeaderCounters();
    renderBookSelector();
    renderCategorySelector();
    initUnitSelector();
    initEventListeners();
    initTheme();

    // 预载附录数据
    fetch('data/grammar-appendix.json')
      .then(res => res.json())
      .then(data => { GRAMMAR_APPENDIX = data; })
      .catch(e => console.warn('附录数据预载失败:', e));

    // 首屏默认背诵视图
    document.getElementById('tabReciteBtn').click();
    startNewSession();
  } catch (err) {
    console.error('Failed to load dataset:', err);
    showToast('数据文件加载失败，请检查网络或刷新页面');
  }
}

// 渲染册别选择器
function renderBookSelector() {
  const container = document.getElementById('bookSelector');
  if (!container) return;
  container.innerHTML = '';

  BOOKS_CONFIG.forEach(b => {
    const chip = document.createElement('div');
    const isSel = (currentSettings.activeBook || '7a') === b.id;
    chip.className = 'unit-chip chip-book' + (isSel ? ' selected' : '');
    chip.textContent = b.shortTitle;
    chip.dataset.book = b.id;
    chip.addEventListener('click', () => {
      if (currentSettings.activeBook !== b.id) {
        switchBook(b.id);
      }
    });
    container.appendChild(chip);
  });
}

// 渲染分层筛选器 (全部 / 课内核心 / 课外拓展)
function renderCategorySelector() {
  const container = document.getElementById('categorySelector');
  if (!container) return;
  const chips = container.querySelectorAll('.chip-category');
  chips.forEach(chip => {
    const cat = chip.dataset.cat;
    if (cat === (currentSettings.categoryFilter || 'all')) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
    chip.onclick = () => {
      chips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      currentSettings.categoryFilter = cat;
      saveSettings(currentSettings);
      startNewSession();
    };
  });
}

// 初始化单元选择器 (自适应当前册别 1..N)
function initUnitSelector() {
  const unitSelectorEl = document.getElementById('unitSelector');
  if (!unitSelectorEl) return;
  unitSelectorEl.innerHTML = '';
  const cfg = getActiveBookConfig();

  for (let u = 1; u <= cfg.units; u++) {
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

function updatePhraseFilterDropdown() {
  const sel = document.getElementById('phraseUnitFilter');
  if (!sel) return;
  const cfg = getActiveBookConfig();
  sel.innerHTML = '<option value="all">全部单元</option>';
  for (let u = 1; u <= cfg.units; u++) {
    const opt = document.createElement('option');
    opt.value = String(u);
    opt.textContent = `Unit ${u}`;
    sel.appendChild(opt);
  }
}

// 统计重点难词
function getLeechCards() {
  const store = loadSM2Store();
  return VOCAB_DATABASE.filter(w => {
    const p = store[w.id] || store[w.canonicalId] || store[w.legacyId];
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

  const cfg = getActiveBookConfig();
  let hasFullUnitMastered = false;
  for (let u = 1; u <= cfg.units; u++) {
    const unitWords = VOCAB_DATABASE.filter(w => w.unit === u);
    if (unitWords.length === 0) continue;
    const allDone = unitWords.every(w => {
      const p = store[w.id] || store[w.canonicalId];
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
  const mode = currentSettings.mode || 'unit';
  const catFilter = currentSettings.categoryFilter || 'all';
  let candidates = [];

  if (mode === 'phrases') {
    candidates = PHRASE_DATABASE.filter(p => currentSettings.selectedUnits.includes(p.unit)).map(p => ({
      id: p.id,
      canonicalId: p.id,
      unit: p.unit,
      unitTitle: p.unitTitle,
      word: p.phrase,
      phonetic: '',
      pos: 'phrase',
      meaning: p.meaning,
      phrase: p.example,
      root: '课文核心短语搭配',
      category: 'core',
      book: currentSettings.activeBook || '7a'
    }));
  } else if (mode === 'leech') {
    candidates = getLeechCards();
  } else {
    // 基础过滤：单元 + 分类 (core vs expansion)
    let filteredVocab = VOCAB_DATABASE.filter(w => currentSettings.selectedUnits.includes(w.unit));
    if (catFilter !== 'all') {
      filteredVocab = filteredVocab.filter(w => (w.category || 'core') === catFilter);
    }

    if (mode === 'due') {
      const now = Date.now();
      candidates = filteredVocab.filter(w => {
        const p = getCardProgress(w.id);
        return p && p.dueDate && p.dueDate <= now;
      });
    } else if (mode === 'batch10' || mode === 'batch15' || mode === 'batch20') {
      const limit = mode === 'batch10' ? 10 : (mode === 'batch15' ? 15 : 20);
      const unmastered = filteredVocab.filter(w => {
        const p = getCardProgress(w.id);
        return !p || p.repetitions < 2;
      });
      candidates = unmastered.slice(0, limit);
      if (candidates.length === 0) {
        candidates = filteredVocab.slice(0, limit);
      }
    } else {
      // 默认单元全量模式
      candidates = filteredVocab;
    }
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
  const trackEl = document.getElementById('stayProgressTrack');
  const fillEl = document.getElementById('stayProgressFill');
  if (trackEl) trackEl.classList.remove('active');
  if (fillEl) fillEl.style.width = '100%';
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

  const bCfg = getActiveBookConfig();
  const bookTag = bCfg.shortTitle.split(' ')[0];
  document.getElementById('cardUnitTag').textContent = `${bookTag} · ${currentCard.unitTitle || 'Unit ' + currentCard.unit}`;

  // 课内核心 vs 课外拓展徽章
  const catBadgeEl = document.getElementById('cardCategoryTag');
  if (catBadgeEl) {
    const isExp = currentCard.category === 'expansion';
    catBadgeEl.textContent = isExp ? '课外拓展' : '课内核心';
    catBadgeEl.className = 'card-category-label ' + (isExp ? 'expansion' : 'core');
  }

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
  document.getElementById('rootText').textContent = currentCard.root || (currentCard.category === 'expansion' ? '课外高分拓展词（阅读与写作升级）' : '考纲核心词汇，结合搭配短语加深理解');

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

  const p = getCardProgress(currentCard.id);
  const isMasteredCard = p.repetitions >= 2 && p.efactor >= 2.4 && (p.lapses || 0) === 0;

  if (isMasteredCard) {
    isStayLocked = false;
    setRatingButtonsDisabled(false);
    return;
  }

  // 翻卡 2 秒平滑状态条
  isStayLocked = true;
  setRatingButtonsDisabled(true);

  const trackEl = document.getElementById('stayProgressTrack');
  const fillEl = document.getElementById('stayProgressFill');
  if (trackEl && fillEl) {
    trackEl.classList.add('active');
    fillEl.style.width = '100%';
  }

  const totalDuration = 2000;
  const intervalStep = 50;
  let elapsed = 0;

  stayTimerInterval = setInterval(() => {
    elapsed += intervalStep;
    const remainingRatio = Math.max(0, 1 - (elapsed / totalDuration));
    if (fillEl) {
      fillEl.style.width = (remainingRatio * 100) + '%';
    }

    if (elapsed >= totalDuration) {
      clearInterval(stayTimerInterval);
      stayTimerInterval = null;
      isStayLocked = false;
      setRatingButtonsDisabled(false);
      if (trackEl) trackEl.classList.remove('active');
    }
  }, intervalStep);
}

function handleRating(quality) {
  if (!currentCard || !isRevealed || isStayLocked) return;

  const currentP = getCardProgress(currentCard.id);
  const updated = calculateSM2(currentP, quality);
  const store = loadSM2Store();

  // 双写：主 ID + 规范 canonicalId + legacyId，确保零丢失
  store[currentCard.id] = updated;
  if (currentCard.canonicalId && currentCard.canonicalId !== currentCard.id) {
    store[currentCard.canonicalId] = { ...updated, id: currentCard.canonicalId };
  }
  if (currentCard.legacyId && currentCard.legacyId !== currentCard.id) {
    store[currentCard.legacyId] = { ...updated, id: currentCard.legacyId };
  }

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

  // 统计当前册掌握数量
  let masteredCount = 0;
  VOCAB_DATABASE.forEach(w => {
    const p = getCardProgress(w.id);
    if (p && p.repetitions >= 2) masteredCount++;
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
  const p = getCardProgress(cardId);
  p.lapses = 0;
  p.efactor = 2.5;
  p.repetitions = 0;
  p.isLeech = false;
  store[cardId] = p;
  saveSM2Store(store);
  showToast('该词已重置初始复习参数');
  renderLeechView();
  updateLeechCountBadge();
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

// Anki 风格统计分析渲染逻辑
function renderStatistics() {
  const history = loadHistoryStore();
  const allCards = [...VOCAB_DATABASE, ...PHRASE_DATABASE];
  const totalCards = allCards.length;

  let matureCount = 0;
  let youngCount = 0;
  let learningCount = 0;
  let newCount = 0;

  let efSum = 0;
  let reviewedCardsCount = 0;
  let totalReviewsAccum = 0;
  let totalIntervalSum = 0;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dueBins = new Array(14).fill(0);

  const intervalBins = [
    { label: '1天', min: 1, max: 1, count: 0 },
    { label: '2-3天', min: 2, max: 3, count: 0 },
    { label: '4-7天', min: 4, max: 7, count: 0 },
    { label: '8-14天', min: 8, max: 14, count: 0 },
    { label: '15-30天', min: 15, max: 30, count: 0 },
    { label: '1-3月', min: 31, max: 90, count: 0 },
    { label: '3月+', min: 91, max: Infinity, count: 0 }
  ];

  const easeBins = [
    { label: '≤1.5', min: 1.0, max: 1.55, count: 0 },
    { label: '1.6-1.8', min: 1.55, max: 1.85, count: 0 },
    { label: '1.9-2.1', min: 1.85, max: 2.15, count: 0 },
    { label: '2.2-2.4', min: 2.15, max: 2.45, count: 0 },
    { label: '2.5(基准)', min: 2.45, max: 2.55, count: 0 },
    { label: '2.6-2.8', min: 2.55, max: 2.85, count: 0 },
    { label: '2.9-3.0', min: 2.85, max: 3.05, count: 0 }
  ];

  let totalLapsesAccum = 0;
  let overdueCardsCount = 0;
  let leechCardsCount = 0;

  allCards.forEach(c => {
    const p = getCardProgress(c.id);
    if (!p || (p.totalReviews === 0 && p.repetitions === 0)) {
      newCount++;
      return;
    }

    reviewedCardsCount++;
    totalReviewsAccum += (p.totalReviews || 0);
    totalLapsesAccum += (p.lapses || 0);
    efSum += (p.efactor || 2.5);
    totalIntervalSum += (p.interval || 0);

    if (p.lapses >= LEECH_THRESHOLD || p.isLeech) {
      leechCardsCount++;
    }

    if (p.interval >= 21) {
      matureCount++;
    } else if (p.repetitions >= 1) {
      youngCount++;
    } else {
      learningCount++;
    }

    if (p.dueDate) {
      const diffDays = Math.floor((p.dueDate - now) / DAY_MS);
      if (diffDays < 0) {
        overdueCardsCount++;
        dueBins[0]++;
      } else if (diffDays === 0) {
        dueBins[0]++;
      } else if (diffDays < 14) {
        dueBins[diffDays]++;
      }
    }

    if (p.interval > 0) {
      for (const b of intervalBins) {
        if (p.interval >= b.min && p.interval <= b.max) {
          b.count++;
          break;
        }
      }
    }

    const ef = p.efactor || 2.5;
    for (const eb of easeBins) {
      if (ef >= eb.min && ef < eb.max) {
        eb.count++;
        break;
      }
    }
  });

  // AI 看板
  const lapseRateVal = totalReviewsAccum > 0 ? ((totalLapsesAccum / totalReviewsAccum) * 100) : 0;
  const retentionRateVal = totalReviewsAccum > 0 ? (100 - lapseRateVal) : 100;
  const lapseRateStr = lapseRateVal.toFixed(1) + '%';
  const retentionRateStr = retentionRateVal.toFixed(1) + '%';

  const aiRetentionEl = document.getElementById('aiRetentionRate');
  if (aiRetentionEl) aiRetentionEl.textContent = retentionRateStr;
  const aiRetentionHintEl = document.getElementById('aiRetentionHint');
  if (aiRetentionHintEl) {
    aiRetentionHintEl.textContent = retentionRateVal >= 88 ? '记忆留存良好 (高于88%优良线)' : (retentionRateVal >= 75 ? '留存平稳 (可适当强化生词)' : '衰减偏快 (需增加复习频次)');
  }

  const aiLapseEl = document.getElementById('aiLapseRate');
  if (aiLapseEl) aiLapseEl.textContent = lapseRateStr;
  const aiLapseHintEl = document.getElementById('aiLapseHint');
  if (aiLapseHintEl) {
    aiLapseHintEl.textContent = `累计遗忘 ${totalLapsesAccum} 次 (总评 ${totalReviewsAccum} 次)`;
  }

  const aiBacklogEl = document.getElementById('aiBacklogCount');
  if (aiBacklogEl) aiBacklogEl.textContent = `${overdueCardsCount + dueBins[0]} 词`;
  const aiBacklogHintEl = document.getElementById('aiBacklogHint');
  if (aiBacklogHintEl) {
    aiBacklogHintEl.textContent = `逾期 ${overdueCardsCount} 词 · 今日到期 ${dueBins[0]} 词`;
  }

  const aiLeechEl = document.getElementById('aiLeechCount');
  if (aiLeechEl) aiLeechEl.textContent = `${leechCardsCount} 词`;
  const aiLeechHintEl = document.getElementById('aiLeechHint');
  if (aiLeechHintEl) {
    aiLeechHintEl.textContent = leechCardsCount > 0 ? '遗忘≥4次，建议重点攻坚' : '暂无高频难词阻滞';
  }

  const adviceEl = document.getElementById('aiStudyAdviceText');
  if (adviceEl) {
    if (totalReviewsAccum === 0) {
      adviceEl.textContent = '当前尚未开始词汇自测。建议从 Unit 1 开始，每天学习 15~20 词，配合发音与词根拆解建立首轮记忆痕迹。';
    } else if (overdueCardsCount > 10) {
      adviceEl.textContent = `目前有 ${overdueCardsCount} 个词汇已过最佳记忆临界点。建议今日优先完成“到期复习”模式，及时修补衰减痕迹，暂缓开辟新单元。`;
    } else if (leechCardsCount >= 3) {
      adviceEl.textContent = `检测到 ${leechCardsCount} 个难记词汇连续受阻。建议切换至“重点难词”面板，结合考点例句与形态拆解专项攻克。`;
    } else if (lapseRateVal > 15) {
      adviceEl.textContent = `单次遗忘率（${lapseRateStr}）稍高于标准线。建议在背诵时利用翻卡两秒停留时间，大声朗读例句并联想场景，加深语境绑定。`;
    } else {
      adviceEl.textContent = `各项记忆指标处于健康区间（留存率 ${retentionRateStr}，EF基准稳定）。可按计划每日推进 1 个批次新词，并消化到期卡片。`;
    }
  }

  // 指标卡片
  document.getElementById('statTotalCards').textContent = totalCards;
  document.getElementById('statTotalCardsSub').textContent = `单词 ${VOCAB_DATABASE.length} · 词组 ${PHRASE_DATABASE.length}`;

  document.getElementById('statMatureCards').textContent = matureCount;
  const matureRatio = totalCards > 0 ? Math.round((matureCount / totalCards) * 100) : 0;
  document.getElementById('statMatureRatio').textContent = `占比 ${matureRatio}%`;

  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  document.getElementById('statTodayReviews').textContent = history[todayKey] || 0;

  let currentStreak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if ((history[k] || 0) > 0) currentStreak++;
    else break;
  }
  document.getElementById('statStreakDays').textContent = `连续 ${currentStreak} 天复习`;

  const avgEf = reviewedCardsCount > 0 ? (efSum / reviewedCardsCount).toFixed(2) : '2.50';
  document.getElementById('statAverageEf').textContent = avgEf;
  document.getElementById('statTotalReviews').textContent = `累计评定 ${totalReviewsAccum} 次`;

  // 状态堆叠条
  const pctMature = totalCards > 0 ? (matureCount / totalCards) * 100 : 0;
  const pctYoung = totalCards > 0 ? (youngCount / totalCards) * 100 : 0;
  const pctLearning = totalCards > 0 ? (learningCount / totalCards) * 100 : 0;
  const pctNew = totalCards > 0 ? (newCount / totalCards) * 100 : 0;

  document.getElementById('segMature').style.width = pctMature + '%';
  document.getElementById('segYoung').style.width = pctYoung + '%';
  document.getElementById('segLearning').style.width = pctLearning + '%';
  document.getElementById('segNew').style.width = pctNew + '%';

  document.getElementById('countMature').textContent = `${matureCount} (${Math.round(pctMature)}%)`;
  document.getElementById('countYoung').textContent = `${youngCount} (${Math.round(pctYoung)}%)`;
  document.getElementById('countLearning').textContent = `${learningCount} (${Math.round(pctLearning)}%)`;
  document.getElementById('countNew').textContent = `${newCount} (${Math.round(pctNew)}%)`;

  // 未来到期柱状图
  const chartDueEl = document.getElementById('chartFutureDue');
  chartDueEl.innerHTML = '';
  const maxDue = Math.max(...dueBins, 1);
  document.getElementById('dueTodaySummary').textContent = `今日及逾期待复习: ${dueBins[0]}`;

  dueBins.forEach((cnt, idx) => {
    const col = document.createElement('div');
    col.className = 'chart-col';
    const heightPct = cnt > 0 ? Math.max(8, Math.round((cnt / maxDue) * 100)) : 0;
    const label = idx === 0 ? '今日' : `+${idx}天`;
    col.innerHTML = `
      <div class="chart-col-val">${cnt > 0 ? cnt : ''}</div>
      <div class="chart-col-bar ${cnt === 0 ? 'zero' : ''}" style="height: ${heightPct}%;" title="${label}: ${cnt} 张卡片"></div>
      <div class="chart-col-label">${label}</div>
    `;
    chartDueEl.appendChild(col);
  });

  // 复习间隔柱状图
  const chartIntEl = document.getElementById('chartIntervals');
  chartIntEl.innerHTML = '';
  const avgInterval = reviewedCardsCount > 0 ? (totalIntervalSum / reviewedCardsCount).toFixed(1) : '0';
  document.getElementById('intervalSummary').textContent = `平均记忆间隔: ${avgInterval} 天`;
  const maxInt = Math.max(...intervalBins.map(b => b.count), 1);

  intervalBins.forEach(b => {
    const col = document.createElement('div');
    col.className = 'chart-col';
    const heightPct = b.count > 0 ? Math.max(8, Math.round((b.count / maxInt) * 100)) : 0;
    col.innerHTML = `
      <div class="chart-col-val">${b.count > 0 ? b.count : ''}</div>
      <div class="chart-col-bar ${b.count === 0 ? 'zero' : ''}" style="height: ${heightPct}%;" title="${b.label}: ${b.count} 张卡片"></div>
      <div class="chart-col-label">${b.label}</div>
    `;
    chartIntEl.appendChild(col);
  });

  // 简易度柱状图
  const chartEaseEl = document.getElementById('chartEase');
  chartEaseEl.innerHTML = '';
  const maxEase = Math.max(...easeBins.map(b => b.count), 1);

  easeBins.forEach(b => {
    const col = document.createElement('div');
    col.className = 'chart-col';
    const heightPct = b.count > 0 ? Math.max(8, Math.round((b.count / maxEase) * 100)) : 0;
    col.innerHTML = `
      <div class="chart-col-val">${b.count > 0 ? b.count : ''}</div>
      <div class="chart-col-bar ${b.count === 0 ? 'zero' : ''}" style="height: ${heightPct}%;" title="EF ${b.label}: ${b.count} 张卡片"></div>
      <div class="chart-col-label">${b.label}</div>
    `;
    chartEaseEl.appendChild(col);
  });

  // 单元考纲掌握度矩阵 (动态匹配当前册单元数)
  const unitListEl = document.getElementById('statsUnitList');
  unitListEl.innerHTML = '';
  const cfg = getActiveBookConfig();

  for (let u = 1; u <= cfg.units; u++) {
    const unitVocab = VOCAB_DATABASE.filter(w => w.unit === u);
    const unitPhrases = PHRASE_DATABASE.filter(p => p.unit === u);
    const unitAll = [...unitVocab, ...unitPhrases];
    const totalU = unitAll.length;

    let masteredU = 0;
    unitAll.forEach(item => {
      const p = getCardProgress(item.id);
      if (p && p.repetitions >= 2 && p.efactor >= 2.2) {
        masteredU++;
      }
    });

    const pct = totalU > 0 ? Math.round((masteredU / totalU) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'unit-mastery-row';
    const title = unitVocab[0] ? unitVocab[0].unitTitle : `Unit ${u}`;
    row.innerHTML = `
      <div class="unit-mastery-header">
        <span>${title}</span>
        <span style="font-family: var(--font-mono); font-size: 11px;">已掌握 ${masteredU} / ${totalU} (${pct}%)</span>
      </div>
      <div class="unit-mastery-track">
        <div class="unit-mastery-fill" style="width: ${pct}%;"></div>
      </div>
    `;
    unitListEl.appendChild(row);
  }
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
           (p.example && p.example.toLowerCase().includes(query)) ||
           (p.unitTitle && p.unitTitle.toLowerCase().includes(query));
  });

  filtered.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">${idx + 1}</td>
      <td style="font-weight: 600; color: var(--text);">${p.phrase}</td>
      <td style="font-weight: 500; color: var(--text);">${p.meaning}</td>
      <td style="font-size: 12.5px; color: var(--text-sub); line-height: 1.45;">${p.example || ''}</td>
      <td style="font-size: 11px; color: var(--text-sub);"><span class="unit-chip" style="padding: 1px 5px; font-size: 10.5px;">Unit ${p.unit}</span></td>
      <td>
        <button class="nav-btn" style="padding: 2px 6px; font-size: 11px;" data-speak="${p.phrase}">发音</button>
      </td>
    `;
    tr.querySelector('[data-speak]').addEventListener('click', () => playPronunciation(p.phrase));
    tbody.appendChild(tr);
  });
}

// 词库清单渲染 (支持跨册选择与核心/拓展分类)
async function renderVocabTable() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  const bookSel = document.getElementById('listBookFilter').value;
  const catSel = document.getElementById('listCategoryFilter').value;
  const tbody = document.getElementById('vocabTableBody');
  tbody.innerHTML = '';

  let dataset = VOCAB_DATABASE;
  if (bookSel !== 'current' && bookSel !== currentSettings.activeBook) {
    if (!BOOK_CACHE.vocab[bookSel]) {
      const res = await fetch(`data/vocab-${bookSel}.json`);
      BOOK_CACHE.vocab[bookSel] = await res.json();
    }
    dataset = BOOK_CACHE.vocab[bookSel];
  }

  const filtered = dataset.filter(w => {
    if (catSel !== 'all' && (w.category || 'core') !== catSel) return false;
    if (!query) return true;
    return w.word.toLowerCase().includes(query) ||
           w.meaning.includes(query) ||
           (w.phrase && w.phrase.toLowerCase().includes(query)) ||
           (w.unitTitle && w.unitTitle.toLowerCase().includes(query));
  });

  filtered.forEach((w, idx) => {
    const tr = document.createElement('tr');
    const p = getCardProgress(w.id);
    const isLeech = p.lapses >= LEECH_THRESHOLD || p.isLeech;
    const isExp = w.category === 'expansion';
    const catBadge = isExp ? '<span class="badge-exp">拓展</span>' : '<span class="badge-core">核心</span>';

    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">${idx + 1}</td>
      <td style="font-weight: 600; color: var(--text);">${w.word} ${isLeech ? '<span class="card-leech-label active" style="font-size:9.5px; padding:0 3px;">难词</span>' : ''}</td>
      <td style="color: var(--text-sub); font-size: 12px; font-family: var(--font-mono);">${w.phonetic || ''}</td>
      <td style="font-style: italic; color: var(--text-muted); font-size: 12px;">${w.pos || ''}</td>
      <td>${catBadge}</td>
      <td>
        <div style="font-weight: 500;">${w.meaning}</div>
        <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">${w.phrase || ''}</div>
        <div style="font-size: 11px; color: var(--tag-blue-color); margin-top: 2px;">${w.root || ''}</div>
      </td>
      <td style="font-size: 11px; color: var(--text-sub);"><span class="unit-chip" style="padding: 1px 5px; font-size: 10.5px;">Unit ${w.unit}</span></td>
      <td><span class="sm2-badge">复习:${p.repetitions} · 遗忘:${p.lapses || 0}</span></td>
      <td>
        <button class="nav-btn" style="padding: 2px 6px; font-size: 11px;" data-speak="${w.word}">发音</button>
      </td>
    `;
    tr.querySelector('[data-speak]').addEventListener('click', () => playPronunciation(w.word));
    tbody.appendChild(tr);
  });
}

// 简易轻量 Markdown 转 HTML 解析器 (用于附录呈现)
function parseMarkdownToHTML(md) {
  if (!md) return '<p>暂无内容</p>';
  let html = md
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

  // 表格处理
  const lines = html.split('\n');
  let inTable = false;
  const result = [];

  for (let l of lines) {
    const line = l.trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (line.includes('---')) continue; // 跳过分割线
      const cols = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        inTable = true;
        result.push('<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>');
      } else {
        result.push('<tr>' + cols.map(c => `<td>${c}</td>`).join('') + '</tr>');
      }
    } else {
      if (inTable) {
        inTable = false;
        result.push('</tbody></table>');
      }
      if (line.startsWith('- ')) {
        result.push(`<li>${line.substring(2)}</li>`);
      } else if (line.length > 0 && !line.startsWith('<h') && !line.startsWith('<block')) {
        result.push(`<p>${line}</p>`);
      } else {
        result.push(line);
      }
    }
  }
  if (inTable) result.push('</tbody></table>');
  return result.join('\n');
}

// 附录速查视图渲染
async function renderAppendixView(subTab = 'phrases') {
  if (!GRAMMAR_APPENDIX) {
    try {
      const res = await fetch('data/grammar-appendix.json');
      GRAMMAR_APPENDIX = await res.json();
    } catch (e) {
      document.getElementById('appendixContent').innerHTML = '<p>附录数据加载失败，请检查网络</p>';
      return;
    }
  }

  const contentEl = document.getElementById('appendixContent');
  if (subTab === 'phrases') {
    contentEl.innerHTML = parseMarkdownToHTML(GRAMMAR_APPENDIX.phrasesAll);
  } else if (subTab === 'verbs') {
    contentEl.innerHTML = parseMarkdownToHTML(GRAMMAR_APPENDIX.irregularVerbs);
  } else if (subTab === 'affixes') {
    contentEl.innerHTML = parseMarkdownToHTML(GRAMMAR_APPENDIX.affixes);
  }
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
    const cfg = getActiveBookConfig();
    currentSettings.selectedUnits = Array.from({ length: cfg.units }, (_, i) => i + 1);
    document.querySelectorAll('#unitSelector .unit-chip').forEach(c => c.classList.add('selected'));
    saveSettings(currentSettings);
    startNewSession();
  });

  document.getElementById('clearUnitsBtn').addEventListener('click', function() {
    currentSettings.selectedUnits = [1];
    document.querySelectorAll('#unitSelector .unit-chip').forEach(c => {
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

  // 顶部主导航标签页切换
  const tabReciteBtn = document.getElementById('tabReciteBtn');
  const tabLeechBtn = document.getElementById('tabLeechBtn');
  const tabStatsBtn = document.getElementById('tabStatsBtn');
  const tabAchievementsBtn = document.getElementById('tabAchievementsBtn');
  const tabPhrasesBtn = document.getElementById('tabPhrasesBtn');
  const tabListBtn = document.getElementById('tabListBtn');
  const tabAppendixBtn = document.getElementById('tabAppendixBtn');

  const reciteView = document.getElementById('reciteView');
  const leechView = document.getElementById('leechView');
  const statsView = document.getElementById('statsView');
  const achievementsView = document.getElementById('achievementsView');
  const phrasesView = document.getElementById('phrasesView');
  const listView = document.getElementById('listView');
  const appendixView = document.getElementById('appendixView');
  const controlPanel = document.getElementById('controlPanel');
  const heatmapSection = document.getElementById('heatmapSection');

  function hideAllTabs() {
    [tabReciteBtn, tabLeechBtn, tabStatsBtn, tabAchievementsBtn, tabPhrasesBtn, tabListBtn, tabAppendixBtn].forEach(b => {
      if (b) b.classList.remove('active');
    });
    [reciteView, leechView, statsView, achievementsView, phrasesView, listView, appendixView, controlPanel, heatmapSection].forEach(v => {
      if (v) v.style.display = 'none';
    });
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

  tabStatsBtn.addEventListener('click', function() {
    hideAllTabs();
    tabStatsBtn.classList.add('active');
    statsView.style.display = 'flex';
    renderStatistics();
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

  if (tabAppendixBtn) {
    tabAppendixBtn.addEventListener('click', function() {
      hideAllTabs();
      tabAppendixBtn.classList.add('active');
      appendixView.style.display = 'flex';
      renderAppendixView('phrases');
    });
  }

  // 附录子标签切换
  const appendixTabPhrases = document.getElementById('appendixTabPhrases');
  const appendixTabVerbs = document.getElementById('appendixTabVerbs');
  const appendixTabAffixes = document.getElementById('appendixTabAffixes');
  const appendixTabs = [appendixTabPhrases, appendixTabVerbs, appendixTabAffixes];

  if (appendixTabPhrases && appendixTabVerbs && appendixTabAffixes) {
    appendixTabPhrases.addEventListener('click', () => {
      appendixTabs.forEach(t => t.classList.remove('selected'));
      appendixTabPhrases.classList.add('selected');
      renderAppendixView('phrases');
    });
    appendixTabVerbs.addEventListener('click', () => {
      appendixTabs.forEach(t => t.classList.remove('selected'));
      appendixTabVerbs.classList.add('selected');
      renderAppendixView('verbs');
    });
    appendixTabAffixes.addEventListener('click', () => {
      appendixTabs.forEach(t => t.classList.remove('selected'));
      appendixTabAffixes.classList.add('selected');
      renderAppendixView('affixes');
    });
  }

  document.getElementById('searchPhrasesBox').addEventListener('input', renderPhrasesTable);
  document.getElementById('phraseUnitFilter').addEventListener('change', renderPhrasesTable);
  document.getElementById('searchBox').addEventListener('input', renderVocabTable);
  document.getElementById('listBookFilter').addEventListener('change', renderVocabTable);
  document.getElementById('listCategoryFilter').addEventListener('change', renderVocabTable);

  // 学情数据导出与 AI 诊断事件绑定
  const exportAiPromptBtn = document.getElementById('exportAiPromptBtn');
  if (exportAiPromptBtn) {
    exportAiPromptBtn.addEventListener('click', async () => {
      try {
        const prompt = buildAIDiagnosticPrompt(VOCAB_DATABASE, PHRASE_DATABASE);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(prompt);
          showToast('已复制 AI 诊断 Prompt，可直接发送给大模型');
        } else {
          const ta = document.createElement('textarea');
          ta.value = prompt;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast('已复制 AI 诊断 Prompt 到剪贴板');
        }
      } catch (err) {
        showToast('复制失败，请尝试直接导出报告');
      }
    });
  }

  const exportAiReportBtn = document.getElementById('exportAiReportBtn');
  if (exportAiReportBtn) {
    exportAiReportBtn.addEventListener('click', () => {
      const prompt = buildAIDiagnosticPrompt(VOCAB_DATABASE, PHRASE_DATABASE);
      const dateStr = new Date().toISOString().slice(0, 10);
      const bCfg = getActiveBookConfig();
      downloadFile(prompt, `沪教版英语_${bCfg.shortTitle.replace(/\s+/g, '')}_AI学情诊断报告_${dateStr}.md`, 'text/markdown;charset=utf-8');
      showToast('已生成并下载 AI 学情诊断 Markdown 报告');
    });
  }

  const exportBackupJsonBtn = document.getElementById('exportBackupJsonBtn');
  if (exportBackupJsonBtn) {
    exportBackupJsonBtn.addEventListener('click', () => {
      exportBackupJSON();
      showToast('学情完整备份已导出');
    });
  }

  const importBackupJsonBtn = document.getElementById('importBackupJsonBtn');
  const importBackupFileInput = document.getElementById('importBackupFileInput');
  if (importBackupJsonBtn && importBackupFileInput) {
    importBackupJsonBtn.addEventListener('click', () => {
      importBackupFileInput.value = '';
      importBackupFileInput.click();
    });

    importBackupFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const res = importBackupJSON(content);
        if (res.success) {
          showToast(res.message);
          currentSettings = loadSettings();
          renderBookSelector();
          renderCategorySelector();
          initUnitSelector();
          renderStatistics();
          renderHeatmap();
          renderAchievements();
          updateLeechCountBadge();
          startNewSession();
        } else {
          alert('导入失败：' + res.message);
        }
      };
      reader.readAsText(file);
    });
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', initData);
