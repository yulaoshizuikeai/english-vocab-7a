---
name: vocab-study-engine
description: >-
  初中英语词表研习系统 (沪教牛津版 7A) 专属工程技能。负责维护与扩展官方 2024 新课标词库、SuperMemo-2 (SM2)
  记忆算法参数、IndexedDB 双轨持久化引擎、Anki 统计图表看板以及 AI 学情量化诊断报告生成器。
  当需要排查学习进度存储、扩充新单元考纲数据、调整算法复习周期、修改卡片交互或生成学情分析提示词时调用。
---

# 初中英语词表研习系统专属工程技能 (Vocab Study Engine)

本技能专为维护、优化和扩展**沪教牛津版初一英语 7A 背诵系统**而设计。

---

## 核心能力与负责领域

### 1. 2024 新课标考纲词库规范 (`data/`)
- **考纲单词标准字段 (`data/vocab-7a.json`)**：
  ```json
  {
    "id": "u1_1",
    "word": "friend",
    "phonetic": "/frend/",
    "pos": "n.",
    "meaning": "朋友；支持者",
    "unit": 1,
    "unitTitle": "Unit 1 Friendship",
    "example": "He made many new friends at junior high school."
  }
  ```
- **重点课文短语标准字段 (`data/phrases-7a.json`)**：
  ```json
  {
    "id": "p_u1_1",
    "phrase": "make friends with",
    "meaning": "与……交朋友",
    "unit": 1,
    "unitTitle": "Unit 1 Friendship",
    "example": "It is easy to make friends with someone who shares your hobbies."
  }
  ```
- **词条容量基准**：全书 8 单元，目前收录 256 核心单词 + 71 课文重点短语，总计 327 条。

---

### 2. SuperMemo-2 (SM2) 算法调优 (`js/sm2.js`)
- **记忆留存率目标**：符合艾宾浩斯优良衰减曲线，理论优良线维持在 85% ~ 92%。
- **算法核心计算函数**：`calculateSM2(cardProgress, quality)`
  - `quality`: 1(重来), 3(困难), 4(良好), 5(简单)
  - `lapses >= 4`: 自动标记为重点难词 `isLeech = true`
- **卡片状态分类标准**：
  - `Mature`: `interval >= 21` 天
  - `Young`: `interval < 21` 天 且 `repetitions >= 1`
  - `Learning`: `repetitions === 0` 且有自测记录
  - `New`: 尚未背诵

---

### 3. 持久化数据结构与安全准则 (`js/storage.js`)
- **存储键命名契约**：
  - `progress`: `sm2_vocab_progress_7a`（卡片学习进度字典）
  - `history`: `sm2_vocab_history_7a`（每日打卡复习计数）
  - `settings`: `sm2_vocab_settings_7a`（用户偏好：单元、发音、英美音）
  - `achievements`: `sm2_vocab_achievements_7a`（10 项里程碑达成记录）
  - `backup`: `sm2_vocab_progress_7a_backup_pre_idb`（升级只读安全冷备）
- **开发硬约束**：
  - 严禁任何物理删除存储的操作；
  - 任何存储字段扩展，必须保持向后兼容，并在 `tests/verify_storage.mjs` 中补充断言测试。

---

### 4. 自动化验证流
在完成任何功能开发后，执行以下命令验证：
```bash
# 验证存储引擎完整性
node tests/verify_storage.mjs

# 检查所有模块的语法
node --check js/app.js
node --check js/storage.js
node --check js/audio.js
node --check js/export.js
node --check js/sm2.js
```
