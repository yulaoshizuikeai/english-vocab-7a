/**
 * 自动化测试脚本：验证持久化无损迁移、双写机制与数据零丢失安全网
 * 运行方式: node tests/verify_storage.mjs
 */

import assert from 'node:assert';

// ---------------- Mock 浏览器环境 ----------------
const mockLocalStorageMap = new Map();
globalThis.localStorage = {
  getItem: (k) => mockLocalStorageMap.get(k) ?? null,
  setItem: (k, v) => mockLocalStorageMap.set(k, String(v)),
  removeItem: (k) => mockLocalStorageMap.delete(k),
  clear: () => mockLocalStorageMap.clear()
};

// 模拟 IndexedDB
const mockIdbStore = new Map();
class MockIDBRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = undefined;
    this.error = null;
  }
}

class MockIDBTransaction {
  constructor(mode) {
    this.mode = mode;
  }
  objectStore() {
    return {
      get: (key) => {
        const req = new MockIDBRequest();
        setTimeout(() => {
          req.result = mockIdbStore.get(key);
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 1);
        return req;
      },
      put: (val, key) => {
        const req = new MockIDBRequest();
        setTimeout(() => {
          mockIdbStore.set(key, JSON.parse(JSON.stringify(val)));
          req.result = key;
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 1);
        return req;
      }
    };
  }
}

class MockIDBDatabase {
  constructor(name) {
    this.name = name;
    this.objectStoreNames = {
      contains: (s) => s === 'kv_store'
    };
  }
  transaction(storeName, mode) {
    return new MockIDBTransaction(mode);
  }
}

globalThis.indexedDB = {
  open: (name, version) => {
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = new MockIDBDatabase(name);
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 1);
    return req;
  }
};

// ---------------- 测试场景执行 ----------------

async function runTests() {
  console.log('🚀 开始执行持久化引擎无损升级与数据安全自动化测试...');

  // 1. 模拟旧用户已有的 localStorage 数据
  const sampleProgress = {
    'u1_1': { id: 'u1_1', repetitions: 4, interval: 14, efactor: 2.6, lapses: 0, totalReviews: 4, isLeech: false },
    'u1_2': { id: 'u1_2', repetitions: 1, interval: 1, efactor: 2.1, lapses: 2, totalReviews: 3, isLeech: true },
    'p_u1_1': { id: 'p_u1_1', repetitions: 2, interval: 6, efactor: 2.5, lapses: 0, totalReviews: 2, isLeech: false }
  };
  const sampleHistory = {
    '2026-10-08': 20,
    '2026-10-09': 15
  };
  const sampleSettings = {
    selectedUnits: [1, 2],
    mode: 'unit',
    autoPronounce: false,
    voiceAccent: '1'
  };
  const sampleAchievements = {
    first_word: 1728000000000,
    review_10: 1728000100000
  };

  mockLocalStorageMap.set('sm2_vocab_progress_7a', JSON.stringify(sampleProgress));
  mockLocalStorageMap.set('sm2_vocab_history_7a', JSON.stringify(sampleHistory));
  mockLocalStorageMap.set('sm2_vocab_settings_7a', JSON.stringify(sampleSettings));
  mockLocalStorageMap.set('sm2_vocab_achievements_7a', JSON.stringify(sampleAchievements));

  // 动态导入待测模块
  const storageModule = await import('../js/storage.js');
  const {
    initStorageEngine,
    loadSM2Store,
    saveSM2Store,
    getCardProgress,
    loadSettings,
    saveSettings,
    loadHistoryStore,
    saveHistoryStore,
    recordReviewHistory,
    loadAchievements,
    saveAchievements
  } = storageModule;

  // 执行启动自检与迁移
  await initStorageEngine();

  // 断言 1: IndexedDB 中已完整写入全部 3 条卡片
  const idbProgress = mockIdbStore.get('progress');
  assert.ok(idbProgress, 'IndexedDB 中必须存在 progress 数据');
  assert.strictEqual(Object.keys(idbProgress).length, 3, '卡片数量必须为 3');
  assert.strictEqual(idbProgress['u1_1'].repetitions, 4);
  assert.strictEqual(idbProgress['u1_1'].efactor, 2.6);
  assert.strictEqual(idbProgress['u1_2'].isLeech, true);

  // 断言 2: 原有 localStorage 中的数据绝未被删除
  const rawLocal = mockLocalStorageMap.get('sm2_vocab_progress_7a');
  assert.ok(rawLocal, 'localStorage 中的主数据不能被删除');
  const parsedLocal = JSON.parse(rawLocal);
  assert.strictEqual(parsedLocal['u1_1'].repetitions, 4);

  // 断言 3: 冷备份快照已安全建立
  const backupSnapshot = mockLocalStorageMap.get('sm2_vocab_progress_7a_backup_pre_idb');
  assert.ok(backupSnapshot, '必须自动建立迁移前只读安全冷备份');
  assert.strictEqual(JSON.parse(backupSnapshot)['u1_2'].lapses, 2);

  // 断言 4: 内存快速读取与业务接口一致性
  const memStore = loadSM2Store();
  assert.strictEqual(memStore['u1_1'].interval, 14);
  const card1 = getCardProgress('u1_1');
  assert.strictEqual(card1.efactor, 2.6);
  const settings = loadSettings();
  assert.strictEqual(settings.voiceAccent, '1');
  assert.deepStrictEqual(settings.selectedUnits, [1, 2]);
  const history = loadHistoryStore();
  assert.strictEqual(history['2026-10-08'], 20);
  const achieve = loadAchievements();
  assert.strictEqual(achieve.first_word, 1728000000000);

  // 断言 5: 双写同步测试 (写入新卡片进度)
  memStore['u2_1'] = { id: 'u2_1', repetitions: 1, interval: 1, efactor: 2.5, lapses: 0, totalReviews: 1, isLeech: false };
  saveSM2Store(memStore);

  // 等待异步 IndexedDB 写入完成
  await new Promise(r => setTimeout(r, 20));

  const updatedIdb = mockIdbStore.get('progress');
  assert.ok(updatedIdb['u2_1'], '新卡片进度必须同步至 IndexedDB');
  const updatedLocal = JSON.parse(mockLocalStorageMap.get('sm2_vocab_progress_7a'));
  assert.ok(updatedLocal['u2_1'], '新卡片进度必须同步至 localStorage 安全副本');

  // 断言 6: 今日打卡自增测试
  const prevCount = history[new Date().toISOString().slice(0, 10)] || 0;
  recordReviewHistory();
  await new Promise(r => setTimeout(r, 20));
  const newHist = loadHistoryStore();
  const currentTodayKey = new Date().toISOString().slice(0, 10);
  assert.strictEqual(newHist[currentTodayKey], prevCount + 1, '今日打卡次数必须正确自增');

  console.log('✅ 所有断言全部通过！无损迁移、双写同步与冷备份机制验证无误！');
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
