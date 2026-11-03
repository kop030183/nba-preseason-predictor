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
      notice: MODEL
        ? "已完成 " + N_GAMES + " 場 " + D.season + " 例行賽（更新至 " + D.asOf + "）。預測只用本季已打的比賽，" +
          "不使用上季表現（休賽季球員異動大）。兩個分數：① 實力評分法：實力評分 = 淨勝分 × 已打場數 ÷（已打場數 + " +
          MODEL.shrinkK + "），打得少時往平均拉回；② 近 10 場 PACE 法（不滿 10 場用已打場數）。賽季初期樣本少，預測波動較大。"
        : "目前使用 " + D.season + " 例行賽已完成的 " + N_GAMES + " 場比賽數據（更新至 " + D.asOf +
          "）。賽季初期樣本少，預測波動較大。",
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
  // 實力評分 = 已打場數 x 本季淨勝分 / (已打場數 + K)，淨勝分 = 場均得分 - 場均失分（打得少時往平均拉回）
  // 預測分差 = 主隊評分 - 客隊評分 + 主場優勢（完整分差，不像 PACE 法把分差砍半，所以主場是 2 分不是 1 分）
  // 預測總分 = 兩隊本季場均得失分直接平均（不用 PACE）；再用 主隊 = 總分/2 + 分差/2 拆成兩隊比分
  function rating(t) { return t.gp * t.net / (t.gp + MODEL.shrinkK); }

  function predictSeason(a, h) {
    var total = (a.off + h.def) / 2 + (h.off + a.def) / 2;
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

  // "53-29" -> 戰績 + 換行顯示勝率 "64.6%"
  function withRate(rec) {
    var p = rec.split("-");
    var w = Number(p[0]);
    var total = w + Number(p[1]);
    return rec + '<span class="rate">' + (total ? (w / total * 100).toFixed(1) + "%" : "—") + "</span>";
  }

  // 實力評分格："+8.4" 加一行小字「已打 8 場」
  function ratingCell(t) {
    var r = rating(t);
    return (r >= 0 ? "+" : "") + f1(r) + '<span class="rate">已打 ' + t.gp + " 場</span>";
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

    // 第二個分數（只有球季進行中才有）：兩個算法預測的勝方相同或不同都標出來
    var alt = $("alt");
    alt.hidden = !MODEL;
    if (MODEL) {
      var p2 = predictLast10(a, h);
      var same = winnerOf(p2) === wPace;
      var win2 = winnerOf(p2) === "home" ? h : a;
      alt.innerHTML =
        '<div class="alt-title">第二個分數：近 10 場 PACE 法</div>' +
        '<div class="alt-line">' + a.zh + " " + f1(p2.away) + "、" + h.zh + " " + f1(p2.home) +
        "（" + win2.zh + " 勝 " + f1(Math.abs(p2.home - p2.away)) + " 分）</div>" +
        '<div class="alt-note' + (same ? "" : " differ") + '">' +
        (same ? "兩個分數預測的勝方相同。" : "兩個分數預測的勝方不同，這種比賽回測約五五波，可視為勢均力敵。") + "</div>";
    }

    // 交手紀錄（以客隊為主視角）；球季進行中除了本季，還附上上季的交手（只供參考，不進預測）
    var blocks = [h2hBlock(D.h2h, COPY.h2hTitle, a, h)];
    if (MODEL && D.h2hPrev) blocks.push(h2hBlock(D.h2hPrev, "上季（" + D.prevSeason + "）兩隊對戰 ", a, h));
    blocks = blocks.filter(Boolean);
    $("h2h").innerHTML = blocks.join("");
    $("h2h").hidden = !blocks.length;

    // 數據對照
    $("s-away").textContent = a.zh;
    $("s-home").textContent = h.zh;
    var l10note = COPY.l10note ? '<span class="row-note">' + COPY.l10note + "</span>" : "";
    var rows = [];
    if (MODEL) rows.push(["實力評分", ratingCell(a), ratingCell(h)]);
    rows.push([COPY.recLabel, withRate(a.w + "-" + a.l), withRate(h.w + "-" + h.l)]);
    rows.push(["主場戰績", withRate(a.home), withRate(h.home)]);
    rows.push(["客場戰績", withRate(a.road), withRate(h.road)]);
    rows.push(["場均得分", f1(a.off), f1(h.off)]);
    rows.push(["場均失分", f1(a.def), f1(h.def)]);
    rows.push([MODEL ? "PACE（本季）" : "PACE", f1(a.pace), f1(h.pace)]);
    rows.push(["近 10 場戰績" + l10note, a.l10rec, h.l10rec]);
    rows.push(["近 10 場得分" + l10note, f1(a.l10off), f1(h.l10off)]);
    rows.push(["近 10 場失分" + l10note, f1(a.l10def), f1(h.l10def)]);
    $("stats-body").innerHTML = rows.map(function (r) {
      return "<tr><td>" + r[1] + "</td><td>" + r[0] + "</td><td>" + r[2] + "</td></tr>";
    }).join("");

    result.hidden = false;
  }

  // ---------- 初始化 ----------
  document.title = COPY.title;
  $("page-title").textContent = COPY.title;
  var noticeStrong = document.createElement("strong");
  noticeStrong.textContent = "資料說明：";
  $("notice").appendChild(noticeStrong);
  $("notice").appendChild(document.createTextNode(COPY.notice));
  $("stats-title").textContent = COPY.statsTitle;
  $("foot-text").textContent = "數據來源：" + COPY.source + "，" + COPY.foot + "。僅供興趣參考。";

  fillSelect(awaySel);
  fillSelect(homeSel);
  awaySel.value = "Philadelphia 76ers";
  homeSel.value = "New York Knicks";

  awaySel.addEventListener("change", render);
  homeSel.addEventListener("change", render);
  $("swap").addEventListener("click", function () {
    var tmp = awaySel.value;
    awaySel.value = homeSel.value;
    homeSel.value = tmp;
    render();
  });

  render();
})();
