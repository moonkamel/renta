import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  num,
  ingredientBaseCost,
  ingredientDisplayCost,
  recipeCost,
  recipesUsing,
  pricing,
  roundUp,
  ratioStatus,
  menuEngineering,
} from '../js/calc.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('num accepte la virgule française', () => {
  assert.equal(num('12,5'), 12.5);
  assert.equal(num(' 1 200,40 '), 1200.4);
  assert.ok(Number.isNaN(num('')));
});

test('coût d’un produit avec rendement', () => {
  // Carottes : 10 € les 5 kg, 80 % utilisables -> 2,50 €/kg net
  const carottes = { price: 10, qty: 5, unit: 'kg', yield: 80 };
  close(ingredientBaseCost(carottes), 0.0025);
  assert.deepEqual(ingredientDisplayCost(carottes), { value: 2.5, unit: 'kg' });
  // Bouteille 70 cl à 21 € -> 30 €/L
  close(ingredientDisplayCost({ price: 21, qty: 70, unit: 'cl' }).value, 30);
});

test('coût d’une fiche avec sous-préparation', () => {
  const db = {
    ingredients: [
      { id: 'beurre', price: 8, qty: 1, unit: 'kg' },
      { id: 'oeuf', price: 3, qty: 12, unit: 'pc' },
      { id: 'citron', price: 2, qty: 1, unit: 'kg', yield: 50 },
    ],
    recipes: [
      {
        id: 'sauce',
        portions: 10,
        items: [
          { type: 'ing', ref: 'beurre', qty: 250, unit: 'g' }, // 2 €
          { type: 'ing', ref: 'oeuf', qty: 4, unit: 'pc' }, // 1 €
        ],
      },
      {
        id: 'plat',
        portions: 1,
        items: [
          { type: 'rec', ref: 'sauce', qty: 2 }, // 0,60 €
          { type: 'ing', ref: 'citron', qty: 50, unit: 'g' }, // 0,20 €
        ],
      },
    ],
  };
  const sauce = recipeCost(db.recipes[0], db);
  close(sauce.total, 3);
  close(sauce.perPortion, 0.3);
  const plat = recipeCost(db.recipes[1], db);
  close(plat.perPortion, 0.8);
  assert.equal(plat.errors, 0);
  assert.deepEqual([...recipesUsing('sauce', db.recipes)], ['plat']);
});

test('erreurs : unité incompatible et boucle', () => {
  const db = {
    ingredients: [{ id: 'lait', price: 1, qty: 1, unit: 'l' }],
    recipes: [
      { id: 'a', portions: 1, items: [{ type: 'ing', ref: 'lait', qty: 1, unit: 'kg' }] },
      { id: 'b', portions: 1, items: [{ type: 'rec', ref: 'c', qty: 1 }] },
      { id: 'c', portions: 1, items: [{ type: 'rec', ref: 'b', qty: 1 }] },
    ],
  };
  assert.equal(recipeCost(db.recipes[0], db).lines[0].error, 'Unité incompatible');
  assert.equal(recipeCost(db.recipes[1], db).errors, 1);
});

test('prix conseillé, ratio et coefficient', () => {
  const p = pricing({ cost: 3, target: 30, vat: 10, sellTTC: 13.2, roundStep: 0.5 });
  close(p.suggestedHT, 10);
  close(p.suggestedTTC, 11);
  close(p.roundedTTC, 11);
  close(p.sellHT, 12);
  close(p.margin, 9);
  close(p.ratio, 25);
  close(p.coef, 4.4);
  close(roundUp(11.01, 0.5), 11.5);
  assert.equal(ratioStatus(25, 30), 'good');
  assert.equal(ratioStatus(33, 30), 'warn');
  assert.equal(ratioStatus(40, 30), 'bad');
});

test('analyse des ventes : 4 familles et ratio pondéré', () => {
  const res = menuEngineering([
    { id: 'burger', qty: 300, margin: 9, cost: 4, sellHT: 13 }, // populaire, marge haute
    { id: 'frites', qty: 250, margin: 3, cost: 0.5, sellHT: 3.5 }, // populaire, marge basse
    { id: 'tartare', qty: 20, margin: 12, cost: 6, sellHT: 18 }, // peu vendu, marge haute
    { id: 'salade', qty: 10, margin: 4, cost: 3, sellHT: 7 }, // peu vendu, marge basse
    { id: 'jamais', qty: 0, margin: 10, cost: 1, sellHT: 11 },
  ]);
  const k = Object.fromEntries(res.rows.map((r) => [r.id, r.klass]));
  assert.deepEqual(k, { burger: 'star', frites: 'plowhorse', tartare: 'puzzle', salade: 'dog' });
  assert.equal(res.rows[0].id, 'burger');
  assert.equal(res.totalQty, 580);
  close(res.totalMargin, 300 * 9 + 250 * 3 + 20 * 12 + 10 * 4);
  close(res.ratio, ((300 * 4 + 250 * 0.5 + 20 * 6 + 10 * 3) / (300 * 13 + 250 * 3.5 + 20 * 18 + 10 * 7)) * 100);
});
