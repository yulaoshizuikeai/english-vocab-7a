import os
import sys
import json
import re
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = r"D:\coding\english-vocab-7a"
DATA_DIR = os.path.join(BASE_DIR, "data")
AUDIO_DIR = r"C:\Users\Yu_233\Desktop\2024新课标沪教版初中英语_Anki闪卡包\audio"
MEDIA_DIR = r"C:\Users\Yu_233\AppData\Roaming\Anki2\User 1\collection.media"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(MEDIA_DIR, exist_ok=True)

def clean_word_id(w):
    return re.sub(r'[^a-z0-9_-]', '_', re.sub(r"['’]", '', w.lower().strip())).strip('_')

# Collect all words and phrases
all_words = {}

for b in ['7a', '7b', '8a', '8b', '9a', '9b']:
    p = os.path.join(DATA_DIR, f"vocab-{b}.json")
    if os.path.exists(p):
        with open(p, 'r', encoding='utf-8') as f:
            items = json.load(f)
            for it in items:
                w = it['word'].strip()
                wid = clean_word_id(w)
                if wid and wid not in all_words:
                    all_words[wid] = w

print(f"Total unique words/terms across all 6 books: {len(all_words)}")

def download_audio(word_text, wid, accent, type_code):
    filename = f"{wid}_{accent}.mp3"
    dest_anki = os.path.join(MEDIA_DIR, filename)
    dest_desktop = os.path.join(AUDIO_DIR, filename)
    
    # If already exists in both, skip
    if os.path.isfile(dest_anki) and os.path.isfile(dest_desktop) and os.path.getsize(dest_anki) > 500:
        return True
    if os.path.isfile(dest_desktop) and not os.path.isfile(dest_anki):
        try:
            import shutil
            shutil.copy2(dest_desktop, dest_anki)
            return True
        except:
            pass
    if os.path.isfile(dest_anki) and not os.path.isfile(dest_desktop):
        try:
            import shutil
            shutil.copy2(dest_anki, dest_desktop)
            return True
        except:
            pass

    # Download from Youdao Cloud TTS
    url = f"https://dict.youdao.com/dictvoice?audio={urllib.parse.quote(word_text)}&type={type_code}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req, timeout=8).read()
        if len(data) > 500: # Valid MP3
            with open(dest_anki, 'wb') as f:
                f.write(data)
            with open(dest_desktop, 'wb') as f:
                f.write(data)
            return True
    except Exception as e:
        # print(f"Error downloading {filename}: {e}")
        pass
    return False

# Plan downloads
tasks = []
for wid, text in all_words.items():
    # US audio (type=2)
    tasks.append((text, wid, 'us', '2'))
    # UK audio (type=1) for single words
    if ' ' not in text:
        tasks.append((text, wid, 'uk', '1'))

print(f"Total audio target files: {len(tasks)}")

missing_tasks = []
for text, wid, accent, type_code in tasks:
    filename = f"{wid}_{accent}.mp3"
    p1 = os.path.join(AUDIO_DIR, filename)
    p2 = os.path.join(MEDIA_DIR, filename)
    if not (os.path.isfile(p1) and os.path.getsize(p1) > 500):
        missing_tasks.append((text, wid, accent, type_code))

print(f"Existing audios: {len(tasks) - len(missing_tasks)}, Missing to download: {len(missing_tasks)}")

if missing_tasks:
    print(f"Downloading {len(missing_tasks)} missing audio files with 16 threads...")
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = [pool.submit(download_audio, t[0], t[1], t[2], t[3]) for t in missing_tasks]
        done_count = sum(1 for f in futures if f.result())
    print(f"Successfully downloaded {done_count} / {len(missing_tasks)} audio files!")
else:
    print("All audio files are already complete and verified on disk!")
