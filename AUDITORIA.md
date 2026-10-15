# Auditoría — Partitura Studio

**Fecha:** 15 de octubre de 2026
**Alcance:** código completo del repositorio, incluido el trabajo sin commitear de la rama (anclaje de anotaciones, transposición/lectura por instrumento, endurecimiento del backend y de la sincronización multi-cuenta).
**Método:** verificación automática en verde antes de auditar (`typecheck`, `lint`, 154 tests, `build` estático y `publish:check`), tres auditorías independientes en paralelo —seguridad/backend, calidad/arquitectura y UI/UX/accesibilidad— con los hallazgos graves confirmados a mano sobre el código, y criterios de producto premium (neutral-first, una acción primaria, paridad móvil/escritorio) tomados de los skills de diseño del entorno.

---

## 1. Veredicto ejecutivo

**El proyecto está en muy buen estado: sin vulnerabilidades críticas, sin deuda de tipado y con una base de tests (154) que cubre los invariantes difíciles.** Lo que queda no es un rediseño, sino una lista concreta de remiendos: un bug real de sincronización tras deshacer, lecturas de IndexedDB sin captura de errores, un bloqueo de la cuota de Apps Script por login no autenticado, y una capa de accesibilidad funcional (campos sin nombre accesible, lienzo inaccesible con teclado) que hoy impide usar la app con lector de pantalla.

| Área | Veredicto |
|---|---|
| Seguridad y backend | Sólido para su modelo (sesión firmada en servidor, cero secretos en el cliente). Riesgos de **operación/configuración**, no de bypass. |
| Calidad y arquitectura | Muy alta. Cero `any`, cero `@ts-ignore`, cero `TODO/FIXME`. Deuda = tamaño de dos módulos polígono. |
| UI/UX y accesibilidad | Base ejemplar (tokens, foco, diálogos con focus trap). Falta accesibilidad funcional y estados globales de red/sync. |
| Tests y CI | 154/154 en verde; CI con gates, pero **`publish:check` no se ejecuta en CI**. |

---

## 2. Estado de la verificación automática

| Gate | Resultado |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ sin errores |
| `npm run lint` (ESLint 9 flat + Next 16) | ✅ sin avisos |
| `npm test` (runner nativo de Node) | ✅ **154/154**, 4,1 s |
| `npm run build` (export estático) | ✅ 4 páginas generadas |
| `npm run publish:check` (antifugas) | ✅ «Todo en verde: se puede publicar» |

---

## 3. Hallazgos — Seguridad y backend

| # | Sev | Ubicación | Hallazgo e impacto | Recomendación |
|---|-----|-----------|--------------------|---------------|
| S1 | **Medio** | `apps-script/Code.gs:264-268, 714-716` | `sign()` usa `SESSION_SECRET` **vacío si no existe**: HMAC con clave vacía, calculable por cualquiera → sesión forjada para cualquier correo de `USERS`. Precondición: instalar pegando líneas a mano sin `prepararInstalacion`. | Fallar en cerrado si falta el secreto; exigir longitud mínima; test de caso. |
| S2 | **Medio** | `Code.gs:300-312, 203-208` | Rate-limit `read→write` no atómico y `CacheService` eventualmente consistente; **sin límite global de `login`**: un no autenticado agota la cuota diaria de ejecuciones (~54 000) y deja el backend muerto para todos. | Incrementar primero y devolver el contador; techo global; backoff creciente. |
| S3 | **Medio** | `.github/workflows/deploy.yml:64` + `lib/drive.ts:101,126-134` | El destino de login es la **variable** de repo `DRIVE_ENDPOINT`: quien tenga escritura la cambia sin PR y en el siguiente push todos los correos+contraseñas van al Apps Script del atacante. | Pasarla a secreto/entorno con revisores; restringir el allowlist a `script.google.com`. |
| S4 | Medio (diseño) | `Code.gs:150, 336-412` | Autorización plana: cualquier correo activo puede borrar o pisar toda la biblioteca; sin atribución de autor. Documentado a propósito; mitigado por la papelera de Drive. | Confirmación de borrado + bitácora, o avisarlo en la ayuda del script. |
| S5 | Bajo | `Code.gs:180` | `String(error.message)` devuelve errores internos de Drive al cliente autenticado. | Mapear a mensajes genéricos salvo `bad_request`. |
| S6 | Bajo | `Code.gs:199, 280-288` | Sin política de contraseña (admite `"123"`) + SHA-256 de una ronda: si `USERS` se filtra, fuerza bruta instantánea. | Mínimo 12 caracteres; KDF con iteraciones. |
| S7 | Bajo | `lib/sync.ts:197,218` + `store.ts:718` | Carrera: borrar durante una sync en vuelo puede perder la lápida al sobrescribir `syncState` → la partitura borrada «resucita». | Fusionar lápidas (`union`) al guardar. |
| S8 | Bajo | `tools/publish-check.mjs:149-153` + `deploy.yml` | El detector de fugas imprime **±30 caracteres alrededor del secreto** y `publish:check` **no corre en CI**. | Imprimir sólo fichero+patrón; añadirlo al workflow. |
| S9 | Bajo | `tools/serve-out.mjs:44,80` | `GET /%ZZ` mata el proceso (`decodeURIComponent` sin capturar); `listen` en 0.0.0.0. | try/catch y `127.0.0.1`. |
| S10 | Bajo | `deploy.yml:23,25,42` | Acciones ancladas a tags móviles (`@v7`), sin `persist-credentials:false` ni Dependabot. | Anclar a SHA; añadir Dependabot. |
| S11 | Bajo | `Code.gs:425-441` | `library.json` corrupto → `readIndex` devuelve `[]` y el siguiente `put` reescribe el índice con una sola partitura (el test sólo cubre una). | Reconstruir el índice desde `scores/`. |
| S12 | Info | `lib/auth.ts:34,77` + `Workspace.tsx:178` | La sesión (30 días) vive en `localStorage`; la puerta se salta con `localOnly`. **Sin impacto remoto**: sólo da acceso a los datos locales de ese equipo. Límite de diseño asumible. | Documentarlo. |
| S13 | Info | `.gitignore:13` | Se ignora `.freebuff/` pero no `.freebuff-logs/`. | Añadir la línea (hecho en este commit). |

**Controles validados (verificados leyendo el código):** comparación constante de HMAC y caducidad/desactivación en cada petición; mensajes idénticos para correo inexistente y contraseña errónea (sin enumeración); `requireId` `^[A-Za-z0-9_-]{3,120}$` sin path traversal; topes 20 MB antes de escribir con `LockService` (el diff sin commitear añade esto y no deja agujeros); zip bomb frenada por `originalSize` declarado **antes** de descomprimir; `normalizeDocument` reconstruye campo a campo y descarta `__proto__` (sin prototype pollution); endpoint https obligatorio con dominio Google; sin `dangerouslySetInnerHTML`, sin cookies (CSRF no aplica); saneado de todo lo que baja de Drive antes de persistir.

---

## 4. Hallazgos — Calidad y arquitectura

| # | Sev | Ubicación | Hallazgo e impacto | Recomendación |
|---|-----|-----------|--------------------|---------------|
| C1 | **Alto** | `lib/store.ts:1331-1361, 1322-1329` | **Confirmado a mano:** `undo`, `redo` y `setActiveLayer` hacen `set({doc})` sin actualizar `meta.updatedAt` (que sí sella `edit()` en `store.ts:331`). Como `sync.ts:253` decide «sin cambios» por fecha, **deshacer tras sincronizar deja el cambio sin subir a Drive, silenciosamente**. | Helper único `setDoc(patch)` que siempre sella `updatedAt`; pasar esas mutaciones por él; test de regresión en `tests/store.test.mjs`. |
| C2 | **Alto** | `store.ts:435-447, 449-482, 566-574` | `refreshLibrary`/`openScore`/`removeScore` sin `try/catch` (las escrituras sí lo tienen) y llamadas como `void` → en modo privado/cuota agotada, pantalla de carga infinita o botón muerto. | Capturar → aviso de lectura y `ready:true` en `finally`. |
| C3 | Medio | `components/ScoreCanvas.tsx:1185` | La marca del trazo seleccionado usa `stroke.points` (píxeles guardados) en vez de `pointsOf(stroke)` (anclado) → desalineada tras transponer u ocultar una parte. | Usar `pressureOutline(pointsOf(stroke), …)`. |
| C4 | Medio | `ScoreCanvas.tsx:668-701` | La goma recalcula `strokePoints` por cada `pointermove` ignorando el memo `strokeView` → O(trazos×puntos) a 60 Hz en partituras grandes. | Alimentar la goma desde `strokeView`. |
| C5 | Medio | `ScoreCanvas.tsx:234-362` + `store.ts:867-881` | `adoptDeclaredReadings` re-dispara el efecto → **doble carga y render de OSMD** al abrir un archivo con `<transpose>` declarado. | Adoptar tras el primer render (ref/flag por `scoreId`). |
| C6 | Medio | `ScoreCanvas.tsx:267-304` | Cada re-ejecución crea un `OpenSheetMusicDisplay` nuevo sin `clear()`/dispose del anterior. | Dispose en el cleanup. |
| C7 | Medio | `ScoreCanvas.tsx:1638 líneas`; `store.ts:1415` | Módulos polígono: lienzo = maquetación+gestos+hit-testing+overlay; store = documento+historial+Drive+reproducción+sesión. | Extraer `lib/hitTest.ts`, `useCanvasGestures`, `AnnotationOverlay`; dividir el store en slices conservando la API pública. |
| C8 | Medio | `ScoreCanvas.tsx:381-406` | El efecto del `ResizeObserver` depende de `doc` → se recrea en cada trazo. | Depender de `doc.meta.id`. |
| C9 | Medio | `store.ts:466-501, 515-530` | Bloque de reset de documento duplicado en tres sitios → un campo nuevo se olvida fácilmente. | `resetDocState(doc): Partial<StoreState>`. |
| C10 | Bajo | `store.ts:523+` | `scheduleSave()` se ejecuta aunque `edit()` devuelva `{}` → guardados y autosync innecesarios. | Saltar si no cambió nada. |
| C11 | Bajo | `ScoreCanvas.tsx:61` vs `store.ts:762`; tres casts estructurales del cursor de OSMD (`:417,433,591`); `window.__partitura` sin borrar al desmontar (`:456-570`). | Constantes compartidas; una interfaz `OSMDLike`; `delete` en cleanup. |

**Fortalezas:** cero `any`/`@ts-ignore`/`TODO`; la frontera OSMD se tipa con `unknown` + `OSMDOwner`; guardas SSR coherentes (`typeof window`) y reproductor perezoso; todos los `addEventListener` verificados tienen `cleanup` y el rAF se cancela; `normalizeDocument` sanea ids duplicados, `__proto__` y bomba de descompresión; `saveNow` reprograma si hay escritura en curso. **El código nuevo (`lib/anchors.ts`, `lib/transpose.ts`) es el mejor del repo**: coheso, documentado por invariantes y con tests. La deuda es de tamaño, no de tipado.

---

## 5. Hallazgos — UI/UX y accesibilidad

| # | Sev | Ubicación | Hallazgo e impacto | Recomendación |
|---|-----|-----------|--------------------|---------------|
| U1 | **Alto** | `AnnotationsPanel.tsx:856-865, 913-919` | `Field` es un `div`, no `<label>`: «Digitación», «Técnica», «Armonía», «Nota» y «Etiquetas» no tienen nombre accesible (sólo placeholder). | Asociar con `htmlFor`/`id` o `aria-label`. |
| U2 | **Alto** | `ScoreCanvas.tsx:1105-1115` | El overlay SVG sin `role`/`aria-label`; las anotaciones sólo existen con puntero (los atajos sólo cambian de herramienta). | `role="img"` + descripción; ruta de teclado para seleccionar compases y anotar. |
| U3 | **Alto** | `store.ts:586-594` | Sin listeners `online/offline` ni indicador global de red; `refreshRemote` traga errores → el usuario no sabe que trabaja offline. | Banner persistente «Sin conexión · guardado local» + reintento al volver. |
| U4 | **Alto** | `ScoreCanvas.tsx:847,868`; `Toolbar.tsx:151-164` | Dibujar en capa bloqueada falla en silencio (`return`) y el aviso está `hidden sm:block` → invisible en móvil. | Toast/aviso inline accesible en móvil. |
| U5 | Medio | `globals.css:190-194` | `:focus-visible { border-radius: 4px }` vence a `rounded-full`: el play se cuadra con teclado. | Eliminar esa declaración. |
| U6 | Medio | `TransportBar.tsx:94`; `DriveDialog.tsx:110-121` | Con `viewport-fit=cover`, barra de transporte y hoja inferior sin `safe-bottom` → controles bajo la barra de gestos. | Añadir `.safe-bottom`. |
| U7 | Medio | `AnnotationsPanel.tsx:31-36` | Chip «Sin marcar» activo ≈ 2,3:1 de contraste. | Fondo `bg-ink` o no rellenar. |
| U8 | Medio | `ScoreCanvas.tsx:1314-1327` | «Dibujando la partitura…»/«No se pudo dibujar» sin `role`/`aria-live` ni reintento. | `role="status"`/`alert` + botón «Reintentar». |
| U9 | Medio | `LibraryView.tsx:296-306`; `ScoreView.tsx:357-368` | Error de sync sin `role="alert"`; en el editor sólo en `title` → invisible en táctil. | Banner con `role="alert"` en ambas vistas. |
| U10 | Medio | `lib/sync.ts:353-361`; `DriveDialog.tsx:291-296` | Se promete aviso de conflicto pero sólo aparece «N conflicto(s)», sin partitura ni acción. | Lista con nombre, versiones y «conservar local/remoto». |
| U11 | Medio | `DriveDialog.tsx:177-185` | Checkbox «Sincronizar solo»: copia ambigua sobre `autoSync`. | «Sincronizar automáticamente al haber cambios». |
| U12 | Medio | `LayerPanel.tsx:188,238…`; `ScoreCanvas.tsx:1469` | Targets de 16-28 px frente al `touch-target` de 40 px aplicado sólo en algunos sitios. | Aplicar sistemáticamente bajo `pointer:coarse`. |
| U13 | Medio | `ScoreView.tsx:305-309` | «guardando…» sólo visible en `xl:`; en móvil sólo existe el `sr-only`. | Señal visible compacta en todos los tamaños. |
| U14 | Medio | `LoginView.tsx:157-233` | En móvil el panel de marca empuja el formulario bajo el pliegue. | Formulario primero (< lg). |
| U15 | Medio | `ScoreView.tsx:378` | «Sincronizar ahora» con `hidden={!syncMessage}` → sin control de sync hasta que hay mensaje. | Mostrar siempre con sesión válida. |
| U16 | Medio | `AnnotationsPanel.tsx:191,660…` | Cuerpo a 10 px sobre táctil. | Mínimo 12 px en móvil. |
| U17-Bajo | | `AnnotationsPanel.tsx:44-48` (flechas de pestaña sin mover foco), `:132-147` («Plantilla» sin `aria-expanded`), `LibraryView.tsx:60` y `LayerPanel.tsx:302` (`confirm()` nativo), `Toolbar.tsx:52`/`LibraryView.tsx:256` vs `LoginView.tsx:357` (sombras y CTA one-off: tinta en biblioteca, azul en login), `LibraryView.tsx:362` (recuento sin `aria-live`). | Roving tabindex; `aria-expanded`; diálogo propio con deshacer; tokens y una sola convención de primario; `aria-live="polite"`. |

**Fortalezas:** tokens documentados con contraste justificado (`globals.css:3-31`); `:focus-visible` global y `prefers-reduced-motion`; diálogos con focus trap, Escape, restauración de foco e `inert` (nivel senior); estados vacíos con siguiente paso; ErrorBoundary que protege los datos; corte móvil sincronizado con `matchMedia`, `100dvh`, safe-areas y `pointer:coarse` para hover; atajos documentados y neutralizados al escribir.

---

## 6. Plan de acción priorizado

**P1 — corregir antes de dar por cerrada la release**
1. C1: sellar `updatedAt` en `undo`/`redo`/`setActiveLayer` (+ test de regresión).
2. C2: `try/catch` en las lecturas del store (`refreshLibrary`/`openScore`/`removeScore`).
3. S1: `sign()` en cerrado si falta `SESSION_SECRET` (+ test).
4. S2: rate-limit atómico y techo global de `login`.
5. S3: `DRIVE_ENDPOINT` a secreto/entorno con allowlist estricta.
6. U1, U3, U4: nombres accesibles en el panel, banner offline, aviso de capa bloqueada en móvil.

**P2 — remiendos baratos de alto valor**
7. C3-C6, C8: remiendos de ScoreCanvas (`pointsOf` en la marca, goma sobre `strokeView`, deps del ResizeObserver, dispose de OSMD, evitar doble render).
8. U5, U6, U7, U8, U9, U13, U15: foco, safe-area, contraste, `role="status"/"alert"`, señales de guardado y sync visibles en móvil.
9. S5, S6, S8, S10: mensajes genéricos, política de contraseñas, `publish:check` en CI, acciones ancladas a SHA.

**P3 — deuda estructural**
10. C7: extraer de ScoreCanvas y dividir el store en slices.
11. U10, U11, U12, U14, U16, U17: UX de conflictos, targets táctiles, tipografía móvil, login móvil, `confirm()` nativo, coherencia de tokens.
12. S7, S9, S11: fusionar lápidas, endurecer `serve-out`, reconstruir índice desde `scores/`.

---

## 7. Anexo — cómo se hizo esta auditoría

1. Se cargaron los skills de diseño/producto del entorno (`saas-product-ui-system`, `ui-ux-design-system`) y se fijaron sus criterios (neutral-first, jerarquía antes que decoración, estados reales, paridad móvil/escritorio, a11y).
2. Se ejecutaron los cinco gates de verificación (sección 2) **antes** de auditar, para no reportar como problema lo que ya fallaría en CI.
3. Tres auditorías independientes en paralelo (seguridad/backend, calidad/arquitectura, UI/UX), cada una con acceso de lectura al código y obligación de citar `archivo:línea`.
4. El hallazgo de mayor impacto (C1) se verificó personalmente contra el código (`store.ts:331` sella; `store.ts:1331-1361` no) antes de publicarlo como confirmado; `reanchor` (`store.ts:883-921`) **no** sella `updatedAt` a propósito — hay test que documenta que normalizar no es una edición — así que queda fuera del bug.
5. Este informe cubre también el trabajo que estaba sin commitear en la rama, que se versiona junto con él: gates en verde y sin regresiones conocidas.
