import os
import sys
import json
import re
import shutil
import genanki

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = r"D:\coding\english-vocab-7a"
DATA_DIR = os.path.join(BASE_DIR, "data")
AUDIO_DIR = r"C:\Users\Yu_233\Desktop\2024新课标沪教版初中英语_Anki闪卡包\audio"
MEDIA_DIR = r"C:\Users\Yu_233\AppData\Roaming\Anki2\User 1\collection.media"
DESKTOP_DIR = r"C:\Users\Yu_233\Desktop"
PACKAGE_DIR = r"C:\Users\Yu_233\Desktop\2024新课标沪教版初中英语_Anki闪卡包"

ROOT_DECK = "初中英语 (2024新课标沪教版)"

def clean_word_id(w):
    return re.sub(r'[^a-z0-9_-]', '_', re.sub(r"['’]", '', w.lower().strip())).strip('_')

# Inlined Collins CSS
collins_css_path = os.path.join(MEDIA_DIR, "_collins_c.css")
collins_css = ""
if os.path.exists(collins_css_path):
    with open(collins_css_path, "r", encoding="utf-8") as f:
        collins_css = f.read()

# Build pure CSS
MODEL_CSS = f"""
.card {{
 font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
 font-size: 16px;
 text-align: left;
 color: #2d3748;
 background-color: #f7fafc;
 padding: 14px;
 max-width: 720px;
 margin: 0 auto;
}}

.section {{
 color: #2d3748;
 border-bottom: 2px solid #e2e8f0;
 background-color: #ffffff;
 margin-top: 10px;
 padding: 10px 14px;
 position: relative;
 text-align: left;
 border-radius: 6px 6px 0 0;
 font-weight: 600;
}}

.extension {{
 font-size: 15px;
 line-height: 1.55em;
 border-bottom: 1px solid #e2e8f0;
 background-color: #ffffff;
 padding: 12px 14px;
 display: block;
 border-radius: 0 0 6px 6px;
}}

.word_header_star {{
 font-size: 16px;
 color: #f59e0b;
 position: absolute;
 right: 14px;
 top: 7px;
 letter-spacing: 2px;
}}

#english {{
 font-size: 38px;
 font-weight: 700;
 color: #1a202c;
 line-height: 1.15;
 padding: 14px 16px;
 border-bottom: 3px solid #3182ce;
 background-color: #ffffff;
 border-radius: 6px;
 box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}}

.phonetic {{
 font-size: 15px;
 font-weight: 400;
 color: #718096;
 margin-top: 6px;
 font-family: "Lucida Sans Unicode", "DejaVu Sans", sans-serif;
}}

.voice {{
 display: inline-block;
 vertical-align: middle;
 margin-left: 12px;
 font-size: 16px;
}}

#chinese {{
 font-size: 16px;
 line-height: 1.8;
 padding: 12px 14px;
 background: #ffffff;
 border-radius: 6px;
 border-left: 4px solid #38a169;
 margin-top: 10px;
 box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}}

#chinese a {{
 text-decoration: none;
 padding: 2px 7px 2px 6px;
 margin: 0 5px 0 0;
 font-size: 12px;
 color: white !important;
 font-weight: 600;
 border-radius: 4px;
 display: inline-block;
 line-height: 1.2;
 vertical-align: middle;
}}

#chinese a.pos_n {{ background-color: #e53e3e !important; }}
#chinese a.pos_v {{ background-color: #38a169 !important; }}
#chinese a.pos_vt {{ background-color: #38a169 !important; }}
#chinese a.pos_vi {{ background-color: #38a169 !important; }}
#chinese a.pos_a {{ background-color: #dd6b20 !important; }}
#chinese a.pos_adj {{ background-color: #dd6b20 !important; }}
#chinese a.pos_r {{ background-color: #805ad5 !important; }}
#chinese a.pos_adv {{ background-color: #805ad5 !important; }}
#chinese a.pos_ad {{ background-color: #805ad5 !important; }}
#chinese a.pos_phr {{ background-color: #3182ce !important; }}
#chinese a.pos_p {{ background-color: #0d9488 !important; }}
#chinese a.pos_prep {{ background-color: #0d9488 !important; }}
#chinese a.pos_pron {{ background-color: #9333ea !important; }}
#chinese a.pos_c {{ background-color: #d97706 !important; }}
#chinese a.pos_conj {{ background-color: #d97706 !important; }}
#chinese a.pos_num {{ background-color: #64748b !important; }}
#chinese a.pos_art {{ background-color: #475569 !important; }}

#vocab {{
 font-size: 13px;
 background-color: #69ac1d;
 height: 26px;
 border-radius: 6px 6px 0 0;
 border-bottom: none;
 cursor: pointer;
 color: white;
 font-weight: bold;
 padding: 4px 12px;
}}

#collins {{
 font-size: 13px;
 background-color: rgb(2,16,79);
 height: 26px;
 border-radius: 6px 6px 0 0;
 border-bottom: none;
 cursor: pointer;
 color: white;
 font-weight: bold;
 padding: 4px 12px;
}}

#ext_vocab {{
 display: block;
 background-color: #f7fafc;
 border: 1px solid #e2e8f0;
 border-top: none;
 padding: 14px;
 border-radius: 0 0 6px 6px;
 margin-bottom: 10px;
}}

#ext_collins {{
 display: block;
 background-color: #f7fafc;
 border: 1px solid #e2e8f0;
 border-top: none;
 padding: 14px;
 border-radius: 0 0 6px 6px;
 margin-bottom: 10px;
}}

{collins_css}
"""

MODEL_QFMT = """<div id="english" class="section">
  {{英语单词}}<span class="voice">{{英语发音}}</span>
  <div class="phonetic">{{英美音标}}</div>
</div>
"""

MODEL_AFMT = """{{FrontSide}}

<div id='ext_english'>
  <div id="chinese" class="extension">{{中文释义}}</div>

  {{#英语例句}}
  <div id="sentences" class="section" style="font-weight:600;font-size:14px;color:#2c5282;padding:8px 12px;background:#ebf8ff;border-bottom:2px solid #3182ce;border-radius:6px 6px 0 0;margin-top:10px;cursor:pointer;">
    📝 课文例句与真题语境
  </div>
  <div id="ext_sentences" class="extension" style="background:#ffffff;padding:12px 14px;border-left:4px solid #3182ce;border-radius:0 0 6px 6px;line-height:1.6;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
    <div class="sentence_en" style="color:#2d3748;font-size:15px;margin-bottom:6px;font-family:'Segoe UI',sans-serif;">{{英语例句}}</div>
    {{#中文例句}}
    <div class="sentence_zh" style="color:#718096;font-size:13px;line-height:1.5;">{{中文例句}}</div>
    {{/中文例句}}
  </div>
  {{/英语例句}}

  {{#vocabulary简明}}
  <div id="vocab" class="section" style="margin-top:10px;cursor:pointer;">
    <span>🌿 Vocabulary.com 语境解析</span>
  </div>
  <div id="ext_vocab" class="extension" style="line-height:1.6;padding:14px;background:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
    <div style="font-size:14.5px;color:#2d3748;">{{vocabulary简明}}</div>
    {{#vocabulary扩展}}
    <div style="font-size:13.5px;color:#4a5568;margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e0;">{{vocabulary扩展}}</div>
    {{/vocabulary扩展}}
  </div>
  {{/vocabulary简明}}

  {{#柯林斯解释}}
  <div id="collins" class="section" style="margin-top:10px;cursor:pointer;">
    <span>📘 COLLINS 柯林斯双解</span>
    <span class="word_header_star">{{柯林斯星级}}</span>
  </div>
  <div id="ext_collins" class="extension" style="background:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
    {{柯林斯解释}}
  </div>
  {{/柯林斯解释}}
</div>

<script>
(function(){
  function toggle(id) {
    var ext = document.getElementById("ext_" + id);
    if (!ext) return;
    if (ext.style.display === "none") {
      ext.style.display = "block";
    } else {
      ext.style.display = "none";
    }
  }
  var v = document.getElementById("vocab");
  if (v) v.onclick = function() { toggle("vocab"); };
  var c = document.getElementById("collins");
  if (c) c.onclick = function() { toggle("collins"); };
  var s = document.getElementById("sentences");
  if (s) s.onclick = function() { toggle("sentences"); };
})();
</script>
"""

model = genanki.Model(
    1740000000001,
    '英语单词模板(vocab配色·2024新课标)',
    fields=[
        {'name': '英语单词'},
        {'name': '英美音标'},
        {'name': '中文释义'},
        {'name': '英语例句'},
        {'name': '中文例句'},
        {'name': 'vocabulary简明'},
        {'name': 'vocabulary扩展'},
        {'name': '柯林斯星级'},
        {'name': '柯林斯解释'},
        {'name': '英语发音'},
    ],
    templates=[
        {
            'name': '英译中',
            'qfmt': MODEL_QFMT,
            'afmt': MODEL_AFMT,
        },
    ],
    css=MODEL_CSS
)

# Book configurations
BOOK_CONFIG = [
    {
        'id': '7a',
        'subdeck': f"{ROOT_DECK}::7A 七年级上册",
        'deck_id': 2024001,
        'title': '7A 七年级上册',
        'apkg_name': '初中英语_7A_全册.apkg',
        'txt_name': '初中英语_7A_全册单词卡.txt',
    },
    {
        'id': '7b',
        'subdeck': f"{ROOT_DECK}::7B 七年级下册",
        'deck_id': 2024002,
        'title': '7B 七年级下册',
        'apkg_name': '初中英语_7B_全册.apkg',
        'txt_name': '初中英语_7B_全册单词卡.txt',
    },
    {
        'id': '8a',
        'subdeck': f"{ROOT_DECK}::8A 八年级上册",
        'deck_id': 2024003,
        'title': '8A 八年级上册',
        'apkg_name': '初中英语_8A_全册.apkg',
        'txt_name': '初中英语_8A_全册单词卡.txt',
    },
    {
        'id': '8b',
        'subdeck': f"{ROOT_DECK}::8B 八年级下册",
        'deck_id': 2024004,
        'title': '8B 八年级下册',
        'apkg_name': '初中英语_8B_全册.apkg',
        'txt_name': '初中英语_8B_全册单词卡.txt',
    },
    {
        'id': '9a',
        'subdeck': f"{ROOT_DECK}::9A 九年级上册",
        'deck_id': 2024005,
        'title': '9A 九年级上册',
        'apkg_name': '初中英语_9A_全册.apkg',
        'txt_name': '初中英语_9A_全册单词卡.txt',
    },
    {
        'id': '9b',
        'subdeck': f"{ROOT_DECK}::9B 九年级下册",
        'deck_id': 2024006,
        'title': '9B 九年级下册',
        'apkg_name': '初中英语_9B_全册.apkg',
        'txt_name': '初中英语_9B_全册单词卡.txt',
    },
]

# Helper to format phonetic
def format_phonetic(p_raw, word):
    if not p_raw:
        return f"美 [{word}]"
    clean = p_raw.strip()
    if '英' in clean or '美' in clean:
        return clean.replace(' ', '&nbsp;')
    return f"英 [{clean}]&nbsp;美 [{clean}]"

# Helper to build audio tag
def build_audio_tag(w):
    wid = clean_word_id(w)
    us_file = f"{wid}_us.mp3"
    uk_file = f"{wid}_uk.mp3"
    
    tags = []
    # Check if files exist
    if os.path.isfile(os.path.join(AUDIO_DIR, us_file)) or os.path.isfile(os.path.join(MEDIA_DIR, us_file)):
        tags.append(f"[sound:{us_file}]")
    if os.path.isfile(os.path.join(AUDIO_DIR, uk_file)) or os.path.isfile(os.path.join(MEDIA_DIR, uk_file)):
        tags.append(f"[sound:{uk_file}]")
        
    if not tags:
        tags.append(f"[sound:{wid}_us.mp3]")
    return "".join(tags)

# 1. Process all books and build notes
print("\n--- Compiling Deck Cards ---")

all_notes_unified = []
deck_objects = {}
book_card_counts = {}

# Also load existing 7A cards
with open(os.path.join(DATA_DIR, "vocab-7a.json"), "r", encoding="utf-8") as f:
    vocab_7a = json.load(f)

# Also load phrases
phrases_deck_name = f"{ROOT_DECK}::06 中考必背核心词组与句型"
phrases_deck = genanki.Deck(2024007, phrases_deck_name)
phrase_card_rows = []

for cfg in BOOK_CONFIG:
    bid = cfg['id']
    deck_name = cfg['subdeck']
    deck_obj = genanki.Deck(cfg['deck_id'], deck_name)
    deck_objects[bid] = deck_obj
    
    vocab_file = os.path.join(DATA_DIR, f"vocab-{bid}.json")
    with open(vocab_file, "r", encoding="utf-8") as f:
        vocab = json.load(f)
        
    card_rows = []
    for item in vocab:
        w = item['word']
        phonetic = format_phonetic(item.get('phonetic', ''), w)
        
        # HTML definition
        if '_anki_def' in item:
            def_html = item['_anki_def']
        else:
            # build from meaning and pos
            pos = item.get('pos', 'n.')
            meaning = item.get('meaning', '')
            cls = 'pos_n'
            for k in ['v', 'adj', 'adv', 'prep', 'phr']:
                if k in pos:
                    cls = f'pos_{k[0]}'
            def_html = f'<a class="{cls}">{pos}</a>{meaning}'
            
        sentence_en = item.get('_sentence_en', item.get('phrase', ''))
        sentence_zh = item.get('_sentence_zh', f"这是课文例句与核心考点：{w}")
        vocab_short = item.get('_vocab_short', f"The word <b><u>{w}</u></b> is a key curricular word.")
        vocab_ext = item.get('_vocab_ext', f"Mastering <b><u>{w}</u></b> helps in examination contexts.")
        collins_star = item.get('_collins_star', "★★★☆☆")
        collins_html = item.get('_collins_html', f'<div class="tab_content"><div class="part_list"><span class="part_number">1</span><div class="part_list_d"><span class="word_header_word">{w}</span></div><ul><li>{item.get("meaning", w)}</li></ul></div></div>')
        audio_tag = build_audio_tag(w)
        
        fields = [
            w,
            phonetic,
            def_html,
            sentence_en,
            sentence_zh,
            vocab_short,
            vocab_ext,
            collins_star,
            collins_html,
            audio_tag
        ]
        
        note = genanki.Note(
            model=model,
            fields=fields,
            guid=genanki.guid_for(w, deck_name)
        )
        deck_obj.add_note(note)
        
        row_tsv = "\t".join(fields)
        card_rows.append(row_tsv)
        all_notes_unified.append((deck_name, row_tsv))
        
    book_card_counts[bid] = len(card_rows)
    print(f"  • {cfg['title']}: {len(card_rows)} cards")
    
    # Write individual txt file
    txt_path = os.path.join(PACKAGE_DIR, cfg['txt_name'])
    txt_lines = [
        '#separator:Tab',
        '#html:true',
        '#notetype:英语单词模板(vocab配色·2024新课标)',
        f'#deck:{deck_name}',
        *card_rows
    ]
    with open(txt_path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(txt_lines))

# 2. Add phrases
print("\nProcessing core phrases...")
for b in ['7a', '7b', '8a', '8b']:
    p_file = os.path.join(DATA_DIR, f"phrases-{b}.json")
    if os.path.exists(p_file):
        with open(p_file, "r", encoding="utf-8") as f:
            phrases = json.load(f)
            for p in phrases:
                text = p.get('phrase', '')
                trans = p.get('meaning', '')
                audio_tag = build_audio_tag(text)
                fields = [
                    text,
                    f"美 [{text}]",
                    f'<a class="pos_phr">phrase.</a>{trans}',
                    p.get('example', f"Pay close attention to the phrase: {text}."),
                    p.get('exampleZh', f"请牢记核心短语：{text}（{trans}）。"),
                    f"High-frequency middle-school exam phrase: <b><u>{text}</u></b>.",
                    f"Used across textbook lessons and reading comprehension.",
                    "★★★★☆",
                    f'<div class="tab_content"><div class="part_list"><span class="part_number">1</span><div class="part_list_d"><span class="word_header_word">{text}</span></div><ul><li>{trans}</li></ul></div></div>',
                    audio_tag
                ]
                note = genanki.Note(
                    model=model,
                    fields=fields,
                    guid=genanki.guid_for(text, phrases_deck_name)
                )
                phrases_deck.add_note(note)
                row_tsv = "\t".join(fields)
                phrase_card_rows.append(row_tsv)
                all_notes_unified.append((phrases_deck_name, row_tsv))

print(f"  • 06 中考必背短语: {len(phrase_card_rows)} cards")

# Write phrase txt file
phrase_txt_path = os.path.join(PACKAGE_DIR, "初中英语_中考必背短语卡.txt")
phrase_txt_lines = [
    '#separator:Tab',
    '#html:true',
    '#notetype:英语单词模板(vocab配色·2024新课标)',
    f'#deck:{phrases_deck_name}',
    *phrase_card_rows
]
with open(phrase_txt_path, "w", encoding="utf-8-sig") as f:
    f.write("\n".join(phrase_txt_lines))

# 3. Write Unified Master TXT (Desktop + Package folder)
unified_txt_desktop = os.path.join(DESKTOP_DIR, "初中英语_2024新课标沪教版_全套单词卡.txt")
unified_txt_pkg = os.path.join(PACKAGE_DIR, "初中英语_2024新课标沪教版_全套单词卡.txt")

unified_lines = [
    '#separator:Tab',
    '#html:true',
    '#notetype:英语单词模板(vocab配色·2024新课标)'
]
curr_d = ""
for dname, row in all_notes_unified:
    if dname != curr_d:
        curr_d = dname
        unified_lines.append(f'#deck:{curr_d}')
    unified_lines.append(row)

with open(unified_txt_desktop, "w", encoding="utf-8-sig") as f:
    f.write("\n".join(unified_lines))
shutil.copy2(unified_txt_desktop, unified_txt_pkg)
print(f"\n✅ Generated Master TXT: {unified_txt_desktop} ({len(all_notes_unified)} cards total)")

# 4. Collect Media Files
supporting_assets = ['_collins_c.css', '_collins_logo4.png', '_vocab_logo.png', '_jquery.js']
all_media_files = set()

# Search all referenced audios
for _, row in all_notes_unified:
    parts = row.split('\t')
    if len(parts) >= 10:
        audios = re.findall(r'\[sound:(.*?)\]', parts[9])
        for a in audios:
            all_media_files.add(a)

all_media_paths = []
for a in all_media_files:
    p1 = os.path.join(AUDIO_DIR, a)
    p2 = os.path.join(MEDIA_DIR, a)
    if os.path.isfile(p1):
        all_media_paths.append(p1)
    elif os.path.isfile(p2):
        all_media_paths.append(p2)

for asset in supporting_assets:
    p = os.path.join(MEDIA_DIR, asset)
    if os.path.isfile(p):
        all_media_paths.append(p)

print(f"Total media files for packaging: {len(all_media_paths)}")

# 5. Build Master APKG
print("\n📦 Generating Master APKG (All 6 books + Phrases)...")
all_deck_objs = list(deck_objects.values()) + [phrases_deck]
master_pkg = genanki.Package(all_deck_objs)
master_pkg.media_files = all_media_paths

master_apkg_desktop = os.path.join(DESKTOP_DIR, "初中英语_2024新课标沪教版_全套闪卡.apkg")
master_apkg_pkg = os.path.join(PACKAGE_DIR, "初中英语_2024新课标沪教版_全套闪卡.apkg")

master_pkg.write_to_file(master_apkg_desktop)
shutil.copy2(master_apkg_desktop, master_apkg_pkg)
print(f"✅ Generated Master APKG: {master_apkg_desktop} ({os.path.getsize(master_apkg_desktop) / (1024*1024):.2f} MB)")

# 6. Build Individual Book APKGs
print("\n📦 Generating Individual Book APKGs...")
for cfg in BOOK_CONFIG:
    bid = cfg['id']
    deck_obj = deck_objects[bid]
    
    # Filter media
    book_media = set()
    for note in deck_obj.notes:
        for a in re.findall(r'\[sound:(.*?)\]', note.fields[9]):
            book_media.add(a)
            
    b_paths = []
    for a in book_media:
        p1 = os.path.join(AUDIO_DIR, a)
        p2 = os.path.join(MEDIA_DIR, a)
        if os.path.isfile(p1):
            b_paths.append(p1)
        elif os.path.isfile(p2):
            b_paths.append(p2)
            
    for asset in supporting_assets:
        p = os.path.join(MEDIA_DIR, asset)
        if os.path.isfile(p):
            b_paths.append(p)
            
    pkg = genanki.Package(deck_obj)
    pkg.media_files = b_paths
    out_apkg = os.path.join(PACKAGE_DIR, cfg['apkg_name'])
    pkg.write_to_file(out_apkg)
    print(f"  • {cfg['title']}: {len(deck_obj.notes)} cards -> {cfg['apkg_name']} ({os.path.getsize(out_apkg) / (1024*1024):.2f} MB)")

# Phrase individual APKG
phrase_media = set()
for note in phrases_deck.notes:
    for a in re.findall(r'\[sound:(.*?)\]', note.fields[9]):
        phrase_media.add(a)
p_paths = []
for a in phrase_media:
    p1 = os.path.join(AUDIO_DIR, a)
    p2 = os.path.join(MEDIA_DIR, a)
    if os.path.isfile(p1):
        p_paths.append(p1)
    elif os.path.isfile(p2):
        p_paths.append(p2)
for asset in supporting_assets:
    p = os.path.join(MEDIA_DIR, asset)
    if os.path.isfile(p):
        p_paths.append(p)
pkg_phrase = genanki.Package(phrases_deck)
pkg_phrase.media_files = p_paths
pkg_phrase.write_to_file(os.path.join(PACKAGE_DIR, "初中英语_中考必背短语.apkg"))
print(f"  • 中考必背短语: {len(phrases_deck.notes)} cards -> 初中英语_中考必背短语.apkg")

print("\n🎉 ALL FULL CURRICULUM DECKS & APKGS SUCCESSFULLY GENERATED!")
