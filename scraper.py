import csv
import os
from datetime import datetime
from typing import Dict, Tuple, List

import requests
from bs4 import BeautifulSoup

URL_VODOSTAJ = "https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?bpID=6&postajaID=43&sektorID=4"
URL_PROTOK = "https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?bpID=6&postajaID=43&sektorID=4"

CSV_PATH = "vodostaj_protok.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "hr,en;q=0.9",
}


def fetch_html(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.text


def normalize_date(date_str: str) -> str:
    # 20.03.26. -> 20.03.2026
    parts = date_str.strip().split(".")
    day = parts[0].zfill(2)
    month = parts[1].zfill(2)
    year = f"20{parts[2].zfill(2)}"
    return f"{day}.{month}.{year}"


def normalize_water_level(value: str) -> str:
    # 28 -> 28,0
    value = value.strip().replace(".", ",")
    if "," not in value:
        value = f"{value},0"
    return value


def normalize_flow(value: str) -> str:
    # 0,79 ostaje 0,79
    return value.strip().replace(".", ",")


def is_measurement_row(cells: List[str]) -> bool:
    if len(cells) != 5:
        return False

    date_text = cells[1].strip()
    time_text = cells[2].strip()
    value_text = cells[3].strip()

    if not date_text or not time_text or not value_text:
        return False

    lowered = " ".join(cells).lower()
    if "datum" in lowered and "vrijeme" in lowered:
        return False

    if len(date_text) != 9 or date_text.count(".") < 3:
        return False

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
        raise ValueError("Nije pronađen tbody")

    data = {}

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

    return data


def load_existing(csv_path: str) -> Dict[Tuple[str, str], Dict[str, str]]:
    existing = {}

    if not os.path.exists(csv_path):
        return existing

    with open(csv_path, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            key = (row["DATUM"].strip(), row["VRIJEME"].strip())
            existing[key] = {
                "DATUM": row["DATUM"].strip(),
                "VRIJEME": row["VRIJEME"].strip(),
                "VODOSTAJ": row["VODOSTAJ"].strip(),
                "PROTOK": row["PROTOK"].strip(),
            }

    return existing


def merge_rows(existing, vodostaji, protoci):
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


def save_csv(csv_path: str, rows_dict):
    rows = [item[1] for item in sorted(rows_dict.items(), key=sort_key, reverse=True)]

    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["DATUM", "VRIJEME", "VODOSTAJ", "PROTOK"],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(rows)


def main():
    html_vodostaj = fetch_html(URL_VODOSTAJ)
    html_protok = fetch_html(URL_PROTOK)

    vodostaji = parse_table(html_vodostaj, "vodostaj")
    protoci = parse_table(html_protok, "protok")

    existing = load_existing(CSV_PATH)
    merged = merge_rows(existing, vodostaji, protoci)

    save_csv(CSV_PATH, merged)
    print(f"Gotovo. Ukupno redaka: {len(merged)}")


if __name__ == "__main__":
    main()
