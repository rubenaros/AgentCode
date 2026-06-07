# Post LinkedIn — v6 (v2 vs v6, énfasis en el arnés)
# Texto plano para LinkedIn: sin markdown en el cuerpo (LinkedIn no lo renderiza). Pegar desde "De 7 a 13 capas" hacia abajo.

De 7 a 13 capas: qué cambia al completar el arnés de un equipo de agentes.

Construí el mismo producto dos veces con el mismo sistema. La diferencia no fueron los modelos —los mismos— sino cuántas capas de arnés tenía cada versión.

Un arnés es toda la infraestructura que rodea al modelo para convertirlo en agente: el loop, las herramientas, la memoria, la planificación, la verificación, la entrega. El principio se repite en la literatura: el modelo razona, el arnés actúa. En un análisis de Claude Code, el 1,6% del código es lógica del modelo; el 98,4% es arnés.

La v2 era un arnés parcial: ~7 de 13 capas. La descomposición de tareas la hacía yo, la verificación era manual, el merge también.

La v6 completa las que faltaban:
→ Memoria persistente (Engram)
→ Planificación por máquina (guiada por especificación)
→ Sub-agentes
→ Verificación con CI como compuerta
→ Entrega autónoma (auto-merge)

No comparo costos absolutos (cada versión hizo una feature distinta). Por unidad:
• Costo: ~$0.45 por tarea → ~$1.07 por feature, con varianza de 1,8× entre corridas idénticas.
• Tiempo: parejo, a favor de v6 al consolidar la feature en una sola corrida.
• Retrabajos: el código salió limpio en las dos. La diferencia fue fricción operativa en v6: más capas, más puntos de falla.

Mi opinión, después de medir:

De todo lo que sumó la v6, las dos capas que se justifican son la verificación con CI y la entrega autónoma. Son baratas y las aporta GitHub, no el overlay. Las sumaría a cualquier setup.

La memoria y la planificación por especificación son condicionales. La memoria se escribió, pero no encontré evidencia de que se leyera. La planificación costó parecido a ir directo, con más varianza. Su valor aparece con un equipo, features grandes o requisitos de auditoría —no en un proyecto pequeño de un solo desarrollador, donde son lastre—.

Un arnés más completo no es automáticamente mejor: es más capaz y más caro de operar. Conviene sumar cada capa cuando el escenario la justifique, no por defecto.

Próximo paso: sacar los modelos de pago y correr modelos locales.

El detalle completo, con los números y la comparación capa por capa, en Medium (link en comentarios).

#IA #Agentes #Arquitectura #DesarrolloDeSoftware
