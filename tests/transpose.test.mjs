/**
 * Pruebas de la transposición (`lib/transpose.ts`).
 *
 * Lo que se protege aquí es una sola idea, pero es la que decide si esto sirve
 * o no: **poner una parte en Mi♭ no puede cambiar cómo suena la música**. Si
 * esa invariante se rompe, un saxo estudiando con el piano oye otro tono.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_TRANSPOSE_OPTIONS,
  TRANSPOSITIONS,
  adoptReadings,
  effectiveReadings,
  partTransposeOf,
  readingFromPlaybackOffset,
  shiftsFor,
  transpositionOptions,
} from "../lib/transpose.ts";

test("el catálogo cubre los instrumentos que se transponen de verdad", () => {
  const valores = TRANSPOSITIONS.map((o) => o.value);
  // Do concierto tiene que estar, y las tres tonalidades del enunciado.
  assert.ok(valores.includes(0));
  assert.ok(valores.includes(2), "Si♭: trompeta, clarinete, saxo soprano");
  assert.ok(valores.includes(7), "Fa: trompa");
  assert.ok(valores.includes(9), "Mi♭: saxo alto");
  assert.ok(valores.includes(14), "Si♭ pero una novena abajo: saxo tenor");

  // Saxo alto: lee un Do y suena un Mi♭ una sexta mayor más abajo, así que para
  // escribir hay que SUBIR nueve semitonos.
  assert.equal(TRANSPOSITIONS.find((o) => o.instruments.includes("saxo alto")).value, 9);
  // Y el tenor, una novena: catorce, no dos. Es el error clásico.
  assert.equal(TRANSPOSITIONS.find((o) => o.instruments.includes("saxo tenor")).value, 14);

  // Sin valores repetidos: dos opciones con el mismo número serían una trampa.
  assert.equal(new Set(valores).size, valores.length);
});

test("la transposición del instrumento se lee pero no se oye; la de la obra sí", () => {
  // Un archivo en Do concierto: lo que declara es cero, así que el papel suma
  // la lectura entera y el oído sólo la obra.
  const enDo = shiftsFor(2, 9, 0);
  assert.equal(enDo.sheet, 2, "la obra, aparte: OSMD la aplica por su cuenta");
  assert.equal(enDo.part, 9, "la lectura del instrumento, sobre las notas del archivo");
  assert.equal(enDo.playback, 2, "en el oído: sólo la obra transportada");
  // El papel es la suma de los dos, y no once + dos.
  assert.equal(enDo.sheet + enDo.part, 11);

  // La invariante, que es lo que importa: lo que se lee es lo que suena más lo
  // que lee el instrumento, para cualquier combinación de transporte, lectura y
  // archivo.
  const bases = [-12, 0, 2, 7];
  const declarados = [0, -2, -9, 2];
  for (const base of bases) {
    for (const declaredOffset of declarados) {
      const declared = readingFromPlaybackOffset(declaredOffset);
      for (const reading of [0, ...TRANSPOSITIONS.map((o) => o.value)]) {
        const s = shiftsFor(base, reading, declared);
        assert.equal(
          s.sheet + s.part - s.playback,
          reading,
          `obra ${base}, archivo ${declaredOffset}, lectura ${reading}`,
        );
      }
    }
  }
});

test("el transporte de la obra va por intervalos, arriba y abajo", () => {
  const valores = BASE_TRANSPOSE_OPTIONS.map((o) => o.value);
  assert.ok(valores.includes(0));
  // Los dos sentidos, y sin repetir el cero.
  assert.ok(valores.includes(2) && valores.includes(-2));
  assert.equal(valores.filter((v) => v === 0).length, 1);
  assert.equal(new Set(valores).size, valores.length);
  assert.equal(BASE_TRANSPOSE_OPTIONS.length, 23, "once arriba, once abajo y el cero");

  // Los nombres dicen el intervalo, no una tonalidad: transportar suma un
  // intervalo, y prometer «La menor» obligaría a decidir menor o mayor.
  const nombre = (v) => BASE_TRANSPOSE_OPTIONS.find((o) => o.value === v).label;
  assert.match(nombre(-3), /tercera menor abajo/);
  assert.match(nombre(0), /sin transportar/);
  assert.match(nombre(7), /quinta justa arriba/);
});

test("el desplegable de una parte nunca oculta el valor que ya trae", () => {
  // Un valor del catálogo: las opciones de siempre.
  assert.equal(transpositionOptions(9).length, TRANSPOSITIONS.length);

  // Un documento de otra herramienta con una transposición rara: se añade la
  // suya. Si no, abrir el selector cambiaría el documento sin tocar nada.
  const raras = transpositionOptions(5);
  assert.equal(raras.length, TRANSPOSITIONS.length + 1);
  assert.equal(raras[raras.length - 1].value, 5);

  // Y el valor sigue siendo el de la parte después de pedir las opciones.
  assert.equal(partTransposeOf({ P1: 5 }, "P1"), 5);
});

test("una parte sin declarar lee en Do, no en un valor inventado", () => {
  assert.equal(partTransposeOf({ P1: 9 }, "P1"), 9);
  assert.equal(partTransposeOf({ P1: 9 }, "P2"), 0);
  assert.equal(partTransposeOf(undefined, "P1"), 0);
  // Un cero explícito y una ausencia valen lo mismo: Do concierto.
  assert.equal(partTransposeOf({ P1: 0 }, "P1"), 0);
});

test("lo que declara el archivo se lee al revés que como lo escribe MusicXML", () => {
  // MusicXML guarda cuántos semitonos hay que sumar a lo ESCRITO para obtener
  // lo que SUENA: el clarinete en Si♭ escribe Do y suena Si♭, así que lleva −2.
  // Nosotros guardamos lo contrario: lo que hay que sumar a lo que suena para
  // escribir lo que se lee, que en el clarinete es +2 (y coincide con el
  // catálogo: el clarinete se lee en Si♭).
  assert.equal(readingFromPlaybackOffset(-2), 2);
  // El saxo alto declara −9 y lee en Mi♭; la trompa en Fa, −7.
  assert.equal(readingFromPlaybackOffset(-9), 9);
  assert.equal(readingFromPlaybackOffset(-7), 7);
  // Un archivo en Do no declara nada, y no declara «−0».
  assert.equal(readingFromPlaybackOffset(0), 0);
  assert.ok(Object.is(readingFromPlaybackOffset(0), 0), "un cero exacto, no un −0");

  // Y la cuenta cuadra con las dos fórmulas del sistema, que es lo que de
  // verdad hay que proteger. Para cada instrumento del catálogo:
  //   el papel:  escrito + sheet + part   (los dos desplazamientos de OSMD)
  //   el oído :  escrito + PlaybackTranspose + obra   (el motor de audio)
  for (const option of TRANSPOSITIONS) {
    const escritoSonando = -option.value; // como lo escribe MusicXML
    const declared = readingFromPlaybackOffset(escritoSonando);
    assert.equal(declared, option.value, `${option.instruments}: lo declarado es la lectura`);

    const escrito = 60;
    const suena = escrito + escritoSonando; // la altura del archivo, en su tono
    const obra = 2;
    // El usuario puede dejar la lectura del archivo o reescribir la parte en Do.
    for (const lectura of [declared, 0, 7]) {
      const { sheet, part, playback } = shiftsFor(obra, lectura, declared);
      assert.equal(
        escrito + sheet + part,
        suena + obra + lectura,
        `el papel de ${option.instruments} con lectura ${lectura}`,
      );
      // El motor lee las alturas de origen y suma lo declarado y la obra: la
      // misma cifra que `playback`, por otro camino. Si estas dos se separaran,
      // el papel y el sonido contarían cosas distintas.
      assert.equal(escrito + playback, escrito + escritoSonando + obra);
    }
  }
});

test("al abrir, el archivo enseña su lectura pero no pisa la del usuario", () => {
  // Un trío donde el saxo y el bajo vienen escritos en su tono.
  const declared = { P1: 9, P3: -12 };
  assert.deepEqual(adoptReadings(undefined, declared), declared);

  // Si alguien ya había elegido otra lectura para el saxo, se respeta.
  assert.deepEqual(adoptReadings({ P1: 0 }, declared), { P1: 0, P3: -12 });

  // Nada que adoptar: no se toca el documento (ni se guarda).
  assert.equal(adoptReadings(undefined, { P1: 0, P2: 0 }), null);
  assert.equal(adoptReadings({ P1: 9, P3: -12 }, declared), null);

  // La primera pasada usa la mezcla: el archivo primero, lo decidido después.
  assert.deepEqual(effectiveReadings(declared, undefined), declared);
  assert.deepEqual(effectiveReadings(declared, { P1: 0 }), { P1: 0, P3: -12 });
});
