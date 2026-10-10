---
title: Project Invariants & Safety Rules
description: 沪教牛津 7A 初中英语背诵系统 AI Agent 最高红线与不可变原则
trigger: always_on
---

# 项目不可变准则与安全红线 (Project Invariants)

所有参与本代码库维护的 AI Agent 必须无条件遵守以下核心准则：

## 1. 绝对零数据丢失原则 (Zero Data Loss)
- 任何情况下**严禁清空或重置**用户学习存储。禁止调用 `localStorage.clear()`, `localStorage.removeItem()` 或删除 IndexedDB 数据库。
- 持久化必须保持**双轨双写（IndexedDB 主库 + localStorage 镜像）**。
- 若修改存储结构，必须在 `js/storage.js` 的 `initStorageEngine()` 中编写无损迁移并打上安全冷备份。

## 2. 纯前端零外部依赖 (Zero Dependencies)
- 本项目设计为极致轻量、零编译的纯前端静态网站。
- 严禁引入任何重量级前端框架、构建器或运行时外部依赖包。
- 所有脚本采用标准原生 ES6 模块 (`type="module"`)。

## 3. 音频防 CORS 红字原则
- 有道音频源不支持跨域 JS `fetch`。
- 音频发音只能通过原生 `<audio>` 标签并复用 `audioPool` 内存对象池播放。
- 音频播放失败时必须静默降级为系统原生 `window.speechSynthesis`。

## 4. 提交前必过验证 (Verification Gate)
- 任何代码改动，必须在终端执行 `node tests/verify_storage.mjs` 确保测试全部 PASS。
- 必须运行 `node --check` 校验所有 JS 文件的语法。
- 若修改了 JS 文件，必须递增 `index.html` 中的模块引入版本号（例如从 `?v=2.4` 到 `?v=2.5`），防止浏览器缓存旧代码。
