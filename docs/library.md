# Bibliothèque

La quatrième app HomeLab regroupe les PDF et les présentations PowerPoint dans
une interface française. Ouvre **Bibliothèque** dans la navigation ou
`/?section=library`. Elle utilise la session HomeLab existante et fonctionne
sur ordinateur et mobile.

Tu peux créer des dossiers imbriqués, renommer et déplacer tes dossiers et
fichiers personnels, rechercher dans toute la bibliothèque, filtrer les formats,
trier les documents et passer de la liste à la grille. Un dossier doit être vide
pour être supprimé. L’import accepte PDF, PPT et PPTX, jusqu’à **25 Mo par fichier**,
par sélection multiple ou glisser-déposer. Les fichiers sont vérifiés côté serveur.

Le lecteur PDF.js affiche les pages, avec pagination, zoom et ajustement à la
largeur, y compris sur mobile. Ses workers, polices, CMaps et modules WASM sont
servis localement et préparés par `npm run prepare:library` (`dev` et `build`
le font automatiquement). Les PowerPoint sont convertis en PDF pour l’aperçu avec
LibreOffice, puis cet aperçu est conservé pour les prochaines ouvertures.
L’original PowerPoint reste téléchargeable. Docker inclut LibreOffice et les
polices DejaVu/Liberation. En développement, installe `libreoffice-impress` ou
configure `LIBRARY_SOFFICE_PATH`; sans ce programme, le téléchargement fonctionne
et l’interface indique que l’aperçu est indisponible.

## Moodle A26

Le dossier **Moodle** existe dès l’ouverture. La synchronisation crée un dossier
par cours, puis un sous-dossier par section Moodle. Elle sélectionne uniquement
les inscriptions A26 (`20263`, `A2026`, `A26` ou `Automne 2026`), et conserve
uniquement les PDF/PPT/PPTX. Elle ne devine pas les cours à partir de leur code.
Les dossiers et documents synchronisés sont gérés automatiquement; les dossiers
personnels restent organisables dans **Mes documents**.

La configuration reprend la connexion privée décrite dans [Moodle](moodle.md) :

```dotenv
MOODLE_MCP_URL=http://127.0.0.1:18000/mcp
MOODLE_ALLOWED_USERS=oli
LIBRARY_MOODLE_SEMESTER=A26
```

Utilise les vrais noms de comptes autorisés sur ton installation. Pour le compte
local de développement créé par `./start-local.sh`, utilise `dev`. Chaque compte
possède sa propre bibliothèque et ses propres copies de fichiers. Le MCP reste
une connexion à **un compte Moodle personnel**. Retirer un utilisateur de
`MOODLE_ALLOWED_USERS` lui retire aussi l’accès aux copies Moodle, sans supprimer
ses fichiers personnels.

Le serveur vérifie Moodle au démarrage, puis toutes les **30 minutes**, même
sans navigateur ouvert. Le bouton **Synchroniser** déclenche une vérification
immédiate. Le navigateur consulte l’avancement toutes les trois secondes pendant
l’import. Les nouvelles ressources sont téléchargées; les ressources inchangées
sont réutilisées. La date de modification Moodle détecte aussi les remplacements
de même taille. Avec un ancien serveur ne fournissant pas cette date, les copies
sont revérifiées quotidiennement. Des identifiants stables empêchent les doublons.

Les transferts utilisent des blocs de 512 Kio et vérifient le SHA-256 du fichier
complet. Un transfert échoué conserve l’ancien original et est repris lors d’une
prochaine vérification. Une ressource retirée de Moodle reste dans la bibliothèque
avec l’indication « Conservé · retiré de Moodle ». Un verrou persistant empêche
deux synchronisations simultanées et expire après une interruption du serveur.

L’import initial peut durer plusieurs minutes selon le nombre et la taille des
fichiers. Les fichiers de plus de 25 Mo restent répertoriés avec une erreur visible;
ils ne sont pas présentés comme enregistrés. Un échec de cours interrompt le
relevé avant de marquer des documents comme retirés.

Pour un import en ligne de commande, depuis `backend/` :

```sh
npm run sync:library -- oli
```

Le script utilise le même stockage, verrou et moteur que le serveur. Dans Docker :

```sh
docker compose exec backend node --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/sync-library.mjs oli
```

## Outil MCP de téléchargement

Les trois outils Moodle initiaux restent disponibles. Le quatrième outil,
`download_file`, exporte les originaux; `read_file` continue de fournir du texte.
L’extension réutilise la validation d’URL et les credentials du serveur existant.
Elle vérifie l’inscription au cours, l’association cours/fichier, le format et les
limites. Le transport et les listeners privés restent identiques.

Pour installer sur le LXC Moodle, copie ces trois fichiers à côté de `server.py`
dans son dossier existant :

- `deployment/moodle/library_download.py`
- `deployment/moodle/install-library-download.py`
- `deployment/moodle/test_library_download.py`

Depuis ce dossier, avec son environnement Python existant :

```sh
.venv/bin/python -m unittest test_library_download.py
.venv/bin/python install-library-download.py
.venv/bin/python -m unittest discover -s tests
systemctl --user restart poly-moodle.service
systemctl --user is-active poly-moodle.service
```

L’installateur est idempotent et expose aussi `timemodified` dans `list_files`.
Les commandes SSH propres à cette installation et la clé d’hôte approuvée se
trouvent dans la documentation **privée**, exclue de Git.

## Stockage et déploiement

Les métadonnées et verrous sont dans SQLite (`library.sqlite`, mode WAL). Les
originaux et aperçus sont dans `files/`. Le stockage ne nécessite pas MongoDB et
n’est pas soumis à sa limite de 16 Mo par document. En local, le dossier est
`backend/.local-data/library/`; `LIBRARY_STORAGE_PATH` permet de le choisir.
Il est exclu de Git. Dans Docker, le volume nommé **library_data** est monté sur
`/data/library`, détenu par l’utilisateur backend non-root. Les recréations de
conteneur conservent la bibliothèque. Inclure ce volume dans la politique de
sauvegarde de l’installation; `docker compose down -v` le supprime.

Le contexte Docker exclut les données locales. Le build supprime aussi ces
documents du paquet standalone et du tracing de l’instrumentation Next.js.

Pour déployer, suivre [la procédure du dépôt](../SERVER-UPDATE.md), reconstruire
`backend` et `frontend`, puis vérifier `/api/health` et `/?section=library`.
La connexion Moodle privée doit rester disponible dans le namespace backend.
Le premier lancement synchronise les comptes autorisés automatiquement.

## Vérifications

```sh
cd backend
npm test
npm run lint
npm run typecheck
npm run build
```

Répéter les quatre commandes dans `frontend/`. Depuis la racine :

```sh
python3 -m unittest discover -s deployment/moodle -p 'test_library_download.py'
node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/test-library-ui.mjs
```

Le parcours Chromium utilise le frontend local sur le port 3000 et une bibliothèque
isolée dans un dossier temporaire. Il vérifie les dossiers imbriqués, imports,
recherche, renommage, déplacement, suppression, formats, lecteurs et tailles
d’écran de 320 à 1440 px. Les captures sont dans `artifacts/library/`.
`HOMELAB_UI_URL` et `CHROME_BIN` permettent de choisir un autre frontend ou Chromium.
Les tests backend couvrent les accès par compte, la révocation Moodle, les cycles
de dossiers, les mutations concurrentes, les transferts corrompus, les reprises,
les révisions de même taille et la conservation des fichiers retirés.
