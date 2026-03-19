import requests
from bs4 import BeautifulSoup
from datetime import datetime

URL = "https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?bpID=6&postajaID=43&sektorID=4"

def main():
    r = requests.get(URL)
    soup = BeautifulSoup(r.text, "html.parser")

    rows = []
    for tr in soup.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(cells) >= 4:
            rows.append(cells[:4])

    now = datetime.utcnow().isoformat()

    with open("data.csv", "a") as f:
        for r in rows:
            f.write(",".join(r) + "," + now + "\n")

if __name__ == "__main__":
    main()
