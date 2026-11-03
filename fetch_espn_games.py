# -*- coding: utf-8 -*-
"""
從 ESPN 計分板抓新球季「已完賽」的例行賽比分，寫成 raw/ 裡 build_data.py 讀得懂的格式。

可重複執行：每次都從球季第一天抓到今天，整個檔案重寫（所以不會有重複或漏掉的場次）。
只收 STATUS_FINAL（已完賽）的比賽，打到一半或還沒打的不收。ESPN 日期是美東日期，和
Basketball-Reference 一致。任何一天抓取失敗就直接報錯，不會默默少一天。

執行：python fetch_espn_games.py
      python fetch_espn_games.py --end 2026-11-10     （只抓到指定日期）
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True  # 別在專案資料夾留下 __pycache__
from build_data import TEAMS  # noqa: E402

SEASON_START = date(2026, 10, 20)  # 2026-27 開幕夜
OUT_FILE = Path(__file__).parent / "raw" / "games_2026-27.txt"
URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
NAME_FIX = {"LA Clippers": "Los Angeles Clippers"}  # ESPN 隊名 -> build_data.py 的 TEAMS 隊名


def fetch_day(d):
    last_err = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(d.strftime("%Y%m%d")), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except Exception as e:  # 網路錯誤、JSON 壞掉都重試
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"{d} 抓取失敗（已重試 4 次）：{last_err}")


def games_of_day(d):
    out = []
    for e in fetch_day(d).get("events", []):
        if e["status"]["type"]["name"] != "STATUS_FINAL" or e.get("season", {}).get("type") != 2:
            continue
        comp = e["competitions"][0]
        side = {c["homeAway"]: c for c in comp["competitors"]}
        names = {k: NAME_FIX.get(v["team"]["displayName"], v["team"]["displayName"]) for k, v in side.items()}
        unknown = set(names.values()) - set(TEAMS)
        if unknown:
            raise SystemExit(f"{d} 有 ESPN 隊名對不上 TEAMS：{sorted(unknown)}（請補 NAME_FIX）")
        out.append((names["away"], int(side["away"]["score"]), names["home"], int(side["home"]["score"])))
    return out


def main(end):
    lines, n = [], 0
    d = SEASON_START
    while d <= end:
        stamp = datetime(d.year, d.month, d.day).strftime("%a, %b {}, %Y").format(d.day)  # Tue, Oct 20, 2026
        for vis, vpts, home, hpts in games_of_day(d):
            lines.append(f"{stamp}|{vis}|{vpts}|{home}|{hpts}")
            n += 1
        d += timedelta(days=1)
        time.sleep(0.3)
    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text(f"##espn:{n}\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"完成：{SEASON_START} ~ {end}，已完賽 {n} 場 -> {OUT_FILE}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="從 ESPN 抓新球季已完賽比分，寫成 raw/games_2026-27.txt")
    parser.add_argument("--end", type=date.fromisoformat, default=date.today(), help="抓到哪一天（預設今天）")
    main(parser.parse_args().end)
