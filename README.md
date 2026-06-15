# Abonnementskalkulator – Elkjøp Telecom

Internt verktøy for selgere i butikk. Anbefaler mobilabonnement fra
**Telenor, Telia og ICE**, og viser kundens besparelse mot dagens abonnement
(uansett hvilken leverandør kunden har i dag).

## Filstruktur

| Fil | Innhold | Hvem endrer |
|-----|---------|-------------|
| `data/abonnementer.json` | Offentlig prisinfo: navn, leverandør, pris/SIM, data, familierabatt | Oppdateres **månedlig** ved prisendring |
| `data/prioritet.json` | **Intern** vekting per abonnement (sorteringsscore) | Du, ved behov |
| `kalkulator.js` | All beregning. Leser begge JSON-filene. Vet aldri hva prioritet-tallet *betyr* | Sjelden |
| `app.js` | Grensesnitt (skjema, resultat + intern prisoversikt) | Sjelden |
| `index.html` / `style.css` | Visning, mobil/nettbrett-vennlig | Sjelden |
| `assets/elkjop-logo.svg` | Elkjøp-logo (hvit) i headeren, fungerer som knapp | Sjelden |
| `assets/{telenor,telia,ice}-logo.*` | Operatør-logoer (hvite) på den tilpassede anbefalingen | Sjelden |

**Intern prisoversikt (redigerbar):** klikk på Elkjøp-logoen for å åpne en
oversikt over alle priser, aldersgrenser/-rabatter og familierabatt-logikk per
operatør. Her kan selgeren også **redigere priser lokalt**, **legge til nye
abonnement** og **tilbakestille**:

- Hver pris er et redigerbart felt. Endringer lagres i nettleseren
  (`localStorage`, nøkkel `elkjop_abo_endringer_v2`), overstyrer `abonnementer.json`
  og påvirker anbefalingene umiddelbart. Endrede felt markeres grønt.
- «Legg til abonnement» legger til en ny plan (leverandør, navn, data/ubegrenset,
  hastighet, pris, aldersgrense, familierabatt og produktrabatt). Nye planer merkes
  «NY» og kan fjernes med ✕.
- «↺ Tilbakestill» fjerner alle lokale endringer og går tilbake til JSON-verdiene.

Andre `localStorage`-nøkler: `elkjop_peak` (Sommerpeak av/på), `elkjop_lokal_dekning`
(lokale dekningsoverstyringer) og `elkjop_meny_v1` (valg i burgermenyen).

Lokale endringer er per nettleser/enhet og rører ikke `abonnementer.json` (som
fortsatt er kilden for permanente, månedlige oppdateringer).

## Sommerpeak 2026 (Peak-modus)

En bryter **i prisoversikten** veksler mellom **normalpriser** og
**Sommerpeak-priser**. Baren lyser amber når Peak er aktiv. **Standard er PÅ**;
modusen huskes mellom økter (`localStorage`-nøkkel `elkjop_peak`). Selve
anbefalingssiden har ingen bryter – den følger bare valgt modus.

- Planer kan ha `peak_pris` i `abonnementer.json` (f.eks. iceMax: 349 vs normal
  399). Når Peak er på brukes `peak_pris`; ellers `pris_per_sim`. Planer uten
  `peak_pris` har samme pris i begge moduser.
- Peak-modus påvirker hele anbefalingen umiddelbart.
- **Lokale prisendringer er modus-spesifikke:** redigerer du en pris i Peak,
  endres bare peak-prisen (normalprisen er urørt), og motsatt. Prisoversikten
  viser «☀ Sommerpeak-priser» / «Normalpriser» i statuslinjen.

Logikk og data er bevisst adskilt: priser oppdateres uten å røre kode, og
intern vekting justeres uten å røre priser eller logikk.

**Flyt:** selgeren fyller inn kundeinfo på steg 1 og trykker den store grønne
**«Gi anbefaling»**-knappen → resultat-visningen (steg 2). Der vises den
anbefalte operatøren (merkevare-tilpasset kort + fordeling per person), og under
**«Andre alternativer»** – de øvrige operatørene som **sammenleggbare dropdowns**
som utvides til å vise sammensetningen (plan per person) hos hver. «← Endre
kundeinfo» går tilbake. Elkjøp-logoen åpner den interne prisoversikten.

Ved siden av «Dagens månedspris» er det en **kalkulator-knapp** som åpner en
enkel kalkulator – nyttig for å summere kundens nåværende abonnement (f.eks.
299 + 399 + 199). Regnestykket vises i en egen linje over displayet mens du
taster. «Bruk i dagens pris» setter resultatet inn i feltet.

**↺ Ny kunde** (øverst i kundepanelet) tømmer alle kundespesifikke felt
(personer, alder/behov, dagens pris og leverandør, kundeprioritet) for å starte
rent på neste kunde – uten å røre innstillinger som priser, Sommerpeak, lokal
dekning og burgermeny-valg.

## Slik virker anbefalingen

Verktøyet er **per-bruker**: hver person i husstanden har egen alder og eget
databehov. For hver leverandør (Telenor/Telia/ice) velges beste plan **per
person**, familierabatt regnes på leverandørnivå, og leverandørene rangeres
etter total husstandspris. Billigste leverandør som dekker alle anbefales.

Slik kan f.eks. **ice** anbefales med én person på *ice 40 GB* og en annen på
*ice 6 GB* – ulike planer, samme nett.

Per person velges planen som:
1. **dekker databehovet** (lignende/litt høyere data – ikke unødig stor),
2. **leverer minst valgt hastighet** (Vanlig / Rask ≥200 Mbit / Lynrask ≥1000 Mbit),
3. er **lovlig for alderen** (junior-/ung-planer har aldersgrense),
4. har **lavest pris** etter eventuell aldersrabatt.

**Hastighet:** ubegrenset-abonnement finnes i ulike hastigheter (`hastighet_mbit`
på planen). Hastighetskravet settes **per person** (Vanlig/Rask/Lynrask).
Krav-nivåene ligger i `HASTIGHET_VALG` (`kalkulator.js`): Vanlig ≥0, **Rask ≥200**,
Lynrask ≥1000 Mbit. Telia ubegrenset har tre hastighetstrinn: X Start (10 Mbit) →
Vanlig, X Basis (250) → Rask, X Max (1000) → Lynrask. ice topper på iceMax 200 /
iceMax med Netflix 300 Mbit – dekker dermed «Rask», men faller ut på «Lynrask»
(krever 1000). Juster `hastighet_mbit` i dataene for å treffe deres faktiske lineup.

`bruk_prioritet: true` er reservert for senere – da kan intern vekting
(`prioritet.json`) påvirke planvalget når flere er omtrent like gode.

Alle beløp er **totalt per måned for husstanden**.

## Konfigurasjon

Øverst i `kalkulator.js`:

```js
const CONFIG = {
  fri_data_som_gb: 40,            // ved "Fri data" teller pakker >= 40 GB som tilnærmet fri
                                  //   (så ice uten ekte ubegrenset blir relevant). Sett høyere
                                  //   for å kreve mer, eller f.eks. 9999 for kun ekte ubegrenset.
  bruk_prioritet: false,          // reservert: la prioritet.json påvirke planvalg
};
```

Databehov-valgene (`DATA_VALG` i `kalkulator.js`): Veldig lite (~1 GB), Lite
(~5 GB), Middels (~15 GB), Mye (~30 GB), Fri data. **Standardvalg = Fri data.**

**Nøyaktig datamengde:** en toggle i burgermenyen («Innstillinger») bytter
data-feltet fra kategori-dropdown til et **GB-tallfelt per person** – skriv inn
f.eks. 19 GB direkte. Verdien seedes fra valgt kategori når du slår den på, og
anbefalingen finner billigste plan som dekker minst det antallet GB.

**Aldersgrupper** velges som dropdown (ikke nøyaktig alder) i `ALDER_VALG`
øverst i `kalkulator.js` – kun gruppen som utløser rabatt/eligibilitet trengs:
`30+ år`, `Under 30`, `Under 16`, `Under 13`. Hver mapper til en representativ
alder (40 / 25 / 14 / 10) som logikken bruker mot `alder_maks` og `alder_rabatt`.

## Oppdatere priser månedlig

Rediger `data/abonnementer.json`. Hvert abonnement:

```json
{
  "id": "telia_10",              // STABIL nøkkel - ikke endre (kobler mot prioritet.json)
  "leverandor": "Telia",
  "navn": "Telia 10 GB",
  "data_gb": 10,
  "ubegrenset": false,           // true = fri data (data_gb ignoreres)
  "hastighet_mbit": 1000,        // maks hastighet planen leverer (mot Vanlig/Rask/Lynrask)
  "pris_per_sim": 369,
  "alder_maks": 29,              // VALGFRI: kun for brukere t.o.m. denne alderen (junior/ung)
  "alder_rabatt": [{ "maks": 29, "rabatt_kr": 50 }]  // VALGFRI: aldersbasert avslag
}
```

**Familierabatt** ligger på leverandørnivå øverst i filen, og hver operatør
har sin egen modell (de er reelt forskjellige):

```json
"familierabatt": {
  "Telenor": { "modell": "familiemedlem_fastpris", "gjelder_kun_ubegrenset": true,
               "medlemspris": { "voksen": 499, "under_30": 399 } },
  "Telia":   { "modell": "dyreste_full_plantype", "rabatt_kr_ubegrenset": 100, "rabatt_kr_ovrige": 30, "maks_antall_med_rabatt": 7 },
  "ice":     null
}
```

- **`familiemedlem_fastpris` (Telenor):** *ikke en samlet familierabatt, men en
  prisfordeling per person.* Hovedabonnent (dyreste kvalifiserte) betaler full
  pris, hvert ekstra medlem på ubegrenset får en **lavere fast medlemspris etter
  alder** (voksen 499 / under 30: 399). En **under 13** faller tilbake på
  voksenprisen (499) med mindre planen har et eget `familie_medlemspris`-felt –
  f.eks. **Sikre Mobil** der under 13 betaler **249**. I fordelingen per person
  vises den faktiske, lavere personprisen (merket «medlemspris»), ikke en egen
  rabattlinje. Gjelder kun ubegrenset. Medlemmer med fastdata betaler egen pris.
- **`dyreste_full_plantype` (Telia):** dyreste SIM full pris, øvrige får rabatt
  etter plantype (`rabatt_kr_ubegrenset` / `rabatt_kr_ovrige`), maks
  `maks_antall_med_rabatt` SIM. Kombineres med aldersrabatt.
- **`null` (ice):** ingen prisrabatt. iceFamilie = felles faktura/datadeling og
  egne barn/ung-planer (modellert som `alder_rabatt` på planene), ikke kronefradrag.

**Ungdoms-/juniorplaner gir ikke familierabatt.** Planer merket med
`"gir_familierabatt": false` (f.eks. Telia X Ung, Telia Junior) kvalifiserer
ikke – kunden må ha vanlig ubegrenset eller fast mengde. Default er `true`.

## Inkluderte tjenester

Toppnivå-feltet `inkludert` i `abonnementer.json` lister tjenester som følger
med per leverandør (vises som ekstra verdi i kundevisning og prisoversikten):

```json
"inkludert": {
  "Telenor": ["Nettvern+"],
  "Telia": ["Svindelsperre", "Nettvakt", "Nettslett"],
  "ice": ["Svindelbeskyttelse"]
}
```

Telenor inkluderer **Nettvern+**; Telia inkluderer **Svindelsperre, Nettvakt og
Nettslett** (på ubegrenset). Vises på anbefalingskortet, i leverandør-
sammenligningen og i prisoversikten. Legg til flere ved behov.

Enkeltplaner kan i tillegg ha plan-spesifikke tjenester via `inkludert` på selve
planen (f.eks. **Sikre Mobil** → «Telenor Sikre», **iceMax med Netflix** →
«Netflix»). Disse vises i prisoversikten. Sikre Mobil er en egen premium
ubegrenset-plan (699, maks hastighet) ved siden av Ubegrenset Enkel/Maksimal.

**Sikkerhetsscore:** Telia har den beste innebygde sikkerheten av
standardabonnementene (`sikkerhet_basis`: Telia 60, Telenor 45, ice 35). **Kun
Telenor Sikre Mobil** – et abonnement med en ekstra sikkerhetspakke – overstiger
Telia, via feltet `"sikkerhet": 100` på selve planen. Ingen andre standardplaner
ligger over Telia. Når kunden prioriterer sikkerhet høyt, kan kalkulatoren
oppgradere til Sikre Mobil innenfor det dynamiske pristaket.

## Produktrabatt (kampanje)

Planer som kvalifiserer merkes med `"produktrabatt": true` (Telia X-planene).
Kronebeløpet styres av en **hamburger-meny** (til venstre for Elkjøp-logoen) med
to gjensidig utelukkende brytere – **500 kr** eller **1000 kr per Telia X** (maks
én på om gangen, begge kan være av). Beløpet = antall kvalifiserte planer ×
valgt sats, vist som **produktrabatt (engangs)** på anbefalingen og i fordelingen.

**Vektes inn i rangeringen:** engangsrabatten fordeles over
`CONFIG.produktrabatt_periode_mnd` (standard 12 mnd) og trekkes fra i
rangeringen – ikke i den viste månedsprisen. En operatør kan dermed anbefales
over en litt billigere løsning hvis merprisen per måned er mindre enn den
fordelte rabatten. Større rabatt → større utslag, og når rabatten avgjorde
valget merkes anbefalingen «✦ produktrabatt vektet inn». Eksempel: ice 399 vs
Telia 449 (gap 50) – 500 kr vipper *ikke* (≈42/mnd), men 1000 kr vipper (≈83/mnd).

## Kundepreferanse

Samme hamburger-meny har en **kundepreferanse**: velg operatør (Telenor/Telia/ice)
og en styrke – **Foretrekk** eller **Krev**:

- **Av** (Ingen preferanse): ren pris-rangering.
- **Foretrekk:** operatøren anbefales hvis den er innenfor `foretrekk_margin_kr`
  (standard 150 kr/mnd) fra billigste – ellers vinner billigste. Holder
  anbefalingen troverdig.
- **Krev:** operatøren anbefales alltid så lenge den kan dekke kunden, uansett pris.

Den viste prisen endres ikke; bare rekkefølgen. Anbefalingen merkes med
«✦ kundepreferanse» når preferansen avgjorde valget. Standard er «Ingen» (av).

## Avanserte innstillinger

Under «Avanserte innstillinger» i hamburger-menyen:

- **Ekskluder dagens operatør** (standard **PÅ**): når selgeren har valgt kundens
  nåværende leverandør i «Dagens leverandør», holdes den operatøren utenfor
  anbefalingen (kunden skal jo bytte). Gjelder bare når dagens operatør er en av
  våre tre (Telenor/Telia/ice). Feltet «Dagens leverandør» starter **tomt** – er
  det tomt, ekskluderes ingenting. Faller automatisk tilbake til fullt utvalg
  hvis ekskluderingen ville fjernet all dekning.
- **Lokal dekning:** glidere per operatør som overstyrer landssnittet (`SCORE.dekning`)
  når lokal dekning avviker. Lagres per nettleser (`elkjop_lokal_dekning`).
  «Nullstill til standard» fjerner overstyringene.

**Kundeprioritet** («Hva er viktigst for kunden?»): hver dimensjon (pris/dekning/
sikkerhet) settes til Lav/Middels/Høy/Svært høy. **Lav = teller ikke** (0 vekt);
er alt satt til Lav, brukes ren pris. Ved lik vektet score vinner billigste.

## Operatør-tilpasset anbefaling

Anbefalingskortet farges etter operatøren som anbefales, med operatørens logo
øverst til høyre og en liste over **fordeler** som følger med:

- **Farge + logo** styres av `MERKEVARE` i `app.js` (Telenor blå, Telia lilla,
  ice navy/amber). Logoene ligger i `assets/` (hvit variant for fargede kort).
- **Fordeler** ligger i `fordeler`-feltet i `abonnementer.json` (per leverandør) –
  f.eks. Telia Sky, Min Sky, iceFamilie. Rediger fritt.

> Behold `id` uendret når du oppdaterer pris. Bytter du `id`, mister abonnementet sin prioritet-score (faller tilbake til nøytral 1.0).

## Endre intern vekting

Rediger `data/prioritet.json`. Høyere tall = foretrekkes blant likeverdige
alternativer. Skala er fri (eksempel 0.5–2.0). Mangler en `id`, brukes 1.0.

## Kjøre lokalt

Nettleseren laster JSON via `fetch`, som krever en webserver (ikke `file://`).
Enkleste måte:

```bash
cd "Elkjøp Abo Kalkulator"
python3 -m http.server 8000
# Åpne http://localhost:8000 på mobil/nettbrett i samme nett
```
