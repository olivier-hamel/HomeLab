# Accueil

Accueil est une app native de HomeLab, distincte de Tempo. Elle s’ouvre après
connexion et via `/?section=home`. Son interface utilise une palette bleu
glacier, indigo et menthe. Tempo reste accessible via `/?section=calendar` et
ouvre directement la vue mois.

La page propose une recherche Google ou DuckDuckGo, les tâches à faire,
l’agenda du jour, les trois premiers événements des 14 prochains jours,
une bande des sept prochaines dates et des accès aux autres apps. Les dates et
l’heure suivent Toronto. `/` place le curseur dans la recherche; Entrée lance
la recherche dans l’onglet courant.

Les tâches sont enregistrées dans MongoDB par compte, avec les événements de
Tempo. « Mes tâches » affiche les tâches inachevées, même en retard ou sans
échéance, puis celles terminées aujourd’hui. « Voir les terminées » permet de
consulter et rouvrir les autres. Une coche change l’état dans Tempo et Accueil;
le titre ouvre le dialogue complet, avec échéance, notes, liens, documents de
Bibliothèque et cours ou projet facultatif. L’ajout rapide crée une tâche pour
aujourd’hui; « Créer avec le dialogue » ouvre la création assistée de Tempo.

Une tâche récurrente affiche sa première échéance non terminée, même en retard,
puis la suivante après la coche. Chaque date a son propre état. Les occurrences
terminées aujourd’hui restent affichées; « Voir les terminées » donne accès aux
autres. La suppression d’une tâche récurrente ouvre Tempo pour confirmer la
suppression de toute la série. Les règles, notes et ressources se modifient dans
le même dialogue que les événements.

Les anciennes tâches du navigateur (`tempo:tasks:v1:<compte>`) sont transférées
une à une, avec un identifiant stable pour reprendre un transfert interrompu
sans doublons. Elles sont retirées du stockage local seulement après réussite.
Le moteur de recherche et les préférences du calendrier restent sur l’appareil,
dans `clear-calendar:preferences:v1:<compte>`.

L’agenda lit `/api/calendar/events` avec la session HomeLab. Il réutilise les
modules de dates et de récurrence de Tempo servis à `/calendar/js/events.js`, afin
que les répétitions et les événements sur plusieurs jours suivent les mêmes
règles. Le service `calendar` doit donc être disponible pour cet aperçu.
L’agenda se rafraîchit chaque minute et au retour sur l’onglet, en conservant les
textes saisis. Une erreur affiche un bouton pour réessayer. Les tâches et
l’agenda utilisent le même service; une écriture refusée rétablit la coche et
conserve les détails saisis. Les tâches Moodle de la session actuelle y
apparaissent après la [synchronisation automatique](calendar.md#tâches-et-moodle).

Cliquer un événement ouvre ses détails dans Tempo à la date de l’occurrence.
La modification d’un événement récurrent continue de s’appliquer à toute la
série. Les dates ouvrent la vue jour; « Ouvrir Tempo » ouvre la vue semaine.
« Prévoir un moment » ouvre la création d’événement dans Tempo. Les boutons
précédent et suivant du navigateur permettent de revenir aux apps visitées.

Les sources se trouvent dans `frontend/src/pages/Home.tsx`, `home.css` et
`frontend/src/lib/home.ts`. L’app utilise le service frontend existant et ne
demande aucun conteneur ni port supplémentaire.

Les tests frontend vérifient la reprise des données, le stockage, les dates et
les liens. Avec le frontend lancé, `node scripts/test-home-ui.mjs` depuis la
racine vérifie les interactions, les API en erreur, les répétitions, les comptes
et six tailles d’écran. Les captures sont dans `artifacts/home/`. Pour un autre
port, définis `HOMELAB_UI_URL=http://localhost:3010`.
Après `npm run build` dans `frontend/`, `node scripts/test-calendar-tasks-ui.mjs`
teste directement les fichiers construits et les modules Tempo avec des API
simulées, sans serveur de développement. Les captures sont dans
`artifacts/calendar-tasks/`.
