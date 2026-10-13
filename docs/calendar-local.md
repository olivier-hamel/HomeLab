# Tester Tempo localement

## Analyse Gemini seule, sans démarrer HomeLab

Utilise Node.js 24. Depuis la racine du dépôt :

```sh
cd backend
npm ci
test -f .env || cp .env.example .env
```

Dans `backend/.env`, renseigne `GEMINI_API_KEY` avec ta clé Gemini. Tu peux aussi
la fournir dans l’environnement du terminal. `GEMINI_MODEL` est facultatif.
Le fichier `.env` est ignoré par Git; ne mets pas la clé dans une commande ou
un fichier suivi. MongoDB n’est pas nécessaire pour ce test.

```sh
# Vraie API, PDF synthétique avec un examen à une date et un horaire connus.
npm run test:pdf

# Vraie API, ton PDF. Le chemin peut être absolu ou relatif à backend/.
npm run test:pdf -- "/chemin/2026-03_PlanDeCours_PHS1101.pdf"
```

Le PDF est transmis à Gemini. La commande utilise le même extracteur, le même
schéma et les mêmes validations que le serveur. Elle affiche le résumé, les
événements, leurs pages et les hypothèses détectées. Elle ne crée aucun
document ni événement dans MongoDB. Le test synthétique échoue si l’examen
attendu n’est pas retrouvé. En cas de refus Gemini, la sortie distingue le
statut HTTP, le modèle et le code fournisseur, sans afficher la clé API ou
le corps d’erreur privé du fournisseur.

## Interface complète dans le navigateur

L’interface a besoin de quatre services locaux. Prépare les dépendances dans
`frontend/`, `backend/` et `apps/calendar/` avec `npm ci`. Le script Mémo
installe ses dépendances Python au premier lancement.

Dans `backend/.env`, configure aussi :

```dotenv
MEMO_AUTH_URL=http://127.0.0.1:8000
MONGODB_URI=<URI de ta base de développement>
MONGODB_DATABASE=homelab_calendar_dev
```

Le compte MongoDB doit avoir accès à cette base. Choisis une base de
développement pour que les imports d’interface restent séparés du calendrier
du serveur. L’analyse seule décrite plus haut fonctionne sans cette étape.

Lance chaque commande dans son propre terminal, depuis la racine du dépôt :

```sh
# 1. Mémo fournit la connexion HomeLab, avec des données locales séparées.
cd apps/memo/web-app
FLASHCARD_WEB_AUTH=1 FLASHCARD_WEB_REQUIRE_HTTPS=0 MEMO_COOKIE_PATH=/ \
  FLASHCARD_WEB_DATA="$PWD/../../../.local-data/memo-calendar" ./start.sh
```

Si `.env.memo-local` existe, vérifie qu’il conserve ces réglages de
développement : `start.sh` le charge avant le démarrage.

```sh
# 2. API HomeLab, lit backend/.env.
cd backend
npm run dev
```

```sh
# 3. Interface Tempo et préparation des aperçus PDF.js.
cd apps/calendar
npm run dev
```

```sh
# 4. HomeLab et ses proxys locaux.
cd frontend
npm run dev
```

Crée une fois un compte local, dans un autre terminal :

```sh
cd apps/memo/web-app
FLASHCARD_WEB_DATA="$PWD/../../../.local-data/memo-calendar" \
  .venv/bin/python -m backend.accounts create dev --display-name Développement
```

Choisis le mot de passe à l’invite. Ouvre **http://localhost:3000**, connecte-toi
avec ce compte, puis ouvre **Tempo → Documents**. Utilise cette URL HomeLab;
elle fournit les proxys `/memo`, `/calendar` et `/api` au même navigateur.
L’exception HTTP est réservée au développement local; le serveur conserve HTTPS.

## Tests automatiques

`npm test` dans `backend/` teste les contrats, l’isolation des comptes, les
erreurs et les validations avec des fournisseurs simulés. Le parcours visuel
`node scripts/test-calendar-documents-ui.mjs` utilise lui aussi des API simulées.
Ces tests ne remplacent pas `npm run test:pdf` pour vérifier la compatibilité
avec la vraie API Gemini avant un déploiement.
