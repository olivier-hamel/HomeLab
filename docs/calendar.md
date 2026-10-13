# Tempo

## Tâches et Moodle

Le dialogue de création accepte un événement ou une tâche. Chat choisit la
nature selon la description, puis les détails restent modifiables avant l’ajout.
La saisie manuelle propose aussi ce choix. Une tâche contient un état à faire /
terminée et une échéance (date, heure facultative). Les boîtes Moodle sans date
conservent une échéance vide : elles restent dans Accueil sans inventer une date
dans le calendrier. Les notes, liens HTTP(S), documents de Bibliothèque et
cours ou projet sont facultatifs. Une tâche sans rattachement est acceptée.

Les tâches apparaissent au jour de l’échéance dans le mois et dans la bande
supérieure des vues semaine/jour, avec leur heure limite et une case à cocher.
Les tâches terminées restent consultables et peuvent être remises à faire.
Le même état est affiché dans Accueil. Tout est enregistré par compte dans
`calendar_events`; les anciens événements restent compatibles.

Le serveur importe les événements visibles et les boîtes de remise Moodle sans
IA. Il détecte la session courante à Toronto (H : janvier–avril, E : mai–juillet,
A : août–décembre) et sélectionne les cours portant cette session dans leur nom
ou code Moodle. `CALENDAR_MOODLE_SEMESTER=H27`, `E27` ou `A26` permet de la
forcer; une valeur vide conserve la détection automatique. Ce réglage est
indépendant de `LIBRARY_MOODLE_SEMESTER`.
Quand Moodle fournit la date de début du trimestre, elle borne également les
événements généraux pour exclure ceux de la session précédente.

La synchronisation commence après le démarrage du backend et vérifie chaque
compte Moodle autorisé toutes les 30 minutes, même sans navigateur. L’ouverture
du calendrier ou d’Accueil déclenche aussi une vérification si nécessaire.
« Actualiser » dans Tempo permet une demande immédiate. Les dates UTC sont
converties à Toronto; les prolongations personnelles vérifiées ont priorité sur
la date du cours. Une prolongation non vérifiée est signalée. Les remises sont
lues cours par cours, et leurs rappels calendrier sont dédoublonnés. Une remise
déjà soumise est cochée à sa première importation; les synchronisations suivantes
préservent l’état choisi dans HomeLab.

Un identifiant stable par source permet de mettre à jour les titres et échéances
sans recréer les éléments ni écraser notes, liens, pièces liées ou coches.
Supprimer un élément importé conserve une marque de suppression durable dans
MongoDB : même une actualisation manuelle ou un redémarrage ne le réimporte pas.
Une réponse partielle ou une panne conserve les éléments déjà présents; seuls
les inventaires complets peuvent masquer un élément retiré de Moodle. Les
anciens semestres déjà importés restent consultables comme historique.

`GET /api/calendar/events` inclut les tâches et, pour les comptes autorisés,
`moodleSync`. `POST /api/calendar/moodle-sync` demande une actualisation.
`PATCH /api/calendar/events/:id` accepte `{ completed, updatedAt }` pour changer
seulement la coche, avec protection contre les versions périmées. Les suppressions
utilisent la route DELETE habituelle. `calendar_moodle_sync` conserve les dates
de vérification et le verrou de synchronisation entre processus.

Validation : `backend/tests/calendar-tasks.test.mjs`,
`apps/calendar/tests/tasks.test.mjs` et `scripts/test-calendar-tasks-ui.mjs`.

Tempo est le calendrier en français de HomeLab. L’app [Accueil](home.md) s’ouvre
par défaut après la connexion. Les liens `?section=home`, `?section=calendar`,
`?section=tv`, `?section=memo` et `?section=library` sélectionnent respectivement
Accueil, Tempo, TV & Movies, Mémo et Bibliothèque. Les noms de sections inconnus
ouvrent Accueil ; le mode TV commence avec TV & Movies.
Le menu latéral contient la navigation et la commande de plein écran.

Tempo s’affiche dans une iframe de même origine à `/calendar/`, y compris en
plein écran. La touche Échap permet de quitter le plein écran après avoir fermé
une éventuelle fenêtre de l’application. Tempo utilise la session HTTPS de
HomeLab et affiche le compte connecté. Les préférences sont enregistrées
séparément pour chaque compte dans le navigateur, y compris celles sauvegardées
avant le changement de nom.

Les sources se trouvent dans [apps/calendar](../apps/calendar/README.md).
Les identifiants techniques `calendar`, le chemin `/calendar/` et le dossier
`apps/calendar/` sont conservés. Compose construit le Dockerfile et sert
l’application sur `calendar:4173` sans publier de port. Caddy vérifie la session
Mémo avant de servir le contenu, retire le préfixe `/calendar` et limite cette
route aux réseaux de confiance. Les URL relatives des ressources fonctionnent
sous ce préfixe. `/calendar/healthz` retourne `ok`.

Pour le développement local, lance `npm run dev` dans `apps/calendar/` avec
le serveur de développement HomeLab et le backend Mémo authentifié. Vite
redirige `/calendar/*` vers le port 4173 et `/memo/*` vers le port 8000.
Consulte le guide des [comptes partagés](accounts.md).

Toutes les modifications utilisent la branche `feat/memo-integration` de
HomeLab et un seul pull sur le serveur. Reconstruis `calendar` pour les
changements de Tempo, `backend` pour les API d’événements et `frontend` pour ceux du tableau de bord.
La procédure figure dans [SERVER-UPDATE.md](../SERVER-UPDATE.md).
Les mises à jour courantes préservent la configuration et les volumes existants.

## Événements

Le bouton « Nouvel événement » ouvre la création en langage naturel ou la
saisie manuelle. GPT-6 Luna propose un objet avec le titre, la description, les
dates et l’horaire; une étape de vérification permet de le corriger avant
l’enregistrement. Un clic sur un événement ouvre la modification; la
suppression demande une confirmation. Les vues mois, semaine et jour ainsi que
l’app Accueil affichent les événements du compte connecté.

Le bouton « Types » permet de créer et supprimer des types propres au compte.
Chaque type a un nom et un niveau d’importance parmi Très faible, Faible, Normale,
Élevée et Très élevée. Les types discrets prennent peu de place; les plus importants
ont des cartes plus grandes et passent en premier dans la vue mois. Les vues
horaires leur accordent davantage de largeur en cas de chevauchement, tout en
conservant leurs heures exactes. Le champ de type est disponible pendant la
création, la modification et la revue des propositions de documents.

Le type système « aucun », caché, est utilisé par défaut et ne peut pas être
supprimé. Supprimer un type conserve ses événements avec une importance normale.
OpenAI reçoit la liste des types du compte et choisit celui qui correspond le
mieux au titre, en langage naturel comme lors des scans PDF et PowerPoint.

Le backend utilise la connexion MongoDB commune à HomeLab : configure
`MONGODB_URI` dans `backend/.env`, avec `MONGODB_DATABASE=homelab` ou ta base
existante. La collection `calendar_events` et les index sont créés automatiquement.
Les requêtes de lecture et d’écriture utilisent le compte vérifié par Mémo.
Les modifications concurrentes sont détectées avant l’écriture.

Le champ « Répétition » propose les fréquences quotidienne, hebdomadaire,
mensuelle et annuelle, un intervalle réglable et une fin facultative (date
incluse ou nombre d’occurrences). Une série reste un seul document MongoDB ;
les vues calculent ses occurrences pour les dates affichées, à l’heure locale
de Toronto. La modification et la suppression concernent toute la série.
GPT-6 Luna peut préparer ces mêmes règles depuis une description en langage naturel.

La création assistée utilise `OPENAI_API_KEY`, exclusivement côté serveur.
Ajoute la clé dans le fichier privé `backend/.env`, puis redémarre le backend.
La création depuis une description utilise `gpt-6-luna`; les scans PDF et
PowerPoint utilisent `gpt-6.1-sol`. Ces modèles sont fixés dans le code serveur.
Le fichier `.env` à la racine sert uniquement
aux réglages Compose. Mémo conserve ses variables
`MEMO_*` dans son service distinct. Le compte MongoDB du backend doit avoir
accès à la base configurée.

Voir le [contrat des événements et les vérifications](../apps/calendar/README.md#mongodb-et-openai).

## Documents de Bibliothèque

Tempo utilise les PDF et PowerPoint de [Bibliothèque](library.md#tempo-et-mémo).
Les nouveaux fichiers produisent automatiquement des propositions d’événements,
présentées dans une notification persistante. Vérifie et corrige les détails
avant d’accepter; les propositions non cochées sont ignorées, et **Plus tard**
conserve la notification. Aucun événement n’est ajouté automatiquement.

Les anciens fichiers ne sont pas scannés automatiquement. Leur menu et le panneau
d’informations de Bibliothèque proposent un scan manuel, également disponible
pour les documents Moodle. Les événements acceptés gardent un lien vers le fichier
et sa page. La suppression du fichier conserve les événements du calendrier.

Les notifications et les fichiers restent dans le volume Bibliothèque; les
événements acceptés restent dans MongoDB. Les anciens PDF Tempo et leurs dossiers
sont migrés à l’ouverture du calendrier sans relancer l’analyse. Les anciens liens
restent consultables. Reconstruis `backend`, `frontend`, `calendar` et `memo`
pour activer le parcours commun.
