/**
 * Pruebas del almacén de estado (`lib/store.ts`).
 *
 * El store es el corazón de la aplicación y hasta ahora no tenía ninguna
 * prueba: lo que se probaba era la lógica de `lib/` que no depende del estado
 * —geometría, sincronización, MusicXML, sesión—. Estos casos cubren tres cosas
 * que ya se rompieron o que era fácil romper sin enterarse:
 *
 *  1. Que editar el título de una partitura pase por el autoguardado. Se
 *     editaba con un `setState` suelto desde el componente, así que el cambio
 *     no marcaba `pendingSave` y sólo se salvaba si el navegador avisaba al
 *     cerrar la pestaña.
 *  2. Que mover un pin actualice el compás al que ha ido a parar, sin borrarlo
 *     cuando el movimiento es de unos píxeles dentro del mismo compás.
 *  3. Que una capa bloqueada siga siendo intocable desde el almacén —mover,
 *     borrar y recibir trazos—, que es lo único que el bloqueo promete.
 *
 * El store se importa tal cual: `loadAuth` y `loadSyncState` ya devuelven su
 * estado vacío cuando no hay `window`, así que se puede ejercitar en Node sin
 * navegador. Lo único que se sustituye es `saveNow`, para poder comprobar que
 * el autoguardado *llama* sin tocar IndexedDB.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { useStore } from "../lib/store.ts";
import { makeLayer, uid } from "../lib/types.ts";

function makeDoc(layers) {
  const list = layers ?? [makeLayer("Mis anotaciones", 0)];
  return {
    meta: {
      id: uid("score"),
      title: "Estudio",
      composer: "",
      instrumentation: "",
      source: "musicxml",
      createdAt: 1,
      updatedAt: 1,
    },
    xml: "<score-partwise/>",
    layers: list,
    activeLayerId: list[0].id,
  };
}

function makeStroke(id) {
  return {
    id,
    points: [
      { x: 0, y: 0, p: 0.5 },
      { x: 10, y: 10, p: 0.5 },
    ],
    color: null,
    width: 2.4,
    opacity: 1,
    tool: "pencil",
    createdAt: 1,
  };
}

function makePin(id, x = 10, y = 20, measureIndex = 2) {
  return {
    id,
    x,
    y,
    measureIndex,
    messages: [],
    resolved: false,
    createdAt: 1,
  };
}

/** Deja el store con un documento y un `saveNow` que sólo cuenta llamadas. */
function withDoc(doc, { saves } = {}) {
  const original = useStore.getState().saveNow;
  useStore.setState({
    doc,
    activeLayerId: doc.activeLayerId,
    pendingSave: false,
    saveError: "",
    saveNow: async () => {
      if (saves) saves.count += 1;
    },
  });
  return original;
}

function restore(original) {
  useStore.setState({
    doc: null,
    pendingSave: false,
    saveNow: original,
    past: [],
    future: [],
    selectedPinId: null,
  });
}

test("editar el título pasa por el autoguardado: antes se podía perder", async () => {
  const doc = makeDoc();
  const saves = { count: 0 };
  const original = withDoc(doc, { saves });

  useStore.getState().setMeta({ title: "Sonata en Do" });

  const state = useStore.getState();
  assert.equal(state.doc.meta.title, "Sonata en Do");
  assert.ok(
    state.doc.meta.updatedAt > 1,
    "el documento tiene que parecer modificado, o la sincronización no lo subiría",
  );
  // La marca es lo que consulta el aviso al cerrar la pestaña, y lo que hace
  // que el autoguardado entre en juego.
  assert.equal(state.pendingSave, true);

  // Y el autoguardado llega de verdad, sin haber tocado ninguna otra cosa.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(saves.count, 1, "el cambio tiene que acabar escribiéndose solo");

  restore(original);
});

test("mover un pin cambia su sitio y el compás al que va a parar", () => {
  const layer = makeLayer("Comentarios", 0);
  layer.pins = [makePin("pin_1")];
  const doc = makeDoc([layer]);
  const original = withDoc(doc);

  useStore.getState().movePin("pin_1", 100, 200, 7);
  let pin = useStore.getState().doc.layers[0].pins[0];
  assert.deepEqual([pin.x, pin.y, pin.measureIndex], [100, 200, 7]);

  // Sin compás de destino no se toca: un arrastre de unos píxeles dentro del
  // mismo compás dejaría el comentario sin compás si se sobrescribiera con
  // `undefined`.
  useStore.getState().movePin("pin_1", 101, 201);
  pin = useStore.getState().doc.layers[0].pins[0];
  assert.deepEqual([pin.x, pin.y, pin.measureIndex], [101, 201, 7]);

  // Fuera del papel (arrastrado al margen): se queda sin compás, no con el
  // viejo, que ya sería mentira.
  useStore.getState().movePin("pin_1", 5, 5, null);
  pin = useStore.getState().doc.layers[0].pins[0];
  assert.equal(pin.measureIndex, null);
  assert.deepEqual([pin.x, pin.y], [5, 5]);

  restore(original);
});

test("una capa bloqueada no se mueve, no se borra y no recibe trazos", () => {
  const locked = makeLayer("Director", 1);
  locked.locked = true;
  locked.pins = [makePin("pin_locked", 30, 40, 5)];
  locked.strokes = [makeStroke("stroke_locked")];

  const mine = makeLayer("Mis anotaciones", 0);
  mine.strokes = [makeStroke("stroke_mine")];
  mine.pins = [makePin("pin_mine", 1, 1, 0)];

  const doc = makeDoc([mine, locked]);
  doc.activeLayerId = mine.id;
  const original = withDoc(doc);

  // Mover el pin de la capa bloqueada: se queda donde estaba.
  useStore.getState().movePin("pin_locked", 999, 999, 42);
  const keptPin = useStore.getState().doc.layers.find((l) => l.id === locked.id).pins[0];
  assert.deepEqual([keptPin.x, keptPin.y, keptPin.measureIndex], [30, 40, 5]);

  // La goma borra lo de la capa propia y respeta la bloqueada.
  useStore.getState().removeStrokes(["stroke_mine", "stroke_locked"]);
  const layers = useStore.getState().doc.layers;
  assert.deepEqual(
    layers.find((l) => l.id === mine.id).strokes.map((s) => s.id),
    [],
  );
  assert.deepEqual(
    layers.find((l) => l.id === locked.id).strokes.map((s) => s.id),
    ["stroke_locked"],
  );

  // Y no se puede colar un trazo dentro de una capa bloqueada.
  useStore.getState().moveStrokeToLayer("stroke_mine", locked.id);
  assert.equal(
    useStore.getState().doc.layers.find((l) => l.id === locked.id).strokes.length,
    1,
    "un trazo no entra en una capa bloqueada",
  );

  restore(original);
});

/**
 * Una petición de guardado que llega mientras se está escribiendo NO se puede
 * perder.
 *
 * El autoguardado es un temporizador: si escribe y, mientras la escritura está
 * en el aire, otro cambio pide guardar, el temporizador de ese segundo cambio ya
 * se ha consumido. Antes, `saveNow` se apartaba sin más cuando ya había una
 * escritura en curso, así que ese cambio se quedaba sin escribir hasta el
 * siguiente cambio (puede que ninguno) o hasta cerrar la pestaña, que es cuando
 * más caro sale perderlo.
 *
 * En Node no hay IndexedDB, así que la escritura acaba en `saveError` —que es
 * también lo que se comprueba: un fallo de guardado se dice y NO apaga el aviso
 * de «hay cambios sin guardar»—. Lo que importa de la prueba es la cola.
 */
test("un guardado que llega mientras se escribe se vuelve a poner en cola", async () => {
  const doc = makeDoc();
  const original = useStore.getState().saveNow;
  useStore.setState({
    doc,
    activeLayerId: doc.activeLayerId,
    pendingSave: false,
    saving: false,
    saveError: "",
  });

  const first = useStore.getState().saveNow();
  assert.equal(useStore.getState().saving, true, "la primera escritura arranca");

  // Esta es la que antes desaparecía sin dejar rastro.
  void useStore.getState().saveNow();
  assert.equal(
    useStore.getState().pendingSave,
    true,
    "el cambio tiene que quedar apuntado para volver a intentarlo",
  );

  await first;
  const state = useStore.getState();
  assert.equal(state.saving, false);
  // El fallo se cuenta, y el aviso de «sin guardar» sigue en pie: hay trabajo
  // que no ha llegado al disco.
  assert.match(state.saveError, /no se han podido guardar|exporta el \.json/i);
  assert.equal(state.pendingSave, true);

  restore(original);
});

/** Partitura mínima medida: un compás, un pentagrama del saxo. */
function makeExtent() {
  return {
    boxes: [{ measureIndex: 0, measureNumber: "1", x: 0, y: 0, width: 100, height: 30 }],
    staffBoxes: [
      { measureIndex: 0, staffIndex: 0, partId: "P1", x: 0, y: 0, width: 100, height: 30 },
    ],
    parts: [{ id: "P1", name: "Saxo", abbreviation: "", staffIndices: [0] }],
    width: 100,
    height: 30,
  };
}

test("un trazo nuevo se guarda anclado, no en píxeles absolutos", () => {
  const doc = makeDoc();
  const original = withDoc(doc);
  useStore.setState({ extent: makeExtent() });

  useStore
    .getState()
    .commitStroke({ ...makeStroke("stroke_1"), points: [{ x: 50, y: 15, p: 0.5 }] });

  const stroke = useStore.getState().doc.layers[0].strokes[0];
  assert.deepEqual(stroke.anchors, [{ m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 }]);

  restore(original);
});

test("un documento anterior al anclaje se normaliza, y normalizar no es una edición", () => {
  const layer = makeLayer("Mis anotaciones", 0);
  layer.strokes = [makeStroke("stroke_legacy")];
  layer.pins = [makePin("pin_legacy")];
  const original = withDoc(makeDoc([layer]));
  useStore.setState({ extent: makeExtent(), past: [], future: [] });

  // Llegó de una versión sin anclas.
  assert.equal(useStore.getState().doc.layers[0].strokes[0].anchors, undefined);

  useStore.getState().reanchor();

  const stroke = useStore.getState().doc.layers[0].strokes[0];
  assert.equal(stroke.anchors.length, 2, "un ancla por punto");
  assert.equal(stroke.anchors[0].m, 0);
  assert.equal(stroke.anchors[0].p, "P1");
  const pin = useStore.getState().doc.layers[0].pins[0];
  assert.ok(pin.anchor, "los comentarios también se anclan");

  // Es una normalización del formato, no una edición de nadie: si entrara en el
  // historial, la primera pulsación de «deshacer» no desharía nada tuyo.
  assert.equal(useStore.getState().past.length, 0);

  // Con la partitura ya anclada no se reescribe nada: ni copias ni avisos.
  const before = useStore.getState().doc.layers[0].strokes[0];
  useStore.getState().reanchor();
  assert.equal(useStore.getState().doc.layers[0].strokes[0], before);

  restore(original);
});
