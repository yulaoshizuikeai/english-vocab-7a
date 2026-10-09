/**
 * 高清音频发音模块 (支持英音 / 美音切换及降级处理)
 */

import { loadSettings } from './storage.js';

export function playPronunciation(word) {
  if (!word) return;
  const settings = loadSettings();
  const accent = settings.voiceAccent || '2'; // 1: 英音, 2: 美音
  const audioUrl = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + accent;

  const audio = new Audio(audioUrl);
  audio.play().catch(function() {
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = accent === '1' ? 'en-GB' : 'en-US';
      utter.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
  });
}
