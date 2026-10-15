/**
 * Pruebas del anclaje de anotaciones (`lib/anchors.ts`).
 *
 * Lo que se prueba aquí es lo que sostiene las funciones grandes: que una
 * anotación no se despegue de la música cuando la partitura se re-maqueta
 * (transponer, ocultar una parte, cambiar el ancho de papel).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorForPin,
  anchorOf,
  anchorPoints,
  anchorsFor,
  needsAnchoring,
  pinBelongsToPart,
  pinPoint,
  pointOf,
  strokeBelongsToPart,
  strokePartIds,
  strokePoints,
} from "../lib/anchors.ts";

/**
 * Partitura de prueba: cuatro compases, dos por sistema, con saxo (pentagrama
 * 0) y piano (pentagramas 1 y 2). Es la plantilla del trío de ejemplo.
 */
function makeExtent({ systemY = 0, staffHeight = 30, width = 100 } = {}) {
  const boxes = [];
  const staffBoxes = [];
  for (const measureIndex of [0, 1, 2, 3]) {
    const y = measureIndex < 2 ? systemY : systemY + 200;
    const x = measureIndex % 2 === 0 ? 0 : width;
    boxes.push({
      measureIndex,
      measureNumber: String(measureIndex + 1),
      x,
      y,
      width,
      height: staffHeight * 3,
    });
    for (const staffIndex of [0, 1, 2]) {
      staffBoxes.push({
        measureIndex,
        staffIndex,
        partId: staffIndex === 0 ? "P1" : "P2",
        x,
        y: y + staffIndex * staffHeight,
        width,
        height: staffHeight,
      });
    }
  }
  return {
    boxes,
    staffBoxes,
    parts: [
      { id: "P1", name: "Saxo", abbreviation: "", staffIndices: [0] },
      { id: "P2", name: "Piano", abbreviation: "", staffIndices: [1, 2] },
    ],
    width: width * 2,
    height: 290,
  };
}

const stroke = (points, extra = {}) => ({
  id: "s1",
  points,
  color: null,
  width: 2,
  opacity: 1,
  tool: "pencil",
  createdAt: 0,
  ...extra,
});

test("un punto sobre un pentagrama se ancla a ese pentagrama, no al compás", () => {
  const extent = makeExtent();
  // (50, 15) cae dentro del pentagrama 0 (saxo) del compás 0.
  assert.deepEqual(anchorOf(extent, 50, 15), { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 });
  // (150, 75) cae en el segundo pentagrama del piano (ordinal 1) del compás 1.
  assert.deepEqual(anchorOf(extent, 150, 75), { m: 1, p: "P2", o: 1, u: 0.5, v: 0.5 });
});

test("anclar y volver a colocar devuelve el mismo píxel", () => {
  const extent = makeExtent();
  for (const [x, y] of [
    [50, 15],
    [150, 75],
    [12, 205],
    [99, 89],
  ]) {
    const anchor = anchorOf(extent, x, y);
    assert.ok(anchor, `debería anclarse (${x}, ${y})`);
    const back = pointOf(extent, anchor);
    assert.ok(Math.abs(back.x - x) < 1e-9, `x: ${back.x} vs ${x}`);
    assert.ok(Math.abs(back.y - y) < 1e-9, `y: ${back.y} vs ${y}`);
  }
});

test("un punto en el margen también sigue a la música", () => {
  const extent = makeExtent();
  // Por encima del primer sistema (donde van las digitaciones)…
  const above = anchorOf(extent, 50, -18);
  assert.equal(above?.m, 0);
  assert.equal(above?.p, "P1", "se ancla al pentagrama más cercano, no al compás");
  assert.equal(above?.o, 0);
  assert.ok(above.v < 0, "por encima del pentagrama: v negativa");
  assert.ok(Math.abs(pointOf(extent, above).y - -18) < 1e-9);

  // …y muy lejos, en el margen izquierdo. Antes se quedaba sin ancla.
  const far = anchorOf(extent, -400, 100);
  assert.ok(far, "fuera de la partitura también se ancla");
  assert.ok(Math.abs(pointOf(extent, far).x - -400) < 1e-9);
});

test("al transponer (cambian de sitio y de ancho los compases) la tinta viaja con la música", () => {
  const before = makeExtent();
  const anchor = anchorOf(before, 50, 15);
  assert.deepEqual(anchor, { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 });

  // Transposición: el compás 0 pasa a ocupar 120 px y el sistema baja 40.
  const after = makeExtent({ systemY: 40, width: 120 });
  const moved = pointOf(after, anchor);
  assert.equal(moved.x, 60, "centro del compás, que ahora es más ancho");
  assert.equal(moved.y, 40 + 0.5 * 30, "centro del pentagrama, en su nueva altura");
});

test("al ocultar una parte, las anotaciones de las demás siguen en SU pentagrama", () => {
  const extent = makeExtent();
  const onSax = anchorOf(extent, 50, 15);
  const onPiano = anchorOf(extent, 50, 75);
  // Se identifica la parte, no el índice: el piano es P2, pentagrama ordinal 1.
  assert.equal(onSax.p, "P1");
  assert.equal(onPiano.p, "P2");
  assert.equal(onPiano.o, 1);

  // Se oculta el saxo: OSMD renumera los pentagramas que quedan (0 y 1) y P1
  // se queda sin ninguno, que es justo lo que rompía el índice global.
  const hidden = makeExtent();
  hidden.staffBoxes = hidden.staffBoxes
    .filter((box) => box.staffIndex !== 0)
    .map((box) => {
      const staffIndex = box.staffIndex - 1;
      return {
        ...box,
        staffIndex,
        y: (box.measureIndex < 2 ? 0 : 200) + staffIndex * 30,
      };
    });
  hidden.parts = [
    { id: "P1", name: "Saxo", abbreviation: "", staffIndices: [] },
    { id: "P2", name: "Piano", abbreviation: "", staffIndices: [0, 1] },
  ];

  // El piano sigue donde estaba: la renumeración no lo ha movido.
  const pianoPoint = pointOf(hidden, onPiano);
  assert.equal(pianoPoint.y, 45, "el pentagrama ordinal 1 sigue siendo el mismo");

  // Y la del saxo no salta al piano: cae sobre el compás, que es lo único
  // honesto que se puede decir de una parte que ya no está dibujada.
  const fallback = pointOf(hidden, onSax);
  assert.ok(fallback, "una parte oculta no borra anotaciones");
  assert.equal(fallback.y, 45, "centro del compás: la caja del saxo ya no existe");
  assert.ok(
    fallback.y >= 0 && fallback.y <= 90,
    "y dentro del compás, no en cualquier parte del papel",
  );
});

test("strokePoints resuelve el trazo anclado y deja intacto el documento antiguo", () => {
  const extent = makeExtent();
  const points = [
    { x: 50, y: 15, p: 0.5 },
    { x: 60, y: 20, p: 0.8 },
  ];

  // Documento antiguo: sin anclas, los píxeles son la verdad.
  const legacy = stroke(points);
  assert.equal(strokePoints(legacy, extent), legacy.points);

  // Documento anclado: se recalcula con la maquetación que le pasemos.
  const anchored = stroke(points, { anchors: anchorPoints(points, extent) });
  const same = strokePoints(anchored, extent);
  assert.ok(Math.abs(same[0].x - 50) < 1e-9 && Math.abs(same[0].y - 15) < 1e-9);
  assert.equal(same[1].p, 0.8, "la presión sobrevive a la resolución");

  const wider = makeExtent({ width: 200 });
  const moved = strokePoints(anchored, wider);
  assert.equal(moved[0].x, 100, "el trazo se recoloca con el compás");
  assert.equal(moved[1].p, 0.8);
});

test("un trazo sin resolver por falta de maquetación devuelve lo guardado, no una invención", () => {
  const extent = makeExtent();
  const points = [{ x: 50, y: 15, p: 0.5 }];
  const anchored = stroke(points, { anchors: anchorPoints(points, extent) });
  const empty = { boxes: [], staffBoxes: [], parts: [], width: 0, height: 0 };
  assert.equal(strokePoints(anchored, empty), anchored.points);
});

test("anchorsFor completa un documento antiguo con la maquetación actual", () => {
  const extent = makeExtent();
  const points = [
    { x: 50, y: 15, p: 0.5 },
    { x: 150, y: 75, p: 0.5 },
  ];
  const legacy = stroke(points);
  const anchors = anchorsFor(legacy, extent);
  assert.equal(anchors.length, 2);
  assert.deepEqual(anchors[0], { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 });
  assert.deepEqual(anchors[1], { m: 1, p: "P2", o: 1, u: 0.5, v: 0.5 });

  // Un trazo que YA trae anclas no se vuelve a anclar: son su fuente de verdad,
  // y recalcularlas con otra maquetación sería justo el error que evitamos.
  const stored = [{ m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 }];
  const already = stroke(points, { anchors: stored });
  assert.equal(anchorsFor(already, makeExtent({ width: 200 })), stored);

  // Sin partitura medida no se inventa nada.
  const empty = { boxes: [], staffBoxes: [], parts: [], width: 0, height: 0 };
  assert.equal(anchorsFor(legacy, empty), null);
});

test("needsAnchoring dice si hay trabajo sin recorrer capas enteras", () => {
  const extent = makeExtent();
  const legacy = stroke([{ x: 50, y: 15, p: 0.5 }]);
  const anchored = stroke([{ x: 50, y: 15, p: 0.5 }], {
    anchors: anchorPoints([{ x: 50, y: 15, p: 0.5 }], extent),
  });
  const pin = (extra) => ({
    id: "p1",
    x: 50,
    y: 15,
    measureIndex: 0,
    messages: [],
    resolved: false,
    createdAt: 0,
    ...extra,
  });

  assert.equal(needsAnchoring([legacy], []), true);
  assert.equal(needsAnchoring([], [pin()]), true);
  assert.equal(
    needsAnchoring([anchored], [pin({ anchor: { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 } })]),
    false,
  );
});

test("una anotación dice de qué parte es por dónde está, sin campos de más", () => {
  const extent = makeExtent();
  const points = [
    { x: 20, y: 15, p: 0.5 }, // saxo (P1)
    { x: 30, y: 15, p: 0.5 }, // saxo (P1)
    { x: 40, y: 75, p: 0.5 }, // piano (P2)
  ];
  const cruzando = stroke(points, { anchors: anchorPoints(points, extent) });
  assert.deepEqual(strokePartIds(cruzando).sort(), ["P1", "P2"]);

  // Centrado en el saxo: un trazo que TOCA el saxo se ve (es de los dos).
  assert.equal(strokeBelongsToPart(cruzando, "P1"), true);
  assert.equal(strokeBelongsToPart(cruzando, "P2"), true);
  // Centrado en el bajo, que no aparece por aquí, no.
  assert.equal(strokeBelongsToPart(cruzando, "P3"), false);

  // Un documento sin anclar no se esconde: no se sabe de quién es.
  assert.equal(strokeBelongsToPart(stroke(points), "P3"), true);

  // Los comentarios, igual, y uno anclado al compás entero (sin parte) se ve.
  const pin = (anchor) => ({
    id: "p1",
    x: 20,
    y: 15,
    measureIndex: 0,
    anchor,
    messages: [],
    resolved: false,
    createdAt: 0,
  });
  assert.equal(pinBelongsToPart(pin({ m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 }), "P1"), true);
  assert.equal(pinBelongsToPart(pin({ m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 }), "P2"), false);
  assert.equal(pinBelongsToPart(pin({ m: 0, p: null, o: 0, u: 0.5, v: 0.5 }), "P2"), true);
  assert.equal(pinBelongsToPart(pin(undefined), "P2"), true);
});

test("los comentarios se recolocan igual que la tinta", () => {
  const extent = makeExtent();
  const pin = {
    id: "p1",
    x: 50,
    y: 15,
    measureIndex: 0,
    messages: [],
    resolved: false,
    createdAt: 0,
  };
  const anchor = anchorForPin(pin, extent);
  assert.deepEqual(anchor, { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 });

  const wider = makeExtent({ width: 200 });
  const moved = pinPoint({ ...pin, anchor }, wider);
  assert.equal(moved.x, 100, "el comentario se va con su compás");

  // Documento antiguo sin ancla: se queda donde estaba, sin saltar.
  assert.deepEqual(pinPoint(pin, wider), { x: 50, y: 15 });
});
