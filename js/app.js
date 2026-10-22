import {
  UNITS,
  baseOf,
  compatibleUnits,
  num,
  ingredientBaseCost,
  ingredientDisplayCost,
  recipeCost,
  recipesUsing,
  pricing,
  ratioStatus,
} from './calc.js';
import * as store from './store.js';
import { db } from './store.js';
import { scanBarcode, lookupProduct } from './scanner.js';
import { icons } from './icons.js';
import { HELP, GLOSSARY } from './help.js';

let $app = document.getElementById('app');
const $title = document.getElementById('title');
const $lead = document.getElementById('lead');
const $help = document.getElementById('help');
const $menu = document.getElementById('menu');

// ---------- Mise en forme ----------

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dec = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const money = (n) => (Number.isFinite(n) ? eur.format(n) : '—');
const pct = (n) => (Number.isFinite(n) ? `${dec.format(Math.round(n * 10) / 10)} %` : '—');
const fmt = (n) => (Number.isFinite(n) ? dec.format(n) : '');
const coef = (n) => (Number.isFinite(n) ? `× ${dec.format(Math.round(n * 100) / 100)}` : '—');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
const plural = (n, word) => `${fmt(n)} ${word}${n > 1 ? 's' : ''}`;

const SHORT_UNIT = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'L', pc: 'pièce' };
const LONG_UNIT = { kg: 'kilo (kg)', g: 'gramme (g)', l: 'litre (L)', cl: 'centilitre (cl)', ml: 'millilitre (ml)', pc: 'pièce(s)' };
const PER_UNIT = { kg: 'le kilo', l: 'le litre', pc: 'la pièce' };
const unitLabel = (u, q = 1) => (u === 'pc' && num(q) > 1 ? 'pièces' : SHORT_UNIT[u] ?? u);
const qtyLabel = (q, u) => `${fmt(num(q))} ${unitLabel(u, q)}`;

function unitOptions(units, selected, labels = SHORT_UNIT) {
  return units.map((u) => `<option value="${u}" ${u === selected ? 'selected' : ''}>${labels[u]}</option>`).join('');
}

const helpBtn = (key, label = 'Explication') =>
  `<button type="button" class="help-dot" data-help="${key}" aria-label="${label}">?</button>`;

const STATUS = {
  good: { label: 'Rentable', cls: 'good' },
  warn: { label: 'Limite', cls: 'warn' },
  bad: { label: 'À revoir', cls: 'bad' },
  none: { label: 'Prix à fixer', cls: 'none' },
  error: { label: 'Incomplète', cls: 'bad' },
};

const kindIcon = (r) => (r.kind === 'drink' ? icons.glass : icons.plate);

// ---------- Petits composants ----------

function toast(text, action) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
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
  setTimeout(() => el.classList.add('out'), action ? 5500 : 2200);
  setTimeout(() => el.remove(), action ? 6000 : 2600);
}

function sheet(html, { className = '', onClose = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet ${className}" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.add('closing');
    document.body.classList.remove('no-scroll');
    setTimeout(() => wrap.remove(), 180);
    onClose?.();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-sheet-close]')) close();
  });
  return { el: wrap.querySelector('.sheet'), close };
}

function openHelp(key) {
  const h = HELP[key];
  if (!h) return;
  sheet(`
    <div class="help-sheet">
      <h3>${h.title}</h3>
      <div class="prose">${h.body}</div>
      <button class="btn primary block" data-sheet-close>J’ai compris</button>
    </div>`);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (b) {
    e.preventDefault();
    e.stopPropagation();
    openHelp(b.dataset.help);
  }
});

function confirmSheet({ title, text, ok = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(
      `
      <h3>${esc(title)}</h3>
      ${text ? `<p class="sheet-text">${text}</p>` : ''}
      <button class="btn ${danger ? 'danger-fill' : 'primary'} block" data-ok>${esc(ok)}</button>
      <button class="btn ghost block" data-sheet-close>Annuler</button>`,
      { onClose: () => resolve(answered) },
    );
    s.el.querySelector('[data-ok]').onclick = () => {
      answered = true;
      s.close();
    };
  });
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
  const status = cost.errors ? 'error' : ratioStatus(price.ratio, target);
  return { cost, price, target, vat, status };
}

const pill = (status, ratio) => {
  const s = STATUS[status];
  return `<span class="pill ${s.cls}">${s.label}${Number.isFinite(ratio) && status !== 'error' ? ` <b>${pct(ratio)}</b>` : ''}</span>`;
};

// Décomposition visuelle du prix payé par le client.
function breakdown(p, overhead) {
  const ttc = p.sellTTC;
  const vat = ttc - p.sellHT;
  const ing = Math.max(p.cost, 0);
  const ch = overhead > 0 ? overhead : 0;
  const rest = p.sellHT - ing - ch;
  const parts = [
    ['ing', 'Ingrédients', ing],
    ...(ch ? [['ch', 'Charges (personnel, loyer…)', ch]] : []),
    ['rest', ch ? 'Ce qu’il vous reste (bénéfice)' : 'Ce qu’il vous reste (marge brute)', Math.max(rest, 0)],
    ['vat', 'TVA (reversée à l’État)', vat],
  ];
  const total = parts.reduce((s, [, , v]) => s + v, 0) || 1;
  return `
    <div class="split">
      <div class="split-title">Sur <b>${money(ttc)}</b> payés par le client :</div>
      <div class="split-bar">${parts
        .filter(([, , v]) => v > 0)
        .map(([k, , v]) => `<span class="seg-${k}" style="flex:${v / total}"></span>`)
        .join('')}</div>
      <ul class="split-legend">${parts
        .map(([k, l, v]) => `<li><i class="dot seg-${k}"></i><span>${l}</span><b>${money(v)}</b></li>`)
        .join('')}</ul>
      ${rest < 0 ? `<p class="alert bad">Attention : à ce prix, vous perdez ${money(-rest)} par portion.</p>` : ''}
    </div>`;
}

// ---------- Routeur ----------

const ONBOARD_KEY = 'renta.onboarded';
const isOnboarded = () => {
  try {
    return localStorage.getItem(ONBOARD_KEY) === '1' || db.recipes.length > 0 || db.ingredients.length > 0;
  } catch {
    return true;
  }
};
const setOnboarded = () => {
  try {
    localStorage.setItem(ONBOARD_KEY, '1');
  } catch {
    // stockage indisponible
  }
};

const routes = [
  [/^#\/bienvenue$/, viewWelcome, 'welcome'],
  [/^#\/fiches$/, viewRecipes, 'main'],
  [/^#\/fiche\/([\w-]+)$/, viewRecipe, 'detail'],
  [/^#\/produits$/, viewProducts, 'main'],
  [/^#\/produit\/([\w-]+)$/, viewProduct, 'detail'],
  [/^#\/calcul$/, viewCalculator, 'main'],
  [/^#\/reglages$/, viewSettings, 'main'],
  [/^#\/aide$/, viewGuide, 'detail'],
];

const scrollMemory = new Map();
let currentPath = null;
let depth = 0; // nombre d'écrans ouverts dans l'appli (pour le bouton retour)

function go(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else {
    history.pushState(null, '', hash);
    depth++;
  }
  transition(() => render());
}

function transition(fn, back = false) {
  document.documentElement.dataset.nav = back ? 'back' : 'forward';
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(fn);
  } else fn();
}

function parseHash() {
  const [path, query = ''] = location.hash.split('?');
  return { path, params: new URLSearchParams(query) };
}

function render({ restoreScroll = false } = {}) {
  const { path, params } = parseHash();
  if (!isOnboarded() && path !== '#/bienvenue') {
    history.replaceState(null, '', '#/bienvenue');
    return render();
  }
  if (currentPath) scrollMemory.set(currentPath, window.scrollY);
  currentPath = path;

  $help.hidden = true;
  $menu.hidden = true;
  $menu.onclick = null;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', path.startsWith(a.dataset.match));
  });
  // Nouveau conteneur à chaque écran : les écouteurs de l'écran précédent disparaissent.
  const fresh = $app.cloneNode(false);
  $app.replaceWith(fresh);
  $app = fresh;
  for (const [re, view, mode] of routes) {
    const m = path.match(re);
    if (m) {
      document.body.dataset.mode = mode;
      view(m[1], params);
      window.scrollTo(0, restoreScroll ? scrollMemory.get(path) || 0 : 0);
      return;
    }
  }
  history.replaceState(null, '', '#/fiches');
  render();
}

function setHeader(title, { back = false, help = null, menu = null } = {}) {
  $title.textContent = title;
  $lead.innerHTML = back
    ? `<button class="hdr-btn" data-back aria-label="Retour">${icons.back}</button>`
    : `<a class="logo" href="#/fiches" aria-label="Accueil">Le Ici</a>`;
  $lead.querySelector('[data-back]')?.addEventListener('click', goBack);
  if (help) {
    $help.hidden = false;
    $help.dataset.help = help;
  }
  if (menu) {
    $menu.hidden = false;
    $menu.onclick = menu;
  }
}

function goBack() {
  if (depth > 0) history.back();
  else go(location.hash.startsWith('#/produit') ? '#/produits' : '#/fiches', true);
}

window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1);
  document.querySelectorAll('.sheet-wrap').forEach((w) => w.remove());
  document.body.classList.remove('no-scroll');
  transition(() => render({ restoreScroll: true }), true);
});

// ---------- Accueil (premier lancement) ----------

function viewWelcome() {
  setHeader('Bienvenue');
  $app.innerHTML = `
    <section class="welcome">
      <div class="welcome-brand">
        <div class="welcome-logo">Le Ici</div>
        <p>Le carnet de rentabilité<br/>de la cuisine et du bar</p>
      </div>
      <div class="tiles-band" aria-hidden="true"></div>
      <h2 class="welcome-title">Comment ça marche ?</h2>
      <ol class="steps">
        <li><span class="step-n">1</span><div><b>Enregistrez vos produits</b><p>Ce que vous achetez, avec le prix de la facture. Scannez le code-barres pour aller plus vite.</p></div></li>
        <li><span class="step-n">2</span><div><b>Créez vos fiches</b><p>Pour chaque plat ou cocktail : les ingrédients et leurs quantités.</p></div></li>
        <li><span class="step-n">3</span><div><b>Fixez le bon prix</b><p>L’appli calcule le coût d’une portion, le prix de vente conseillé et ce qu’il vous reste.</p></div></li>
      </ol>
      <button class="btn primary block big" data-demo>${icons.sparkle} Découvrir avec un exemple</button>
      <button class="btn block big" data-start>Commencer avec ma carte</button>
      <p class="fine">Vos données restent sur ce téléphone. Aucun compte à créer.</p>
    </section>`;
  $app.querySelector('[data-demo]').onclick = () => {
    if (!db.recipes.length) store.loadDemo();
    setOnboarded();
    go('#/fiches', true);
    setTimeout(() => toast('Exemple chargé : touchez une fiche pour l’ouvrir'), 400);
  };
  $app.querySelector('[data-start]').onclick = () => {
    setOnboarded();
    go('#/produits', true);
  };
}

// ---------- Fiches techniques ----------

let recipeFilter = 'all';
let recipeSearch = '';

function viewRecipes() {
  setHeader('Mes fiches', { help: 'ecran-fiches' });

  if (!db.recipes.length) {
    const noProducts = !db.ingredients.length;
    $app.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icons.fiches}</div>
        <h2>Aucune fiche pour l’instant</h2>
        <p>Une fiche, c’est une recette (un plat, un cocktail, une sauce…). L’appli calcule ce qu’elle vous coûte et à quel prix la vendre.</p>
        ${
          noProducts
            ? `<p class="tip"><b>Conseil :</b> commencez par enregistrer quelques produits (vos achats), ce sera plus rapide pour remplir les fiches.</p>
               <a class="btn primary block big" href="#/produits">Ajouter mes produits</a>
               <button class="btn block" data-new>Créer une fiche quand même</button>`
            : `<button class="btn primary block big" data-new>${icons.plus} Créer ma première fiche</button>`
        }
        <button class="btn ghost block" data-demo>Charger l’exemple</button>
      </div>`;
    $app.querySelector('[data-new]').onclick = () => newRecipe();
    $app.querySelector('[data-demo]').onclick = () => {
      store.loadDemo();
      render();
    };
    return;
  }

  const analysed = db.recipes.map((r) => ({ r, a: analyse(r) }));
  const sold = analysed.filter(({ a }) => Number.isFinite(a.price.ratio) && a.status !== 'error');
  const avg = sold.length ? sold.reduce((s, { a }) => s + a.price.ratio, 0) / sold.length : NaN;
  const count = (list) => analysed.filter(({ a }) => list.includes(a.status)).length;
  const good = count(['good']);
  const review = count(['warn', 'bad', 'error']);
  const unpriced = count(['none']);

  $app.innerHTML = `
    <section class="summary">
      <div class="summary-main">
        <span>Part moyenne des ingrédients ${helpBtn('ratio')}</span>
        <b>${pct(avg)}</b>
        <small>${sold.length ? `sur ${plural(sold.length, 'fiche')} avec un prix de vente` : 'ajoutez vos prix de vente pour la voir'}</small>
      </div>
      <div class="summary-counts">
        <button data-filter="good"><i class="dot good"></i><b>${good}</b> rentable${good > 1 ? 's' : ''}</button>
        <button data-filter="review"><i class="dot bad"></i><b>${review}</b> à revoir</button>
        <button data-filter="none"><i class="dot none"></i><b>${unpriced}</b> sans prix</button>
      </div>
    </section>

    <button class="btn primary block big" data-new>${icons.plus} Nouvelle fiche</button>

    <div class="search">${icons.search}<input type="search" placeholder="Rechercher une fiche…" value="${esc(recipeSearch)}" aria-label="Rechercher une fiche" /></div>
    <div class="chips">
      ${[
        ['all', 'Toutes'],
        ['food', 'Cuisine'],
        ['drink', 'Bar'],
        ['review', 'À revoir'],
        ['none', 'Sans prix'],
        ['good', 'Rentables'],
      ]
        .map(([k, l]) => `<button class="chip ${recipeFilter === k ? 'on' : ''}" data-chip="${k}">${l}</button>`)
        .join('')}
    </div>
    <ul class="cards" id="recipe-list"></ul>`;

  const list = $app.querySelector('#recipe-list');
  const draw = () => {
    const q = norm(recipeSearch);
    const rows = analysed
      .filter(({ r, a }) => {
        if (recipeFilter === 'food' && r.kind === 'drink') return false;
        if (recipeFilter === 'drink' && r.kind !== 'drink') return false;
        if (recipeFilter === 'review' && !['warn', 'bad', 'error'].includes(a.status)) return false;
        if (recipeFilter === 'none' && a.status !== 'none') return false;
        if (recipeFilter === 'good' && a.status !== 'good') return false;
        return !q || norm(r.name).includes(q);
      })
      .sort((x, y) => byName(x.r, y.r));
    list.innerHTML = rows.length
      ? rows
          .map(
            ({ r, a }) => `
        <li><a class="card-row" href="#/fiche/${r.id}">
          <span class="kind ${r.kind === 'drink' ? 'drink' : 'food'}">${kindIcon(r)}</span>
          <div class="row-main">
            <div class="row-title">${esc(r.name || 'Sans nom')}</div>
            <div class="row-sub">
              Coût <b>${money(a.price.cost)}</b>
              ${Number.isFinite(a.price.sellTTC) ? ` · Vendu <b>${money(a.price.sellTTC)}</b>` : Number.isFinite(a.price.roundedTTC) ? ` · Conseillé ${money(a.price.roundedTTC)}` : ''}
            </div>
          </div>
          ${pill(a.status, a.price.ratio)}
        </a></li>`,
          )
          .join('')
      : '<li class="muted center pad">Aucune fiche ne correspond.</li>';
  };
  draw();
  const setFilter = (k) => {
    recipeFilter = k;
    $app.querySelectorAll('[data-chip]').forEach((c) => c.classList.toggle('on', c.dataset.chip === k));
    draw();
  };
  $app.querySelector('.search input').oninput = (e) => {
    recipeSearch = e.target.value;
    draw();
  };
  $app.querySelectorAll('[data-chip]').forEach((b) => (b.onclick = () => setFilter(b.dataset.chip)));
  $app.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => setFilter(b.dataset.filter)));
  $app.querySelector('[data-new]').onclick = () => newRecipe();
}

function newRecipe() {
  const s = sheet(`
    <h3>Nouvelle fiche</h3>
    <p class="sheet-text">Qu’allez-vous calculer ?</p>
    <button class="choice" data-k="food">
      <span class="kind food">${icons.plate}</span>
      <span><b>Cuisine</b><small>Plat, entrée, dessert, sauce, garniture… (TVA ${fmt(db.settings.vatFood)} %, objectif ${fmt(db.settings.targetFood)} %)</small></span>
    </button>
    <button class="choice" data-k="drink">
      <span class="kind drink">${icons.glass}</span>
      <span><b>Bar</b><small>Cocktail, boisson, verre de vin… (TVA ${fmt(db.settings.vatDrink)} %, objectif ${fmt(db.settings.targetDrink)} %)</small></span>
    </button>
    <button class="btn ghost block" data-sheet-close>Annuler</button>`);
  s.el.querySelectorAll('[data-k]').forEach(
    (b) =>
      (b.onclick = () => {
        s.close();
        const r = store.createRecipe(b.dataset.k);
        go(`#/fiche/${r.id}?new=1`);
      }),
  );
}

function viewRecipe(id, params) {
  const recipe = store.getRecipe(id);
  if (!recipe) return go('#/fiches', true);

  const header = () =>
    setHeader(recipe.name || 'Nouvelle fiche', {
      back: true,
      help: 'ecran-fiche',
      menu: () => recipeMenu(recipe),
    });
  header();

  const drink = recipe.kind === 'drink';
  const { target, vat } = settingsFor(recipe);
  const parents = store.usedIn('rec', recipe.id);
  const isSet = (v) => v !== '' && v != null;
  const customized = isSet(recipe.target) || isSet(recipe.vat);

  $app.innerHTML = `
    <section class="step">
      <h2 class="step-title"><span class="step-n">1</span>La recette</h2>
      <div class="card">
        <label class="lbl" for="r-name">Nom</label>
        <input id="r-name" class="title-input" name="name" placeholder="${drink ? 'ex : Mojito' : 'ex : Burger du Ici'}" value="${esc(recipe.name)}" autocomplete="off" enterkeyhint="done" />
        <div class="lbl">Type</div>
        <div class="seg" role="radiogroup">
          <button data-kind="food" class="${!drink ? 'on' : ''}" role="radio" aria-checked="${!drink}">${icons.plate} Cuisine</button>
          <button data-kind="drink" class="${drink ? 'on' : ''}" role="radio" aria-checked="${drink}">${icons.glass} Bar</button>
        </div>
        <div class="field-row">
          <div><span class="lbl inline">Nombre de portions ${helpBtn('portions')}</span>
            <small class="hint">Combien d’assiettes ou de verres cette recette donne.</small></div>
          <div class="stepper">
            <button data-step="-1" aria-label="Une portion de moins">−</button>
            <input name="portions" inputmode="decimal" value="${esc(fmt(num(recipe.portions)))}" aria-label="Nombre de portions" />
            <button data-step="1" aria-label="Une portion de plus">+</button>
          </div>
        </div>
        ${parents.length ? `<p class="note">${icons.pot} Utilisée comme préparation dans : ${parents.map((p) => `<a href="#/fiche/${p.id}">${esc(p.name || 'Sans nom')}</a>`).join(', ')}</p>` : ''}
      </div>
    </section>

    <section class="step">
      <h2 class="step-title"><span class="step-n">2</span>Les ingrédients <span class="step-aside" id="total-cost"></span></h2>
      <p class="step-help">Indiquez les quantités pour <b>toute la recette</b> (<span id="portions-word"></span>).</p>
      <div class="card flush">
        <ul class="items" id="items"></ul>
        <div class="items-actions">
          <button class="btn primary" data-add>${icons.plus} Ajouter</button>
          <button class="btn" data-scan>${icons.scan} Scanner</button>
        </div>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title"><span class="step-n">3</span>Le prix de vente</h2>
      <div class="card">
        <div id="suggest"></div>
        <label class="lbl" for="r-sell">Votre prix sur la carte (TTC) ${helpBtn('ht', 'HT et TTC')}</label>
        <div class="input-unit big"><input id="r-sell" name="sellTTC" inputmode="decimal" placeholder="0,00" value="${esc(fmt(num(recipe.sellTTC)))}" enterkeyhint="done" /><span>€</span></div>
        <details class="more" ${customized ? 'open' : ''}>
          <summary>Objectif et TVA de cette fiche</summary>
          <div class="field-row">
            <span class="lbl inline">Objectif : part des ingrédients ${helpBtn('objectif')}</span>
            <div class="input-unit small"><input name="target" inputmode="decimal" placeholder="${fmt(target)}" value="${esc(fmt(num(recipe.target)))}" aria-label="Objectif en pourcentage" /><span>%</span></div>
          </div>
          <div class="field-row">
            <span class="lbl inline">TVA ${helpBtn('tva')}</span>
            <select name="vat" class="small" aria-label="TVA">
              ${['', 5.5, 10, 20]
                .map((v) => `<option value="${v}" ${String(recipe.vat ?? '') === String(v) ? 'selected' : ''}>${v === '' ? `Auto (${fmt(vat)} %)` : `${fmt(v)} %`}</option>`)
                .join('')}
            </select>
          </div>
          <p class="hint">Laissez vide pour utiliser les valeurs des Réglages.</p>
        </details>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title"><span class="step-n">4</span>Le résultat</h2>
      <div class="card" id="results"></div>
    </section>

    <section class="step">
      <h2 class="step-title"><span class="step-n">${icons.book}</span>Notes</h2>
      <div class="card"><textarea name="notes" rows="3" placeholder="Dressage, grammages, allergènes, verre utilisé…">${esc(recipe.notes)}</textarea></div>
    </section>

    <div class="dock" id="dock"></div>`;

  const persist = () => {
    recipe.updatedAt = Date.now();
    store.save();
  };

  const drawItems = () => {
    const ul = $app.querySelector('#items');
    if (!recipe.items.length) {
      ul.innerHTML = `<li class="items-empty">
        <b>Aucun ingrédient</b>
        <span>Touchez « Ajouter » pour choisir un produit${db.ingredients.length ? '' : ' (ou en créer un)'}, puis indiquez la quantité.</span>
      </li>`;
    } else {
      ul.innerHTML = recipe.items
        .map((it, i) => {
          let name;
          let units;
          let sub = '';
          if (it.type === 'rec') {
            const r = store.getRecipe(it.ref);
            name = r ? `<a href="#/fiche/${r.id}">${esc(r.name || 'Sans nom')}</a>` : '<span class="bad-text">Préparation supprimée</span>';
            units = `<span class="unit-fixed">portion${num(it.qty) > 1 ? 's' : ''}</span>`;
            sub = `<span class="tag">${icons.pot} préparation maison</span>`;
          } else {
            const ing = store.getIngredient(it.ref);
            name = ing ? esc(ing.name) : '<span class="bad-text">Produit supprimé</span>';
            units = ing ? `<select data-unit="${i}" aria-label="Unité">${unitOptions(compatibleUnits(ing.unit), it.unit)}</select>` : '';
            const c = ing && ingredientDisplayCost(ing);
            if (c) sub = `<span class="tag">${money(c.value)} ${PER_UNIT[c.unit]}</span>`;
          }
          return `
          <li class="item" data-i="${i}">
            <div class="item-head">
              <div class="item-name">${name}${sub}</div>
              <span class="item-cost" data-cost="${i}"></span>
            </div>
            <div class="item-qty">
              <input data-qty="${i}" inputmode="decimal" placeholder="Quantité" value="${esc(fmt(num(it.qty)))}" aria-label="Quantité" enterkeyhint="done" />
              ${units}
              <button class="icon-btn" data-del="${i}" aria-label="Retirer cet ingrédient">${icons.trash}</button>
            </div>
          </li>`;
        })
        .join('');
    }
    drawResults();
  };

  const drawResults = () => {
    const a = analyse(recipe);
    const p = a.price;
    const portions = num(recipe.portions);
    a.cost.lines.forEach((line, i) => {
      const el = $app.querySelector(`[data-cost="${i}"]`);
      if (!el) return;
      el.textContent = line.error ? line.error : money(line.cost);
      el.classList.toggle('bad-text', !!line.error);
    });
    $app.querySelector('#total-cost').textContent = recipe.items.length ? `Total ${money(a.cost.total)}` : '';
    $app.querySelector('#portions-word').textContent =
      Number.isFinite(portions) && portions > 0 ? `les ${plural(portions, 'portion')}` : 'toutes les portions';

    // Prix conseillé
    $app.querySelector('#suggest').innerHTML = Number.isFinite(p.roundedTTC)
      ? `<div class="suggest">
          <div>
            <span>Prix conseillé ${helpBtn('prix-conseille')}</span>
            <b>${money(p.roundedTTC)}</b>
            <small>minimum pour que les ingrédients fassent ${pct(a.target)} du prix</small>
          </div>
          ${Math.abs(num(recipe.sellTTC) - p.roundedTTC) > 0.004 ? `<button class="btn small-btn" data-use-price>Utiliser</button>` : `<span class="ok-tag">${icons.check}</span>`}
        </div>`
      : `<p class="hint first">Le prix conseillé apparaîtra quand les ingrédients auront une quantité.</p>`;

    // Résultat
    const hasSell = Number.isFinite(p.sellTTC);
    const overhead = num(db.settings.overhead) > 0 ? num(db.settings.overhead) : 0;
    let html = '';
    if (a.cost.errors) {
      html += `<p class="alert warn">${plural(a.cost.errors, 'ingrédient')} à compléter (en rouge ci-dessus) pour un calcul juste.</p>`;
    }
    html += `
      <div class="kpis">
        <div class="kpi"><span>Coût d’une portion</span><b>${money(p.cost)}</b><small>en ingrédients, HT</small></div>
        ${
          overhead
            ? `<div class="kpi"><span>Prix de revient ${helpBtn('charges')}</span><b>${money(p.fullCost)}</b><small>avec ${money(overhead)} de charges</small></div>`
            : portions > 1
              ? `<div class="kpi"><span>Coût de la recette</span><b>${money(a.cost.total)}</b><small>pour ${plural(portions, 'portion')}</small></div>`
              : `<div class="kpi"><span>Prix conseillé</span><b>${money(p.roundedTTC)}</b><small>TTC, objectif ${pct(a.target)}</small></div>`
        }
      </div>`;
    if (hasSell && Number.isFinite(p.ratio) && a.status !== 'error') {
      const msg = {
        good: `Les ingrédients font <b>${pct(p.ratio)}</b> du prix HT, sous votre objectif de ${pct(a.target)}. Bien joué !`,
        warn: `Les ingrédients font <b>${pct(p.ratio)}</b> du prix HT, un peu au-dessus de votre objectif de ${pct(a.target)}. Pour l’atteindre, vendez au moins <b>${money(p.roundedTTC)}</b> ou réduisez un peu les quantités.`,
        bad: `Les ingrédients font <b>${pct(p.ratio)}</b> du prix HT, bien au-dessus de votre objectif de ${pct(a.target)}. Vendez au moins <b>${money(p.roundedTTC)}</b>, ou revoyez la recette ou vos achats.`,
      }[a.status];
      html += `
        <div class="verdict ${a.status}">
          <div class="verdict-head">${pill(a.status)}<span class="verdict-ratio">${pct(p.ratio)}</span></div>
          <p>${msg}</p>
        </div>
        ${breakdown(p, overhead)}
        <div class="lines">
          <div class="line"><span>Prix de vente HT ${helpBtn('ht')}</span><b>${money(p.sellHT)}</b></div>
          <div class="line"><span>Marge brute par portion ${helpBtn('marge')}</span><b>${money(p.margin)}</b></div>
          ${overhead ? `<div class="line"><span>Marge nette par portion ${helpBtn('charges')}</span><b class="${p.netMargin < 0 ? 'bad-text' : ''}">${money(p.netMargin)}</b></div>` : ''}
          <div class="line"><span>Coefficient ${helpBtn('coef')}</span><b>${coef(p.coef)}</b></div>
        </div>`;
    } else if (!a.cost.errors) {
      html += `<p class="hint center">Indiquez votre prix de vente à l’étape 3 pour savoir si ce ${drink ? 'cocktail' : 'plat'} est rentable.</p>`;
    }
    $app.querySelector('#results').innerHTML = html;

    // Barre résumé en bas d'écran
    $app.querySelector('#dock').innerHTML = `
      <div class="dock-info"><span>Coût / portion</span><b>${money(p.cost)}</b></div>
      <div class="dock-info"><span>${hasSell ? 'Vendu' : 'Conseillé'}</span><b>${money(hasSell ? p.sellTTC : p.roundedTTC)}</b></div>
      ${pill(a.status, p.ratio)}`;
    header();
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
  $app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  });
  $app.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.dataset.help) return;
    if (t.dataset.kind) {
      if (recipe.kind === t.dataset.kind) return;
      recipe.kind = t.dataset.kind;
      persist();
      $app.querySelectorAll('[data-kind]').forEach((b) => {
        b.classList.toggle('on', b === t);
        b.setAttribute('aria-checked', b === t);
      });
      const st = settingsFor(recipe);
      const auto = $app.querySelector('[name="vat"] option[value=""]');
      if (auto) auto.textContent = `Auto (${fmt(st.vat)} %)`;
      $app.querySelector('[name="target"]').placeholder = fmt(st.target);
      drawResults();
    } else if (t.dataset.step) {
      const cur = num(recipe.portions);
      recipe.portions = Math.max(1, (Number.isFinite(cur) ? Math.round(cur) : 1) + Number(t.dataset.step));
      $app.querySelector('[name="portions"]').value = recipe.portions;
      persist();
      drawResults();
    } else if (t.dataset.del != null) {
      const at = +t.dataset.del;
      const [removed] = recipe.items.splice(at, 1);
      persist();
      drawItems();
      toast('Ingrédient retiré', {
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
    } else if (t.hasAttribute('data-use-price')) {
      const p = analyse(recipe).price;
      recipe.sellTTC = Math.round(p.roundedTTC * 100) / 100;
      $app.querySelector('[name="sellTTC"]').value = fmt(recipe.sellTTC);
      persist();
      drawResults();
      toast('Prix conseillé appliqué');
    }
  });

  function addItem(item) {
    recipe.items.push(item);
    persist();
    drawItems();
    const input = $app.querySelector(`[data-qty="${recipe.items.length - 1}"]`);
    input?.closest('.item')?.classList.add('flash');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  }

  if (params.get('new')) {
    history.replaceState(null, '', `#/fiche/${recipe.id}`);
    setTimeout(() => $app.querySelector('[name="name"]')?.focus(), 350);
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
  const s = sheet(
    `
    <div class="sheet-head">
      <h3>Ajouter un ingrédient</h3>
      <button class="icon-btn" data-sheet-close aria-label="Fermer">${icons.close}</button>
    </div>
    <div class="search">${icons.search}<input type="search" placeholder="Rechercher…" autocomplete="off" aria-label="Rechercher un produit" /></div>
    <button class="btn block" data-create>${icons.plus} Créer un nouveau produit</button>
    <div id="pick"></div>`,
    { className: 'tall' },
  );
  const box = s.el.querySelector('#pick');
  const input = s.el.querySelector('input');
  const draw = () => {
    const q = norm(input.value);
    const fi = ings.filter((i) => !q || norm(i.name).includes(q) || norm(i.supplier).includes(q));
    const fp = preps.filter((r) => !q || norm(r.name).includes(q));
    let html = '';
    if (fi.length) {
      html += `<div class="list-sep">Mes produits</div><ul class="list">${fi
        .map((i) => {
          const c = ingredientDisplayCost(i);
          return `<li><button class="row" data-ing="${i.id}"><div class="row-main"><div class="row-title">${esc(i.name)}</div>
            <div class="row-sub">${c ? `${money(c.value)} ${PER_UNIT[c.unit]}` : 'prix incomplet'}</div></div><span class="add-ico">${icons.plus}</span></button></li>`;
        })
        .join('')}</ul>`;
    }
    if (fp.length) {
      html += `<div class="list-sep">Mes préparations maison ${helpBtn('preparation')}</div><ul class="list">${fp
        .map(
          (r) => `<li><button class="row" data-rec="${r.id}"><div class="row-main"><div class="row-title">${esc(r.name || 'Sans nom')}</div>
          <div class="row-sub">${money(recipeCost(r, db).perPortion)} la portion</div></div><span class="add-ico">${icons.plus}</span></button></li>`,
        )
        .join('')}</ul>`;
    }
    box.innerHTML =
      html ||
      `<p class="muted center pad">${db.ingredients.length ? 'Aucun résultat. Créez le produit avec le bouton ci-dessus.' : 'Vous n’avez encore aucun produit. Créez-en un avec le bouton ci-dessus.'}</p>`;
  };
  draw();
  input.oninput = draw;
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.help) return;
    s.close();
    if (b.dataset.ing) onPick(itemFromIngredient(store.getIngredient(b.dataset.ing)));
    else if (b.dataset.rec) onPick({ type: 'rec', ref: b.dataset.rec, qty: 1 });
  };
  s.el.querySelector('[data-create]').onclick = () => {
    s.close();
    const name = input.value.trim();
    go(`#/produit/new?addTo=${recipe.id}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
  };
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

async function scanIntoRecipe(recipe, onPick) {
  const code = await scanBarcode({ title: 'Scanner un ingrédient' });
  if (!code) return;
  const ing = store.findByBarcode(code);
  if (ing) {
    onPick(itemFromIngredient(ing));
    toast(`${ing.name} ajouté : indiquez la quantité`);
  } else {
    toast('Nouveau produit : complétez-le, il sera ajouté à la fiche');
    go(`#/produit/new?barcode=${encodeURIComponent(code)}&addTo=${recipe.id}`);
  }
}

function recipeMenu(recipe) {
  const s = sheet(`
    <h3>${esc(recipe.name || 'Fiche')}</h3>
    <button class="menu-item" data-a="share">${icons.share}<span>Partager ou copier la fiche<small>Envoyer par message à l’équipe</small></span></button>
    <button class="menu-item" data-a="dup">${icons.copy}<span>Dupliquer<small>Pour créer une variante (ex. version végétarienne)</small></span></button>
    <button class="menu-item danger" data-a="del">${icons.trash}<span>Supprimer la fiche</span></button>
    <button class="btn ghost block" data-sheet-close>Fermer</button>`);
  s.el.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    s.close();
    if (a === 'dup') {
      const copy = store.duplicateRecipe(recipe.id);
      go(`#/fiche/${copy.id}`);
      toast('Fiche dupliquée');
    } else if (a === 'share') {
      shareRecipe(recipe);
    } else if (a === 'del') {
      const parents = store.usedIn('rec', recipe.id);
      const ok = await confirmSheet({
        title: `Supprimer « ${recipe.name || 'Sans nom'} » ?`,
        text: parents.length
          ? `Elle sera aussi retirée de : ${parents.map((p) => esc(p.name)).join(', ')}.`
          : 'Cette action est définitive.',
        ok: 'Supprimer',
        danger: true,
      });
      if (ok) {
        store.deleteRecipe(recipe.id);
        go('#/fiches', true);
        toast('Fiche supprimée');
      }
    }
  };
}

async function shareRecipe(recipe) {
  const a = analyse(recipe);
  const lines = [`${recipe.name || 'Fiche'} — ${plural(num(recipe.portions), 'portion')}`];
  recipe.items.forEach((it, i) => {
    const line = a.cost.lines[i];
    const name = it.type === 'rec' ? store.getRecipe(it.ref)?.name : store.getIngredient(it.ref)?.name;
    const unit = it.type === 'rec' ? 'portion(s)' : unitLabel(it.unit, it.qty);
    lines.push(`• ${name ?? '?'} : ${fmt(num(it.qty))} ${unit} (${money(line.cost)})`);
  });
  lines.push('', `Coût d’une portion : ${money(a.price.cost)}`, `Prix conseillé : ${money(a.price.roundedTTC)} TTC`);
  if (Number.isFinite(a.price.sellTTC)) {
    lines.push(`Prix de vente : ${money(a.price.sellTTC)} TTC (ingrédients ${pct(a.price.ratio)})`);
  }
  if (recipe.notes) lines.push('', `Notes : ${recipe.notes}`);
  const text = lines.join('\n');
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.name, text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Fiche copiée : collez-la dans un message');
  } catch {
    toast('Partage impossible sur cet appareil');
  }
}

// ---------- Produits (matières premières) ----------

let productSearch = '';

function viewProducts() {
  setHeader('Mes produits', { help: 'ecran-produits' });
  if (!db.ingredients.length) {
    $app.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icons.produits}</div>
        <h2>Aucun produit enregistré</h2>
        <p>Les produits sont vos <b>matières premières</b> : ce que vous achetez (beurre, bœuf, rhum, citrons…) avec le prix payé au fournisseur.</p>
        <button class="btn primary block big" data-scan>${icons.scan} Scanner un code-barres</button>
        <button class="btn block big" data-new>${icons.plus} Saisir à la main</button>
        <p class="fine">Les produits frais sans code-barres (légumes, viande…) se saisissent à la main.</p>
      </div>`;
    $app.querySelector('[data-scan]').onclick = scanFromTab;
    $app.querySelector('[data-new]').onclick = () => go('#/produit/new');
    return;
  }
  $app.innerHTML = `
    <div class="duo">
      <button class="btn primary big" data-new>${icons.plus} Nouveau</button>
      <button class="btn big" data-scan>${icons.scan} Scanner</button>
    </div>
    <div class="search">${icons.search}<input type="search" placeholder="Rechercher un produit, un fournisseur…" value="${esc(productSearch)}" aria-label="Rechercher un produit" /></div>
    <p class="list-count" id="product-count"></p>
    <ul class="cards" id="product-list"></ul>`;
  const ul = $app.querySelector('#product-list');
  const draw = () => {
    const q = norm(productSearch);
    const rows = db.ingredients
      .filter((i) => !q || norm(i.name).includes(q) || norm(i.supplier).includes(q) || (i.barcode || '').includes(q))
      .sort(byName);
    $app.querySelector('#product-count').textContent = `${plural(rows.length, 'produit')} · prix ramenés au kilo, au litre ou à la pièce`;
    ul.innerHTML =
      rows
        .map((i) => {
          const c = ingredientDisplayCost(i);
          const trend = priceTrend(i);
          const used = store.usedIn('ing', i.id).length;
          return `<li><a class="card-row" href="#/produit/${i.id}">
          <div class="row-main">
            <div class="row-title">${esc(i.name)}</div>
            <div class="row-sub">Acheté ${money(num(i.price))} HT les ${qtyLabel(i.qty, i.unit)}${i.supplier ? ` · ${esc(i.supplier)}` : ''}</div>
            <div class="row-sub">${used ? `Dans ${plural(used, 'fiche')}` : 'Pas encore utilisé'}${num(i.yield) < 100 ? ` · ${fmt(num(i.yield))} % utilisable` : ''}</div>
          </div>
          <div class="row-end">
            <b>${c ? money(c.value) : '—'}</b><small>${c ? PER_UNIT[c.unit] : ''}</small>
            ${trend ? `<span class="trend ${trend.up ? 'up' : 'down'}">${trend.up ? icons.up : icons.down}${pct(Math.abs(trend.change))}</span>` : ''}
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
  $app.querySelector('[data-new]').onclick = () => go('#/produit/new');
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
    toast('Produit retrouvé : modifiez le prix si besoin');
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
  const addToRecipe = addTo && store.getRecipe(addTo);
  const used = existing ? store.usedIn('ing', existing.id) : [];
  const suppliers = [...new Set(db.ingredients.map((i) => i.supplier).filter(Boolean))];

  setHeader(isNew ? 'Nouveau produit' : existing.name, { back: true, help: 'ecran-produit' });

  $app.innerHTML = `
    <form id="product-form" novalidate>
      ${addToRecipe ? `<p class="banner">Ce produit sera ajouté à la fiche « ${esc(addToRecipe.name || 'Sans nom')} ».</p>` : ''}
      <section class="step">
        <h2 class="step-title"><span class="step-n">1</span>Le produit</h2>
        <div class="card">
          <label class="lbl" for="p-name">Nom du produit</label>
          <input id="p-name" name="name" autocomplete="off" placeholder="ex : Beurre doux, Rhum blanc…" value="${esc(ing.name)}" enterkeyhint="next" />
          <p class="lookup" id="off-status" hidden></p>
          <label class="lbl" for="p-barcode">Code-barres <span class="opt">facultatif</span> ${helpBtn('code-barres')}</label>
          <div class="with-btn">
            <input id="p-barcode" name="barcode" inputmode="numeric" autocomplete="off" placeholder="Scannez ou tapez" value="${esc(ing.barcode)}" />
            <button type="button" class="btn" data-scan aria-label="Scanner le code-barres">${icons.scan}</button>
          </div>
        </div>
      </section>

      <section class="step">
        <h2 class="step-title"><span class="step-n">2</span>Ce que vous payez</h2>
        <p class="step-help">Recopiez votre facture fournisseur, hors taxes ${helpBtn('ht', 'HT et TTC')}</p>
        <div class="card">
          <div class="buy">
            <div>
              <label class="lbl" for="p-price">Prix payé (HT)</label>
              <div class="input-unit big"><input id="p-price" name="price" inputmode="decimal" placeholder="0,00" value="${esc(fmt(num(ing.price)))}" /><span>€</span></div>
            </div>
            <span class="buy-for">pour</span>
            <div>
              <label class="lbl" for="p-qty">Quantité reçue</label>
              <input id="p-qty" class="big-input" name="qty" inputmode="decimal" placeholder="1" value="${esc(fmt(num(ing.qty)))}" />
            </div>
          </div>
          <label class="lbl" for="p-unit">Unité de la quantité</label>
          <select id="p-unit" name="unit">${unitOptions(Object.keys(LONG_UNIT), ing.unit, LONG_UNIT)}</select>
          <p class="hint">Exemples : 32 € pour 20 litres d’huile · 16,90 € pour 70 cl de rhum · 4,80 € pour 12 pains.</p>
        </div>
      </section>

      <section class="step">
        <h2 class="step-title"><span class="step-n">3</span>Partie utilisable ${helpBtn('rendement')}</h2>
        <p class="step-help">Quelle part du produit finit vraiment dans l’assiette ou le verre ?</p>
        <div class="card">
          <div class="chips wrap">
            ${[100, 95, 90, 80, 70, 50]
              .map((v) => `<button type="button" class="chip" data-yield="${v}">${v} %</button>`)
              .join('')}
          </div>
          <div class="field-row">
            <span class="lbl inline">Autre valeur</span>
            <div class="input-unit small"><input name="yield" inputmode="decimal" value="${esc(fmt(num(ing.yield)))}" aria-label="Partie utilisable en pourcentage" /><span>%</span></div>
          </div>
          <div class="result-box" id="unit-cost"></div>
        </div>
      </section>

      <section class="step">
        <h2 class="step-title"><span class="step-n">4</span>Fournisseur <span class="opt">facultatif</span></h2>
        <div class="card">
          <input name="supplier" autocomplete="off" placeholder="ex : Metro, Promocash, le primeur…" value="${esc(ing.supplier)}" aria-label="Fournisseur" list="suppliers" />
          <datalist id="suppliers">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
        </div>
      </section>
    </form>
    ${
      existing
        ? `
      ${used.length ? `<section class="step"><h2 class="step-title">Utilisé dans</h2><ul class="cards">${used.map((r) => `<li><a class="card-row" href="#/fiche/${r.id}"><span class="kind ${r.kind === 'drink' ? 'drink' : 'food'}">${kindIcon(r)}</span><div class="row-main"><div class="row-title">${esc(r.name || 'Sans nom')}</div></div><span class="chev">${icons.chevron}</span></a></li>`).join('')}</ul></section>` : ''}
      ${existing.history?.length ? `<section class="step"><h2 class="step-title">Anciens prix</h2><ul class="cards">${[...existing.history].reverse().map((h) => `<li class="card-row static"><div class="row-main"><div class="row-title">${money(num(h.price))} les ${qtyLabel(h.qty, h.unit)}</div></div><small class="muted">${h.date ? `jusqu’au ${new Date(h.date).toLocaleDateString('fr-FR')}` : ''}</small></li>`).join('')}</ul></section>` : ''}
      <button class="btn danger block" data-delete>${icons.trash} Supprimer ce produit</button>`
        : ''
    }
    <div class="dock">
      <button class="btn primary block big" type="submit" form="product-form">${icons.check} ${addToRecipe ? 'Enregistrer et ajouter à la fiche' : 'Enregistrer'}</button>
    </div>`;

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
    const data = readForm();
    $app.querySelectorAll('[data-yield]').forEach((c) => c.classList.toggle('on', num(c.dataset.yield) === data.yield));
    const c = ingredientDisplayCost(data);
    const box = $app.querySelector('#unit-cost');
    if (!c) {
      box.className = 'result-box empty-box';
      box.innerHTML = 'Remplissez le prix et la quantité : le coût au kilo, au litre ou à la pièce s’affichera ici.';
      return;
    }
    const raw = ingredientBaseCost({ ...data, yield: 100 }) * UNITS[c.unit].factor;
    const unitWord = { kg: '1 kilo', l: '1 litre', pc: '1 pièce' }[c.unit];
    box.className = 'result-box';
    box.innerHTML = `
      <span>${unitWord} utilisable vous coûte</span>
      <b>${money(c.value)} HT</b>
      <small>${data.yield < 100 ? `au lieu de ${money(raw)}, car ${fmt(100 - data.yield)} % du produit est perdu` : 'aucune perte prise en compte'}</small>`;
  };
  drawCost();
  form.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
    drawCost();
  });
  form.addEventListener('change', drawCost);
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-yield]');
    if (!b) return;
    form.yield.value = b.dataset.yield;
    drawCost();
  });

  const status = $app.querySelector('#off-status');
  const lookup = async (code) => {
    status.hidden = false;
    status.className = 'lookup loading';
    status.textContent = 'Recherche du produit…';
    const info = await lookupProduct(code);
    if (!info?.name) {
      status.className = 'lookup';
      status.textContent = 'Produit inconnu de la base Open Food Facts : tapez le nom vous-même.';
      return;
    }
    if (!form.name.value.trim()) form.name.value = info.name;
    if (info.qty && !form.qty.value.trim()) {
      form.qty.value = fmt(info.qty);
      form.unit.value = info.unit;
    }
    status.className = 'lookup found';
    status.innerHTML = `${icons.check} Trouvé ! Vérifiez le nom et la quantité, puis indiquez votre prix.`;
    drawCost();
  };
  if (isNew && ing.barcode) lookup(ing.barcode);

  $app.querySelector('[data-scan]').onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    const other = store.findByBarcode(code);
    if (other && other.id !== existing?.id) {
      toast(`Ce code-barres est déjà celui de « ${other.name} »`);
      return;
    }
    form.barcode.value = code;
    if (!form.name.value.trim() || !form.qty.value.trim()) lookup(code);
  };

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      e.target.blur();
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = readForm();
    const missing = [];
    if (!data.name) missing.push(['name', 'le nom']);
    if (!Number.isFinite(data.price) || data.price < 0) missing.push(['price', 'le prix payé']);
    if (!(data.qty > 0)) missing.push(['qty', 'la quantité reçue']);
    if (!(data.yield > 0 && data.yield <= 100)) missing.push(['yield', 'la partie utilisable (entre 1 et 100 %)']);
    if (missing.length) {
      missing.forEach(([n]) => form[n].classList.add('invalid'));
      form[missing[0][0]].focus();
      toast(`Il manque ${missing.map(([, l]) => l).join(', ')}`);
      return;
    }
    const other = data.barcode && store.findByBarcode(data.barcode);
    if (other && other.id !== existing?.id) {
      toast(`Ce code-barres est déjà celui de « ${other.name} »`);
      return;
    }
    // Si l'unité change de famille (kg -> pièce), les fiches qui l'utilisent deviennent incohérentes.
    if (existing && baseOf(existing.unit) !== baseOf(data.unit) && used.length) {
      const ok = await confirmSheet({
        title: 'Changer le type d’unité ?',
        text: `Passer de « ${LONG_UNIT[existing.unit]} » à « ${LONG_UNIT[data.unit]} » rendra les quantités incohérentes dans ${plural(used.length, 'fiche')}. Il faudra les corriger.`,
        ok: 'Changer quand même',
      });
      if (!ok) return;
    }
    const newId = store.upsertIngredient({ ...(existing ? { id: existing.id } : {}), ...data });
    if (addToRecipe) {
      addToRecipe.items.push(itemFromIngredient(store.getIngredient(newId)));
      store.save();
      history.replaceState(null, '', `#/fiche/${addToRecipe.id}`);
      transition(() => render(), true);
      setTimeout(() => {
        const input = $app.querySelector(`[data-qty="${addToRecipe.items.length - 1}"]`);
        input?.scrollIntoView({ block: 'center' });
        input?.focus();
      }, 300);
      toast('Produit ajouté : indiquez la quantité');
      return;
    }
    toast(existing ? 'Modifications enregistrées' : 'Produit enregistré');
    goBack();
  };

  $app.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: `Supprimer « ${existing.name} » ?`,
      text: used.length
        ? `Il sera aussi retiré de ${plural(used.length, 'fiche')} : ${used.map((r) => esc(r.name)).join(', ')}.`
        : 'Cette action est définitive.',
      ok: 'Supprimer',
      danger: true,
    });
    if (ok) {
      store.deleteIngredient(existing.id);
      go('#/produits', true);
      toast('Produit supprimé');
    }
  });

  if (isNew && !ing.barcode && !ing.name && !matchMedia('(pointer: coarse)').matches) form.name.focus();
}

// ---------- Calcul rapide ----------

const calcState = { cost: '', target: '', vat: '', sell: '' };

function viewCalculator() {
  setHeader('Calcul rapide', { help: 'ecran-calcul' });
  const s = db.settings;
  $app.innerHTML = `
    <p class="intro">Un calcul express, sans créer de fiche.</p>
    <section class="step">
      <h2 class="step-title"><span class="step-n">1</span>Le coût des ingrédients</h2>
      <div class="card">
        <label class="lbl" for="c-cost">Coût des ingrédients d’une portion (HT)</label>
        <div class="input-unit big"><input id="c-cost" name="cost" inputmode="decimal" placeholder="0,00" value="${esc(calcState.cost)}" /><span>€</span></div>
        <div class="field-grid">
          <div>
            <label class="lbl" for="c-target">Objectif ${helpBtn('objectif')}</label>
            <div class="input-unit"><input id="c-target" name="target" inputmode="decimal" placeholder="${fmt(s.targetFood)}" value="${esc(calcState.target)}" /><span>%</span></div>
          </div>
          <div>
            <label class="lbl" for="c-vat">TVA ${helpBtn('tva')}</label>
            <select id="c-vat" name="vat">${[5.5, 10, 20].map((v) => `<option value="${v}" ${String(calcState.vat || s.vatFood) === String(v) ? 'selected' : ''}>${fmt(v)} %</option>`).join('')}</select>
          </div>
        </div>
        <div id="calc-suggest"></div>
      </div>
    </section>
    <section class="step">
      <h2 class="step-title"><span class="step-n">2</span>Est-ce rentable ? <span class="opt">facultatif</span></h2>
      <div class="card">
        <label class="lbl" for="c-sell">Prix sur la carte (TTC)</label>
        <div class="input-unit big"><input id="c-sell" name="sell" inputmode="decimal" placeholder="0,00" value="${esc(calcState.sell)}" /><span>€</span></div>
        <div id="calc-result"></div>
      </div>
    </section>
    <section class="step">
      <h2 class="step-title">Les repères du métier</h2>
      <div class="card prose small">
        <p><b>Part des ingrédients</b> ${helpBtn('ratio')} : cuisine 25 à 35 %, cocktails 18 à 25 %, vins 30 à 40 %.</p>
        <p><b>Coefficient</b> ${helpBtn('coef')} : en cuisine, on multiplie souvent le coût par 3,5 à 4 pour obtenir le prix TTC.</p>
      </div>
    </section>`;
  const compute = () => {
    const target = Number.isFinite(num(calcState.target)) ? num(calcState.target) : s.targetFood;
    const p = pricing({
      cost: calcState.cost,
      target,
      vat: calcState.vat || s.vatFood,
      sellTTC: calcState.sell,
      roundStep: s.roundStep,
    });
    return { p, target };
  };
  const draw = () => {
    const { p, target } = compute();
    $app.querySelector('#calc-suggest').innerHTML = Number.isFinite(p.suggestedTTC)
      ? `<div class="suggest">
          <div><span>Prix conseillé ${helpBtn('prix-conseille')}</span><b>${money(p.roundedTTC)}</b>
          <small>soit ${money(p.suggestedHT)} HT (avant arrondi : ${money(p.suggestedTTC)})</small></div>
          <button class="btn small-btn" data-use>Tester</button>
        </div>`
      : '<p class="hint first">Tapez le coût pour voir le prix conseillé.</p>';
    const status = ratioStatus(p.ratio, target);
    $app.querySelector('#calc-result').innerHTML =
      Number.isFinite(p.ratio) && status !== 'none'
        ? `<div class="verdict ${status}"><div class="verdict-head">${pill(status)}<span class="verdict-ratio">${pct(p.ratio)}</span></div>
           <p>Les ingrédients font ${pct(p.ratio)} du prix HT (objectif ${pct(target)}).</p></div>
           ${breakdown(p, 0)}
           <div class="lines">
             <div class="line"><span>Marge brute ${helpBtn('marge')}</span><b>${money(p.margin)}</b></div>
             <div class="line"><span>Coefficient ${helpBtn('coef')}</span><b>${coef(p.coef)}</b></div>
           </div>`
        : '';
  };
  draw();
  const onInput = (e) => {
    if (e.target.name in calcState) calcState[e.target.name] = e.target.value;
    draw();
  };
  $app.addEventListener('input', onInput);
  $app.addEventListener('change', onInput);
  $app.addEventListener('click', (e) => {
    if (!e.target.closest('[data-use]')) return;
    calcState.sell = fmt(compute().p.roundedTTC);
    $app.querySelector('[name="sell"]').value = calcState.sell;
    draw();
  });
}

// ---------- Réglages ----------

function viewSettings() {
  setHeader('Réglages', { help: 'ecran-reglages' });
  const s = db.settings;
  const vatOptions = (cur) => [5.5, 10, 20].map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${fmt(v)} %</option>`).join('');
  $app.innerHTML = `
    <a class="guide-link" href="#/aide">
      <span class="kind">${icons.book}</span>
      <span><b>Guide d’utilisation</b><small>Comment ça marche, et le sens de chaque mot</small></span>
      <span class="chev">${icons.chevron}</span>
    </a>

    <section class="step">
      <h2 class="step-title">Mes objectifs ${helpBtn('objectif')}</h2>
      <p class="step-help">Part maximale du prix de vente HT consacrée aux ingrédients.</p>
      <div class="card">
        <div class="field-row"><span class="lbl inline">${icons.plate} Cuisine</span>
          <div class="input-unit small"><input name="targetFood" inputmode="decimal" value="${fmt(s.targetFood)}" aria-label="Objectif cuisine" /><span>%</span></div></div>
        <div class="field-row"><span class="lbl inline">${icons.glass} Bar</span>
          <div class="input-unit small"><input name="targetDrink" inputmode="decimal" value="${fmt(s.targetDrink)}" aria-label="Objectif bar" /><span>%</span></div></div>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title">TVA ${helpBtn('tva')}</h2>
      <div class="card">
        <div class="field-row"><span class="lbl inline">${icons.plate} Cuisine</span><select class="small" name="vatFood" aria-label="TVA cuisine">${vatOptions(s.vatFood)}</select></div>
        <div class="field-row"><span class="lbl inline">${icons.glass} Bar</span><select class="small" name="vatDrink" aria-label="TVA bar">${vatOptions(s.vatDrink)}</select></div>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title">Prix conseillé</h2>
      <div class="card">
        <div class="field-row"><span class="lbl inline">Arrondir au-dessus à</span>
          <select class="small" name="roundStep" aria-label="Arrondi">${[
            [0, 'Pas d’arrondi'],
            [0.1, '0,10 €'],
            [0.5, '0,50 €'],
            [1, '1 €'],
          ]
            .map(([v, l]) => `<option value="${v}" ${s.roundStep === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select></div>
        <p class="hint">Ex. avec 0,50 € : 11,23 € devient 11,50 €.</p>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title">Charges par portion <span class="opt">facultatif</span> ${helpBtn('charges')}</h2>
      <div class="card">
        <div class="field-row"><span class="lbl inline">Montant</span>
          <div class="input-unit small"><input name="overhead" inputmode="decimal" placeholder="0,00" value="${s.overhead ? fmt(s.overhead) : ''}" aria-label="Charges par portion" /><span>€</span></div></div>
        <p class="hint">Personnel, loyer, énergie… divisés par le nombre de couverts. Sert à calculer le prix de revient complet et la marge nette.</p>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title">Sauvegarde</h2>
      <div class="card">
        <p class="hint first">Vos données sont <b>uniquement sur ce téléphone</b>. Exportez une sauvegarde régulièrement (envoyez-la vous par mail ou sur un Drive). Elle sert aussi pour passer sur un autre téléphone.</p>
        <button class="btn primary block" data-export>${icons.download} Exporter une sauvegarde</button>
        <label class="btn block file-btn">${icons.upload} Restaurer une sauvegarde<input type="file" accept="application/json,.json" hidden /></label>
      </div>
    </section>

    <section class="step">
      <h2 class="step-title">Autres</h2>
      <div class="card">
        <button class="btn block" data-demo>${icons.sparkle} Ajouter les fiches d’exemple</button>
        <button class="btn danger block" data-reset>${icons.trash} Tout effacer</button>
      </div>
      <p class="fine">Le Ici · ${plural(db.ingredients.length, 'produit')} · ${plural(db.recipes.length, 'fiche')}</p>
    </section>`;

  const apply = (t) => {
    if (!(t.name in s)) return false;
    const v = num(t.value);
    if (t.name === 'overhead') s.overhead = Number.isFinite(v) && v > 0 ? v : 0;
    else if (Number.isFinite(v) && (v > 0 || t.name === 'roundStep')) s[t.name] = v;
    else return false;
    store.save();
    return true;
  };
  $app.addEventListener('input', (e) => apply(e.target));
  $app.addEventListener('change', (e) => {
    if (apply(e.target)) toast('Réglage enregistré');
  });

  $app.querySelector('[data-export]').onclick = exportData;
  $app.querySelector('input[type="file"]').onchange = importData;
  $app.querySelector('[data-demo]').onclick = () => {
    store.loadDemo();
    toast('Exemples ajoutés');
    go('#/fiches');
  };
  $app.querySelector('[data-reset]').onclick = async () => {
    const ok = await confirmSheet({
      title: 'Tout effacer ?',
      text: 'Tous les produits et toutes les fiches seront supprimés de ce téléphone. Exportez une sauvegarde avant si vous voulez les garder.',
      ok: 'Tout effacer',
      danger: true,
    });
    if (ok) {
      store.replaceAll({ settings: db.settings });
      toast('Données effacées');
      render();
    }
  };
}

async function exportData() {
  const date = new Date().toISOString().slice(0, 10);
  const name = `le-ici-sauvegarde-${date}.json`;
  const blob = new Blob([JSON.stringify({ app: 'renta', version: 1, exportedAt: date, ...db }, null, 2)], {
    type: 'application/json',
  });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Le Ici' });
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
  toast('Sauvegarde téléchargée');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.ingredients) || !Array.isArray(data.recipes)) throw new Error();
    const ok = await confirmSheet({
      title: 'Restaurer cette sauvegarde ?',
      text: `Elle contient ${plural(data.ingredients.length, 'produit')} et ${plural(data.recipes.length, 'fiche')}. Vos données actuelles seront remplacées.`,
      ok: 'Restaurer',
    });
    if (!ok) return;
    store.replaceAll(data);
    setOnboarded();
    toast('Sauvegarde restaurée');
    go('#/fiches');
  } catch {
    toast('Ce fichier n’est pas une sauvegarde valide');
  } finally {
    e.target.value = '';
  }
}

// ---------- Guide ----------

function viewGuide() {
  setHeader('Guide d’utilisation', { back: true });
  $app.innerHTML = `
    <div class="tiles-band" aria-hidden="true"></div>
    <section class="step">
      <h2 class="step-title">En 3 étapes</h2>
      <ol class="steps card">
        <li><span class="step-n">1</span><div><b>Produits</b><p>Enregistrez ce que vous achetez avec le prix de la facture (HT) et la quantité. Scannez le code-barres quand il y en a un.</p></div></li>
        <li><span class="step-n">2</span><div><b>Fiches</b><p>Pour chaque plat ou cocktail, ajoutez les produits et les quantités utilisées. Indiquez combien de portions ça donne.</p></div></li>
        <li><span class="step-n">3</span><div><b>Prix</b><p>L’appli calcule le coût d’une portion et propose un prix. Mettez votre prix de carte : la pastille devient verte si c’est rentable.</p></div></li>
      </ol>
    </section>
    <section class="step">
      <h2 class="step-title">Les couleurs</h2>
      <div class="card legend">
        <p>${pill('good')} les ingrédients restent sous votre objectif.</p>
        <p>${pill('warn')} jusqu’à 5 points au-dessus de l’objectif.</p>
        <p>${pill('bad')} plus de 5 points au-dessus : augmentez le prix ou revoyez la recette.</p>
        <p>${pill('none')} vous n’avez pas encore indiqué de prix de vente.</p>
      </div>
    </section>
    <section class="step">
      <h2 class="step-title">Quand un prix fournisseur change</h2>
      <div class="card prose small">
        <p>Allez dans <b>Produits</b> (ou scannez le produit), changez le prix et enregistrez. <b>Toutes les fiches sont recalculées.</b> Une flèche rouge ou verte montre l’évolution du prix.</p>
      </div>
    </section>
    <section class="step">
      <h2 class="step-title">Le vocabulaire</h2>
      <div class="glossary">
        ${GLOSSARY.map((k) => `<details class="card"><summary>${HELP[k].title}</summary><div class="prose">${HELP[k].body}</div></details>`).join('')}
      </div>
    </section>
    <button class="btn block" data-welcome>Revoir l’écran d’accueil</button>`;
  $app.querySelector('[data-welcome]').onclick = () => go('#/bienvenue');
}

// ---------- Démarrage ----------

// Liens internes : navigation gérée par l'appli (les onglets ne s'empilent pas dans l'historique).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || a.id === 'tab-scan') return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (a.closest('.tabbar')) {
    if (location.hash === href) return window.scrollTo({ top: 0, behavior: 'smooth' });
    depth = 0;
    go(href, true);
  } else go(href);
});

document.getElementById('tab-scan').onclick = (e) => {
  e.preventDefault();
  scanFromTab();
};

navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
if (!location.hash || location.hash === '#/') history.replaceState(null, '', '#/fiches');
render();
