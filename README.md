# Renta — rentabilité cuisine & bar

Application pour téléphone qui calcule le **coût matière**, le **prix de revient** et le **prix de vente conseillé** de vos plats et cocktails.

## Ce que fait l'appli

- **Produits** : vos matières premières avec leur prix d'achat HT et leur conditionnement (ex. 21 € la bouteille de 70 cl, 9 € le sac de 10 kg).
  - **Rendement** : la part réellement utilisable (épluchage, parage, jus d'un citron…) est prise en compte dans le coût.
  - **Code-barres** : scannez un produit avec la caméra. S'il est connu, vous mettez juste son prix à jour ; sinon le nom et la contenance sont pré-remplis via [Open Food Facts](https://world.openfoodfacts.org).
  - Historique des prix : la hausse ou la baisse depuis le dernier prix est affichée.
- **Fiches techniques** : ingrédients + quantités + nombre de portions.
  - Coût total et **coût par portion**, mis à jour automatiquement quand un prix d'achat change.
  - **Préparations maison** : une fiche (sauce, fond, sirop…) peut servir d'ingrédient dans une autre.
  - **Prix conseillé TTC** selon votre ratio matière visé (30 % cuisine, 22 % bar par défaut) et la TVA (10 % / 20 %).
  - Avec votre prix de vente : **ratio matière**, **marge brute**, **coefficient**, et un code couleur vert / orange / rouge.
- **Calcul rapide** : prix conseillé à partir d'un coût, sans créer de fiche.
- **Réglages** : objectifs, TVA, arrondi des prix, charges par portion (pour le prix de revient complet et la marge nette), sauvegarde / restauration.

Les données restent **sur le téléphone** (aucun compte, aucun serveur). Pensez à exporter une sauvegarde de temps en temps depuis *Réglages*.

## Les formules

| | |
|---|---|
| Coût d'un produit | prix d'achat HT ÷ quantité ÷ rendement |
| Prix conseillé HT | coût matière ÷ ratio visé |
| Prix conseillé TTC | prix HT × (1 + TVA) |
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
- `js/store.js` — stockage local et données d'exemple
- `js/scanner.js` — scan (BarcodeDetector natif, ou ZXing dans `vendor/` sur iPhone) et Open Food Facts
- `js/app.js` — écrans
- `sw.js` — fonctionnement hors ligne
