# gentle-ai sobre Multica: lo que cuesta agregar SDD al stack multiagente (+60% por issue, 3 memorias estructuradas, 0 fases SDD activadas)

*Probé el overlay de gentle-ai sobre el setup Multica + opencode del v2. El overhead es real, predecible, y solo se justifica si tu equipo necesita audit trail y razonamiento articulado. Esto es lo que medí.*

![v2 vs v3 — comparativo de costo, tiempo, tests y memorias persistidas](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/hero-v2-vs-v3.png)

---

Hace una semana publiqué [un artículo sobre construir el mismo MVP dos veces con agentes IA](https://medium.com/@rubenaros/multica-5-agentes-ia-12-errores-v1-1-80-49-min-v2). v1 fue caos (3h, $4.21, 12 intervenciones). v2 fue disciplina (49 min, $1.80, 3 intervenciones) aplicando 4 patrones: template completo, contratos como tests, CONSTITUTION.md, cost routing por agente.

Mucha gente comentó: *"¿probaste con [insertá framework SDD]?"*. Probé OpenSpec, Spec-Kit, y los dejé fuera porque para Multica no encajaban. Pero apareció **gentle-ai** ([github.com/Gentleman-Programming/gentle-ai](https://github.com/Gentleman-Programming/gentle-ai), 3.6k ⭐), que es distinto: **no compite con Multica, vive una capa más abajo** — dentro de opencode, configura un orquestador + 10 sub-agentes SDD + memoria persistente (Engram) + skills curadas.

Lo instalé, lo probé sobre petdesk-v2, y medí todo.

**Resultado**: agregué una feature nueva (Stats Dashboard), gentle-ai cobró **+21% en costo total**, **+92% en tiempo por issue**, y a cambio me dio **3 memorias estructuradas en Engram con insights de diseño** y **detección automática de specs mal escritos**.

Si esto te suena a un buen trade-off, seguí leyendo. Si querés velocidad pura: mejor quedate con v2.

---

## Qué es gentle-ai y dónde encaja

Antes que nada, dónde vive cada cosa en mi stack:

```
CAPA 4 — Arquitecto (yo): contratos, CONSTITUTION
CAPA 3 — Repo: PLAN.md, src/domain/, tests/contracts/
CAPA 2 — Multica: orquesta MACRO (features paralelas en Kanban)
CAPA 1 — opencode: runner que Multica lanza por issue
CAPA 0 — gentle-ai overlay (DENTRO de opencode):
          • gentle-orchestrator + 10 sub-agentes SDD
          • Engram (memoria persistente cross-session)
          • 12 skills curadas (branch-pr, judgment-day, etc.)
          • plugins: background-agents, engram, model-variants
```

**Multica orquesta features paralelas. gentle-ai orquesta fases SDD dentro de cada feature.** No se pisan — se complementan. Cuando Multica dispara opencode para un issue, ese opencode arranca con todo el overlay de gentle-ai activo automáticamente (porque modifica el config global de opencode en la instalación).

No tuve que tocar nada en Multica. La integración es transparente.

## El experimento (A/B puro)

Para que la comparación fuera honesta:
- **Mismo repo** (petdesk-v2, ya construido)
- **Mismos agentes** (Dev Motor v2, Dev Front v2, QA v2 — los mismos del v2)
- **Mismos modelos** (Kimi K2.6 para lógica, DeepSeek V3.2 para frontend)
- **Misma estructura** de Multica (3 issues, 2 olas paralelas)
- **Misma metodología** (CONSTITUTION.md + contracts + checklists)

**La única variable**: gentle-ai overlay activado sobre opencode globalmente.

La feature elegida: **Stats Dashboard** para PetDesk. Sustantiva (lógica + API + UI + tests), bien acotada, ideal para ver si el orquestador SDD se activaba.

Issues:
1. **StatsEngine** — clase que computa `StatsBundle` sobre un rango (Dev Motor, Kimi)
2. **Stats API + Dashboard UI** — endpoint + sección visualizadora (Dev Front, DeepSeek)
3. **QA stats e2e** — escenario end-to-end + casos límite (QA, Kimi)

## Los números reales (medidos en OpenRouter)

| Métrica | v2 | **v3 (con gentle-ai)** | Δ |
|---|---|---|---|
| **Costo OpenRouter total** | $1.80 (4 issues) | **$2.17 (3 issues)** | +21% absoluto |
| **Costo por issue promedio** | ~$0.45 | **$0.72** | **+60%** |
| **Tiempo de reloj total** | 49 min | **~70 min** | +43% |
| **Tiempo por issue promedio** | ~12 min | **~23 min** | **+92%** |
| **Issues** | 4 | 3 | — |
| **Tests al cierre** | 31 | **48** | +55% (17 nuevos del feature stats) |
| **Intervenciones humanas** | 3 | **3** | igual |
| **Scope violations** | 0 | **0** | igual |
| **Memorias persistidas (Engram)** | 0 | **3** ✅ | nuevo |

**El elefante**: el costo por issue subió **+60%** y el tiempo **+92%**.

Y acá viene lo no-obvio: **SDD no se activó en ninguno de los 3 issues**. El `gentle-orchestrator` evaluó cada uno y decidió ir directo, sin invocar las 6 fases (`explore → propose → spec → design → implement → verify`). El overhead que pagué fue del **overlay base** (skill-registry + Engram + system prompts custom inyectados en cada call al LLM), no del flujo SDD propiamente dicho.

Es información importante: **gentle-ai te factura el overhead del overlay incluso si el orquestador no usa la feature marquee**.

## Lo que sí me dio gentle-ai (que v2 no producía)

### 1. Engram memories estructuradas con `Learned`

Cada agente persistió una memoria con formato `What / Why / Where / Learned`. Ejemplo del Dev Motor v3 después de implementar StatsEngine:

```
What:    Implemented StatsEngine class in src/engine/stats.ts
Why:     Issue ZEN-14 required a stats engine for the v3 feature
Where:   src/engine/stats.ts, tests/engine.stats.test.ts
Learned: Workable minutes calculation must intersect
         [rangeStart, rangeEnd) with each day's 9:00–18:00 UTC
         window for accurate occupancyRate on partial days.
         Tops need deterministic tie-breaking by id for stable tests.
```

**Eso es razonamiento articulado**, no solo código. El agente entendió un sutil edge-case (intersección de rango con horarios laborables) y lo dejó escrito como insight reusable. Próximos agentes que toquen stats lo pueden recuperar.

v2 no producía esto. El código era bueno; las decisiones detrás del código se perdían.

### 2. Detección automática de specs mal escritos

El Dev Front v3 (sobre DeepSeek) persistió esta `session_summary`:

```
Goal: Implement Stats API and Dashboard UI for v3 (Issue 2)

Discoveries:
- StatsEngine implementation already exists in src/engine/stats.ts
- No polling was actually implemented in dashboard despite
  issue claiming it existed
- StatsBundle type already defined in domain/types.ts
```

**Encontró un error en mi issue body.** Yo había escrito "ya hay polling para appointments — sumar a stats" pero en realidad **no había polling en el dashboard v2**. El agente lo detectó, lo dejó documentado, y aplicó polling desde cero.

v2 no hacía esto. O implementaba mal el spec, o pedía permiso, o asumía silenciosamente.

### 3. Mejor calidad arquitectónica del código

El StatsEngine de v3 vs uno equivalente en v2: helpers extraídos con docstrings (`workableMinutesInRange()`), separación de responsabilidades, una máquina de estados clara. No es revolucionario, pero es **más diseñado**.

## Lo que cuesta (y por qué)

**+60% en costo per-issue**. Esto se descompone:

- Skill-registry escaneado (12 skills disponibles) → se inyecta en system prompt cada call
- Engram MCP server → cada decisión persiste vía HTTP local
- Plugins (`background-agents`, `engram`, `model-variants`) → handshake con cada init
- Sub-agent infrastructure → aunque no se use SDD, el orquestador "piensa más" antes de actuar

El multiplicador del costo es predecible — vale lo mismo siempre, sin importar el tamaño del feature. Eso lo hace **fácil de presupuestar**, pero también significa que **no se amortiza en features chicas**.

**+92% en tiempo per-issue**. Mismo costo por token, pero el agente **emite muchos más tokens por tarea** (razonamiento articulado, memoria que se actualiza). Si tu cuello de botella es velocidad: malo.

## El veredicto honesto

**No uses gentle-ai si:**
- Tu prioridad es velocidad/costo mínimo. v2 puro ya es óptimo.
- Tus features son chicas y mecánicas (todos los issues caen como "trivial" para el orquestador).
- Trabajas solo y no necesitas audit trail entre sesiones.
- Tu equipo no aprovecha memoria cross-session (cada feature es completamente independiente).

**Sí usa gentle-ai si:**
- **Equipo de 2+ devs** compartiendo decisiones arquitectónicas. Engram memories cross-session se vuelven referencia común.
- **Compliance / auditoría estricta**. La memoria estructurada es exactamente lo que piden auditores ("¿por qué decidieron X?" → ahí está).
- **Pipeline de features grandes** donde SDD sí se va a activar (yo no llegué a verlo en este experimento porque ninguno fue "grande" para el orquestador). Para features con muchas decisiones de diseño, las 6 fases pueden pagar el overhead.
- **Querés que el agente articule meta-razonamiento** ("qué encontré", "qué aprendí") — no solo código.

**Mi caso personal**: lo voy a mantener instalado pero solo para proyectos medianos+ (5+ features con decisiones de diseño). Para experimentos chicos vuelvo a v2 puro.

## Lo que NO probé (y dejo para v4)

- **Forzar al orquestador a activar SDD** (vía slash command `/sdd-new` por ejemplo) y medir el costo de las 6 fases vs el costo base del overlay.
- **Per-phase model assignment** (Sonnet para design, Kimi para code, DeepSeek para test). El feature está documentado pero requiere ejecutar SDD primero.
- **Skills auto-invocadas en features grandes**. En mis 3 issues no se invocó ninguna (porque ninguno fue lo suficientemente grande para activarlas).
- **Engram cross-feature memory recall**. ¿El agente del Issue 2 leyó la memoria del Issue 1? No vi evidencia en logs.

Si te interesa que pruebe alguna de estas, dejame un comentario.

## TL;DR

- **gentle-ai + Multica funciona** sin tocar nada de Multica (se integra vía config global de opencode).
- **Overhead per-issue: +60% costo, +92% tiempo**, incluso sin activar SDD. Es el costo del overlay base.
- **Valor concreto**: 3 memorias estructuradas en Engram con `Learned` insights, **detección automática de specs mal escritos**, mejor calidad arquitectónica del código.
- **No es marketing**: es trade-off velocidad/costo vs razonamiento articulado + memoria + audit trail.
- **Cuándo sí**: equipo, compliance, features medianas-grandes, ramp-up entre sesiones.
- **Cuándo no**: solo dev, velocidad pura, features chicas.

**Repos**:
- [petdesk-v2](https://github.com/rubenaros/petdesk-v2) — el repo donde corrí v2 y v3 (mismos contratos, distinto overlay)
- [AgentCode](https://github.com/rubenaros/AgentCode) — workspace con scripts, docs, retrospectivas
- [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) — el overlay que probé

Si vas a probar el combo Multica + gentle-ai: **andá despacio, medí cada experimento, y andá honesto contigo mismo sobre si el overhead te paga**.
