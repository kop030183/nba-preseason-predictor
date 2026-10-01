(function () {
  "use strict";

  var D = window.NBA_DATA;
  var T = D.teams;
  var HOME_ADV = D.homeAdvantage;

  var $ = function (id) { return document.getElementById(id); };
  var awaySel = $("away");
  var homeSel = $("home");

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

  function teamBlock(t, role, score, isWinner) {
    var el = document.createElement("div");
    el.className = "team" + (isWinner ? " winner" : "");
    el.innerHTML =
      '<span class="badge" style="background:' + t.color + '">' + t.abbr + "</span>" +
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
    hint.hidden = true;

    var a = T[aKey];
    var h = T[hKey];
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

    // 數據對照
    $("s-away").textContent = a.zh;
    $("s-home").textContent = h.zh;
    var rows = [
      ["整季戰績", withRate(a.w + "-" + a.l), withRate(h.w + "-" + h.l)],
      ["主場戰績", withRate(a.home), withRate(h.home)],
      ["客場戰績", withRate(a.road), withRate(h.road)],
      ["場均得分", f1(a.off), f1(h.off)],
      ["場均失分", f1(a.def), f1(h.def)],
      ["PACE", f1(a.pace), f1(h.pace)],
      ["近 10 場戰績", a.l10rec, h.l10rec],
      ["近 10 場得分", f1(a.l10off), f1(h.l10off)],
      ["近 10 場失分", f1(a.l10def), f1(h.l10def)]
    ];
    $("stats-body").innerHTML = rows.map(function (r) {
      return "<tr><td>" + r[1] + "</td><td>" + r[0] + "</td><td>" + r[2] + "</td></tr>";
    }).join("");

    result.hidden = false;
  }

  // ---------- 初始化 ----------
  $("season-label").textContent = D.season;
  $("asof-label").textContent = D.asOf;

  fillSelect(awaySel);
  fillSelect(homeSel);
  awaySel.value = "New York Knicks";
  homeSel.value = "San Antonio Spurs";

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
