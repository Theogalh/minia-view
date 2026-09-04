# Thumbnail Lab

Extension MV3 (Chrome + Firefox) qui remplace une partie des miniatures et titres
de l'interface YouTube par les tiens, pour juger un visuel en conditions reelles :
dans la grille d'accueil, la recherche, et la colonne "up next".

## Installation

**Chrome / Edge / Brave**
1. `chrome://extensions`
2. Activer "Mode developpeur"
3. "Charger l'extension non empaquetee" → selectionner ce dossier
4. Recharger l'onglet YouTube apres chaque modification du code

**Firefox**
1. `about:debugging#/runtime/this-firefox`
2. "Charger un module temporaire" → selectionner `manifest.json`
3. Le chargement temporaire disparait a la fermeture du navigateur

Chrome affiche un avertissement sur la cle `browser_specific_settings` (specifique
a Gecko) et charge quand meme. Firefox l'exige pour un ID stable.

## Structure

```
manifest.json      declaration : permissions, ou s'injecte le content script
content.js         tourne dans la page YouTube, fait la substitution DOM
popup/popup.html   UI du bouton de barre d'outils
popup/popup.js     gestion du pool, redimensionnement canvas, storage
popup/theogalh.css copie du design system theogalh.dev
```

Pas de service worker : rien a faire en tache de fond, le popup ecrit dans
`storage.local` et le content script ecoute `storage.onChanged`.

## Fonctionnement

- Le choix "cette video est-elle remplacee, et par quoi" est un hash FNV-1a du
  `videoId`, pas un `Math.random()`. Une video garde donc la meme fausse miniature
  d'un re-render a l'autre — sinon la grille clignote en permanence.
- Le taux (10 / 30 / 60 / 100 %) compare `hash % 100` au seuil.
- Le titre est global : un seul champ dans le popup, applique a toutes les cards
  injectees, modifiable a chaud (comme le liseré). Vide = titres d'origine
  conserves. Sans image dans le pool, un titre seul remplace quand meme les titres.
- Les originaux sont conserves dans des `data-tl-*` sur les noeuds touches et
  remis en place quand on desactive. En cas de doute, recharger l'onglet.
- Les images sont recadrees en 640x360 JPEG avant stockage (`storage.local` est
  plafonne autour de 10 Mo).

## Depannage

| Symptome | Cause probable |
|---|---|
| Rien ne change | Onglet ouvert avant l'installation → recharger |
| Les miniatures reviennent a l'original | Un selecteur YouTube a change ; comparer `CARD_SEL` / `IMG_SEL` avec le DOM reel |
| Image vide, erreur CSP `img-src` en console | YouTube refuse les `data:` sur cette page ; voir la note du README plus bas |
| Le titre revient mais pas l'image (ou l'inverse) | Le selecteur de titre couvre mal ce layout ; ajouter le cas dans `TITLE_SEL` |
| Le popup se ferme quand le selecteur de fichiers s'ouvre | Comportement navigateur (perte de focus, systematique sur Firefox) ; utiliser le drag & drop, ou le bouton "↗ Tab" qui ouvre la meme UI dans un onglet |

Si les `data:` sont bloquees par la CSP de la page, la parade est de servir les
images depuis l'extension : les ecrire dans `web_accessible_resources` et utiliser
`chrome.runtime.getURL(...)`, qui est exempte de la CSP de la page. Cela suppose
de packager les images plutot que de les uploader depuis le popup.

## Limites assumees

- Les Shorts et le lecteur video ne sont pas traites, seulement les cards.
- Le remplacement est local et cosmetique : rien n'est envoye nulle part, rien
  n'est modifie chez YouTube.
