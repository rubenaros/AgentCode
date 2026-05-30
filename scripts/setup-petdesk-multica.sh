#!/usr/bin/env bash
# Setup de PetDesk en Multica (Opción A — todo por CLI).
#
# Fase 1 (por defecto):  crea 5 agentes Kimi (runtime OpenCode) + 6 issues SIN asignar.
# Fase 2 (--assign N):   asigna el issue número N a su agente -> dispara la tarea.
#
# Orden recomendado: corre sin args; agrega el repo en la UI (Settings > Repositories);
# luego `--assign 0`; cuando el PR del 0 se mergee, `--assign 1`, `--assign 2`, etc.
#
# Idempotente: no recrea agentes/issues que ya existan (match por nombre/título).
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Runtime de OpenCode (= Provider OpenCode). Override con RT=... si cambia.
RT="${RT:-21a83fcc-8fbe-4134-82e2-90350e1ce387}"

# ---------- helpers JSON ----------
# Extrae .id del JSON de salida de un create
json_id() { python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))"; }
# Lista [{id,name|title}] tolerando envoltorios {items|agents|issues|data:[...]}
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

# ---------- instrucciones base (Karpathy, comunes a todos) ----------
read -r -d '' BASE <<'EOF' || true
Eres un ingeniero de software senior. Sigues estas reglas (adaptadas de las guidelines de Karpathy) en CADA tarea:

# 1. Pensar antes de codear
- Declara tus supuestos de forma explícita al inicio.
- Si hay varias interpretaciones, NO elijas en silencio: descríbelas y elige la más razonable justificándola.
- Si existe un enfoque más simple, dilo.

# 2. Simplicidad primero
- El mínimo código que resuelve el problema. Nada especulativo.
- Sin features no pedidas, sin abstracciones para código de un solo uso, sin "flexibilidad" no solicitada, sin manejo de errores para escenarios imposibles.
- Si escribiste 200 líneas y caben en 50, reescríbelo.

# 3. Cambios quirúrgicos
- Toca solo lo necesario. Cada línea cambiada debe rastrearse directamente al pedido.
- No "mejores" código adyacente, ni refactorices lo que no está roto, ni cambies estilo/formato ajenos.
- Elimina solo los imports/variables que TUS cambios dejaron huérfanos. Código muerto preexistente: MENCIÓNALO, no lo borres.

# 4. Ejecución dirigida por objetivos
- Convierte la tarea en un criterio de éxito verificable antes de empezar.
- Para multi-paso, declara un plan breve: paso -> cómo se verifica.
- Itera hasta cumplir el criterio. Ejecuta tests/build cuando apliquen.

# Cómo manejar dudas (IMPORTANTE — corres SIN humano en vivo)
- NO puedes pausar y esperar respuesta a mitad de tarea.
- Ambigüedad de BAJO riesgo: elige lo razonable, DECLARA el supuesto y avanza.
- Solo ante decisiones de ALTO riesgo o IRREVERSIBLES: NO adivines. Deja la pregunta concreta + opciones como resultado final.
EOF

ensure_agent() { # name  addendum
  local name="$1" add="$2" id
  id="$(agent_id_by_name "$name")"
  if [ -n "$id" ]; then echo "= agente '$name' ya existe ($id)"; return; fi
  id="$(multica agent create --runtime-id "$RT" --visibility workspace \
        --name "$name" --instructions "$BASE

$add" --output json | json_id)"
  echo "+ agente '$name' creado ($id)"
}

ensure_issue() { # "title"  /path/body
  local title="$1" file="$2" id
  id="$(issue_id_by_prefix "$title")"
  if [ -n "$id" ]; then echo "= issue '$title' ya existe ($id)"; return; fi
  id="$(multica issue create --title "$title" --description-file "$file" --output json | json_id)"
  echo "+ issue '$title' creado ($id)"
}

# Cabecera común que se antepone a cada issue
issue_header() { cat <<'EOF'
Trabajas en el repo `petdesk` (el workdir ya lo trae clonado con el esqueleto: dirs src/*, README.md y docs/PLAN.md).
LEE PRIMERO `docs/PLAN.md` — ahí está la arquitectura completa, los contratos y el layout. No borres docs/PLAN.md ni reorganices el layout.

EOF
}

create_all() {
  echo "== Creando agentes (runtime OpenCode -> Kimi K2.6 por defecto) =="
  ensure_agent "Orquestador" "ROL: Arquitecto/Orquestador. Defines estructura, tipos e interfaces; NO implementas lógica de negocio. Los contratos en src/domain son estables: otros dependen de ellos. El repo YA trae esqueleto + docs/PLAN.md: scaffolea Next.js ENCIMA sin borrarlo."
  ensure_agent "Dev Motor"   "ROL: Backend. Implementas lógica de dominio pura + sus tests, contra las interfaces de src/domain. NO toques UI ni el cerebro del chat."
  ensure_agent "Dev Chat"    "ROL: Lógica de aplicación. Implementas el cerebro del chat contra la INTERFAZ SchedulerPort (no la implementación de otro agente). NO toques el motor ni la UI."
  ensure_agent "Dev Front"   "ROL: Frontend. Construyes la UI Next.js integrando engine+receptionist vía API routes. Diseño simple, sin sobreingeniería."
  ensure_agent "QA"          "ROL: QA. Escribes tests rigurosos y buscas casos límite. Reportas bugs como comentario del issue; arreglas solo si el fix es trivial."

  echo "== Creando issues (sin asignar) =="
  local tmp; tmp="$(mktemp -d)"

  { issue_header; cat <<'EOF'
Crea el scaffold del proyecto PetDesk y los contratos compartidos.

1. Inicializa Next.js (App Router) + TypeScript + Tailwind + Vitest. Scripts npm: dev, build, test, lint.
2. src/domain/types.ts: Service, Client, Appointment, WaitlistEntry, ReminderJob, Notification, Slot (campos en docs/PLAN.md).
3. src/domain/ports.ts: interfaces SchedulerPort, Repository (CRUD clients/services/appointments/waitlist/reminders/notifications), NotificationPort (notify+list), Clock (now()).
4. src/infra/memoryRepo.ts (InMemoryRepo con datos sembrados: 3 servicios grooming, 2 clientes, 1 cita futura, 2 waitlist) y src/infra/systemClock.ts.
5. NO implementes motor, cerebro ni UI. Solo tipos, interfaces y repo en memoria.

Criterio de éxito:
- `npm run build` compila sin errores TS.
- `npm test` corre sin fallar la config.
- Interfaces exportadas desde src/domain/ports.ts.
- Test mínimo: InMemoryRepo siembra 3 servicios.
EOF
  } > "$tmp/0"; ensure_issue "PetDesk 0 — Scaffold + contratos" "$tmp/0"

  { issue_header; cat <<'EOF'
Depende de: Issue 0 (mergeado). Implementa el motor en src/engine/scheduler.ts (implementa SchedulerPort). Recibe Repository y Clock por constructor.

Reglas:
- book(): lanza si [start, start+durationMin) solapa una cita 'booked'. Crea ReminderJob 24h antes.
- reschedule(): valida no-solape; reagenda el ReminderJob.
- cancel(): marca 'cancelled', libera slot, devuelve { freed, candidates } (WaitlistEntry del mismo servicio cuya ventana contiene el slot, FIFO por createdAt).
- getAvailability(): slots libres 9:00–18:00, paso = durationMin.
- dueReminders(now): ReminderJobs con dueAt<=now y sent=false.
NO toques UI ni cerebro.

Criterio de éxito (tests en tests/engine.test.ts, verdes):
- book libre crea cita; book solapado lanza.
- cancel devuelve candidatos FIFO correctos y solo del servicio/ventana que matchea.
- dueReminders respeta el Clock inyectado (fecha fija).
EOF
  } > "$tmp/1"; ensure_issue "PetDesk 1 — Motor de agenda" "$tmp/1"

  { issue_header; cat <<'EOF'
Depende de: Issue 0. Implementa el cerebro en src/receptionist/ (intents.ts + brain.ts) y src/infra/inAppNotifier.ts. Usa SchedulerPort como INTERFAZ (no la implementación de otro agente).

intents.ts: parseIntent(text) -> {type:'book'|'reschedule'|'cancel'|'info'|'unknown', entities}. Por reglas/keywords (SIN LLM externo).
brain.ts: handleMessage({text, clientId, scheduler, notifier, clock}):
- book -> reply de confirmación + Notification 'confirmation' + Notification 'upsell' (service.upsells).
- cancel -> tras cancelar, Notification 'backfill_offer' al PRIMER candidato FIFO.
- info -> reply con precio/horario.
- devuelve {reply}; deja notificaciones en el notifier.
InAppNotifier implementa NotificationPort en memoria.
NO toques el motor (úsalo por interfaz) ni la UI.

Criterio de éxito (tests en tests/brain.test.ts con fake de SchedulerPort, verdes):
- "agendar baño" -> book + reply + upsell.
- cancelar con waitlist -> backfill_offer al primer candidato FIFO.
- intent desconocido -> fallback sin crash.
EOF
  } > "$tmp/2"; ensure_issue "PetDesk 2 — Cerebro del chat" "$tmp/2"

  { issue_header; cat <<'EOF'
Depende de: Issue 0 (integra 1 y 2 vía API routes). Construye la UI en src/app/ con Tailwind:

1. app/page.tsx — landing "PetDesk para Pet Grooming": hero, 3 beneficios (agenda 24/7, recordatorios, backfill), CTA. Estática.
2. app/chat/page.tsx — chat de reservas cara al cliente.
3. app/dashboard/page.tsx — panel groomer: citas del día, waitlist, FEED de notificaciones, botón "Cancelar" por cita (dispara backfill), y control "Avanzar tiempo" (Clock manual -> dueReminders al feed).
4. app/api/message/route.ts — POST {text,clientId} -> instancia scheduler(InMemoryRepo)+brain+InAppNotifier -> {reply}.
5. app/api/appointments + .../cancel + .../notifications para el dashboard.
Usa las clases reales (no mocks). Diseño simple.

Criterio de éxito:
- `npm run build` compila.
- En dev: landing carga; /chat "agendar baño" devuelve confirmación; /dashboard cancelar cita con waitlist muestra la oferta de backfill en el feed.
EOF
  } > "$tmp/3"; ensure_issue "PetDesk 3 — Frontend (landing/chat/dashboard)" "$tmp/3"

  { issue_header; cat <<'EOF'
Depende de: Issues 1 y 2. Refuerza cobertura y agrega el test estrella del backfill.

1. Casos límite en engine/brain: doble-booking, cancelar sin waitlist (candidates vacío), reagendar a slot ocupado, ventana de waitlist que NO matchea.
2. tests/backfill.e2e.test.ts: A agendado; B y C en waitlist (B primero); A cancela -> notifier emite 'backfill_offer' para B (no C); B acepta -> slot 'booked' por B.
3. Todos los tests verdes con `npm test`. Si hay bug en engine/brain: repórtalo en comentario del issue y arréglalo solo si es trivial.

Criterio de éxito: e2e de backfill verde + los 4 casos límite cubiertos.
EOF
  } > "$tmp/4"; ensure_issue "PetDesk 4 — QA y e2e backfill" "$tmp/4"

  { issue_header; cat <<'EOF'
Depende de: Issue 0. Configura el despliegue continuo.

1. .github/workflows/ci.yml: en push/PR corre `npm ci`, `npm run lint`, `npm test`, `npm run build`. Debe quedar verde.
2. Prepara para Vercel (Next.js se autodetecta; vercel.json solo si hace falta). Documenta en README cómo conectar el repo a Vercel (auto-deploy en push a main).
3. README: qué es, cómo correr local, y la nota de datos en memoria (se resetean en cold start); DB y notificaciones email/SMS = fases posteriores.

Criterio de éxito: workflow CI válido y verde + README claro.
EOF
  } > "$tmp/5"; ensure_issue "PetDesk 5 — Deploy (CI + Vercel)" "$tmp/5"

  rm -rf "$tmp"
  echo ""
  echo "Listo. Agrega el repo en Settings > Repositories:  https://github.com/rubenaros/petdesk.git"
  echo "Luego dispara el primero:  $0 --assign 0"
}

assign_one() { # N
  local n="$1" agent title id
  case "$n" in
    0) title="PetDesk 0"; agent="Orquestador" ;;
    1) title="PetDesk 1"; agent="Dev Motor" ;;
    2) title="PetDesk 2"; agent="Dev Chat" ;;
    3) title="PetDesk 3"; agent="Dev Front" ;;
    4) title="PetDesk 4"; agent="QA" ;;
    5) title="PetDesk 5"; agent="Orquestador" ;;
    *) echo "Issue inválido: $n (usa 0..5)"; exit 1 ;;
  esac
  id="$(issue_id_by_prefix "$title")"
  [ -z "$id" ] && { echo "No encuentro el issue '$title'. ¿Corriste la fase 1?"; exit 1; }
  echo "Asignando '$title' ($id) -> $agent  (esto DISPARA la tarea)"
  multica issue assign "$id" --to "$agent" --output table
}

# ---------- entry ----------
if [ "${1:-}" = "--assign" ]; then
  assign_one "${2:?usa: --assign N (0..5)}"
else
  create_all
fi
