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

## 2. Préparer et transférer l’archive

Sur la machine de développement, depuis le dossier du service :

```sh
npm run package:server
```

L’archive `.local-data/packages/chatgpt-bridge-server-0.1.0.tar.gz` contient le code,
le verrou npm, les tests et les fichiers de déploiement. Elle exclut **le profil
Chromium, les jetons, la base de conversations, `.env`, node_modules et dist**.
Le fichier `.sha256` permet de vérifier le transfert.

```sh
scp .local-data/packages/chatgpt-bridge-server-0.1.0.tar.gz* admin@IP_VM:~/
ssh admin@IP_VM
sha256sum --check chatgpt-bridge-server-0.1.0.tar.gz.sha256
mkdir -p ~/chatgpt-bridge-source
tar -xzf ~/chatgpt-bridge-server-0.1.0.tar.gz -C ~/chatgpt-bridge-source
cd ~/chatgpt-bridge-source
bash deployment/install-ubuntu.sh --dry-run
sudo bash deployment/install-ubuntu.sh
```

L’installateur cible Ubuntu 24.04 x86-64 ou arm64. Il installe les paquets Linux,
le QEMU Guest Agent, Node.js 24.22.1 depuis nodejs.org avec vérification SHA-256,
les dépendances verrouillées et Chromium. Il compile sous un compte non privilégié,
puis rend le code non modifiable par ce compte. Il démarre et active le service.
Il vérifie uniquement l’API locale `/healthz` : **aucune question ChatGPT**.
L’option `--no-start` active le démarrage au prochain boot sans démarrer immédiatement.

L’archive ne transporte pas la connexion locale : se connecter une nouvelle fois
sur la VM évite de déplacer les cookies et les clés de chiffrement du navigateur.

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

Créer une nouvelle archive, l’extraire dans un nouveau dossier source de la VM
et relancer l’installateur. Le code est construit avant l’arrêt de l’ancienne
version ; configuration et données ne sont pas remplacées. Si la nouvelle version
ne répond pas à `/healthz`, l’installateur rétablit les anciens liens et redémarre
la version précédemment active. Les anciennes versions sont conservées pour un
retour manuel ; surveiller l’espace disque au fil des mises à jour.

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
