/**
 * 本地持久化存储与学习指标管理
 */

const STORAGE_KEY = 'sm2_vocab_progress_7a';
const SETTINGS_KEY = 'sm2_vocab_settings_7a';
const HISTORY_KEY = 'sm2_vocab_history_7a';
const ACHIEVE_KEY = 'sm2_vocab_achievements_7a';

export function loadSM2Store() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveSM2Store(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {}
}

export function getCardProgress(cardId) {
  const store = loadSM2Store();
  if (store[cardId]) {
    return store[cardId];
  }
  return {
    id: cardId,
    repetitions: 0,
    interval: 0,
    efactor: 2.5,
    dueDate: null,
    lastReview: null,
    totalReviews: 0,
    lapses: 0,
    isLeech: false
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { selectedUnits: [1], mode: 'unit', autoPronounce: true, voiceAccent: '2' };
  } catch (e) {
    return { selectedUnits: [1], mode: 'unit', autoPronounce: true, voiceAccent: '2' };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {}
}

export function loadHistoryStore() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function recordReviewHistory() {
  try {
    const history = loadHistoryStore();
    const today = new Date();
    const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    history[key] = (history[key] || 0) + 1;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {}
}

export function loadAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveAchievements(data) {
  try {
    localStorage.setItem(ACHIEVE_KEY, JSON.stringify(data));
  } catch (e) {}
}
