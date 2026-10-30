// The overtime-form row parser (src/ocr/parse.js) on synthetic OCR words: layouts that differ from the sample, OCR slips, unknown payrolls.
import { parsePage, findDate, payrollKey } from '../src/ocr/parse.js';
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}: ${l}${c ? '' : ' ' + extra}`); };
const W = (text, x, y, conf = 90, w = text.length * 14) => ({ text, conf, x0: x, y0: y, x1: x + w, y1: y + 30 });
const people = [{ id: 'a', full_name: 'Ahmed Ali', payroll: 'EMC-062' }, { id: 'b', full_name: 'Sara Mahmoud', payroll: 'EMC-1216' }, { id: 'c', full_name: 'Omar K', payroll: 'OPRCTR5' }];

ok('payroll key ignores leading zeros and punctuation', payrollKey('EMC-062') === 'EMC62' && payrollKey('emc 0062') === 'EMC62' && payrollKey('EMC1216') === 'EMC1216' && payrollKey('xyz') === null);
ok('dates: 23-Oct-2026, 23/10/2026, 2026-10-23, "23 Oct 2026"', ['23-Oct-2026', '23/10/2026', '2026-10-23', 'x 23 Oct 2026 y'].every((t) => findDate(t) === '2026-10-23') && findDate('no date') === null && findDate('99-Foo-2026') === null);

// the sample layout: hours | work text | EMC code | (garbage from the Arabic name)
let r = parsePage([W('23-Oct-2026', 900, 100), W('3', 300, 400), W('BC', 450, 400, 96), W('Cooler', 500, 400, 96), W('fan', 600, 400, 96), W('repair', 660, 400, 96), W('EMC-062', 800, 401), W('gels', 1000, 400, 40), W('drome', 1080, 400, 30)], people);
ok('sample layout: date, person from the payroll, hours 3, note, no Arabic', r.date === '2026-10-23' && r.rows.length === 1 && r.rows[0].personId === 'a' && r.rows[0].name === 'Ahmed Ali' && r.rows[0].hours === 3 && r.rows[0].note === 'BC Cooler fan repair' && r.rows[0].warn.length === 0, JSON.stringify(r.rows));

// mirrored layout: the code on the LEFT, text then hours to its right, a serial number on the far left
r = parsePage([W('1', 100, 500), W('EMC-1216', 200, 500), W('Replace', 400, 500, 95), W('pump', 480, 500, 95), W('seal', 540, 500, 95), W('4', 700, 500, 95)], people);
ok('mirrored layout (code left, hours right, serial number far left): hours 4, not the serial 1', r.rows.length === 1 && r.rows[0].personId === 'b' && r.rows[0].hours === 4 && r.rows[0].note === 'Replace pump seal' && r.rows[0].warn.includes('hours_check'), JSON.stringify(r.rows));

// anywhere on the page, several rows, any order; OCR slips; split code; unknown payroll skipped
r = parsePage([W('Date:', 50, 20), W('2026-10-24', 130, 20),
  W('EMC-O62', 600, 300), W('Fix', 300, 300, 95), W('fan', 350, 300, 95), W('2', 150, 300),
  W('EMC-', 600, 400), W('1216', 680, 401), W('Lube', 300, 400, 95), W('oil', 360, 400, 95), W('5', 150, 400),
  W('EMC-777', 600, 500), W('Other', 300, 500, 95), W('dept', 360, 500, 95), W('6', 150, 500)], people);
ok('several rows anywhere: OCR slip O->0, a code split in two words, and an unknown payroll is skipped (listed)', r.date === '2026-10-24' && r.rows.length === 2 && r.rows[0].personId === 'a' && r.rows[0].hours === 2 && r.rows[1].personId === 'b' && r.rows[1].hours === 5 && r.skipped.join() === 'EMC-777', JSON.stringify(r));

// missing / odd hours are flagged, not guessed
r = parsePage([W('EMC-062', 600, 300), W('Fix', 300, 300, 95), W('fan', 350, 300, 95)], people);
ok('no hours on the row: flagged "hours_missing"', r.rows[0].hours === null && r.rows[0].warn.includes('hours_missing'));
r = parsePage([W('EMC-062', 600, 300), W('Fix', 300, 300, 95), W('30', 200, 300)], people);
ok('hours outside 0-24 are flagged', r.rows[0].hours === 30 && r.rows[0].warn.includes('hours_range'));
r = parsePage([W('EMC-062', 600, 300), W('A', 300, 300, 95), W('EMC-062', 600, 400), W('B', 300, 400, 95)], people);
ok('the same person twice on a page is flagged', r.rows.length === 2 && r.rows.every((x) => x.warn.includes('duplicate')));
r = parsePage([W('nothing', 10, 10), W('here', 90, 10)], people);
ok('a page without any payroll code gives no rows', r.rows.length === 0 && r.anchors.length === 0 && r.date === null);
// the company form (note LEFT of the code, name right): people of one merged work cell share its note; the English name / serial number on the right are not the note / hours
{ const pp = [{ id: 'a', full_name: 'Ahmed Ali', payroll: 'EMC-062' }, { id: 'b', full_name: 'Sara M', payroll: 'EMC-063' }, { id: 'c', full_name: 'Omar K', payroll: 'EMC-064' }, { id: 'd', full_name: 'Lina R', payroll: 'EMC-065' }];
  const words = [W('EMC-062', 800, 300), W('2', 150, 300), W('1', 1500, 300), W('Ahmed', 1000, 300, 95), W('Ali', 1080, 300, 95),
    W('EMC-063', 800, 345), W('3', 150, 345), W('2', 1500, 345),
    W('Pump', 400, 340, 96), W('seal', 470, 340, 96), W('EMC-064', 800, 390), W('4', 150, 390), W('3', 1500, 390),
    W('EMC-065', 800, 435), W('1', 150, 435), W('Valve', 400, 400, 96), W('overhaul', 470, 400, 96), W('line', 400, 440, 96), W('two', 470, 440, 96)];
  let q = parsePage(words, pp, { noteSide: -1 });
  ok('noteSide -1: the English name on the right is not the note, the serial number on the right is not the hours', q.rows[0].note === '' && q.rows[0].hours === 2 && q.rows[1].hours === 3 && q.rows[2].hours === 4 && q.rows[0].warn.includes('note_missing'));
  q = parsePage(words, pp, { noteSide: -1, links: [true, true, false], bounds: [322, 367, 412] });
  ok('merged work cell: the three people share the note read in the middle of the cell, one group', q.rows.slice(0, 3).every((r) => r.note === 'Pump seal' && r.group === 1 && !r.warn.includes('note_missing')), q.rows.map((r) => r.note + '/' + r.group).join(' | '));
  ok('hours stay per person', q.rows.map((r) => r.hours).join() === '2,3,4,1');
  ok('a single row whose note wraps over two lines is read over the whole height of its cell (between the lines under the rows)', q.rows[3].note === 'Valve overhaul line two' && q.rows[3].group === 0, q.rows[3].note);
  q = parsePage(words, pp, { noteSide: -1, links: [false, false, false] });
  ok('no merge found: every row keeps its own line', q.rows[0].note === '' && q.rows[1].note === 'Pump seal' && q.rows.every((r) => r.group === 0)); }
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
