# EliGraph

> Serveur MCP (Model Context Protocol) pour piloter un tenant Microsoft 365 / Azure
> en langage naturel via Microsoft Graph et Azure ARM, avec authentification déléguée
> stricte, transport HTTP remote, et audit trail structuré.
>
> Fork professionnel de [merill/lokka](https://github.com/merill/lokka) — MIT.

## Pourquoi EliGraph

[Lokka](https://github.com/merill/lokka) est un excellent serveur MCP pour Microsoft 365 :
il expose les APIs Microsoft Graph et Azure ARM comme outils MCP, fonctionne en stdio
pour Claude Desktop, et supporte plusieurs modes d'authentification.

Pour un usage **professionnel chez un client**, plusieurs exigences ne sont pas couvertes
par l'upstream. EliGraph les ajoute :

| Exigence | Lokka | EliGraph |
|---|---|---|
| Authentification déléguée stricte (tracée par UPN) | optionnel | **obligatoire en prod** |
| Mode app-only (`CLIENT_SECRET` au sens client_credentials) | autorisé | **refusé par défaut** |
| Transport HTTP remote (Streamable HTTP) | non | **oui** (Claude.ai, Copilot Studio) |
| Audit trail JSON structuré | non | **oui** (stdout + fichier rotatif) |
| Observabilité (Grafana + Loki) | non | **prévu** |
| Business rules / guardrails | non | **prévu** |
| Connecteur Copilot Studio | non | **prévu** |

## État du projet

EliGraph est en cours de développement actif. Voir `ARCHITECTURE.md` pour la roadmap
détaillée par workstreams.

| Workstream | Statut |
|---|---|
| WS0 — Setup repo, rebranding Lokka → EliGraph | en cours |
| WS1 — HTTP wrapper /mcp Streamable | à faire |
| WS2 — Auth déléguée OBO + refus app-only | à faire |
| WS3 — Audit trail JSON | à faire |
| WS4 — Observabilité Grafana + Loki | à faire |
| WS5 — Business rules / guardrails | à faire |
| WS6 — Déploiement VPS + nginx + Let's Encrypt | à faire |
| WS7 — Connecteur Copilot Studio | à faire |

## Modes d'authentification

EliGraph **n'autorise pas** le mode app-only (`client_credentials`) par défaut. Les modes
supportés sont :

### Mode stdio (Claude Desktop)

- **Azure CLI** (`az login` préalable) — simple, recommandé pour le développement
- **Device Code** — pour les environnements sans CLI Azure

### Mode HTTP remote (Claude.ai, Copilot Studio)

- **On-Behalf-Of (OBO)** — le client envoie un token utilisateur dont l'audience est
  EliGraph, le serveur l'échange contre un token Graph downstream **au nom de
  l'utilisateur**. Toutes les opérations Graph sont auditées sous l'UPN réel.

Le mode app-only peut être réactivé pour des cas exceptionnels (scripts d'administration,
tâches planifiées sans utilisateur) avec :

```bash
ELIGRAPH_ALLOW_APP_ONLY=true
```

Cette opt-in est explicite et logée au démarrage.

## Installation

> Section à compléter au fur et à mesure que les workstreams progressent.

### Pré-requis

- Node.js 20 LTS
- Docker (pour le mode déployé)
- Une App Registration Microsoft Entra avec :
  - Un scope exposé : `api://<eligraph-app-id>/access_as_user`
  - Permissions Graph déléguées (admin consent requis selon scopes)
  - Un secret ou un certificat (pour l'échange OBO côté serveur)

### Mode stdio (développement local)

À documenter en fin de WS0.

### Mode HTTP remote (production)

À documenter en fin de WS6.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — architecture détaillée, roadmap, décisions techniques
- [`CLAUDE.md`](./CLAUDE.md) — contexte projet pour Claude Code
- Documentation upstream Lokka : [lokka.dev](https://lokka.dev)

## Crédits

EliGraph est un fork de [merill/lokka](https://github.com/merill/lokka) par Merill Fernando,
distribué sous licence MIT. Tous les outils MCP de base (`Lokka-Microsoft`, `set-access-token`,
`get-auth-status`) proviennent de Lokka et restent attribués à leurs auteurs originaux.

Les ajouts EliGraph (transport HTTP remote, OBO strict, audit trail structuré, guardrails,
observabilité, connecteur Copilot Studio) sont développés par Ishak Chennouf chez Eliadis.

## Licence

MIT — voir [`LICENSE`](./LICENSE). Cette licence couvre à la fois le code original Lokka
et les ajouts EliGraph.
