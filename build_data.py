# -*- coding: utf-8 -*-
"""
把 raw/ 裡的 2025-26 例行賽原始資料，整理成網頁用的 data/teams.js。

資料是「凍結快照」：只含 2025-26 例行賽(前1230場，不含季後賽)，不會即時更新。
2026-27 開打後，把 raw/ 換成新球季的檔案、改下面 SEASON_LABEL，重跑一次即可。

執行：python build_data.py
"""
import json
from datetime import datetime
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
SEASON_LABEL = "2025-26"
GAME_FILES = ["games_2025-26_oct.txt", "games_2025-26_nov_to_june.txt"]
PACE_FILE = "pace_2025-26.txt"
REGULAR_SEASON_GAMES = 1230  # 30隊 x 82場 / 2
REGULAR_SEASON_END = datetime(2026, 4, 12)  # 例行賽最後一天，之後是附加賽/季後賽
# 原始資料混有一場「NBA盃決賽」(不計入例行賽戰績)，要排除：(日期, 客隊, 客隊得分, 主隊, 主隊得分)
EXCLUDED_GAMES = {(datetime(2025, 12, 16), "San Antonio Spurs", 113, "New York Knicks", 124)}

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


def load_games():
    games = []
    for name in GAME_FILES:
        for line in (RAW / name).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("##"):
                continue
            date_s, vis, vpts, home, hpts = line.split("|")
            d = datetime.strptime(date_s.strip(), "%a, %b %d, %Y")
            games.append((d, vis, int(vpts), home, int(hpts)))
    games.sort(key=lambda g: g[0])
    return [g for g in games if g[0] <= REGULAR_SEASON_END and g not in EXCLUDED_GAMES]


def load_pace():
    pace = {}
    for line in (RAW / PACE_FILE).read_text(encoding="utf-8").splitlines():
        if line.strip():
            team, p = line.strip().split("|")
            pace[team] = float(p)
    return pace


def main():
    games = load_games()
    pace = load_pace()
    assert len(games) == REGULAR_SEASON_GAMES, f"賽程筆數不對：{len(games)}"
    assert set(pace) == set(TEAMS), f"PACE隊名對不上：{set(pace) ^ set(TEAMS)}"

    log = defaultdict(list)  # 隊 -> [(得分, 失分, 是否主場)]，依日期排序
    for _, vis, vpts, home, hpts in games:
        log[vis].append((vpts, hpts, False))
        log[home].append((hpts, vpts, True))

    bad = {k: len(v) for k, v in log.items() if len(v) != 82}
    assert not bad, f"有球隊場次不是82場：{bad}"

    out = {}
    for en, (abbr, zh, conf, color) in TEAMS.items():
        g = log[en]
        n = len(g)
        last10 = g[-10:]
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
            "off": round(sum(p for p, _, _ in g) / n, 1),
            "def": round(sum(o for _, o, _ in g) / n, 1),
            "l10off": round(sum(p for p, _, _ in last10) / 10, 1),
            "l10def": round(sum(o for _, o, _ in last10) / 10, 1),
            "l10rec": f"{sum(1 for p, o, _ in last10 if p > o)}-{sum(1 for p, o, _ in last10 if p < o)}",
        }

    # 每對球隊的交手比分：key 是兩隊縮寫「依字母排序後用 - 連接」，值依日期排列，
    # 每場是 [字母序在前那隊得分, 字母序在後那隊得分]
    h2h = defaultdict(list)
    for _, vis, vpts, home, hpts in games:
        a, b = sorted([TEAMS[vis][0], TEAMS[home][0]])
        first_pts, second_pts = (vpts, hpts) if TEAMS[vis][0] == a else (hpts, vpts)
        h2h[f"{a}-{b}"].append([first_pts, second_pts])
    assert len(h2h) == 435, f"對戰組合數不對：{len(h2h)}"  # C(30,2)

    payload = {
        "season": SEASON_LABEL,
        "h2h": h2h,
        "asOf": games[-1][0].strftime("%Y-%m-%d"),
        "games": len(games),
        "homeAdvantage": 1,
        "teams": out,
    }
    target = ROOT / "data" / "teams.js"
    target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"完成：{len(out)} 隊，例行賽 {len(games)} 場，最後一場 {payload['asOf']} -> {target}")


if __name__ == "__main__":
    main()
