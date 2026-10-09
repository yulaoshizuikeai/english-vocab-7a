/**
 * SuperMemo-2 (SM2) 记忆间隔重复算法
 * 实现严谨的复习间隔递增与掌握度评估
 */

export const LEECH_THRESHOLD = 4; // 连续遗忘达到 4 次标记为重点难词

/**
 * 计算 SM2 下一次复习参数
 * @param {Object} cardProgress 当前卡片进度状态
 * @param {number} quality 评分 (1: 重来, 3: 困难, 4: 良好, 5: 简单)
 * @returns {Object} 更新后的进度
 */
export function calculateSM2(cardProgress, quality) {
  const now = Date.now();
  let { repetitions = 0, interval = 0, efactor = 2.5, lapses = 0, totalReviews = 0 } = cardProgress;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
    lapses = (lapses || 0) + 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = quality === 3 ? 3 : 6;
    } else {
      interval = Math.round(interval * efactor);
    }
    repetitions += 1;
  }

  // EF 公式: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (efactor < 1.3) efactor = 1.3;
  if (efactor > 3.0) efactor = 3.0;

  const isLeech = lapses >= LEECH_THRESHOLD;
  const nextDue = now + interval * 24 * 60 * 60 * 1000;

  return {
    ...cardProgress,
    repetitions,
    interval,
    efactor: parseFloat(efactor.toFixed(2)),
    dueDate: nextDue,
    lastReview: now,
    totalReviews: totalReviews + 1,
    lapses,
    isLeech
  };
}

/**
 * 预测各评分按钮的间隔天数
 */
export function predictIntervals(progress) {
  const ef = progress.efactor || 2.5;
  const rep = progress.repetitions || 0;
  const interval = progress.interval || 0;

  const hardDays = rep === 0 ? 1 : (rep === 1 ? 3 : Math.round(interval * Math.max(1.3, ef - 0.15)));
  const goodDays = rep === 0 ? 1 : (rep === 1 ? 6 : Math.round(interval * ef));
  const easyDays = rep === 0 ? 3 : (rep === 1 ? 8 : Math.round(interval * (ef + 0.15)));

  return { hardDays, goodDays, easyDays };
}
