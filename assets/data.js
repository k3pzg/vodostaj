/* Shared, DOM-free measurement logic. All source labels use Europe/Zagreb. */
(function (root) {
  "use strict";
  const HOUR = 3600000;
  const zone = "Europe/Zagreb";
  const partsFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const dateFormatter = new Intl.DateTimeFormat("hr-HR", {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (t) =>
    Object.fromEntries(
      partsFormatter.formatToParts(new Date(t)).map((p) => [p.type, p.value]),
    );
  function dayKey(t) {
    const p = parts(t);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function hourKey(t) {
    const p = parts(t);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const timeCache = new Map();
  function stationTime(date, time = "00:00") {
    const key = `${date}T${time}`;
    if (timeCache.has(key)) return timeCache.get(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      throw new Error("Neispravan datum ili vrijeme");
    const [y, m, d] = date.split("-").map(Number),
      [h, minute] = time.split(":").map(Number);
    const wall = Date.UTC(y, m - 1, d, h, minute);
    // Zagreb uses UTC+1/+2. Select the first autumn occurrence, matching Python fold=0.
    const candidates = [wall - 2 * HOUR, wall - HOUR].filter(
      (t) => hourKey(t) === key,
    );
    if (!candidates.length)
      throw new Error(`Nepostojeći datum ili sat: ${key}`);
    const result = Math.min(...candidates);
    timeCache.set(key, result);
    return result;
  }
  function parseNumber(raw) {
    if (!raw) return null;
    if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(raw))
      throw new Error("Neispravna brojčana vrijednost u CSV-u");
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value))
      throw new Error("Prevelika vrijednost u CSV-u");
    return value;
  }
  function parseCSV(text) {
    const lines = text
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/);
    if (lines.shift() !== "DATUM;VRIJEME;VODOSTAJ;PROTOK")
      throw new Error("Neispravno CSV zaglavlje");
    const seen = new Set();
    const rows = lines
      .filter((line) => line.trim())
      .map((line) => {
        const cells = line.split(";").map((v) => v.trim());
        if (cells.length !== 4)
          throw new Error("Neispravan broj stupaca u CSV-u");
        const [datum, vrijeme, water, flow] = cells;
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(datum) || !/^\d{2}:00$/.test(vrijeme))
          throw new Error("Neispravna satna oznaka u CSV-u");
        const [d, m, y] = datum.split("."),
          dt = stationTime(`${y}-${m}-${d}`, vrijeme);
        if (seen.has(dt)) throw new Error("Duplikat mjerenja u CSV-u");
        seen.add(dt);
        return {
          dt,
          datum,
          vrijeme,
          vodostaj: parseNumber(water),
          protok: parseNumber(flow),
        };
      });
    return rows.sort((a, b) => a.dt - b.dt);
  }
  function bounds(rows, hours, now = Date.now(), anchor = false) {
    const end =
      anchor && rows.length
        ? rows.at(-1).dt
        : !hours && rows.length
          ? Math.max(now, rows.at(-1).dt)
          : now;
    return { start: hours ? end - hours * HOUR : (rows[0]?.dt ?? end), end };
  }
  function withEstimates(rows, payload) {
    if (payload?.schema_version !== 1 || payload.station !== "Ilova - Maslenjača" || !Array.isArray(payload.estimates))
      throw new Error("Neispravne procjene protoka");
    const estimates = new Map();
    for (const item of payload.estimates) {
      if (typeof item.date !== "string" || typeof item.time !== "string" ||
          !Number.isFinite(item.water_cm) || !Number.isFinite(item.flow_m3s) || item.flow_m3s < 0) continue;
      estimates.set(`${item.date} ${item.time}`, item);
    }
    return rows.map((r) => {
      const item = estimates.get(`${r.datum} ${r.vrijeme}`);
      return r.protok === null && item && r.vodostaj === item.water_cm
        ? { ...r, protok: item.flow_m3s, estimatedProtok: true }
        : r;
    });
  }
  function filter(rows, start, end) {
    return rows.filter((r) => r.dt >= start && r.dt <= end);
  }
  function latest(rows, field) {
    return rows.findLast((r) => Number.isFinite(r[field])) ?? null;
  }
  function summary(rows, field) {
    const values = rows.map((r) => r[field]).filter(Number.isFinite);
    if (!values.length) return { count: 0, min: null, max: null, mean: null };
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }
  function delta24(rows, field) {
    const last = latest(rows, field);
    if (!last) return null;
    const p = parts(last.dt),
      previousDay = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - 1))
        .toISOString()
        .slice(0, 10);
    let t;
    try {
      t = stationTime(previousDay, `${p.hour}:${p.minute}`);
    } catch {
      return null;
    }
    const previous = rows.find((r) => r.dt === t);
    return Number.isFinite(previous?.[field])
      ? last[field] - previous[field]
      : null;
  }
  function coverage(rows, start, end) {
    const expected = new Map();
    // One CSV row per civil hour, including on the autumn clock change.
    for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR)
      expected.set(hourKey(t), t);
    const available = new Map(rows.map((r) => [hourKey(r.dt), r]));
    const missing = { vodostaj: [], protok: [] };
    for (const [key, t] of expected)
      for (const field of Object.keys(missing)) {
        if (!Number.isFinite(available.get(key)?.[field]) ||
            (field === "protok" && available.get(key)?.estimatedProtok))
          missing[field].push(t);
      }
    const total = expected.size;
    return {
      total,
      missing,
      percent: total
        ? (100 *
            (2 * total - missing.vodostaj.length - missing.protok.length)) /
          (2 * total)
        : null,
    };
  }
  function chartRows(rows) {
    const result = [];
    for (const row of rows) {
      const previous = result.at(-1);
      if (previous && row.dt - previous.dt > HOUR) {
        const missing = previous.dt + HOUR;
        // The repeated autumn civil hour cannot have a second CSV row.
        if (
          !(
            row.dt - previous.dt === 2 * HOUR &&
            hourKey(missing) === hourKey(previous.dt)
          )
        )
          result.push({ dt: missing, vodostaj: null, protok: null });
      }
      result.push(row);
    }
    return result;
  }
  function dailyRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const day = dayKey(row.dt);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(row);
    }
    const result = [];
    let previousDay;
    for (const [day, group] of groups) {
      const dt = stationTime(day, "12:00");
      if (previousDay && dt - previousDay > 26 * HOUR)
        result.push({
          dt: previousDay + 24 * HOUR,
          vodostaj: null,
          protok: null,
        });
      result.push({
        dt,
        vodostaj: summary(group, "vodostaj").mean,
        protok: summary(group, "protok").mean,
        estimatedProtok: group.some((r) => r.estimatedProtok),
        estimatedCount: group.filter((r) => r.estimatedProtok).length,
        counts: {
          vodostaj: summary(group, "vodostaj").count,
          protok: summary(group, "protok").count,
        },
      });
      previousDay = dt;
    }
    return result;
  }
  function toCSV(rows, includeOrigin = false) {
    includeOrigin = includeOrigin || rows.some((r) => r.estimatedProtok);
    return (
      `\uFEFFDATUM;VRIJEME;VODOSTAJ;PROTOK${includeOrigin ? ";PROTOK_IZVOR" : ""}\r\n` +
      rows
        .map((r) =>
          [
            r.datum,
            r.vrijeme,
            Number.isFinite(r.vodostaj)
              ? String(r.vodostaj).replace(".", ",")
              : "",
            Number.isFinite(r.protok) ? String(r.protok).replace(".", ",") : "",
          ].concat(includeOrigin ? [r.estimatedProtok ? "procjena_krivuljom" : Number.isFinite(r.protok) ? "objavljeni_podatak" : "nedostaje"] : []).join(";"),
        )
        .join("\r\n") +
      "\r\n"
    );
  }
  const api = {
    HOUR,
    zone,
    parts,
    dayKey,
    hourKey,
    stationTime,
    parseCSV,
    withEstimates,
    bounds,
    filter,
    latest,
    summary,
    delta24,
    coverage,
    chartRows,
    dailyRows,
    toCSV,
    formatTime: (t) => dateFormatter.format(new Date(t)),
    formatNumber: (n, digits = 1) =>
      Number.isFinite(n)
        ? n.toLocaleString("hr-HR", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          })
        : "—",
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WaterData = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
