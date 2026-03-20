import csv
import os
import re

import requests
from bs4 import BeautifulSoup

URLS = {
    "vodostaj": "https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?bpID=6&postajaID=43&sektorID=4",
    "protok": "https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?bpID=6&postajaID=43&sektorID=4",
}

OUTPUT_FILE = "data.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{2}\.$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def is_valid_date(value):
    return bool(DATE_RE.match(value.strip()))


def is_valid_time(value):
    return bool(TIME_RE.match(value.strip()))


def fetch_data(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    data = {}

    for tr in soup.find_all("tr"):
        cells = [cell.get_text(" ", strip=True) for cell in tr.find_all(["td", "th"])]

        # Trebamo naći red koji stvarno sadrži datum i vrijeme
        # i onda uzeti prvu sljedeću numeričku vrijednost kao mjerenje.
        datum = None
        vrijeme = None
        vrijednost = None

        for i, cell in enumerate(cells):
            if datum is None and is_valid_date(cell):
                datum = cell
                continue

            if datum is not None and vrijeme is None and is_valid_time(cell):
                vrijeme = cell
                continue

            if datum is not None and vrijeme is not None:
                # prvo sljedeće polje nakon vremena uzimamo kao vrijednost
                if cell not in ["Datum", "Vrijeme", "Vodostaj", "Protok", "Trend", "Grafički prikaz"]:
                    vrijednost = cell
                    break

        if datum and vrijeme and vrijednost:
            data[(datum, vrijeme)] = vrijednost

    return data


def load_existing_keys():
    existing = set()
    if not os.path.exists(OUTPUT_FILE):
        return existing

    with open(OUTPUT_FILE, "r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        next(reader, None)
        for row in reader:
            if len(row) >= 2:
                existing.add((row[0], row[1]))

    return existing


def main():
    vodostaj = fetch_data(URLS["vodostaj"])
    protok = fetch_data(URLS["protok"])

    existing = load_existing_keys()
    file_exists = os.path.exists(OUTPUT_FILE)

    all_keys = sorted(set(vodostaj.keys()) | set(protok.keys()), reverse=True)

    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=";")

        if not file_exists:
            writer.writerow(["datum", "vrijeme", "vodostaj", "protok"])

        inserted = 0

        for key in all_keys:
            if key in existing:
                continue

            datum, vrijeme = key
            writer.writerow([
                datum,
                vrijeme,
                vodostaj.get(key, ""),
                protok.get(key, "")
            ])
            inserted += 1

    print(f"Upisano novih redova: {inserted}")


if __name__ == "__main__":
    main()
