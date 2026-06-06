#!/usr/bin/env bash
# Setup de v6 — Stats Dashboard CON SDD invocado explícitamente.
# A diferencia de v4/v5 (3 issues pre-cortados, agente directo), acá hay UN solo issue
# a nivel feature y se invoca el flujo SDD (explore -> propose -> spec -> design ->
# tasks -> apply -> verify). El preflight va bakeado para no colgar el modo headless.
#
# Comparación: contra v2 (baseline sin overlay). v5 queda como referencia secundaria
# (overlay sin SDD). Artefactos en openspec/ (visibles). Merge autónomo (auto-merge + CI).
# Entorno: Multica 0.3.17 + opencode 1.16.2 + gentle-ai 1.34.1. Base: rama v6-baseline.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

REPO_OWNER="rubenaros"
REPO_NAME="petdesk-v2"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
BASE_BRANCH="${BASE_BRANCH:-v6-baseline}"

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
issue_id_by_prefix() { multica issue list --output json 2>/dev/null | _list title | awk -F'\t' -v p="$1" 'index($1,p)==1{print $2; exit}'; }

ensure_issue() {
  local title="$1" file="$2" id
  id="$(issue_id_by_prefix "$title")"
  if [ -n "$id" ]; then echo "= issue '$title' ya existe ($id)"; return; fi
  id="$(multica issue create --title "$title" --description-file "$file" --output json | json_id)"
  echo "+ issue '$title' creado ($id)"
}

create_one() {
  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<EOF
Trabajas en el repo \`${REPO_NAME}\` (el workdir ya lo trae clonado).

BASE DE TRABAJO (obligatorio): este experimento NO va sobre \`main\`.
  git fetch origin
  git checkout ${BASE_BRANCH}        # estado pre-stats: contrato StatsBundle presente, sin implementación
Basa tu feature branch en \`origin/${BASE_BRANCH}\`.

MÉTODO — USA SDD (obligatorio para este issue):
Ejecuta el flujo SDD completo para esta feature: explore -> propose -> spec -> design -> tasks -> apply -> verify.
SDD Session Preflight — proporciono las CUATRO decisiones ahora; NO preguntes y NO te detengas:
  - A2: ejecución automática
  - B1: artefactos en OpenSpec (carpeta \`openspec/\`)
  - C2: un solo PR
  - D1: presupuesto de 400 líneas
Trata esto como el bloque de preflight de la sesión y avanza. Es una corrida headless no interactiva; nunca pauses para confirmación.

ANTES DE EMPEZAR: lee \`CONSTITUTION.md\` y \`docs/PLAN.md\`. El contrato \`StatsBundle\` ya está en \`src/domain/types.ts\` (NO MODIFICAR).

FEATURE — Stats Dashboard para PetDesk. Debe satisfacer:

1. StatsEngine en \`src/engine/stats.ts\`: clase con \`compute(rangeStart, rangeEnd): StatsBundle\`.
   - appointmentsTotal = citas cuyo \`start\` cae en [rangeStart, rangeEnd).
   - booked/completed/cancelled por status; la suma == total.
   - cancellationRate = cancelled/total (4 decimales; 0 si total=0).
   - occupancyRate = durationMin de booked+completed / minutos laborables 9:00-18:00 UTC en el rango (0..1, 4 decimales).
   - topServicesByBookings / topServicesByCancellations / topClientsByVisits = top 5, orden desc, tie-break estable por id.
2. API GET en \`src/app/api/stats/route.ts\`: query \`?start&end\` (default últimos 30 días), usa el shared repo singleton, devuelve { stats }.
3. Sección "Estadísticas" en \`src/app/dashboard/page.tsx\`: total, cancelación %, ocupancia %, top 3 servicios; fetch + polling cada 5s.
4. Tests: unitarios del engine, e2e con InMemoryRepo, y casos límite (rango vacío, todo cancelado, empates).

NO modifiques \`src/domain/\`, \`tests/contracts/\`, ni \`CONSTITUTION.md\`.

ENTREGA — antes de abrir el PR, verifica \`npm test\`, \`npm run lint\`, \`npm run build\` en verde. Commitea TAMBIÉN los artefactos de \`openspec/\`.
  git checkout -b feat/v6-stats origin/${BASE_BRANCH}
  git add -A && git commit -m "<mensaje claro>"
  git push ${REPO_URL} HEAD:feat/v6-stats
  gh pr create --repo ${REPO_OWNER}/${REPO_NAME} --base ${BASE_BRANCH} --head feat/v6-stats \\
    --title "PetDesk v6 — Stats Dashboard (SDD)" \\
    --body "<resumen + artefactos SDD + cómo verificar>"

AUTONOMÍA — inmediatamente después de crear el PR, habilita auto-merge:
  gh pr merge feat/v6-stats --repo ${REPO_OWNER}/${REPO_NAME} --auto --squash
El PR se mergeará solo cuando el check \`ci\` pase en verde. No esperes aprobación humana.
EOF
  ensure_issue "PetDesk v6 — Stats Dashboard (SDD)" "$tmp"
  rm -f "$tmp"
  echo ""
  echo "Base: ${BASE_BRANCH}. Método: SDD (preflight bakeado). Merge: autónomo (CI)."
  echo "Dispara la corrida:  $0 --assign"
}

assign_one() {
  local title="PetDesk v6 — Stats Dashboard (SDD)" id
  id="$(issue_id_by_prefix "$title")"
  [ -z "$id" ] && { echo "No encuentro '$title'. Corré primero el script sin args."; exit 1; }
  echo "Asignando '$title' ($id) -> Dev Motor v2  (DISPARA SDD; sub-agentes + merge autónomo)"
  multica issue assign "$id" --to "Dev Motor v2" --output table
}

if [ "${1:-}" = "--assign" ]; then
  assign_one
else
  create_one
fi
