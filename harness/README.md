# Harness agéntico mínimo-robusto (v3)

Loop agéntico propio para evaluar modelos de coding locales, sin depender de opencode/Multica.
Construido y validado en el arco documentado en [`../docs/MODELOS-LOCALES-AGENTICOS.md`](../docs/MODELOS-LOCALES-AGENTICOS.md).

## Archivos
- `ornith_agent_v3.py` — el harness. Loop sobre Ollama `/api/chat` con: 3 tools (run_bash/read_file/write_file), tool-calling nativo + parser XML de fallback, **guardrails en código** (forzado de fase explore→implement→verify, read-block duro, scope-guard) y **loop de verify cerrado y dirigido** (el harness corre `npm test`, parsea el error a feedback nítido, dirige el fix, repite hasta verde). System prompt ~200 tokens (barato en contexto).
- `petdesk_task.txt` — la tarea constante (Stats Dashboard de petdesk-v2).
- `run-cloud-experiment.sh` — provisiona una GPU cloud y corre el experimento completo.

## Config (env vars)
`AGENT_MODEL` · `AGENT_THINK` (default false) · `AGENT_TEMP` (0.6) · `AGENT_NUMCTX` · `AGENT_NUMPREDICT` (cap anti-runaway).

## Correr local (contra Ollama en :11434)
```bash
AGENT_MODEL=<modelo-en-ollama> AGENT_NUMCTX=16384 \
  python3 ornith_agent_v3.py <workdir> petdesk_task.txt 90
```

## Correr en la nube (experimento Qwen3.6-27B)
Ver `run-cloud-experiment.sh` y la sección "Plan del experimento" del doc.
Serving vía Ollama (mantiene el harness sin cambios).

## Gotchas conocidos (modelos chicos)
- Tool-calls sucios: se aliasa `execute_bash`/`file_editor`→`run_bash`/`write_file`; parser lenient para JSON con newlines literales en `content`/`cmd`.
- La aceptación exige que existan los archivos del feature (si no, da falso-verde con feature ausente).
