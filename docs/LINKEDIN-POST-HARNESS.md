# Post LinkedIn — harness

Un tablero Kanban que reparte tareas a agentes de IA parece el sistema central. Lo medí contra cómo la literatura define un "harness" de agente, y cubre 5 de 13 capas.

El principio que se repite en las fuentes: el modelo razona, el harness actúa. En un análisis de Claude Code, el 1,6% del código es lógica del modelo y el 98,4% es infraestructura alrededor. El harness es donde está casi todo el sistema.

Las 13 capas van del modelo y el loop de control a la memoria, la planificación, la verificación y la entrega. Multica, el tablero que usé, implementa con solidez la porción exterior: workspace aislado, cola, despacho, ciclo de vida y reporte. No toca el loop del agente, la memoria, la planificación ni la verificación.

Las otras 8 capas las llené con componentes open source, y esto es lo importante: las capas son el invariante, los componentes son una elección. Usé opencode para el loop (alternativa: Codex), Engram para la memoria persistente, gentle-ai para la planificación guiada por especificación, GitHub CI más contratos ejecutables para la verificación, y auto-merge para la entrega. Cada una tiene reemplazo.

Lo que medí al sumarlas:
- Verificación y entrega: rindieron. Las tareas se integraron solas, con el CI como única compuerta.
- Memoria: se escribe, pero no encontré evidencia de que se lea. Valor latente.
- Planificación guiada por especificación: costo variable y alto, hasta cuatro veces entre corridas idénticas.
- Dato práctico: el número de costo que reporta la herramienta no coincidió con la factura del proveedor. Para presupuestar, sirve la factura.

Conclusión: un tablero de agentes es una capa de un harness, no el harness. Completarlo es elegir un componente por capa y, sobre todo, medir cuáles pagan su costo en tu caso.

Escribí el detalle completo con la grilla de las 13 capas. Link en comentarios.

#IA #Agentes #DesarrolloDeSoftware #Arquitectura
