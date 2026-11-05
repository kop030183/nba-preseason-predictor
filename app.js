(function () {
  "use strict";

  var D = window.NBA_DATA;
  var T = D.teams;
  var HOME_ADV = D.homeAdvantage;

  var $ = function (id) { return document.getElementById(id); };
  var awaySel = $("away");
  var homeSel = $("home");

  // 球季進行中：資料帶有模型參數時，預測只用本季已打的比賽（不用上季表現；參數見 build_data.py 的 MODEL）
  var MODEL = D.mode === "in_season" && D.model ? D.model : null;

  var SCHEDULE = window.NBA_SCHEDULE || null;  // 賽程（球季進行中才有，build_data.py 產生；日期與時間都是台灣時間）
  var ABBR = {};  // 縮寫 -> 球隊 key；網址和賽程都用縮寫
  Object.keys(T).forEach(function (k) { ABBR[T[k].abbr] = k; });
  var neutral = false;   // 目前這場是不是中立場地（從賽程點進來才可能是）；中立場地不加主場優勢
  var fromDate = null;   // 從哪一天的賽程點進來的（用來顯示「回到賽程」）
  var PRE = D.pre || null;  // 最近一個比賽日「開打之前」的球隊數據（build_data.py 產生），給已完賽的比賽看賽前預測
  var PRE_DAYS = D.preDays || {};  // 更早的比賽日各自「開打之前」的球隊數據（只有預測公式要用的欄位），給賽程卡片顯示賽前預測，不能點進去
  var pregame = false;      // 目前是不是在看一場已完賽比賽（固定頁面：賽前預測、賽前數據、當時盤口，不能換隊）
  var finalGame = null;     // 上面那場已完賽比賽在賽程裡的資料（pregame 為 true 時才有）

  // ---------- 依資料模式切換的文字 ----------
  // D.mode："preseason" = 拿上一季整季數據當賽季前預測；"in_season" = 球季進行中，用本季已打的比賽
  var MODE = D.mode === "in_season" ? "in_season" : "preseason";
  var N_GAMES = D.games.toLocaleString("en-US");
  var COPY = {
    preseason: {
      title: "NBA 賽季前對戰預測",
      notice: "目前使用 " + D.season + " 例行賽的數據（凍結在 " + D.asOf + "），當作 " + D.nextSeason +
        " 開季前的預測，所以準確度有限：賽季前預估的勝負命中率約 60%。" +
        "（66.5% 是賽季中、用本季累積數據的回測數字，不適用於賽季前預測。）新球季開打後，數據會更新。",
      statsTitle: "上季數據對照",
      l10note: "上季季末",
      h2hTitle: D.season + " 例行賽兩隊對戰 ",
      source: "Basketball-Reference.com",
      foot: "整理自 " + D.season + " 例行賽 " + N_GAMES + " 場"
    },
    in_season: {
      title: "NBA 對戰預測",
      notice: "",  // 球季進行中不顯示說明框（資料更新到哪天，頁尾會寫）
      statsTitle: D.season + " 本季數據對照",
      recLabel: "本季戰績",
      l10note: "",
      h2hTitle: D.season + " 例行賽兩隊對戰 ",
      source: D.h2hPrev
        ? "ESPN（" + D.season + " 比分與 PACE、DraftKings 盤口）、Basketball-Reference.com（" + D.prevSeason + " 交手紀錄）"
        : "ESPN（" + D.season + " 比分與 PACE、DraftKings 盤口）",
      foot: "整理自 " + D.season + " 例行賽已完成的 " + N_GAMES + " 場（更新至 " + D.asOf + "）"
    }
  }[MODE];
  COPY.recLabel = COPY.recLabel || "整季戰績";

  // ---------- 預測公式（與舊專案 api.py 完全一致） ----------
  // ha = 主場優勢（分）；不給就用預設，中立場地傳 0
  function predictPace(a, h, ha) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.off / a.pace * avg + h.def / h.pace * avg) / 2,
      home: (h.off / h.pace * avg + a.def / a.pace * avg) / 2 + (ha == null ? HOME_ADV : ha)
    };
  }

  // ---------- 近況預測（球季進行中）：用近 10 場的 PACE 法 ----------
  // 和賽季前的 PACE 法同一個公式，只是改用「近 10 場」（不滿 10 場就用已打場數）的得失分，PACE 用本季累積值：
  // 兩隊得失分交叉配對 -> 各除以自己的 PACE（變成每回合得分）-> 乘上預估 PACE（兩隊 PACE 的平均）-> 主隊 +1
  function predictLast10(a, h, ha) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.l10off / a.pace * avg + h.l10def / h.pace * avg) / 2,
      home: (h.l10off / h.pace * avg + a.l10def / a.pace * avg) / 2 + (ha == null ? HOME_ADV : ha)
    };
  }

  // ---------- 球季進行中的預測（只用本季已打的比賽） ----------
  // 整季評分 = 已打場數 x 整季至今淨勝分 / (已打場數 + K)，淨勝分 = 場均得分 - 場均失分（打得少時往平均拉回）
  // 近況評分 = 近 10 場場數 x 近 10 場淨勝分 / (近 10 場場數 + K)，不滿 10 場就用已打場數
  // 球隊評分 = 整季評分和近況評分按 recentWeight 混合（目前各占一半）
  // 預測分差 = 主隊評分 - 客隊評分 + 主場優勢（完整分差，不像 PACE 法把分差砍半，所以主場是 2 分不是 1 分）
  // 預測總分 = 兩隊場均得失分直接平均（整季至今與近 10 場按同樣比例混合，不用 PACE）；
  // 再用 主隊 = 總分/2 + 分差/2 拆成兩隊比分
  function shrunk(n, net) { return n * net / (n + MODEL.shrinkK); }

  function rating(t) {
    var w = MODEL.recentWeight;
    return (1 - w) * shrunk(t.gp, t.net) + w * shrunk(Math.min(10, t.gp), t.net10);
  }

  function predictSeason(a, h, ha) {
    var w = MODEL.recentWeight;
    var totalSeason = (a.off + h.def) / 2 + (h.off + a.def) / 2;
    var totalRecent = (a.l10off + h.l10def) / 2 + (h.l10off + a.l10def) / 2;
    var total = (1 - w) * totalSeason + w * totalRecent;
    var margin = rating(h) - rating(a) + (ha == null ? MODEL.homeAdv : ha);
    return { away: total / 2 - margin / 2, home: total / 2 + margin / 2 };
  }

  // ---------- 下拉選單 ----------
  function fillSelect(sel) {
    var groups = { E: "東區", W: "西區" };
    Object.keys(groups).forEach(function (conf) {
      var og = document.createElement("optgroup");
      og.label = groups[conf];
      Object.keys(T)
        .filter(function (k) { return T[k].conf === conf; })
        .sort(function (x, y) { return T[x].zh.localeCompare(T[y].zh, "zh-Hant"); })
        .forEach(function (k) {
          var o = document.createElement("option");
          o.value = k;
          o.textContent = T[k].zh + "（" + T[k].abbr + "）";
          og.appendChild(o);
        });
      sel.appendChild(og);
    });
  }

  // ---------- 畫面 ----------
  // 本季 0 場的球隊沒有場均數據（資料裡是 null），顯示「—」
  function f1(n) { return n == null ? "—" : n.toFixed(1); }

  // 隊徽文字色：白字對比（WCAG 相對亮度公式）不到 4.5 就改黑字
  function badgeTextColor(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return 1.05 / (lum + 0.05) >= 4.5 ? "#fff" : "#000";
  }

  function teamBlock(t, role, score, isWinner) {
    var el = document.createElement("div");
    el.className = "team" + (isWinner ? " winner" : "");
    el.innerHTML =
      '<span class="badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr + "</span>" +
      '<div class="name">' + t.zh + "</div>" +
      '<div class="role">' + role + "</div>" +
      '<div class="score">' + (typeof score === "string" ? score : f1(score)) + "</div>";  // 傳字串就原樣顯示（實際比分是整數）
    return el;
  }

  function setBlock(id, node) {
    var host = $(id);
    host.replaceWith(node);
    node.id = id;
  }

  // ---------- 數據對照：球隊名稱與數字用隊色，較優的一方加皇冠 ----------
  function hexToRgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
  }

  function luminance(rgb) {  // WCAG 相對亮度
    var c = rgb.map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // 隊色直接當文字色，有些顏色在卡片底色上會看不清楚（深色底上的深藍、淺色底上的亮黃）：
  // 對比不到 4.5 就往白色（深色底）或黑色（淺色底）一步步調整，直到看得清楚，色相不變
  function readableOn(hex, bg) {
    var c = hexToRgb(hex);
    var bgL = luminance(bg);
    var target = bgL < 0.5 ? [255, 255, 255] : [0, 0, 0];
    for (var p = 0; p <= 1.0001; p += 0.05) {
      var m = c.map(function (v, i) { return Math.round(v + (target[i] - v) * p); });
      var l = luminance(m);
      if ((Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05) >= 4.5) return "rgb(" + m.join(",") + ")";
    }
    return "rgb(" + target.join(",") + ")";
  }

  function cardBackground() {
    var m = getComputedStyle($("stats-title").parentNode).backgroundColor.match(/\d+/g);
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }

  // 比較兩邊的數字，回傳較優的一方："a"（客隊）、"h"（主隊），一樣或無法比較回傳 null
  function betterHigh(x, y) { return x > y ? "a" : (y > x ? "h" : null); }
  function betterLow(x, y) { return x < y ? "a" : (y < x ? "h" : null); }
  function betterRecord(ra, rh) {  // "7-1" 對 "3-4"：比勝率；其中一隊 0 場、或勝率一樣都不給皇冠
    var pa = ra.split("-").map(Number), ph = rh.split("-").map(Number);
    var ta = pa[0] + pa[1], th = ph[0] + ph[1];
    if (!ta || !th) return null;
    return betterHigh(pa[0] * th, ph[0] * ta);
  }

  // "53-29" 的小字：勝率 "64.6%"
  function rateSub(rec) {
    var p = rec.split("-");
    var w = Number(p[0]);
    var total = w + Number(p[1]);
    return '<span class="rate">' + (total ? (w / total * 100).toFixed(1) + "%" : "—") + "</span>";
  }

  // 一格數據：數字（隊色）+ 較優的加皇冠 + 小字
  function statCell(main, sub, crown, color) {
    return '<td style="color:' + color + '">' + main +
      (crown ? ' <span class="crown" role="img" aria-label="較優" title="較優">👑</span>' : "") + (sub || "") + "</td>";
  }

  // 實力評分格："+8.4" 加一行小字「已打 8 場」
  function ratingText(t) {
    var r = rating(t);
    return (r >= 0 ? "+" : "") + f1(r);
  }

  // 某一份交手資料（本季或上季）裡，客隊 a 和主隊 h 的對戰；沒有交手就回傳空字串
  function h2hBlock(data, title, a, h) {
    var pair = [a.abbr, h.abbr].sort();
    var meetings = data[pair[0] + "-" + pair[1]] || [];
    if (!meetings.length) return "";
    var awayFirst = a.abbr === pair[0];
    var awayWins = 0;
    var lines = meetings.map(function (m) {
      var ap = awayFirst ? m[0] : m[1];
      var hp = awayFirst ? m[1] : m[0];
      if (ap > hp) awayWins++;
      return '<div class="h2h-game">' + a.zh + " " + ap + " : " + hp + " " + h.zh + "</div>";
    });
    return '<div class="h2h-block"><div class="h2h-title">' + title + meetings.length + " 場：" + a.zh + " " +
      awayWins + " 勝 " + (meetings.length - awayWins) + " 敗</div>" + lines.join("") + "</div>";
  }

  function winnerOf(p) { return p.home >= p.away ? "home" : "away"; }

  // 預測信心：看大比分（①實力評分法）兩隊比分各四捨五入到 0.1 之後的分差（取絕對值），門檻來自三季回測：
  //   0 ~ 3.5 分 低信心 ／ 3.6 ~ 6.5 分 中信心 ／ 6.6 分以上 高信心（猜對率見 README）
  function confidenceOf(p) {
    var gap = Math.round(Math.abs(Number(f1(p.home)) - Number(f1(p.away))) * 10) / 10;
    if (gap <= 3.5) return { key: "low", label: "低信心" };
    if (gap <= 6.5) return { key: "mid", label: "中信心" };
    return { key: "high", label: "高信心" };
  }

  function confHtml(p) {  // 帶顏色的信心字樣：高 = 綠、中 = 橘、低 = 紅
    var c = confidenceOf(p);
    return '<span class="conf conf-' + c.key + '">' + c.label + "</span>";
  }

  // 球季進行中：兩個分數與「兩種模式方向是否一致」（賽程列表和對戰畫面共用）；neutral 時不加主場優勢
  function compareModels(a, h, isNeutral) {
    var ha = isNeutral ? 0 : null;
    var p1 = predictSeason(a, h, ha);
    var p2 = predictLast10(a, h, ha);
    return { p1: p1, p2: p2, w1: winnerOf(p1), w2: winnerOf(p2), same: winnerOf(p1) === winnerOf(p2) };
  }

  // 賽程裡已完賽的那一場（台灣日期 date；網址沒帶日期就當作最近一個比賽日）；找不到就回傳 null
  function findFinal(aAbbr, hAbbr, date) {
    if (!SCHEDULE || !PRE) return null;
    var d = isDate(date) ? date : PRE.date;
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = SCHEDULE.games[i];
      if (g.s === "F" && g.d === d && g.a === aAbbr && g.h === hAbbr && preGameInfo(g)) return g;
    }
    return null;
  }

  // 某場已完賽比賽「開打之前」的球隊數據：最近一個比賽日在 PRE，更早的在 PRE_DAYS
  function snapshotOf(g) { return g.d === PRE.date ? PRE.teams : PRE_DAYS[g.d]; }

  function render() {
    var aKey = awaySel.value;
    var hKey = homeSel.value;
    var hint = $("hint");
    var result = $("result");
    $("neutral-note").hidden = !neutral;
    $("odds-card").hidden = true;  // 盤口等這次預測算完、確定有這場比賽才會再打開
    $("picker").hidden = pregame;  // 已完賽的比賽是固定頁面，不能換隊
    $("board-card").hidden = pregame;
    $("pre-board").hidden = !pregame;
    $("final-board").hidden = !pregame;
    // 看已完賽比賽時，整頁都用「那天開打之前」的數據（隊名、隊色照常從球隊總表拿）
    var snap = pregame ? snapshotOf(finalGame) : null;
    var src = pregame ? { } : T;
    if (snap) { src[aKey] = Object.assign({}, T[aKey], snap[aKey]); src[hKey] = Object.assign({}, T[hKey], snap[hKey]); }

    if (aKey === hKey) {
      hint.textContent = "客隊和主隊不能是同一支球隊，請重新選擇。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    var a = src[aKey];
    var h = src[hKey];
    // 本季 0 場的球隊沒有任何數據可算（球季進行中才會發生）
    var noGames = [a, h].filter(function (t) { return !t.gp; }).map(function (t) { return t.zh; });
    if (noGames.length) {
      hint.textContent = noGames.join("、") + " 本季尚未出賽，暫時無法預測。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    hint.hidden = true;

    var cmp = MODEL ? compareModels(a, h, neutral) : null;
    var pace = MODEL ? cmp.p1 : predictPace(a, h, neutral ? 0 : null);
    var wPace = winnerOf(pace);

    // 主記分板
    setBlock("board-away", teamBlock(a, "客隊", pace.away, wPace === "away"));
    setBlock("board-home", teamBlock(h, "主隊", pace.home, wPace === "home"));
    var winTeam = wPace === "home" ? h : a;
    var diff = Math.abs(pace.home - pace.away);
    $("verdict-tag").textContent = winTeam.zh + " 勝";
    // 球季進行中不顯示「預測分差、總分」那一行（賽季前模式照舊）
    $("board-margin").hidden = !!MODEL;
    $("board-margin").textContent = "預測分差 " + f1(diff) + " 分，總分 " + f1(pace.home + pace.away) + " 分";

    // 預測信心（只有球季進行中才有）；②近況預測仍會算（compareModels），只是不顯示
    var alt = $("alt");
    alt.hidden = !MODEL;
    if (MODEL) {
      alt.innerHTML = '<div class="alt-title">預測信心</div><div class="alt-line">' + confHtml(cmp.p1) + "</div>";
    }
    // 已完賽的固定頁面：上面那塊換成「賽前預測 比分 信心」
    if (pregame) {
      // 第一張卡：實際比分（隊徽、隊名、大比分，贏的一方綠色）
      setBlock("final-away", teamBlock(a, "客隊", String(finalGame.as), finalGame.as > finalGame.hs));
      setBlock("final-home", teamBlock(h, "主隊", String(finalGame.hs), finalGame.hs > finalGame.as));
      // 第二張卡：賽前預測、信心、各選項對錯
      $("pre-board").innerHTML = '<div class="pre-title">賽前預測</div>' +
        '<div class="pre-score">' + a.zh + " " + f1(cmp.p1.away) + " : " + f1(cmp.p1.home) + " " + h.zh + "</div>" +
        '<div class="pre-conf">' + confHtml(cmp.p1) + "</div>" +
        (finalGame.sp != null ? '<div class="pre-picks">' + betPicksHtml(a, h, cmp.p1, finalGame) + "</div>" : "");
    }

    // 交手紀錄（以客隊為主視角）；球季進行中除了本季，還附上上季的交手（只供參考，不進預測）
    var blocks = [h2hBlock(D.h2h, COPY.h2hTitle, a, h)];
    if (MODEL && D.h2hPrev) blocks.push(h2hBlock(D.h2hPrev, D.prevSeason + " 例行賽兩隊對戰 ", a, h));
    blocks = blocks.filter(Boolean);
    $("h2h").innerHTML = blocks.join("");
    $("h2h").hidden = !blocks.length;

    // 數據對照
    var bg = cardBackground();
    var aColor = readableOn(a.color, bg);
    var hColor = readableOn(h.color, bg);
    $("s-away").textContent = a.zh;
    $("s-home").textContent = h.zh;
    $("s-away").style.color = aColor;
    $("s-home").style.color = hColor;
    var l10note = COPY.l10note ? '<span class="row-note">' + COPY.l10note + "</span>" : "";
    // 每列：[列名, 客隊數字, 客隊小字, 主隊數字, 主隊小字, 較優的一方（null = 不放皇冠）]
    var rows = [];
    if (MODEL) {
      rows.push(["實力評分", ratingText(a), '<span class="rate">已打 ' + a.gp + " 場</span>",
        ratingText(h), '<span class="rate">已打 ' + h.gp + " 場</span>", betterHigh(Number(f1(rating(a))), Number(f1(rating(h))))]);
    }
    var rec = function (label, ra, rh) { return [label, ra, rateSub(ra), rh, rateSub(rh), betterRecord(ra, rh)]; };
    rows.push(rec(COPY.recLabel, a.w + "-" + a.l, h.w + "-" + h.l));
    rows.push(rec("主場戰績", a.home, h.home));
    rows.push(rec("客場戰績", a.road, h.road));
    rows.push(["場均得分", f1(a.off), "", f1(h.off), "", betterHigh(a.off, h.off)]);
    rows.push(["場均失分", f1(a.def), "", f1(h.def), "", betterLow(a.def, h.def)]);  // 失分越少越好
    rows.push([MODEL ? "PACE（本季）" : "PACE", f1(a.pace), "", f1(h.pace), "", null]);  // 節奏快慢沒有好壞
    rows.push(rec("近 10 場戰績" + l10note, a.l10rec, h.l10rec));
    rows.push(["近 10 場得分" + l10note, f1(a.l10off), "", f1(h.l10off), "", betterHigh(a.l10off, h.l10off)]);
    rows.push(["近 10 場失分" + l10note, f1(a.l10def), "", f1(h.l10def), "", betterLow(a.l10def, h.l10def)]);
    $("stats-body").innerHTML = rows.map(function (r) {
      return "<tr>" + statCell(r[1], r[2], r[5] === "a", aColor) + "<td>" + r[0] + "</td>" +
        statCell(r[3], r[4], r[5] === "h", hColor) + "</tr>";
    }).join("");

    result.hidden = false;
    if (MODEL) {
      if (pregame) showRecordedOdds(a, h, aColor, hColor);
      else renderOdds(aKey, hKey, a, h, aColor, hColor);
    }
  }

  // ---------- 現在的盤口（DraftKings，經 ESPN 轉載；打開頁面時即時抓，不寫進資料檔） ----------
  // 單隊總分查不到莊家實際開的盤口，這裡用「讓分 + 總分」推算：主隊 = 總分/2 - 主隊讓分/2，客隊 = 總分/2 + 主隊讓分/2
  var ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=";
  var ESPN_NAME_FIX = { "LA Clippers": "Los Angeles Clippers" };
  var oddsCache = {};   // 日期 ->{ t: 抓取時間, p: Promise(events) }；60 秒內重用，不重複打 ESPN
  var oddsToken = 0;    // 切換球隊很快時，只畫最後一次的結果

  function upcomingGameOf(aAbbr, hAbbr) {  // 賽程裡這組客隊/主隊「還沒打完」的下一場
    if (!SCHEDULE) return null;
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = SCHEDULE.games[i];
      if ((g.s === "S" || g.s === "L") && g.a === aAbbr && g.h === hAbbr) return g;
    }
    return null;
  }

  function fetchScoreboard(day) {  // day = 美東日期 "2026-11-05"；ESPN 不接受日期範圍，一天抓一次
    var key = day.replace(/-/g, "");
    var hit = oddsCache[key];
    if (hit && Date.now() - hit.t < 60000) return hit.p;
    var p = fetch(ESPN_SB + key).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) { return j.events || []; });
    oddsCache[key] = { t: Date.now(), p: p };
    p["catch"](function () { delete oddsCache[key]; });
    return p;
  }

  function lineNum(s) {  // "+1.5" -> 1.5、"o222.5" -> 222.5、"EVEN" / "PK" -> 0；看不懂回傳 null
    if (s == null) return null;
    if (/^(even|pk)/i.test(String(s))) return 0;
    var n = parseFloat(String(s).replace(/^[ou]/i, ""));
    return isNaN(n) ? null : n;
  }

  // 畫盤口卡片：homeLine = 主隊讓分（負 = 主隊讓分），totalLine = 總分；note = 卡片外的兩行小字
  // 單隊總分：由讓分與總分推算，再調成 .5 結尾（x.0 進位到 x.5，例如 112.0 -> 112.5）；順序是 讓分、單隊總分、總分
  // res = 已完賽比賽的實際比分 { as, hs }：有的話，讓分打 ✅ 在讓分過關的那一邊，單隊總分與總分打 ⬆️（大）/ ⬇️（小）；剛好打平盤的不標
  function sgn(v) { return (v > 0 ? "+" : "") + f1(v); }          // 讓分顯示：+1.5 / -1.5
  function half(v) { return f1(Math.floor(v) + 0.5); }             // 單隊總分調成 .5 結尾（x.0 進位到 x.5）

  function drawOdds(a, h, aColor, hColor, homeLine, totalLine, note, res) {
    var UP = " ⬆️", DOWN = " ⬇️", OK = " ✅";
    var overUnder = function (actual, line) { return actual > line ? UP : actual < line ? DOWN : ""; };
    var rows = "";
    if (homeLine != null) {
      var cover = res ? (res.hs - res.as + homeLine) : 0;  // > 0 主隊讓分過關（受讓方贏盤），< 0 客隊過關
      rows += "<tr><td>" + sgn(-homeLine) + (res && cover < 0 ? OK : "") + "</td><td>讓分</td><td>" +
        sgn(homeLine) + (res && cover > 0 ? OK : "") + "</td></tr>";
    }
    if (homeLine != null && totalLine != null) {
      var aTT = half(totalLine / 2 + homeLine / 2), hTT = half(totalLine / 2 - homeLine / 2);
      rows += "<tr><td>" + aTT + (res ? overUnder(res.as, Number(aTT)) : "") + "</td><td>單隊總分</td><td>" +
        hTT + (res ? overUnder(res.hs, Number(hTT)) : "") + "</td></tr>";
    }
    if (totalLine != null) {
      rows += '<tr><td colspan="3"><b>總分 ' + totalLine + (res ? overUnder(res.as + res.hs, totalLine) : "") + "</b></td></tr>";
    }
    if (!rows) return false;
    $("odds-body").innerHTML = '<div class="odds-title">' + (res ? "賭盤結果" : "賭盤") + '</div><table class="stats"><thead><tr><th style="color:' + aColor + '">' + a.zh +
      '</th><th></th><th style="color:' + hColor + '">' + h.zh + "</th></tr></thead><tbody>" + rows + "</tbody></table>";
    $("odds-note").innerHTML = note + "<br>非投注建議，娛樂參考 !";
    return true;
  }

  // 已完賽：把賽前預測拿去對盤口，每個選項對不對（讓分選哪一邊、單隊總分與總分選大或小）。
  // 預測比分用畫面上顯示的 0.1 位數；剛好等於盤口的不選、實際剛好打平盤的不標對錯
  function betPicksHtml(a, h, p, g) {
    if (g.sp == null || g.ou == null) return "";
    var mark = function (ok) { return ok === null ? "" : ok ? " ✅" : " ❌"; };
    var pa = Number(f1(p.away)), ph = Number(f1(p.home));
    var lines = [];
    var cover = g.hs - g.as + g.sp;   // 實際：> 0 主隊過關，< 0 客隊過關
    var pick = ph - pa + g.sp;        // 預測：> 0 選主隊那邊，< 0 選客隊那邊
    if (pick !== 0) {
      lines.push((pick > 0 ? h.zh + " " + sgn(g.sp) : a.zh + " " + sgn(-g.sp)) + mark(cover === 0 ? null : (cover > 0) === (pick > 0)));
    }
    var overUnder = function (name, pred, line, actual) {
      if (pred === line) return;
      lines.push(name + " " + line + " " + (pred > line ? "大" : "小") + mark(actual === line ? null : (actual > line) === (pred > line)));
    };
    overUnder(a.zh, pa, Number(half(g.ou / 2 + g.sp / 2)), g.as);
    overUnder(h.zh, ph, Number(half(g.ou / 2 - g.sp / 2)), g.hs);
    overUnder("總分", pa + ph, g.ou, g.as + g.hs);
    return lines.map(function (t) { return "<div>" + t + "</div>"; }).join("");
  }

  function showOdds(a, h, aColor, hColor, o) {  // 即時盤口（ESPN 賽事列表的 odds）
    var ps = o.pointSpread, tot = o.total;
    var hl = ps && ps.home && ps.home.close;
    var ov = tot && tot.over && tot.over.close;
    var homeLine = hl ? lineNum(hl.line) : null;
    var totalLine = ov ? lineNum(ov.line) : (typeof o.overUnder === "number" ? o.overUnder : null);
    var hh = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
    return drawOdds(a, h, aColor, hColor, homeLine, totalLine, "經 ESPN 取得 DraftKings 的賭盤概況，台灣時間 " + hh + " 更新");
  }

  // 已完賽的比賽：用 update 時存進賽程資料的收盤盤口（sp = 主隊讓分、ou = 總分；原始紀錄在 raw/odds_2026-27.json）
  function showRecordedOdds(a, h, aColor, hColor) {
    ++oddsToken;  // 作廢還在路上的即時盤口
    var g = finalGame;
    var card = $("odds-card");
    if (!g || g.sp == null || !drawOdds(a, h, aColor, hColor, g.sp, g.ou, "經 ESPN 取得 DraftKings 的賭盤概況，開賽前最後的盤口",
      { as: g.as, hs: g.hs })) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
  }

  function renderOdds(aKey, hKey, a, h, aColor, hColor) {
    var card = $("odds-card");
    var g = upcomingGameOf(a.abbr, h.abbr);
    var token = ++oddsToken;
    if (!g) { card.hidden = true; return; }
    $("odds-body").innerHTML = '<p class="odds-msg">載入中…</p>';
    $("odds-note").textContent = "";
    card.hidden = false;
    var fail = function (msg) {
      if (token !== oddsToken) return;
      $("odds-body").innerHTML = '<p class="odds-msg">' + msg + "</p>";
      $("odds-note").textContent = "";
    };
    // 賽程日期是台灣日期，ESPN 用美東日期：台灣日期的前一天到當天一起抓，再用隊名對出這場
    Promise.all([fetchScoreboard(addDays(g.d, -1)), fetchScoreboard(g.d)]).then(function (days) {
      if (token !== oddsToken) return;
      var events = days[0].concat(days[1]);
      var ev = null;
      events.forEach(function (e) {
        var comp = e.competitions && e.competitions[0];
        if (!comp || e.status.type.name === "STATUS_FINAL") return;
        var names = {};
        comp.competitors.forEach(function (c) {
          var raw = c.team.displayName;
          names[c.homeAway] = ESPN_NAME_FIX[raw] || raw;
        });
        if (names.away === aKey && names.home === hKey) ev = comp;
      });
      var o = ev && ev.odds && ev.odds[0];
      if (!o) return fail("這場目前還沒有盤口。");
      if (!showOdds(a, h, aColor, hColor, o)) fail("這場目前還沒有盤口。");
    }, function () { fail("盤口暫時抓不到，稍後重新整理再試。"); });
  }

  // ---------- 初始化 ----------
  document.title = COPY.title;
  $("page-title").textContent = COPY.title;
  if (COPY.notice) {
    var noticeStrong = document.createElement("strong");
    noticeStrong.textContent = "資料說明：";
    $("notice").appendChild(noticeStrong);
    $("notice").appendChild(document.createTextNode(COPY.notice));
  } else {
    $("notice").hidden = true;
  }
  $("stats-title").textContent = COPY.statsTitle;
  $("foot-text").textContent = "數據來源：" + COPY.source + "，" + COPY.foot + "。僅供興趣參考。";

  fillSelect(awaySel);
  fillSelect(homeSel);
  awaySel.value = "Philadelphia 76ers";
  homeSel.value = "New York Knicks";

  // ---------- 網址記住狀態，所以每一場的預測都有自己的連結，也能用瀏覽器的上一頁 ----------
  //   #tab=matchup&away=PHI&home=NYK[&date=2026-11-05][&neutral=1]    第一層：自選對戰
  //   #tab=schedule&date=2026-11-05                                   第二層：某天的賽程
  function readHash() { return new URLSearchParams(location.hash.replace(/^#/, "")); }

  function hashOf(obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) { if (obj[k]) p.set(k, obj[k]); });
    return "#" + p.toString();
  }

  function replaceHash(obj) { history.replaceState(null, "", hashOf(obj)); }

  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }

  // ---------- 第二層：賽程（日期都是台灣日期，過去的日期不能選） ----------
  var gamesByDate = {};
  var dates = [];  // 有比賽的台灣日期（由小到大）
  if (SCHEDULE) {
    SCHEDULE.games.forEach(function (g) { (gamesByDate[g.d] = gamesByDate[g.d] || []).push(g); });
    dates = Object.keys(gamesByDate).sort();
  }
  var lastDate = dates.length ? dates[dates.length - 1] : null;
  var curDate = null;

  function todayTW() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }  // 台灣的今天

  function addDays(d, n) {
    var p = d.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  function fmtDate(d) {  // "2026-11-05" -> "11/5（四）"
    var p = d.split("-").map(Number);
    return p[1] + "/" + p[2] + "（" + "日一二三四五六".charAt(new Date(p[0], p[1] - 1, p[2]).getDay()) + "）";
  }

  function nextGameDate(from) {  // from 當天或之後，第一個有比賽的日期
    for (var i = 0; i < dates.length; i++) if (dates[i] >= from) return dates[i];
    return null;
  }

  function nextUpcomingDate() {  // 今天或之後，第一個還有比賽沒打完（尚未開打或進行中）的日期
    var t = todayTW();
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] >= t && gamesByDate[dates[i]].some(function (g) { return g.s === "S" || g.s === "L"; })) return dates[i];
    }
    return null;
  }

  function hasUpcoming() { return !!lastDate && lastDate >= todayTW(); }

  // 最早能選的日期：賽程資料的第一天（build_data.py 的 SCHEDULE_SHOW_FROM，過去這幾天看賽前預測和結果）；
  // 賽程第一天還在未來（球季還沒開打）就是今天。更早的日期沒有資料，不能選
  function minDate() {
    var t = todayTW();
    return dates.length && dates[0] < t ? dates[0] : t;
  }

  function clampDate(d) {
    var lo = minDate();
    if (!isDate(d)) d = todayTW();
    return d < lo ? lo : (d > lastDate ? lastDate : d);
  }

  function prevMatchDay(d) {  // d 之前的一個比賽日（不能早於最早能選的日期）
    for (var i = dates.length - 1; i >= 0; i--) if (dates[i] < d) return dates[i] >= minDate() ? dates[i] : null;
    return null;
  }

  function nextMatchDay(d) {  // d 之後的一個比賽日
    for (var i = 0; i < dates.length; i++) if (dates[i] > d) return dates[i];
    return null;
  }

  function miniBadge(t) {
    return '<span class="mini-badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr + "</span>";
  }

  // 已完賽的比賽：用「那天開打之前」的數據算賽前預測，對照實際結果；算不出來（球隊還沒有數據）就回傳 null
  // 最近一個比賽日的數據在 PRE，更早的比賽日在 PRE_DAYS
  function preGameInfo(g) {
    if (!PRE || g.s !== "F" || !g.a || !g.h) return null;
    var teams = g.d === PRE.date ? PRE.teams : PRE_DAYS[g.d];
    if (!teams) return null;
    var a = teams[ABBR[g.a]];
    var h = teams[ABBR[g.h]];
    if (!a.gp || !h.gp) return null;
    var c = compareModels(a, h, g.n);
    var homeWon = g.hs > g.as;
    // an / hn：兩隊的名稱資料（隊名、隊徽）一律從球隊總表拿，PRE_DAYS 裡只有算預測要用的數字
    return { a: a, h: h, an: T[ABBR[g.a]], hn: T[ABBR[g.h]], c: c,
      ok1: (c.w1 === "home") === homeWon, ok2: (c.w2 === "home") === homeWon };
  }

  // 這場能不能點進去：兩隊都確定，而且（還沒打完、不是已經過去的日子）或（已完賽、有賽前數據，點進去是固定頁面）
  // 已經過去的日子，資料沒更新時狀態還是「尚未開打」，這種不能點
  function isClickable(g, date) {
    var a = g.a ? T[ABBR[g.a]] : null;
    var h = g.h ? T[ABBR[g.h]] : null;
    var past = date < todayTW();
    return !!(a && h) && (((g.s === "S" || g.s === "L") && !past) || !!(MODEL && preGameInfo(g)));
  }

  function gameHash(g, date) {
    return hashOf({ tab: "matchup", away: g.a, home: g.h, date: date, neutral: g.n ? "1" : "", pre: g.s === "F" ? "1" : "" });
  }

  // 一邊的球隊：隊徽、隊名、戰績（沒決定的隊伍顯示「待定」）
  function teamCell(t) {
    if (!t) return '<div class="gm-team"><span class="mini-badge tbd">?</span><div class="gm-name">待定</div></div>';
    return '<div class="gm-team">' + miniBadge(t) + '<div class="gm-name">' + t.zh + '</div><div class="gm-rec">' +
      t.w + "-" + t.l + "</div></div>";
  }

  // 賽程列表的一場比賽，版型仿 NBA 官網：客隊在左、主隊在右，中間是開賽時間（已完賽改顯示比分）。
  // 能點的是連結，點了帶到那場的預測
  function gameItem(g, date) {
    var a = g.a ? T[ABBR[g.a]] : null;
    var h = g.h ? T[ABBR[g.h]] : null;
    var pi = MODEL ? preGameInfo(g) : null;
    var past = date < todayTW();
    var clickable = isClickable(g, date);
    var el = document.createElement(clickable ? "a" : "div");
    el.className = "game" + (clickable ? "" : " is-static");
    if (clickable) el.href = gameHash(g, date);

    var tags = (g.tag ? '<span class="game-tag">' + g.tag + "</span>" : "") +
      (g.n && a && h ? '<span class="game-tag">中立場地</span>' : "");

    // 中間：已完賽顯示比分（贏的那隊加粗，箭頭指向勝方），其他顯示開賽時間
    var mid;
    if (g.s === "F" && a && h) {
      var homeWon = g.hs > g.as;
      mid = '<div class="gm-score"><span class="gm-pts ' + (homeWon ? "lose" : "win") + '">' + g.as + "</span>" +
        '<span class="gm-final"><b>' + (homeWon ? "▶" : "◀") + "</b>已完賽</span>" +
        '<span class="gm-pts ' + (homeWon ? "win" : "lose") + '">' + g.hs + "</span></div>";
    } else {
      mid = '<div class="game-time">' + g.t + "</div>" +
        (g.s === "L" ? '<div class="gm-sub live">進行中</div>' : g.s === "X" ? '<div class="gm-sub">延期或取消</div>' : "");
    }

    // 卡片下方的小字
    var line = "";
    if (g.s === "F") {
      if (pi) {  // 賽前預測（大比分那個算法）vs 實際結果
        var predWin = pi.c.w1 === "home" ? pi.hn : pi.an;
        line = "賽前預測比分：" + pi.an.zh + " " + f1(pi.c.p1.away) + " : " + f1(pi.c.p1.home) + " " + pi.hn.zh +
          "<br>賽前預測：" + predWin.zh + " 勝（" + confHtml(pi.c.p1) + "）　" +
          (pi.ok1 ? '<span class="ok">預測正確</span>' : '<span class="bad">預測失敗</span>');
      }
    } else if (g.s === "X") {
      line = "";
    } else if (past) {
      line = "這天已經過去，更新資料後會顯示結果";
    } else if (!(a && h)) {
      line = "兩隊要等前一輪打完才決定";
    } else if (MODEL && date === nextUpcomingDate()) {  // 只有「下一個比賽日」顯示預測和信心，更後面的日子先不顯示
      var c = compareModels(a, h, g.n);
      var win = c.w1 === "home" ? h : a;
      line = "預測：" + win.zh + " 勝（" + confHtml(c.p1) + "）";
    }

    el.innerHTML = (tags ? '<div class="gm-tags">' + tags + "</div>" : "") +
      '<div class="gm-row">' + teamCell(a) + '<div class="gm-mid">' + mid + "</div>" + teamCell(h) + "</div>" +
      (line ? '<div class="game-pred">' + line + "</div>" : "");
    var li = document.createElement("li");
    li.appendChild(el);
    return li;
  }

  function renderSchedule(date) {
    curDate = date;
    $("date-input").value = date;
    $("date-prev").disabled = !prevMatchDay(date);
    $("date-next").disabled = !nextMatchDay(date);
    var games = gamesByDate[date] || [];
    var list = $("game-list");
    list.innerHTML = "";
    games.forEach(function (g) { list.appendChild(gameItem(g, date)); });
    // 當天已完賽、有賽前預測的比賽：預測正確幾場、預測失敗幾場（用大比分那個算法，和卡片上標的一樣）
    var right = 0, wrong = 0;
    if (MODEL) games.forEach(function (g) {
      var pi = preGameInfo(g);
      if (pi) { if (pi.ok1) right++; else wrong++; }
    });
    var sum = $("day-summary");
    sum.hidden = right + wrong === 0;
    sum.innerHTML = '當天預測正確 <span class="ok">' + right + '</span> 場、預測失敗 <span class="bad">' + wrong + "</span> 場";
    $("game-empty").hidden = games.length > 0;
    if (!games.length) {
      $("game-empty-text").textContent = fmtDate(date) + "沒有比賽。";
      var next = nextGameDate(addDays(date, 1));
      var jump = $("jump-next");
      jump.hidden = !next;
      if (next) {
        jump.textContent = "跳到下一個比賽日：" + fmtDate(next);
        jump.onclick = function () { goDate(next); };
      }
    }
  }

  function goDate(d) {  // 使用者在賽程裡換日期：不新增瀏覽紀錄，這樣「上一頁」從對戰畫面會回到對的那一天
    d = clampDate(d);
    renderSchedule(d);
    replaceHash({ tab: "schedule", date: d });
  }

  function showTab(name) {
    var sched = name === "schedule";
    $("view-schedule").hidden = !sched;
    $("view-matchup").hidden = sched;
    $("tab-matchup").setAttribute("aria-current", sched ? "false" : "page");
    $("tab-schedule").setAttribute("aria-current", sched ? "page" : "false");
  }

  function updateBack() {
    $("back").hidden = !fromDate;
    if (fromDate) {
      $("back-link").textContent = "← 回到 " + fmtDate(fromDate) + "賽程";
      $("back-link").href = hashOf({ tab: "schedule", date: fromDate });
    }
    updateGameNav();
  }

  // ---------- 同一天的比賽之間切換（從賽程點進來才有）：上一場 / 下一場，順序和賽程列表一樣 ----------
  var dayList = [];   // 那天能點的比賽
  var dayIdx = -1;    // 目前這場在 dayList 的位置

  function updateGameNav() {
    dayList = [];
    dayIdx = -1;
    if (fromDate && gamesByDate[fromDate]) {
      dayList = gamesByDate[fromDate].filter(function (g) { return isClickable(g, fromDate); });
      var a = T[awaySel.value].abbr;
      var h = T[homeSel.value].abbr;
      for (var i = 0; i < dayList.length; i++) if (dayList[i].a === a && dayList[i].h === h) dayIdx = i;
    }
    var nav = $("gamenav");
    nav.hidden = dayIdx < 0 || dayList.length < 2;
    if (!nav.hidden) {
      $("game-pos").textContent = "第 " + (dayIdx + 1) + " / " + dayList.length + " 場";
      $("game-prev").disabled = dayIdx === 0;
      $("game-next").disabled = dayIdx === dayList.length - 1;
    }
  }

  function goGame(delta) {
    var g = dayList[dayIdx + delta];
    if (!g) return;
    // 用取代而不是新增瀏覽紀錄：瀏覽器的「上一頁」還是回到賽程，不會一場一場倒退
    history.replaceState(null, "", gameHash(g, fromDate));
    applyHash();
  }

  // 依網址決定要顯示哪一層、哪一場
  function applyHash() {
    var p = readHash();
    if (hasUpcoming() && p.get("tab") === "schedule") {
      showTab("schedule");
      renderSchedule(clampDate(p.get("date") || nextGameDate(todayTW()) || lastDate));
      return;
    }
    var ak = ABBR[p.get("away")];
    var hk = ABBR[p.get("home")];
    if (ak && hk && ak !== hk) {
      awaySel.value = ak;
      homeSel.value = hk;
    }
    neutral = p.get("neutral") === "1";
    finalGame = p.get("pre") === "1" && ak && hk ? findFinal(p.get("away"), p.get("home"), p.get("date")) : null;  // 只有真的是那天已完賽的比賽才算
    pregame = !!finalGame;
    fromDate = hasUpcoming() && isDate(p.get("date")) ? p.get("date") : null;
    updateBack();
    showTab("matchup");
    render();
  }

  // 使用者自己換球隊：這就不是賽程裡的那一場了
  function onPick() {
    neutral = false;
    pregame = false;
    finalGame = null;
    fromDate = null;
    updateBack();
    replaceHash({ tab: "matchup", away: T[awaySel.value].abbr, home: T[homeSel.value].abbr });
    render();
  }

  awaySel.addEventListener("change", onPick);
  homeSel.addEventListener("change", onPick);
  $("swap").addEventListener("click", function () {
    var tmp = awaySel.value;
    awaySel.value = homeSel.value;
    homeSel.value = tmp;
    onPick();
  });

  // 使用者切換淺色/深色模式時，隊色要跟著重新調整
  if (window.matchMedia) {
    var darkMq = window.matchMedia("(prefers-color-scheme: dark)");
    if (darkMq.addEventListener) darkMq.addEventListener("change", render);
    else if (darkMq.addListener) darkMq.addListener(render);
  }

  // 分頁與賽程控制（沒有賽程、或賽程都已過去就不顯示分頁）
  if (hasUpcoming()) {
    $("tabs").hidden = false;
    $("date-input").min = minDate();
    $("date-input").max = lastDate;
    $("tab-matchup").addEventListener("click", function () {
      location.hash = hashOf({ tab: "matchup", away: T[awaySel.value].abbr, home: T[homeSel.value].abbr });
    });
    $("tab-schedule").addEventListener("click", function () {
      location.hash = hashOf({ tab: "schedule", date: curDate || nextGameDate(todayTW()) || lastDate });
    });
    $("date-input").addEventListener("change", function () { goDate($("date-input").value); });
    $("date-prev").addEventListener("click", function () { var d = prevMatchDay(curDate); if (d) goDate(d); });
    $("date-next").addEventListener("click", function () { var d = nextMatchDay(curDate); if (d) goDate(d); });
    $("date-today").addEventListener("click", function () { goDate(todayTW()); });
  }
  // 切換場次：按鈕、鍵盤左右鍵、手機左右滑動（沒有「上一場／下一場」時都不作用）
  $("game-prev").addEventListener("click", function () { goGame(-1); });
  $("game-next").addEventListener("click", function () { goGame(1); });
  var typing = function (el) { return !!el && /^(SELECT|INPUT|TEXTAREA)$/.test(el.tagName); };  // 這些元素自己會用方向鍵
  var interactive = function (el) { return !!el && /^(SELECT|INPUT|TEXTAREA|BUTTON|A)$/.test(el.tagName); };
  document.addEventListener("keydown", function (e) {
    if ($("gamenav").hidden || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return;
    if (e.key === "ArrowLeft") goGame(-1);
    else if (e.key === "ArrowRight") goGame(1);
  });
  var touch = null;
  $("view-matchup").addEventListener("touchstart", function (e) {
    touch = e.touches.length === 1 && !interactive(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  $("view-matchup").addEventListener("touchend", function (e) {
    if (!touch || $("gamenav").hidden) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) goGame(dx < 0 ? 1 : -1);  // 往左滑 = 下一場
  }, { passive: true });

  window.addEventListener("hashchange", applyHash);

  if (location.hash) {
    applyHash();
  } else {
    showTab("matchup");
    render();
  }
})();
