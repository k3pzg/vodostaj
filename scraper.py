import csv
import os
import time
from datetime import datetime
from typing import Dict, Tuple, List, Optional

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


def fetch_html(url: str, retries: int = 3, sleep_seconds: int = 10) -> Optional[str]:
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
    return None


def normalize_date(date_str: str) -> str:
    # ulaz: 20.03.26.
    # izlaz: 20.03.2026
    parts = date_str.strip().split(".")
    if len(parts) < 3:
        raise ValueError(f"Neispravan datum: {date_str}")

    day = parts[0].zfill(2)
    month = parts[1].zfill(2)
    year_2 = parts[2].zfill(2)
    year_4 = f"20{year_2}"

    return f"{day}.{month}.{year_4}"


def normalize_water_level(value: str) -> str:
    # vodostaj dolazi kao 28 -> treba biti 28,0
    value = value.strip().replace(".", ",")
    if "," not in value:
        value = f"{value},0"
    return value


def normalize_flow(value: str) -> str:
    # protok obično već dolazi kao 0,79
    return value.strip().replace(".", ",")


def is_measurement_row(cells: List[str]) -> bool:
    # očekujemo 5 stupaca:
    # [status, datum, vrijeme, vrijednost, trend]
    if len(cells) != 5:
        return False

    date_text = cells[1].strip()
    time_text = cells[2].strip()
    value_text = cells[3].strip()

    if not date_text or not time_text or not value_text:
        return False

    combined = " ".join(cells).lower()
    if "datum" in combined and "vrijeme" in combined:
        return False

    # npr. 20.03.26.
    if len(date_text) != 9 or date_text.count(".") < 3:
        return False

    # npr. 21:00
    if len(time_text) != 5 or ":" not in time_text:
        return False

    return True


def parse_table(html: str, mode: str) -> Dict[Tuple[str, str], str]:
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
        if len(tds) != 5:
            continue

        cells = [td.get_text(" ", strip=True) for td in tds]

        if not is_measurement_row(cells):
            continue

        raw_date = cells[1]
        raw_time = cells[2]
        raw_value = cells[3]

        date_out = normalize_date(raw_date)
        time_out = raw_time.strip()

        if mode == "vodostaj":
            value_out = normalize_water_level(raw_value)
        elif mode == "protok":
            value_out = normalize_flow(raw_value)
        else:
            raise ValueError(f"Nepoznat mode: {mode}")

        data[(date_out, time_out)] = value_out

    if not data:
        raise ValueError(f"Nisu pronađeni podaci za mode={mode}")

    return data


def load_existing(csv_path: str) -> Dict[Tuple[str, str], Dict[str, str]]:
    existing: Dict[Tuple[str, str], Dict[str, str]] = {}

    if not os.path.exists(csv_path):
        return existing

    with open(csv_path, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if not row:
                continue

            datum = row.get("DATUM", "").strip()
            vrijeme = row.get("VRIJEME", "").strip()
            vodostaj = row.get("VODOSTAJ", "").strip()
            protok = row.get("PROTOK", "").strip()

            if not datum or not vrijeme:
                continue

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

    common_keys = set(vodostaji.keys()) & set(protoci.keys())

    for key in common_keys:
        datum, vrijeme = key
        merged[key] = {
            "DATUM": datum,
            "VRIJEME": vrijeme,
            "VODOSTAJ": vodostaji[key],
            "PROTOK": protoci[key],
        }

    return merged


def sort_key(item):
    row = item[1]
    dt = datetime.strptime(f"{row['DATUM']} {row['VRIJEME']}", "%d.%m.%Y %H:%M")
    return dt


def save_csv(csv_path: str, rows_dict: Dict[Tuple[str, str], Dict[str, str]]) -> None:
    rows = [item[1] for item in sorted(rows_dict.items(), key=sort_key, reverse=True)]

    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["DATUM", "VRIJEME", "VODOSTAJ", "PROTOK"],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(rows)


def ensure_csv_exists(csv_path: str) -> None:
    if os.path.exists(csv_path):
        return

    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["DATUM", "VRIJEME", "VODOSTAJ", "PROTOK"])


def main():
    ensure_csv_exists(CSV_PATH)

    html_vodostaj = fetch_html(URL_VODOSTAJ)
    html_protok = fetch_html(URL_PROTOK)

    if not html_vodostaj or not html_protok:
        print("Izvor trenutno nije dostupan. CSV ostaje nepromijenjen.")
        return

    try:
        vodostaji = parse_table(html_vodostaj, "vodostaj")
        protoci = parse_table(html_protok, "protok")
    except Exception as e:
        print(f"[ERROR] Parsiranje nije uspjelo: {e}")
        return

    existing = load_existing(CSV_PATH)
    merged = merge_rows(existing, vodostaji, protoci)

    save_csv(CSV_PATH, merged)
    print(f"Gotovo. Ukupno redaka u CSV-u: {len(merged)}")


if __name__ == "__main__":
    main()
