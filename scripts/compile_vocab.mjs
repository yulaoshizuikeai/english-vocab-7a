/**
 * 2024新课标沪教版初中英语全学段词库与短语编译流水线
 * 读取 Markdown 结构化词表并生成符合 SM-2 规范的前端 JSON 数据集
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_DIR = 'D:/coding/english-vocab-7a';
const SOURCE_MD_DIR = 'c:/Users/Yu_233/Desktop/初中历史/2024新课标沪教版初中英语必背词表';
const DATA_DIR = path.join(WORKSPACE_DIR, 'data');

const BOOKS_CONFIG = [
  {
    id: '7a',
    title: '七年级上册 (7A)',
    shortTitle: '7A',
    folder: '01_七年级上册(7A)_单元核心与课外拓展',
    units: 8
  },
  {
    id: '7b',
    title: '七年级下册 (7B)',
    shortTitle: '7B',
    folder: '02_七年级下册(7B)_单元核心与课外拓展',
    units: 8
  },
  {
    id: '8a',
    title: '八年级上册 (8A)',
    shortTitle: '8A',
    folder: '03_八年级上册(8A)_单元核心与课外拓展',
    units: 8
  },
  {
    id: '8b',
    title: '八年级下册 (8B)',
    shortTitle: '8B',
    folder: '04_八年级下册(8B)_单元核心与课外拓展',
    units: 8
  },
  {
    id: '9',
    title: '九年级全册 (9A/9B)',
    shortTitle: '9全册',
    folder: '05_九年级全册(9A_9B)_中考冲刺核心与课外拓展',
    units: 6
  }
];

function parseUnitNumber(filename) {
  const match = filename.match(/Unit_(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

function parseMarkdownFile(filePath, bookId) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let title = '';
  let unit = 1;
  let currentSection = '';
  const coreWords = [];
  const expansionWords = [];
  const phrases = [];

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('# ')) {
      title = line.replace('# ', '').trim();
      const uMatch = title.match(/Unit\s*(\d+)/i);
      if (uMatch) unit = parseInt(uMatch[1], 10);
    } else if (line.includes('课内必背核心词')) {
      currentSection = 'core';
    } else if (line.includes('课外高分拓展词')) {
      currentSection = 'expansion';
    } else if (line.includes('单元核心考点') || line.includes('单元核心词组')) {
      currentSection = 'phrases';
    } else if (line.startsWith('|') && !line.includes('序号') && !line.includes('---')) {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 5) {
        const item = {
          word: parts[1].replace(/\*\*/g, '').trim(),
          phonetic: parts[2].trim(),
          pos: parts[3].trim(),
          meaning: parts[4].trim(),
          phrase: parts[5] ? parts[5].trim() : '',
          category: currentSection === 'expansion' ? 'expansion' : 'core'
        };
        if (currentSection === 'core') coreWords.push(item);
        else if (currentSection === 'expansion') expansionWords.push(item);
      }
    } else if (currentSection === 'phrases' && line.startsWith('- **')) {
      const match = line.match(/^-\s*\*\*(.*?)\*\*\s*[：:]\s*(.*)$/);
      if (match) {
        phrases.push({
          phrase: match[1].trim(),
          meaning: match[2].trim(),
          example: match[2].trim()
        });
      }
    }
  }

  return { unit, title, coreWords, expansionWords, phrases };
}

async function compileAll() {
  console.log('🚀 开始编译 2024新课标沪教版初中英语全学段数据表...');

  // 1. 读取既有 7A 数据并升版保持 100% 兼容
  const existing7aVocabPath = path.join(DATA_DIR, 'vocab-7a.json');
  const existing7aPhrasesPath = path.join(DATA_DIR, 'phrases-7a.json');
  const existing7aVocab = JSON.parse(fs.readFileSync(existing7aVocabPath, 'utf-8'));
  const existing7aPhrases = JSON.parse(fs.readFileSync(existing7aPhrasesPath, 'utf-8'));

  // 将现有 256 个词规范化标记
  const existing7aWordSet = new Set();
  const upgraded7aVocab = existing7aVocab.map((item, idx) => {
    existing7aWordSet.add(item.word.toLowerCase());
    return {
      ...item,
      book: '7a',
      canonicalId: `7a_u${item.unit}_core_${idx + 1}`,
      legacyId: item.id,
      category: 'core'
    };
  });

  // 读取 7A 的 Markdown，解析课外拓展词
  const folder7a = path.join(SOURCE_MD_DIR, BOOKS_CONFIG[0].folder);
  const files7a = fs.readdirSync(folder7a).filter(f => f.endsWith('.md')).sort();
  files7a.forEach(f => {
    const parsed = parseMarkdownFile(path.join(folder7a, f), '7a');
    let expIdx = 1;
    parsed.expansionWords.forEach(w => {
      // 避免与核心词完全重名
      if (!existing7aWordSet.has(w.word.toLowerCase())) {
        existing7aWordSet.add(w.word.toLowerCase());
        upgraded7aVocab.push({
          id: `7a_u${parsed.unit}_exp_${expIdx}`,
          canonicalId: `7a_u${parsed.unit}_exp_${expIdx}`,
          legacyId: `7a_u${parsed.unit}_exp_${expIdx}`,
          book: '7a',
          unit: parsed.unit,
          unitTitle: `Unit ${parsed.unit}`,
          word: w.word,
          phonetic: w.phonetic,
          pos: w.pos,
          meaning: w.meaning,
          phrase: w.phrase || `课外高分拓展：${w.word}`,
          root: '课外高分拓展词（阅读 & 写作升级）',
          category: 'expansion'
        });
        expIdx++;
      }
    });
  });

  fs.writeFileSync(path.join(DATA_DIR, 'vocab-7a.json'), JSON.stringify(upgraded7aVocab, null, 2), 'utf-8');
  console.log(`✅ 7A 词库编译完成: ${upgraded7aVocab.length} 词 (含原有256核心词 + 拓展词)`);

  // 2. 编译 7B, 8A, 8B, 9
  for (let i = 1; i < BOOKS_CONFIG.length; i++) {
    const cfg = BOOKS_CONFIG[i];
    const bFolder = path.join(SOURCE_MD_DIR, cfg.folder);
    const bFiles = fs.readdirSync(bFolder).filter(f => f.endsWith('.md')).sort();

    const bookVocab = [];
    const bookPhrases = [];

    bFiles.forEach(f => {
      const parsed = parseMarkdownFile(path.join(bFolder, f), cfg.id);
      const unitNum = parsed.unit;
      const unitTitle = parsed.title.replace(/^#\s*/, '').replace(/^[0-9A-Za-z\s]+Unit\s*\d+\s*[：:]\s*/, '').trim() || `Unit ${unitNum}`;

      // 核心词
      parsed.coreWords.forEach((w, idx) => {
        const id = `${cfg.id}_u${unitNum}_core_${idx + 1}`;
        bookVocab.push({
          id,
          canonicalId: id,
          legacyId: id,
          book: cfg.id,
          unit: unitNum,
          unitTitle: `Unit ${unitNum} ${unitTitle}`,
          word: w.word,
          phonetic: w.phonetic,
          pos: w.pos,
          meaning: w.meaning,
          phrase: w.phrase || `课文例词：${w.word}`,
          root: `${w.pos} ${w.meaning}`,
          category: 'core'
        });
      });

      // 拓展词
      parsed.expansionWords.forEach((w, idx) => {
        const id = `${cfg.id}_u${unitNum}_exp_${idx + 1}`;
        bookVocab.push({
          id,
          canonicalId: id,
          legacyId: id,
          book: cfg.id,
          unit: unitNum,
          unitTitle: `Unit ${unitNum} ${unitTitle}`,
          word: w.word,
          phonetic: w.phonetic,
          pos: w.pos,
          meaning: w.meaning,
          phrase: w.phrase || `高分语境：${w.word}`,
          root: '课外高分拓展词（阅读 & 写作升级）',
          category: 'expansion'
        });
      });

      // 短语
      parsed.phrases.forEach((p, idx) => {
        const id = `${cfg.id}_p${unitNum}_${idx + 1}`;
        bookPhrases.push({
          id,
          book: cfg.id,
          unit: unitNum,
          unitTitle: `Unit ${unitNum} ${unitTitle}`,
          phrase: p.phrase,
          meaning: p.meaning,
          example: p.example || `课文核心短语：${p.phrase}`
        });
      });
    });

    const vFileName = `vocab-${cfg.id}.json`;
    const pFileName = `phrases-${cfg.id}.json`;
    fs.writeFileSync(path.join(DATA_DIR, vFileName), JSON.stringify(bookVocab, null, 2), 'utf-8');
    fs.writeFileSync(path.join(DATA_DIR, pFileName), JSON.stringify(bookPhrases, null, 2), 'utf-8');
    console.log(`✅ ${cfg.id.toUpperCase()} 词库与短语编译完成: ${bookVocab.length} 词, ${bookPhrases.length} 组短语`);
  }

  // 3. 编译附录与中考速查数据
  const appendixDir = path.join(SOURCE_MD_DIR, '06_附录与中考速查');
  const grammarAppendix = {
    phrasesAll: fs.readFileSync(path.join(appendixDir, '01_中考高频核心词组与固定搭配全集.md'), 'utf-8'),
    irregularVerbs: fs.readFileSync(path.join(appendixDir, '02_初中英语必背不规则动词分类全表.md'), 'utf-8'),
    affixes: fs.readFileSync(path.join(appendixDir, '03_中考构词法与词形转换规律.md'), 'utf-8')
  };
  fs.writeFileSync(path.join(DATA_DIR, 'grammar-appendix.json'), JSON.stringify(grammarAppendix, null, 2), 'utf-8');
  console.log('✅ 语法与中考速查附录编译完成 (grammar-appendix.json)');

  // 4. 生成 books.json 目录索引
  const booksMeta = BOOKS_CONFIG.map(c => ({
    id: c.id,
    title: c.title,
    shortTitle: c.shortTitle,
    units: c.units,
    vocabFile: `data/vocab-${c.id}.json`,
    phrasesFile: `data/phrases-${c.id}.json`
  }));
  fs.writeFileSync(path.join(DATA_DIR, 'books.json'), JSON.stringify(booksMeta, null, 2), 'utf-8');
  console.log('✅ books.json 目录索引生成完成');

  console.log('🎉 全量数据编译完毕！');
}

compileAll().catch(err => {
  console.error('编译失败:', err);
  process.exit(1);
});
