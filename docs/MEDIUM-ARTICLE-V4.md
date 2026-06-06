# Dos preguntas para un equipo de agentes: ¿más barato y más autónomo?

*Repetí el mismo proyecto que ya había construido con la versión 2, esta vez con el tablero y el ejecutor actualizados. Una de las dos respuestas no fue la que esperaba.*

![Arquitectura del stack de orquestación](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/architecture-v4.svg)

---

Hace unas semanas conté cómo construí un producto pequeño (un asistente de turnos para una veterinaria) con varios agentes de código trabajando en paralelo sobre un tablero de tareas. Esa versión —la 2— quedó disciplinada y predecible: cada tarea entregaba un cambio limpio, las pruebas pasaban y el costo era estable. Pero dejó dos cosas pendientes que quería resolver.

La primera: cada tarea empezaba de cero. Los agentes no recordaban nada de lo que habían decidido antes. La segunda, y más importante: yo seguía integrando a mano cada cambio. El equipo proponía, pero la última palabra —y el trabajo de cierre— eran míos.

Así que actualicé la infraestructura y volví a correr el mismo proyecto, con dos preguntas concretas:

1. ¿El stack actualizado resulta más barato por tarea?
2. ¿Puede integrar el trabajo sin que yo intervenga?

Las respuestas terminaron siendo muy distintas entre sí.

---

## El punto de partida

La versión 2 servía de referencia. Sobre el mismo repositorio, con los mismos agentes y los mismos modelos, sus números eran:

- **Costo:** 0,45 dólares por tarea.
- **Tiempo:** unos 12 minutos por tarea.
- **Pruebas al cierre:** 31.
- **Memoria entre tareas:** ninguna.
- **Integración:** manual, una por una.

El objetivo declarado de esa versión —el que había dejado anotado como "lo próximo"— era cerrar la integración automática. Esa era la deuda.

## Qué cambió y qué se mantuvo

Para que la comparación tuviera sentido, moví solo la base de la infraestructura y dejó fija la capa de método:

- **Tablero (Multica):** actualizado a la última versión.
- **Ejecutor (opencode):** actualizado a la última versión.
- **Capa de método y memoria (gentle-ai):** sin cambios respecto de la versión anterior.

gentle-ai es un complemento que se monta sobre el ejecutor. Aporta cuatro funciones: coordinación de fases de trabajo, sub-agentes, un catálogo de habilidades reutilizables y memoria persistente (esta última a través de un componente aparte, llamado Engram). Mantenerlo fijo fue deliberado: quería medir el efecto de actualizar la base, no mezclarlo con un cambio de método.

Conviene una aclaración que apareció al revisar las corridas. De esas cuatro funciones, en tareas de este tamaño solo una entregó algo concreto: la memoria dejó registros estructurados de cada tarea. Las fases de planificación y el catálogo de habilidades no llegaron a activarse. Y como la memoria proviene de Engram, que funciona por su cuenta, ese valor se puede conservar sin el resto del complemento.

El diagrama de arriba muestra cómo se ordenan las piezas: la persona define los contratos, el repositorio guarda el plan y las pruebas, el tablero reparte las tareas, el ejecutor corre cada una, y por debajo está la capa de método más los modelos.

## Pregunta 1 — el costo: la respuesta que no esperaba

Corrí el mismo conjunto de tareas dos veces (las llamo versión 4 y versión 5). El costo por tarea fue:

- Primera corrida: **0,32 dólares por tarea.**
- Segunda corrida: **0,61 dólares por tarea.**

El mismo trabajo, el mismo stack, la misma especificación. Casi el doble de diferencia entre una corrida y otra.

La explicación está en cuánto trabajo interno hizo cada agente. En una tarea idéntica —construir el motor de estadísticas—, la primera corrida procesó unas 64.000 unidades de texto de entrada; la segunda, más de un millón. El agente, frente al mismo pedido, a veces resuelve directo y a veces delibera mucho más. No es algo que yo controle, y la diferencia de costo lo sigue.

La conclusión es incómoda pero clara: **con esta configuración no hay una ventaja de costo confiable.** El rango de la corrida (entre 0,32 y 0,61 por tarea) queda a ambos lados de los 0,45 de la versión 2. A veces sale más barato, a veces más caro. La variación entre corridas pesa más que la diferencia entre versiones.

Si hubiera publicado solo la primera corrida, habría anunciado una mejora del 30 por ciento. Habría sido un número real y, al mismo tiempo, engañoso. Una sola corrida no alcanza para medir nada cuando la variación es tan grande.

## Pregunta 2 — la autonomía: la respuesta clara

Acá la respuesta fue contundente, y para el lado bueno.

En la versión 5 conecté la integración automática: cuando un agente termina una tarea, deja su cambio propuesto y lo marca para integrarse en cuanto las pruebas pasen. Si pasan, el cambio entra solo. Si no, queda detenido.

El resultado: **las tres tareas se integraron sin que yo tocara nada.** Cero intervenciones de integración, frente a las que hacía a mano en cada versión anterior. La compuerta dejó de ser mi revisión y pasó a ser el resultado de las pruebas.

Hubo un detalle revelador en el camino. Al principio los cambios aparecían "sin pruebas asociadas", como si no existiera la automatización. Resultó que las pruebas automáticas estaban configuradas, pero apuntaban a la rama equivocada del repositorio. Media función de autonomía no funcionaba por una línea de configuración mal dirigida. Una vez corregida, todo encajó.

Queda un límite. La integración se automatiza sola, pero **el reparto de la siguiente tarea sigue siendo manual.** Cuando se integra la primera tarea, soy yo quien lanza las dos siguientes. El tablero, en su versión actual, no encadena tareas que dependen unas de otras. Esa parte de la deuda sigue abierta.

## Una nota sobre cómo medir

Durante el análisis comparé dos fuentes de costo: la que reporta la herramienta del ejecutor y la factura real del proveedor de modelos. No coincidieron, y no de forma consistente: en una corrida la herramienta quedó por debajo de la factura; en otra, por encima.

La lección práctica es simple: para presupuestar, sirve la factura del proveedor, no el número que entrega la herramienta. Y conviene cruzar siempre las dos.

## La comparación, en una tabla

| | Versión 2 | Versión 4 | Versión 5 |
|---|---|---|---|
| Costo por tarea | 0,45 | ~0,32 | ~0,61 |
| Tiempo por tarea | ~12 min | ~8 min | 8–30 min |
| Integración | manual | manual | **automática** |
| Memoria entre tareas | no | sí | sí |
| Reparto de tareas | manual | manual | manual |

(Costos en dólares, según la factura del proveedor.)

## Sobre los frameworks que prometen el ciclo completo

Hay una categoría de herramientas en alza que promete justamente esto: de una especificación corta a código de producción —con requisitos, arquitectura, pruebas, auditoría de seguridad y despliegue— a cargo de decenas de agentes coordinados. La arquitectura que proponen es sólida y, en el fondo, es la misma que usé en este experimento: un orquestador, agentes especializados, fases con compuertas, revisión en paralelo y memoria entre sesiones, casi siempre definida en archivos de texto.

El punto no es la arquitectura. Es que la mayoría de esas presentaciones muestran lo que el sistema puede hacer, sin un solo número de costo, tiempo o repetibilidad. Y ahí es donde lo que medí marca la diferencia:

- La maquinaria pesada no siempre se usa. En tareas de tamaño normal, las fases de planificación y el catálogo de habilidades no llegaron a activarse. Se paga por tenerlas, no por usarlas.
- El costo no es estable. El mismo pedido resultó hasta cuatro veces más caro entre una corrida y otra.
- La memoria se guarda, pero su beneficio no está asegurado: dejar registros no es lo mismo que consultarlos.
- La autonomía completa tiene costuras. La integración se puede automatizar; el encadenamiento de tareas, todavía no.

Nada de esto descalifica a esas herramientas. La arquitectura funciona, y el valor aparece en los escenarios adecuados: equipos, funciones grandes, requisitos de auditoría. Pero el único modo de saber si rinden para un proyecto es medirlas sobre ese proyecto, en lugar de confiar en la demostración. Esto no es una teoría sobre un framework nuevo: es la medición de un enfoque que muchos ya están ofreciendo.

## Qué me llevo

Dos preguntas, dos respuestas de distinto signo.

El costo no bajó de manera confiable. La idea de que actualizar la base abarataba el trabajo no se sostuvo: la variación entre corridas la borra. Es un resultado menos vistoso, pero más útil de saber antes de prometerle ahorros a nadie.

La autonomía, en cambio, avanzó de verdad. La integración automática funciona de punta a punta, y la deuda principal de la versión 2 quedó a medio cerrar: el cierre se automatizó, el reparto todavía no.

Lo próximo es claro: automatizar también el reparto de tareas dependientes, y medir el costo sobre varias corridas en lugar de una sola, para separar la señal del ruido. Hay un tercer frente: probar el stack con la memoria de Engram por su cuenta, sin el resto de gentle-ai, para ver si conserva el único aporte que el complemento demostró —los registros estructurados— a menor costo.

---

**Repositorios:**
- [petdesk-v2](https://github.com/rubenaros/petdesk-v2) — repositorio del experimento (ramas por versión).
- [AgentCode](https://github.com/rubenaros/AgentCode) — scripts, documentación y comparativas.
