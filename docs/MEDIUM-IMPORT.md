# 12 errores con 5 agentes IA y los 4 patrones que arreglaron todo: $4.21 → $1.80 por el mismo MVP

*Construí dos veces la misma app con un orquestador multiagente. La v2 me costó 57% menos, 73% menos tiempo, y necesitó 75% menos intervenciones mías. Esto es lo que hice mal al primer intento y lo que cambié.*

![PetDesk v1 vs v2](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/hero-v1-vs-v2.png)

Hace dos semanas decidí probar algo concreto: armar un MVP real con varios workers IA, no con un solo agente como Copilot. Quería ver si la promesa del "Kanban con agentes IA" era humo o tenía sustancia. Elegí construir **PetDesk** — una mini-SaaS de recepcionista IA para peluquerías caninas (chat de reservas + dashboard + *backfill* de cancelaciones).

El stack: **Multica** self-host (orquestador open source, ~32k ⭐ en GitHub), **Kimi K2.6** vía **OpenRouter** (10× más barato que Claude Opus), **OpenCode** como CLI del agente, **GitHub** + **Vercel** para deploy.

Cinco agentes simultáneos: Arquitecto, Dev Motor, Dev Chat, Dev Front, QA.

La primera vuelta (v1) la entregué en 3 horas por $4.21. **Funcionó**, pero con dolor. La segunda vuelta (v2), aplicando lecciones, la entregué en **49 minutos por $1.80**. Mismo producto, mismo nivel de calidad, más cobertura de tests.

Esto es la experiencia — los 12 errores, las 3 lecciones que mejoraron todo, los 4 patrones que produjeron el v2, y los números reales medidos en OpenRouter.

## v1: la sesión donde aprendí qué NO hacer

### Fase 1 — Setup: dos supuestos erróneos

**Error 1.** Confié en un reporte de research que decía "Multica no tiene binding de repo". Resulta que sí lo tiene desde la v0.3.6. Tuve que verificar en el código fuente del server para descubrirlo. **Lección: la documentación de research envejece más rápido que el código de proyectos OSS activos.** Verifica en el código instalado, no en notas.

**Error 2.** Asumí que asignar un issue + agente completándolo = PR automático en GitHub. No. Multica necesita su GitHub App instalada + webhooks públicos (que `localhost` no recibe). Tuve que enseñarle a cada agente el paso de entrega con `gh pr create` mediante un comentario obligatorio en el issue.

### Fase 2 — El Issue 0 (scaffold): cuando el agente arrasó el repo

**Error 3 — el más caro.** Le pedí al primer agente que scaffoldeara Next.js con `create-next-app`. El comando hizo `git init` fresco. Resultado: borró el remote a GitHub, borró mi `docs/PLAN.md`, y dejó el worktree desconectado del origen. **5 minutos de trabajo del agente, $0.40 quemados, 0 PRs abiertos.**

> Los scaffolders agresivos (`create-next-app`, `create-react-app`, `npm init`) no se mezclan con repos preexistentes. **El arquitecto scaffoldea; los agentes construyen encima.**

**Error 4.** Cuando hice el scaffold yo mismo, el agente ya había escrito sus propios contratos en `src/domain/types.ts`. Improvisó campos distintos al plan (`durationMinutes` vs `durationMin`), removió el campo `windowStart/windowEnd` del Waitlist (que es **la clave del feature estrella de backfill FIFO**), y reintrodujo SMS en `Notification.channel` cuando explícitamente lo había descartado.

> "Según docs/PLAN.md" no es contractual para un LLM. **El arquitecto escribe los contratos a mano. Los agentes los consumen, no los definen.**

### Fase 3 — Monitoreo: bug en mi propio vigía

**Error 5.** Mi script para esperar a que el agente terminara salió a los 20 segundos diciendo "¡terminó!". El agente recién había sido asignado y el daemon ni siquiera había picked up la tarea. Yo chequeaba `status != "in_progress"` como condición terminal, pero `todo` (estado inicial pre-pickup) también caía ahí.

> En máquinas de estado, **lista explícita de estados terminales**, nunca "todo lo que no sea X".

### Fase 4 — Integración: los agentes se salieron del scope

**Error 6.** El agente QA tocó `src/domain/ports.ts` (agregó un método que "necesitaba" para sus tests). El agente Deploy editó `brain.ts` del Dev Chat (para "arreglar lint"). Ambos fuera de su scope.

> "No toques X" no es contractual para un LLM. Es una sugerencia que ignora cuando le conviene. **Toda integración necesita revisión humana.**

**Error 7.** QA y Deploy modificaron ambos `tests/brain.test.ts` y `tests/engine.test.ts`. Conflictos garantizados al mergear.

**Error 8.** El lint reventó con 12 errores: `any` casts en tests (legítimos para *fakes*) + `react-hooks/set-state-in-effect` en el dashboard (regla nueva agresiva de React 19 sobre polling legítimo). El default de eslint-config-next no estaba calibrado para mi caso de uso. Fix: overrides en `eslint.config.mjs` — la solución correcta no era doblarle la nariz al código del agente, era ajustar la config.

**Error 9.** Un agente commiteó `tsconfig.tsbuildinfo` (artefacto regenerable). Mi `.gitignore` inicial era pobre. Aprendí que **un `.gitignore` débil se replica en todos los PRs siguientes**, y si las 3 ramas paralelas regeneran el mismo archivo, chocan al mergear.

### Fase 5 — Vercel: las dos sorpresas finales

**Error 10.** `vercel git connect` falló. La Vercel GitHub App no estaba instalada en mi cuenta de GitHub. Auto-deploy quedó deshabilitado hasta hacer ese clic manual.

**Error 11.** La URL del deploy devolvió **401**. El team de Vercel tenía "Deployment Protection" ON por default. El deploy estaba "Ready" pero requería login Vercel para verlo. Otro clic manual en settings.

### Fase 6 — La estimación que rompió mi presupuesto mental

**Error 12.** El reporte original proyectó **$0.086 a $0.137 por tarea** con Kimi. Lo real fue **$0.59 promedio** — 4 a 7 veces más. La razón: el cálculo asumía "60k input + 20k output de una pasada". Pero los agentes hacen 30 a 125 tool calls por tarea, y **cada uno re-envía el contexto acumulado**. El input se infla multiplicativamente.

> **Estimar costo de agentes con la fórmula de una llamada simple es engañoso.** Multiplica esos números por 3 a 5 veces para tareas agénticas reales. Y mide en OpenRouter, no estimes.

## Las 3 lecciones que cambiaron todo

Después de esos 12 errores aprendí 3 principios:

**1. El arquitecto define contratos y scaffoldea. Punto.** Lo mecánico (Next init, types, ports, infraestructura) lo haces tú. El agente nunca toca esos archivos. Lo creativo (lógica, features, UI) lo hace él. Esto va contra la intuición de "que el agente haga TODO" pero es la palanca de mayor retorno.

**2. "No toques X" no es contrato — es una sugerencia que el LLM ignora cuando le conviene.** Necesitas enforcement estructural: **CODEOWNERS**, **branch protection**, y **tests que fallen si el contrato se viola**. Sin eso, todo depende de la disciplina del agente, que es inconsistente entre runs.

**3. Los costos reales son 3 a 5 veces las estimaciones "single-call".** Por el re-envío de contexto en agentes con muchos tool calls. **No estimes; mide en OpenRouter `/auth/key`.** Es la única verdad operativa.

## v2: rehice todo aplicando los patrones

Con las lecciones decidí rehacer el mismo producto en un repo nuevo (`petdesk-v2`), pero ahora con un **template completo** preparado por mí ANTES de invocar a ningún agente.

### Scaffold completo y contratos como ley

**Scaffold completo** (Next.js + TS + Tailwind + Vitest + fast-check). Los agentes ya no scaffoldean nada.

**`src/domain/`** con tipos + interfaces correctas. Los contratos del producto, escritos por mí.

**`tests/contracts/*.contract.ts`** — la spec ejecutable. Funciones property-based con fast-check que cualquier implementación debe pasar:

https://gist.github.com/rubenaros/ddb96c7db20ad84e484b938e52bc6a39

Cuando el agente Dev Motor implementa `Scheduler`, su test file simplemente escribe:

https://gist.github.com/rubenaros/a00e368ddf083731fe6280f3288cfaa9

Si su implementación no pasa, CI rojo. **Spec ejecutable, no markdown.** Esto es lo que ningún framework de SDD (OpenSpec, GitHub Spec-Kit — sí, los probé) entrega out-of-the-box.

### Reglas duras y guardrails estructurales

**`CONSTITUTION.md`** — reglas duras del proyecto: "no uses create-next-app", "no toques `src/domain/`", "entrega como PR usando este comando exacto". Inspirado en el concepto Constitution de Spec-Kit pero sin instalar Spec-Kit.

**`CODEOWNERS`** sobre `src/domain/`, `tests/contracts/` y `CONSTITUTION.md`.

**`.gitignore` agresivo** desde el primer commit (incluye `*.tsbuildinfo`, `.next/`, `coverage/`, swap files).

**`eslint.config.mjs`** con overrides para tests (`any` permitido en fakes) y polling — calibrado de antemano.

**`.github/workflows/ci.yml`** ya en el template — corre `lint + test + build` en cada PR.

**`docs/PLAN.md`** con marcadores `[P]` explícitos: "Issues 1 y 2 son paralelos; 3 y 4 dependen de 1+2 mergeados". Inspirado en Spec-Kit `tasks.md`.

### Lo que cambié en los agentes

**Cost routing**: el agente de Frontend lo creé con `--model openrouter/deepseek/deepseek-v3.2` (4 veces más barato que Kimi K2.6, calidad sobrada para UI mecánica + APIs sencillas).

**Cada issue body referencia el contract test** que su implementación debe pasar — la spec llega al agente automáticamente.

**Checklist marcable** al final del issue body — el agente debe marcar cada item en el PR antes de pedir merge.

## Los resultados reales (medidos en OpenRouter)

Esto es lo que produjo el v2 vs v1, con el mismo producto entregado:

- **Costo OpenRouter:** v1 $4.21 → v2 $1.80 (**−57%**)
- **Tiempo de reloj total:** v1 ~3h → v2 ~49 min (**−73%**)
- **Intervenciones humanas:** v1 ~12 → v2 3 (**−75%**)
- **Tests al cierre:** v1 18 → v2 31 (+72% cobertura)
- **PRs limpios al 1er intento:** v1 3/4 → v2 4/4
- **Scope violations:** v1 2 → v2 0
- **Basura commiteada:** v1 1 → v2 0

El motor de agenda en v1 lo escribió Kimi en 14 minutos. En v2, **6 minutos y 10 segundos** — más del doble de rápido. ¿La razón? No tuvo que improvisar nada. El contract test le decía exactamente qué cumplir, el `Repository` y `Clock` ya estaban en el template, no exploró estructura de archivos.

Y lo más importante: **0 violaciones de scope en v2** vs 2 en v1, sin necesitar branch protection (que en repos privados requiere GitHub Pro). El `CONSTITUTION.md` + el scope explícito en el issue body fue suficiente para que los 4 agentes respetaran sus límites.

DeepSeek V3.2 en el frontend entregó 10 archivos (8 en `app/` + 2 utilidades en `infra/`) sin desviarse y sin necesitar correcciones. La calidad fue indistinguible de Kimi para ese tipo de trabajo.

## Lo que te diría si vas a probar esto

**1. Escribe el plan tú mismo.** El plan, los contratos, los nombres de archivo, el layout. No lo delegues. Es la palanca de mayor retorno.

**2. Contratos como tests, no como markdown.** Si tu spec es un `.md` que el agente "debería seguir", olvídalo. Si tu spec es un test que falla en CI cuando el agente la viola, ahí sí tienes enforcement. fast-check + un patrón de suite parametrizada es todo lo que necesitas.

**3. Empieza con un template, no con un agente.** Scaffolding + configs + CI + `.gitignore` + `CONSTITUTION.md` antes de invocar a nadie. Cada minuto invertido en el template ahorra 10 minutos de errores en producción.

**4. Routea por costo.** El frontend (Next + Tailwind + APIs simples) no necesita el mejor modelo. DeepSeek V3.2 lo hizo perfectamente por 4 veces menos que Kimi.

**5. No estimes costos — mídelos.** Carga $10 en OpenRouter y revisa `/auth/key` después de cada corrida. Es la única forma real.

**6. No instales OpenSpec ni Spec-Kit.** Sí, los probé. Para flujos multiagente headless como Multica, son IDE-céntricos (asumen humano + AI en Cursor/Claude Code corriendo slash commands) y no resuelven el problema real: que el agente respete el contrato. **Adopta sus principios** — CONSTITUTION, [P] markers, contract tests, checklist por issue — sin agregar dependencias.

**7. Tres intervenciones humanas son OK. Cero intervención requiere mucho más setup.** Las 3 intervenciones del v2 (mergear cada ola + verificación final) son irreductibles sin Autopilot + webhooks + GitHub Actions. La diferencia entre 3 y 0 cuesta otras 3 horas de plomería; entre 12 y 3 las cierras con CONSTITUTION + contracts.

## TL;DR

- Construí PetDesk dos veces con 5 agentes Kimi/DeepSeek orquestados vía Multica self-host.
- **v1:** 3 horas, $4.21, 12 intervenciones mías, 18 tests, 2 scope violations.
- **v2:** 49 minutos, $1.80, 3 intervenciones, 31 tests, 0 violations.
- La diferencia: **template completo + contract tests con fast-check + `CONSTITUTION.md` + cost routing**. Sin frameworks de SDD, sin tooling pesado. Solo principios aplicados con disciplina.

**Repos:**

- [petdesk v1](https://github.com/rubenaros/petdesk) — el showcase original, con todos sus errores.
- [petdesk v2](https://github.com/rubenaros/petdesk-v2) — el redo con los patrones. El `CONSTITUTION.md` y los `tests/contracts/` son lo más interesante para llevarse.
- [AgentCode](https://github.com/rubenaros/AgentCode) — el workspace de orquestación con los docs completos (retrospectiva de errores, plan v2, evaluación de OpenSpec/Spec-Kit, scripts reusables).

Si vas a probar agentic dev con tu propio orquestador, **empieza por el template**. El resto se ordena solo.
