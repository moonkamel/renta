// Explications en langage simple, ouvertes par les boutons « ? ».

export const HELP = {
  // ---- Les écrans ----
  'ecran-fiches': {
    title: 'Les fiches, c’est quoi ?',
    body: `<p>Une <b>fiche</b> (ou fiche technique), c’est une recette : un plat, un cocktail, une sauce…</p>
      <p>Vous y mettez les ingrédients et leurs quantités. L’appli calcule alors :</p>
      <ul><li>combien coûte une portion,</li><li>à quel prix la vendre,</li><li>si votre prix actuel est rentable.</li></ul>
      <p>La pastille de couleur à droite vous dit d’un coup d’œil si le plat est <span class="pill good">Rentable</span>, <span class="pill warn">Limite</span> ou <span class="pill bad">À revoir</span>.</p>`,
  },
  'ecran-produits': {
    title: 'Les produits, c’est quoi ?',
    body: `<p>Ce sont vos <b>matières premières</b> : ce que vous achetez chez vos fournisseurs (beurre, bœuf, rhum, citrons…).</p>
      <p>Pour chacun, vous indiquez le <b>prix payé</b> et la <b>quantité achetée</b>. L’appli en déduit le prix au kilo, au litre ou à la pièce.</p>
      <p>Quand un prix change chez le fournisseur, mettez-le à jour ici : <b>toutes les fiches qui l’utilisent sont recalculées automatiquement</b>.</p>
      <p>Astuce : scannez le code-barres pour retrouver un produit en une seconde.</p>`,
  },
  'ecran-calcul': {
    title: 'Le calcul rapide',
    body: `<p>Pour un calcul express sans créer de fiche : vous connaissez déjà le coût des ingrédients d’une portion et vous voulez savoir à combien la vendre.</p>
      <p>Si vous ajoutez votre prix de vente actuel, l’appli vous dit s’il est rentable.</p>`,
  },
  'ecran-reglages': {
    title: 'Les réglages',
    body: `<p>Ici vous choisissez vos <b>objectifs</b> : quelle part du prix de vente les ingrédients doivent représenter au maximum. Ces valeurs servent pour toutes les fiches (sauf si vous les changez dans une fiche).</p>
      <p>Pensez aussi à <b>sauvegarder</b> vos données : elles sont uniquement sur ce téléphone.</p>`,
  },
  'ecran-produit': {
    title: 'Remplir un produit',
    body: `<p>Recopiez simplement votre facture ou l’étiquette :</p>
      <ul><li><b>Prix</b> : ce que vous avez payé, hors taxes (HT).</li>
      <li><b>Quantité</b> : ce que vous avez reçu pour ce prix (1 kg, 70 cl, 12 pièces…).</li></ul>
      <p>Exemple : un bidon d’huile de 20 L à 32 € HT → prix <b>32</b>, quantité <b>20 L</b>. L’appli calcule 1,60 € le litre.</p>`,
  },
  'ecran-fiche': {
    title: 'Remplir une fiche',
    body: `<ol><li><b>La recette</b> : donnez un nom et dites combien de portions elle donne.</li>
      <li><b>Les ingrédients</b> : ajoutez chaque produit avec la quantité utilisée pour <u>toute</u> la recette.</li>
      <li><b>Le prix</b> : l’appli vous propose un prix. Mettez le vôtre (celui de la carte).</li>
      <li><b>Le résultat</b> : vous voyez ce qu’il vous reste une fois les ingrédients payés.</li></ol>
      <p>Tout est enregistré automatiquement, pas besoin de bouton « Enregistrer ».</p>`,
  },

  // ---- Le vocabulaire ----
  ht: {
    title: 'HT et TTC',
    body: `<p><b>TTC</b> (toutes taxes comprises) : le prix payé par le client, celui de la carte.</p>
      <p><b>HT</b> (hors taxes) : ce prix sans la TVA. C’est ce qui revient vraiment au restaurant, car la TVA est reversée à l’État.</p>
      <p>Exemple avec 10 % de TVA : un plat à <b>11 € TTC</b> rapporte <b>10 € HT</b>.</p>
      <p>Vos prix d’achat fournisseurs se notent en <b>HT</b> (c’est ce qui figure sur la facture pro).</p>`,
  },
  tva: {
    title: 'Quelle TVA choisir ?',
    body: `<ul><li><b>10 %</b> : plats et boissons sans alcool servis sur place, vente à emporter de plats préparés.</li>
      <li><b>20 %</b> : boissons alcoolisées (bière, vin, cocktails).</li>
      <li><b>5,5 %</b> : certains produits à emporter non consommés immédiatement (ex. boissons sans alcool en bouteille fermée).</li></ul>
      <p>En cas de doute, demandez à votre comptable.</p>`,
  },
  ratio: {
    title: 'Part des ingrédients (ratio matière)',
    body: `<p>C’est la part du prix de vente HT qui sert à payer les ingrédients. Les pros l’appellent <b>ratio matière</b> ou <b>food cost</b>.</p>
      <p>Exemple : un plat vendu <b>10 € HT</b> dont les ingrédients coûtent <b>3 €</b> → ratio de <b>30 %</b>.</p>
      <p><b>Plus il est bas, plus vous gagnez.</b> Repères courants :</p>
      <ul><li>Cuisine : 25 à 35 %</li><li>Cocktails : 18 à 25 %</li><li>Vins : 30 à 40 %</li></ul>`,
  },
  objectif: {
    title: 'Objectif (ratio visé)',
    body: `<p>C’est la part maximale du prix que vous acceptez de consacrer aux ingrédients.</p>
      <p>Avec un objectif de <b>30 %</b>, un plat qui coûte 3 € d’ingrédients doit être vendu au moins <b>10 € HT</b> (soit 11 € TTC avec 10 % de TVA).</p>
      <p>Baissez l’objectif si vos charges (personnel, loyer) sont élevées.</p>`,
  },
  'prix-conseille': {
    title: 'Le prix conseillé',
    body: `<p>C’est le prix de vente minimum pour respecter votre objectif.</p>
      <p>Calcul : coût des ingrédients ÷ objectif, puis on ajoute la TVA, et on arrondit (réglable dans Réglages).</p>
      <p>Exemple : 3 € d’ingrédients, objectif 30 % → 10 € HT → <b>11 € TTC</b>.</p>
      <p>C’est un repère : vous pouvez vendre plus cher si votre clientèle l’accepte.</p>`,
  },
  marge: {
    title: 'Marge brute',
    body: `<p>Ce qu’il reste sur le prix HT une fois les ingrédients payés.</p>
      <p>Exemple : plat vendu 10 € HT, 3 € d’ingrédients → <b>7 € de marge brute</b>.</p>
      <p>Cette marge doit payer le personnel, le loyer, l’énergie… et ce qui reste est votre bénéfice.</p>`,
  },
  coef: {
    title: 'Coefficient multiplicateur',
    body: `<p>Combien de fois le prix de vente TTC est plus grand que le coût des ingrédients.</p>
      <p>Exemple : 3 € d’ingrédients, vendu 12 € TTC → coefficient <b>× 4</b>.</p>
      <p>Repère : en cuisine on vise souvent × 3,5 à × 4 ; au bar × 4 à × 6.</p>`,
  },
  rendement: {
    title: 'Partie utilisable (rendement)',
    body: `<p>Beaucoup de produits ont des pertes : épluchures, os, parage, jus des agrumes, fond de bouteille…</p>
      <p>Indiquez le pourcentage qu’on utilise vraiment :</p>
      <ul><li>100 % : rien n’est perdu (sucre, farine, sirop)</li><li>~ 80 % : carottes, pommes de terre épluchées</li><li>~ 45 % : jus de citron</li><li>~ 97 % : bouteille d’alcool (égouttures)</li></ul>
      <p>Le coût est corrigé : si vous payez 2 €/kg mais n’utilisez que 80 %, le kilo utile vous coûte en réalité <b>2,50 €</b>.</p>`,
  },
  portions: {
    title: 'Nombre de portions',
    body: `<p>Combien de portions (assiettes, verres) cette recette produit.</p>
      <ul><li>Un burger : <b>1</b> portion, les quantités sont celles d’un burger.</li>
      <li>Une sauce faite en grande quantité : par exemple <b>20</b> portions, et vous notez les quantités de toute la casserole.</li></ul>
      <p>L’appli divise le coût total par ce nombre.</p>`,
  },
  preparation: {
    title: 'Les préparations maison',
    body: `<p>Une fiche peut servir d’ingrédient dans une autre : une sauce, un fond, un sirop maison, une portion de frites…</p>
      <p>Créez d’abord la fiche de la préparation (ex. « Sauce burger », 20 portions), puis ajoutez-la dans votre plat avec le nombre de portions utilisées.</p>
      <p>Si le prix d’un ingrédient de la sauce change, le plat est recalculé aussi.</p>`,
  },
  charges: {
    title: 'Charges par portion et prix de revient',
    body: `<p>Le <b>prix de revient</b>, c’est ce que vous coûte vraiment une portion : les ingrédients <b>plus</b> une part du personnel, du loyer, de l’énergie…</p>
      <p>Pour l’estimer : additionnez vos charges du mois (hors ingrédients) et divisez par le nombre de couverts du mois.</p>
      <p>Exemple : 18 000 € de charges pour 3 000 couverts → <b>6 € par portion</b>.</p>
      <p>Si vous remplissez ce champ, l’appli affiche aussi la <b>marge nette</b> (ce qu’il reste vraiment).</p>`,
  },
  'code-barres': {
    title: 'Le code-barres',
    body: `<p>Scannez le code-barres de l’emballage avec l’appareil photo du téléphone.</p>
      <ul><li>Si le produit est déjà enregistré, l’appli l’ouvre directement : idéal pour mettre à jour un prix.</li>
      <li>Sinon, l’appli cherche le nom et la contenance dans la base gratuite Open Food Facts. Il ne reste qu’à mettre le prix.</li></ul>
      <p>Les produits frais sans code-barres (légumes, viande à la coupe) se saisissent à la main.</p>`,
  },
};

// Ordre du lexique sur la page d'aide.
export const GLOSSARY = ['ht', 'tva', 'ratio', 'objectif', 'prix-conseille', 'marge', 'coef', 'rendement', 'portions', 'preparation', 'charges', 'code-barres'];
