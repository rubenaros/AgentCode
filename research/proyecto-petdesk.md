# Proyecto PetDesk — MVP recepcionista IA (showcase multiagente)

**Fecha:** 2026-05-26
**Nombre de trabajo:** PetDesk (placeholder — renombrable; el motor es genérico "AI receptionist para negocios de cita previa", pet grooming es la beachhead).
**Origen:** idea #5 (AI receptionist para groomers). Núcleo defendible = **backfill de cancelaciones**.

## Decisiones de arquitectura (fijadas por el arquitecto)

- **MVP sin SMS.** El recepcionista es un **chat web** (widget de reservas en el sitio del negocio). Cliente agenda/reprograma/cancela por chat; el groomer ve todo en un dashboard. Nada de Twilio, números, A2P ni costos de telefonía.
- **Backfill sin SMS:** cuando una cancelación libera un hueco, el sistema busca candidatos de la lista de espera y genera una **oferta** que aparece en un **feed de notificaciones in-app** del dashboard ("Oferta enviada a B por el slot de las 15:00"). Eso representa lo que en el futuro sería email/SMS/push, pero en el MVP es in-app y 100% visible/testeable.
- **Stack:** Next.js (App Router) + TypeScript + Tailwind. Tests con **Vitest**. Deploy **Vercel + auto-deploy desde GitHub**.
- **Persistencia MVP:** `InMemoryRepo` (singleton de módulo, sembrado al iniciar). En Vercel un cold-start resetea datos → aceptable para demo guiada. Swap futuro a Upstash/Neon detrás de la interfaz `Repository`.
- **NLU MVP:** parser de intención **por reglas/keywords** (no LLM externo) → determinista y testeable. Upgrade a LLM = fase posterior.
- **Costuras para no acoplar (clave del diseño):**
  - `NotificationPort` — salida de avisos. `InAppNotifier` (feed) ahora; email/SMS/push después, sin tocar la lógica.
  - `Repository` — persistencia. `InMemoryRepo` ahora; DB después.
  - `SchedulerPort` — interfaz del motor. Permite que Dev2 (cerebro) codee contra la interfaz sin esperar a Dev1 (implementación) → **paralelismo real**.
  - `Clock` — `now()` inyectable → tests deterministas y "avanzar tiempo" para recordatorios en la demo.

## Layout de archivos (disjunto por issue → cero conflictos de merge)

```
src/
  domain/         # Issue 0 — tipos + interfaces (puertos)
    types.ts
    ports.ts      # NotificationPort, Repository, SchedulerPort, Clock
  engine/         # Issue 1 (Dev1) — implementa SchedulerPort
    scheduler.ts
  receptionist/   # Issue 2 (Dev2) — cerebro del chat
    intents.ts
    brain.ts
  infra/          # Issue 0 (repo/clock) + Issue 2 (notifier)
    memoryRepo.ts
    systemClock.ts
    inAppNotifier.ts
  app/            # Issue 3 (Dev3) — Next.js
    page.tsx              # landing pet grooming
    dashboard/page.tsx    # panel del groomer (citas + waitlist + feed de notificaciones)
    chat/page.tsx         # widget de chat de reservas (cara al cliente)
    api/.../route.ts      # wiring
tests/            # Issue 4 (QA)
.github/workflows/ci.yml  # Issue 5 (Deploy)
```

## Modelo de dominio (contrato — Issue 0 lo materializa)

- `Service { id, name, durationMin, priceCents, upsells: string[] }`
- `Client { id, name, phone }`
- `Appointment { id, clientId, serviceId, start: ISO, end: ISO, status: 'booked'|'cancelled'|'completed' }`
- `WaitlistEntry { id, clientId, serviceId, windowStart: ISO, windowEnd: ISO, createdAt: ISO }`
- `ReminderJob { id, appointmentId, dueAt: ISO, sent: boolean }`
- `Notification { id, clientId, kind: 'confirmation'|'upsell'|'backfill_offer'|'reminder', body, createdAt: ISO }`

## SchedulerPort (interfaz — Dev1 implementa, Dev2 consume)

```ts
interface SchedulerPort {
  getAvailability(serviceId: string, from: Date, to: Date): Slot[];
  book(clientId: string, serviceId: string, start: Date): Appointment;      // lanza si solapa
  reschedule(appointmentId: string, newStart: Date): Appointment;
  cancel(appointmentId: string): { freed: Slot; candidates: WaitlistEntry[] }; // FIFO que matchea servicio+ventana
  dueReminders(now: Date): ReminderJob[];
}
```

El **backfill** vive aquí: `cancel()` libera el slot y devuelve los `WaitlistEntry` ordenados por `createdAt` (FIFO) cuyo servicio coincide y cuya ventana `[windowStart, windowEnd]` contiene el slot liberado. El cerebro (Dev2) toma esos candidatos y emite una `Notification` de `backfill_offer` al primero vía `NotificationPort`.

---

# ISSUES PARA MULTICA (copiar/pegar y asignar)

> Orden: **Issue 0 primero y se mergea** (crea estructura + contratos). Luego 1, 2, 3 en **paralelo**. 4 (QA) tras 1 y 2. 5 (Deploy) puede ir tras 0.
> Cada issue trae criterio de éxito verificable (estilo Karpathy). Los devs codean contra **interfaces**, no contra implementaciones de otros.

## Issue 0 — [Arquitecto] Scaffold + contratos
**Asignar a:** agente Orquestador/Arquitecto (Sonnet o Kimi)
**Depende de:** nada (va primero, se mergea antes que el resto)

```
Crea el scaffold del proyecto PetDesk y los contratos compartidos.

1. Inicializa Next.js (App Router) + TypeScript + Tailwind + Vitest. Scripts npm: dev, build, test, lint.
2. Crea src/domain/types.ts con: Service, Client, Appointment, WaitlistEntry, ReminderJob, Notification, Slot (usa los campos del PLAN).
3. Crea src/domain/ports.ts con las interfaces: SchedulerPort, Repository (CRUD de clients/services/appointments/waitlist/reminders/notifications), NotificationPort (notify(n: Notification) + list()), Clock (now()).
4. Crea src/infra/memoryRepo.ts (InMemoryRepo implementa Repository, con datos sembrados: 3 servicios pet-grooming, 2 clientes, 1 cita futura, 2 entradas de waitlist) y src/infra/systemClock.ts.
5. NO implementes el motor ni el cerebro ni la UI — solo tipos, interfaces y repo en memoria.

Criterio de éxito:
- `npm run build` compila sin errores de TypeScript.
- `npm test` corre (aunque haya 0 tests) sin fallar la config.
- Exporta todas las interfaces desde src/domain/ports.ts.
- InMemoryRepo siembra datos al construirse (verificable con un test mínimo de "repo tiene 3 servicios").
```

## Issue 1 — [Dev1] Motor de agenda (SchedulerPort)
**Asignar a:** Kimi Dev
**Depende de:** Issue 0 (mergeado)

```
Implementa el motor de agenda en src/engine/scheduler.ts. Implementa la interfaz SchedulerPort de src/domain/ports.ts. Recibe un Repository y un Clock por constructor (inyección).

Reglas:
- book(): rechaza (lanza Error) si el rango [start, start+durationMin) solapa una cita 'booked' existente. Crea ReminderJob para 24h antes del start.
- reschedule(): mueve la cita validando no-solape; reagenda el ReminderJob.
- cancel(): marca 'cancelled', libera el slot y devuelve { freed, candidates } donde candidates = WaitlistEntry del mismo serviceId cuya ventana contiene el slot, ordenados FIFO por createdAt.
- getAvailability(): slots libres del servicio en el rango (asume horario 9:00–18:00, paso = durationMin).
- dueReminders(now): ReminderJobs con dueAt <= now y sent=false.

NO toques la UI ni el cerebro. Solo el motor.

Criterio de éxito (escribe estos tests en tests/engine.test.ts y hazlos pasar):
- book en slot libre crea cita; book solapado lanza error.
- cancel devuelve candidatos en orden FIFO correcto y solo del servicio/ventana que matchea.
- dueReminders respeta el Clock inyectado (test con fecha fija).
- `npm test` verde.
```

## Issue 2 — [Dev2] Cerebro del chat + backfill + upsell
**Asignar a:** Kimi Dev (2º agente, o el mismo en otra tarea)
**Depende de:** Issue 0 (usa SchedulerPort como INTERFAZ, no la implementación de Dev1)

```
Implementa el cerebro del chat en src/receptionist/ (intents.ts + brain.ts) y el notifier in-app en src/infra/inAppNotifier.ts.

intents.ts: parseIntent(text) -> { type: 'book'|'reschedule'|'cancel'|'info'|'unknown', entities }. Parser por reglas/keywords (NO LLM externo): "agendar/reservar", "cambiar/reprogramar", "cancelar", "precio/horario/info".

brain.ts: handleMessage({ text, clientId, scheduler, notifier, clock }) que:
- Interpreta la intención y llama al SchedulerPort.
- book -> responde confirmación en el chat y emite Notification 'confirmation'; luego OFRECE UPSELL (service.upsells: ej. corte de uñas, limpieza dental) como Notification 'upsell'.
- cancel -> tras cancelar, toma los candidates del backfill y emite Notification 'backfill_offer' dirigida al PRIMERO de la lista vía NotificationPort.
- info -> responde precio/horario en el chat.
- Devuelve { reply: string } (lo que ve el cliente en el chat) y deja las notificaciones en el notifier.

InAppNotifier implementa NotificationPort guardando las Notification en memoria (para que el dashboard las muestre en su feed).

NO toques el motor (úsalo por la interfaz) ni la UI de Next.

Criterio de éxito (tests en tests/brain.test.ts, usando un fake de SchedulerPort):
- "quiero agendar baño el viernes" -> book + reply de confirmación + Notification de upsell emitida.
- al cancelar una cita con waitlist, el notifier recibe un 'backfill_offer' dirigido al primer candidato FIFO.
- intent desconocido -> reply de fallback (no crashea).
- `npm test` verde.
```

## Issue 3 — [Dev3] Frontend: landing + chat de reservas + dashboard
**Asignar a:** Kimi Dev o un agente DeepSeek (Custom Args --model openrouter/deepseek/deepseek-chat)
**Depende de:** Issue 0 (integra 1 y 2 vía API routes)

```
Construye la UI en src/app/ con Tailwind:

1. app/page.tsx — landing de "PetDesk para Pet Grooming": hero, 3 beneficios (agenda 24/7, recordatorios, backfill de cancelaciones), CTA. Estática.
2. app/chat/page.tsx — widget de chat de reservas (cara al cliente): caja de chat donde el cliente escribe en lenguaje natural; muestra las respuestas del recepcionista.
3. app/dashboard/page.tsx — panel del groomer: citas del día, lista de espera, FEED DE NOTIFICACIONES (confirmaciones, upsells, ofertas de backfill), y un botón "Cancelar" por cita que dispara el backfill. Incluye un control "Avanzar tiempo" que dispara dueReminders (Clock manual) y muestra los recordatorios en el feed.
4. app/api/message/route.ts — POST {text, clientId}: instancia scheduler(InMemoryRepo)+brain+InAppNotifier y devuelve { reply }.
5. app/api/appointments/route.ts y .../cancel y .../notifications — para el dashboard (listar citas, cancelar, leer el feed).

Usa las clases reales de engine/receptionist/infra (no mocks). Diseño limpio y simple, sin sobreingeniería.

Criterio de éxito:
- `npm run build` compila.
- En `npm run dev`: la landing carga; en /chat escribir "agendar baño" devuelve confirmación visible; en /dashboard cancelar una cita con waitlist hace aparecer la oferta de backfill en el feed.
```

## Issue 4 — [QA] Suite de tests + escenario backfill end-to-end
**Asignar a:** agente QA (Kimi o Claude)
**Depende de:** Issues 1 y 2

```
Refuerza la cobertura y agrega el test estrella del backfill.

1. Revisa tests/engine.test.ts y tests/brain.test.ts; agrega casos límite: doble-booking, cancelar cita sin waitlist (candidates vacío), reagendar a slot ocupado, ventana de waitlist que NO matchea.
2. tests/backfill.e2e.test.ts: escenario completo — cliente A agendado, clientes B y C en waitlist (B primero), A cancela -> el notifier emite 'backfill_offer' para B (no C), B acepta -> el slot queda 'booked' por B.
3. Asegura que TODOS los tests pasan con `npm test`. Si encuentras un bug en engine/brain, repórtalo en un comentario del issue Y arréglalo solo si el fix es trivial; si no, deja el test marcado como fallo documentado.

Criterio de éxito:
- `npm test` con el e2e de backfill verde.
- Cobertura de los 4 casos límite listados.
```

## Issue 5 — [Deploy] GitHub + Vercel + CI
**Asignar a:** cualquier agente (o manual)
**Depende de:** Issue 0

```
Configura el despliegue continuo.

1. .github/workflows/ci.yml: en cada push/PR corre `npm ci`, `npm run lint`, `npm test`, `npm run build`. Debe quedar verde.
2. Prepara el proyecto para Vercel (vercel.json si hace falta; Next.js se detecta solo). Documenta en README los pasos para conectar el repo a Vercel (auto-deploy en push a main).
3. README con: qué es, cómo correr local (`npm i && npm run dev`), y la nota de que el MVP usa datos en memoria (se resetean en cold start) y el swap a DB / notificaciones email-SMS es fase posterior.

Criterio de éxito:
- Workflow de CI presente y válido.
- README claro.
- (Manual) repo en GitHub + proyecto Vercel conectado -> URL pública desplegando en push.
```

## Fases posteriores (fuera de esta vuelta)
- `EmailNotifier`/`PushNotifier`/`SmsNotifier implements NotificationPort` (cuando haya negocio que lo pague — el SMS queda para cuando se justifique A2P/Twilio).
- `PostgresRepo/UpstashRepo implements Repository`.
- NLU con LLM real para el parser de intención (reemplaza el rule-based).
- Cron real para recordatorios (Vercel Cron) en vez del "Avanzar tiempo".
- Multi-vertical: landing pages por nicho (barberías, manicure, masajes) reusando el mismo motor.
