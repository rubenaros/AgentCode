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
| 8 | Ternary-Bonsai-27B (Q2_0) | **harness v3 + edit tool**, GPU, 32K | ❌ (pero cerca) | **45/47 tests pasan** — código real, no alucina. No cierra 2 bugs de lógica sutiles en 6 rondas de verify; no adopta `str_replace` (vuelve a `write_file`) |

**Marcador: 4 modelos, 9 corridas, 0 features completas** — pero el ternario cambió *cómo* se falla: de "código roto" a "casi verde, atascado en la última milla".

## La evolución del harness (y qué probó cada versión)

1. **Mínimo** — loop pelado, 3 tools (`run_bash`, `read_file`, `write_file`), tool-calling nativo + parser XML de fallback. Probó: los modelos chicos **no se auto-scaffoldean** (read-loops, divagación, código roto).
2. **v2 — guardrails en código** (`ornith_agent_v2.py`): forzado de fase (explore→implement→verify), loop-breaker, scope-guard, verificación forzada. System prompt ~200 tokens (barato). Probó: un harness fuerte **en código** rescata el **proceso** (el 14B recorrió el arco completo por primera vez) — pero no la **corrección** (código roto).
3. **v3 — loop de verify cerrado y dirigido** (`ornith_agent_v3.py`): el harness corre `npm test` él mismo, parsea el error a un mensaje nítido y accionable, dirige al modelo a reescribir el archivo exacto, repite hasta verde. Read-block duro, detección de archivos por git (agnóstica al mecanismo bash/heredoc), aceptación honesta (exige que existan los archivos). Probó: **el confound de feedback está descartado** — con el error servido verbatim 27 veces, el 14B igual no aplica el fix.
4. **v3 + edit tool** (`str_replace`): se agregó una tool de edición quirúrgica — reemplaza un snippet exacto en vez de reescribir el archivo entero, con **match tolerante a whitespace** y, en miss, devuelve el texto actual del archivo (fuzzy anchor vía `difflib`) para esquivar el read-block. Hipótesis: reescribir el archivo completo truncaba (`num_predict` corto), y un edit chico lo evitaría. Probó dos cosas: (a) el confound de truncamiento **no era el techo** — con el ternario los `write_file` completos ya salían bien; (b) **el modelo no adopta la tool nueva**: la intentó 1 vez con el schema mal (emitió `content` en vez de `old_str`/`new_str`, confundiéndola con `write_file`), vio el error dirigido, y la abandonó. `str_replace` es más raro en el training que `write_file` → bajo presión el modelo colapsa al schema familiar. **Y no importaba** — aunque el edit hubiera funcionado, el cuello de botella no era el mecanismo de escritura, era el diagnóstico del bug.

## Conclusiones (ganadas, no apresuradas)

1. **El harness es la palanca del PROCESO.** El v3 llevó al 14B por explore→implement→verify→fix, cosa que solo no hacía. Y se puede hacer **fuerte sin ser gordo en contexto**: la inteligencia va en el código del harness (nudges cortos), no en un system prompt de 20K.

2. **El modelo es el techo de la CORRECCIÓN — y el techo NO es generar, es debuggear.** Con el loop cerrado, el error nítido servido 27 veces, el patrón correcto a la vista y 27 intentos, SWE-Next-14B **no cambió `../../src/...` por `../src/...`**. Ningún harness fabrica una capacidad que el modelo no tiene — salvo que el harness *escriba el fix* (codemod), y ahí el modelo ya no hace nada. **El ternario afinó dónde está exactamente el techo:** escribió **45/47 tests en verde** — código real, arquitectura sólida, cero alucinación de APIs — pero se trabó 6 rondas en 2 bugs de lógica sutiles (`cancellationRate` da 0 en vez de 0.5; off-by-one en el top-N) sin identificar la causa. **El piso no es "no sabe programar" — es "no puede debuggear sus propios errores sutiles".** La generación llegó a near-frontier; la auto-corrección de la última milla, no. Y contra el mito de que "los modelos chicos alucinan mucho para coding": **no alucinó** — falló en el diagnóstico, que es otra cosa.

3. **El doble bind contexto↔harness.** Un modelo débil necesita un harness más fuerte, pero un harness fuerte cuesta contexto (el de Multica/opencode: **20.481 tokens irreducibles**, medido en v7). En 16GB no se pueden tener las dos cosas. Es **parcialmente escapable** poniendo el harness en código (barato), pero el **piso de capacidad** no lo escapa nada.

4. **Dense > MoE, más grande = más confiable.** Consistente en todos lados: el Gemma dense fue más estable que su hermano MoE; los modelos chicos aflojan/divaga; la corrección es cuestión de escala.

5. **Un 27B a Q2 NO es un 27B.** El ternario es un 27B **cuantizado a 2 bits** (`Q2_0`, 6.7GB) para entrar en 16GB. Escribe bien pero no debuggea — y esa es justo la capacidad que la cuantización agresiva se come primero (el razonamiento de última milla es lo más frágil a la pérdida de precisión). Meter un 27B en 16GB *bajando los bits* da un modelo lisiado en lo que importa. Refuerza el "engaño VRAM" de más abajo desde el otro lado: no solo el MoE en poca VRAM está lisiado — un dense sobre-cuantizado también.

## Veredicto — el arco se cierra

**La pregunta era: ¿existe un modelo local que entre en 16GB y cierre una tarea agéntica real? La respuesta, ganada en 9 corridas sobre 4 modelos, es NO.**

Y sabemos exactamente por qué. No es serving, ni formato, ni truncamiento, ni feedback — todo eso lo resolvió el harness (v3 lleva al modelo por explore→implement→verify→fix, con el error servido verbatim). **El piso es la capacidad de debug de última milla, y esa capacidad vive por encima de lo que entra en 16GB.** El mejor caso que logramos —el ternario 27B-Q2— escribió 45/47 tests y ahí se quedó, incapaz de diagnosticar 2 bugs sutiles en 6 rondas. Bajar bits para caber en 16GB lisia justo lo que hace falta.

**Esto no es un experimento fallido: es el resultado.** En 16GB, hoy (jul-2026), no hay modelo local que converja — no por accidente de configuración, sino por una relación estructural entre el tamaño que exige la corrección agéntica y la VRAM disponible. La única palanca que quedaría dentro de "local" es **más hardware** (una tarjeta de 24GB), que es una decisión de plata, no un experimento pendiente. El arco queda cerrado.

## Lo que dijo la investigación (deep-research, jun-jul 2026)

- **Terminal-Bench 2.0** (arXiv 2601.11868, ICLR 2026): frontier <65%, chicos ~15%, GPT-OSS-20B ~4%. Los chicos **no convergen** en CLI multi-paso real.
- **Firma de convergencia** (arXiv 2604.02547): leer-antes-de-editar (ρ=+0.68) vs parchear-agresivo-temprano (ρ=−0.78). Nuestros read-loops son ese patrón mal calibrado.
- **"Harness irrelevante" REFUTADO (0-3):** el harness SÍ importa, un modelo débil se beneficia de mejor scaffolding.
- **En 7-14B dense no hay nada que converja** con harness mínimo. OpenRouter jun-2026, literal: *"7B-14B dense range: None."*

## Fuera de alcance — dónde SÍ empezaría a converger (Qwen3.6-27B, requiere 24GB)

> **Nota, no continuación.** Esto ya no responde la pregunta del arco (*local en 16GB*) — la responde otra (*¿a qué tamaño converge?*) y exige hardware que rompe la restricción original. Queda documentado como referencia para el día que haya una tarjeta de 24GB, no como paso pendiente.

El **tier 27B** es donde el coding agéntico empieza a funcionar de verdad — pero en Q6, que necesita ~24GB (ver Conclusión #5: a Q2 para caber en 16GB, el 27B queda lisiado en el debug). Qwen3.6-27B (Alibaba, 22-abr-2026, Apache 2.0, dense, 262K ctx) — números **verificados** (blog oficial + medios independientes):

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
- **Hipótesis:** con 59.3 en Terminal-Bench, **converge** — cierra los 2 bugs de lógica que el ternario Q2 no pudo, y responde la pregunta *distinta*: *"¿a qué tamaño (y precisión) converge un modelo local?"*. No reabre el arco de 16GB, que ya cerró en NO.

### Notas de reproducibilidad

- Harness en `harness/ornith_agent_v3.py` (**persistido y commiteado**, ya no efímero). Incluye el `edit` tool (`str_replace`) y el backend dual `ollama`/`openai`.
- Gotchas de plumbing (modelos chicos emiten tool-calls sucios): aliasar `execute_bash`/`file_editor`→`run_bash`/`write_file`; parser lenient para JSON con newlines literales en `content`/`cmd`; `sed -n` evade el read-block (agregarlo a la lista de reads); la aceptación debe exigir que los archivos existan (si no, da falso-verde con feature ausente).
- **Gotchas del ternario GPU** (fork PrismML llama.cpp, `harness/llama-prism/build-cuda/bin/llama-server`, modelo `harness/models/Ternary-Bonsai-27B-Q2_0.gguf`):
  - Backend `AGENT_BACKEND=openai` (el fork solo habla formato OpenAI; se corre **sin `--jinja`** para que el modelo emita `<tool_call>` como content crudo que el parser lenient recupera).
  - Puerto **8090**, no 8080 — el 8080 lo ocupa Multica (docker-proxy).
  - Contexto **32K obligatorio** (`-c 32768`): con 16K el prompt overflowea (~15K tokens de reads) y llama-server devuelve **HTTP 400** → mata la corrida. La VRAM alcanza (9.5GB con el modelo cargado).
  - El `edit` tool (`str_replace`) funciona (verificado con unit tests + end-to-end), pero **el modelo no lo usa** — dato de comportamiento, no bug del harness.
  - Logs de referencia: `harness/run-ternary-gpu-edit.log` (crash 400 a 16K) y `harness/run-ternary-gpu-edit2.log` (la corrida buena a 32K).

### Gotcha de plumbing anticipado: el parser de `<think>` de llama.cpp corrompe el stream (Qwen3)

Referencia externa: [*The Only Correct Way to Use llama.cpp with Qwen3.6-27B*](https://blog.gopenai.com/the-only-correct-way-to-use-llama-cpp-with-qwen3-6-27b-d550bd0605a7) (Andrew Zhu, may-2026). Aviso para el día del experimento de 24GB — **verificar antes de confiar**, no adoptar a ciegas.

**El núcleo (correcto, y coincide con lo que ya vivimos):** el split reasoning/answer server-side de llama.cpp puede **corromper silenciosamente** el stream de un modelo que usa tags XML inline (`<think>…</think>`). La causa raíz honesta no es "parser de DeepSeek vs Qwen" (el propio código citado define `thinking_start_tag="<think>"` y una regla PEG para ellos) sino una **violación del prefijo en `string_diff`**: cuando el PEG re-asigna texto entre `reasoning_content` y `content` a medida que llegan tokens, el delta deja de ser prefijo del anterior → tags dropeados/duplicados, o `content`↔`reasoning` swapeados. No crashea: queda todo *un poco* mal (el peor tipo de bug).

**La cura sensata:** servidor pasa texto crudo, cliente parsea. Arrancar con `--reasoning-format none` y separar el `<think>` uno mismo. **Es exactamente nuestra postura** — el harness v3 ya corre `no-jinja` y parsea tool-calls a mano; probablemente ya esquivamos este bug sin saberlo.

**Errores del artículo (no copiar tal cual):**
- El regex de su "cura" busca `<thinking`/`</thinking` (con `ing`) pero el modelo emite `<think>`/`</think>` → **nunca matchea**, cae al fallback y jamás separa el thinking. Anclar al marcador **estructural** `</think>\n\n`, no a cualquier `</think>`.
- Su test estrella (pedir al modelo que imprima los tags literales) rompe *cualquier* splitter first-match, cliente incluido — mover el split de server a cliente **no** lo cura; sólo anclar al marcador estructural lo hace. Es un caso auto-referencial, no el modo de falla del uso normal.
- `reasoning_format:"none"` en el **body** del request es dudoso: hasta donde sé es un flag de arranque del server, no un parámetro por-request. Si es no-op, esa parte del consejo es inofensiva pero inútil. Verificar contra el build.
- Versiones/regresión (b9211, b9191, commit `5bf468a2f`, issue #23320): plausibles, sin verificar desde acá. Si nos apoyamos en la regresión, se confirma primero.

**Directiva para el harness (si corremos Qwen3.6-27B en llama.cpp):** raw passthrough (`--reasoning-format none` o `no-jinja`); strip de `<think>…</think>` client-side anclando a `</think>\n\n`; **no** confiar en el split reasoning/content del server. Es una extensión chica de `ornith_agent_v3.py` (ya parsea tool-calls crudos). Valida la tesis del arco: **el que falla es el arnés (plumbing), no el modelo** — `Agente = Harness∘LLM`.

---

*Memorias Engram relacionadas: `research/harness-context-doublebind`, `research/small-agentic-models-2026`, `research/qwen36-27b-candidate`, `sdd/v8-ornith/*`.*
