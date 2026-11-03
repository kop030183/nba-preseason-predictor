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
  var pregame = false;      // 目前是不是在看一場已完賽比賽的賽前預測

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
      h2hTitle: "上季兩隊對戰 ",
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
        ? "ESPN（" + D.season + " 比分與 PACE）、Basketball-Reference.com（" + D.prevSeason + " 交手紀錄）"
        : "ESPN（" + D.season + " 比分與 PACE）",
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

  // ---------- 第二個分數：近 10 場 PACE 法（球季進行中） ----------
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
      '<div class="score">' + f1(score) + "</div>";
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
      return '<div class="h2h-game">' + a.zh + " " + ap + "、" + h.zh + " " + hp + "</div>";
    });
    return '<div class="h2h-block"><div class="h2h-title">' + title + meetings.length + " 場：" + a.zh + " " +
      awayWins + " 勝 " + (meetings.length - awayWins) + " 敗</div>" + lines.join("") + "</div>";
  }

  function winnerOf(p) { return p.home >= p.away ? "home" : "away"; }

  // 球季進行中：兩個分數與「兩種模式方向是否一致」（賽程列表和對戰畫面共用）；neutral 時不加主場優勢
  function compareModels(a, h, isNeutral) {
    var ha = isNeutral ? 0 : null;
    var p1 = predictSeason(a, h, ha);
    var p2 = predictLast10(a, h, ha);
    return { p1: p1, p2: p2, w1: winnerOf(p1), w2: winnerOf(p2), same: winnerOf(p1) === winnerOf(p2) };
  }

  // 那天（PRE.date）已完賽、可以看賽前預測的比賽；沒有就回傳 null
  function findFinal(aAbbr, hAbbr) {
    if (!SCHEDULE || !PRE) return null;
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = SCHEDULE.games[i];
      if (g.s === "F" && g.d === PRE.date && g.a === aAbbr && g.h === hAbbr) return g;
    }
    return null;
  }

  // 已完賽的比賽：說明「下面是賽前預測」，並對照實際比分、標出兩種算法猜對或猜錯
  function showPregameBanner(a, h, cmp) {
    var box = $("pregame");
    var g = pregame ? findFinal(a.abbr, h.abbr) : null;
    box.hidden = !g;
    if (!g) return;
    var homeWon = g.hs > g.as;
    var mark = function (w) { return (w === "home") === homeWon ? '<span class="ok">猜對</span>' : '<span class="bad">猜錯</span>'; };
    box.innerHTML =
      "<p><strong>這場已經打完（" + fmtDate(g.d) + "）。</strong>下面是賽前預測，用的是這場開打前的數據（更新至 " +
      fmtDate(PRE.asOf) + "）。</p>" +
      "<p>實際比分：" + a.zh + " " + g.as + "、" + h.zh + " " + g.hs + " · 實力評分法 " + mark(cmp.w1) +
      " · 近 10 場 PACE 法 " + mark(cmp.w2) + "</p>";
  }

  function render() {
    var aKey = awaySel.value;
    var hKey = homeSel.value;
    var hint = $("hint");
    var result = $("result");
    $("neutral-note").hidden = !neutral;
    $("pregame").hidden = true;  // 需要時下面再顯示
    var src = pregame && PRE ? PRE.teams : T;  // 看已完賽比賽的賽前預測時，整頁都用賽前數據

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
    if (cmp) showPregameBanner(a, h, cmp);
    var pace = MODEL ? cmp.p1 : predictPace(a, h, neutral ? 0 : null);
    var wPace = winnerOf(pace);

    // 主記分板
    setBlock("board-away", teamBlock(a, "客隊", pace.away, wPace === "away"));
    setBlock("board-home", teamBlock(h, "主隊", pace.home, wPace === "home"));
    var winTeam = wPace === "home" ? h : a;
    var diff = Math.abs(pace.home - pace.away);
    $("verdict-tag").textContent = winTeam.zh + " 勝";
    $("board-margin").textContent = (MODEL ? "實力評分法：" : "") +
      "預測分差 " + f1(diff) + " 分，總分 " + f1(pace.home + pace.away) + " 分";

    // 第二個分數（只有球季進行中才有）；兩個算法預測的勝方相同或不同，在比分上方給一句總結
    var alt = $("alt");
    var summary = $("summary");
    alt.hidden = !MODEL;
    summary.hidden = !MODEL;
    if (MODEL) {
      var p2 = cmp.p2;
      var same = cmp.same;
      var win2 = cmp.w2 === "home" ? h : a;
      alt.innerHTML =
        '<div class="alt-title">第二個分數：近 10 場 PACE 法</div>' +
        '<div class="alt-line">' + a.zh + " " + f1(p2.away) + "、" + h.zh + " " + f1(p2.home) +
        "（" + win2.zh + " 勝 " + f1(Math.abs(p2.home - p2.away)) + " 分）</div>";
      summary.className = "summary " + (same ? "agree" : "differ");
      summary.textContent = same ? "兩種模式預測方向一致 可參考" : "兩種模式預測方向不一致 看看就好";
    }

    // 交手紀錄（以客隊為主視角）；球季進行中除了本季，還附上上季的交手（只供參考，不進預測）
    var blocks = [h2hBlock(pregame && PRE ? PRE.h2h : D.h2h, COPY.h2hTitle, a, h)];
    if (MODEL && D.h2hPrev) blocks.push(h2hBlock(D.h2hPrev, "上季（" + D.prevSeason + "）兩隊對戰 ", a, h));
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

  function hasUpcoming() { return !!lastDate && lastDate >= todayTW(); }

  function clampDate(d) {
    var lo = todayTW();
    if (!isDate(d)) d = lo;
    return d < lo ? lo : (d > lastDate ? lastDate : d);
  }

  function miniBadge(t) {
    return '<span class="mini-badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr + "</span>";
  }

  // 最近一個比賽日已完賽的比賽：用「開打之前」的數據算賽前預測，對照實際結果；算不出來（球隊還沒有數據）就回傳 null
  function preGameInfo(g) {
    if (!PRE || g.s !== "F" || g.d !== PRE.date || !g.a || !g.h) return null;
    var a = PRE.teams[ABBR[g.a]];
    var h = PRE.teams[ABBR[g.h]];
    if (!a.gp || !h.gp) return null;
    var c = compareModels(a, h, g.n);
    var homeWon = g.hs > g.as;
    return { a: a, h: h, c: c, ok1: (c.w1 === "home") === homeWon, ok2: (c.w2 === "home") === homeWon };
  }

  // 賽程列表的一場比賽。能點的（兩隊都確定，而且還沒打完、或是最近一個比賽日已完賽可看賽前預測）是連結
  function gameItem(g, date) {
    var a = g.a ? T[ABBR[g.a]] : null;
    var h = g.h ? T[ABBR[g.h]] : null;
    var pi = MODEL ? preGameInfo(g) : null;
    var clickable = !!(a && h) && (g.s === "S" || g.s === "L" || !!pi);
    var el = document.createElement(clickable ? "a" : "div");
    el.className = "game" + (clickable ? "" : " is-static");
    if (clickable) {
      el.href = hashOf({ tab: "matchup", away: g.a, home: g.h, date: date, neutral: g.n ? "1" : "", pre: g.s === "F" ? "1" : "" });
    }

    var teams = a && h
      ? miniBadge(a) + " " + a.zh + " @ " + h.zh + " " + miniBadge(h)
      : "待定 @ 待定";
    var tags = (g.tag ? '<span class="game-tag">' + g.tag + "</span>" : "") +
      (g.n && a && h ? '<span class="game-tag">中立場地</span>' : "") +
      (g.s === "L" ? '<span class="game-tag live">進行中</span>' : "");

    var line = "";
    if (g.s === "F") {
      line = "已完賽：" + (a ? a.zh : "") + " " + g.as + "、" + (h ? h.zh : "") + " " + g.hs;
      if (pi) {  // 賽前預測 vs 實際結果
        var win = pi.c.w1 === "home" ? pi.h : pi.a;
        line += '<br>賽前預測 ' + win.zh + " 勝 " + f1(Math.abs(pi.c.p1.home - pi.c.p1.away)) + " 分：實力評分法 " +
          (pi.ok1 ? '<span class="ok">猜對</span>' : '<span class="bad">猜錯</span>') + " · 近 10 場 PACE 法 " +
          (pi.ok2 ? '<span class="ok">猜對</span>' : '<span class="bad">猜錯</span>');
      }
    } else if (g.s === "X") {
      line = "延期或取消";
    } else if (!(a && h)) {
      line = "兩隊要等前一輪打完才決定";
    } else if (MODEL) {
      var c = compareModels(a, h, g.n);
      var win = c.w1 === "home" ? h : a;
      line = "預測 " + win.zh + " 勝 " + f1(Math.abs(c.p1.home - c.p1.away)) + " 分 · " +
        '<span class="' + (c.same ? "agree" : "differ") + '">' + (c.same ? "兩種模式方向一致" : "兩種模式方向不一致") + "</span>";
    }

    el.innerHTML = '<div class="game-top"><span class="game-time">' + g.t + '</span><span class="game-teams">' + teams +
      "</span>" + tags + "</div>" + (line ? '<div class="game-pred">' + line + "</div>" : "");
    var li = document.createElement("li");
    li.appendChild(el);
    return li;
  }

  function renderSchedule(date) {
    curDate = date;
    var today = todayTW();
    $("date-input").value = date;
    $("date-prev").disabled = date <= today;
    $("date-next").disabled = date >= lastDate;
    var games = gamesByDate[date] || [];
    var list = $("game-list");
    list.innerHTML = "";
    games.forEach(function (g) { list.appendChild(gameItem(g, date)); });
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
    pregame = p.get("pre") === "1" && !!ak && !!hk && !!findFinal(p.get("away"), p.get("home"));  // 只有真的是那天已完賽的比賽才算
    fromDate = hasUpcoming() && isDate(p.get("date")) ? p.get("date") : null;
    updateBack();
    showTab("matchup");
    render();
  }

  // 使用者自己換球隊：這就不是賽程裡的那一場了
  function onPick() {
    neutral = false;
    pregame = false;
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
    $("date-input").min = todayTW();
    $("date-input").max = lastDate;
    $("tab-matchup").addEventListener("click", function () {
      location.hash = hashOf({ tab: "matchup", away: T[awaySel.value].abbr, home: T[homeSel.value].abbr });
    });
    $("tab-schedule").addEventListener("click", function () {
      location.hash = hashOf({ tab: "schedule", date: curDate || nextGameDate(todayTW()) || lastDate });
    });
    $("date-input").addEventListener("change", function () { goDate($("date-input").value); });
    $("date-prev").addEventListener("click", function () { goDate(addDays(curDate, -1)); });
    $("date-next").addEventListener("click", function () { goDate(addDays(curDate, 1)); });
    $("date-today").addEventListener("click", function () { goDate(todayTW()); });
  }
  window.addEventListener("hashchange", applyHash);

  if (location.hash) {
    applyHash();
  } else {
    showTab("matchup");
    render();
  }
})();
