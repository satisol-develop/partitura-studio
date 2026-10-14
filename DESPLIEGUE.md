# Subir Partitura Studio: guía paso a paso

Esta guía lleva el proyecto desde tu ordenador hasta una dirección
`usuario.github.io` con acceso cerrado, con los pasos en el orden en que hay que
darlos. Se tarda unos 15 minutos la primera vez.

Al terminar tendrás:

- la aplicación publicada en GitHub Pages (sitio estático, gratis);
- un backend en Google Apps Script que guarda las anotaciones y el MusicXML en
  tu carpeta de Google Drive;
- una **lista de correos autorizados**: sólo esa gente puede entrar.

Si algo falla, salta a la última sección ([Si algo no funciona](#si-algo-no-funciona)):
están los errores que aparecen de verdad, con su causa.

---

## 0. Lo que hace falta

| Qué | Para qué |
| --- | --- |
| Una cuenta de Google | El backend y la carpeta de Drive. Es la que paga el almacenamiento. |
| Una cuenta de GitHub | El repositorio y el sitio publicado. |
| Node 24 o superior | Compilar y probar antes de publicar. |
| `git` | Subir el código. |

```bash
node -v      # v24.x o superior
git --version
```

---

## 1. Crear el backend (Apps Script)

El sitio es estático, así que no tiene servidor propio: el «servidor» es un
script de Google que se ejecuta con tus permisos y guarda todo en tu Drive.

1. Entra en <https://script.google.com> y crea un **proyecto nuevo**.
2. Borra el contenido de `Code.gs` y pega el del archivo del proyecto:
   [`apps-script/Code.gs`](apps-script/Code.gs). Guarda (💾).
3. Arriba, en el desplegable de funciones, elige **`prepararInstalacion`** y
   pulsa **Ejecutar**. Te pedirá permiso para acceder a Drive: acepta con la
   misma cuenta. Esto crea las propiedades `PASSWORD_SALT`, `SESSION_SECRET`,
   `SERVICE_KEY` y `USERS` (vacía). *No cambies `PASSWORD_SALT` nunca*: es la sal
   de las contraseñas y, si se pierde, nadie puede volver a entrar.
4. Crea el primer usuario. `generarUsuario` no se ejecuta sola (el editor no
   pasa argumentos), así que hay que llamarla desde otra función. Añade al
   final de `Code.gs` una función de usar y tirar, con tu correo y una
   contraseña larga (12 caracteres o más):

   ```javascript
   function primerUsuario() {
     generarUsuario("tu@correo.com", "una-contraseña-larga");
   }
   ```

   Selecciona `primerUsuario` en el desplegable de funciones, **Ejecutar** y
   mira **Ver → Registros** (Ctrl+Enter). Aparece una línea como esta:

   ```
   {"email":"tu@correo.com","hash":"a91f…","active":true}
   ```

   Copia **la línea entera**, incluidas las llaves.

   Esa función de usar y tirar se puede borrar después; quien crea usuarios
   normalmente es `generarUsuario`, que se llama igual pero desde el editor.

5. Abre **⚙️ Configuración del proyecto → Propiedades de la secuencia de
   comandos** y edita la propiedad `USERS`: pega ahí la línea del paso anterior,
   entre corchetes. Tiene que quedar un JSON válido:

   ```
   [{"email":"tu@correo.com","hash":"a91f…","active":true}]
   ```

6. Publica: **Implementar → Nueva implementación → tipo «Aplicación web»**.
   - *Descripción*: `Partitura Studio`
   - *Ejecutar como*: **Yo (tu@correo.com)**
   - *Quién tiene acceso*: **Cualquier persona**

   Autoriza otra vez si lo pide. Copia la **URL de la aplicación web**: es la
   que termina en `/exec`.

   > **¿Por qué «cualquiera»?** Porque el control de acceso no lo hace Google,
   > lo hace el script con la lista `USERS`. Un sitio estático no puede
   > autenticarse contra Google en cada petición, así que «cualquiera con cuenta
   > de Google» dejaría la aplicación inservible. Lo que protege tus partituras
   > es que cada petición lleva una sesión firmada.

7. Comprueba que responde, cambiando la URL y la contraseña:

   ```bash
   curl -sL -H 'Content-Type: text/plain;charset=utf-8' \
     -d '{"action":"login","email":"tu@correo.com","password":"una-contraseña-larga"}' \
     'https://script.google.com/macros/s/TU_URL/exec'
   ```

   El `-L` no es adorno: Apps Script responde primero con un **302 y el cuerpo
   vacío**, y el resultado viaja en la redirección —igual que lo sigue el
   navegador—, así que sin él el comando no imprime nada y parece que el script
   no funciona. (Y no añadas `-X POST`: forzaría el método tras la redirección
   y Google devolvería un `411 Length Required`.)

   Respuesta esperada (recortada):

   ```json
   {"ok":true,"email":"tu@correo.com","expiresAt":1791…,"session":"tu@correo.com|1791…|6f4a…"}
   ```

   Si devuelve `{"ok":false,"error":"Correo o contraseña incorrectos."}`, revisa
   la contraseña y que `USERS` esté bien pegado.

---

## 2. Dar y quitar acceso

Todo se hace desde el editor de Apps Script (nunca desde la web, nunca desde la
consola del navegador). El editor ejecuta funciones **sin argumentos**, así que
las que llevan correo o contraseña se llaman desde una función de una línea; el
resto se eligen directamente en el desplegable. Lo que imprimen se lee en
**Ver → Registros** (Ctrl+Enter):

| Función | Cómo se ejecuta | Qué hace |
| --- | --- | --- |
| `generarUsuario("ana@ejemplo.com", "contraseña")` | Desde una línea propia | Imprime la línea para pegar en `USERS`. |
| `listarUsuarios()` | Directa | Lista los correos autorizados y quién está desactivado. |
| `desactivarUsuario("ana@ejemplo.com")` | Desde una línea propia | Deja de poder entrar **y sus sesiones mueren en la siguiente petición**. |
| `activarUsuario("ana@ejemplo.com")` | Desde una línea propia | Vuelve a permitirlo. |
| `revocarSesiones()` | Directa | Echa a todo el mundo (todos tienen que volver a entrar). |

Para dar de alta a alguien: añade la llamada, ejecútala, copia la línea y
añádela a la propiedad `USERS`, separada por comas:

```javascript
function altaAna() {
  generarUsuario("ana@ejemplo.com", "otra-contraseña-larga");
}
```

```
[{"email":"tu@correo.com","hash":"a91f…","active":true},
{"email":"ana@ejemplo.com","hash":"77c2…","active":true}]
```

**No hay roles**: o estás en la lista, o no entras. Quien entra puede ver y
editar todo lo que hay en la carpeta de Drive; no hay permisos por partitura.

**Qué protege esto y qué no.** La puerta está en el servidor, y sin una sesión
válida no se lee ni se escribe en Drive — probado con la aplicación estática
publicada. Pero el sitio en sí es público: cualquiera puede abrir la página y
ver la pantalla de acceso, y lo que no puede es pasar de ahí sin una cuenta de
la lista. Lo que hay que cuidar de verdad es la **cuenta de Google** que ejecuta
el script: es la que tiene las partituras.

---

## 3. Subir el código a GitHub

En la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Partitura Studio"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

> `node_modules/` y `out/` no se suben: ya están excluidos en `.gitignore`.

Antes de empujar, la comprobación de lo que **se va a subir** (no del código,
que eso ya lo comprueba el flujo):

```bash
GH_TOKEN=… npm run publish:check
```

Comprueba tres cosas que se deciden al compilar y que ya no se pueden arreglar
después: que en lo publicado no haya ninguna `SERVICE_KEY`, `SESSION_SECRET`,
`PASSWORD_SALT` ni resto de servidor, y ningún `.env` que se pueda compilar sin
querer; que la **puerta de acceso esté puesta** (si alguien publicó
`LOGIN_REQUIRED=false`, aquí sale en rojo); y que la ruta base y la URL del
backend cuadren con lo que publicará GitHub. Al final sirve el artefacto y
imprime la lista de lo que sólo se puede ver abriendo la página: «Entrar»,
contraseña equivocada, correo fuera de la lista, sincronizar, ventana privada.

Con `GH_TOKEN` lee las variables del repositorio —esas son las que GitHub
incrustará de verdad—; sin ella usa las de este entorno y lo dice, porque si no
coinciden con las de *Settings → Variables*, lo que compruebas no es la
publicación. `--sin-build` comprueba `out/` tal cual está y `--mock` enciende
el doble del backend para probar sin tocar tu Drive.

---

## 4. Encender GitHub Pages

1. En el repositorio: **Settings → Pages**.
2. En *Build and deployment → Source*, elige **GitHub Actions**. (No elijas
   «Deploy from a branch»: el proyecto necesita compilarse, y eso lo hace el
   flujo que viene incluido.)
3. En **Settings → Secrets and variables → Actions → pestaña Variables**, crea
   dos variables de repositorio:

   | Nombre | Valor |
   | --- | --- |
   | `DRIVE_ENDPOINT` | La URL `/exec` del paso 1. |
   | `LOGIN_REQUIRED` | `true` (o déjala sin crear: se pide acceso igual). Sólo `false` quita la puerta. |

   Son *Variables*, no secrets: la URL es pública y la aplicación ya no maneja
   ninguna llave. Poner `LOGIN_REQUIRED` en `false` **quita** la pantalla de
   acceso (sólo tiene sentido en una instalación de una sola persona que no
   comparte la carpeta con nadie); en `true`, en blanco o sin crear, pide acceso.

   La puerta está puesta por defecto, aunque `DRIVE_ENDPOINT` siga vacía: lo que
   faltaría entonces es la dirección del servidor, y la pide la propia pantalla de
   acceso la primera vez. Así un sitio publicado por olvido sale con la puerta
   puesta y la lista de correos autorizados sigue mandando.

4. Vuelve a lanzar la publicación: **Actions → Publicar en GitHub Pages →
   Run workflow** (o haz cualquier cambio y `git push`).
5. Cuando el flujo termine en verde, la dirección aparece en
   **Settings → Pages** y en el resumen del despliegue:

   ```
   https://TU_USUARIO.github.io/TU_REPO/
   ```

   El flujo se encarga del detalle que rompe más publicaciones: si el sitio
   cuelga de `/TU_REPO/`, el `basePath` se resuelve solo con
   `actions/configure-pages`, así que los estilos y el JavaScript cargan en su
   ruta correcta. También crea `out/.nojekyll` y lo sube dentro del artefacto
   (`include-hidden-files: true`, que sin él la acción deja fuera los archivos
   ocultos y el `touch` no serviría de nada), para que Jekyll no ignore la
   carpeta `_next` si algún día se sirve la carpeta de otra forma.

---

## 5. Primer arranque

1. Abre la dirección publicada. Debe aparecer **Entrar**.
2. Escribe el correo y la contraseña del paso 1.4.
3. Entra y crea un ejemplo (*Ejemplo para piano solo*) o importa tu MusicXML.
4. Dibuja algo, espera unos segundos y abre **Drive… → Sincronizar ahora**.
5. Comprueba en Google Drive que existe la carpeta **Partitura Studio** con:

   ```
   Partitura Studio/
     library.json
     scores/<id>/document.json
     scores/<id>/score.musicxml
   ```

6. Prueba en un segundo navegador (o en una ventana privada) entrando con el
   mismo correo: las partituras de Drive deben bajar solas.

Si el paso 5 falla, mira el mensaje exacto en la ventana de **Drive…**: los
errores están escritos para decir qué pasa.

---

## 6. Publicar cambios más adelante

| Qué cambiaste | Qué hay que hacer |
| --- | --- |
| La aplicación (cualquier archivo del proyecto) | `git push`. El flujo compila, pasa las comprobaciones y republica. |
| `apps-script/Code.gs` | Pegarlo en el proyecto de Apps Script **y crear una nueva versión** de la implementación (Implementar → Gestionar implementaciones → ✏️ → Versión: nueva). Sin esto, la URL sigue sirviendo el código viejo. |
| La URL del backend | Cambiar la variable `DRIVE_ENDPOINT` y volver a publicar (se incrusta al construir). |
| Usuarios | Sólo en Apps Script, con las funciones de la sección 2. No hay que republicar nada. |

El flujo de publicación pasa tres comprobaciones antes de publicar y, si alguna
falla, **no publica**:

```bash
npm run typecheck
npm run lint
npm test
```

---

## 7. Probar en local antes de publicar

> La comprobación completa del artefacto —puerta, fugas y ruta base— es
> `npm run publish:check` (ver el final de la sección 3).

```bash
npm install
npm run dev                 # http://localhost:3000
```

La pantalla de acceso sale también en local, con la misma regla que en
publicación: **por defecto hay puerta**, aunque todavía no haya backend. Para
trabajar sin ella hay que apagarla expresamente:

```bash
NEXT_PUBLIC_LOGIN_REQUIRED=false npm run dev
```

Para probar el ciclo completo de Drive sin tocar tu Drive de verdad, arranca el
doble del backend y entra contra él (te da el usuario y la contraseña al
arrancar):

```bash
node tools/mock-apps-script.mjs 4599
# Pantalla de acceso → Dirección del servidor: http://127.0.0.1:4599/exec
# Correo: ana@ejemplo.com   Contraseña: contraseña-de-ana
```

Y para probar el artefacto exacto que se publica (con su `basePath`, sin proceso
de Node detrás):

```bash
npm run build
npm run serve:out -- 4173 /nombre-del-repo
# http://localhost:4173/nombre-del-repo/
```

---

## 8. Si algo no funciona

| Lo que ves | Qué pasa | Qué hacer |
| --- | --- | --- |
| Abres la dirección publicada y sale **Entrar**, con la casilla «Dirección del servidor» vacía | La puerta está puesta —por defecto lo está— pero `DRIVE_ENDPOINT` sigue sin crear, así que aún no hay URL. | No es un fallo: es la puerta esperando al backend. *Settings → Secrets and variables → Actions → Variables* → `DRIVE_ENDPOINT` con tu URL `/exec`, y **Actions → Publicar en GitHub Pages → Re-run all jobs** (la URL se incrusta al construir). Hasta entonces, quien tiene la URL puede escribirla en esa misma casilla. |
| «No se pudo contactar con …» | No se llegó a hablar con el servidor. | Comprueba la URL (`/exec`), que la implementación esté publicada «para cualquiera» y la conexión. Si es una red con proxy, prueba desde otra. |
| «La respuesta no era JSON» | Apps Script devolvió HTML: la implementación está desautorizada o no es pública. | Vuelve a implementar y autoriza; revisa *Quién tiene acceso*. |
| «Correo o contraseña incorrectos» y estás seguro de la contraseña | La propiedad `USERS` no tiene esa línea, el `hash` se cortó al copiar, o la cuenta está desactivada. | Ejecuta `listarUsuarios()`: si aparece con «(desactivado)», `activarUsuario("correo")`; si no está, genera la línea con `generarUsuario` y vuelve a pegar `USERS`. |
| Has olvidado la contraseña | No hay recuperación automática: la contraseña sólo existe como hash. | Genera una línea nueva con `generarUsuario("tu@correo.com", "otra-contraseña")` y **reemplaza** la anterior en `USERS` (esa persona tendrá que volver a entrar). |
| Entra pero todo sale «sesión ha caducado» | Se cambió `SESSION_SECRET` (o se ejecutó `revocarSesiones()`). | Vuelve a entrar. Es el comportamiento correcto. |
| «Demasiados intentos fallidos» | 8 fallos seguidos con ese correo en 15 minutos. | Espera un cuarto de hora. |
| El flujo falla en el paso *Configurar Pages*: `Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions` | Pages todavía no está encendido en el repositorio, o su *Source* no es **GitHub Actions** (con «Deploy from a branch» el flujo entero no tiene sentido). | Es el primer error de una publicación nueva, y no se arregla desde el flujo. Settings → Pages → *Build and deployment → Source* → **GitHub Actions**, y luego **Actions → Publicar en GitHub Pages → Re-run all jobs**. |
| La página sale sin estilos y con 404 en `/_next/...` | El `basePath` no cuadra con la URL. | Comprueba que el *Source* de Pages es **GitHub Actions** y que el flujo terminó en verde. |
| 404 al recargar una ruta interna | Se subió el contenido de `out/` a mano o desde una rama. | Deja que publique el flujo; la aplicación es una sola página y se sirve bien desde el artefacto. |
| «No se han podido guardar los cambios en este navegador» | IndexedDB lleno o navegación privada. | Exporta el `.json` de la partitura y libera espacio; en privado, el almacenamiento no persiste. |
| Drive no tiene la carpeta | La implementación se ejecuta con otra cuenta de Google. | *Ejecutar como* debe ser **Yo**, con la cuenta donde quieres la carpeta. |

Para ver qué está pasando por dentro, en la consola del navegador (sólo en
desarrollo) `__partitura.snapshot()` devuelve herramientas, capas, plantilla y
el estado de la sesión, sin el token.

---

## 9. Desmontarlo

- **Cortar el acceso a una persona**: `desactivarUsuario("correo")`. Sus sesiones
  dejan de valer en la siguiente petición.
- **Expulsar a todo el mundo ahora mismo**: `revocarSesiones()`. Vuelven a
  entrar con su contraseña en cuanto quieran, así que sirve para cortar un
  momento, no para cerrar de forma definitiva.
- **Cerrar de forma definitiva**: en la implementación de Apps Script, cambia
  *Quién tiene acceso* a **Sólo yo** y vuelve a implementar. La URL deja de
  responder a los demás.
- **Apagar el sitio**: Settings → Pages → Unpublish, o borra el repositorio.
- **Ojo con lo que no se borra solo**: los datos siguen en la carpeta de Drive
  (bórrala tú desde Drive) y en el navegador de cada persona (se borran desde
  los ajustes del navegador). Desmontar la aplicación no limpia nada de eso.

Por último: `LOGIN_REQUIRED=false` **no cierra** la puerta, la quita del todo
(es la variable que el flujo convierte en `NEXT_PUBLIC_LOGIN_REQUIRED` al
construir). Sólo tiene sentido en una instalación de una sola persona que
no comparte la carpeta con nadie.
