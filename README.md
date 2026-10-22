# Le Ici — rentabilité cuisine & bar

Application pour téléphone, aux couleurs du Ici (store rouge, moutarde, bois et carreaux de ciment), qui calcule le **coût matière**, le **prix de revient** et la **rentabilité** de vos plats et cocktails, au prix que vous fixez.

## Ce que fait l'appli

- **Produits** : vos matières premières avec leur prix d'achat HT et leur conditionnement (ex. 21 € la bouteille de 70 cl, 9 € le sac de 10 kg).
  - **Rendement** : la part réellement utilisable (épluchage, parage, jus d'un citron…) est prise en compte dans le coût.
  - **Code-barres** : scannez un produit avec la caméra. S'il est connu, vous mettez juste son prix à jour ; sinon le nom et la contenance sont pré-remplis via [Open Food Facts](https://world.openfoodfacts.org).
  - Historique des prix : la hausse ou la baisse depuis le dernier prix est affichée.
- **Fiches techniques** : ingrédients + quantités + nombre de portions.
  - Coût total et **coût par portion**, mis à jour automatiquement quand un prix d'achat change.
  - **Préparations maison** : une fiche (sauce, fond, sirop…) peut servir d'ingrédient dans une autre.
  - **Votre prix de vente** : c'est le restaurateur qui le fixe. L'appli le juge selon le ratio matière visé (30 % cuisine, 22 % bar par défaut) et la TVA (10 % / 20 %).
  - Avec votre prix de vente : **ratio matière**, **marge brute**, **coefficient**, et un code couleur vert / orange / rouge.
- **Pensée pour les débutants** : écran d'accueil qui explique le fonctionnement, étapes numérotées sur chaque écran, boutons « ? » qui expliquent chaque mot (HT/TTC, ratio matière, marge, coefficient, rendement…) et un guide complet dans *Réglages*.
- **Ventes** : pour chaque période (un mois, une semaine), on saisit combien de fois chaque fiche s'est vendue. L'appli affiche la marge brute réellement gagnée, la part des ingrédients réelle (pondérée par les ventes), ce que chaque fiche rapporte au total, et classe la carte en 4 familles : Star, Locomotive, Pépite, Poids mort. Une carte explique pourquoi le ratio seul ne suffit pas (un cocktail à 18 % vendu 3 fois rapporte bien moins qu'un plat à 32 % vendu 300 fois).
- **Calcul rapide** : un coût et un prix de carte donnent le verdict, sans créer de fiche.
- **Réglages** : objectifs, TVA, charges par portion (pour le prix de revient complet et la marge nette), sauvegarde / restauration.

**Partage avec l'équipe** : les données sont stockées dans une base en ligne (Supabase, projet `le-ici`) et synchronisées sur tous les téléphones, sans compte ni mot de passe. Les changements arrivent sur les autres téléphones en quelques secondes. Hors connexion, l'appli continue de marcher et envoie les modifications au retour du réseau. Chaque version est archivée dans la table `items_history`. L'appli peut lire, ajouter et modifier, mais pas supprimer définitivement : une suppression est enregistrée comme `deleted = true`. Sans réseau ni configuration (`js/config.js` vide), l'appli fonctionne seule sur le téléphone.

## Les formules

| | |
|---|---|
| Coût d'un produit | prix d'achat HT ÷ quantité ÷ rendement |
| Prix de vente HT | prix TTC ÷ (1 + TVA) |
| Ratio matière | coût matière ÷ prix de vente HT |
| Marge brute | prix de vente HT − coût matière |
| Coefficient | prix de vente TTC ÷ coût matière |

## Mettre l'appli en ligne (une seule fois)

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Relancez le workflow *Publier sur GitHub Pages* (onglet **Actions**) ou poussez un commit.
3. L'adresse s'affiche dans le workflow (du type `https://<compte>.github.io/renta/`).

## Installer sur le téléphone

Ouvrez l'adresse sur le téléphone, puis :

- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
- **Android (Chrome)** : menu ⋮ → *Installer l'application* / *Ajouter à l'écran d'accueil*.

L'appli s'ouvre alors en plein écran et fonctionne même sans réseau (le scan reste possible ; seule la recherche Open Food Facts a besoin d'internet).

> La caméra ne fonctionne qu'en HTTPS (c'est le cas avec GitHub Pages).

## Développement

Aucune compilation : HTML, CSS et JavaScript simples.

```bash
npm start   # serveur local sur http://localhost:3000
npm test    # tests du moteur de calcul
```

- `js/calc.js` — calculs (unités, coûts, prix), testés dans `test/`
- `js/store.js` — stockage local
- `js/sync.js` — synchronisation avec la base partagée (`js/config.js` : adresse et clé publique)
- `js/scanner.js` — scan (BarcodeDetector natif, ou ZXing dans `vendor/` sur iPhone) et Open Food Facts
- `js/app.js` — écrans
- `js/help.js` — textes d'aide et lexique
- `js/icons.js` — icônes
- `fonts/` — police DM Serif Display (licence OFL)
- `sw.js` — fonctionnement hors ligne
