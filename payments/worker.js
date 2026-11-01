// Fuel Run — betalen met Mollie (Cloudflare Worker)
// Geheimen (Cloudflare > Worker > Settings > Variables and Secrets):
//   MOLLIE_KEY  = je Mollie API-sleutel (test_... om te testen, live_... voor echt)
//   ADMIN_CODE  = dezelfde beheercode als in de god mode (HIGHSCORES BEHEREN)
// De prijzen komen uit de god mode (Firestore config/site), nooit van de speler zelf.

const PROJECT = 'fuel-run-9fe5c';
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const FB = `https://firestore.googleapis.com/v1/${DOCS}`;
const ITEMS = ['colors', 'name', 'ship', 'laser', 'emp'];
const ITEM_NAME = { colors: 'Kleuren', name: 'Naam op het vliegtuig', ship: 'Ander schip', laser: 'Superlaser', emp: 'EMP-explosie' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const cleanName = v => String(v || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').trim().slice(0, 10);
const num = v => v ? +(v.doubleValue ?? v.integerValue ?? 0) : 0;

async function fbGet(path) {
  const r = await fetch(`${FB}/${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore ' + r.status);
  return r.json();
}
async function siteConfig() {
  const d = await fbGet('config/site'); const f = (d && d.fields) || {};
  const eur = {}; for (const [k, v] of Object.entries((f.eur && f.eur.mapValue && f.eur.mapValue.fields) || {})) eur[k] = num(v);
  const packs = {}; for (const [k, v] of Object.entries((f.packs && f.packs.mapValue && f.packs.mapValue.fields) || {})) {
    const m = (v.mapValue && v.mapValue.fields) || {}; packs[k] = { c: Math.round(num(m.c)), e: num(m.e) };
  }
  return { eur, packs };
}
// The key as pasted in Cloudflare, without spaces, line breaks, quotes or a leading "Bearer".
const mollieKey = env => String(env.MOLLIE_KEY || '').replace(/^\s*bearer\s+/i, '').replace(/["'\s]/g, '');
async function mollie(env, path, init = {}) {
  const r = await fetch('https://api.mollie.com/v2/' + path, { ...init, headers: { Authorization: 'Bearer ' + mollieKey(env), 'Content-Type': 'application/json' } });
  const j = await r.json(); if (!r.ok) throw new Error('mollie ' + r.status + ' ' + (j.detail || ''));
  return j;
}

// Give the player what was paid for. Safe to call more than once: every payment id is booked only once.
async function credit(env, p) {
  if (p.status !== 'paid') return { status: p.status };
  const m = p.metadata || {}, n = cleanName(m.name);
  if (!n) return { status: 'paid', credited: false, error: 'geen naam' };
  const w = await fbGet('wallets/' + encodeURIComponent(n));
  if (!w) return { status: 'paid', credited: false, error: 'geen portemonnee' };
  const paid = (w.fields && w.fields.paid && w.fields.paid.mapValue && w.fields.paid.mapValue.fields) || {};
  if (paid[p.id]) return { status: 'paid', credited: true, kind: m.kind, id: m.id };
  const upd = { name: `${DOCS}/wallets/${n}`, fields: { paid: { mapValue: { fields: { [p.id]: { booleanValue: true } } } } } };
  const mask = ['paid.' + p.id], tr = [];
  if (m.kind === 'item' && ITEMS.includes(m.id)) { upd.fields.items = { mapValue: { fields: { [m.id]: { booleanValue: true } } } }; mask.push('items.' + m.id); }
  else if (m.kind === 'pack' && +m.c > 0) tr.push({ fieldPath: 'bonus', increment: { integerValue: String(Math.round(+m.c)) } });
  else return { status: 'paid', credited: false, error: 'onbekend artikel' };
  const writes = [
    { update: { name: `${DOCS}/admin/key`, fields: { c: { stringValue: String(env.ADMIN_CODE) } } }, updateMask: { fieldPaths: ['c'] }, updateTransforms: [{ fieldPath: 't', setToServerValue: 'REQUEST_TIME' }] },
    { update: upd, updateMask: { fieldPaths: mask }, updateTransforms: tr, currentDocument: { exists: true } }
  ];
  const r = await fetch(`${FB}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
  if (!r.ok) {   // maybe booked at the same moment by the webhook: check again
    const again = await fbGet('wallets/' + encodeURIComponent(n));
    const pd = (again && again.fields && again.fields.paid && again.fields.paid.mapValue && again.fields.paid.mapValue.fields) || {};
    if (pd[p.id]) return { status: 'paid', credited: true, kind: m.kind, id: m.id };
    return { status: 'paid', credited: false, error: 'boeken mislukt (' + r.status + ')' };
  }
  return { status: 'paid', credited: true, kind: m.kind, id: m.id };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (url.pathname === '/' || url.pathname === '/health') { const k = mollieKey(env), good = /^(test|live)_[A-Za-z0-9]{20,}$/.test(k);
        return json({ ok: true, mollie: good, admin: !!env.ADMIN_CODE, test: k.startsWith('test_'),
          key: k ? (good ? k.slice(0, 5) + '…' + ' (' + k.length + ' tekens)' : 'ongeldig: moet beginnen met test_ of live_ (nu: "' + k.slice(0, 5) + '…", ' + k.length + ' tekens)') : 'ontbreekt' }); }

      if (url.pathname === '/create' && req.method === 'POST') {
        const b = await req.json();
        const n = cleanName(b.name), kind = b.kind, id = String(b.id || '');
        if (!n) return json({ error: 'Kies eerst een spelersnaam.' }, 400);
        const w = await fbGet('wallets/' + encodeURIComponent(n));
        if (!w) return json({ error: 'Bescherm je naam eerst met een cijfercode (hangar).' }, 400);
        const cfg = await siteConfig();
        let eur = 0, desc = '', meta = { name: n, kind, id };
        if (kind === 'item') {
          if (!ITEMS.includes(id)) return json({ error: 'Onbekend artikel.' }, 400);
          const owned = w.fields && w.fields.items && w.fields.items.mapValue && w.fields.items.mapValue.fields && w.fields.items.mapValue.fields[id];
          if (owned && owned.booleanValue) return json({ error: 'Dit heb je al.' }, 400);
          eur = cfg.eur[id] || 0; desc = `Fuel Run: ${ITEM_NAME[id]} voor ${n}`;
        } else if (kind === 'pack') {
          const pk = cfg.packs[id]; if (!pk || !(pk.c > 0)) return json({ error: 'Onbekend pakket.' }, 400);
          eur = pk.e; meta.c = pk.c; desc = `Fuel Run: ${pk.c} FR-Coins voor ${n}`;
        } else return json({ error: 'Onbekende aankoop.' }, 400);
        if (!(eur >= 0.5)) return json({ error: 'Hiervoor is (nog) geen prijs ingesteld.' }, 400);
        const back = /^https?:\/\//.test(b.back || '') ? b.back : 'https://meerservices.github.io/fuel-run/';
        const p = await mollie(env, 'payments', { method: 'POST', body: JSON.stringify({
          amount: { currency: 'EUR', value: eur.toFixed(2) }, description: desc.slice(0, 250),
          redirectUrl: back + (back.includes('?') ? '&' : '?') + 'pay=1', webhookUrl: url.origin + '/webhook', metadata: meta }) });
        return json({ id: p.id, url: p._links.checkout.href });
      }

      if (url.pathname === '/webhook' && req.method === 'POST') {   // Mollie calls this after every status change
        const id = (await req.formData()).get('id');
        if (id && /^tr_\w+$/.test(id)) await credit(env, await mollie(env, 'payments/' + id));
        return new Response('ok');
      }

      if (url.pathname === '/status') {   // the game asks this after returning from Mollie
        const id = url.searchParams.get('id') || '';
        if (!/^tr_\w+$/.test(id)) return json({ error: 'bad id' }, 400);
        return json(await credit(env, await mollie(env, 'payments/' + id)));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
  }
};
