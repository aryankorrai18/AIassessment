// exceljs is heavy; this module is only imported by the lazily-loaded pages that need it.
import ExcelJS from "exceljs";

export type SheetSpec = { name: string; columns: string[]; rows: (string | number | null)[][] };

export async function downloadWorkbook(filename: string, sheets: SheetSpec[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.columns).font = { bold: true };
    s.rows.forEach((r) => ws.addRow(r.map((v) => v ?? "")));
    ws.columns.forEach((col, i) => {
      const longest = Math.max(s.columns[i].length, ...s.rows.map((r) => String(r[i] ?? "").length));
      col.width = Math.min(60, Math.max(10, longest + 2));
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads the first worksheet into objects keyed by trimmed header text. */
export async function readFirstSheet(file: File): Promise<{ rowNumber: number; values: Record<string, string> }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cell.text.trim();
  });
  const out: { rowNumber: number; values: Record<string, string> }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h) values[h] = row.getCell(col).text.trim();
    });
    if (Object.values(values).some((v) => v)) out.push({ rowNumber, values });
  });
  return out;
}
