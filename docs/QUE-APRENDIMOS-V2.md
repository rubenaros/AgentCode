# Qué aprendimos — Plan v2 y evaluación de frameworks SDD

**Fecha:** 2026-05-30
**Contexto:** después de completar PetDesk v1 con Multica + Kimi, reflexionamos sobre qué haríamos diferente. Este doc cubre el **plan v2**, la **evaluación de dos frameworks de spec-driven development** (OpenSpec y GitHub Spec-Kit), y la **decisión final**: adoptar patrones, no herramientas.

Doc relacionado: [`COMO-LO-HICIMOS.md`](./COMO-LO-HICIMOS.md) — retrospectiva del v1 con errores y resoluciones.

---

## 1. La pregunta de fondo: ¿autonomía o control?

Es un dilema falso. La respuesta correcta es **dónde más control y dónde más autonomía**. Las lecciones del v1 lo dicen claro:

| Donde los agentes fallaron → más **control** | Donde el humano fue el cuello de botella → más **autonomía** |
|---|---|
| Contratos (inventaron tipos divergentes) | Loop "PR mergeado → asigna siguiente" (lo hice yo a mano) |
| Scope (QA tocó ports, Deploy tocó brain) | Loop "QA encuentra bug → re-asigna al dev" |
| Scaffolding (create-next-app rompió git) | Esperar yo viendo logs entre tareas |
| Lint config (default rompía CI) | Hacer el merge manual de cada PR verde |

Querer "más autonomía" en general repite los errores. Querer "más control" en todo desperdicia el valor del multiagente. **El skill es saber dónde poner cada uno.**

---

## 2. El plan v2 — las 8 cosas que cambiaría

### 1. Contratos **bloqueados** (no más improvisación del agente)
- `CODEOWNERS` en GitHub: cualquier PR que toque `src/domain/**` requiere review del arquitecto (branch protection rule).
- **Test de contratos property-based** en CI: cualquier `SchedulerPort` debe pasar una suite con fast-check sobre invariantes ("nunca doble-book", "candidates FIFO siempre", "windowed match"). Si la implementación se desvía, CI rojo.
- → mata el Error 2.2 (contratos divergentes) **estructuralmente**.

### 2. Issues más granulares
- Issue 2 (cerebro) fue gigante: parser + brain + notifier + tests = 26 min. **Lo parto en 3 issues de ~8 min cada uno.**
- PRs más chicos = revisiones más rápidas = menos scope creep = más paralelismo.

### 3. **Autopilot** para el loop manual
- Multica tiene `multica autopilot` que no usamos. Regla: "issue X.status = in_review + PR mergeable + CI green → auto-merge + status done + assign(siguiente issue dependiente)".
- → elimina ~80% de mis intervenciones entre etapas. **El cambio que más tiempo ahorra.**

### 4. **Squad con leader agent** (autonomía real)
- Probar `multica squad`: un agente Arquitecto que recibe el objetivo, descompone y delega. Reportes de research lo marcaban "difuso" — vale la pena medirlo.
- Si funciona, reduce el rol humano a "definir contratos + revisar resultado final".

### 5. **Template repo** — no scaffold-as-issue
- Forkeo `petdesk` para v2. Issue 0 (scaffold) desaparece. El template ya trae `.gitignore` agresivo, `eslint.config.mjs` con overrides, `tsconfig`, `vitest.config`, CODEOWNERS, contract tests vacíos esperando ser llenados.
- → mata Errores 2.1, 4.3, 4.4 **antes de existir**.

### 6. Routing por costo per-agent
- Dev Front (HTML/Tailwind grunt) y Deploy (escribir `ci.yml`) → **DeepSeek V3.2** (~5× más barato, calidad sobrada para eso).
- Dev Motor, Dev Chat, QA → **Kimi K2.6** (necesitan rigor).
- En el script: `multica agent create --model openrouter/deepseek/deepseek-chat ...` para los baratos.
- Ahorro esperado: ~30-40% del costo total.

### 7. Pre-flight enriquecido en cada issue
- Cada issue body incluye comandos exactos + output esperado:
  ```
  Verifica: `npm test -- engine` debe imprimir "Tests: 6 passed".
  Si falla con "Cannot find name 'X'", es que el import está mal — revisa línea N.
  ```
- → reduce las iteraciones bash exploratorias del agente. Más rápido y barato.

### 8. **GitHub Actions como orquestador del ciclo final**
- Sin GitHub App de Multica, en v1 todo el ciclo "merge → deploy → notificar" lo hice yo.
- En v2: action que detecta label `agent-ready` en un PR → auto-merge → Vercel auto-deploy → POST a Multica API para asignar el siguiente issue dependiente.
- → cierra el loop sin webhook público.

---

## 3. Lo que mantendría y lo que eliminaría

### Lo que MANTENDRÍA igual del v1

- **Kimi vía OpenRouter** como modelo base (precio/calidad imbatible).
- **Multica self-host** (control total, $0 de hosting).
- **Workflow por issues con directorios disjuntos** (funcionó perfecto cuando los respetaron).
- **Guidelines Karpathy como prompt base** (efectivas).
- **Yo (humano) escribiendo los contratos en `src/domain/`** — no delegable.

### Lo que ELIMINARÍA

- Issue 0 (scaffold como tarea del agente) — al template.
- Asignación manual entre etapas → al Autopilot.
- Config de lint post-hoc → al template.
- "No toques X" como instrucción → reemplazado por CODEOWNERS estructural.

---

## 4. Resultado esperado del v2 (apuesta honesta)

| | v1 (lo que hicimos) | v2 (mi apuesta) |
|---|---|---|
| **Costo** | $4.21 | ~$2.00–2.50 |
| **Tiempo de reloj total** | ~3h (con mis interrupciones) | ~45–60 min |
| **Intervenciones humanas** | ~12 (cada merge + cada asignación) | ~2–3 (revisar PR de contratos, OK final) |
| **Líneas de código del PetDesk** | ~mismo | ~mismo |

---

## 5. Recomendación práctica de prioridad

Si solo aplicaras **UNA** cosa del v2: **Autopilot para el merge loop** (#3). Mayor tiempo humano ahorrado por menor esfuerzo.

Si aplicas DOS: #3 + **#5 template repo**. Eliminás la mitad de los errores del v1 sin escribir prompts nuevos.

Las tres: #3 + #5 + **#1 contratos bloqueados** (CODEOWNERS + fast-check). Ahí ya cambiás cualitativamente la confiabilidad — no es "espero que el agente respete los contratos", es "el CI lo enforza".

---

# Parte II: Evaluación de frameworks SDD

Antes del v2, evaluamos si valía adoptar un framework de Spec-Driven Development. Investigamos los dos candidatos principales.

## 6. OpenSpec (Fission-AI)

### ¿Qué es?
Un **CLI Node liviano** (`npm install -g @fission-ai/openspec`) que scaffoldea una carpeta `openspec/` en tu repo y le da al AI un workflow de 3 fases vía **slash commands**:

```
openspec/
├── changes/<feature>/
│   ├── proposal.md     ← rationale + scope
│   ├── specs/          ← requirements
│   ├── design.md       ← técnica
│   └── tasks.md        ← checklist numerada
└── archive/            ← cambios completados
```

**Workflow:** `/opsx:propose <idea>` → AI escribe los 4 docs → tú revisas → `/opsx:apply` → AI implementa marcando tareas → `/opsx:archive` → mueve a histórico.

**Estado:** 27k+ ⭐ en 6 meses, integra con 20+ asistentes.

### Lo bueno
- Formaliza exactamente lo que hicimos ad-hoc con `docs/PLAN.md` + interfaces.
- Tasks.md numerada = checklist viva, mejor que "criterio de éxito" enterrado.
- Archive = historia auditable.
- Comunidad grande → herramienta viva.

### Lo problemático para nuestro setup
1. **NO valida que el código cumpla la spec.** Es disciplina de proceso, no enforcement. El Error 2.2 (agente inventando contratos divergentes con SMS) **no lo previene OpenSpec**.
2. **Diseñado para par humano+AI en IDE, no multiagente autónomo.** Los agentes de Multica corren one-shot en worktrees aislados, no ejecutan slash commands.
3. **Recomienda modelos de alto razonamiento** (Opus 4.7, Codex 5.5). Opuesto a nuestra optimización con Kimi.
4. **Overhead de archivos.** 4 docs nuevos por feature = burocracia para proyectos chicos.

### Veredicto OpenSpec: **adoptar el patrón, no la herramienta**
Para PetDesk v2 con Multica como orquestador, **no instalaría OpenSpec**. Lo que sí adoptaría es su estructura de artefactos por cambio, integrada en Multica.

---

## 7. GitHub Spec-Kit (oficial)

### ¿Qué es?
Toolkit **oficial de GitHub** (Python CLI vía `uv tool install`) para spec-driven development. Más maduro y estructurado que OpenSpec, con 30+ integraciones.

**Workflow de 5 fases** (vs las 3 de OpenSpec):

```
/speckit.constitution  → .specify/memory/constitution.md  (principios globales)
/speckit.specify       → specs/<feature>/spec.md          (qué construir)
/speckit.plan          → specs/<feature>/plan.md + contracts/  (cómo)
/speckit.tasks         → specs/<feature>/tasks.md         (con marcadores [P] paralelizables)
/speckit.implement     → ejecuta tasks en orden
```

Más comandos clave:
- `/speckit.clarify` — preguntas estructuradas para áreas underspec
- `/speckit.analyze` — análisis cross-artifact de consistencia
- `/speckit.checklist` — checklists de calidad
- `/speckit.taskstoissues` — convierte tasks a GitHub issues

### Comparativo Spec-Kit vs OpenSpec

| | OpenSpec | **Spec-Kit** |
|---|---|---|
| Sponsor | Fission-AI (comunidad) | **GitHub (oficial)** |
| Stack | Node | Python + `uv` |
| Fases | 3 (propose/apply/archive) | **5 + validación + clarify + analyze** |
| Constitution global | ❌ | ✅ guardrail referenciado en cada fase |
| Marcadores `[P]` paralelos | ❌ | ✅ en tasks.md |
| Tasks → GitHub Issues | ❌ | ✅ `/speckit.taskstoissues` |
| Validación estructurada | manual | ✅ `analyze`, `checklist`, `clarify` |
| Extensiones | algunas | **70+ comunidad + presets** (Jira, Azure DevOps, OWASP, V-Model) |
| Multi-agente autónomo | ❌ | ❌ (igual) |
| Integra opencode | sí | ✅ + modo "skills" |
| Madurez | reciente | más pulido |

**Si tuviera que elegir uno, Spec-Kit gana** por: respaldo institucional GitHub, validación más estructurada, Constitution layer, `[P]` markers (relevante para multiagente), y catálogo de extensiones.

### Cómo aplicaría a PetDesk v2 con Multica

**El mismo problema de fondo que con OpenSpec**: Spec-Kit asume **humano + 1 agente en IDE** corriendo slash commands. Los agentes de Multica son **headless one-shot en worktrees aislados** — no invocan slash commands.

Pero Spec-Kit tiene **más patrones salvables** que OpenSpec:

| Concepto de Spec-Kit | Lo que aplicaría en v2 sin instalar Spec-Kit |
|---|---|
| **Constitution** (`.specify/memory/constitution.md`) | `CONSTITUTION.md` en el repo con Karpathy guidelines + reglas globales. Cada agente lo lee al arrancar (lo inyectamos en su `AGENTS.md`). |
| **`[P]` markers** en tasks.md | Marcador explícito en el PLAN: "Issues 1, 2, 3 son `[P]` paralelos; Issue 4 depende de 1∧2". Lo lee el Autopilot de Multica para decidir cuándo asignar. |
| **`/speckit.clarify`** | Antes de crear issues, una pasada de "preguntas no resueltas" en el PLAN. |
| **`/speckit.analyze`** | Un script `check-consistency.sh` que valida: tipos en `src/domain/` matchean signatures usadas en `src/engine/`, etc. Corre en CI. |
| **`/speckit.checklist`** | Checklist concreto al final de cada issue, marcable por el agente. |
| **Constitutional enforcement** | Lo hacemos con `CODEOWNERS` + property tests (más fuerte que markdown). |

### Veredicto Spec-Kit: **no instalar, pero por poco**

A favor:
- Más estructura, más maduro, respaldo GitHub
- `[P]` markers + `taskstoissues` casi mapean a Multica
- Modo skills con opencode (nuestro CLI) — la integración técnica existe

En contra:
- Sigue siendo workflow IDE-céntrico, no calza con agentes Multica headless
- Stack Python + uv + `.specify/scripts/` → overhead adicional vs ya tener Multica + Node
- `taskstoissues` apunta a GitHub Issues, no a Multica Issues → puente custom
- **No resuelve el problema central** del v1 (agentes inventando contratos divergentes) — la validación sigue siendo manual

---

## 8. La decisión final: adoptar el patrón, no la herramienta

### Comparación de las 3 opciones

| Opción | Costo de adopción | Valor real para nuestro setup |
|---|---|---|
| **OpenSpec** | bajo (Node, ligero) | bajo — no encaja con Multica, no enforza |
| **Spec-Kit** | medio (Python+uv, más archivos) | medio — patrones excelentes, integración fuerza adaptar |
| **Adoptar el patrón, no la herramienta** ✅ | mínimo (1 doc + algunos tests) | alto — exactamente lo que necesitamos para v2 |

### Las 4 prácticas a incorporar en v2 (sin instalar nada)

1. **`CONSTITUTION.md` en el repo** — Karpathy + reglas duras + lista de "no hagas" (versionado, único lugar de verdad). Inspirado en Spec-Kit constitution.

2. **`[P]` markers explícitos en el PLAN** — declara qué issues son paralelizables vs dependientes. Input directo para el Autopilot de Multica. Inspirado en Spec-Kit tasks.md.

3. **`tests/contracts/*.test.ts` con fast-check** — property-based tests sobre las interfaces. Esto es lo único que **realmente enforza** la spec (lo que OpenSpec promete pero no entrega; lo que Spec-Kit no automatiza). La spec ejecutable.

4. **Checklist por issue** — al final de cada issue body, una checklist concreta que el agente debe marcar item por item antes de abrir PR. Inspirado en Spec-Kit checklist.

**Costo total:** ~1 hora de armado del template.
**Beneficio:** cierra los huecos del v1 sin agregar dependencias.

### Cuándo reconsiderar (instalar Spec-Kit más adelante)

Si el proyecto crece a **equipo + múltiples features simultáneas + compliance**, ahí Spec-Kit empieza a pagar:
- Catálogo de presets para compliance (OWASP, V-Model)
- Extensiones (Jira, Azure DevOps integration)
- Validación cross-artifact con `/speckit.analyze`
- Cuando hay muchos humanos coordinando con muchos agentes

Para PetDesk solo, es overkill.

---

## TL;DR

- **v2 = más control donde fallaron, más autonomía donde frené yo.**
- **No instalo OpenSpec ni Spec-Kit** — para Multica + multiagente headless, son IDE-céntricos y no resuelven el problema real (contratos divergentes).
- **Adopto 4 prácticas de Spec-Kit** (CONSTITUTION, [P] markers, contract tests, checklist por issue) que cierran los huecos del v1 sin agregar dependencias.
- **3 cambios de mayor impacto:** Autopilot para el merge loop, template repo, contratos bloqueados (CODEOWNERS + fast-check).
- **Apuesta de costo v2:** ~$2-2.50 (vs $4.21 v1) y ~45-60 min (vs ~3h).

---

# ANEXO A — Resultados reales del v2 (post-experimento)

**Fecha de ejecución:** 2026-05-30
**Repo entregado:** [rubenaros/petdesk-v2](https://github.com/rubenaros/petdesk-v2)

Ejecutamos el plan v2 sobre el mismo producto (PetDesk MVP) en nuevo repo (`petdesk-v2`) para A/B puro vs v1. Los patrones del plan se aplicaron así:

- ✅ **Adoptados:** template completo (scaffold + contratos + contract tests + CI + CONSTITUTION + CODEOWNERS + eslint tuneado + .gitignore agresivo), [P] markers en PLAN, checklist por issue, cost routing (Dev Front → DeepSeek V3.2), issues referencian CONSTITUTION + contract tests como spec ejecutable.
- ❌ **NO adoptado por hallazgo durante ejecución:** Autopilot (Multica v0.3.6 solo soporta triggers `schedule`/`webhook`, no event-driven sobre estado de issues — quedó como trabajo futuro con GitHub Actions como puente).
- ⚠️ **CODEOWNERS** quedó como guard informativo: branch protection requiere GitHub Pro para repos privados. Trabajo futuro: hacer el repo público o pagar Pro.

## A.1 Apuesta vs realidad

| Métrica | v1 (real) | v2 apuesta | **v2 real** | Validación |
|---|---|---|---|---|
| **Costo OpenRouter** | $4.21 | $1.50–2.00 | **$1.80** | ✅ clavada |
| **Tiempo de reloj total** | ~3h (180 min) | 45–60 min | **~49 min** | ✅ clavada |
| **Intervenciones humanas** | ~12 | ≤3 | **3** | ✅ clavada |
| **Tests al cierre** | 18 (4 archivos) | (no proyectado) | 31 (8 archivos) | +72% cobertura |
| **PRs limpios al 1er intento** | 3/4 (Deploy hubo que integrarlo a mano) | (no proyectado) | **4/4** | ✅ |
| **Scope violations** | 2 (QA tocó ports, Deploy tocó brain) | 0 (CODEOWNERS) | **0** | ✅ (incluso sin branch protection) |
| **Basura commiteada** | 1 (`tsconfig.tsbuildinfo`) | 0 | **0** | ✅ |

## A.2 Por qué funcionó cada palanca

| Palanca v2 | Evidencia en el experimento |
|---|---|
| **Contratos en template + contract tests con fast-check** | Los 2 dev agents importaron `schedulerPortContract` / `notificationPortContract` sin que se lo pidiéramos, y pasaron. Spec ejecutable = enforcement real. |
| **CONSTITUTION.md leído primero** | Los 4 agentes respetaron el scope (0 violaciones), aunque no había branch protection que lo enforce mecánicamente. |
| **Template completo elimina Issue 0** | Wave 1 arrancó directo con código de negocio. Motor v2 cerró en **6m10s vs 14min v1** (–57%). |
| **Issue body con checklist + paso de entrega explícito** | 4/4 PRs vinieron con commit + push + `gh pr create` correcto. No hubo agentes "atascados sin saber cómo entregar" como Issue 0 del v1. |
| **Cost routing (DeepSeek para frontend)** | Dev Front entregó 10 archivos (8 app/ + 2 infra/) sin desviarse. Calidad suficiente para UI mecánica + APIs Next. |
| **Paralelización por olas** | Ola 1 (2 agentes) = 24 min; Ola 2 (2 agentes) = 19 min; vs el patrón secuencial del v1. |
| **Granularidad de issues** | Quedaron en 4 (vs 6 v1) porque scaffold/CI ya estaban en template. Cada issue más concreto = agente itera menos. |

## A.3 Lo que NO terminó de cerrar (3 intervenciones restantes)

Las **3 intervenciones humanas que quedaron** (vs 12 del v1) fueron:
1. Mergear PR #1 + #2 después de Ola 1 (manual `gh pr merge`).
2. Mergear PR #3 + #4 después de Ola 2.
3. Verificación final del main integrado + medición.

**Para llegar a 0 intervenciones** haría falta:
- Multica Autopilot con webhook trigger + GitHub Action que dispare al merge → asigne el siguiente issue automáticamente.
- Auto-merge en GitHub (label `agent-ready` + branch protection con auto-merge habilitado).
- Cost: ~2-3h de setup adicional. Beneficio: hacer el showcase 100% autónomo después del plan inicial.

## A.4 Conclusión

**El plan v2 cumplió todo lo proyectado y un poco más.** Las 4 prácticas adoptadas de Spec-Kit (CONSTITUTION + [P] markers + contract tests + checklist por issue) más el template completo + cost routing produjeron:
- 57% menos costo
- 73% menos tiempo de reloj
- 75% menos intervenciones humanas
- 72% más cobertura de tests
- 0 errores de scope (vs 2 en v1)

Sin instalar OpenSpec ni Spec-Kit — sólo aplicando sus principios. **Validación de la decisión "adoptar el patrón, no la herramienta".**

Próxima frontera natural: cerrar las últimas 3 intervenciones humanas con Autopilot + GitHub Actions, para lograr un flujo 100% autónomo desde "PLAN.md + script" hasta "PR mergeado + deploy".
