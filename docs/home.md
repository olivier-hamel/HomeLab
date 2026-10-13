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

Les tâches et le moteur de recherche sont conservés par compte sur cet appareil.
Les clés historiques `tempo:tasks:v1:<compte>` et
`clear-calendar:preferences:v1:<compte>` restent utilisées : les anciennes
tâches apparaissent automatiquement et les réglages du calendrier sont préservés.
Les tâches inachevées restent visibles le lendemain; les tâches terminées sont
visibles le jour où elles ont été cochées. Les onglets du même navigateur se
mettent à jour entre eux. Sans stockage disponible, les tâches restent utilisables
pour la session, y compris pendant la navigation entre apps.

L’agenda lit `/api/calendar/events` avec la session HomeLab. Il réutilise les
modules de dates et de récurrence de Tempo servis à `/calendar/js/events.js`, afin
que les répétitions et les événements sur plusieurs jours suivent les mêmes
règles. Le service `calendar` doit donc être disponible pour cet aperçu.
L’agenda se rafraîchit chaque minute et au retour sur l’onglet, en conservant les
textes saisis. Une erreur affiche un bouton pour réessayer; les tâches restent
disponibles.

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
