"use strict";
(() => {
  const D = WaterData,
    $ = (id) => document.getElementById(id);
  const state = {
    rows: [],
    selected: [],
    hours: 72,
    custom: null,
    page: 0,
    loading: false,
    status: null,
    fetched: null,
    error: null,
  };
  const charts = {};
  const fields = [
    { key: "vodostaj", id: "water", unit: "cm", digits: 1, color: "--water" },
    { key: "protok", id: "flow", unit: "m³/s", digits: 2, color: "--flow" },
  ];
  let renderBounds;
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
      title = "Izvor kasni s mjerenjima";
      description =
        "Prikazana su posljednja poznata mjerenja. Nova mjerenja mogu nedostajati; spremljena arhiva ostaje dostupna.";
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
    const plotted = daily ? D.dailyRows(rows) : D.chartRows(rows);
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
      }));
      const dayPadding = daily ? 12 * D.HOUR : 0;
      const min = Math.min(start, points[0]?.x ?? start) - dayPadding;
      const max =
        Math.max(end, points.at(-1)?.x ?? end, min + D.HOUR) + dayPadding;
      const config = {
        type: "line",
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
              pointRadius: points.length < 100 ? 2 : 0,
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
                  `${daily ? "Prosjek: " : ""}${D.formatNumber(ctx.parsed.y, f.digits)} ${f.unit}${daily ? ` (${ctx.raw.count} mjerenja)` : ""}`,
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
        : "Prekid linije označava nedostajuća mjerenja. Vrijednosti se ne procjenjuju.",
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
      `Popunjenost oba niza · ${c.total.toLocaleString("hr-HR")} očekivanih satnih oznaka · posljednja 3 sata izuzeta zbog kašnjenja objave`,
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
        `${labels[status.status] ?? "Nepoznat status"} · ${D.formatTime(Date.parse(status.checked_at))}${failed.length ? ` · ${failed.join(", ")}` : ""}`,
      );
    } else
      setText(
        "collection-status",
        "Status pokušaja nije dostupan. Starost mjerenja provjerena je iz arhive.",
      );
  }
  function tableRows() {
    let rows = state.selected;
    if ($("incomplete").checked)
      rows = rows.filter((r) => r.vodostaj === null || r.protok === null);
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
        r.vodostaj === null || r.protok === null ? "Nepotpun" : "Oba mjerenja",
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
      state.custom ??
      D.bounds(state.rows, state.hours, now, $("anchor").checked);
    const { start, end } = renderBounds;
    state.selected = D.filter(state.rows, start, end);
    if (!state.custom) {
      $("date-from").value = D.dayKey(start);
      $("date-to").value = D.dayKey(end);
    }
    const earliest = D.dayKey(state.rows[0].dt),
      latest = D.dayKey(Math.max(now, state.rows.at(-1).dt));
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
    banner(now);
    updateLatest(now);
    updateCharts(state.selected, start, end);
    updateQuality(state.selected, start, end, now);
    updateTable();
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
    const [csv, status] = await Promise.allSettled([
      resource("vodostaj_protok.csv"),
      resource("scrape-status.json", true),
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
      state.rows = rows;
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
          String(!state.custom && +btn.dataset.hours === state.hours),
        ),
      );
  }
  $("presets").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-hours]");
    if (!btn) return;
    state.hours = +btn.dataset.hours;
    state.custom = null;
    $("filter-error").hidden = true;
    resetPage();
    presets();
    render();
  });
  $("anchor").addEventListener("change", () => {
    state.custom = null;
    $("filter-error").hidden = true;
    resetPage();
    presets();
    render();
  });
  $("date-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const start = D.stationTime($("date-from").value);
      const to = $("date-to").value,
        next = new Date(`${to}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const end = D.stationTime(next.toISOString().slice(0, 10)) - 1;
      if (start > end)
        throw new Error("Početni datum mora biti prije završnog.");
      if (
        state.rows.length &&
        ($("date-from").value < D.dayKey(state.rows[0].dt) ||
          $("date-to").value >
            D.dayKey(Math.max(Date.now(), state.rows.at(-1).dt)))
      )
        throw new Error("Odaberi datume od početka arhive do danas.");
      state.custom = { start, end };
      $("filter-error").hidden = true;
      resetPage();
      presets();
      render();
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
      new Blob([D.toCSV([...state.selected].reverse())], {
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
