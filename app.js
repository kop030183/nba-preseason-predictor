(function () {
  "use strict";

  var D = window.NBA_DATA;
  var T = D.teams;
  var HOME_ADV = D.homeAdvantage;

  var $ = function (id) { return document.getElementById(id); };
  var awaySel = $("away");
  var homeSel = $("home");

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
      foot: "整理自 " + D.season + " 例行賽 " + N_GAMES + " 場"
    },
    in_season: {
      title: "NBA 對戰預測",
      notice: "目前使用 " + D.season + " 例行賽已完成的 " + N_GAMES + " 場比賽數據（更新至 " + D.asOf +
        "）。賽季初期樣本少，預測波動較大。",
      statsTitle: D.season + " 本季數據對照",
      l10note: "",
      h2hTitle: D.season + " 例行賽兩隊對戰 ",
      foot: "整理自 " + D.season + " 例行賽已完成的 " + N_GAMES + " 場（更新至 " + D.asOf + "）"
    }
  }[MODE];

  // ---------- 預測公式（與舊專案 api.py 完全一致） ----------
  function predictPace(a, h) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.off / a.pace * avg + h.def / h.pace * avg) / 2,
      home: (h.off / h.pace * avg + a.def / a.pace * avg) / 2 + HOME_ADV
    };
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
  function f1(n) { return n.toFixed(1); }

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
    return rec + '<span class="rate">' + (total ? (w / total * 100).toFixed(1) : "0.0") + "%</span>";
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
    var noGames = [a, h].filter(function (t) { return !t.gp; }).map(function (t) { return t.zh; });
    if (noGames.length) {
      hint.textContent = noGames.join("、") + " 本季尚未出賽，暫時無法預測。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    hint.hidden = true;

    var pace = predictPace(a, h);
    var wPace = winnerOf(pace);

    // 主記分板
    setBlock("board-away", teamBlock(a, "客隊", pace.away, wPace === "away"));
    setBlock("board-home", teamBlock(h, "主隊", pace.home, wPace === "home"));
    var winTeam = wPace === "home" ? h : a;
    var diff = Math.abs(pace.home - pace.away);
    $("verdict-tag").textContent = winTeam.zh + " 勝";
    $("board-margin").textContent =
      "預測分差 " + f1(diff) + " 分，總分 " + f1(pace.home + pace.away) + " 分";

    // 上季交手紀錄（以客隊為主視角）
    var pair = [a.abbr, h.abbr].sort();
    var meetings = D.h2h[pair[0] + "-" + pair[1]] || [];
    var awayFirst = a.abbr === pair[0];
    var awayWins = 0;
    var lines = meetings.map(function (m) {
      var ap = awayFirst ? m[0] : m[1];
      var hp = awayFirst ? m[1] : m[0];
      if (ap > hp) awayWins++;
      return '<div class="h2h-game">' + a.zh + " " + ap + "、" + h.zh + " " + hp + "</div>";
    });
    $("h2h").innerHTML = meetings.length
      ? '<div class="h2h-title">' + COPY.h2hTitle + meetings.length + " 場：" + a.zh + " " +
        awayWins + " 勝 " + (meetings.length - awayWins) + " 敗</div>" + lines.join("")
      : "";
    $("h2h").hidden = !meetings.length;

    // 數據對照
    $("s-away").textContent = a.zh;
    $("s-home").textContent = h.zh;
    var l10note = COPY.l10note ? '<span class="row-note">' + COPY.l10note + "</span>" : "";
    var rows = [
      ["整季戰績", withRate(a.w + "-" + a.l), withRate(h.w + "-" + h.l)],
      ["主場戰績", withRate(a.home), withRate(h.home)],
      ["客場戰績", withRate(a.road), withRate(h.road)],
      ["場均得分", f1(a.off), f1(h.off)],
      ["場均失分", f1(a.def), f1(h.def)],
      ["PACE", f1(a.pace), f1(h.pace)],
      ["近 10 場戰績" + l10note, a.l10rec, h.l10rec],
      ["近 10 場得分" + l10note, f1(a.l10off), f1(h.l10off)],
      ["近 10 場失分" + l10note, f1(a.l10def), f1(h.l10def)]
    ];
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
  $("foot-text").textContent = "數據來源：Basketball-Reference.com，" + COPY.foot + "。僅供興趣參考。";

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
