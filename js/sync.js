// Synchronisation avec la base partagée : tous les téléphones voient les mêmes produits,
// fiches, ventes et réglages. L'appli reste utilisable hors connexion : les modifications
// sont envoyées dès que le réseau revient.
//
// Principe : on garde, pour chaque élément, la dernière version connue du serveur (« ombre »).
// Envoyer = tout élément local différent de son ombre. Recevoir = les lignes modifiées
// depuis le dernier passage (curseur sur l'horodatage serveur).

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { db, saveLocal, setSaveHook } from './store.js';

const META_KEY = 'renta.sync';
const POLL_MS = 12000;
const OVERLAP_MS = 5000; // relit un peu en arrière pour ne rien rater
const PAGE = 1000;

export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const status = { state: enabled ? 'idle' : 'off', lastSync: null, pending: 0 };

let meta = loadMeta();
let running = false;
let again = false;
let timer = null;
const remoteListeners = new Set();
const statusListeners = new Set();

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if (m && typeof m.shadow === 'object') return m;
  } catch {
    // ignoré
  }
  return { cursor: null, shadow: {} };
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // stockage plein ou indisponible
  }
}

export const onRemoteChange = (fn) => remoteListeners.add(fn);
export const onStatus = (fn) => statusListeners.add(fn);

function setStatus(state) {
  status.state = state;
  status.pending = enabled ? pendingChanges().length : 0;
  statusListeners.forEach((fn) => fn(status));
}

const COLLECTIONS = [
  ['ingredient', () => db.ingredients],
  ['recipe', () => db.recipes],
  ['sales', () => db.sales],
];

function localItems() {
  const map = new Map();
  for (const [kind, list] of COLLECTIONS) {
    for (const obj of list()) if (obj?.id) map.set(`${kind}:${obj.id}`, { kind, id: obj.id, data: obj });
  }
  map.set('settings:main', { kind: 'settings', id: 'main', data: db.settings });
  return map;
}

function pendingChanges() {
  const local = localItems();
  const out = [];
  for (const [key, it] of local) {
    const json = JSON.stringify(it.data);
    if (meta.shadow[key] !== json) out.push({ key, json, row: { kind: it.kind, id: it.id, data: it.data, deleted: false } });
  }
  for (const key of Object.keys(meta.shadow)) {
    if (local.has(key)) continue;
    const i = key.indexOf(':');
    out.push({ key, json: null, row: { kind: key.slice(0, i), id: key.slice(i + 1), data: {}, deleted: true } });
  }
  return out;
}

async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 || options.method === 'POST' ? null : res.json();
}

async function push() {
  const changes = pendingChanges();
  for (let i = 0; i < changes.length; i += 200) {
    const chunk = changes.slice(i, i + 200);
    await api('items?on_conflict=kind,id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk.map((c) => c.row)),
    });
    for (const c of chunk) {
      if (c.json === null) delete meta.shadow[c.key];
      else meta.shadow[c.key] = c.json;
    }
    saveMeta();
  }
}

function replaceInPlace(target, data) {
  // On garde le même objet : les écrans ouverts gardent une référence valide.
  for (const k of Object.keys(target)) if (!(k in data)) delete target[k];
  Object.assign(target, data);
}

function applyRow(row) {
  const key = `${row.kind}:${row.id}`;
  const json = JSON.stringify(row.data);
  if (row.deleted) {
    const coll = COLLECTIONS.find(([k]) => k === row.kind);
    delete meta.shadow[key];
    if (!coll) return false;
    const list = coll[1]();
    const idx = list.findIndex((o) => o.id === row.id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }
  if (meta.shadow[key] === json) return false; // déjà à jour (souvent notre propre envoi)
  const local = localItems().get(key);
  if (local && meta.shadow[key] !== undefined && JSON.stringify(local.data) !== meta.shadow[key]) {
    // Modifié ici pendant la synchro : la version locale, plus récente, sera envoyée au prochain passage.
    meta.shadow[key] = json;
    return false;
  }
  meta.shadow[key] = json;
  if (row.kind === 'settings') {
    replaceInPlace(db.settings, { ...db.settings, ...row.data });
    return true;
  }
  const coll = COLLECTIONS.find(([k]) => k === row.kind);
  if (!coll || !row.data || typeof row.data !== 'object') return false;
  const list = coll[1]();
  const existing = list.find((o) => o.id === row.id);
  if (existing) replaceInPlace(existing, { ...row.data, id: row.id });
  else list.push({ ...row.data, id: row.id });
  return true;
}

async function pull() {
  let changed = false;
  let since = meta.cursor ? new Date(Date.parse(meta.cursor) - OVERLAP_MS).toISOString() : null;
  for (;;) {
    const filter = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
    const rows = await api(`items?select=kind,id,data,deleted,updated_at${filter}&order=updated_at.asc&limit=${PAGE}`);
    for (const row of rows) if (applyRow(row)) changed = true;
    if (rows.length) {
      const last = rows.at(-1).updated_at;
      if (!meta.cursor || last > meta.cursor) meta.cursor = last;
      since = last;
    }
    if (rows.length < PAGE) break;
  }
  saveMeta();
  return changed;
}

export async function syncNow() {
  if (!enabled) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus('syncing');
  try {
    // Premier passage sur ce téléphone : on récupère d'abord les données de l'équipe
    // (sinon les réglages par défaut écraseraient ceux du resto). Ensuite : envoyer puis recevoir.
    let changed = false;
    if (!meta.cursor) changed = await pull();
    await push();
    if (await pull()) changed = true;
    if (changed) {
      saveLocal();
      remoteListeners.forEach((fn) => fn());
    }
    status.lastSync = Date.now();
    setStatus('ok');
  } catch {
    setStatus(navigator.onLine === false ? 'offline' : 'error');
  } finally {
    running = false;
    if (again) {
      again = false;
      syncNow();
    }
  }
}

// Envoi rapide après une modification (regroupe les frappes au clavier).
function syncSoon() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1200);
  if (status.state === 'ok' || status.state === 'idle') setStatus(status.state);
}

export function startSync() {
  if (!enabled) return;
  setSaveHook(syncSoon);
  syncNow();
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', () => setStatus('offline'));
}
