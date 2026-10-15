/**
 * Reproducción de la partitura cargada.
 *
 * Se sintetiza desde el propio modelo de OSMD, no desde el MusicXML en texto:
 * así el sonido y la partitura dibujada son necesariamente el mismo documento.
 *
 * Notas de implementación que importan:
 *
 *  - OSMD mide el tiempo en **redondas** (una negra = 0.25). La conversión a
 *    segundos se hace con un mapa de tempo por compás, no con un único BPM:
 *    una obra con cambios de tempo sonaría mal con el tempo inicial aplicado
 *    a todo.
 *  - Las notas ligadas aparecen como varias notas separadas en el modelo. Sólo
 *    se ataca la primera de la cadena y su duración se extiende sobre el resto;
 *    si no, cada ligadura se oiría como un re-ataque.
 *  - El paquete `osmd-audio-player` no sirve aquí: declara compatibilidad con
 *    opensheetmusicdisplay ^0.8.4, muy anterior al 2.2.1 que usamos.
 */

export interface PlayNote {
  /** Segundos desde el inicio de la obra. */
  time: number;
  duration: number;
  /** Número MIDI (60 = Do central). */
  midi: number;
  velocity: number;
  partId: string | null;
  measureIndex: number;
}

export interface PlaybackTimeline {
  notes: PlayNote[];
  /** Duración total en segundos, incluyendo silencios finales. */
  duration: number;
  /** Segundo en que empieza cada compás. */
  measureTimes: number[];
  /** Tempo inicial en negras por minuto. */
  tempo: number;
  /** Partes de la plantilla, para poder silenciarlas por separado. */
  partIds: string[];
  /**
   * Segundo correspondiente a cada paso del cursor de OSMD, para que el
   * indicador siga la música. Es `null` si no se pudo construir.
   */
  cursorTimes: number[] | null;
}

/* ------------------------------------------------------------------ */
/* Tipos mínimos del modelo de OSMD que necesitamos                   */
/* ------------------------------------------------------------------ */

interface RawFraction {
  RealValue?: number;
}

interface RawPitch {
  getHalfTone?: () => number;
  Octave?: number;
  FundamentalNote?: number;
  AccidentalHalfTones?: number;
}

interface RawTie {
  StartNote?: unknown;
  Notes?: { Length?: RawFraction }[];
  Duration?: RawFraction;
}

/**
 * Un instrumento del archivo. `PlaybackTranspose` no es nuestro: lo escribe el
 * cargador a partir del `<transpose>` de la parte, y es lo que relaciona sus
 * notas escritas con lo que suenan.
 */
interface RawInstrument {
  IdString?: string;
  Id?: string;
  PlaybackTranspose?: number;
}

interface RawNote {
  Pitch?: RawPitch;
  Length?: RawFraction;
  IsGraceNote?: boolean;
  isRest?: () => boolean;
  getAbsoluteTimestamp?: () => RawFraction;
  NoteTie?: RawTie;
  ParentStaff?: { ParentInstrument?: RawInstrument };
}

interface RawVoiceEntry {
  Notes?: RawNote[];
}

interface RawStaffEntry {
  VoiceEntries?: RawVoiceEntry[];
}

interface RawVertical {
  StaffEntries?: (RawStaffEntry | undefined)[];
}

interface RawSourceMeasure {
  AbsoluteTimestamp?: RawFraction;
  Duration?: RawFraction;
  TempoInBPM?: number;
  VerticalSourceStaffEntryContainers?: RawVertical[];
}

interface RawCursor {
  reset?: () => void;
  next?: () => void;
  show?: () => void;
  hide?: () => void;
  update?: () => void;
  Iterator?: {
    EndReached?: boolean;
    CurrentSourceTimestamp?: RawFraction;
  };
}

interface RawSheet {
  SourceMeasures?: RawSourceMeasure[];
  DefaultStartTempoInBpm?: number;
}

interface OSMDOwner {
  Sheet?: RawSheet;
  cursor?: RawCursor;
  cursors?: RawCursor[];
}

/* ------------------------------------------------------------------ */
/* Extracción                                                          */
/* ------------------------------------------------------------------ */

const num = (fraction: RawFraction | undefined, fallback = 0): number => {
  const value = fraction?.RealValue;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

/**
 * Altura en número MIDI.
 *
 * Cuidado con la convención de OSMD: `getHalfTone()` **no** es el número MIDI.
 * OSMD cuenta las octavas una por debajo de la notación científica, así que su
 * valor va 12 por debajo. Se comprueba contra su propia frecuencia, que es la
 * que define el sonido: el Do5 escrito en el MusicXML de prueba tiene
 * `getHalfTone() === 60` y `Frequency === 523,25 Hz`, y 523,25 Hz es Do5, o sea
 * MIDI 72. Es decir: MIDI = getHalfTone() + 12.
 *
 * Los campos crudos (`Octave`, `FundamentalNote`, `AccidentalHalfTones`) sirven
 * sólo de reserva, y se compensan con el mismo desfase *más* el que OSMD
 * aplica entre la octava del MusicXML y su octava interna (`OctaveXmlDifference`).
 */
const OSMD_HALFTONE_TO_MIDI = 12;
const OSMD_XML_OCTAVE_OFFSET = 3;

function midiOf(pitch: RawPitch | undefined): number | null {
  if (!pitch) return null;

  const halfTone = pitch.getHalfTone?.();
  if (typeof halfTone === "number" && Number.isFinite(halfTone)) {
    return Math.round(halfTone) + OSMD_HALFTONE_TO_MIDI;
  }

  const fundamental = pitch.FundamentalNote;
  const octave = pitch.Octave;
  if (typeof fundamental !== "number" || typeof octave !== "number") return null;
  const accidental = pitch.AccidentalHalfTones ?? 0;
  return (
    12 * (octave + 1 + OSMD_XML_OCTAVE_OFFSET) +
    fundamental +
    accidental +
    OSMD_HALFTONE_TO_MIDI
  );
}

function partIdOf(note: RawNote): string | null {
  const instrument = note.ParentStaff?.ParentInstrument;
  if (!instrument) return null;
  return instrument.IdString ?? instrument.Id ?? null;
}

/**
 * Cuántos semitonos hay que sumar a la altura que trae la nota para que suene
 * lo que tiene que sonar.
 *
 * Son dos cosas, y las dos importan por separado:
 *
 *  - `PlaybackTranspose` es lo que el archivo declara de la parte: un clarinete
 *    en Si♭ que escribe Do suena Si♭, y el archivo lo dice con −2. Se aplica
 *    porque las notas de origen son las **escritas**, así que sin esto un saxo
 *    sonaría una sexta por encima de lo que suena.
 *  - `base` es el transporte de la obra: eso sí es música, y mueve el papel y
 *    el sonido a la vez.
 *
 * Lo que NO aparece aquí es cómo lee cada parte (`Instrument.Transpose`):
 * cambiar la notación de un instrumento no puede cambiar el tono de la música.
 * Si algún día alguien mete esa suma aquí, se rompe justo la invariante que
 * sostiene la función de transposición, y esta línea es el sitio donde mirarlo.
 */
function soundingOffset(instrument: RawInstrument | undefined, base: number): number {
  return (instrument?.PlaybackTranspose ?? 0) + base;
}

/**
 * Construye la línea de tiempo de reproducción a partir de la partitura ya
 * cargada en OSMD.
 *
 * `base` es el transporte de la obra en semitonos. Se pasa aparte y no se lee
 * del documento porque OSMD tampoco lo aplica a las alturas de origen —sólo al
 * dibujo—, así que si no se sumara aquí la pieza se leería en otro tono y
 * sonaría en el de siempre, que es el fallo que esta línea evita.
 */
export function buildTimeline(osmd: unknown, base = 0): PlaybackTimeline {
  const owner = osmd as OSMDOwner;
  const sheet = owner.Sheet;
  const measures = sheet?.SourceMeasures ?? [];

  // 1. Mapa de tempo: tramos de redondas con su BPM.
  const tempoSegments: { start: number; end: number; bpm: number }[] = [];
  let bpm = sheet?.DefaultStartTempoInBpm && sheet.DefaultStartTempoInBpm > 0
    ? sheet.DefaultStartTempoInBpm
    : 120;
  const startBpm = bpm;
  let totalWhole = 0;

  for (const measure of measures) {
    const start = num(measure.AbsoluteTimestamp);
    const length = num(measure.Duration);
    const own = measure.TempoInBPM;
    if (typeof own === "number" && Number.isFinite(own) && own > 0) bpm = own;
    const end = start + length;
    tempoSegments.push({ start, end, bpm });
    totalWhole = Math.max(totalWhole, end);
  }

  /** Redondas → segundos, respetando los cambios de tempo. */
  const wholeToSeconds = (whole: number): number => {
    let seconds = 0;
    for (const segment of tempoSegments) {
      if (whole <= segment.start) break;
      const span = Math.min(whole, segment.end) - segment.start;
      if (span <= 0) continue;
      seconds += span * 4 * (60 / segment.bpm);
    }
    return seconds;
  };

  // 2. Notas. Nos quedamos con la primera de cada ligadura para no re-atacar.
  const notes: PlayNote[] = [];
  const measureTimes: number[] = [];
  const partIds = new Set<string>();

  measures.forEach((measure, measureIndex) => {
    const measureWhole = num(measure.AbsoluteTimestamp);
    measureTimes.push(wholeToSeconds(measureWhole));

    for (const vertical of measure.VerticalSourceStaffEntryContainers ?? []) {
      for (const staffEntry of vertical.StaffEntries ?? []) {
        if (!staffEntry) continue;
        for (const voiceEntry of staffEntry.VoiceEntries ?? []) {
          for (const note of voiceEntry.Notes ?? []) {
            if (note.isRest?.()) continue;
            if (note.IsGraceNote) continue;

            // Las notas ligadas comparten objeto Tie: sólo suena la primera, y
            // dura todo lo que dura la cadena.
            const tie = note.NoteTie;
            if (tie && tie.StartNote && tie.StartNote !== note) continue;

            const written = midiOf(note.Pitch);
            if (written == null) continue;
            const midi = written + soundingOffset(note.ParentStaff?.ParentInstrument, base);

            const onsetWhole = num(note.getAbsoluteTimestamp?.(), measureWhole);
            let lengthWhole = num(note.Length, 0);
            if (tie) {
              const tied = num(tie.Duration, 0);
              lengthWhole = tied > 0 ? tied : lengthWhole;
            }
            if (lengthWhole <= 0) continue;

            const partId = partIdOf(note);
            if (partId) partIds.add(partId);

            notes.push({
              time: wholeToSeconds(onsetWhole),
              duration: Math.max(0.04, wholeToSeconds(onsetWhole + lengthWhole) - wholeToSeconds(onsetWhole)),
              midi,
              velocity: 0.75,
              partId,
              measureIndex,
            });
          }
        }
      }
    }
  });

  notes.sort((a, b) => a.time - b.time);

  const endOfNotes = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  const duration = Math.max(endOfNotes, wholeToSeconds(totalWhole));

  return {
    notes,
    duration,
    measureTimes,
    tempo: startBpm,
    partIds: [...partIds],
    cursorTimes: buildCursorTimeline(owner, wholeToSeconds),
  };
}

/**
 * Recorre una vez el cursor de OSMD para saber a qué segundo corresponde cada
 * paso. Es la única forma de que el indicador siga la música: la API del cursor
 * permite leer su posición, pero no buscarla por tiempo.
 *
 * Es un extra, no un requisito: si algo falla aquí, la reproducción sigue
 * funcionando sin indicador en lugar de romperse.
 */
function buildCursorTimeline(
  owner: OSMDOwner,
  wholeToSeconds: (whole: number) => number,
): number[] | null {
  const cursor = owner.cursor ?? owner.cursors?.[0];
  if (!cursor?.next || !cursor.Iterator) return null;

  const MAX_STEPS = 8000;
  const times: number[] = [];
  try {
    cursor.reset?.();
    let guard = 0;
    while (!cursor.Iterator.EndReached && guard++ < MAX_STEPS) {
      times.push(wholeToSeconds(num(cursor.Iterator.CurrentSourceTimestamp)));
      cursor.next();
    }
    cursor.reset?.();
    cursor.hide?.();
    return times.length > 0 ? times : null;
  } catch {
    try {
      cursor.reset?.();
      cursor.hide?.();
    } catch {
      /* el cursor es opcional */
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Motor de audio                                                      */
/* ------------------------------------------------------------------ */

const LOOKAHEAD_SECONDS = 0.12;
const TICK_MS = 25;

/**
 * Reproductor compartido. Hay exactamente un contexto de audio y un transporte
 * en toda la aplicación, así que un único objeto es lo correcto: el lienzo lo
 * usa para mover el cursor y la barra de transporte para controlarlo, sin
 * tener que pasar referencias por medio árbol de componentes.
 *
 * El contexto de audio no se crea hasta el primer `play()`, así que importarlo
 * en el servidor no tiene efectos.
 */
let shared: ScorePlayer | null = null;

export function getSharedPlayer(): ScorePlayer {
  shared ??= new ScorePlayer();
  return shared;
}

export interface PlayerCallbacks {
  onTime?: (seconds: number, measureIndex: number | null) => void;
  onEnded?: () => void;
}

/**
 * Reproductor con Web Audio.
 *
 * Usa el patrón de planificación anticipada: un temporizador barato corre cada
 * 25 ms y va agendando en el reloj del audio las notas que caen dentro de los
 * siguientes 120 ms. Programar con `setTimeout` directamente daría un ritmo
 * irregular, porque los temporizadores del navegador no tienen precisión.
 */
export class ScorePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timeline: PlaybackTimeline | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursorIndex = 0;
  private nextIndex = 0;
  private originTime = 0;
  private offset = 0;
  private muted = new Set<string>();
  private callbacks: PlayerCallbacks = {};

  setCallbacks(callbacks: PlayerCallbacks) {
    this.callbacks = callbacks;
  }

  setTimeline(timeline: PlaybackTimeline | null) {
    this.stop();
    this.timeline = timeline;
  }

  get isPlaying(): boolean {
    return this.timer !== null;
  }

  /** Segundos de música transcurridos. */
  get currentTime(): number {
    if (!this.ctx || !this.timeline) return this.offset;
    if (!this.isPlaying) return this.offset;
    return Math.max(0, this.ctx.currentTime - this.originTime);
  }

  get totalDuration(): number {
    return this.timeline?.duration ?? 0;
  }

  setMutedParts(partIds: string[]) {
    this.muted = new Set(partIds);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor!();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // Un filtro suave quita el filo del triángulo sin apagar el ataque.
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 4200;
      this.master.connect(filter);
      filter.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  play(fromSeconds?: number) {
    const timeline = this.timeline;
    if (!timeline || timeline.notes.length === 0) return;

    const ctx = this.ensureContext();
    void ctx.resume();

    const from = fromSeconds ?? this.offset;
    if (from >= timeline.duration - 0.02) this.offset = 0;
    const start = this.offset >= timeline.duration - 0.02 ? 0 : from;

    this.originTime = ctx.currentTime - start;
    this.nextIndex = timeline.notes.findIndex((n) => n.time >= start);
    if (this.nextIndex < 0) this.nextIndex = timeline.notes.length;
    this.cursorIndex = 0;
    if (timeline.cursorTimes) {
      while (
        this.cursorIndex < timeline.cursorTimes.length &&
        timeline.cursorTimes[this.cursorIndex] < start
      ) {
        this.cursorIndex++;
      }
    }

    this.stopTimer();
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  pause() {
    if (!this.isPlaying) return;
    this.offset = this.currentTime;
    this.stopTimer();
    this.stopScheduled();
    void this.ctx?.suspend();
    this.callbacks.onTime?.(this.offset, null);
  }

  stop() {
    this.stopTimer();
    this.stopScheduled();
    this.offset = 0;
    this.nextIndex = 0;
    this.cursorIndex = 0;
    void this.ctx?.suspend();
  }

  seek(seconds: number) {
    this.offset = Math.max(0, Math.min(seconds, this.totalDuration));
    if (this.isPlaying) this.play(this.offset);
  }

  dispose() {
    this.stopTimer();
    this.stopScheduled();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private stopTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private stopScheduled() {
    if (!this.ctx || !this.master) return;
    // Cortamos lo ya agendado: al pausar no deben quedar notas sonando.
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.setValueAtTime(0.5, now + 0.03);
  }

  private tick() {
    const ctx = this.ctx;
    const timeline = this.timeline;
    if (!ctx || !timeline) return;

    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD_SECONDS;

    while (
      this.nextIndex < timeline.notes.length &&
      this.originTime + timeline.notes[this.nextIndex].time <= horizon
    ) {
      const note = timeline.notes[this.nextIndex++];
      const when = this.originTime + note.time;
      if (when < now - 0.05) continue; // ya pasó (p. ej. al reanudar)
      if (note.partId && this.muted.has(note.partId)) continue;
      this.schedule(note, when);
    }

    const elapsed = now - this.originTime;
    this.callbacks.onTime?.(
      Math.min(elapsed, timeline.duration),
      this.measureAt(elapsed),
    );

    if (elapsed >= timeline.duration) {
      this.offset = timeline.duration;
      this.stopTimer();
      this.stopScheduled();
      this.callbacks.onEnded?.();
    }
  }

  /** Compás que suena en un instante dado. */
  measureAt(seconds: number): number | null {
    const times = this.timeline?.measureTimes;
    if (!times || times.length === 0) return null;
    let lo = 0;
    let hi = times.length - 1;
    if (seconds < times[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Paso del cursor que corresponde a un instante, o null si no hay línea de
   * tiempo del cursor. Se avanza de forma monótona con `next()` para no
   * recorrer la partitura entera en cada fotograma.
   */
  advanceCursorTo(
    seconds: number,
    onStep: (stepIndex: number) => void,
  ): void {
    const times = this.timeline?.cursorTimes;
    if (!times) return;
    while (
      this.cursorIndex < times.length &&
      times[this.cursorIndex] <= seconds
    ) {
      onStep(this.cursorIndex);
      this.cursorIndex++;
    }
  }

  resetCursorTracking() {
    this.cursorIndex = 0;
  }

  private schedule(note: PlayNote, when: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();

    osc.type = "triangle";
    osc.frequency.value = frequency;
    // Una segunda voz una octava arriba y muy floja da cuerpo al sonido.
    osc2.type = "sine";
    osc2.frequency.value = frequency * 2;

    const peak = 0.16 * note.velocity;
    const attack = 0.012;
    const release = Math.min(0.16, Math.max(0.05, note.duration * 0.35));
    const end = when + Math.max(note.duration, attack + 0.05);

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.setValueAtTime(peak, Math.max(when + attack, end - release));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc.start(when);
    osc2.start(when);
    osc.stop(end + 0.02);
    osc2.stop(end + 0.02);

    osc.onended = () => {
      gain.disconnect();
      osc.disconnect();
      osc2.disconnect();
    };
  }
}
