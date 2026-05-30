#!/usr/bin/env bash
# Setup de PetDesk v2 en Multica.
#
# Diferencias vs v1:
# - 4 issues (no 6): el scaffold + CI viven en el template del repo.
# - Cost routing: Dev Front v2 corre sobre DeepSeek V3.2 (~4× más barato).
# - Issues referencian CONSTITUTION.md (reglas duras) y tests/contracts/ (spec ejecutable).
# - Cada issue exige cumplir la checklist embebida antes de PR.
#
# Fase 1 (por defecto):  crea 4 agentes v2 + 4 issues SIN asignar.
# Fase 2 (--assign N):   asigna el issue N a su agente -> dispara la tarea.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Runtime de OpenCode (= Provider OpenCode).
RT="${RT:-21a83fcc-8fbe-4134-82e2-90350e1ce387}"

REPO_OWNER="rubenaros"
REPO_NAME="petdesk-v2"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"

# ---------- helpers ----------
json_id() { python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))"; }
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

# ---------- instrucciones base ----------
# Cada agente recibe el rol; CONSTITUTION.md vive EN EL REPO (el agente lo lee al arrancar).
read -r -d '' BASE <<'EOF' || true
Eres un ingeniero de software senior en el proyecto PetDesk v2.
ANTES de empezar CUALQUIER tarea: lee `CONSTITUTION.md` en el root del repo. Es ley.

Resumen (la versión completa está en CONSTITUTION.md):
- Pensar antes de codear: declara supuestos, no elijas en silencio.
- Simplicidad: el mínimo código que resuelve. Nada especulativo.
- Cambios quirúrgicos: cada línea trazable al pedido.
- Tests/build verdes antes de PR (`npm test && npm run lint && npm run build`).
- NO toques `src/domain/`, `tests/contracts/`, `CONSTITUTION.md`, `.github/`.
- NO uses create-next-app ni reinicialices git.
- Solo modificas archivos listados en TU issue.
- Entregas como PR a `main` (instrucciones en el body del issue).
EOF

ensure_agent() { # name model addendum
  local name="$1"
  local model="$2"
  local add="$3"
  local id
  id="$(agent_id_by_name "$name")"
  if [ -n "$id" ]; then echo "= agente '$name' ya existe ($id)"; return; fi
  if [ -n "$model" ]; then
    id="$(multica agent create --runtime-id "$RT" --visibility workspace \
          --name "$name" --model "$model" --instructions "$BASE

$add" --output json | json_id)"
  else
    id="$(multica agent create --runtime-id "$RT" --visibility workspace \
          --name "$name" --instructions "$BASE

$add" --output json | json_id)"
  fi
  echo "+ agente '$name' creado ($id)${model:+ [model=$model]}"
}

ensure_issue() { # "title" /path/body
  local title="$1" file="$2" id
  id="$(issue_id_by_prefix "$title")"
  if [ -n "$id" ]; then echo "= issue '$title' ya existe ($id)"; return; fi
  id="$(multica issue create --title "$title" --description-file "$file" --output json | json_id)"
  echo "+ issue '$title' creado ($id)"
}

# Cabecera común que se antepone a cada issue
issue_header() { cat <<EOF
Trabajas en el repo \`${REPO_NAME}\` (el workdir ya lo trae clonado).

ANTES DE EMPEZAR (orden obligatorio):
1. Lee \`CONSTITUTION.md\` en el root — reglas duras.
2. Lee \`docs/PLAN.md\` — arquitectura completa + tu issue en contexto.
3. Lee \`tests/contracts/\` relevante — es la spec ejecutable. Tu impl debe pasarla.

ENTREGA (obligatoria) — antes de abrir PR verifica que pasen: \`npm test\`, \`npm run lint\`, \`npm run build\`.
  git checkout -b feat/petdesk-v2-N
  git add -A && git commit -m "<mensaje claro>"
  git push ${REPO_URL} HEAD:feat/petdesk-v2-N
  gh pr create --repo ${REPO_OWNER}/${REPO_NAME} --base main --head feat/petdesk-v2-N \\
    --title "PetDesk v2 N — <título>" \\
    --body "<resumen + checklist marcada del PLAN.md>"

EOF
}

create_all() {
  echo "== Creando agentes v2 (cost routing: Dev Front -> DeepSeek) =="
  ensure_agent "Dev Motor v2" "" \
    "ROL: Backend. Implementas SchedulerPort en src/engine/scheduler.ts. Tu test en tests/engine.test.ts importa schedulerPortContract y lo pasa a tu Scheduler — debe pasar."
  ensure_agent "Dev Chat v2" "" \
    "ROL: Lógica de aplicación. Implementas src/receptionist/{intents.ts,brain.ts} + src/infra/inAppNotifier.ts. Codeas contra la INTERFAZ SchedulerPort (no la implementación de Dev Motor). Tu test importa notificationPortContract sobre tu InAppNotifier — debe pasar."
  ensure_agent "Dev Front v2" "openrouter/deepseek/deepseek-v3.2" \
    "ROL: Frontend. Construyes la UI Next en src/app/** integrando engine+receptionist vía API routes. Diseño simple."
  ensure_agent "QA v2" "" \
    "ROL: QA. SOLO modificas tests/. Escribes tests rigurosos y casos límite + tests/backfill.e2e.test.ts. Reportas bugs encontrados como comentario del issue del agente responsable; arreglas SOLO si el fix es trivial Y declaras por qué."

  echo "== Creando issues v2 (sin asignar) =="
  local tmp; tmp="$(mktemp -d)"

  { issue_header; cat <<'EOF'
**Issue 1 — Motor de agenda** [P con Issue 2]

Implementa `src/engine/scheduler.ts` (clase Scheduler que implementa SchedulerPort). Recibe Repository y Clock por constructor.

Reglas (resumen — detalles en tests/contracts/SchedulerPort.contract.ts):
- book(): lanza si solapa una cita 'booked'. Crea ReminderJob 24h antes.
- reschedule(): valida no-solape; reagenda ReminderJob.
- cancel(): marca 'cancelled'; devuelve { freed, candidates } (FIFO por createdAt, mismo servicio, ventana contiene el slot).
- getAvailability(): slots libres 9:00–18:00, paso=durationMin.
- dueReminders(now): no enviados con dueAt<=now.

Test del agente en `tests/engine.test.ts`:
```ts
import { Scheduler } from '../src/engine/scheduler';
import { InMemoryRepo } from '../src/infra/memoryRepo';
import { SystemClock } from '../src/infra/systemClock';
import { schedulerPortContract } from './contracts/SchedulerPort.contract';
schedulerPortContract(() => {
  const repo = new InMemoryRepo();
  return { scheduler: new Scheduler(repo, new SystemClock()), repo, clock: new SystemClock() };
});
```

CHECKLIST (marcar en el body del PR):
- [ ] Leí CONSTITUTION.md y respeté las reglas duras.
- [ ] Solo modifiqué `src/engine/scheduler.ts` y `tests/engine.test.ts`.
- [ ] NO toqué `src/domain/**`, `tests/contracts/**`, `CONSTITUTION.md`.
- [ ] `npm test` pasa (incluido schedulerPortContract sobre mi Scheduler).
- [ ] `npm run lint` pasa (0 errores).
- [ ] `npm run build` compila.
- [ ] PR abierto con `gh pr create` apuntando a main.
EOF
  } > "$tmp/1"; ensure_issue "PetDesk v2 1 — Motor de agenda" "$tmp/1"

  { issue_header; cat <<'EOF'
**Issue 2 — Cerebro recepcionista** [P con Issue 1]

Implementa:
- `src/receptionist/intents.ts`: `parseIntent(text)` -> {type: 'book'|'reschedule'|'cancel'|'info'|'unknown', entities}. Por keywords (NO LLM).
- `src/receptionist/brain.ts`: `handleMessage({text, clientId, scheduler, notifier, clock})`:
  - book -> reply + Notification 'confirmation' + Notification 'upsell'.
  - cancel -> tras cancelar, Notification 'backfill_offer' al PRIMER candidato FIFO.
  - info -> reply con precio/horario.
  - devuelve {reply}; notificaciones quedan en el notifier.
- `src/infra/inAppNotifier.ts`: implementa NotificationPort en memoria.

Tests del agente:
- `tests/notifier.test.ts`: importa `notificationPortContract` y la pasa a tu `InAppNotifier`.
- `tests/brain.test.ts`: con fake SchedulerPort, verifica:
  - "agendar baño" -> book + reply + upsell.
  - cancelar con waitlist -> backfill_offer al primer candidato FIFO.
  - intent desconocido -> fallback sin crash.

CODEAS CONTRA LA INTERFAZ SchedulerPort (no la impl de Dev Motor).

CHECKLIST (marcar en el body del PR):
- [ ] Leí CONSTITUTION.md y respeté las reglas duras.
- [ ] Solo modifiqué `src/receptionist/**`, `src/infra/inAppNotifier.ts`, `tests/notifier.test.ts`, `tests/brain.test.ts`.
- [ ] NO toqué `src/engine/`, `src/domain/**`, `tests/contracts/**`.
- [ ] `npm test` pasa (notificationPortContract sobre InAppNotifier, brain tests).
- [ ] `npm run lint` y `npm run build` pasan.
- [ ] PR abierto.
EOF
  } > "$tmp/2"; ensure_issue "PetDesk v2 2 — Cerebro recepcionista" "$tmp/2"

  { issue_header; cat <<'EOF'
**Issue 3 — Frontend (landing + chat + dashboard + APIs)** [P con Issue 4, tras 1+2]

Construye con Tailwind en `src/app/`:
1. `app/page.tsx` — landing PetDesk: hero, 3 beneficios (agenda 24/7, recordatorios, backfill), CTA. Estática.
2. `app/chat/page.tsx` — chat de reservas cliente.
3. `app/dashboard/page.tsx` — panel groomer: citas del día, waitlist, feed de notificaciones, botón "Cancelar" por cita (dispara backfill), control "Avanzar tiempo".
4. `app/api/message/route.ts` — POST {text,clientId} -> instancia scheduler+brain+InAppNotifier -> {reply}.
5. `app/api/appointments/route.ts`, `.../cancel/route.ts`, `.../notifications/route.ts`.

Usa las clases reales (engine + brain + notifier ya en main). Diseño simple, sin sobreingeniería.

CHECKLIST (marcar en el body del PR):
- [ ] Leí CONSTITUTION.md.
- [ ] Solo modifiqué `src/app/**`.
- [ ] NO toqué engine, receptionist, domain, contracts ni infra fuera de uso.
- [ ] `npm run dev`: landing carga, /chat responde, /dashboard cancela y muestra oferta de backfill en el feed.
- [ ] `npm test`, `npm run lint`, `npm run build` pasan.
- [ ] PR abierto.
EOF
  } > "$tmp/3"; ensure_issue "PetDesk v2 3 — Frontend" "$tmp/3"

  { issue_header; cat <<'EOF'
**Issue 4 — QA + e2e backfill** [P con Issue 3, tras 1+2]

Solo modificas `tests/`.

1. Casos límite adicionales:
   - en `tests/engine.test.ts` (o un nuevo `tests/engine.edge.test.ts`): doble-booking, cancelar sin waitlist (candidates vacío), reagendar a slot ocupado, ventana de waitlist que NO matchea.
   - en `tests/brain.test.ts`: intent ambiguo, cancel de cita inexistente, upsell cuando service.upsells vacío.
2. `tests/backfill.e2e.test.ts`: escenario completo usando clases reales (Scheduler + brain + InAppNotifier + InMemoryRepo):
   - Cliente A agendado; B y C en waitlist (B primero FIFO).
   - A cancela -> el notifier emite 'backfill_offer' para B (no C).
   - B acepta (book sobre el slot liberado) -> queda 'booked' por B.

Si encuentras un bug del Dev Motor o Dev Chat: déjalo en un comentario de SU issue (con repro) y arregla SOLO si el fix es trivial (declarándolo).

CHECKLIST (marcar en el body del PR):
- [ ] Leí CONSTITUTION.md.
- [ ] SOLO modifiqué `tests/`.
- [ ] e2e de backfill end-to-end (A → B accept) verde.
- [ ] ≥3 casos límite agregados.
- [ ] `npm test`, `npm run lint`, `npm run build` pasan.
- [ ] PR abierto.
EOF
  } > "$tmp/4"; ensure_issue "PetDesk v2 4 — QA y e2e backfill" "$tmp/4"

  rm -rf "$tmp"
  echo ""
  echo "Listo. Dispara la ola 1 (Issues 1 y 2 en paralelo):"
  echo "  $0 --assign 1 && $0 --assign 2"
}

assign_one() { # N
  local n="$1" agent title id
  case "$n" in
    1) title="PetDesk v2 1"; agent="Dev Motor v2" ;;
    2) title="PetDesk v2 2"; agent="Dev Chat v2" ;;
    3) title="PetDesk v2 3"; agent="Dev Front v2" ;;
    4) title="PetDesk v2 4"; agent="QA v2" ;;
    *) echo "Issue inválido: $n (usa 1..4)"; exit 1 ;;
  esac
  id="$(issue_id_by_prefix "$title")"
  [ -z "$id" ] && { echo "No encuentro '$title'. ¿Corriste la fase 1?"; exit 1; }
  echo "Asignando '$title' ($id) -> $agent  (DISPARA la tarea)"
  multica issue assign "$id" --to "$agent" --output table
}

if [ "${1:-}" = "--assign" ]; then
  assign_one "${2:?usa: --assign N (1..4)}"
else
  create_all
fi
