/**
 * Transposición: cómo se lee una parte y cómo suena.
 *
 * Hay dos cosas distintas que se confunden todo el rato, y de ahí salen los
 * líos, así que van separadas por escrito:
 *
 *  1. **La obra se transporta a otro tono.** Es una decisión musical: la pieza
 *     suena en otra tonalidad. Cambia lo que se lee Y lo que se oye.
 *  2. **El instrumento es transpositor.** El saxo alto en Mi♭ lee un Do escrito
 *     y suena un Mi♭ (una sexta mayor más abajo). Esto es sólo una forma de
 *     escribir: en un trío, el saxo, el piano y el bajo tienen que sonar en el
 *     mismo tono, así que la transposición del instrumento **no puede cambiar
 *     lo que suena**. Si el saxofonista estudia con el piano, el piano no puede
 *     sonar en otra tonalidad por haber puesto la parte del saxo en Mi♭.
 *
 * Por eso el signo de `PartInfo.transpose` es «semitonos que hay que SUMAR a lo
 * que suena para escribir lo que se lee»: saxo alto +9, tenor +14, trompa en Fa
 * +7, trompeta en Si♭ +2.
 */

export interface TranspositionOption {
  /** Semitonos que se suman a lo que suena para obtener lo que se lee. */
  value: number;
  /** Cómo se llama la tonalidad con la que lee el instrumento. */
  label: string;
  /** Instrumentos que leen así, para poder elegir sin saber solfeo de ceros. */
  instruments: string;
}

/**
 * Las transposiciones de verdad: las que hacen falta para montar una partitura
 * de banda o de grupo, no la lista completa de la literatura.
 */
export const TRANSPOSITIONS: TranspositionOption[] = [
  { value: -12, label: "Do", instruments: "píccolo (una octava arriba)" },
  { value: 0, label: "Do", instruments: "piano, flauta, violín, trombón, guitarra" },
  { value: 2, label: "Si♭", instruments: "trompeta, clarinete, saxo soprano" },
  { value: 3, label: "La", instruments: "clarinete en La" },
  { value: 7, label: "Fa", instruments: "trompa, corno inglés" },
  { value: 9, label: "Mi♭", instruments: "saxo alto" },
  { value: 14, label: "Si♭", instruments: "saxo tenor, clarinete bajo (una octava abajo)" },
  { value: 21, label: "Mi♭", instruments: "saxo barítono (una octava abajo)" },
];

/**
 * Las opciones que se ofrecen para una parte concreta.
 *
 * Si la parte ya trae un valor que no está en el catálogo (un documento hecho
 * con otra herramienta, o una transposición rara), se añade como opción propia:
 * un desplegable que no puede mostrar el valor que tiene el documento lo
 * cambiaría sin que nadie se lo pidiera al abrir el selector.
 */
export function transpositionOptions(current: number): TranspositionOption[] {
  if (TRANSPOSITIONS.some((option) => option.value === current)) return TRANSPOSITIONS;
  return [
    ...TRANSPOSITIONS,
    { value: current, label: `${current}`, instruments: "como venía en el archivo" },
  ];
}

/**
 * Nombres de intervalo, para el transporte de la obra entera.
 *
 * Se ofrece por intervalos y no por tonalidades a propósito: transportar no
 * «pone» una tonalidad, suma un intervalo, y decir «una tercera menor arriba»
 * es exactamente lo que hace. Prometer «La menor» obligaría a decidir entre
 * menor y mayor, y a saber en qué tono estaba la obra.
 */
const INTERVAL_NAMES = [
  "",
  "Un semitono",
  "Un tono",
  "Una tercera menor",
  "Una tercera mayor",
  "Una cuarta justa",
  "Un tritono",
  "Una quinta justa",
  "Una sexta menor",
  "Una sexta mayor",
  "Una séptima menor",
  "Una séptima mayor",
];

export const BASE_TRANSPOSE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "En su tono (sin transportar)" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((value) => ({
    value,
    label: `${INTERVAL_NAMES[value]} arriba`,
  })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((value) => ({
    value: -value,
    label: `${INTERVAL_NAMES[value]} abajo`,
  })),
];

/**
 * Los tres desplazamientos de una parte, en semitonos, todos medidos **sobre
 * las alturas que trae el archivo**, que es la única referencia que no cambia.
 *
 * Van separados y no sumados porque el papel se cuenta así: OSMD aplica la obra
 * (`Sheet.Transpose`) y la parte (`Instrument.Transpose`) por caminos distintos
 * y los suma él. Devolver un solo número invitaría a sumarlo dos veces.
 *
 * - `sheet`: lo que mueve la obra entera.
 * - `part`: lo que se suma por ser esta parte y leer así: su lectura menos lo
 *   que el archivo ya declara.
 * - `playback`: lo que suena, que es lo que lee el motor de audio.
 *
 * La invariante que sostiene todo esto es que lo que se lee sea lo que suena más
 * la lectura: `sheet + part = playback + reading`. Si se rompiera, poner una
 * parte en Mi♭ cambiaría el tono de la música.
 */
export function shiftsFor(
  base: number,
  reading: number,
  declared = 0,
): { sheet: number; part: number; playback: number } {
  return {
    sheet: base,
    part: reading - declared,
    playback: base - declared,
  };
}

/** Semitonos totales de un instrumento, tolerando documentos sin declarar. */
export function partTransposeOf(
  partTransposes: Record<string, number> | undefined,
  partId: string,
): number {
  return partTransposes?.[partId] ?? 0;
}

/**
 * El desplazamiento que trae el archivo, traducido a «cómo lee la parte».
 *
 * MusicXML declara `<transpose>` como los semitonos que hay que **sumar a lo
 * escrito para obtener lo que suena**: un clarinete en Si♭ lleva −2, porque su
 * Do escrito suena Si♭. OSMD lo guarda tal cual en `Instrument.PlaybackTranspose`,
 * y esa es justo la dirección contraria a la nuestra (nosotros guardamos lo que
 * hay que sumar a lo que suena para escribir lo que se lee), así que aquí se
 * cambia de signo **una sola vez** y en un solo sitio.
 *
 * Que estas dos cuentas sean inversas es lo que hace que un archivo de banda se
 * abra tal y como se escribió: el saxo se lee en Mi♭ porque el archivo lo dice.
 */
export function readingFromPlaybackOffset(playbackOffset: number): number {
  // Un −0 se cuela en el documento y luego no es igual a 0: el Do concierto
  // tiene que ser exactamente cero. Y un valor que no sea un número (un
  // `<transpose>` mal formado) vale lo mismo que no declarar nada.
  if (playbackOffset === 0 || !Number.isFinite(playbackOffset)) return 0;
  return -playbackOffset;
}

/**
 * Lo que el archivo declara de cada parte, sin pisar lo que ya se decidió.
 *
 * Al abrir una partitura de banda, la lectura de cada instrumento ya viene en el
 * archivo. Adoptarla hace dos cosas: que la parte se dibuje tal y como se
 * escribió (un desplazamiento de 0 sobre sus notas, no uno de +9 encima), y que
 * el panel pueda decir la verdad («lee en Mi♭») en vez de ofrecer «Do concierto»
 * sobre una parte que no lo está.
 *
 * Lo que haya en el documento manda: si alguien ya eligió una lectura, abrir el
 * archivo otra vez no se la cambia. Y un archivo en Do no declara nada, así que
 * no escribe nada: devuelve `null` en vez de un objeto vacío para que quien
 * llama pueda no tocar el documento.
 */
export function adoptReadings(
  current: Record<string, number> | undefined,
  declared: Record<string, number>,
): Record<string, number> | null {
  const merged: Record<string, number> = { ...current };
  let added = false;
  for (const [partId, reading] of Object.entries(declared)) {
    if (reading === 0) continue;
    if (current && partId in current) continue;
    merged[partId] = reading;
    added = true;
  }
  return added ? merged : null;
}

/**
 * Las lecturas que hay que aplicar en una primera pasada: lo que declara el
 * archivo, con lo que ya se decidió por encima.
 *
 * La primera pasada es la única que importa para que no se vea un salto: se
 * dibuja ya con la lectura buena, y el documento se entera después.
 */
export function effectiveReadings(
  declared: Record<string, number>,
  current: Record<string, number> | undefined,
): Record<string, number> {
  return { ...declared, ...current };
}
