# -*- coding: utf-8 -*-
"""
從 ESPN 抓新球季「已完賽」的例行賽，寫成 raw/ 裡 build_data.py 讀得懂的檔案：
  raw/games_2026-27.txt      逐場比分（每次整個檔案重寫，不會有重複或漏掉的場次）
  raw/boxscores_2026-27.json 逐場的出手/罰球/籃板/失誤（算本季 PACE 用）。有快取：已經抓過的場次不會再抓，
                             所以第一次跑要幾分鐘，之後每次只抓新打完的比賽。

只收 STATUS_FINAL（已完賽）的比賽，打到一半或還沒打的不收。ESPN 日期是美東日期，和
Basketball-Reference 一致。任何一天或任何一場抓取失敗就直接報錯，不會默默少資料。

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
RAW = Path(__file__).parent / "raw"
OUT_FILE = RAW / "games_2026-27.txt"
BOX_FILE = RAW / "boxscores_2026-27.json"
URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={}"
NAME_FIX = {"LA Clippers": "Los Angeles Clippers"}  # ESPN 隊名 -> build_data.py 的 TEAMS 隊名


def fetch_json(url, what):
    last_err = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # 網路錯誤、JSON 壞掉都重試
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"{what} 抓取失敗（已重試 4 次）：{last_err}")


def games_of_day(d):
    out = []
    for e in fetch_json(URL.format(d.strftime("%Y%m%d")), str(d)).get("events", []):
        if e["status"]["type"]["name"] != "STATUS_FINAL" or e.get("season", {}).get("type") != 2:
            continue
        comp = e["competitions"][0]
        side = {c["homeAway"]: c for c in comp["competitors"]}
        names = {k: NAME_FIX.get(v["team"]["displayName"], v["team"]["displayName"]) for k, v in side.items()}
        unknown = set(names.values()) - set(TEAMS)
        if unknown:
            raise SystemExit(f"{d} 有 ESPN 隊名對不上 TEAMS：{sorted(unknown)}（請補 NAME_FIX）")
        out.append({
            "id": e["id"], "away": names["away"], "away_pts": int(side["away"]["score"]),
            "home": names["home"], "home_pts": int(side["home"]["score"]),
            "periods": int(e["status"]["period"]),  # 4 = 沒打延長賽，5 = 一節延長賽…
        })
    return out


def box_of_game(event_id, game):
    """單場 summary -> 兩隊的出手/罰球/籃板/失誤。"""
    teams = fetch_json(SUMMARY_URL.format(event_id), f"事件 {event_id} 的 boxscore")["boxscore"]["teams"]
    stats = {}
    for t in teams:
        name = NAME_FIX.get(t["team"]["displayName"], t["team"]["displayName"])
        s = {x["name"]: x["displayValue"] for x in t["statistics"]}
        fgm, fga = (int(v) for v in s["fieldGoalsMade-fieldGoalsAttempted"].split("-"))
        fta = int(s["freeThrowsMade-freeThrowsAttempted"].split("-")[1])
        stats[name] = {"fgm": fgm, "fga": fga, "fta": fta, "orb": int(s["offensiveRebounds"]),
                       "drb": int(s["defensiveRebounds"]), "tov": int(s["totalTurnovers"])}
    assert set(stats) == {game["away"], game["home"]}, f"事件 {event_id} boxscore 隊名對不上：{set(stats)}"
    return stats


def main(end):
    cache = json.loads(BOX_FILE.read_text(encoding="utf-8")) if BOX_FILE.exists() else {}
    lines, n, new_boxes = [], 0, 0
    d = SEASON_START
    while d <= end:
        stamp = datetime(d.year, d.month, d.day).strftime("%a, %b {}, %Y").format(d.day)  # Tue, Oct 20, 2026
        for g in games_of_day(d):
            lines.append(f"{stamp}|{g['away']}|{g['away_pts']}|{g['home']}|{g['home_pts']}")
            n += 1
            if g["id"] not in cache:
                cache[g["id"]] = {"date": d.isoformat(), "away": g["away"], "home": g["home"],
                                  "periods": g["periods"], "stats": box_of_game(g["id"], g)}
                new_boxes += 1
                time.sleep(0.3)
        d += timedelta(days=1)
        time.sleep(0.3)
    RAW.mkdir(exist_ok=True)
    OUT_FILE.write_text(f"##espn:{n}\n" + "\n".join(lines) + "\n", encoding="utf-8")
    # 一場一行，方便看 git diff
    ordered = sorted(cache.items(), key=lambda kv: (kv[1]["date"], kv[0]))
    BOX_FILE.write_text("{\n" + ",\n".join(f'"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in ordered) + "\n}\n",
                        encoding="utf-8")
    print(f"完成：{SEASON_START} ~ {end}，已完賽 {n} 場 -> {OUT_FILE}；boxscore 新抓 {new_boxes} 場，共 {len(cache)} 場 -> {BOX_FILE}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="從 ESPN 抓新球季已完賽比分與 boxscore，寫進 raw/")
    parser.add_argument("--end", type=date.fromisoformat, default=date.today(), help="抓到哪一天（預設今天）")
    main(parser.parse_args().end)
