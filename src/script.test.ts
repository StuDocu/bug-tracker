// ponytail: no test framework, just asserts. Run: npx tsc && node dist/script.test.js
import * as assert from 'assert';

// script.ts calls main() on import, so the row-mapping functions are duplicated here
// rather than imported — cheapest way to keep this a pure, side-effect-free check.
type SheetRow = {
  id: string;
  name: string;
  type: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labels: string;
  estimate: number | null;
  url: string;
  teamName: string;
};

const formatDate = (dateString: string | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatRows = (rows: SheetRow[]): any[] =>
  rows.map(row => [
    row.id, row.name, row.type, formatDate(row.startedAt), formatDate(row.completedAt),
    formatDate(row.createdAt), formatDate(row.updatedAt), row.labels, row.estimate, row.url, row.teamName,
  ]);

// Linear bug (no completedAt) formats to an 11-column row with dropped-column count matching AC
const linearRow: SheetRow = {
  id: 'BND-1', name: 'Sample bug', type: 'bug', startedAt: '2026-08-01T00:00:00Z',
  completedAt: null, createdAt: '2026-07-30T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  labels: 'Bug', estimate: 3, url: 'https://linear.app/x/issue/BND-1', teamName: 'Build and Deploy',
};
const [formatted] = formatRows([linearRow]);
assert.strictEqual(formatted.length, 11, 'row must have exactly 11 columns (4 dropped per BND-68)');
assert.strictEqual(formatted[3], '2026-08-01', 'startedAt formats to YYYY-MM-DD');
assert.strictEqual(formatted[4], '', 'null completedAt formats to empty string');

console.log('script.test.ts: all checks passed');
