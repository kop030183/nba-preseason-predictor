# -*- coding: utf-8 -*-
"""
把 raw/ 裡的例行賽原始資料，整理成網頁用的 data/teams.js。

只收例行賽（日期 <= REGULAR_SEASON_END，再排除 EXCLUDED_GAMES 的盃賽決賽），不含附加賽/季後賽。
注意不能用「前 1230 場」切例行賽：盃賽決賽會被算進去。
新球季的比分由 fetch_espn_games.py 寫進 raw/，每次更新：先跑它，再跑這支。

兩種模式（改下面的 SEASON_COMPLETE，或執行時加 --complete / --in-progress 臨時覆蓋）：
- 整季完成：嚴格檢查 1230 場、每隊 82 場、435 組對戰，網頁 mode = "preseason"（拿整季數據當下一季的賽季前預測）
- 進行中：改檢查每隊場數 <= 82、主客場各 <= 41、沒有重複比賽、沒有未來日期，網頁 mode = "in_season"

執行：python build_data.py
"""
import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
SEASON_LABEL = "2026-27"
SEASON_COMPLETE = False  # True = 整季已打完；False = 球季進行中
GAME_FILES = ["games_2026-27.txt"]
PACE_FILE = "pace_2025-26.txt"  # 新球季的 PACE 還沒有，先沿用上季（PACE 對勝負判定影響很小）
REGULAR_SEASON_GAMES = 1230  # 30隊 x 82場 / 2
REGULAR_SEASON_END = datetime(2027, 4, 11)  # 例行賽最後一天，之後是附加賽/季後賽
# 原始資料混有一場「NBA盃決賽」(不計入例行賽戰績)，要排除：(日期, 客隊, 主隊)
# 只比對日期和隊伍，不比對比分（決賽打完前不知道比分，資料有一分誤差也不會漏排）。
# 2026-27 的盃賽決賽在 2026-12-11，兩隊 12/9 準決賽後才知道，到時再加進來。
# 盃賽小組賽、八強、四強都算例行賽，不用排除。
EXCLUDED_GAMES = set()

# 英文隊名 -> (縮寫, 中文名, 分區, 代表色)
TEAMS = {
    "Atlanta Hawks": ("ATL", "老鷹", "E", "#E03A3E"),
    "Boston Celtics": ("BOS", "塞爾提克", "E", "#007A33"),
    "Brooklyn Nets": ("BKN", "籃網", "E", "#5B5B5B"),
    "Charlotte Hornets": ("CHA", "黃蜂", "E", "#1D8CAB"),
    "Chicago Bulls": ("CHI", "公牛", "E", "#CE1141"),
    "Cleveland Cavaliers": ("CLE", "騎士", "E", "#860038"),
    "Dallas Mavericks": ("DAL", "獨行俠", "W", "#00538C"),
    "Denver Nuggets": ("DEN", "金塊", "W", "#FEC524"),
    "Detroit Pistons": ("DET", "活塞", "E", "#C8102E"),
    "Golden State Warriors": ("GSW", "勇士", "W", "#1D428A"),
    "Houston Rockets": ("HOU", "火箭", "W", "#CE1141"),
    "Indiana Pacers": ("IND", "溜馬", "E", "#FDBB30"),
    "Los Angeles Clippers": ("LAC", "快艇", "W", "#C8102E"),
    "Los Angeles Lakers": ("LAL", "湖人", "W", "#552583"),
    "Memphis Grizzlies": ("MEM", "灰熊", "W", "#5D76A9"),
    "Miami Heat": ("MIA", "熱火", "E", "#98002E"),
    "Milwaukee Bucks": ("MIL", "公鹿", "E", "#00471B"),
    "Minnesota Timberwolves": ("MIN", "灰狼", "W", "#236192"),
    "New Orleans Pelicans": ("NOP", "鵜鶘", "W", "#85714D"),
    "New York Knicks": ("NYK", "尼克", "E", "#F58426"),
    "Oklahoma City Thunder": ("OKC", "雷霆", "W", "#007AC1"),
    "Orlando Magic": ("ORL", "魔術", "E", "#0077C0"),
    "Philadelphia 76ers": ("PHI", "七六人", "E", "#006BB6"),
    "Phoenix Suns": ("PHX", "太陽", "W", "#E56020"),
    "Portland Trail Blazers": ("POR", "拓荒者", "W", "#E03A3E"),
    "Sacramento Kings": ("SAC", "國王", "W", "#5A2D81"),
    "San Antonio Spurs": ("SAS", "馬刺", "W", "#8A8D8F"),
    "Toronto Raptors": ("TOR", "暴龍", "E", "#CE1141"),
    "Utah Jazz": ("UTA", "爵士", "W", "#F9A01B"),
    "Washington Wizards": ("WAS", "巫師", "E", "#002B5C"),
}


def next_season_label(label):
    """'2025-26' -> '2026-27'"""
    start = int(label[:4]) + 1
    return f"{start}-{(start + 1) % 100:02d}"


class RawDataError(ValueError):
    """原始資料某一行解析失敗；訊息格式「檔名:行號: 原文 (原因)」。"""


def load_games(raw_dir):
    games = []
    for name in GAME_FILES:
        for lineno, raw_line in enumerate((raw_dir / name).read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("##"):
                continue
            try:
                date_s, vis, vpts, home, hpts = line.split("|")
                d = datetime.strptime(date_s.strip(), "%a, %b %d, %Y")
                game = (d, vis, int(vpts), home, int(hpts))
                unknown = {vis, home} - set(TEAMS)
                if unknown:
                    raise ValueError(f"隊名不在 TEAMS 裡：{sorted(unknown)}")
            except ValueError as e:
                raise RawDataError(f"{name}:{lineno}: {raw_line!r} ({e})") from None
            games.append(game)
    games.sort(key=lambda g: g[0])

    excluded = [g for g in games if (g[0], g[1], g[3]) in EXCLUDED_GAMES]
    # 資料已經涵蓋到排除日期、那場卻沒排到 -> 多半是日期或隊名設錯，直接報錯，不要默默算進例行賽
    # （「涵蓋到」只算今天以前的比賽；未來日期的資料另外由 check_no_duplicates_or_future 報錯）
    last_date = max((g[0] for g in games if g[0].date() <= date.today()), default=None)
    hit = {(g[0], g[1], g[3]) for g in excluded}
    missed = sorted(k for k in EXCLUDED_GAMES if last_date and k[0] <= last_date and k not in hit)
    assert not missed, "EXCLUDED_GAMES 設定了卻在資料裡找不到（日期, 客隊, 主隊）：" + str(
        [(f"{d:%Y-%m-%d}", v, h) for d, v, h in missed])

    kept = [g for g in games if g[0] <= REGULAR_SEASON_END and (g[0], g[1], g[3]) not in EXCLUDED_GAMES]
    return kept, excluded


def load_pace(raw_dir):
    pace = {}
    for lineno, raw_line in enumerate((raw_dir / PACE_FILE).read_text(encoding="utf-8").splitlines(), start=1):
        if raw_line.strip():
            try:
                team, p = raw_line.strip().split("|")
                pace[team] = float(p)
            except ValueError as e:
                raise RawDataError(f"{PACE_FILE}:{lineno}: {raw_line!r} ({e})") from None
    return pace


def check_no_duplicates_or_future(games, today):
    """兩種模式都檢查：沒有重複比賽、沒有未來日期。"""
    seen = set()
    for d, vis, _, home, _ in games:
        key = (d, vis, home)
        assert key not in seen, f"重複的比賽：{d:%Y-%m-%d} {vis} @ {home}"
        seen.add(key)
        assert d.date() <= today, f"未來日期的比賽：{d:%Y-%m-%d} {vis} @ {home}（今天是 {today}）"


def check_in_progress_limits(games):
    """只在進行中模式檢查：每隊場數 <= 82、主客場各 <= 41。

    整季完成模式不能檢查「主客場各 <= 41」：NBA 盃淘汰賽（中立場地）會讓真實的整季資料出現
    42/40 的主客場失衡（2025-26 的尼克、馬刺、雷霆、魔術都是），整季完成模式改靠「每隊剛好 82 場」把關。
    """
    home_n, road_n = defaultdict(int), defaultdict(int)
    for _, vis, _, home, _ in games:
        road_n[vis] += 1
        home_n[home] += 1
    too_many = {t: (home_n[t], road_n[t]) for t in TEAMS
                if home_n[t] + road_n[t] > 82 or home_n[t] > 41 or road_n[t] > 41}
    assert not too_many, (f"有球隊場次超過上限（主場, 客場；總場數<=82、主客場各<=41）：{too_many}。"
                          "若球季已接近尾聲（NBA 盃中立場地賽可能讓主客場變成 42/40），請改用 --complete")


def main(raw_dir, target, complete):
    games, excluded = load_games(raw_dir)
    pace = load_pace(raw_dir)
    assert games, "沒有任何比賽資料"
    assert set(pace) == set(TEAMS), f"PACE隊名對不上：{set(pace) ^ set(TEAMS)}"
    check_no_duplicates_or_future(games, date.today())
    if complete:
        assert len(games) == REGULAR_SEASON_GAMES, f"賽程筆數不對：{len(games)}"
    else:
        check_in_progress_limits(games)

    log = defaultdict(list)  # 隊 -> [(得分, 失分, 是否主場)]，依日期排序
    for _, vis, vpts, home, hpts in games:
        log[vis].append((vpts, hpts, False))
        log[home].append((hpts, vpts, True))

    if complete:
        bad = {k: len(v) for k, v in log.items() if len(v) != 82}
        assert not bad, f"有球隊場次不是82場：{bad}"

    out = {}
    for en, (abbr, zh, conf, color) in TEAMS.items():
        g = log[en]
        n = len(g)
        last10 = g[-10:]
        n10 = len(last10)  # 球隊還沒打滿 10 場時，分母是實際場數
        wins = sum(1 for p, o, _ in g if p > o)
        hw = sum(1 for p, o, h in g if h and p > o)
        hn = sum(1 for _, _, h in g if h)
        rw = sum(1 for p, o, h in g if not h and p > o)
        rn = n - hn
        out[en] = {
            "abbr": abbr, "zh": zh, "conf": conf, "color": color,
            "gp": n, "w": wins, "l": n - wins,
            "home": f"{hw}-{hn - hw}", "road": f"{rw}-{rn - rw}",
            "pace": pace[en],
            # 本季 0 場的球隊（進行中模式才會有）沒有平均可算，輸出 null，網頁會顯示「尚未出賽」
            "off": round(sum(p for p, _, _ in g) / n, 1) if n else None,
            "def": round(sum(o for _, o, _ in g) / n, 1) if n else None,
            "l10off": round(sum(p for p, _, _ in last10) / n10, 1) if n10 else None,
            "l10def": round(sum(o for _, o, _ in last10) / n10, 1) if n10 else None,
            "l10rec": f"{sum(1 for p, o, _ in last10 if p > o)}-{sum(1 for p, o, _ in last10 if p < o)}",
        }

    # 每對球隊的交手比分：key 是兩隊縮寫「依字母排序後用 - 連接」，值依日期排列，
    # 每場是 [字母序在前那隊得分, 字母序在後那隊得分]
    h2h = defaultdict(list)
    for _, vis, vpts, home, hpts in games:
        a, b = sorted([TEAMS[vis][0], TEAMS[home][0]])
        first_pts, second_pts = (vpts, hpts) if TEAMS[vis][0] == a else (hpts, vpts)
        h2h[f"{a}-{b}"].append([first_pts, second_pts])
    if complete:
        assert len(h2h) == 435, f"對戰組合數不對：{len(h2h)}"  # C(30,2)

    payload = {
        "season": SEASON_LABEL,
        "nextSeason": next_season_label(SEASON_LABEL),
        "mode": "preseason" if complete else "in_season",
        "h2h": h2h,
        "asOf": games[-1][0].strftime("%Y-%m-%d"),
        "games": len(games),
        "homeAdvantage": 1,
        "teams": out,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"完成（{'整季完成' if complete else '進行中'}模式）：{len(out)} 隊，例行賽 {len(games)} 場，"
          f"最後一場 {payload['asOf']}，排除 {len(excluded)} 場 -> {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="把 raw/ 的原始比分整理成 data/teams.js")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--complete", dest="complete", action="store_true", default=None,
                      help="當作整季已打完（嚴格檢查 1230 / 82 / 435）")
    mode.add_argument("--in-progress", dest="complete", action="store_false",
                      help="當作球季進行中（只檢查上限、重複、未來日期）")
    parser.add_argument("--raw-dir", type=Path, default=RAW, help="原始資料資料夾（預設 raw/）")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "teams.js", help="輸出檔（預設 data/teams.js）")
    args = parser.parse_args()
    try:
        main(args.raw_dir, args.out, SEASON_COMPLETE if args.complete is None else args.complete)
    except RawDataError as e:
        sys.exit(f"原始資料格式錯誤 {e}")
