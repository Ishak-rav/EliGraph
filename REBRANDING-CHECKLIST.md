# Rebranding Lokka → EliGraph — checklist WS0

> À exécuter dans une branche dédiée `ws0-rebranding`.
> Faire des commits atomiques par section pour faciliter la review.

## Stratégie

Le rebranding doit :

1. Ne **pas** casser la build existante.
2. Conserver le crédit attribué à Merill Fernando et Lokka (licence MIT, README, code
   d'origine).
3. Renommer ce qui est notre (package npm, repo, identifiants internes).
4. Garder les références à Lokka **uniquement** dans : la mention de fork, la licence,
   les noms internes de variables d'env historiques (`TENANT_ID`, etc.), et les
   commentaires de code qui décrivent le code d'origine.

## 1. Fichiers de configuration npm

### `src/mcp/package.json`

Modifier :

```diff
- "name": "@merill/lokka",
+ "name": "@eliadis/eligraph",

- "description": "MCP server for Microsoft Graph and Azure RM APIs",
+ "description": "EliGraph — MCP server for Microsoft 365 and Azure with delegated auth, HTTP transport, and audit trail. Fork of @merill/lokka.",

- "author": "Merill Fernando",
+ "author": "Ishak Chennouf <ichennouf@eliadis.fr>",
+ "contributors": [
+   "Merill Fernando (original Lokka author)"
+ ],

- "repository": "github:merill/lokka",
+ "repository": "github:<ton-org>/eligraph",

  "bin": {
-   "lokka": "build/index.js"
+   "eligraph": "build/index.js"
  }
```

⚠️ **Ne pas oublier** :

- Réinitialiser la version à `0.1.0` (on repart d'un cycle propre)
- `npm install` après pour régénérer `package-lock.json`
- Vérifier que `npm run build` passe toujours

### `src/mcp/package-lock.json`

Sera régénéré par `npm install`. Vérifier que le champ `"name"` racine est bien
`@eliadis/eligraph` après régénération.

## 2. Code source

### `src/mcp/src/index.ts` (et tout fichier .ts qui mentionne "Lokka")

Rechercher toutes les occurrences :

```bash
cd src/mcp/src
grep -rn -i "lokka" .
```

Pour chaque occurrence, juger au cas par cas :

| Cas | Action |
|---|---|
| Nom d'outil MCP exposé (`Lokka-Microsoft`) | **Renommer** `EliGraph-Microsoft` (mais : breaking change pour les utilisateurs Lokka qui forkeraient EliGraph — assumé pour un usage interne) |
| Nom du serveur MCP dans `Server({ name: "lokka", ... })` | Renommer `eligraph` |
| Logs ou messages d'erreur `"Lokka starting..."` | Renommer `"EliGraph starting..."` |
| Commentaire qui décrit l'origine du code | **Garder** la mention Lokka |
| URL de doc `lokka.dev` dans messages d'aide | Remplacer par lien vers le repo EliGraph (ou garder en attendant qu'on ait notre doc) |

### Décision sur le nom de l'outil MCP

Tu as deux options :

**Option A — Renommer en `EliGraph-Microsoft`**
- ✅ Cohérent avec le branding
- ❌ Casse la rétrocompatibilité avec les configs MCP existantes des utilisateurs

**Option B — Garder `Lokka-Microsoft`**
- ✅ Drop-in replacement de Lokka pour les utilisateurs existants
- ❌ Confusion sur ce qui est qui

**Recommandation** : Option A. Pour un usage interne Eliadis sans utilisateurs externes
encore, c'est le bon moment pour rebrand proprement.

## 3. Documentation

### `README.md` racine

Remplacé par le nouveau README.md fourni.

### `src/mcp/README.md` (s'il existe)

À supprimer ou réduire à une ligne pointant vers le `README.md` racine.

### `LICENSE`

**Garder le copyright Merill Fernando**. Ajouter une ligne pour Eliadis :

```
MIT License

Copyright (c) 2024 Merill Fernando (original Lokka)
Copyright (c) 2026 Ishak Chennouf / Eliadis (EliGraph fork)

Permission is hereby granted, free of charge, ...
```

### `assets/`

Le dossier contient des GIFs de démo Lokka. Deux options :

- **Garder en attendant** des assets EliGraph (rapide)
- **Supprimer** et créer un dossier `docs/assets/` propre quand on aura nos propres
  démos (recommandé pour la propreté)

### `website/`

C'est le site Docusaurus de Lokka (`lokka.dev`). À ce stade, **supprimer entièrement**
le dossier — on n'hostera pas de site, et garder un site qui pointe vers `lokka.dev`
crée de la confusion.

```bash
rm -rf website/
```

Si plus tard tu veux un site EliGraph, on le recréera proprement.

## 4. Repo GitHub

### Description du repo

Sur GitHub.com → Settings → Edit repository details :

```
EliGraph — MCP server for Microsoft 365 with delegated auth, HTTP transport, and audit trail. Fork of merill/lokka.
```

### Topics

Suggestions : `mcp`, `microsoft-365`, `microsoft-graph`, `azure`, `entra-id`, `iga`, `model-context-protocol`, `claude`.

### README badges

Quand le pipeline CI sera vert, ajouter en haut du README :

```markdown
[![CI](https://github.com/<ton-org>/eligraph/actions/workflows/ci.yml/badge.svg)](...)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
```

## 5. Variables d'environnement

Décision : on **garde** `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `USE_GRAPH_BETA`, etc.
pour la compatibilité avec les configs Lokka existantes (au cas où tu importerais une
config). On **ajoute** des nouvelles préfixées `ELIGRAPH_*` pour les nouvelles features :

```bash
# Nouvelles variables EliGraph
ELIGRAPH_TRANSPORT=stdio          # ou "http"
ELIGRAPH_HTTP_PORT=3000
ELIGRAPH_HTTP_HOST=0.0.0.0
ELIGRAPH_ALLOW_APP_ONLY=false
ELIGRAPH_REDIRECT_URI=https://eligraph.example.com/auth/callback
ELIGRAPH_ALLOWED_AUDIENCES=api://<client-id>/access_as_user
ELIGRAPH_AUDIT_FILE=/var/log/eligraph/audit.log
ELIGRAPH_LOG_LEVEL=info
```

Créer `.env.example` à la racine du repo (ou dans `src/mcp/`) avec ces variables
documentées.

## 6. Git remotes

Configurer le double remote dès le début pour pouvoir suivre l'upstream :

```bash
# origin = ton fork
git remote -v
# devrait afficher :
# origin  https://github.com/<ton-org>/eligraph.git (fetch)
# origin  https://github.com/<ton-org>/eligraph.git (push)

# Ajouter upstream
git remote add upstream https://github.com/merill/lokka.git
git remote -v
# devrait maintenant afficher origin + upstream

# Fetch upstream pour avoir ses branches dispo
git fetch upstream
```

## 7. Commits à faire (atomiques)

Je suggère cette séquence dans la branche `ws0-rebranding` :

```bash
git checkout -b ws0-rebranding

# Commit 1 — ajout des docs
git add ARCHITECTURE.md CLAUDE.md README.md REBRANDING-CHECKLIST.md
git commit -m "docs(ws0): add ARCHITECTURE, CLAUDE, README, rebranding checklist"

# Commit 2 — package.json + package-lock
# (modifier package.json puis npm install)
git add src/mcp/package.json src/mcp/package-lock.json
git commit -m "refactor(ws0): rename npm package from @merill/lokka to @eliadis/eligraph"

# Commit 3 — code source (renommage Lokka → EliGraph dans le code)
git add src/mcp/src/
git commit -m "refactor(ws0): rebrand Lokka identifiers to EliGraph in source"

# Commit 4 — LICENSE
git add LICENSE
git commit -m "docs(ws0): add Eliadis copyright while preserving original Lokka attribution"

# Commit 5 — supprimer website/
git rm -rf website/
git commit -m "chore(ws0): remove upstream Lokka docusaurus site"

# Commit 6 — .env.example
git add src/mcp/.env.example
git commit -m "docs(ws0): add .env.example with EliGraph variables"

# Commit 7 — CI
git add .github/workflows/ci.yml
git commit -m "ci(ws0): add minimal GitHub Actions pipeline (build + test)"

# Push et ouvrir une PR vers main
git push origin ws0-rebranding
```

## 8. Vérifications finales avant merge

- [ ] `npm install` passe sans erreur dans `src/mcp/`
- [ ] `npm run build` passe sans erreur
- [ ] `npm test` passe (même si ça ne teste presque rien à ce stade)
- [ ] `grep -rn -i "lokka" src/mcp/src/` ne retourne plus que des mentions de fork
      ou commentaires d'origine assumés
- [ ] Le README s'affiche correctement sur GitHub
- [ ] La CI GitHub Actions est verte sur la branche
- [ ] L'instance MCP démarre toujours en stdio :
      `node src/mcp/build/index.js` ne crashe pas

## 9. Ce qu'on **ne fait pas** pendant WS0

- Pas de feature nouvelle (HTTP, OBO, audit, etc.). Ces sujets sont WS1+.
- Pas de refactor architectural lourd. On peut commencer à créer les dossiers
  `transports/`, `auth/`, `audit/`, `config/` comme placeholder vides avec un
  `index.ts` qui re-export l'existant, mais on **ne déplace rien encore**.
- Pas de changement de la stack (Express reste, npm reste, etc.).
