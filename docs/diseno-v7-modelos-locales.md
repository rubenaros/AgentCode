# Diseño v7 — Modelos locales (Qwen2.5-Coder-14B en vLLM)

> **Estado: CERRADO con veredicto (2026-06-28).** El serving, el tool-calling y el plumbing
> funcionaron, pero el experimento **no pudo medir la calidad del código del modelo local**:
> el agente nunca arrancó porque el prompt base del harness (20.5K tokens) no deja espacio en
> un contexto de ≤24K. El cuello de botella resultó ser el **harness, no el modelo**. Veredicto
> completo al final, en [Resultado](#resultado-veredicto-2026-06-28).
>
> **Cambio de modelo (2026-06-28):** el modelo elegido pasó de **Devstral-Small-2507** a
> **Qwen2.5-Coder-14B-Instruct-AWQ**. Devstral-24B entraba en 16 GB pero dejaba solo ~0.66 GB
> para el KV-cache → contexto capado a ~4K, demasiado apretado para opencode agentic. Qwen-14B
> deja headroom de sobra y sirve a **16384 de contexto con tool-calling validado**. El detalle
> está en [Por qué Qwen2.5-Coder-14B](#por-qué-qwen25-coder-14b).

El v7 lleva al extremo la capa #1 del stack (abaratar el modelo): saca la API de pago
de la ecuación y sirve el modelo **localmente** con vLLM. La pregunta deja de ser de
costo y pasa a ser de calidad.

## La pregunta del experimento

No es *"¿más barato?"* — un modelo corriendo en la laptop es ~$0, la respuesta es trivial
y conocida de antemano. La pregunta real es:

> **¿Un modelo local de 16GB produce código *production-acceptable* para features de este
> tamaño, y cuánta calidad se pierde frente a Kimi K2.6?**

Si solo se midiera costo, el local "gana" por definición y la conclusión nace sesgada.
Por eso el v7 incorpora una **vara de calidad**, que es lo que ningún experimento anterior
(v1–v6) midió.

## Variable aislada

Solo cambia **el modelo que sirve opencode** (Qwen-14B local vs Kimi por OpenRouter).
Todo lo demás queda **idéntico al v5** para que el experimento sea controlado.

| Capa | v5 (baseline) | v7 |
|---|---|---|
| Multica | 0.3.17 | 0.3.17 (frozen) |
| opencode | 1.16.2 | 1.16.2 (frozen) |
| gentle-ai overlay | 1.34.1 (activo) | 1.34.1 (frozen) |
| SDD | no se activa (feature chica) | igual |
| Feature | Stats Dashboard | Stats Dashboard |
| **Modelo** | **Kimi K2.6 (OpenRouter)** | **Qwen2.5-Coder-14B-AWQ (vLLM local)** |

> El baseline de comparación es **v5** (Kimi, sin SDD), no v6 (que introduce SDD). v5 es el
> único que aísla la variable "modelo". El overlay se mantiene **congelado** a propósito: ver
> [env-baseline-v4.md](./env-baseline-v4.md) para el razonamiento del freeze.

## Hardware (confirmado)

| Componente | Valor |
|---|---|
| GPU | NVIDIA GeForce RTX 3080 **Laptop** (chip GA104M) |
| VRAM | **16 GB** (16384 MiB) |
| Compute capability | 8.6 (Ampere) |
| RAM / cores | 31 GB / 16 |

Verificado con `nvidia-smi -L`, `FB Memory Total` y `lspci`. El chip GA104M solo existe en
variantes de 8 o 16 GB: **no hay versión de 24 GB** de esta tarjeta (eso requeriría el GA102
de una desktop 3090/4090). Este techo de 16 GB es lo que define qué modelo entra.

## Runtime + modelo

vLLM expone un endpoint `/v1/chat/completions` **OpenAI-compatible**, igual que OpenRouter.
Por eso el cambio es quirúrgico: opencode apunta su `base_url` al servidor local y el overlay
no se entera.

Comando de serve **verificado funcionando** (vLLM 0.20.0 cu129, transformers 4.57.6, fp16
KV-cache, AWQ + float16). El parser de tool-calling necesita un plugin community (ver más
abajo), por eso no es el contenedor stock sino `vllm serve` en un venv con los archivos del
parser en `~/vllm-v7/`:

```bash
PATH="$VENV/bin:$PATH" PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  vllm serve Qwen/Qwen2.5-Coder-14B-Instruct-AWQ \
  --served-model-name qwen2.5-coder-14b \
  --quantization awq --dtype float16 \
  --tool-parser-plugin /home/ruben-aros/vllm-v7/qwen2_5_coder_tool_parser.py \
  --tool-call-parser qwen2_5_coder \
  --chat-template /home/ruben-aros/vllm-v7/tool_chat_template_qwen2_5_coder.jinja \
  --enable-auto-tool-choice \
  --max-model-len 16384 --enforce-eager \
  --gpu-memory-utilization 0.92 --port 8000
```

**Notas de hardware (verificadas):** en Ampere funcionan AWQ/GPTQ/Marlin. FP8 **nativo** no
funciona (necesita Ada 8.9); el FP8 KV-cache sí existe como palanca de contexto, pero con
Qwen-14B **no hace falta** — a `--max-model-len 16384` sobra VRAM con fp16 KV (queda margen
para subir a 32768 más adelante, que es lo que la investigación dice que Qwen-14B aguanta).

### Por qué Qwen2.5-Coder-14B

La primera elección fue **Devstral-Small-2507** (24B) por su SWE-bench y su parser de fábrica
limpio. Pero al levantarlo en la 3080 de 16 GB, los pesos AWQ dejaban solo **~0.66 GB para el
KV-cache → contexto capado a ~4K**: demasiado apretado para opencode agentic, que necesita
acumular contexto multi-archivo. Devstral quedó descartado por hardware, no por calidad.

Candidatos que entran en 16 GB con tool-calling, verificados contra benchmarks 2026:

| Modelo | SWE-bench Verified | Contexto en 16 GB | Tool-calling en vLLM |
|---|---|---|---|
| **Qwen2.5-Coder-14B-AWQ** ✅ elegido | 42.7 % | ✅ cómodo (16K probado, 32K posible) | ⚠️ parser stock roto → fix community (abajo) |
| Devstral-Small-2507 (24B) ❌ no entra | 53.6 % | ⛔ capado a ~4K (0.66 GB KV) | ✅ limpio (`--tool-call-parser mistral`) |
| Qwen3-14B (generalista) | — | ✅ cómodo | ✅ limpio (`hermes`) |
| Qwen2.5-Coder-7B-AWQ | — | ✅ holgado | ⚠️ mismo parser; el más flojo en agentic |

**Excluidos por no entrar:** Qwen3-Coder-30B-A3B (pesos 16.7–18 GB; el MoE carga todos los
expertos → necesita 24 GB), Qwen2.5-Coder-32B (19 GB), Devstral-2-2512 (SWE-bench 68 % pero
con bug activo de parser en vLLM).

Qwen2.5-Coder-14B es el mejor coding model que **entra con contexto usable**: −11 puntos de
SWE-bench frente a Devstral, pero con 16K de contexto real en lugar de 4K. Para un experimento
de loops agentic multi-archivo, el contexto manda sobre el score nominal del benchmark.

#### El parser de tool-calling (gotcha que costó resolver)

El parser `hermes` (el que vLLM sugiere para Qwen) **falla en silencio** con Qwen2.5-Coder: el
modelo emite `<tools>{json}</tools>`, no el `<tool_call>` que espera hermes, así que `tool_calls`
queda vacío y el JSON se va al `content`. No tira error — simplemente no hay tool calls, y el
agente no edita archivos.

El fix es el plugin community **`hanXen/vllm-qwen2.5-coder-tool-parser`**: se bajan
`qwen2_5_coder_tool_parser.py` + `tool_chat_template_qwen2_5_coder.jinja` a `~/vllm-v7/` y se
cargan con `--tool-parser-plugin` + `--tool-call-parser qwen2_5_coder`. Con eso el smoke test
pasa: `add → {"a":17,"b":25}`, `finish_reason: tool_calls`.

> **Gotchas operacionales registrados:**
> - No matar el server con `pkill -f "vllm serve"` desde un script que lo lanza — se mata su
>   propio shell padre (exit 144). Matar por puerto: `kill -TERM -$(ps -o pgid= -p $(fuser 8000/tcp))`.
> - El waiter que hace grep de `'parser'` da falso positivo: marca líneas INFO benignas como
>   error. Verificar con `curl`, no solo con el waiter (el server estaba bien: "Application
>   startup complete").

## La vara de calidad

### Plano objetivo (automático, comparable v5 ↔ v7)

| Id | Métrica |
|---|---|
| M1 | Completitud funcional (¿implementó todo el issue, sin stubs ni TODOs?) |
| M2 | CI: ¿verde? ¿a la primera o tras N pushes? (lint + test + build de petdesk-v2) |
| M3 | Iteraciones hasta verde (o abandono) |
| M4 | Autonomía: ¿logró auto-merge con CI verde? (camino A del v5) |
| M5 | Tiempo wall-clock + tokens / throughput |

### Plano cualitativo (la vara nueva — juez adversarial a ciegas)

- Se toma el **diff final** de cada corrida (3 de Qwen-14B + el de v5/Kimi), se etiquetan
  A/B/C/D **sin revelar qué modelo produjo cada uno**, y se evalúan con `judgment-day`
  (Claude Opus) usando una rúbrica fija.
- A ciegas para eliminar el sesgo de "sé que este es el modelo barato".
- Rúbrica, 5 ejes, escala 1–5:

  | Eje | Qué mide |
  |---|---|
  | Correctness | ¿hace lo que pide sin bugs? |
  | Completeness | ¿cubre todo el issue, sin stubs? |
  | Edge cases | ¿maneja inputs raros y errores? |
  | Code quality | ¿idiomático, legible, sin over-engineering, sigue patrones del repo? |
  | Security | ¿introduce vulnerabilidades? |

### Umbral de veredicto

El experimento concluye **viable** si Qwen-14B logra **CI verde + juez ≥ 4/5 en correctness
y completeness**. Si cruza ese umbral en el Stats Dashboard, entonces para features de este
tamaño un modelo local de laptop es una alternativa real al API de pago.

## Protocolo paso a paso

1. **vLLM up** — levantar el contenedor; confirmar `GET /v1/models`.
2. **Plumbing** — apuntar opencode a vLLM con un provider OpenAI-compatible custom, **sin
   tocar los plugins del overlay**. Validar con un prompt simple (ver sección siguiente).
3. **Smoke test** — un issue trivial (el `add()` del de-risk) para confirmar que el modelo
   **emite tool calls y edita archivos**. ⛔ *Gate:* si falla aquí, detener y arreglar el
   plumbing — no se quema el experimento completo. ✅ *Hecho:* gate pasado con el parser
   community `qwen2_5_coder` (el stock `hermes` fallaba en silencio).
4. **Baseline branch** — `v7-baseline` en petdesk-v2 = **599749d6 + el fix de ci-trigger**
   (lección del v6: resetear al commit crudo pierde el trigger de CI y rompe el auto-merge).
   De paso, limpiar restos del v6: PR #15 trabado y ramas `feat/v6-stats-*`.
5. **Corridas** — lanzar el issue Stats Dashboard **3×** vía Multica (agente Provider=OpenCode
   → vLLM), `temperature=0`. Recolectar M1–M5 por corrida.
6. **Juez** — judgment-day a ciegas sobre los diffs finales → scores por eje.
7. **Síntesis** — tabla comparativa v7 (Qwen-14B) vs v5 (Kimi); veredicto sobre el umbral.

## Plumbing opencode → vLLM

opencode ya rutea por un endpoint OpenAI-compatible (OpenRouter). Para el v7 se agrega un
provider custom que apunta al vLLM local. **Va en el `opencode.jsonc` chico (o per-agent en
Multica vía Custom Args), no en los plugins gestionados por el overlay.**

```jsonc
{
  "provider": {
    "vllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "vLLM local",
      "options": { "baseURL": "http://localhost:8000/v1", "apiKey": "dummy" },
      "models": { "qwen2.5-coder-14b": { "name": "Qwen2.5-Coder-14B" } }
    }
  },
  "model": "vllm/qwen2.5-coder-14b"
}
```

vLLM no exige una API key real (sirve cualquier valor). En Multica, el agente con
Provider=OpenCode usa `--model vllm/qwen2.5-coder-14b` en Custom Args. **El detalle exacto
se valida en el paso 2 antes de las corridas oficiales.**

## Riesgos conocidos + mitigación

| Riesgo | Mitigación |
|---|---|
| Contexto de 16K ahoga al agente en un repo real | Headroom para subir a 32K si hace falta; **medir** si truncó (es un dato del experimento) |
| Tool-calling falla o entra en loops | ✅ resuelto: parser community `qwen2_5_coder` (el stock `hermes` falla en silencio); smoke test pasado como gate |
| Fragilidad operacional (como el 502 del v6) | Reintentos + log por corrida |
| El plumbing pisa el overlay frozen | El provider va en config aparte de los plugins; validar antes de correr |

## Gap esperado vs Kimi K2.6

De la investigación de benchmarks (tratar como orden de magnitud, no decimal exacto; los
scores de SWE-bench dependen del scaffold):

| Benchmark | Local 16 GB (Qwen2.5-Coder-14B) | Kimi K2.6 |
|---|---|---|
| SWE-bench Verified | 42.7 % | **80.2 %** |
| LiveCodeBench v6 | ~24 % | **89.6 %** |
| HumanEval+ (synthesis simple) | 87 % | ~saturado (≈ a la par) |

Lectura: en generación de una función el local está casi a la par; en loops agentic
multi-archivo el gap ronda los **−37 puntos de SWE-bench**. La hipótesis a confirmar con el
experimento es que un modelo local de 16 GB es un **editor competente de tareas acotadas**,
pero no un sustituto de Kimi K2.6 para trabajo autónomo multi-archivo.

## Estado / próximos pasos

- [x] Paso 1 — levantar vLLM con Qwen2.5-Coder-14B-AWQ (16K ctx, fp16 KV)
- [x] Paso 2 — plumbing aplicado: provider `vllm` en `opencode.jsonc`, `temperature=0` forzado server-side (`--override-generation-config`), `limit` del modelo para capar `max_tokens`.
- [x] Paso 3 — smoke test del tool-calling resuelto (gate pasado: `add → {"a":17,"b":25}`, parser community `qwen2_5_coder`)
- [x] Paso 4 — `v7-baseline` ya creada (`6390947a` = 599749d6 + ci-trigger fix); limpieza de ramas v4/v5.
- ⊘ Paso 5 — **bloqueado**: el agente no arranca (loop de contexto, ver Resultado). No hubo diffs.
- ⊘ Paso 6 — no ejecutable sin diffs del paso 5.
- ⊘ Paso 7 — reemplazado por este veredicto (no se generó `env-baseline-v7.md`).

## Resultado (veredicto, 2026-06-28)

El experimento **no llegó a medir la calidad del código del modelo local** — y *por qué* no
llegó es el hallazgo.

### Qué SÍ funcionó (todo el plumbing)

| Pieza | Estado |
|---|---|
| Serving Qwen-14B-AWQ en vLLM (16K y 24K) | ✅ |
| Tool-calling | ✅ con el parser community `qwen2_5_coder` (el `hermes` stock falla en silencio) |
| `temperature=0` determinista | ✅ `--override-generation-config '{"temperature": 0}'`, verificado byte-a-byte |
| Provider en opencode + routing per-agent en Multica (`--model vllm/...`) | ✅ |

### Qué lo frenó: el contexto que consume el harness

El agente **nunca pudo empezar a trabajar**. El prompt base —antes de cualquier acción— es de
**20.481 tokens fijos**: system prompt de orquestación de Multica (*"## Goal — complete the
assigned issue using Multica commands…"*) + definiciones de tools de opencode. Eso choca con
el contexto del modelo local:

- **A 16K:** imposible (20.481 > 16.384). El agente entra en loop error → compactación → error.
- **A 24K:** falla por **1 token** (20.481 + 4.096 de output = 24.577 > 24.576). Mismo loop.
- **Mitigación intentada (desactivar engram MCP):** **no movió nada** — el prompt base quedó en
  20.481 idéntico, incluso tras reiniciar el daemon. Engram no estaba en ese prompt; el peso es
  el scaffolding de Multica + tools de opencode, **irreducible** sin desarmar el setup.

### El veredicto

> **El cuello de botella es el *harness*, no la calidad del modelo.** El overlay/orquestación
> se diseñó asumiendo modelos de gran contexto (Kimi K2.6 ≈ 256K, donde 20K de overhead es
> irrelevante). Un modelo local de contexto acotado (≤24K) es **estructuralmente incompatible**
> con este stack agentic — independientemente de qué tan bueno sea su código.

Para medir la calidad del modelo local haría falta **otro harness más liviano** (sin el
scaffolding de orquestación pesado), lo que ya sería otro experimento — no "el mismo stack con
modelo local". Subir a 32K en la laptop de 16 GB era VRAM al límite (gpu-mem-util ~0.96,
riesgo OOM) por un margen de trabajo aún ajustado: se descartó.

> Lección transversal para el arnés: una capa "modelo local barato" no es plug-in si las capas
> de orquestación de arriba asumen contexto abundante. El costo en tokens de contexto del
> harness es una restricción de diseño tan real como el costo en dólares de la API.

## Referencias

- [instalacion-qwen-vllm-opencode.md](./instalacion-qwen-vllm-opencode.md) — guía reproducible: venv con uv, vLLM, parser de tool-calling y plumbing en opencode.
- [env-baseline-v4.md](./env-baseline-v4.md) — baseline v4/v5, razonamiento del freeze del overlay.
- `scripts/setup-petdesk-v5-stats.sh` — autonomía (camino A): auto-merge gateado por CI.
- `scripts/setup-petdesk-v6-sdd.sh` — v6 con SDD; lección del reset de baseline.
