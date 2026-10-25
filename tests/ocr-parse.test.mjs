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
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
