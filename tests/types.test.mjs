import assert from "node:assert/strict";
import test from "node:test";

import {
  countAnnotations,
  makeLayer,
  noteRange,
  rangeCovers,
  rangeLabel,
  rangesOverlap,
  uid,
} from "../lib/types.ts";

test("noteRange tolera documentos sin fin de tramo y rangos invertidos", () => {
  const single = { measureIndex: 4, measureNumber: "5" };
  assert.deepEqual(noteRange(single), { from: 4, to: 4 });

  const span = { measureIndex: 2, measureEnd: 7, measureNumber: "3–8" };
  assert.deepEqual(noteRange(span), { from: 2, to: 7 });

  // Un documento manipulado a mano no debe romper el orden.
  const inverted = { measureIndex: 9, measureEnd: 3, measureNumber: "¿?" };
  assert.deepEqual(noteRange(inverted), { from: 3, to: 9 });
});

test("rangeCovers y rangesOverlap", () => {
  const range = { from: 2, to: 5 };
  assert.equal(rangeCovers(range, 2), true);
  assert.equal(rangeCovers(range, 5), true);
  assert.equal(rangeCovers(range, 1), false);
  assert.equal(rangeCovers(range, 6), false);

  assert.equal(rangesOverlap({ from: 0, to: 2 }, { from: 2, to: 4 }), true);
  assert.equal(rangesOverlap({ from: 0, to: 1 }, { from: 2, to: 4 }), false);
  // Un tramo contenido en otro también se solapa.
  assert.equal(rangesOverlap({ from: 0, to: 9 }, { from: 3, to: 4 }), true);
});

test("rangeLabel numera como está impreso y no como el índice", () => {
  // Una partitura con anacrusa: el compás 0 se imprime como "0" y el 1 como "1".
  const numbers = ["0", "1", "2", "3"];
  assert.equal(rangeLabel(1, 1, numbers), "1");
  assert.equal(rangeLabel(1, 3, numbers), "1–3");
  // Sin números disponibles: el número natural del índice.
  assert.equal(rangeLabel(0, 0, []), "1");
  assert.equal(rangeLabel(4, 6, []), "5–7");
});

test("uid no se repite ni generando muchos seguidos", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(uid("score"));
  assert.equal(seen.size, 5000);
  assert.match(uid("layer"), /^layer_/);
});

test("countAnnotations suma los tres tipos de anotación", () => {
  const layer = makeLayer("Mis anotaciones", 0);
  layer.strokes = [{ id: "s1" }, { id: "s2" }];
  layer.pins = [{ id: "p1" }];
  layer.notes = [{ id: "n1" }];
  const otra = makeLayer("Director", 1);
  assert.equal(countAnnotations([layer, otra]), 4);
  // La paleta se recorre en ciclo y el color de cada capa sale de su índice.
  assert.notEqual(otra.color, layer.color);
  assert.equal(makeLayer("X", 8).color, layer.color);
});
