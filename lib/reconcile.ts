export type Imported = {
  key: string;
  date: string;
  name: string;
  amount: number;
  type: "income" | "expense";
};
function safeDate(raw: string) {
  const v = raw.trim();
  const formatted = /^\d{8}/.test(v)
    ? v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8)
    : /^\d{2}\/\d{2}\/\d{4}$/.test(v)
      ? v.slice(6) + "-" + v.slice(3, 5) + "-" + v.slice(0, 2)
      : v.slice(0, 10);
  const d = new Date(formatted + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(formatted) ||
    isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== formatted
  )
    throw Error("Data inválida no extrato.");
  return formatted;
}
function amount(raw: string) {
  let v = raw.replace(/[\sR$€£]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 999999999 || n === 0)
    throw Error("Valor inválido ou zero no extrato.");
  return Math.round(n * 100);
}
function csvRows(text: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === separator && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw Error("Aspas não fechadas no CSV.");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function parseStatement(
  text: string,
  format: "ofx" | "csv",
): Imported[] {
  if (text.length > 2000000) throw Error("Extrato muito grande. Use até 2 MB.");
  let items: Imported[] = [];
  if (format === "ofx") {
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw Error("Entidades externas não são permitidas.");
    const blocks =
      text.match(
        /<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi,
      ) || [];
    const tag = (block: string, name: string) =>
      block
        .match(new RegExp("<" + name + ">([^<\\r\\n]+)", "i"))?.[1]
        ?.trim() || "";
    items = blocks.map((b) => {
      const n = amount(tag(b, "TRNAMT"));
      return {
        key: tag(b, "FITID"),
        date: safeDate(tag(b, "DTPOSTED")),
        name: tag(b, "MEMO") || tag(b, "NAME") || "Lançamento importado",
        amount: Math.abs(n),
        type: n < 0 ? "expense" : "income",
      };
    });
  } else {
    const separator = text.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
    const rows = csvRows(text.replace(/^\uFEFF/, ""), separator);
    const header = (rows.shift() || []).map((x) =>
      x
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase(),
    );
    const index = (names: string[]) =>
      header.findIndex((x) => names.includes(x));
    const di = index(["data", "date", "dtposted"]),
      ni = index(["descricao", "description", "historico", "memo", "name"]),
      amountIndex = index(["valor", "amount", "trnamt"]),
      ki = index(["id", "fitid", "identificador"]);
    if (di < 0 || ni < 0 || amountIndex < 0)
      throw Error(
        "O CSV precisa das colunas Data, Descrição e Valor (negativo para despesas).",
      );
    items = rows.map((r) => {
      const n = amount(r[amountIndex] || "");
      return {
        key: ki >= 0 ? r[ki] || "" : "",
        date: safeDate(r[di] || ""),
        name: r[ni]?.trim() || "Lançamento importado",
        amount: Math.abs(n),
        type: n < 0 ? "expense" : "income",
      };
    });
  }
  if (!items.length || items.length > 1000)
    throw Error("Importe entre 1 e 1.000 lançamentos por arquivo.");
  return items.map((x) => ({
    ...x,
    name: x.name.replace(/[\x00-\x1f]/g, "").slice(0, 150),
    key: x.key.slice(0, 150),
  }));
}
