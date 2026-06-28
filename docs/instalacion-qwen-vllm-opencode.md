# Instalación de Qwen2.5-Coder-14B con vLLM y uso en opencode

Cómo se sirve **Qwen2.5-Coder-14B-Instruct-AWQ** localmente con vLLM en una RTX 3080
Laptop (16 GB) y cómo se conecta a **opencode** como provider OpenAI-compatible. Es la
receta real del v7: ambiente con **uv** (no Docker), tool-calling arreglado con un parser
community, y el plumbing que no toca el overlay de gentle-ai.

> **Estado:** verificado end-to-end hasta el smoke test de tool-calling (modelo emite tool
> calls y edita archivos). El plumbing de opencode (paso 6) es la receta a aplicar; el provider
> todavía no está escrito en el `opencode.jsonc`. Fecha: 2026-06-28.
>
> Contexto del experimento: [diseno-v7-modelos-locales.md](./diseno-v7-modelos-locales.md).

---

## Quick path

```bash
# 0. Prerrequisitos: driver NVIDIA + CUDA, uv instalado. Carpeta de trabajo:
mkdir -p ~/vllm-v7 && cd ~/vllm-v7

# 1. Ambiente virtual con uv (Python 3.12)
uv venv --python 3.12

# 2. vLLM con el build de CUDA correcto (pin de la versión que funciona)
uv pip install "vllm==0.20.0" --torch-backend=cu129

# 3. Bajar el parser de tool-calling community a ~/vllm-v7/
#    (repo: hanXen/vllm-qwen2.5-coder-tool-parser — ver paso 3)
#    qwen2_5_coder_tool_parser.py  +  tool_chat_template_qwen2_5_coder.jinja

# 4. Arrancar el servidor (descarga el modelo de HF la 1ª vez, ~9-10 GB)
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  ~/vllm-v7/.venv/bin/vllm serve Qwen/Qwen2.5-Coder-14B-Instruct-AWQ \
  --served-model-name qwen2.5-coder-14b \
  --quantization awq --dtype float16 \
  --tool-parser-plugin ~/vllm-v7/qwen2_5_coder_tool_parser.py \
  --tool-call-parser qwen2_5_coder \
  --chat-template ~/vllm-v7/tool_chat_template_qwen2_5_coder.jinja \
  --enable-auto-tool-choice \
  --max-model-len 16384 --enforce-eager \
  --gpu-memory-utilization 0.92 --port 8000

# 5. Verificar
curl -s http://localhost:8000/v1/models | jq .

# 6. Apuntar opencode al endpoint local (ver paso 6)
```

---

## La decisión: uv vs Docker

El diseño original del v7 proponía el contenedor stock (`docker run … vllm/vllm-openai`). En
la práctica se eligió **uv + venv**. La razón no es preferencia, es que el caso lo pide.

| Eje | uv + venv (elegido) | Docker (`vllm/vllm-openai`) |
|---|---|---|
| **Archivos custom** (parser + chat template) | Quedan en `~/vllm-v7/` y se pasan con `--tool-parser-plugin` / `--chat-template`. Cero fricción. | Hay que montar volúmenes o construir una imagen derivada para meterlos. |
| **Versión de torch/CUDA** | `--torch-backend=cu129` resuelve el wheel exacto para el driver de la máquina. | La imagen trae su propio CUDA; puede no matchear el driver host. |
| **Iteración** | Cambiar flag, parser o versión = un comando. | Rebuild de imagen por cada cambio. |
| **Velocidad de setup** | uv resolvió 191 paquetes en ~3 s. | Pull de imagen + capas. |
| **GPU** | Acceso directo. | Necesita `nvidia-container-toolkit` + `--gpus all`. |
| **Reproducibilidad / portabilidad** | ❌ atado a esta máquina (Python de anaconda, driver local, ~9 GB de wheels en el venv). | ✅ la imagen corre igual en otro host. |
| **Aislamiento** | Comparte libs del sistema. | Aísla todo. |

**Veredicto para este caso:** experimento de research, en **una** laptop, con archivos custom
que hay que inyectar → **uv gana**. Si esto fuera a producción o a correr en varias máquinas,
la portabilidad de Docker daría vuelta la decisión.

---

## Prerrequisitos

| Componente | Valor en esta máquina | Cómo verificar |
|---|---|---|
| GPU | RTX 3080 Laptop (GA104M), **16 GB**, CC 8.6 (Ampere) | `nvidia-smi -L` |
| Driver / CUDA | compatible con cu129 wheels | `nvidia-smi` (esquina sup. der.) |
| RAM / cores | 31 GB / 16 | — |
| `uv` | 0.6.9 | `uv --version` |
| Python | 3.12.2 (tomado de anaconda base) | `python --version` |

> **Por qué AWQ + 16 GB:** los pesos en AWQ 4-bit de Qwen-14B entran con holgura y dejan VRAM
> para un KV-cache de **16384 tokens** en fp16. (Devstral-24B no entró: dejaba ~0.66 GB de KV
> → contexto capado a 4K. Ver el doc de diseño.)

---

## Paso 1 — Ambiente virtual con uv

```bash
mkdir -p ~/vllm-v7 && cd ~/vllm-v7
uv venv --python 3.12        # crea ~/vllm-v7/.venv con CPython 3.12.2
```

`uv venv` crea el entorno sin activarlo. Dos formas de usarlo:

```bash
source ~/vllm-v7/.venv/bin/activate     # opción A: activar
# o bien invocar los binarios por ruta absoluta (opción B, la que usan los comandos de abajo):
~/vllm-v7/.venv/bin/vllm --version
```

---

## Paso 2 — Instalar vLLM (build de CUDA correcto)

```bash
cd ~/vllm-v7
uv pip install "vllm==0.20.0" --torch-backend=cu129
```

- **`--torch-backend=cu129`** (experimental en uv 0.6.9) le dice a uv que resuelva el wheel de
  torch para CUDA 12.9. Sin esto, uv resuelve "auto" y puede traer otra combinación — en el
  primer intento resolvió `vllm 0.23.0 + torch cu126`, que se descartó. **Pinear la versión es
  lo que hace la receta reproducible.**
- vLLM arrastra torch, las libs `nvidia-*` y transformers. El venv termina pesando ~9 GB.

### Versiones congeladas (las que funcionan)

Lo que quedó instalado en el venv y está verificado sirviendo tool-calls:

| Paquete | Versión |
|---|---|
| Python | 3.12.2 |
| uv | 0.6.9 |
| **vllm** | **0.20.0+cu129** |
| **torch** | **2.11.0+cu129** |
| **transformers** | **4.57.6** |

> Verificable en cualquier momento con:
> `~/vllm-v7/.venv/bin/python -c "import vllm, torch, transformers; print(vllm.__version__, torch.__version__, transformers.__version__)"`

---

## Paso 3 — Modelo y parser de tool-calling

### El modelo

`Qwen/Qwen2.5-Coder-14B-Instruct-AWQ` (Hugging Face). **No hay que descargarlo a mano**: vLLM
lo baja la primera vez que arranca con ese id (~9–10 GB → `~/.cache/huggingface`).

### El parser (el gotcha que costó resolver)

El parser `hermes` —el que vLLM sugiere para Qwen— **falla en silencio** con Qwen2.5-Coder:
el modelo emite `<tools>{json}</tools>`, no el `<tool_call>` que espera hermes. Resultado:
`tool_calls` queda vacío, el JSON se va al `content`, y el agente **no edita archivos**. No
tira error — simplemente no hay tool calls.

**Fix:** el plugin community **`hanXen/vllm-qwen2.5-coder-tool-parser`** (GitHub). Bajar sus
dos archivos a `~/vllm-v7/`:

```bash
cd ~/vllm-v7
# Ajustar la ruta raw exacta a la del repo (rama/archivos):
curl -L -O https://raw.githubusercontent.com/hanXen/vllm-qwen2.5-coder-tool-parser/main/qwen2_5_coder_tool_parser.py
curl -L -O https://raw.githubusercontent.com/hanXen/vllm-qwen2.5-coder-tool-parser/main/tool_chat_template_qwen2_5_coder.jinja
```

El parser registra el nombre **`qwen2_5_coder`**, que es el que va en `--tool-call-parser`.

---

## Paso 4 — Arrancar el servidor

```bash
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  ~/vllm-v7/.venv/bin/vllm serve Qwen/Qwen2.5-Coder-14B-Instruct-AWQ \
  --served-model-name qwen2.5-coder-14b \
  --quantization awq --dtype float16 \
  --tool-parser-plugin ~/vllm-v7/qwen2_5_coder_tool_parser.py \
  --tool-call-parser qwen2_5_coder \
  --chat-template ~/vllm-v7/tool_chat_template_qwen2_5_coder.jinja \
  --enable-auto-tool-choice \
  --max-model-len 16384 --enforce-eager \
  --gpu-memory-utilization 0.92 --port 8000
```

| Flag | Por qué |
|---|---|
| `--quantization awq --dtype float16` | Pesos AWQ 4-bit, cómputo en fp16. En Ampere no hay FP8 nativo. |
| `--tool-parser-plugin … --tool-call-parser qwen2_5_coder` | Carga el parser community (paso 3). |
| `--chat-template …` | Template que emite el formato `<tools>` que el parser entiende. |
| `--enable-auto-tool-choice` | Habilita que el modelo decida cuándo llamar tools. |
| `--max-model-len 16384` | Contexto. Hay margen para subir a 32768 más adelante. |
| `--enforce-eager` | Sin captura de CUDA graphs (más estable, menos VRAM de arranque). |
| `--gpu-memory-utilization 0.92` | Deja un colchón de VRAM; con 0.95 se ajusta demasiado. |
| `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` | Reduce fragmentación del allocator. |

Listo cuando el log dice **`Application startup complete`** y **`Uvicorn running on …:8000`**.

---

## Paso 5 — Verificar (no confíes en el log)

```bash
# a) el modelo está servido
curl -s http://localhost:8000/v1/models | jq .

# b) smoke test de tool-calling — el gate del experimento
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" -d '{
    "model": "qwen2.5-coder-14b",
    "messages": [{"role":"user","content":"Use the add tool to add 17 and 25"}],
    "tools": [{"type":"function","function":{
      "name":"add","description":"add two numbers",
      "parameters":{"type":"object","properties":{
        "a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}}}],
    "tool_choice":"auto"
  }' | jq '.choices[0]'
```

✅ **Esperado:** `finish_reason: "tool_calls"` y un tool call `add` con `{"a":17,"b":25}`.
Si `tool_calls` viene vacío y el JSON está en `content`, el parser no cargó → revisar paso 3.

---

## Paso 6 — Conectar opencode

vLLM expone `/v1` **OpenAI-compatible**, igual que OpenRouter. Se agrega un provider custom
que apunta al endpoint local. **Va en el `opencode.jsonc` (provider `vllm`), sin tocar
`mcp.engram` ni los plugins** del overlay de gentle-ai.

El `~/.config/opencode/opencode.jsonc` queda así:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "engram": {
      "command": ["/home/ruben-aros/.local/bin/engram", "mcp", "--tools=agent"],
      "enabled": true,
      "type": "local"
    }
  },
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

- `apiKey` puede ser cualquier string: vLLM no valida la key.
- Cambiar `"model"` global a `vllm/qwen2.5-coder-14b` rutea todo a local. Para alternar con
  Kimi sin editar el archivo, dejá el `model` en Kimi y elegí el de vLLM por sesión/agente.

### En Multica (per-agent, sin tocar el global)

Agente con **Provider = OpenCode** y, en **Custom Args**:

```
--model vllm/qwen2.5-coder-14b
```

Así el agente del tablero rutea a vLLM local mientras el resto sigue en su default.

---

## Gestión del proceso (start / stop)

```bash
# ¿está vivo? (puerto 8000)
curl -s http://localhost:8000/v1/models >/dev/null && echo UP || echo DOWN

# detener — por puerto, NO con pkill (ver gotcha)
kill -TERM -$(ps -o pgid= -p $(fuser 8000/tcp 2>/dev/null) | tr -d ' ')
```

> **Gotchas operacionales (registrados en vivo):**
> - **No** uses `pkill -f "vllm serve"` desde un script que a su vez lanza `vllm serve`: se
>   mata su propio shell padre (exit 144). Matá por puerto/PGID como arriba.
> - Un waiter que hace `grep 'parser'` en el log da **falso positivo**: marca líneas INFO
>   benignas como error. Verificá con `curl`, no con el grep del log.

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `tool_calls` vacío, JSON en `content` | parser `hermes` o sin plugin | usar `--tool-call-parser qwen2_5_coder` + `--tool-parser-plugin` (paso 3) |
| OOM / no levanta | `--gpu-memory-utilization` muy alto o ctx muy grande | bajar a 0.90 / reducir `--max-model-len` |
| Combinación rara de versiones | `uv pip install vllm` sin pin ni `--torch-backend` | pinear `vllm==0.20.0 --torch-backend=cu129` |
| `exit 144` al parar | `pkill` se mató a sí mismo | matar por puerto/PGID |
| Arranca pero opencode no lo ve | provider mal puesto o server abajo | `curl /v1/models`; revisar `baseURL` y `model` |

---

## Checklist

- [ ] `uv venv --python 3.12` creó `~/vllm-v7/.venv`
- [ ] `vllm==0.20.0 --torch-backend=cu129` instalado (versiones del paso 2 verifican)
- [ ] Parser `qwen2_5_coder` (`.py` + `.jinja`) en `~/vllm-v7/`
- [ ] `vllm serve` muestra `Application startup complete`
- [ ] `curl /v1/models` lista `qwen2.5-coder-14b`
- [ ] Smoke test devuelve `finish_reason: tool_calls` con `{"a":17,"b":25}`
- [ ] opencode: provider `vllm` + `model` apuntando a local (o `--model` en Multica)

---

## Referencias

- [diseno-v7-modelos-locales.md](./diseno-v7-modelos-locales.md) — diseño del experimento, por qué Qwen y no Devstral, la vara de calidad.
- [env-baseline-v4.md](./env-baseline-v4.md) — razonamiento del freeze del overlay (gentle-ai/opencode).
- Repo del parser: `hanXen/vllm-qwen2.5-coder-tool-parser` (GitHub).
- Modelo: `Qwen/Qwen2.5-Coder-14B-Instruct-AWQ` (Hugging Face).
