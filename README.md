# NBA 賽季前對戰預測

選兩支 NBA 球隊，用上一季（2025-26 例行賽）的表現推算對戰比分與勝負。純網頁（HTML / CSS / JavaScript），不需要後端伺服器。

> **資料是凍結快照**：目前只含 2025-26 例行賽（截至 2026-04-12，共 1,230 場），拿來當 2026-27 開季前的預測，準確度有限。新球季開打後會更新資料。

## 預測方法

與 [nba-matchup-predictor](https://github.com/kop030183/nba-matchup-predictor)（即時抓資料版）使用同一組公式：

- **PACE 調整法（主推）**：把場均得失分依各隊節奏（PACE）換算成每回合得分，再依兩隊平均節奏換算回該場比分，主隊加 1 分主場優勢。
- **近 10 場平均法**：自隊近 10 場得分與對手近 10 場失分平均，主隊加 1 分主場優勢。賽季前的「近 10 場」是指 2025-26 例行賽最後 10 場。

三季（2023-24 ~ 2025-26）共 3,224 場逐場回測：PACE 調整法勝負命中率約 66.5%，近 10 場平均法約 65.2%。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `index.html` / `style.css` / `app.js` | 網頁本體 |
| `data/teams.js` | 網頁讀取的資料（由 `build_data.py` 產生，請勿手改） |
| `build_data.py` | 把 `raw/` 原始比分整理成 `data/teams.js` |
| `raw/` | 2025-26 原始賽程比分與 PACE |

## 本機開啟

直接雙擊 `index.html` 即可。

## 更新到新球季

1. 把新球季的賽程與 PACE 檔放進 `raw/`
2. 修改 `build_data.py` 最上方的 `SEASON_LABEL`、檔名、`REGULAR_SEASON_END`、`EXCLUDED_GAMES`
3. 執行 `python build_data.py`

## 資料來源

NBA.com（PACE）、ESPN（賽程比分）。僅供學習與興趣參考。
