# Vodostaj

## GitHub Actions scraper

Scraper se automatski pokreće svaki sat, a može se pokrenuti i ručno na stranici
**Actions → Scrape vodostaj i protok → Run workflow**.

> [!IMPORTANT]
> Opcija **Re-run jobs** ponovno izvršava isti commit i istu verziju workflowa
> kao izvorno pokretanje. Zato se stari neuspjeli run (primjerice commit
> `7486fe4`) ne može koristiti za provjeru naknadnog popravka workflowa. Nakon
> što je popravak spojen na zadanu granu, pokrenite potpuno novi run pomoću
> gumba **Run workflow** i odaberite zadanu granu.

Novi run s aktualnim workflowom u koraku **Checkout** prikazuje
`actions/checkout@v5`, a u koraku **Setup Python** prikazuje
`actions/setup-python@v6`. Ako run i dalje prikazuje `checkout@v4` i
`setup-python@v5`, izvršava staru verziju workflowa.

Za stvarni uzrok neuspjeha otvorite posao **scrape** i proširite prvi korak s
crvenim znakom. Poruka `Process completed with exit code 1` u sažetku označava
samo završni status i ne sadrži izvornu poruku greške.
