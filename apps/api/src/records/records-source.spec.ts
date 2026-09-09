import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOfficialRecordsHtml, parseOfficialRecordWeight } from './records-source.js';

const HTML = `
<table><thead><tr><th>Другое</th></tr></thead><tbody></tbody></table>
<table><thead><tr><th></th><th>Рыба:</th><th>Вес:</th><th>Водоем:</th><th>Прим-ка:</th><th>Игрок:</th><th>Дата:</th></tr></thead>
<tbody><tr><td><img src="assets/images/fish/small/2334.png"></td><td><a href="abramites.html"> Абрамитес  мраморный </a></td><td>1,632 кг</td><td>Амазония</td><td>Червь</td><td>NVS2111</td><td>09.09.2026 12:41</td></tr></tbody></table>`;

void describe('official records parser', () => {
  void it('parses the identified table without persisting bait', () => {
    const result = parseOfficialRecordsHtml(HTML);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      fishName: 'Абрамитес мраморный',
      fishPath: '/abramites.html',
      imageKey: 2334,
      weightGrams: 1632,
      waterbody: 'Амазония',
      playerName: 'NVS2111',
      caughtAt: new Date('2026-09-09T09:41:00.000Z'),
      caughtAtRaw: '09.09.2026 12:41',
    });
  });

  void it('parses grams and exact kilogram thousandths', () => {
    assert.equal(parseOfficialRecordWeight('439 гр'), 439);
    assert.equal(parseOfficialRecordWeight('44,501 кг'), 44_501);
    assert.throws(() => parseOfficialRecordWeight('1,5 гр'), /Fractional grams/u);
  });

  void it('rejects incomplete and unrelated HTML', () => {
    assert.throws(() => parseOfficialRecordsHtml('<html></html>'), /was not found/u);
    assert.throws(
      () => parseOfficialRecordsHtml(HTML.replace('<td>NVS2111</td>', '<td></td>')),
      /missing identity/u,
    );
  });
});
