#!/usr/bin/env bash
# Setup de v8 — RE-RUN del Stats Dashboard con MODELO LOCAL Ornith-1.0-9B (GGUF Q4 vía Ollama).
#
# CAVEAT EXPERIMENTAL (leer antes de comparar números):
# A diferencia del v7 (cuya variable aislada era SOLO el modelo), el v8 cambia TRES cosas a la vez
# respecto del v5/Kimi y del v7/Qwen:
#   1. Modelo:      Qwen2.5-Coder-14B  ->  Ornith-1.0-9B
#   2. Runtime:     vLLM (BF16)        ->  Ollama (GGUF)
#   3. Cuantizacion: -                 ->  Q4_K_M (~6GB en disco)
# Motivo: Ornith-9B en BF16 son ~19GB y NO entra en la RTX 3080 Laptop (16GB VRAM). El unico
# camino local es GGUF cuantizado, y vLLM no sirve GGUF de forma confiable -> se usa Ollama.
# Por lo tanto la comparacion v8 vs v7 NO es 1:1. Documentar este caveat al reportar resultados;
# para una comparacion limpia habria que re-correr Qwen-14B tambien en GGUF Q4 (fuera de scope aqui).
#
# Requisitos previos (ENTORNO — NO los levanta este script; ver runbook abajo):
#   - Ollama (>= 0.17.1; verificado en 0.30.11) sirviendo Ornith-1.0-9B GGUF en su endpoint
#     OpenAI-compat http://localhost:11434/v1 (modelo local `ornith-1.0-9b`, creado vía Modelfile).
#       Nota: Ornith está sobre Qwen 3.5 (arch `qwen35`); Ollama < 0.17.1 falla con
#       "unknown model architecture: 'qwen35'".
#   - opencode.jsonc: provider OpenAI-compat (named `vllm` por legacy, base_url :11434) con el
#     model id `ornith-1.0-9b` en su lista -> opencode lo lista como `vllm/ornith-1.0-9b`.
#   - multica daemon corriendo
#   - rama v8-baseline empujada desde el MISMO punto que v7-baseline (estado pre-stats)
# Entorno: Multica 0.3.17 + opencode 1.16.2 + gentle-ai 1.34.1 + Ollama 0.30.11 (congelado).
# Base: v8-baseline.
#
# RUNBOOK del entorno (correr a mano una sola vez, antes de --assign):
#   # 1. Liberar la GPU: parar cualquier server que la ocupe (p.ej. granite-docling en vLLM).
#   # 2. Bajar el GGUF Q4_K_M (~6GB) vía Ollama:
#   #    ollama pull hf.co/bartowski/deepreinforce-ai_Ornith-1.0-9B-GGUF:Q4_K_M
#   #    (Si el pull se atasca en un blob chico por CDN de HF, reusar el blob grande ya bajado
#   #     en /usr/share/ollama/.ollama/models/blobs/ con un Modelfile local `FROM <blob>` +
#   #     `ollama create ornith-1.0-9b` -> evita el CDN por completo.)
#   # 3. Ollama sirve el modelo en su endpoint OpenAI-compat :11434/v1 (daemon `ollama serve`).
#   #    (Ornith es modelo de razonamiento: abre con bloque <think>...</think>. Todo en GPU:
#   #     VRAM ~5.3GB usados / ~10.7GB libres, ~10.7 tok/s en la RTX 3080.)
#   # 4. Verificar: curl -s localhost:11434/v1/models | grep ornith
#
# NOTA determinismo (TODO pre-corridas, igual que v7): el diseno pide temperature=0 para que las
# 3 corridas midan varianza del modelo y no de sampling. La card de Ornith recomienda temp=0.6;
# validar que opencode pase temp=0 si querés numeros deterministas (si no, medís sampling + modelo).
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

RT="${RT:-21a83fcc-8fbe-4134-82e2-90350e1ce387}"   # runtime OpenCode (ruben-aros-Legion)
REPO_OWNER="rubenaros"
REPO_NAME="petdesk-v2"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
BASE_BRANCH="${BASE_BRANCH:-v8-baseline}"
AGENT_NAME="${AGENT_NAME:-Dev Ornith v8}"
MODEL="${MODEL:-vllm/ornith-1.0-9b}"   # provider OpenAI-compat en :11434 (el nombre `vllm` es legacy; detras corre Ollama)

json_id() { python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))"; }
_list() { python3 -c "
import sys,json
d=json.load(sys.stdin)
if isinstance(d,dict):
    for k in ('items','agents','issues','data','results'):
        if isinstance(d.get(k),list): d=d[k]; break
    else: d=[]
key=sys.argv[1]
for x in d: print((x.get(key) or '')+'\t'+(x.get('id') or ''))
" "$1"; }
agent_id_by_name() { multica agent list --output json 2>/dev/null | _list name | awk -F'\t' -v n="$1" '$1==n{print $2; exit}'; }
issue_id_by_prefix() { multica issue list --output json 2>/dev/null | _list title | awk -F'\t' -v p="$1" 'index($1,p)==1{print $2; exit}'; }

# Crea (idempotente) el agente OpenCode que routea a Ornith-9B local (GGUF via Ollama en :11434).
# max-concurrent-tasks=1: Ollama sirve el modelo de a uno y el throughput es bajo (~10.7 tok/s en la
# 3080); serializar evita contención. VRAM holgada (~5.3GB/16GB), así que no es un tema de OOM.
ensure_agent() {
  local id
  id="$(agent_id_by_name "$AGENT_NAME")"
  if [ -n "$id" ]; then echo "= agente '$AGENT_NAME' ya existe ($id)"; return; fi
  id="$(multica agent create \
        --name "$AGENT_NAME" \
        --runtime-id "$RT" \
        --model "$MODEL" \
        --max-concurrent-tasks 1 \
        --visibility workspace \
        --description "v8: OpenCode -> Ornith-1.0-9B GGUF Q4 via Ollama en :11434. Requiere el server arriba." \
        --output json | json_id)"
  echo "+ agente '$AGENT_NAME' creado ($id) -> model=$MODEL, runtime=OpenCode"
}

ensure_issue() {
  local title="$1" file="$2" id
  id="$(issue_id_by_prefix "$title")"
  if [ -n "$id" ]; then echo "= issue '$title' ya existe ($id)"; return; fi
  id="$(multica issue create --title "$title" --description-file "$file" --output json | json_id)"
  echo "+ issue '$title' creado ($id)"
}

# Header por corrida N — MISMO espiritu y prompt que el v7 (no contaminar la variable de interes:
# el feature). Solo cambia la rama feat/v8-stats-$n y la base v8-baseline.
issue_header() { local n="$1"; cat <<EOF
Trabajas en el repo \`${REPO_NAME}\` (el workdir ya lo trae clonado).

BASE DE TRABAJO (obligatorio): este experimento NO va sobre \`main\`.
Antes de tocar nada:
  git fetch origin
  git checkout ${BASE_BRANCH}        # estado pre-stats: contrato StatsBundle presente, sin implementación
Si tu workdir vino en otra rama, igual basa tu feature branch en \`origin/${BASE_BRANCH}\`.

ANTES DE EMPEZAR (orden obligatorio):
1. Lee \`CONSTITUTION.md\` en el root — reglas duras del proyecto.
2. Lee \`docs/PLAN.md\` — arquitectura completa de petdesk-v2.
3. Lee \`src/domain/types.ts\` — el tipo \`StatsBundle\` (ya definido por el arquitecto, NO MODIFICAR).

NOTA: tu opencode corre con gentle-ai overlay activo (gentle-orchestrator + sub-agentes SDD + skills). Si la complejidad del feature lo amerita, USA SDD para razonar el diseño. Si es atómico, ve directo. Tu criterio.

ENTREGA (obligatoria) — antes de abrir PR verifica que pasen \`npm test\`, \`npm run lint\`, \`npm run build\`.
  git checkout -b feat/v8-stats-${n} origin/${BASE_BRANCH}
  git add -A && git commit -m "<mensaje claro>"
  git push ${REPO_URL} HEAD:feat/v8-stats-${n}
  gh pr create --repo ${REPO_OWNER}/${REPO_NAME} --base ${BASE_BRANCH} --head feat/v8-stats-${n} \\
    --title "PetDesk v8 ${n} — Stats Dashboard" \\
    --body "<resumen + cómo verificar + checklist del issue>"

AUTONOMÍA — inmediatamente después de crear el PR, habilita auto-merge:
  gh pr merge feat/v8-stats-${n} --repo ${REPO_OWNER}/${REPO_NAME} --auto --squash
El PR se mergeará SOLO cuando el check \`ci\` de GitHub pase en verde. No esperes aprobación humana.

EOF
}

# Cuerpo del feature — el Stats Dashboard COMPLETO, IDENTICO al v7 (es la constante del experimento).
feature_body() { cat <<'EOF'
**FEATURE — Stats Dashboard para PetDesk (feature completo, una sola corrida lo entrega todo).**

1. **StatsEngine** en `src/engine/stats.ts`: clase con `compute(rangeStart: Date, rangeEnd: Date): StatsBundle`.
   - `appointmentsTotal` = citas cuyo `start` cae en [rangeStart, rangeEnd).
   - `appointmentsBooked/Completed/Cancelled` = filtrado por `status`. La suma == total.
   - `cancellationRate` = cancelled/total, 4 decimales. Si total=0 → 0.
   - `occupancyRate` = (durationMin de booked+completed) / (minutos laborables 9:00–18:00 UTC en los días del rango). 0..1, 4 decimales.
   - `topServicesByBookings` / `topServicesByCancellations` / `topClientsByVisits` = top 5, orden desc, tie-break estable por id.

2. **API GET** en `src/app/api/stats/route.ts`:
   - Acepta `?start=ISO&end=ISO`. Si faltan, usa los últimos 30 días.
   - Instancia StatsEngine con el shared repo singleton (`src/infra/sharedInstances.ts`).
   - Devuelve `{ stats: StatsBundle }`.

3. **Dashboard UI** — sección "Estadísticas" arriba del feed en `src/app/dashboard/page.tsx`:
   - Muestra: total citas, tasa de cancelación (%), ocupancia (%), top 3 servicios por reservas, top 3 por cancelaciones.
   - Fetch al endpoint en mount + polling cada 5s (ya hay polling para appointments — sumar).
   - Tailwind simple, alineado con el resto.

4. **Tests**:
   - Unitarios del engine en `tests/engine.stats.test.ts` (repo sembrado, ≥6 tests).
   - e2e con InMemoryRepo en `tests/stats.e2e.test.ts` (semana con status mixto: appointmentsTotal=10, cancellationRate=0.2, tops ordenados).
   - Casos límite en `tests/engine.stats.edge.test.ts`: rango vacío, todo cancelado, occupancy 100%, empates (sort estable).

RESTRICCIONES — NO modifiques `src/domain/`, `tests/contracts/`, ni `CONSTITUTION.md`. El tipo `StatsBundle` ya existe.

CHECKLIST PARA EL PR:
- [ ] Leí CONSTITUTION.md, docs/PLAN.md y src/domain/types.ts.
- [ ] StatsEngine + API + sección Estadísticas en /dashboard implementados.
- [ ] Tests: unitarios (≥6) + e2e + ≥4 casos límite, todos verdes.
- [ ] `npm test`, `npm run lint` (0 errores) y `npm run build` pasan.
- [ ] No toqué domain/, contracts/, CONSTITUTION.md.
- [ ] PR abierto sobre v8-baseline + auto-merge habilitado.
EOF
}

create_all() {
  ensure_agent
  local tmp; tmp="$(mktemp -d)"
  local n
  for n in 1 2 3; do
    { issue_header "$n"; feature_body; } > "$tmp/$n"
    ensure_issue "PetDesk v8 $n — Stats Dashboard" "$tmp/$n"
  done
  rm -rf "$tmp"
  echo ""
  echo "Base: ${BASE_BRANCH}. Modelo: $MODEL (Ornith-9B GGUF Q4 local). Merge: autónomo (auto-merge + CI)."
  echo "Dispara las corridas DE A UNA — esperá que termine cada PR antes de la siguiente"
  echo "(Ollama sirve de a uno y va lento ~10.7 tok/s; correr en paralelo solo genera contención)."
  echo "  $0 --assign 1     # luego: --assign 2, --assign 3"
}

assign_one() {
  local n="$1" id
  case "$n" in 1|2|3) ;; *) echo "Corrida inválida: $n (usa 1..3)"; exit 1 ;; esac
  id="$(issue_id_by_prefix "PetDesk v8 $n")"
  [ -z "$id" ] && { echo "No encuentro 'PetDesk v8 $n'. Corré primero el script sin args."; exit 1; }
  echo "Asignando 'PetDesk v8 $n' ($id) -> $AGENT_NAME  (Ornith-9B local; merge autónomo vía CI)"
  multica issue assign "$id" --to "$AGENT_NAME" --output table
}

if [ "${1:-}" = "--assign" ]; then
  assign_one "${2:?usa: --assign N (1..3)}"
else
  create_all
fi
