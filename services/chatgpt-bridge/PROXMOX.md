# Installer le service autonome dans Proxmox

## Choix recommandé

Créer une **VM dédiée Ubuntu Server 24.04 LTS**, avec le service Node.js lancé
directement par systemd. Elle reste indépendante de la VM HomeLab.

| Choix | Intérêt | Décision pour ce service |
| --- | --- | --- |
| VM KVM | Noyau et système complets, isolation et dépendances prévisibles | Recommandé pour commencer |
| LXC non privilégié | Moins de ressources pour le système invité ; noyau partagé | Possible, mais le navigateur et les restrictions LXC restent à qualifier |
| Docker dans une VM | Utile pour une organisation déjà centrée sur Docker | Couche supplémentaire peu utile ici ; cette livraison utilise systemd |

Proxmox décrit les conteneurs comme partageant le noyau de l’hôte et présente la
VM comme une frontière d’isolation plus forte. Le choix de la VM est notre
recommandation pour ce navigateur persistant, pas une affirmation que LXC serait
incompatible. Sources : [documentation Proxmox](https://github.com/proxmox/pve-docs/blob/master/pct.adoc),
[systèmes pris en charge par Playwright](https://playwright.dev/docs/intro#system-requirements).

Configuration initiale proposée :

| Paramètre Proxmox | Valeur |
| --- | --- |
| Nom | `chatgpt-bridge` |
| OS | Ubuntu Server 24.04 LTS, sans bureau |
| CPU | 1 socket, 1 cœur, type `host` si aucune migration entre CPU différents n’est prévue |
| Mémoire | 2 048 Mio fixes ; désactiver le ballooning pour cette première qualification |
| Disque | 20 Gio, SCSI/VirtIO ; thin provisioning et discard si le stockage le permet |
| Réseau | VirtIO sur le bridge LAN approprié ; réservation DHCP |
| Options | Démarrage automatique et QEMU Guest Agent |
| Swap invité | 1 Gio recommandé si aucun swap n’existe déjà |

Le budget de 1 CPU / 2 Go reste à qualifier sous charge prolongée. Un Gio de RAM
est trop serré au vu des premières mesures de Chromium. Le swap est une marge
contre les pics, sans remplacer la RAM. Si la VM échange beaucoup ou redémarre
sur manque de mémoire, passer à 3–4 Go ; ajouter un second vCPU si la latence gêne.
Le service limite initialement son CPU à 100 % d’un cœur et applique une pression
mémoire à partir de 1 536 Mio, sans plafond mémoire additionnel à celui de la VM.

## 1. Créer la VM

Dans Proxmox, utiliser l’ISO Ubuntu Server 24.04, les paramètres ci-dessus, un
compte administrateur personnel et OpenSSH Server. Choisir une adresse LAN stable.
Activer le pare-feu selon les conventions du réseau ; l’unique accès entrant
nécessaire est SSH depuis les machines administratrices. Le service conserve
toutes ses écoutes API/noVNC/VNC sur `127.0.0.1` par défaut. Pour une app sur le
même LAN, [API.md](API.md) décrit l’écoute API sur le LAN privé de la VM et
le filtrage obligatoire du sous-réseau ; VNC/noVNC restent sur loopback.

Dans les commandes suivantes, remplacer `admin@IP_VM` par le compte et l’adresse
de cette **nouvelle VM**. L’installateur refuse l’hôte Proxmox. Il ne crée pas la
VM, ne touche pas à sa configuration réseau et n’installe pas de bureau graphique.

## 2. Déployer un commit Git

Sur la machine de développement, vérifier et committer les changements du
service, puis lancer ces commandes depuis la racine du dépôt HomeLab :

```sh
bash services/chatgpt-bridge/deployment/deploy-git.sh --dry-run admin@IP_VM main
BRIDGE_SSH_KEY="$HOME/.ssh/id_ed25519" \
  bash services/chatgpt-bridge/deployment/deploy-git.sh admin@IP_VM main
```

Le compte administrateur de la VM doit permettre `sudo -n` pour ce déploiement.
La clé SSH reste sur le PC ; `BRIDGE_SSH_KEY` est facultatif si SSH trouve déjà
la bonne clé. La vérification de la clé d’hôte reste active. La référence Git
peut être une branche locale ou un SHA complet ; elle vaut `HEAD` par défaut.
Les modifications du service non committées bloquent le déploiement.

Le script transfère l’historique committé dans un **bundle Git**, puis le récupère
dans `/opt/chatgpt-bridge/repository.git` sur la VM. Aucun push GitHub n’est
nécessaire. Le bundle contient l’historique du dépôt ; les fichiers ignorés tels
que le profil Chromium, les jetons, SQLite, `.env`, node_modules et dist ne sont
pas transférés. La VM prépare un checkout détaché du commit exact et installe
uniquement le dossier du service. Le dépôt Git et les données privées restent
hors des versions exécutées.

L’installateur cible Ubuntu 24.04 x86-64 ou arm64. Il installe Git si nécessaire,
les paquets Linux, le QEMU Guest Agent, Node.js 24.22.1 avec vérification SHA-256,
les dépendances verrouillées et Chromium. Il compile sous un compte non privilégié,
puis rend le code non modifiable par ce compte. Il démarre et active le service.
Il vérifie `/healthz` et l’état de session sans poser de question à ChatGPT.
La version active contient `GIT_REVISION` pour identifier le commit installé :

```sh
ssh admin@IP_VM
sudo cat /opt/chatgpt-bridge/app/GIT_REVISION
sudo chatgpt-bridge status --refresh
```

Sur une première installation, se connecter au compte dans la session noVNC.
Les déploiements suivants conservent le profil et les jetons propres à la VM.

## 3. Connexion initiale via noVNC

Sur le PC, dans un terminal distinct, établir le tunnel :

```sh
ssh -N -L 16081:127.0.0.1:6081 admin@IP_VM
```

Dans le terminal SSH de la VM :

```sh
sudo chatgpt-bridge session open
```

Sur le PC, ouvrir **http://127.0.0.1:16081/vnc.html?resize=scale**, puis saisir le
mot de passe noVNC temporaire affiché dans le terminal de la VM. Le port local
16081 évite de confondre la VM avec une instance locale sur 6081. Se connecter
au compte ChatGPT Plus, puis vérifier :

```sh
sudo chatgpt-bridge status --refresh
sudo chatgpt-bridge ask "Bonjour"
```

La première commande ne pose pas de question au modèle. La seconde est un essai
réel facultatif ; ne pas lancer plusieurs campagnes de test en parallèle.
Les conversations et approbations se gèrent ensuite avec la même CLI, par exemple
`sudo chatgpt-bridge approve ACTION_ID` ou `sudo chatgpt-bridge deny ACTION_ID`.
L’accès noVNC expire après quinze minutes et n’intervient pas pour les échanges
ou décisions ordinaires.

Pour examiner un fil : `sudo chatgpt-bridge session open --inspect`, puis
`sudo chatgpt-bridge session close`. Une reconnexion peut être nécessaire après
un changement d’adresse IP ou un contrôle de compte ; elle reste manuelle.

## 4. Exploitation et emplacements

Voir aussi [le guide de maintenance](MAINTENANCE.md) pour les contrôles courants,
les mises à jour, les sauvegardes et le dépannage.

| Élément | Chemin |
| --- | --- |
| Version de code active | `/opt/chatgpt-bridge/app` → version sous `releases/` |
| Cache Git des sources | `/opt/chatgpt-bridge/repository.git` |
| Node.js du service | `/opt/chatgpt-bridge/node` → version sous `runtimes/` |
| Configuration | `/etc/chatgpt-bridge/bridge.env` |
| Base, profil, jetons, verrous | `/var/lib/chatgpt-bridge/` |
| Navigateurs et cache npm | `/var/cache/chatgpt-bridge/` |
| CLI | `/usr/local/bin/chatgpt-bridge` |

```sh
sudo systemctl status chatgpt-bridge --no-pager
sudo journalctl -u chatgpt-bridge -n 100 --no-pager
sudo systemctl restart chatgpt-bridge
sudo systemctl stop chatgpt-bridge
sudo chatgpt-bridge status
```

Le compte `chatgpt-bridge` n’a pas de connexion interactive. systemd démarre le
service sans root, conserve les données hors du code et nettoie aussi les processus
enfants restants lors d’un arrêt forcé. Un redémarrage interrompant un envoi marque
celui-ci comme ambigu : aucune resoumission automatique n’est effectuée.

Les ports et délais peuvent être modifiés avec
`sudoedit /etc/chatgpt-bridge/bridge.env`, puis un redémarrage. Conserver les deux
chemins de stockage fournis : l’unité systemd limite les écritures à ces emplacements.
Pour lever la limite CPU après passage à deux vCPU :

```sh
sudo systemctl edit chatgpt-bridge
```

Ajouter `[Service]` puis `CPUQuota=200%`, et redémarrer le service.

Si l’API doit être appelée depuis le PC, ajouter un tunnel
`ssh -N -L 13211:127.0.0.1:3211 admin@IP_VM`. Utiliser alors le jeton **de la VM**,
stocké dans `/var/lib/chatgpt-bridge/api-token`, avec le client appelant. Ce jeton
local n’est pas une clé OpenAI. Aucune ouverture de port API sur le LAN n’est requise.

Pour qu’une app appelle directement l’API depuis le même LAN, suivre
[API.md](API.md) : définir `BRIDGE_HOST=0.0.0.0`, `BRIDGE_ALLOWED_HOSTS` avec
l’adresse privée de la VM et `BRIDGE_LAN_CIDRS` avec le sous-réseau local, puis
redémarrer. Le service refuse les adresses clientes extérieures à ce sous-réseau,
même avec un jeton valide.

## 5. Mise à jour et sauvegarde

Commiter la nouvelle version et relancer `deployment/deploy-git.sh` depuis le
PC en choisissant sa branche ou son SHA. Le déploiement exige une file vide et
crée une sauvegarde privée à froid avant l’installation. Le code est construit
avant l’arrêt de l’ancienne version ; configuration et données sont conservées.
Si la nouvelle version ne répond pas à `/healthz`, l’installateur rétablit les
anciens liens et redémarre la version précédemment active. Le commit est inscrit
dans `GIT_REVISION` et dans le cache Git. Les anciennes versions restent
conservées ; surveiller l’espace disque au fil des mises à jour.

Avant une mise à jour importante, faire une sauvegarde Proxmox de la VM. Pour
une copie des seules données applicatives et de la configuration :

```sh
sudo chatgpt-bridge-backup /chemin/prive/chatgpt-bridge-backup.tar.gz
```

La destination doit être un nouveau fichier dans un dossier existant. Le script
arrête proprement le service pour copier SQLite et le profil, puis le redémarre
s’il était actif. Cette archive contient la session et les jetons : la conserver
dans le stockage privé des sauvegardes. Chromium peut être téléchargé de nouveau.

Pour restaurer sur la même VM : arrêter le service, extraire la sauvegarde sous
`/`, rétablir le propriétaire `chatgpt-bridge:chatgpt-bridge` de `/var/lib/chatgpt-bridge`,
puis redémarrer et vérifier l’état. Sur une nouvelle VM, privilégier une connexion
manuelle au compte ; la portabilité d’un profil Chromium n’est pas garantie.

## Validation du déploiement

L’installation a été effectuée dans la VM Ubuntu 24.04 le 22 octobre 2026.
Le service systemd, le diagnostic, l’authentification API, les écoutes loopback,
le QEMU Guest Agent et la reprise après sauvegarde à froid ont été vérifiés.
Le guide SSH propre à cette instance reste local et ignoré par Git.
Voir [VALIDATION.md](VALIDATION.md) pour les résultats et les limites.

La connexion manuelle du compte a été effectuée et l’état `ready` confirmé après
redémarrage du service. Aucun message ChatGPT n’a été envoyé pendant ce
déploiement ; la charge prolongée et un redémarrage complet de la VM restent
à qualifier.
