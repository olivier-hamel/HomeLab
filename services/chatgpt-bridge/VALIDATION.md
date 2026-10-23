# Validation locale

## Procédure Git — 23 octobre 2026

- Vérification TypeScript et 42 tests automatisés réussis, sans test ignoré.
- Dépôt Git temporaire et bundle réel : sélection d’un ancien commit exact,
  conservation des fichiers, refus d’un commit absent et mise à jour après
  réécriture de l’historique vérifiés. Les fichiers privés ignorés sont exclus.
- Aperçus sans SSH/réseau, dépôt autonome et refus des modifications non
  committées vérifiés. La syntaxe des scripts Bash de déploiement est valide.


## Documents joints — 23 octobre 2026

- Vérification TypeScript et compilation Node.js 24 réussies ; contrat OpenAPI
  chargé et analysé correctement.
- 40 tests automatisés réussis, sans test ignoré. Les tests Chromium utilisent
  des pages locales : vrais fichiers PDF/texte chargés par Playwright, plusieurs
  documents, attente d’un indicateur de téléversement différé, soumission unique,
  rejet, annulation et absence d’entrée de document.
- API, client TypeScript et CLI avec plusieurs `--attach` vérifiés. Un document
  de 300 000 octets traverse l’API puis le contrat HTTP réel de tab2api 0.3.0,
  au-delà de l’ancienne limite de corps texte. Authentification et validation
  stricte restent actives ; un appel texte après un document ne reçoit aucun fichier.
- Limites par fichier/total, base64 canonique, types et noms, métadonnées sans
  contenu binaire, idempotence incluant les fichiers, migration de la base texte,
  reprise d’une file persistée et absence de réexpédition après décision vérifiées.
- Aucun envoi au compte ChatGPT réel ni déploiement sur la VM effectué pour cette
  modification. L’acceptation et la fin de traitement des documents par l’interface
  ChatGPT réelle restent à qualifier après installation.

## Validation initiale — 22 octobre 2026

- Node.js 24 : compilation et vérification TypeScript réussies.
- 22 tests automatisés réussis, dont les tests navigateur sur une page locale,
  le contrat avec tab2api 0.3.0, les approbations/refus, la reprise et l’idempotence.
- Audit des dépendances d’exécution : aucune vulnérabilité connue signalée.
- Connexion manuelle du compte effectuée par le propriétaire via noVNC.
- Accès noVNC authentifié vérifié avec un client en lecture seule ; aucun message
  ChatGPT envoyé par cette vérification.
- Deux messages utilisateur ont été acceptés dans le même fil ChatGPT, espacés
  de plus de vingt minutes. Le premier essai, avec l’adaptateur initial, a laissé
  une réponse vide et a été conservé comme interrompu. Une tentative intermédiaire
  est restée en brouillon et n’a pas été renvoyée automatiquement.
- Avec l’adaptateur corrigé, la réponse au second message a été récupérée et le
  code du premier message a été rappelé correctement, après redémarrage du service.
  Le journal de ce tour confirme une seule soumission du formulaire et aucun appel
  Stop détecté. Aucun autre message modèle n’a été envoyé pendant la validation.

L’interface actuelle utilise de nouveaux attributs pour les messages, un libellé
de langage devant les blocs de code et un comportement Entrée qui peut insérer
un saut de ligne. Le moteur local prend ces éléments en charge, vérifie que le
message est apparu dans le fil et ne clique jamais un bouton Envoyer/Stop.

La boucle d’actions a été validée automatiquement avec des fournisseurs internes
aux tests. Elle n’a pas été exercée contre Plus afin de limiter les demandes réelles.
La sélection exacte du modèle et les allocations du compte ne sont pas mesurées
par le service ; il utilise uniquement l’interface normale de ChatGPT.com.

Des instantanés préliminaires ont mesuré environ 0,5 Gio PSS au repos et 1,1 Gio
pendant l’essai initial pour l’ensemble des processus gérés. Ce ne sont pas des
maxima garantis. Le fonctionnement prolongé sous une limite de 1 CPU / 1–2 Go,
les réponses longues et une campagne multi-conversations réelle restent à qualifier.

## Préparation Proxmox

- Installateur Ubuntu 24.04 : syntaxe Bash et aperçu sans mutation vérifiés.
- Unité systemd : syntaxe vérifiée avec systemd 255 ; le chemin de l’exécutable
  a été remplacé temporairement pour cette vérification, sans installer l’unité.
- Séparation des données et du cache Chromium vérifiée par les tests.
- Archive serveur générée, SHA-256 vérifié et extraction suivie d’un aperçu de
  l’installateur réussie. Les tests vérifient l’exclusion des données privées,
  des dépendances, du guide SSH privé et des liens symboliques ; l’archive réelle
  contient 42 fichiers.
- Disponibilité du fichier SHA-256 officiel Node.js 24.22.1 vérifiée.

Aucune requête ChatGPT supplémentaire n’a été effectuée pour cette préparation.

## Installation sur la VM — 22 octobre 2026

- Installation réelle sur Ubuntu Server 24.04.4, x86-64, 1 vCPU, environ 2 Gio de
  RAM et 2 Gio de swap. Extension du volume racine ext4 dans l’espace LVM libre
  du disque virtuel de 20 Gio ; environ 12 Gio libres après installation.
- Node.js 24.22.1 vérifié par SHA-256, dépendances npm verrouillées, Chromium,
  Xvfb, x11vnc, noVNC/websockify et QEMU Guest Agent installés.
- Un premier démarrage a révélé des fichiers source privés devenus illisibles
  après changement de propriétaire. L’installateur accorde désormais explicitement
  la lecture et la traversée au groupe du service, sans droit d’écriture. La
  nouvelle installation a démarré correctement ; ces permissions ont été vérifiées
  sous l’identité non privilégiée du service.
- `chatgpt-bridge.service` actif et activé au démarrage ; QEMU Guest Agent actif.
  `/healthz` retourne `ok`, l’accès non authentifié à `/v1/status` retourne `401`,
  et les deux serveurs API/moteur écoutent uniquement sur `127.0.0.1`.
- `doctor` a reconnu les dépendances et le navigateur réel, avec une session
  `login_required` et aucune demande en file. Le profil local n’a pas été copié.
- Sauvegarde à froid réelle créée sous `/var/backups/chatgpt-bridge`, fichier
  root `0600`, contenu vérifié et reprise du service confirmée par `/healthz`.
  Cette sauvegarde initiale précède la connexion au compte Plus sur la VM.
- Guide de maintenance inclus dans la livraison. Guide SSH local en mode `0600`,
  ignoré par Git et exclu de l’archive de code.
- Accès HTTP noVNC vérifié sur la VM et via le tunnel SSH du PC : port local
  `16081` vers le port `6081` de la VM. Le guide précise que le tunnel doit être
  lancé sur le PC et que l’URL locale utilise `16081`.
- Connexion manuelle effectuée par le propriétaire sur la VM. Le service a reconnu
  `session: ready`, avec une file vide et la maintenance fermée. Une seconde
  sauvegarde privée du profil connecté a été créée, puis l’état `ready` a été
  confirmé après le redémarrage associé à cette sauvegarde.

Aucun message ChatGPT n’a été envoyé pendant l’installation. Une réponse réelle,
le redémarrage complet de la VM, la restauration d’une sauvegarde et le retour à
une ancienne version fonctionnelle ne font pas partie de cette validation.
La charge prolongée sous les ressources de cette VM reste à qualifier.

## Mise à jour API pour les apps du LAN — 22 octobre 2026

- Nouvelle version construite et activée dans la VM existante, avec une archive
  de code de 48 fichiers vérifiée par SHA-256. Le guide `API.md`, le client app
  compilé et ses déclarations TypeScript sont présents dans la version installée.
- Sauvegarde à froid du profil, de SQLite et de la configuration créée et son
  archive vérifiée avant la mise à jour. L’ancien code et la configuration ont
  été restaurés lors d’un premier contrôle lancé depuis un répertoire privé
  inaccessible au compte du service ; le contrôle corrigé a ensuite réussi.
- Les 33 tests locaux avaient réussi ; les 14 tests d’accès LAN, du contrat HTTP
  et du client app ont aussi réussi sur la VM sous le compte non privilégié,
  depuis le répertoire de la nouvelle version. Ils n’utilisent pas le compte réel.
- API activée sur le LAN avec un sous-réseau privé précis et une liste d’hôtes
  explicite. Le moteur reste sur loopback et la maintenance reste locale.
  Le guide SSH privé contient l’adresse et les paramètres propres à l’instance.
- Depuis une autre machine du LAN : `/healthz` retourne `200`, `/v1/status`
  sans jeton ou avec un mauvais jeton retourne `401`, et les appels authentifiés
  d’état, d’historique et du contrat OpenAPI retournent `200`. Un hôte ou une
  origine non autorisés et l’accès distant à la maintenance retournent `403`.
- Service actif et activé au démarrage, session `ready`, file vide, maintenance
  fermée. Aucun message ChatGPT n’a été soumis pour ce déploiement.
