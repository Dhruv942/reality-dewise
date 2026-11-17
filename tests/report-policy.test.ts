import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReportFilters } from '../src/modules/reports/report.validation';
import { csvEscape, excelCompatibleTsv, safeSpreadsheetCell } from '../src/modules/reports/export.policy';

describe('report policies', () => {
  it('parses inclusive date filters and rejects an inverted range', () => {
    const filters = parseReportFilters({ fromDate: '2026-01-01', toDate: '2026-01-31', tz: 'Asia/Kolkata', limit: '25', offset: '0' });
    assert.equal(filters.fromDate, '2026-01-01');
    assert.equal(filters.toDate, '2026-01-31');
    assert.equal(filters.tz, 'Asia/Kolkata');
    assert.throws(() => parseReportFilters({ fromDate: '2026-02-01', toDate: '2026-01-31' }), /Validation failed/);
    assert.throws(() => parseReportFilters({ unsupported: 'x' }), /Validation failed/);
  });

  it('uses canonical enums and validates monetary filters', () => {
    const filters = parseReportFilters({ source: '99ACRES', transactionType: 'SALE_PURCHASE', propertyCategory: 'RESIDENTIAL', priceBand: 'ABOVE_8_CR', minPrice: '1000000' });
    assert.equal(filters.source, '99ACRES');
    assert.equal(filters.minPrice, 1_000_000);
    assert.throws(() => parseReportFilters({ minPrice: '-1' }), /Validation failed/);
    assert.throws(() => parseReportFilters({ source: 'WALK_IN' }), /Validation failed/);
  });

  it('protects spreadsheet formulas and serializes CSV/Excel rows', () => {
    assert.equal(safeSpreadsheetCell('=HYPERLINK("http://bad")'), "'=HYPERLINK(\"http://bad\")");
    assert.equal(csvEscape('a,"b"'), '"a,""b"""');
    assert.equal(csvEscape(null), '');
    assert.equal(csvEscape(''), '');
    assert.equal(csvEscape(12), '12');
    assert.equal(csvEscape(undefined), '');
    assert.equal(excelCompatibleTsv(['Name', 'Value'], [['Rustomjee', 10]]), 'Name\tValue\r\nRustomjee\t10\r\n');
  });
});
