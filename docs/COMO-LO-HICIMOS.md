# Cómo lo hicimos — Showcase multiagente con Multica + Kimi + GitHub + Vercel

**Fecha:** 2026-05-29
**Proyecto entregado:** [PetDesk](https://github.com/rubenaros/petdesk) — recepcionista IA para negocios de cita previa (MVP web, sin SMS), beachhead pet grooming.
**Costo total real:** **~$4.21 USD** (7 tareas agénticas, ver §10).
**Fuente larga del plan:** [`research/proyecto-petdesk.md`](../research/proyecto-petdesk.md).
**Aprendizajes operativos persistidos:** [memoria `multica-multiagent-workflow`](../../.claude/projects/-home-ruben-aros-Projects-AgentCode/memory/multica-multiagent-workflow.md).

---

## 1. La idea de fondo

Una **metodología Kanban para agentes de código**: cada feature es un *issue* en un tablero; cada agente es un "trabajador" con rol e instrucciones; el orquestador asigna issues a agentes; cada tarea corre aislada en su propio worktree; el resultado se entrega como **PR en GitHub** y se mergea cuando un humano (arquitecto) lo aprueba.

```
┌─────────────────────────────────────────────────────────────┐
│  Multica (self-host, Docker) — tablero + daemon orquestador │
│  ─────────────────────────────────────────────────────────  │
│  Issues  ──asignar──>  Agente (perfil + instrucciones)      │
│                              │                              │
│                              ▼                              │
│  ~/multica_workspaces/<task>/workdir/  (worktree aislado)   │
│                              │                              │
│                              ▼                              │
│              OpenCode CLI  ─ ruta a ─>  Kimi K2.6           │
│                              │           (vía OpenRouter)   │
│                              ▼                              │
│            git push + gh pr create ─> GitHub repo           │
│                                            │                │
│                                            ▼                │
│                                  Vercel auto-deploy         │
└─────────────────────────────────────────────────────────────┘
```

## 2. Las piezas y qué hace cada una

| Pieza | Rol | Ubicación |
|---|---|---|
| **Multica self-host** | Tablero Kanban + daemon que ejecuta agentes | `~/.multica/server` (Docker: backend + frontend + Postgres17/pgvector) |
| **`multica` CLI** | Crear agentes/issues, autenticar, controlar daemon | `~/.local/bin/multica` |
| **App de escritorio Multica** | UI nativa | `~/.local/bin/multica-desktop.AppImage` |
| **Agentes (5)** | Perfiles con rol + instrucciones (Karpathy + addendum por rol) | server, workspace `zenzai` |
| **OpenCode** | El CLI que el daemon ejecuta por cada tarea | `~/.nvm/.../bin/opencode` |
| **OpenRouter + Kimi K2.6** | Gateway + modelo (~10× más barato que Opus, ~5× que Sonnet) | key en `~/.local/share/opencode/auth.json`; modelo default en `~/.config/opencode/opencode.jsonc` |
| **Repo `petdesk` en GitHub** | Código fuente + workflow CI | https://github.com/rubenaros/petdesk |
| **Vercel** | Auto-deploy + URL pública | proyecto `felipearosrs-projects/petdesk` |

## 3. Setup inicial (una vez)

### 3.1 Multica self-host

Script oficial (clona el repo, levanta `docker compose` con imágenes de GHCR, instala el CLI binario):

```bash
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh \
  | bash -s -- --with-server
```

Notas:
- Se instala en `~/.multica/server` (compose: `docker-compose.selfhost.yml`).
- Puertos `127.0.0.1:8080` (backend) y `127.0.0.1:3000` (frontend) — solo localhost.
- Si `/usr/local/bin` no es escribible, exporta `MULTICA_BIN_DIR=$HOME/.local/bin` antes de correr el script para evitar `sudo`.

Configura el CLI y autentica:
```bash
multica setup self-host    # interactivo: pide servidor + login
```

Como `RESEND_API_KEY` no está configurada en el `.env` del server, el código de login **se imprime en los logs del backend** en vez de mandarse por email:
```bash
docker compose -f ~/.multica/server/docker-compose.selfhost.yml logs backend | grep -i code
```

Arranca el daemon (autodetecta los CLIs de agentes en `PATH`):
```bash
multica daemon start
multica daemon status   # debería mostrar 'running' y los agentes detectados
```

### 3.2 Agente CLI (OpenCode + Kimi vía OpenRouter)

OpenCode es OpenAI-compatible y soporta OpenRouter de fábrica:
```bash
npm install -g opencode-ai     # deja binario 'opencode' en PATH
opencode auth login            # eliges OpenRouter, pegas la API key
```
La key queda en `~/.local/share/opencode/auth.json` (perms 600).

Forzamos Kimi como modelo por defecto editando `~/.config/opencode/opencode.jsonc`:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openrouter/moonshotai/kimi-k2.6"
}
```

> **Por qué OpenCode y no Claude Code**: OpenCode habla formato OpenAI → encaja directo con OpenRouter. Claude Code habla formato Anthropic; OpenRouter no expone endpoint Anthropic-compatible como drop-in.

### 3.3 Binding del repo al workspace de Multica

Esto **no tiene CLI** (a diferencia de casi todo lo demás). Es 1 clic en la UI:

1. Abre http://localhost:3000 → workspace **`zenzai`**.
2. **Settings → Repositories → Add** la URL: `https://github.com/<owner>/<repo>.git`.

El daemon clona el repo (bare) bajo demanda en `~/multica_workspaces/.repos/<ws>/<host+owner+repo>.git` la primera vez que arranca una tarea. Por cada tarea crea un **worktree aislado** desde ese cache bare en `~/multica_workspaces/<ws>/<task>/workdir/`.

> Nota: para repos privados, el daemon usa tus credenciales locales de git (corre como tú). Verifica que `git ls-remote <url>` funcione no-interactivo.

## 4. La decisión clave de arquitectura: contratos primero

Esto es lo más importante para que el multiagente **luzca y no choque**. En `src/domain/ports.ts` definí **interfaces** estables antes de cualquier implementación:

```ts
export interface SchedulerPort {
  getAvailability(serviceId: string, from: Date, to: Date): Slot[];
  book(clientId: string, serviceId: string, start: Date): Appointment;
  reschedule(appointmentId: string, newStart: Date): Appointment;
  cancel(appointmentId: string): { freed: Slot; candidates: WaitlistEntry[] }; // ← backfill
  dueReminders(now: Date): ReminderJob[];
}
export interface Repository { ... }
export interface NotificationPort { ... }
export interface Clock { now(): Date; }
```

Esto **habilita el paralelismo real**:
- `Dev Motor` implementa `SchedulerPort` en `src/engine/`.
- `Dev Chat` codea el cerebro contra la **interfaz** `SchedulerPort` (sin esperar a Dev Motor), en `src/receptionist/`.
- `Dev Front` integra las clases reales vía API routes, en `src/app/`.
- Cada uno toca archivos **disjuntos** → PRs sin merge conflicts.

> Sin contratos sólidos al inicio, los agentes inventan APIs incompatibles entre sí. El primer intento de Issue 0 (sin que yo escribiera los contratos) reintrodujo SMS y un waitlist sin backfill.

## 5. El flujo de trabajo por issue

Lo que pasa cuando asignas un issue a un agente:

1. **Daemon recibe la asignación** (polling ~30s).
2. **Clona o actualiza el cache bare** del repo.
3. **Crea un worktree aislado** en `~/multica_workspaces/<ws>/<task>/workdir/` desde ese cache.
4. **Inyecta un `AGENTS.md`** en el workdir con la identidad del agente (rol + instrucciones Karpathy).
5. **Lanza `opencode run --dir <workdir> "<prompt>"`** — el prompt dice: lee el issue, lee sus comentarios (obligatorio), trabaja.
6. **El agente itera** (tool calls: read, write, bash, edit) hasta cumplir el criterio de éxito.
7. **Entrega** (el paso que tuvimos que enseñarle por comentario):
   ```bash
   git checkout -b feat/petdesk-N
   git add -A && git commit -m "..."
   git push https://github.com/rubenaros/petdesk.git HEAD:feat/petdesk-N
   gh pr create --repo rubenaros/petdesk --base main --head feat/petdesk-N ...
   ```
8. **Marca el issue como `in_review`** y termina.

## 6. La automatización del setup (script reusable)

Todo el setup de PetDesk (5 agentes + 6 issues + asignación) está en **un único script versionado**:

📄 [`scripts/setup-petdesk-multica.sh`](../scripts/setup-petdesk-multica.sh)

Idempotente (no duplica si re-corres). Dos fases:
```bash
./setup-petdesk-multica.sh             # crea agentes + issues sin asignar
./setup-petdesk-multica.sh --assign N  # dispara el issue N (uno por vez)
```

Las **instrucciones Karpathy + rol por agente** están embebidas en el script. Las **descripciones de issues** también (con `--description-file` para multi-línea).

### 6.1 Comandos clave del CLI que usa el script

```bash
multica agent create --runtime-id <opencode-rt> --name "..." --instructions "..." \
  --visibility workspace
multica issue create --title "..." --description-file <archivo>
multica issue comment add <issue-id> --content-file <archivo>   # mandatory read
multica issue assign <issue-id> --to "<nombre-agente>"           # ← dispara la tarea
multica issue status <issue-id> done
multica issue runs <issue-id> --output table
multica issue runs <issue-id> --output json                       # para parsear progreso
multica runtime list                                              # ID del runtime OpenCode
```

> **Truco**: `multica issue assign` **dispara la ejecución inmediatamente**. Por eso el script crea todo unassigned primero y la fase 2 (`--assign N`) gatilla en orden de dependencia.

## 7. La realidad: lo que falló y cómo lo arreglamos

Los puntos donde el agente puro **no basta** y tuve que intervenir como arquitecto.

### 7.1 Vista rápida (los 10 errores)

| # | Problema | Causa | Cómo se resolvió |
|---|---|---|---|
| 1.1 | Confiamos en el reporte sin re-verificar | Notas viejas decían "Multica no tiene binding de repo" — la v0.3.6 sí lo tiene | Verifiqué en el código fuente del server (`grep -r repo`) antes de plantearlo |
| 1.2 | Nada llegaba a GitHub | GitHub App de Multica no instalada (necesita webhook público, no llega a `localhost`) | Comentario obligatorio en cada issue con `git push` directo + `gh pr create` |
| 2.1 | Issue 0 borró `docs/PLAN.md` + git remote | `create-next-app` hace `git init` fresco, arrasa con todo | Hice el scaffold yo a mano, reutilizando solo el andamiaje del agente |
| 2.2 | Agente inventó contratos divergentes (con SMS, sin backfill) | "Según docs/PLAN.md" no es contractual para un LLM | Escribí `types.ts` + `ports.ts` correctos a mano |
| 3.1 | Vigía salió a los 20s pensando que el agente había terminado | Chequeaba `status != in_progress` como terminal; pero `todo` (pre-pickup) caía ahí | Lista explícita: `terminal = in_review \| done \| cancelled \| failed` |
| 4.1 | QA tocó `src/domain/ports.ts`; Deploy tocó `brain.ts`+tests | Scope creep — los agentes optimizan localmente | Revisé cada PR; acepté lo aditivo (QA), descarté lo invasivo (Deploy) |
| 4.2 | QA y Deploy chocaban en archivos de test | Scope no era lo suficientemente disjunto | Mergeé QA (dueño legítimo); descarté las ediciones a tests del Deploy |
| 4.3 | Lint rompía CI (`any` en tests, `set-state-in-effect`) | Reglas estrictas de Next 16/React 19 vs práctica de fakes/polling | Overrides en `eslint.config.mjs` (relajar reglas para tests + polling) |
| 4.4 | `tsconfig.tsbuildinfo` commiteado | `.gitignore` inicial pobre | Agregué `*.tsbuildinfo` antes del fan-out paralelo (evitó 3 PRs chocando) |
| 5.1 | Vercel GitHub auto-connect falló | Vercel GitHub App no instalada en cuenta `rubenaros` | Pendiente: 1 clic en `vercel.com/.../settings/git` |
| 5.2 | URL de Vercel devuelve 401 | "Deployment Protection" ON por default en el team | Pendiente: 1 clic en `settings/deployment-protection` → Disabled |
| 6.1 | Subestimé costo por tarea 4–7× | El cálculo asumía "60k in + 20k out de una pasada"; agentes hacen 30–125 tool calls re-enviando contexto | Calibración: multiplicar estimaciones "single-call" por 3–5× |

### 7.2 Análisis profundo (agrupado por fase)

#### Fase 1: Setup inicial y supuestos

**Error 1.1 — Confiamos en el reporte sin re-verificar.** Asumí que Multica "no tenía binding de repo" porque el reporte de research lo decía. La realidad: la v0.3.6 sí lo tiene; el reporte estaba desactualizado. La documentación de research envejece rápido en proyectos OSS activos. **Lección: verifica en el código instalado, no en notas previas.**

**Error 1.2 — No instalamos el GitHub App de Multica.** Asumí que asignar un issue + completarlo abriría un PR automático. Pero el flujo PR de Multica necesita su GitHub App instalada + webhook público (no llega a `localhost` sin túnel). El fix fue agregar un comentario obligatorio a cada issue con el paso de entrega manual. **Lección: en self-host local, los webhooks GitHub→Multica no funcionan sin túnel; mejor que el agente pushee y abra PR él mismo con `gh`.**

#### Fase 2: Issue 0 (el scaffold)

**Error 2.1 — Dejamos que el agente corriera `create-next-app` sobre el repo.** Issue 0 corrió 5 min y abrió 0 PRs porque `create-next-app` hizo `git init` fresco — arrasó con commits, remote y `docs/PLAN.md`. El fix fue hacer el scaffold yo en local. **Lección: los scaffolders agresivos (`create-next-app`, `create-react-app`, `npm init`) no se mezclan con repos preexistentes. El arquitecto scaffoldea y empuja; los agentes construyen encima.**

**Error 2.2 — El agente inventó contratos divergentes.** Escribió `src/domain/types.ts` con campos distintos al plan: `durationMinutes` en vez de `durationMin`, `WaitlistEntry` sin `windowStart/windowEnd/createdAt` (rompía el backfill FIFO), `Notification.channel: 'sms'|...` (¡reintrodujo SMS!). El agente improvisa cuando le parece. El fix: escribir yo los contratos. **Lección: el arquitecto escribe los contratos a mano, no los delega. Los agentes deben *consumir* las interfaces, no *definirlas*.**

#### Fase 3: Monitoreo

**Error 3.1 — Vigía con condición de salida incorrecta.** Mi primer vigía salió a los 20s diciendo "terminó", pero el agente recién había sido asignado y el daemon no lo había tomado aún. Chequeaba `status != "in_progress"` como terminal — pero `todo` (estado inicial pre-pickup) caía en esa condición. Lo cambié a una lista explícita: `terminal = in_review | done | cancelled | failed`. **Lección: en máquinas de estado, lista explícita de estados terminales, nunca "todo lo que no sea X".**

#### Fase 4: Integración de PRs paralelos

**Error 4.1 — Scope creep entre agentes.** QA tocó `src/domain/ports.ts` (agregó `saveClient()`); Deploy tocó `src/receptionist/brain.ts` y archivos de test del Dev Chat. Los agentes optimizan localmente — sus instrucciones decían "no toques X" pero lo justifican cuando les conviene. Revisé cada PR antes de mergear. **Lección: "No toques X" no es contractual para un LLM. Toda integración necesita revisión humana antes de mergear.**

**Error 4.2 — Conflictos de test entre QA y Deploy.** QA y Deploy ambos modificaron `tests/brain.test.ts` y `tests/engine.test.ts` desde el mismo `main`. Mergeé QA (dueño legítimo) y descarté las ediciones de Deploy a esos archivos. **Lección: asignar un dueño claro por directorio (QA→tests/, Deploy→.github/+README, Front→app/) en el plan. Hacer el "no entres acá" explícito en las instrucciones.**

**Error 4.3 — Lint rompía CI por configuración no afinada.** 12 errores `any` en tests (fakes de QA) + 1 error `react-hooks/set-state-in-effect` (polling en dashboard). El fix fueron overrides en `eslint.config.mjs`: `no-explicit-any: off` para `tests/**`, `set-state-in-effect: warn` global. **Lección: la configuración de lint del scaffolder default no es la que necesitas. Ajustar config es la solución correcta, no contorsionar el código.**

**Error 4.4 — Artefactos de build commiteados.** PR #2 incluyó `tsconfig.tsbuildinfo`. Mi `.gitignore` inicial no lo cubría. Lo agregué a `main` antes del fan-out de 3/4/5 — si no, las 3 ramas paralelas habrían chocado sobre ese archivo regenerable. **Lección: un `.gitignore` agresivo desde el inicio (incluir `*.tsbuildinfo`, `.next/`, `coverage/`).**

#### Fase 5: Deploy en Vercel

**Error 5.1 — Vercel GitHub auto-connect falla.** `vercel git connect` devolvió error porque la Vercel GitHub App no está instalada en la cuenta `rubenaros`. Sin eso, Vercel no puede leer el repo privado. Fix: pendiente — 1 clic en `vercel.com/.../settings/git`. **Lección: la integración Vercel↔GitHub para repos privados requiere la app instalada por el owner del repo. No es un setup CLI-only.**

**Error 5.2 — URL pública responde 401.** El deploy quedó `Ready` pero la URL devolvió 401. Causa: el team `felipearosrs-projects` tiene "Deployment Protection" ON por default. Fix: pendiente — 1 clic en `settings/deployment-protection`. **Lección: los teams de Vercel tienen protections por default; revisar las settings del team antes de presumir que el deploy es accesible.**

#### Fase 6: Estimación de costos

**Error 6.1 — Subestimación 4–7× del costo por tarea.** El reporte original proyectó $0.086–0.137 por tarea con Kimi; lo real fue **$0.59 promedio**. El cálculo asumía "60k input + 20k output en una pasada" — pero los agentes hacen 30–125 tool calls y cada uno re-envía el contexto acumulado, inflando el input multiplicativamente. **Lección: estimar costo de agentes con la fórmula de una llamada simple es engañoso. La verdad operativa solo se sabe midiendo (OpenRouter `/auth/key`).**

### 7.3 Las 3 lecciones más importantes

1. **El arquitecto define los contratos y scaffoldea**, no los agentes. Lo mecánico (Next init, types, ports, scaffolds) lo haces tú; lo creativo (features, lógica, UI) lo hacen ellos.

2. **"No toques X" no es contractual para un LLM** — es una recomendación que ignora cuando le conviene. Toda integración necesita revisión humana antes de mergear.

3. **Los costos reales son 3–5× las estimaciones "single-call"** por el re-envío de contexto en agentes con muchos tool calls. Mide en OpenRouter, no estimes.

## 8. La receta para replicar en otro proyecto

1. **Crea el repo en GitHub** vacío.
2. **Escribe tú el `PLAN.md`** con: stack, modelo de dominio, **contratos (interfaces)**, layout de archivos disjunto por issue.
3. **Scaffoldea localmente** (Next / FastAPI / lo que sea) + commit + push a `main`. **No dejes el scaffold a un agente** (gana tiempo y evitas que rompa git).
4. **En Multica**: Settings → Repositories → agrega la URL del repo nuevo.
5. **Adapta `scripts/setup-petdesk-multica.sh`**: cambia nombres de agentes, issue bodies, owner/repo en la entrega.
6. **Corre el script**, asigna en orden de dependencia, mergea PRs entre tareas (los agentes no saben rebase).
7. **Verifica integración** localmente al final (lint + test + build) antes del último push.
8. **Conecta a Vercel** una vez: `vercel link` + clic en Settings → Git → Connect Repository.

## 9. Stack y tiempos

| | |
|---|---|
| **Scaffold** | Next.js 16 (App Router) + TS + Tailwind 4 + Vitest 4 |
| **CI** | GitHub Actions: `npm ci && lint && test && build` |
| **Deploy** | Vercel (auto-detecta Next; sin `vercel.json`) |
| **Persistencia MVP** | `InMemoryRepo` (resetea en cold start; swap a Postgres/Upstash detrás de `Repository` es fase posterior) |

**Tiempos por tarea agéntica:** **14–28 min**. Dominado por las **rondas LLM** (no por la máquina). Cada call re-envía el contexto acumulado, así que tareas con 30–125 tool calls inflan el input.

**Cura de la lentitud:** paralelismo. Los Issues 3, 4 y 5 corrieron a la vez en **~27 min de reloj**, no 80.

## 10. Costos reales (medidos en OpenRouter)

| | USD |
|---|---|
| Gasto **acumulado** de la key | **$4.21** |
| Gasto esta semana (≈ esta sesión) | $4.12 |
| Saldo restante | $5.79 de $10 cargados |

**~7 tareas agénticas** ejecutadas → **~$0.59 promedio por tarea**.

> **Calibración importante**: el reporte original (`research/reporte-agentes-kanban-modelos.md`) proyectaba $0.086–0.137 por tarea para Kimi. Lo real fue **4–7× eso**. La razón: la estimación asumía "60k in + 20k out de una pasada"; las tareas reales hacen 30–125 tool calls re-enviando contexto.
> **Regla práctica**: multiplica las estimaciones "una iteración" por **3–5×** para tareas agénticas reales.

### Comparación con otros modelos (mismo trabajo)

| Modelo | Costo estimado del showcase | Veces vs Kimi |
|---|---|---|
| **Kimi K2.6** (lo que usamos) | **$4.21** ✓ | 1× |
| Claude Sonnet 4.6 | ~$15–25 | 4–6× más caro |
| Claude Opus 4.7 | ~$25–40 | 6–10× más caro |
| DeepSeek V3.2 | ~$0.50–1.00 | ~5× más barato |

## 11. Resultado entregado

| | |
|---|---|
| **Repo** | https://github.com/rubenaros/petdesk |
| **Commits en `main`** | scaffold + engine (PR #1) + chat (PR #2) + frontend (PR #4) + QA (PR #3) + CI/README (integrado del PR #5) |
| **Tests** | 4 archivos, **18/18 verdes** |
| **Lint / Build** | 0 errores |
| **Vercel** | proyecto `felipearosrs-projects/petdesk` desplegado en producción (URL pendiente de 1 clic para hacerla pública) |
| **CI** | `.github/workflows/ci.yml` correrá en cada push/PR |
| **Multica** | issues ZEN-4 a ZEN-9 marcados `done` |

---

## 12. Lo que demostró este showcase

- **Paralelismo real** con 3 agentes Kimi a la vez en ramas aisladas (~27 min de reloj para 3 tareas).
- **Pipeline completo y reproducible** desde la línea de comandos: tablero → asignación → ejecución aislada → PR → merge → deploy.
- **Costo de orden centavos por tarea**, dos órdenes de magnitud bajo Opus.
- **Y los límites honestos**: los agentes se desvían de contratos, salen de scope, rompen git con scaffolders agresivos, no auto-pushean. **La integración necesita un humano/arquitecto** que escriba los contratos, mergee con cuidado y arregle lint a nivel config.

---

## 13. Playbook paso a paso (cómo arrancar un flujo de cero)

Asume que la infra (Multica + OpenCode + key Kimi) ya está montada — fue 1 sola vez. Esto es el flujo de **cada proyecto nuevo**.

### 0. Pre-flight (verifica que la infra esté viva)
```bash
multica daemon status
# debe decir: running, con agentes detectados (claude, opencode, gemini)
```
Si `stopped` → `multica daemon start`. Si "not authenticated" → `multica setup self-host`.

### 1. Escribe el plan tú (no el agente)
En `~/Projects/<proyecto>/docs/PLAN.md`: stack, modelo de dominio, **contratos (interfaces)**, layout de archivos disjunto por issue, los issues. Sin esto el primer agente inventa contratos divergentes.

### 2. Crea el repo y empuja el esqueleto
```bash
cd ~/Projects/<proyecto>
git init && git add -A && git commit -m "scaffold + contratos"
gh repo create <proyecto> --private --source=. --push
```
**Hazlo tú, no el agente** (los scaffolders tipo `create-next-app` reinicializan git).

### 3. Conecta el repo al workspace de Multica (UI, único paso sin CLI)
http://localhost:3000 → **Settings → Repositories → Add** → URL del repo → Save.

### 4. Crea los agentes (CLI, idempotente)
Adapta `scripts/setup-petdesk-multica.sh`: cambia nombres y addenda de rol. Corre el script — crea los 5 sobre el runtime OpenCode (heredan Kimi K2.6 default).

### 5. Crea los issues — sin asignar
```bash
multica issue create --title "..." --description-file ./issue-N.md
```
Cuerpo de cada issue: contexto + qué construir + **criterio de éxito verificable** + paso de entrega (`git push https://github.com/... HEAD:feat/N` + `gh pr create`).

### 6. Comentario obligatorio con reglas extra
```bash
multica issue comment add <issue-id> --content-file ./reglas.md
```
(Multica le dice al agente que lea los comentarios como obligatorio al asignarse.)

### 7. Dispara el primer issue (sin dependencias)
```bash
multica issue assign <issue-id> --to "Orquestador"
```
En ese momento el daemon clona, crea worktree, inyecta `AGENTS.md`, lanza `opencode run`.

### 8. Monitorea (3 lugares útiles)
- **UI**: feed del issue en vivo (cada tool call).
- **CLI**: `multica issue runs <id>`, `multica issue get <id>`, `multica agent list`.
- **Daemon log**: `tail -f ~/.multica/daemon.log`.

### 9. Cuando el agente termina
Status pasa a `in_review`, aparece PR en GitHub. **Tú revisas + mergeas**:
```bash
gh pr diff <N>; gh pr merge <N> --squash --delete-branch
multica issue status <issue-id> done
```

### 10. Dispara los siguientes en orden de dependencia
Los que no dependen entre sí → **en paralelo** (3 agentes a la vez = mismo tiempo de reloj):
```bash
multica issue assign <id-2> --to "Dev Motor"
multica issue assign <id-3> --to "Dev Chat"
multica issue assign <id-4> --to "Dev Front"
```

---

## 14. Lo autónomo vs lo manual (clave para entender el flujo real)

**Multica puede ser más autónomo** (vía `multica autopilot` y `multica squad` con leader que delega), pero **en este proyecto no lo usamos**. Las transiciones entre agentes las disparé yo (o el script). Esta tabla aclara qué es 🤖 (automático) y qué es 👤 (humano):

| Lo que se podría pensar que pasa solo | Lo que realmente pasa |
|---|---|
| "El agente X pide lanzar a otros" | 👤 yo lanzo cada uno con `multica issue assign` |
| "Dev termina → QA se activa solo" | 👤 yo mergeo el PR y asigno QA |
| "QA detecta error → re-devuelve al dev" | 🤖 QA comenta el bug → 👤 yo re-asigno al dev |
| "Agente CI/CD se activa cuando todo pasó" | 🤖 GitHub Actions + Vercel reaccionan al `git push` (sin agente Multica) |

### Lo que sí es 🤖 (automático)
- Daemon claim del task asignado y creación del worktree.
- Clone/fetch del repo, inyección de `AGENTS.md`.
- Cada tool call del agente se refleja en el feed del issue por WebSocket.
- Status del issue: `todo → in_progress → in_review` lo cambia el daemon/agente.
- CI (GitHub Actions) corre en cada `git push`.
- Vercel re-despliega en cada push a `main` (una vez conectado el GitHub App).
- Lectura obligatoria de comentarios cuando un agente recibe asignación.

### Lo que es 👤 (decisión humana en cada vuelta)
- Escribir el `PLAN.md` y los contratos.
- Crear agentes + issues + comentarios (una vez por proyecto).
- Cada `multica issue assign` (decide qué disparar y cuándo).
- Revisar PRs, resolver conflictos de integración entre ramas paralelas.
- Marcar issues como `done`, re-abrir si QA encuentra bug.
- Arreglar config de lint, hacer el `vercel link`, instalar GitHub Apps.

### Cómo hacerlo más autónomo (lo que no probamos)
- **`multica autopilot create`** — agente que monitorea condiciones (ej. "issue in_review + ZEN-N done → asigna QA") y dispara acciones.
- **`multica squad create`** — grupo con un *leader agent* que decide qué subagente toma cada tarea.
- **Webhooks GitHub → Multica API** — un workflow que llame a Multica al mergear un PR para asignar el siguiente issue.

Próximo experimento natural: armar un Autopilot que cierre el loop "QA → re-asigna al dev solo".
