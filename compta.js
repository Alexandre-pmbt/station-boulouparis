/* ===== Moteur comptable de la station (sans affichage, testable seul) ===== */
(function (root) {
  "use strict";
  const TAUX_COLLECTEE = { 3: "445711", 6: "445712", 11: "445713", 22: "445714" };
  const TAUX_DEDUCTIBLE = { 3: "445661", 6: "445662", 11: "445663", 22: "445664" };
  const TAUX = [0, 3, 6, 11, 22];

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  function num(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[\s  ]/g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  const int = (v) => Math.round(num(v));
  const isCode = (v) => v != null && /^\s*[0-9]{1,4}\s*$/.test(String(v));
  function frDate(s) { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
  function excelDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
    if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    return null;
  }

  /* ---------- Lecture du « Décompte de caisse cumulé » EURODATA ----------
     rows : tableau de lignes (sheet_to_json header:1). Repère les colonnes par les en-têtes. */
  function lireDecompteEurodata(rows) {
    const R = rows.map((r) => (r || []).map((c) => (c == null ? "" : c)));
    const txt = (r) => r.map((c) => String(c)).join(" ");
    const out = { societe: "", periode: null, ventes: [], autres: [], encaissements: [], ecartEurodata: 0, recapTgc: [], carburants: [], alertes: [] };
    out.societe = String(R[0]?.[0] || "").trim();
    const iPer = R.findIndex((r) => /P[ée]riode\s*:/i.test(txt(r)));
    if (iPer >= 0) {
      const ds = txt(R[iPer]).match(/(\d{2}\/\d{2}\/\d{4})/g) || [];
      out.periode = { debut: frDate(ds[0]), fin: frDate(ds[1] || ds[0]) };
    }
    if (!out.periode || !out.periode.debut) throw new Error("Période introuvable : ce fichier n'est pas un décompte de caisse EURODATA.");

    const findCol = (r, re) => r.findIndex((c) => re.test(norm(c)));
    const iVentes = R.findIndex((r) => norm(r[0]) === "VENTES");
    const iEnc = R.findIndex((r) => norm(r[0]) === "ENCAISSEMENTS");
    const iRecap = R.findIndex((r) => /RECAPITULATIF PAR BASE/.test(norm(r[0])));
    const iCarb = R.findIndex((r) => /DETAIL DES CARBURANTS/.test(norm(r[0])));
    if (iVentes < 0 || iEnc < 0) throw new Error("Sections VENTES / ENCAISSEMENTS introuvables dans le fichier.");

    // VENTES
    const h = R[iVentes + 1];
    const cLib = findCol(h, /^LIBELLE/), cCpt = findCol(h, /^COMPTE/), cTva = findCol(h, /^CODE ?TVA/), cQte = findCol(h, /^QUANTITE/),
      cHt = findCol(h, /HORS TAXES/), cMt = findCol(h, /^MONTANTS ?TVA/), cTtc = findCol(h, /TOUTES TAXES/);
    for (let i = iVentes + 2; i < iEnc; i++) {
      const r = R[i]; const lib = String(r[cLib] || "").trim(); const cpt = String(r[cCpt] || "").trim();
      if (!lib || /^TOTAL/i.test(norm(lib)) || !cpt) continue;
      const ligne = { code: String(r[cLib - 1] ?? r[0]).trim(), libelle: lib, compte: cpt, codeTva: String(r[cTva] ?? "").trim(),
        quantite: num(r[cQte]), ht: int(r[cHt]), tgc: int(r[cMt]), ttc: int(r[cTtc]) };
      if (ligne.codeTva === "" && ligne.tgc === 0) out.autres.push(ligne); else out.ventes.push(ligne);
    }
    // ENCAISSEMENTS
    const he = R[iEnc + 1];
    const eLib = findCol(he, /^LIBELLE/), eCpt = findCol(he, /^COMPTE/), eMt = findCol(he, /^MONTANT/);
    const finEnc = [iRecap, iCarb, R.length].filter((x) => x > iEnc).sort((a, b) => a - b)[0];
    for (let i = iEnc + 2; i < finEnc; i++) {
      const r = R[i]; const lib = String(r[eLib] || "").trim(); const cpt = String(r[eCpt] || "").trim();
      if (!lib || /^TOTAL/.test(norm(lib)) || !cpt) continue;
      if (/^DIFFERENCE DE CAISSE/.test(norm(lib))) { out.ecartEurodata = int(r[eMt]) * (/\+/.test(lib) ? 1 : -1); continue; }
      out.encaissements.push({ code: String(r[eLib - 1] ?? "").trim(), libelle: lib, compte: cpt, montant: int(r[eMt]) });
    }
    // RÉCAPITULATIF TGC
    if (iRecap >= 0) {
      let hr = -1; for (let i = iRecap; i < iRecap + 5; i++) if (findCol(R[i] || [], /^CODE$/) >= 0) { hr = i; break; }
      if (hr >= 0) {
        const H = R[hr]; const rCode = findCol(H, /^CODE$/), rOrig = findCol(H, /^ORIGINE$/), rTaux = findCol(H, /^TAUX$/), rHt = findCol(H, /^HT$/), rTva = findCol(H, /^TVA$/), rTtc = findCol(H, /^TTC$/);
        for (let i = hr + 1; i < (iCarb > hr ? iCarb : R.length); i++) {
          const r = R[i]; if (!isCode(r[rCode]) || String(r[rOrig]).trim() === "") continue;
          out.recapTgc.push({ origine: String(r[rOrig]).trim(), code: String(r[rCode]).trim(), taux: num(r[rTaux]), ht: int(r[rHt]), tgc: int(r[rTva]), ttc: int(r[rTtc]) });
        }
      }
    }
    // CARBURANTS
    if (iCarb >= 0) {
      const H = R[iCarb + 1]; const kLib = findCol(H, /^CARBURANT/), kQ = findCol(H, /^QUANTITE/), kP = findCol(H, /^PRIX/), kHt = findCol(H, /HORS TAXES/), kTtc = findCol(H, /TOUTES TAXES/);
      for (let i = iCarb + 2; i < R.length; i++) {
        const r = R[i]; const lib = String(r[kLib] || "").trim(); if (!lib) continue; if (/^TOTAL/.test(norm(lib))) break;
        out.carburants.push({ produit: /GAZOLE|GASOIL|DIESEL/.test(norm(lib)) ? "GAZOLE" : "SANS PLOMB", libelle: lib, litres: num(r[kQ]), prix: num(r[kP]), ht: int(r[kHt]), ttc: int(r[kTtc]) });
      }
    }
    // Taux par code TGC (depuis le récapitulatif)
    out.tauxParCode = {};
    for (const x of out.recapTgc) out.tauxParCode[x.code] = x.taux;
    // Totaux et contrôle
    out.totalDu = sum(out.ventes, "ttc") + sum(out.autres, "ttc");
    out.totalEncaisse = sum(out.encaissements, "montant");
    out.ecart = out.totalEncaisse - out.totalDu; // négatif = manque
    if (out.ecartEurodata && out.ecartEurodata !== out.ecart) out.alertes.push(`Écart recalculé (${out.ecart}) différent de celui d'EURODATA (${out.ecartEurodata}).`);
    for (const v of out.ventes) if (v.ht + v.tgc !== v.ttc) out.alertes.push(`Ligne ${v.libelle} : HT + TGC ≠ TTC.`);
    return out;
  }
  const sum = (a, k) => a.reduce((s, x) => s + (k ? x[k] : x), 0);

  /* ---------- Écriture d'un décompte de caisse ---------- */
  function ecritureCaisse(dec, opts = {}) {
    const autresRecettes = opts.compteAutresRecettes || "758000";
    const lignes = []; const tgc = {}; const nouveauxComptes = [];
    for (const v of dec.ventes) {
      lignes.push({ compte: v.compte, libelle: v.libelle, debit: 0, credit: v.ht });
      if (v.tgc) {
        const taux = dec.tauxParCode[v.codeTva];
        if (!TAUX_COLLECTEE[taux]) throw new Error(`Taux de TGC inconnu pour le code ${v.codeTva} (${v.libelle}).`);
        tgc[taux] = (tgc[taux] || 0) + v.tgc;
      }
      nouveauxComptes.push({ numero: v.compte, libelle: "Ventes " + v.libelle.toLowerCase() });
    }
    for (const t of Object.keys(tgc).map(Number).sort((a, b) => a - b)) lignes.push({ compte: TAUX_COLLECTEE[t], libelle: `TGC collectée ${t} %`, debit: 0, credit: tgc[t] });
    for (const a of dec.autres) {
      const cpt = a.compte === "999999" ? autresRecettes : a.compte;
      lignes.push({ compte: cpt, libelle: a.libelle, debit: 0, credit: a.ttc });
    }
    for (const e of dec.encaissements) { lignes.push({ compte: e.compte, libelle: e.libelle, debit: e.montant, credit: 0 }); nouveauxComptes.push({ numero: e.compte, libelle: e.libelle }); }
    if (dec.ecart < 0) lignes.push({ compte: "658000", libelle: "Manque de caisse", debit: -dec.ecart, credit: 0 });
    if (dec.ecart > 0) lignes.push({ compte: "758100", libelle: "Excédent de caisse", debit: 0, credit: dec.ecart });
    const p = dec.periode;
    const per = p.debut === p.fin ? fmtD(p.debut) : `${fmtD(p.debut)} au ${fmtD(p.fin)}`;
    return {
      journal: "CA", date: p.fin, piece: "Z " + p.fin.replace(/-/g, "") + (p.debut !== p.fin ? "C" : ""),
      libelle: "Recettes caisse EURODATA " + per, lignes, nouveauxComptes, tgc,
    };
  }
  const fmtD = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "");

  /* ---------- Facture fournisseur ---------- */
  function ventilationDefaut(facture, compteCategorie) {
    return [{ compte: compteCategorie || "471000", taux: 0, ht: facture.montant_ttc, tgc: 0 }];
  }
  function ecritureFacture(f, tiers, compteCategorie) {
    const vent = (f.ventilation && f.ventilation.length) ? f.ventilation : ventilationDefaut(f, compteCategorie);
    const total = vent.reduce((s, v) => s + int(v.ht) + int(v.tgc), 0);
    if (total !== int(f.montant_ttc)) throw new Error(`Ventilation (${total}) différente du montant TTC (${f.montant_ttc}).`);
    const avoir = f.montant_ttc < 0;
    const L = []; const tgc = {};
    for (const v of vent) {
      const ht = int(v.ht); if (ht) L.push(sens(v.compte, ht, f.libelle || tiers.nom));
      const t = int(v.tgc); if (t) { if (!TAUX_DEDUCTIBLE[v.taux]) throw new Error("Taux de TGC invalide : " + v.taux); tgc[v.taux] = (tgc[v.taux] || 0) + t; }
    }
    for (const t of Object.keys(tgc)) L.push(sens(TAUX_DEDUCTIBLE[t], tgc[t], `TGC déductible ${t} %`));
    L.push({ ...sens(tiers.compte || "401000", -int(f.montant_ttc), tiers.nom), tiers_id: tiers.id });
    return { journal: "AC", date: f.date_facture, piece: f.numero || "", libelle: `${avoir ? "Avoir" : "Facture"} ${tiers.nom}${f.numero ? " " + f.numero : ""}`, source: "facture", source_id: f.id, lignes: L };
  }
  // montant positif = débit, négatif = crédit
  function sens(compte, m, libelle) { return m >= 0 ? { compte, libelle, debit: m, credit: 0 } : { compte, libelle, debit: 0, credit: -m }; }

  function ecritureReglement(r, tiers) {
    const tres = r.compte_tresorerie || "512000";
    return {
      journal: tres.startsWith("512") ? "BQ" : "CA", date: r.date, piece: r.reference || r.mode,
      libelle: `Règlement ${tiers.nom} (${r.mode.toLowerCase()})`, source: "reglement", source_id: r.id,
      lignes: [{ compte: tiers.compte || "401000", tiers_id: tiers.id, libelle: tiers.nom, debit: r.montant, credit: 0 }, { compte: tres, libelle: r.mode, debit: 0, credit: r.montant }],
    };
  }

  /* ---------- Paie du mois (totaux des bulletins) ---------- */
  function ecriturePaie(mois, p) {
    const brut = int(p.brut), salCafat = int(p.sal_cafat), salAutres = int(p.sal_autres), patCafat = int(p.pat_cafat), patAutres = int(p.pat_autres), acomptes = int(p.acomptes);
    const net = brut - salCafat - salAutres;
    const fin = finMois(mois);
    return {
      journal: "SA", date: fin, piece: "PAIE " + mois, libelle: "Salaires " + moisFr(mois), source: "paie",
      lignes: [
        { compte: "641000", libelle: "Salaires bruts", debit: brut, credit: 0 },
        { compte: "645100", libelle: "Charges patronales CAFAT", debit: patCafat, credit: 0 },
        { compte: "645300", libelle: "Charges patronales retraite et prévoyance", debit: patAutres, credit: 0 },
        { compte: "431000", libelle: "CAFAT", debit: 0, credit: salCafat + patCafat },
        { compte: "437000", libelle: "Retraite et prévoyance", debit: 0, credit: salAutres + patAutres },
        { compte: "425000", libelle: "Acomptes versés", debit: 0, credit: acomptes },
        { compte: "421000", libelle: "Net à payer", debit: 0, credit: net - acomptes },
      ],
      net,
    };
  }
  function finMois(m) { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo, 0)); return d.toISOString().slice(0, 10); }
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisFr = (m) => MOIS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4);

  /* ---------- États ---------- */
  function balance(lignes, comptes) {
    const lib = {}; for (const c of comptes || []) lib[c.numero] = c.libelle;
    const m = new Map();
    for (const l of lignes) { const b = m.get(l.compte) || { compte: l.compte, libelle: lib[l.compte] || "", debit: 0, credit: 0 }; b.debit += +l.debit; b.credit += +l.credit; m.set(l.compte, b); }
    return [...m.values()].map((b) => ({ ...b, solde: b.debit - b.credit })).sort((a, b) => a.compte.localeCompare(b.compte));
  }
  const RUBRIQUES_RESULTAT = [
    ["Ventes de carburants", (c) => /^70700[0-9]$/.test(c) && ["707003", "707007"].includes(c), "P"],
    ["Ventes boutique et services", (c) => c.startsWith("70"), "P"],
    ["Autres produits", (c) => /^7[1-9]/.test(c), "P"],
    ["Achats de marchandises", (c) => c.startsWith("607") || c.startsWith("6037"), "C"],
    ["Charges externes", (c) => /^6[12]/.test(c) || c.startsWith("606") || c.startsWith("604"), "C"],
    ["Impôts et taxes", (c) => c.startsWith("63"), "C"],
    ["Salaires et charges sociales", (c) => c.startsWith("64"), "C"],
    ["Autres charges de gestion", (c) => c.startsWith("65"), "C"],
    ["Charges financières", (c) => c.startsWith("66"), "C"],
    ["Charges exceptionnelles", (c) => c.startsWith("67"), "C"],
    ["Dotations aux amortissements et provisions", (c) => c.startsWith("68"), "C"],
    ["Impôt sur les sociétés", (c) => c.startsWith("69"), "C"],
  ];
  function compteResultat(bal, comptesCarburant) {
    const carb = new Set(comptesCarburant || ["707003", "707007"]);
    const rub = RUBRIQUES_RESULTAT.map(([nom, , t]) => ({ nom, type: t, montant: 0, comptes: [] }));
    for (const b of bal) {
      if (!/^[67]/.test(b.compte)) continue;
      let idx = b.compte.startsWith("70") && carb.has(b.compte) ? 0 : RUBRIQUES_RESULTAT.findIndex(([, f], i) => i > 0 && f(b.compte));
      if (idx < 0) idx = b.compte.startsWith("7") ? 2 : 7;
      const v = rub[idx].type === "P" ? -b.solde : b.solde;
      rub[idx].montant += v; rub[idx].comptes.push({ ...b, montant: v });
    }
    const produits = rub.filter((r) => r.type === "P").reduce((s, r) => s + r.montant, 0);
    const charges = rub.filter((r) => r.type === "C").reduce((s, r) => s + r.montant, 0);
    const ventes = rub[0].montant + rub[1].montant, achats = rub[3].montant;
    return { rubriques: rub, produits, charges, resultat: produits - charges, margeCommerciale: ventes - achats };
  }
  function bilan(bal) {
    const A = { "Immobilisations nettes": 0, "Stocks": 0, "Créances clients et autres": 0, "TGC et État (débiteur)": 0, "Trésorerie": 0 };
    const P = { "Capitaux propres": 0, "Résultat de la période": 0, "Emprunts": 0, "Fournisseurs": 0, "Dettes sociales": 0, "TGC et État (créditeur)": 0, "Autres dettes": 0, "Découverts bancaires": 0 };
    let res = 0;
    for (const b of bal) {
      const c = b.compte, s = b.solde;
      if (/^[67]/.test(c)) { res -= s; continue; }
      if (c.startsWith("10") || c.startsWith("11") || c.startsWith("12") || c.startsWith("13") || c.startsWith("14") || c.startsWith("15")) P["Capitaux propres"] -= s;
      else if (c.startsWith("16") || c.startsWith("17")) P["Emprunts"] -= s;
      else if (c.startsWith("2")) A["Immobilisations nettes"] += s;
      else if (c.startsWith("3")) A["Stocks"] += s;
      else if (c.startsWith("5")) { if (s >= 0) A["Trésorerie"] += s; else P["Découverts bancaires"] -= s; }
      else if (c.startsWith("4")) {
        if (c.startsWith("40")) { if (s <= 0) P["Fournisseurs"] -= s; else A["Créances clients et autres"] += s; }
        else if (c.startsWith("42") || c.startsWith("43")) { if (s <= 0) P["Dettes sociales"] -= s; else A["Créances clients et autres"] += s; }
        else if (c.startsWith("44")) { if (s >= 0) A["TGC et État (débiteur)"] += s; else P["TGC et État (créditeur)"] -= s; }
        else { if (s >= 0) A["Créances clients et autres"] += s; else P["Autres dettes"] -= s; }
      } else if (c === "999999") { if (s >= 0) A["Créances clients et autres"] += s; else P["Autres dettes"] -= s; }
    }
    P["Résultat de la période"] = res;
    const tA = Object.values(A).reduce((a, b) => a + b, 0), tP = Object.values(P).reduce((a, b) => a + b, 0);
    return { actif: A, passif: P, totalActif: tA, totalPassif: tP };
  }

  /* ---------- TGC du mois ---------- */
  function declarationTgc(bal, imports) {
    const g = (c) => bal.find((b) => b.compte === c);
    const lignes = [3, 6, 11, 22].map((t) => {
      const col = g(TAUX_COLLECTEE[t]); const ded = g(TAUX_DEDUCTIBLE[t]);
      return { taux: t, collectee: col ? -col.solde : 0, deductible: ded ? ded.solde : 0 };
    });
    // Bases HT déclarées par la caisse (récapitulatif EURODATA)
    // Code 0 = hors champ (règlements de crédits, autres recettes) ; taux 0 avec un autre code = ventes exonérées
    const bases = {}; for (const t of TAUX) bases[t] = 0; let horsChamp = 0;
    for (const imp of imports || []) for (const r of (imp.data?.recapTgc || [])) {
      if (r.origine !== "0" || r.code === "0") { horsChamp += r.ht; continue; }
      bases[r.taux || 0] = (bases[r.taux || 0] || 0) + r.ht;
    }
    for (const l of lignes) l.base = bases[l.taux] || 0;
    const collectee = lignes.reduce((s, l) => s + l.collectee, 0), deductible = lignes.reduce((s, l) => s + l.deductible, 0);
    return { lignes, baseExonere: bases[0] || 0, horsChamp, collectee, deductible, net: collectee - deductible };
  }
  function ecritureLiquidationTgc(mois, decl) {
    const L = [];
    for (const l of decl.lignes) {
      if (l.collectee) L.push(sens(TAUX_COLLECTEE[l.taux], l.collectee, `TGC collectée ${l.taux} %`));
      if (l.deductible) L.push(sens(TAUX_DEDUCTIBLE[l.taux], -l.deductible, `TGC déductible ${l.taux} %`));
    }
    L.push(sens("445510", -decl.net, decl.net >= 0 ? "TGC à décaisser" : "Crédit de TGC"));
    return { journal: "OD", date: finMois(mois), piece: "TGC " + mois, libelle: "Liquidation TGC " + moisFr(mois), source: "tgc", lignes: L };
  }

  /* ---------- Rapprochement carburant (cuves / ventes / livraisons) ---------- */
  function rapprochementCarburant(imports, cuves) {
    const out = [];
    const jauge = (date, produit) => cuves.find((c) => c.date === date && c.produit === produit && c.jauge != null);
    const veille = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
    for (const imp of imports) {
      const d = imp.data; if (!d?.carburants?.length) continue;
      for (const produit of ["GAZOLE", "SANS PLOMB"]) {
        const ventes = d.carburants.filter((c) => c.produit === produit).reduce((s, c) => s + c.litres, 0);
        const j0 = jauge(veille(imp.date_debut), produit), j1 = jauge(imp.date_fin, produit);
        const livr = cuves.filter((c) => c.produit === produit && c.date >= imp.date_debut && c.date <= imp.date_fin).reduce((s, c) => s + num(c.livraison), 0);
        const r = { periode: [imp.date_debut, imp.date_fin], produit, ventes, livraisons: livr, jaugeDebut: j0 ? num(j0.jauge) : null, jaugeFin: j1 ? num(j1.jauge) : null };
        if (r.jaugeDebut != null && r.jaugeFin != null) { r.theorique = r.jaugeDebut + livr - ventes; r.ecart = r.jaugeFin - r.theorique; r.ecartPct = ventes ? (r.ecart / ventes) * 100 : 0; }
        out.push(r);
      }
    }
    return out;
  }

  /* ---------- Reprise du fichier « REGLEMENT FOURNISSEUR » ---------- */
  function lireHistoriqueFournisseurs(rows) {
    const H = (rows[0] || []).map(norm);
    const col = (re) => H.findIndex((h) => re.test(h));
    const c = { f: col(/^FOURNISSEURS?$/), d: col(/^DESIGNATION/), n: col(/^N. ?DE FACTURE/), desc: col(/^DESCRIPTIF/), m: col(/^MONTANT/), de: col(/^DATE EMISSION/), dp: col(/^DATE DE PAIEMENT/), e: col(/^ECHEANCE/), mode: col(/^MODE/), np: col(/^N. ?DE PAIEMENT/), com: col(/^COMMENTAIRE/) };
    if (c.f < 0 || c.m < 0) throw new Error("Colonnes FOURNISSEURS / MONTANT TTC introuvables (onglet « RECAP PAIEMENTS »).");
    const factures = [], rejets = [];
    const MODES = { CHQ: "CHEQUE", CHEQUE: "CHEQUE", VIREMENT: "VIREMENT", PRELEVEMENT: "PRELEVEMENT", CB: "CB", ESPECES: "ESPECES", "RETOUR DE FONDS": "RETOUR DE FONDS" };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || []; const nom = norm(r[c.f]); if (!nom) continue;
      const m = r[c.m];
      if (typeof m !== "number" && !/^-?[\d\s.,]+$/.test(String(m ?? "").trim())) { rejets.push({ ligne: i + 1, fournisseur: nom, raison: "Montant illisible : " + String(m ?? "(vide)") }); continue; }
      const dateF = excelDate(r[c.de]);
      if (!dateF) { rejets.push({ ligne: i + 1, fournisseur: nom, raison: "Date d'émission manquante" }); continue; }
      const avoir = /AVOIR/.test(norm(r[c.d]));
      const mt = Math.abs(int(m)) * (avoir ? -1 : 1);
      factures.push({
        fournisseur: nom, numero: String(r[c.n] ?? "").trim(), categorie: norm(r[c.desc]) || null, montant_ttc: mt,
        date_facture: dateF, echeance: excelDate(r[c.e]), date_paiement: excelDate(r[c.dp]),
        mode: MODES[norm(r[c.mode])] || (norm(r[c.mode]) || null), ref_paiement: String(r[c.np] ?? "").trim() || null,
        commentaire: String(r[c.com] ?? "").trim() || null, ligne: i + 1,
      });
    }
    return { factures, rejets };
  }
  // Regroupe les variantes d'écriture d'un même fournisseur (espaces, accents, casse)
  function cleFournisseur(n) { return norm(n).replace(/[^A-Z0-9]/g, ""); }

  /* ---------- Export FEC ---------- */
  const JOURNAUX = { CA: "Caisse", AC: "Achats", BQ: "Banque", OD: "Opérations diverses", SA: "Salaires", AN: "À-nouveaux", VT: "Ventes" };
  function exportFEC(ecritures, lignesParEcriture, comptes, tiers) {
    const lib = Object.fromEntries((comptes || []).map((c) => [c.numero, c.libelle]));
    const tn = Object.fromEntries((tiers || []).map((t) => [t.id, t.nom]));
    const head = "JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise";
    const d8 = (s) => s.replace(/-/g, "");
    const out = [head]; let n = 0;
    const tri = [...ecritures].sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal));
    for (const e of tri) {
      n++;
      for (const l of lignesParEcriture[e.id] || []) {
        out.push([e.journal, JOURNAUX[e.journal] || e.journal, n, d8(e.date), l.compte, lib[l.compte] || "", l.tiers_id ? l.tiers_id.slice(0, 8) : "", l.tiers_id ? tn[l.tiers_id] || "" : "",
          e.piece || "", d8(e.date), (l.libelle || e.libelle || "").replace(/\t/g, " "), String(l.debit), String(l.credit), l.lettrage || "", "", d8(e.date), "", ""].join("\t"));
      }
    }
    return out.join("\r\n");
  }

  /* ---------- Planning ---------- */
  // "6-14", "6h-14h30", "6:00-11 15-19" → heures
  function heuresCreneau(s) {
    let total = 0;
    for (const m of String(s || "").matchAll(/(\d{1,2})(?:[h:](\d{2})?)?\s*-\s*(\d{1,2})(?:[h:](\d{2})?)?/gi)) {
      const a = +m[1] + (+(m[2] || 0)) / 60; let b = +m[3] + (+(m[4] || 0)) / 60; if (b <= a) b += 24; total += b - a;
    }
    return Math.round(total * 100) / 100;
  }
  function semaineIso(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((d - y0) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
  }
  function lundiDeSemaine(sem) {
    const [y, w] = sem.split("-W").map(Number);
    const j4 = new Date(Date.UTC(y, 0, 4)); const day = j4.getUTCDay() || 7;
    const lundi = new Date(j4); lundi.setUTCDate(j4.getUTCDate() - day + 1 + (w - 1) * 7);
    return lundi;
  }
  function joursSemaine(sem) { const l = lundiDeSemaine(sem); return [...Array(7)].map((_, i) => { const d = new Date(l); d.setUTCDate(l.getUTCDate() + i); return d.toISOString().slice(0, 10); }); }

  /* Lecture d'une feuille SheetJS : les cellules au format date deviennent "AAAA-MM-JJ" (sans décalage horaire) */
  function lireFeuille(XLSX, ws) {
    const ref = ws["!ref"]; if (!ref) return [];
    const rg = XLSX.utils.decode_range(ref); const rows = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const row = [];
      for (let c = rg.s.c; c <= rg.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) { row.push(""); continue; }
        if (cell.t === "n" && ((cell.z && XLSX.SSF.is_date(cell.z)) || (!cell.z && cell.w && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell.w)))) { row.push(excelDate(cell.v) || ""); continue; }
        if (cell.t === "d") { row.push(excelDate(cell.v) || ""); continue; }
        row.push(cell.v);
      }
      rows.push(row);
    }
    return rows;
  }

  root.COMPTA = {
    lireFeuille,
    num, int, norm, excelDate, frDate, fmtD, finMois, moisFr, MOIS, TAUX, TAUX_COLLECTEE, TAUX_DEDUCTIBLE, JOURNAUX,
    lireDecompteEurodata, ecritureCaisse, ecritureFacture, ecritureReglement, ecriturePaie, sens,
    balance, compteResultat, bilan, declarationTgc, ecritureLiquidationTgc, rapprochementCarburant,
    lireHistoriqueFournisseurs, cleFournisseur, exportFEC, heuresCreneau, semaineIso, lundiDeSemaine, joursSemaine,
  };
})(typeof window !== "undefined" ? window : globalThis);
