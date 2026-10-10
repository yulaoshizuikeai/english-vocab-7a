/**
 * 高清音频发音模块 (支持英音 / 美音切换、Cache API 离线持久化与语音兜底)
 */

import { loadSettings } from './storage.js';

const AUDIO_CACHE_NAME = 'vocab-audio-cache-v1';

export async function playPronunciation(word) {
  if (!word) return;
  const settings = loadSettings();
  const accent = settings.voiceAccent || '2'; // 1: 英音, 2: 美音
  const audioUrl = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + accent;

  // 1. 尝试从浏览器 Cache API 读取离线发音缓存（秒级免流播放）
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(AUDIO_CACHE_NAME);
      const cachedResponse = await cache.match(audioUrl);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const blobUrl = URL.createObjectURL(blob);
        const cachedAudio = new Audio(blobUrl);
        cachedAudio.onended = () => URL.revokeObjectURL(blobUrl);
        cachedAudio.onerror = () => URL.revokeObjectURL(blobUrl);
        await cachedAudio.play();
        return;
      }

      // 未命中缓存：异步下载并存入 Cache API (后台进行，不阻塞即时播放)
      fetch(audioUrl)
        .then((res) => {
          if (res.ok) cache.put(audioUrl, res.clone());
        })
        .catch(() => {});
    } catch (cacheErr) {
      // Cache API 异常时透明跳过，走常规播放
    }
  }

  // 2. 常规网络音频播放
  const audio = new Audio(audioUrl);
  audio.play().catch(function() {
    // 3. 网络故障或无声卡时系统语音兜底 (离线可用)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = accent === '1' ? 'en-GB' : 'en-US';
      utter.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
  });
}
