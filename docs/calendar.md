# Tempo

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
saisie manuelle. GPT-6.1 Sol propose un objet avec le titre, la description, les
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
mieux au titre en langage naturel. Gemini reçoit cette même liste lors des scans PDF et PowerPoint.

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
GPT-6.1 Sol peut préparer ces mêmes règles depuis une description en langage naturel.

La création assistée utilise `OPENAI_API_KEY`, exclusivement côté serveur.
Ajoute la clé dans le fichier privé `backend/.env`, puis redémarre le backend.
`OPENAI_MODEL` est optionnel et vaut `gpt-6.1-sol` par défaut. Le fichier `.env`
à la racine sert uniquement aux réglages Compose. Les scans de documents
conservent `GEMINI_API_KEY` et `GEMINI_MODEL`. Mémo conserve ses variables
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
sont migrés à l’ouverture du calendrier sans relancer Gemini. Les anciens liens
restent consultables. Reconstruis `backend`, `frontend`, `calendar` et `memo`
pour activer le parcours commun.
