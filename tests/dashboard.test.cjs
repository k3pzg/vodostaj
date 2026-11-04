const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../assets/data.js");
const head = "\uFEFFDATUM;VRIJEME;VODOSTAJ;PROTOK\r\n";
const row = (day, time, water = "12,0", flow = "0,09") =>
  `${day};${time};${water};${flow}\r\n`;
test("strict CSV keeps missing measurements distinct from zero and sorts chronologically", () => {
  const rows = D.parseCSV(
    head +
      row("02.11.2026", "14:00", "0", "") +
      row("01.11.2026", "14:00", "-2", "0"),
  );
  assert.equal(rows[0].vodostaj, -2);
  assert.equal(rows[0].protok, 0);
  assert.equal(rows[1].protok, null);
  assert.equal(rows[1].vodostaj, 0);
});
test("invalid dates, conflicting rows, malformed CSV and injected content are rejected", () => {
  for (const text of [
    "wrong\n",
    head + row("31.02.2026", "14:00"),
    head + row("02.11.2026", "14:00", "<img>"),
    head + row("02.11.2026", "14:15"),
    head + row("02.11.2026", "14:00") + row("02.11.2026", "14:00"),
  ])
    assert.throws(() => D.parseCSV(text));
});
test("station timestamps do not use browser timezone", () => {
  assert.equal(
    D.stationTime("2026-11-02", "14:00"),
    Date.parse("2026-11-02T13:00:00Z"),
  );
  assert.equal(
    D.stationTime("2026-07-02", "14:00"),
    Date.parse("2026-07-02T12:00:00Z"),
  );
  assert.equal(D.hourKey(Date.parse("2026-11-02T13:00Z")), "2026-11-02T14:00");
});
test("DST nonexistent hour is rejected, autumn chooses first occurrence", () => {
  assert.throws(() => D.stationTime("2026-03-29", "02:00"));
  assert.equal(
    D.stationTime("2026-10-25", "02:00"),
    Date.parse("2026-10-25T00:00Z"),
  );
});
test("missing hour breaks chart lines without filling the archive", () => {
  const rows = D.parseCSV(
    head + row("02.11.2026", "07:00") + row("02.11.2026", "09:00"),
  );
  const plotted = D.chartRows(rows);
  assert.equal(plotted.length, 3);
  assert.equal(plotted[1].vodostaj, null);
  assert.equal(rows.length, 2);
});
test("multi-year gap needs only one null separator", () => {
  const rows = D.parseCSV(
    head + row("02.11.2020", "07:00") + row("02.11.2026", "09:00"),
  );
  assert.equal(D.chartRows(rows).length, 3);
});
test("latest metrics are found independently and missing exact previous-day sample has no trend", () => {
  const rows = D.parseCSV(
    head +
      row("01.11.2026", "14:00", "10", "") +
      row("02.11.2026", "13:00", "11", "0,09") +
      row("02.11.2026", "14:00", "12", ""),
  );
  assert.equal(D.latest(rows, "protok").vrijeme, "13:00");
  assert.equal(D.delta24(rows, "vodostaj"), 2);
  assert.equal(D.delta24(rows, "protok"), null);
});
test("previous local day comparison spans 25 real hours after autumn clock change", () => {
  const rows = D.parseCSV(
    head + row("24.10.2026", "14:00", "10") + row("25.10.2026", "14:00", "12"),
  );
  assert.equal((rows[1].dt - rows[0].dt) / D.HOUR, 25);
  assert.equal(D.delta24(rows, "vodostaj"), 2);
});
test("coverage reports completely absent hours and partial values", () => {
  const rows = D.parseCSV(
    head + row("02.11.2026", "07:00") + row("02.11.2026", "09:00", "12", ""),
  );
  const c = D.coverage(rows, rows[0].dt, rows[1].dt);
  assert.equal(c.total, 3);
  assert.equal(c.missing.vodostaj.length, 1);
  assert.equal(c.missing.protok.length, 2);
  assert.equal(c.percent, 50);
});
test("coverage respects spring and autumn civil-hour CSV contract", () => {
  for (const [day, hours, total] of [
    ["29.03.2026", ["00:00", "01:00", "03:00", "04:00"], 4],
    ["25.10.2026", ["00:00", "01:00", "02:00", "03:00", "04:00"], 5],
  ]) {
    const rows = D.parseCSV(head + hours.map((h) => row(day, h)).join(""));
    const c = D.coverage(rows, rows[0].dt, rows.at(-1).dt);
    assert.equal(c.total, total);
    assert.equal(c.percent, 100);
  }
});
test("empty ranges clear metrics and have no invented coverage", () => {
  assert.equal(D.summary([], "vodostaj").min, null);
  assert.equal(D.coverage([], 10, 0).percent, null);
  const rows = D.parseCSV(head + row("02.11.2026", "14:00"));
  const b = D.bounds(rows, 24, rows[0].dt + 48 * D.HOUR);
  assert.deepEqual(D.filter(rows, b.start, b.end), []);
  assert.equal(D.bounds(rows, 24, Date.now(), true).end, rows[0].dt);
});
test("daily means use available values and preserve sample counts", () => {
  const rows = D.parseCSV(
    head +
      row("01.11.2026", "14:00", "10", "0") +
      row("01.11.2026", "15:00", "20", "") +
      row("03.11.2026", "14:00", "30", "0,2"),
  );
  const daily = D.dailyRows(rows);
  assert.equal(daily[0].vodostaj, 15);
  assert.equal(daily[0].protok, 0);
  assert.equal(daily[0].counts.protok, 1);
  assert.equal(daily[1].vodostaj, null);
  assert.equal(daily[2].vodostaj, 30);
});
test("CSV export roundtrips real rows with BOM, comma decimals and blanks", () => {
  const rows = D.parseCSV(head + row("02.11.2026", "14:00", "12,3", ""));
  assert.deepEqual(D.parseCSV(D.toCSV(rows)), rows);
  assert.ok(D.toCSV(rows).startsWith("\uFEFF"));
});

test("autumn repeated hour does not cause a false chart gap", () => {
  const rows = D.parseCSV(
    head + row("25.10.2026", "02:00") + row("25.10.2026", "03:00"),
  );
  assert.equal(D.chartRows(rows).length, 2);
});

test("whole archive includes all stored rows within source clock tolerance", () => {
  const rows = D.parseCSV(
    head + row("02.11.2026", "14:00") + row("02.11.2026", "15:00"),
  );
  const range = D.bounds(rows, 0, rows.at(-1).dt - D.HOUR / 2);
  assert.deepEqual(D.filter(rows, range.start, range.end), rows);
});
