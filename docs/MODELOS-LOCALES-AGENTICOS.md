# Modelos locales para tareas agénticas — experimentos y conclusiones

> Retrospectiva del arco "¿puede un modelo local chico ejecutar tareas agénticas de coding?"
> Hardware: **RTX 3080 Laptop, 16GB VRAM**. Tarea constante: el **Stats Dashboard** de `petdesk-v2 @ v8-baseline` (engine + API + UI + tests, con `npm test`/`lint`/`build` como aceptación).

## La pregunta

¿Existe un modelo open-weight **chico** (7–14B, que entre en 16GB) capaz de **sostener y cerrar** una tarea agéntica real — leer el repo, implementar, correr tests, corregir hasta verde — sin depender de la nube?

Baseline de referencia: **Kimi K2.6 vía opencode** (harness pesado) pasó el CI y mergeó el mismo feature a la primera.

## Los experimentos

Todos sobre la misma tarea, con harness propio (`ornith_agent*.py`, loop agéntico mínimo sobre Ollama `/api/chat`).

| # | Modelo | Harness / setting | Resultado | Modo de falla |
|---|---|---|---|---|
| 0 | Ornith-1.0-9B | Multica → opencode → gentle-ai | no corrió limpio | 4 muros de serving: contexto 4K, campo `reasoning`, tool-XML (falsa alarma), parser-gen `No user query` |
| 1 | Ornith-1.0-9B | harness mínimo, 32K | ❌ | crash muro de contexto; alucinó la API del repo (`appointments()` vs `listAppointments()`) |
| 2 | Ornith-1.0-9B | harness mínimo, 64K | ❌ | madriguera generando tests con base64/python; test files no parsean |
| 3 | Gemma-4-12B-coder-fable5 | greedy (temp 0) | ❌ | generación desbocada → timeout. SÍ corrió `npm test` (convergió al loop) |
| 4 | Gemma-4-12B-coder-fable5 | temp 0.6 | ❌ | 14h: loop de re-lectura + divagación off-scope (wrangler, playwright) |
| 5 | SWE-Next-14B | harness mínimo | ❌ | read-loop puro: 90 `cat`, 0 archivos |
| 6 | SWE-Next-14B | **harness v2** (guardrails) | ❌ | rompió el read-loop, escribió 5 archivos, entró a verify (64 pasos), corrió `npm test` 3× — pero código roto, build FAIL |
| 7 | SWE-Next-14B | **harness v3** (directed verify) | ❌ | loop cerrado 27 rondas + feedback nítido — el modelo **nunca arregló un import de 1 línea** |

**Marcador: 3 modelos, 8 corridas, 0 features funcionales.**

## La evolución del harness (y qué probó cada versión)

1. **Mínimo** — loop pelado, 3 tools (`run_bash`, `read_file`, `write_file`), tool-calling nativo + parser XML de fallback. Probó: los modelos chicos **no se auto-scaffoldean** (read-loops, divagación, código roto).
2. **v2 — guardrails en código** (`ornith_agent_v2.py`): forzado de fase (explore→implement→verify), loop-breaker, scope-guard, verificación forzada. System prompt ~200 tokens (barato). Probó: un harness fuerte **en código** rescata el **proceso** (el 14B recorrió el arco completo por primera vez) — pero no la **corrección** (código roto).
3. **v3 — loop de verify cerrado y dirigido** (`ornith_agent_v3.py`): el harness corre `npm test` él mismo, parsea el error a un mensaje nítido y accionable, dirige al modelo a reescribir el archivo exacto, repite hasta verde. Read-block duro, detección de archivos por git (agnóstica al mecanismo bash/heredoc), aceptación honesta (exige que existan los archivos). Probó: **el confound de feedback está descartado** — con el error servido verbatim 27 veces, el 14B igual no aplica el fix.

## Conclusiones (ganadas, no apresuradas)

1. **El harness es la palanca del PROCESO.** El v3 llevó al 14B por explore→implement→verify→fix, cosa que solo no hacía. Y se puede hacer **fuerte sin ser gordo en contexto**: la inteligencia va en el código del harness (nudges cortos), no en un system prompt de 20K.

2. **El modelo es el techo de la CORRECCIÓN.** Con el loop cerrado, el error nítido servido 27 veces, el patrón correcto a la vista y 27 intentos, SWE-Next-14B **no cambió `../../src/...` por `../src/...`**. Ningún harness fabrica una capacidad que el modelo no tiene — salvo que el harness *escriba el fix* (codemod), y ahí el modelo ya no hace nada.

3. **El doble bind contexto↔harness.** Un modelo débil necesita un harness más fuerte, pero un harness fuerte cuesta contexto (el de Multica/opencode: **20.481 tokens irreducibles**, medido en v7). En 16GB no se pueden tener las dos cosas. Es **parcialmente escapable** poniendo el harness en código (barato), pero el **piso de capacidad** no lo escapa nada.

4. **Dense > MoE, más grande = más confiable.** Consistente en todos lados: el Gemma dense fue más estable que su hermano MoE; los modelos chicos aflojan/divaga; la corrección es cuestión de escala.

## Lo que dijo la investigación (deep-research, jun-jul 2026)

- **Terminal-Bench 2.0** (arXiv 2601.11868, ICLR 2026): frontier <65%, chicos ~15%, GPT-OSS-20B ~4%. Los chicos **no convergen** en CLI multi-paso real.
- **Firma de convergencia** (arXiv 2604.02547): leer-antes-de-editar (ρ=+0.68) vs parchear-agresivo-temprano (ρ=−0.78). Nuestros read-loops son ese patrón mal calibrado.
- **"Harness irrelevante" REFUTADO (0-3):** el harness SÍ importa, un modelo débil se beneficia de mejor scaffolding.
- **En 7-14B dense no hay nada que converja** con harness mínimo. OpenRouter jun-2026, literal: *"7B-14B dense range: None."*

## El próximo experimento — Qwen3.6-27B (pendiente de 24GB)

El **tier 27B** es donde el coding agéntico empieza a funcionar de verdad. Qwen3.6-27B (Alibaba, 22-abr-2026, Apache 2.0, dense, 262K ctx) — números **verificados** (blog oficial + medios independientes):

| Benchmark | Qwen3.6-27B | Nota |
|---|---|---|
| SWE-bench Verified | **77.2** | supera al Qwen3.5-**397B** MoE (76.2) |
| Terminal-Bench 2.0 | **59.3** | ≈ Claude 4.5 Opus · **near-frontier** |
| SWE-bench Pro | 53.5 | vs 50.9 del 397B |

- **Caveat:** el 90% en SWE-bench (GitHub QwenLM/Qwen3 #1846) es "con engineered agent stack" — el número honesto del modelo es 77.2/59.3.
- **Hardware:** corre en cuantización de **16.8GB** → **NO entra en 16GB** con contexto usable. Necesita **24GB** (3090/4090/5090) o Mac unified memory grande.

### Dense 27B vs MoE 35B-A3B — para agéntico, elegir el dense

La misma familia tiene un **Qwen3.6-35B-A3B (MoE, 3B activos)** que el marketing vende como "corre en 6GB". Para tareas agénticas es el modelo **equivocado**:

| | Qwen3.6-27B **dense** | Qwen3.6-35B-A3B **MoE** |
|---|---|---|
| SWE-bench Verified | **77.2** | 73.4 |
| Confiabilidad agéntica | estable | **"afloja", le falta profundidad** (instruction-following inferior) |
| VRAM real para calidad | ~24GB (Q6) | ~20GB (Q4), peor calidad |
| "Corre en poco" (gancho) | 16GB Q4 (sin lugar para KV) | 6GB IQ2 (2-bit + offload a RAM, lisiado) |
| Para lo agéntico | **el candidato** | desvío de eficiencia |

**El engaño MoE-VRAM:** "35B en 6GB" confunde cómputo con memoria. Los FLOPs escalan con los activos (3B → rápido), pero la **VRAM escala con el TOTAL (35B)** — todos los expertos deben estar residentes porque no se sabe a qué experto rutea cada token hasta inferir. Un 35B MoE a Q4 son ~20GB de pesas; para "entrar" en 6GB hay que ir a **IQ2 (2 bits) + offload a RAM + contexto 8K** = correrlo lisiado. Ya lo verificamos en la research (Qwen3-Coder-Next: *"el footprint lo determina el total, no los activos"*).

**Para convergencia agéntica manda la profundidad, no la velocidad** → el dense 27B. La propia fuente del 27B lo admite: el 35B-A3B *"a veces afloja... hizo el minesweeper en un index.html de un archivo; el 27B lo hace bien"*. Consistente con todo el arco: **dense > MoE para confiabilidad.**

### Plan del experimento (cuando haya 24GB)

- **Serving:** `llama-server -hf unsloth/Qwen3.6-27B-MTP-GGUF:Q6_K --spec-type draft-mtp -ngl 999 -fa on -c 65536 --port 8080`
- **Harness:** `ornith_agent_v3.py` (directed verify loop + read-block + feedback nítido), settings temp 0.6, think off, cap `num_predict`.
- **Tarea:** el mismo Stats Dashboard de `petdesk-v2 @ v8-baseline`.
- **Aceptación:** `npm test` + `lint` + `build` verdes, con los archivos del feature presentes.
- **Hipótesis:** con 59.3 en Terminal-Bench, **converge** — arregla el import de 1 línea que el 14B no pudo en 27 rondas. Cierra la pregunta del arco: *"¿a qué tamaño converge un modelo local?"*.

### Notas de reproducibilidad

- Harness en `scratchpad/ornith_agent_v3.py` (efímero — re-crear desde esta doc si hace falta).
- Gotchas de plumbing (modelos chicos emiten tool-calls sucios): aliasar `execute_bash`/`file_editor`→`run_bash`/`write_file`; parser lenient para JSON con newlines literales en `content`/`cmd`; `sed -n` evade el read-block (agregarlo a la lista de reads); la aceptación debe exigir que los archivos existan (si no, da falso-verde con feature ausente).

---

*Memorias Engram relacionadas: `research/harness-context-doublebind`, `research/small-agentic-models-2026`, `research/qwen36-27b-candidate`, `sdd/v8-ornith/*`.*
