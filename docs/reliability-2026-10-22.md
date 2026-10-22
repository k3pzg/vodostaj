# Provjera pouzdanosti 22.10.2026.

Osnova pregleda je main commit `1c07944c2f9092ad684465c647a787065c20aca9`.
Vrijeme Actions pokretanja u nastavku je UTC; vremena mjerenja su iz CSV-a.

## Raspored

Workflow je na mainu imao `7 * * * *`; posljednja promjena workflowa prije ovog
pregleda bila je 25.8.2026. Promjena rasporeda u promatranom razdoblju nije nađena.

[Actions API](https://api.github.com/repos/k3pzg/vodostaj/actions/runs?per_page=100)
je za 20.10. do posljednjeg provjerenog pokretanja 22.10. u 04:34:39 UTC vratio
12 zakazanih scraper pokretanja. Njihovi razmaci bili su oko 3,18–5,68 sati.
Za svih 12 provjereni su i zapisi poslova: posao počinje 2–4 sekunde nakon
nastanka runa i traje 11–17 sekundi. Dugotrajno izvršavanje scrapera ili čekanje
na runner nakon nastanka runa zato ne objašnjava te višesatne razmake. Nisu nađeni
otkazani ni neuspješni scraper runovi u tom intervalu.

Primjeri početaka: 20.10. 00:16:43, 05:57:44, 11:27:17, 16:54:39, 20:32:15,
23:49:14; 21.10. 04:36:01, 10:03:35, 15:11:32, 20:05:33, 23:16:23;
22.10. 04:34:39.

Nalaz smješta problem prije početka izvršavanja posla, u isporuku zakazanog
događaja. GitHub izričito dokumentira mogućnost odgode i odbacivanja schedule
događaja pod opterećenjem. To je moguće objašnjenje, ali API ne daje dokaze o
internoj odluci raspoređivača za svaki propušteni sat i specifičan uzrok unutar
GitHuba nije potvrđen. Nema osnove tvrditi da će sama izmjena cron minute ili
češći GitHub cron osigurati satno izvršavanje. Zadržan je postojeći raspored;
dodan je ulaz za neovisan raspoređivač, bez postavljanja vanjskog servisa.

Dokumentacija:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

## Praznine i mogućnost oporavka

U posljednjih sedam dana potvrđene su sljedeće praznine u oba stupca CSV-a.
Pretražena je povijest `vodostaj_protok.csv` na svim dohvaćenim granama; nijedan
od ova četiri retka nije nađen. To vrijedi za dostupnu Git povijest, ne za moguće
nedohvaćene ili izbrisane izvore.

| Vrijeme u CSV-u | Dostupni dokazi | Status oporavka |
| --- | --- | --- |
| 15.10.2026. 11:00 | Run 38755891091 dodao je sate 12–16, preskočivši 11. Izvorni HTML tog runa nije sačuvan. | Aktualne tablice više ne pokrivaju taj datum. Naknadni dohvat nije potvrđen. |
| 18.10.2026. 10:00 | Run 39136390837 dodao je druge sate. Nema sačuvanog izvornog HTML-a. | Aktualne tablice više ne pokrivaju taj datum. Naknadni dohvat nije potvrđen. |
| 18.10.2026. 17:00 | Run 39152346065 dodao je druge sate. Nema sačuvanog izvornog HTML-a. | Aktualne tablice više ne pokrivaju taj datum. Naknadni dohvat nije potvrđen. |
| 20.10.2026. 08:00 | Aktualne tablice vodostaja i protoka pokrivaju razdoblje 20.10. 00:00 – 22.10. 08:00, ali nijedna ne sadrži 20.10. 08:00. | Nedostupan u oba provjerena aktualna izvora. Za oporavak treba izvorni arhiv operatora. |

Izravni dohvat dviju tablica tijekom pregleda oko 06:48 UTC vratio je po
56 mjerenja. Ponovljeni izravni dohvat nakon korisnikove poveznice potvrdio je isti rezultat.
Svih 54 sata koja se preklapaju s CSV-om imaju potpuno jednake
vrijednosti. Preostala dva su 22.10. u 07:00 i 08:00 i moguće ih je dohvatiti
redovnim scraperom. Integracijska provjera nad privremenom kopijom CSV-a dodala
je upravo ta dva retka i ispravno prijavila četiri navedene praznine. Produkcijski
CSV ovom izmjenom nije promijenjen.

Primjer neobičnog šiljka sa slike: 20.10. u 13:00 vodostaj 32 cm i protok
1,03 m³/s postoje u oba izravno dohvaćena izvora i u CSV-u. Dakle taj šiljak nije
nastao samo crtanjem grafa. Provjera prepisivanja ne potvrđuje ispravnost senzora,
referentne razine ili hidrauličkih uvjeta; za to treba provjera kod operatora.
Izglađivanje linije i spajanje praznina na dashboardu ipak su uklonjeni.

Izvori:
- https://mvodostaji.voda.hr/Home/PregledVodostajaPostaje?sektorID=4&bpID=6&postajaID=43
- https://mvodostaji.voda.hr/Home/PregledProtokaPostaje?sektorID=4&bpID=6&postajaID=43
- https://github.com/k3pzg/vodostaj/actions/runs/38755891091
- https://github.com/k3pzg/vodostaj/actions/runs/39136390837
- https://github.com/k3pzg/vodostaj/actions/runs/39152346065
- https://github.com/k3pzg/vodostaj/actions/runs/39415057050
- https://github.com/k3pzg/vodostaj/actions/runs/39723151545

Postojeći scraper uzimao je samo presjek satnih oznaka dvaju izvora. To može
izgubiti raspoloživo mjerenje ako drugi izvor nema isti sat. Postojeći scraper je
ujedno vraćao izlazni kod 0 i nakon neuspjelog dohvata ili parsiranja, pa retries
u workflowu nisu reagirali. To su potvrđene slabosti koda, ali nisu dokaz uzroka
konkretnih povijesnih praznina. Pregledani runovi oko četiri praznine navode
uspješno parsiranje i stvarno dodavanje drugih redaka; ne čuvaju izvorne tablice
ni pojedinačne neusklađene sate, pa konačni povijesni uzrok ostaje nepotvrđen.

Nijedno nedostajuće mjerenje nije procijenjeno ili izmišljeno. Za tri starija
sata i dalje je moguć arhivski podatak kod operatora, ali nije pronađen niti
potvrđen ovim pregledom. Vrijednosti se mogu dopuniti tek nakon provjere takvog
izvora.
