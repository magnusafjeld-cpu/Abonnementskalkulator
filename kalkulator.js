/* ============================================================
   Abonnementskalkulator - logikk
   Leser data/abonnementer.json (offentlig pris + familierabatt)
   og data/prioritet.json (intern vekting, foreløpig ikke i bruk).

   Per-bruker-modell: hver person har egen alder og eget databehov.
   For hver leverandør (Telenor/Telia/ice) velges beste plan PER person,
   familierabatt regnes på leverandørnivå, og leverandørene rangeres
   etter total husstandspris. Slik kan f.eks. ice anbefales med én
   person på ice 50 GB og en annen på ice 6 GB.
   ============================================================ */

// ---- Konfigurasjon (juster fritt) ---------------------------
const CONFIG = {
  // Ved "Fri data": en plan teller som tilnærmet fri data hvis den har minst
  // så mange GB. Slik kan en leverandør uten ekte ubegrenset (f.eks. ice med
  // sin største pakke) likevel være et relevant alternativ. Ekte ubegrenset
  // dekker alltid.
  fri_data_som_gb: 40,

  // Reservert for senere: la intern prioritet (prioritet.json) påvirke
  // hvilken plan som velges per bruker når flere er omtrent like gode.
  bruk_prioritet: false,

  // Kundepreferanse "Foretrekk": den foretrukne operatøren anbefales hvis den
  // er innenfor dette beløpet (kr/mnd) fra billigste. "Krev" ignorerer dette.
  foretrekk_margin_kr: 150,

  // Produktrabatt (engangs) fordeles over denne perioden (mnd) når den vektes
  // inn i rangeringen. F.eks. 1000 kr / 12 ≈ 83 kr/mnd "rabattert" i ranking.
  produktrabatt_periode_mnd: 12,

  // Kundeprioritet: dynamisk pristak. Anbefalingen kan koste opp til en premie ×
  // antall SIM mer enn billigste. Premien skalerer med hvor LITE pris vektlegges
  // (0 ved ren pris, opp mot dette maksbeløpet når pris er nedprioritert). Slik kan
  // f.eks. en bedre-dekning-operatør vinne når pris er nedprioritert, uten å bli
  // valgt når kunden mest bryr seg om pris.
  prioritet_premie_maks_kr: 275,

  // Sikkerhetsbudsjett: hvor mye ekstra (per SIM, over billigste) kunden er villig
  // til å betale for å oppgradere til en sikrere plan (f.eks. Telenor Sikre).
  // Skalerer med det ABSOLUTTE sikkerhetsnivået kunden har satt (Lav→Svært høy),
  // IKKE med den normaliserte vekten – slik at budsjettet er stabilt uansett hva
  // dekning/pris er satt til. Ved «Svært høy» er hele beløpet tilgjengelig, nok
  // til at Telenor Sikre velges når sikkerhet faktisk er det viktigste.
  sikkerhet_premie_maks_kr: 600,
};

// Datakategori -> påkrevd GB. null = fri data. Standardvalg = "fri" (se app.js).
const DATA_VALG = {
  veldig_lite: { label: "Veldig lite (~1 GB)", gb: 1 },
  lite:        { label: "Lite (~5 GB)",        gb: 5 },
  middels:     { label: "Middels (~15 GB)",    gb: 15 },
  mye:         { label: "Mye (~30 GB)",        gb: 30 },
  fri:         { label: "Fri data",            gb: null },
};

// Hastighetskrav -> minimum Mbit planen må levere. Standard = "vanlig".
const HASTIGHET_VALG = {
  vanlig:  { label: "Vanlig",  min_mbit: 0 },
  rask:    { label: "Rask",    min_mbit: 200 },
  lynrask: { label: "Lynrask", min_mbit: 1000 },
};

// Aldersgruppe -> representativ alder som utløser riktig rabatt/eligibilitet.
// Vi trenger ikke nøyaktig alder, kun hvilken rabattgruppe brukeren er i.
const ALDER_VALG = {
  voksen: { label: "30+ år",     alder: 40 },
  ung:    { label: "Under 30",   alder: 25 },
  junior: { label: "Under 16",   alder: 14 },
  barn:   { label: "Under 13",   alder: 10 },
};

// Leverandørene vi faktisk selger.
const VARE_LEVERANDORER = ["Telenor", "Telia", "ice"];

// ---- Datalasting --------------------------------------------
let ABONNEMENTER = [];          // effektiv liste (base + lokale endringer)
let BASE_ABONNEMENTER = [];     // uendret fra abonnementer.json
let FAMILIERABATT = {};
let INKLUDERT = {};
let FORDELER = {};
let PRIORITET = {};
let SALGSKODER = {};   // plan-id -> { kode, binding }
let TELIA_X_IDS = [];  // plan-id-er som regnes som "Telia X" (utløser peakkoder)
let EKSTRAKODER = {};  // familie-/peakkoder
let SCORE = { dekning: {}, sikkerhet_basis: {} }; // dekning/sikkerhet pr. operatør
let LOKAL_DEKNING = {}; // lokale dekningsoverstyringer pr. operatør (avanserte innst.)
let UTMERKELSER = {};   // utmerkelser/priser pr. operatør (vises i anbefalingen)

// Lokale endringer lagret i nettleseren (priser per modus + nye abonnement).
const LAGER_NOKKEL = "elkjop_abo_endringer_v2";
const PEAK_NOKKEL = "elkjop_peak";
const DEKNING_NOKKEL = "elkjop_lokal_dekning";
let LOKALE_ENDRINGER = { priser: { normal: {}, peak: {} }, nye: [] };
let PEAK = true; // Sommerpeak-modus (kampanjepriser). Standard: på.

async function lastData() {
  // no-store: unngå at nettleseren serverer utdaterte priser etter at
  // abonnementer.json er oppdatert månedlig.
  const [abo, pri, kod] = await Promise.all([
    fetch("data/abonnementer.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/prioritet.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/koder.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  BASE_ABONNEMENTER = abo.abonnementer;
  FAMILIERABATT = abo.familierabatt || {};
  INKLUDERT = abo.inkludert || {};
  FORDELER = abo.fordeler || {};
  SCORE = abo.score || { dekning: {}, sikkerhet_basis: {} };
  UTMERKELSER = abo.utmerkelser || {};
  PRIORITET = pri.prioritet;
  SALGSKODER = kod.salgskoder || {};
  TELIA_X_IDS = kod.telia_x_ids || [];
  EKSTRAKODER = kod.ekstrakoder || {};
  lastPeak();
  lastLokalDekning();
  lastLokaleEndringer();
  byggAbonnementer();
}

// ---- Lokal dekning (avanserte innstillinger) ----------------
// Selger kan overstyre dekningsscore pr. operatør for lokale forhold. Lagres i
// nettleseren og overstyrer landsverdiene i SCORE.dekning.
function lastLokalDekning() {
  try {
    LOKAL_DEKNING = JSON.parse(localStorage.getItem(DEKNING_NOKKEL) || "{}") || {};
  } catch {
    LOKAL_DEKNING = {};
  }
}
function lagreLokalDekning() {
  try {
    localStorage.setItem(DEKNING_NOKKEL, JSON.stringify(LOKAL_DEKNING));
  } catch {}
}
// Landsstandard (benchmark) for en operatør.
function standardDekning(leverandor) {
  return SCORE.dekning[leverandor] != null ? SCORE.dekning[leverandor] : 50;
}
// Gjeldende dekning (lokal overstyring hvis satt, ellers standard).
function gjeldendeDekning(leverandor) {
  return LOKAL_DEKNING[leverandor] != null
    ? LOKAL_DEKNING[leverandor]
    : standardDekning(leverandor);
}
function settLokalDekning(leverandor, verdi) {
  LOKAL_DEKNING[leverandor] = Math.max(0, Math.min(100, Math.round(verdi)));
  lagreLokalDekning();
}
function nullstillLokalDekning() {
  LOKAL_DEKNING = {};
  try {
    localStorage.removeItem(DEKNING_NOKKEL);
  } catch {}
}
function harLokalDekning() {
  return Object.keys(LOKAL_DEKNING).length > 0;
}

// ---- Peak-modus (Sommerpeak 2026) ---------------------------
function lastPeak() {
  // Standard: PÅ. Respekterer lagret valg hvis selger har skrudd det av.
  try {
    const v = localStorage.getItem(PEAK_NOKKEL);
    PEAK = v === null ? true : v === "1";
  } catch {
    PEAK = true;
  }
}
function settPeak(paa) {
  PEAK = !!paa;
  try {
    localStorage.setItem(PEAK_NOKKEL, PEAK ? "1" : "0");
  } catch {}
  byggAbonnementer();
}
function erPeak() {
  return PEAK;
}
function aktivModus() {
  return PEAK ? "peak" : "normal";
}
// Basepris for et abonnement i gjeldende modus (peak_pris ved Peak hvis satt).
function basePris(p) {
  return PEAK && p.peak_pris != null ? p.peak_pris : p.pris_per_sim;
}

// ---- Lokale prisendringer / nye abonnement -------------------
function lastLokaleEndringer() {
  try {
    const lagret = JSON.parse(localStorage.getItem(LAGER_NOKKEL) || "null");
    const pris = (lagret && lagret.priser) || {};
    LOKALE_ENDRINGER = {
      priser: { normal: pris.normal || {}, peak: pris.peak || {} },
      nye: (lagret && lagret.nye) || [],
    };
  } catch {
    LOKALE_ENDRINGER = { priser: { normal: {}, peak: {} }, nye: [] };
  }
}

function lagreLokaleEndringer() {
  try {
    localStorage.setItem(LAGER_NOKKEL, JSON.stringify(LOKALE_ENDRINGER));
  } catch {}
}

// Bygger den effektive ABONNEMENTER-lista: base/peak-pris med modus-spesifikke
// overstyringer + nye abonnement.
function byggAbonnementer() {
  const overstyr = LOKALE_ENDRINGER.priser[aktivModus()] || {};
  const overstyrNormal = LOKALE_ENDRINGER.priser.normal || {};
  const bygg = (p) => {
    const eff = overstyr[p.id] != null ? overstyr[p.id] : basePris(p);
    // Ordinær (ikke-peak) pris – referansen for «før»-pris når Sommerpeak gir
    // rabatt. Prioritet: normal-overstyring > eksplisitt 'for_pris' (kampanje­
    // planer uten egen normalpris, f.eks. Telia X Kampanje) > planens normale
    // listepris.
    const ordinaer =
      overstyrNormal[p.id] != null
        ? overstyrNormal[p.id]
        : p.for_pris != null
        ? p.for_pris
        : p.pris_per_sim;
    return { ...p, pris_per_sim: eff, pris_ordinaer: ordinaer };
  };
  // Kampanje-abonnement (kun_peak) vises kun når Sommerpeak er på.
  const synlig = (p) => PEAK || !p.kun_peak;
  ABONNEMENTER = BASE_ABONNEMENTER.concat(LOKALE_ENDRINGER.nye)
    .filter(synlig)
    .map(bygg);
}

function settPris(id, pris) {
  const modus = aktivModus();
  const nyPlan = LOKALE_ENDRINGER.nye.find((p) => p.id === id);
  if (nyPlan) {
    // Nytt abonnement: lagre pris direkte (peak_pris i peak-modus).
    if (PEAK) nyPlan.peak_pris = pris;
    else nyPlan.pris_per_sim = pris;
  } else {
    const base = BASE_ABONNEMENTER.find((p) => p.id === id);
    if (base && basePris(base) === pris) {
      delete LOKALE_ENDRINGER.priser[modus][id]; // tilbake til standard
    } else {
      LOKALE_ENDRINGER.priser[modus][id] = pris;
    }
  }
  lagreLokaleEndringer();
  byggAbonnementer();
}

function leggTilAbonnement(plan) {
  LOKALE_ENDRINGER.nye.push(plan);
  lagreLokaleEndringer();
  byggAbonnementer();
}

function fjernNyttAbonnement(id) {
  LOKALE_ENDRINGER.nye = LOKALE_ENDRINGER.nye.filter((p) => p.id !== id);
  lagreLokaleEndringer();
  byggAbonnementer();
}

function tilbakestillEndringer() {
  LOKALE_ENDRINGER = { priser: { normal: {}, peak: {} }, nye: [] };
  try {
    localStorage.removeItem(LAGER_NOKKEL);
  } catch {}
  byggAbonnementer();
}

function harLokaleEndringer() {
  return (
    Object.keys(LOKALE_ENDRINGER.priser.normal).length > 0 ||
    Object.keys(LOKALE_ENDRINGER.priser.peak).length > 0 ||
    LOKALE_ENDRINGER.nye.length > 0
  );
}
function erNyttAbonnement(id) {
  return LOKALE_ENDRINGER.nye.some((p) => p.id === id);
}
function erEndretPris(id) {
  return id in (LOKALE_ENDRINGER.priser[aktivModus()] || {});
}

// Inkluderte tjenester for en leverandør (f.eks. Telenor: Nettvern+).
function inkludertFor(leverandor) {
  return INKLUDERT[leverandor] || [];
}

// Ekstra fordeler som følger med hos en leverandør (vises i anbefalingen).
function fordelerFor(leverandor) {
  return FORDELER[leverandor] || [];
}

// Utmerkelser/priser for en leverandør (vises på anbefalingskortet).
function utmerkelserFor(leverandor) {
  return Array.isArray(UTMERKELSER[leverandor]) ? UTMERKELSER[leverandor] : [];
}

// Ekstra tjenester som følger med en spesifikk plan (f.eks. Sikre Mobil: Telenor Sikre).
function planInkludert(p) {
  return Array.isArray(p.inkludert) ? p.inkludert : [];
}

// ---- Hjelpere -----------------------------------------------
function effektivData(p) {
  return p.ubegrenset ? Infinity : p.data_gb;
}

// Maks hastighet planen leverer (Mbit). Mangler feltet -> anta full hastighet.
function planHastighet(p) {
  return p.hastighet_mbit != null ? p.hastighet_mbit : 1000;
}

function dekkerHastighet(p, minMbit) {
  return planHastighet(p) >= (minMbit || 0);
}

// Kvalifiserer planen for familierabatt? Ungdoms-/juniorplaner gjør ikke det
// (kunden må ha vanlig ubegrenset eller fast mengde). Default: ja.
function girFamilierabatt(p) {
  return p.gir_familierabatt !== false;
}

// ---- Scorer for kundeprioritet (dekning/sikkerhet) ----------
// Dekning er operatør-nivå (målt nettytelse). Sikkerhet er operatør-basis, men
// enkeltplaner kan overstyre (f.eks. Telenor Sikre Mobil = 100).
function dekningScore(leverandor) {
  return gjeldendeDekning(leverandor);
}
function sikkerhetScore(p) {
  if (p.sikkerhet != null) return p.sikkerhet;
  const b = SCORE.sikkerhet_basis[p.leverandor];
  return b != null ? b : 50;
}

function dekkerBehov(p, behovGb) {
  // behovGb === null betyr at kunden vil ha fri data. Ekte ubegrenset dekker,
  // og en stor nok pakke (>= CONFIG.fri_data_som_gb) teller som tilnærmet fri.
  if (behovGb === null) {
    return p.ubegrenset || effektivData(p) >= CONFIG.fri_data_som_gb;
  }
  return effektivData(p) >= behovGb;
}

function alderOk(p, alder) {
  // alder kan være null (ikke oppgitt) -> da utelukkes aldersbegrensede
  // junior/ung-planer, siden vi ikke kan bekrefte at de er tillatt.
  if (p.alder_maks != null) {
    if (alder == null || alder > p.alder_maks) return false;
  }
  if (p.alder_min != null && alder != null && alder < p.alder_min) return false;
  return true;
}

// Alderstilpasset pris ut fra en gitt grunnpris (trekker fra beste aldersrabatt).
function prisMedAldersrabatt(base, p, alder) {
  let pris = base;
  if (alder != null && Array.isArray(p.alder_rabatt)) {
    let beste = 0;
    for (const r of p.alder_rabatt) {
      if (alder <= r.maks && r.rabatt_kr > beste) beste = r.rabatt_kr;
    }
    pris -= beste;
  }
  return Math.max(0, pris);
}

// Pris for én plan for en gitt alder (etter eventuell aldersrabatt). Bruker den
// effektive prisen (peak-pris når Sommerpeak er på).
function planPris(p, alder) {
  return prisMedAldersrabatt(p.pris_per_sim, p, alder);
}

// Ordinær (ikke-peak) alderstilpasset pris – «før»-prisen som vises overstreket
// når Sommerpeak gir rabatt på planen.
function planPrisOrdinaer(p, alder) {
  const base = p.pris_ordinaer != null ? p.pris_ordinaer : p.pris_per_sim;
  return prisMedAldersrabatt(base, p, alder);
}

function prioritetFor(id) {
  return id in PRIORITET ? PRIORITET[id] : 1.0;
}

// ---- Per-bruker planvalg ------------------------------------
// Beste plan hos én leverandør for én bruker: dekker behovet, lovlig for
// alder, lavest pris, deretter tettest datapassform (lignende/litt høyere).
// Alle planer hos én leverandør som dekker bruker (behov/alder/hastighet),
// sortert billigst først (deretter tettest datapassform).
function velgKandidater(leverandor, bruker) {
  return ABONNEMENTER
    .filter(
      (p) =>
        p.leverandor === leverandor &&
        alderOk(p, bruker.alder) &&
        dekkerBehov(p, bruker.behovGb) &&
        dekkerHastighet(p, bruker.hastighetMbit)
    )
    .map((p) => ({ plan: p, pris: planPris(p, bruker.alder), prioritet: prioritetFor(p.id) }))
    .sort((a, b) => {
      if (a.pris !== b.pris) return a.pris - b.pris;
      if (effektivData(a.plan) !== effektivData(b.plan))
        return effektivData(a.plan) - effektivData(b.plan);
      return b.prioritet - a.prioritet; // siste tie-break (reservert)
    });
}

function velgPlan(leverandor, bruker) {
  return velgKandidater(leverandor, bruker)[0] || null;
}

// ---- Familierabatt (operatør-spesifikk) ---------------------
// Hver leverandør har sin egen struktur. valg = [{plan, pris}] der 'pris' er
// alderstilpasset listepris per SIM. Returnerer total husstandspris.

// Telenor-stil: hovedabonnent (dyreste kvalifiserte) betaler full pris, hvert
// ekstra familiemedlem på ubegrenset betaler en FAST medlemspris etter alder
// (voksen / under_30 / under_13). Ikke-kvalifiserte planer (fastdata): egen pris.
// Medlemmer kan ha mindre abo - da gjelder ikke familieprisen for dem.
// En plan kan overstyre medlemsprisen for et aldersledd via 'familie_medlemspris'
// (f.eks. Sikre: U13 betaler 249 som familiemedlem, mens vanlige ubegrenset
// faller tilbake på voksenprisen).
function medlemsprisForAlder(alder, mp, plan) {
  const planMp = (plan && plan.familie_medlemspris) || {};
  const pris = (ledd) => (planMp[ledd] != null ? planMp[ledd] : mp[ledd]);
  if (alder != null && alder < 13) return pris("under_13") ?? pris("voksen") ?? 0;
  if (alder != null && alder < 30) return pris("under_30") ?? pris("voksen") ?? 0;
  return pris("voksen") ?? 0;
}

// Effektiv pris PER PERSON for Telenor-modellen. Dette er ikke en samlet
// familierabatt, men en prisfordeling: hovedabonnenten (dyreste kvalifiserte)
// betaler full pris, mens hvert ekstra medlem på ubegrenset får en fast, lavere
// medlemspris etter alder (ekstra billig for yngre). Ikke-kvalifiserte planer
// (f.eks. fastdata) beholder sin egen pris. Returnerer en array i samme
// rekkefølge som 'valg'.
function medlemsprisFordeling(valg, regel) {
  const mp = regel.medlemspris || {};
  const kvalifisert = (v) =>
    girFamilierabatt(v.plan) &&
    (regel.gjelder_kun_ubegrenset ? v.plan.ubegrenset : true);

  const priser = valg.map((v) => v.pris);
  const kvalifIdx = valg
    .map((v, i) => (kvalifisert(v) ? i : -1))
    .filter((i) => i >= 0);
  if (kvalifIdx.length === 0) return priser;

  // Hovedabonnent = dyreste kvalifiserte plan.
  let hovedIdx = kvalifIdx[0];
  kvalifIdx.forEach((i) => {
    if (valg[i].pris > valg[hovedIdx].pris) hovedIdx = i;
  });

  // Medlemsprisen kan IKKE kombineres med aldersrabatt: når fordelingen er aktiv
  // (2+ ubegrenset) betaler hovedabonnenten ordinær pris (ingen aldersrabatt) og
  // øvrige fast medlemspris. Er det bare én ubegrenset, beholdes aldersrabatten.
  const fordelingAktiv = kvalifIdx.length >= 2;
  kvalifIdx.forEach((i) => {
    const v = valg[i];
    const ordinaer = v.plan.pris_per_sim;
    if (i === hovedIdx) {
      priser[i] = fordelingAktiv ? ordinaer : v.pris;
    } else {
      priser[i] = Math.min(ordinaer, medlemsprisForAlder(v.alder, mp, v.plan));
    }
  });
  return priser;
}

function familietotalMedlemFastpris(valg, regel) {
  return medlemsprisFordeling(valg, regel).reduce((s, p) => s + p, 0);
}

// Per-person visningspris for en leverandør. Telenor-modellen fordeler prisen
// direkte per person (differensierte priser, ingen samlet rabattlinje); øvrige
// modeller viser listepris per SIM, og en eventuell rabatt vises samlet.
function visningsPriser(leverandor, valg) {
  const regel = FAMILIERABATT[leverandor];
  if (regel && regel.modell === "familiemedlem_fastpris")
    return medlemsprisFordeling(valg, regel);
  return valg.map((v) => v.pris);
}

// Familierabatt-beløp (kr) for én plan som ikke-dyreste medlem. En plan kan ha
// sitt eget beløp ('familierabatt_kr', f.eks. egendefinerte abonnement), ellers
// brukes operatørens standard (ubegrenset vs. øvrige). Mangler begge -> 0.
function familierabattKrFor(p, regel) {
  if (p.familierabatt_kr != null) return p.familierabatt_kr;
  if (!regel) return 0;
  return p.ubegrenset ? regel.rabatt_kr_ubegrenset || 0 : regel.rabatt_kr_ovrige || 0;
}

// Dyreste-full-modell: dyreste SIM full pris, øvrige kvalifiserte får et rabatt-
// beløp per SIM (plan-eget beløp eller operatørstandard). Ungdoms-/juniorplaner
// (gir_familierabatt=false) kvalifiserer ikke. Maks 'maks_antall_med_rabatt' SIM
// får rabatt. Kombineres med aldersrabatt.
function familietotalDyresteFull(valg, regel) {
  const sortert = [...valg].sort((a, b) => b.pris - a.pris); // dyreste først
  const maks = (regel && regel.maks_antall_med_rabatt) ?? Infinity;

  let total = 0;
  let rabattGitt = 0;
  sortert.forEach((v, i) => {
    const rab = familierabattKrFor(v.plan, regel);
    // Dyreste full, plan som ikke kvalifiserer / uten rabattbeløp, eller utover taket.
    if (i === 0 || !girFamilierabatt(v.plan) || rab <= 0 || rabattGitt >= maks) {
      total += v.pris;
      return;
    }
    total += Math.max(0, v.pris - rab);
    rabattGitt++;
  });
  return total;
}

function familietotal(leverandor, valg) {
  const regel = FAMILIERABATT[leverandor];
  if (regel && regel.modell === "familiemedlem_fastpris")
    return familietotalMedlemFastpris(valg, regel);
  // Dyreste-full-modell brukes når operatøren har den, ELLER når en plan har et
  // eget familierabatt-beløp (egendefinerte abonnement, også hos operatører uten
  // egen rabattmodell som ice).
  const harPerPlan = valg.some((v) => v.plan.familierabatt_kr != null);
  if ((regel && regel.modell === "dyreste_full_plantype") || harPerPlan)
    return familietotalDyresteFull(valg, regel);
  return valg.reduce((s, v) => s + v.pris, 0); // ingen rabatt (f.eks. ice)
}

// ---- Per-leverandør husstandspris ---------------------------
// Finn kombinasjonen av per-bruker planvalg som gir lavest EFFEKTIV
// husstandspris. Effektiv = månedspris (etter familierabatt) minus den
// månedsfordelte produktrabatten (f.eks. Telia X: 500/1000 kr engangs / periode).
// Hver bruker har et lite kandidatsett; vi prøver alle kombinasjoner. Dette
// fanger to avveiinger samtidig: (1) billig plan uten familierabatt vs. litt
// dyrere plan som utløser familierabatt, og (2) en fastdata-plan vs. en litt
// dyrere Telia X som gir produktrabatt (kan lønne seg selv om behovet er mindre).
// 'total' er fortsatt den reelle månedsprisen; 'effektiv' brukes til å velge.
// Engangs produktrabatt (kr) for én plan: planens eget beløp hvis satt,
// ellers det globale kampanjebeløpet (0/500/1000). 0 hvis planen ikke
// kvalifiserer. Lar egendefinerte abonnement ha sin egen produktrabatt
// uavhengig av Telia X-kampanjen i menyen.
function produktrabattKrFor(plan, globalKr) {
  if (!plan.produktrabatt) return 0;
  return plan.produktrabatt_kr != null ? plan.produktrabatt_kr : globalKr || 0;
}
// Månedsfordelt produktrabatt for én plan.
function bonusPerMndFor(plan, globalKr) {
  return produktrabattKrFor(plan, globalKr) / (CONFIG.produktrabatt_periode_mnd || 12);
}
// Samlet engangs produktrabatt (kr) for et sett valg.
function produktrabattTotalKr(valg, globalKr) {
  return valg.reduce((s, v) => s + produktrabattKrFor(v.plan, globalKr), 0);
}

function besteHusstandsvalg(leverandor, sett, bonusKr) {
  const globalKr = bonusKr || 0;
  const antallKomb = sett.reduce((a, s) => a * s.length, 1);
  const evaluer = (valg) => {
    const total = familietotal(leverandor, valg);
    const bonus = valg.reduce((s, v) => s + bonusPerMndFor(v.plan, globalKr), 0);
    return { valg, total, effektiv: total - bonus };
  };

  // Sikkerhetsventil mot eksplosjon: for svært store husstander, fall tilbake
  // til noen få uniforme strategier (billigst per person / siste kandidat /
  // produktrabatt der mulig) i stedet for å prøve alle kombinasjoner.
  if (antallKomb > 4096) {
    const strategier = [
      sett.map((s) => s[0]),
      sett.map((s) => s[s.length - 1]),
      sett.map((s) => s.find((k) => k.plan.produktrabatt) || s[0]),
    ];
    return strategier
      .map(evaluer)
      .reduce((a, b) => (b.effektiv < a.effektiv ? b : a));
  }

  let beste = null;
  for (let mask = 0; mask < antallKomb; mask++) {
    let m = mask;
    const valg = sett.map((s) => {
      const v = s[m % s.length];
      m = Math.floor(m / s.length);
      return v;
    });
    const e = evaluer(valg);
    if (!beste || e.effektiv < beste.effektiv) beste = e;
  }
  return beste;
}

// Sikkerhets-oppgradering: når kunden prioriterer sikkerhet kan vi bytte planer
// til mer sikre alternativer (f.eks. Telenor Sikre Mobil) så lenge husstanden
// holder seg innenfor pristaket (pris-optimal total + tak × antall SIM).
// Oppgraderingene med størst sikkerhetsgevinst tas først.
function sikkerhetsoppgradering(leverandor, lister, brukere, prisOptimal, budsjettTotal) {
  const valg = prisOptimal.valg.map((v) => ({ ...v }));

  const oppgraderinger = lister
    .map((liste, i) => {
      const sikrest = [...liste].sort((a, b) => {
        const d = sikkerhetScore(b.plan) - sikkerhetScore(a.plan);
        return d !== 0 ? d : a.pris - b.pris;
      })[0];
      const gevinst = sikkerhetScore(sikrest.plan) - sikkerhetScore(valg[i].plan);
      return { i, til: { ...sikrest, alder: brukere[i].alder }, gevinst };
    })
    .filter((o) => o.gevinst > 0)
    .sort((a, b) => b.gevinst - a.gevinst);

  for (const o of oppgraderinger) {
    const forrige = valg[o.i];
    valg[o.i] = o.til;
    if (familietotal(leverandor, valg) > budsjettTotal) valg[o.i] = forrige; // over taket
  }
  return { valg, total: familietotal(leverandor, valg) };
}

// sikkerhetsBudsjett: absolutt total-tak (kr) for sikkerhetsoppgradering, eller
// null/undefined for ren pris-optimal sammensetning.
// bonusKr: global engangs produktrabatt per kvalifiserte plan (0 når av). Planer
// med eget 'produktrabatt_kr' bruker sitt eget beløp i stedet. Gjør at en litt
// dyrere Telia X (eller et egendefinert abo) kan velges når engangsrabatten gir
// lavere effektiv totalpris.
function beregnLeverandor(leverandor, brukere, sikkerhetsBudsjett, bonusKr) {
  const lister = brukere.map((b) => velgKandidater(leverandor, b));

  // Kan ikke betjene alle (f.eks. noen krever fri data, leverandøren har ikke).
  if (lister.some((l) => l.length === 0)) {
    return { leverandor, dekkerAlle: false };
  }

  // Per bruker: et lite kandidatsett som betyr noe for optimeringen:
  // (1) billigste dekkende plan, (2) billigste familierabatt-kvalifiserte plan,
  // og (3) billigste produktrabatt-plan (Telia X) når en kampanje er aktiv – selv
  // om brukeren egentlig klarer seg med mindre, kan engangsrabatten gjøre den
  // billigere effektivt. Øvrige planer er aldri optimale og utelates.
  const sett = lister.map((liste, i) => {
    const kand = [liste[0]];
    const leggTil = (k) => {
      if (k && !kand.some((x) => x.plan.id === k.plan.id)) kand.push(k);
    };
    leggTil(liste.find((k) => girFamilierabatt(k.plan)));
    leggTil(liste.find((k) => k.plan.familierabatt_kr != null)); // egen familierabatt
    // Produktrabatt-plan som kandidat når den gir et faktisk beløp (global
    // kampanje på, eller planen har eget produktrabatt_kr).
    leggTil(liste.find((k) => produktrabattKrFor(k.plan, bonusKr) > 0));
    kand.forEach((k) => (k.alder = brukere[i].alder)); // trengs for medlemspris (Telenor)
    return kand;
  });

  const prisOptimal = besteHusstandsvalg(leverandor, sett, bonusKr);

  // Med et sikkerhetsbudsjett kan vi oppgradere planer (f.eks. til Telenor Sikre
  // Mobil) opp til budsjettet; ellers pris-optimalt.
  let valg = prisOptimal.valg;
  let total = prisOptimal.total;
  if (sikkerhetsBudsjett != null) {
    const oppg = sikkerhetsoppgradering(leverandor, lister, brukere, prisOptimal, sikkerhetsBudsjett);
    valg = oppg.valg;
    total = oppg.total;
  }

  // Visningspris per person. For Telenor fordeles medlemsprisen direkte (hver
  // person har sin egen, ev. lavere pris) – da blir det ingen samlet rabattlinje.
  // For Telia vises listepris per SIM og differansen som en samlet familierabatt.
  const visPriser = visningsPriser(leverandor, valg);
  valg.forEach((v, i) => (v.visPris = visPriser[i]));
  const sumVis = visPriser.reduce((s, p) => s + p, 0);

  // Antall planer som kvalifiserer for produktrabatt (f.eks. Telia X), og samlet
  // engangsbeløp. Beløpet kommer fra valgt kampanje (0/500/1000) eller planens
  // eget produktrabatt_kr for egendefinerte abonnement.
  const antallBonus = valg.filter((v) => v.plan.produktrabatt).length;
  const bonusTotalKr = produktrabattTotalKr(valg, bonusKr || 0);

  return {
    leverandor,
    dekkerAlle: true,
    total,
    prisOptimalTotal: prisOptimal.total, // billigste mulige hos denne operatøren
    familierabatt: sumVis - total,
    antallBonus, // antall abonnement som utløser produktrabatt
    bonusTotalKr, // samlet engangs produktrabatt (kr) for husstanden
    brukerPlaner: valg, // [{plan, pris}] i samme rekkefølge som brukere
    dekning: dekningScore(leverandor),
    sikkerhet: valg.reduce((s, v) => s + sikkerhetScore(v.plan), 0) / valg.length,
  };
}

// ---- Hovedfunksjon ------------------------------------------
/**
 * @param {Array} brukere  - [{ alder: number|null, behovGb: number|null }]
 * @param {number|null} dagensTotal - dagens totalpris for husstanden
 * @param {Object|null} preferanse - { leverandor, modus } der modus er
 *        "foretrekk" (vinner innenfor foretrekk_margin_kr av billigste) eller
 *        "krev" (anbefales alltid hvis den kan dekke kunden).
 * @param {number} produktrabattKr - engangsrabatt per kvalifiserte plan
 *        (0/500/1000). Fordeles over CONFIG.produktrabatt_periode_mnd og
 *        trekkes fra i rangeringen (ikke i vist månedspris).
 * @param {Object} prioritet - { vekter: {pris,dekning,sikkerhet} (sum 1),
 *        sikkerhetViktig: bool, sikkerhetNiva: 0-1 }. Vektene styrer den vektede
 *        totalscoren. sikkerhetViktig (sikkerhet Høy/Svært høy) tillater plan-
 *        oppgradering til sikrere planer. sikkerhetNiva er det ABSOLUTTE
 *        sikkerhetsnivået (uavhengig av de andre dimensjonene) og styrer hvor
 *        stort sikkerhetsbudsjettet er (CONFIG.sikkerhet_premie_maks_kr per SIM)
 *        – slik at f.eks. dekning satt høyt ikke endrer sikkerhetsoppgraderingen.
 */
function beregnHusstand(brukere, dagensTotal, preferanse, produktrabattKr, prioritet, ekskluder) {
  if (!brukere.length) return { ok: false, grunn: "ingen_brukere" };
  const vekt = (prioritet && prioritet.vekter) || { pris: 1, dekning: 0, sikkerhet: 0 };
  const sikkerhetViktig = !!(prioritet && prioritet.sikkerhetViktig);

  const periode = CONFIG.produktrabatt_periode_mnd || 12;
  // Global engangs produktrabatt per kvalifiserte plan (0/500/1000). Planer med
  // eget produktrabatt_kr bruker sitt eget beløp. Brukes både til å velge planer
  // (kan lønne seg å sette en fastdata-bruker på Telia X) og til den effektive
  // prisen i rangeringen. Amortiseringen bruker husstandens samlede engangsbeløp.
  const amortisert = (lev) => (lev.bonusTotalKr || 0) / periode;

  // Ekskluder dagens operatør (hvis valgt og det er en av våre). Faller tilbake til
  // fullt sett dersom ekskluderingen fjerner all dekning.
  let operatorer =
    ekskluder && VARE_LEVERANDORER.includes(ekskluder)
      ? VARE_LEVERANDORER.filter((l) => l !== ekskluder)
      : VARE_LEVERANDORER;

  // Pass 1: pris-optimal sammensetning per leverandør (uten sikkerhetsoppgradering)
  // for å finne det globale prisgulvet.
  let pass1 = operatorer
    .map((l) => beregnLeverandor(l, brukere, null, produktrabattKr))
    .filter((x) => x.dekkerAlle);
  if (!pass1.length && operatorer.length < VARE_LEVERANDORER.length) {
    operatorer = VARE_LEVERANDORER; // ekskludering fjernet all dekning -> ignorer
    pass1 = operatorer
      .map((l) => beregnLeverandor(l, brukere, null, produktrabattKr))
      .filter((x) => x.dekkerAlle);
  }
  if (!pass1.length) return { ok: false, grunn: "ingen_dekning" };
  const minEffektiv = Math.min(...pass1.map((l) => l.total - amortisert(l)));
  const nSim = brukere.length;

  // Absolutt sikkerhetsnivå (0-1) kunden har satt, uavhengig av de andre
  // dimensjonene. Brukes til sikkerhetsbudsjettet slik at det IKKE krymper når
  // f.eks. dekning settes høyt (som ellers ville skrudd sikkerhetsoppgraderingen
  // av/på og gitt ulogiske bytter).
  const sikkerhetNiva =
    prioritet && prioritet.sikkerhetNiva != null ? prioritet.sikkerhetNiva : 0;

  // Generelt pristak: hvor mye dyrere anbefalingen kan være enn billigste når
  // pris er nedprioritert (skalerer med 1 − prisvekt).
  const generellPremiePerSim =
    (CONFIG.prioritet_premie_maks_kr || 0) * (1 - (vekt.pris || 0));

  // Sikkerhetsbudsjett: hvor mye ekstra per SIM en sikkerhetsoppgradering kan
  // koste. Skalerer med det absolutte sikkerhetsnivået (ikke med vekten/dekning),
  // så «Svært høy» gir nok rom til Telenor Sikre uansett øvrige innstillinger.
  const sikkPremiePerSim = sikkerhetViktig
    ? (CONFIG.sikkerhet_premie_maks_kr || 0) * sikkerhetNiva
    : 0;

  // Anbefalingstaket må romme en berettiget sikkerhetsoppgradering, ellers ville
  // en oppgradert (men «for dyr») operatør blitt kastet ut av taket igjen.
  const premiePerSim = Math.max(generellPremiePerSim, sikkPremiePerSim);
  const capEffektiv = minEffektiv + premiePerSim * nSim;

  // Pass 2: endelig beregning. Når sikkerhet er viktig kan planer oppgraderes opp
  // til sikkerhetsbudsjettet, så de sikreste planene velges uten å sprenge taket.
  const sikkBudsjett = sikkerhetViktig ? minEffektiv + sikkPremiePerSim * nSim : null;
  let dekkende = operatorer
    .map((l) => beregnLeverandor(l, brukere, sikkBudsjett, produktrabattKr))
    .filter((x) => x.dekkerAlle);

  dekkende.forEach((lev) => (lev.effektivPris = lev.total - amortisert(lev)));

  // Billigste etter ren månedspris (for produktrabatt-deteksjon).
  const rawBilligste = dekkende.reduce((a, b) => (b.total < a.total ? b : a));

  // Vektet totalscore: pris-score 0-100 (billigste effektive = 100), dekning/
  // sikkerhet 0-100 fra data. Vektene kommer fra kundens prioritetsnivåer.
  dekkende.forEach((lev) => {
    const prisScore = lev.effektivPris > 0 ? (100 * minEffektiv) / lev.effektivPris : 100;
    lev.prisScore = prisScore;
    lev.vektetScore =
      (vekt.pris || 0) * prisScore +
      (vekt.dekning || 0) * lev.dekning +
      (vekt.sikkerhet || 0) * lev.sikkerhet;
  });

  // Sorter på vektet score; ved lik score (f.eks. dekning prioritert og to
  // operatører har samme dekning) vinner den billigste effektive prisen.
  dekkende = dekkende
    .slice()
    .sort((a, b) => b.vektetScore - a.vektetScore || a.effektivPris - b.effektivPris);

  // Anbefalt: høyest vektet score innenfor det dynamiske pristaket.
  const innenforTak = (lev) => lev.effektivPris <= capEffektiv;
  let anbefalt = dekkende.find(innenforTak) || dekkende[0];

  // Kundepreferanse: flytt foretrukken operatør til topp hvis kriteriet oppfylles.
  let preferanseBrukt = null;
  if (preferanse && preferanse.leverandor) {
    const pref = dekkende.find((l) => l.leverandor === preferanse.leverandor);
    if (pref && pref !== anbefalt) {
      const margin = CONFIG.foretrekk_margin_kr || 0;
      const oppfyller =
        preferanse.modus === "krev" || pref.total <= anbefalt.total + margin;
      if (oppfyller) {
        anbefalt = pref;
        preferanseBrukt = preferanse.leverandor;
      }
    }
  }

  dekkende = [anbefalt, ...dekkende.filter((l) => l !== anbefalt)];

  // Hva avgjorde valget (for visning).
  const produktrabattBrukt =
    !preferanseBrukt &&
    (produktrabattKr || 0) > 0 &&
    (anbefalt.antallBonus || 0) > 0 &&
    anbefalt.total > rawBilligste.total;
  const prioritetBrukt =
    !preferanseBrukt &&
    !produktrabattBrukt &&
    anbefalt.leverandor !== rawBilligste.leverandor;

  return {
    ok: true,
    leverandorer: dekkende, // anbefalt først, øvrige etter vektet score
    anbefalt,
    dagensTotal,
    preferanseBrukt,
    produktrabattBrukt,
    prioritetBrukt,
  };
}

// ---- Visningshjelpere ---------------------------------------
function kr(n) {
  return Math.round(n).toLocaleString("nb-NO") + " kr";
}

function dataTekst(p) {
  return p.ubegrenset ? "Fri data" : p.data_gb + " GB";
}

function behovTekst(behovGb) {
  return behovGb === null ? "fri data" : behovGb + " GB";
}

function hastighetTekst(p) {
  return planHastighet(p) + " Mbit";
}

// ---- Tilbudskoder (salgssystem) -----------------------------
// Bygger lista over koder selgeren må legge inn for en anbefaling.
// brukerPlaner = lev.brukerPlaner = [{plan, pris, alder}] i bruker-rekkefølge.
// Regler (se data/koder.json):
//  - Hovedkode pr. abo fra SALGSKODER.
//  - ICE-familie: legges pr. ice-abo når det er >=2 ice-salg (peak: SPK26ICEFAM,
//    ellers SICEFAMILIE).
//  - Telia X under Sommerpeak: SPK26TEXTILB pr. X-abo + SPK26TEFAM familie fra og
//    med X-abo nr. 2.
function byggTilbudskoder(brukerPlaner) {
  const iceFamilieAktiv =
    brukerPlaner.filter((v) => v.plan.leverandor === "ice").length >= 2;
  let teliaXTeller = 0;
  let sikreKodeLagt = false; // Sikkerhetssenter-koder legges kun én gang per kunde.

  // Familiefordelte priser (Telenor-modellen) – brukes til å avgjøre om en U13 på
  // Sikre faktisk mottar U13-familieprisen (249) og dermed skal ha egen salgskode.
  const lev = brukerPlaner.length ? brukerPlaner[0].plan.leverandor : null;
  const famRegel = FAMILIERABATT[lev];
  const medlemspriser =
    famRegel && famRegel.modell === "familiemedlem_fastpris"
      ? medlemsprisFordeling(brukerPlaner, famRegel)
      : null;

  const rader = brukerPlaner.map((v, i) => {
    const id = v.plan.id;
    let def = SALGSKODER[id] || null;
    // U13 på Sikre Mobil som mottar familieprisen (U13-rabatt) får egen salgskode.
    const u13SikreRabatt =
      id === "telenor_sikre_mobil" &&
      v.alder != null && v.alder < 13 &&
      medlemspriser && famRegel &&
      medlemspriser[i] === medlemsprisForAlder(v.alder, famRegel.medlemspris || {}, v.plan);
    if (u13SikreRabatt && SALGSKODER.telenor_sikre_mobil_u13) {
      def = SALGSKODER.telenor_sikre_mobil_u13;
    }
    const navnVis = u13SikreRabatt ? v.plan.navn + " (U13)" : v.plan.navn;
    const koder = def
      ? [{ kode: def.kode, tekst: navnVis, type: "hoved" }]
      : [{ kode: "(mangler kode)", tekst: navnVis, type: "mangler" }];

    // ICE familieprovisjon – pr. abo når >=2 ice-salg.
    if (v.plan.leverandor === "ice" && iceFamilieAktiv) {
      const ek = PEAK ? EKSTRAKODER.ice_familie_peak : EKSTRAKODER.ice_familie;
      if (ek) koder.push({ kode: ek.kode, tekst: ek.tekst, type: "ekstra" });
    }

    // Telenor Sikre – sikkerhetssenter-koder legges kun én gang per kunde
    // (uavhengig av hvor mange Sikre-abo som selges), + ekstrastøtte under peak.
    if (id === "telenor_sikre_mobil" && !sikreKodeLagt) {
      sikreKodeLagt = true;
      const ts = EKSTRAKODER.telenor_sikkerhet;
      if (ts) koder.push({ kode: ts.kode, tekst: ts.tekst, type: "ekstra" });
      if (PEAK) {
        const tsp = EKSTRAKODER.telenor_sikkerhet_peak;
        if (tsp) koder.push({ kode: tsp.kode, tekst: tsp.tekst, type: "ekstra" });
      }
    }

    // Telia X – peakkoder kun under Sommerpeak.
    const erTeliaX = TELIA_X_IDS.includes(id);
    if (erTeliaX) {
      teliaXTeller++;
      if (PEAK) {
        const ps = EKSTRAKODER.telia_peaksupport;
        if (ps) koder.push({ kode: ps.kode, tekst: ps.tekst, type: "ekstra" });
        // Familie gjelder fra og med abo nr. 2.
        if (teliaXTeller >= 2) {
          const fam = EKSTRAKODER.telia_familie_peak;
          if (fam) koder.push({ kode: fam.kode, tekst: fam.tekst, type: "ekstra" });
        }
      }
    }

    return {
      person: i + 1,
      planNavn: v.plan.navn,
      leverandor: v.plan.leverandor,
      binding: def ? def.binding : "—",
      koder,
    };
  });

  // Samlet kodeliste med antall, i den rekkefølgen kodene først dukker opp.
  const tellinger = new Map();
  rader.forEach((r) =>
    r.koder.forEach((k) => {
      if (k.type === "mangler") return;
      const t = tellinger.get(k.kode);
      if (t) t.antall++;
      else tellinger.set(k.kode, { kode: k.kode, tekst: k.tekst, antall: 1 });
    })
  );

  return { rader, samlet: [...tellinger.values()], peak: PEAK };
}
