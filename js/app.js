import {
  UNITS,
  baseOf,
  compatibleUnits,
  num,
  ingredientDisplayCost,
  recipeCost,
  recipesUsing,
  pricing,
  ratioStatus,
} from './calc.js';
import * as store from './store.js';
import { db } from './store.js';
import { scanBarcode, lookupProduct } from './scanner.js';

let $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $action = document.getElementById('action');

// ---------- Utilitaires d'affichage ----------

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dec = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const money = (n) => (Number.isFinite(n) ? eur.format(n) : '—');
const pct = (n) => (Number.isFinite(n) ? `${dec.format(Math.round(n * 10) / 10)} %` : '—');
const fmt = (n) => (Number.isFinite(n) ? dec.format(n) : '');
const unitLabel = (u) => UNITS[u]?.label ?? u;
const qtyLabel = (q, u) => `${fmt(num(q))} ${u === 'pc' && num(q) > 1 ? 'pièces' : unitLabel(u)}`;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });

function unitOptions(units, selected) {
  return units.map((u) => `<option value="${u}" ${u === selected ? 'selected' : ''}>${unitLabel(u)}</option>`).join('');
}

function toast(text, action) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => {
      el.remove();
      action.run();
    };
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 2500);
}

function sheet(html) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog"><div class="sheet-handle"></div>${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-sheet-close]')) close();
  });
  return { el: wrap.querySelector('.sheet'), close };
}

function settingsFor(recipe) {
  const s = db.settings;
  const drink = recipe.kind === 'drink';
  const target = Number.isFinite(num(recipe.target)) ? num(recipe.target) : drink ? s.targetDrink : s.targetFood;
  const vat = Number.isFinite(num(recipe.vat)) ? num(recipe.vat) : drink ? s.vatDrink : s.vatFood;
  return { target, vat };
}

function analyse(recipe) {
  const cost = recipeCost(recipe, db);
  const { target, vat } = settingsFor(recipe);
  const price = pricing({
    cost: cost.errors ? NaN : cost.perPortion,
    target,
    vat,
    sellTTC: recipe.sellTTC,
    overhead: db.settings.overhead,
    roundStep: db.settings.roundStep,
  });
  return { cost, price, target, vat, status: ratioStatus(price.ratio, target) };
}

// ---------- Routeur ----------

const routes = [
  [/^#?\/?$/, () => go('#/fiches', true)],
  [/^#\/fiches$/, viewRecipes],
  [/^#\/fiche\/([\w-]+)$/, viewRecipe],
  [/^#\/produits$/, viewProducts],
  [/^#\/produit\/([\w-]+)$/, viewProduct],
  [/^#\/calcul$/, viewCalculator],
  [/^#\/reglages$/, viewSettings],
];

function go(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  render();
}

function parseHash() {
  const [path, query = ''] = location.hash.split('?');
  return { path, params: new URLSearchParams(query) };
}

function render() {
  const { path, params } = parseHash();
  $action.hidden = true;
  $action.onclick = null;
  $back.hidden = true;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', path.startsWith(a.dataset.match));
  });
  // Nouveau conteneur à chaque écran : les écouteurs de l'écran précédent disparaissent.
  const fresh = $app.cloneNode(false);
  $app.replaceWith(fresh);
  $app = fresh;
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      window.scrollTo(0, 0);
      view(m[1], params);
      return;
    }
  }
  go('#/fiches', true);
}

function setHeader(title, { back = false, action = null } = {}) {
  $title.textContent = title;
  $back.hidden = !back;
  if (action) {
    $action.hidden = false;
    $action.textContent = action.label;
    $action.setAttribute('aria-label', action.aria || action.label);
    $action.onclick = action.run;
  }
}

$back.onclick = () => {
  if (history.length > 1) history.back();
  else go('#/fiches', true);
};
window.addEventListener('popstate', render);
window.addEventListener('hashchange', render);

// ---------- Fiches techniques ----------

let recipeFilter = 'all';
let recipeSearch = '';

function viewRecipes() {
  setHeader('Mes fiches', {
    action: { label: '+', aria: 'Nouvelle fiche', run: () => newRecipe() },
  });

  if (!db.recipes.length) {
    $app.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📋</div>
        <h2>Aucune fiche technique</h2>
        <p>Créez une fiche pour chaque plat ou cocktail : l’appli calcule le coût par portion et le prix de vente conseillé.</p>
        <button class="btn primary block" data-new="food">Nouvelle fiche cuisine</button>
        <button class="btn block" data-new="drink">Nouvelle fiche bar</button>
        <button class="btn ghost block" data-demo>Voir un exemple</button>
      </div>`;
    $app.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => newRecipe(b.dataset.new)));
    $app.querySelector('[data-demo]').onclick = () => {
      store.loadDemo();
      render();
    };
    return;
  }

  const analysed = db.recipes.map((r) => ({ r, a: analyse(r) }));
  const sold = analysed.filter(({ a }) => Number.isFinite(a.price.ratio));
  const avg = sold.length ? sold.reduce((s, { a }) => s + a.price.ratio, 0) / sold.length : NaN;
  const toReview = analysed.filter(({ a }) => a.status === 'bad' || a.cost.errors).length;

  $app.innerHTML = `
    <section class="stats">
      <div><b>${db.recipes.length}</b><span>fiches</span></div>
      <div><b>${pct(avg)}</b><span>ratio matière moyen</span></div>
      <div class="${toReview ? 'bad-text' : ''}"><b>${toReview}</b><span>à revoir</span></div>
    </section>
    <div class="search"><input type="search" placeholder="Rechercher une fiche" value="${esc(recipeSearch)}" /></div>
    <div class="chips">
      ${[
        ['all', 'Tout'],
        ['food', 'Cuisine'],
        ['drink', 'Bar'],
        ['review', 'À revoir'],
      ]
        .map(([k, l]) => `<button class="chip ${recipeFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`)
        .join('')}
    </div>
    <ul class="list" id="recipe-list"></ul>`;

  const list = $app.querySelector('#recipe-list');
  const draw = () => {
    const q = norm(recipeSearch);
    const rows = analysed
      .filter(({ r, a }) => {
        if (recipeFilter === 'food' && r.kind === 'drink') return false;
        if (recipeFilter === 'drink' && r.kind !== 'drink') return false;
        if (recipeFilter === 'review' && !(a.status === 'bad' || a.status === 'warn' || a.cost.errors)) return false;
        return !q || norm(r.name).includes(q);
      })
      .sort((x, y) => byName(x.r, y.r));
    list.innerHTML = rows.length
      ? rows
          .map(
            ({ r, a }) => `
        <li><a class="row" href="#/fiche/${r.id}">
          <div class="row-main">
            <div class="row-title">${r.kind === 'drink' ? '🍸' : '🍽️'} ${esc(r.name || 'Sans nom')}</div>
            <div class="row-sub">
              Coût ${money(a.price.cost)} / portion
              ${Number.isFinite(a.price.sellTTC) ? ` · vendu ${money(a.price.sellTTC)}` : ` · conseillé ${money(a.price.roundedTTC)}`}
              ${a.cost.errors ? ' · <span class="bad-text">incomplète</span>' : ''}
            </div>
          </div>
          <span class="badge ${a.status}">${Number.isFinite(a.price.ratio) ? pct(a.price.ratio) : 'prix ?'}</span>
        </a></li>`,
          )
          .join('')
      : '<li class="muted center pad">Aucune fiche ne correspond.</li>';
  };
  draw();
  $app.querySelector('.search input').oninput = (e) => {
    recipeSearch = e.target.value;
    draw();
  };
  $app.querySelectorAll('[data-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        recipeFilter = b.dataset.filter;
        $app.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('on', c === b));
        draw();
      }),
  );
}

function newRecipe(kind) {
  if (!kind) {
    const s = sheet(`
      <h3>Nouvelle fiche</h3>
      <button class="btn primary block" data-k="food">🍽️ Plat / préparation cuisine</button>
      <button class="btn block" data-k="drink">🍸 Cocktail / boisson</button>`);
    s.el.querySelectorAll('[data-k]').forEach(
      (b) =>
        (b.onclick = () => {
          s.close();
          newRecipe(b.dataset.k);
        }),
    );
    return;
  }
  const r = store.createRecipe(kind);
  go(`#/fiche/${r.id}`);
}

function viewRecipe(id) {
  const recipe = store.getRecipe(id);
  if (!recipe) return go('#/fiches', true);

  setHeader(recipe.name || 'Nouvelle fiche', {
    back: true,
    action: { label: '⋯', aria: 'Options', run: () => recipeMenu(recipe) },
  });

  const { target, vat } = settingsFor(recipe);
  const drink = recipe.kind === 'drink';
  const parents = store.usedIn('rec', recipe.id);

  $app.innerHTML = `
    <div class="card">
      <input class="title-input" name="name" placeholder="${drink ? 'Nom du cocktail' : 'Nom du plat'}" value="${esc(recipe.name)}" autocomplete="off" />
      <div class="seg">
        <button data-kind="food" class="${!drink ? 'on' : ''}">🍽️ Cuisine</button>
        <button data-kind="drink" class="${drink ? 'on' : ''}">🍸 Bar</button>
      </div>
      <div class="field-row">
        <label>Nombre de portions</label>
        <div class="stepper">
          <button data-step="-1" aria-label="Moins">−</button>
          <input name="portions" inputmode="decimal" value="${esc(fmt(num(recipe.portions)))}" />
          <button data-step="1" aria-label="Plus">+</button>
        </div>
      </div>
      ${parents.length ? `<p class="hint">Utilisée comme préparation dans : ${parents.map((p) => esc(p.name || 'Sans nom')).join(', ')}</p>` : ''}
    </div>

    <h3 class="section-title">Ingrédients <span class="muted" id="total-cost"></span></h3>
    <div class="card flush"><ul class="items" id="items"></ul>
      <div class="items-actions">
        <button class="btn primary" data-add>+ Ajouter</button>
        <button class="btn" data-scan>📷 Scanner</button>
      </div>
    </div>

    <h3 class="section-title">Prix de vente</h3>
    <div class="card">
      <div class="field-row">
        <label>Mon prix de vente TTC</label>
        <div class="input-unit"><input name="sellTTC" inputmode="decimal" placeholder="0,00" value="${esc(fmt(num(recipe.sellTTC)))}" /><span>€</span></div>
      </div>
      <div class="field-row">
        <label>Ratio matière visé</label>
        <div class="input-unit"><input name="target" inputmode="decimal" placeholder="${fmt(target)}" value="${esc(fmt(num(recipe.target)))}" /><span>%</span></div>
      </div>
      <div class="field-row">
        <label>TVA</label>
        <select name="vat">
          ${['', 5.5, 10, 20]
            .map((v) => `<option value="${v}" ${String(recipe.vat ?? '') === String(v) ? 'selected' : ''}>${v === '' ? `Par défaut (${fmt(vat)} %)` : `${fmt(v)} %`}</option>`)
            .join('')}
        </select>
      </div>
    </div>
    <div class="card" id="results"></div>

    <h3 class="section-title">Notes</h3>
    <div class="card"><textarea name="notes" rows="3" placeholder="Dressage, grammages, allergènes…">${esc(recipe.notes)}</textarea></div>
  `;

  const persist = () => {
    recipe.updatedAt = Date.now();
    store.save();
  };

  const drawItems = () => {
    const res = recipeCost(recipe, db);
    const ul = $app.querySelector('#items');
    if (!recipe.items.length) {
      ul.innerHTML = '<li class="muted center pad">Ajoutez les produits qui composent la recette, avec leur quantité.</li>';
    } else {
      ul.innerHTML = recipe.items
        .map((it, i) => {
          const line = res.lines[i];
          let name;
          let units;
          if (it.type === 'rec') {
            const sub = store.getRecipe(it.ref);
            name = sub ? `📋 ${esc(sub.name || 'Sans nom')}` : '<span class="bad-text">Préparation supprimée</span>';
            units = '<span class="unit-fixed">portion</span>';
          } else {
            const ing = store.getIngredient(it.ref);
            name = ing ? esc(ing.name) : '<span class="bad-text">Produit supprimé</span>';
            units = ing
              ? `<select data-unit="${i}">${unitOptions(compatibleUnits(ing.unit), it.unit)}</select>`
              : '';
          }
          return `
          <li class="item" data-i="${i}">
            <div class="item-name">${name}
              <span class="item-cost ${line.error ? 'bad-text' : ''}" data-cost="${i}">${line.error ? esc(line.error) : money(line.cost)}</span>
            </div>
            <div class="item-qty">
              <input data-qty="${i}" inputmode="decimal" placeholder="Qté" value="${esc(fmt(num(it.qty)))}" />
              ${units}
              <button class="icon-btn" data-del="${i}" aria-label="Retirer">🗑</button>
            </div>
          </li>`;
        })
        .join('');
    }
    drawResults();
  };

  const drawResults = () => {
    const a = analyse(recipe);
    a.cost.lines.forEach((line, i) => {
      const el = $app.querySelector(`[data-cost="${i}"]`);
      if (!el) return;
      el.textContent = line.error ? line.error : money(line.cost);
      el.classList.toggle('bad-text', !!line.error);
    });
    $app.querySelector('#total-cost').textContent = recipe.items.length ? `· total ${money(a.cost.total)}` : '';
    const p = a.price;
    const hasSell = Number.isFinite(p.sellTTC);
    const overhead = num(db.settings.overhead) > 0;
    $app.querySelector('#results').innerHTML = `
      ${a.cost.errors ? `<p class="alert">⚠️ ${a.cost.errors} ligne(s) incomplète(s) : le coût n’est pas fiable.</p>` : ''}
      <div class="kpis">
        <div class="kpi"><span>Coût matière / portion</span><b>${money(p.cost)}</b></div>
        <div class="kpi accent"><span>Prix conseillé TTC</span><b>${money(p.roundedTTC)}</b>
          <small>pour ${pct(a.target)} de matière · ${money(p.suggestedHT)} HT</small></div>
      </div>
      ${overhead ? `<div class="line"><span>Prix de revient (avec charges)</span><b>${money(p.fullCost)}</b></div>` : ''}
      ${
        hasSell
          ? `
        <div class="verdict ${a.status}">
          <div class="verdict-ratio"><span>Ratio matière</span><b>${pct(p.ratio)}</b></div>
          <p>${
            a.status === 'good'
              ? '✅ Rentable : vous êtes sous votre objectif.'
              : a.status === 'warn'
                ? '🟠 Un peu au-dessus de l’objectif.'
                : `🔴 Trop cher en matière. Visez ${money(p.roundedTTC)} ou réduisez le coût.`
          }</p>
        </div>
        <div class="line"><span>Prix de vente HT</span><b>${money(p.sellHT)}</b></div>
        <div class="line"><span>Marge brute / portion (HT)</span><b>${money(p.margin)}</b></div>
        ${overhead ? `<div class="line"><span>Marge nette / portion (HT)</span><b class="${p.netMargin < 0 ? 'bad-text' : ''}">${money(p.netMargin)}</b></div>` : ''}
        <div class="line"><span>Coefficient multiplicateur</span><b>${Number.isFinite(p.coef) ? `× ${dec.format(Math.round(p.coef * 100) / 100)}` : '—'}</b></div>`
          : '<p class="hint">Saisissez votre prix de vente ci-dessus pour voir votre marge et votre ratio matière.</p>'
      }`;
    setHeader(recipe.name || 'Nouvelle fiche', {
      back: true,
      action: { label: '⋯', aria: 'Options', run: () => recipeMenu(recipe) },
    });
  };

  drawItems();

  // Saisie : on met à jour le modèle et les résultats sans tout redessiner (garde le focus).
  $app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.qty != null) {
      recipe.items[+t.dataset.qty].qty = t.value;
    } else if (['name', 'portions', 'sellTTC', 'target', 'notes'].includes(t.name)) {
      recipe[t.name] = t.value;
    } else return;
    persist();
    drawResults();
  });
  $app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.unit != null) recipe.items[+t.dataset.unit].unit = t.value;
    else if (t.name === 'vat') recipe.vat = t.value;
    else return;
    persist();
    drawResults();
  });
  $app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.kind) {
      recipe.kind = t.dataset.kind;
      persist();
      render();
    } else if (t.dataset.step) {
      const cur = num(recipe.portions);
      recipe.portions = Math.max(1, (Number.isFinite(cur) ? Math.round(cur) : 1) + Number(t.dataset.step));
      $app.querySelector('[name="portions"]').value = recipe.portions;
      persist();
      drawResults();
    } else if (t.dataset.del != null) {
      const [removed] = recipe.items.splice(+t.dataset.del, 1);
      const at = +t.dataset.del;
      persist();
      drawItems();
      toast('Ligne retirée', {
        label: 'Annuler',
        run: () => {
          recipe.items.splice(at, 0, removed);
          persist();
          drawItems();
        },
      });
    } else if (t.hasAttribute('data-add')) {
      pickItem(recipe, addItem);
    } else if (t.hasAttribute('data-scan')) {
      scanIntoRecipe(recipe, addItem);
    }
  });

  function addItem(item) {
    recipe.items.push(item);
    persist();
    drawItems();
    const input = $app.querySelector(`[data-qty="${recipe.items.length - 1}"]`);
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  }
}

function defaultUnitFor(ing) {
  return { g: 'g', ml: 'cl', pc: 'pc' }[baseOf(ing.unit)] || ing.unit;
}

function itemFromIngredient(ing) {
  return { type: 'ing', ref: ing.id, qty: '', unit: defaultUnitFor(ing) };
}

function pickItem(recipe, onPick) {
  const blocked = recipesUsing(recipe.id, db.recipes);
  blocked.add(recipe.id);
  const preps = db.recipes.filter((r) => !blocked.has(r.id)).sort(byName);
  const ings = [...db.ingredients].sort(byName);
  const s = sheet(`
    <div class="sheet-head">
      <input type="search" placeholder="Rechercher un produit" autocomplete="off" />
      <button class="icon-btn" data-sheet-close aria-label="Fermer">✕</button>
    </div>
    <ul class="list compact" id="pick"></ul>
    <button class="btn block" data-create>+ Créer un nouveau produit</button>`);
  const ul = s.el.querySelector('#pick');
  const input = s.el.querySelector('input');
  const draw = () => {
    const q = norm(input.value);
    const fi = ings.filter((i) => !q || norm(i.name).includes(q) || norm(i.supplier).includes(q));
    const fp = preps.filter((r) => !q || norm(r.name).includes(q));
    ul.innerHTML =
      fi
        .map((i) => {
          const c = ingredientDisplayCost(i);
          return `<li><button class="row" data-ing="${i.id}"><div class="row-main"><div class="row-title">${esc(i.name)}</div>
            <div class="row-sub">${c ? `${money(c.value)} / ${unitLabel(c.unit)}` : 'prix incomplet'}</div></div></button></li>`;
        })
        .join('') +
      (fp.length ? `<li class="list-sep">Préparations maison</li>` : '') +
      fp
        .map(
          (r) => `<li><button class="row" data-rec="${r.id}"><div class="row-main"><div class="row-title">📋 ${esc(r.name || 'Sans nom')}</div>
          <div class="row-sub">${money(recipeCost(r, db).perPortion)} / portion</div></div></button></li>`,
        )
        .join('') ||
      `<li class="muted center pad">${db.ingredients.length ? 'Aucun résultat.' : 'Aucun produit pour l’instant.'}</li>`;
  };
  draw();
  input.oninput = draw;
  ul.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    s.close();
    if (b.dataset.ing) onPick(itemFromIngredient(store.getIngredient(b.dataset.ing)));
    else onPick({ type: 'rec', ref: b.dataset.rec, qty: 1 });
  };
  s.el.querySelector('[data-create]').onclick = () => {
    s.close();
    const name = input.value.trim();
    go(`#/produit/new?addTo=${recipe.id}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
  };
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

async function scanIntoRecipe(recipe, onPick) {
  const code = await scanBarcode({ title: 'Scanner un produit' });
  if (!code) return;
  const ing = store.findByBarcode(code);
  if (ing) {
    onPick(itemFromIngredient(ing));
    toast(`${ing.name} ajouté`);
  } else {
    go(`#/produit/new?barcode=${encodeURIComponent(code)}&addTo=${recipe.id}`);
  }
}

function recipeMenu(recipe) {
  const s = sheet(`
    <h3>${esc(recipe.name || 'Fiche')}</h3>
    <button class="btn block" data-a="dup">Dupliquer la fiche</button>
    <button class="btn block" data-a="share">Partager / copier</button>
    <button class="btn danger block" data-a="del">Supprimer la fiche</button>
    <button class="btn ghost block" data-sheet-close>Annuler</button>`);
  s.el.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    s.close();
    if (a === 'dup') {
      const copy = store.duplicateRecipe(recipe.id);
      go(`#/fiche/${copy.id}`);
    } else if (a === 'share') {
      shareRecipe(recipe);
    } else if (a === 'del') {
      const parents = store.usedIn('rec', recipe.id);
      const extra = parents.length ? `\nElle sera aussi retirée de : ${parents.map((p) => p.name).join(', ')}.` : '';
      if (confirm(`Supprimer « ${recipe.name || 'Sans nom'} » ?${extra}`)) {
        store.deleteRecipe(recipe.id);
        go('#/fiches', true);
      }
    }
  };
}

async function shareRecipe(recipe) {
  const a = analyse(recipe);
  const lines = recipe.items.map((it, i) => {
    const line = a.cost.lines[i];
    const name =
      it.type === 'rec' ? store.getRecipe(it.ref)?.name : store.getIngredient(it.ref)?.name;
    const unit = it.type === 'rec' ? 'portion' : unitLabel(it.unit);
    return `- ${name ?? '?'} : ${fmt(num(it.qty))} ${unit} (${money(line.cost)})`;
  });
  const text = [
    `${recipe.name || 'Fiche'} — ${fmt(num(recipe.portions))} portion(s)`,
    ...lines,
    `Coût matière / portion : ${money(a.price.cost)}`,
    `Prix conseillé TTC : ${money(a.price.roundedTTC)} (ratio ${pct(a.target)})`,
    Number.isFinite(a.price.sellTTC) ? `Prix de vente TTC : ${money(a.price.sellTTC)} · ratio ${pct(a.price.ratio)}` : '',
    recipe.notes ? `Notes : ${recipe.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.name, text });
      return;
    } catch {
      // annulé : on copie
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Fiche copiée');
  } catch {
    toast('Partage impossible sur cet appareil');
  }
}

// ---------- Produits (matières premières) ----------

let productSearch = '';

function viewProducts() {
  setHeader('Mes produits', {
    action: { label: '+', aria: 'Nouveau produit', run: () => go('#/produit/new') },
  });
  if (!db.ingredients.length) {
    $app.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🥕</div>
        <h2>Aucun produit</h2>
        <p>Enregistrez vos matières premières avec leur prix d’achat. Scannez le code-barres pour aller plus vite.</p>
        <button class="btn primary block" data-scan>📷 Scanner un produit</button>
        <button class="btn block" data-new>Saisir à la main</button>
      </div>`;
    $app.querySelector('[data-scan]').onclick = scanFromTab;
    $app.querySelector('[data-new]').onclick = () => go('#/produit/new');
    return;
  }
  $app.innerHTML = `
    <div class="search with-btn">
      <input type="search" placeholder="Rechercher un produit" value="${esc(productSearch)}" />
      <button class="btn" data-scan aria-label="Scanner">📷</button>
    </div>
    <ul class="list" id="product-list"></ul>`;
  const ul = $app.querySelector('#product-list');
  const draw = () => {
    const q = norm(productSearch);
    const rows = db.ingredients
      .filter((i) => !q || norm(i.name).includes(q) || norm(i.supplier).includes(q) || (i.barcode || '').includes(q))
      .sort(byName);
    ul.innerHTML =
      rows
        .map((i) => {
          const c = ingredientDisplayCost(i);
          const trend = priceTrend(i);
          const used = store.usedIn('ing', i.id).length;
          return `<li><a class="row" href="#/produit/${i.id}">
          <div class="row-main">
            <div class="row-title">${esc(i.name)} ${i.barcode ? '<span class="tag">▮▯▮</span>' : ''}</div>
            <div class="row-sub">${money(num(i.price))} HT les ${qtyLabel(i.qty, i.unit)}${i.supplier ? ` · ${esc(i.supplier)}` : ''}${used ? ` · ${used} fiche${used > 1 ? 's' : ''}` : ''}</div>
          </div>
          <div class="row-end">
            <b>${c ? money(c.value) : '—'}</b><small>/ ${c ? unitLabel(c.unit) : ''}</small>
            ${trend ? `<small class="${trend.up ? 'bad-text' : 'good-text'}">${trend.up ? '▲' : '▼'} ${pct(Math.abs(trend.change))}</small>` : ''}
          </div>
        </a></li>`;
        })
        .join('') || '<li class="muted center pad">Aucun produit ne correspond.</li>';
  };
  draw();
  $app.querySelector('.search input').oninput = (e) => {
    productSearch = e.target.value;
    draw();
  };
  $app.querySelector('[data-scan]').onclick = scanFromTab;
}

function priceTrend(ing) {
  const prev = ing.history?.at(-1);
  if (!prev) return null;
  const now = ingredientDisplayCost(ing);
  const before = ingredientDisplayCost({ ...ing, ...prev });
  if (!now || !before || !before.value || now.unit !== before.unit) return null;
  const change = ((now.value - before.value) / before.value) * 100;
  if (Math.abs(change) < 0.05) return null;
  return { change, up: change > 0 };
}

async function scanFromTab() {
  const code = await scanBarcode();
  if (!code) return;
  const ing = store.findByBarcode(code);
  if (ing) {
    go(`#/produit/${ing.id}`);
    toast('Produit trouvé : mettez à jour le prix si besoin');
  } else {
    go(`#/produit/new?barcode=${encodeURIComponent(code)}`);
  }
}

function viewProduct(id, params) {
  const isNew = id === 'new';
  const existing = isNew ? null : store.getIngredient(id);
  if (!isNew && !existing) return go('#/produits', true);
  const ing = existing
    ? { ...existing }
    : {
        name: params.get('name') || '',
        supplier: '',
        price: '',
        qty: '',
        unit: 'kg',
        yield: 100,
        barcode: params.get('barcode') || '',
      };
  const addTo = params.get('addTo');
  const used = existing ? store.usedIn('ing', existing.id) : [];

  setHeader(isNew ? 'Nouveau produit' : 'Produit', { back: true });

  $app.innerHTML = `
    <form class="card form" novalidate>
      <label class="field">Nom du produit
        <input name="name" required autocomplete="off" placeholder="ex : Beurre doux" value="${esc(ing.name)}" />
      </label>
      <p class="hint" id="off-status" hidden></p>
      <div class="field-grid">
        <label class="field">Prix d’achat HT
          <div class="input-unit"><input name="price" inputmode="decimal" placeholder="0,00" value="${esc(fmt(num(ing.price)))}" /><span>€</span></div>
        </label>
        <label class="field">pour
          <div class="qty-unit">
            <input name="qty" inputmode="decimal" placeholder="1" value="${esc(fmt(num(ing.qty)))}" />
            <select name="unit">${unitOptions(Object.keys(UNITS), ing.unit)}</select>
          </div>
        </label>
      </div>
      <label class="field">Rendement (partie utilisable)
        <div class="input-unit"><input name="yield" inputmode="decimal" value="${esc(fmt(num(ing.yield)))}" /><span>%</span></div>
        <small>100 % si rien n’est perdu. Ex : 80 % pour des carottes épluchées, 45 % pour le jus d’un citron.</small>
      </label>
      <div class="result-box" id="unit-cost"></div>
      <label class="field">Fournisseur <span class="muted">(facultatif)</span>
        <input name="supplier" autocomplete="off" value="${esc(ing.supplier)}" />
      </label>
      <label class="field">Code-barres <span class="muted">(facultatif)</span>
        <div class="with-btn">
          <input name="barcode" inputmode="numeric" autocomplete="off" value="${esc(ing.barcode)}" />
          <button type="button" class="btn" data-scan aria-label="Scanner">📷</button>
        </div>
      </label>
      <button class="btn primary block big" type="submit">${addTo ? 'Enregistrer et ajouter à la fiche' : 'Enregistrer'}</button>
    </form>
    ${
      existing
        ? `
      ${used.length ? `<h3 class="section-title">Utilisé dans</h3><ul class="list">${used.map((r) => `<li><a class="row" href="#/fiche/${r.id}"><div class="row-main"><div class="row-title">${esc(r.name || 'Sans nom')}</div></div><span class="chev">›</span></a></li>`).join('')}</ul>` : ''}
      ${existing.history?.length ? `<h3 class="section-title">Anciens prix</h3><ul class="list">${[...existing.history].reverse().map((h) => `<li class="row static"><div class="row-main"><div class="row-title">${money(num(h.price))} les ${qtyLabel(h.qty, h.unit)}</div></div><small class="muted">${h.date ? new Date(h.date).toLocaleDateString('fr-FR') : ''}</small></li>`).join('')}</ul>` : ''}
      <button class="btn danger block" data-delete>Supprimer ce produit</button>`
        : ''
    }`;

  const form = $app.querySelector('form');
  const readForm = () => ({
    name: form.name.value.trim(),
    supplier: form.supplier.value.trim(),
    price: num(form.price.value),
    qty: num(form.qty.value),
    unit: form.unit.value,
    yield: num(form.yield.value),
    barcode: form.barcode.value.trim(),
  });
  const drawCost = () => {
    const c = ingredientDisplayCost(readForm());
    $app.querySelector('#unit-cost').innerHTML = c
      ? `Coût réel : <b>${money(c.value)} / ${unitLabel(c.unit)}</b> HT`
      : 'Indiquez le prix et la quantité pour voir le coût au kilo, au litre ou à la pièce.';
  };
  drawCost();
  form.addEventListener('input', drawCost);
  form.addEventListener('change', drawCost);

  const status = $app.querySelector('#off-status');
  const lookup = async (code) => {
    status.hidden = false;
    status.textContent = 'Recherche du produit dans Open Food Facts…';
    const info = await lookupProduct(code);
    if (!info?.name) {
      status.textContent = 'Produit non trouvé dans la base : complétez le nom à la main.';
      return;
    }
    if (!form.name.value.trim()) form.name.value = info.name;
    if (info.qty && !form.qty.value.trim()) {
      form.qty.value = fmt(info.qty);
      form.unit.value = info.unit;
    }
    status.textContent = `Trouvé : ${info.name}. Vérifiez et ajoutez votre prix d’achat.`;
    drawCost();
    form.price.focus();
  };
  if (isNew && ing.barcode) lookup(ing.barcode);

  $app.querySelector('[data-scan]').onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    const other = store.findByBarcode(code);
    if (other && other.id !== existing?.id) {
      toast(`Ce code est déjà utilisé par « ${other.name} »`);
      return;
    }
    form.barcode.value = code;
    if (!form.name.value.trim() || !form.qty.value.trim()) lookup(code);
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const data = readForm();
    const errors = [];
    if (!data.name) errors.push('le nom');
    if (!Number.isFinite(data.price) || data.price < 0) errors.push('le prix');
    if (!(data.qty > 0)) errors.push('la quantité');
    if (!(data.yield > 0 && data.yield <= 100)) errors.push('le rendement (entre 1 et 100 %)');
    if (errors.length) {
      toast(`Vérifiez ${errors.join(', ')}`);
      return;
    }
    const other = data.barcode && store.findByBarcode(data.barcode);
    if (other && other.id !== existing?.id) {
      toast(`Ce code-barres est déjà utilisé par « ${other.name} »`);
      return;
    }
    // Si l'unité change de famille (kg -> pièce), les fiches qui l'utilisent deviennent incohérentes.
    if (existing && baseOf(existing.unit) !== baseOf(data.unit) && used.length) {
      if (!confirm('Changer le type d’unité rendra les quantités des fiches incohérentes. Continuer ?')) return;
    }
    const newId = store.upsertIngredient({ ...(existing ? { id: existing.id } : {}), ...data });
    const target = addTo && store.getRecipe(addTo);
    if (target) {
      target.items.push(itemFromIngredient(store.getIngredient(newId)));
      store.save();
      history.replaceState(null, '', `#/fiche/${target.id}`);
      render();
      setTimeout(() => $app.querySelector(`[data-qty="${target.items.length - 1}"]`)?.focus(), 50);
      return;
    }
    toast('Produit enregistré');
    if (history.length > 1) history.back();
    else go('#/produits', true);
  };

  $app.querySelector('[data-delete]')?.addEventListener('click', () => {
    const extra = used.length ? `\nIl sera retiré de ${used.length} fiche(s) : ${used.map((r) => r.name).join(', ')}.` : '';
    if (confirm(`Supprimer « ${existing.name} » ?${extra}`)) {
      store.deleteIngredient(existing.id);
      go('#/produits', true);
    }
  });

  if (isNew && !ing.barcode && !ing.name && !matchMedia('(pointer: coarse)').matches) form.name.focus();
}

// ---------- Calculatrice rapide ----------

const calcState = { cost: '', target: '', vat: '', sell: '' };

function viewCalculator() {
  setHeader('Calcul rapide');
  const s = db.settings;
  $app.innerHTML = `
    <p class="hint pad-x">Pour un calcul express, sans créer de fiche.</p>
    <div class="card form">
      <label class="field">Coût matière d’une portion (HT)
        <div class="input-unit"><input name="cost" inputmode="decimal" placeholder="0,00" value="${esc(calcState.cost)}" /><span>€</span></div>
      </label>
      <div class="field-grid">
        <label class="field">Ratio visé
          <div class="input-unit"><input name="target" inputmode="decimal" placeholder="${fmt(s.targetFood)}" value="${esc(calcState.target)}" /><span>%</span></div>
        </label>
        <label class="field">TVA
          <select name="vat">${[5.5, 10, 20].map((v) => `<option value="${v}" ${String(calcState.vat || s.vatFood) === String(v) ? 'selected' : ''}>${fmt(v)} %</option>`).join('')}</select>
        </label>
      </div>
      <div id="calc-suggest"></div>
      <label class="field">Prix de vente TTC pratiqué <span class="muted">(facultatif)</span>
        <div class="input-unit"><input name="sell" inputmode="decimal" placeholder="0,00" value="${esc(calcState.sell)}" /><span>€</span></div>
      </label>
      <div id="calc-result"></div>
    </div>
    <div class="card">
      <h3>Repères</h3>
      <p class="hint">Ratio matière (food cost) = coût matière ÷ prix de vente HT.<br/>
      Cuisine : 25 à 35 % · Bar / cocktails : 18 à 25 % · Vins : 30 à 40 %.<br/>
      Coefficient = prix TTC ÷ coût matière. Un coefficient de 3,5 à 4 correspond à environ 30 % de ratio avec 10 % de TVA.</p>
    </div>`;
  const draw = () => {
    const target = Number.isFinite(num(calcState.target)) ? num(calcState.target) : s.targetFood;
    const p = pricing({
      cost: calcState.cost,
      target,
      vat: calcState.vat || s.vatFood,
      sellTTC: calcState.sell,
      roundStep: s.roundStep,
    });
    $app.querySelector('#calc-suggest').innerHTML = Number.isFinite(p.suggestedTTC)
      ? `<div class="kpis"><div class="kpi accent"><span>Prix conseillé TTC</span><b>${money(p.roundedTTC)}</b><small>${money(p.suggestedTTC)} exact · ${money(p.suggestedHT)} HT</small></div></div>`
      : '';
    const status = ratioStatus(p.ratio, target);
    $app.querySelector('#calc-result').innerHTML = Number.isFinite(p.ratio)
      ? `<div class="verdict ${status}"><div class="verdict-ratio"><span>Ratio matière</span><b>${pct(p.ratio)}</b></div></div>
         <div class="line"><span>Marge brute HT</span><b>${money(p.margin)}</b></div>
         <div class="line"><span>Coefficient</span><b>× ${dec.format(Math.round(p.coef * 100) / 100)}</b></div>`
      : '';
  };
  draw();
  $app.addEventListener('input', (e) => {
    if (e.target.name in calcState) calcState[e.target.name] = e.target.value;
    draw();
  });
  $app.addEventListener('change', (e) => {
    if (e.target.name in calcState) calcState[e.target.name] = e.target.value;
    draw();
  });
}

// ---------- Réglages ----------

function viewSettings() {
  setHeader('Réglages');
  const s = db.settings;
  $app.innerHTML = `
    <h3 class="section-title">Objectifs de rentabilité</h3>
    <div class="card form">
      <div class="field-grid">
        <label class="field">Ratio visé cuisine
          <div class="input-unit"><input name="targetFood" inputmode="decimal" value="${fmt(s.targetFood)}" /><span>%</span></div>
        </label>
        <label class="field">Ratio visé bar
          <div class="input-unit"><input name="targetDrink" inputmode="decimal" value="${fmt(s.targetDrink)}" /><span>%</span></div>
        </label>
        <label class="field">TVA cuisine
          <select name="vatFood">${[5.5, 10, 20].map((v) => `<option value="${v}" ${s.vatFood === v ? 'selected' : ''}>${fmt(v)} %</option>`).join('')}</select>
        </label>
        <label class="field">TVA bar
          <select name="vatDrink">${[5.5, 10, 20].map((v) => `<option value="${v}" ${s.vatDrink === v ? 'selected' : ''}>${fmt(v)} %</option>`).join('')}</select>
        </label>
      </div>
      <label class="field">Arrondir le prix conseillé à
        <select name="roundStep">${[
          [0, 'pas d’arrondi'],
          [0.1, '0,10 €'],
          [0.5, '0,50 €'],
          [1, '1 €'],
        ]
          .map(([v, l]) => `<option value="${v}" ${s.roundStep === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select>
      </label>
      <label class="field">Charges par portion <span class="muted">(facultatif)</span>
        <div class="input-unit"><input name="overhead" inputmode="decimal" placeholder="0,00" value="${s.overhead ? fmt(s.overhead) : ''}" /><span>€</span></div>
        <small>Personnel, loyer, énergie… divisés par le nombre de couverts. Permet d’afficher le prix de revient complet et la marge nette.</small>
      </label>
    </div>

    <h3 class="section-title">Sauvegarde</h3>
    <div class="card">
      <p class="hint">Vos données sont enregistrées uniquement sur ce téléphone. Faites une sauvegarde régulièrement (et pour changer de téléphone).</p>
      <button class="btn primary block" data-export>⬇️ Exporter une sauvegarde</button>
      <label class="btn block file-btn">⬆️ Restaurer une sauvegarde<input type="file" accept="application/json,.json" hidden /></label>
    </div>

    <h3 class="section-title">Autres</h3>
    <div class="card">
      <button class="btn block" data-demo>Ajouter les fiches d’exemple</button>
      <button class="btn danger block" data-reset>Tout effacer</button>
      <p class="hint center">Renta · ${db.ingredients.length} produits · ${db.recipes.length} fiches</p>
    </div>`;

  const onChange = (e) => {
    const t = e.target;
    if (!(t.name in s)) return;
    const v = num(t.value);
    if (t.name === 'overhead') s.overhead = Number.isFinite(v) && v > 0 ? v : 0;
    else if (Number.isFinite(v) && (v > 0 || t.name === 'roundStep')) s[t.name] = v;
    store.save();
  };
  $app.addEventListener('input', onChange);
  $app.addEventListener('change', onChange);

  $app.querySelector('[data-export]').onclick = exportData;
  $app.querySelector('input[type="file"]').onchange = importData;
  $app.querySelector('[data-demo]').onclick = () => {
    store.loadDemo();
    toast('Exemples ajoutés');
    go('#/fiches');
  };
  $app.querySelector('[data-reset]').onclick = () => {
    if (confirm('Effacer tous les produits et toutes les fiches ? Pensez à exporter une sauvegarde avant.')) {
      store.replaceAll({ settings: db.settings });
      toast('Données effacées');
      render();
    }
  };
}

async function exportData() {
  const date = new Date().toISOString().slice(0, 10);
  const name = `renta-sauvegarde-${date}.json`;
  const blob = new Blob([JSON.stringify({ app: 'renta', version: 1, exportedAt: date, ...db }, null, 2)], {
    type: 'application/json',
  });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Renta' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.ingredients) || !Array.isArray(data.recipes)) throw new Error();
    if (!confirm(`Remplacer vos données par cette sauvegarde (${data.ingredients.length} produits, ${data.recipes.length} fiches) ?`)) return;
    store.replaceAll(data);
    toast('Sauvegarde restaurée');
    go('#/fiches');
  } catch {
    toast('Fichier de sauvegarde invalide');
  } finally {
    e.target.value = '';
  }
}

// ---------- Démarrage ----------

document.getElementById('tab-scan').onclick = (e) => {
  e.preventDefault();
  scanFromTab();
};

navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
render();
