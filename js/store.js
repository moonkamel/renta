// Stockage local (sur le téléphone) des produits, fiches et réglages.

const KEY = 'renta.v1';

export const DEFAULT_SETTINGS = {
  targetFood: 30, // ratio matière visé en cuisine (%)
  targetDrink: 22, // ratio matière visé au bar (%)
  vatFood: 10, // TVA restauration sur place
  vatDrink: 20, // TVA boissons alcoolisées
  roundStep: 0.5, // arrondi du prix conseillé (€)
  overhead: 0, // charges (personnel, loyer…) par portion, facultatif
};

export const db = load();

function load() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY));
  } catch {
    data = null;
  }
  return normalize(data);
}

export function normalize(data) {
  return {
    ingredients: Array.isArray(data?.ingredients) ? data.ingredients : [],
    recipes: Array.isArray(data?.recipes) ? data.recipes : [],
    sales: Array.isArray(data?.sales) ? data.sales : [],
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings || {}) },
  };
}

let saveHook = null;
export const setSaveHook = (fn) => (saveHook = fn);

// Enregistre sur le téléphone sans prévenir la synchro (utilisé quand les données viennent du serveur).
export function saveLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

// Enregistre une modification faite dans l'appli : elle sera aussi envoyée à l'équipe.
export function save() {
  const ok = saveLocal();
  saveHook?.();
  return ok;
}

export function replaceAll(data) {
  const next = normalize(data);
  db.ingredients = next.ingredients;
  db.recipes = next.recipes;
  db.sales = next.sales;
  db.settings = next.settings;
  save();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const getIngredient = (id) => db.ingredients.find((i) => i.id === id);
export const getRecipe = (id) => db.recipes.find((r) => r.id === id);

export function findByBarcode(code) {
  return db.ingredients.find((i) => i.barcode && i.barcode === code);
}

// Fiches qui utilisent directement un produit ou une préparation.
export function usedIn(type, id) {
  return db.recipes.filter((r) => r.items.some((it) => it.type === type && it.ref === id));
}

export function upsertIngredient(ing) {
  const existing = getIngredient(ing.id);
  if (existing) {
    const oldPrice = Number(existing.price);
    const priceChanged =
      oldPrice !== Number(ing.price) || existing.qty !== ing.qty || existing.unit !== ing.unit;
    if (priceChanged) {
      // On garde une trace du prix précédent pour afficher la variation.
      ing.history = [
        ...(existing.history || []),
        { date: existing.updatedAt, price: existing.price, qty: existing.qty, unit: existing.unit },
      ].slice(-10);
    } else {
      ing.history = existing.history;
    }
    ing.updatedAt = priceChanged ? Date.now() : existing.updatedAt;
    Object.assign(existing, ing);
  } else {
    ing.id = ing.id || uid();
    ing.updatedAt = Date.now();
    db.ingredients.push(ing);
  }
  save();
  return ing.id;
}

export function deleteIngredient(id) {
  db.ingredients = db.ingredients.filter((i) => i.id !== id);
  for (const r of db.recipes) r.items = r.items.filter((it) => !(it.type === 'ing' && it.ref === id));
  save();
}

export function createRecipe(kind = 'food') {
  const recipe = {
    id: uid(),
    name: '',
    kind,
    portions: 1,
    items: [],
    sellTTC: '',
    target: '',
    vat: '',
    notes: '',
    updatedAt: Date.now(),
  };
  db.recipes.push(recipe);
  save();
  return recipe;
}

export function duplicateRecipe(id) {
  const src = getRecipe(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = `${src.name || 'Sans nom'} (copie)`;
  copy.updatedAt = Date.now();
  db.recipes.push(copy);
  save();
  return copy;
}

export function deleteRecipe(id) {
  db.recipes = db.recipes.filter((r) => r.id !== id);
  for (const r of db.recipes) r.items = r.items.filter((it) => !(it.type === 'rec' && it.ref === id));
  for (const p of db.sales) delete p.counts?.[id];
  save();
}

// ---------- Ventes ----------
// Une période = des quantités vendues par fiche ({ id, label, counts: { idFiche: qté } }).

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function createSalesPeriod(label) {
  const now = new Date();
  let name = label || `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const base = name;
  for (let i = 2; db.sales.some((p) => p.label === name); i++) name = `${base} (${i})`;
  const period = { id: uid(), label: name, counts: {}, createdAt: Date.now() };
  db.sales.push(period);
  save();
  return period;
}

export const getSalesPeriod = (id) => db.sales.find((p) => p.id === id);

export function deleteSalesPeriod(id) {
  db.sales = db.sales.filter((p) => p.id !== id);
  save();
}
