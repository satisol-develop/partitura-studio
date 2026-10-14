/**
 * Partitura de ejemplo multiparte: saxo alto, piano y bajo.
 *
 * Sirve para probar todo lo que sólo aparece cuando hay más de una parte:
 * cuatro pentagramas en total (saxo 1, piano 2, bajo 1), notas que suenan a la
 * vez en instrumentos distintos, y anotaciones que hay que poder atribuir a un
 * instrumento concreto en vez de a "la partitura".
 */
export const TRIO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Tres voces</work-title></work>
  <identification><creator type="composer">Anónimo</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Saxo alto</part-name><part-abbreviation>Sx.</part-abbreviation></score-part>
    <score-part id="P2"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation></score-part>
    <score-part id="P3"><part-name>Bajo</part-name><part-abbreviation>B.</part-abbreviation></score-part>
  </part-list>

  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="below">
        <direction-type><dynamics><mf/></dynamics></direction-type>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="5">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="6">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="7">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="8">
      <direction placement="below">
        <direction-type><dynamics><pp/></dynamics></direction-type>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>

  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="4">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="5">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="6">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="7">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="8">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>

  <part id="P3">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>1</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>F</step><octave>1</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>G</step><octave>1</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="5">
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="6">
      <note><pitch><step>E</step><octave>1</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="7">
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>G</step><octave>1</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="8">
      <note><pitch><step>C</step><octave>1</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>
`;
