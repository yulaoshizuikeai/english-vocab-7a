# AGENT.md

本项目核心 AI Agent 开发与维护指南请参考主工作协议文档：
👉 [AGENTS.md](./AGENTS.md)

### 快速指引
- **持久化架构**：`IndexedDB` (VocabLearnerDB_7a) + 内存快速缓存 + `localStorage` 双写安全保底
- **记忆算法引擎**：`SuperMemo-2 (SM2)` 间隔重复算法，Leech 阈值为 4
- **测试指令**：`node tests/verify_storage.mjs`
- **代码规范**：原生 ES6 模块，零运行时 NPM 依赖，纯静态边缘托管
