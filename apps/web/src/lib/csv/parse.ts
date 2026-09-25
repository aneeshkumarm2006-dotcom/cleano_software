// Isomorphic CSV parsing/serialization. No external dependency — used by both the
// client import UI and the server import action so behavior is identical on both sides.

export interface ParsedCsv {
  headers: string[];
  records: Record<string, string>[];
}

/**
 * Parse CSV text (RFC-4180-ish). Handles quoted fields, escaped quotes (""),
 * commas/newlines inside quotes, CRLF or LF line endings, and a leading BOM.
 * The first non-empty line is treated as the header row.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore — \n drives the row break (handles CRLF)
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // flush trailing field/row (file not ending in newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== "")) // drop fully-blank lines
    .map((r) => {
      const rec: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rec[h] = (r[idx] ?? "").trim();
      });
      return rec;
    });

  return { headers, records };
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serialize an array of rows (each row an array of cells) to CSV text. */
export function unparseCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}
