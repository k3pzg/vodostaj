import re

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{2}\.$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def fetch_data(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    data = {}

    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]

        if len(cells) < 3:
            continue

        datum = cells[0]
        vrijeme = cells[1]
        vrijednost = cells[2]

        # filtriraj samo stvarne podatke
        if not DATE_RE.match(datum):
            continue

        if not TIME_RE.match(vrijeme):
            continue

        data[(datum, vrijeme)] = vrijednost

    return data
