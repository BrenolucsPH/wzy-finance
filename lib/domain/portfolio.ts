export type InvestmentOperation = {
  id: string;
  operation: "buy" | "sell" | "income" | "quote" | "reverse";
  quantity: string;
  price_cents: number;
  fees_cents: number;
  date: string;
  created: number;
  reversal_of?: string | null;
};
const scale = 100000000n;
export function quantityUnits(value: string) {
  if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(value))
    throw Error("Informe uma quantidade com até oito casas decimais.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(8, "0"));
}
export function formatQuantity(value: bigint) {
  const raw = value.toString().padStart(9, "0"),
    fraction = raw.slice(-8).replace(/0+$/, "");
  return raw.slice(0, -8) + (fraction ? "." + fraction : "");
}
export function tradeAmount(quantity: string, price: number) {
  if (!Number.isSafeInteger(price) || price < 0) throw Error("Preço inválido.");
  const cents = Number(
    (quantityUnits(quantity) * BigInt(price) + scale / 2n) / scale,
  );
  if (!Number.isSafeInteger(cents) || cents > 99999999999)
    throw Error("Operação fora do intervalo permitido.");
  return cents;
}
export function positionValue(operations: InvestmentOperation[]) {
  const reversed = new Set(
    operations
      .filter((o) => o.operation === "reverse")
      .map((o) => o.reversal_of),
  );
  let quantity = 0n,
    cost = 0,
    lastPrice = 0,
    realized = 0,
    income = 0,
    lastDate = "";
  for (const op of operations
    .filter((o) => o.operation !== "reverse" && !reversed.has(o.id))
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.created - b.created ||
        a.id.localeCompare(b.id),
    )) {
    const units = quantityUnits(op.quantity),
      amount = tradeAmount(op.quantity, Number(op.price_cents)),
      fees = Number(op.fees_cents);
    if (op.operation === "buy") {
      if (units <= 0n) throw Error("Quantidade deve ser positiva.");
      quantity += units;
      cost += amount + fees;
    }
    if (op.operation === "sell") {
      if (units <= 0n || units > quantity)
        throw Error(
          "A venda excede a quantidade disponível na data informada.",
        );
      const allocated =
        units === quantity
          ? cost
          : Number((BigInt(cost) * units + quantity / 2n) / quantity);
      realized += amount - fees - allocated;
      cost -= allocated;
      quantity -= units;
    }
    if (op.operation === "income") income += Number(op.price_cents) - fees;
    else {
      lastPrice = Number(op.price_cents);
      lastDate = op.date;
    }
  }
  if (![cost, realized, income].every(Number.isSafeInteger))
    throw Error("A posição excede o intervalo financeiro seguro.");
  const marketValue = tradeAmount(formatQuantity(quantity), lastPrice);
  return {
    quantity: formatQuantity(quantity),
    costBasis: cost,
    marketValue,
    unrealized: marketValue - cost,
    realized,
    income,
    lastPrice,
    lastDate,
  };
}
