/* ===== Gestion Station MOBIL Boulouparis — interface ===== */
"use strict";
const C = window.COMPTA;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null || n === "" || isNaN(n) ? "" : Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " "));
const F = (n) => (n == null ? "" : fmt(n) + " F");
const L = (n) => fmt(n) + " L";
const fd = C.fmtD;
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now() + Math.random());

const S = {
  user: null, role: "aucun", nom: "", tab: "bord", sub: {},
  mois: today().slice(0, 7),
  params: {}, comptes: [], tiers: [], factures: [], reglements: [], imports: [], cuves: [], salaries: [], periodes: [], profiles: [],
  lignesCache: new Map(),
};
const estCompta = () => ["gerant", "comptable"].includes(S.role);
const estGerant = () => S.role === "gerant";
const tiersPar = (id) => S.tiers.find((t) => t.id === id);
const libCompte = (n) => (S.comptes.find((c) => c.numero === n) || {}).libelle || "";
const moisClos = (m) => S.periodes.some((p) => p.mois === m);
const debutMois = (m) => m + "-01";
const finMois = (m) => C.finMois(m);

/* ---------- Messages ---------- */
function toast(msg, type = "ok") {
  const t = document.createElement("div"); t.className = "toast " + type; t.textContent = msg;
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), type === "bad" ? 7000 : 3500);
}
async function action(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(e.message || String(e), "bad"); return undefined; }
}
function modal(titre, html, { large } = {}) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal ${large ? "large" : ""}" role="dialog" aria-label="${esc(titre)}"><header><h2>${esc(titre)}</h2><button class="link" data-close>Fermer</button></header><div class="modal-body">${html}</div></div>`;
  m.addEventListener("click", (e) => { if (e.target === m || e.target.hasAttribute("data-close")) m.remove(); });
  document.body.appendChild(m); return m;
}
const chip = (txt, t) => `<span class="chip ${t}">${esc(txt)}</span>`;

/* ---------- Données ---------- */
async function chargerTout() {
  const [par, comptes, tiers, imports, cuves, salaries, periodes] = await Promise.all([
    DB.sel("parametres"), DB.sel("comptes", { order: "numero" }), DB.sel("tiers", { order: "nom" }),
    DB.sel("caisse_imports", { order: "date_debut desc" }), DB.sel("cuves", { order: "date desc" }),
    DB.sel("salaries", { order: "prenom" }), DB.sel("periodes_closes"),
  ]);
  S.params = par[0]?.data || {}; S.comptes = comptes; S.tiers = tiers; S.imports = imports; S.cuves = cuves; S.salaries = salaries; S.periodes = periodes;
  S.factures = await DB.sel("factures", { order: "date_facture desc" });
  if (estCompta()) S.reglements = await DB.sel("reglements", { order: "date desc" });
  if (estGerant()) S.profiles = await DB.sel("profiles", { order: "nom" });
  S.lignesCache.clear();
}
async function lignes(d1, d2) {
  const k = d1 + "|" + d2;
  if (!S.lignesCache.has(k)) S.lignesCache.set(k, await DB.sel("v_lignes", { gte: d1 ? { date: d1 } : {}, lte: d2 ? { date: d2 } : {}, order: ["date", "id"] }));
  return S.lignesCache.get(k);
}
const invalider = () => S.lignesCache.clear();
async function assurerComptes(liste) {
  const connus = new Set(S.comptes.map((c) => c.numero));
  const neufs = []; const vus = new Set();
  for (const c of liste) if (!connus.has(c.numero) && !vus.has(c.numero)) { vus.add(c.numero); neufs.push({ numero: c.numero, libelle: c.libelle }); }
  if (neufs.length) { await DB.ins("comptes", neufs, { upsert: true, onConflict: "numero", ignore: true }); S.comptes = await DB.sel("comptes", { order: "numero" }); }
}
async function passer(e) {
  const comptes = new Set(S.comptes.map((c) => c.numero));
  for (const l of e.lignes) if (!comptes.has(l.compte)) throw new Error(`Compte ${l.compte} absent du plan comptable.`);
  const deb = S.params.debut_compta;
  if (deb && e.date < deb && e.journal !== "AN") throw new Error(`Date antérieure au début de la comptabilité (${fd(deb)}).`);
  const id = await DB.rpc("passer_ecriture", { p: e }); invalider(); return id;
}

/* ---------- Structure ---------- */
const ONGLETS = [
  ["bord", "Tableau de bord", () => true],
  ["caisse", "Caisse", () => true],
  ["fourn", "Fournisseurs", () => true],
  ["carbu", "Carburant", () => true],
  ["perso", "Personnel", () => true],
  ["compta", "Comptabilité", estCompta],
  ["param", "Paramètres", estGerant],
];
function rendre() {
  const tabs = ONGLETS.filter(([, , ok]) => ok());
  if (!tabs.some(([k]) => k === S.tab)) S.tab = "bord";
  $("#app").innerHTML = `
  <header class="top">
    <div class="brand"><h1>${esc(S.params.enseigne || "Station")}</h1><span>${esc(S.params.societe || "")}</span></div>
    <div class="ctx">
      <label class="small muted">Mois <input type="month" id="mois" value="${S.mois}"></label>
      <span class="small muted">${esc(S.nom)} · ${esc({ gerant: "Gérant", comptable: "Comptable", caissier: "Caisse" }[S.role] || S.role)}</span>
      <button class="link" id="mdp">Mon mot de passe</button>
      <button id="deco">Se déconnecter</button>
    </div>
  </header>
  <nav class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${k === S.tab}">${n}</button>`).join("")}</nav>
  <main id="vue"></main>`;
  $("#mois").onchange = (e) => { if (e.target.value) { S.mois = e.target.value; vue(); } };
  $("#deco").onclick = async () => { await DB.client.auth.signOut(); location.reload(); };
  $("#mdp").onclick = changerMdp;
  $$("nav.tabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; $$("nav.tabs button").forEach((x) => x.setAttribute("aria-selected", x === b)); vue(); }));
  vue();
}
async function vue() {
  const el = $("#vue"); el.innerHTML = `<div class="panel muted">Chargement…</div>`;
  try { await ({ bord: vBord, caisse: vCaisse, fourn: vFourn, carbu: vCarbu, perso: vPerso, compta: vCompta, param: vParam }[S.tab])(el); }
  catch (e) { console.error(e); el.innerHTML = `<div class="panel"><p class="bad">${esc(e.message)}</p></div>`; }
}
function sousOnglets(el, cle, liste, rendu) {
  const dispo = liste.filter((x) => !x[2] || x[2]());
  if (!dispo.some(([k]) => k === S.sub[cle])) S.sub[cle] = dispo[0][0];
  el.innerHTML = `<nav class="subtabs">${dispo.map(([k, n]) => `<button data-s="${k}" aria-pressed="${k === S.sub[cle]}">${n}</button>`).join("")}</nav><div id="sv"></div>`;
  $$(".subtabs button", el).forEach((b) => (b.onclick = () => { S.sub[cle] = b.dataset.s; sousOnglets(el, cle, liste, rendu); }));
  const sv = $("#sv", el); sv.innerHTML = `<div class="panel muted">Chargement…</div>`;
  Promise.resolve(rendu[S.sub[cle]](sv)).catch((e) => { console.error(e); sv.innerHTML = `<div class="panel"><p class="bad">${esc(e.message)}</p></div>`; });
}

/* =====================================================================
   TABLEAU DE BORD
   ===================================================================== */
function importsDuMois(m) { return S.imports.filter((i) => i.date_debut.slice(0, 7) === m && i.date_fin.slice(0, 7) === m); }
function sansDoublons(list) {
  // Garde le cumul mensuel s'il existe, sinon les journées ; signale les chevauchements
  const mens = list.filter((i) => i.date_debut !== i.date_fin);
  if (mens.length) return { liste: [mens.sort((a, b) => (b.date_fin > a.date_fin ? 1 : -1))[0]], chevauchement: list.length > 1 };
  return { liste: list, chevauchement: false };
}
function resumeImports(list) {
  const r = { carburant: 0, boutique: 0, autres: 0, total: 0, encaisse: 0, ecart: 0, litres: { GAZOLE: 0, "SANS PLOMB": 0 } };
  for (const i of list) {
    const d = i.data; const carbCpt = new Set((d.carburants || []).length ? ["707003", "707007"] : []);
    for (const v of d.ventes) { if (carbCpt.has(v.compte) || /GAZOLE|ESSENCE|SANS PLOMB/.test(C.norm(v.libelle))) r.carburant += v.ttc; else r.boutique += v.ttc; }
    r.autres += (d.autres || []).reduce((s, a) => s + a.ttc, 0);
    r.encaisse += d.totalEncaisse; r.ecart += d.ecart;
    for (const c of d.carburants || []) r.litres[c.produit] += c.litres;
  }
  r.total = r.carburant + r.boutique;
  return r;
}
async function vBord(el) {
  const m = S.mois; const { liste, chevauchement } = sansDoublons(importsDuMois(m)); const r = resumeImports(liste);
  const aPayer = S.factures.filter((f) => f.montant_ttc - f.regle > 0);
  const echues = aPayer.filter((f) => f.echeance && f.echeance < today());
  const aValider = S.factures.filter((f) => f.statut === "a_valider" && !f.historique);
  let res = null, treso = null, tgc = null;
  if (estCompta()) {
    const lm = await lignes(debutMois(m), finMois(m)); const bm = C.balance(lm, S.comptes);
    res = C.compteResultat(bm); tgc = C.declarationTgc(C.balance(lm.filter((l) => l.source !== "tgc"), S.comptes), liste);
    const lt = await lignes(null, finMois(m)); const bt = C.balance(lt, S.comptes);
    treso = { banque: bt.filter((b) => b.compte.startsWith("512")).reduce((s, b) => s + b.solde, 0), caisse: bt.filter((b) => b.compte.startsWith("53")).reduce((s, b) => s + b.solde, 0) };
  }
  const alertes = [];
  if (!liste.length) alertes.push(["warn", `Aucun décompte de caisse importé pour ${C.moisFr(m)}.`]);
  if (chevauchement) alertes.push(["warn", "Ce mois contient un cumul mensuel et des journées : seul le cumul est compté ici."]);
  if (r.ecart < 0) alertes.push(["bad", `Manque de caisse : ${F(-r.ecart)} sur ${C.moisFr(m)}.`]);
  if (echues.length && estCompta()) alertes.push(["warn", `${echues.length} facture(s) échue(s) non réglée(s), pour ${F(echues.reduce((s, f) => s + f.montant_ttc - f.regle, 0))}.`]);
  if (aValider.length && estCompta()) alertes.push(["warn", `${aValider.length} facture(s) déposée(s) à valider.`]);
  const rap = C.rapprochementCarburant(liste, S.cuves).filter((x) => x.ecart != null && Math.abs(x.ecartPct) > 0.5);
  for (const x of rap) alertes.push(["bad", `Écart cuve ${x.produit} : ${fmt(x.ecart)} L (${x.ecartPct.toFixed(2)} % des ventes).`]);

  // CA des 12 derniers mois
  const mois12 = [...Array(12)].map((_, i) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 - (11 - i), 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const serie = mois12.map((mm) => ({ m: mm, ...resumeImports(sansDoublons(importsDuMois(mm)).liste) }));
  el.innerHTML = `
  <div class="kpis">
    ${kpi("Chiffre d'affaires TTC", F(r.total), `Carburant ${F(r.carburant)} · Boutique ${F(r.boutique)}`)}
    ${kpi("Litres vendus", L(r.litres.GAZOLE + r.litres["SANS PLOMB"]), `Gazole ${L(r.litres.GAZOLE)} · SP ${L(r.litres["SANS PLOMB"])}`)}
    ${kpi("Écart de caisse", F(r.ecart), r.ecart < 0 ? "Manque" : r.ecart > 0 ? "Excédent" : "Caisse juste", r.ecart < 0 ? "bad" : "")}
    ${estCompta() ? kpi("Factures à payer", F(aPayer.reduce((s, f) => s + f.montant_ttc - f.regle, 0)), `${echues.length} échue(s)`, echues.length ? "warn" : "") : ""}
    ${res ? kpi("Résultat du mois", F(res.resultat), `Marge commerciale ${F(res.margeCommerciale)}`, res.resultat < 0 ? "bad" : "ok") : ""}
    ${treso ? kpi("Trésorerie", F(treso.banque + treso.caisse), `Banque ${F(treso.banque)} · Caisse et cartes ${F(treso.caisse)}`) : ""}
    ${tgc ? kpi("TGC du mois", F(tgc.net), `Collectée ${F(tgc.collectee)} · Déductible ${F(tgc.deductible)}`) : ""}
  </div>
  <div class="panel"><h2>À surveiller</h2>${alertes.length ? `<ul class="alerts">${alertes.map(([t, a]) => `<li class="${t}">${esc(a)}</li>`).join("")}</ul>` : `<p class="muted">Rien à signaler.</p>`}</div>
  <div class="panel"><h2>Chiffre d'affaires TTC sur 12 mois</h2>${grapheBarres(serie)}</div>`;
}
function kpi(t, v, s, cls = "") { return `<div class="kpi ${cls}"><div class="kpi-t">${esc(t)}</div><div class="kpi-v num">${esc(v)}</div><div class="kpi-s">${esc(s)}</div></div>`; }
function grapheBarres(serie) {
  const max = Math.max(1, ...serie.map((s) => s.total)); const W = 720, H = 220, pad = 30, bw = (W - pad) / serie.length;
  const bars = serie.map((s, i) => {
    const x = pad + i * bw + 4, w = bw - 8; const hc = (s.carburant / max) * (H - 40), hb = (s.boutique / max) * (H - 40);
    return `<g><title>${C.moisFr(s.m)} : ${F(s.total)} (carburant ${F(s.carburant)}, boutique ${F(s.boutique)})</title>
      <rect x="${x}" y="${H - 20 - hc}" width="${w}" height="${hc}" fill="var(--accent)" rx="2"/>
      <rect x="${x}" y="${H - 20 - hc - hb}" width="${w}" height="${hb}" fill="var(--accent-2)" rx="2"/>
      <text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" class="ax">${C.MOIS[+s.m.slice(5, 7) - 1].slice(0, 3)}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Chiffre d'affaires mensuel">${bars}
    <text x="0" y="12" class="ax">${fmt(max / 1e6)} MF</text></svg>
    <div class="legend"><span><i style="background:var(--accent)"></i>Carburant</span><span><i style="background:var(--accent-2)"></i>Boutique</span></div>`;
}

/* =====================================================================
   CAISSE (EURODATA)
   ===================================================================== */
async function lireXlsx(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellNF: true });
}
async function vCaisse(el) {
  const m = S.mois; const liste = S.imports.filter((i) => i.date_fin.slice(0, 7) === m || i.date_debut.slice(0, 7) === m);
  el.innerHTML = `
  <div class="panel">
    <div class="row"><h2 class="grow">Décomptes de caisse EURODATA · ${C.moisFr(m)}</h2>
      ${estCompta() ? `<button id="rb">Remise en banque</button>` : ""}<label class="btn primary">Importer des décomptes (.xlsx)<input type="file" id="fz" accept=".xlsx,.xls" multiple hidden></label></div>
    <p class="small muted">Dans EURODATA, exportez le « Décompte de caisse cumulé » au format Excel, de préférence chaque jour. Un cumul mensuel fonctionne aussi, mais il ne faut pas comptabiliser à la fois le mois et ses journées.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Période</th><th class="num">Ventes TTC</th><th class="num">Encaissé</th><th class="num">Écart</th><th class="num">Litres</th><th>Statut</th><th></th></tr></thead><tbody>
    ${liste.map((i) => { const d = i.data; const lit = (d.carburants || []).reduce((s, c) => s + c.litres, 0);
      return `<tr><td>${i.date_debut === i.date_fin ? fd(i.date_debut) : fd(i.date_debut) + " → " + fd(i.date_fin)}</td><td class="num">${F(d.totalDu)}</td><td class="num">${F(d.totalEncaisse)}</td>
      <td class="num">${d.ecart ? chip(F(d.ecart), d.ecart < 0 ? "bad" : "warn") : chip("0", "ok")}</td><td class="num">${fmt(lit)}</td>
      <td>${i.statut === "comptabilise" ? chip("Comptabilisé", "ok") : chip("Brouillon", "warn")}</td>
      <td class="actions"><button data-voir="${i.id}">Voir</button>${estCompta() && i.statut !== "comptabilise" ? `<button class="primary" data-cpt="${i.id}">Comptabiliser</button><button class="link danger" data-sup="${i.id}">Supprimer</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">Aucun décompte pour ce mois.</td></tr>`}
    </tbody></table></div>
  </div>`;
  $("#fz").onchange = (e) => importerDecomptes([...e.target.files]);
  if ($("#rb")) $("#rb").onclick = remiseBanque;
  $$("[data-voir]", el).forEach((b) => (b.onclick = () => voirDecompte(S.imports.find((i) => i.id === b.dataset.voir))));
  $$("[data-cpt]", el).forEach((b) => (b.onclick = () => comptabiliserDecompte(S.imports.find((i) => i.id === b.dataset.cpt))));
  $$("[data-sup]", el).forEach((b) => (b.onclick = async () => { if (!confirm("Supprimer ce décompte (brouillon) ?")) return; await action(async () => { await DB.del("caisse_imports", { id: b.dataset.sup }); S.imports = S.imports.filter((i) => i.id !== b.dataset.sup); vue(); }, "Décompte supprimé"); }));
}
async function importerDecomptes(files) {
  let n = 0;
  for (const f of files) {
    await action(async () => {
      const wb = await lireXlsx(f); const rows = C.lireFeuille(XLSX, wb.Sheets[wb.SheetNames[0]]);
      const d = C.lireDecompteEurodata(rows);
      if (d.societe && !/BOULOUPARIS/i.test(d.societe)) throw new Error(`${f.name} : ce décompte concerne « ${d.societe} ».`);
      const exist = S.imports.find((i) => i.date_debut === d.periode.debut && i.date_fin === d.periode.fin);
      if (exist) { if (exist.statut === "comptabilise") throw new Error(`${f.name} : la période est déjà importée et comptabilisée.`); if (!confirm(`La période ${fd(d.periode.debut)} – ${fd(d.periode.fin)} est déjà importée. La remplacer ?`)) return; await DB.del("caisse_imports", { id: exist.id }); }
      const row = await DB.ins("caisse_imports", { date_debut: d.periode.debut, date_fin: d.periode.fin, fichier: f.name, data: d, total_ttc: d.totalDu, ecart: d.ecart });
      S.imports = [row, ...S.imports.filter((i) => i.id !== exist?.id)].sort((a, b) => (a.date_debut < b.date_debut ? 1 : -1));
      S.mois = d.periode.fin.slice(0, 7); n++;
      if (d.alertes.length) toast(f.name + " : " + d.alertes.join(" "), "warn");
    });
  }
  if (n) toast(`${n} décompte(s) importé(s)`);
  rendre();
}
function voirDecompte(i) {
  const d = i.data; let e = null, err = "";
  try { e = C.ecritureCaisse(d, { compteAutresRecettes: S.params.compte_autres_recettes }); } catch (x) { err = x.message; }
  const carb = d.ventes.filter((v) => ["707003", "707007"].includes(v.compte) || /GAZOLE|ESSENCE/.test(C.norm(v.libelle)));
  const shop = d.ventes.filter((v) => !carb.includes(v));
  const parFam = {}; for (const v of shop) { const fam = v.libelle.replace(/\s+(EX|TS\d)$/i, ""); parFam[fam] = (parFam[fam] || 0) + v.ttc; }
  modal(`Décompte ${fd(i.date_debut)} – ${fd(i.date_fin)}`, `
    <div class="split">
      <div class="panel flat"><h3>Ventes</h3><table>
        ${carb.map((v) => `<tr><td>${esc(v.libelle)}</td><td class="num">${fmt(v.quantite)} L</td><td class="num">${F(v.ttc)}</td></tr>`).join("")}
        ${Object.entries(parFam).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td></td><td class="num">${F(v)}</td></tr>`).join("")}
        ${d.autres.map((a) => `<tr><td>${esc(a.libelle)}</td><td></td><td class="num">${F(a.ttc)}</td></tr>`).join("")}
        <tr class="total"><td>Total dû</td><td></td><td class="num">${F(d.totalDu)}</td></tr></table></div>
      <div class="panel flat"><h3>Encaissements</h3><table>
        ${d.encaissements.map((x) => `<tr><td>${esc(x.libelle)}</td><td class="num">${F(x.montant)}</td></tr>`).join("")}
        <tr class="total"><td>Total encaissé</td><td class="num">${F(d.totalEncaisse)}</td></tr>
        <tr class="${d.ecart < 0 ? "bad" : ""}"><td>Écart de caisse</td><td class="num">${F(d.ecart)}</td></tr></table>
        <h3>TGC collectée</h3><table>${e ? Object.entries(e.tgc).map(([t, v]) => `<tr><td>${t} %</td><td class="num">${F(v)}</td></tr>`).join("") : ""}</table></div>
    </div>
    ${err ? `<p class="bad">${esc(err)}</p>` : `<details><summary>Écriture comptable (${e.lignes.length} lignes)</summary>${tableEcriture(e)}</details>`}`, { large: true });
}
function tableEcriture(e) {
  const D = e.lignes.reduce((s, l) => s + l.debit, 0), Cr = e.lignes.reduce((s, l) => s + l.credit, 0);
  return `<div class="tbl-wrap"><table><thead><tr><th>Compte</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th></tr></thead><tbody>
  ${e.lignes.map((l) => `<tr><td class="mono">${esc(l.compte)}</td><td>${esc(l.libelle || libCompte(l.compte))}</td><td class="num">${l.debit ? fmt(l.debit) : ""}</td><td class="num">${l.credit ? fmt(l.credit) : ""}</td></tr>`).join("")}
  <tr class="total"><td></td><td>Total</td><td class="num">${fmt(D)}</td><td class="num">${fmt(Cr)}</td></tr></tbody></table></div>`;
}
async function comptabiliserDecompte(i) {
  const chev = S.imports.find((x) => x.id !== i.id && x.statut === "comptabilise" && x.date_debut <= i.date_fin && x.date_fin >= i.date_debut);
  if (chev) return toast(`Impossible : la période chevauche un décompte déjà comptabilisé (${fd(chev.date_debut)} – ${fd(chev.date_fin)}).`, "bad");
  await action(async () => {
    const e = C.ecritureCaisse(i.data, { compteAutresRecettes: S.params.compte_autres_recettes });
    await assurerComptes(e.nouveauxComptes);
    await passer({ journal: e.journal, date: e.date, piece: e.piece, libelle: e.libelle, source: "caisse", source_id: i.id, lignes: e.lignes });
    i.statut = "comptabilise"; vue();
  }, "Décompte comptabilisé");
}

async function remiseBanque() {
  const comptes = S.comptes.filter((c) => /^53\d{4}$/.test(c.numero) && c.numero !== "531000" && c.actif);
  const bt = C.balance(await lignes(null, today()), S.comptes);
  const solde = (n) => (bt.find((b) => b.compte === n) || {}).solde || 0;
  const m = modal("Remise en banque", `<p class="small muted">Sort de la caisse ce qui est arrivé sur le compte BNC : dépôt d'espèces ou de chèques, versement des cartes bancaires (avec la commission retenue par la banque).</p>
    <form class="form" id="frb"><label>Date (relevé bancaire)<input type="date" name="date" value="${today()}" required></label>
    <label>Quoi<select name="compte">${comptes.map((c) => `<option value="${c.numero}">${esc(c.libelle)} · en caisse ${fmt(solde(c.numero))} F</option>`).join("")}</select></label>
    <label>Montant remis (brut)<input type="number" name="montant" required></label><label>Commission bancaire<input type="number" name="commission" value="0"></label>
    <label>Arrivé sur<input name="banque" class="mono" list="dl_rb" value="512000"></label>${datalistComptes("dl_rb", (n) => /^(51|40|46)/.test(n))}
    <label>Référence<input name="piece"></label></form>
    <p class="small muted">Pour la carte MOBIL, si le montant vient en déduction des factures carburant, choisissez le compte du fournisseur dans « Arrivé sur ».</p>
    <div class="row end"><button class="primary" id="rbok">Comptabiliser</button></div>`);
  $("#rbok", m).onclick = () => action(async () => {
    const f = $("#frb", m); if (!f.reportValidity()) return;
    const mt = C.int(f.montant.value), com = C.int(f.commission.value); if (mt <= 0 || com < 0 || com >= mt) throw new Error("Montants invalides.");
    const lib = libCompte(f.compte.value);
    await passer({ journal: "BQ", date: f.date.value, piece: f.piece.value || null, libelle: "Remise " + lib.toLowerCase(), source: "od",
      lignes: [{ compte: f.banque.value.trim(), libelle: "Remise " + lib, debit: mt - com, credit: 0 }, { compte: "627000", libelle: "Commission", debit: com, credit: 0 }, { compte: f.compte.value, libelle: lib, debit: 0, credit: mt }] });
    m.remove();
  }, "Remise comptabilisée");
}

/* =====================================================================
   FOURNISSEURS
   ===================================================================== */
const reste = (f) => f.montant_ttc - f.regle;
function vFourn(el) {
  sousOnglets(el, "fourn", [["fac", "Factures"], ["ech", "À payer", estCompta], ["reg", "Règlements", estCompta], ["tiers", "Fournisseurs", estCompta], ["rep", "Reprise Excel", estCompta]],
    { fac: vFactures, ech: vEcheancier, reg: vReglements, tiers: vTiers, rep: vReprise });
}
function vFactures(el) {
  const f0 = S.sub.facFiltre || { q: "", statut: "", tout: false };
  const m = S.mois;
  let list = S.factures.filter((f) => f0.tout || f.date_facture.slice(0, 7) === m);
  if (f0.statut === "a_valider") list = list.filter((f) => f.statut === "a_valider" && !f.historique);
  if (f0.statut === "hist") list = list.filter((f) => f.historique && f.statut !== "comptabilisee");
  if (f0.statut === "impaye") list = list.filter((f) => reste(f) > 0);
  if (f0.q) { const q = C.norm(f0.q); list = list.filter((f) => C.norm((tiersPar(f.tiers_id) || {}).nom).includes(q) || C.norm(f.numero).includes(q)); }
  el.innerHTML = `<div class="panel">
    <div class="row"><h2 class="grow">Factures fournisseurs</h2><button class="primary" id="nf">Nouvelle facture</button></div>
    <div class="row small">
      <input id="fq" placeholder="Fournisseur ou n°" value="${esc(f0.q)}">
      <select id="fs"><option value="">Toutes</option><option value="a_valider" ${f0.statut === "a_valider" ? "selected" : ""}>À valider</option><option value="impaye" ${f0.statut === "impaye" ? "selected" : ""}>Non réglées</option><option value="hist" ${f0.statut === "hist" ? "selected" : ""}>Reprises hors comptabilité</option></select>
      <label><input type="checkbox" id="ft" ${f0.tout ? "checked" : ""}> Tous les mois</label>
      <span class="grow"></span><span class="muted">${list.length} facture(s) · ${F(list.reduce((s, f) => s + f.montant_ttc, 0))}</span>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Fournisseur</th><th>N°</th><th>Catégorie</th><th class="num">TTC</th><th class="num">Reste</th><th>Échéance</th><th>Statut</th><th></th></tr></thead><tbody>
    ${list.slice(0, 500).map((f) => `<tr class="click" data-f="${f.id}"><td>${fd(f.date_facture)}</td><td>${esc((tiersPar(f.tiers_id) || {}).nom)}</td><td>${esc(f.numero)}</td><td>${esc(f.categorie)}</td>
      <td class="num">${fmt(f.montant_ttc)}</td><td class="num">${reste(f) ? fmt(reste(f)) : chip("Réglée", "ok")}</td><td>${f.echeance ? (f.echeance < today() && reste(f) > 0 ? chip(fd(f.echeance), "bad") : fd(f.echeance)) : ""}</td>
      <td>${f.statut === "comptabilisee" ? chip("Comptabilisée", "ok") : f.historique ? chip("Reprise", "info") : chip("À valider", "warn")}</td><td>${f.fichier ? "📎" : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">Aucune facture.</td></tr>`}
    </tbody></table></div>${list.length > 500 ? `<p class="small muted">500 premières lignes affichées : affinez la recherche.</p>` : ""}
  </div>`;
  const maj = () => { S.sub.facFiltre = { q: $("#fq").value, statut: $("#fs").value, tout: $("#ft").checked }; vFactures(el); };
  $("#fq").onchange = maj; $("#fs").onchange = maj; $("#ft").onchange = maj;
  $("#nf").onclick = () => formFacture(null, () => vFactures(el));
  $$("[data-f]", el).forEach((tr) => (tr.onclick = () => formFacture(S.factures.find((f) => f.id === tr.dataset.f), () => vFactures(el))));
}
function optionsCategories(sel) { return Object.keys(S.params.categories || {}).sort().map((k) => `<option ${k === sel ? "selected" : ""}>${esc(k)}</option>`).join(""); }
function datalistComptes(id, filtre = () => true) { return `<datalist id="${id}">${S.comptes.filter((c) => c.actif && filtre(c.numero)).map((c) => `<option value="${c.numero}">${esc(c.libelle)}</option>`).join("")}</datalist>`; }
function formFacture(f, apres) {
  const neuf = !f; f = f || { date_facture: today(), ventilation: [], montant_ttc: 0, regle: 0, statut: "a_valider" };
  const t = tiersPar(f.tiers_id);
  const verrou = f.statut === "comptabilisee";
  const vent = f.ventilation?.length ? f.ventilation : [];
  const m = modal(neuf ? "Nouvelle facture" : `Facture ${t?.nom || ""} ${f.numero || ""}`, `
    <form id="ff" class="form">
      <label>Fournisseur<input name="tiers" list="dl_t" required value="${esc(t?.nom || "")}" ${verrou ? "disabled" : ""}></label>
      <datalist id="dl_t">${S.tiers.map((x) => `<option value="${esc(x.nom)}">`).join("")}</datalist>
      <label>N° de facture<input name="numero" value="${esc(f.numero || "")}" ${verrou ? "disabled" : ""}></label>
      <label>Date<input type="date" name="date_facture" required value="${f.date_facture}" ${verrou ? "disabled" : ""}></label>
      <label>Échéance<input type="date" name="echeance" value="${f.echeance || ""}"></label>
      <label>Catégorie<select name="categorie" ${verrou ? "disabled" : ""}><option value=""></option>${optionsCategories(f.categorie)}</select></label>
      <label>Montant TTC (F)<input type="number" name="montant_ttc" required step="1" value="${f.montant_ttc || ""}" ${verrou ? "disabled" : ""}></label>
      <label class="wide">Libellé<input name="libelle" value="${esc(f.libelle || "")}" ${verrou ? "disabled" : ""}></label>
    </form>
    ${estCompta() ? `<h3>Ventilation HT / TGC</h3>
    <p class="small muted">Une ligne par taux de TGC figurant sur la facture. Sans ventilation, tout le montant va sur le compte de la catégorie, sans TGC déductible.</p>
    ${datalistComptes("dl_c", (n) => /^[2-6]/.test(n))}
    <div class="tbl-wrap"><table id="tv"><thead><tr><th>Compte</th><th>Taux TGC</th><th class="num">HT</th><th class="num">TGC</th><th></th></tr></thead><tbody></tbody>
      <tfoot><tr class="total"><td colspan="2">Total <span id="vc" class="small"></span></td><td class="num" id="vht"></td><td class="num" id="vtg"></td><td></td></tr></tfoot></table></div>
    ${verrou ? "" : `<div class="row"><button type="button" id="va">Ajouter une ligne</button><button type="button" id="vauto">Tout au taux…</button></div>`}` : ""}
    <div class="row">
      ${f.fichier ? `<button type="button" id="vp">Voir la pièce</button>` : ""}
      ${!verrou ? `<label class="btn">${f.fichier ? "Remplacer" : "Joindre"} la pièce (photo ou PDF)<input type="file" id="pj" accept="image/*,application/pdf" capture="environment" hidden></label><span id="pjn" class="small muted"></span>` : ""}
    </div>
    ${f.historique && !verrou ? `<p class="small muted">Facture reprise du fichier Excel : elle n'est pas en comptabilité. Comptabilisez-la seulement si elle est postérieure au début de la comptabilité et n'est pas dans les à-nouveaux.</p>` : ""}
    <div class="row end">
      ${!neuf && !verrou && estCompta() ? `<button type="button" class="danger" id="fdel">Supprimer</button>` : ""}
      ${verrou && estCompta() ? `<button type="button" class="danger" id="fdec">Annuler l'écriture</button>` : ""}
      <span class="grow"></span>
      <button type="button" id="fsave">Enregistrer</button>
      ${estCompta() && !verrou ? `<button type="button" class="primary" id="fpost">Enregistrer et comptabiliser</button>` : ""}
    </div>`, { large: true });
  const form = $("#ff", m);
  const tb = $("#tv tbody", m);
  const ligneV = (v = { compte: "", taux: 0, ht: "", tgc: "" }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input list="dl_c" class="vc mono" value="${esc(v.compte)}" ${verrou ? "disabled" : ""}></td>
      <td><select class="vt" ${verrou ? "disabled" : ""}>${C.TAUX.map((x) => `<option value="${x}" ${+v.taux === x ? "selected" : ""}>${x} %</option>`).join("")}</select></td>
      <td><input type="number" class="vh" value="${v.ht}" ${verrou ? "disabled" : ""}></td><td><input type="number" class="vg" value="${v.tgc}" ${verrou ? "disabled" : ""}></td>
      <td>${verrou ? "" : `<button type="button" class="link danger vx">×</button>`}</td>`;
    tb.appendChild(tr);
    $(".vh", tr).oninput = () => { $(".vg", tr).value = Math.round(C.num($(".vh", tr).value) * +$(".vt", tr).value / 100); tot(); };
    $(".vt", tr).onchange = () => { $(".vh", tr).oninput(); };
    $(".vg", tr).oninput = tot; $(".vx", tr) && ($(".vx", tr).onclick = () => { tr.remove(); tot(); });
  };
  const lireV = () => (tb ? $$("tr", tb).map((tr) => ({ compte: $(".vc", tr).value.trim(), taux: +$(".vt", tr).value, ht: C.int($(".vh", tr).value), tgc: C.int($(".vg", tr).value) })).filter((v) => v.compte || v.ht) : f.ventilation || []);
  const tot = () => {
    if (!tb) return; const v = lireV(); const ht = v.reduce((s, x) => s + x.ht, 0), tg = v.reduce((s, x) => s + x.tgc, 0);
    $("#vht", m).textContent = fmt(ht); $("#vtg", m).textContent = fmt(tg);
    const ttc = C.int(form.montant_ttc.value); const d = ttc - ht - tg;
    $("#vc", m).innerHTML = v.length ? (d === 0 ? chip("équilibré", "ok") : chip(`écart ${fmt(d)}`, "bad")) : "";
  };
  if (tb) { vent.forEach(ligneV); tot(); }
  const compteCat = () => (S.params.categories || {})[form.categorie.value] || "471000";
  if ($("#va", m)) $("#va", m).onclick = () => ligneV({ compte: compteCat(), taux: 0, ht: "", tgc: "" });
  if ($("#vauto", m)) $("#vauto", m).onclick = () => {
    const t = prompt("Taux de TGC appliqué à toute la facture (0, 3, 6, 11 ou 22) :", "11"); if (t == null) return;
    const taux = +t; if (!C.TAUX.includes(taux)) return toast("Taux invalide", "bad");
    const ttc = C.int(form.montant_ttc.value); const ht = Math.round(ttc / (1 + taux / 100));
    tb.innerHTML = ""; ligneV({ compte: compteCat(), taux, ht, tgc: ttc - ht }); tot();
  };
  form.montant_ttc && (form.montant_ttc.oninput = tot);
  form.date_facture.onchange = () => { const tt = S.tiers.find((x) => x.nom === form.tiers.value); if (!form.echeance.value) form.echeance.value = addDays(form.date_facture.value, tt?.delai_jours ?? 30); };
  form.tiers.onchange = () => { const tt = S.tiers.find((x) => C.cleFournisseur(x.nom) === C.cleFournisseur(form.tiers.value)); if (tt) { form.tiers.value = tt.nom; if (tt.categorie && !form.categorie.value) form.categorie.value = tt.categorie; } form.date_facture.onchange(); };
  let fichier = null; if ($("#pj", m)) $("#pj", m).onchange = (e) => { fichier = e.target.files[0]; $("#pjn", m).textContent = fichier ? fichier.name : ""; };
  if ($("#vp", m)) $("#vp", m).onclick = async () => { const u = await action(() => DB.lien(f.fichier)); if (u) window.open(u, "_blank"); };

  async function enregistrer() {
    if (!form.reportValidity()) return null;
    const nom = form.tiers.value.trim().toUpperCase();
    let tt = S.tiers.find((x) => C.cleFournisseur(x.nom) === C.cleFournisseur(nom));
    if (!tt) {
      if (!estCompta()) throw new Error("Fournisseur inconnu : demandez au comptable de le créer, ou choisissez-le dans la liste.");
      tt = await DB.ins("tiers", { nom, categorie: form.categorie.value || null }); S.tiers.push(tt); S.tiers.sort((a, b) => a.nom.localeCompare(b.nom));
    }
    let chemin = f.fichier || null;
    if (fichier) chemin = await DB.upload(`factures/${form.date_facture.value.slice(0, 7)}/${uid()}-${fichier.name.replace(/[^\w.\-]/g, "_")}`, fichier);
    const row = verrou ? { echeance: form.echeance.value || null } : {
      tiers_id: tt.id, numero: form.numero.value.trim() || null, date_facture: form.date_facture.value, echeance: form.echeance.value || null,
      categorie: form.categorie.value || null, libelle: form.libelle.value.trim() || null, montant_ttc: C.int(form.montant_ttc.value), ventilation: lireV(), fichier: chemin,
    };
    if (neuf) {
      const dbl = S.factures.find((x) => x.tiers_id === tt.id && x.numero && x.numero === row.numero);
      if (dbl && !confirm(`La facture ${row.numero} de ${tt.nom} existe déjà. Enregistrer quand même ?`)) return null;
      f = await DB.ins("factures", row); S.factures.unshift(f);
    } else { f = await DB.upd("factures", { id: f.id }, row); S.factures = S.factures.map((x) => (x.id === f.id ? f : x)); }
    return f;
  }
  $("#fsave", m).onclick = () => action(async () => { if (await enregistrer()) { m.remove(); apres(); } }, "Facture enregistrée");
  if ($("#fpost", m)) $("#fpost", m).onclick = () => action(async () => {
    const v = lireV(); if (v.length) { const d = C.int(form.montant_ttc.value) - v.reduce((s, x) => s + x.ht + x.tgc, 0); if (d) throw new Error(`La ventilation ne correspond pas au TTC (écart ${fmt(d)}).`); }
    const ff = await enregistrer(); if (!ff) return;
    await comptabiliserFacture(ff); m.remove(); apres();
  }, "Facture comptabilisée");
  if ($("#fdel", m)) $("#fdel", m).onclick = () => { if (confirm("Supprimer cette facture ?")) action(async () => { await DB.del("factures", { id: f.id }); S.factures = S.factures.filter((x) => x.id !== f.id); m.remove(); apres(); }, "Facture supprimée"); };
  if ($("#fdec", m)) $("#fdec", m).onclick = () => { if (confirm("Supprimer l'écriture comptable de cette facture ? La facture repassera « à valider ».")) action(async () => { await DB.rpc("supprimer_ecriture", { p_id: f.ecriture_id }); invalider(); f.statut = "a_valider"; f.ecriture_id = null; m.remove(); apres(); }, "Écriture annulée"); };
}
async function comptabiliserFacture(f) {
  const t = tiersPar(f.tiers_id);
  const e = C.ecritureFacture(f, t, (S.params.categories || {})[f.categorie]);
  await passer(e); f.statut = "comptabilisee";
}
function vEcheancier(el) {
  const ouverts = S.factures.filter((f) => reste(f) !== 0);
  const parT = new Map(); for (const f of ouverts) { if (!parT.has(f.tiers_id)) parT.set(f.tiers_id, []); parT.get(f.tiers_id).push(f); }
  const groupes = [...parT.entries()].map(([id, fs]) => ({ t: tiersPar(id), fs: fs.sort((a, b) => (a.echeance || a.date_facture).localeCompare(b.echeance || b.date_facture)), total: fs.reduce((s, f) => s + reste(f), 0) })).sort((a, b) => b.total - a.total);
  const total = groupes.reduce((s, g) => s + g.total, 0);
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Factures à payer · ${F(total)}</h2><button class="primary" id="rsel" disabled>Régler la sélection</button></div>
  <p class="small muted">Cochez les factures d'un même fournisseur, puis « Régler la sélection ». Les avoirs (montants négatifs) se déduisent.</p>
  ${groupes.map((g) => `<details class="grp"><summary><b>${esc(g.t?.nom)}</b> <span class="num">${F(g.total)}</span> <span class="small muted">${g.fs.length} pièce(s)${g.fs.some((f) => f.echeance && f.echeance < today()) ? " · " + chip("échu", "bad") : ""}</span></summary>
    <table>${g.fs.map((f) => `<tr><td><input type="checkbox" class="sel" data-id="${f.id}" data-t="${f.tiers_id}"></td><td>${fd(f.date_facture)}</td><td>${esc(f.numero)}</td><td>${esc(f.categorie)}</td><td>${f.echeance ? fd(f.echeance) : ""}</td><td class="num">${fmt(reste(f))}</td><td>${f.historique ? chip("Reprise", "info") : ""}</td></tr>`).join("")}</table></details>`).join("")}</div>`;
  const maj = () => { const s = $$(".sel:checked", el); const ts = new Set(s.map((x) => x.dataset.t)); $("#rsel").disabled = !s.length || ts.size > 1; $("#rsel").textContent = s.length ? `Régler ${s.length} pièce(s) · ${F(s.reduce((a, x) => a + reste(S.factures.find((f) => f.id === x.dataset.id)), 0))}` : "Régler la sélection"; };
  $$(".sel", el).forEach((c) => (c.onchange = maj));
  $("#rsel").onclick = () => formReglement($$(".sel:checked", el).map((x) => S.factures.find((f) => f.id === x.dataset.id)), () => vEcheancier(el));
}
function formReglement(fs, apres) {
  const t = tiersPar(fs[0].tiers_id); const mt = fs.reduce((s, f) => s + reste(f), 0);
  const modes = Object.keys(S.params.modes || { VIREMENT: "512000" });
  const m = modal(`Règlement ${t.nom}`, `<form class="form" id="fr">
    <label>Date<input type="date" name="date" value="${today()}" required></label>
    <label>Mode<select name="mode">${modes.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label>
    <label>Référence (n° de chèque, virement…)<input name="reference"></label>
    <label>Montant<input type="number" name="montant" value="${mt}" required></label>
  </form><p class="small muted">${fs.length} pièce(s) : ${fs.map((f) => esc(f.numero || fd(f.date_facture))).join(", ")}. L'écriture de banque (ou de caisse pour les espèces) est passée automatiquement.</p>
  <div class="row end"><button class="primary" id="rok">Enregistrer le règlement</button></div>`);
  $("#rok", m).onclick = () => action(async () => {
    const fm = $("#fr", m); if (!fm.reportValidity()) return;
    const montant = C.int(fm.montant.value); if (montant <= 0) throw new Error("Montant invalide.");
    const r = await DB.ins("reglements", { tiers_id: t.id, date: fm.date.value, mode: fm.mode.value, compte_tresorerie: (S.params.modes || {})[fm.mode.value] || "512000", montant, reference: fm.reference.value || null, factures: fs.map((f) => f.id) });
    // Impute le montant sur les factures, avoirs d'abord
    let dispo = montant + fs.filter((f) => reste(f) < 0).reduce((s, f) => s - reste(f), 0);
    for (const f of fs.sort((a, b) => reste(a) - reste(b))) {
      const part = reste(f) < 0 ? reste(f) : Math.min(reste(f), dispo); if (reste(f) > 0) dispo -= part;
      const nf = await DB.upd("factures", { id: f.id }, { regle: f.regle + part }); Object.assign(f, nf);
    }
    await passer(C.ecritureReglement(r, t)); S.reglements.unshift(r); m.remove(); apres();
  }, "Règlement enregistré et comptabilisé");
}
function vReglements(el) {
  const m = S.mois; const list = S.reglements.filter((r) => r.date.slice(0, 7) === m);
  el.innerHTML = `<div class="panel"><h2>Règlements · ${C.moisFr(m)}</h2><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Fournisseur</th><th>Mode</th><th>Référence</th><th class="num">Montant</th><th>Comptabilité</th></tr></thead><tbody>
  ${list.map((r) => `<tr><td>${fd(r.date)}</td><td>${esc(tiersPar(r.tiers_id)?.nom)}</td><td>${esc(r.mode)}</td><td>${esc(r.reference)}</td><td class="num">${fmt(r.montant)}</td><td>${r.ecriture_id ? chip("Passé", "ok") : r.historique ? chip("Reprise", "info") : chip("Non passé", "warn")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Aucun règlement ce mois.</td></tr>`}
  </tbody><tfoot><tr class="total"><td colspan="4">Total</td><td class="num">${fmt(list.reduce((s, r) => s + r.montant, 0))}</td><td></td></tr></tfoot></table></div></div>`;
}
function vTiers(el) {
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Fournisseurs et organismes</h2><button class="primary" id="nt">Nouveau</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Compte</th><th>Catégorie</th><th class="num">Délai</th><th class="num">Reste dû</th></tr></thead><tbody>
  ${S.tiers.map((t) => `<tr class="click" data-t="${t.id}"><td>${esc(t.nom)}</td><td>${esc(t.type)}</td><td class="mono">${esc(t.compte)}</td><td>${esc(t.categorie)}</td><td class="num">${t.delai_jours ?? ""} j</td><td class="num">${fmt(S.factures.filter((f) => f.tiers_id === t.id).reduce((s, f) => s + reste(f), 0))}</td></tr>`).join("")}
  </tbody></table></div><p class="small muted">Pour la CAFAT, le service de la Recette ou une caisse de retraite, mettez le type « organisme » et le compte de dette correspondant (431000, 445510, 437000) : leurs règlements soldent alors la bonne dette.</p></div>`;
  const ouvrir = (t) => {
    const n = !t; t = t || { type: "fournisseur", compte: "401000", delai_jours: 30 };
    const m = modal(n ? "Nouveau tiers" : t.nom, `<form class="form" id="ft">
      <label>Nom<input name="nom" required value="${esc(t.nom || "")}"></label>
      <label>Type<select name="type">${["fournisseur", "organisme", "client", "autre"].map((x) => `<option ${x === t.type ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Compte<input name="compte" list="dl_c4" class="mono" value="${esc(t.compte)}"></label>${datalistComptes("dl_c4", (x) => x.startsWith("4"))}
      <label>Catégorie par défaut<select name="categorie"><option value=""></option>${optionsCategories(t.categorie)}</select></label>
      <label>Délai de paiement (jours)<input type="number" name="delai_jours" value="${t.delai_jours ?? 30}"></label>
      <label class="wide">Notes<input name="notes" value="${esc(t.notes || "")}"></label></form>
      <div class="row end"><button class="primary" id="tok">Enregistrer</button></div>`);
    $("#tok", m).onclick = () => action(async () => {
      const fm = $("#ft", m); if (!fm.reportValidity()) return;
      const row = { nom: fm.nom.value.trim().toUpperCase(), type: fm.type.value, compte: fm.compte.value.trim(), categorie: fm.categorie.value || null, delai_jours: +fm.delai_jours.value || 0, notes: fm.notes.value || null };
      if (n) S.tiers.push(await DB.ins("tiers", row)); else { const r = await DB.upd("tiers", { id: t.id }, row); S.tiers = S.tiers.map((x) => (x.id === r.id ? r : x)); }
      S.tiers.sort((a, b) => a.nom.localeCompare(b.nom)); m.remove(); vTiers(el);
    }, "Enregistré");
  };
  $("#nt").onclick = () => ouvrir(null);
  $$("[data-t]", el).forEach((tr) => (tr.onclick = () => ouvrir(tiersPar(tr.dataset.t))));
}
function vReprise(el) {
  el.innerHTML = `<div class="panel"><h2>Reprise du fichier « Règlement fournisseurs »</h2>
  <p>Importe l'onglet <b>RECAP PAIEMENTS</b> de votre fichier Excel : les fournisseurs, les factures et leurs dates de paiement. Les factures reprises servent au suivi (à payer, historique) mais <b>n'entrent pas en comptabilité</b>, pour éviter de compter deux fois ce qui figurera dans le bilan d'ouverture.</p>
  <p class="small muted">Pour démarrer la comptabilité, passez ensuite les à-nouveaux (Comptabilité, puis Saisie) : un bouton ajoute automatiquement les soldes fournisseurs non réglés.</p>
  <label class="btn primary">Choisir le fichier Excel<input type="file" id="fh" accept=".xlsx,.xls" hidden></label><div id="rh"></div></div>`;
  $("#fh").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    await action(async () => {
      const wb = await lireXlsx(f);
      const nomF = wb.SheetNames.find((n) => /RECAP/i.test(n)) || wb.SheetNames[0];
      const r = C.lireHistoriqueFournisseurs(C.lireFeuille(XLSX, wb.Sheets[nomF]));
      const cles = new Map(); for (const x of r.factures) { const k = C.cleFournisseur(x.fournisseur); if (!cles.has(k)) cles.set(k, x.fournisseur); }
      const nouveaux = [...cles.entries()].filter(([k]) => !S.tiers.some((t) => C.cleFournisseur(t.nom) === k));
      const deja = r.factures.filter((x) => S.factures.some((f2) => f2.historique && f2.numero && f2.numero === x.numero && C.cleFournisseur(tiersPar(f2.tiers_id)?.nom) === C.cleFournisseur(x.fournisseur) && f2.montant_ttc === x.montant_ttc));
      const aImp = r.factures.filter((x) => !deja.includes(x));
      $("#rh").innerHTML = `<div class="kpis">${kpi("Onglet", nomF, "")}${kpi("Factures lues", fmt(r.factures.length), F(r.factures.reduce((s, x) => s + x.montant_ttc, 0)))}${kpi("Déjà importées", fmt(deja.length), "")}${kpi("Nouveaux fournisseurs", fmt(nouveaux.length), "")}${kpi("Non réglées", fmt(aImp.filter((x) => !x.date_paiement).length), F(aImp.filter((x) => !x.date_paiement).reduce((s, x) => s + x.montant_ttc, 0)))}</div>
        ${r.rejets.length ? `<h3>Lignes écartées (${r.rejets.length})</h3><ul class="alerts">${r.rejets.map((x) => `<li>Ligne ${x.ligne} · ${esc(x.fournisseur)} : ${esc(x.raison)}</li>`).join("")}</ul>` : ""}
        <div class="row end"><button class="primary" id="hok" ${aImp.length ? "" : "disabled"}>Importer ${aImp.length} facture(s)</button></div>`;
      $("#hok").onclick = () => action(async () => {
        $("#hok").disabled = true; $("#hok").textContent = "Import en cours…";
        if (nouveaux.length) { const ins = await DB.ins("tiers", nouveaux.map(([, nom]) => { const ex = r.factures.find((x) => C.cleFournisseur(x.fournisseur) === C.cleFournisseur(nom)); return { nom, categorie: ex?.categorie && (S.params.categories || {})[ex.categorie] ? ex.categorie : null }; })); S.tiers.push(...ins); }
        const idDe = (nom) => S.tiers.find((t) => C.cleFournisseur(t.nom) === C.cleFournisseur(nom)).id;
        const rows = aImp.map((x) => ({ tiers_id: idDe(x.fournisseur), numero: x.numero || null, date_facture: x.date_facture, echeance: x.echeance, categorie: x.categorie, libelle: x.commentaire,
          montant_ttc: x.montant_ttc, regle: x.date_paiement ? x.montant_ttc : 0, historique: true, statut: "a_valider" }));
        const insF = await DB.ins("factures", rows);
        // Règlements historiques regroupés par fournisseur, date et mode
        const grp = new Map();
        aImp.forEach((x, i) => { if (!x.date_paiement) return; const k = idDe(x.fournisseur) + "|" + x.date_paiement + "|" + (x.mode || "VIREMENT"); const g = grp.get(k) || { tiers_id: idDe(x.fournisseur), date: x.date_paiement, mode: x.mode || "VIREMENT", montant: 0, factures: [], reference: x.ref_paiement }; g.montant += x.montant_ttc; g.factures.push(insF[i].id); grp.set(k, g); });
        const regs = [...grp.values()].filter((g) => g.montant > 0).map((g) => ({ ...g, compte_tresorerie: (S.params.modes || {})[g.mode] || "512000", historique: true }));
        if (regs.length) await DB.ins("reglements", regs);
        await chargerTout(); $("#rh").innerHTML = `<p class="ok">Import terminé : ${insF.length} factures, ${regs.length} règlements, ${nouveaux.length} nouveaux fournisseurs.</p>`;
      }, "Reprise importée");
    });
  };
}

/* =====================================================================
   CARBURANT
   ===================================================================== */
function vCarbu(el) {
  const m = S.mois; const { liste } = sansDoublons(importsDuMois(m));
  const imps = S.imports.filter((i) => i.date_fin.slice(0, 7) === m);
  const rap = C.rapprochementCarburant(imps.filter((i) => i.date_debut === i.date_fin).length ? imps.filter((i) => i.date_debut === i.date_fin) : liste, S.cuves);
  const rel = S.cuves.filter((c) => c.date.slice(0, 7) === m).sort((a, b) => b.date.localeCompare(a.date) || a.produit.localeCompare(b.produit));
  const carb = liste.flatMap((i) => i.data.carburants || []);
  el.innerHTML = `
  <div class="kpis">${["GAZOLE", "SANS PLOMB"].map((p) => { const x = carb.filter((c) => c.produit === p); const l = x.reduce((s, c) => s + c.litres, 0), t = x.reduce((s, c) => s + c.ttc, 0); return kpi(p === "GAZOLE" ? "Gazole" : "Sans plomb", L(l), l ? `${F(t)} · ${fmt((t / l) * 10) / 10} F/L` : ""); }).join("")}</div>
  <div class="split">
    <div class="panel"><h2>Relevé de cuve ou livraison</h2>
      <form class="form" id="fc"><label>Date<input type="date" name="date" value="${today()}" required></label>
      <label>Produit<select name="produit"><option>GAZOLE</option><option>SANS PLOMB</option></select></label>
      <label>Jauge fin de journée (L)<input type="number" step="0.1" name="jauge"></label>
      <label>Livraison du jour (L)<input type="number" step="0.1" name="livraison"></label>
      <label class="wide">Note<input name="note"></label></form>
      <div class="row end"><button class="primary" id="cok">Enregistrer</button></div>
      <p class="small muted">Relevez la jauge chaque soir après la dernière vente, et notez les litres livrés (bon de livraison Mobil). Le rapprochement compare alors la jauge mesurée au stock théorique.</p></div>
    <div class="panel"><h2>Relevés · ${C.moisFr(m)}</h2><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Produit</th><th class="num">Jauge</th><th class="num">Livré</th><th>Note</th><th></th></tr></thead><tbody>
      ${rel.map((c) => `<tr><td>${fd(c.date)}</td><td>${esc(c.produit)}</td><td class="num">${fmt(c.jauge)}</td><td class="num">${c.livraison ? fmt(c.livraison) : ""}</td><td>${esc(c.note)}</td><td><button class="link danger" data-dc="${c.id}">×</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Aucun relevé.</td></tr>`}</tbody></table></div></div>
  </div>
  <div class="panel"><h2>Rapprochement cuves / ventes</h2><div class="tbl-wrap"><table><thead><tr><th>Période</th><th>Produit</th><th class="num">Jauge début</th><th class="num">+ Livré</th><th class="num">− Vendu</th><th class="num">= Théorique</th><th class="num">Jauge fin</th><th class="num">Écart</th></tr></thead><tbody>
    ${rap.map((r) => `<tr><td>${r.periode[0] === r.periode[1] ? fd(r.periode[0]) : fd(r.periode[0]) + " → " + fd(r.periode[1])}</td><td>${r.produit}</td><td class="num">${r.jaugeDebut == null ? chip("manque", "warn") : fmt(r.jaugeDebut)}</td><td class="num">${fmt(r.livraisons)}</td><td class="num">${fmt(r.ventes)}</td><td class="num">${r.theorique == null ? "" : fmt(r.theorique)}</td><td class="num">${r.jaugeFin == null ? chip("manque", "warn") : fmt(r.jaugeFin)}</td>
      <td class="num">${r.ecart == null ? "" : chip(`${fmt(r.ecart)} L (${r.ecartPct.toFixed(2)} %)`, Math.abs(r.ecartPct) > 0.5 ? "bad" : "ok")}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">Importez les décomptes de caisse et saisissez les jauges pour voir le rapprochement.</td></tr>`}
  </tbody></table></div><p class="small muted">Jauge début = relevé de la veille du premier jour. Un écart supérieur à 0,5 % des ventes est signalé.</p></div>`;
  $("#cok").onclick = () => action(async () => {
    const f = $("#fc"); if (!f.reportValidity()) return;
    const row = { date: f.date.value, produit: f.produit.value, jauge: f.jauge.value === "" ? null : C.num(f.jauge.value), livraison: C.num(f.livraison.value), note: f.note.value || null };
    const r = await DB.ins("cuves", row, { upsert: true, onConflict: "date,produit" });
    S.cuves = [r, ...S.cuves.filter((c) => !(c.date === r.date && c.produit === r.produit))]; vCarbu(el);
  }, "Relevé enregistré");
  $$("[data-dc]", el).forEach((b) => (b.onclick = () => action(async () => { await DB.del("cuves", { id: b.dataset.dc }); S.cuves = S.cuves.filter((c) => c.id !== b.dataset.dc); vCarbu(el); })));
}

/* =====================================================================
   PERSONNEL
   ===================================================================== */
function vPerso(el) {
  sousOnglets(el, "perso", [["plan", "Planning"], ["sal", "Salariés", estGerant], ["paie", "Paie du mois", estGerant]], { plan: vPlanning, sal: vSalaries, paie: vPaie });
}
const legende = () => ({ ...C.LEGENDE_DEFAUT, ...(S.params.legende_planning || {}) });
const notesDef = () => ({ ...C.NOTES_DEFAUT, ...(S.params.notes_planning || {}) });
const fh = (h) => (h ? (Math.round(h * 100) / 100).toString().replace(".", ",") : "");
async function vPlanning(el) {
  if (!S.semaine) S.semaine = C.semaineIso(new Date());
  const sem = S.semaine; const jours = C.joursSemaine(sem);
  const pl = (await DB.sel("plannings", { eq: { semaine: sem } }))[0]?.data || {};
  const presents = new Set(Object.keys(pl));
  const liste = S.salaries.filter((s) => s.actif || presents.has(s.id));
  const ro = !estCompta();
  const NJ = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const leg = legende();
  el.innerHTML = `<div class="panel planning"><div class="row"><button id="sp" aria-label="Semaine précédente">◀</button><h2 class="grow center">Semaine ${sem.slice(6)} · du ${fd(jours[0])} au ${fd(jours[6])}</h2><button id="sn" aria-label="Semaine suivante">▶</button>
    <input type="date" id="sgo" title="Aller à une date" class="noprint">
    ${ro ? "" : `<button id="pcopy">Copier la semaine précédente</button><label class="btn">Importer un planning Excel<input type="file" id="pimp" accept=".xlsx,.xls" hidden></label><button class="primary" id="psave">Enregistrer</button>`}<button id="pprint">Imprimer</button></div>
    <p class="small muted noprint">Codes : ${Object.entries(leg).map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(" · ")} · <b>REPOS</b>. Ajouts possibles : « / CP », « + 2H », « 8H HS », ou un horaire libre « 6-14 ».</p>
    <div class="tbl-wrap"><table><thead><tr><th>Salarié</th>${jours.map((j, i) => `<th>${NJ[i]} ${j.slice(8)}/${j.slice(5, 7)}</th>`).join("")}<th class="num">Heures</th><th class="num">HS</th></tr></thead><tbody>
    ${liste.map((s) => `<tr data-s="${s.id}"><td>${esc(s.prenom || "")} ${esc(s.nom)}<div class="small muted">${esc(s.poste || "")}</div></td>${jours.map((j) => `<td><input class="pc" data-j="${j}" value="${esc(pl[s.id]?.[j] || "")}" ${ro ? "readonly" : ""} size="9"></td>`).join("")}<td class="num ht"></td><td class="num hs"></td></tr>`).join("") || `<tr><td colspan="10" class="muted">Aucun salarié actif : ajoutez-les dans l'onglet Salariés, ou importez votre planning Excel.</td></tr>`}
    </tbody><tfoot><tr class="total"><td>Total</td>${jours.map((j) => `<td class="num" data-tj="${j}"></td>`).join("")}<td class="num" id="ptot"></td><td class="num" id="phs"></td></tr></tfoot></table></div></div>`;
  const calc = () => {
    let tot = 0, ths = 0; const tj = {};
    $$("tr[data-s]", el).forEach((tr) => {
      let h = 0, hs = 0;
      $$(".pc", tr).forEach((i) => { const a = C.analyserCreneau(i.value, leg, notesDef()); h += a.heures; hs += a.hs; tj[i.dataset.j] = (tj[i.dataset.j] || 0) + a.heures + a.hs; i.dataset.t = a.type; i.title = a.type === "douteux" ? "Code à vérifier" : a.heures || a.hs || a.cp ? `${fh(a.heures)} h${a.hs ? " + " + fh(a.hs) + " h sup." : ""}${a.cp ? " · CP " + fh(a.cp) + " h" : ""}` : ""; });
      $(".ht", tr).textContent = fh(h); $(".hs", tr).textContent = fh(hs); tot += h; ths += hs;
    });
    $$("[data-tj]", el).forEach((td) => (td.textContent = fh(tj[td.dataset.tj])));
    $("#ptot").textContent = fh(tot); $("#phs").textContent = fh(ths);
  };
  $$(".pc", el).forEach((i) => (i.oninput = calc)); calc();
  const versSemaine = (d) => { S.semaine = C.semaineIso(d); vPlanning(el); };
  const decal = (n) => { const l = C.lundiDeSemaine(sem); l.setUTCDate(l.getUTCDate() + 7 * n); versSemaine(new Date(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate())); };
  $("#sp").onclick = () => decal(-1); $("#sn").onclick = () => decal(1);
  $("#sgo").onchange = (e) => { if (e.target.value) { const [y, m, d] = e.target.value.split("-").map(Number); versSemaine(new Date(y, m - 1, d)); } };
  $("#pprint").onclick = () => window.print();
  const lire = () => { const d = { ...pl }; $$("tr[data-s]", el).forEach((tr) => { const o = {}; $$(".pc", tr).forEach((i) => { if (i.value.trim()) o[i.dataset.j] = i.value.trim(); }); if (Object.keys(o).length) d[tr.dataset.s] = o; else delete d[tr.dataset.s]; }); return d; };
  if (!ro) {
    $("#psave").onclick = () => action(() => DB.ins("plannings", { semaine: sem, data: lire(), maj_le: new Date().toISOString() }, { upsert: true, onConflict: "semaine" }), "Planning enregistré");
    $("#pcopy").onclick = async () => {
      const l = C.lundiDeSemaine(sem); l.setUTCDate(l.getUTCDate() - 7); const prev = C.semaineIso(new Date(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
      const p = (await DB.sel("plannings", { eq: { semaine: prev } }))[0]?.data || {}; const pj = C.joursSemaine(prev);
      $$("tr[data-s]", el).forEach((tr) => $$(".pc", tr).forEach((i, k) => { i.value = p[tr.dataset.s]?.[pj[k]] || ""; })); calc(); toast("Semaine précédente copiée : pensez à enregistrer.");
    };
    $("#pimp").onchange = (e) => { const f = e.target.files[0]; if (f) importerPlanning(f, () => vPlanning(el)); e.target.value = ""; };
  }
}
async function importerPlanning(file, apres) {
  const r = await action(async () => { const wb = await lireXlsx(file); const ws = wb.Sheets[wb.SheetNames.find((n) => /PLANNING/i.test(n)) || wb.SheetNames[0]]; return C.lirePlanningExcel(C.lireFeuille(XLSX, ws)); });
  if (!r) return;
  const cle = (x) => C.norm(x).replace(/[^A-Z]/g, "");
  const trouver = (nom) => S.salaries.find((s) => cle(s.prenom) === cle(nom) || cle(s.nom) === cle(nom) || cle((s.prenom || "") + (s.nom || "")) === cle(nom));
  const inconnus = r.noms.filter((n) => !trouver(n));
  const douteux = r.cellules.map((c) => ({ c, a: C.analyserCreneau(c.texte, { ...legende(), ...r.legende }, notesDef()) })).filter((x) => x.a.douteux);
  const notes = {}; r.cellules.forEach((c) => C.analyserCreneau(c.texte, { ...legende(), ...r.legende }, notesDef()).notes.forEach((n) => { if (n.length <= 3) notes[n] = (notes[n] || 0) + 1; }));
  const m = modal("Importer le planning Excel", `
    <div class="kpis">${kpi("Période", `${fd(r.debut)} → ${fd(r.fin)}`, "")}${kpi("Salariés", r.noms.length, r.noms.join(", "))}${kpi("Créneaux lus", fmt(r.cellules.filter((c) => c.texte).length), "")}</div>
    ${Object.keys(r.legende).length ? `<p class="small">Horaires repris de la légende du fichier : ${Object.entries(r.legende).map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(" · ")}.</p>` : ""}
    ${inconnus.length ? `<div class="box"><b>${inconnus.length} prénom(s) sans fiche salarié :</b> ${inconnus.map(esc).join(", ")}.<br>${estGerant() ? `<label><input type="checkbox" id="pcre" checked> Créer leur fiche (prénom seulement ; complétez ensuite contrat et taux horaire)</label>` : `<span class="muted">Demandez au gérant de les créer, sinon leurs créneaux ne seront pas importés.</span>`}</div>` : ""}
    ${Object.keys(notes).length ? `<p class="small">Mentions trouvées après « / » : ${Object.entries(notes).map(([k, v]) => `<b>${esc(k)}</b> (${v} fois)`).join(", ")}. Leur signification se règle dans Paramètres, puis Codes du planning.</p>` : ""}
    ${r.avertissements.length ? `<ul class="alerts">${r.avertissements.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    ${douteux.length ? `<details><summary>${douteux.length} créneau(x) à vérifier (importés tels quels, comptés sous réserve)</summary><ul class="small">${douteux.slice(0, 80).map((x) => `<li>${esc(x.c.nom)} · ${fd(x.c.date)} · « ${esc(x.c.texte)} »</li>`).join("")}</ul></details>` : ""}
    <p class="small muted">Pour chaque salarié du fichier, les jours de la période importée remplacent ce qui était déjà saisi. Les autres semaines ne bougent pas.</p>
    <div class="row end"><button class="primary" id="piok">Importer</button></div>`, { large: true });
  $("#piok", m).onclick = () => action(async () => {
    $("#piok", m).disabled = true; $("#piok", m).textContent = "Import en cours…";
    if (inconnus.length && $("#pcre", m)?.checked) { const recent = addDays(r.fin < today() ? r.fin : today(), -45);
      await DB.ins("salaries", inconnus.map((n) => ({ nom: "", prenom: n, poste: "", actif: r.cellules.some((c) => c.nom === n && c.texte && c.date >= recent && !/^REPOS$|^X$/i.test(c.texte)) }))); S.salaries = await DB.sel("salaries", { order: "prenom" }); }
    if (Object.keys(r.legende).length) await enregParams({ ...S.params, legende_planning: { ...(S.params.legende_planning || {}), ...r.legende } });
    const parSem = new Map(); const datesFichier = new Set(r.cellules.map((c) => c.date));
    for (const c of r.cellules) { const s = trouver(c.nom); if (!s) continue; const k = C.semaineIso(new Date(+c.date.slice(0, 4), +c.date.slice(5, 7) - 1, +c.date.slice(8, 10))); if (!parSem.has(k)) parSem.set(k, []); parSem.get(k).push({ sid: s.id, ...c }); }
    const exist = Object.fromEntries((await DB.sel("plannings", { in: { semaine: [...parSem.keys()] } })).map((p) => [p.semaine, p.data]));
    const rows = [...parSem.entries()].map(([sem, cs]) => {
      const d = JSON.parse(JSON.stringify(exist[sem] || {}));
      const sids = new Set(cs.map((c) => c.sid));
      for (const sid of sids) { const o = d[sid] || {}; for (const j of Object.keys(o)) if (datesFichier.has(j)) delete o[j]; d[sid] = o; }
      for (const c of cs) if (c.texte) d[c.sid][c.date] = c.texte;
      for (const sid of Object.keys(d)) if (!Object.keys(d[sid]).length) delete d[sid];
      return { semaine: sem, data: d, maj_le: new Date().toISOString() };
    });
    await DB.ins("plannings", rows, { upsert: true, onConflict: "semaine" });
    m.remove(); toast(`Planning importé : ${rows.length} semaine(s).`); apres();
  });
}
async function heuresDuMois(m) {
  // Toutes les semaines qui touchent le mois
  const d1 = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1); const sems = new Set();
  for (let d = new Date(d1); d.getMonth() === d1.getMonth(); d.setDate(d.getDate() + 1)) sems.add(C.semaineIso(d));
  const pls = await DB.sel("plannings", { in: { semaine: [...sems] } });
  const par = {};
  for (const p of pls) for (const [sid, jours] of Object.entries(p.data)) for (const [j, v] of Object.entries(jours)) if (j.slice(0, 7) === m) (par[sid] = par[sid] || []).push([j, v]);
  const out = {}; for (const [sid, l] of Object.entries(par)) out[sid] = C.totaliserCreneaux(l.sort(), legende(), notesDef());
  return out;
}
async function vSalaries(el) {
  const priv = Object.fromEntries((await DB.sel("salaries_prive")).map((p) => [p.id, p.data]));
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Salariés</h2><button class="primary" id="ns">Nouveau salarié</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Nom</th><th>Poste</th><th>Contrat</th><th>Entrée</th><th class="num">Taux horaire</th><th class="num">Heures / mois</th><th>Statut</th></tr></thead><tbody>
  ${S.salaries.map((s) => { const p = priv[s.id] || {}; return `<tr class="click" data-s="${s.id}"><td>${esc(s.prenom || "")} ${esc(s.nom)}</td><td>${esc(s.poste)}</td><td>${esc(p.contrat)}</td><td>${p.entree ? fd(p.entree) : ""}</td><td class="num">${fmt(p.taux_horaire)}</td><td class="num">${fmt(p.heures_mois)}</td><td>${s.actif ? chip("Actif", "ok") : chip("Sorti", "info")}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">Aucun salarié.</td></tr>`}
  </tbody></table></div></div>`;
  const ouvrir = (s) => {
    const n = !s; s = s || { actif: true }; const p = priv[s.id] || {};
    const m = modal(n ? "Nouveau salarié" : `${s.prenom || ""} ${s.nom}`, `<form class="form" id="fs">
      <label>Nom<input name="nom" required value="${esc(s.nom || "")}"></label><label>Prénom<input name="prenom" value="${esc(s.prenom || "")}"></label>
      <label>Poste<input name="poste" value="${esc(s.poste || "")}" placeholder="Pompiste, caissier…"></label>
      <label>Contrat<select name="contrat">${["CDI", "CDD", "Apprentissage", "Extra"].map((x) => `<option ${x === p.contrat ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Date d'entrée<input type="date" name="entree" value="${p.entree || ""}"></label><label>Date de sortie<input type="date" name="sortie" value="${p.sortie || ""}"></label>
      <label>Taux horaire brut (F)<input type="number" name="taux_horaire" value="${p.taux_horaire || ""}"></label><label>Heures contractuelles / mois<input type="number" step="0.01" name="heures_mois" value="${p.heures_mois || "169"}"></label>
      <label>N° CAFAT<input name="cafat" value="${esc(p.cafat || "")}"></label><label>Actif<select name="actif"><option value="1" ${s.actif ? "selected" : ""}>Oui</option><option value="0" ${!s.actif ? "selected" : ""}>Non (sorti)</option></select></label>
      </form><div class="row end"><button class="primary" id="sok">Enregistrer</button></div>`);
    $("#sok", m).onclick = () => action(async () => {
      const f = $("#fs", m); if (!f.reportValidity()) return;
      const base = { nom: f.nom.value.trim().toUpperCase(), prenom: f.prenom.value.trim(), poste: f.poste.value.trim(), actif: f.actif.value === "1" };
      const r = n ? await DB.ins("salaries", base) : await DB.upd("salaries", { id: s.id }, base);
      await DB.ins("salaries_prive", { id: r.id, data: { contrat: f.contrat.value, entree: f.entree.value || null, sortie: f.sortie.value || null, taux_horaire: C.num(f.taux_horaire.value), heures_mois: C.num(f.heures_mois.value), cafat: f.cafat.value.trim() } }, { upsert: true, onConflict: "id" });
      S.salaries = await DB.sel("salaries", { order: "prenom" }); m.remove(); vSalaries(el);
    }, "Salarié enregistré");
  };
  $("#ns").onclick = () => ouvrir(null);
  $$("[data-s]", el).forEach((tr) => (tr.onclick = () => ouvrir(S.salaries.find((s) => s.id === tr.dataset.s))));
}
async function vPaie(el) {
  const m = S.mois; const h = await heuresDuMois(m);
  const priv = Object.fromEntries((await DB.sel("salaries_prive")).map((p) => [p.id, p.data]));
  const paie = (await DB.sel("paies", { eq: { mois: m } }))[0] || { mois: m, data: {} };
  const d = paie.data; const actifs = S.salaries.filter((s) => s.actif || h[s.id]);
  const nd = notesDef();
  const brutEstime = actifs.reduce((s, x) => s + ((h[x.id]?.heures || 0) + (h[x.id]?.hs || 0) + (h[x.id]?.cpH || 0)) * (priv[x.id]?.taux_horaire || 0), 0);
  const champs = [["brut", "Salaires bruts"], ["sal_cafat", "Cotisations salariales CAFAT"], ["sal_autres", "Cotisations salariales retraite / prévoyance"], ["pat_cafat", "Cotisations patronales CAFAT"], ["pat_autres", "Cotisations patronales retraite / prévoyance"], ["acomptes", "Acomptes versés dans le mois"]];
  el.innerHTML = `<div class="split">
    <div class="panel"><h2>Heures du planning · ${C.moisFr(m)}</h2><div class="tbl-wrap"><table><thead><tr><th>Salarié</th><th class="num">Jours</th><th class="num">Heures</th><th class="num">H. sup.</th><th class="num">CP (j)</th><th>Absences et mentions</th><th class="num">Contrat</th><th class="num">Brut estimé</th></tr></thead><tbody>
      ${actifs.map((s) => { const p = priv[s.id] || {}; const t = h[s.id] || { heures: 0, hs: 0, cpH: 0, cpJ: 0, jours: 0, absences: {}, notes: {}, douteux: [] };
        const ment = [...Object.entries(t.absences).map(([k, v]) => `${esc(nd[k]?.libelle || k)} ${v} j`), ...Object.entries(t.notes).map(([k, v]) => `${esc(nd[k]?.libelle || k)} ×${v}`)].join(", ");
        return `<tr><td>${esc(s.prenom || "")} ${esc(s.nom)}</td><td class="num">${t.jours}</td><td class="num">${fh(t.heures)}</td><td class="num">${fh(t.hs)}</td><td class="num">${fh(t.cpJ)}</td><td class="small">${ment}${t.douteux.length ? " " + chip(t.douteux.length + " à vérifier", "warn") + `<div class="muted">${esc(t.douteux.join(", "))}</div>` : ""}</td><td class="num">${fmt(p.heures_mois)}</td><td class="num">${fmt((t.heures + t.hs + t.cpH) * (p.taux_horaire || 0))}</td></tr>`; }).join("")}
      </tbody><tfoot><tr class="total"><td>Total</td><td></td><td class="num">${fh(Object.values(h).reduce((a, t) => a + t.heures, 0))}</td><td class="num">${fh(Object.values(h).reduce((a, t) => a + t.hs, 0))}</td><td class="num">${fh(Object.values(h).reduce((a, t) => a + t.cpJ, 0))}</td><td></td><td></td><td class="num">${fmt(brutEstime)}</td></tr></tfoot></table></div>
      <p class="small muted">Brut estimé = (heures + heures supplémentaires + heures de CP) × taux horaire, sans majoration des heures supplémentaires, primes ni retenues. Les bulletins restent à établir à partir de ces heures.</p></div>
    <div class="panel"><h2>Écriture de paie</h2><p class="small muted">Reportez les totaux du livre de paie du mois.</p>
      <form class="form one" id="fp">${champs.map(([k, n]) => `<label>${n}<input type="number" name="${k}" value="${d[k] ?? ""}" ${paie.ecriture_id ? "disabled" : ""}></label>`).join("")}</form>
      <div id="pe"></div>
      <div class="row end">${paie.ecriture_id ? `${chip("Comptabilisée", "ok")}<button class="danger" id="pdel">Annuler l'écriture</button>` : `<button id="psv">Enregistrer</button><button class="primary" id="ppost">Comptabiliser</button>`}</div></div></div>`;
  const lire = () => Object.fromEntries(champs.map(([k]) => [k, C.int($("#fp")[k].value)]));
  const prev = () => { const e = C.ecriturePaie(m, lire()); $("#pe").innerHTML = `<p>Net à payer : <b class="num">${F(e.net - lire().acomptes)}</b></p>` + tableEcriture(e); };
  $$("#fp input").forEach((i) => (i.oninput = prev)); prev();
  if ($("#psv")) $("#psv").onclick = () => action(() => DB.ins("paies", { mois: m, data: lire() }, { upsert: true, onConflict: "mois" }), "Enregistré");
  if ($("#ppost")) $("#ppost").onclick = () => action(async () => {
    const v = lire(); if (!v.brut) throw new Error("Saisissez au moins le brut.");
    const e = C.ecriturePaie(m, v); const id = await passer(e);
    await DB.ins("paies", { mois: m, data: v, ecriture_id: id }, { upsert: true, onConflict: "mois" }); vPaie(el);
  }, "Paie comptabilisée");
  if ($("#pdel")) $("#pdel").onclick = () => { if (confirm("Annuler l'écriture de paie de ce mois ?")) action(async () => { await DB.rpc("supprimer_ecriture", { p_id: paie.ecriture_id }); invalider(); await DB.upd("paies", { mois: m }, { ecriture_id: null }); vPaie(el); }, "Écriture annulée"); };
}

/* =====================================================================
   COMPTABILITÉ
   ===================================================================== */
function vCompta(el) {
  sousOnglets(el, "compta", [["ecr", "Écritures"], ["saisie", "Saisie"], ["gl", "Grand livre"], ["bal", "Balance"], ["res", "Résultat"], ["bil", "Bilan"], ["tgc", "TGC"], ["clo", "Clôture"], ["exp", "Export"], ["pc", "Plan comptable"]],
    { ecr: vEcritures, saisie: vSaisie, gl: vGrandLivre, bal: vBalance, res: vResultat, bil: vBilan, tgc: vTgc, clo: vCloture, exp: vExport, pc: vPlan });
}
function choixPeriode(cle) {
  const p = S.sub[cle] || "mois";
  return `<select class="per" data-k="${cle}"><option value="mois" ${p === "mois" ? "selected" : ""}>${C.moisFr(S.mois)}</option><option value="exo" ${p === "exo" ? "selected" : ""}>Du 1er janvier à fin ${C.moisFr(S.mois)}</option></select>`;
}
function bornes(cle) { return (S.sub[cle] || "mois") === "exo" ? [S.mois.slice(0, 4) + "-01-01", finMois(S.mois)] : [debutMois(S.mois), finMois(S.mois)]; }
function lierPeriode(el, cle, re) { $$(".per", el).forEach((s) => (s.onchange = () => { S.sub[cle] = s.value; re(el); })); }
async function vEcritures(el) {
  const ls = await lignes(debutMois(S.mois), finMois(S.mois)); const j = S.sub.jrn || "";
  const parE = new Map(); for (const l of ls) { if (j && l.journal !== j) continue; if (!parE.has(l.ecriture_id)) parE.set(l.ecriture_id, []); parE.get(l.ecriture_id).push(l); }
  const clos = moisClos(S.mois);
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Écritures · ${C.moisFr(S.mois)} ${clos ? chip("clôturé", "info") : ""}</h2>
    <select id="jr"><option value="">Tous journaux</option>${Object.entries(C.JOURNAUX).map(([k, n]) => `<option value="${k}" ${k === j ? "selected" : ""}>${k} · ${n}</option>`).join("")}</select></div>
    ${[...parE.values()].map((g) => { const e = g[0]; const D = g.reduce((s, l) => s + +l.debit, 0);
      return `<details class="grp"><summary><span class="mono">${e.journal}</span> ${fd(e.date)} · ${esc(e.ecriture_libelle)} <span class="small muted">${esc(e.piece || "")}</span> <span class="num">${fmt(D)}</span></summary>
      <table>${g.map((l) => `<tr><td class="mono">${l.compte}</td><td>${esc(l.libelle)}</td><td class="num">${+l.debit ? fmt(l.debit) : ""}</td><td class="num">${+l.credit ? fmt(l.credit) : ""}</td></tr>`).join("")}</table>
      ${clos ? "" : `<div class="row end"><button class="link danger" data-del="${e.ecriture_id}">Supprimer cette écriture</button></div>`}</details>`; }).join("") || `<p class="muted">Aucune écriture.</p>`}</div>`;
  $("#jr").onchange = (e) => { S.sub.jrn = e.target.value; vEcritures(el); };
  $$("[data-del]", el).forEach((b) => (b.onclick = () => { if (confirm("Supprimer définitivement cette écriture ? La pièce d'origine (facture, décompte) redeviendra à comptabiliser.")) action(async () => { await DB.rpc("supprimer_ecriture", { p_id: b.dataset.del }); invalider(); await chargerTout(); vEcritures(el); }, "Écriture supprimée"); }));
}
function vSaisie(el) {
  el.innerHTML = `<div class="panel"><h2>Saisie d'une écriture</h2>
    <form class="form" id="fo"><label>Journal<select name="journal">${["OD", "AN", "BQ", "CA", "SA", "VT"].map((k) => `<option value="${k}">${k} · ${C.JOURNAUX[k]}</option>`).join("")}</select></label>
    <label>Date<input type="date" name="date" value="${finMois(S.mois)}" required></label><label>Pièce<input name="piece"></label><label class="wide">Libellé<input name="libelle" required></label></form>
    ${datalistComptes("dl_all")}
    <div class="tbl-wrap"><table id="to"><thead><tr><th>Compte</th><th>Tiers</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th></th></tr></thead><tbody></tbody>
    <tfoot><tr class="total"><td colspan="3">Total <span id="oeq"></span></td><td class="num" id="od"></td><td class="num" id="oc"></td><td></td></tr></tfoot></table></div>
    <datalist id="dl_tt">${S.tiers.map((t) => `<option value="${esc(t.nom)}">`).join("")}</datalist>
    <div class="row"><button id="oa">Ajouter une ligne</button><button id="oan">À-nouveaux : ajouter les soldes fournisseurs non réglés</button><span class="grow"></span><button class="primary" id="ook">Passer l'écriture</button></div>
    <p class="small muted">À-nouveaux : saisissez le bilan d'ouverture remis par votre expert-comptable (journal AN, daté du premier jour de la comptabilité), compte par compte. Le bouton ajoute le détail des fournisseurs encore dus d'après la reprise Excel ; retirez alors la ligne 401000 globale du bilan pour ne pas la compter deux fois.</p></div>`;
  const tb = $("#to tbody");
  const add = (l = {}) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input class="oc mono" list="dl_all" value="${esc(l.compte || "")}" size="8"></td><td><input class="ot" list="dl_tt" value="${esc(l.tiers || "")}"></td><td><input class="ol" value="${esc(l.libelle || "")}"></td><td><input type="number" class="od" value="${l.debit || ""}"></td><td><input type="number" class="ocr" value="${l.credit || ""}"></td><td><button class="link danger ox">×</button></td>`;
    tb.appendChild(tr); $$("input", tr).forEach((i) => (i.oninput = tot)); $(".ox", tr).onclick = () => { tr.remove(); tot(); };
  };
  const lire = () => $$("tr", tb).map((tr) => { const tn = $(".ot", tr).value.trim(); const t = tn ? S.tiers.find((x) => x.nom === tn) : null; return { compte: $(".oc", tr).value.trim(), tiers_id: t?.id || null, libelle: $(".ol", tr).value.trim(), debit: C.int($(".od", tr).value), credit: C.int($(".ocr", tr).value) }; }).filter((l) => l.compte && (l.debit || l.credit));
  const tot = () => { const ls = lire(); const D = ls.reduce((s, l) => s + l.debit, 0), Cr = ls.reduce((s, l) => s + l.credit, 0); $("#od").textContent = fmt(D); $("#oc").textContent = fmt(Cr); $("#oeq").innerHTML = D === Cr && D ? chip("équilibrée", "ok") : D || Cr ? chip("écart " + fmt(D - Cr), "bad") : ""; };
  add(); add(); tot();
  $("#oa").onclick = add;
  $("#oan").onclick = () => {
    const f = $("#fo"); f.journal.value = "AN"; if (S.params.debut_compta) f.date.value = S.params.debut_compta; if (!f.libelle.value) f.libelle.value = "À-nouveaux";
    const deb = S.params.debut_compta || "9999-12-31"; const parT = {};
    for (const x of S.factures) if (x.historique && x.date_facture < deb && reste(x) !== 0) parT[x.tiers_id] = (parT[x.tiers_id] || 0) + reste(x);
    let n = 0; for (const [id, r] of Object.entries(parT)) { const t = tiersPar(id); if (!r) continue; add({ compte: t.compte, tiers: t.nom, libelle: "Solde " + t.nom, debit: r < 0 ? -r : 0, credit: r > 0 ? r : 0 }); n++; }
    tot(); toast(n ? `${n} solde(s) fournisseur ajouté(s)` : "Aucune facture reprise non réglée avant le début de la comptabilité.", n ? "ok" : "warn");
  };
  $("#ook").onclick = () => action(async () => {
    const f = $("#fo"); if (!f.reportValidity()) return;
    await passer({ journal: f.journal.value, date: f.date.value, piece: f.piece.value || null, libelle: f.libelle.value, source: f.journal.value === "AN" ? "an" : "od", lignes: lire() });
    vSaisie(el);
  }, "Écriture passée");
}
async function vGrandLivre(el) {
  const [d1, d2] = bornes("glp"); const cpt = S.sub.glc || "512000";
  const avant = C.balance(await lignes(null, addDays(d1, -1))).find((b) => b.compte === cpt);
  const ls = (await lignes(d1, d2)).filter((l) => l.compte === cpt);
  let solde = avant ? avant.solde : 0;
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Grand livre</h2><input id="glc" list="dl_gl" class="mono" value="${esc(cpt)}" size="10">${datalistComptes("dl_gl")}${choixPeriode("glp")}</div>
  <p class="muted">${esc(libCompte(cpt))}</p><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th class="num">Solde</th></tr></thead><tbody>
  <tr class="muted"><td colspan="6">Report au ${fd(d1)}</td><td class="num">${fmt(solde)}</td></tr>
  ${ls.map((l) => { solde += l.debit - l.credit; return `<tr><td>${fd(l.date)}</td><td>${l.journal}</td><td>${esc(l.piece)}</td><td>${esc(l.libelle)}</td><td class="num">${+l.debit ? fmt(l.debit) : ""}</td><td class="num">${+l.credit ? fmt(l.credit) : ""}</td><td class="num">${fmt(solde)}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
  $("#glc").onchange = (e) => { S.sub.glc = e.target.value.trim(); vGrandLivre(el); }; lierPeriode(el, "glp", vGrandLivre);
}
async function vBalance(el) {
  const [d1, d2] = bornes("balp"); const bal = C.balance(await lignes(d1, d2), S.comptes);
  const t = bal.reduce((a, b) => ({ d: a.d + b.debit, c: a.c + b.credit }), { d: 0, c: 0 });
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Balance générale</h2>${choixPeriode("balp")}<button id="bcsv">Exporter en CSV</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Compte</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th><th class="num">Solde débiteur</th><th class="num">Solde créditeur</th></tr></thead><tbody>
  ${bal.map((b) => `<tr class="click" data-c="${b.compte}"><td class="mono">${b.compte}</td><td>${esc(b.libelle)}</td><td class="num">${fmt(b.debit)}</td><td class="num">${fmt(b.credit)}</td><td class="num">${b.solde > 0 ? fmt(b.solde) : ""}</td><td class="num">${b.solde < 0 ? fmt(-b.solde) : ""}</td></tr>`).join("")}
  </tbody><tfoot><tr class="total"><td colspan="2">Total ${t.d === t.c ? chip("équilibrée", "ok") : chip("déséquilibrée", "bad")}</td><td class="num">${fmt(t.d)}</td><td class="num">${fmt(t.c)}</td><td></td><td></td></tr></tfoot></table></div></div>`;
  lierPeriode(el, "balp", vBalance);
  $$("[data-c]", el).forEach((tr) => (tr.onclick = () => { S.sub.glc = tr.dataset.c; S.sub.glp = S.sub.balp; S.sub.compta = "gl"; vCompta($("#vue")); }));
  $("#bcsv").onclick = () => telecharger(`balance_${d1}_${d2}.csv`, "Compte;Libellé;Débit;Crédit;Solde\n" + bal.map((b) => [b.compte, b.libelle, b.debit, b.credit, b.solde].join(";")).join("\n"));
}
async function vResultat(el) {
  const [d1, d2] = bornes("resp"); const r = C.compteResultat(C.balance(await lignes(d1, d2), S.comptes));
  const bloc = (t) => r.rubriques.filter((x) => x.type === t && x.montant).map((x) => `<details class="grp"><summary>${esc(x.nom)} <span class="num">${F(x.montant)}</span></summary><table>${x.comptes.map((c) => `<tr><td class="mono">${c.compte}</td><td>${esc(c.libelle)}</td><td class="num">${fmt(c.montant)}</td></tr>`).join("")}</table></details>`).join("");
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Compte de résultat</h2>${choixPeriode("resp")}</div>
  <div class="split"><div><h3>Produits · ${F(r.produits)}</h3>${bloc("P")}</div><div><h3>Charges · ${F(r.charges)}</h3>${bloc("C")}</div></div>
  <div class="kpis">${kpi("Marge commerciale", F(r.margeCommerciale), "Ventes − achats de marchandises (hors variation de stock)")}${kpi("Résultat", F(r.resultat), r.resultat >= 0 ? "Bénéfice" : "Perte", r.resultat >= 0 ? "ok" : "bad")}</div>
  <p class="small muted">Pour un résultat juste en cours d'année, passez la variation de stock (inventaire) en écriture d'OD : 370000 / 603700.</p></div>`;
  lierPeriode(el, "resp", vResultat);
}
async function vBilan(el) {
  const b = C.bilan(C.balance(await lignes(null, finMois(S.mois)), S.comptes));
  const col = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmt(v)}</td></tr>`).join("");
  el.innerHTML = `<div class="panel"><h2>Bilan au ${fd(finMois(S.mois))}</h2><div class="split">
  <table><thead><tr><th>Actif</th><th></th></tr></thead><tbody>${col(b.actif)}</tbody><tfoot><tr class="total"><td>Total actif</td><td class="num">${fmt(b.totalActif)}</td></tr></tfoot></table>
  <table><thead><tr><th>Passif</th><th></th></tr></thead><tbody>${col(b.passif)}</tbody><tfoot><tr class="total"><td>Total passif</td><td class="num">${fmt(b.totalPassif)}</td></tr></tfoot></table></div>
  ${b.totalActif !== b.totalPassif ? `<p class="bad">Écart actif / passif : ${fmt(b.totalActif - b.totalPassif)}. Vérifiez les à-nouveaux.</p>` : ""}
  <p class="small muted">Bilan de gestion, sans les écritures d'inventaire (amortissements, stocks, charges à payer) que l'expert-comptable passe à la clôture.</p></div>`;
}
async function vTgc(el) {
  const m = S.mois; const bal = C.balance((await lignes(debutMois(m), finMois(m))).filter((l) => l.source !== "tgc"), S.comptes);
  const { liste } = sansDoublons(importsDuMois(m)); const d = C.declarationTgc(bal, liste);
  const deja = (await lignes(debutMois(m), finMois(m))).some((l) => l.source === "tgc");
  el.innerHTML = `<div class="panel"><h2>TGC · ${C.moisFr(m)}</h2>
  <div class="tbl-wrap"><table><thead><tr><th>Taux</th><th class="num">Base HT (caisse)</th><th class="num">TGC collectée</th><th class="num">TGC déductible</th></tr></thead><tbody>
  ${d.lignes.map((l) => `<tr><td>${l.taux} %</td><td class="num">${fmt(l.base)}</td><td class="num">${fmt(l.collectee)}</td><td class="num">${fmt(l.deductible)}</td></tr>`).join("")}
  <tr><td>Exonéré</td><td class="num">${fmt(d.baseExonere)}</td><td></td><td></td></tr><tr class="muted"><td>Hors champ (règlements de crédits, autres recettes)</td><td class="num">${fmt(d.horsChamp)}</td><td></td><td></td></tr>
  <tr class="total"><td colspan="2">Total</td><td class="num">${fmt(d.collectee)}</td><td class="num">${fmt(d.deductible)}</td></tr>
  </tbody><tfoot><tr class="total"><td colspan="2">${d.net >= 0 ? "TGC à payer" : "Crédit de TGC"}</td><td class="num" colspan="2">${F(Math.abs(d.net))}</td></tr></tfoot></table></div>
  <p class="small muted">Collectée et déductible viennent des écritures du mois (comptes 4457x et 4456x). Vérifiez que toutes les factures du mois sont comptabilisées avec leur ventilation avant de déclarer.</p>
  <div class="row end">${deja ? chip("Écriture de liquidation passée", "ok") : `<button class="primary" id="tliq" ${d.collectee || d.deductible ? "" : "disabled"}>Passer l'écriture de liquidation</button>`}</div></div>`;
  if ($("#tliq")) $("#tliq").onclick = () => action(async () => { await passer(C.ecritureLiquidationTgc(m, d)); vTgc(el); }, "Liquidation passée : la dette est au 445510");
}
function vCloture(el) {
  const mois = [...new Set([...S.imports.map((i) => i.date_fin.slice(0, 7)), ...S.factures.map((f) => f.date_facture.slice(0, 7)), S.mois, ...S.periodes.map((p) => p.mois)])].sort().reverse().slice(0, 24);
  el.innerHTML = `<div class="panel"><h2>Clôture des périodes</h2><p class="small muted">Un mois clôturé ne peut plus recevoir ni perdre d'écriture. Seul le gérant peut rouvrir un mois.</p>
  <table><tbody>${mois.map((m) => { const c = moisClos(m); const brou = S.imports.filter((i) => i.date_fin.slice(0, 7) === m && i.statut !== "comptabilise").length + S.factures.filter((f) => f.date_facture.slice(0, 7) === m && f.statut === "a_valider" && !f.historique).length;
    return `<tr><td>${C.moisFr(m)}</td><td>${c ? chip("Clôturé", "info") : brou ? chip(brou + " pièce(s) en attente", "warn") : chip("Ouvert", "ok")}</td><td>${c ? (estGerant() ? `<button data-o="${m}">Rouvrir</button>` : "") : `<button data-c="${m}">Clôturer</button>`}</td></tr>`; }).join("")}</tbody></table></div>`;
  $$("[data-c]", el).forEach((b) => (b.onclick = () => { if (confirm(`Clôturer ${C.moisFr(b.dataset.c)} ?`)) action(async () => { await DB.ins("periodes_closes", { mois: b.dataset.c }); S.periodes.push({ mois: b.dataset.c }); vCloture(el); }, "Mois clôturé"); }));
  $$("[data-o]", el).forEach((b) => (b.onclick = () => action(async () => { await DB.del("periodes_closes", { mois: b.dataset.o }); S.periodes = S.periodes.filter((p) => p.mois !== b.dataset.o); vCloture(el); }, "Mois rouvert")));
}
function vExport(el) {
  const y = S.mois.slice(0, 4);
  el.innerHTML = `<div class="panel"><h2>Export pour l'expert-comptable</h2>
  <div class="form"><label>Du<input type="date" id="x1" value="${y}-01-01"></label><label>Au<input type="date" id="x2" value="${finMois(S.mois)}"></label></div>
  <div class="row"><button class="primary" id="xfec">Fichier des écritures (FEC, .txt)</button><button id="xcsv">Écritures (CSV, Excel)</button></div>
  <p class="small muted">Le format FEC est lu par la plupart des logiciels comptables (Sage, Cegid, Quadra, EBP…).</p></div>`;
  const get = async () => {
    const ls = await lignes($("#x1").value, $("#x2").value); const ecr = new Map(); const par = {};
    for (const l of ls) { if (!ecr.has(l.ecriture_id)) ecr.set(l.ecriture_id, { id: l.ecriture_id, journal: l.journal, date: l.date, piece: l.piece, libelle: l.ecriture_libelle }); (par[l.ecriture_id] = par[l.ecriture_id] || []).push(l); }
    return { ls, ecr: [...ecr.values()], par };
  };
  $("#xfec").onclick = () => action(async () => { const g = await get(); telecharger(`FEC_${$("#x1").value}_${$("#x2").value}.txt`, C.exportFEC(g.ecr, g.par, S.comptes, S.tiers)); });
  $("#xcsv").onclick = () => action(async () => { const g = await get(); telecharger(`ecritures_${$("#x1").value}_${$("#x2").value}.csv`, "Date;Journal;Pièce;Compte;Libellé;Débit;Crédit\n" + g.ls.map((l) => [fd(l.date), l.journal, l.piece || "", l.compte, (l.libelle || "").replace(/;/g, ","), l.debit, l.credit].join(";")).join("\n")); });
}
function vPlan(el) {
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Plan comptable</h2><input id="pn" class="mono" placeholder="Numéro" size="8"><input id="pl" placeholder="Libellé"><button class="primary" id="pa">Ajouter</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Compte</th><th>Libellé</th><th>Actif</th></tr></thead><tbody>
  ${S.comptes.map((c) => `<tr><td class="mono">${c.numero}</td><td><input data-l="${c.numero}" value="${esc(c.libelle)}"></td><td><input type="checkbox" data-a="${c.numero}" ${c.actif ? "checked" : ""}></td></tr>`).join("")}</tbody></table></div></div>`;
  $("#pa").onclick = () => action(async () => { const n = $("#pn").value.trim(); if (!/^\d{3,10}$/.test(n)) throw new Error("Numéro de compte : 3 à 10 chiffres."); S.comptes.push(await DB.ins("comptes", { numero: n, libelle: $("#pl").value.trim() || n })); S.comptes.sort((a, b) => a.numero.localeCompare(b.numero)); vPlan(el); }, "Compte ajouté");
  $$("[data-l]", el).forEach((i) => (i.onchange = () => action(() => DB.upd("comptes", { numero: i.dataset.l }, { libelle: i.value }), "Libellé modifié")));
  $$("[data-a]", el).forEach((i) => (i.onchange = () => action(() => DB.upd("comptes", { numero: i.dataset.a }, { actif: i.checked }))));
}
function telecharger(nom, txt) {
  const b = new Blob(["﻿" + txt], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = nom; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =====================================================================
   PARAMÈTRES ET UTILISATEURS
   ===================================================================== */
function vParam(el) { sousOnglets(el, "param", [["soc", "Société"], ["map", "Catégories et modes"], ["codes", "Codes du planning"], ["users", "Utilisateurs"]], { soc: vSociete, map: vMapping, codes: vCodesPlanning, users: vUsers }); }
function vCodesPlanning(el) {
  const leg = legende(), nd = notesDef();
  el.innerHTML = `<div class="split"><div class="panel"><h2>Horaires des codes</h2><p class="small muted">Un code « M-n » ou « APM-n » absent de la liste compte pour n heures.</p>
    <table id="tl"><thead><tr><th>Code</th><th>Horaire</th><th class="num">Heures</th><th></th></tr></thead><tbody>${Object.entries(leg).map(([k, v]) => `<tr><td><input class="k mono" value="${esc(k)}" size="7"></td><td><input class="v" value="${esc(v)}" size="10"></td><td class="num">${fh(C.heuresCreneau(v))}</td><td><button class="link danger x">×</button></td></tr>`).join("")}</tbody></table><button id="tla">Ajouter un code</button></div>
    <div class="panel"><h2>Mentions après « / »</h2><p class="small muted">« CP » est toujours un congé payé. Indiquez ce que veulent dire les autres mentions, par exemple « M » pour maladie. Une mention qui est une absence ne compte pas d'heures travaillées.</p>
    <table id="tn"><thead><tr><th>Mention</th><th>Signification</th><th>Absence</th><th></th></tr></thead><tbody>${Object.entries(nd).map(([k, v]) => `<tr><td><input class="k mono" value="${esc(k)}" size="4"></td><td><input class="v" value="${esc(v.libelle)}"></td><td><input type="checkbox" class="a" ${v.absence ? "checked" : ""}></td><td><button class="link danger x">×</button></td></tr>`).join("")}</tbody></table><button id="tna">Ajouter une mention</button></div></div>
    <div class="row end"><button class="primary" id="cok">Enregistrer</button></div>`;
  const lier = () => $$(".x", el).forEach((b) => (b.onclick = () => b.closest("tr").remove())); lier();
  $("#tla").onclick = () => { const tr = document.createElement("tr"); tr.innerHTML = `<td><input class="k mono" size="7"></td><td><input class="v" size="10" placeholder="5H-13H"></td><td></td><td><button class="link danger x">×</button></td>`; $("#tl tbody").appendChild(tr); lier(); };
  $("#tna").onclick = () => { const tr = document.createElement("tr"); tr.innerHTML = `<td><input class="k mono" size="4"></td><td><input class="v"></td><td><input type="checkbox" class="a"></td><td><button class="link danger x">×</button></td>`; $("#tn tbody").appendChild(tr); lier(); };
  $("#cok").onclick = () => action(async () => {
    const l = {}; for (const tr of $$("#tl tbody tr")) { const k = C.norm($(".k", tr).value).replace(/\s+/g, ""), v = $(".v", tr).value.trim(); if (!k) continue; if (!C.heuresCreneau(v)) throw new Error(`Horaire illisible pour ${k} : écrivez par exemple 5H-13H.`); l[k] = v; }
    const n = {}; for (const tr of $$("#tn tbody tr")) { const k = C.norm($(".k", tr).value).replace(/[^A-Z]/g, ""); if (k && k !== "CP") n[k] = { libelle: $(".v", tr).value.trim() || k, absence: $(".a", tr).checked }; }
    await enregParams({ ...S.params, legende_planning: l, notes_planning: n }); vCodesPlanning(el);
  }, "Codes enregistrés");
}
async function enregParams(p) { await DB.ins("parametres", { id: 1, data: p }, { upsert: true, onConflict: "id" }); S.params = p; }
function vSociete(el) {
  const p = S.params;
  el.innerHTML = `<div class="panel"><h2>Société</h2><form class="form" id="fp">
    <label>Raison sociale<input name="societe" value="${esc(p.societe || "")}"></label><label>Enseigne<input name="enseigne" value="${esc(p.enseigne || "")}"></label>
    <label class="wide">Adresse<input name="adresse" value="${esc(p.adresse || "")}"></label><label>RIDET<input name="ridet" value="${esc(p.ridet || "")}"></label>
    <label>Début de la comptabilité dans l'outil<input type="date" name="debut_compta" value="${p.debut_compta || ""}"></label>
    <label>Compte des « autres recettes » de caisse<input name="compte_autres_recettes" class="mono" value="${esc(p.compte_autres_recettes || "758000")}"></label></form>
    <div class="row end"><button class="primary" id="pok">Enregistrer</button></div></div>`;
  $("#pok").onclick = () => action(async () => { const f = $("#fp"); const n = { ...p }; for (const k of ["societe", "enseigne", "adresse", "ridet", "debut_compta", "compte_autres_recettes"]) n[k] = f[k].value.trim(); await enregParams(n); rendre(); }, "Paramètres enregistrés");
}
function vMapping(el) {
  const p = S.params; const cat = p.categories || {}, mod = p.modes || {};
  const tab = (o, id, t) => `<table id="${id}"><thead><tr><th>${t}</th><th>Compte</th><th></th></tr></thead><tbody>${Object.entries(o).map(([k, v]) => `<tr><td><input class="k" value="${esc(k)}"></td><td><input class="v mono" list="dl_m" value="${esc(v)}" size="8"></td><td><button class="link danger x">×</button></td></tr>`).join("")}</tbody></table><button class="add" data-t="${id}">Ajouter</button>`;
  el.innerHTML = `${datalistComptes("dl_m")}<div class="split"><div class="panel"><h2>Catégories de dépenses</h2><p class="small muted">Compte de charge utilisé par défaut pour chaque catégorie de facture.</p>${tab(cat, "tc", "Catégorie")}</div>
  <div class="panel"><h2>Modes de paiement</h2><p class="small muted">Compte de trésorerie débité à chaque règlement.</p>${tab(mod, "tm", "Mode")}</div></div><div class="row end"><button class="primary" id="mok">Enregistrer</button></div>`;
  const lier = () => $$(".x", el).forEach((b) => (b.onclick = () => b.closest("tr").remove()));
  lier(); $$(".add", el).forEach((b) => (b.onclick = () => { const tr = document.createElement("tr"); tr.innerHTML = `<td><input class="k"></td><td><input class="v mono" list="dl_m" size="8"></td><td><button class="link danger x">×</button></td>`; $(`#${b.dataset.t} tbody`).appendChild(tr); lier(); }));
  const lire = (id) => Object.fromEntries($$(`#${id} tbody tr`).map((tr) => [C.norm($(".k", tr).value), $(".v", tr).value.trim()]).filter(([k, v]) => k && v));
  $("#mok").onclick = () => action(async () => {
    const c = lire("tc"), m = lire("tm"); const conn = new Set(S.comptes.map((x) => x.numero));
    for (const v of [...Object.values(c), ...Object.values(m)]) if (!conn.has(v)) throw new Error(`Compte ${v} absent du plan comptable.`);
    await enregParams({ ...S.params, categories: c, modes: m });
  }, "Enregistré");
}
function vUsers(el) {
  const R = { gerant: "Gérant", comptable: "Comptable", caissier: "Caisse", desactive: "Désactivé" };
  el.innerHTML = `<div class="panel"><div class="row"><h2 class="grow">Utilisateurs</h2><button class="primary" id="nu">Créer un compte</button></div>
  <table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th></tr></thead><tbody>${S.profiles.map((p) => `<tr><td>${esc(p.nom)}</td><td>${esc(p.email)}</td><td>${p.id === S.user.id ? R[p.role] : `<select data-u="${p.id}">${Object.entries(R).map(([k, n]) => `<option value="${k}" ${k === p.role ? "selected" : ""}>${n}</option>`).join("")}</select>`}</td></tr>`).join("")}</tbody></table>
  <ul class="small muted"><li><b>Comptable</b> : comptabilité, fournisseurs, caisse, carburant, planning. Ne voit ni les fiches salariés ni la paie.</li><li><b>Caisse</b> : importe les décomptes, dépose les factures en photo, saisit les jauges, consulte le planning. Ne voit pas la comptabilité.</li><li><b>Désactivé</b> : plus aucun accès, à appliquer le jour d'un départ.</li></ul></div>`;
  $$("[data-u]", el).forEach((s) => (s.onchange = () => action(async () => { await DB.upd("profiles", { id: s.dataset.u }, { role: s.value }); S.profiles = await DB.sel("profiles", { order: "nom" }); }, "Rôle modifié")));
  $("#nu").onclick = () => {
    const m = modal("Créer un compte", `<form class="form" id="fu"><label>Nom<input name="nom" required></label><label>E-mail<input type="email" name="email" required></label>
      <label>Rôle<select name="role"><option value="caissier">Caisse</option><option value="comptable">Comptable</option><option value="gerant">Gérant</option></select></label></form><div id="ur"></div><div class="row end"><button class="primary" id="uok">Créer</button></div>`);
    $("#uok", m).onclick = () => action(async () => {
      const f = $("#fu", m); if (!f.reportValidity()) return;
      const pwd = motDePasse(); const email = f.email.value.trim().toLowerCase();
      const sec = S.sbCreation || (S.sbCreation = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "station-creation" } }));
      const { data, error } = await sec.auth.signUp({ email, password: pwd }); if (error) throw new Error(error.message);
      if (!data.user || (data.user.identities && !data.user.identities.length)) throw new Error("Cette adresse a déjà un compte.");
      await DB.ins("profiles", { id: data.user.id, nom: f.nom.value.trim(), email, role: f.role.value }, { upsert: true, onConflict: "id" });
      S.profiles = await DB.sel("profiles", { order: "nom" });
      $("#ur", m).innerHTML = `<p>Compte créé. Transmettez ces informations à ${esc(f.nom.value)} :</p><p class="mono box">Adresse : ${esc(location.origin + location.pathname)}<br>E-mail : ${esc(email)}<br>Mot de passe provisoire : ${esc(pwd)}</p><p class="small muted">Il pourra le changer avec « Mon mot de passe ».</p>`;
      $("#uok", m).remove(); vUsers(el);
    });
  };
}
function motDePasse() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const v = new Uint32Array(12); crypto.getRandomValues(v); return [...v].map((x) => a[x % a.length]).join(""); }
function changerMdp() {
  const m = modal("Mon mot de passe", `<form class="form one" id="fm"><label>Nouveau mot de passe (8 caractères minimum)<input type="password" name="p1" minlength="8" required autocomplete="new-password"></label><label>Confirmer<input type="password" name="p2" required autocomplete="new-password"></label></form><div class="row end"><button class="primary" id="mok">Changer</button></div>`);
  $("#mok", m).onclick = () => action(async () => { const f = $("#fm", m); if (!f.reportValidity()) return; if (f.p1.value !== f.p2.value) throw new Error("Les deux mots de passe diffèrent."); const { error } = await DB.client.auth.updateUser({ password: f.p1.value }); if (error) throw new Error(error.message); m.remove(); }, "Mot de passe changé");
}

/* =====================================================================
   CONNEXION ET DÉMARRAGE
   ===================================================================== */
async function ecranConnexion() {
  let init = true; try { init = !!(await DB.rpc("base_initialisee")); } catch {}
  $("#app").innerHTML = `<div class="login panel"><h1>Station MOBIL Boulouparis</h1>
    ${init ? `<p class="muted">Connectez-vous pour accéder à la gestion de la station.</p>` : `<p><b>Premier démarrage.</b> Créez le compte du gérant : il aura tous les droits.</p>`}
    <form class="form one" id="fl">${init ? "" : `<label>Votre nom<input name="nom" required></label>`}
    <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
    <label>Mot de passe<input type="password" name="pwd" required minlength="8" autocomplete="${init ? "current-password" : "new-password"}"></label>
    <button class="primary">${init ? "Se connecter" : "Créer le compte gérant"}</button></form></div>`;
  $("#fl").onsubmit = (e) => { e.preventDefault(); action(async () => {
    const f = e.target; const email = f.email.value.trim().toLowerCase(), password = f.pwd.value;
    const nonConfirme = (m) => /not confirmed/i.test(m || "");
    const MSG_CONF = "Adresse e-mail pas encore confirmée : cliquez sur le lien reçu par e-mail de Supabase (même si la page qui s'ouvre affiche une erreur), puis reconnectez-vous ici. Le gérant peut aussi désactiver « Confirm email » dans Supabase.";
    if (init) { const { error } = await DB.client.auth.signInWithPassword({ email, password }); if (error) throw new Error(nonConfirme(error.message) ? MSG_CONF : /Invalid/.test(error.message) ? "E-mail ou mot de passe incorrect." : error.message); }
    else {
      let { data: su, error } = await DB.client.auth.signUp({ email, password });
      if ((error && /already registered/i.test(error.message)) || (!error && !su?.session)) ({ error } = await DB.client.auth.signInWithPassword({ email, password }));
      if (error) throw new Error(nonConfirme(error.message) ? MSG_CONF : /Invalid/.test(error.message) ? "Ce compte existe déjà avec un autre mot de passe." : error.message);
      const ok = await DB.rpc("premier_gerant", { p_nom: f.nom.value.trim() }); if (!ok) throw new Error("Un gérant existe déjà : connectez-vous.");
    }
    await demarrer();
  }); };
}
async function demarrer() {
  const { data } = await DB.client.auth.getSession(); S.user = data.session?.user || null;
  if (!S.user) return ecranConnexion();
  const prof = (await DB.sel("profiles", { eq: { id: S.user.id } }))[0];
  S.role = prof?.role || "aucun"; S.nom = prof?.nom || S.user.email;
  if (!["gerant", "comptable", "caissier"].includes(S.role)) {
    $("#app").innerHTML = `<div class="login panel"><h1>Accès en attente</h1><p>Votre compte (${esc(S.user.email)}) n'a pas encore de rôle. Demandez au gérant de vous en attribuer un.</p><button id="deco">Se déconnecter</button></div>`;
    $("#deco").onclick = async () => { await DB.client.auth.signOut(); location.reload(); }; return;
  }
  await chargerTout(); rendre();
}
window.STATION = { S, demarrer, chargerTout };
window.addEventListener("DOMContentLoaded", () => {
  if (!window.SUPABASE_URL) { $("#app").innerHTML = `<div class="panel">Configuration Supabase manquante (supabase-config.js).</div>`; return; }
  const client = window.__SB_MOCK__ || supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "station-boulouparis" } });
  DB.init(client);
  demarrer().catch((e) => { console.error(e); $("#app").innerHTML = `<div class="login panel"><h1>Impossible de charger les données</h1><p class="bad">${esc(e.message || e)}</p><div class="row"><button class="primary" onclick="location.reload()">Réessayer</button><button id="deco2">Se déconnecter</button></div></div>`; $("#deco2").onclick = async () => { await DB.client.auth.signOut(); location.reload(); }; });
});
