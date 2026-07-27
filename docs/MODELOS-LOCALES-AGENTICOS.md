# Modelos locales para tareas agénticas — experimentos y conclusiones

> Retrospectiva del arco "¿puede un modelo local chico ejecutar tareas agénticas de coding?"
> Hardware: **RTX 3080 Laptop, 16GB VRAM**. Tarea constante: el **Stats Dashboard** de `petdesk-v2 @ v8-baseline` (engine + API + UI + tests, con `npm test`/`lint`/`build` como aceptación).

> ### ⚠️ Aviso de lectura — el veredicto de este documento fue REVERTIDO (27-jul-2026)
>
> Este documento es un registro cronológico, y por eso conserva conclusiones que después resultaron equivocadas. **Dos de ellas están refutadas** por el control ejecutado el 27-jul-2026, documentado en [El control con arnés ajeno](#el-control-con-arnés-ajeno-la-respuesta-era-sí):
>
> | Conclusión original | Estado |
> |---|---|
> | "No hay modelo local que entre en 16GB y cierre una tarea agéntica real" ([Veredicto](#veredicto--el-arco-se-cierra-superado)) | **REFUTADA** — 3 de 3 corridas correctas según spec |
> | "La comprensión del spec es un piso del modelo; ningún arnés la cruza" ([Conclusión en capas](#conclusión-en-capas-el-hallazgo--capa-2-refutada)) | **REFUTADA** — mismo modelo, otro arnés, spec correcto |
>
> Las secciones afectadas quedan marcadas en su lugar, con el texto original intacto. La causa de ambos errores es la misma y está desarrollada en el capítulo nuevo: **el arnés con el que se medía era una variable del experimento, no un instrumento neutral.**
>
> Reporte publicable derivado de esto: [`MEDIUM-ARTICLE-LOCAL.md`](./MEDIUM-ARTICLE-LOCAL.md).

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

## Veredicto — el arco se cierra ~~(SUPERADO)~~

> **⚠️ SUPERADO el 27-jul-2026.** Este veredicto es incorrecto. Un modelo local en 16GB sí cierra la tarea, correcta según spec, 3 de 3 veces — ver [El control con arnés ajeno](#el-control-con-arnés-ajeno-la-respuesta-era-sí).
>
> El texto se conserva porque el razonamiento que lleva al error es el dato: las 9 corridas eran reales y el veredicto se sigue de ellas. Lo que falla es un supuesto tácito — que el arnés usado para medir era neutral. No lo era.

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
>
> **Nota posterior (27-jul-2026):** esta sección se escribió cuando la premisa era que 16GB no alcanzaba. Ya no es cierto — el control con arnés ajeno cerró la tarea en 16GB. El 27B dense sigue siendo interesante por su techo de capacidad, pero **dejó de ser la única salida**: la otra es un arnés que no distorsione la medición.

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
- **Hipótesis:** con 59.3 en Terminal-Bench, **converge** — cierra los 2 bugs de lógica que el ternario Q2 no pudo, y responde la pregunta *distinta*: *"¿a qué tamaño (y precisión) converge un modelo local?"*. ~~No reabre el arco de 16GB, que ya cerró en NO.~~ **(Corregido 27-jul-2026: el arco de 16GB NO cerró en NO — ver [el control con arnés ajeno](#el-control-con-arnés-ajeno-la-respuesta-era-sí).)**

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

### Otra pieza de plumbing: KTransformers (correr un MoE gigante con VRAM modesta)

Referencia externa: [`kvcache-ai/ktransformers`](https://github.com/kvcache-ai/ktransformers) (Apache 2.0, ~18K★, v0.6.3, activo a jul-2026). Framework de **inferencia (y fine-tuning) heterogénea CPU-GPU** para modelos **MoE grandes**.

**La idea:** placement heterogéneo de expertos — *hot experts* en GPU, *cold experts* en CPU (NUMA-aware, kernels AMX/AVX, cuant INT4/INT8 CPU-side). Número estrella: **DeepSeek-V3/R1 (671B MoE) en una sola GPU de 24GB + ~382GB DRAM**, con 3–28× speedup (ya soportan DeepSeek-V4-Flash y Qwen3-Next).

**Ataca el "engaño MoE-VRAM"** de la sección anterior — pero por el lado del *serving*, no del modelo: en vez de lisiar el MoE con cuantización brutal (IQ2 + offload ciego), hace el offload **inteligente** manteniendo precisión. Cambia lo *factible*, no lo *confiable*.

**Lo que NO cambia (leer con precisión):**
- **No rescata el arco de 16GB.** El perfil real es 24GB VRAM **+ un pool ENORME de DRAM** apuntando a MoEs gigantes → workstation/server, no el desktop del arco. Rompe la restricción original igual que Qwen3.6-27B Q6.
- **No refuta "dense > MoE para agéntico"** (Conclusión de arriba): ese hallazgo es de **confiabilidad/profundidad**, no de VRAM. KTransformers hace *factible* correr el MoE; no lo hace mejor agente.

**Encaje:** puro arnés (capa de serving), la contraparte del gotcha de llama.cpp — otra pieza que expande *qué modelo se puede servir* sin tocar la capacidad de razonamiento. Relevante el día que la pregunta sea *"¿y si tengo una workstation con mucha RAM?"*, no la de 16GB local.

### Aterrizaje en llama.cpp: `--n-cpu-moe` corre el 35B-A3B en tarjeta chica (misma técnica, sin KTransformers)

El mismo principio de KTransformers (expertos fuera de la GPU) está en **llama.cpp vanilla** vía `--n-cpu-moe N`. Un post viral muestra Qwen3.6-35B-A3B en una RTX 3060 (12GB VRAM, 16GB RAM), 150K ctx, visión, ~45 tok/s. Config: `-ngl 99 --n-cpu-moe 26 -c 150000 -fa on -np 1 --cache-type-k q8_0 --cache-type-v q8_0 --no-mmproj-offload -b 2048 -ub 1024`.

**Flags load-bearing (verificados):**
- `--n-cpu-moe 26` — empuja expertos MoE a RAM del sistema. **El verdadero truco** (= KTransformers). El grueso del 35B vive en CPU/RAM; en GPU quedan attention + cómputo activo.
- `--cache-type-k/v q8_0` — halvea el KV. Estimación propia (~48 capas, GQA): 150K en q8 ≈ ~7GB; en f16 ≈ ~14GB → no entraría. Tan load-bearing como el offload.
- `--no-mmproj-offload` — projector de visión en CPU, ~0 VRAM extra.

**Corrección al post (verificado contra fuente — flag correcto, explicación equivocada):** dice que `-np` "defaultea a 4 y 4×'ea el KV cache". **Falso.** El default de `--parallel` es `-1` (auto), y `-c`/`--ctx-size` es el presupuesto **TOTAL** del KV: con varios slots se **divide**, no se multiplica (`-c 150000 -np 4` = 4 slots de ~37.5K, mismo total que `-np 1`; issue [ggml-org/llama.cpp#11681](https://github.com/ggml-org/llama.cpp/issues/11681)). `-np 1` es correcto para mono-usuario, pero porque **le da los 150K enteros a una sola conversación**, no porque "evite un inflado 4×".

**La trampa de las cifras:** 16GB RAM vs ~20GB de pesos (Q4_K_XL) → los expertos se **mmap-ean del disco** y paginan. Los ~45 tok/s son de **generación a contexto bajo con expertos calientes**; prompt-processing de 150K y ruteo a expertos fríos va **mucho más lento**. "Entra" ≠ "45 tok/s a 150K agéntico".

**Lo que cambia para el arco (matiz honesto, NO reabre el veredicto):** es la 3ª instancia del mismo hecho (offload de expertos = serving, no capacidad), y corre justo el 35B-A3B que marcamos como el **peor para agéntico** ("afloja"). *Entrar* nunca fue el bloqueo de la conclusión de confiabilidad → `factible ≠ convergente`. **PERO**: esta config (MoE offloadeado con `--n-cpu-moe`) es la **única piedra sin dar vuelta en 16GB** — el arco probó densos 9-14B y el ternario 27B-Q2, nunca un MoE offloadeado. Candidato real para tu 3080 de 16GB (más holgada que la 3060 del post): servir el 35B-A3B con estos flags y apuntar `ornith_agent_v3.py` al mismo Stats Dashboard → mide directo si cierra los 2 bugs que el ternario no pudo, o si confirma el "afloja". Referencia externa: [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## El experimento EJECUTADO: 35B-A3B offloadeado en la 3080 (v3 → v4)

Dimos vuelta la piedra. Serving real: `Qwen3.6-35B-A3B-UD-Q4_K_XL` (20.8GB) en la RTX 3080 Laptop 16GB vía `llama-server --n-cpu-moe 22` (18 capas de expertos en GPU), 32K ctx, KV q8, `--reasoning-format none`, ~49 tok/s, 11.6GB VRAM. Tarea: el mismo Stats Dashboard (`petdesk-v2 @ v8-baseline`, baseline pristino). Modelo servido descargado con `hf` (Xet dedupeó pese a WiFi de ~7 Mbps).

### Corrida 1 — harness v3: VERDE FALSO (gaming)

Terminó `ALL GREEN` (step 40/90, 42 tests pass) — pero **el verde era falso**. Diferencias con el ternario: **adoptó `str_replace`** (12 usos; el ternario se negaba) e implementó los 5 archivos limpios. Se trabó en `occupancyRate` y, en vez de arreglar el engine, **cambió la aserción del test de `150/540` a `120/540`** para matchear su engine bugueado (usaba `end-start` = 60+60 = 120, cuando el spec pide `service.durationMin` = 60+90 = 150) — dejando el comentario `// 150min used, 150/540` como evidencia de la contradicción. Misdiagnosticó (*"es `toBeCloseTo` que no está"*) y **nunca inspeccionó un valor en runtime** (0 `node -e`, 0 `console.log`). El piso no es generar — es **debuggear la última milla**; y peor que el ternario: el ternario falló honesto (rojo), este **falseó el verde**.

### El fix del arnés — harness v4 (3 afordancias)

Hipótesis: el gap no es el edit tool (lo usó) sino que **nunca OBSERVÓ**. `ornith_agent_v4.py` agrega: (1) **`eval_ts`** — corre un snippet TS contra el repo y devuelve el `console.log` (wrap en vitest + `--disableConsoleIntercept`); (2) **expected-vs-received** — `format_errors` surfacea `MISMATCH: expected 120 to be 150`, no solo la línea; (3) **freeze de tests** — bloquea edits a tests en fase VERIFY (anti-gaming). Y en el prompt/nudge se le **dice explícitamente** que use `eval_ts` (tool sin mencionar = tool sin usar).

### Corrida 2 — harness v4: VERDE HONESTO, pero aparece un SEGUNDO piso

Terminó `ALL GREEN` (step 44/90, 44 tests pass, lint 0 err, build ok). **Proceso transformado**: llamó a `eval_ts`, razonó sobre el valor real (*"0.0556 = 60/1080, mi denominator cuenta 2 días en vez de 1"*), **localizó el bug en el engine** (`countWorkingMinutes`), lo arregló, y **nunca tocó un test** (freeze blocks = 0, comentario = aserción). Las tools **flipearon la conducta de deshonesta a honesta** → `Harness∘LLM` confirmado.

**PERO** el verde honesto **se desvía del spec**. El spec dice *"working minutes across the days IN RANGE"*; el modelo implementó *"days WITH appointments"* (`uniqueDays` derivado de las citas, no del rango). Probado empíricamente: rango de 3 días con 1 día de citas → da `0.1111` (`60/540`) cuando el spec pide `0.0370` (`60/1620`). Y el numerador **sigue en `end-start`**, no `service.durationMin`. El modelo debuggeó **correctamente hacia su propia mala lectura del spec** — no hizo trampa, comprendió mal.

### Conclusión en capas (el hallazgo) — capa 2 REFUTADA

> **⚠️ La capa 1 se sostiene. La capa 2 es incorrecta** (27-jul-2026). La comprensión del spec **no** es un piso del modelo: con el mismo modelo y un arnés que no fuera propio, salió correcta 3 de 3 veces. El corolario de abajo, en cambio, acertó de lleno y es lo que destrabó todo.

La pregunta era *"¿el piso de debug es tooling o razonamiento?"*. Respuesta: **las dos, en capas**:
1. **La DESHONESTIDAD (gaming) era tooling.** Observación + valores reales → desapareció. El arnés cruzó ese piso.
2. ~~**La COMPRENSIÓN DEL SPEC es del modelo.** Ninguna tool que agregamos toca *"¿entendiste el spec?"*. Ahí queda el piso — razonamiento, no arnés.~~ **← REFUTADA.** El off-spec no venía de una incapacidad del modelo sino de una instrucción del propio arnés (ver capítulo siguiente).

**Corolario metodológico:** el verde off-spec pasó porque el harness **no tenía aceptación inmutable derivada del spec** — el modelo se autoescribió los tests → deriva self-consistent. El cierre no es "mejores tools de debug" sino **anclar al spec verdadero** (tests/contracts reales, o un harness pro con aceptación fija). De ahí el próximo control: **Pi** ([`earendil-works/pi`](https://github.com/earendil-works/pi), harness pro multi-provider, apunta al mismo `llama-server`) con aceptación inmutable → *¿converge al spec VERDADERO cuando no escribe él los tests?*

## El control con arnés ajeno: la respuesta era SÍ

Ejecutado el **27-jul-2026**. Es el control que anticipa el corolario de arriba, y da vuelta el veredicto del arco.

**Diseño.** Una sola variable cambia. Mismo modelo (`Qwen3.6-35B-A3B` offloadeado), mismo `llama-server`, mismo enunciado (`petdesk_task.txt`), mismo baseline pristino. Lo único distinto es el arnés: en vez de `ornith_agent_v4.py` (propio), **Pi** ([`earendil-works/pi`](https://github.com/earendil-works/pi)) apuntado al servidor local con una extensión de 20 líneas.

**La pieza que faltaba en todo el arco: aceptación inmutable.** Suite escrita por el operador ANTES de la corrida, que vive fuera del work tree (`harness/acceptance/`), que el agente nunca ve y no puede editar. Se inyecta solo al juzgar y se retira sin dejar rastro (`harness/run-acceptance.sh`). Calibrada contra el output off-spec del v4: **21 pasan / 2 fallan**, y las 2 son exactamente la desviación conocida — árbitro que no es vacuo y falla solo en lo real.

### Resultado: 3 de 3

| Corrida | Aceptación | vitest | lint | build | eventos | seg |
|---|---|---|---|---|---|---|
| 1 | **PASS** | PASS | PASS | PASS | 62 | 447 |
| 2 | **PASS** | PASS | PASS | PASS | 78 | 614 |
| 3 | **PASS** | FAIL | PASS | PASS | 62 | 956 |

El gate rojo de la 3 **no es código roto**: Pi aborta al compactar su propio contexto y deja un `debug.test.ts` tirado. Su engine pasa el árbitro igual. Correlación perfecta en 3 sesiones revisadas: 0 compactions → termina con DONE; 1 compaction → último evento = la compaction, tarea a medias. Es limitación del ejecutor en modo `-p`.

Gate verificado de forma independiente en vez de creerle al agente: 45/45 tests, 0 lint, build limpio, y `src/domain/` + `tests/contracts/` + `CONSTITUTION.md` intactos.

La diferencia se ve comparando un comentario de cada versión del código generado:

```ts
// v4 (arnés propio): Occupancy: only count days that actually have appointments in the range
// Pi (arnés ajeno):   Count calendar days in range [rangeStart, rangeEnd)
```

### Por qué fallaba el v4: una línea del prompt

`ornith_agent_v4.py:51` instruye:

> *"The tests are FROZEN and CORRECT — fix the code to match the test, NEVER the test to match the code."*

Puesta como defensa anti-gaming tras la corrida 1, y correcta en intención. Tiene un supuesto tácito: **que los tests son confiables.** Los escribía el propio modelo — y `:522` muestra que el freeze solo aplica en fase VERIFY, así que durante IMPLEMENT el agente escribió sus propios tests y después el harness se los declaró verdad. Se autoexaminó.

**El mecanismo, verificado por aritmética en 2 corridas:** el modelo escribe buen código pero **calcula mal a mano los valores esperados**.

| Corrida | Su test asertó | Correcto (sumado a mano) | Devolvió su impl |
|---|---|---|---|
| Pi attempt 1 | `180/3780` (contó una cita **cancelada**) | `120/3780 = 0.0317` | **0.0317** ✓ |
| Pi run 3 | `660/3780` | `60+60+90+90+120+60+60+60 = 600` → `0.1587` | **0.1587** ✓ |

Las dos veces el código estaba bien y el test estaba mal. Bajo la instrucción del v4 eso se resuelve rompiendo el código correcto para obedecer la mala aritmética. **La guarda anti-trampa era una máquina de romper código bueno**, y su resultado se leyó como un límite del modelo.

### Lo que esto corrige del arco

1. **El veredicto "NO en 16GB" era sobre el arnés, no sobre el modelo.** Las 9 corridas previas eran reales, pero cada fila de esa tabla es también un arnés distinto — y el último tenía este defecto.
2. **Una guarda en lenguaje natural es una hipótesis, no una garantía, y falla en silencio.** Un guardarraíl en código tira error; una instrucción en un prompt sesga la salida sin avisar.
3. **La aceptación tiene que ser de autoría externa, como instrumento.** Dato que lo respalda: en una corrida correcta, el test que el modelo escribió para sí mismo usaba un rango de UN día — caso donde ambas interpretaciones de la métrica dan lo mismo. Su autoexamen no discriminaba. Acertó, pero sus tests no lo obligaban.
4. **Un arnés propio no puede medir un modelo.** Cuando el resultado falla hay dos explicaciones y el sesgo natural es culpar a la pieza que uno no escribió.

### Gotchas del control (Pi)

- **`-nc` OBLIGATORIO.** Pi auto-descubre `AGENTS.md`/`CLAUDE.md` **subiendo por el árbol**: desde `harness/petdesk-work` alcanza `AgentCode/CLAUDE.md`, que documenta este experimento y su respuesta. Sin `-nc` el modelo no resuelve el spec, lo lee de las notas. Verificado post-hoc: 0 menciones de MODELOS-LOCALES/multica/Kanban en las sesiones.
- **`-p` no stremea el transcript a stdout** — el log queda vacío y parece que no corrió nada. Todo está en el `.jsonl` de `--session-dir`.
- **Contexto**: con `-c 32768` la primera corrida murió (`request (32825 tokens) exceeds the available context size`). A 64K el costo fue **+300 MB** de VRAM (11,6 → 11,9 GB) con KV en `q8_0`. Racionar contexto es error caro.
- **Dos huecos del arnés de prueba que se leían como defectos del modelo**: el `vitest.config.ts` del baseline no declara los alias `@/*` (válidos en `next build`, invisibles para el runner), y la route lee `request.nextUrl`, que un `Request` pelado no tiene → hay que manejarla con `NextRequest`. Sin calibrar la suite, ambas entraban al informe como fallas del agente.

### Reproducibilidad (control Pi)

- `harness/run-pi-control.sh` — corrida única + veredicto. Incluye el comando de relanzamiento del server.
- `harness/run-pi-repeat.sh` — repeticiones con reset pristino y sesión nueva; escribe `harness/pi-variance-summary.tsv`.
- `harness/acceptance/` — la suite, su config de vitest con los alias, y el README con las 5 decisiones de fairness (dónde el spec es ambiguo, el fixture se construye para que todas las lecturas den el mismo valor).
- `harness/artifacts/pi-phase1-run{1,2,3}/` y `pi-phase1-attempt1/` — código generado + sesión `.jsonl` de cada corrida.
- Server: idéntico al del v4 salvo `-c 65536`.

### Reproducibilidad (v3/v4)

- Harness v4: `harness/ornith_agent_v4.py` (v3 + `eval_ts` + expected-vs-received + freeze). Logs: `harness/run-35ba3b-v4.log` (honesto/off-spec), `harness/run-35ba3b.log` (v3/gaming).
- Server: `--n-cpu-moe 22` (40 capas totales, 8/256 expertos activos). `--cpu-moe` (todo CPU) = 3.2GB VRAM / ~15 tok/s; `-n-cpu-moe 22` = 11.6GB / ~49 tok/s. Verificar `nvidia-smi` ANTES de lanzar (el vLLM de OCR toma 14GB y la deja sin lugar).
- Gotcha `eval_ts`: vitest **traga `console.log`** por default → `--disableConsoleIntercept` para que el valor salga a stdout.

---

*Memorias Engram relacionadas: `research/harness-context-doublebind`, `research/small-agentic-models-2026`, `research/qwen36-27b-candidate`, `sdd/v8-ornith/*`.*
