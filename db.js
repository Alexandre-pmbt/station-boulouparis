/* ===== Accès aux données (Supabase) ===== */
const DB = (() => {
  let sb = null;
  const fail = (error) => {
    const e = new Error(traduire(error.message || "Erreur"));
    e.code = error.code; return e;
  };
  function traduire(m) {
    if (/row-level security|permission denied|42501/i.test(m)) return "Accès refusé pour votre rôle.";
    if (/duplicate key/i.test(m)) return "Cet élément existe déjà.";
    if (/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
    if (/violates foreign key.*comptes/i.test(m)) return "Compte comptable inconnu : créez-le d'abord dans le plan comptable.";
    return m;
  }
  function q(table, o = {}) {
    let x = sb.from(table).select(o.cols || "*");
    for (const [k, v] of Object.entries(o.eq || {})) x = x.eq(k, v);
    for (const [k, v] of Object.entries(o.gte || {})) x = x.gte(k, v);
    for (const [k, v] of Object.entries(o.lte || {})) x = x.lte(k, v);
    for (const [k, v] of Object.entries(o.in || {})) x = x.in(k, v);
    for (const ord of [].concat(o.order || [])) { const [c, d] = ord.split(" "); x = x.order(c, { ascending: d !== "desc" }); }
    return x;
  }
  return {
    init(client) { sb = client; },
    get client() { return sb; },
    async sel(table, o = {}) {
      const out = []; const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await q(table, o).range(from, from + page - 1);
        if (error) throw fail(error);
        out.push(...data); if (data.length < page) break;
      }
      return out;
    },
    async ins(table, rows, o = {}) {
      const arr = Array.isArray(rows) ? rows : [rows]; const out = [];
      for (let i = 0; i < arr.length; i += 300) {
        let x = o.upsert ? sb.from(table).upsert(arr.slice(i, i + 300), { onConflict: o.onConflict, ignoreDuplicates: !!o.ignore }) : sb.from(table).insert(arr.slice(i, i + 300));
        const { data, error } = await x.select();
        if (error) throw fail(error); out.push(...(data || []));
      }
      return Array.isArray(rows) ? out : out[0];
    },
    async upd(table, match, patch) {
      let x = sb.from(table).update(patch);
      for (const [k, v] of Object.entries(match)) x = x.eq(k, v);
      const { data, error } = await x.select(); if (error) throw fail(error);
      if (!data.length) throw new Error("Modification refusée ou élément introuvable.");
      return data[0];
    },
    async del(table, match) {
      let x = sb.from(table).delete();
      for (const [k, v] of Object.entries(match)) x = x.eq(k, v);
      const { error } = await x; if (error) throw fail(error);
    },
    async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw fail(error); return data; },
    async upload(path, file) {
      const { error } = await sb.storage.from("pieces").upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) throw fail(error); return path;
    },
    async lien(path) {
      const { data, error } = await sb.storage.from("pieces").createSignedUrl(path, 300);
      if (error) throw fail(error); return data.signedUrl;
    },
  };
})();
