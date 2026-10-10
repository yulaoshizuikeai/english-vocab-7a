/**
 * 高清音频发音模块 (支持英音 / 美音切换、音频实例缓存与本地语音兜底)
 */

import { loadSettings } from './storage.js';

// 音频对象内存池，提升重复播放响应速度并避免重复创建
const audioPool = new Map();

export function playPronunciation(word) {
  if (!word) return;
  const settings = loadSettings();
  const accent = settings.voiceAccent || '2'; // 1: 英音, 2: 美音
  const audioUrl = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + accent;

  // 1. 优先使用已存在的音频实例（避免频繁网络开销）
  let audio = audioPool.get(audioUrl);
  if (!audio) {
    audio = new Audio(audioUrl);
    // 控制池大小，防止内存过大
    if (audioPool.size > 150) {
      const firstKey = audioPool.keys().next().value;
      audioPool.delete(firstKey);
    }
    audioPool.set(audioUrl, audio);
  } else {
    audio.currentTime = 0;
  }

  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(function() {
      // 2. 网络受限或断网无声卡时，无缝切换系统离线语音合成兜底
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(word);
        utter.lang = accent === '1' ? 'en-GB' : 'en-US';
        utter.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    });
  }
}
