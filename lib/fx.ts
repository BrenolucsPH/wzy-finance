import { db } from "./server";
export const currencies = [
  "BRL",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "CHF",
  "AUD",
] as const;
export async function quote(currency: string, date?: string) {
  if (!currencies.includes(currency as (typeof currencies)[number]))
    throw Error("CURRENCY_INVALID");
  if (currency === "BRL")
    return {
      currency,
      rate: 1,
      date: date || new Date().toISOString().slice(0, 10),
      cached: false,
    };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error("CURRENCY_INVALID");
  const key = date || "latest";
  const cached = await db()
    .prepare(
      "SELECT rate,quote_date,updated,source_date FROM fx_quotes WHERE currency=? AND quote_date=?",
    )
    .bind(currency, key)
    .first<{
      rate: number;
      quote_date: string;
      updated: number;
      source_date: string;
    }>();
  if (cached && (date || Date.now() - cached.updated < 3600000))
    return {
      currency,
      rate: cached.rate,
      date: cached.source_date || cached.quote_date,
      cached: true,
    };
  if (process.env.WZY_TEST_SCHEMA) {
    if (process.env.WZY_QA_FX !== "1") throw Error("CURRENCY_UNAVAILABLE");
    return {
      currency,
      rate: currency === "USD" ? 5 : 6,
      date: date || "2026-10-09",
      cached: false,
    };
  }
  const url = `https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/brl${date ? "?date=" + date : ""}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error("CURRENCY_UNAVAILABLE");
  const result = (await response.json()) as {
    rate: number;
    date: string;
  };
  if (
    !Number.isFinite(result.rate) ||
    result.rate <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.date)
  )
    throw Error("CURRENCY_UNAVAILABLE");
  // Only currency codes and quote dates are sent to the provider, never account data.
  await db().batch([
    db()
      .prepare(
        "INSERT INTO fx_quotes (currency,quote_date,rate,updated,source_date) VALUES (?,?,?,?,?) ON CONFLICT(currency,quote_date) DO UPDATE SET rate=excluded.rate,updated=excluded.updated,source_date=excluded.source_date",
      )
      .bind(currency, key, result.rate, Date.now(), result.date),
    db()
      .prepare(
        "INSERT INTO fx_quotes (currency,quote_date,rate,updated,source_date) VALUES (?,?,?,?,?) ON CONFLICT(currency,quote_date) DO UPDATE SET rate=excluded.rate,updated=excluded.updated,source_date=excluded.source_date",
      )
      .bind(currency, result.date, result.rate, Date.now(), result.date),
  ]);
  return { currency, rate: result.rate, date: result.date, cached: false };
}
