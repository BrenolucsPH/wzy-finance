import { money, type Entry } from "./finance";
const headers = [
  "Data",
  "Descrição",
  "Tipo",
  "Categoria",
  "Subcategoria",
  "Centro de custo",
  "Tags",
  "Conta",
  "Valor em reais",
  "Status",
];
function lines(entries: Entry[], month?: string) {
  const accounts = new Map(
    entries
      .filter((e) => e.kind === "account" || e.kind === "card")
      .map((e) => [e.id, e.name]),
  );
  return entries
    .filter(
      (e) => e.kind === "transaction" && (!month || e.date?.startsWith(month)),
    )
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map((e) => [
      e.date || "",
      e.name,
      e.type === "expense"
        ? "Despesa"
        : e.type === "income"
          ? "Receita"
          : "Transferência",
      e.category || "",
      e.subcategory || "",
      e.costCenter || "",
      e.tags?.join(", ") || "",
      accounts.get(e.accountId || "") || "",
      e.amount / 100,
      e.status === "paid" ? "Concluído" : "Pendente",
    ]);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function excelBytes(entries: Entry[], month: string) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "WZY";
  const sheet = book.addWorksheet("Lançamentos");
  sheet.addRow(headers);
  for (const row of lines(entries, month)) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF286652" },
  };
  sheet.columns.forEach((c, i) => {
    c.width = i === 1 ? 40 : 22;
  });
  sheet.getColumn(9).numFmt = '"R$" #,##0.00';
  sheet.autoFilter = { from: "A1", to: "J1" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const bytes = await book.xlsx.writeBuffer();
  return new Uint8Array(bytes);
}
export async function pdfBytes(entries: Entry[], month: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.setFontSize(22);
  doc.text("WZY", 15, 20);
  doc.setFontSize(12);
  doc.text("Relatório financeiro · " + month, 15, 30);
  doc.setFontSize(9);
  let y = 43;
  for (const row of lines(entries, month)) {
    const text = `${row[0]} | ${row[1]} | ${row[2]} | ${money(Math.round(Number(row[8]) * 100))} | ${row[9]}`;
    const wrapped = doc.splitTextToSize(text, 180) as string[];
    const height = wrapped.length * 5 + 4;
    if (y + height > 280) {
      doc.addPage();
      y = 20;
    }
    doc.text(wrapped, 15, y);
    y += height;
  }
  if (y === 43) doc.text("Nenhum lançamento neste período.", 15, y);
  return doc.output("arraybuffer");
}
export async function exportArchive() {
  const response = await fetch("/api/finance/export", {
    credentials: "same-origin",
  });
  if (!response.ok) throw Error("Entre para exportar seus dados.");
  const data = (await response.json()) as {
    files: {
      id: string;
      name: string;
      size: number;
    }[];
  };
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("WZY-dados.json", JSON.stringify(data, null, 2));
  for (const file of data.files) {
    const r = await fetch("/api/files/" + encodeURIComponent(file.id), {
      credentials: "same-origin",
    });
    if (!r.ok)
      throw Error("Um comprovante não pôde ser exportado. Tente novamente.");
    zip.file(
      "comprovantes/" +
        file.id +
        "-" +
        file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_"),
      await r.arrayBuffer(),
    );
  }
  const avatar = await fetch("/api/account/avatar", {
    credentials: "same-origin",
  });
  if (avatar.ok) zip.file("perfil.webp", await avatar.arrayBuffer());
  downloadBlob(
    await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    }),
    "WZY-exportacao-completa.zip",
  );
}
export async function exportExcel(entries: Entry[], month: string) {
  downloadBlob(
    new Blob([await excelBytes(entries, month)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "WZY-" + month + ".xlsx",
  );
}
export async function exportPdf(entries: Entry[], month: string) {
  downloadBlob(
    new Blob([await pdfBytes(entries, month)], { type: "application/pdf" }),
    "WZY-" + month + ".pdf",
  );
}
