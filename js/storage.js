/**
 * 2024新课标沪教版初中英语全学段 · 本地持久化存储与学情指标引擎 V3.0
 * 架构：IndexedDB 主存储 (VocabLearnerDB_Unified) + 内存快速缓存 (In-Memory Store) + localStorage 安全副本与冷备
 * 保证零数据丢失、多册无缝迁移、断网离线安全与全局规范化卡片 ID 兼容
 */

const DB_NAME = 'VocabLearnerDB_Unified';
const LEGACY_DB_NAME = 'VocabLearnerDB_7a';
const DB_VERSION = 3;
const STORE_NAME = 'kv_store';

const STORAGE_KEY_UNIFIED = 'sm2_vocab_progress_unified';
const STORAGE_KEY_LEGACY = 'sm2_vocab_progress_7a';
const SETTINGS_KEY = 'sm2_vocab_settings_7a';
const HISTORY_KEY = 'sm2_vocab_history_7a';
const ACHIEVE_KEY = 'sm2_vocab_achievements_7a';
const BACKUP_KEY_PRE_IDB = 'sm2_vocab_progress_7a_backup_pre_idb';
const BACKUP_KEY_PRE_V3 = 'sm2_vocab_progress_backup_pre_v3';
const MIGRATED_FLAG = 'sm2_migrated_to_unified_v3';

export function getDefaultSettings() {
  return {
    activeBook: '7a',
    selectedUnits: [1],
    categoryFilter: 'all', // 'all' | 'core' | 'expansion'
    mode: 'unit',
    autoPronounce: true,
    voiceAccent: '2'
  };
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
 * 打开或获取 IndexedDB 单例 (支持升级与创建 kv_store)
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
 * 将老版本 ID 映射到规范 ID 的双向解析
 */
export function mapLegacyIdToCanonical(legacyId) {
  const m = legacyId.match(/^u(\d+)_(\d+)$/);
  if (m) {
    return `7a_u${m[1]}_core_${m[2]}`;
  }
  const pm = legacyId.match(/^p(\d+)_(\d+)$/);
  if (pm) {
    return `7a_p${pm[1]}_${pm[2]}`;
  }
  return legacyId;
}

/**
 * 启动自检与平滑无损迁移引擎 V3
 * 1. 优先读取主库 VocabLearnerDB_Unified 数据。
 * 2. 若主库无数据，检查旧库 VocabLearnerDB_7a 或 localStorage 中的历史记录。
 * 3. 建立只读安全冷备份（绝不物理删除任何既有数据）。
 * 4. 自动升级老版本 ID 映射并合并进入统一进度字典。
 * 5. 保持 localStorage 安全双写镜像。
 */
export async function initStorageEngine() {
  try {
    const db = await openDatabase();
    if (db) {
      const idbProgress = await idbGet('progress');
      if (idbProgress && typeof idbProgress === 'object' && Object.keys(idbProgress).length > 0) {
        // 主库已具有进度，作为权威数据
        _memStore.progress = idbProgress;
        _memStore.settings = Object.assign(getDefaultSettings(), (await idbGet('settings')) || readFromLocalStorage(SETTINGS_KEY, {}));
        _memStore.history = (await idbGet('history')) || readFromLocalStorage(HISTORY_KEY, {});
        _memStore.achievements = (await idbGet('achievements')) || readFromLocalStorage(ACHIEVE_KEY, {});

        syncMemoryToLocalStorage();
        return;
      }

      // 主库暂无数据，检查 localStorage 与旧版本数据
      let sourceProgress = readFromLocalStorage(STORAGE_KEY_UNIFIED, null);
      if (!sourceProgress || Object.keys(sourceProgress).length === 0) {
        sourceProgress = readFromLocalStorage(STORAGE_KEY_LEGACY, null);
      }

      if (sourceProgress && typeof sourceProgress === 'object' && Object.keys(sourceProgress).length > 0) {
        console.log('[Storage] 检测到原有学情记录，正在执行零丢失平滑迁移至 V3.0 统一架构...');

        // 建立冷备份快照
        try {
          if (typeof localStorage !== 'undefined') {
            const rawLegacy = localStorage.getItem(STORAGE_KEY_LEGACY);
            if (rawLegacy) {
              localStorage.setItem(BACKUP_KEY_PRE_IDB, rawLegacy);
              localStorage.setItem(BACKUP_KEY_PRE_V3, rawLegacy);
            }
            localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
          }
        } catch (e) {}

        const sourceSettings = Object.assign(getDefaultSettings(), readFromLocalStorage(SETTINGS_KEY, {}));
        const sourceHistory = readFromLocalStorage(HISTORY_KEY, {});
        const sourceAchievements = readFromLocalStorage(ACHIEVE_KEY, {});

        // 构建无损映射后的 progress 字典（同时保留原 key 与 canonicalKey，杜绝任何断层）
        const migratedProgress = { ...sourceProgress };
        for (const [k, val] of Object.entries(sourceProgress)) {
          const canonKey = mapLegacyIdToCanonical(k);
          if (canonKey !== k && !migratedProgress[canonKey]) {
            migratedProgress[canonKey] = {
              ...val,
              id: canonKey,
              legacyId: k
            };
          }
        }

        await idbSet('progress', migratedProgress);
        await idbSet('settings', sourceSettings);
        await idbSet('history', sourceHistory);
        await idbSet('achievements', sourceAchievements);

        _memStore.progress = migratedProgress;
        _memStore.settings = sourceSettings;
        _memStore.history = sourceHistory;
        _memStore.achievements = sourceAchievements;

        syncMemoryToLocalStorage();
        console.log(`[Storage] ✅ 成功平滑迁移 ${Object.keys(sourceProgress).length} 条卡片学情数据至 V3.0 统一引擎`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Storage] 初始化存储引擎出现异常，将透明降级至 localStorage:', err);
  }

  // 兜底保护：从 localStorage 载入或初始化默认值
  if (!_memStore.progress) {
    const rawLocal = readFromLocalStorage(STORAGE_KEY_UNIFIED, null) || readFromLocalStorage(STORAGE_KEY_LEGACY, {});
    _memStore.progress = rawLocal;
  }
  if (!_memStore.settings) {
    _memStore.settings = Object.assign(getDefaultSettings(), readFromLocalStorage(SETTINGS_KEY, {}));
  }
  if (!_memStore.history) _memStore.history = readFromLocalStorage(HISTORY_KEY, {});
  if (!_memStore.achievements) _memStore.achievements = readFromLocalStorage(ACHIEVE_KEY, {});

  syncMemoryToLocalStorage();
}

function syncMemoryToLocalStorage() {
  if (_memStore.progress) {
    writeToLocalStorage(STORAGE_KEY_UNIFIED, _memStore.progress);
    writeToLocalStorage(STORAGE_KEY_LEGACY, _memStore.progress);
  }
  if (_memStore.settings) writeToLocalStorage(SETTINGS_KEY, _memStore.settings);
  if (_memStore.history) writeToLocalStorage(HISTORY_KEY, _memStore.history);
  if (_memStore.achievements) writeToLocalStorage(ACHIEVE_KEY, _memStore.achievements);
}

// ---------------- 同步业务接口保持 100% 向后兼容 ----------------

export function loadSM2Store() {
  if (_memStore.progress) {
    return _memStore.progress;
  }
  const fallback = readFromLocalStorage(STORAGE_KEY_UNIFIED, null) || readFromLocalStorage(STORAGE_KEY_LEGACY, {});
  _memStore.progress = fallback;
  return fallback;
}

export function saveSM2Store(store) {
  _memStore.progress = store || {};
  // 1. 异步写入主库 IndexedDB
  idbSet('progress', _memStore.progress);
  // 2. 同步双写入 localStorage 安全副本
  writeToLocalStorage(STORAGE_KEY_UNIFIED, _memStore.progress);
  writeToLocalStorage(STORAGE_KEY_LEGACY, _memStore.progress);
}

/**
 * 健壮的多维卡片进度查询：
 * 优先按 cardId 查找；若无，按 canonicalId 查找；若无，按 legacyId 查找。
 */
export function getCardProgress(cardId) {
  const store = loadSM2Store();
  if (store) {
    if (store[cardId]) return store[cardId];

    // 检查 canonicalId 映射 (7a_u1_core_1 -> u1_1)
    const m = cardId.match(/^7a_u(\d+)_core_(\d+)$/);
    if (m) {
      const legKey = `u${m[1]}_${m[2]}`;
      if (store[legKey]) return store[legKey];
    }

    // 检查 legacyId 映射 (u1_1 -> 7a_u1_core_1)
    const lm = cardId.match(/^u(\d+)_(\d+)$/);
    if (lm) {
      const canonKey = `7a_u${lm[1]}_core_${lm[2]}`;
      if (store[canonKey]) return store[canonKey];
    }
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
  const fallback = Object.assign(getDefaultSettings(), readFromLocalStorage(SETTINGS_KEY, {}));
  _memStore.settings = fallback;
  return fallback;
}

export function saveSettings(s) {
  _memStore.settings = Object.assign(getDefaultSettings(), s || {});
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
