"use strict";
(() => {
  const D = WaterData,
    $ = (id) => document.getElementById(id);
  const state = {
    rows: [],
    selected: [],
    hours: 72,
    zoom: null,
    page: 0,
    loading: false,
    status: null,
    fetched: null,
    error: null,
    estimates: null,
    estimateError: false,
  };
  const charts = {};
  const fields = [
    { key: "vodostaj", id: "water", unit: "cm", digits: 1, color: "--water" },
    { key: "protok", id: "flow", unit: "m³/s", digits: 2, color: "--flow" },
  ];
  let renderBounds;
  let rangeDirty = false;
  const inputTime = (stamp) => D.hourKey(stamp);
  let theme;
  try {
    theme = localStorage.getItem("ilova-theme");
  } catch {}
  document.documentElement.dataset.theme = ["light", "dark"].includes(theme)
    ? theme
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  function setText(id, value) {
    $(id).textContent = value;
  }
  function ageLabel(hours) {
    if (hours < -1) return "Buduća oznaka";
    if (hours < 1) return "Prije manje od sat";
    if (hours < 48) return `Prije ${Math.floor(hours)} h`;
    return `Prije ${Math.floor(hours / 24)} dana`;
  }
  function banner(now) {
    const last = fields.map((f) => D.latest(state.rows, f.key));
    const ages = last.map((r) => (r ? (now - r.dt) / D.HOUR : Infinity));
    let type = "ok",
      title = "Mjerenja su svježa",
      description = "Oba mjerenja objavljena su unutar posljednja 3 sata.";
    if (state.error) {
      type = "error";
      title = state.rows.length
        ? "Osvježavanje nije uspjelo"
        : "Podaci trenutačno nisu dostupni";
      description = state.rows.length
        ? "Zadržan je prethodno učitan pregled. Pokušaj ponovno gumbom „Osvježi podatke”."
        : `${state.error} Pokušaj ponovno gumbom „Osvježi podatke”.`;
    } else if (ages.some((a) => a < -1)) {
      type = "error";
      title = "Provjeri vrijeme izvora";
      description =
        "Izvor sadrži buduću vremensku oznaku. Mjerenja nisu potvrđena kao svježa.";
    } else if (ages.some((a) => a > 3)) {
      type = "stale";
      const confirmedDelay = Object.values(state.status?.sources ?? {}).some(
        (source) => source.status === "stale",
      );
      title = confirmedDelay
        ? "Izvor kasni s mjerenjima"
        : "Mjerenja nisu svježa";
      description =
        "Prikazana su posljednja poznata mjerenja. Nova mjerenja kasne ili još nisu prikupljena; spremljena arhiva ostaje dostupna.";
    } else if (D.latest(state.rows, 'protok')?.estimatedProtok) {
      type = "warning";
      title = "Protok je procijenjen iz vodostaja";
      description = "Prikazana je procjena prema povijesnoj krivulji Q(H). Objavljeni protok trenutačno nije dostupan za zadnji sat.";
    } else if (
      state.status?.status === "error" ||
      Object.keys(state.status?.source_errors ?? {}).length
    ) {
      type = "warning";
      title = "Prikupljanje je djelomično nedostupno";
      description =
        "Provjeri status prikupljanja niže. Raspoloživa mjerenja su sačuvana.";
    } else if (
      state.status?.checked_at &&
      now - Date.parse(state.status.checked_at) > 3 * D.HOUR
    ) {
      type = "warning";
      title = "Čekamo novi pokušaj prikupljanja";
      description =
        "Mjerenja su još svježa, ali zadnji prijavljeni pokušaj prikupljanja stariji je od 3 sata.";
    }
    $("status-banner").dataset.state = type;
    setText("status-title", title);
    setText("status-description", description);
  }
  function updateLatest(now) {
    for (const f of fields) {
      const row = D.latest(state.rows, f.key),
        age = row ? (now - row.dt) / D.HOUR : Infinity;
      setText(`${f.id}-value`, D.formatNumber(row?.[f.key], f.digits));
      if (f.key === "protok") {
        setText("flow-origin", row?.estimatedProtok ? "Procjena Q(H) · nije objavljeni protok" : "Objavljeni protok Hrvatskih voda");
      }
      setText(
        `${f.id}-time`,
        row ? D.formatTime(row.dt) : "Nema dostupnog mjerenja",
      );
      setText(`${f.id}-age`, row ? ageLabel(age) : "Nedostupno");
      $(`${f.id}-age`).classList.toggle("stale", age > 3 || age < -1);
      const delta = D.delta24(state.rows, f.key);
      setText(
        `${f.id}-change`,
        delta === null
          ? "Nema usporedbe za prethodni dan"
          : `${delta > 0 ? "↗ +" : delta < 0 ? "↘ " : "→ "}${D.formatNumber(delta, f.digits)} ${f.unit} prema prethodnom danu`,
      );
    }
  }
  function updateCharts(rows, start, end) {
    if (typeof Chart === "undefined") {
      setText(
        "chart-note",
        "Grafovi se nisu mogli učitati. Sva dostupna mjerenja možeš pregledati u tablici i preuzeti kao CSV.",
      );
      return;
    }
    const daily = $("aggregation").value === "daily";
    const plotted = (daily ? D.dailyRows(rows) : D.chartRows(rows)).map(
      (row) =>
        daily && state.zoom
          ? { ...row, dt: Math.min(end, Math.max(start, row.dt)) }
          : row,
    );
    const css = getComputedStyle(document.documentElement),
      ink = css.getPropertyValue("--muted").trim(),
      grid = css.getPropertyValue("--line").trim();
    for (const f of fields) {
      const stats = D.summary(rows, f.key),
        color = css.getPropertyValue(f.color).trim();
      setText(
        `${f.id}-range`,
        `${stats.count.toLocaleString("hr-HR")} mjerenja`,
      );
      const summary = $(`${f.id}-summary`);
      summary.replaceChildren();
      for (const [label, val] of [
        ["Minimum", stats.min],
        ["Prosjek", stats.mean],
        ["Maksimum", stats.max],
      ]) {
        const span = document.createElement("span"),
          b = document.createElement("b");
        span.textContent = label;
        b.textContent = `${D.formatNumber(val, f.digits)} ${f.unit}`;
        span.append(b);
        summary.append(span);
      }
      const points = plotted.map((r) => ({
        x: r.dt,
        y: r[f.key],
        count: r.counts?.[f.key],
        estimated: f.key === "protok" && r.estimatedProtok,
        estimatedCount: r.estimatedCount,
      }));
      const dayPadding = daily && !state.zoom ? 12 * D.HOUR : 0;
      const min = Math.min(start, points[0]?.x ?? start) - dayPadding;
      const max =
        Math.max(end, points.at(-1)?.x ?? end, min + 60000) + dayPadding;
      const config = {
        type: "line",
        plugins: [ChartRangeSelection],
        data: {
          datasets: [
            {
              label: f.id === "water" ? "Vodostaj" : "Protok",
              data: points,
              borderColor: color,
              backgroundColor: color + "12",
              borderWidth: 2,
              fill: true,
              tension: 0,
              spanGaps: false,
              segment: {
                borderDash: (ctx) => ctx.p0.raw.estimated || ctx.p1.raw.estimated ? [6, 4] : undefined,
              },
              pointStyle: (ctx) => ctx.raw?.estimated ? "triangle" : "circle",
              pointRadius: (ctx) => {
                const i = ctx.dataIndex;
                const isolated =
                  Number.isFinite(points[i]?.y) &&
                  !Number.isFinite(points[i - 1]?.y) &&
                  !Number.isFinite(points[i + 1]?.y);
                return isolated ? 3 : points.length < 100 ? 2 : 0;
              },
              pointHoverRadius: 5,
            },
          ],
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          parsing: false,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          plugins: {
            rangeSelection: {
              color,
              onSelect: (from, to) => {
                const start = Math.max(
                  renderBounds.start,
                  Math.round(from / 60000) * 60000,
                );
                const end = Math.min(
                  renderBounds.end,
                  Math.round(to / 60000) * 60000,
                );
                if (end - start >= 60000) applyZoom(start, end);
              },
            },
            legend: { display: false },
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) =>
                  items.length
                    ? daily
                      ? D.dayKey(items[0].parsed.x)
                          .split("-")
                          .reverse()
                          .join(".")
                      : D.formatTime(items[0].parsed.x)
                    : "",
                label: (ctx) =>
                  `${daily ? "Prosjek: " : ""}${D.formatNumber(ctx.parsed.y, f.digits)} ${f.unit}${daily ? ` (${ctx.raw.count} uzoraka${ctx.raw.estimated ? `; ${ctx.raw.estimatedCount} procjena` : ""})` : ctx.raw.estimated ? " · PROCJENA Q(H)" : ""}`,
              },
            },
          },
          scales: {
            x: {
              type: "linear",
              min,
              max,
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: ink,
                maxTicksLimit: 5,
                maxRotation: 0,
                font: { size: 10 },
                callback: (t) => {
                  const p = D.parts(t);
                  return end - start <= 72 * D.HOUR
                    ? `${p.day}.${p.month}. ${p.hour}:${p.minute}`
                    : `${p.day}.${p.month}.`;
                },
              },
            },
            y: {
              grid: { color: grid },
              border: { display: false },
              ticks: {
                color: ink,
                maxTicksLimit: 5,
                font: { size: 10 },
                callback: (t) => D.formatNumber(t, f.digits),
              },
            },
          },
        },
      };
      if (charts[f.id]) charts[f.id].destroy();
      charts[f.id] = new Chart($(`chart-${f.id}`), config);
    }
    setText(
      "chart-note",
      daily
        ? "Dnevni prosjeci dostupnih sati. U opisu točke vidi se broj mjerenja; nepotpuni dani mogu imati manje uzoraka."
        : "Prekid linije označava nedostajuće podatke. Isprekidani protok i trokuti označavaju procjenu Q(H); puna linija označava objavljene podatke.",
    );
  }
  function updateQuality(rows, start, end, now) {
    const auditEnd = Math.min(end, now - 3 * D.HOUR);
    const c = D.coverage(rows, start, auditEnd);
    setText(
      "coverage",
      c.percent === null ? "—" : `${D.formatNumber(c.percent, 1)} %`,
    );
    $("coverage-bar").style.width = `${c.percent ?? 0}%`;
    setText(
      "coverage-description",
      `Popunjenost objavljenih mjerenja (procjene se ne računaju) · ${c.total.toLocaleString("hr-HR")} očekivanih satnih oznaka · posljednja 3 sata izuzeta zbog kašnjenja objave`,
    );
    const list = $("gap-list");
    list.replaceChildren();
    for (const f of fields) {
      const missing = c.missing[f.key];
      setText(
        `${f.id}-missing`,
        c.total
          ? `${c.total - missing.length} / ${c.total} sati · nedostaje ${missing.length}`
          : "Nema sati za provjeru",
      );
      const section = document.createElement("div"),
        strong = document.createElement("strong"),
        ul = document.createElement("ul");
      strong.textContent = f.id === "water" ? "Vodostaj" : "Protok";
      for (const t of missing.slice(-200).reverse()) {
        const li = document.createElement("li");
        li.textContent = D.formatTime(t);
        ul.append(li);
      }
      if (!missing.length) {
        const li = document.createElement("li");
        li.textContent = "Nema nedostajućih sati u provjeri.";
        ul.append(li);
      }
      if (missing.length > 200) {
        const li = document.createElement("li");
        li.textContent = `Prikazano posljednjih 200 od ${missing.length} sati.`;
        ul.append(li);
      }
      section.append(strong, ul);
      list.append(section);
    }
    const status = state.status;
    if (status?.checked_at && Number.isFinite(Date.parse(status.checked_at))) {
      const labels = {
        ok: "Uredno",
        degraded: "Kašnjenje ili nepotpun izvor",
        error: "Dohvat nije uspio",
      };
      const failed = Object.keys(status.source_errors ?? {});
      setText(
        "collection-status",
        `${labels[status.status] ?? "Nepoznat status"} · ${D.formatTime(Date.parse(status.checked_at))}${status.fallback?.status && status.fallback.status !== "error" ? " · rezervni izvor vodostaja (1491)" : ""}${failed.length ? ` · primarni izvor: ${failed.join(", ")}` : ""}`,
      );
    } else
      setText(
        "collection-status",
        "Status pokušaja nije dostupan. Starost mjerenja provjerena je iz arhive.",
      );
  }
  function updateRatingCurve() {
    const model = state.estimates?.model;
    const count = state.selected.filter((r) => r.estimatedProtok).length;
    setText("estimate-note", state.estimateError
      ? "Procjene protoka nisu se mogle učitati. Prikazani su samo objavljeni podaci."
      : `${count.toLocaleString("hr-HR")} procjena protoka u odabranom razdoblju. Procjene se ne računaju kao objavljena mjerenja u provjeri popunjenosti. Dnevni prosjeci i statistike uključuju prikazane procjene.`);
    $("rating-chart-wrap").hidden = !model;
    if (!model) {
      setText("rating-summary", "Za krivulju je potrebno najmanje 20 povijesnih parova na 5 različitih vodostaja.");
      if (charts.rating) { charts.rating.destroy(); delete charts.rating; }
      return;
    }
    const validation = model.validation;
    setText("rating-summary", `${model.sample_count.toLocaleString("hr-HR")} objavljenih parova · ${model.knots.length} vodostaja · raspon ${D.formatNumber(model.min_h_cm, 0)}–${D.formatNumber(model.max_h_cm, 0)} cm. Medijani po vodostaju, monotona krivulja i linearna interpolacija; bez stalnog koeficijenta i bez ekstrapolacije. Praznine veće od ${model.max_gap_cm} cm ne preračunavaju se.`);
    const temporal = validation?.chronological_last_20_percent;
    const levels = validation?.held_out_levels;
    setText("rating-validation", temporal && levels
      ? `Provjera na zadnjih 20 % povijesnih parova: MAE ${D.formatNumber(temporal.mae_m3s, 4)} m³/s (${temporal.predicted}/${temporal.tested} pokrivenih). Provjera na izostavljenim vodostajima: MAE ${D.formatNumber(levels.mae_m3s, 4)} m³/s (${levels.predicted}/${levels.tested}). To opisuje slaganje s arhivom, a ne jamči točnost budućeg protoka. Krivulja nije službena protočna krivulja operatora.`
      : "Povijesna provjera nije dostupna.");
    if (typeof Chart === "undefined") return;
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue("--flow").trim();
    const ink = css.getPropertyValue("--muted").trim();
    const line = [];
    for (const knot of model.knots) {
      if (line.length && knot.h_cm - line.at(-1).x > model.max_gap_cm)
        line.push({x: (line.at(-1).x + knot.h_cm) / 2, y: null});
      line.push({x: knot.h_cm, y: knot.q_m3s});
    }
    const last = D.latest(state.rows, 'protok');
    const data = {datasets: [
      {label: "Povijesna krivulja Q(H)", data: line, borderColor: color,
       backgroundColor: color, pointRadius: 1, borderWidth: 2, spanGaps: false},
      {label: "Posljednja procjena", data: last?.estimatedProtok ? [{x: last.vodostaj, y: last.protok}] : [],
       pointRadius: 6, pointStyle: "triangle", backgroundColor: ink, showLine: false},
    ]};
    const options = {animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: {legend: {labels: {color: ink}}, tooltip: {callbacks: {
        title: (items) => items.length ? `Vodostaj: ${D.formatNumber(items[0].parsed.x, 1)} cm` : "",
        label: (ctx) => `Q(H): ${D.formatNumber(ctx.parsed.y, 2)} m³/s`,
      }}},
      scales: {x: {type: "linear", title: {display: true, text: "Vodostaj H (cm)", color: ink}, ticks: {color: ink}},
               y: {title: {display: true, text: "Protok Q (m³/s)", color: ink}, ticks: {color: ink}}}};
    if (charts.rating) {
      charts.rating.data = data;
      charts.rating.options = options;
      charts.rating.update('none');
    } else charts.rating = new Chart($("chart-rating"), {type: "line", data, options});
  }
  function tableRows() {
    let rows = state.selected;
    if ($("incomplete").checked)
      rows = rows.filter((r) => r.vodostaj === null || r.protok === null || r.estimatedProtok);
    return $("table-sort").value === "desc" ? [...rows].reverse() : rows;
  }
  function updateTable() {
    const rows = tableRows(),
      size = 25,
      pages = Math.max(1, Math.ceil(rows.length / size));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const pageRows = rows.slice(state.page * size, (state.page + 1) * size),
      body = $("table-body");
    body.replaceChildren();
    for (const r of pageRows) {
      const tr = document.createElement("tr");
      for (const value of [
        r.datum,
        r.vrijeme,
        D.formatNumber(r.vodostaj, 1),
        D.formatNumber(r.protok, 2),
        r.estimatedProtok ? "Protok: procjena Q(H)" : r.vodostaj === null || r.protok === null ? "Nepotpun" : "Oba mjerenja",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    if (!pageRows.length) {
      const tr = document.createElement("tr"),
        td = document.createElement("td");
      td.colSpan = 5;
      td.className = "table-empty";
      td.textContent = $("incomplete").checked
        ? "Nema nepotpunih zapisa. Potpuno nedostajući sati navedeni su u pregledu iznad."
        : "Nema mjerenja u odabranom razdoblju.";
      tr.append(td);
      body.append(tr);
    }
    setText(
      "table-count",
      rows.length
        ? `${state.page * size + 1}–${Math.min((state.page + 1) * size, rows.length)} od ${rows.length.toLocaleString("hr-HR")} zapisa`
        : "0 zapisa",
    );
    setText("page-label", `${state.page + 1} / ${pages}`);
    $("prev-page").disabled = !state.page;
    $("next-page").disabled = state.page + 1 >= pages;
  }
  function render() {
    if (!state.rows.length) return;
    const now = Date.now();
    renderBounds =
      state.zoom ?? D.bounds(state.rows, state.hours, now, $("anchor").checked);
    const { start, end } = renderBounds;
    state.selected = D.filter(state.rows, start, end);
    if (!rangeDirty) {
      $("date-from").value = inputTime(start);
      $("date-to").value = inputTime(end);
    }
    $("reset-zoom").disabled = !state.zoom;
    const earliest = inputTime(state.rows[0].dt),
      latest = inputTime(Math.max(now, state.rows.at(-1).dt));
    for (const id of ["date-from", "date-to"]) {
      $(id).min = earliest;
      $(id).max = latest;
    }
    setText(
      "period-label",
      `${D.formatTime(start)} — ${D.formatTime(end)} · Europe/Zagreb`,
    );
    setText(
      "period-count",
      `${state.selected.length.toLocaleString("hr-HR")} satnih zapisa`,
    );
    $("empty-state").hidden = Boolean(state.selected.length);
    $("export").disabled = !state.selected.length;
    $("show-archive").disabled = false;
    $("show-archive-table").disabled = false;
    setText(
      "dataset-summary",
      `${state.rows.length.toLocaleString("hr-HR")} satnih zapisa · ${D.formatTime(state.rows[0].dt)} — ${D.formatTime(state.rows.at(-1).dt)}`,
    );
    setText(
      "archive-scope",
      `Prikaz ${state.selected.length.toLocaleString("hr-HR")} od ukupno ${state.rows.length.toLocaleString("hr-HR")} zapisa u datasetu. ${state.hours === 0 && !state.zoom ? "Odabrana je cijela arhiva." : "Tablica prati odabrano razdoblje."}`,
    );
    banner(now);
    updateLatest(now);
    updateCharts(state.selected, start, end);
    updateQuality(state.selected, start, end, now);
    updateTable();
    updateRatingCurve();
  }
  async function resource(path, json = false) {
    const response = await fetch(`${path}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Dohvat nije uspio (HTTP ${response.status}).`);
    return json ? response.json() : response.text();
  }
  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    $("refresh").disabled = true;
    $("refresh").setAttribute("aria-busy", "true");
    setText("checked-at", "Provjeravam podatke…");
    const [csv, status, estimates] = await Promise.allSettled([
      resource("vodostaj_protok.csv"),
      resource("scrape-status.json", true),
      resource("flow-estimates.json", true),
    ]);
    state.status =
      status.status === "fulfilled" &&
      status.value &&
      typeof status.value === "object"
        ? status.value
        : null;
    try {
      if (csv.status === "rejected") throw csv.reason;
      const rows = D.parseCSV(csv.value);
      if (!rows.length) throw new Error("Arhiva ne sadrži mjerenja.");
      state.estimateError = false;
      state.estimates = null;
      state.rows = rows;
      try {
        if (estimates.status === "rejected") throw estimates.reason;
        state.rows = D.withEstimates(rows, estimates.value);
        state.estimates = estimates.value;
      } catch {
        state.estimateError = true;
      }
      state.error = null;
      state.fetched = Date.now();
      render();
      setText(
        "checked-at",
        `Pregled osvježen ${new Intl.DateTimeFormat("hr-HR", { timeZone: D.zone, hour: "2-digit", minute: "2-digit" }).format(state.fetched)}`,
      );
    } catch (error) {
      state.error =
        error.name === "TimeoutError"
          ? "Izvor nije odgovorio na vrijeme."
          : error.message;
      banner(Date.now());
      setText(
        "checked-at",
        state.fetched
          ? `Zadržan pregled od ${D.formatTime(state.fetched)}`
          : "Dohvat pregleda nije uspio",
      );
      if (!state.rows.length) {
        setText("table-count", "Podaci nisu učitani");
        $("table-body").replaceChildren();
        const tr = document.createElement("tr"),
          td = document.createElement("td");
        td.colSpan = 5;
        td.className = "table-empty";
        td.textContent = "Dohvat nije uspio. Pokušaj osvježiti pregled.";
        tr.append(td);
        $("table-body").append(tr);
      }
    } finally {
      state.loading = false;
      $("refresh").disabled = false;
      $("refresh").removeAttribute("aria-busy");
    }
  }
  function resetPage() {
    state.page = 0;
  }
  function presets() {
    document
      .querySelectorAll("#presets button")
      .forEach((btn) =>
        btn.setAttribute(
          "aria-pressed",
          String(!state.zoom && +btn.dataset.hours === state.hours),
        ),
      );
  }
  function clearZoom() {
    state.zoom = null;
    rangeDirty = false;
    $("filter-error").hidden = true;
  }
  function applyZoom(start, end) {
    state.zoom = { start, end };
    rangeDirty = false;
    $("filter-error").hidden = true;
    resetPage();
    presets();
    render();
  }
  $("reset-zoom").addEventListener("click", () => {
    clearZoom();
    resetPage();
    presets();
    render();
  });
  $("date-form").addEventListener("input", (event) => {
    if (event.target.type === "datetime-local") rangeDirty = true;
  });
  function showArchive() {
    state.hours = 0;
    clearZoom();
    $("anchor").checked = false;
    $("incomplete").checked = false;
    $("table-sort").value = "desc";
    $("filter-error").hidden = true;
    resetPage();
    presets();
    render();
    $("table-title").scrollIntoView({ block: "start" });
  }
  $("show-archive").addEventListener("click", showArchive);
  $("show-archive-table").addEventListener("click", showArchive);
  $("presets").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-hours]");
    if (!btn) return;
    state.hours = +btn.dataset.hours;
    clearZoom();
    resetPage();
    presets();
    render();
  });
  $("anchor").addEventListener("change", () => {
    clearZoom();
    resetPage();
    presets();
    render();
  });
  $("date-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (!state.rows.length) throw new Error("Najprije učitaj podatke.");
      const parseInput = (value) => {
        const [date, time] = value.split("T");
        if (!time)
          throw new Error("Upiši datum i vrijeme za oba kraja raspona.");
        return D.stationTime(date, time);
      };
      const start = parseInput($("date-from").value);
      const end = parseInput($("date-to").value);
      if (start >= end)
        throw new Error("Početak raspona mora biti prije završetka.");
      if (
        start < state.rows[0].dt ||
        end > Math.max(Date.now(), state.rows.at(-1).dt)
      )
        throw new Error(
          "Odaberi raspon od početka arhive do trenutačnog vremena.",
        );
      applyZoom(start, end);
    } catch (error) {
      setText("filter-error", error.message);
      $("filter-error").hidden = false;
    }
  });
  $("aggregation").addEventListener("change", render);
  $("incomplete").addEventListener("change", () => {
    resetPage();
    updateTable();
  });
  $("table-sort").addEventListener("change", () => {
    resetPage();
    updateTable();
  });
  $("prev-page").addEventListener("click", () => {
    state.page--;
    updateTable();
  });
  $("next-page").addEventListener("click", () => {
    state.page++;
    updateTable();
  });
  $("refresh").addEventListener("click", loadData);
  $("theme").addEventListener("click", () => {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ilova-theme", theme);
    } catch {}
    render();
  });
  $("export").addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([D.toCSV([...state.selected].reverse(), true)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `ilova-${D.dayKey(renderBounds.start)}-${D.dayKey(renderBounds.end)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  loadData();
  setInterval(
    () => {
      if (!document.hidden) loadData();
    },
    5 * 60 * 1000,
  );
  setInterval(() => {
    if (state.rows.length && !document.hidden) render();
  }, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (
      !document.hidden &&
      (!state.fetched || Date.now() - state.fetched > 5 * 60 * 1000)
    )
      loadData();
  });
})();
