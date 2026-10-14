import assert from "node:assert/strict";
import test from "node:test";

import {
  clientToScore,
  distToSegment,
  measureAt,
  pressureOutline,
  readScoreExtent,
  smoothPath,
  spanBands,
} from "../lib/geometry.ts";

/** Rectángulo falso con la misma forma que los del DOM real. */
const rect = (left, top) => ({ left, top, right: left, bottom: top, width: 0, height: 0 });

test("clientToScore deshace exactamente el zoom", () => {
  // El overlay está escalado con transform: su rect ya viene escalado, así que
  // dividir por el zoom devuelve el punto en espacio de partitura.
  assert.deepEqual(clientToScore(rect(100, 50), 2, 300, 250), { x: 100, y: 100 });
  assert.deepEqual(clientToScore(rect(0, 0), 0.5, 59, 29), { x: 118, y: 58 });
});

test("measureAt acierta dentro y tolera el hueco entre sistemas", () => {
  const boxes = [
    { measureIndex: 0, measureNumber: "1", x: 0, y: 0, width: 100, height: 60 },
    { measureIndex: 1, measureNumber: "2", x: 100, y: 0, width: 100, height: 60 },
    { measureIndex: 2, measureNumber: "3", x: 0, y: 200, width: 100, height: 60 },
  ];
  assert.equal(measureAt(boxes, 50, 30)?.measureIndex, 0);
  assert.equal(measureAt(boxes, 150, 30)?.measureIndex, 1);
  // 20 px por debajo del primer sistema sigue siendo el primer sistema.
  assert.equal(measureAt(boxes, 50, 80)?.measureIndex, 0);
  // A mitad del hueco entre sistemas (más de 48 px) no hay compás.
  assert.equal(measureAt(boxes, 50, 140), null);
  // Fuera por la izquierda en horizontal no se arrastra a ningún compás.
  assert.equal(measureAt(boxes, -30, 30), null);
});

test("spanBands cubre el tramo, separa sistemas y respeta la parte", () => {
  // Dos compases por sistema, cuatro compases: medimos el tramo 0..3.
  const boxes = [
    { measureIndex: 0, measureNumber: "1", x: 0, y: 0, width: 100, height: 80 },
    { measureIndex: 1, measureNumber: "2", x: 100, y: 0, width: 100, height: 80 },
    { measureIndex: 2, measureNumber: "3", x: 0, y: 200, width: 100, height: 80 },
    { measureIndex: 3, measureNumber: "4", x: 100, y: 200, width: 100, height: 80 },
  ];
  const staffBoxes = [];
  for (const measureIndex of [0, 1, 2, 3]) {
    const y = measureIndex < 2 ? 0 : 200;
    const x = measureIndex % 2 === 0 ? 0 : 100;
    // Pentagrama 0: saxo. Pentagramas 1 y 2: piano.
    for (const staffIndex of [0, 1, 2]) {
      staffBoxes.push({ measureIndex, staffIndex, partId: staffIndex === 0 ? "P1" : "P2", x, y: y + staffIndex * 30, width: 100, height: 30 });
    }
  }
  const extent = {
    boxes,
    staffBoxes,
    parts: [
      { id: "P1", name: "Saxo", abbreviation: "", staffIndices: [0] },
      { id: "P2", name: "Piano", abbreviation: "", staffIndices: [1, 2] },
    ],
  };

  // Toda la plantilla: una banda por pentagrama y por sistema (2 sistemas × 3).
  assert.equal(spanBands(extent, 0, 3, null).length, 6);
  // Un solo compás del primer sistema: 3 bandas (una por pentagrama).
  assert.equal(spanBands(extent, 0, 0, null).length, 3);
  // Sólo el piano: 2 bandas por sistema.
  const piano = spanBands(extent, 0, 3, "P2");
  assert.equal(piano.length, 4);
  // Y sólo el saxo: 1 por sistema, con el alto de un pentagrama.
  const saxo = spanBands(extent, 0, 1, "P1");
  assert.equal(saxo.length, 1);
  assert.equal(saxo[0].height, 30);
  // El ancho cubre los dos compases del sistema (0..200).
  assert.equal(saxo[0].x, 0);
  assert.equal(saxo[0].width, 200);
  // Una parte que no existe no pinta nada (mejor nada que algo mal puesto).
  assert.deepEqual(spanBands(extent, 0, 1, "P9"), []);
});

test("spanBands usa la caja agregada cuando no hay pentagramas", () => {
  const extent = {
    boxes: [{ measureIndex: 0, measureNumber: "1", x: 10, y: 20, width: 50, height: 40 }],
    staffBoxes: [],
    parts: [],
  };
  assert.deepEqual(spanBands(extent, 0, 0, null), [{ x: 10, y: 20, width: 50, height: 40 }]);
});

test("readScoreExtent lee partes, pentagramas y cajas", () => {
  const box = (x, y, w, h) => ({
    AbsolutePosition: { x: x / 10, y: y / 10 },
    Size: { width: w / 10, height: h / 10 },
  });
  const measure = (index, number, staves) => ({
    PositionAndShape: box(0, index * 100, 0, 0),
    MeasureNumber: number,
    parentSourceMeasure: { measureListIndex: index, MeasureNumber: number },
    // `MeasureList` es una matriz [medida][pentagrama].
    _staves: staves,
  });
  const osmd = {
    EngravingRules: { UnitToPixelFactor: 10 },
    Sheet: {
      Parts: [
        { IdString: "P1", Name: "Saxo alto", Staves: [{}] },
        { IdString: "P2", Name: "Piano", Staves: [{}, {}] },
      ],
    },
    GraphicSheet: {
      MeasureList: [
        [measure(0, "1", 0), box(0, 0, 200, 30), measure(0, "1", 2), box(0, 40, 200, 30)],
        [measure(1, "2", 0), box(200, 0, 180, 30), measure(1, "2", 2), box(200, 40, 180, 30)],
      ].map((row) => row.filter((_, i) => i % 2 === 0)),
    },
  };

  // La matriz de arriba queda con las formas: [ {medida0}, {medida1} ] pero
  // necesitamos duplicar cada compás por pentagrama, así que la rehacemos
  // explícitamente para no depender de trucos del filtro.
  osmd.GraphicSheet.MeasureList = [
    [
      { PositionAndShape: box(0, 0, 200, 30), parentSourceMeasure: { MeasureNumber: "1" } },
      { PositionAndShape: box(0, 40, 200, 30), parentSourceMeasure: { MeasureNumber: "1" } },
      { PositionAndShape: box(0, 80, 200, 30), parentSourceMeasure: { MeasureNumber: "1" } },
    ],
    [
      { PositionAndShape: box(200, 0, 180, 30), parentSourceMeasure: { MeasureNumber: "2" } },
      { PositionAndShape: box(200, 40, 180, 30), parentSourceMeasure: { MeasureNumber: "2" } },
      { PositionAndShape: box(200, 80, 180, 30), parentSourceMeasure: { MeasureNumber: "2" } },
    ],
  ];

  const extent = readScoreExtent(osmd);

  assert.deepEqual(
    extent.parts.map((p) => [p.id, p.name, p.staffIndices]),
    [
      ["P1", "Saxo alto", [0]],
      ["P2", "Piano", [1, 2]],
    ],
  );
  assert.equal(extent.boxes.length, 2);
  // La caja agregada del compás cubre los tres pentagramas: de y=0 a y=110.
  assert.deepEqual(extent.boxes[0], {
    measureIndex: 0,
    measureNumber: "1",
    x: 0,
    y: 0,
    width: 200,
    height: 110,
  });
  assert.equal(extent.staffBoxes.length, 6);
  assert.equal(extent.staffBoxes[1].partId, "P2");
  assert.equal(extent.width, 380);
  assert.equal(extent.height, 110);
});

test("readScoreExtent cae a los bordes cuando Size viene a cero", () => {
  // AbsolutePosition, Size y los bordes van en las MISMAS unidades internas de
  // OSMD (1 unidad = distancia entre líneas del pentagrama), así que el factor
  // de píxeles se aplica a los cuatro.
  const osmd = {
    EngravingRules: { UnitToPixelFactor: 10 },
    Sheet: { Parts: [{ Id: "P1", Name: "Piano", Staves: [{}] }] },
    GraphicSheet: {
      MeasureList: [
        [
          {
            PositionAndShape: {
              AbsolutePosition: { x: 1, y: 2 },
              Size: { width: 0, height: 0 },
              BorderLeft: 10,
              BorderRight: 210,
              BorderTop: 20,
              BorderBottom: 80,
            },
          },
        ],
      ],
    },
  };
  const [only] = readScoreExtent(osmd).boxes;
  assert.deepEqual(
    { x: only.x, y: only.y, width: only.width, height: only.height },
    { x: 10, y: 20, width: 2000, height: 600 },
  );
});

test("distToSegment mide la distancia perpendicular y respeta los extremos", () => {
  assert.equal(distToSegment(5, 3, 0, 0, 10, 0), 3);
  assert.equal(distToSegment(5, 0, 0, 0, 10, 0), 0);
  // Más allá del extremo: cuenta la distancia al extremo, no a la recta.
  assert.equal(distToSegment(13, 4, 0, 0, 10, 0), 5);
  // Segmento degenerado (un punto): distancia al punto.
  assert.equal(distToSegment(3, 4, 0, 0, 0, 0), 5);
});

test("pressureOutline cierra el polígono y la presión cambia el grosor", () => {
  const circle = pressureOutline([{ x: 10, y: 10, p: 0.5 }], 4);
  assert.match(circle, /^M .* Z$/);

  const thin = pressureOutline([{ x: 0, y: 0, p: 0 }, { x: 100, y: 0, p: 0 }], 6);
  const thick = pressureOutline([{ x: 0, y: 0, p: 1 }, { x: 100, y: 0, p: 1 }], 6);
  assert.match(thin, /Z$/);
  assert.match(thick, /Z$/);
  assert.notEqual(thin, thick);
  // Con el ratón (p = 0.5) el trazo mide exactamente el ancho base.
  const halfWidth = 3;
  assert.match(pressureOutline([{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }], 6), new RegExp(`-${halfWidth}`));
});

test("smoothPath trata los casos degenerados", () => {
  assert.equal(smoothPath([]), "");
  assert.match(smoothPath([{ x: 1, y: 2 }]), /^M 1 2 l/);
  assert.equal(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), "M 0 0 L 10 0");
  assert.match(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]), /C/);
});
