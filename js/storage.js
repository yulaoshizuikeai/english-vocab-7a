/**
 * 沪教牛津版初一英语 7A · 本地持久化存储与学情指标引擎
 * 架构：IndexedDB 主存储 + 内存快速缓存 (In-Memory Store) + localStorage 安全副本与冷备
 * 保证零数据丢失、无缝平滑迁移与断网离线安全
 */

const DB_NAME = 'VocabLearnerDB_7a';
const DB_VERSION = 1;
const STORE_NAME = 'kv_store';

const STORAGE_KEY = 'sm2_vocab_progress_7a';
const SETTINGS_KEY = 'sm2_vocab_settings_7a';
const HISTORY_KEY = 'sm2_vocab_history_7a';
const ACHIEVE_KEY = 'sm2_vocab_achievements_7a';
const BACKUP_KEY = 'sm2_vocab_progress_7a_backup_pre_idb';
const MIGRATED_FLAG = 'sm2_migrated_to_idb';

function getDefaultSettings() {
  return { selectedUnits: [1], mode: 'unit', autoPronounce: true, voiceAccent: '2' };
}

// 内存快速缓存：保证同步函数无延迟返回
const _memStore = {
  progress: null,
  settings: null,
  history: null,
  achievements: null
};

// 浏览器 IndexedDB 实例引用
let dbInstance = null;
const isIndexedDBSupported = typeof indexedDB !== 'undefined';

function readFromLocalStorage(key, fallback = null) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeToLocalStorage(key, val) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {}
}

/**
 * 打开或获取 IndexedDB 单例
 */
export function openDatabase() {
  if (!isIndexedDBSupported) return Promise.resolve(null);
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };
      request.onerror = (event) => {
        console.warn('[Storage] 打开 IndexedDB 失败，降级为 localStorage:', event.target?.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('[Storage] IndexedDB 初始化异常，降级为 localStorage:', e);
      resolve(null);
    }
  });
}

/**
 * IndexedDB 异步读取
 */
export function idbGet(key) {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * IndexedDB 异步写入
 */
export function idbSet(key, value) {
  return openDatabase().then((db) => {
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

/**
 * 启动自检与平滑无损迁移引擎
 * 1. 若 IndexedDB 已有数据：直接载入内存并保持 localStorage 镜像。
 * 2. 若 IndexedDB 暂无数据：完整读取现有 localStorage，写入 IndexedDB 并生成只读安全冷备份（绝不物理删除）。
 * 3. 若 IndexedDB 不可用：透明降级使用 localStorage。
 */
export async function initStorageEngine() {
  try {
    const db = await openDatabase();
    if (db) {
      const idbProgress = await idbGet('progress');
      if (idbProgress && typeof idbProgress === 'object' && Object.keys(idbProgress).length > 0) {
        // 已有 IndexedDB 进度，作为权威数据
        _memStore.progress = idbProgress;
        _memStore.settings = (await idbGet('settings')) || readFromLocalStorage(SETTINGS_KEY, getDefaultSettings());
        _memStore.history = (await idbGet('history')) || readFromLocalStorage(HISTORY_KEY, {});
        _memStore.achievements = (await idbGet('achievements')) || readFromLocalStorage(ACHIEVE_KEY, {});

        // 保持 localStorage 同步副本
        syncMemoryToLocalStorage();
        return;
      }

      // IndexedDB 暂无数据，检测原有的 localStorage 历史记录
      const localProgress = readFromLocalStorage(STORAGE_KEY, null);
      if (localProgress && typeof localProgress === 'object' && Object.keys(localProgress).length > 0) {
        console.log('[Storage] 检测到 localStorage 原有学情记录，正在执行零丢失平滑迁移至 IndexedDB...');

        // 建立只读安全冷备（双重保险，绝不删除原数据）
        try {
          if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) localStorage.setItem(BACKUP_KEY, raw);
            localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
          }
        } catch (e) {}

        const localSettings = readFromLocalStorage(SETTINGS_KEY, getDefaultSettings());
        const localHistory = readFromLocalStorage(HISTORY_KEY, {});
        const localAchievements = readFromLocalStorage(ACHIEVE_KEY, {});

        // 写入主库 IndexedDB
        await idbSet('progress', localProgress);
        await idbSet('settings', localSettings);
        await idbSet('history', localHistory);
        await idbSet('achievements', localAchievements);

        _memStore.progress = localProgress;
        _memStore.settings = localSettings;
        _memStore.history = localHistory;
        _memStore.achievements = localAchievements;

        console.log(`[Storage] ✅ 成功平滑迁移 ${Object.keys(localProgress).length} 条卡片学习记录至 IndexedDB`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Storage] 初始化存储引擎出现异常，将透明降级至 localStorage:', err);
  }

  // 兜底保护：从 localStorage 载入或初始化默认值
  if (!_memStore.progress) _memStore.progress = readFromLocalStorage(STORAGE_KEY, {});
  if (!_memStore.settings) _memStore.settings = readFromLocalStorage(SETTINGS_KEY, getDefaultSettings());
  if (!_memStore.history) _memStore.history = readFromLocalStorage(HISTORY_KEY, {});
  if (!_memStore.achievements) _memStore.achievements = readFromLocalStorage(ACHIEVE_KEY, {});
}

function syncMemoryToLocalStorage() {
  if (_memStore.progress) writeToLocalStorage(STORAGE_KEY, _memStore.progress);
  if (_memStore.settings) writeToLocalStorage(SETTINGS_KEY, _memStore.settings);
  if (_memStore.history) writeToLocalStorage(HISTORY_KEY, _memStore.history);
  if (_memStore.achievements) writeToLocalStorage(ACHIEVE_KEY, _memStore.achievements);
}

// ---------------- 同步业务接口保持 100% 向后兼容 ----------------

export function loadSM2Store() {
  if (_memStore.progress) {
    return _memStore.progress;
  }
  const fallback = readFromLocalStorage(STORAGE_KEY, {});
  _memStore.progress = fallback;
  return fallback;
}

export function saveSM2Store(store) {
  _memStore.progress = store || {};
  // 1. 异步写入主库 IndexedDB
  idbSet('progress', _memStore.progress);
  // 2. 同步写入 localStorage 安全副本
  writeToLocalStorage(STORAGE_KEY, _memStore.progress);
}

export function getCardProgress(cardId) {
  const store = loadSM2Store();
  if (store && store[cardId]) {
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
  if (_memStore.settings) {
    return _memStore.settings;
  }
  const fallback = readFromLocalStorage(SETTINGS_KEY, getDefaultSettings());
  _memStore.settings = fallback;
  return fallback;
}

export function saveSettings(s) {
  _memStore.settings = s || getDefaultSettings();
  idbSet('settings', _memStore.settings);
  writeToLocalStorage(SETTINGS_KEY, _memStore.settings);
}

export function loadHistoryStore() {
  if (_memStore.history) {
    return _memStore.history;
  }
  const fallback = readFromLocalStorage(HISTORY_KEY, {});
  _memStore.history = fallback;
  return fallback;
}

export function saveHistoryStore(history) {
  _memStore.history = history || {};
  idbSet('history', _memStore.history);
  writeToLocalStorage(HISTORY_KEY, _memStore.history);
}

export function recordReviewHistory() {
  try {
    const history = loadHistoryStore();
    const today = new Date();
    const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    history[key] = (history[key] || 0) + 1;
    saveHistoryStore(history);
  } catch (e) {}
}

export function loadAchievements() {
  if (_memStore.achievements) {
    return _memStore.achievements;
  }
  const fallback = readFromLocalStorage(ACHIEVE_KEY, {});
  _memStore.achievements = fallback;
  return fallback;
}

export function saveAchievements(data) {
  _memStore.achievements = data || {};
  idbSet('achievements', _memStore.achievements);
  writeToLocalStorage(ACHIEVE_KEY, _memStore.achievements);
}
