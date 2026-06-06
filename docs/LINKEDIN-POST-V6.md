# Post LinkedIn — v2 vs v6

Construí el mismo producto con dos versiones del mismo sistema de agentes de código. La diferencia no estaba en los modelos —los mismos en las dos— sino en cuántas capas de "harness" tenía cada una.

Un harness es toda la infraestructura que rodea al modelo para convertirlo en agente. La literatura lo descompone en unas 13 capas: el loop de control, las herramientas, la memoria, la planificación, la verificación, la entrega. El principio se repite: el modelo razona, el harness actúa.

La v2 tenía un harness parcial, unas 7 capas: tablero, ejecutor, contratos escritos a mano. La descomposición de tareas la hacía yo, la verificación era manual, el merge también.

La v6 completa las que faltaban: memoria persistente (Engram), planificación por máquina (flujo guiado por especificación), sub-agentes, verificación con CI como compuerta, y entrega autónoma.

No comparo costos absolutos: cada versión construyó una feature distinta. Lo normalizable:
- Costo por feature: en v6, alrededor del doble, pero con una variación de hasta 1,8 veces entre corridas idénticas.
- Tiempo por feature: parejo, a favor de v6 cuando la feature se entrega en una sola tarea.
- Retrabajos: el código salió limpio en las dos. La diferencia fue fricción operativa en v6 (un corte del proveedor, un PR que quedó sin integrar). Más capas, más puntos de falla.

Mi opinión, después de medir: de todo lo que sumó la v6, las dos capas que rinden son la verificación con CI y la entrega autónoma. Son baratas y las aporta GitHub, no el overlay. La memoria y la planificación por especificación son condicionales: la memoria se escribió pero no vi que se leyera, y la planificación costó parecido a ir directo, con más variación.

Un harness más completo no es automáticamente mejor. Es más capaz y más caro de operar. Detalle completo en Medium, link en comentarios.

#IA #Agentes #DesarrolloDeSoftware #Arquitectura
