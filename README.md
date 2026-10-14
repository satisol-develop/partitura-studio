# Partitura Studio

Espacio de trabajo para anotar partituras, con la idea de Notion pero aplicada
a música: cada partitura tiene **capas independientes de anotación** en lugar de
una única capa de garabatos.

Si anotas un PDF, todo lo que escribes vive en el mismo sitio y no se puede
separar. Aquí, tu digitación, la corrección del director y el análisis armónico
son capas distintas: se ocultan, se reordenan, se recolorean y se mueven entre
sí por separado.

## Arrancar

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # pruebas de la lógica con el runner de Node
npm run build        # compilación de producción (export estático)
```

La pantalla de acceso aparece también en `npm run dev`: **por defecto hay
puerta**, igual que en publicación. Para trabajar sin ella hay que apagarla
(`NEXT_PUBLIC_LOGIN_REQUIRED=false npm run dev`) o entrar contra el doble del
backend, que ya se enciende sin más en [Probar sin Google](#probar-sin-google).

Todo se guarda primero en **IndexedDB**, en el propio navegador: la aplicación
funciona sin conexión. Opcionalmente se **sincroniza con una carpeta de tu
Google Drive** (tus anotaciones y el MusicXML de cada partitura) a través de una
implementación de Apps Script que instalas tú una vez — ver
[Drive](#drive-anotaciones-y-musicxml-en-tu-carpeta) más abajo.

Y se entra con **correo y contraseña**: quien administra la instalación decide
quién está en la lista de autorizados. Ver [Acceso](#acceso-quién-entra-y-cómo-se-decide).

**¿Vas a publicarlo?** Los pasos, en orden, están en [DESPLIEGUE.md](DESPLIEGUE.md).

## Qué se puede hacer

**Tres formas de anotar, en la misma capa o en capas distintas**

| Herramienta | Tecla | Qué hace |
| --- | --- | --- |
| Lápiz | `P` | Tinta libre sobre el pentagrama. Aprovecha la presión si usas tableta. |
| Resaltador | `H` | Trazo ancho y translúcido (mezcla `multiply`, no tapa las notas). |
| Goma | `E` | Borra trazos enteros. Respeta las capas bloqueadas. |
| Comentario | `C` | Hilo de texto anclado a un punto concreto de la partitura. |
| Nota de compás | `N` | Datos estructurados del compás; ver abajo. |
| Seleccionar | `V` | Selecciona trazos para moverlos de capa, o pines y compases. |

**Campos estructurados por compás** (no todo es texto libre): prioridad de
estudio (repasar / importante / crítico), dinámica, articulación, digitación,
técnica, análisis armónico, nota libre y etiquetas. Los compases anotados
aparecen con un marcador en la partitura, coloreado según la prioridad.

**Un tramo, no un compás.** Con *Nota de compás* (o *Seleccionar*) se puede
arrastrar por encima de varios compases, o mantener `Mayús` al hacer clic para
extender el tramo desde el ancla. La anotación se guarda como un rango
(`measureIndex` → `measureEnd`) y se dibuja como una banda sobre el pasaje: es
lo que hace falta para «aquí entra el tema» o «bajar dinámica hasta la letra
B» sin repetir la misma nota compás a compás.

**Varias voces.** Una `part` de MusicXML es una parte de la plantilla, no un
bloque de pentagramas: un piano con dos pentagramas es *una* parte con dos
pentagramas, y se oculta, se silencia o se anota como una sola cosa. En el
panel de plantilla se elige a qué parte se atribuyen las anotaciones nuevas (o
a toda la plantilla), y el marcador de una anotación sólo pinta los pentagramas
de su parte: lo que el director apunta en el piano no aparece encima del saxo.
Un mismo tramo admite por tanto varias anotaciones, una por instrumento, sin
pisarse.

**Reproducir el XML.** Suena el contenido del documento, con silenciado por
parte para estudiar tu voz oyendo las demás. Ver la sección de reproducción.

**Mover un comentario.** Un pin se arrastra en modo *Seleccionar*: al soltarlo se
recalcula el compás al que ha ido a parar, porque un comentario movido dos
sistemas más abajo pertenece al compás de destino. Antes había que borrarlo y
volver a escribirlo. En una capa bloqueada se puede leer y seleccionar, pero no
mover.

**Dos exportaciones, para dos destinos distintos.** La copia `.json` es el
documento entero (capas, anotaciones y el XML dentro) y sirve para volver a
abrirlo aquí; el `.musicxml` es la música sola, sin las anotaciones, y es lo
que se abre en otro editor de partituras. El segundo es la única forma de sacar
de aquí la transcripción de un MIDI o el XML que venía dentro de un `.mxl`.

Otros: deshacer/rehacer dentro de la sesión (`Ctrl+Z` / `Ctrl+Shift+Z`), zoom con
ajuste de ancho, capas con visibilidad, bloqueo, opacidad, orden, duplicado y
vaciado, biblioteca de partituras y sincronización con Drive.

## Formato de entrada

- **MusicXML** (`.musicxml`, `.xml`) — el camino principal.
- **`.mxl`** — se descomprime (ZIP) y se guarda el XML en claro. Depende de si
  el `.mxl` trae `META-INF/container.xml`; si no, se coge el primer XML suelto.
- **MIDI** (`.mid`, `.midi`) — transcripción de mejor esfuerzo, ver limitaciones.
- **`.json`** — una copia exportada antes, para recuperar tus capas.

## La decisión técnica que sostiene todo

Anclar anotaciones a una partitura tiene una trampa: **la maquetación de los
compases depende del ancho del contenedor**. OSMD decide dónde rompe los
sistemas según el ancho disponible, así que si el ancho cambia (al
redimensionar la ventana, por ejemplo) los compases se mueven y cualquier
anotación guardada en coordenadas absolutas queda desalineada.

Por eso:

1. **El ancho de maquetación es fijo** (`layoutWidth`, por defecto 1180 px de
   espacio de partitura) y se guarda con el documento.
2. **El zoom no recalcula coordenadas**: se aplica un `transform: scale()` CSS
   sobre un contenedor que envuelve *a la vez* la partitura y el lienzo de
   anotaciones. Es imposible que se desalineen, y el zoom es instantáneo porque
   no hay re-maquetación.
3. **Las anotaciones se guardan en "espacio de partitura"** = píxeles con zoom
   1, nunca píxeles de pantalla.

OSMD trabaja en unidades donde 1 unidad = distancia entre líneas del pentagrama
y 1 píxel de VexFlow = 0,1 unidades (`EngravingRules.UnitToPixelFactor = 10`).
`lib/geometry.ts` es el único sitio donde se hace esa conversión.

### Cómo se comprueba que está bien alineado

`lib/geometry.ts` lee, después de `osmd.render()`, la caja de cada compás desde
`GraphicSheet.MeasureList[measureListIndex][staffIndex]`, uniendo todos los
pentagramas de ese compás en una sola caja. Esas coordenadas se pueden comparar
con las barras de compás que OSMD ha dibujado de verdad en el SVG: coinciden al
decimal (por ejemplo, el compás 1 empieza en x=252,35609 y la barra está en
252,35609).

En desarrollo hay una superficie de diagnóstico expuesta en `window`:

```js
__partitura.measureBoxes()      // cajas de todos los compases
__partitura.staffBoxes()        // cajas por pentagrama (para separar partes)
__partitura.measureAt(x, y)     // qué compás cae en un punto de partitura
__partitura.zoom()
__partitura.osmd()              // documento vivo de OSMD (notas, cursor, tiempo)
__partitura.snapshot()          // herramientas, capas, plantilla y reproducción
```

## Publicar en GitHub Pages

La aplicación es un sitio estático: el build no necesita servidor.

```bash
npm run build                       # genera out/
npm run serve:out -- 4173           # sirve out/ como lo haría Pages
```

El flujo está en [.github/workflows/deploy.yml](.github/workflows/deploy.yml) y
se dispara al empujar a `main`. Los pasos que importan, y por qué:

- **Antes del primer push hay que encender Pages**, una sola vez: *Settings →
  Pages → Build and deployment → Source → **GitHub Actions***. Si no está
  encendido, el flujo falla en `configure-pages` con `Get Pages site failed.
  Please verify that the repository has Pages enabled and configured to build
  using GitHub Actions` — el error que se ve en el primer intento, tal cual. No
  se puede automatizar desde el propio flujo: crear el sitio de Pages por API
  pide un token con permiso de administración y `GITHUB_TOKEN` no lo tiene, así
  que el flujo no lleva ninguna llave guardada. Son dos clics, y una vez.

- `actions/configure-pages` resuelve el `base_path` del sitio —`/repo` en un
  sitio de proyecto (`usuario.github.io/repo/`), vacío en uno de usuario— y se
  pasa al build en `PAGES_BASE_PATH`. Se fija **al construir** porque
  `basePath` se incrusta en las rutas de los paquetes del cliente: no se puede
  cambiar después sin volver a construir.
- El build se comprueba antes de publicar: `npm run typecheck`, `npm run lint`
  y `npm test`. Si algo falla, no se publica nada.
- Se añade `out/.nojekyll` **y se sube dentro del artefacto**. Publicando con
  Actions no se pasa por Jekyll, pero si algún día se sirve la carpeta de otra
  forma, Jekyll ignora las carpetas que empiezan por guion bajo y `_next/` es
  donde va todo el JavaScript y el CSS. La segunda mitad de la frase importa:
  un archivo que empieza por punto es un archivo oculto, y
  `upload-pages-artifact` los deja fuera salvo que se pidan
  (`include-hidden-files: true`). Sin esa opción el `touch` se quedaba en el
  runner y el sitio se publicaba sin el archivo, con el paso en verde.

Para probar el artefacto exacto que se publicará —con su `basePath`, sus
rutas y sin proceso de Node detrás— está `tools/serve-out.mjs`:

```bash
MSYS_NO_PATHCONV=1 npm run serve:out -- 4173 /partitura-studio
```

Comprobado con el sitio exportado: `index.html` y su CSS a 200, la raíz a 404
(al ser un sitio de proyecto), el render de OSMD correcto y ninguna petición
fuera de lo esperado.

## Acceso: quién entra y cómo se decide

No hay roles ni permisos distintos: hay una **lista de correos autorizados**. O
estás en ella, o no entras. Corro y administro esa lista desde Apps Script; ver
[DESPLIEGUE.md](DESPLIEGUE.md#2-dar-y-quitar-acceso).

**La decisión se toma en el servidor, no en la pantalla.** Un login escrito
sólo en el navegador no protege nada: el sitio es estático, así que cualquiera
puede leer el JavaScript, quitarse la puerta de delante y llamar al script
directamente. Por eso cada petición de datos lleva una **sesión firmada**
(HMAC con un secreto que sólo vive en el script) y sin una válida no se lee ni
se escribe nada en Drive. La pantalla de acceso es la puerta cómoda; la puerta
de verdad está en el otro lado.

Qué se deduce de ahí, sin adornos:

- **La página es pública.** Se puede abrir y ver la pantalla de acceso. Lo que
  no se puede es pasar de ahí sin una cuenta de la lista.
- **El token de sesión vale como una contraseña temporal** (30 días, por
  defecto) mientras dura: vive en el `localStorage` del navegador. No se
  incluye en las copias ni en los diagnósticos, y `revocarSesiones()` lo
  invalida todo de golpe.
- **Desactivar a alguien surte efecto en la siguiente petición**, aunque su
  sesión siga firmada y sin caducar: la firma prueba que la emitimos nosotros,
  no que la persona siga autorizada.
- **Las contraseñas no se guardan**: sólo un hash SHA-256 con la sal del script
  y el propio correo, así que dos personas con la misma contraseña no comparten
  hash.
- **Sin conexión se puede entrar** si había una sesión viva: no se puede
  preguntar al servidor, y bloquear el acceso a partituras que ya están en el
  equipo no protegería nada. La salida sin conexión —«ver lo guardado en este
  equipo»— sólo aparece cuando el fallo **fue de red**, nunca cuando el servidor
  dijo que no.
- **Lo que protege de verdad** es la cuenta de Google que ejecuta el script: es
  la que tiene las partituras. Esto es una puerta razonable para un aula o un
grupo de estudio, no un sistema de seguridad.

`NEXT_PUBLIC_LOGIN_REQUIRED=false` es la única forma de quitarla, y está pensada
para quien usa su propio Drive sin compartirlo con nadie. **Sin esa variable —o
con la variable en blanco— la puerta se enseña igual**, aunque todavía no exista
ningún backend: con el sitio publicado es lo que hace falta, porque una
instalación a la que se le olvidó crear la variable no puede salir a la calle
sin puerta, y no saber si hay servidor no es razón para abrirla. Eso sí: sin
`DRIVE_ENDPOINT` la pantalla de acceso pide la dirección del servidor la primera
vez, así que entrar hasta que la pongas.

## Drive: anotaciones y MusicXML en tu carpeta

Opcional y desactivado por defecto. Sirve para tener las partituras en varios
equipos y para que las anotaciones sobrevivan a borrar los datos del navegador.

Montarlo son cinco minutos y está detallado en
[DESPLIEGUE.md](DESPLIEGUE.md#1-crear-el-backend-apps-script). El resumen:
proyecto en [script.google.com](https://script.google.com) con el contenido de
[apps-script/Code.gs](apps-script/Code.gs), `prepararInstalacion`,
`generarUsuario(...)` para el primer correo, e *Implementar → Aplicación web*
con *Ejecutar como: Yo* y acceso *Cualquier persona*.

Al cambiar el código hay que crear una **nueva versión** de la implementación.
Es el error más común: se edita el script, se recarga la aplicación y sigue
funcionando lo viejo.

### Qué se guarda y dónde

```
Partitura Studio/                  (en Mi unidad)
  library.json                     índice: qué partituras hay y cuándo cambiaron
  scores/<id>/document.json        las capas de anotación y los metadatos
  scores/<id>/score.musicxml       el MusicXML sobre el que están anotadas
```

El MusicXML se guarda **aparte del JSON** y no dentro: se puede abrir y
reutilizar desde Drive sin la aplicación, y guardar una anotación no obliga a
reescribir una partitura de cientos de kilobytes.

### Cómo se sincroniza

- **Local primero.** Se escribe siempre en IndexedDB y Drive es la copia. Al
  revés (escribir directo en Drive) la aplicación dejaría de funcionar sin
  conexión, y un trazo perdido por un timeout es peor que una sincronización
  que llega unos segundos tarde. Con «Sincronizar solo» activo, se sube ocho
  segundos después del último cambio: no en cada trazo, que la cuota de Drive no
  perdona.
- **Choques: gana el más reciente** (`meta.updatedAt`). No se mezclan capas:
  fusionar dos versiones de la misma lista de trazos sin un modelo de
  diferencias sólo puede inventar anotaciones que nadie dibujó. Cuando los dos
  lados han cambiado desde la última vez, se avisa en el informe en vez de
  resolverlo en silencio.
- **Borrados.** Al eliminar una partitura se deja una «lápida» hasta que Drive
  la confirma; si no, borrar aquí y sincronizar volvería a bajarla.
- **Errores.** Un fallo en una partitura no aborta el resto: el informe dice
  «3 subidas · 1 error» y se puede reintentar sin tocar lo demás.

### Quién puede llamar al backend

La implementación de Apps Script se ejecuta **con tus permisos de Drive** y su
URL es pública, así que la autorización no puede depender de conocerla: cada
acción que toca datos exige una **sesión de usuario válida** (o la clave de
servicio, que sólo se usa desde la consola y desde `curl` y nunca llega al
navegador). Ver [Acceso](#acceso-quién-entra-y-cómo-se-decide).

Lo que esto **no** es: un backend multiusuario. No hay aislamiento por persona
(todos los autorizados ven la misma carpeta), ni auditoría de quién cambió qué,
ni cifrado en reposo más allá del que ya pone Drive. Para un grupo de estudio o
un aula es suficiente; para datos sensibles, no. Está escrito también en la
cabecera de [apps-script/Code.gs](apps-script/Code.gs) y en el diálogo de
ajustes, porque es el tipo de detalle que no conviene descubrir después.

### Detalles del protocolo que no son negociables

- El cuerpo va como **`text/plain`**, no como `application/json`: un
  `Content-Type: application/json` dispara un `OPTIONS` previo que Apps Script
  no responde y la petición muere como error de red. Lo mismo con cualquier
  cabecera propia, así que la sesión va en el cuerpo.
- Las respuestas son **siempre HTTP 200 con un campo `ok`**, incluso en los
  errores: un 4xx sin cabeceras CORS no se puede leer desde el navegador y llega
  como un «Failed to fetch» indistinguible de estar sin conexión. El campo
  `code` es lo que sí distingue: `unauthenticated` cierra la sesión y pide
  acceso, `network` no toca nada.
- Escrituras bajo `LockService`: dos pestañas guardando a la vez pueden leer el
  índice al mismo tiempo y perder una de las dos partituras.

### Probar sin Google

`tools/mock-apps-script.mjs` implementa el mismo contrato en memoria, así que el
ciclo completo se puede ejercitar sin desplegar nada:

```bash
node tools/mock-apps-script.mjs 4599
# Imprime el usuario y la contraseña de prueba al arrancar.
# En la pantalla de acceso: Dirección del servidor → http://127.0.0.1:4599/exec
```

Lo usan `tests/drive-sync.test.mjs` (subida, bajada, conflictos, borrados,
sesión caducada, error de red y fallo aislado de una partitura) y
`tests/auth.test.mjs` (entrar, contraseña mal, usuario desactivado, sesión
manipulada y revocada), y sirve para comprobar a mano la interfaz. No reproduce
los límites de Drive, el cerrojo entre instancias ni la redirección real a
`script.googleusercontent.com`.

## Pruebas

```bash
npm test
```

Con el runner de Node, sin navegador y sin dependencias de pruebas. Los
enganches de `tests/register-hooks.mjs` hacen que Node pueda cargar el código
tal cual: resuelven las rutas sin extensión (que en el proyecto resuelve el
empaquetador) y apuntan `@tonejs/midi` al fichero que usa la aplicación, porque
el paquete no publica `exports` y Node y el empaquetador eligen ficheros
distintos.

- `tests/geometry.test.mjs` — conversión de coordenadas, cajas de compás, tramos
  por sistema, presión del trazo.
- `tests/types.test.mjs` — rangos de compases y utilidades del modelo.
- `tests/midi-to-musicxml.test.mjs` — el conversor, incluidos los tres fallos
  reales que costó encontrar: varios `<pitch>` en un mismo `<note>` (acordes que
  se perdían), `<duration>` detrás de `<tie>` (orden que exige el DTD) y
  ligaduras inferidas por contigüidad en vez de por continuidad de la nota.
- `tests/auth.test.mjs` — acceso y sesiones: contraseña incorrecta, correo
  desconocido y usuario desactivado diciendo lo mismo (para no poder averiguar
  quién tiene cuenta), sesión manipulada, caducada, revocada, alguien
  desactivado a mitad de sesión, y un corte de red que **no** deja a nadie
  fuera.
- `tests/drive-sync.test.mjs` — el cliente de Drive y el motor de
  sincronización, contra el doble local, entrando de verdad con correo y
  contraseña.
- `tests/store.test.mjs` — el estado: que editar el título pase por el
  autoguardado (llegando a llamar a `saveNow` sin tocar nada más), que mover un
  pin actualice el compás al que va a parar, y que una capa bloqueada no se
  mueva, no se borre y no reciba trazos.
- `tests/files.test.mjs` — la frontera de los archivos: un `.json` ajeno o sin
  partitura se rechaza con un motivo, una copia antigua se completa, el `.mxl`
  se abre por su `container.xml` (y si no lo trae, por el primer XML), 26 MB se
  rechazan sin colgar la pestaña, y el nombre del MusicXML exportado sale sin
  acentos ni barras.

## Reproducción

El transporte suena **desde el modelo de OSMD**, no releyendo el texto del
MusicXML: así lo que se oye es, por construcción, el mismo documento que se ve
dibujado, y sigue siendo correcto aunque el XML llegue por otra vía (`.mxl`,
MIDI transcrito, etc.).

- **El tempo sale de la partitura**, compás a compás (`TempoInBPM` de cada
  `SourceMeasure`), no de un BPM único. Una obra con cambios de tempo suena a
  tempo en todo su recorrido.
- **Las ligaduras se respetan**: en el modelo, una nota ligada son varias notas
  con el mismo `NoteTie`, así que sólo se ataca la primera y su duración se
  extiende sobre el resto. Sin eso, cada ligadura se oiría como un re-ataque.
- **Cursor y compás**: el cursor de OSMD sigue la música y la barra indica el
  compás que suena, con opción de desplazar la vista para no perderlo.
- **Planificación anticipada**: un temporizador barato (25 ms) agenda en el
  reloj de Web Audio las notas que caen dentro de los siguientes 120 ms.
  Programar cada nota con `setTimeout` daría un ritmo irregular, porque los
  temporizadores del navegador no son precisos.
- **Silenciar partes**: cada parte de la plantilla se puede apagar por separado.

El paquete `osmd-audio-player` no se usa a propósito: declara compatibilidad con
opensheetmusicdisplay `^0.8.4`, muy anterior al 2.2.1 de aquí.

### La trampa que costó encontrar: `getHalfTone()` no es el número MIDI

OSMD numera las octavas una por debajo de la notación científica, así que
`pitch.getHalfTone()` vale 12 menos que el número MIDI. No se deduce leyendo el
código; se comprueba contra la frecuencia, que es lo que define el sonido: el
Do5 escrito en el MusicXML de prueba tiene `getHalfTone() === 60` y
`Frequency === 523,25 Hz`, y 523,25 Hz es Do5, o sea MIDI 72. Se confirma además
contra el dibujo: la cabeza de esa nota cae en el tercer espacio del pentagrama
en clave de sol, no bajo el pentagrama.

Sumar ese desfase es todo, pero olvidarlo hacía que la partitura entera sonara
**tres octavas por debajo** sin que se viera nada raro en pantalla.

## Móvil y tableta

El espacio de trabajo es el mismo; lo que cambia es cómo cabe. Todo esto está
medido a 390×844 (móvil), 820×1180 (tableta vertical) y 844×390 (móvil
tumbado), no deducido del CSS.

- **Los paneles, como cajón.** A partir de 1024 px de ancho las capas y las
  anotaciones van al lado de la partitura. Por debajo no caben (288 + 320 px de
  paneles dejarían la partitura en un suspiro), así que se abren superpuestos
  con los botones *Capas* y *Anotaciones*, se cierran tocando el fondo o con
  `Escape`, y al cerrarse el foco vuelve a su botón. Antes esos dos botones **no
  hacían nada** en una pantalla estrecha: los paneles estaban ocultos por CSS y
  no había forma de llegar a ellos.
- **Dos dedos para moverse.** En una pantalla táctil el dedo que toca la
  partitura dibuja, así que desplazar y ampliar son gestos de dos dedos: el
  punto medio entre ellos mueve la vista y la distancia entre ellos cambia el
  zoom, dejando siempre bajo los dedos el mismo punto de la partitura (medido:
  el punto no se mueve ni un píxel al duplicar la distancia). El margen gris
  alrededor del papel sí se desplaza con un dedo, y en escritorio todo sigue
  igual que antes.
- **La palma no cuenta.** Si hay un lápiz apoyado, los toques de dedo se
  ignoran. Sin eso, escribir con un lápiz en una tableta y apoyar la mano
  cancelaría el trazo en cada palabra. Y al revés: dos dedos de verdad a mitad
  de un trazo lo descartan, que es la forma de arrepentirse sin soltar el lápiz.
- **El encuadre se rehace solo.** La partitura se encaja al abrirse y también
  cuando cambia el hueco (girar el dispositivo, redimensionar, mostrar u
  ocultar un panel). Sólo mientras el zoom siga siendo el que puso la
  aplicación: en cuanto se cambia a mano o con los dedos, manda esa elección.
  En un móvil no se encaja por debajo del 55 % —encajar 1180 px en 390 deja la
  música ilegible—, y es mejor un tamaño legible con desplazamiento; el botón
  *Ajustar* sí encaja de verdad, aunque eso signifique un 30 %.
- **Zócalo.** El alto es `100dvh` y no `100vh`, que en un móvil deja la barra
  de reproducción fuera de la pantalla, con márgenes seguros
  (`env(safe-area-inset-*)`) para la muesca y la barra de gestos. La escala del
  navegador ya no está bloqueada, así que se puede ampliar con los dedos donde
  el texto es de 10 px (los paneles), y con puntero grueso los botones crecen
  hasta 40 px de lado.
- **Nada cortado.** En un móvil la cabecera se parte en dos líneas (botones y
  después el título, que antes quedaba en «T…»), y la fila de color y grosor
  ocupa la suya: en 390 px se comprobó que ningún control queda fuera del
  ancho de la ventana.

## Accesibilidad

- **Anillo de foco propio** (`:focus-visible`), porque media interfaz lleva
  `outline-none` para dibujar su borde. Sólo aparece al navegar con teclado.
- **Nombres de verdad en los controles que no tienen texto**: los botones de
  color se anuncian como «Tinta Azul estudio» o «Color Rojo correcciones», no
  como `#1f6feb`; el grosor, el tablero de capas y el transporte tienen
  etiqueta.
- **Pestañas como pestañas** (`role="tablist"`, `aria-selected`, flechas para
  cambiar) y diálogo de Drive como diálogo (`aria-modal`, foco atrapado,
  `Escape` cierra y el foco vuelve a donde estaba).
- **Lo que cambia solo se anuncia**: guardar, sincronizar y los errores de
  guardado van en regiones `aria-live`; un error de guardado también se ve como
  banda roja con `role="alert"`, porque el peor final posible es seguir
  dibujando creyendo que se guarda.
- **Contraste**: el gris de los textos secundarios está a 5,8:1 sobre blanco
  (AA pide 4,5:1), y afecta a etiquetas de 10-11 px, que es donde se nota.
- **`prefers-reduced-motion`** desactiva transiciones y desplazamientos suaves.

## Limitaciones conocidas

- **Import de MIDI**: MIDI dice cuándo suena qué, no cómo se escribe. Se
  cuantiza a semicorchea, se agrupan acordes, se separan hasta 4 voces y se
  reparte en dos pentagramas si el registro cruza el Do central. Se pierden
  dinámicas, articulaciones y pedal (MIDI no las lleva de forma fiable) y las
  pistas de percusión (canal 10) se descartan.
- **Cambiar el ancho de maquetación** de una partitura ya anotada requeriría
  re-anclar todas las anotaciones transformándolas con la caja de cada compás.
  Todavía no está hecho, por eso el ancho es fijo.
- **Paginación**: se usa el modo continuo de OSMD (un solo lienzo alto), no
  páginas A4. Los saltos de sistema siguen siendo los correctos; no hay saltos
  de página.
- **Un instrumento por partitura importada de MIDI**: el MusicXML conserva la
  plantilla completa (saxo, piano, bajo, con sus pentagramas), pero el conversor
  de MIDI fusiona todas las pistas en una sola parte, porque MIDI no dice qué
  pentagramas forman una misma parte.
- **Reproducción sin matices**: todas las notas suenan con la misma intensidad;
  las dinámicas del XML no se interpretan. El sonido es un sintetizador simple
  (triángulo con una octava por encima y un filtro suave), no una muestra de
  instrumento.
- **Acceso**: la lista de correos autorizados distingue «entra» de «no entra»,
  nada más. No hay roles, ni permisos por partitura, ni saber quién cambió qué:
  todos los autorizados comparten la misma carpeta con los mismos permisos. Y la
  página en sí es pública —lo que está cerrado es el acceso a los datos—, así
  que la puerta es tan fuerte como la cuenta de Google que la sostiene.
- **Sincronización**: gana la versión más reciente y no se mezclan capas; si dos
  personas editan la misma partitura sin sincronizar entre medias, una de las
  dos versiones se descarta (y se informa). No hay historial de versiones en
  Drive.
- **El backend de Apps Script no tiene pruebas automáticas**: necesita el
  entorno de Google. Lo que sí está probado es el contrato del cliente contra el
  doble local, y el flujo real se ha ejercitado a mano contra él.
- **Un móvil tumbado es estrecho de alto**: entre cabecera, barra de
  herramientas y barra de reproducción quedan unos 205 px de partitura a la
  vista. Se lee, pero para anotar conviene la vertical o una tableta.
- El historial de deshacer vive en memoria: se pierde al recargar la página.
  Las anotaciones no.

## Mapa del código

```
app/                     layout, página, estilos globales e icon.svg (el favicon, con la marca)
components/
  Workspace.tsx          raíz: carga la biblioteca, atajos de teclado, aviso al cerrar
  LoginView.tsx          pantalla de acceso: panel de marca y formulario
  Logo.tsx               la marca (pentagrama anotado) y la tira de la paleta
  ErrorBoundary.tsx      barrera de errores: un fallo de render no deja la pantalla en blanco
  ScoreView.tsx          disposición del espacio de trabajo (paneles laterales o cajón)
  ScoreCanvas.tsx        render de OSMD + lienzo de anotaciones + herramientas
  LayerPanel.tsx         gestión de capas
  AnnotationsPanel.tsx   editor de compás, hilos de comentarios, trazo seleccionado
  Toolbar.tsx            barra de herramientas
  TransportBar.tsx       reproducción: play, posición, silenciar, seguir
  LibraryView.tsx        biblioteca de partituras
  DriveDialog.tsx        ajustes de la sincronización con Drive
apps-script/
  Code.gs                backend en Google Apps Script (anotaciones + MusicXML en Drive)
lib/
  geometry.ts            ÚNICO sitio con conversión de coordenadas de OSMD
  types.ts               modelo de datos (capa → trazos / pines / notas)
  store.ts               estado, historial de deshacer, autoguardado, sesión y sincronización
  auth.ts                sesión guardada y cuándo hay que pedir acceso
  persistence.ts         IndexedDB
  drive.ts               cliente del backend de Apps Script
  sync.ts                motor de sincronización (recibe el almacén y `fetch`: se prueba sin navegador)
  files.ts               import/export de archivos
  playback.ts            lectura de la partitura a línea de tiempo + motor Web Audio
  midi-to-musicxml.ts    conversor MIDI → MusicXML
  demo-score.ts          partitura de ejemplo (piano solo)
  demo-trio.ts           partitura de ejemplo multiparte (saxo, piano, bajo)
tests/                   pruebas de la lógica con el runner de Node + enganches de resolución
tools/
  serve-out.mjs          sirve out/ como lo haría GitHub Pages (para probar el artefacto)
  mock-apps-script.mjs   doble local del backend, con el mismo contrato
```

## Sobre las «skills» de diseño e ingeniería

No había skills de diseñador ni de ingeniería instalables en este entorno (el
canal de skills de la cuenta está vacío y lo único descargable aquí son las de
vídeo), así que los dos repasos se han hecho aplicando los criterios
directamente: accesibilidad, estados de error, validación de entrada, contratos
probados y medición en vez de suposiciones. Lo de arriba —`aria-live`, `Escape`
en los cajones, foco que vuelve, el error de guardado a la vista, la validación
de la importación, el acceso decidido en el servidor y las pruebas que
reproducen los tres fallos reales de MusicXML— es el resultado, no una lista de
intenciones.

## Cómo se publica

Los pasos completos, en orden y con los errores típicos al final, están en
[DESPLIEGUE.md](DESPLIEGUE.md).
