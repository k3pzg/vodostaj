import csv
import os
from datetime import datetime

import requests
from bs4 import BeautifulSoup

POSTAJA = "Ilova - Maslenjača"

URLS = {
    "vodostaj": "https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?bpID=6&postajaID=43&sektorID=4",
    "protok": "https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?bpID=6&postajaID=43&sektorID=4",
}

OUTPUT_FILE = "data.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}


def fetch_rows(url, tip):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    rows = []

    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 4:
            continue

        datum = cells[0]
        vrijeme = cells[1]
        vrijednost = cells[2]
        trend = cells[3]

        rows.append([
            POSTAJA,
            tip,
            datum,
            vrijeme,
            vrijednost,
            trend,
            datetime.utcnow().isoformat()
        ])

    return rows


def load_existing_keys(filename):
    existing = set()
    if not os.path.exists(filename):
        return existing

    with open(filename, "r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) >= 5:
                key = (row[0], row[1], row[2], row[3], row[4])
                existing.add(key)
    return existing


def main():
    all_rows = []
    for tip, url in URLS.items():
        all_rows.extend(fetch_rows(url, tip))

    file_exists = os.path.exists(OUTPUT_FILE)
    existing = load_existing_keys(OUTPUT_FILE)

    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        if not file_exists:
            writer.writerow([
                "postaja",
                "tip",
                "datum",
                "vrijeme",
                "vrijednost",
                "trend",
                "fetched_at_utc"
            ])

        inserted = 0
        for row in all_rows:
            key = (row[0], row[1], row[2], row[3], row[4])
            if key not in existing:
                writer.writerow(row)
                inserted += 1

    print(f"Upisano novih redova: {inserted}")


if __name__ == "__main__":
    main()
