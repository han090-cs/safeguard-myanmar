"""Builds the やさしい日本語 files (simple words, hard kanji written in hiragana) from the standard Japanese files.
Run: python3 tools/make_ja_easy.py   (needs: pip install pykakasi)"""
import json, re, pykakasi
from pathlib import Path
I = Path(__file__).resolve().parent.parent / "i18n"
KEEP = set("日月火水木金土年時分秒今中大小高低上下人出入見行来本間前後午何先生道北南東西国円少多強弱暑寒新古長車病院町天気雨雪風山川外休食飲子体手目耳口足頭近遠早遅同正他全度週毎合計使作話語音楽安店駅家会社電話買売着働歩走立座開閉明暗白黒赤青方向不世主事京仕代以住便借元兄光写冬別力勉動区医去台味品員問回図地堂場声夏夕夜太好妹姉始字室屋工市思急悪意所持教文料旅族昼曜有服村林果歌止死民池注洋洗海牛特犬理産用田画界発県真知短私秋究答紙終習考者肉自色英茶菜薬親試説貸質起転軽送通進運都重野銀門陽集電静題顔飛館首験報警予確認情災害洪危険温湿気象雷霧潮波嵐火災対策安全必要情報公式発表表示予測今日明日昨日夕朝昼夜時間場所作物畑土肥料種収穫万千百")
# simpler words / phrasing, applied before the kanji → hiragana step (longest first)
SIMPLE = [
 ("おそれがあります", "かもしれません"), ("のおそれ", "かもしれません"), ("おそれ", "しんぱい"),
 ("非常に強い", "とても強い"), ("非常に", "とても"), ("極端な", "ものすごい"), ("極端", "ものすごい"),
 ("着氷性の", "こおる"), ("着氷性", "こおる"), ("冠水する", "水がたまる"), ("冠水", "水がたまること"),
 ("洪水・土砂災害", "洪水や山のくずれ"), ("土砂災害", "山のくずれ"),
 ("控えましょう", "やめましょう"), ("控えて", "やめて"), ("不要な外出", "出かけなくてもいい用事"),
 ("従ってください", "守ってください"), ("従って", "守って"), ("当局", "役所"), ("指示", "言うこと"),
 ("有害", "体によくない"), ("一般的", "ふつう"), ("推定", "よそう"), ("一時的", "少しのあいだ"),
 ("猛暑", "とても暑い日"), ("熱中症", "ねっちゅうしょう（暑さで具合が悪くなること）"),
 ("注視", "よく見"), ("観測所", "天気をはかる所"), ("基準", "きまり"), ("取得", "とる"),
 ("読み込み", "よみこみ"), ("再試行", "もう一度ためす"), ("深刻", "とてもわるい"), ("不明", "わからない"),
 ("可能性", "かのうせい"), ("目安", "めやす"), ("精度", "正しさ"), ("免責", "ちゅうい"),
]
SIMPLE.sort(key=lambda p: -len(p[0]))
K = pykakasi.kakasi()
KANJI = re.compile(r"[一-鿿]")
def easy(s):
    if not isinstance(s, str): return s
    for a, b in SIMPLE: s = s.replace(a, b)
    out = []
    for tok in K.convert(s):
        o = tok["orig"]
        if KANJI.search(o) and not all((not KANJI.fullmatch(c)) or c in KEEP for c in o): out.append(tok["hira"])
        else: out.append(o)
    r = "".join(out)
    return re.sub(r"\{(\w+)\}", lambda m: m.group(0), r)
def walk(o):
    if isinstance(o, str): return easy(o)
    if isinstance(o, dict): return {k: walk(v) for k, v in o.items()}
    if isinstance(o, list): return [walk(v) for v in o]
    return o
for name in ("ja", "scales_ja", "weather_codes_ja"):
    d = json.load(open(I / f"{name}.json", encoding="utf8"))
    json.dump(walk(d), open(I / f"{name.replace('ja','ja_easy')}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("ok")
