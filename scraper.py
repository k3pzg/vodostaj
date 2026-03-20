import csv
import os
from datetime import datetime

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


def fetch_data(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    data = {}

    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 4:
            continue

        datum = cells[0]
        vrijeme = cells[1]
        vrijednost = cells[2]

        key = (datum, vrijeme)
        data[key] = vrijednost

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

    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=";")

        if not file_exists:
            writer.writerow(["datum", "vrijeme", "vodostaj", "protok"])

        inserted = 0

        for key in vodostaj:
            datum, vrijeme = key

            if key in existing:
                continue

            v = vodostaj.get(key, "")
            p = protok.get(key, "")

            writer.writerow([datum, vrijeme, v, p])
            inserted += 1

    print(f"Upisano novih redova: {inserted}")


if __name__ == "__main__":
    main()
