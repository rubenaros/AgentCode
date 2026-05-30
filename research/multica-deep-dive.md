# Multica — Análisis profundo

**Repo:** [`multica-ai/multica`](https://github.com/multica-ai/multica) · Apache 2.0 · ~32k ⭐ · TypeScript/Go
**Fecha:** 2026-05-24

---

## 1. Qué es (y qué NO es)

Multica es **una capa de orquestación**, no un framework de agentes ni un gestor de modelos. Convierte CLIs de agentes de codificación (Claude Code, Codex, Kimi, etc.) en "compañeros de equipo" asignables: les da perfil, ciclo de vida de tareas, un tablero estilo Kanban y un feed de actividad compartido entre humanos y agentes.

> **Clave que cambia todo:** Multica **no maneja API keys ni elige modelos**. Auto-detecta los CLIs en tu `PATH` y cada CLI gestiona su propia autenticación y proveedor. Multica solo decide *qué CLI* ejecuta *qué tarea*.

---

## 2. Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 16 (App Router) |
| Backend | Go (Chi router, sqlc, gorilla/websocket) |
| Base de datos | PostgreSQL 17 + pgvector |
| Runtime | Daemon local que ejecuta los CLIs de agentes |

**Flujo de componentes:**
```
Web dashboard (Next.js) ──┐
                          ├──► Server (Go + Postgres/pgvector)
CLI `multica` ────────────┘            ▲
                                       │ registra CLIs disponibles
                          Daemon local (escanea PATH)
                          └─► ejecuta: claude / codex / kimi / qwen / ...
```

- Un **Runtime** es un entorno de cómputo que expone una lista de CLIs. El daemon local es el caso canónico: arranca, escanea `PATH` y se registra con el server.
- Los **agentes se bindean a runtimes**; el runtime reporta qué CLIs hay disponibles.

---

## 3. Cómo funciona el multi-modelo (lo que pediste)

Multica NO configura modelos. Cada proveedor entra **a través de su CLI**, que tú configuras por separado:

| Modelo / Proveedor | Cómo entra a Multica |
|---|---|
| **Kimi** | CLI de Kimi (soportado de fábrica en la lista de runtimes) |
| **Claude** | Claude Code CLI (auth propia) |
| **OpenAI** | Codex CLI (usa OpenAI), o Qwen Code apuntado a `base_url` de OpenAI |
| **Qwen** | Qwen Code CLI → `modelProviders` en `~/.qwen/settings.json` + `OPENAI_API_KEY` en `~/.qwen/.env` |
| **DeepSeek / otros** | Cualquier CLI OpenAI-compatible (Codex/Qwen Code) con `base_url` cambiado |

> Qwen Code permite múltiples proveedores vía `modelProviders` en `settings.json` (cada entrada con `id`, `envKey`, `baseUrl` opcional). Las credenciales nunca se persisten: se leen de `process.env[envKey]`. Esta es la vía limpia para enchufar DeepSeek/Kimi/OpenAI a un mismo CLI.

**Implicación práctica:** para tener Claude + Kimi + Qwen + DeepSeek en el tablero, instalas y autenticas cada CLI por separado; Multica los descubre solos. El "routing por costo" se logra creando agentes distintos (cada uno con su runtime/CLI/modelo) y asignándoles tareas según criticidad.

---

## 4. Squads / leader — dato en conflicto ⚠️

Hay **información contradictoria** entre fuentes:
- El **repo oficial** describe *Squads*: agentes (y humanos) bajo un *leader agent* que delega y decide quién toma cada tarea.
- Una **guía técnica** afirma que en la práctica es un **modelo de asignación plano**: las issues se asignan a agentes individuales en un tablero compartido, sin cadena de delegación documentada ni asignación agente-a-agente.

**Lectura probable:** los Squads son una feature reciente o parcial. No asumir delegación autónoma robusta todavía; verificar en la versión instalada.

---

## 5. Skills (capacidades reutilizables)

- Formato: un directorio con `SKILL.md` + config/archivos opcionales, registrado a un workspace y reutilizable por cualquier agente.
- Usan el **estándar de skills de Claude Code** e importan desde catálogos públicos (skills.sh).
- Cuando un agente completa una tarea (ej. "migrar schema v1→v2"), la solución se guarda como skill reutilizable.
- ⚠️ **Limitación:** el importador guarda cada archivo en una columna `TEXT` de Postgres → **falla con binarios** (PNG, compilados).

---

## 6. Flujo típico tarea → PR

1. Creas una issue (CLI o UI).
2. La asignas a un agente en el tablero Kanban.
3. El agente la reclama (enqueue → claim → start).
4. Ejecuta usando su CLI bindeado (Claude Code, Codex, Kimi…).
5. El progreso aparece en el feed compartido (WebSocket).
6. Abre un PR o reporta blockers en comentarios.

---

## 7. Instalación

```bash
# Homebrew (macOS/Linux)
brew install multica-ai/tap/multica
multica setup

# Script (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash

# Self-host con server propio
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server
multica setup self-host
```

**Requisitos:** Node 20+, pnpm 10.28+, Go 1.26+, Docker (para self-host). PostgreSQL 17 + pgvector.

**Setup de un agente:** `multica setup` configura/autentica/arranca el daemon → en la UI: Settings → Agents → New Agent → eliges runtime y provider (Kimi, Claude Code, Codex, etc.).

**Dato real:** se ha corrido un pipeline de **16 agentes en un server self-host de €4.49/mes**.

---

## 8. Madurez y riesgos ⚠️ (lo que hay que saber antes de adoptarlo)

| Riesgo | Detalle |
|---|---|
| **API inestable** | Etapa temprana; esperar breaking changes en la serie v0.2.x. (Ya hay v0.3.x, así que avanza rápido, pero aún no "production-hardened"). |
| **Race condition de estado** | Cancelar una tarea justo tras asignarla puede dejar agentes pegados en `working`. |
| **Sin binding de repo** | Los proyectos no se atan a una URL de repo concreta → riesgo de que el agente elija el repo equivocado. |
| **Brechas de seguridad (v0.2.16)** | Faltaba protección anti-fuerza-bruta en `/auth/verify-code` y defensa CSRF. Verificar si está corregido en la versión actual. |
| **Skills con binarios** | El importador no maneja PNG/binarios (columna TEXT). |

**Conclusión de madurez:** prometedor y muy activo, pero **no production-hardened**. Para un primer uso: entorno aislado, repos de bajo riesgo, versión más reciente, y revisar el changelog de seguridad.

---

## 9. Veredicto

- **A favor:** open source real, self-hostable (código no sale de tu infra), Kimi de fábrica, multi-CLI/multi-modelo vía los CLIs subyacentes, skills reutilizables, muy activo.
- **En contra:** setup pesado (Node+pnpm+Go+Docker+Postgres), Squads/delegación aún difusos, varios bugs/brechas conocidos, API en evolución.
- **Cuándo usarlo:** equipos que manejan 2+ agentes en tareas distintas, con apetito de tolerar una herramienta joven a cambio de control total y costo casi nulo.

---

## 10. Fuentes

- [github.com/multica-ai/multica](https://github.com/multica-ai/multica) · [multica.ai/docs](https://multica.ai/docs) · [docs/skills](https://multica.ai/docs/skills)
- [Guía Multica (agentpedia)](https://agentpedia.codes/blog/multica-guide) · [Tutorial (byteiota)](https://byteiota.com/multica-tutorial-manage-ai-agents-as-real-teammates/)
- [Review 16 agentes €4.49/mes (toolchew)](https://toolchew.com/en/review-multica-2026/) · [Review (AgentConn)](https://agentconn.com/blog/multica-open-source-managed-agents-platform-review/)
- [Skills system (Flowtivity)](https://flowtivity.ai/blog/multica-skills-system-how-to-build-compound-agent-capabilities/)
- [Qwen Code model providers (docs)](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/)
