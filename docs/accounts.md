# Comptes HomeLab

HomeLab affiche sa propre page de connexion en HTTPS avec les comptes Mémo
disponibles. Sélectionner un compte, puis saisir son mot de passe habituel.
La session ouvre Tempo, les films et Mémo. Les comptes restent dans
`accounts.sqlite3` du volume `memo_data` : aucune nouvelle base de comptes,
migration MongoDB ou copie de mots de passe n'est nécessaire.

Le premier mot de passe temporaire doit être changé avant d'accéder aux apps.
Les boutons du compte HomeLab permettent de changer le mot de passe ou de se
déconnecter. Mémo intégré reprend la même session; ses actions de compte
reviennent à HomeLab. Un lien direct vers `/memo/` ouvre la section Mémo du tableau de bord.

## Profils cinéma

Le profil cinéma utilise par défaut le compte HomeLab connecté. Son sélecteur
propose les mêmes comptes existants, sans demander leur mot de passe. Par
exemple, connecté à Oli, on peut regarder les films avec le profil Max et
revenir à Tempo ou à Mémo en restant Oli.

Le choix cinéma est conservé par compte HomeLab dans le navigateur. Les
préférences de Tempo sont également séparées par compte. Les profils
cinéma utilisent toujours leurs identifiants `oli` et `max` dans MongoDB :
conserver `MEDIA_USER_ID`, `MONGODB_DATABASE` et la configuration MongoDB
existants pour retrouver leurs historiques. L'ancien profil générique `default`
n'apparaît plus dans le sélecteur; ses données restent intactes en base.

Une session HomeLab valide est nécessaire côté serveur pour les API cinéma,
y compris leur état de configuration et les flux vidéo. Les liens temporaires
pour les lecteurs externes restent utilisables sans cookie dans le lecteur,
mais vérifient la session de leur créateur avant chaque nouvelle requête.
Une déconnexion, expiration ou réinitialisation du mot de passe bloque les
requêtes suivantes. Un flux déjà ouvert peut continuer jusqu'à sa fermeture.

## Configuration et mise à jour

Le Dockerfile Mémo active toujours les comptes et HTTPS. Le cookie existant
`memo_session` conserve ses protections `HttpOnly`, `Secure`, `SameSite=Strict`
et son expiration de sept jours. Il couvre désormais `/`. Une session Mémo
existante est conservée puis son ancien cookie limité à `/memo` est retiré
à la première vérification depuis HomeLab.

Compose configure le backend avec `MEMO_AUTH_URL=http://memo:8000`, sur le
réseau interne. Le backend vérifie directement la session auprès de Mémo et
refuse l'accès si ce service est indisponible ou si les comptes sont désactivés.
Caddy utilise également Mémo pour vérifier l'accès à Tempo.

Conserver les certificats et les paramètres HTTPS HomeLab déjà utilisés pour
Mémo. Vérifier que `MEDIA_ALLOWED_ORIGINS` dans `backend/.env` contient les
URL **HTTPS** LAN/Tailscale exactes, avec leur port. L'ouverture HTTP de HomeLab
redirige vers les ports HTTPS configurés dans Compose, en conservant la section
demandée et le mode TV.

L'application Android/Fire TV mémorise la nouvelle adresse HTTPS lors du passage
depuis HTTP. Recompiler son APK pour inclure la confiance dans les autorités
installées par l'utilisateur, puis installer l'autorité Caddy sur l'appareil
(ou utiliser un certificat déjà reconnu). La validation TLS reste active.

Suivre [SERVER-UPDATE.md](../SERVER-UPDATE.md), puis reconstruire et recréer
`memo`, `backend`, `calendar` et `frontend`. Ne pas supprimer le volume `memo_data`
ni recréer les comptes existants. Les commandes d'administration habituelles
de Mémo servent aussi à gérer les comptes HomeLab :

```sh
docker compose exec memo python -m backend.accounts create nouvel_utilisateur --display-name "Nom affiché"
docker compose exec memo python -m backend.accounts reset-password nouvel_utilisateur
```

Vérifier après mise à jour :

1. Sans connexion, HomeLab affiche les comptes existants et les API cinéma refusent l'accès.
2. Se connecter à Oli, ouvrir Tempo et Mémo sans seconde connexion.
3. Passer au profil cinéma Max sans mot de passe; le compte HomeLab reste Oli.
4. Se déconnecter; les apps disparaissent et les nouvelles requêtes cinéma sont refusées.

## Développement local

Lancer le backend Mémo avec `FLASHCARD_WEB_AUTH=1` et un répertoire de données
de développement. Pour HTTP sur loopback uniquement, utiliser
`FLASHCARD_WEB_REQUIRE_HTTPS=0` et `MEMO_COOKIE_PATH=/`. HomeLab Vite transmet
`/memo/*` à `127.0.0.1:8000`, `/calendar/*` à `127.0.0.1:4173` et `/api/*` au
backend Next.js. Configurer `MEMO_AUTH_URL=http://127.0.0.1:8000` et l'origine
HTTP de développement dans le backend. Les builds de production exigent HTTPS.
