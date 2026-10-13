# Tempo

Tempo est le calendrier de HomeLab, entièrement en français. Son nom évoque le
rythme des journées et accompagne Mémo. Tempo ouvre directement le calendrier,
avec des vues par mois, semaine et jour. La recherche Web, les tâches du jour et
l’aperçu de l’agenda sont dans l’app distincte [Accueil](../../docs/home.md). Les événements
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

Accueil est l’app ouverte par défaut après la connexion à HomeLab.
La section Tempo ouvre le calendrier.
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
- `dist/js/notifications.js` : notifications persistantes et revue des événements détectés dans Bibliothèque.
- `dist/js/components/documents.js` : fenêtre de revue des propositions; composants historiques conservés pour les archives.
- `dist/js/pdf-preview.js` : aperçu de première page avec PDF.js, sans service externe.
- `scripts/prepare-pdf.mjs` : préparation des ressources PDF.js, exécutée par le serveur de développement et le build Docker.
- `dist/js/account.js` : compte HomeLab et protection des textes affichés.
- `dist/js/components/` : menu, vues du calendrier, fenêtres et icônes.
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
`backend/src/lib/calendar/`. Les préférences restent dans le navigateur. Les tâches sont gérées par Accueil.

## Navigation

Tempo ouvre la vue mois. L’app [Accueil](../../docs/home.md) affiche les tâches
et l’agenda de la journée et peut ouvrir directement une date ou un événement
dans Tempo. Les liens de HomeLab acceptent `?section=calendar&date=2026-10-13&view=day`.

Clique sur une date du mois ou du mini calendrier pour ouvrir sa semaine,
puis sur un jour pour voir son horaire. Le fil d’Ariane permet de revenir à
la semaine ou au mois. Les commandes précédent, suivant,
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

Les raccourcis du calendrier sont conservés : `M` pour le mois,
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

## Documents de Bibliothèque

Tempo utilise maintenant [Bibliothèque](../../docs/library.md#tempo-et-mémo) pour
les documents PDF et PowerPoint. La section Documents est supprimée du menu.
Chaque nouveau fichier, quelle que soit son origine, déclenche un scan Gemini
en arrière-plan. Une notification persistante permet d’accepter ou d’ignorer
les propositions, avec modification des détails. **Plus tard** conserve la revue.
Les fichiers déjà présents ne sont pas scannés automatiquement; un bouton de
scan/rescan reste disponible sur chaque fichier dans Bibliothèque.

`dist/js/notifications.js` gère la notification et la revue. Les événements
acceptés conservent leur lien vers Bibliothèque et la page source. Les archives
Tempo existantes sont migrées sans scan, avec leurs dossiers et propositions.

Pour tester avec Gemini réel, configure la clé privée dans `backend/.env`, puis
lance `npm run test:pdf` depuis `backend/`. Le test ne crée aucune donnée. Voir
le [guide local](../../docs/calendar-local.md).

Le parcours commun est vérifié avec
`node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-library-tempo-ui.mjs`
depuis la racine, frontend local démarré. Il utilise une bibliothèque temporaire,
Gemini et un calendrier simulés. Les captures sont dans `artifacts/library/`.
Les tests des archives historiques restent dans `backend/tests/calendar-documents.test.mjs`.

Pour l’API, lance `npm test`, `npm run lint`, `npm run typecheck` et `npm run build`
dans `backend/`. Pour le calendrier, utilise `node scripts/test-calendar-ui.mjs`
depuis la racine après installation de Playwright dans Mémo et de Chrome.
