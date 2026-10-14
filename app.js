/* Roadmap timeline.
   Reads and writes roadmap.json in the private progress-sync repo.
   This file ships no plan contents. */
(function () {
  "use strict";

  var APP_ID = "roadmap";
  var SAVE_DELAY = 2500;
  var STATUSES = ["planned", "in_progress", "done"];
  var STATUS_LABEL = {
    planned: "Planned",
    in_progress: "In progress",
    done: "Done"
  };

  var els = {
    sync: document.getElementById("sync-label"),
    main: document.getElementById("main"),
    connect: document.getElementById("connect"),
    connectBtn: document.getElementById("btn-connect")
  };

  var doc = null;
  var dirty = false;
  var inSave = false;
  var saving = false;
  var saveAgain = false;
  var saveTimer = null;
  var retried = false;
  var loading = false;
  var loadNote = "";

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function hhmm() {
    var now = new Date();
    return pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function hasToken() {
    try {
      var cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }

  function showConnect() {
    if (els.connect) els.connect.hidden = hasToken();
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return "—";
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: Number.isInteger(v) ? 0 : 2
    }).format(v);
  }

  function ratio(value, target) {
    var v = Number(value);
    var t = Number(target);
    if (!isFinite(v) || !isFinite(t) || t <= 0) return null;
    return v / t;
  }

  function statusOf(m) {
    return m && STATUSES.indexOf(m.status) >= 0 ? m.status : "planned";
  }

  function nextStatus(status) {
    var i = STATUSES.indexOf(status);
    if (i < 0) return STATUSES[0];
    return STATUSES[(i + 1) % STATUSES.length];
  }

  function targetsLabel() {
    var note = doc && typeof doc.targetsNote === "string" ? doc.targetsNote.trim() : "";
    return note || "crew estimate";
  }

  function currentMilestone() {
    var list = (doc && doc.milestones) || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].status === "in_progress") return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (list[i] && statusOf(list[i]) !== "done") return list[i];
    }
    return list.length ? list[list.length - 1] : null;
  }

  function latestCheckin() {
    var best = null;
    var list = (doc && doc.checkins) || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (!list[i] || list[i].date == null || list[i].date === "") continue;
      if (!best || String(list[i].date) > String(best.date)) best = list[i];
    }
    return best;
  }

  function normalize(data) {
    var d = data && typeof data === "object" ? data : {};
    if (!d.goal || typeof d.goal !== "object") d.goal = {};
    if (!d.baseline || typeof d.baseline !== "object") d.baseline = {};
    if (!Array.isArray(d.milestones)) d.milestones = [];
    if (!Array.isArray(d.notes)) d.notes = [];
    if (!Array.isArray(d.checkins)) d.checkins = [];
    d.milestones.forEach(function (m) {
      if (m && typeof m === "object" && !Array.isArray(m.tasks)) m.tasks = [];
    });
    return d;
  }

  function bar(percent) {
    var el = node("span", "bar");
    var fill = document.createElement("i");
    var width = percent == null ? 0 : Math.max(0, Math.min(100, percent));
    fill.style.width = width + "%";
    el.appendChild(fill);
    return el;
  }

  function progressBlock(caption, value, target) {
    var block = node("div", "bar-block");
    var cap = node("p", "bar-cap");
    cap.appendChild(node("span", "", caption));
    var share = ratio(value, target);
    if (share == null) {
      cap.appendChild(node("b", "", "—"));
      block.appendChild(cap);
      return block;
    }
    cap.appendChild(node("b", "", Math.round(share * 100) + "%"));
    block.appendChild(cap);
    block.appendChild(bar(share * 100));
    return block;
  }

  function renderEmpty(message) {
    clear(els.main);
    var card = node("section", "card empty");
    card.appendChild(node("span", "big", "🗺️"));
    card.appendChild(node("p", "", message));
    els.main.appendChild(card);
  }

  function renderHero() {
    var goal = doc.goal || {};
    var hero = node("section", "hero");
    hero.setAttribute("aria-label", "Goal");
    hero.appendChild(node("h2", "", goal.text ? String(goal.text) : "Roadmap"));
    if (goal.targetDate) {
      hero.appendChild(node("p", "goal-when", "Target " + goal.targetDate));
    }

    var latest = latestCheckin();
    var value = latest && isFinite(Number(latest.netWorth)) ? Number(latest.netWorth) : null;
    hero.appendChild(node("p", "stat-num", value == null ? "—" : money(value)));
    hero.appendChild(node(
      "p",
      "stat-label",
      latest ? "Latest check-in · " + latest.date : "No check-in yet"
    ));

    var milestone = currentMilestone();
    var milestoneCaption = milestone
      ? String(milestone.title || "Milestone") + " · " + money(milestone.netWorthTarget)
      : "No current milestone";
    hero.appendChild(progressBlock(
      milestoneCaption,
      value == null ? 0 : value,
      milestone ? milestone.netWorthTarget : null
    ));

    var goalCaption = goal.amount != null ? "Goal · " + money(goal.amount) : "Goal";
    hero.appendChild(progressBlock(goalCaption, value == null ? 0 : value, goal.amount));

    var base = doc.baseline || {};
    if (base.monthlySurplus != null && base.monthlySurplus !== "") {
      var surplus = node("p", "surplus");
      surplus.appendChild(node("span", "", "Monthly surplus "));
      surplus.appendChild(node("b", "", money(base.monthlySurplus)));
      if (base.asOf) surplus.appendChild(node("span", "", " · as of " + base.asOf));
      hero.appendChild(surplus);
    }

    return hero;
  }

  function renderMilestone(m, index) {
    var status = statusOf(m);
    var item = node("li", "ms " + status);
    item.appendChild(node("span", "dot"));
    var card = node("article", "card ms-card");
    var top = node("div", "ms-top");
    var when = node("time", "when", m.when ? String(m.when) : "");
    if (m.when) when.setAttribute("datetime", String(m.when));
    top.appendChild(when);
    var chip = node("button", "status " + status, STATUS_LABEL[status]);
    chip.type = "button";
    chip.setAttribute("data-action", "status");
    chip.setAttribute("data-i", String(index));
    chip.setAttribute("aria-label", "Status " + STATUS_LABEL[status] + ". Tap to change.");
    top.appendChild(chip);
    card.appendChild(top);
    card.appendChild(node("h3", "", m.title ? String(m.title) : "Milestone"));
    var target = node("p", "ms-target");
    target.appendChild(document.createTextNode(money(m.netWorthTarget)));
    target.appendChild(node("span", "", targetsLabel()));
    card.appendChild(target);

    var tasks = Array.isArray(m.tasks) ? m.tasks : [];
    if (!tasks.length) {
      card.appendChild(node("p", "muted", "No tasks."));
    } else {
      var list = node("ul", "tasks");
      tasks.forEach(function (task, ti) {
        if (!task || typeof task !== "object") return;
        var li = node("li");
        var label = node("label", task.done ? "task done" : "task");
        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!task.done;
        box.setAttribute("data-action", "task");
        box.setAttribute("data-mi", String(index));
        box.setAttribute("data-ti", String(ti));
        label.appendChild(box);
        label.appendChild(node("span", "", task.text ? String(task.text) : ""));
        li.appendChild(label);
        list.appendChild(li);
      });
      card.appendChild(list);
    }
    item.appendChild(card);
    return item;
  }

  function renderTimeline() {
    var wrap = document.createDocumentFragment();
    wrap.appendChild(node("h2", "section-title", "Milestones"));
    var list = doc.milestones || [];
    if (!list.length) {
      var empty = node("section", "card");
      empty.appendChild(node("p", "muted", "No milestones yet."));
      wrap.appendChild(empty);
      return wrap;
    }
    var ol = node("ol", "timeline");
    list.forEach(function (m, i) {
      if (!m || typeof m !== "object") return;
      ol.appendChild(renderMilestone(m, i));
    });
    wrap.appendChild(ol);
    return wrap;
  }

  function field(name, label, type, value, required) {
    var lab = node("label");
    lab.appendChild(document.createTextNode(label));
    var input = document.createElement("input");
    input.name = name;
    input.type = type;
    if (type === "number") {
      input.inputMode = "decimal";
      input.step = "any";
    }
    if (value != null) input.value = value;
    if (required) input.required = true;
    lab.appendChild(input);
    return lab;
  }

  function renderCheckins() {
    var wrap = document.createDocumentFragment();
    wrap.appendChild(node("h2", "section-title", "Check-ins"));
    var card = node("section", "card");
    var milestone = currentMilestone();
    var latest = latestCheckin();
    var value = latest && isFinite(Number(latest.netWorth)) ? Number(latest.netWorth) : 0;
    var caption = milestone
      ? "Latest vs " + (milestone.title || "milestone") + " · " + money(milestone.netWorthTarget)
      : "No active target";
    card.appendChild(progressBlock(caption, latest ? value : 0, milestone ? milestone.netWorthTarget : null));

    var form = document.createElement("form");
    form.className = "checkin-form";
    form.setAttribute("data-action", "checkin");
    form.autocomplete = "off";
    form.appendChild(field("date", "Date", "date", todayISO(), true));
    form.appendChild(field("netWorth", "Net worth", "number", "", true));
    form.appendChild(field("investedPerMonth", "Invested / month", "number", "", false));
    form.appendChild(field("sideIncome", "Side income", "number", "", false));
    var add = node("button", "add-btn", "Add check-in");
    add.type = "submit";
    form.appendChild(add);
    card.appendChild(form);

    var rows = (doc.checkins || []).map(function (c, i) {
      return { c: c, i: i };
    }).filter(function (row) {
      return row.c && typeof row.c === "object";
    }).sort(function (a, b) {
      return String(b.c.date || "").localeCompare(String(a.c.date || ""));
    });

    if (!rows.length) {
      card.appendChild(node("p", "muted", "No check-ins yet."));
    }
    rows.forEach(function (row) {
      var c = row.c;
      var block = node("article", "checkin");
      block.appendChild(node("p", "checkin-date", c.date ? String(c.date) : "Undated"));
      block.appendChild(node("p", "checkin-main", money(c.netWorth)));
      var meta = node("p", "checkin-meta");
      meta.textContent = "Invested / month " + money(c.investedPerMonth) + " · Side income " + money(c.sideIncome);
      block.appendChild(meta);
      var shareCaption = milestone ? (milestone.title || "Target") : "No active target";
      block.appendChild(progressBlock(
        shareCaption,
        c.netWorth,
        milestone ? milestone.netWorthTarget : null
      ));
      card.appendChild(block);
    });
    wrap.appendChild(card);
    return wrap;
  }

  function renderNotes() {
    var wrap = document.createDocumentFragment();
    wrap.appendChild(node("h2", "section-title", "Notes"));
    var card = node("section", "card");
    var notes = doc.notes || [];
    if (!notes.length) {
      card.appendChild(node("p", "muted", "No notes."));
    } else {
      var ul = node("ul", "notes");
      notes.forEach(function (note) {
        if (note == null || note === "") return;
        ul.appendChild(node("li", "", String(note)));
      });
      if (!ul.childNodes.length) card.appendChild(node("p", "muted", "No notes."));
      else card.appendChild(ul);
    }
    wrap.appendChild(card);
    return wrap;
  }

  function renderPlan() {
    clear(els.main);
    els.main.appendChild(renderHero());
    els.main.appendChild(renderTimeline());
    els.main.appendChild(renderCheckins());
    els.main.appendChild(renderNotes());
  }

  function render() {
    if (!els.main) return;
    if (!hasToken()) {
      renderEmpty("Your plan stays private. Connect sync to load it on this device.");
      return;
    }
    if (!doc) {
      renderEmpty(loadNote || "Loading your plan…");
      return;
    }
    renderPlan();
  }

  function fail(err) {
    var message = err && err.message ? err.message : String(err);
    if (els.sync) els.sync.textContent = "⚠️ " + message;
    if (/No GitHub token|token rejected|Not synced/i.test(message)) loadNote = "";
    showConnect();
    if (!hasToken()) render();
  }

  function scheduleSave() {
    dirty = true;
    retried = false;
    if (!hasToken()) {
      if (els.sync) els.sync.textContent = "📴 Not synced";
      showConnect();
      return;
    }
    if (els.sync) els.sync.textContent = "✏️ Saving soon…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushNow, SAVE_DELAY);
  }

  function touch() {
    if (!doc) return;
    doc.updatedAt = new Date().toISOString();
    scheduleSave();
    render();
  }

  function pushNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!doc || !hasToken() || !window.GhSync) return;
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    inSave = true;
    if (els.sync) els.sync.textContent = "☁️ Saving…";
    GhSync.save(APP_ID, function () {
      return doc;
    }, applyRemote, { quiet: true }).then(function () {
      saving = false;
      inSave = false;
      retried = false;
      if (!saveAgain) dirty = false;
      if (els.sync) els.sync.textContent = "✅ Saved " + hhmm();
      if (saveAgain) {
        saveAgain = false;
        pushNow();
      }
    }, function (err) {
      saving = false;
      inSave = false;
      fail(err);
      if (!retried && /another device/.test(String(err && err.message))) {
        retried = true;
        saveTimer = setTimeout(pushNow, 3000);
      }
    });
  }

  function applyRemote(remote) {
    if (inSave) return;
    if (!remote || typeof remote !== "object") return;
    doc = normalize(remote);
    dirty = false;
    loadNote = "";
    render();
  }

  function autoLoad() {
    showConnect();
    if (!hasToken()) {
      doc = null;
      loadNote = "";
      if (els.sync) els.sync.textContent = "📴 Not synced";
      render();
      return;
    }
    if (loading || saving || saveTimer || dirty) return;
    var active = document.activeElement;
    if (active && active.closest && active.closest("#main form")) return;
    loading = true;
    GhSync.load(APP_ID, applyRemote).then(function (msg) {
      loading = false;
      if (!doc) {
        loadNote = msg || "Nothing saved on GitHub yet";
        if (els.sync) els.sync.textContent = loadNote;
        render();
      } else if (els.sync) {
        els.sync.textContent = "☁️ Synced " + hhmm();
      }
      showConnect();
    }, function (err) {
      loading = false;
      loadNote = err && err.message ? err.message : "Could not load";
      render();
      fail(err);
    });
  }

  function readNumber(form, name, fallback) {
    var raw = String(new FormData(form).get(name) || "").trim();
    if (!raw) return fallback;
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  function onMainClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-action='status']") : null;
    if (!btn || !doc) return;
    var i = Number(btn.getAttribute("data-i"));
    var milestone = doc.milestones && doc.milestones[i];
    if (!milestone) return;
    milestone.status = nextStatus(statusOf(milestone));
    touch();
  }

  function onMainChange(e) {
    var box = e.target;
    if (!box || !box.getAttribute || box.getAttribute("data-action") !== "task" || !doc) return;
    var mi = Number(box.getAttribute("data-mi"));
    var ti = Number(box.getAttribute("data-ti"));
    var milestone = doc.milestones && doc.milestones[mi];
    var task = milestone && milestone.tasks && milestone.tasks[ti];
    if (!task) return;
    task.done = !!box.checked;
    touch();
  }

  function onMainSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute || form.getAttribute("data-action") !== "checkin") return;
    e.preventDefault();
    if (!doc) return;
    if (!Array.isArray(doc.checkins)) doc.checkins = [];
    var data = new FormData(form);
    var date = String(data.get("date") || "").trim();
    var netWorth = readNumber(form, "netWorth", null);
    var invested = readNumber(form, "investedPerMonth", 0);
    var side = readNumber(form, "sideIncome", 0);
    if (!date || netWorth == null || invested == null || side == null) {
      if (els.sync) els.sync.textContent = "⚠️ Check the check-in amounts";
      return;
    }
    doc.checkins.push({
      date: date,
      netWorth: netWorth,
      investedPerMonth: invested,
      sideIncome: side
    });
    touch();
  }

  if (!els.main || !window.GhSync || typeof GhSync.load !== "function") {
    if (els.sync) els.sync.textContent = "GitHub sync failed to load.";
    if (els.main) renderEmpty("GitHub sync failed to load.");
    return;
  }

  els.main.addEventListener("click", onMainClick);
  els.main.addEventListener("change", onMainChange);
  els.main.addEventListener("submit", onMainSubmit);
  if (els.connectBtn) {
    els.connectBtn.addEventListener("click", function () {
      GhSync.load(APP_ID, applyRemote).then(function (msg) {
        showConnect();
        if (!doc) {
          loadNote = msg || "Nothing saved on GitHub yet";
          if (els.sync) els.sync.textContent = loadNote;
          render();
        } else if (els.sync) {
          els.sync.textContent = "☁️ Synced " + hhmm();
        }
      }, fail);
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && saveTimer) pushNow();
    if (document.visibilityState === "visible") autoLoad();
  });

  showConnect();
  render();
  setInterval(autoLoad, 60000);
  autoLoad();
})();
