/* ============================================================
   app.js - grensesnitt og kobling mot kalkulator.js
   Per-bruker-modell: hver person har egen alder og databehov.
   Live oppdatering ved hver endring -> minst mulig klikking.
   ============================================================ */

// Standard person for nye rader / ny kunde.
function nyBruker() {
  return { alderValg: "voksen", data: "fri", hastighet: "vanlig", dataGb: 15 };
}

// Escaper tekst som settes inn via innerHTML (f.eks. egendefinerte abonnements-
// navn fra selgeren), så spesialtegn (< > & ") ikke bryter eller injiserer HTML.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const state = {
  // Når på: skriv inn nøyaktig databehov i GB per person (i stedet for kategori).
  noyaktigData: false,
  // Hver bruker: { alderValg, data, hastighet, dataGb } (data = kategori, dataGb = eksakt GB)
  brukere: [nyBruker()],
  // Kundeprioritet per dimensjon (indeks i NIVAER). Standard: pris svært viktig, resten ikke viktig.
  prioritet: { pris: 3, dekning: 0, sikkerhet: 0 },
  // Vis prioritet-panelet (kundepreferanser utover pris) på hjemskjermen. Standard: på.
  visPrioritet: true,
  // Ekskluder dagens operatør fra anbefalingen (avanserte innstillinger). Standard: på.
  ekskluderDagens: true,
};

// Største operatører i Norge. Kunden kan ha hvem som helst - brukes som
// sammenligningsgrunnlag. 'nett' er nyttig kontekst for dekning senere.
const OPERATORER = [
  {
    gruppe: "Egne nett (vårt utvalg)",
    operatorer: [
      { navn: "Telenor", nett: "Telenor" },
      { navn: "Telia", nett: "Telia" },
      { navn: "ice", nett: "ice" },
    ],
  },
  {
    gruppe: "På Telenor-nettet",
    operatorer: [
      { navn: "Talkmore", nett: "Telenor" },
      { navn: "Saga Mobil", nett: "Telenor" },
      { navn: "Lycamobile", nett: "Telenor" },
      { navn: "Happybytes", nett: "Telenor" },
    ],
  },
  {
    gruppe: "På Telia-nettet",
    operatorer: [
      { navn: "OneCall", nett: "Telia" },
      { navn: "Chilimobil", nett: "Telia" },
      { navn: "MyCall", nett: "Telia" },
      { navn: "Release", nett: "Telia" },
      { navn: "Fjordkraft Mobil", nett: "Telia" },
      { navn: "NorgesEnergi Mobil", nett: "Telia" },
    ],
  },
  {
    gruppe: "Annet",
    operatorer: [{ navn: "Annen / vet ikke", nett: null }],
  },
];

// Merkevare-stil per leverandør (farge + logo) for den tilpassede anbefalingen.
const MERKEVARE = {
  Telenor: { bg1: "#0072CE", bg2: "#00B5F0", accent: "#9fe6ff", merkeTekst: "#06325c", logo: "assets/telenor-logo.svg", logoH: 42 },
  Telia:   { bg1: "#7A1FB8", bg2: "#A93EE6", accent: "#e6c9fb", merkeTekst: "#3d0e63", logo: "assets/telia-logo.png", logoH: 26 },
  ice:     { bg1: "#16284e", bg2: "#27437a", accent: "#FFB900", merkeTekst: "#3a2a00", logo: "assets/ice-logo.svg", logoH: 32 },
};
const MERKE_DEFAULT = { bg1: "#00733e", bg2: "#015e33", accent: "#89bb33", merkeTekst: "#0d1a56", logo: null, logoH: 0 };

// Kundeprioritet: hver dimensjon får et nivå (indeks i NIVAER). Nivå -> poeng,
// poeng normaliseres til vekter for den vektede totalscoren. "Svært høy" teller
// klart mest; "Lav" = 0 poeng = teller ikke (dimensjonen påvirker ikke valget).
// Er alt satt til Lav, faller vi tilbake til ren pris (se prioritetTilVekter).
const NIVAER = [
  { label: "Ikke viktig", poeng: 0 },
  { label: "Litt viktig", poeng: 3 },
  { label: "Viktig", poeng: 6 },
  { label: "Svært viktig", poeng: 10 },
];
const PRIORITET_DIMS = [
  { key: "pris", navn: "Pris" },
  { key: "dekning", navn: "Dekning" },
  { key: "sikkerhet", navn: "Sikkerhet" },
];
// Sikkerhet regnes som "viktig" (tillater plan-oppgradering) fra og med Høy.
const SIKKERHET_VIKTIG_FRA = 2;

// ---- Bygg leverandør-dropdown -------------------------------
function byggLeverandorer() {
  const sel = document.getElementById("leverandor");
  sel.innerHTML = "";
  // Tomt standardvalg – ingen leverandør valgt før selgeren velger.
  const tom = document.createElement("option");
  tom.value = "";
  tom.textContent = "— Velg leverandør —";
  sel.appendChild(tom);
  OPERATORER.forEach((g) => {
    const og = document.createElement("optgroup");
    og.label = g.gruppe;
    g.operatorer.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.navn;
      opt.textContent = o.navn;
      if (o.nett) opt.dataset.nett = o.nett;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

// ---- Bygg person-liste --------------------------------------
function renderBrukere() {
  const wrap = document.getElementById("brukere");
  wrap.innerHTML = "";

  state.brukere.forEach((b, i) => {
    const alderOpts = Object.entries(ALDER_VALG)
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k === b.alderValg ? "selected" : ""}>${v.label}</option>`
      )
      .join("");
    const dataOpts = Object.entries(DATA_VALG)
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k === b.data ? "selected" : ""}>${v.label}</option>`
      )
      .join("");
    const hastOpts = Object.entries(HASTIGHET_VALG)
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k === b.hastighet ? "selected" : ""}>${v.label}</option>`
      )
      .join("");

    const row = document.createElement("div");
    row.className = "bruker";
    row.innerHTML = `
      <div class="bruker-topp">
        <span>Person ${i + 1}</span>
        ${
          state.brukere.length > 1
            ? `<button type="button" class="fjern" data-i="${i}" aria-label="Fjern person">✕</button>`
            : ""
        }
      </div>
      <div class="bruker-rad">
        <div class="mini">
          <label>Aldersgruppe</label>
          <select class="alder" data-i="${i}">${alderOpts}</select>
        </div>
        <div class="mini vid">
          <label>Data i dag / behov${state.noyaktigData ? " (GB)" : ""}</label>
          ${
            state.noyaktigData
              ? `<input type="number" class="dataGb" data-i="${i}" min="0" step="1" inputmode="numeric" value="${b.dataGb}" placeholder="f.eks. 19" />`
              : `<select class="data" data-i="${i}">${dataOpts}</select>`
          }
        </div>
        <div class="mini">
          <label>Hastighet</label>
          <select class="hastighet" data-i="${i}">${hastOpts}</select>
        </div>
      </div>`;
    wrap.appendChild(row);
  });

  // Lyttere (oppdaterer kun resultatet, ikke hele lista -> beholder fokus)
  wrap.querySelectorAll(".alder").forEach((el) =>
    el.addEventListener("change", (e) => {
      state.brukere[e.target.dataset.i].alderValg = e.target.value;
      oppdater();
    })
  );
  wrap.querySelectorAll(".data").forEach((el) =>
    el.addEventListener("change", (e) => {
      state.brukere[e.target.dataset.i].data = e.target.value;
      oppdater();
    })
  );
  wrap.querySelectorAll(".dataGb").forEach((el) =>
    el.addEventListener("input", (e) => {
      state.brukere[e.target.dataset.i].dataGb = e.target.value;
      oppdater();
    })
  );
  wrap.querySelectorAll(".hastighet").forEach((el) =>
    el.addEventListener("change", (e) => {
      state.brukere[e.target.dataset.i].hastighet = e.target.value;
      oppdater();
    })
  );
  wrap.querySelectorAll(".fjern").forEach((el) =>
    el.addEventListener("click", (e) => {
      state.brukere.splice(Number(e.target.dataset.i), 1);
      renderBrukere();
      oppdater();
    })
  );
}

// ---- Les input ----------------------------------------------
function lesHusstand() {
  const prisRaw = document.getElementById("dagensPris").value.trim();
  const levSel = document.getElementById("leverandor");
  const valgt = levSel.options[levSel.selectedIndex];

  const brukere = state.brukere.map((b) => ({
    alder: ALDER_VALG[b.alderValg].alder,
    alderLabel: ALDER_VALG[b.alderValg].label,
    behovGb: state.noyaktigData ? Number(b.dataGb) || 0 : DATA_VALG[b.data].gb,
    hastighetMbit: HASTIGHET_VALG[b.hastighet].min_mbit,
    hastighetLabel: HASTIGHET_VALG[b.hastighet].label,
  }));

  return {
    leverandor: levSel.value,
    nett: valgt ? valgt.dataset.nett || null : null,
    dagensPris: prisRaw === "" ? null : Number(prisRaw),
    brukere,
  };
}

// Siste husstandsresultat – grunnlag for tilbud/kode-vinduet (alle leverandører).
let sisteResultat = null;

// «Ny kunde»: tøm alt kundespesifikt (personer, alder/behov, dagens pris og
// leverandør, kundeprioritet) for å starte rent på neste kunde. Beholder
// innstillinger som ikke gjelder kunden: priser, Sommerpeak, lokal dekning og
// burgermeny-valg (produktrabatt-kampanje, preferanse, toggles).
function nyKunde() {
  state.brukere = [nyBruker()];
  state.prioritet = { pris: 3, dekning: 0, sikkerhet: 0 };
  document.getElementById("dagensPris").value = "";
  document.getElementById("leverandor").selectedIndex = 0;
  renderBrukere();
  renderPrioritet();
  oppdater();
  visVisning("input");
}

// ---- Kundeprioritet -----------------------------------------
function renderPrioritet() {
  const wrap = document.getElementById("prioritetRader");
  wrap.innerHTML = PRIORITET_DIMS.map(
    (d) => `
      <div class="prioritet-rad">
        <span class="prioritet-navn">${d.navn}</span>
        <div class="prioritet-niva" data-dim="${d.key}">
          ${NIVAER.map(
            (n, i) =>
              `<button type="button" data-niva="${i}" class="${
                state.prioritet[d.key] === i ? "aktiv" : ""
              }">${n.label}</button>`
          ).join("")}
        </div>
      </div>`
  ).join("");
  oppdaterPrioritetSammendrag();
}

function oppdaterPrioritetSynlighet() {
  document.getElementById("prioritetFelt").hidden = !state.visPrioritet;
}

function oppdaterPrioritetSammendrag() {
  // Vis hver dimensjon som en boble/pille (Pris · Høy), med nivå som data-attr
  // slik at CSS kan tone aktive (over Lav) tydeligere enn de som ikke teller.
  const piller = PRIORITET_DIMS.map(
    (d) =>
      `<span class="prioritet-pille" data-niva="${state.prioritet[d.key]}"><b>${d.navn}</b> · ${NIVAER[state.prioritet[d.key]].label}</span>`
  );
  document.getElementById("prioritetSammendrag").innerHTML = piller.join("");
}

// Gjør prioritetsnivåene om til normaliserte vekter + sikkerhetViktig-flagg.
function prioritetTilVekter() {
  const poeng = (dim) => NIVAER[state.prioritet[dim]].poeng;
  const sum = poeng("pris") + poeng("dekning") + poeng("sikkerhet");
  const maksPoeng = NIVAER[NIVAER.length - 1].poeng;
  // Alt satt til Lav (sum 0) -> ren pris, så vi ikke deler på 0 og slik at
  // «ingenting er viktig» gir billigste alternativ.
  const vekter =
    sum > 0
      ? {
          pris: poeng("pris") / sum,
          dekning: poeng("dekning") / sum,
          sikkerhet: poeng("sikkerhet") / sum,
        }
      : { pris: 1, dekning: 0, sikkerhet: 0 };
  return {
    vekter,
    sikkerhetViktig: state.prioritet.sikkerhet >= SIKKERHET_VIKTIG_FRA,
    // Absolutt sikkerhetsnivå (0-1), uavhengig av de andre dimensjonene. Styrer
    // sikkerhetsbudsjettet i kalkulatoren (Svært høy = 1.0 = fullt budsjett).
    sikkerhetNiva: poeng("sikkerhet") / maksPoeng,
  };
}

// Selgende anbefalingstekst som knytter operatørens styrke (dekning/sikkerhet) til
// god pris og kundens prioritet. Nevner dimensjoner satt høyt (Høy/Svært høy), og
// sier "best" når operatøren faktisk topper dimensjonen, ellers "sterk".
// Returnerer "" når panelet er av eller ingen dimensjon er prioritert høyt.
function prioritetSalgsTekst(a, res) {
  if (!state.visPrioritet) return "";
  const TERSKEL = 2; // Høy eller Svært høy
  const dims = [
    { key: "sikkerhet", navn: "sikkerhet", verdi: (l) => l.sikkerhet },
    { key: "dekning", navn: "dekning", verdi: (l) => l.dekning },
  ]
    .filter((d) => state.prioritet[d.key] >= TERSKEL)
    .sort((x, y) => state.prioritet[y.key] - state.prioritet[x.key]);
  if (!dims.length) return "";

  const fraser = dims.map((d) => {
    const maks = Math.max(...res.leverandorer.map((l) => d.verdi(l)));
    let niva = d.verdi(a) >= maks ? "best" : "sterk";
    // Telia skal aldri krediteres «best sikkerhet» – Telenor (Sikre) er sterkere.
    if (d.key === "sikkerhet" && a.leverandor === "Telia" && niva === "best") niva = "høy";
    return `${niva} ${d.navn}`;
  });
  const liste = fraser.length === 2 ? `${fraser[0]} og ${fraser[1]}` : fraser[0];
  return `${a.leverandor} leverer ${liste} til en god pris – nettopp det som var viktigst for kunden.`;
}

// ---- Lokal dekning (avanserte innstillinger) ----------------
function renderDekning() {
  const wrap = document.getElementById("dekningRader");
  wrap.innerHTML = VARE_LEVERANDORER.map(
    (lev) => `
      <div class="dekning-rad">
        <span class="dekning-navn">${lev}</span>
        <input type="range" min="0" max="100" step="1" value="${gjeldendeDekning(lev)}" data-lev="${lev}" class="dekning-slider" aria-label="Dekning ${lev}" />
        <span class="dekning-verdi" data-lev="${lev}">${gjeldendeDekning(lev)}</span>
      </div>`
  ).join("");
  document.getElementById("nullstillDekning").disabled = !harLokalDekning();
}

// ---- Rendering ----------------------------------------------
function oppdater() {
  const h = lesHusstand();
  // Kundepreferanse (fra hamburger-menyen): Foretrekk eller Krev valgt operatør.
  const prefOperator = document.getElementById("prefOperator").value;
  const prefModus =
    document.querySelector("#prefModus .seg-btn.aktiv")?.dataset.modus || "foretrekk";
  const preferanse = prefOperator ? { leverandor: prefOperator, modus: prefModus } : null;
  // Produktrabatt per Telia X: manuelt beløp (standard 500, 0 = av, maks 1000).
  // Vektes inn i rangeringen (fordelt over CONFIG.produktrabatt_periode_mnd).
  const produktrabattKr = rabattBelopKr();
  // Skal produktrabatten påvirke selve anbefalingen? Av = vises fortsatt, men
  // teller ikke i hvilken operatør/plan som anbefales.
  const rabattIRangering = document.getElementById("rabattIRangering").checked;
  // Kundeprioritet (nivåer pr. dimensjon) -> vekter + sikkerhetViktig. Når
  // kundepreferanser utover pris er skrudd av: ren pris.
  const prioritet = state.visPrioritet
    ? prioritetTilVekter()
    : { vekter: { pris: 1, dekning: 0, sikkerhet: 0 }, sikkerhetViktig: false, sikkerhetNiva: 0 };
  // Ekskluder dagens operatør hvis valgt (avanserte innstillinger).
  const ekskluder = state.ekskluderDagens ? h.leverandor : null;
  const res = beregnHusstand(h.brukere, h.dagensPris, preferanse, produktrabattKr, prioritet, ekskluder, rabattIRangering);
  const el = document.getElementById("resultat");

  if (!res.ok) {
    sisteResultat = null;
    el.innerHTML =
      '<div class="melding">Ingen av leverandørene Telenor, Telia eller ice kan dekke alle personenes databehov samtidig. Juster databehovet, eller velg «Fri data» kun der det faktisk trengs.</div>';
    return;
  }

  const a = res.anbefalt;
  sisteResultat = res;
  const antall = h.brukere.length;
  let html = "";

  // Anbefalingskort – tilpasset operatørens merkevare (farge + logo + fordeler)
  const mv = MERKEVARE[a.leverandor] || MERKE_DEFAULT;
  const fordeler = fordelerFor(a.leverandor);
  const utmerkelser = utmerkelserFor(a.leverandor);
  const salgstekst = prioritetSalgsTekst(a, res);
  // Lenke til Telenor Sikre når anbefalingen faktisk inneholder Sikre Mobil.
  const harSikre = a.brukerPlaner.some((v) => v.plan.id === "telenor_sikre_mobil");
  // Lenke til iceFamilie når anbefalingen har 2+ ice-abo (samme vilkår som familiekoden).
  const harIceFamilie =
    a.brukerPlaner.filter((v) => v.plan.leverandor === "ice").length >= 2;
  // Lenke til Telia Trygghet når Telia anbefales.
  const harTeliaTrygghet = a.leverandor === "Telia";
  html += `
    <div class="anbefaling" style="background:linear-gradient(135deg, ${mv.bg1} 0%, ${mv.bg2} 100%); box-shadow:0 8px 26px ${mv.bg1}59;">
      ${mv.logo ? `<img class="anbefaling-logo" src="${mv.logo}" alt="${a.leverandor}" style="height:${mv.logoH}px" />` : ""}
      <span class="merke" style="background:${mv.accent}; color:${mv.merkeTekst};">VÅR ANBEFALING</span>
      <div class="navn">Bytt til ${a.leverandor}</div>
      <div class="lev">${antall} ${antall === 1 ? "person" : "personer"} · tilpasset hver bruker${
        res.preferanseBrukt ? " · ✦ kundepreferanse" : ""
      }</div>
      ${utmerkelser
        .map((u) => {
          const tekst = typeof u === "string" ? u : u.tekst;
          const url = typeof u === "object" ? u.url : null;
          return url
            ? `<a class="utmerkelse utmerkelse-lenke" href="${url}" target="_blank" rel="noopener">🏆 ${tekst} <span class="utmerkelse-pil">↗</span></a>`
            : `<div class="utmerkelse">🏆 ${tekst}</div>`;
        })
        .join("")}
      ${salgstekst ? `<div class="prioritet-note">✦ ${salgstekst}</div>` : ""}
      <div class="pris">${kr(a.total)} <small>/mnd totalt</small></div>
      ${a.familierabatt > 0 ? `<div class="detalj">Inkl. familierabatt −${kr(a.familierabatt)}</div>` : ""}
      ${
        a.bonusTotalKr > 0 && a.antallBonus > 0
          ? `<div class="bytterabatt-linje">🎁 + ${kr(a.bonusTotalKr)} produktrabatt <small>(engangs · ${a.antallBonus} ${a.antallBonus === 1 ? "abonnement" : "abonnementer"})</small></div>`
          : ""
      }
      ${
        fordeler.length
          ? `<div class="fordeler">
               <div class="fordeler-tittel">Fordeler hos ${a.leverandor}</div>
               <ul>${fordeler.map((f) => `<li>${f}</li>`).join("")}</ul>
             </div>`
          : ""
      }
      ${
        harSikre
          ? `<a class="sikre-lenke" href="https://www.telenor.no/sikre/" target="_blank" rel="noopener">Les mer om Telenor Sikre <span class="utmerkelse-pil">↗</span></a>`
          : ""
      }
      ${
        harIceFamilie
          ? `<a class="sikre-lenke" href="https://www.ice.no/mobilabonnement/icefamilie/" target="_blank" rel="noopener">Les mer om iceFamilie <span class="utmerkelse-pil">↗</span></a>`
          : ""
      }
      ${
        harTeliaTrygghet
          ? `<a class="sikre-lenke" href="https://www.telia.no/trygghet/" target="_blank" rel="noopener">Les mer om Trygghet hos Telia <span class="utmerkelse-pil">↗</span></a>`
          : ""
      }
    </div>`;

  // Besparelse vs. dagens
  if (h.dagensPris != null && !Number.isNaN(h.dagensPris)) {
    const spar = h.dagensPris - a.total;
    if (spar > 0) {
      html += `
        <div class="besparelse-wrap">
          <button type="button" class="besparelse positiv besparelse-knapp" aria-expanded="false">
            <span>Kunden sparer ${kr(spar)}/mnd
              <span class="aar">${kr(spar * 12)} i året vs. i dag</span>
            </span>
            <span class="ikon besparelse-pil">▾</span>
          </button>
          <div class="besparelse-detalj" hidden>
            <div class="besparelse-rad">
              <span class="besparelse-etikett">Nåværende pris per år</span>
              <span class="besparelse-belop gammel-pris">${kr(h.dagensPris * 12)}</span>
            </div>
            <div class="besparelse-rad">
              <span class="besparelse-etikett">Ny pris per år</span>
              <span class="besparelse-belop ny-pris">${kr(a.total * 12)}</span>
            </div>
            <div class="besparelse-rad besparelse-sum-rad">
              <span class="besparelse-etikett">Sparer totalt</span>
              <span class="besparelse-belop">${kr(spar * 12)}</span>
            </div>
          </div>
        </div>`;
    } else if (spar === 0) {
      html += `<div class="besparelse nulleller">Samme pris som i dag – men hos ${a.leverandor}.</div>`;
    } else {
      html += `
        <div class="besparelse nulleller">
          <span>${kr(-spar)}/mnd mer enn i dag
            <span class="aar">Til gjengjeld tilpassede abonnement hos ${a.leverandor}</span>
          </span>
        </div>`;
    }
  }

  // Fordeling per person (anbefalt)
  html += `<div class="panel"><h2>Fordeling per person</h2>${byggFordeling(a, h.brukere, produktrabattKr)}</div>`;

  // Velg tilbud – åpner vindu med koder for salgssystemet (anbefalt leverandør).
  html += `<button type="button" id="tilbudKnapp" class="cta cta-tilbud" data-lev="${a.leverandor}">Velg tilbud</button>`;

  // Andre alternativer – sammenleggbare dropdowns med sammensetning per person
  const alternativer = res.leverandorer.slice(1);
  if (alternativer.length) {
    html += '<div class="panel sammenlign"><h2>Andre alternativer</h2><div class="alt-liste">';
    alternativer.forEach((lev) => {
      const spar =
        h.dagensPris != null && !Number.isNaN(h.dagensPris)
          ? h.dagensPris - lev.total
          : null;
      const levInkl = inkludertFor(lev.leverandor);
      html += `
        <div class="alt">
          <button type="button" class="alt-topp">
            <span class="alt-v">
              <span class="alt-navn">${lev.leverandor}</span>
              ${levInkl.length ? `<span class="meta">+ ${levInkl.join(", ")} inkludert</span>` : ""}
            </span>
            <span class="alt-h">
              <span class="alt-pris">${kr(lev.total)}<small>/mnd</small></span>
              ${spar != null && spar > 0 ? `<span class="spar">spar ${kr(spar)}/mnd</span>` : ""}
            </span>
            <span class="alt-pil" aria-hidden="true">▾</span>
          </button>
          <div class="alt-innhold" hidden>${byggFordeling(lev, h.brukere, produktrabattKr)}<button type="button" class="cta cta-tilbud cta-tilbud-alt" data-lev="${lev.leverandor}">Velg tilbud – ${lev.leverandor}</button></div>
        </div>`;
    });
    html += "</div></div>";
  }

  el.innerHTML = html;
}

// Bygger per-person-fordelingen for en leverandør (gjenbrukt i anbefaling + alternativer).
// produktrabattKr = 0 (av), 500 eller 1000 per kvalifiserte plan.
function byggFordeling(lev, brukere, produktrabattKr) {
  const antall = brukere.length;
  let html = "";
  lev.brukerPlaner.forEach((v, i) => {
    const b = brukere[i];
    // Personprisen som faktisk betales: Telenor-medlemspris hvis satt, ellers
    // listeprisen (som allerede er peak-pris når Sommerpeak er på).
    const betalt = v.visPris != null ? v.visPris : v.pris;
    // «Før»-pris: ordinær (ikke-peak) listepris. Fanger både Sommerpeak-rabatt og
    // Telenor-medlemspris. Vises overstreket over betalt pris når det er rabatt.
    const ordinaer = planPrisOrdinaer(v.plan, v.alder);
    const rabattert = betalt < ordinaer;
    html += `
      <div class="kort-rad">
        <div class="v">
          <span class="navn">Person ${i + 1}: ${v.plan.navn}</span>
          <span class="meta">${b.alderLabel} · behov ${behovTekst(b.behovGb)} · ${b.hastighetLabel} → ${dataTekst(v.plan)}, ${hastighetTekst(v.plan)}</span>
        </div>
        <div class="h">
          ${rabattert ? `<div class="for-pris">${kr(ordinaer)}</div>` : ""}
          <div class="total${rabattert ? " rabattert" : ""}">${kr(betalt)}</div>
        </div>
      </div>`;
  });
  if (lev.familierabatt > 0) {
    html += `
      <div class="kort-rad">
        <div class="v">
          <span class="navn">Familierabatt</span>
          <span class="meta">${lev.leverandor} · ${antall} SIM</span>
        </div>
        <div class="h"><div class="total rabatt">−${kr(lev.familierabatt)}</div></div>
      </div>`;
  }
  html += `
      <div class="kort-rad topp sum">
        <div class="v"><span class="navn">Totalt per måned</span></div>
        <div class="h"><div class="total">${kr(lev.total)}</div></div>
      </div>`;
  if (lev.bonusTotalKr > 0 && lev.antallBonus > 0) {
    const bonusTotal = lev.bonusTotalKr;
    const periode = CONFIG.produktrabatt_periode_mnd || 12;
    const stk = `${lev.antallBonus} ${lev.antallBonus === 1 ? "abonnement" : "abonnementer"}`;
    html += `
      <div class="kort-rad engangs">
        <div class="v">
          <span class="navn">Produktrabatt</span>
          <span class="meta">${stk} · engangs · ≈${kr(bonusTotal / periode)}/mnd fordelt over ${periode} mnd</span>
        </div>
        <div class="h"><div class="total rabatt">−${kr(bonusTotal)}</div></div>
      </div>`;
  }
  return html;
}

// ---- Tilbud / kode-vindu ------------------------------------
// Kopi-ikon (klikkbart) + sjekk-ikon for tilbakemelding.
const KOPI_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const SJEKK_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const kopiIkon = (kode) =>
  `<button type="button" class="kode-kopier" data-kode="${kode}" title="Kopier ${kode}" aria-label="Kopier ${kode}">${KOPI_SVG}</button>`;

// Bygger og viser vinduet med koder selgeren legger inn i Blueberry, for valgt
// leverandør (anbefalt eller et av alternativene).
function visTilbud(leverandor) {
  if (!sisteResultat) return;
  const lev = sisteResultat.leverandorer.find((l) => l.leverandor === leverandor);
  if (!lev || !lev.brukerPlaner.length) return;
  const data = byggTilbudskoder(lev.brukerPlaner);
  const innhold = document.getElementById("tilbudInnhold");

  const harBinding = data.rader.some(
    (r) => r.binding && r.binding !== "Uten binding" && r.binding !== "—"
  );
  // Egendefinerte (lagt til) abonnement har ingen salgskode i systemet.
  const manglerKode = data.rader.filter((r) =>
    r.koder.some((k) => k.type === "mangler")
  );

  let html = `<p class="tilbud-intro">Legg inn disse kodene i Blueberry for <b>${lev.leverandor}</b>${
    data.peak ? ' <span class="tilbud-peak">☀ Sommerpeak aktiv</span>' : ""
  }</p>`;
  if (manglerKode.length) {
    const personer = manglerKode.map((r) => `Person ${r.person}`).join(", ");
    html += `<div class="tilbud-mangler-varsel">⚠ ${
      manglerKode.length === 1 ? "Ett abonnement mangler" : "Flere abonnement mangler"
    } salgskode (egendefinert abonnement: ${personer}) – finn og legg inn riktig kode manuelt i Blueberry.</div>`;
  }
  if (harBinding) {
    html += `<div class="tilbud-binding-varsel">⚠ Anbefalingen selges med binding – husk å informere kunden om dette.</div>`;
  }
  html += `<div class="tilbud-rader">`;

  data.rader.forEach((r) => {
    html += `
      <div class="tilbud-rad">
        <div class="tilbud-rad-topp">
          <span class="tilbud-person">Person ${r.person}</span>
          <span class="tilbud-plan">${r.planNavn}</span>
          <span class="tilbud-binding">${r.binding}</span>
        </div>
        <div class="tilbud-koder">
          ${r.koder
            .map((k) =>
              k.type === "mangler"
                ? `<span class="kode-chip mangler" title="Egendefinert abonnement uten salgskode – legg inn manuelt">⚠ Mangler kode</span>`
                : `<span class="kode-chip ${k.type}" title="${k.tekst}">${kopiIkon(k.kode)}<code>${k.kode}</code></span>`
            )
            .join("")}
        </div>
      </div>`;
  });
  html += "</div>";

  html += `
    <div class="tilbud-samlet">
      <h3>Samlet kodeliste</h3>
      <ul class="tilbud-samlet-liste">
        ${data.samlet
          .map(
            (s) =>
              `<li>${kopiIkon(s.kode)}<code>${s.kode}</code>${
                s.antall > 1 ? `<span class="antall">×${s.antall}</span>` : ""
              }<span class="kode-tekst">${s.tekst}</span></li>`
          )
          .join("")}
      </ul>
    </div>`;

  innhold.innerHTML = html;
  document.getElementById("tilbudOverlay").hidden = false;
}

// ---- Oppstart -----------------------------------------------
// ---- Prisoversikt (intern) ----------------------------------
// Menneskelig beskrivelse av familierabatt-modellen per leverandør.
function familierabattTekst(leverandor) {
  const r = FAMILIERABATT[leverandor];
  if (!r) {
    return "Ingen prisrabatt. iceFamilie gir felles faktura og datadeling, samt egne ung- og junior-planer med lavere fastpris (under 30 / under 13).";
  }
  if (r.modell === "familiemedlem_fastpris") {
    const mp = r.medlemspris || {};
    const ledd = [
      mp.voksen != null ? `${mp.voksen} kr (voksen)` : null,
      mp.under_30 != null ? `${mp.under_30} kr (under 30)` : null,
      mp.under_13 != null ? `${mp.under_13} kr (under 13)` : null,
    ].filter(Boolean).join(", ");
    return `Ingen samlet familierabatt – prisen fordeles per person. Hovedabonnent betaler full pris. Hvert ekstra medlem på ubegrenset får en lavere fast medlemspris (ekstra billig for yngre): ${ledd}. På Sikre betaler under 13 kun 249 kr. Medlemmer med fastdata betaler egen pris.`;
  }
  if (r.modell === "dyreste_full_plantype") {
    return `Dyreste SIM betaler full pris. Øvrige: −${r.rabatt_kr_ubegrenset} kr på ubegrenset, −${r.rabatt_kr_ovrige} kr på fastdata/junior. Maks ${r.maks_antall_med_rabatt} SIM med rabatt. Kombineres med aldersrabatt.`;
  }
  return "";
}

// Overskrift for rabatt-/prisfordelingsavsnittet i prisoversikten. Telenor-
// modellen er en prisfordeling per person, ikke en samlet familierabatt.
function rabattTittel(leverandor) {
  const r = FAMILIERABATT[leverandor];
  if (r && r.modell === "familiemedlem_fastpris") return "Pris per medlem";
  return "Familierabatt";
}

function planAldersNotat(p) {
  const deler = [];
  if (p.alder_maks != null) deler.push(`kun t.o.m. ${p.alder_maks} år`);
  if (Array.isArray(p.alder_rabatt)) {
    p.alder_rabatt.forEach((r) => deler.push(`−${r.rabatt_kr} kr t.o.m. ${r.maks} år`));
  }
  if (p.gir_familierabatt === false) deler.push("ingen familierabatt");
  else if (p.familierabatt_kr != null) deler.push(`familierabatt −${p.familierabatt_kr} kr/ekstra SIM`);
  if (p.produktrabatt) {
    deler.push(p.produktrabatt_kr != null ? `produktrabatt ${p.produktrabatt_kr} kr engangs` : "produktrabatt (kampanje)");
  }
  return deler.join(" · ");
}

function prisStatusTekst() {
  const modus = erPeak() ? "☀ Sommerpeak-priser" : "Normalpriser";
  return harLokaleEndringer() ? modus + " · ● lokale endringer" : modus;
}

function renderPrisoversikt() {
  let html = '<h1 class="pris-tittel">Prisoversikt &amp; rabattlogikk</h1>';

  // Sommerpeak-bryter (kun her)
  html += `<div id="peakBar" class="peak-bar${erPeak() ? " aktiv" : ""}">
      <div class="peak-info">
        <span class="peak-ikon">☀</span>
        <span class="peak-tekst"><b>Sommerpeak 2026</b> <span class="peak-status">${
          erPeak() ? "kampanjepriser aktive" : "av – normalpriser"
        }</span></span>
      </div>
      <label class="peak-switch" aria-label="Skru Sommerpeak av/på">
        <input type="checkbox" id="peakToggle" ${erPeak() ? "checked" : ""} />
        <span class="toggle-slider"></span>
      </label>
    </div>`;

  // Verktøylinje: status + tilbakestill
  html += `<div class="pris-verktoy">
      <span class="pris-status">${prisStatusTekst()}</span>
      <button type="button" id="resetEndringer" class="pris-reset" ${
        harLokaleEndringer() ? "" : "disabled"
      }>↺ Tilbakestill</button>
    </div>`;

  VARE_LEVERANDORER.forEach((lev) => {
    const planer = ABONNEMENTER.filter((p) => p.leverandor === lev);
    html += `<div class="panel pris-lev">
      <div class="pris-lev-topp"><h2>${lev}</h2></div>
      <table class="pris-tabell">
        <thead><tr><th>Abonnement</th><th>Data</th><th>Hastighet</th><th class="hoyre">Pris/mnd</th></tr></thead>
        <tbody>`;
    planer.forEach((p) => {
      const notat = planAldersNotat(p);
      const inkl = planInkludert(p);
      const ny = erNyttAbonnement(p.id);
      html += `<tr>
        <td>${p.navn}${ny ? ` <span class="ny-badge">NY</span>` : ""}${
        notat ? `<span class="pris-notat">${notat}</span>` : ""
      }${inkl.length ? `<span class="pris-notat">+ ${inkl.join(", ")}</span>` : ""}${
        ny ? `<button type="button" class="fjern-ny" data-id="${p.id}" title="Fjern">✕</button>` : ""
      }</td>
        <td>${dataTekst(p)}</td>
        <td>${hastighetTekst(p)}</td>
        <td class="hoyre"><input type="number" class="pris-input${
          erEndretPris(p.id) ? " endret" : ""
        }" data-id="${p.id}" value="${p.pris_per_sim}" min="0" step="10" inputmode="numeric" /></td>
      </tr>`;
    });
    const inkl = inkludertFor(lev);
    html += `</tbody></table>
      <div class="pris-rabatt"><span class="merke-liten">${rabattTittel(lev)}</span> ${familierabattTekst(lev)}</div>
      ${inkl.length ? `<div class="pris-rabatt"><span class="merke-liten">Inkludert</span> ${inkl.join(", ")}</div>` : ""}
    </div>`;
  });

  // Legg til nytt abonnement
  html += `<div class="panel pris-lev">
    <div class="pris-lev-topp"><h2>Legg til abonnement</h2></div>
    <div class="ny-abo-form">
      <select id="nyLev">${VARE_LEVERANDORER.map((l) => `<option value="${l}">${l}</option>`).join("")}</select>
      <input id="nyNavn" type="text" placeholder="Navn (f.eks. Telia 20 GB)" />
      <select id="nyType">
        <option value="fast">Fast data (GB)</option>
        <option value="ubegrenset">Ubegrenset</option>
      </select>
      <input id="nyGb" type="number" placeholder="GB" min="0" inputmode="numeric" />
      <input id="nyHast" type="number" placeholder="Mbit" min="0" inputmode="numeric" />
      <input id="nyPris" type="number" placeholder="Pris/mnd" min="0" step="10" inputmode="numeric" />
      <input id="nyAlderMaks" type="number" placeholder="Aldersgrense – maks alder (valgfri)" min="0" inputmode="numeric" />
      <label class="ny-abo-sjekk">
        <input type="checkbox" id="nyFamilierabatt" checked />
        <span>Gir familierabatt (slå av for ung-/juniorplaner)</span>
      </label>
      <input id="nyFamilierabattKr" type="number" placeholder="Familierabatt – kr per ekstra SIM" min="0" step="10" inputmode="numeric" />
      <label class="ny-abo-sjekk">
        <input type="checkbox" id="nyProduktrabatt" />
        <span>Produktrabatt (engangs, f.eks. Telia X)</span>
      </label>
      <input id="nyProduktrabattKr" type="number" placeholder="Produktrabatt – kr engangs (tomt = følg kampanje)" min="0" step="50" inputmode="numeric" hidden />
      <button type="button" id="leggTilAbo" class="ny-abo-knapp">+ Legg til abonnement</button>
      <div class="ny-abo-feil" id="nyFeil" hidden></div>
    </div>
  </div>`;

  // Konfigurasjon / forutsetninger
  html += `<div class="panel pris-lev">
    <div class="pris-lev-topp"><h2>Forutsetninger i beregningen</h2></div>
    <ul class="pris-config">
      <li><b>«Fri data»</b> dekkes av ubegrenset.</li>
      <li><b>Hastighet</b>: ${Object.values(HASTIGHET_VALG).map((h) => `${h.label} (≥${h.min_mbit} Mbit)`).join(", ")}. Planen må levere minst valgt hastighet.</li>
      <li><b>Anbefaling per person</b>: dekker behov + hastighet, lovlig for alder, lavest pris.</li>
      <li><b>Aldersgrupper</b>: ${Object.values(ALDER_VALG).map((a) => a.label).join(", ")}.</li>
    </ul>
  </div>`;

  document.getElementById("prisInnhold").innerHTML = html;
}

// Leser «legg til»-skjemaet, validerer og legger til et nytt abonnement.
function haandterLeggTilAbo() {
  const lev = document.getElementById("nyLev").value;
  const navn = escapeHtml(document.getElementById("nyNavn").value.trim());
  const type = document.getElementById("nyType").value;
  const gb = Number(document.getElementById("nyGb").value);
  const hast = Number(document.getElementById("nyHast").value) || 1000;
  const pris = Number(document.getElementById("nyPris").value);
  const alderMaks = Number(document.getElementById("nyAlderMaks").value);
  const girFamilierabatt = document.getElementById("nyFamilierabatt").checked;
  const familierabattKr = Number(document.getElementById("nyFamilierabattKr").value);
  const produktrabatt = document.getElementById("nyProduktrabatt").checked;
  const produktrabattKr = Number(document.getElementById("nyProduktrabattKr").value);
  const feil = document.getElementById("nyFeil");
  const vis = (m) => {
    feil.textContent = m;
    feil.hidden = false;
  };

  if (!navn) return vis("Skriv inn et navn.");
  if (!pris || pris <= 0) return vis("Skriv inn en gyldig pris.");
  const ubegrenset = type === "ubegrenset";
  if (!ubegrenset && (!gb || gb <= 0))
    return vis("Skriv inn datamengde (GB), eller velg Ubegrenset.");

  const plan = {
    id: "ny_" + Date.now(),
    leverandor: lev,
    navn,
    data_gb: ubegrenset ? 0 : gb,
    ubegrenset,
    hastighet_mbit: hast,
    pris_per_sim: pris,
  };
  // Valgfrie flagg som påvirker beregningen.
  if (!girFamilierabatt) {
    plan.gir_familierabatt = false; // default er true
  } else if (familierabattKr && familierabattKr > 0) {
    // Eksplisitt familierabatt-beløp (kr per ekstra SIM) for denne planen.
    plan.familierabatt_kr = familierabattKr;
  }
  if (produktrabatt) {
    plan.produktrabatt = true;
    // Eget engangsbeløp for denne planen. Tomt = følg kampanjevalget i menyen.
    if (produktrabattKr && produktrabattKr > 0) plan.produktrabatt_kr = produktrabattKr;
  }
  if (alderMaks && alderMaks > 0) plan.alder_maks = alderMaks;

  leggTilAbonnement(plan);
  renderPrisoversikt();
  oppdater();
}

// ---- Visnings-håndtering (input / resultat / pris) ----------
const VISNING_ID = { input: "inputVisning", resultat: "resultatVisning", pris: "prisVisning" };
let forrigeVisning = "input";

function visVisning(navn) {
  Object.entries(VISNING_ID).forEach(([k, id]) => {
    document.getElementById(id).hidden = k !== navn;
  });
  window.scrollTo(0, 0);
}

// Prisoversikt åpnes fra logoen og returnerer dit man kom fra.
function aapnePris() {
  forrigeVisning = document.getElementById("resultatVisning").hidden ? "input" : "resultat";
  renderPrisoversikt();
  visVisning("pris");
}

// ---- Enkel kalkulator (for dagens pris) ---------------------
let kalkAkk = null; // akkumulert verdi
let kalkOp = null; // ventende operator
let kalkNyttTall = true; // neste siffer starter et nytt tall
let kalkDisp = "0"; // det som vises (gjeldende tall / resultat)
let kalkUttrykk = ""; // regnestykket så langt, f.eks. "300 + 200 + "
let kalkEtterLik = false; // sist trykk var «=»

const KALK_SYM = { "+": "+", "-": "−", "*": "×", "/": "÷" };

function kalkVisning() {
  document.getElementById("kalkUttrykk").textContent = kalkUttrykk;
  document.getElementById("kalkDisplay").textContent = kalkDisp;
}
function kalkAnvend(op, a, b) {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? a : a / b;
    default: return b;
  }
}
function kalkTast(k) {
  if (/^[0-9]$/.test(k)) {
    if (kalkEtterLik) { kalkUttrykk = ""; kalkAkk = null; kalkOp = null; kalkEtterLik = false; }
    kalkDisp = kalkNyttTall || kalkDisp === "0" ? k : kalkDisp + k;
    kalkNyttTall = false;
  } else if (k === ".") {
    if (kalkEtterLik) { kalkUttrykk = ""; kalkAkk = null; kalkOp = null; kalkEtterLik = false; }
    if (kalkNyttTall) {
      kalkDisp = "0.";
      kalkNyttTall = false;
    } else if (!kalkDisp.includes(".")) {
      kalkDisp += ".";
    }
  } else if (k === "C") {
    kalkAkk = null; kalkOp = null; kalkNyttTall = true; kalkDisp = "0";
    kalkUttrykk = ""; kalkEtterLik = false;
  } else if (k === "back") {
    if (!kalkNyttTall) {
      kalkDisp = kalkDisp.length > 1 ? kalkDisp.slice(0, -1) : "0";
      if (kalkDisp === "" || kalkDisp === "-") kalkDisp = "0";
    }
  } else if (k === "+" || k === "-" || k === "*" || k === "/") {
    const sym = KALK_SYM[k];
    const visTall = kalkDisp;
    if (kalkEtterLik) {
      // Fortsett å regne videre fra resultatet.
      kalkUttrykk = visTall + " " + sym + " ";
      kalkAkk = parseFloat(kalkDisp) || 0;
      kalkOp = k; kalkNyttTall = true; kalkEtterLik = false;
    } else if (kalkNyttTall && kalkUttrykk) {
      // To operatorer på rad: bytt bare ut den siste operatoren.
      kalkUttrykk = kalkUttrykk.replace(/[+−×÷]\s*$/, sym + " ");
      kalkOp = k;
    } else {
      const tall = parseFloat(kalkDisp) || 0;
      if (kalkOp !== null && !kalkNyttTall) {
        kalkAkk = kalkAnvend(kalkOp, kalkAkk, tall);
        kalkDisp = String(kalkAkk);
      } else {
        kalkAkk = tall;
      }
      kalkUttrykk += visTall + " " + sym + " ";
      kalkOp = k;
      kalkNyttTall = true;
    }
  } else if (k === "=") {
    const visTall = kalkDisp;
    const tall = parseFloat(kalkDisp) || 0;
    if (kalkOp !== null) {
      kalkUttrykk = kalkUttrykk + visTall + " =";
      kalkAkk = kalkAnvend(kalkOp, kalkAkk, tall);
      kalkDisp = String(kalkAkk);
      kalkOp = null;
    } else {
      kalkAkk = tall;
    }
    kalkNyttTall = true;
    kalkEtterLik = true;
  }
  kalkVisning();
}

// ---- Oppstart -----------------------------------------------
// ---- Lagring av menyvalg (burgermeny) -----------------------
// Lagrer valgene i hamburgermenyen lokalt slik at de overlever en omlasting
// (produktrabatt, kundepreferanse og innstillings-bryterne). Lokal dekning og
// priser/Peak lagres separat i kalkulator.js.
const MENY_NOKKEL = "elkjop_meny_v1";

// Maks produktrabatt per Telia X. Beløpsfeltet i menyen klampes til dette.
const RABATT_MAKS_KR = 1000;

// Leser produktrabatt-beløpet fra menyen, klampet til [0, RABATT_MAKS_KR].
function rabattBelopKr() {
  const v = Number(document.getElementById("rabattBelop").value);
  if (Number.isNaN(v) || v <= 0) return 0;
  return Math.min(v, RABATT_MAKS_KR);
}

function lagreMeny() {
  try {
    const data = {
      rabattBelop: rabattBelopKr(),
      rabattIRangering: document.getElementById("rabattIRangering").checked,
      prefOperator: document.getElementById("prefOperator").value,
      prefModus:
        document.querySelector("#prefModus .seg-btn.aktiv")?.dataset.modus ||
        "foretrekk",
      visPrioritet: state.visPrioritet,
      noyaktigData: state.noyaktigData,
      ekskluderDagens: state.ekskluderDagens,
      // Markør for engangs-migrering til ny standard (ekskluder dagens = på).
      ekskluderStandardPaa: true,
    };
    localStorage.setItem(MENY_NOKKEL, JSON.stringify(data));
  } catch {}
}

function lastMeny() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(MENY_NOKKEL) || "null");
  } catch {
    data = null;
  }
  if (!data) return; // ingen lagrede valg -> behold HTML-standard

  // Produktrabatt-beløp. Fallback til gammel form (rabattPaa/rabatt) hvis lagret.
  const rabattBelopEl = document.getElementById("rabattBelop");
  if (data.rabattBelop != null) {
    rabattBelopEl.value = Math.min(Math.max(data.rabattBelop, 0), RABATT_MAKS_KR);
  } else if (typeof data.rabattPaa === "boolean") {
    rabattBelopEl.value = data.rabattPaa ? 500 : 0;
  } else if (typeof data.rabatt === "number") {
    rabattBelopEl.value = Math.min(Math.max(data.rabatt, 0), RABATT_MAKS_KR);
  }
  // Om produktrabatten skal telle i anbefalingen (standard på).
  if (typeof data.rabattIRangering === "boolean")
    document.getElementById("rabattIRangering").checked = data.rabattIRangering;

  // Kundepreferanse (operatør + Foretrekk/Krev).
  if (typeof data.prefOperator === "string")
    document.getElementById("prefOperator").value = data.prefOperator;
  if (data.prefModus) {
    document
      .querySelectorAll("#prefModus .seg-btn")
      .forEach((b) => b.classList.toggle("aktiv", b.dataset.modus === data.prefModus));
  }

  // Innstillinger (speiles til state + avkrysningsbokser).
  if (typeof data.visPrioritet === "boolean") {
    state.visPrioritet = data.visPrioritet;
    document.getElementById("visPrioritet").checked = data.visPrioritet;
  }
  if (typeof data.noyaktigData === "boolean") {
    state.noyaktigData = data.noyaktigData;
    document.getElementById("noyaktigData").checked = data.noyaktigData;
  }
  // Engangs-migrering: gamle lagrede valg (før «ekskluder dagens» ble standard på)
  // mangler markøren -> behold HTML-standarden (på) i stedet for den gamle verdien.
  if (data.ekskluderStandardPaa && typeof data.ekskluderDagens === "boolean") {
    state.ekskluderDagens = data.ekskluderDagens;
    document.getElementById("ekskluderDagens").checked = data.ekskluderDagens;
  }
}

// Stabil fallback-versjon (GitHub Pages) som anbefales hvis datalasting feiler
// på den siden selgeren står på (f.eks. utdatert/ufullstendig Netlify-deploy).
const FALLBACK_URL = "https://magnusafjeld-cpu.github.io/Abonnementskalkulator/";

// Vises i stedet for en blank skjerm når data/-filene ikke kan lastes. Anbefaler
// den stabile GitHub Pages-versjonen, eller omlasting hvis vi allerede er der.
function visLastefeil(feil) {
  const paaFallback = location.href.startsWith(FALLBACK_URL);
  const wrap = document.querySelector(".wrap");
  if (!wrap) return;
  const handling = paaFallback
    ? `<button type="button" class="cta" onclick="location.reload()">Last siden på nytt</button>`
    : `<a class="cta" href="${FALLBACK_URL}">Åpne stabil versjon ↗</a>
       <button type="button" class="lastefeil-reload" onclick="location.reload()">eller prøv på nytt her</button>`;
  wrap.innerHTML = `
    <section class="panel lastefeil">
      <div class="lastefeil-ikon">⚠</div>
      <h2>Kunne ikke laste data</h2>
      <p>Prisene og abonnementene lot seg ikke hente${
        paaFallback ? "" : ", så kalkulatoren kan ikke vise riktige tall her akkurat nå"
      }.${paaFallback ? " Sjekk nettforbindelsen og prøv på nytt." : " Bruk den stabile versjonen i stedet:"}</p>
      <div class="lastefeil-handling">${handling}</div>
      <p class="lastefeil-detalj">${escapeHtml(feil && feil.message ? feil.message : String(feil))}</p>
    </section>`;
}

async function start() {
  try {
    await lastData();
  } catch (feil) {
    visLastefeil(feil);
    return;
  }
  byggLeverandorer();
  lastMeny(); // gjenopprett lagrede menyvalg før vi bygger UI som avhenger av dem
  renderBrukere();

  document.getElementById("dagensPris").addEventListener("input", oppdater);
  document.getElementById("leverandor").addEventListener("change", oppdater);

  // Kundeprioritet: nivåvelgere (delegert).
  renderPrioritet();
  oppdaterPrioritetSynlighet();
  document.getElementById("prioritetRader").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-niva]");
    if (!b) return;
    const dim = b.parentElement.dataset.dim;
    state.prioritet[dim] = Number(b.dataset.niva);
    renderPrioritet();
    oppdater();
  });

  // Av/på for kundepreferanser utover pris (skjuler panelet på hjemskjermen).
  const visPrioritet = document.getElementById("visPrioritet");
  visPrioritet.addEventListener("change", () => {
    state.visPrioritet = visPrioritet.checked;
    lagreMeny();
    oppdaterPrioritetSynlighet();
    oppdater();
  });

  // Avanserte innstillinger: lokal dekning (glidere pr. operatør).
  renderDekning();
  const dekningRader = document.getElementById("dekningRader");
  dekningRader.addEventListener("input", (e) => {
    const s = e.target.closest(".dekning-slider");
    if (!s) return;
    settLokalDekning(s.dataset.lev, Number(s.value));
    const verdi = dekningRader.querySelector(`.dekning-verdi[data-lev="${s.dataset.lev}"]`);
    if (verdi) verdi.textContent = gjeldendeDekning(s.dataset.lev);
    document.getElementById("nullstillDekning").disabled = !harLokalDekning();
    oppdater();
  });
  document.getElementById("nullstillDekning").addEventListener("click", () => {
    nullstillLokalDekning();
    renderDekning();
    oppdater();
  });

  // Ekskluder dagens operatør (avanserte innstillinger).
  const ekskluderDagens = document.getElementById("ekskluderDagens");
  ekskluderDagens.addEventListener("change", () => {
    state.ekskluderDagens = ekskluderDagens.checked;
    lagreMeny();
    oppdater();
  });

  // Hamburger-meny (produktrabatt-kampanjer)
  const menyKnapp = document.getElementById("menyKnapp");
  const meny = document.getElementById("meny");
  menyKnapp.addEventListener("click", (e) => {
    e.stopPropagation();
    const apen = meny.hidden;
    meny.hidden = !apen;
    menyKnapp.setAttribute("aria-expanded", String(apen));
    // Start alltid med avanserte innstillinger lukket når menyen åpnes.
    if (apen) {
      const av = document.querySelector(".meny-avansert");
      if (av) av.open = false;
    }
  });
  document.addEventListener("click", (e) => {
    if (!meny.hidden && !meny.contains(e.target) && !menyKnapp.contains(e.target)) {
      meny.hidden = true;
      menyKnapp.setAttribute("aria-expanded", "false");
    }
  });

  // Produktrabatt: manuelt beløp per Telia X (0 = av, klampes til maks 1000 kr)
  const rabattBelop = document.getElementById("rabattBelop");
  rabattBelop.addEventListener("input", () => {
    // Klamp til [0, 1000] og skriv tilbake klampet verdi til feltet.
    const v = Number(rabattBelop.value);
    if (!Number.isNaN(v) && v > RABATT_MAKS_KR) rabattBelop.value = RABATT_MAKS_KR;
    if (!Number.isNaN(v) && v < 0) rabattBelop.value = 0;
    lagreMeny();
    oppdater();
  });
  // Enter avslutter redigeringen av feltet, men holder burgermenyen åpen.
  rabattBelop.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      rabattBelop.blur();
    }
  });
  // Bryter: skal produktrabatten telle i anbefalingen?
  document.getElementById("rabattIRangering").addEventListener("change", () => {
    lagreMeny();
    oppdater();
  });

  // Kundepreferanse (operatør + Foretrekk/Krev)
  const prefOp = document.getElementById("prefOperator");
  const prefModusEl = document.getElementById("prefModus");
  const prefHint = document.getElementById("prefHint");
  function oppdaterPref() {
    const aktiv = prefOp.value !== "";
    prefModusEl.classList.toggle("disabled", !aktiv);
    const modus = prefModusEl.querySelector(".seg-btn.aktiv")?.dataset.modus || "foretrekk";
    prefHint.textContent = !aktiv
      ? "Velg operatør for å aktivere."
      : modus === "krev"
      ? "Krev: anbefales alltid hvis operatøren kan dekke kunden."
      : "Foretrekk: vinner når prisen er nær billigste.";
  }
  prefOp.addEventListener("change", () => { oppdaterPref(); lagreMeny(); oppdater(); });
  prefModusEl.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (prefOp.value === "") return;
      prefModusEl.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("aktiv", b === btn));
      oppdaterPref();
      lagreMeny();
      oppdater();
    });
  });
  oppdaterPref();
  document.getElementById("leggTil").addEventListener("click", () => {
    state.brukere.push(nyBruker());
    renderBrukere();
    oppdater();
  });

  // Nøyaktig datamengde-toggle (burgermeny)
  const noyaktigData = document.getElementById("noyaktigData");
  noyaktigData.addEventListener("change", () => {
    state.noyaktigData = noyaktigData.checked;
    lagreMeny();
    if (state.noyaktigData) {
      // Seed eksakt GB fra valgt kategori (fri/ukjent -> 15 som start).
      state.brukere.forEach((b) => {
        const gb = DATA_VALG[b.data].gb;
        b.dataGb = gb != null ? gb : b.dataGb || 15;
      });
    }
    renderBrukere();
    oppdater();
  });

  document.getElementById("anbefalKnapp").addEventListener("click", () => {
    oppdater();
    visVisning("resultat");
  });

  document.getElementById("nyKundeKnapp").addEventListener("click", nyKunde);

  // Enkel kalkulator for dagens pris
  const kalkOverlay = document.getElementById("kalkOverlay");
  const dagensPrisEl = document.getElementById("dagensPris");
  document.getElementById("kalkKnapp").addEventListener("click", () => {
    const v = dagensPrisEl.value.trim();
    kalkDisp = v === "" ? "0" : v;
    kalkAkk = null;
    kalkOp = null;
    // Vis dagens pris som start. Operator bruker den; første siffer starter friskt.
    kalkNyttTall = true;
    kalkVisning();
    kalkOverlay.hidden = false;
  });
  document.getElementById("kalkLukk").addEventListener("click", () => (kalkOverlay.hidden = true));
  kalkOverlay.addEventListener("click", (e) => {
    if (e.target === kalkOverlay) kalkOverlay.hidden = true;
  });
  document.getElementById("kalkTast").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (b) kalkTast(b.dataset.k);
  });
  function kalkBruk() {
    kalkTast("="); // fullfør evt. ventende regning
    dagensPrisEl.value = Math.round(parseFloat(kalkDisp) || 0);
    dagensPrisEl.dispatchEvent(new Event("input"));
    kalkOverlay.hidden = true;
  }
  document.getElementById("kalkBruk").addEventListener("click", kalkBruk);

  // Tastatur / numpad-støtte mens kalkulatoren er åpen.
  document.addEventListener("keydown", (e) => {
    if (kalkOverlay.hidden) return;
    const k = e.key;
    if (k === "Escape") {
      kalkOverlay.hidden = true;
    } else if (k === "Enter") {
      kalkBruk(); // regn ut og legg inn i dagens pris
    } else if (/^[0-9]$/.test(k)) {
      kalkTast(k);
    } else if (k === "." || k === ",") {
      kalkTast(".");
    } else if (k === "+" || k === "-" || k === "*" || k === "/") {
      kalkTast(k);
    } else if (k === "=") {
      kalkTast("=");
    } else if (k === "Backspace") {
      kalkTast("back");
    } else if (k === "Delete" || k === "c" || k === "C") {
      kalkTast("C");
    } else {
      return; // ikke en kalkulatortast – ikke blokker andre snarveier
    }
    e.preventDefault();
  });

  // Sammenleggbare alternativer + Velg tilbud (delegert – #resultat fornyes ved oppdatering)
  document.getElementById("resultat").addEventListener("click", (e) => {
    const tilbudBtn = e.target.closest(".cta-tilbud");
    if (tilbudBtn) {
      visTilbud(tilbudBtn.dataset.lev);
      return;
    }
    const besparelseKnapp = e.target.closest(".besparelse-knapp");
    if (besparelseKnapp) {
      const detalj = besparelseKnapp.nextElementSibling;
      const apnes = detalj.hidden;
      detalj.hidden = !apnes;
      besparelseKnapp.setAttribute("aria-expanded", String(apnes));
      besparelseKnapp.classList.toggle("apen", apnes);
      return;
    }
    const topp = e.target.closest(".alt-topp");
    if (!topp) return;
    const innhold = topp.nextElementSibling;
    const apnes = innhold.hidden;
    innhold.hidden = !apnes;
    topp.classList.toggle("apen", apnes);
  });

  // Tilbud / kode-vindu
  const tilbudOverlay = document.getElementById("tilbudOverlay");
  document
    .getElementById("tilbudLukk")
    .addEventListener("click", () => (tilbudOverlay.hidden = true));
  tilbudOverlay.addEventListener("click", (e) => {
    if (e.target === tilbudOverlay) {
      tilbudOverlay.hidden = true;
      return;
    }
    const kopier = e.target.closest(".kode-kopier");
    if (kopier) {
      const kode = kopier.dataset.kode || "";
      navigator.clipboard
        ?.writeText(kode)
        .then(() => {
          kopier.innerHTML = SJEKK_SVG;
          kopier.classList.add("kopiert");
          setTimeout(() => {
            kopier.innerHTML = KOPI_SVG;
            kopier.classList.remove("kopiert");
          }, 1200);
        })
        .catch(() => {});
    }
  });

  // Prisoversikt: redigerbare priser, tilbakestill, fjern/legg til abonnement (delegert)
  const prisInnhold = document.getElementById("prisInnhold");
  prisInnhold.addEventListener("change", (e) => {
    if (e.target.id === "peakToggle") {
      settPeak(e.target.checked);
      renderPrisoversikt(); // oppdaterer priser + bar-status
      oppdater(); // påvirker anbefalingen
      return;
    }
    // «Gir familierabatt»: vis/skjul beløpsfeltet i «legg til»-skjemaet.
    if (e.target.id === "nyFamilierabatt") {
      const kr = document.getElementById("nyFamilierabattKr");
      if (kr) kr.hidden = !e.target.checked;
      return;
    }
    // «Produktrabatt»: vis/skjul beløpsfeltet i «legg til»-skjemaet.
    if (e.target.id === "nyProduktrabatt") {
      const kr = document.getElementById("nyProduktrabattKr");
      if (kr) kr.hidden = !e.target.checked;
      return;
    }
    // Datatype: GB-feltet er kun relevant for fastdata, ikke ubegrenset.
    if (e.target.id === "nyType") {
      const gb = document.getElementById("nyGb");
      if (gb) gb.hidden = e.target.value === "ubegrenset";
      return;
    }
    const inp = e.target.closest(".pris-input");
    if (!inp) return;
    const verdi = Number(inp.value);
    if (Number.isNaN(verdi) || verdi < 0) return;
    settPris(inp.dataset.id, verdi);
    inp.classList.toggle("endret", erEndretPris(inp.dataset.id));
    const reset = document.getElementById("resetEndringer");
    if (reset) reset.disabled = !harLokaleEndringer();
    const status = document.querySelector(".pris-status");
    if (status) status.textContent = prisStatusTekst();
    oppdater(); // påvirker anbefalingen
  });
  prisInnhold.addEventListener("click", (e) => {
    if (e.target.closest("#resetEndringer")) {
      if (!confirm("Er du sikker på at du vil tilbakestille alle lokale prisendringer og nye abonnement til standardverdiene?")) return;
      tilbakestillEndringer();
      renderPrisoversikt();
      oppdater();
    } else if (e.target.closest(".fjern-ny")) {
      fjernNyttAbonnement(e.target.closest(".fjern-ny").dataset.id);
      renderPrisoversikt();
      oppdater();
    } else if (e.target.closest("#leggTilAbo")) {
      haandterLeggTilAbo();
    }
  });

  document.getElementById("endreKnapp").addEventListener("click", () => visVisning("input"));
  document.getElementById("logoKnapp").addEventListener("click", aapnePris);
  document.getElementById("tilbakeKnapp").addEventListener("click", () => visVisning(forrigeVisning));

  // Guide / hjelp («i»-knapp i headeren)
  const guideOverlay = document.getElementById("guideOverlay");
  document.getElementById("guideKnapp").addEventListener("click", () => (guideOverlay.hidden = false));
  document.getElementById("guideLukk").addEventListener("click", () => (guideOverlay.hidden = true));
  guideOverlay.addEventListener("click", (e) => {
    if (e.target === guideOverlay) guideOverlay.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !guideOverlay.hidden) guideOverlay.hidden = true;
  });

  oppdater();
}

start();
