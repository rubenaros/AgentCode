# Post LinkedIn — modelos locales (arnés, modelo, serving, aceptación)
# Texto plano para LinkedIn: sin markdown en el cuerpo (LinkedIn no lo renderiza). Pegar desde "Un agente de código" hacia abajo.

Un agente de código corriendo con modelo local en una tarjeta de 16 GB: las cuatro decisiones que lo hacen funcionar.

Sacar los modelos de pago de la ecuación cambia el problema de lugar. Deja de ser costo por token y pasa a ser presupuesto: cuánta VRAM hay, cuánto contexto entra, y qué queda para trabajar después de que el andamiaje se sirve su parte.

1. EL ARNÉS — liviano

El criterio que pesa más es cuánto contexto consume el arnés en t0, antes de leer una sola línea del repositorio. OpenCode y equivalentes llegan al primer turno con su prompt de sistema, sus definiciones de herramientas y los archivos de contexto del proyecto: un piso de unos 20.500 tokens.

En la nube no se siente, sobran ventanas de 200K. En local es decisivo por dos razones que se multiplican: la ventana es más chica, y ese piso se reprocesa en cada turno sobre hardware que procesa prompt a una fracción de la velocidad de un servicio administrado.

De ahí el problema de fondo: un modelo más chico necesita un arnés más fuerte, pero un arnés más fuerte cuesta contexto, que es justo lo que un modelo local tiene escaso.

2. EL MODELO — por descarte

→ Denso 7-14B: no convergen en tareas agénticas multi-paso.
→ Denso 27B en calidad usable: necesita 24 GB, no entra.
→ Denso 27B bajado a 2 bits para que entre: la cuantización agresiva se come primero el razonamiento de última milla, justo la capacidad que hace falta.
→ MoE 35B con expertos en RAM: entra manteniendo 4 bits de calidad.

Vale decirlo sin rodeos: para tareas agénticas el MoE es el peor de los dos candidatos. Pero el denso no entra y el MoE sí. La decisión no es cuál es mejor, es cuál es el mejor que cabe.

3. EL SERVING — llama.cpp con offload de expertos

--n-cpu-moe 22 empuja 22 capas de expertos a la RAM del sistema. Un modelo de 20,8 GB en disco termina ocupando 11,9 GB de VRAM, a unos 53 tokens por segundo.

Y el detalle donde más fácil se falla: con 32K de contexto la corrida muere a mitad de tarea. Los síntomas encadenados —respuesta vacía, compresión de contexto, archivo escrito por la mitad— parecen incompetencia del modelo si no lees el log del servidor. Duplicar a 64K cuesta 300 MB de VRAM con la caché en 8 bits. Racionar contexto es un error caro.

4. LA ACEPTACIÓN — de autoría externa

Usar los tests que escribe el propio agente como criterio habilita un modo de falla concreto: el agente escribe su interpretación del enunciado en un test, pasa su propio test, y el resultado queda verde estando mal.

La corrección es una suite escrita antes de la corrida, que vive fuera del árbol de trabajo, que el agente nunca ve y no puede editar. Y hay que calibrarla contra un resultado defectuoso conocido: un árbitro sin calibrar aprueba o reprueba con la misma seguridad, y no hay forma de saber cuál está haciendo.

EL RESULTADO

Tres corridas independientes: tres de tres correctas según la especificación. Verifiqué el gate por mi cuenta en vez de creerle al agente: 45 de 45 tests, cero lint, build limpio.

• Costo por token: de ~US$1,07 por feature a cero.
• Tiempo por corrida: ~11 min en la nube, 7,5 a 16 min en local. Competitivo.

MI OPINIÓN, DESPUÉS DE MEDIR

Una guarda escrita en lenguaje natural es una hipótesis, no una garantía, y falla en silencio. El caso concreto: una instrucción del tipo "los tests están congelados y son correctos, arregla el código para que coincida" —puesta para impedir que el agente edite un test a su conveniencia— es contraproducente cuando los tests los escribe el propio modelo. El mecanismo es directo: el modelo escribe buen código pero calcula mal los valores esperados a mano. Afirmó 660 donde la suma de los datos daba 600, y su código había calculado 600. Al declarar ese número verdad, la guarda rompe código correcto.

Un guardarraíl en código tira un error. Una instrucción en un prompt sesga la salida sin avisar. Si vas a escribir reglas para el agente, asume que cada una es una hipótesis que también hay que probar.

Y el orden de las decisiones es el de este post: primero el arnés, que define cuánto contexto queda; después el modelo que entra en lo que sobra; después el serving; y la aceptación desde el principio. Elegir el modelo primero es el error natural y el que más caro sale.

El detalle completo, con la configuración y los números, en Medium (link en comentarios).

#IA #Agentes #ModelosLocales #Arquitectura #DesarrolloDeSoftware
