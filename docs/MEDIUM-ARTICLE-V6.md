# De 7 a 13 capas: qué cambia al completar el harness de un equipo de agentes

*Construí el mismo producto con dos versiones del mismo sistema: una con un harness parcial (v2) y otra con el harness completo (v6, con memoria persistente, planificación por máquina y entrega autónoma). No comparo costos absolutos —cada versión construyó una feature distinta—. Comparo el costo por feature, los retrabajos, el tiempo y, sobre todo, lo que cada harness entrega.*

![v2 vs v6: qué capas del harness tenía cada versión](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/architecture-v2-vs-v6.svg)

---

Un "harness" es toda la infraestructura que rodea al modelo para convertirlo en agente. La literatura lo descompone en unas trece capas, del modelo y el loop de control a la memoria, la planificación, la verificación y la entrega. El principio que se repite: el modelo razona, el harness actúa. En un análisis de Claude Code, el 1,6% del código es lógica del modelo y el 98,4% es harness.

Tenía dos versiones del mismo sistema de agentes sobre un tablero Kanban. Las dos usan los mismos modelos baratos vía OpenRouter. La diferencia está en cuántas capas de harness tiene cada una.

## El harness de cada versión

**v2** era un harness parcial. Cubría unas siete capas: el tablero (Multica) aportaba el workspace aislado, la cola, el despacho y el ciclo de vida; el ejecutor (opencode) aportaba el loop, las herramientas y el contexto de trabajo; y el arquitecto —una persona— aportaba los contratos y las reglas del proyecto. La descomposición de tareas la hacía el arquitecto a mano. La verificación eran contratos ejecutables más una revisión manual. El merge lo hacía una persona.

**v6** completa las capas que faltaban:

| Capa | v2 | v6 |
|---|---|---|
| Memoria persistente | ninguna | Engram (episódica/semántica) |
| Planificación / descomposición | manual (el arquitecto) | por máquina (flujo guiado por especificación) |
| Multi-agente | solo el tablero | sub-agentes del overlay |
| Verificación | contratos + revisión manual | CI como compuerta automática |
| Entrega | merge manual | auto-merge gateado por CI |

En números: v2 tenía alrededor de 7 capas; v6 tiene las 13. Lo que v6 sumó es memoria, planificación por máquina, sub-agentes, verificación automática y entrega autónoma.

## Lo que sí comparé (y lo que no)

Las dos versiones construyeron features distintas: v2 levantó el MVP completo; v6 agregó una feature de estadísticas sobre esa base. Por eso el costo absoluto no dice nada. Lo que sí se puede normalizar:

**Costo por feature.** En v2, el costo por unidad de trabajo era bajo y predecible. En v6, una feature completa con el flujo de especificación costó, en promedio, alrededor del doble por unidad, pero con una variación grande entre corridas: el mismo pedido idéntico osciló hasta 1,8 veces de una corrida a otra. La planificación por máquina no tiene un costo fijo; tiene un costo que cambia según cuánto decida deliberar el agente.

**Tiempo por feature.** Parejo, e incluso a favor de v6 cuando la feature se entrega en una sola tarea con especificación, en vez de partida en varias. Consolidar evita recargar el contexto del repositorio en cada subtarea.

**Retrabajos.** Acá aparece el matiz más útil. En las dos versiones, el código de los agentes salió limpio: pasó los tests, respetó el alcance, sin violaciones. La diferencia no estuvo en el código, sino en la operación. v2 fue tranquila: cuatro PRs limpios al primer intento, y las únicas intervenciones humanas fueron los merges. v6 tuvo más fricción operativa: un corte transitorio del proveedor que obligó a relanzar una corrida, y un detalle de configuración mío —resetear la rama base borró el commit que activaba el CI— que dejó un PR sin integrar. El harness más completo tiene más piezas, y más piezas significan más puntos de falla.

## Lo que el harness completo entrega de más

Más allá del costo, v6 deja cosas que v2 no producía:

- **Memoria que sobrevive.** Cada agente dejó registros estructurados de qué hizo y por qué. v2 perdía toda decisión al terminar la tarea.
- **Plan y especificación como artefacto.** v6 dejó documentos de exploración, propuesta, especificación, diseño y tareas en el repositorio. v2 no dejaba rastro del razonamiento detrás del código.
- **Entrega autónoma.** En v6, las tareas se integraron solas con el CI como única compuerta: cero merges manuales. En v2 los hacía todos una persona.

## Mi recomendación

Voy a ser directo, porque medí lo suficiente para tener una posición.

De todo lo que v6 agregó, **lo que claramente rinde son dos capas: la verificación con CI y la entrega autónoma.** Eliminan las intervenciones manuales de merge, son baratas de montar, y —dato importante— las aporta GitHub, no el overlay de método. Esas dos capas las sumaría a cualquier setup, incluido un v2.

Las capas pesadas del overlay —la memoria persistente y la planificación por especificación— son **condicionales**. Medí dos cosas incómodas: la memoria se escribió en cada tarea, pero no encontré evidencia de que se leyera después; y la planificación por máquina costó aproximadamente lo mismo que ir directo, pero con esa variación de 1,8 veces y una capa siempre activa que se paga corra o no. El valor de esas capas aparece en escenarios que no probé: un equipo de varias personas que comparte decisiones, features grandes con muchas alternativas de diseño, o requisitos de auditoría. Para un solo desarrollador y features acotadas, agregan costo y fragilidad sin un retorno que haya podido demostrar.

Dicho de otro modo: **el salto de v2 a "harness completo" mejora sobre todo por dos capas baratas; el resto del harness pesado conviene incorporarlo cuando el escenario lo justifique, no por defecto.** Un harness más completo no es automáticamente mejor. Es más capaz y más caro de operar, y conviene sumar cada capa solo cuando se va a usar.

## El cierre

La pregunta útil no es "¿cuál versión es mejor?", sino "¿qué capa de harness necesito para este trabajo?". v2 era un harness parcial, predecible y barato. v6 es completo, más capaz y más variable. Entre las dos, la lección no es elegir una, sino entender que cada capa tiene un costo y un escenario donde paga. La mayoría de las veces, las dos capas que más rinden son las más simples de agregar.

---

**Repositorios y referencia:**
- [AgentCode](https://github.com/rubenaros/AgentCode) — scripts, documentación y la referencia de capas (`research/capas-harness-stack-v6.md`).
- [petdesk-v2](https://github.com/rubenaros/petdesk-v2) — el repositorio del experimento (ramas por versión).
