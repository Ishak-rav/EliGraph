# EliGraph — Architecture & roadmap

> Fork de [merill/lokka](https://github.com/merill/lokka) (MIT) — serveur MCP pour piloter
> un tenant Microsoft 365 / Azure en langage naturel via Microsoft Graph et Azure ARM.
>
> EliGraph se distingue de Lokka par : auth déléguée stricte (refus de l'app-only en prod),
> transport HTTP remote (Streamable HTTP), audit trail JSON structuré, observabilité
> Grafana + Loki, et guardrails métier.

## 1. Décisions d'architecture

| Domaine | Décision | Justification |
|---|---|---|
| Runtime | Node.js 22 LTS | Node 20 actions GitHub dépréciées le 16 juin 2026 |
| Langage | TypeScript strict + `isolatedModules` | `isolatedModules` réduit la consommation mémoire de tsc |
| HTTP server | Express 5 | Conservé de Lokka, async error handling natif en v5 |
| MCP SDK | `@modelcontextprotocol/sdk` ≥ 1.26.0 | Versions ≤ 1.25.3 : 3 CVE high (ReDoS, data leak, DNS rebinding) |
| Transport remote | Streamable HTTP (spec 2025-03-26) | SSE déprécié au profit de Streamable HTTP |
| Auth Microsoft | `@azure/identity` 4.x (déjà présent) | `OnBehalfOfCredential` + `AzureCliCredential` + `DeviceCodeCredential` |
| Logging | `logger.ts` existant (à migrer vers pino — WS3) | Migration pino prévue en WS3 |
| Tests | vitest + supertest | Léger, ESM natif |
| Conteneur | Docker multi-stage, base `node:22-alpine` | Image finale légère |
| Reverse proxy | nginx + Let's Encrypt (certbot) | Standard sur VPS |
| CI/CD | GitHub Actions → GHCR → SSH deploy | Simple et auto-hébergé |
| Config | Zod centralisé dans `src/config/env.ts` | Validation au démarrage, aucun `process.env.X` dispersé (WS2) |

## 2. Couches de l'architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Clients MCP                                                 │
│  Claude Desktop (stdio) │ Claude.ai │ Copilot Studio │ ...  │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
        ┌──────▼──────┐        ┌──────▼─────────────────┐
        │ stdio       │        │ Streamable HTTP /mcp   │
        │ JSON-RPC    │        │ POST + SSE upgrade     │
        │ over pipe   │        │ OAuth 2.1 Bearer       │
        └──────┬──────┘        └──────┬─────────────────┘
               │                      │
               └──────────┬───────────┘
                          │
       ┌──────────────────▼──────────────────────┐
       │ EliGraph core (Node.js / TypeScript)    │
       │                                         │
       │  ┌──────────┐  ┌──────────┐  ┌────────┐ │
       │  │   Auth   │  │   Tool   │  │ Audit  │ │
       │  │ resolver │─▶│dispatcher│─▶│ logger │ │
       │  └──────────┘  └──────────┘  └────────┘ │
       └──────────────────┬──────────────────────┘
                          │
                ┌─────────▼─────────┐
                │ Graph + ARM client│
                │ axios + retry +   │
                │ throttling + batch│
                └─────────┬─────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     ┌────────────────┐    ┌──────────────────┐
     │ Microsoft Graph│    │   Azure ARM      │
     │ (Entra, Intune,│    │ (Subs, RBAC,     │
     │  Exchange…)    │    │  cost mgmt)      │
     └────────────────┘    └──────────────────┘
```

### Auth resolver

Stratégie selon le mode :

- **stdio** : `AzureCliCredential` (défaut) ou `DeviceCodeCredential`
- **HTTP remote** : `OnBehalfOfCredential` strict — extrait le Bearer entrant, l'échange contre un token Graph downstream

Refus explicite de l'app-only (`CLIENT_SECRET` / `USE_CERTIFICATE`) quand `ELIGRAPH_ALLOW_APP_ONLY=false` (défaut). Le serveur logue un warning et exit(1) si quelqu'un tente de démarrer en app-only sans avoir explicitement opt-in.

### Tool dispatcher

Reprend les outils Lokka existants (`Lokka-Microsoft` qui couvre Graph + ARM, `set-access-token`, `get-auth-status`). Ajoute une couche de guardrails (WS5) qui inspecte chaque appel avant exécution :

- DELETE sur `/users/*` → require_confirmation
- POST sur `/groups/{id}/members` avec >50 membres → block sauf rôle admin
- Toute opération sur des groupes nommés "Tenant Admins", "Global Admins" → require_confirmation

Règles déclaratives en YAML, chargées au démarrage.

### Audit logger

pino avec sérializers custom. Chaque entrée contient :

```json
{
  "ts": "2026-05-07T14:32:01.123Z",
  "level": "info",
  "session_id": "mcp-sess-abc123",
  "event": "tool_call",
  "user_upn": "john.doe@contoso.com",
  "mcp_tool": "Lokka-Microsoft",
  "tool_args": { "apiType": "graph", "path": "/users", "method": "get" },
  "graph_method": "GET",
  "graph_path": "/v1.0/users",
  "graph_status": 200,
  "duration_ms": 245,
  "error": null
}
```

Destinations :
- **MVP** : stdout (toujours) + fichier JSON rotatif (`/var/log/eligraph/audit.log`)
- **Plus tard** : push HTTP vers Loki, Azure Monitor

Champs plats, pas de nesting profond → Loki-friendly dès le début.

## 3. Structure du repo

```
eligraph/
├── src/
│   ├── index.ts                  # Entry point — détecte stdio vs http
│   ├── transports/
│   │   ├── stdio.ts              # Wrapper StdioServerTransport
│   │   └── http.ts               # Express + StreamableHTTPServerTransport
│   ├── auth/
│   │   ├── resolver.ts           # Choix de la stratégie
│   │   ├── azure-cli.ts
│   │   ├── device-code.ts
│   │   └── obo.ts                # OnBehalfOfCredential + extraction Bearer
│   ├── tools/
│   │   ├── microsoft-graph.ts    # Outil MCP (existe dans Lokka)
│   │   ├── azure-arm.ts
│   │   ├── token-mgmt.ts         # set-access-token, get-auth-status
│   │   └── guardrails.ts         # Business rules (WS5)
│   ├── clients/
│   │   ├── graph.ts              # axios + retry + 429 handling
│   │   └── arm.ts
│   ├── audit/
│   │   ├── logger.ts             # pino instance configurée
│   │   ├── serializers.ts
│   │   └── transports/
│   │       ├── stdout.ts
│   │       └── file.ts
│   └── config/
│       └── env.ts                # Validation des variables d'env (zod)
├── deploy/
│   ├── docker-compose.yml
│   ├── nginx.conf
│   ├── promtail-config.yml       # WS4
│   └── grafana-dashboards/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── tests/
│   ├── auth/
│   ├── transports/
│   └── e2e/
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
├── ARCHITECTURE.md               # Ce fichier
└── README.md
```

## 4. Roadmap par workstreams

| WS | Sujet | Statut | Dépend de | Notes |
|---|---|---|---|---|
| WS0 | Setup repo, fork, CI minimale, rebranding Lokka → EliGraph | ✅ Terminé | — | Mergé sur `main` (PR #1 à #3) |
| WS1 | Transport HTTP Streamable `/mcp` | ✅ Terminé | WS0 | PR #4 en cours de CI — `ELIGRAPH_TRANSPORT=http\|stdio` |
| WS2 | Config Zod centralisée + refus app-only | ✅ Terminé | WS1 | PR #5 — `src/config/env.ts`, guard app-only |
| WS3 | Audit trail JSON (stdout + fichier rotatif) | ✅ Terminé | WS0 | PR #6 — pino, redaction, audit structuré |
| WS4 | Observabilité Grafana + Loki | 🔄 En cours | WS3 | Branche `ws4-observability` |
| WS5 | Business rules / guardrails | ✅ Terminé | WS3 | PR #8 — engine block/confirm/warn, 8 règles par défaut |
| WS6 | Déploiement VPS + nginx + Let's Encrypt | ✅ Terminé | WS1, WS2, WS3 | PR #7 — Dockerfile, nginx, certbot, deploy.yml |
| WS7 | Connecteur Copilot Studio | ⏳ À faire | WS6 | |

**Total MVP (WS0 à WS3 + WS6)** : environ 10 à 17 jours de dev effectif.

### Dette technique identifiée en WS1

- `add-graph-permission` ouvre un navigateur interactif — cassé en mode HTTP (serveur distant). À corriger en WS2 : désactiver le tool ou implémenter un flow OAuth avec redirect URI selon le transport actif.
- Pas de CORS sur `/mcp` — bloquant pour Copilot Studio et clients browser. À ajouter avant WS7.
- Smoke test CI uniquement en mode stdio. Un smoke test HTTP (démarrage + POST initialize) reste à écrire.

## 5. Pré-requis Microsoft à préparer en parallèle

Avant que WS2 ne soit testable bout-en-bout, il faut une App Registration EliGraph dans le tenant client (ou ton tenant de test perso) :

1. **Créer l'App Registration** "EliGraph"
2. **Expose an API** → ajouter un scope `access_as_user` → URI `api://{eligraph-client-id}/access_as_user`
3. **API permissions (delegated)** : ajouter les scopes Graph nécessaires (`User.Read`, `Directory.Read.All`, etc.) + admin consent si requis
4. **Authentication** :
   - Redirect URI : `https://eligraph.<domaine>/auth/callback`
   - Allow public client flows : non
5. **Certificates & secrets** : créer un secret pour l'échange OBO côté serveur (ou mieux, un certificat)
6. **Stocker les credentials** dans un fichier `.env` local + secrets GitHub Actions pour la CI

Le fichier `.env.example` à committer :

```bash
# Mode de transport
ELIGRAPH_TRANSPORT=stdio        # ou "http"

# App Registration EliGraph
TENANT_ID=
CLIENT_ID=
CLIENT_SECRET=                  # uniquement pour OBO côté serveur
ELIGRAPH_REDIRECT_URI=https://eligraph.example.com/auth/callback

# Sécurité
ELIGRAPH_ALLOW_APP_ONLY=false   # défaut, ne pas modifier en prod
ELIGRAPH_ALLOWED_AUDIENCES=api://<client-id>/access_as_user

# HTTP server (mode http uniquement)
ELIGRAPH_HTTP_PORT=3000
ELIGRAPH_HTTP_HOST=0.0.0.0

# Audit
ELIGRAPH_AUDIT_FILE=/var/log/eligraph/audit.log
ELIGRAPH_LOG_LEVEL=info

# Graph
USE_GRAPH_BETA=false
```

## 6. WS0 — détail (à exécuter aujourd'hui)

```bash
# 1. Fork côté GitHub puis clone
git clone https://github.com/Ishak-rav/eligraph.git
cd eligraph
git remote add upstream https://github.com/merill/lokka.git
git fetch upstream

# 2. Setup branche de travail
git checkout -b ws0-setup

# 3. Mise à jour des deps
cd src/mcp
npm install
npm outdated         # voir ce qui est en retard
npm update           # mises à jour mineures
npm install --save @modelcontextprotocol/sdk@latest

# 4. Ajout des deps EliGraph
npm install --save pino pino-http zod
npm install --save-dev vitest supertest @types/supertest

# 5. Configurer tsconfig strict si pas déjà fait
# Vérifier "strict": true dans src/mcp/tsconfig.json

# 6. Premier commit
git add .
git commit -m "WS0: setup deps, vitest, pino, zod"

# 7. CI minimale
mkdir -p .github/workflows
# Créer .github/workflows/ci.yml (template ci-dessous)
git add .github/workflows/ci.yml ARCHITECTURE.md
git commit -m "WS0: CI minimale + ARCHITECTURE.md"
git push origin ws0-setup
```

Template `.github/workflows/ci.yml` :

```yaml
name: CI

on:
  push:
    branches: [main, "ws*"]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: src/mcp/package-lock.json
      - working-directory: src/mcp
        run: |
          npm ci
          npm run build
          npm test
```

## 7. WS1 — détail (HTTP wrapper) ✅

Implémenté dans la PR #4 (`ws1-http-transport` → `dev`).

**Fichiers créés/modifiés :**

| Fichier | Rôle |
|---|---|
| `src/mcp/src/types.ts` | `AuthCtx` (authManager + graphClient partagés) + `ServerFactory` |
| `src/mcp/src/transports/http.ts` | Express `/mcp` — sessions `Map<sessionId, transport>`, une `McpServer` par session |
| `src/mcp/src/main.ts` | `buildServer(ctx)` factory extraite, `main()` branche sur `ELIGRAPH_TRANSPORT` |

**Points de sécurité appliqués en WS1 :**
- `ELIGRAPH_HTTP_HOST` par défaut `127.0.0.1` (pas `0.0.0.0`)
- Port invalide → `throw` immédiat avec message explicite
- Header `mcp-session-id` normalisé (`string[]` → `string`)
- Lookup session via `get()` unique (pas de race `has()`+`get()`)
- Swap atomique du contexte auth dans `add-graph-permission`
- `ELIGRAPH_TRANSPORT` invalide → `throw` immédiat

**Test manuel :**
```bash
ELIGRAPH_TRANSPORT=http USE_CLIENT_TOKEN=true npm start
# → POST http://localhost:3000/mcp avec body initialize MCP
# → Vérifier header Mcp-Session-Id dans la réponse
```

## 8. WS2 — détail (Config Zod + refus app-only)

**Objectif :** centraliser toute la configuration dans `src/config/env.ts` validée par Zod
au démarrage, et implémenter le refus explicite du mode app-only.

**Étape 1 — `src/config/env.ts`**

Remplace tous les `process.env.X` dispersés dans `main.ts`. Le module exporte un objet
`config` typé, validé à l'import. Si une variable obligatoire manque ou est invalide,
le process exit(1) avec un message clair avant de démarrer quoi que ce soit.

Variables à valider :
- `ELIGRAPH_TRANSPORT` : `"stdio" | "http"`, défaut `"stdio"`
- `ELIGRAPH_HTTP_PORT` : entier 1–65535, défaut `3000`
- `ELIGRAPH_HTTP_HOST` : string, défaut `"127.0.0.1"`
- `ELIGRAPH_LOG_LEVEL` : `"trace"|"debug"|"info"|"warn"|"error"`, défaut `"info"`
- `ELIGRAPH_ALLOW_APP_ONLY` : boolean, défaut `false`
- `TENANT_ID`, `CLIENT_ID` : string optionnels
- `CLIENT_SECRET` : string optionnel (présence → app-only si pas OBO)
- `USE_CLIENT_TOKEN`, `USE_INTERACTIVE`, `USE_CERTIFICATE` : boolean, défaut `false`
- `ACCESS_TOKEN`, `REDIRECT_URI`, `CERTIFICATE_PATH`, `CERTIFICATE_PASSWORD` : optionnels
- `USE_GRAPH_BETA` : boolean, défaut `true`

**Étape 2 — Refus app-only**

Si `CLIENT_SECRET` est fourni ET `USE_CLIENT_TOKEN=false` ET `USE_INTERACTIVE=false` :
c'est du mode `ClientCredentials` (app-only). Si `ELIGRAPH_ALLOW_APP_ONLY=false` (défaut),
logger un warning explicite et `process.exit(1)`.

```
[ELIGRAPH] FATAL: App-only authentication (CLIENT_SECRET without OBO) is disabled.
Set ELIGRAPH_ALLOW_APP_ONLY=true to opt in explicitly.
Refusing to start — see ARCHITECTURE.md §8 for details.
```

**Étape 3 — Refactoring `main.ts`**

Remplacer tous les `process.env.X` par des imports de `config`. La logique de
sélection du mode auth reste dans `main.ts` mais s'appuie sur les valeurs typées.

## 8. Risques identifiés

| Risque | Impact | Mitigation |
|---|---|---|
| App Registration mal configurée (audience, scopes) | OBO échoue | Documenter le setup Entra dans `docs/setup-entra.md` dès WS0 |
| Lokka upstream casse une API qu'on utilise | Merge conflicts | Pull upstream toutes les 2 semaines, tests E2E sur les outils |
| Token Graph leaké dans les logs | Sécurité critique | pino redaction sur `Authorization`, `accessToken`, `Bearer*` dès WS3 |
| VPS Contabo saturé par les logs | Indisponibilité | Logrotate sur `audit.log`, taille max 100MB × 7 fichiers |
| Copilot Studio change ses spécifications custom connector | WS7 à refaire | Tester WS7 sur un environnement de test isolé |

## 9. Ce que ce document n'est PAS

Ce document décrit le **plan**. Il ne fige pas l'implémentation — chaque WS pourra ajuster les détails au fur et à mesure que la réalité du code Lokka actuel se révèle. Un `JOURNAL.md` séparé peut tracer les décisions ad-hoc prises pendant le dev.
