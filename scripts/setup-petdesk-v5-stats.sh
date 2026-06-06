#!/usr/bin/env bash
# Setup de v5 — RE-RUN del Stats Dashboard con AUTONOMÍA (Camino A).
# Mismo experimento/feature que v4, pero ahora el agente habilita auto-merge en su
# propio PR: GitHub lo mergea solo cuando el check `ci` pasa en verde. Sin revisión
# humana — la compuerta es el CI (modelo de aprobación batch).
#
# Entorno: Multica 0.3.17 + opencode 1.16.2 + gentle-ai 1.34.1 (congelado).
# Base: rama v5-baseline @ 599749d6 (contrato StatsBundle presente, sin implementación).
# Branch protection en v5-baseline exige el check `ci`, sin reviews humanos.
#
# Autonomía: merge = autónomo (agente + CI). Dispatch de #2/#3 tras mergear #1 = lo
# orquesta el humano/operador (Multica 0.3.17 no encadena hermanos-dependientes nativo).
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

RT="${RT:-21a83fcc-8fbe-4134-82e2-90350e1ce387}"
REPO_OWNER="rubenaros"
REPO_NAME="petdesk-v2"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
BASE_BRANCH="${BASE_BRANCH:-v5-baseline}"

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

ensure_issue() {
  local title="$1" file="$2" id
  id="$(issue_id_by_prefix "$title")"
  if [ -n "$id" ]; then echo "= issue '$title' ya existe ($id)"; return; fi
  id="$(multica issue create --title "$title" --description-file "$file" --output json | json_id)"
  echo "+ issue '$title' creado ($id)"
}

issue_header() { cat <<EOF
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
  git checkout -b feat/v5-stats-N origin/${BASE_BRANCH}
  git add -A && git commit -m "<mensaje claro>"
  git push ${REPO_URL} HEAD:feat/v5-stats-N
  gh pr create --repo ${REPO_OWNER}/${REPO_NAME} --base ${BASE_BRANCH} --head feat/v5-stats-N \\
    --title "PetDesk v5 N — <título>" \\
    --body "<resumen + cómo verificar + checklist del issue>"

AUTONOMÍA — inmediatamente después de crear el PR, habilita auto-merge:
  gh pr merge feat/v5-stats-N --repo ${REPO_OWNER}/${REPO_NAME} --auto --squash
El PR se mergeará SOLO cuando el check \`ci\` de GitHub pase en verde. No esperes aprobación humana.

EOF
}

create_all() {
  local tmp; tmp="$(mktemp -d)"

  { issue_header; cat <<'EOF'
**Issue 1 — StatsEngine** [secuencial, va primero]

Implementa una clase `StatsEngine` en `src/engine/stats.ts` que computa el `StatsBundle` del dominio.

API esperada:
```ts
import type { Repository } from '../domain/ports';
import type { StatsBundle } from '../domain/types';

export class StatsEngine {
  constructor(private repo: Repository) {}
  compute(rangeStart: Date, rangeEnd: Date): StatsBundle;
}
```

Reglas / contrato (todas verificables con tests):
- `appointmentsTotal` = citas cuyo `start` cae en [rangeStart, rangeEnd).
- `appointmentsBooked/Completed/Cancelled` = filtrado por `status`. Suma == total.
- `cancellationRate` = cancelled/total, redondeado a 4 decimales. Si total=0 → 0.
- `occupancyRate` = (durationMin de citas booked+completed) / (minutos laborables 9:00–18:00 UTC en días del rango). 0..1. Redondeado a 4 decimales.
- `topServicesByBookings` = top 5 por count, solo status booked+completed. Ordenado desc.
- `topServicesByCancellations` = top 5 por count, solo status cancelled. Ordenado desc.
- `topClientsByVisits` = top 5 por count de citas no canceladas. Ordenado desc.

Tests del agente en `tests/engine.stats.test.ts`:
- Test con repo sembrado (usar InMemoryRepo + datos custom).
- Casos: rango vacío, rango con solo cancelaciones, occupancy 100%, ties en tops.

Solo modificas `src/engine/stats.ts` y `tests/engine.stats.test.ts`.
NO modificas `src/domain/`, `tests/contracts/`, `CONSTITUTION.md`, código existente de engine/receptionist/app.

CHECKLIST PARA EL PR:
- [ ] Leí CONSTITUTION.md.
- [ ] Solo creé/modifiqué los 2 archivos listados.
- [ ] `npm test` pasa con ≥6 tests nuevos para StatsEngine.
- [ ] `npm run lint` (0 errores) y `npm run build` pasan.
- [ ] PR abierto sobre v5-baseline + auto-merge habilitado.
EOF
  } > "$tmp/1"; ensure_issue "PetDesk v5 1 — StatsEngine" "$tmp/1"

  { issue_header; cat <<'EOF'
**Issue 2 — API + Dashboard UI para Stats** [P con Issue 3, tras Issue 1 mergeado]

Construye:
1. `src/app/api/stats/route.ts` — GET endpoint:
   - Acepta query params `?start=ISO&end=ISO`. Si faltan, usa últimos 30 días.
   - Instancia StatsEngine con el shared repo singleton (ver `src/infra/sharedInstances.ts`).
   - Devuelve `{ stats: StatsBundle }`.
2. Modifica `src/app/dashboard/page.tsx` para AGREGAR una sección "Estadísticas" arriba del feed:
   - Muestra: total citas, tasa de cancelación (%), ocupancia (%), top 3 servicios por reservas, top 3 servicios por cancelaciones.
   - Fetch al endpoint en mount + polling cada 5s (ya hay polling para appointments — sumar).
   - Diseño Tailwind simple, alineado con el resto.

Solo modificas `src/app/api/stats/**` y `src/app/dashboard/page.tsx`.
NO modificas engine, receptionist, domain, contracts.

CHECKLIST:
- [ ] Leí CONSTITUTION.md.
- [ ] Endpoint responde y la sección Estadísticas se ve en `/dashboard`.
- [ ] `npm test`, `npm run lint`, `npm run build` pasan.
- [ ] PR abierto + auto-merge habilitado.
EOF
  } > "$tmp/2"; ensure_issue "PetDesk v5 2 — Stats API + Dashboard UI" "$tmp/2"

  { issue_header; cat <<'EOF'
**Issue 3 — QA stats e2e** [P con Issue 2, tras Issue 1 mergeado]

Solo modificas `tests/`.

1. `tests/stats.e2e.test.ts` — escenario completo end-to-end con `InMemoryRepo`:
   - Siembra: 3 servicios, 4 clientes, 10 citas en una semana (con status mixto: 5 booked, 3 completed, 2 cancelled), 2 en waitlist (irrelevantes para stats pero no deben afectar).
   - Llama StatsEngine.compute() sobre la semana.
   - Verifica: appointmentsTotal=10, distribución de status, cancellationRate=0.2, topServicesByBookings ordenado correcto, topClients refleja visitas no canceladas.
2. Casos límite en `tests/engine.stats.edge.test.ts`:
   - Rango sin citas → todos los counts = 0, rates = 0, tops = [].
   - Rango con TODAS canceladas → cancellationRate=1, occupancy=0.
   - Cita que arranca antes del rango pero termina dentro (incluir o no — declara el supuesto).
   - Empate en tops (sort estable por id alfabético).

Reporta bugs del Dev Stats como comentario del issue 1; arregla solo si el fix es trivial Y dejas constancia.

CHECKLIST:
- [ ] SOLO modifiqué `tests/`.
- [ ] e2e con datos reales verde.
- [ ] ≥4 casos límite cubiertos.
- [ ] `npm test`, `npm run lint`, `npm run build` pasan.
- [ ] PR abierto + auto-merge habilitado.
EOF
  } > "$tmp/3"; ensure_issue "PetDesk v5 3 — QA stats e2e" "$tmp/3"

  rm -rf "$tmp"
  echo ""
  echo "Base: rama ${BASE_BRANCH}. Merge = autónomo (agente + CI). Dispatch #2/#3 = manual tras mergear #1."
  echo "Dispara Issue 1 (debe ir solo primero):"
  echo "  $0 --assign 1"
}

assign_one() {
  local n="$1" agent title id
  case "$n" in
    1) title="PetDesk v5 1"; agent="Dev Motor v2" ;;
    2) title="PetDesk v5 2"; agent="Dev Front v2" ;;
    3) title="PetDesk v5 3"; agent="QA v2" ;;
    *) echo "Issue inválido: $n (usa 1..3)"; exit 1 ;;
  esac
  id="$(issue_id_by_prefix "$title")"
  [ -z "$id" ] && { echo "No encuentro '$title'."; exit 1; }
  echo "Asignando '$title' ($id) -> $agent  (DISPARA tarea; merge autónomo vía auto-merge + CI)"
  multica issue assign "$id" --to "$agent" --output table
}

if [ "${1:-}" = "--assign" ]; then
  assign_one "${2:?usa: --assign N (1..3)}"
else
  create_all
fi
