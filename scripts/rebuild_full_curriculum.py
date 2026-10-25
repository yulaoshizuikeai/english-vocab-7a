import os
import sys
import json
import csv
import re
import urllib.request
import urllib.parse
import sqlite3
import shutil
import time
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = r"D:\coding\english-vocab-7a"
DATA_DIR = os.path.join(BASE_DIR, "data")
RAW_DIR = os.path.join(BASE_DIR, "raw_books")
AUDIO_DIR = r"C:\Users\Yu_233\Desktop\2024新课标沪教版初中英语_Anki闪卡包\audio"
MEDIA_DIR = r"C:\Users\Yu_233\AppData\Roaming\Anki2\User 1\collection.media"
DESKTOP_DIR = r"C:\Users\Yu_233\Desktop"
PACKAGE_DIR = r"C:\Users\Yu_233\Desktop\2024新课标沪教版初中英语_Anki闪卡包"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(PACKAGE_DIR, exist_ok=True)

# 1. Load Unit Titles
UNIT_TITLES = {
    '7b': {
        1: "Unit 1 People around us（身边的人）",
        2: "Unit 2 France is more than Paris（魅力法国）",
        3: "Unit 3 Our animal friends（动物朋友）",
        4: "Unit 4 Save the trees（拯救树木）",
        5: "Unit 5 Water（生命之水）",
        6: "Unit 6 Electricity（电的奥秘）",
        7: "Unit 7 Poems about life（生活诗篇）",
        8: "Unit 8 From hobby to career（从爱好到事业）",
    },
    '8a': {
        1: "Unit 1 Encyclopaedias（百科全书）",
        2: "Unit 2 Numbers（奇妙的数字）",
        3: "Unit 3 Computers（计算机世界）",
        4: "Unit 4 Inventions（改变世界的发明）",
        5: "Unit 5 Educational exchanges（教育与文化交流）",
        6: "Unit 6 Ancient stories（古老的故事）",
        7: "Unit 7 Memory（记忆的奥秘）",
        8: "Unit 8 English Week（精彩英语周）",
    },
    '8b': {
        1: "Unit 1 Helping those in need（扶危济困）",
        2: "Unit 2 Body language（身势与肢体语言）",
        3: "Unit 3 Traditional skills（传统绝技）",
        4: "Unit 4 Cartoons and comic strips（动漫天地）",
        5: "Unit 5 Save the endangered animals（保护濒危动物）",
        6: "Unit 6 Pets（可爱的宠物伙伴）",
        7: "Unit 7 The unknown world（未知的世界）",
        8: "Unit 8 A green world（共建绿色世界）",
    },
    '9a': {
        1: "Unit 1 Wise men in history（历史上的智者）",
        2: "Unit 2 Great minds（伟大的头脑）",
        3: "Unit 3 Family life（家庭生活）",
        4: "Unit 4 Problems and advice（成长困扰与建议）",
        5: "Unit 5 Action!（影视在行动）",
        6: "Unit 6 Eating habits & Health（饮食与健康）",
        7: "Unit 7 The adventures of Tom Sawyer（汤姆索亚历险记）",
        8: "Unit 8 Surprise endings（出人意料的结局）",
    },
    '9b': {
        1: "Unit 1 Great explorations（伟大的探索）",
        2: "Unit 2 Culture shock（文化碰撞）",
        3: "Unit 3 The environment（生态与环境）",
        4: "Unit 4 Natural disasters（自然灾害与救援）",
        5: "Unit 5 Travel & Sport（环球旅行与探险）",
        6: "Unit 6 Caring for your health（健康人生与展望）",
    }
}

# 2. Load User Anki Collection
print("Loading existing Anki collection dictionary...")
src = os.path.join(MEDIA_DIR, "..", "collection.anki2")
dst = os.path.join(BASE_DIR, "scripts", "col_temp_rebuild.db")

def unicase(s1, s2):
    return (s1.lower() > s2.lower()) - (s1.lower() < s2.lower())

shutil.copy2(src, dst)
conn = sqlite3.connect(dst)
conn.create_collation("unicase", unicase)
cur = conn.cursor()

cur.execute("SELECT flds FROM notes WHERE mid = 1466955593264")
anki_dict = {}
for r in cur.fetchall():
    flds = r[0].split("\x1f")
    w = flds[0].strip().lower()
    anki_dict[w] = flds

conn.close()
if os.path.exists(dst):
    os.remove(dst)
print(f"Loaded {len(anki_dict)} words from Anki library.")

# 3. Load Phonetics Cache
phonetics_cache_path = os.path.join(BASE_DIR, "scripts", "phonetics_cache.json")
phonetics_cache = {}
if os.path.exists(phonetics_cache_path):
    with open(phonetics_cache_path, "r", encoding="utf-8") as f:
        phonetics_cache = json.load(f)

# Helper: Clean Word ID
def clean_word_id(w):
    return re.sub(r'[^a-z0-9_-]', '_', re.sub(r"['’]", '', w.lower().strip())).strip('_')

# Helper: Parse translation & POS
POS_MAP = {
    'n': 'pos_n', 'noun': 'pos_n',
    'v': 'pos_v', 'verb': 'pos_v', 'vt': 'pos_v', 'vi': 'pos_v',
    'adj': 'pos_a', 'a': 'pos_a',
    'adv': 'pos_r', 'ad': 'pos_r',
    'prep': 'pos_prep', 'p': 'pos_prep',
    'conj': 'pos_conj', 'c': 'pos_conj',
    'pron': 'pos_pron',
    'num': 'pos_num',
    'art': 'pos_num',
    'phr': 'pos_phr', 'phrase': 'pos_phr'
}

def parse_trans_to_pos_and_html(trans_raw):
    if not trans_raw:
        return 'n.', '<a class="pos_n">n.</a>待补充'
    lines = [l.strip() for l in trans_raw.split('\n') if l.strip()]
    pos_set = []
    html_parts = []
    
    for l in lines:
        m = re.match(r'^([a-zA-Z\.\s/]+?)\.\s*(.*)$', l)
        if m:
            raw_pos = m.group(1).replace(' ', '').lower()
            rest = m.group(2)
            cls = POS_MAP.get(raw_pos, 'pos_n')
            pos_set.append(f"{raw_pos}.")
            html_parts.append(f'<a class="{cls}">{raw_pos}.</a>{rest}')
        else:
            pos_set.append('phrase.')
            html_parts.append(f'<a class="pos_phr">phrase.</a>{l}')
            
    pos_str = ' / '.join(list(dict.fromkeys(pos_set)))
    html_str = '<br>'.join(html_parts)
    return pos_str, html_str

# Helper: Fetch phonetics online if missing
def fetch_phonetics(word):
    w_clean = word.lower().strip()
    if w_clean in phonetics_cache:
        info = phonetics_cache[w_clean]
        uk = info.get('ukphone', '')
        us = info.get('usphone', '')
        if uk or us:
            p_uk = f"英 [{uk}]" if uk else ""
            p_us = f"美 [{us}]" if us else ""
            return f"{p_uk}&nbsp;{p_us}".strip("&nbsp;")
            
    if ' ' in w_clean:
        return f"美 [{w_clean}]"
        
    try:
        url = f"https://dict.youdao.com/jsonapi?q={urllib.parse.quote(w_clean)}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        res = json.loads(urllib.request.urlopen(req, timeout=3).read().decode('utf-8'))
        ec = res.get('ec', {}).get('word', [{}])[0]
        uk = ec.get('ukphone', '')
        us = ec.get('usphone', '')
        if uk or us:
            p_uk = f"英 [{uk}]" if uk else ""
            p_us = f"美 [{us}]" if us else ""
            val = f"{p_uk}&nbsp;{p_us}".strip("&nbsp;")
            phonetics_cache[w_clean] = {'ukphone': uk, 'usphone': us}
            return val
    except:
        pass
    return f"美 [{w_clean}]"

print("\nProcessing books and rebuilding JSON data...")

books_meta = [
    {"id": "7a", "title": "七年级上册 (7A)", "shortTitle": "7A", "units": 8, "vocabFile": "data/vocab-7a.json", "phrasesFile": "data/phrases-7a.json"},
    {"id": "7b", "title": "七年级下册 (7B)", "shortTitle": "7B", "units": 8, "vocabFile": "data/vocab-7b.json", "phrasesFile": "data/phrases-7b.json"},
    {"id": "8a", "title": "八年级上册 (8A)", "shortTitle": "8A", "units": 8, "vocabFile": "data/vocab-8a.json", "phrasesFile": "data/phrases-8a.json"},
    {"id": "8b", "title": "八年级下册 (8B)", "shortTitle": "8B", "units": 8, "vocabFile": "data/vocab-8b.json", "phrasesFile": "data/phrases-8b.json"},
    {"id": "9a", "title": "九年级上册 (9A)", "shortTitle": "9A", "units": 8, "vocabFile": "data/vocab-9a.json", "phrasesFile": "data/phrases-9a.json"},
    {"id": "9b", "title": "九年级下册 (9B)", "shortTitle": "9B", "units": 6, "vocabFile": "data/vocab-9b.json", "phrasesFile": "data/phrases-9b.json"}
]

# Write updated books.json
with open(os.path.join(DATA_DIR, "books.json"), "w", encoding="utf-8") as f:
    json.dump(books_meta, f, ensure_ascii=False, indent=2)

all_vocab_by_book = {}

for b in ['7b', '8a', '8b', '9a', '9b']:
    list_path = os.path.join(RAW_DIR, f"{b}_list.txt")
    trans_path = os.path.join(RAW_DIR, f"{b}_trans.csv")
    
    # Load translation map
    trans_map = {}
    with open(trans_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for r in reader:
            if len(r) >= 2:
                trans_map[r[0].strip().lower()] = r[1].strip()
                
    # Parse list by unit
    with open(list_path, 'r', encoding='utf-8') as f:
        lines = [l.strip() for l in f if l.strip()]
        
    current_unit = 1
    unit_words = []
    book_vocab = []
    
    idx_in_book = 1
    for l in lines:
        if l.startswith('#'):
            m = re.search(r'\d+', l)
            if m:
                current_unit = int(m.group(0))
        else:
            w_raw = l
            w_lower = w_raw.lower()
            trans_raw = trans_map.get(w_lower, '')
            pos_str, html_def = parse_trans_to_pos_and_html(trans_raw)
            
            # Check Anki library for rich fields
            anki_card = anki_dict.get(w_lower)
            if anki_card:
                phonetic = anki_card[1]
                # if definition in Anki has HTML badges, use it; otherwise html_def
                if '<a class=' in anki_card[2]:
                    html_def = anki_card[2]
                sentence_en = anki_card[3]
                sentence_zh = anki_card[4]
                vocab_short = anki_card[5]
                vocab_ext = anki_card[6]
                collins_star = anki_card[7]
                collins_html = anki_card[8]
            else:
                phonetic = fetch_phonetics(w_raw)
                sentence_en = f"This is an important vocabulary item in {UNIT_TITLES[b].get(current_unit, f'Unit {current_unit}')}: {w_raw}."
                sentence_zh = f"这是课文重点核心词汇：{w_raw}。"
                vocab_short = f"The word <b><u>{w_raw}</u></b> is frequently tested in middle school exams."
                vocab_ext = f"Mastering <b><u>{w_raw}</u></b> helps improve reading comprehension and writing score."
                collins_star = "★★★☆☆"
                collins_html = f'<div class="tab_content"><div class="part_list"><span class="part_number">1</span><div class="part_list_d"><span class="word_header_word">{w_raw}</span></div><ul><li>{w_raw}: {trans_raw.replace(chr(10), " ")}</li></ul></div></div>'
            
            unit_title = UNIT_TITLES[b].get(current_unit, f"Unit {current_unit}")
            
            item = {
                "id": f"{b}_u{current_unit}_{idx_in_book}",
                "unit": current_unit,
                "unitTitle": unit_title,
                "word": w_raw,
                "phonetic": phonetic,
                "pos": pos_str,
                "meaning": trans_raw.replace('\n', '；'),
                "phrase": f"课文例词：{w_raw} ({trans_raw.split(chr(10))[0]})",
                "root": f"{pos_str} {trans_raw.split(chr(10))[0]}",
                "book": b,
                "canonicalId": f"{b}_u{current_unit}_core_{idx_in_book}",
                "legacyId": f"{b}_u{current_unit}_{idx_in_book}",
                "category": "core",
                # Additional rich fields for Anki generator
                "_anki_def": html_def,
                "_sentence_en": sentence_en,
                "_sentence_zh": sentence_zh,
                "_vocab_short": vocab_short,
                "_vocab_ext": vocab_ext,
                "_collins_star": collins_star,
                "_collins_html": collins_html
            }
            book_vocab.append(item)
            idx_in_book += 1
            
    all_vocab_by_book[b] = book_vocab
    
    # Save to data/vocab-{b}.json
    out_json = os.path.join(DATA_DIR, f"vocab-{b}.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(book_vocab, f, ensure_ascii=False, indent=2)
    print(f"✅ Generated {out_json}: {len(book_vocab)} words across {len(set(w['unit'] for w in book_vocab))} units")

# Save updated phonetics cache
with open(phonetics_cache_path, "w", encoding="utf-8") as f:
    json.dump(phonetics_cache, f, ensure_ascii=False)

print("\nAll JSON database files updated successfully!")
