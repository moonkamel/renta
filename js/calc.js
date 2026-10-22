// Moteur de calcul : conversions d'unités, coût des produits et des fiches, prix de vente.
// Aucune dépendance au DOM pour pouvoir être testé avec Node.

export const UNITS = {
  g: { base: 'g', factor: 1, label: 'g' },
  kg: { base: 'g', factor: 1000, label: 'kg' },
  ml: { base: 'ml', factor: 1, label: 'ml' },
  cl: { base: 'ml', factor: 10, label: 'cl' },
  l: { base: 'ml', factor: 1000, label: 'L' },
  pc: { base: 'pc', factor: 1, label: 'pièce' },
};

// Unité "de référence" pour afficher un prix lisible (€/kg, €/L, €/pièce).
const DISPLAY_UNIT = { g: 'kg', ml: 'l', pc: 'pc' };

export function baseOf(unit) {
  return UNITS[unit]?.base ?? null;
}

export function compatibleUnits(unit) {
  const base = baseOf(unit);
  return Object.keys(UNITS).filter((u) => UNITS[u].base === base);
}

export function toBase(qty, unit) {
  const u = UNITS[unit];
  return u ? qty * u.factor : NaN;
}

export function num(value) {
  if (typeof value === 'number') return value;
  if (value == null) return NaN;
  const s = String(value).replace(/\s/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

const isPos = (n) => Number.isFinite(n) && n > 0;

// Coût HT d'une unité de base (g, ml ou pièce) en tenant compte du rendement (pertes).
export function ingredientBaseCost(ing) {
  const price = num(ing.price);
  const qty = toBase(num(ing.qty), ing.unit);
  const yieldPct = Number.isFinite(num(ing.yield)) ? num(ing.yield) : 100;
  if (!Number.isFinite(price) || price < 0 || !isPos(qty) || !isPos(yieldPct)) return NaN;
  return price / qty / (yieldPct / 100);
}

// Prix "lisible" : { value, unit } par kg, par litre ou par pièce.
export function ingredientDisplayCost(ing) {
  const base = ingredientBaseCost(ing);
  const unit = DISPLAY_UNIT[baseOf(ing.unit)];
  if (!Number.isFinite(base) || !unit) return null;
  return { value: base * UNITS[unit].factor, unit };
}

// Ensemble des fiches qui utilisent (directement ou non) la fiche `id`.
export function recipesUsing(id, recipes) {
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recipes) {
      if (result.has(r.id)) continue;
      if (r.items?.some((it) => it.type === 'rec' && (it.ref === id || result.has(it.ref)))) {
        result.add(r.id);
        changed = true;
      }
    }
  }
  return result;
}

// Coût d'une ligne de fiche. Renvoie { cost, error }.
export function itemCost(item, db, stack = []) {
  const qty = num(item.qty);
  if (!Number.isFinite(qty) || qty < 0) return { cost: NaN, error: 'Quantité manquante' };
  if (item.type === 'rec') {
    const sub = db.recipes.find((r) => r.id === item.ref);
    if (!sub) return { cost: NaN, error: 'Préparation supprimée' };
    if (stack.includes(sub.id)) return { cost: NaN, error: 'Boucle entre préparations' };
    const res = recipeCost(sub, db, stack);
    if (res.errors || !Number.isFinite(res.perPortion)) return { cost: NaN, error: 'Préparation incomplète' };
    return { cost: res.perPortion * qty, error: null };
  }
  const ing = db.ingredients.find((i) => i.id === item.ref);
  if (!ing) return { cost: NaN, error: 'Produit supprimé' };
  if (baseOf(item.unit) !== baseOf(ing.unit)) return { cost: NaN, error: 'Unité incompatible' };
  const unitCost = ingredientBaseCost(ing);
  if (!Number.isFinite(unitCost)) return { cost: NaN, error: 'Prix du produit incomplet' };
  return { cost: unitCost * toBase(qty, item.unit), error: null };
}

// Coût total et par portion d'une fiche technique.
export function recipeCost(recipe, db, stack = []) {
  const inner = [...stack, recipe.id];
  let total = 0;
  let errors = 0;
  const lines = (recipe.items || []).map((item) => {
    const res = itemCost(item, db, inner);
    if (res.error) errors++;
    else total += res.cost;
    return res;
  });
  const portions = num(recipe.portions);
  const perPortion = isPos(portions) ? total / portions : NaN;
  return { total, perPortion, lines, errors };
}

export function roundUp(value, step) {
  if (!isPos(step) || !Number.isFinite(value)) return value;
  // Petite tolérance pour éviter 12.0000001 -> 12.50
  return Math.ceil(value / step - 1e-9) * step;
}

// Calcul des prix. cost = coût matière HT par portion.
// target = ratio matière visé (%), vat = TVA (%), sellTTC = prix pratiqué.
export function pricing({ cost, target, vat, sellTTC, overhead = 0, roundStep = 0 }) {
  const c = num(cost);
  const t = num(target);
  const v = Number.isFinite(num(vat)) ? num(vat) : 0;
  const vatMul = 1 + v / 100;
  const out = {
    cost: c,
    fullCost: c + (Number.isFinite(num(overhead)) ? num(overhead) : 0),
    suggestedHT: NaN,
    suggestedTTC: NaN,
    roundedTTC: NaN,
    sellHT: NaN,
    sellTTC: NaN,
    margin: NaN,
    netMargin: NaN,
    ratio: NaN,
    coef: NaN,
  };
  if (Number.isFinite(c) && isPos(t)) {
    out.suggestedHT = c / (t / 100);
    out.suggestedTTC = out.suggestedHT * vatMul;
    out.roundedTTC = roundStep ? roundUp(out.suggestedTTC, roundStep) : out.suggestedTTC;
  }
  const s = num(sellTTC);
  if (isPos(s)) {
    out.sellTTC = s;
    out.sellHT = s / vatMul;
    if (Number.isFinite(c)) {
      out.margin = out.sellHT - c;
      out.netMargin = out.sellHT - out.fullCost;
      out.ratio = (c / out.sellHT) * 100;
      out.coef = c > 0 ? s / c : NaN;
    }
  }
  return out;
}

// Statut d'un ratio matière par rapport à l'objectif.
export function ratioStatus(ratio, target) {
  if (!Number.isFinite(ratio) || !isPos(target)) return 'none';
  if (ratio <= target) return 'good';
  if (ratio <= target + 5) return 'warn';
  return 'bad';
}
