# CLAUDE.md — EliGraph

> Ce fichier est le contexte projet pour Claude Code. Il est lu automatiquement
> à chaque démarrage d'une session. Il décrit ce que le projet est, ses contraintes
> non-négociables, et les conventions que tu dois respecter.

## 1. Identité du projet

**EliGraph** est un serveur MCP (Model Context Protocol) qui permet d'interroger
et de piloter un tenant Microsoft 365 / Azure en langage naturel via les APIs
Microsoft Graph et Azure ARM.

EliGraph est un **fork de [merill/lokka](https://github.com/merill/lokka)** (licence MIT,
auteur Merill Fernando), adapté pour répondre à des exigences professionnelles que
l'upstream ne couvre pas.

Le projet est développé par **Ishak Chennouf** chez **Eliadis**, une société de conseil
spécialisée dans les environnements Microsoft (Entra ID, Exchange, SharePoint, Intune,
Azure). Il vise des missions d'IGA (Identity Governance & Administration) et de N2
Identity Support pour des grands comptes (Stago, GALEC, etc.).

## 2. Différences avec Lokka upstream

EliGraph diverge de Lokka sur quatre axes :

1. **Authentification déléguée stricte** : refus de l'app-only (`CLIENT_SECRET` au sens
   client_credentials) en production. Modes acceptés : Azure CLI, Device Code,
   On-Behalf-Of (OBO).
2. **Transport HTTP remote** : exposition d'un endpoint `/mcp` au standard MCP
   Streamable HTTP (spec 2025-03-26) en plus du mode stdio existant.
3. **Audit trail JSON structuré** : logging exhaustif de toutes les opérations avec pino,
   format Loki-compatible, destinations multiples (stdout + fichier rotatif).
4. **Observabilité** : stack Grafana + Loki + Promtail intégrée pour visualisation
   temps réel (workstream ultérieur).

## 3. Contraintes non-négociables

Quand tu écris du code pour ce projet, ces règles ne sont jamais négociables :

- **Aucun secret en dur dans le code**. Tout passe par variables d'environnement
  validées via `zod` au démarrage.
- **Aucun token, secret, ou credential dans les logs**. Le logger pino doit avoir
  une `redaction` configurée pour `Authorization`, `accessToken`, `*.secret`,
  `*.password`, `Bearer*`.
- **Pas de mode app-only par défaut**. La variable `ELIGRAPH_ALLOW_APP_ONLY` vaut
  `false` par défaut. Si elle est laissée à `false` et qu'un utilisateur tente
  un démarrage en `CLIENT_SECRET` mode, le serveur log un warning explicite et
  exit(1).
- **TypeScript strict**. `tsconfig.json` doit avoir `"strict": true`. Pas de `any`
  implicite, pas de `// @ts-ignore` sans justification en commentaire.
- **Aucune dépendance ajoutée sans raison**. Avant d'ajouter un package, vérifier
  s'il est déjà transitivement disponible ou s'il fait double emploi.
- **Pas de `console.log` en production**. Toujours via le logger pino centralisé.

## 4. Stack technique

| Domaine | Choix | Notes |
|---|---|---|
| Runtime | Node.js 20 LTS | Aligné avec Lokka |
| Langage | TypeScript strict | |
| HTTP | Express | Conservé de Lokka, pas de migration vers Fastify |
| MCP SDK | `@modelcontextprotocol/sdk` ≥ 1.10 | Premier release supportant Streamable HTTP |
| Auth Microsoft | `@azure/identity` | `OnBehalfOfCredential`, `AzureCliCredential`, `DeviceCodeCredential` |
| Logging | `pino` + `pino-http` | JSON structuré, redaction obligatoire |
| Validation env | `zod` | Validation au démarrage |
| Tests | `vitest` + `supertest` | |
| Conteneur | Docker multi-stage, `node:20-alpine` | |
| Reverse proxy | nginx + Let's Encrypt | Sur VPS |
| CI/CD | GitHub Actions → GHCR → SSH | |

## 5. Structure du repo (cible)

```
eligraph/
├── src/mcp/                       # code Lokka existant (à refactorer progressivement)
│   ├── src/
│   │   ├── index.ts               # entry point, détecte stdio vs http
│   │   ├── transports/
│   │   │   ├── stdio.ts
│   │   │   └── http.ts            # Express + StreamableHTTPServerTransport
│   │   ├── auth/
│   │   │   ├── resolver.ts
│   │   │   ├── azure-cli.ts
│   │   │   ├── device-code.ts
│   │   │   └── obo.ts
│   │   ├── tools/
│   │   ├── clients/
│   │   ├── audit/
│   │   └── config/
│   ├── package.json
│   └── tsconfig.json
├── deploy/
├── .github/workflows/
├── tests/
├── ARCHITECTURE.md                # plan détaillé, roadmap par workstreams
├── CLAUDE.md                      # ce fichier
└── README.md
```

## 6. Workstreams

| WS | Sujet | Statut |
|---|---|---|
| WS0 | Setup repo, fork, CI minimale, rebranding Lokka → EliGraph | en cours |
| WS1 | HTTP wrapper /mcp Streamable | à faire |
| WS2 | Auth déléguée OBO + refus app-only | à faire |
| WS3 | Audit trail JSON (stdout + fichier) | à faire |
| WS4 | Observabilité Grafana + Loki | à faire |
| WS5 | Business rules / guardrails | à faire |
| WS6 | Déploiement VPS + nginx + Let's Encrypt | à faire |
| WS7 | Connecteur Copilot Studio | à faire |

Voir `ARCHITECTURE.md` pour le détail de chaque workstream.

## 7. Conventions de code

- **Imports** : ESM uniquement (`import x from "y"`), avec extension `.js` même pour
  les fichiers `.ts` (résolution Node.js native ESM).
- **Nommage des fichiers** : `kebab-case.ts` (pas de PascalCase ni snake_case).
- **Exports** : nommés (`export function foo`), pas de default export sauf cas
  particulier (entry points).
- **Erreurs** : classes d'erreur typées (`AuthError`, `GraphApiError`, etc.) qui héritent
  d'`Error`. Jamais de `throw "string"`.
- **Async** : `async/await` partout, pas de `.then()` chaîné.
- **Config** : toute config passe par `src/config/env.ts` avec validation `zod`.
  Aucun `process.env.X` dispersé dans le code.
- **Tests** : un fichier `.test.ts` par module, colocalisé. Couverture cible 70%+
  sur les modules critiques (`auth/`, `audit/`).

## 8. Conventions de commits

Format Conventional Commits avec préfixe de workstream :

```
<type>(<ws>): <description courte>

[corps optionnel]

[footer optionnel]
```

Types : `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`.

Exemples :
```
feat(ws1): add Streamable HTTP transport on /mcp endpoint
refactor(ws0): rename package from lokka to eligraph
docs(ws0): add ARCHITECTURE.md and CLAUDE.md
fix(ws2): reject app-only when ELIGRAPH_ALLOW_APP_ONLY is false
```

## 9. Branches

- `main` : prod, protégée, merge uniquement via PR
- `ws<N>-<feature>` : branche de travail par workstream (ex: `ws1-http-transport`)
- `upstream-sync` : branche temporaire pour intégrer les évolutions de Lokka upstream

Pull upstream Lokka toutes les 2 semaines minimum, sur une branche dédiée, avec
résolution manuelle des conflits.

## 10. Variables d'environnement

Toutes les variables lues par EliGraph sont préfixées `ELIGRAPH_*`, à l'exception des
variables historiques de Lokka qu'on conserve par compatibilité (`TENANT_ID`,
`CLIENT_ID`, `CLIENT_SECRET`, `USE_GRAPH_BETA`, etc.).

Voir `.env.example` à la racine pour la liste complète.

## 11. Pré-requis Microsoft Entra

Une App Registration EliGraph est requise dans le tenant cible avec :

- Un scope exposé : `api://<eligraph-app-id>/access_as_user`
- Permissions Graph **déléguées** (`User.Read`, `Directory.Read.All`, etc. selon
  besoins) avec admin consent
- Un secret ou un certificat (utilisé uniquement pour l'échange OBO côté serveur,
  pas pour de l'app-only)
- Redirect URI : `https://<domaine-eligraph>/auth/callback`

## 12. Environnement de développement

- Windows 11
- VS Code
- PowerShell 7
- Node.js 20
- Docker Desktop
- Path projet : `C:\Dev\eligraph\`

## 13. Sécurité — règles d'or

- Le `CLIENT_SECRET` qu'on utilise pour OBO **n'est pas une identité applicative**.
  Il sert uniquement à authentifier EliGraph auprès d'Entra pour échanger le token
  utilisateur. Les permissions appliquées restent celles déléguées de l'utilisateur.
  Ne jamais confondre avec un mode app-only.
- Tout secret va dans `.env` (gitignored) ou dans GitHub Actions secrets.
  Jamais committé.
- En cas de doute sur une opération destructive (DELETE, opérations de masse),
  toujours passer par le module `guardrails.ts` (WS5).
- Les logs d'audit ne sont **jamais** purgés automatiquement par EliGraph. La rotation
  est gérée par logrotate côté OS.

## 14. Contact upstream

Si une amélioration développée pour EliGraph peut bénéficier à Lokka upstream, créer
une PR sur `merill/lokka` plutôt que de garder la divergence. Cela limite la dette de
synchronisation. Les fonctionnalités spécifiquement professionnelles (auth déléguée
stricte, audit, guardrails) restent en revanche dans le fork.
