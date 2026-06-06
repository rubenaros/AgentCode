# Baseline de entorno — v3 (congelado antes del upgrade)

Snapshot del entorno con el que se midió el artículo v3 (`MEDIUM-ARTICLE-V3.md`).

> **Nota:** la comparación del v4 se hace contra **v2**, no contra v3 — ver
> `env-baseline-v4.md`. Este documento queda como registro histórico del estado
> congelado y de la prueba de compatibilidad del upgrade.

**Fecha del snapshot:** 2026-06-05T23:13:48Z

## Versiones congeladas (estado "antes")

| Herramienta | Versión v3 (baseline) | Notas |
|---|---|---|
| **opencode** | 1.15.10 | Runner que dispara el daemon de Multica |
| **gentle-ai** | 1.34.1 | Overlay SDD sobre opencode (3 plugins + Engram) |
| **engram** | 1.16.1 | Memoria persistente (server en :7437) — al día |
| **gga** | 2.8.1 | Code review por AI — al día |

Los plugins del overlay v3: `engram.ts`, `model-variants.ts`, `background-agents.ts`
(en `~/.config/opencode/plugins/`). Modelo por defecto: `openrouter/moonshotai/kimi-k2.6`.

## Métricas v3 medidas con este entorno

Referencia: `MEDIUM-ARTICLE-V3.md`. Medido sobre petdesk-v2, feature Stats Dashboard, 3 issues.

| Métrica | v2 | v3 (gentle-ai 1.34.1) |
|---|---|---|
| Costo por issue promedio | ~$0.45 | $0.72 (+60%) |
| Tiempo por issue promedio | ~12 min | ~23 min (+92%) |
| Tests al cierre | 31 | 48 |
| Memorias persistidas (Engram) | 0 | 3 |
| SDD activado | — | 0 fases (orquestador fue directo) |

## Prueba de compatibilidad del upgrade (smoke test aislado)

Antes de cambiar el entorno se validó OpenCode **1.16.2** contra el overlay **1.34.1**
en un sandbox aislado (`npx opencode-ai@1.16.2`, `XDG_CONFIG_HOME`/`XDG_DATA_HOME`
redirigidos a `/tmp/oc-test`, sin tocar el global). Resultado: **limpio**.

- 3 plugins gentle-ai → cargaron sin fallo
- MCP engram → conectó, `toolCount=15`
- Routing → `openrouter/moonshotai/kimi-k2.6`, respuesta OK, exit 0
- Errores fatales → cero (los WARN de `duplicate skill name` eran artefacto del sandbox)

## Target del v4 (decidido)

Re-correr el mismo experimento Stats Dashboard cambiando SOLO la capa de
orquestación + runner, dejando el overlay SDD constante:

| Herramienta | v3 (baseline) | v4 (target) | Cambio |
|---|---|---|---|
| **opencode** | 1.15.10 | **1.16.2** | ✅ aplicado |
| **Multica** | 0.3.6 | **0.3.17** | ✅ aplicado |
| **gentle-ai** | 1.34.1 | **1.34.1** | 🔒 congelado (variable controlada) |
| **engram** | 1.16.1 | 1.16.1 | sin cambio |
| **gga** | 2.8.1 | 2.8.1 | sin cambio |

Decisión metodológica: congelar gentle-ai aísla el efecto de los cambios de
Multica (event-driven triggers, autopilot) + opencode (edit-safety, config por
worktree), sin introducir la variable del overlay (hard delegation gates de 1.36.5).

Backup DB pre-upgrade: `~/.multica/backups/multica-db-pre-0.3.17.sql`.

## Pendiente antes de re-correr

- **Slate limpio:** petdesk-v2 ya tiene la feature Stats Dashboard del v3. Hay que
  resetear el repo al estado v2 (pre-stats) para que el A/B sea válido.
- Re-correr `scripts/setup-petdesk-v3-stats.sh` con el entorno v4 y re-medir
  costo/tiempo/tests/memorias contra la tabla v3 de arriba.
