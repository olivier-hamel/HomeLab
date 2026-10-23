# Service autonome ChatGPT Plus

Service personnel **réel uniquement**, accessible par API HTTP et CLI, sans interface
de chat graphique. Il automatise le **Chat normal de ChatGPT.com** avec un profil
Chromium dédié et [tab2api 0.3.0](https://www.npmjs.com/package/tab2api/v/0.3.0).
Il ne lance aucun client Work/Codex et ne demande aucune clé d’API OpenAI facturée.

Le moteur conserve le serveur et les contrôles de tab2api, avec un adaptateur local
local pour le DOM actuel de ChatGPT : une seule soumission du formulaire,
lecture des nouveaux attributs de réponse et aucun clic sur un bouton Envoyer/Stop.
L’enveloppe JSON est demandée dans un bloc de code pour rester du texte dans le
renderer de ChatGPT. Une réponse finale vide est signalée, jamais renvoyée automatiquement.
L’apparition du nouveau message utilisateur est vérifiée avant d’attendre la réponse.

Ce dossier possède son installation, ses processus et ses données. Il ne dépend
d’aucun composant HomeLab et n’est ajouté à aucun de ses démarrages ou services.
Il peut être copié seul dans un autre répertoire pour fonctionner.

L’accès est non officiel et dépend de l’interface ChatGPT.com. Une modification de
cette interface, une limite du compte ou un contrôle de sécurité peut interrompre
le service. La connexion et les contrôles de sécurité sont effectués manuellement
dans la session distante ; les mots de passe ChatGPT ne sont jamais demandés par l’API.

Pour le serveur : [guide Proxmox et installation dans une VM dédiée](PROXMOX.md).
Pour l’exploitation : [maintenance, sauvegardes et mises à jour](MAINTENANCE.md).
`npm run package:server` prépare une archive de code sans profil, jeton ni base locale.

## Installation locale

Prérequis : Linux, Node.js **24**, npm. Sur Debian/Ubuntu, installer les outils
graphiques en une fois :

```sh
sudo apt-get install xvfb xauth x11vnc novnc websockify
cd /home/user/Documents/HomeLab/services/chatgpt-bridge
npm ci
npm run setup
npm run build
npm start
```

Une variante sans installation administrateur est disponible pour Debian/Ubuntu
disposant déjà de Python 3, xauth et des bibliothèques Linux/X11 de base :

```sh
npm ci
npm run setup -- --portable-system
npm run build
npm start
```

Cette variante télécharge les paquets avec apt, vérifie les bibliothèques requises
et extrait leurs fichiers sous `.local-data/system`. Ses index apt et le navigateur
sont également privés à ce projet. Elle ne modifie ni les sources apt ni les paquets
installés du système. La préparation demande de l’espace disque pour Chromium et
les index apt ; ce n’est pas la consommation mémoire en fonctionnement.

Le service écoute sur **http://127.0.0.1:3211**. Le terminal indique seulement le
chemin du jeton, jamais sa valeur. Arrêt propre : `Ctrl+C`.

Les paramètres facultatifs sont décrits dans `.env.example`. Pour les modifier,
créer un `.env` dans ce dossier ; ne pas réutiliser les variables ou secrets HomeLab.
Les ports par défaut sont : API `3211`, moteur `3210`, VNC `5901`, noVNC `6081`.
Par défaut, toutes les écoutes TCP sont limitées à `127.0.0.1` ; Xvfb n’écoute pas
en TCP. L’API peut être ouverte au **même sous-réseau LAN privé** explicitement
configuré ; voir [l’intégration dans une app](API.md).

## Connexion au compte Plus

Dans un second terminal, depuis ce dossier :

```sh
npm run cli -- session open
```

La commande affiche une URL noVNC et un mot de passe temporaire de huit caractères.
Ouvrir cette URL, cliquer **Connect**, saisir ce mot de passe, puis se connecter
normalement à ChatGPT dans Chromium. Utiliser son propre compte Plus. Aucun secret
ChatGPT ne doit être collé dans le terminal, l’API ou cette conversation.

La connexion validée ferme automatiquement l’accès de maintenance et remet le moteur
en service. Si nécessaire :

```sh
npm run cli -- session show
npm run cli -- session close
npm run cli -- status --refresh
```

Attendre `"session": "ready"` avant une première question. Le modèle utilisé est
celui sélectionné dans l’interface du compte. Le nom `chatgpt-web` est un identifiant
de compatibilité et ne sélectionne pas un modèle API. La vérification du forfait Plus
reste à faire dans cette session : le service ne prétend pas mesurer sa facturation.

La fenêtre n’apparaît jamais sur le bureau local : Chromium s’affiche dans Xvfb.
noVNC est réservé à la connexion exceptionnelle et expire après **15 minutes**.
Les questions et les décisions d’actions ne nécessitent pas d’ouvrir cette session.

Pour examiner un fil après une interruption, utiliser `npm run cli -- session open --inspect`.
Cette variante reste ouverte même si le compte est déjà connecté ; terminer avec
`npm run cli -- session close`. Elle n’envoie aucun message et conserve la même
expiration de quinze minutes.

Pour accéder à une instance située sur une autre machine, établir un tunnel privé :

```sh
ssh -N -L 6081:127.0.0.1:6081 utilisateur@machine
```

Ouvrir ensuite l’URL locale affichée. Ne pas publier directement les ports API,
VNC ou noVNC. L’authentification VNC courte protège une session locale temporaire ;
le tunnel SSH assure le chiffrement entre machines. Aucun tunnel tiers n’est installé.

## Questions et conversations

```sh
# Crée une conversation, attend la réponse et affiche les identifiants sur stderr.
npm run cli -- ask "Explique la différence entre TCP et UDP."

# Reprend exactement le même fil distant.
npm run cli -- ask --conversation CONVERSATION_ID "Donne un exemple concret."

# Joint de vrais documents ; répéter --attach pour plusieurs fichiers.
npm run cli -- ask --attach ./rapport.pdf --attach ./notes.docx "Résume ces documents."

npm run cli -- conversations list
npm run cli -- conversations show CONVERSATION_ID

# Sortie exploitable par script ; un message peut aussi être fourni avec --stdin.
npm --silent run cli -- ask --json --no-wait "Une nouvelle question"
npm run cli -- runs show RUN_ID
```

Chaque opération a un état : `queued`, `running`, `awaiting_approval`, `completed`,
`failed`, `cancelled` ou `interrupted`. La CLI attend sans streaming. `--no-wait`
rend immédiatement l’identifiant de l’opération. `Ctrl+C` pendant cette attente
arrête la CLI, mais l’opération reste récupérable par son identifiant.

Les pièces jointes sont téléversées dans le compositeur ChatGPT avant l’envoi de
la question : quatre documents maximum, 10 Mio par fichier et 20 Mio au total.
Formats : PDF, Word (`doc`, `docx`), OpenDocument (`odt`), RTF, Excel (`xls`, `xlsx`),
PowerPoint (`ppt`, `pptx`), texte, Markdown, CSV, TSV, JSON, HTML, XML et YAML.
Le service attend les noms des documents, la fin des indicateurs de téléversement
et un bouton d’envoi disponible. Un rejet ou une attente non confirmée interrompt
l’opération sans envoyer la question ni réessayer automatiquement.
Les limites du compte et l’acceptation des fichiers par ChatGPT s’appliquent aussi.

Il y a une génération à la fois et au plus seize opérations actives/en file. Une
conversation en attente d’action reste bloquée jusqu’à décision ou annulation ;
les autres conversations peuvent avancer. La liste contient les fils créés par
ce service, sans importer automatiquement l’historique entier du compte.

## Actions de démonstration et confirmations

Les seuls outils disponibles sont :

| Outil | Arguments | Effet après approbation |
| --- | --- | --- |
| `demo.create_note` | `{"text":"..."}` ; 1 à 4 000 caractères | Enregistrer une note dans la base privée du service |
| `demo.list_notes` | `{"limit":10}` ; entier facultatif de 1 à 50 | Retourner les dernières notes du service |

Pour tester une boucle complète :

```sh
npm run cli -- ask "Utilise demo.create_note pour conserver : essai personnel du service."
```

L’assistant renvoie une action structurée. La CLI affiche `awaiting_approval`,
l’identifiant de l’action, son nom et ses arguments exacts. Examiner ces arguments,
puis choisir l’une des deux commandes :

```sh
npm run cli -- approve ACTION_ID
npm run cli -- deny ACTION_ID
```

`approve` exécute l’outil autorisé, conserve son résultat et le transmet à l’assistant
dans la même conversation. `deny` transmet le refus sans exécuter l’action. La CLI
attend ensuite la réponse ou une autre demande d’action. Il y a au maximum huit
actions par opération, chacune avec une décision séparée.

Aucun nom d’outil, argument ou résultat fourni par un client ne peut remplacer
ceux de l’action enregistrée. Les objets inconnus ou mal formés restent du texte
avec un avertissement ; aucun bloc de code, commande shell ou texte libre n’est
exécuté. Les outils ne peuvent accéder ni aux fichiers arbitraires de l’hôte ni aux
services HomeLab. La création d’une note et son résultat sont enregistrés dans
une seule transaction pour éviter les doublons après redémarrage.

## API HTTP

Le contrat complet est dans [openapi.yaml](openapi.yaml). Toutes les routes sauf
`GET /healthz` exigent `Authorization: Bearer <jeton local>`. La CLI lit le fichier
de jeton automatiquement. Pour un essai avec curl, depuis ce dossier :

```sh
export BRIDGE_TOKEN="$(cat .local-data/api-token)"
curl --fail-with-body http://127.0.0.1:3211/v1/status \
  -H "Authorization: Bearer $BRIDGE_TOKEN"
```

| Route | Usage |
| --- | --- |
| `GET /healthz` | Processus vivant ; ne vérifie pas ChatGPT |
| `GET /v1/openapi.yaml` | Contrat OpenAPI téléchargeable, authentifié |
| `GET /v1/status?refresh=true` | Session, file et état de maintenance ; aucun secret de maintenance |
| `POST /v1/conversations` | Corps `{"title":"Titre facultatif"}` ; retourne `201` et `id` |
| `GET /v1/conversations` | Conversations locales |
| `GET /v1/conversations/:id` | Identifiant distant et messages |
| `POST /v1/conversations/:id/messages` | Corps `{"text":"Question","attachments":[{"filename":"rapport.pdf","data_base64":"..."}]}` ; pièces jointes facultatives ; retourne `202`, `run_id`, `status` |
| `GET /v1/runs/:id` | Réponse finale, erreur et actions structurées |
| `POST /v1/actions/:id/decision` | Corps `{"approved":true}` ou `false` ; retourne l’opération poursuivie |
| `POST /v1/runs/:id/cancel` | Annulation locale, sans relance |
| `POST/GET/DELETE /v1/session/maintenance` | Ouvrir, consulter ou fermer la session exceptionnelle |

Le POST de message accepte `Idempotency-Key` (1 à 200 caractères) : une répétition
avec le même fil, le même message et les mêmes documents retourne la même opération ; une autre demande
avec cette clé reçoit `409`. Une décision répétée identique n’exécute pas deux fois
l’action ; une décision contradictoire reçoit `409`.

Les réponses sont JSON, sans SSE ni streaming. Les contrôles locaux restent
disponibles quand ChatGPT est déconnecté. [API.md](API.md) décrit l’accès depuis
une app du même LAN, les origines CORS explicites et le client TypeScript fourni
(`src/app-client.ts`). Le jeton et le sous-réseau autorisé sont vérifiés pour les
appels LAN. La maintenance reste réservée aux clients locaux sans origine
navigateur. Le client CLI reste sur loopback ; le client app accepte l’URL LAN
configurée. Les deux refusent les redirections et ne relancent aucun envoi.

## Interruption et redémarrage

```sh
npm run cli -- cancel RUN_ID
```

Une interruption réseau ou un arrêt du processus après soumission ne permet pas
toujours de savoir si ChatGPT a reçu le message. L’opération devient `interrupted`
et bloque le fil ; il n’y a **aucune resoumission automatique**. Examiner la session
distante avant d’annuler cette opération et de poser explicitement une nouvelle
question. Une annulation n’efface pas un message déjà reçu par ChatGPT.

Les fils distants, messages locaux et approbations en attente survivent au
redémarrage. Les opérations qui n’avaient pas encore été soumises reprennent dans
la file. Un verrou protège le profil contre deux instances simultanées. Les
processus orphelins enregistrés sont nettoyés au redémarrage seulement si leur PID
et leur date de démarrage correspondent encore.

Les erreurs de session comprennent notamment `login_required`, `security_challenge`,
`rate_limited`, `ui_changed` et `browser_disconnected`. Utiliser `status --refresh`,
puis la maintenance si une intervention est nécessaire. Le délai d’un tour est
de cinq minutes par défaut, hors attente de décision humaine.

## Vérification

```sh
npm run check
npm test
npm run doctor
# Vérifie le framebuffer noVNC en lecture seule, si une session --inspect est ouverte :
npm run verify:maintenance
```

Les tests utilisent des doublures **internes aux fichiers de test** pour vérifier
les refus, approbations, interruptions, reprises, contrats HTTP et la CLI. Il
n’existe aucun mode simulé dans le service. Les tests de contrat démarrent la
véritable version npm de tab2api avec un fournisseur de test ; ils vérifient aussi
que notre adaptateur n’envoie pas de paramètres incompatibles.

Après connexion du compte, ces campagnes consomment de vraies demandes Plus :

```sh
npm run smoke:live -- minimal
npm run smoke:live -- chat
npm run smoke:live -- long
# Après arrêt/redémarrage manuel du service :
npm run smoke:live -- resume CONVERSATION_ID
npm run metrics
```

`minimal` est l’étape par défaut : deux demandes courtes vérifient la mémoire d’un
même fil. `chat` effectue quatre demandes et vérifie deux fils distincts avec leur mémoire.
Les demandes des campagnes sont espacées d’au moins trente secondes, sans relance
automatique d’un message échoué. Ne pas exécuter plusieurs campagnes en parallèle.
`long` effectue une demande et vérifie la taille ainsi qu’un marqueur final ;
l’omission du marqueur est signalée comme inconclusive. `resume` vérifie la
conservation de l’identifiant distant ; confirmer humainement le redémarrage et
le code mémorisé. Tester aussi les deux décisions d’actions avec les commandes
ci-dessus. Les scripts ne journalisent pas le contenu des réponses.

`metrics` mesure RSS/PSS des processus du service, du navigateur et de l’écran
virtuel. Répéter pendant une réponse longue et pendant la maintenance. Le budget
**1 CPU / 1–2 Go n’est pas garanti** sans qualification sur une machine contrainte.

## Données privées

`.local-data` est ignoré par Git, avec des permissions privées. Il contient
`state.sqlite`, le profil Chromium, les jetons locaux, les fichiers de verrouillage,
les dépendances téléchargées et les éventuels fichiers temporaires de maintenance.
Les conversations existent aussi dans l’historique du compte ChatGPT. Ne pas
committer, publier ou partager ce répertoire. Il ne faut pas le supprimer pour
une simple reconnexion : cela ferait perdre la session et les associations de fils.
Les documents joints sont conservés dans la base privée avec leur opération pour
permettre la reprise de la file après redémarrage ; ils font partie des sauvegardes.
L’API d’historique retourne leurs métadonnées et SHA-256, jamais leur contenu base64.
