# Capas de harness del stack — referencia (v6)

Documento de referencia: las capas de harness de un agente de código según la literatura,
mapeadas contra nuestro stack, con las versiones de cada componente al momento del v6.

Relacionado: [reporte-agentes-kanban-modelos.md](./reporte-agentes-kanban-modelos.md) · [multica-deep-dive.md](./multica-deep-dive.md) · retrospectivas en `../docs/`.

---

## 1. Versiones del stack (estado al v6)

| Componente | Versión | Rol | Capas de harness que cubre |
|---|---|---|---|
| **Multica** | 0.3.17 | Tablero / daemon de orquestación | Exterior: workspace, cola/despacho, ciclo de vida, reporte |
| **opencode** | 1.16.2 | Ejecutor (CLI) por tarea | Interior: loop, tools, contexto de trabajo |
| **gentle-ai** | 1.34.1 (congelado) | Overlay de método y memoria | Planificación (SDD), memoria, skills, sub-agentes, hooks |
| **Engram** | 1.16.1 | Memoria persistente (servidor + MCP) | Memoria episódica/semántica, persistencia |
| **gga** | 2.8.1 | Revisión por IA (opcional) | Verificación |
| **Modelos** | Kimi K2.6 · DeepSeek V3.2 | Inferencia | Capa del modelo (vía OpenRouter) |
| Infra | Node 22 · Postgres 17/pgvector · Go 1.26 | Soporte | — |

Gateway: OpenRouter. CI/entrega: GitHub Actions + auto-merge. Contratos: el arquitecto (humano).

---

## 2. Marco: las 13 capas de harness (literatura)

Síntesis de fuentes primarias (Anthropic, SWE-agent, CoALA y papers 2024-2026). Principio
central convergente: **el modelo razona; el harness actúa.** El límite entre ambos es una
decisión de diseño con consecuencias de rendimiento (SWE-agent pasó de 6,7% a 68,3% en
SWE-bench mejorando el harness, no el modelo). En Claude Code, ~1,6% del código es lógica
del modelo y 98,4% es infraestructura de harness.

| # | Capa | Qué hace |
|---|---|---|
| 1 | Modelo / inferencia | Razona, genera, decide qué tool llamar. Es lo único que NO es harness. |
| 2 | Prompt / instrucción (scaffold) | System prompt, skills, persona, contratos, esquemas de tools. Se arma antes del primer turno. |
| 3 | Loop de control | Ciclo observar-pensar-actuar: llama al modelo, ejecuta tools, reinyecta resultados. |
| 4 | Uso de tools / function calling | Registro de tools, despacho, validación de esquema, devolución de resultados. |
| 5 | Entorno / sandbox / workspace | Filesystem, shell, contenedor, estado git aislado donde se ejecutan las acciones. |
| 6a | Contexto de trabajo | Qué entra al context window por turno; compactación bajo presión. |
| 6b | Memoria persistente | Almacenamiento que sobrevive al reset de contexto: episódica, semántica, recuperación. |
| 7 | Planificación / descomposición | Parte un objetivo en subtareas, ordena, trackea estado. |
| 8 | Orquestación / multi-agente | Rutea a sub-agentes, topología de comunicación, fan-out/fan-in. |
| 9 | Verificación / guardrails / auto-crítica | Tests, validadores, gates humanos, política de seguridad, auto-reflexión. |
| 10 | Estado / persistencia de sesión | Transcripts, listas de tareas, artefactos, checkpoints; sobrevive a crash/multi-sesión. |
| 11 | Hooks de ciclo de vida / observabilidad | Auth, logging, política, instrumentación en puntos definidos del loop. |
| 12 | Cola / despacho de tareas | Acepta, encola, rutea y despacha tareas a agentes/sub-agentes. |
| 13 | Reporte / entrega | Última milla: formato, PR, commit, respuesta API, reporte estructurado. |

**Inner loop vs outer loop:** el *inner loop* es un turno (observar-pensar-actuar dentro de
una ventana de contexto); el *outer loop* abarca múltiples tareas/sesiones (planificación de
alto nivel, recuperación de fallas, continuidad cross-sesión).

---

## 3. Mapeo: quién implementa cada capa en nuestro stack

| # | Capa | Implementa | ¿Nativa de Multica o agregada? |
|---|---|---|---|
| 1 | Modelo | Kimi / DeepSeek (OpenRouter) | Externa |
| 2 | Prompt / instrucción | opencode (base) + gentle-ai (skills, prompt del orquestador) + arquitecto (CONSTITUTION, contratos) | Agregada |
| 3 | Loop de control | **opencode** | Agregada (opencode) |
| 4 | Tools / function calling | opencode + tools de Engram (MCP) | Agregada |
| 5 | Entorno / workspace | **Multica** (`multica_workspaces/<ws>/<task>/workdir`) | **Nativa de Multica** |
| 6a | Contexto de trabajo | **opencode** | Agregada (opencode) |
| 6b | Memoria persistente | **Engram** (gentle-ai) | Agregada — pieza central |
| 7 | Planificación / descomposición | **SDD** (gentle-ai) + arquitecto (split manual) | Agregada |
| 8 | Orquestación / multi-agente | Multica (outer: asigna issues) + sub-agentes gentle-ai (inner: fases) | Nativa (outer) + agregada (inner) |
| 9 | Verificación / guardrails | CI GitHub + contract tests (arquitecto) + skill judgment-day + fase verify de SDD | Agregada |
| 10 | Estado / persistencia | Multica (estado issue + runs) + opencode (sesiones) + Engram (memoria) + repo (artefactos openspec) | Nativa (parcial) + agregada |
| 11 | Hooks / observabilidad | Multica (timeout, cancel, rerun, failure_reason, costo) + plugins gentle-ai (background-agents, engram, model-variants) | Nativa (outer) + agregada (inner) |
| 12 | Cola / despacho | **Multica** | **Nativa de Multica** (su capa más propia) |
| 13 | Reporte / entrega | Multica (tablero) + GitHub CI + auto-merge | Nativa (parcial) + agregada (entrega) |

---

## 4. Síntesis inner/outer loop

```
OUTER LOOP (multi-tarea, cross-sesión)
  ├─ Multica        → workspace, cola/despacho, ciclo de vida, tablero   [5, 8-outer, 11-outer, 12, 13-parcial]
  └─ gentle-ai/SDD  → descomposición en fases, orquestación de sub-agentes [7, 8-inner]

INNER LOOP (por-turno: observar-pensar-actuar)
  └─ opencode       → loop, tools, contexto de trabajo, compactación      [3, 4, 6a]

TRANSVERSAL (persiste y verifica)
  ├─ Engram         → memoria episódica/semántica                          [6b, 10-parcial]
  ├─ GitHub CI      → verificación + entrega autónoma                      [9, 13]
  └─ arquitecto     → scaffold de contratos + tests ejecutables            [2, 9]
```

---

## 5. Qué implementa Multica vs qué agregamos

**Multica (harness exterior, acotado):** capas 5 (workspace), 12 (cola/despacho), 11-outer
(ciclo de vida), 8-outer (asignación) y partes de 10 y 13 (estado y reporte al tablero).
Son ~5 de las 13. No toca el inner loop, ni la memoria persistente, ni la planificación, ni
la verificación/entrega.

**Lo que agregamos apilando componentes:**
- **opencode** → todo el inner harness (3, 4, 6a). Sin esto, Multica no tiene agente.
- **gentle-ai y componentes:** Engram → memoria persistente (6b); SDD/spec-driven →
  planificación (7) + verify (9); skills → instrucción/scaffold (2, memoria procedural);
  sub-agentes → multi-agente inner (8); plugins → hooks inner (11); judgment-day →
  verificación a ciegas (9).
- **Arquitecto + GitHub CI** → scaffold de contratos (2), verificación (9: contract tests + CI),
  entrega autónoma (13: auto-merge).

**Conclusión.** De 13 capas, Multica implementa ~5 (un harness exterior real pero delgado).
El inner loop, la memoria, el método, la verificación y la entrega los aportamos nosotros.
Por eso Multica es sustituible por un script + GitHub Actions para buena parte de su función;
el valor diferenciador del stack vive en las capas agregadas (opencode + gentle-ai + CI + contratos).

---

## Fuentes

- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic — Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works)
- [SWE-agent: Agent-Computer Interfaces (arXiv:2405.15793)](https://arxiv.org/abs/2405.15793)
- [CoALA — Cognitive Architectures for Language Agents (arXiv:2309.02427)](https://arxiv.org/pdf/2309.02427)
- [SWE-bench Harness](https://www.swebench.com/SWE-bench/reference/harness/)
- [Awesome-Agent-Harness (survey)](https://github.com/Gloriaameng/Awesome-Agent-Harness)
