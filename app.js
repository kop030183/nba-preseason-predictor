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
  function predictPace(a, h) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.off / a.pace * avg + h.def / h.pace * avg) / 2,
      home: (h.off / h.pace * avg + a.def / a.pace * avg) / 2 + HOME_ADV
    };
  }

  // ---------- 第二個分數：近 10 場 PACE 法（球季進行中） ----------
  // 和賽季前的 PACE 法同一個公式，只是改用「近 10 場」（不滿 10 場就用已打場數）的得失分，PACE 用本季累積值：
  // 兩隊得失分交叉配對 -> 各除以自己的 PACE（變成每回合得分）-> 乘上預估 PACE（兩隊 PACE 的平均）-> 主隊 +1
  function predictLast10(a, h) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.l10off / a.pace * avg + h.l10def / h.pace * avg) / 2,
      home: (h.l10off / h.pace * avg + a.l10def / a.pace * avg) / 2 + HOME_ADV
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

  function predictSeason(a, h) {
    var w = MODEL.recentWeight;
    var totalSeason = (a.off + h.def) / 2 + (h.off + a.def) / 2;
    var totalRecent = (a.l10off + h.l10def) / 2 + (h.l10off + a.l10def) / 2;
    var total = (1 - w) * totalSeason + w * totalRecent;
    var margin = rating(h) - rating(a) + MODEL.homeAdv;
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

  function render() {
    var aKey = awaySel.value;
    var hKey = homeSel.value;
    var hint = $("hint");
    var result = $("result");

    if (aKey === hKey) {
      hint.textContent = "客隊和主隊不能是同一支球隊，請重新選擇。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    var a = T[aKey];
    var h = T[hKey];
    // 本季 0 場的球隊沒有任何數據可算（球季進行中才會發生）
    var noGames = [a, h].filter(function (t) { return !t.gp; }).map(function (t) { return t.zh; });
    if (noGames.length) {
      hint.textContent = noGames.join("、") + " 本季尚未出賽，暫時無法預測。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    hint.hidden = true;

    var pace = MODEL ? predictSeason(a, h) : predictPace(a, h);
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
      var p2 = predictLast10(a, h);
      var same = winnerOf(p2) === wPace;
      var win2 = winnerOf(p2) === "home" ? h : a;
      alt.innerHTML =
        '<div class="alt-title">第二個分數：近 10 場 PACE 法</div>' +
        '<div class="alt-line">' + a.zh + " " + f1(p2.away) + "、" + h.zh + " " + f1(p2.home) +
        "（" + win2.zh + " 勝 " + f1(Math.abs(p2.home - p2.away)) + " 分）</div>";
      summary.className = "summary " + (same ? "agree" : "differ");
      summary.textContent = same ? "兩種模式預測方向一致 可參考" : "兩種模式預測方向不一致 看看就好";
    }

    // 交手紀錄（以客隊為主視角）；球季進行中除了本季，還附上上季的交手（只供參考，不進預測）
    var blocks = [h2hBlock(D.h2h, COPY.h2hTitle, a, h)];
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

  awaySel.addEventListener("change", render);
  homeSel.addEventListener("change", render);
  // 使用者切換淺色/深色模式時，隊色要跟著重新調整
  if (window.matchMedia) {
    var darkMq = window.matchMedia("(prefers-color-scheme: dark)");
    if (darkMq.addEventListener) darkMq.addEventListener("change", render);
    else if (darkMq.addListener) darkMq.addListener(render);
  }
  $("swap").addEventListener("click", function () {
    var tmp = awaySel.value;
    awaySel.value = homeSel.value;
    homeSel.value = tmp;
    render();
  });

  render();
})();
