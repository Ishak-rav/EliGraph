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
| Runtime | Node.js 20 LTS | Aligné avec Lokka et l'env de dev |
| Langage | TypeScript strict | Lokka est déjà en TS |
| HTTP server | Express | Conserver l'écosystème Lokka, éviter un refactor |
| MCP SDK | `@modelcontextprotocol/sdk` ≥ 1.10 | Premier release supportant Streamable HTTP |
| Transport remote | Streamable HTTP (spec 2025-03-26) | SSE déprécié au profit de Streamable HTTP |
| Auth Microsoft | `@azure/identity` (déjà présent) | `OnBehalfOfCredential` + `AzureCliCredential` + `DeviceCodeCredential` |
| Logging | pino + pino-http | JSON structuré natif, format Loki-compatible |
| Tests | vitest + supertest | Léger, ESM natif |
| Conteneur | Docker multi-stage, base `node:20-alpine` | Image finale légère |
| Reverse proxy | nginx + Let's Encrypt (certbot) | Standard sur VPS |
| CI/CD | GitHub Actions → GHCR → SSH deploy | Simple et auto-hébergé |

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

| WS | Sujet | Estimation | Dépend de |
|---|---|---|---|
| WS0 | Setup repo, fork, CI minimale | 1-2 j | — |
| WS1 | HTTP wrapper /mcp Streamable | 3-5 j | WS0 |
| WS2 | Auth déléguée OBO + refus app-only | 3-5 j | WS1 |
| WS3 | Audit trail JSON (stdout + fichier) | 2-3 j | WS0 |
| WS4 | Observabilité Grafana + Loki | 2-3 j | WS3 |
| WS5 | Business rules / guardrails | 3-5 j | WS3 |
| WS6 | Déploiement VPS + nginx + LE | 1-2 j | WS1, WS2, WS3 |
| WS7 | Connecteur Copilot Studio | 3-5 j | WS6 |

**Total MVP (WS0 à WS3 + WS6)** : environ 10 à 17 jours de dev effectif.

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

## 7. WS1 — détail (HTTP wrapper)

Trois étapes principales :

**Étape 1 — Détection du mode dans `index.ts`**

```typescript
// src/index.ts (nouveau ou refactor de l'existant)
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

const mode = process.env.ELIGRAPH_TRANSPORT ?? "stdio";

if (mode === "http") {
  await startHttp();
} else {
  await startStdio();
}
```

**Étape 2 — Implémentation `transports/http.ts`**

```typescript
import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../audit/logger.js";
import { buildMcpServer } from "../server.js";   // factory à extraire de l'index actuel

export async function startHttp() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Healthcheck
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Endpoint MCP unique
  app.all("/mcp", async (req, res) => {
    const sessionId = req.header("mcp-session-id") ?? randomUUID();

    // À ce stade WS1 : pas encore d'auth ni d'audit
    // WS2 ajoutera la validation du Bearer
    // WS3 ajoutera l'instrumentation pino-http

    const server: Server = buildMcpServer({ sessionId });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = Number(process.env.ELIGRAPH_HTTP_PORT ?? 3000);
  const host = process.env.ELIGRAPH_HTTP_HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    logger.info({ port, host }, "EliGraph HTTP server listening");
  });
}
```

**Étape 3 — Test bout-en-bout avec MCP Inspector**

```bash
# Terminal 1 : démarrer EliGraph en mode HTTP
ELIGRAPH_TRANSPORT=http npm run start

# Terminal 2 : connecter MCP Inspector
npx @modelcontextprotocol/inspector
# → URL: http://localhost:3000/mcp
# → Tester l'appel à un outil Graph
```

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
