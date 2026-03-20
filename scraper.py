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


def fetch_data(url):
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    data = {}

    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]

        if len(cells) < 3:
            continue

        datum = cells[0]
        vrijeme = cells[1]
        vrijednost = cells[2]

        if not DATE_RE.match(datum):
            continue

        if not TIME_RE.match(vrijeme):
            continue

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
