# Tempo

Tempo est le calendrier en français de HomeLab et sa section ouverte par défaut
après la connexion. Les liens `?section=calendar`, `?section=tv` et
`?section=memo` sélectionnent respectivement Tempo, TV & Movies et Mémo.
Les noms de sections inconnus ouvrent Tempo ; le mode TV commence avec TV & Movies.
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
saisie manuelle. Gemini propose un objet avec le titre, la description, les
dates et l’horaire; une étape de vérification permet de le corriger avant
l’enregistrement. Un clic sur un événement ouvre la modification; la
suppression demande une confirmation. Les vues mois, semaine, jour et
l’accueil affichent les événements du compte connecté.

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
Gemini peut préparer ces mêmes règles depuis une description en langage naturel.

La création assistée réutilise `GEMINI_API_KEY`, exclusivement côté serveur;
`GEMINI_MODEL` est optionnel. Mémo conserve ses variables `MEMO_*` dans son
service distinct. Il n’est pas nécessaire de créer une nouvelle clé ou un
nouveau cluster si ceux utilisés par HomeLab conviennent déjà. Le compte
MongoDB du backend doit avoir accès à la base configurée.

Voir le [contrat des événements et les vérifications](../apps/calendar/README.md#mongodb-et-gemini).

## Documents

La bibliothèque « Documents » permet de conserver plusieurs PDF dans Tempo,
avec recherche, aperçu de première page, téléchargement et suppression.
L’import accepte plusieurs fichiers et le glisser-déposer, avec une limite
de 10 Mo par PDF. Les événements détectés par Gemini sont présentés dans une
fenêtre de revue : sélectionne les propositions, ajuste leurs détails, puis
confirme l’ajout au calendrier. La revue reste accessible depuis la bibliothèque.

Les événements issus d’un PDF affichent leur document d’origine et un lien
vers sa page. La suppression d’un document conserve les événements déjà
ajoutés et remplace l’accès au fichier par une mention de suppression.

MongoDB conserve les fichiers et les analyses dans `calendar_documents`,
séparément par compte. Les index sont créés automatiquement; aucun nouveau
volume ni changement de configuration n’est nécessaire. Les PDF sont envoyés
à Gemini pendant l’analyse et conservés durablement dans HomeLab. Un échec de
Gemini ne supprime pas le PDF. Sans clé Gemini, l’import et la consultation
restent disponibles.

Reconstruis les services `calendar` et `backend` pour activer cette fonctionnalité.
Le build Docker de Tempo prépare automatiquement PDF.js; en local, exécute
`npm ci --omit=optional --ignore-scripts` dans `apps/calendar` avant `npm run dev`.
Consulte les [détails et vérifications des PDF](../apps/calendar/README.md#documents-pdf).
