const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const months = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export function queryPlan(
  question: string,
  reference: string,
  accounts: { id: string; name: string }[],
  categories: string[],
) {
  const q = normalize(question),
    year = question.match(/20\d{2}/)?.[0] || reference.slice(0, 4);
  let month = reference;
  const named = months
    .map((name, index) => ({ name, index }))
    .filter((m) => q.includes(m.name));
  if (named.length === 1)
    month = year + "-" + String(named[0].index + 1).padStart(2, "0");
  if (/mes passado|ultimo mes/.test(q)) {
    const d = new Date(reference + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - 1);
    month = d.toISOString().slice(0, 7);
  }
  const account = accounts.filter((a) => q.includes(normalize(a.name)));
  if (account.length > 1)
    return {
      clarify:
        "Encontrei mais de uma conta na pergunta. Consulte uma por vez ou pergunte pelo total de todas.",
    } as const;
  const category = categories.find((c) => q.includes(normalize(c)));
  let term = "";
  if (!category) {
    if (/mercado|supermercado/.test(q)) term = "mercado";
    else if (q.includes("delivery")) term = "delivery";
    else {
      const match = q.match(
        /com (.+?)(?: em | no mes| neste mes| nos ultimos|$)/,
      );
      if (match) term = match[1].trim();
    }
  }
  if (account[0] && term.includes(normalize(account[0].name))) term = "";
  const intent = /patrimonio/.test(q)
    ? "wealth"
    : /saldo|quanto.*tenho/.test(q)
      ? "balance"
      : /saude|score/.test(q)
        ? "health"
        : /venc|pagar|proxim/.test(q)
          ? "upcoming"
          : /gast|despes|receb|receit|entrou|rendimento|mercado|delivery/.test(
                q,
              )
            ? "transactions"
            : "unknown";
  const type = /receb|receit|entrou|rendimento/.test(q) ? "income" : "expense",
    group = /por conta/.test(q)
      ? "account"
      : /por categoria|maiores gastos/.test(q)
        ? "category"
        : "total";
  const recent = q.match(/ultimos (\d+) meses/);
  let count = recent ? Math.min(36, Math.max(1, Number(recent[1]))) : 1;
  if (/este ano|neste ano/.test(q)) count = Number(reference.slice(5));
  const d = new Date(month + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - (count - 1));
  let start = d.toISOString().slice(0, 10);
  d.setUTCMonth(d.getUTCMonth() + count);
  let end = d.toISOString().slice(0, 10);
  if (named.length === 2) {
    start =
      year +
      "-" +
      String(Math.min(...named.map((m) => m.index)) + 1).padStart(2, "0") +
      "-01";
    const upper = new Date(
      Date.UTC(Number(year), Math.max(...named.map((m) => m.index)) + 1, 1),
    );
    end = upper.toISOString().slice(0, 10);
  }
  return {
    intent,
    type,
    group,
    month,
    start,
    end,
    accountId: account[0]?.id,
    category,
    term: term.slice(0, 100),
  };
}
