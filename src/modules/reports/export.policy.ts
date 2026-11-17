export type ExportCell = string | number | boolean | Date | null | undefined;

export function safeSpreadsheetCell(value: ExportCell): string | number | boolean {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

export function csvEscape(value: ExportCell): string {
  const safe = String(safeSpreadsheetCell(value));
  if (!safe) return '';
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvDocument(headers: string[], rows: ExportCell[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function excelCompatibleTsv(headers: string[], rows: ExportCell[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => String(safeSpreadsheetCell(cell)).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\r\n') + '\r\n';
}
