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
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings || {}) },
  };
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

export function replaceAll(data) {
  const next = normalize(data);
  db.ingredients = next.ingredients;
  db.recipes = next.recipes;
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
  save();
}

export function loadDemo() {
  const ids = {};
  const ing = (key, name, price, qty, unit, extra = {}) => {
    ids[key] = uid();
    return { id: ids[key], name, price, qty, unit, yield: 100, supplier: '', barcode: '', updatedAt: Date.now(), ...extra };
  };
  const ingredients = [
    ing('boeuf', 'Bœuf haché 15 %', 11.9, 1, 'kg'),
    ing('pain', 'Pain burger brioché', 4.8, 12, 'pc'),
    ing('cheddar', 'Cheddar tranches', 9.5, 1, 'kg'),
    ing('salade', 'Salade iceberg', 1.2, 1, 'pc', { yield: 70 }),
    ing('tomate', 'Tomates', 2.9, 1, 'kg', { yield: 90 }),
    ing('pdt', 'Pommes de terre', 9, 10, 'kg', { yield: 80 }),
    ing('huile', 'Huile de friture', 32, 20, 'l'),
    ing('mayo', 'Mayonnaise', 7.5, 5, 'kg'),
    ing('rhum', 'Rhum blanc', 16.9, 70, 'cl', { yield: 97 }),
    ing('citron', 'Citron vert', 4.5, 1, 'kg', { yield: 45 }),
    ing('menthe', 'Menthe fraîche (botte)', 1.1, 1, 'pc', { yield: 60 }),
    ing('sucre', 'Sirop de sucre de canne', 6.9, 70, 'cl'),
    ing('eau', 'Eau gazeuse', 0.9, 1, 'l'),
  ];
  const sauceId = uid();
  const fritesId = uid();
  const recipes = [
    {
      id: sauceId,
      name: 'Sauce burger maison',
      kind: 'food',
      portions: 20,
      items: [
        { type: 'ing', ref: ids.mayo, qty: 500, unit: 'g' },
        { type: 'ing', ref: ids.tomate, qty: 150, unit: 'g' },
      ],
      sellTTC: '',
      target: '',
      vat: '',
      notes: 'Préparation de base, 30 g par burger.',
      updatedAt: Date.now(),
    },
    {
      id: fritesId,
      name: 'Frites fraîches',
      kind: 'food',
      portions: 10,
      items: [
        { type: 'ing', ref: ids.pdt, qty: 2, unit: 'kg' },
        { type: 'ing', ref: ids.huile, qty: 25, unit: 'cl' },
      ],
      sellTTC: 4.5,
      target: '',
      vat: '',
      notes: '',
      updatedAt: Date.now(),
    },
    {
      id: uid(),
      name: 'Cheeseburger frites',
      kind: 'food',
      portions: 1,
      items: [
        { type: 'ing', ref: ids.pain, qty: 1, unit: 'pc' },
        { type: 'ing', ref: ids.boeuf, qty: 150, unit: 'g' },
        { type: 'ing', ref: ids.cheddar, qty: 40, unit: 'g' },
        { type: 'ing', ref: ids.salade, qty: 0.1, unit: 'pc' },
        { type: 'ing', ref: ids.tomate, qty: 40, unit: 'g' },
        { type: 'rec', ref: sauceId, qty: 1 },
        { type: 'rec', ref: fritesId, qty: 1 },
      ],
      sellTTC: 15.9,
      target: '',
      vat: '',
      notes: '',
      updatedAt: Date.now(),
    },
    {
      id: uid(),
      name: 'Mojito',
      kind: 'drink',
      portions: 1,
      items: [
        { type: 'ing', ref: ids.rhum, qty: 5, unit: 'cl' },
        { type: 'ing', ref: ids.citron, qty: 60, unit: 'g' },
        { type: 'ing', ref: ids.menthe, qty: 0.2, unit: 'pc' },
        { type: 'ing', ref: ids.sucre, qty: 2, unit: 'cl' },
        { type: 'ing', ref: ids.eau, qty: 8, unit: 'cl' },
      ],
      sellTTC: 9,
      target: '',
      vat: '',
      notes: 'Verre highball, glace pilée.',
      updatedAt: Date.now(),
    },
  ];
  db.ingredients.push(...ingredients);
  db.recipes.push(...recipes);
  save();
}
