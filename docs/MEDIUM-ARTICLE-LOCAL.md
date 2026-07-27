# Un agente de código con modelo local en 16 GB: las cuatro decisiones que lo hacen funcionar

*Qué arnés, qué modelo, cómo servirlo y qué resultado da, medido contra una aceptación que el agente no escribe ni puede ver. Hardware: una RTX 3080 Laptop de 16 GB. Tarea: la misma de toda la serie —el Stats Dashboard de un repositorio Next.js + TypeScript, con motor de cálculo, endpoint de API, interfaz y tests—.*

![Las cuatro decisiones, en orden: arnés, modelo, serving y aceptación](https://raw.githubusercontent.com/rubenaros/AgentCode/main/docs/architecture-local.svg)

---

Sacar los modelos de pago de la ecuación cambia el problema de lugar. Deja de ser un asunto de costo por token y pasa a ser uno de presupuesto: cuánta VRAM hay, cuánto contexto entra, y qué queda para trabajar después de que el andamiaje se sirve su parte.

Hay cuatro decisiones que determinan si el montaje funciona, y conviene tomarlas en este orden.

## 1. El arnés: liviano

El criterio que pesa por encima de todos los demás es **cuánto contexto consume el arnés en t0** — antes de que el agente lea una sola línea del repositorio, con la tarea todavía sin empezar.

Los ejecutores maduros son caros en ese punto. OpenCode y equivalentes llegan al primer turno con su prompt de sistema, las definiciones de todas sus herramientas, los archivos de contexto del proyecto y, si hay una capa de método encima, sus instrucciones y sub-agentes. Ese piso irreducible, medido en el montaje anterior de esta serie, ronda los **20.500 tokens**.

En la nube no se siente: sobran ventanas de 200K. En local es decisivo, por dos razones que se multiplican. La ventana es más chica de entrada. Y cada token de ese piso **se reprocesa en cada turno**, sobre hardware que procesa prompt a una fracción de la velocidad de un servicio administrado.

De ahí el problema de fondo de correr local, el doble bind: **un modelo más chico necesita un arnés más fuerte, pero un arnés más fuerte cuesta contexto, y el contexto es justo lo que un modelo local tiene escaso.**

La salida es un arnés liviano: bucle de control, herramientas (leer, escribir, editar, bash), gestión de contexto, y poco más. **Pi**, de propósito general y multi-proveedor, arranca con una fracción de ese piso. Conectarlo al modelo local son veinte líneas registrando un proveedor compatible con OpenAI.

Hay un segundo criterio, y es de método: **conviene un arnés de propósito general antes que uno a medida.** No por calidad de código, sino porque cada instrucción que se agrega a un arnés propio es una hipótesis sin probar que entra al experimento disfrazada de infraestructura. Cuando el resultado falla, el arnés es una variable más, no un instrumento neutral — y el sesgo natural es atribuir la falla al modelo, que es la pieza que no se escribió.

## 2. El modelo: por qué un MoE de 35B y no un denso

La elección sale de descartar, y el camino es reproducible:

| Opción | Por qué queda afuera |
|---|---|
| Denso 7B–14B | No convergen en tareas agénticas multi-paso: bucles de lectura, divagación fuera de alcance, código roto. Coincide con lo que reporta la investigación de mercado. |
| Denso 27B en calidad usable | Necesita unos 24 GB. No entra. |
| Denso 27B bajado a 2 bits para que entre | Entra, pero la cuantización agresiva se come primero el razonamiento de última milla — justo la capacidad que hace falta. Escribe 45 de 47 tests en verde y se traba sin poder diagnosticar dos bugs sutiles. **Un 27B a 2 bits no es un 27B.** |
| **MoE 35B con expertos en RAM** | **Entra manteniendo 4 bits de calidad.** |

La clave del último renglón: un modelo *Mixture of Experts* activa solo una fracción de sus parámetros por token —35B totales, 3B activos—, y sus expertos se pueden mantener en la RAM del sistema en vez de la VRAM.

El elegido es **Qwen3.6-35B-A3B** (Apache 2.0, contexto de 262K). Marca 73,4 en SWE-bench Verified, por debajo del 77,2 del denso de 27B.

Conviene decirlo sin rodeos: **para tareas agénticas este es el peor de los dos.** La documentación del propio fabricante admite que el MoE "afloja" frente al denso en seguimiento de instrucciones. Pero el denso no entra en la tarjeta con calidad usable y el MoE sí. La decisión no es cuál es mejor, es cuál es el mejor que entra.

Un aviso, porque el marketing de los MoE confunde: **el cómputo escala con los parámetros activos, pero la memoria escala con el total.** "35B corriendo en 6 GB" significa 2 bits y un modelo lisiado. Los 3B activos dan velocidad, no ahorro de memoria.

## 3. El serving: llama.cpp, offload de expertos y contexto

```
llama-server -m Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf \
  -ngl 99 --n-cpu-moe 22 -c 65536 -fa on \
  -ctk q8_0 -ctv q8_0 -np 1 --jinja --reasoning-format none \
  --host 127.0.0.1 --port 8090
```

Las banderas que cargan el peso:

- **`--n-cpu-moe 22`** — el truco central. Empuja 22 capas de expertos a la RAM del sistema. Un modelo de 20,8 GB en disco termina ocupando **11,9 GB de VRAM**, con espacio de sobra en una tarjeta de 16.
- **`-ctk q8_0 -ctv q8_0`** — cuantiza la caché de contexto a 8 bits. Tan determinante como el offload, por lo que sigue.
- **`--reasoning-format none`** — el servidor entrega texto crudo y el cliente separa el bloque de razonamiento. El separador del servidor puede corromper el stream de modelos que emiten etiquetas en línea, y falla en silencio.

Rendimiento real: **~53 tokens/s de generación y ~500 tokens/s de procesamiento de prompt.**

### El contexto es donde más fácil se falla

Con 32K la corrida muere a mitad de tarea. El servidor lo dice sin ambigüedad:

```
request (32825 tokens) exceeds the available context size (32768 tokens)
```

Los síntomas encadenados son fáciles de malinterpretar: el modelo devuelve una respuesta vacía, el arnés comprime su contexto, y un archivo queda escrito por la mitad. Sin leer el log del servidor, todo eso parece incompetencia del modelo.

Duplicar a 64K cuesta **300 MB de VRAM** — de 11,6 a 11,9 GB. Ese es el dato accionable: con la caché cuantizada a 8 bits, **el contexto es barato y racionarlo es un error caro.** Conviene asignar el que la tarjeta aguante.

## 4. La aceptación: de autoría externa e invisible para el agente

Usar `npm test` + `lint` + `build` como criterio, con los tests escritos por el propio agente, habilita un modo de falla verificado: **el agente escribe su interpretación del enunciado en un test, pasa su propio test, y el resultado queda verde estando mal.**

Un caso concreto de esa deriva: la especificación pide dividir por los minutos laborables de *los días del rango*; la implementación usa *los días que tienen citas*. Un rango de tres días con citas en uno da 0,1111 donde corresponde 0,0370. Todo verde.

La corrección es una suite escrita antes de la corrida, que vive fuera del árbol de trabajo, que el agente nunca ve y no puede editar. Se inyecta solo al momento de juzgar y se retira después.

Tres requisitos para que sirva:

**Calibrarla contra un resultado defectuoso conocido.** Un árbitro sin calibrar aprueba o reprueba con la misma seguridad, y no hay forma de saber cuál está haciendo. Contra la implementación defectuosa de arriba, la suite marca 21 tests en verde y 2 en rojo, y los 2 son exactamente la desviación conocida.

**Neutralizar las ambigüedades del enunciado en los datos de prueba.** Donde la especificación no define algo, el caso debe construirse para que todas las lecturas razonables den el mismo valor esperado. Si no, el árbitro reprueba por decisiones que el enunciado nunca tomó. En esta suite hay cinco puntos así: cómo se cuentan los días del rango, si los fines de semana cuentan, de dónde sale la duración de una cita, qué significa "reservas" y "visitas", y si las listas de top rellenan con entradas en cero.

**Resolver el entorno de la suite antes de culpar al agente.** Dos fallas que parecen defectos del modelo son en realidad huecos del arnés de prueba: una configuración de tests que no resuelve los alias de importación del proyecto —válidos en build, invisibles para el runner—, y un handler de API invocado con un tipo de request que no lleva las propiedades que el framework sí le pasa en producción. Ambas producen rojo sin que haya nada mal en el código bajo prueba.

## Resultado

Tres corridas independientes: árbol de trabajo limpio y sesión nueva cada una, mismo enunciado, mismo servidor.

| Corrida | Aceptación | Tests | Lint | Build | Tiempo |
|---|---|---|---|---|---|
| 1 | **correcta** | verde | verde | verde | 7,5 min |
| 2 | **correcta** | verde | verde | verde | 10,2 min |
| 3 | **correcta** | rojo | verde | verde | 16 min |

**Tres de tres correctas según la especificación.**

El gate rojo de la tercera no es código defectuoso: el arnés aborta al comprimir su propio contexto y deja un archivo de depuración en el árbol. Su motor de cálculo pasa el árbitro igual. La correlación es perfecta en las sesiones revisadas: sin compresión termina, con compresión muere a mitad de camino. Es una limitación del ejecutor en modo no interactivo, y conviene tenerla en cuenta al presupuestar contexto.

El gate se verificó de forma independiente en vez de creerle al agente: 45 de 45 tests, cero errores de lint, build limpio, y las zonas prohibidas del repositorio intactas.

Contra la referencia del artículo anterior, la misma feature con modelos de pago:

| | Nube | Local |
|---|---|---|
| Costo por token | ~US$1,07 por feature | cero |
| Tiempo por corrida | ~11 min | 7,5 a 16 min |
| Varianza de tiempo | ~1,8× | ~2,1× |

El tiempo es competitivo. La expectativa razonable era que lo local fuera dramáticamente más lento, y no lo es.

## Conclusiones

**1. Un modelo local de este perfil, en 16 GB, cierra una tarea agéntica real y correcta según especificación.** Con offload de expertos, arnés liviano y aceptación externa, tres de tres.

**2. La aceptación tiene que ser de autoría externa al agente.** No por desconfianza, sino como instrumento. Un detalle lo ilustra: en una de las corridas correctas, el test que el modelo escribió para sí mismo usaba un rango de un solo día, un caso donde las dos interpretaciones posibles de la métrica dan el mismo número. Su propio examen no distinguía la respuesta correcta de la equivocada. Acertó, pero sus tests no lo obligaban a acertar.

**3. El offload de expertos cambia lo factible, no lo confiable.** Permite servir un modelo que no entraba. No lo vuelve mejor agente. Aquí lo factible era la restricción que mandaba, así que alcanzó.

**4. El orden de las decisiones es el de este texto.** Primero el arnés, que define cuánto contexto queda; después el modelo que entra en lo que sobra; después el serving; y la aceptación desde el principio. Elegir el modelo primero es el error natural y el que más caro sale.

---

**Repositorios:**
- [AgentCode](https://github.com/rubenaros/AgentCode) — arneses, la suite de aceptación y los scripts de corrida.
- [petdesk-v2](https://github.com/rubenaros/petdesk-v2) — el repositorio del experimento.
