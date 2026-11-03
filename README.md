# Ilova · vodostaj i protok

Pregled satnih mjerenja postaje **Ilova – Maslenjača (43)** u području Končanice.
Podaci se prikupljaju s javnih stranica Hrvatskih voda i čuvaju u
`vodostaj_protok.csv`. Nema interpolacije ni izmišljanja nedostajućih mjerenja.

**[Otvori dashboard](https://k3pzg.github.io/vodostaj/dashboard.html)** ·
[Izvorni vodostaj](https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?sektorID=4&bpID=6&postajaID=43) ·
[Izvorni protok](https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?sektorID=4&bpID=6&postajaID=43)

## Dashboard

- Posljednji poznati vodostaj i protok, svaki s vlastitim vremenom i starošću.
- Jasno upozorenje kad podatak kasni više od 3 sata. Osvježavanje stranice nije
  dokaz novog mjerenja; vrijeme učitavanja prikazano je zasebno.
- Promjena prema istom lokalnom satu prethodnog dana, samo ako oba mjerenja postoje.
- Brzi rasponi (24 sata, 3/7/30 dana, cijela arhiva), vlastiti datumi i opcija
  **Do zadnjeg mjerenja** za povijesni pregled tijekom kašnjenja izvora.
- Satni grafovi i dnevni prosjeci. Opis dnevne točke navodi broj dostupnih uzoraka.
  Prekidi ostaju vidljivi; dnevni prosjek nepotpunog dana nije potpun dnevni podatak.
- Minimum, maksimum i prosjek odabranog razdoblja za oba mjerenja.
- Popunjenost oba niza i popis nedostajućih sati. Posljednja 3 sata izuzeta su
  iz provjere praznina zbog mogućeg kašnjenja objave. Jesenski ponovljeni sat
  računa se jednom jer CSV ne sadrži UTC odmak.
- Paginirana tablica, redoslijed, prikaz nepotpunih redaka i CSV izvoz **svih
  odabranih satnih redaka**, ne samo trenutačne stranice. Filtar nepotpunih redaka
  odnosi se samo na tablicu; potpuno nedostajući sati navedeni su iznad nje.
- Svijetla/tamna tema, mobilni prikaz, tipkovnička navigacija i ručno osvježavanje.

Sva vremena mjerenja tumače se i prikazuju u `Europe/Zagreb`, bez obzira na
vremensku zonu uređaja. Podaci se dohvaćaju iz datoteka uz dashboard pa je moguće
pregledati i vlastitu granu lokalno. Chart.js 4.4.9 i njegova MIT licenca nalaze
se u `assets/vendor/`; nisu potrebni CDN ni vanjski fontovi. Dashboard se
osvježava svakih 5 minuta dok je kartica vidljiva. Neuspjelo osvježavanje čuva
prethodno učitane podatke i prikazuje upozorenje.

## Prikupljanje i ponašanje pri kvaru

GitHub Actions traži pokretanje svaki sat (`7 * * * *`, UTC), a prikupljanje
pokreće i nakon izmjene scrapera ili njegova workflowa na `main`. GitHub ne jamči
satnu isporuku: događaji mogu kasniti ili biti odbačeni pod opterećenjem.
Za zajamčeno neovisno pokretanje treba vanjski raspoređivač; podržan je
`repository_dispatch` s `event_type: scrape`, ali vanjski servis nije postavljen.

Scraper provjerava strukturu izvora, datume, pune sate, numeričke vrijednosti,
duplikate i buduće oznake. Jedan sat u budućnosti dopušten je kao tolerancija.
Dva se izvora obrađuju **neovisno**:

| Stanje | Ponašanje |
| --- | --- |
| Oba izvora uredna | Spremi dostupna mjerenja i provjeri praznine. |
| Izvor kasni | Spremi valjana mjerenja, prijavi kašnjenje; nema beskorisnog ponavljanja samo zbog starosti. |
| Jedan izvor nedostupan/neispravan | Spremi drugi, očuvaj ranije poznata polja i prijavi problem. |
| Oba izvora nedostupna/neispravna | Očuvaj CSV, ponovi dohvat, objavi status greške i označi workflow neuspješnim. |
| Neispravan postojeći CSV ili kvar zapisivanja | Prekini s greškom; ne prikazuj uspješno prikupljanje. |

Zapisi su atomarni; nepromijenjeni CSV se ne prepisuje. Prazno polje iz djelomičnog
uvoza ne briše poznatu vrijednost drugog mjerenja. Workflow pri istodobnim
izmjenama prvo pokušava rebase, a kod sukoba spaja prikupljene vrijednosti u
aktualnu granu umjesto odbacivanja tuđih promjena koda.

`scrape-status.json` objavljuje vrijeme **pokušaja**, stanja pojedinih izvora i
kvalitetu arhive za dashboard. Generira ga workflow i sprema uz CSV, čak i kad
oba izvora zakažu (ako spremanje/slanje uspije). Nedostupan status ne blokira
prikaz arhive. Sažetak Actions posla prikazuje kratke nalaze; izvještaji i
izvorni HTML dostupni su 30 dana u artefaktu `scrape-diagnostics-*`.

### Izlazni kodovi

| Kod | Značenje |
| --- | --- |
| 0 | Izvori i provjera uredni. Nova mjerenja nisu nužna ako je niz svjež. |
| 1 | Oba izvora neupotrebljiva ili ozbiljna greška CSV-a/zapisa. |
| 2 | Kašnjenje, djelomični dohvat, nepodudarni sati ili praznine; valjana mjerenja spremljena su. |

Kod 2 u Actions daje upozorenje, a kod 1 nakon ponavljanja daje grešku.
`--check` samo čita CSV, provjerava kvalitetu i zapisuje izvještaj; ne dohvaća izvor.
Zadani prozor provjere je 168 sati, a prag svježine 3 sata.

CSV nema UTC odmak pa ne razlikuje dva jesenska mjerenja istog lokalnog sata.
Proturječni duplikati u izvoru odbijaju se. Pri proljetnoj promjeni sata ne
prijavljuje se nepostojeći sat. Za potpunu razradu jesenske dvosmislenosti treba
potvrda operatora o vremenu izvora i migracija formata.

## Lokalno pokretanje i provjera

Potreban je Python 3.11+ i Node.js 24 za JS provjere.

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/dashboard.test.cjs
# Opcionalne provjere u pregledniku (iste pokreće CI):
pip install playwright==1.56.0
python -m playwright install chromium
python tests/browser_smoke.py
python scraper.py --report collection-report.json --status-file scrape-status.json
python scraper.py --check --report quality-report.json
python -m http.server 8000
```

Otvori `http://localhost:8000/dashboard.html`. `index.html` vodi na isti pregled.
Za siguran probni dohvat koristi kopiju CSV-a i `--csv putanja/do/kopije.csv`.

Nakon izmjene workflowa pokreni **Actions → Scrape vodostaj i protok → Run
workflow** na `main`. **Re-run jobs** ponavlja stari commit i stari workflow.

Nalazi prethodnog pregleda i granice oporavka povijesnih podataka:
[22.10.2026.](docs/reliability-2026-10-22.md). Aktualni pregled:
[3.11.2026.](docs/review-2026-11-03.md).
