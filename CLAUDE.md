# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A **research and planning workspace**, not a software project. The goal it documents: orchestrate coding agents/subagents with a Kanban methodology, consuming models via API that are cheaper than Claude but at a comparable level. There is no application code, no build/lint/test pipeline — just research documents in `research/` and an `.env` template for the API keys those agents would eventually use.

Notes are written in **Spanish**; match that language when adding to `research/`.

## Layout

**Research** (planning + investigación de mercado):
- `research/reporte-agentes-kanban-modelos.md` — reporte principal: orquestadores Kanban (Multica, Vibe Kanban…), costos modelos vs SWE-bench, Claude API-vs-subscription, arquitectura recomendada.
- `research/multica-deep-dive.md` — deep dive técnico de Multica.
- `research/proyecto-petdesk.md` — plan original del showcase PetDesk (arquitectura, contratos, 6 issues).
- `research/capas-harness-stack-v6.md` — referencia: las 13 capas de harness (literatura) mapeadas al stack + versiones de cada componente al v6.

**Docs — Retrospectivas y planning**:
- `docs/COMO-LO-HICIMOS.md` — retrospectiva completa del showcase PetDesk v1: arquitectura, flujo, errores, receta, costos reales, playbook paso a paso, análisis 🤖/👤 de lo autónomo vs manual.
- `docs/QUE-APRENDIMOS-V2.md` — plan v2 (las 8 mejoras + apuesta) y evaluación de frameworks SDD (OpenSpec, GitHub Spec-Kit). Decisión: adoptar 4 patrones sin instalar ninguno. Incluye **Anexo A** con resultados reales del v2 ejecutado.

**Docs — Baselines de entorno** (mediciones reproducibles):
- `docs/env-baseline-v3.md` — snapshot del entorno congelado del v3 + smoke test de compatibilidad del upgrade de opencode. Registro histórico.
- `docs/env-baseline-v4.md` — baseline del v4/v5: comparación contra v2 con costo real de OpenRouter, autonomía y la varianza de costo ~4×.

**Docs — Artículos para publicar**:

Cada versión tiene su paquete (Medium + LinkedIn; v2/v3 con hero + carousel, v4/v5 con diagrama de arquitectura SVG).

| Versión | Tema central | Archivos |
|---|---|---|
| **v2** (Multica + multiagente) | 12 errores del v1 + 4 patrones que arreglaron todo | `MEDIUM-ARTICLE.md` · `MEDIUM-IMPORT.md` · `LINKEDIN-POST.md` · `hero-v1-vs-v2.png` · `linkedin-carousel.pdf` |
| **v3** (+ gentle-ai overlay) — *no publicado, descartado como comparación* | Lo que cuesta agregar SDD al stack: +60% costo per-issue, +92% tiempo, pero 3 memorias estructuradas | `MEDIUM-ARTICLE-V3.md` · `LINKEDIN-POST-V3.md` · `hero-v2-vs-v3.png` · `linkedin-carousel-v3.pdf` |
| **v4/v5** (autonomía: stack actualizado vs v2) | Dos preguntas — ¿más barato? (no: costo no-determinístico, varianza ~4×). ¿más autónomo? (sí: auto-merge gateado por CI, 0 merges humanos). Nombra gentle-ai/Engram con el matiz | `MEDIUM-ARTICLE-V4.md` · `LINKEDIN-POST-V4.md` · `architecture-v4.svg` |
| **harness** (síntesis transversal) | Un tablero de agentes = 5 de 13 capas de un harness; las 8 que faltan, con qué se llenan (open source, con alternativas) y cuáles rindieron | `MEDIUM-ARTICLE-HARNESS.md` · `LINKEDIN-POST-HARNESS.md` · `architecture-harness-grid.svg` |
| **v6** (v2 vs v6: completar el harness) | SDD invocado de verdad; comparación v2↔v6 por harness (7→13 capas), costo/feature, retrabajos y tiempo. Opinión: CI + auto-merge rinden; memoria y SDD son condicionales | `MEDIUM-ARTICLE-V6.md` · `LINKEDIN-POST-V6.md` · `architecture-v2-vs-v6.svg` |

Las versiones `.html` son las fuentes editables (hero + carousel). Los `.pdf` y `.png` son los outputs renderizados con Chrome `--print-to-pdf` / `--screenshot`.

**Scripts**:
- `scripts/setup-petdesk-multica.sh` — v1 original, crea agentes + issues en Multica.
- `scripts/setup-petdesk-v2-multica.sh` — v2, con cost routing (DeepSeek para Frontend) + referencias a `tests/contracts/` y `CONSTITUTION.md`.
- `scripts/setup-petdesk-v3-stats.sh` — v3, agrega feature Stats Dashboard sobre petdesk-v2 para medir gentle-ai overlay.
- `scripts/setup-petdesk-v4-stats.sh` — v4, re-run del Stats Dashboard contra la rama `v4-baseline` con el entorno actualizado (Multica 0.3.17 + opencode 1.16.2).
- `scripts/setup-petdesk-v5-stats.sh` — v5, autonomía (Camino A): el agente habilita auto-merge; la integración la gatea el CI. Base `v5-baseline`.
- `scripts/setup-petdesk-v6-sdd.sh` — v6, SDD invocado explícitamente (un issue feature-level, preflight bakeado, artefactos en `openspec/`). Base `v6-baseline`.

Todos son **idempotentes** y reusables: copiar, cambiar nombres + issue bodies, listo.

**Repos relacionados** (los 3 públicos):
- `rubenaros/petdesk` — v1 (showcase original con todos los errores)
- `rubenaros/petdesk-v2` — v2 + v3 (template con contracts + features incrementales)
- `rubenaros/AgentCode` — este repo (workspace de orquestación + docs + scripts)

**Otros**:
- `.env.example` → copy to `.env` (gitignored) to fill in keys.

When research documents cross-reference each other, keep the relative markdown links (e.g. `[multica-deep-dive.md](./multica-deep-dive.md)`) intact and bidirectional.

## Key decisions already reached (don't re-litigate without reason)

These conclusions are settled in the research; build on them rather than re-deriving:

- **Model routing by cost/quality:** critical/architecture → Claude Opus 4.7 or Sonnet 4.6; general implementation → Kimi K2.6 (best balance); trivial/boilerplate → DeepSeek V3.2 or MiniMax M2.5.
- **The Kanban board does NOT choose the model** — the underlying CLI agent (Claude Code, Codex, Qwen Code…) does, configured via its own `base_url` + API key. Multica auto-detects CLIs on `PATH`; it manages neither keys nor models.
- **Parallel multi-agent work must go through metered API, not subscription plans.** As of the 2026-04-04 cutoff, Anthropic blocked subscription quota for third-party tools — orchestrators must bill by API key.

## Critical: ANTHROPIC_API_KEY scoping

Do **not** put `ANTHROPIC_API_KEY` in the global environment. The official Claude Code CLI will silently use it and bill via API, bypassing the user's Max plan ("double-charge trap"). Scope it only to the orchestrator's own environment (its `docker-compose`/`.env`). See section 6 of the main report. This is why `.env.example` leaves `ANTHROPIC_API_KEY` commented out under a warning.

## API gateway convention

The chosen default is **OpenRouter** as a unified gateway (`OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`) — one OpenAI-compatible format for Kimi, Claude, DeepSeek, etc. Direct per-provider keys (Moonshot/Kimi, DeepSeek) are kept as commented optional alternatives in `.env.example`.

## Live setup on this machine (Multica self-host)

Multica is installed and running locally (v0.3.6, self-host via Docker). It lives **outside** this repo — this repo is just where the orchestration is driven from.

- **Server:** `~/.multica/server` — backend + frontend + Postgres17/pgvector, all bound to `127.0.0.1` (not exposed). Compose file: `~/.multica/server/docker-compose.selfhost.yml`.
  - Frontend (board): http://localhost:3000 · Backend/API: http://localhost:8080
- **CLI:** `multica` in `~/.local/bin`. Daemon runs locally, scans `PATH`, and registers a runtime per detected agent CLI.
- **Desktop app:** `~/.local/bin/multica-desktop.AppImage` (launcher: `~/.local/share/applications/multica-desktop.desktop`). Ubuntu 24.04 has no libfuse2, so the launcher runs it with `--appimage-extract-and-run`.
- **Detected agent CLIs:** `claude`, `opencode`, `gemini`.

### Common commands

```bash
multica daemon status            # running? detected agents?
multica daemon start / stop      # daemon lifecycle
multica daemon logs              # agent execution logs
# Server lifecycle (from ~/.multica/server):
docker compose -f docker-compose.selfhost.yml ps | logs -f | down
# Full stop (server + daemon):
bash /tmp/multica-install.sh --stop   # or re-fetch install.sh
```

### How the cheap-model route is wired (OpenCode → OpenRouter → Kimi)

Multica injects creds **per-agent** via the **Custom Env** / **Custom Args** fields (Settings → Agents). It does NOT hold provider keys itself. The working setup:

- **OpenCode** holds the OpenRouter key in its own auth (`~/.local/share/opencode/auth.json`, perms 600) and a default model in `~/.config/opencode/opencode.jsonc` (`"model": "openrouter/moonshotai/kimi-k2.6"`). The daemon runs as the same user, so OpenCode picks both up automatically.
- Therefore a Multica agent with **Provider = OpenCode** and empty Custom Env/Args already routes to Kimi K2.6 via OpenRouter. Verified end-to-end.
- For a different cheap model per-agent, override with **Custom Args** `--model openrouter/<slug>` (e.g. `deepseek/deepseek-chat`, `minimax/minimax-m2`) — no need to touch OpenCode's global default.
- **`claude` can't use OpenRouter as a drop-in** (it speaks the Anthropic Messages format; OpenRouter's endpoint is OpenAI format). Use an OpenAI-compatible CLI (OpenCode/Codex) for OpenRouter.

### Self-host login gotcha

`RESEND_API_KEY` is unset, so login email codes are **not sent** — they are printed in the backend logs:

```bash
docker compose -f ~/.multica/server/docker-compose.selfhost.yml logs backend | grep -i code
```

## gentle-ai overlay (instalado globalmente para v3+)

Desde el v3 hay un **overlay activo en opencode** que cambia su comportamiento sin que Multica lo sepa. La integración es transparente vía config global.

- **Binario**: `gentle-ai 1.34.1` en `~/.local/bin/` (instalado por bajada directa del tarball de release; no hay brew/scoop/go en este sistema).
- **Engram server**: `engram 1.16.1` corriendo en `http://localhost:7437` (memoria persistente SQLite, MCP server vía stdio para opencode).
- **gga**: `gga 2.8.1` instalado (code review por AI, hook git opcional).

**Lo que modificó en opencode**:
- `~/.config/opencode/opencode.jsonc` ahora incluye `mcp.engram` configurado.
- `~/.config/opencode/plugins/` tiene 3 plugins: `background-agents.ts` (reemplaza tool `task` con delegación async persistente), `engram.ts` (adaptador a Engram HTTP), `model-variants.ts` (cache de tiers OpenRouter).
- **Cualquier opencode que arranque** (incluido el que dispara Multica daemon) carga el overlay automáticamente.

**Hallazgos del v3** (ver `docs/MEDIUM-ARTICLE-V3.md` para el análisis completo):
- **El overlay tiene costo fijo**: +60% costo per-issue, +92% tiempo per-issue, INCLUSO sin activar SDD.
- **SDD no se activa salvo en features grandes** — el `gentle-orchestrator` evalúa cada issue y decide. En features chicas/medianas (los que producen Multica), va directo.
- **Valor concreto agregado**: Engram persiste memorias estructuradas con `What/Why/Where/Learned`, detección automática de specs mal escritos por el agente, mejor calidad arquitectónica del código.

**Backup**: el opencode.jsonc original (sin gentle-ai) está en `~/.config/opencode/opencode.jsonc.pre-gentle-ai.bak`.
