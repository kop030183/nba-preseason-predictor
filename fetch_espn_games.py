# -*- coding: utf-8 -*-
"""
從 ESPN 抓新球季「已完賽」的例行賽，寫成 raw/ 裡 build_data.py 讀得懂的檔案：
  raw/games_2026-27.txt      逐場比分（每次整個檔案重寫，不會有重複或漏掉的場次）
  raw/boxscores_2026-27.json 逐場的出手/罰球/籃板/失誤（算本季 PACE 用）。有快取：已經抓過的場次不會再抓，
                             所以第一次跑要幾分鐘，之後每次只抓新打完的比賽。

只收 STATUS_FINAL（已完賽）的比賽，打到一半或還沒打的不收。ESPN 日期是美東日期，和
Basketball-Reference 一致。任何一天或任何一場抓取失敗就直接報錯，不會默默少資料。

另外也會抓賽程（從 SCHEDULE_START 到例行賽最後一天，含已打完的，網頁才能看過去幾天的賽前預測），寫成 raw/schedule_2026-27.json，給網頁的賽程分頁用。
賽程每次都整個重抓（賽程會改期、盃賽決賽的兩隊要打完四強才知道），ESPN 不支援一次抓一段日期，
所以是一天一天抓，約 170 次請求、首次約一分鐘。

執行：python fetch_espn_games.py
      python fetch_espn_games.py --end 2026-11-10     （只抓到指定日期）
      python fetch_espn_games.py --no-schedule        （不更新賽程）
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
SCHEDULE_FILE = RAW / "schedule_2026-27.json"
ODDS_FILE = RAW / "odds_2026-27.json"  # 已完賽比賽的賭盤紀錄（開盤與收盤）
SEASON_END = date(2027, 4, 11)  # 例行賽最後一天（美東日期）
# 賽程從哪個美東日期開始抓：網頁賽程分頁最早能看的台灣日期（build_data.py 的 SCHEDULE_SHOW_FROM）
# 要往前推一天，因為台灣日期通常是美東日期的隔天（2026-11-03 台灣 = 美東 11/2 的比賽）
SCHEDULE_START = date(2026, 10, 31)
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


def schedule_of_day(d):
    """某個美東日期的所有例行賽（含還沒打的、打完的），給賽程分頁用。隊名是 'TBD' 的（盃賽決賽）記成 None。"""
    out = []
    for e in fetch_json(URL.format(d.strftime("%Y%m%d")), f"{d} 賽程").get("events", []):
        if e.get("season", {}).get("type") != 2:
            continue
        comp = e["competitions"][0]
        side = {c["homeAway"]: c for c in comp["competitors"]}
        names = {}
        for k, c in side.items():
            raw = c["team"].get("displayName", "")
            name = NAME_FIX.get(raw, raw)
            if name not in TEAMS and raw != "TBD":
                raise SystemExit(f"{d} 賽程有 ESPN 隊名對不上 TEAMS：{raw}（請補 NAME_FIX）")
            names[k] = name if name in TEAMS else None
        notes = [n.get("headline") for n in comp.get("notes", []) if n.get("headline")]
        final = e["status"]["type"]["name"] == "STATUS_FINAL"
        out.append({
            "id": e["id"], "utc": e["date"], "away": names["away"], "home": names["home"],
            "status": e["status"]["type"]["name"], "neutral": bool(comp.get("neutralSite")),
            "note": notes[0] if notes else None,
            "away_pts": int(side["away"]["score"]) if final else None,
            "home_pts": int(side["home"]["score"]) if final else None,
        })
    return out


def write_schedule():
    first = SCHEDULE_START
    games, d = {}, first
    while d <= SEASON_END:
        for g in schedule_of_day(d):
            games[g["id"]] = g
        d += timedelta(days=1)
        time.sleep(0.2)
    ordered = sorted(games.values(), key=lambda g: (g["utc"], g["id"]))
    SCHEDULE_FILE.write_text(
        "[\n" + ",\n".join(json.dumps(g, ensure_ascii=False) for g in ordered) + "\n]\n", encoding="utf-8")
    print(f"賽程：{first} ~ {SEASON_END}（美東日期），共 {len(ordered)} 場 -> {SCHEDULE_FILE}")


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


def _num(s):
    """盤口文字轉數字：'+4.5' -> 4.5、'o229.5' -> 229.5、'-110' -> -110.0、'EVEN' / 'PK' -> 0（讓分平手）。"""
    if s is None:
        return None
    s = str(s).strip().lstrip("ou")
    if s.upper() in ("EVEN", "PK", "PICK"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def _pair(node):
    """盤口節點 {'open': {...}, 'close': {...}} -> [開盤, 收盤]（line 優先，沒有就取 odds）。"""
    out = []
    for k in ("open", "close"):
        x = (node or {}).get(k) or {}
        out.append(_num(x.get("line") if x.get("line") is not None else x.get("odds")))
    return out


def odds_of_game(event_id):
    """單場 summary 的 pickcenter -> 賭盤紀錄（DraftKings）；查不到盤口回傳 None。已完賽的比賽這裡是收盤（開賽前最後）盤口。"""
    pcs = fetch_json(SUMMARY_URL.format(event_id), f"事件 {event_id} 的盤口").get("pickcenter") or []
    pc = pcs[0] if pcs else None
    if not pc or pc.get("overUnder") is None or not pc.get("pointSpread"):
        return None
    ps, tot, ml = pc["pointSpread"], pc.get("total") or {}, pc.get("moneyline") or {}
    odds_pair = lambda n: [_num((n.get(k) or {}).get("odds")) for k in ("open", "close")]
    return {
        "provider": (pc.get("provider") or {}).get("name"),
        "spread_home": _pair(ps.get("home")),            # 主隊讓分 [開盤, 收盤]，負 = 主隊讓分（熱門）
        "spread_odds": {"home": odds_pair(ps.get("home") or {}), "away": odds_pair(ps.get("away") or {})},
        "total": _pair(tot.get("over")),                  # 總分 [開盤, 收盤]
        "total_odds": {"over": odds_pair(tot.get("over") or {}), "under": odds_pair(tot.get("under") or {})},
        "moneyline": {"home": odds_pair(ml.get("home") or {}), "away": odds_pair(ml.get("away") or {})},
    }


def write_odds():
    """已完賽比賽的賭盤紀錄 -> raw/odds_2026-27.json（以 ESPN 事件編號為鍵，增量：記過的不重抓）。
    ESPN 賽事列表在比賽打完後會把盤口拿掉，所以趁還查得到時存下來，網頁已完賽的預測頁就從這裡讀。"""
    if not SCHEDULE_FILE.exists():
        return
    cache = json.loads(ODDS_FILE.read_text(encoding="utf-8")) if ODDS_FILE.exists() else {}
    new = missing = 0
    for g in json.loads(SCHEDULE_FILE.read_text(encoding="utf-8")):
        if g["status"] != "STATUS_FINAL" or not g["away"] or not g["home"] or g["id"] in cache:
            continue
        rec = odds_of_game(g["id"])
        time.sleep(0.3)
        if rec is None:
            missing += 1  # 這場查不到盤口：不存，下次更新再試
            continue
        cache[g["id"]] = {"utc": g["utc"], "away": g["away"], "home": g["home"], **rec}
        new += 1
    ordered = sorted(cache.items(), key=lambda kv: (kv[1]["utc"], kv[0]))
    ODDS_FILE.write_text("{\n" + ",\n".join(f'"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in ordered) + "\n}\n",
                         encoding="utf-8")
    print(f"賭盤紀錄：新存 {new} 場，查不到 {missing} 場，共 {len(cache)} 場 -> {ODDS_FILE}")


def main(end, with_schedule=True):
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
    if with_schedule:
        write_schedule()
    write_odds()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="從 ESPN 抓新球季已完賽比分、boxscore 與賽程，寫進 raw/")
    parser.add_argument("--end", type=date.fromisoformat, default=date.today(), help="抓到哪一天（預設今天）")
    parser.add_argument("--no-schedule", action="store_true", help="不更新賽程")
    args = parser.parse_args()
    main(args.end, not args.no_schedule)
