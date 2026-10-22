import argparse
import json
import re
import sys
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo
import csv
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple

import requests
from bs4 import BeautifulSoup

URL_VODOSTAJ = "https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?sektorID=4&bpID=6&postajaID=43"
URL_PROTOK = "https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?sektorID=4&bpID=6&postajaID=43"

CSV_PATH = "vodostaj_protok.csv"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "hr,en;q=0.9",
}


def fetch_html(url: str, retries: int = 3, sleep_seconds: int = 10) -> str:
    last_error = None

    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            return response.text
        except requests.exceptions.RequestException as e:
            last_error = e
            print(f"[WARN] Pokušaj {attempt}/{retries} nije uspio za {url}: {e}")
            if attempt < retries:
                time.sleep(sleep_seconds)

    print(f"[WARN] Izvor trenutno nije dostupan: {url}")
    print(f"[WARN] Zadnja greška: {last_error}")
    raise RuntimeError(f"Dohvat nije uspio: {url}: {last_error}") from last_error


def normalize_date(date_str: str) -> str:
    value = date_str.strip().rstrip(".")
    for fmt in ("%d.%m.%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%d.%m.%Y")
        except ValueError:
            pass
    raise ValueError(f"Neispravan datum: {date_str}")


def validate_value(value: str) -> None:
    if not re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", value.strip()):
        raise ValueError(f"Neispravna vrijednost: {value!r}")


def measurement_time(key):
    return datetime.strptime(" ".join(key), "%d.%m.%Y %H:%M")


def normalize_water_level(value: str) -> str:
    # vodostaj dolazi kao 28 -> treba biti 28,0
    value = value.strip().replace(".", ",")
    if "," not in value:
        value = f"{value},0"
    return value


def normalize_flow(value: str) -> str:
    # protok obično već dolazi kao 0,79
    return value.strip().replace(".", ",")


def parse_table(html: str, mode: str) -> Dict[Tuple[str, str], str]:
    if mode not in {"vodostaj", "protok"}:
        raise ValueError(f"Nepoznat mode: {mode}")
    soup = BeautifulSoup(html, "html.parser")

    table = soup.find("table", id="example")
    if table is None:
        raise ValueError("Nije pronađena tablica #example")

    tbody = table.find("tbody")
    if tbody is None:
        raise ValueError("Nije pronađen tbody u tablici")

    data: Dict[Tuple[str, str], str] = {}

    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if not tds:  # header made of th cells
            continue
        if any(td.has_attr("colspan") for td in tds):  # station metadata and legend
            continue
        if len(tds) != 5:
            raise ValueError("Promijenjena struktura retka izvorne tablice")

        cells = [td.get_text(" ", strip=True) for td in tds]

        if "datum" in " ".join(cells).lower():
            continue
        if not cells[1] or not cells[2]:
            raise ValueError(f"Neispravan redak: {cells}")

        raw_date = cells[1]
        raw_time = cells[2]
        raw_value = cells[3]

        date_out = normalize_date(raw_date)
        time_out = raw_time.strip()
        measurement_time((date_out, time_out))
        if not re.fullmatch(r"\d{2}:00", time_out):
            raise ValueError(f"Očekuje se puni sat: {time_out}")
        validate_value(raw_value)

        if mode == "vodostaj":
            value_out = normalize_water_level(raw_value)
        elif mode == "protok":
            value_out = normalize_flow(raw_value)
        else:
            raise ValueError(f"Nepoznat mode: {mode}")

        key = (date_out, time_out)
        if key in data and data[key] != value_out:
            raise ValueError(f"Proturječni podaci za {key}")
        data[key] = value_out

    if not data:
        raise ValueError(f"Nisu pronađeni podaci za mode={mode}")

    return data


def load_existing(csv_path: str) -> Dict[Tuple[str, str], Dict[str, str]]:
    existing: Dict[Tuple[str, str], Dict[str, str]] = {}

    if not os.path.exists(csv_path):
        return existing

    with open(csv_path, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        if reader.fieldnames != ["DATUM", "VRIJEME", "VODOSTAJ", "PROTOK"]:
            raise ValueError("Neispravno CSV zaglavlje")
        for row in reader:
            if not row:
                continue

            datum = (row.get("DATUM") or "").strip()
            vrijeme = (row.get("VRIJEME") or "").strip()
            vodostaj = (row.get("VODOSTAJ") or "").strip()
            protok = (row.get("PROTOK") or "").strip()

            measurement_time((datum, vrijeme))
            for value in (vodostaj, protok):
                if value:
                    validate_value(value)
            if (datum, vrijeme) in existing:
                raise ValueError(f"Duplikat u CSV-u: {datum} {vrijeme}")

            key = (datum, vrijeme)
            existing[key] = {
                "DATUM": datum,
                "VRIJEME": vrijeme,
                "VODOSTAJ": vodostaj,
                "PROTOK": protok,
            }

    return existing


def merge_rows(
    existing: Dict[Tuple[str, str], Dict[str, str]],
    vodostaji: Dict[Tuple[str, str], str],
    protoci: Dict[Tuple[str, str], str],
) -> Dict[Tuple[str, str], Dict[str, str]]:
    merged = dict(existing)

    source_keys = set(vodostaji) | set(protoci)

    for key in source_keys:
        datum, vrijeme = key
        merged[key] = {
            "DATUM": datum,
            "VRIJEME": vrijeme,
            "VODOSTAJ": vodostaji.get(key, existing.get(key, {}).get("VODOSTAJ", "")),
            "PROTOK": protoci.get(key, existing.get(key, {}).get("PROTOK", "")),
        }

    return merged


def sort_key(item):
    row = item[1]
    dt = datetime.strptime(f"{row['DATUM']} {row['VRIJEME']}", "%d.%m.%Y %H:%M")
    return dt


def save_csv(csv_path: str, rows_dict: Dict[Tuple[str, str], Dict[str, str]]) -> None:
    rows = [item[1] for item in sorted(rows_dict.items(), key=sort_key, reverse=True)]

    # Replace only after the complete file has been written successfully.
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=Path(csv_path).resolve().parent, delete=False,
            newline="", encoding="utf-8-sig",
        ) as f:
            temp_name = f.name
            writer = csv.DictWriter(
                f, fieldnames=["DATUM", "VRIJEME", "VODOSTAJ", "PROTOK"], delimiter=";"
            )
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_name, csv_path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


LOCAL_ZONE = ZoneInfo("Europe/Zagreb")


def local_now():
    return datetime.now(timezone.utc).astimezone(LOCAL_ZONE)


def age_hours(key, now):
    # Source labels have no UTC offset; use station civil time, never runner time.
    stamp = measurement_time(key).replace(tzinfo=LOCAL_ZONE)
    return (now.astimezone(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds() / 3600


def check_freshness(data, now, max_age_hours):
    if not data:
        raise ValueError("Nema mjerenja")
    newest = max(data, key=measurement_time)
    oldest_age = age_hours(newest, now)
    if oldest_age > max_age_hours or oldest_age < -1:
        raise ValueError(f"Nesvježi ili budući podaci: {newest}, starost {oldest_age:.2f} h")
    return newest


def audit_rows(rows, now, lookback_hours=168, max_age_hours=3):
    # Iterate real UTC hours so the missing civil hour at spring DST is not a gap.
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(hours=lookback_hours)
    expected = set()
    for h in range(lookback_hours + 1):
        stamp = (start + timedelta(hours=h)).astimezone(LOCAL_ZONE)
        # Allow publication lag at the tail, but detect internal gaps immediately.
        if (now.astimezone(timezone.utc) - stamp).total_seconds() / 3600 >= max_age_hours:
            expected.add((stamp.strftime("%d.%m.%Y"), stamp.strftime("%H:%M")))
    if rows:
        newest = max(rows, key=measurement_time)
        for key in rows:
            if start <= measurement_time(key).replace(tzinfo=LOCAL_ZONE).astimezone(timezone.utc) <= end:
                expected.add(key)
        local_end = measurement_time(newest)
        for h in range(lookback_hours + 1):
            stamp = (start + timedelta(hours=h)).astimezone(LOCAL_ZONE)
            key = (stamp.strftime("%d.%m.%Y"), stamp.strftime("%H:%M"))
            if measurement_time(key) <= local_end:
                expected.add(key)
    missing = {}
    stale = {}
    for field in ("VODOSTAJ", "PROTOK"):
        present = {key for key, row in rows.items() if row.get(field)}
        missing[field] = [" ".join(k) for k in sorted(expected - present, key=measurement_time)]
        try:
            check_freshness(present, now, max_age_hours)
        except ValueError as exc:
            stale[field] = str(exc)
    return {"checked_at": now.isoformat(), "timezone": "Europe/Zagreb",
            "lookback_hours": lookback_hours, "max_age_hours": max_age_hours,
            "missing": missing, "freshness_errors": stale,
            "total_rows": len(rows)}


def write_report(report, path):
    Path(path).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Provjera mjerenja\n```json\n" + json.dumps(report, ensure_ascii=False, indent=2) + "\n```\n")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=CSV_PATH)
    parser.add_argument("--report", default="scrape-report.json")
    parser.add_argument("--check", action="store_true", help="Provjeri CSV bez dohvaćanja")
    parser.add_argument("--max-age-hours", type=float, default=3)
    parser.add_argument("--lookback-hours", type=int, default=168)
    parser.add_argument("--snapshot-dir", help="Sačuvaj izvorni HTML za dijagnostiku")
    args = parser.parse_args(argv)
    if args.max_age_hours <= 0 or args.lookback_hours < 1:
        parser.error("Prag svježine i razdoblje provjere moraju biti pozitivni")
    now = local_now()
    report = {"checked_at": now.isoformat()}
    try:
        existing = load_existing(args.csv)
        rows = existing
        if not args.check:
            sources = {}
            for mode, url in (("vodostaj", URL_VODOSTAJ), ("protok", URL_PROTOK)):
                html = fetch_html(url)
                if args.snapshot_dir:
                    Path(args.snapshot_dir).mkdir(parents=True, exist_ok=True)
                    Path(args.snapshot_dir, mode + ".html").write_text(html, encoding="utf-8")
                sources[mode] = parse_table(html, mode)
                check_freshness(sources[mode], now, args.max_age_hours)
            rows = merge_rows(existing, sources["vodostaj"], sources["protok"])
            save_csv(args.csv, rows)
            report["sources"] = {mode: {
                "count": len(data),
                "oldest": " ".join(min(data, key=measurement_time)),
                "newest": " ".join(max(data, key=measurement_time)),
            } for mode, data in sources.items()}
            report["unpaired_source_hours"] = [" ".join(k) for k in sorted(
                set(sources["vodostaj"]) ^ set(sources["protok"]), key=measurement_time)]
            report["new_rows"] = len(set(rows) - set(existing))
            report["changed_rows"] = sum(existing.get(k) != v for k, v in rows.items())
        report.update(audit_rows(rows, now, args.lookback_hours, args.max_age_hours))
        bad = bool(report["freshness_errors"] or any(report["missing"].values()))
        bad = bad or bool(report.get("unpaired_source_hours"))
        report["status"] = "degraded" if bad else "ok"
        write_report(report, args.report)
        print(json.dumps(report, ensure_ascii=False))
        # Valid observations have been saved even if other hours are missing.
        return 2 if bad else 0
    except (RuntimeError, ValueError, OSError) as exc:
        report.update(status="error", error=str(exc))
        write_report(report, args.report)
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
