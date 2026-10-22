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

## Pouzdanost i provjera podataka

Raspored `7 * * * *` traži satno pokretanje u UTC-u, ali GitHub Actions ne jamči
satnu isporuku. Događaji se mogu odgoditi ili odbaciti pod opterećenjem
([GitHub dokumentacija](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
Ponavljanje unutar posla ne pomaže ako posao uopće nije pokrenut. Za obvezno satno
prikupljanje potreban je neovisan raspoređivač i nadzor koji se izvršava izvan
ovog workflowa. Workflow prihvaća `repository_dispatch` s `event_type: scrape`
kao ulaz za takav raspoređivač; vanjski servis nije postavljen ovom izmjenom.

Scraper provjerava oba izvora, datume, pune sate, brojčane vrijednosti i svježinu
najnovijeg mjerenja. Pretpostavlja lokalno vrijeme postaje `Europe/Zagreb`,
a ne vrijeme računala koje izvršava scraper. Zadani prag svježine je 3 sata;
može se promijeniti argumentom `--max-age-hours`. Do jedan sat budućeg vremena
prihvaća se kao tolerancija za sat izvora. Praznine se traže za svaki stupac
zasebno u posljednjih 168 sati. Unutarnje praznine otkrivaju se odmah, a na kraju
niza dopušteno je zadano kašnjenje objave. `--lookback-hours` proširuje provjeru.

```sh
python scraper.py
python scraper.py --check --report quality-report.json
python scraper.py --check --lookback-hours 720
python -m unittest discover -s tests -v
node --test tests/dashboard.test.cjs
```

Izlazni kodovi:

| Kod | Značenje |
| --- | --- |
| 0 | Dohvat/provjera uspješni, podaci svježi, nema pronađenih praznina. Nova mjerenja nisu nužna ako je postojeći niz još svjež. |
| 1 | Neuspješan dohvat, parsiranje, validacija ili zapis. CSV se ne zamjenjuje ako dohvat/validacija ne uspiju. |
| 2 | Provjera je pronašla praznine, nesvjež CSV ili nepodudarne sate dvaju izvora. Kod prikupljanja valjani dohvaćeni podaci već su spremljeni. |

Ako samo jedan izvor ima mjerenje za pojedini sat, čuva se raspoloživa vrijednost,
a drugi stupac ostaje prazan ili zadržava ranije poznatu vrijednost. Sljedeći
dohvat može dopuniti prazno polje isključivo stvarnim izvornim mjerenjem.
Nema interpolacije, pretvaranja praznine u nulu ni kopiranja susjednih vrijednosti.
Zapisi se zamjenjuju atomarno; pogreška pisanja ne smije skratiti postojeći CSV.

Workflow prvo sprema i šalje valjana mjerenja, a zatim provjerava kvalitetu.
**Crveni workflow zbog praznina zato može imati uspješno spremljena nova mjerenja.**
Poznate praznine ostaju prijavljene dok su unutar razdoblja provjere. To ne
zaustavlja buduće prikupljanje. Sažetak posla i artefakt `scrape-diagnostics-*`
sadrže JSON izvještaje i dohvaćeni HTML (čuvanje 30 dana), uključujući broj novih
i promijenjenih redaka te najstarije/najnovije vrijeme izvora. `--check` samo čita
CSV i zapisuje izvještaj. Ne pokreće mrežni dohvat.

Pri proljetnom pomicanju sata ne prijavljuje se nepostojeći lokalni sat. Postojeći
format CSV-a nema UTC odmak i ne može razlikovati dva jesenska mjerenja s istom
lokalnom oznakom sata. Proturječni duplikati odbijaju se; potpuno razrješenje
zahtijeva potvrdu vremenske zone izvora i migraciju formata s odmakom.

Graf koristi ravne segmente i prekida liniju na nedostajućim satima. Prazne točke
služe samo prikazu i ne zapisuju se u CSV.

Nalazi pregleda od 22.10.2026. i granice mogućeg oporavka opisani su u
[docs/reliability-2026-10-22.md](docs/reliability-2026-10-22.md).
