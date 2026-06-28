#!/usr/bin/env bash
# Setup de v7 — RE-RUN del Stats Dashboard con MODELO LOCAL (Qwen2.5-Coder-14B vía vLLM).
# Variable aislada del experimento: SOLO cambia el modelo que sirve opencode (Qwen local
# vs Kimi/OpenRouter del v5). Todo lo demás queda idéntico al v5 — por eso el PROMPT del
# issue es el mismo que el v5; la diferencia (el modelo) vive en el AGENTE, no en el texto.
#
# 3 corridas del FEATURE COMPLETO (no 3 issues distintos como v5): cada corrida produce el
# Stats Dashboard entero en su propia rama feat/v7-stats-N + PR, para comparar 3 diffs de
# Qwen contra el diff de v5/Kimi con un juez a ciegas (paso 6 del diseño).
#
# Requisitos previos (pasos 1-2 del diseño, ya hechos):
#   - vLLM sirviendo Qwen en http://localhost:8000/v1  (model id: qwen2.5-coder-14b)
#   - opencode.jsonc con el provider `vllm`  (plumbing aplicado)
#   - multica daemon corriendo
# Entorno: Multica 0.3.17 + opencode 1.16.2 + gentle-ai 1.34.1 (congelado). Base: v7-baseline.
#
# NOTA temperature=0 (TODO pre-corridas): el diseño pide determinismo. vLLM trae un
# generation_config con temperature=0.7 por defecto (ver el warning del serve.log).
# Validar que opencode pase temperature=0 ANTES de tomar los números como deterministas;
# si no, las 3 corridas miden varianza de sampling además de la del modelo.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

RT="${RT:-21a83fcc-8fbe-4134-82e2-90350e1ce387}"   # runtime OpenCode (ruben-aros-Legion)
REPO_OWNER="rubenaros"
REPO_NAME="petdesk-v2"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
BASE_BRANCH="${BASE_BRANCH:-v7-baseline}"
AGENT_NAME="${AGENT_NAME:-Dev Qwen v7}"
MODEL="${MODEL:-vllm/qwen2.5-coder-14b}"

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

# Crea (idempotente) el agente OpenCode que routea a vLLM/Qwen local.
# max-concurrent-tasks=1: vLLM solo aguanta ~1.5x concurrencia a 16K ctx — fuerza secuencial.
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
        --description "v7: OpenCode -> vLLM local ($MODEL). Requiere vLLM arriba en :8000." \
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

# Header por corrida N — idéntico en espíritu al v5 (no contaminar la variable aislada),
# parametrizado solo en la rama feat/v7-stats-$n.
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
  git checkout -b feat/v7-stats-${n} origin/${BASE_BRANCH}
  git add -A && git commit -m "<mensaje claro>"
  git push ${REPO_URL} HEAD:feat/v7-stats-${n}
  gh pr create --repo ${REPO_OWNER}/${REPO_NAME} --base ${BASE_BRANCH} --head feat/v7-stats-${n} \\
    --title "PetDesk v7 ${n} — Stats Dashboard" \\
    --body "<resumen + cómo verificar + checklist del issue>"

AUTONOMÍA — inmediatamente después de crear el PR, habilita auto-merge:
  gh pr merge feat/v7-stats-${n} --repo ${REPO_OWNER}/${REPO_NAME} --auto --squash
El PR se mergeará SOLO cuando el check \`ci\` de GitHub pase en verde. No esperes aprobación humana.

EOF
}

# Cuerpo del feature — el Stats Dashboard COMPLETO, idéntico para las 3 corridas.
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
- [ ] PR abierto sobre v7-baseline + auto-merge habilitado.
EOF
}

create_all() {
  ensure_agent
  local tmp; tmp="$(mktemp -d)"
  local n
  for n in 1 2 3; do
    { issue_header "$n"; feature_body; } > "$tmp/$n"
    ensure_issue "PetDesk v7 $n — Stats Dashboard" "$tmp/$n"
  done
  rm -rf "$tmp"
  echo ""
  echo "Base: ${BASE_BRANCH}. Modelo: $MODEL (local). Merge: autónomo (auto-merge + CI)."
  echo "Dispara las corridas DE A UNA — esperá que termine cada PR antes de la siguiente"
  echo "(vLLM aguanta ~1.5x concurrencia a 16K ctx; correr en paralelo degrada o trunca)."
  echo "  $0 --assign 1     # luego: --assign 2, --assign 3"
}

assign_one() {
  local n="$1" id
  case "$n" in 1|2|3) ;; *) echo "Corrida inválida: $n (usa 1..3)"; exit 1 ;; esac
  id="$(issue_id_by_prefix "PetDesk v7 $n")"
  [ -z "$id" ] && { echo "No encuentro 'PetDesk v7 $n'. Corré primero el script sin args."; exit 1; }
  echo "Asignando 'PetDesk v7 $n' ($id) -> $AGENT_NAME  (Qwen local; merge autónomo vía CI)"
  multica issue assign "$id" --to "$AGENT_NAME" --output table
}

if [ "${1:-}" = "--assign" ]; then
  assign_one "${2:?usa: --assign N (1..3)}"
else
  create_all
fi
