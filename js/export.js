/**
 * 学习数据导出、导入与 AI 学情诊断报告生成引擎
 * 完全保留并兼容原有的本地存储结构 (sm2_vocab_progress_7a, sm2_vocab_history_7a, sm2_vocab_settings_7a, sm2_vocab_achievements_7a)
 */

import {
  loadSM2Store,
  saveSM2Store,
  loadSettings,
  saveSettings,
  loadHistoryStore,
  loadAchievements,
  saveAchievements
} from './storage.js';

/**
 * 浏览器端通用文件下载工具函数
 */
export function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 完整导出学情数据为备份 JSON
 */
export function exportBackupJSON() {
  const backup = {
    version: "2.0",
    textbook: "沪教牛津版初一英语 7A (2024新课标)",
    exportedAt: new Date().toISOString(),
    stores: {
      progress: loadSM2Store(),
      history: loadHistoryStore(),
      settings: loadSettings(),
      achievements: loadAchievements()
    }
  };
  const jsonStr = JSON.stringify(backup, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(jsonStr, `沪教牛津7A英语_学情备份_${dateStr}.json`, 'application/json;charset=utf-8');
}

/**
 * 从 JSON 备份文件导入学情数据并合并/还原
 * @param {string} jsonString 
 * @returns {{ success: boolean, message: string }}
 */
export function importBackupJSON(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      return { success: false, message: '无效的 JSON 格式' };
    }

    // 结构校验：支持标准备份包装，或直接是 SM2 progress 字典
    let progress = null;
    let history = null;
    let settings = null;
    let achievements = null;

    if (data.stores && typeof data.stores === 'object') {
      progress = data.stores.progress;
      history = data.stores.history;
      settings = data.stores.settings;
      achievements = data.stores.achievements;
    } else if (data.progress || data.sm2_vocab_progress_7a) {
      progress = data.progress || data.sm2_vocab_progress_7a;
      history = data.history || data.sm2_vocab_history_7a;
      settings = data.settings || data.sm2_vocab_settings_7a;
      achievements = data.achievements || data.sm2_vocab_achievements_7a;
    } else {
      // 检查是否本身就是卡片进度字典 (例如 key 为 u1_1, p_u1_1 等)
      const firstKey = Object.keys(data)[0];
      if (firstKey && data[firstKey] && typeof data[firstKey] === 'object' && ('repetitions' in data[firstKey] || 'interval' in data[firstKey])) {
        progress = data;
      }
    }

    if (!progress) {
      return { success: false, message: '未在文件中检测到有效的复习进度记录' };
    }

    // 安全写入本地存储，严格保留原有字段
    saveSM2Store(progress);
    if (history && typeof history === 'object') {
      localStorage.setItem('sm2_vocab_history_7a', JSON.stringify(history));
    }
    if (settings && typeof settings === 'object') {
      saveSettings(settings);
    }
    if (achievements && typeof achievements === 'object') {
      saveAchievements(achievements);
    }

    const cardCount = Object.keys(progress).length;
    return { success: true, message: `成功导入 ${cardCount} 张卡片的研习状态` };
  } catch (err) {
    return { success: false, message: '解析文件失败：' + err.message };
  }
}

/**
 * 生成供大模型深度量化诊断的学情分析 Markdown 报告
 * @param {Array} vocabList 全量单词库
 * @param {Array} phraseList 全量词组库
 * @returns {string} Markdown 格式化诊断提示词文本
 */
export function buildAIDiagnosticPrompt(vocabList = [], phraseList = []) {
  const store = loadSM2Store();
  const history = loadHistoryStore();
  const achievements = loadAchievements();
  const allCards = [...vocabList, ...phraseList];
  const totalCards = allCards.length;

  let matureCount = 0;   // interval >= 21d
  let youngCount = 0;    // interval < 21d && repetitions >= 1
  let learningCount = 0; // repetitions === 0 && (totalReviews > 0 || lapses > 0)
  let newCount = 0;      // 尚未学习

  let totalReviewsAccum = 0;
  let totalLapsesAccum = 0;
  let efSum = 0;
  let reviewedCardsCount = 0;
  let totalIntervalSum = 0;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const overdueCards = [];
  const dueTodayCards = [];
  const next7DaysDueCount = new Array(7).fill(0);

  // 记录每个单元的掌握情况
  const unitStats = {};
  for (let u = 1; u <= 8; u++) {
    unitStats[u] = {
      unit: u,
      title: `Unit ${u}`,
      total: 0,
      learned: 0,
      mastered: 0, // repetitions >= 2 && ef >= 2.2
      lapses: 0
    };
  }

  // 高频薄弱词与难词列表 (lapses >= 2 或 ef < 2.1)
  const weakCards = [];

  allCards.forEach(c => {
    const u = c.unit || 1;
    if (unitStats[u]) {
      unitStats[u].total++;
      if (c.unitTitle) unitStats[u].title = c.unitTitle;
    }

    const p = store[c.id];
    if (!p || (p.totalReviews === 0 && p.repetitions === 0)) {
      newCount++;
      return;
    }

    reviewedCardsCount++;
    totalReviewsAccum += (p.totalReviews || 0);
    totalLapsesAccum += (p.lapses || 0);
    efSum += (p.efactor || 2.5);
    totalIntervalSum += (p.interval || 0);

    if (unitStats[u]) {
      unitStats[u].learned++;
      unitStats[u].lapses += (p.lapses || 0);
      if (p.repetitions >= 2 && (p.efactor || 2.5) >= 2.2) {
        unitStats[u].mastered++;
      }
    }

    // 状态分类
    if (p.interval >= 21) {
      matureCount++;
    } else if (p.repetitions >= 1) {
      youngCount++;
    } else {
      learningCount++;
    }

    // 到期判断
    if (p.dueDate) {
      const diffDays = Math.floor((p.dueDate - now) / DAY_MS);
      if (diffDays < 0) {
        overdueCards.push({ card: c, progress: p, overdueDays: Math.abs(diffDays) });
      } else if (diffDays === 0) {
        dueTodayCards.push({ card: c, progress: p });
      }
      if (diffDays >= 0 && diffDays < 7) {
        next7DaysDueCount[diffDays]++;
      }
    }

    // 难词与薄弱词识别 (lapses >= 2 或 efactor <= 2.1 或 isLeech)
    if (p.lapses >= 2 || (p.efactor && p.efactor <= 2.1) || p.isLeech) {
      weakCards.push({
        text: c.word || c.phrase,
        meaning: c.meaning,
        phonetic: c.phonetic || '',
        unit: c.unit,
        unitTitle: c.unitTitle,
        pos: c.pos || 'phrase',
        lapses: p.lapses || 0,
        ef: p.efactor || 2.5,
        repetitions: p.repetitions || 0,
        interval: p.interval || 0
      });
    }
  });

  // 按遗忘次数从大到小排序难词
  weakCards.sort((a, b) => (b.lapses - a.lapses) || (a.ef - b.ef));

  // 综合指标计算
  const avgEf = reviewedCardsCount > 0 ? (efSum / reviewedCardsCount).toFixed(2) : '2.50';
  const avgInterval = reviewedCardsCount > 0 ? (totalIntervalSum / reviewedCardsCount).toFixed(1) : '0';
  const lapseRate = totalReviewsAccum > 0 ? ((totalLapsesAccum / totalReviewsAccum) * 100).toFixed(1) : '0.0';
  const retentionRate = totalReviewsAccum > 0 ? (100 - parseFloat(lapseRate)).toFixed(1) : '100.0';
  const matureRate = totalCards > 0 ? ((matureCount / totalCards) * 100).toFixed(1) : '0.0';
  const coverageRate = totalCards > 0 ? (((totalCards - newCount) / totalCards) * 100).toFixed(1) : '0.0';

  // 连续打卡天数计算
  const today = new Date();
  let currentStreak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if ((history[k] || 0) > 0) currentStreak++;
    else break;
  }

  // 组装 Markdown 诊断 Prompt
  const lines = [
    `# 沪教牛津版初一英语 7A (2024新课标) · 学情量化诊断报告`,
    ``,
    `> **系统导出时间**：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `> **教材版本**：沪教牛津版 (2024年秋季新课标修订版，全书 8 单元，共 256 核心单词 + 71 课文重点词组)`,
    `> **记忆算法引擎**：SuperMemo SM-2 增强型自适应间隔重复算法`,
    ``,
    `## 一、 全局记忆指标与宏观画像`,
    ``,
    `| 指标项目 | 统计数值 | 算法参照基准 | 学情判定 |`,
    `| :--- | :--- | :--- | :--- |`,
    `| **总卡片库容量** | ${totalCards} 张 (单词 ${vocabList.length} + 词组 ${phraseList.length}) | 327 项 | 全书考纲基准 |`,
    `| **已学习覆盖率** | ${coverageRate}% (${totalCards - newCount} / ${totalCards}) | 目标 100% | ${parseFloat(coverageRate) >= 80 ? '高覆盖' : (parseFloat(coverageRate) >= 40 ? '稳步推进中' : '初学阶段')} |`,
    `| **成熟卡片占比 (Mature ≥21天)** | ${matureRate}% (${matureCount} 张) | 目标 ≥70% | ${parseFloat(matureRate) >= 50 ? '长期记忆巩固良好' : '短期/中期记忆为主'} |`,
    `| **初熟卡片 (Young <21天)** | ${youngCount} 张 (${((youngCount/totalCards)*100).toFixed(1)}%) | 动态转化 | 正在建立记忆痕迹 |`,
    `| **再学习/重置中 (Learning)** | ${learningCount} 张 (${((learningCount/totalCards)*100).toFixed(1)}%) | 越低越好 | 近期遗忘再认中 |`,
    `| **未学习新卡 (New)** | ${newCount} 张 (${((newCount/totalCards)*100).toFixed(1)}%) | - | 待学词汇 |`,
    `| **记忆留存率 (Retention Rate)** | ${retentionRate}% | 理论优良线 85%~92% | ${parseFloat(retentionRate) >= 85 ? '符合艾宾浩斯优良衰减曲线' : '遗忘率偏高，需缩短复习间隔'} |`,
    `| **单次自测遗忘率 (Lapse Rate)** | ${lapseRate}% (累计遗忘 ${totalLapsesAccum} 次) | 警示线 >15% | ${parseFloat(lapseRate) > 15 ? '需加强词根拆解与情境造句' : '处于健康容错区间'} |`,
    `| **全库平均简易度 (Avg EF)** | ${avgEf} | 初始基准 2.50 | ${parseFloat(avgEf) >= 2.4 ? '词汇难度感知适中' : '词汇难度感知偏高，易挫败'} |`,
    `| **平均记忆保持间隔** | ${avgInterval} 天 | - | 动态增长 |`,
    `| **累计自测评定总次数** | ${totalReviewsAccum} 次 | - | 练习充分度 |`,
    `| **连续坚持打卡** | ${currentStreak} 天 | - | 学习习惯持续性 |`,
    ``,
    `## 二、 单元考纲掌握度矩阵 (Unit Mastery Matrix)`,
    ``,
    `| 单元编号与主题 | 考纲总词条 | 已学词条 | 已深度掌握 (EF≥2.2) | 单元掌握率 | 累计遗忘次数 | 单元学情评价 |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |`
  ];

  for (let u = 1; u <= 8; u++) {
    const st = unitStats[u];
    const pct = st.total > 0 ? Math.round((st.mastered / st.total) * 100) : 0;
    const learnedPct = st.total > 0 ? Math.round((st.learned / st.total) * 100) : 0;
    let evalText = '未开始';
    if (pct >= 80) evalText = '已精通 (建议维持抽测)';
    else if (pct >= 50) evalText = '基本掌握 (巩固长间隔词)';
    else if (learnedPct > 0) evalText = '攻坚中 (待巩固)';

    lines.push(`| **${st.title}** | ${st.total} | ${st.learned} | ${st.mastered} | **${pct}%** | ${st.lapses} 次 | ${evalText} |`);
  }

  lines.push(
    ``,
    `## 三、 负荷与复习积压分析 (Workload & Due Forecast)`,
    ``,
    `- **逾期未复习卡片 (Overdue)**: ${overdueCards.length} 张 ${overdueCards.length > 0 ? '（存在记忆衰减风险，建议今日优先消化）' : '（无积压，进度良好）'}`,
    `- **今日到期自测 (Due Today)**: ${dueTodayCards.length} 张`,
    `- **未来 7 天到期预期分布**:`,
    `  - 第 1 天(+1d): ${next7DaysDueCount[1]} 张`,
    `  - 第 2 天(+2d): ${next7DaysDueCount[2]} 张`,
    `  - 第 3 天(+3d): ${next7DaysDueCount[3]} 张`,
    `  - 第 4 天(+4d): ${next7DaysDueCount[4]} 张`,
    `  - 第 5 天(+5d): ${next7DaysDueCount[5]} 张`,
    `  - 第 6 天(+6d): ${next7DaysDueCount[6]} 张`,
    ``
  );

  lines.push(`## 四、 重点难词与记忆瓶颈清单 (Leech & High-Lapse Words)`);
  if (weakCards.length === 0) {
    lines.push(`- 当前暂无连续遗忘（Lapses ≥ 2）或严重低简易度词汇，词汇记忆平稳。`);
  } else {
    lines.push(`共识别出 **${weakCards.length}** 个高认知负荷或频繁遗忘词汇：\n`);
    lines.push(`| # | 词汇 / 搭配 | 词性 | 音标 | 单元 | 释义 | 遗忘次数 | 当前简易度 |`);
    lines.push(`| :---: | :--- | :---: | :--- | :--- | :--- | :---: | :---: |`);
    weakCards.slice(0, 30).forEach((w, i) => {
      lines.push(`| ${i + 1} | **${w.text}** | \`${w.pos}\` | ${w.phonetic} | U${w.unit} | ${w.meaning} | **${w.lapses}** | ${w.ef} |`);
    });
    if (weakCards.length > 30) {
      lines.push(`\n*(注：仅显示前 30 个最亟待突破的词汇，其余 ${weakCards.length - 30} 个词请导出完整 JSON 分析)*`);
    }
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## 五、 AI 导师诊断与教学建议指令 (Prompt for LLM)`,
    `请作为专注初中英语学科核心素养与记忆心理学的资深辅导老师，结合上述【沪教牛津版 7A】客观量化数据，为该学生输出一份严谨、客观、具备可执行性的学情诊断报告与学习规划：`,
    ``,
    `1. **学习状态整体诊断**：根据成熟卡片占比、遗忘率（${lapseRate}%）与简易度分布，客观评估学生当前的词汇持久记忆力与认知负荷，指出目前存在的最大记忆瓶颈。`,
    `2. **单元薄弱点定向突破**：指出掌握率最低或遗忘次数最高的 2~3 个单元，并结合初一牛津教材的主题语境（如交友、学校生活、兴趣爱好、地球保护等）给出语篇阅读建议。`,
    `3. **难词攻坚方案 (针对高遗忘清单)**：从上述高遗忘词汇中挑选出 3~5 个代表性难词，提供针对性的【词根词缀认知拆解】、【语境搭配例句】与【同义/反义串记法】。`,
    `4. **未来 7 天最佳复习排程建议**：根据到期预测与当前积压，为学生规划接下来 7 天每天的建议新学量与复习批次。`
  );

  return lines.join('\n');
}
