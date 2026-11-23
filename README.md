# Quizz : entraînement de culture générale

Site statique (HTML/CSS/JavaScript, sans serveur ni IA) publié sur GitHub Pages.
Chaque thème est une **liste** : un tableau avec des colonnes typées (texte, nombre, date, image, son).
Avant de s'entraîner, on choisit les colonnes **montrées** et celles **à trouver**.

Fonctions :

- Choix multiple, saisie libre (accents, majuscules, articles et petites fautes tolérés ; « Louis 14 » = « Louis XIV »), remise dans l'ordre (dates ou nombres).
- Après chaque réponse, la fiche complète s'affiche.
- Filtres par étiquettes et par colonnes à peu de valeurs (famille, dynastie…).
- Combinaisons de réglages enregistrées sur la page d'accueil.
- Révision espacée des erreurs (tout de suite, puis 1, 3, 7, 16 jours).
- Historique des scores.
- Éditeur de listes dans le site : « Enregistrer sur le site » envoie la liste (et ses images) dans le dépôt en un seul commit ; elle apparaît sur tous les appareils après la publication automatique (~1 min). Chaque appareil se connecte une fois avec une clé GitHub « fine-grained » (Contents : Read and write sur ce dépôt), ou via le « lien pour connecter un autre appareil ». Export `.zip`/`.json` possible aussi.

La progression (scores, révisions, brouillons) est stockée dans le navigateur (`localStorage`).

## Ajouter une liste

Créer un fichier `lists/<identifiant>.json`. L'identifiant (nom du fichier) sert dans l'adresse et pour la progression : ne pas le changer ensuite.
L'index `lists/index.json` est généré automatiquement au déploiement (ne pas l'écrire à la main).

```json
{
  "title": "Oiseaux d'Europe",
  "description": "Texte court affiché sous le titre.",
  "columns": [
    { "key": "nom", "label": "Nom", "type": "text" },
    { "key": "photo", "label": "Photo", "type": "image" },
    { "key": "envergure", "label": "Envergure", "type": "number", "unit": "cm", "tolerance": "15%" },
    { "key": "decouverte", "label": "Découverte", "type": "date", "tolerance": 2 },
    { "key": "chant", "label": "Chant", "type": "audio" }
  ],
  "rows": [
    {
      "id": "merle-noir",
      "nom": ["Merle noir", "Merle"],
      "photo": { "wikipedia": ["Merle noir", "en:Turdus merula"] },
      "envergure": 36,
      "tags": ["jardin", "commun"]
    }
  ]
}
```

### Colonnes

| Champ | Rôle |
|---|---|
| `key` | Nom technique, unique, sans espace. Ne pas le changer une fois la liste utilisée. |
| `label` | Nom affiché. |
| `type` | `text`, `number`, `date`, `image` ou `audio`. |
| `unit` | (nombre) unité affichée, ex. `"cm"`. |
| `tolerance` | (nombre) écart accepté en saisie libre : absolu (`2`) ou relatif (`"10%"`). (date) écart en années. |
| `filter` | `false` pour ne jamais proposer la colonne comme filtre, `true` pour la forcer. Par défaut, les colonnes texte avec peu de valeurs différentes deviennent des filtres. |

### Valeurs des cellules

- **Texte** : une chaîne, ou un tableau de réponses acceptées (la première est affichée).
- **Nombre** : un nombre JSON (`36`, `1.5`).
- **Date** : `"1515"`, `"1515-09"`, `"1515-09-13"` ; avant J.-C. : `"-52"`. En saisie libre, seule l'année est notée.
- **Image / son** :
  - un chemin relatif au dossier `lists/` : `"img/oiseaux/merle.jpg"` ;
  - une adresse web complète ;
  - un objet avec crédit : `{ "src": "img/…", "credit": "Auteur", "license": "CC BY-SA 4.0", "source": "https://…" }` ;
  - **récupération automatique** : `{ "wikipedia": "Merle noir" }` (article français ; `"en:…"` pour une autre langue ; un tableau pour essayer plusieurs titres) ou `{ "commons": "Nom du fichier.jpg" }`. Au déploiement, l'image libre de l'article est téléchargée dans `lists/img/<liste>/`, puis le JSON est complété avec `src`, l'auteur, la licence et la source, et enregistré dans le dépôt.
- `id` (facultatif mais conseillé) : identifiant stable de la fiche, utilisé pour la révision.
- `tags` (facultatif) : étiquettes servant de filtres.

## Développement local

```sh
node scripts/fetch-images.mjs   # facultatif : récupère les images Wikipédia
node scripts/build-index.mjs    # génère lists/index.json
python3 -m http.server          # puis ouvrir http://localhost:8000
```

## Déploiement

Le workflow `.github/workflows/pages.yml` s'exécute à chaque push sur la branche par défaut :
il récupère les images manquantes, les enregistre dans le dépôt, génère l'index et publie le site.
Il faut une seule fois activer Pages : **Settings → Pages → Source : GitHub Actions**.

## Crédits

Les photos d'oiseaux proviennent de Wikimedia Commons, sous licences libres ; l'auteur, la licence et un lien vers la source sont affichés sous chaque photo.
