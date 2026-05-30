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

**Docs** (retrospectiva + planning del v2):
- `docs/COMO-LO-HICIMOS.md` — retrospectiva completa del showcase PetDesk v1: arquitectura (§1-4), flujo (§5-6), errores y resoluciones (§7), receta (§8), costos reales (§10), playbook paso a paso (§13), análisis 🤖/👤 de lo autónomo vs manual (§14).
- `docs/QUE-APRENDIMOS-V2.md` — plan v2 (las 8 mejoras + apuesta de costo/tiempo) y evaluación de frameworks SDD (OpenSpec, GitHub Spec-Kit) con la decisión final: adoptar 4 patrones sin instalar ninguno.

**Scripts**:
- `scripts/setup-petdesk-multica.sh` — script idempotente para crear agentes + issues en Multica. Template reusable: para un proyecto nuevo, copiar y cambiar nombres + issue bodies.

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
