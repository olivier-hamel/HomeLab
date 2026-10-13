# Tempo

Tempo est le calendrier de HomeLab, entièrement en français. Son nom évoque le
rythme des journées et accompagne Mémo. L’accueil sert de point de départ :
recherche Web, tâches du jour, agenda et événements des 14 prochains jours,
avec des vues par mois, semaine et jour. Les événements
sont enregistrés dans MongoDB pour chaque compte HomeLab. Tu peux les créer
en langage naturel avec Gemini, vérifier les détails avant l’ajout, puis
les modifier ou les supprimer. Aucun événement de démonstration n’est inclus.

## Lancer en local

Node.js 24 est recommandé. PDF.js est servi localement pour afficher les aperçus.

```sh
npm ci --omit=optional --ignore-scripts
npm run dev
```

Lance HomeLab et le service de comptes Mémo comme décrit dans le guide des
[comptes partagés](../../docs/accounts.md), puis ouvre Tempo depuis HomeLab.
Le serveur statique écoute sur `http://localhost:4173` ; l’interface utilise
l’API de compte partagée et le backend HomeLab sur le port 3001. `PORT=3000 npm run dev` permet de choisir un autre port.

`npm test` vérifie les calculs de dates, la navigation, les événements et les préférences.
`npm run check` vérifie la syntaxe des modules.

## Serveur

Tempo est la section ouverte par défaut après la connexion à HomeLab.
HomeLab sert l’application à `/calendar/` via le service Docker `calendar`.
Les chemins et identifiants techniques restent les mêmes pour conserver les
liens existants et la configuration du serveur. Les préférences déjà enregistrées
restent disponibles pour chaque compte.

Consulte [SERVER-UPDATE.md](../../SERVER-UPDATE.md) pour la procédure commune
commit → push → pull → mise à jour.

## Structure

- `dist/index.html` : point d’entrée, langue et métadonnées.
- `dist/js/date.js` : calculs de dates indépendants des changements d’heure et formatage français canadien.
- `dist/js/state.js` : date sélectionnée, vues, navigation et préférences locales.
- `dist/js/events.js` : contrat des événements, accès API et disposition des horaires qui se chevauchent.
- `dist/js/event-controller.js` : création assistée, aperçu, saisie manuelle, modification et suppression.
- `dist/js/components/event-dialog.js` : fenêtre accessible et adaptative de gestion des événements.
- `dist/js/documents.js` et `document-controller.js` : imports multiples, bibliothèque, analyse et revue des événements.
- `dist/js/components/documents.js` : bibliothèque, panneau de détails et fenêtres de revue/suppression.
- `dist/js/pdf-preview.js` : aperçu de première page avec PDF.js, sans service externe.
- `scripts/prepare-pdf.mjs` : préparation des ressources PDF.js, exécutée par le serveur de développement et le build Docker.
- `dist/js/account.js` : compte HomeLab et protection des textes affichés.
- `dist/js/components/` : menu, vues du calendrier, fenêtres et icônes.
- `dist/js/components/home.js` : recherche Web, tâches, agenda et prochains événements.
- `dist/js/components/shell.js` : interface commune et fil d’Ariane.
- `dist/js/app.js` : assemblage des vues, interactions et raccourcis clavier.
- `dist/styles/` : thème, styles des composants et mises en page adaptatives.
- `scripts/serve.mjs` : serveur statique sans dépendances.
- `tests/` : vérifications des dates, de la navigation, du fuseau horaire et des préférences.

`dist/` contient directement les sources de l’application : aucune compilation
n’est nécessaire. Les modules JavaScript natifs séparent les composants.
`dist/vendor/` contient les ressources PDF.js générées, exclues de Git.
Les données passent par `/api/calendar/*` dans le backend HomeLab. La connexion
MongoDB commune se trouve dans `backend/src/lib/database.ts`, la configuration
Gemini dans `backend/src/lib/ai/gemini.ts` et le dépôt des événements dans
`backend/src/lib/calendar/`. Les préférences et les tâches restent dans le navigateur.

## Accueil et recherche

La recherche centrale propose Google ou DuckDuckGo. Le moteur choisi est
enregistré sur cet appareil, séparément pour chaque compte; les préférences
permettent aussi de le changer. Entrée lance la recherche dans l’onglet courant,
y compris lorsque Tempo est intégré à HomeLab. Le raccourci `/` ramène à
l’accueil et place le curseur dans la recherche. Sur ordinateur, la recherche
reçoit le focus à l’ouverture. Sur mobile, le clavier reste fermé au chargement.

« À faire » permet d’ajouter, cocher et supprimer les tâches. Elles sont
enregistrées dans le navigateur pour chaque compte, sans synchronisation entre
appareils. Les onglets Tempo du même navigateur se mettent à jour entre eux.
Les tâches inachevées restent visibles le lendemain; les tâches
terminées restent affichées le jour où elles ont été cochées. Si le navigateur
refuse l’enregistrement, la liste fonctionne pour la session et l’indique.

L’agenda met en évidence le rendez-vous en cours ou le prochain rendez-vous.
L’aperçu « À venir » présente les trois premiers événements des 14 prochains
jours, avec le nombre total et un accès au calendrier. Il inclut les répétitions
et les événements qui se poursuivent, même si la semaine courante se termine.
La bande de dates ouvre les sept prochaines journées. Les textes saisis et
la position du curseur restent intacts lors des rafraîchissements de l’accueil.

`node scripts/test-calendar-home-ui.mjs`, depuis la racine, vérifie la recherche,
les tâches, les préférences, les dates, la navigation depuis une iframe et le
rendu à six tailles d’écran, avec des API simulées. Les captures sont dans
`artifacts/calendar-home/`.

## Navigation

L’accueil affiche toujours la journée actuelle à Toronto et les jours à venir,
même après avoir consulté d’autres dates. La flèche de la carte « Aujourd’hui »
ouvre l’horaire du jour, les dates de l’aperçu ouvrent chaque journée et
la flèche de la carte « À venir » ouvre la vue semaine. « Voir le calendrier »
et le raccourci « Calendrier » ouvrent la vue mois.

Clique sur une date du mois ou du mini calendrier pour ouvrir sa semaine,
puis sur un jour pour voir son horaire. Le fil d’Ariane permet de revenir à
la semaine, au mois ou à l’accueil. Les commandes précédent, suivant,
aujourd’hui et « Aller à une date » fonctionnent dans les vues du calendrier.

Utilise « Nouvel événement » ou `N` pour créer un événement. Dans la vue mois,
le bouton + d’une date prépare cette date; dans la vue jour, cliquer une heure
préremplit son horaire. Clique sur un événement pour modifier ses détails.
La suppression demande une confirmation; fermer un brouillon modifié protège
les détails non enregistrés. Les événements sur plusieurs jours et toute
la journée sont pris en charge. Le champ « Répétition » permet de répéter un
événement chaque jour, semaine, mois ou année, avec un intervalle de 1 à 99.
Par exemple, choisis « Chaque semaine », un intervalle de 2 et dimanche pour
un souper un dimanche sur deux. Tu peux sélectionner plusieurs jours de la
semaine et terminer la série à une date (incluse) ou après 1 à 1 000 occurrences.
Sans fin, les occurrences continuent lors de la navigation vers les dates futures.

Une série est enregistrée comme un seul événement. Cliquer sur une occurrence
ouvre les détails de la première occurrence ; la modification ou la suppression
s’applique à toute la série, comme indiqué dans la fenêtre. Les heures restent
locales à Toronto, y compris lors des changements d’heure. Les semaines de
répétition commencent le lundi, quelle que soit la préférence d’affichage.
Pour les répétitions mensuelles, les mois sans le jour choisi sont sautés
(ex. le 31) ; le 29 février annuel se répète seulement les années bissextiles.

Les raccourcis existants sont conservés : `H` pour l’accueil, `M` pour le mois,
`W` pour la semaine, `D` pour le jour, `T` pour aujourd’hui, `G` pour choisir
une date et `?` pour l’aide. Les flèches changent de période ou de date lorsqu’une
date du mois a le focus. Entrée ouvre la semaine de cette date.

Les préférences proposent un début de semaine le lundi ou le dimanche et un
affichage sur 12 ou 24 heures. Les dates suivent le format `fr-CA` et le fuseau
`America/Toronto`. Les préférences restent séparées par compte et sont
enregistrées dans le navigateur.

## MongoDB et Gemini

Renseigne `MONGODB_URI` et `GEMINI_API_KEY` dans `backend/.env` (voir
[le modèle](../../backend/.env.example)). La clé reste exclusivement sur le serveur.
`MONGODB_DATABASE` vaut `homelab` par défaut; `MONGODB_USERNAME` et
`MONGODB_PASSWORD` remplacent les marqueurs dans une URI si nécessaire.
`GEMINI_MODEL` permet de choisir le modèle commun aux fonctionnalités AI
du backend; une valeur vide conserve le modèle existant. Mémo, qui tourne dans
un service Python distinct, conserve sa configuration `MEMO_*`.

La collection `calendar_events` et ses index sont créés automatiquement.
Le même serveur MongoDB peut héberger Tempo, le cinéma et Mémo; le compte
MongoDB du backend doit avoir les droits de lecture, écriture et création
d’index dans la base configurée. Aucun compte Google Calendar n’est nécessaire.
La saisie manuelle fonctionne sans clé Gemini. MongoDB reste nécessaire à
l’enregistrement. Un problème de connexion s’affiche avec une action Réessayer.

L’objet retourné par Gemini et accepté par `addEvent` suit ce même contrat :

```js
{
  title: "Souper avec Camille",
  description: "Au restaurant du quartier",
  date: "2026-10-16",
  endDate: "2026-10-16",
  startTime: "19:00",
  endTime: "21:00",
  allDay: false,
  recurrence: null // ou { frequency: "weekly", interval: 2, weekdays: [5], until: null, count: 6 }
}
```

Les heures sont des valeurs locales à Toronto; pour toute la journée, les
heures valent `null` et la date de fin est inclusive. Le backend valide
chaque objet, y compris la règle de récurrence. `frequency` vaut `daily`,
`weekly`, `monthly` ou `yearly`. `weekdays` contient les jours de la semaine
(`0` = dimanche, `6` = samedi) seulement pour `weekly`, sinon `[]`. Le jour de
la première occurrence doit être sélectionné. `until` et `count` sont exclusifs,
ou tous deux `null` pour une série sans fin. `date` et `endDate` décrivent la
première occurrence, pas la durée de la série. Les événements existants sans
`recurrence` restent compatibles.

Gemini comprend par exemple « Souper tous les dimanches à 19 h pendant deux
heures » ou « Yoga un mardi sur deux à 18 h, six fois ». Il demande une précision
pour les règles non prises en charge, comme le dernier dimanche du mois.
Gemini prépare seulement un brouillon : l’ajout nécessite
l’action de l’utilisateur. Les dates relatives suivent la date actuelle
à Toronto, même lorsqu’un autre mois est affiché.

## Documents PDF

Pour tester avec la **vraie API Gemini** avant de déployer, configure
`GEMINI_API_KEY` dans `backend/.env`, puis lance `npm run test:pdf` depuis
`backend/`, ou `npm run test:pdf -- "/chemin/document.pdf"`. Ce test réutilise
l’extracteur du serveur et ne crée aucune donnée dans MongoDB.
Voir le [guide de test local](../../docs/calendar-local.md) pour lancer aussi
l’interface complète.

« Documents » ouvre une bibliothèque avec recherche et filtre « À vérifier ».
Ajoute plusieurs PDF par le bouton ou par glisser-déposer (10 Mo par fichier).
Sur ordinateur, le panneau de détails présente l’aperçu de première page,
l’original à ouvrir ou télécharger et les événements associés. Sur téléphone,
la sélection ouvre les détails avec un retour à la bibliothèque.

Chaque PDF est enregistré avant son analyse. Gemini recherche les événements
explicites, puis une fenêtre les regroupe par document avec la page d’origine,
les hypothèses éventuelles et des détails modifiables. Sélectionne tout ou
quelques événements, ou ferme la revue pour la reprendre depuis la bibliothèque.
Aucun événement n’est ajouté sans validation. Les corrections d’une revue
fermée restent disponibles pendant la session; les propositions originales
sont conservées côté serveur.

Les événements ajoutés gardent une référence à leur PDF, son nom et sa page.
Cette référence est conservée lors des modifications, y compris pour les
séries récurrentes. Supprimer un PDF demande confirmation : le fichier et ses
propositions disparaissent, les événements restent avec la mention « Document
supprimé ». Supprimer un événement permet de sélectionner à nouveau sa
proposition dans la bibliothèque.

La collection MongoDB `calendar_documents` conserve les PDF binaires et leur
analyse par compte, sans volume Docker supplémentaire. La limite de 10 Mo
laisse une marge sous la limite BSON de 16 Mio pour les métadonnées. Le même
PDF importé plusieurs fois dans un compte est reconnu par son empreinte SHA-256.
Les listes n’incluent jamais les octets PDF. Les originaux et toutes les
opérations nécessitent la session HomeLab.

Les PDF sont envoyés à Gemini comme données PDF intégrées à la requête
d’analyse. Leur conservation durable est assurée par HomeLab; elle ne dépend
pas des fichiers temporaires Google. Une erreur d’analyse conserve le PDF et
propose une nouvelle tentative. Sans clé Gemini, la bibliothèque fonctionne
et les documents pourront être analysés après configuration. Une analyse
propose jusqu’à 100 événements, avec au maximum 6 analyses par minute et par
compte. Les requêtes interrompues et les clics répétés ne créent pas de copies
supplémentaires des événements déjà ajoutés.

Prépare PDF.js avec `npm run prepare:pdf` dans ce dossier, puis lance
`node scripts/test-calendar-documents-ui.mjs` depuis la racine pour vérifier
le parcours complet. Le script utilise Playwright, Chrome et des API simulées,
sans accéder à Gemini ou MongoDB. Les captures sont dans
`artifacts/calendar-documents/`. Le backend comprend aussi
`tests/calendar-documents.test.mjs` pour le stockage, les accès, l’analyse,
les liens, les reprises et la suppression.

Pour les vérifications de l’API, lance `npm test`, `npm run lint`,
`npm run typecheck` et `npm run build` dans `backend/`. Pour le parcours
visuel, lance `node scripts/test-calendar-ui.mjs` depuis la racine après
installation des dépendances de `apps/memo/web-app/frontend/` (Playwright)
et de Chrome. `CHROME_BIN` permet de choisir un autre exécutable Chromium.
Les captures sont produites dans `artifacts/calendar/`. Ces vérifications
utilisent des API simulées; elles ne contactent pas ton MongoDB ni Gemini.
