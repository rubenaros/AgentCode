# Un tablero para agentes es solo un tercio de un harness

*Un Kanban que reparte tareas a agentes de IA parece la pieza central. Medido contra cómo la literatura define un harness, implementa 5 de 13 capas. Estas son las otras 8, con qué las llené usando solo componentes open source, y cuáles rindieron.*

![Las capas de un harness de agente, mapeadas a componentes](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/architecture-v4.svg)

---

Pasé las últimas semanas armando un equipo de agentes de código que trabajan en paralelo sobre un tablero. Empecé creyendo que el tablero era el sistema. Terminé entendiendo que el tablero es una capa de un sistema mucho más grande, y ni siquiera la más importante.

La pregunta que ordena todo esto no es "qué tablero uso", sino "qué capas necesita un agente de código para funcionar, y quién implementa cada una". La literatura tiene una respuesta bastante consistente. Y al mapear mi stack contra ella, quedó claro que el tablero —en mi caso Multica— cubre una porción acotada, y que el valor real estaba en las capas que fui sumando.

## Qué es un harness, y dónde termina el modelo

En la literatura sobre agentes, "harness" es toda la infraestructura que rodea al modelo para convertirlo en agente. El principio se repite en casi todas las fuentes: **el modelo razona; el harness actúa.** El modelo recibe especificaciones de herramientas, decide cuál llamar y emite una salida estructurada. El harness valida esa salida, la ejecuta contra el mundo real, recoge el resultado y se lo devuelve como observación.

Un dato pone la proporción en perspectiva: en un análisis de Claude Code, alrededor del 1,6% del código es lógica de decisión del modelo; el 98,4% es infraestructura de harness. Y un resultado de SWE-agent mostró un salto de 6,7% a 68,3% en SWE-bench mejorando el harness, no el modelo. El harness no es accesorio: es donde está casi todo.

Hay además una distinción útil: el *inner loop* (un turno: observar, pensar, actuar dentro de una ventana de contexto) y el *outer loop* (coordinación de varias tareas o sesiones). Un tablero vive en el outer loop. El trabajo real del agente vive en el inner loop.

## Las 13 capas

Sintetizando fuentes primarias (Anthropic, SWE-agent, el marco CoALA de memoria, y varios papers recientes), un harness de agente de código se descompone en estas capas:

1. Modelo / inferencia
2. Prompt e instrucción (el scaffold)
3. Loop de control (observar-pensar-actuar)
4. Uso de herramientas
5. Entorno / sandbox / workspace
6. Contexto de trabajo y memoria persistente
7. Planificación y descomposición de tareas
8. Orquestación y coordinación multi-agente
9. Verificación, guardrails y auto-crítica
10. Estado y persistencia entre sesiones
11. Hooks de ciclo de vida y observabilidad
12. Cola y despacho de tareas
13. Reporte y entrega

La capa 1 es lo único que no es harness. Las otras doce son infraestructura.

## Lo que el tablero te da: 5 capas

Multica, el tablero que usé, implementa con solidez la porción exterior del harness:

- **Workspace (5):** clona el repositorio en un directorio aislado por tarea.
- **Cola y despacho (12):** acepta tareas, las asigna a un agente, las encola. Es su capa más propia.
- **Ciclo de vida (11, exterior):** lanza el proceso, lo monitorea, lo cancela o lo reintenta, clasifica el motivo de falla, registra el costo.
- **Orquestación exterior (8):** asigna issues a agentes a través del tablero.
- **Estado y reporte (10 y 13, parcial):** guarda el estado del issue y reporta de vuelta al tablero.

Es real y es útil. Pero conviene mirar lo que no aparece en esa lista: el loop del agente, la memoria, la planificación, la verificación, la entrega. Un dato concreto: el tablero no elige el modelo (lo hace el ejecutor), y la integración automática que logré no la hizo el tablero (la hizo el CI de GitHub).

## Las 8 capas que faltan, y con qué las llené

Acá está la decisión de fondo. Cada capa que falta tiene varios componentes posibles. Yo elegí llenar todas con software open source y autohospedable; podría haber elegido alternativas propietarias o gestionadas para cada una. Las capas son el invariante; los componentes son la elección.

- **Loop, herramientas y contexto de trabajo (3, 4, 6a):** las cubre el ejecutor. Usé **opencode**. Alternativa directa: Codex. (Claude Code no sirve para esta ruta porque no habla el formato del gateway que elegí.)
- **Memoria persistente (6b):** la agrega **Engram**, un servidor de memoria que se conecta como MCP. Guarda registros episódicos y semánticos que sobreviven al reset de contexto. Alternativa: otros almacenes vía MCP.
- **Planificación y descomposición (7):** la aporta **gentle-ai** con su flujo de desarrollo guiado por especificación (explorar, proponer, especificar, diseñar, dividir, implementar, verificar). Existe toda una categoría de frameworks que hacen esto.
- **Orquestación interior y hooks (8, 11):** los sub-agentes y plugins de **gentle-ai**, sobre el sistema de extensiones del ejecutor.
- **Verificación (9):** el **CI de GitHub** (tests, lint, build) más contratos ejecutables que escribí a mano. Alternativa: cualquier otro CI.
- **Entrega (13):** integración automática con **auto-merge de GitHub**, gateada por el CI.
- **Scaffold de contratos (2):** lo aporta el arquitecto —una persona— con un archivo de reglas del proyecto y los tipos de dominio definidos antes de delegar.

Los modelos (capa 1), Kimi y DeepSeek, entran por **OpenRouter**, también una elección entre muchas.

## Qué rindió y qué no

Sumar capas no es gratis ni garantiza mejora. Esto es lo que medí al ejecutar el mismo producto con distintas configuraciones:

- **La verificación y la entrega rindieron sin matices.** Con el CI como única compuerta, las tareas se integraron solas: cero intervenciones manuales de merge. Un detalle revelador: durante un tiempo los cambios figuraban "sin pruebas" porque el CI apuntaba a la rama equivocada. Media función de autonomía caída por una línea de configuración.
- **El loop y las herramientas son la base no negociable.** Sin el ejecutor, el tablero no tiene agente. Actualizar el ejecutor también mejoró el caching de contexto de forma notable.
- **La memoria es valor latente, no demostrado.** Los agentes escribieron registros estructurados de cada tarea. No encontré evidencia de que los leyeran después. Escribir no es lo mismo que consultar; el beneficio aparece con equipos o requisitos de auditoría, escenarios que no probé.
- **La planificación guiada por especificación tiene un costo variable y alto.** Para una función trivial llegó a consumir el flujo completo de fases sin terminar en nueve minutos. Y un dato que cambió mis conclusiones: el costo por tarea idéntica varió hasta cuatro veces entre corridas. Con esa varianza, comparar una sola corrida entre versiones es ruido.
- **La herramienta miente sobre su propio costo.** El número que reporta el ejecutor no coincidió con la factura del proveedor de modelos, y no de forma consistente. Para presupuestar, sirve la factura, no el número del CLI.

## El harness mínimo que conserva el valor

Si quito lo que no rindió de forma confiable y dejo lo que sí:

```
Arquitecto + contratos  →  Repo + CI  →  ejecutor (opencode/Codex)
con un modelo barato vía OpenRouter  →  auto-merge gateado por CI
```

Eso entrega contratos sólidos, integración autónoma y costo bajo. El tablero aporta visibilidad, no capacidad: buena parte de su función la cubre un script más el CI. La memoria y la planificación guiada por especificación las reincorporaría cuando el escenario las justifique —equipo, features grandes, auditoría—, no por defecto.

## El cierre

La conclusión es la misma que repite la literatura: el harness, no el modelo, es donde está casi todo el sistema. Un tablero de agentes es una capa de ese harness, no el harness. Completarlo es un ejercicio de elegir un componente por capa —yo elegí open source— y, sobre todo, de medir cuáles de esas capas pagan su costo en tu caso concreto.

---

**Repositorios y referencia:**
- [AgentCode](https://github.com/rubenaros/AgentCode) — scripts, documentación y la referencia de capas (`research/capas-harness-stack-v6.md`).
- [petdesk-v2](https://github.com/rubenaros/petdesk-v2) — el repositorio del experimento.

**Fuentes:** [Building Effective Agents (Anthropic)](https://www.anthropic.com/research/building-effective-agents) · [Effective Harnesses for Long-Running Agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [SWE-agent](https://arxiv.org/abs/2405.15793) · [CoALA](https://arxiv.org/pdf/2309.02427)
