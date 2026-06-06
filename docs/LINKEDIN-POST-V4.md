# Post LinkedIn — v4/v5

Le hice dos preguntas al mismo equipo de agentes de código que monté hace unas semanas, ahora con la infraestructura actualizada:

¿Sale más barato? ¿Puede cerrar el trabajo sin que yo intervenga?

Las respuestas fueron de signo opuesto.

**El costo no bajó de forma confiable.**
Corrí el mismo conjunto de tareas dos veces. La primera: 0,32 dólares por tarea. La segunda: 0,61. Mismo stack, misma especificación. Frente al mismo pedido, el agente a veces resuelve directo y a veces delibera el triple. Esa variación pesa más que cualquier diferencia entre versiones. Si publicaba solo la primera corrida, anunciaba una mejora del 30 por ciento que no existe. Una sola corrida no mide nada cuando la variación es tan grande.

**La integración automática, en cambio, funcionó.**
Conecté el cierre: cuando un agente termina, su cambio entra solo en cuanto pasan las pruebas. Las tres tareas se integraron sin que yo tocara nada. La compuerta dejó de ser mi revisión y pasó a ser el resultado de las pruebas.

Un detalle del camino: al principio los cambios figuraban "sin pruebas". Las pruebas existían, pero apuntaban a la rama equivocada del repositorio. Media función de autonomía caída por una línea de configuración.

Lo que queda pendiente: el reparto de la siguiente tarea sigue siendo manual. El cierre se automatizó; el encadenamiento, todavía no.

Un apunte sobre el método: mantuve fija la capa que aporta coordinación y memoria, gentle-ai. Al revisar las corridas, de todo lo que ofrece solo la memoria entregó algo concreto: las fases de planificación y el catálogo de habilidades no se activaron en tareas de este tamaño. Y como esa memoria viene de un componente aparte, Engram, se puede conservar sin el resto del complemento.

Dos lecciones para quien mida agentes: la factura del proveedor manda, no el número de la herramienta. Y una sola corrida no alcanza para sacar conclusiones de costo.

Escribí el detalle completo, con la arquitectura y los números. Link en comentarios.

#IA #Agentes #Automatización #DesarrolloDeSoftware
