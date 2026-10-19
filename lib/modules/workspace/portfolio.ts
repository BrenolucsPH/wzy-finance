import { z } from "zod";
import { db } from "../../server";
import { transaction } from "../../postgres";
import { quote } from "../../fx";
import {
  positionValue,
  tradeAmount,
  type InvestmentOperation,
} from "../../domain/portfolio";
import {
  ownedEntry,
  parse,
  id,
  date,
  requestId,
  InputError,
  commandId,
  insertEntry,
  lockOwner,
} from "./common";
import type { Entry } from "../../finance";
export async function portfolio(owner: string) {
  const positions = (
    await db()
      .prepare(
        "SELECT id,account_id,symbol,name,asset_type,currency FROM investment_positions WHERE user_id=? ORDER BY name",
      )
      .bind(owner)
      .all<{
        id: string;
        account_id: string;
        symbol: string;
        name: string;
        asset_type: string;
        currency: string;
      }>()
  ).results;
  const result = [];
  for (const p of positions) {
    const operations = (
      await db()
        .prepare(
          "SELECT id,operation,quantity::text,price_cents,fees_cents,date,created,reversal_of FROM investment_operations WHERE user_id=? AND position_id=? ORDER BY date,created,id",
        )
        .bind(owner, p.id)
        .all<InvestmentOperation>()
    ).results.map((o) => ({
      ...o,
      price_cents: Number(o.price_cents),
      fees_cents: Number(o.fees_cents),
      created: Number(o.created),
    }));
    const value = positionValue(operations),
      fx = await quote(p.currency);
    result.push({
      ...p,
      ...value,
      baseMarketValue: Math.round(value.marketValue * fx.rate),
      fxRate: fx.rate,
      fxDate: fx.date,
      operations: operations.slice(-50).reverse(),
    });
  }
  return {
    positions: result,
    valuationSource: "manual",
    totalMarketValue: result.reduce((s, p) => s + p.baseMarketValue, 0),
  };
}
export async function createPosition(owner: string, body: unknown) {
  const b = parse(
      z.object({
        accountId: id,
        symbol: z.string().trim().min(1).max(30),
        name: z.string().trim().min(1).max(100),
        assetType: z.enum(["stock", "fund", "fixed_income", "crypto", "other"]),
        requestId,
      }),
      body,
    ),
    account = await ownedEntry(owner, b.accountId);
  if (account.kind !== "account" || account.accountType !== "investment")
    throw new InputError("Escolha uma conta de investimentos.");
  const positionId = await commandId(owner, b.requestId, "position");
  await db()
    .prepare(
      "INSERT INTO investment_positions(id,user_id,account_id,symbol,name,asset_type,currency,created) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(
      positionId,
      owner,
      account.id,
      b.symbol.toUpperCase(),
      b.name,
      b.assetType,
      account.currency || "BRL",
      Date.now(),
    )
    .lockUser(owner)
    .run();
  return portfolio(owner);
}
export async function investmentOperation(owner: string, body: unknown) {
  const b = parse(
    z.object({
      positionId: id,
      operation: z.enum(["buy", "sell", "income", "quote"]),
      quantity: z
        .string()
        .regex(/^\d{1,12}(?:\.\d{1,8})?$/)
        .default("0"),
      price: z.number().int().nonnegative().max(99999999999),
      fees: z.number().int().nonnegative().max(99999999999).default(0),
      date,
      requestId,
    }),
    body,
  );
  const operationId = await commandId(owner, b.requestId, "investment");
  await transaction(async (client) => {
    await lockOwner(client, owner);
    const rows = await client.query(
      "SELECT * FROM investment_positions WHERE user_id=$1 AND id=$2",
      [owner, b.positionId],
    );
    if (!rows.rows.length) throw new InputError("Posição não encontrada.", 404);
    const position = rows.rows[0];
    const old = await client.query(
      "SELECT * FROM investment_operations WHERE user_id=$1 AND request_id=$2",
      [owner, b.requestId],
    );
    if (old.rows.length) {
      const o = old.rows[0];
      if (
        o.position_id !== b.positionId ||
        o.operation !== b.operation ||
        Number(o.quantity) !== Number(b.quantity) ||
        Number(o.price_cents) !== b.price ||
        Number(o.fees_cents) !== b.fees ||
        o.date !== b.date
      )
        throw new InputError(
          "Esta solicitação já foi usada com outros dados.",
          409,
        );
      return;
    }
    const operations = (
      await client.query(
        "SELECT id,operation,quantity::text,price_cents,fees_cents,date,created,reversal_of FROM investment_operations WHERE user_id=$1 AND position_id=$2",
        [owner, b.positionId],
      )
    ).rows as InvestmentOperation[];
    const op: InvestmentOperation = {
      id: operationId,
      operation: b.operation,
      quantity: b.quantity,
      price_cents: b.price,
      fees_cents: b.fees,
      date: b.date,
      created: Math.max(
        Date.now(),
        ...operations.map((o) => Number(o.created) + 1),
      ),
    };
    try {
      positionValue([...operations, op]);
    } catch (e) {
      throw new InputError((e as Error).message);
    }
    await client.query(
      "INSERT INTO investment_operations(id,user_id,position_id,operation,quantity,price_cents,fees_cents,date,created,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        operationId,
        owner,
        b.positionId,
        b.operation,
        b.quantity,
        b.price,
        b.fees,
        b.date,
        op.created,
        b.requestId,
      ],
    );
    const amount =
      b.operation === "income"
        ? b.price
        : ["buy", "sell"].includes(b.operation)
          ? tradeAmount(b.quantity, b.price)
          : 0;
    if (b.operation !== "quote") {
      const fx = await quote(position.currency, b.date),
        currency = position.currency;
      if (amount > 0) {
        const entry: Entry = {
          id: operationId + "-cash",
          kind: "transaction",
          name:
            (b.operation === "buy"
              ? "Compra"
              : b.operation === "sell"
                ? "Venda"
                : "Rendimento") +
            " · " +
            position.symbol,
          amount: Math.round(amount * fx.rate),
          originalAmount: amount,
          currency,
          fxRate: fx.rate,
          fxDate: fx.date,
          date: b.date,
          type: b.operation === "buy" ? "expense" : "income",
          status: "paid",
          accountId: position.account_id,
          category: b.operation === "income" ? "Rendimentos" : "Investimentos",
          financialActivity:
            b.operation === "income"
              ? "investment_income"
              : "investment_principal",
          investmentPosition: b.positionId,
        };
        await insertEntry(client, owner, entry);
      }
      if (b.fees > 0)
        await insertEntry(client, owner, {
          id: operationId + "-fees",
          kind: "transaction",
          name: "Taxas · " + position.symbol,
          amount: Math.round(b.fees * fx.rate),
          originalAmount: b.fees,
          currency,
          fxRate: fx.rate,
          fxDate: fx.date,
          date: b.date,
          type: "expense",
          status: "paid",
          accountId: position.account_id,
          category: "Investimentos",
          financialActivity: "investment_fee",
          investmentPosition: b.positionId,
        });
    }
  });
  return portfolio(owner);
}
export async function reverseInvestment(owner: string, body: unknown) {
  const b = parse(
      z.object({
        operationId: id,
        date,
        reason: z.string().trim().min(3).max(300),
        requestId,
      }),
      body,
    ),
    operationId = await commandId(owner, b.requestId, "investment-reverse");
  await transaction(async (client) => {
    await lockOwner(client, owner);
    const found = await client.query(
      "SELECT * FROM investment_operations WHERE user_id=$1 AND id=$2",
      [owner, b.operationId],
    );
    if (!found.rows.length || found.rows[0].operation === "reverse")
      throw new InputError("Operação inválida.");
    const original = found.rows[0];
    const exists = await client.query(
      "SELECT id FROM investment_operations WHERE user_id=$1 AND reversal_of=$2",
      [owner, b.operationId],
    );
    if (exists.rows.length) {
      if (exists.rows[0].id === operationId) return;
      throw new InputError("Operação já corrigida.", 409);
    }
    const operations = (
      await client.query(
        "SELECT id,operation,quantity::text,price_cents,fees_cents,date,created,reversal_of FROM investment_operations WHERE user_id=$1 AND position_id=$2",
        [owner, original.position_id],
      )
    ).rows as InvestmentOperation[];
    const reversal: InvestmentOperation = {
      id: operationId,
      operation: "reverse",
      quantity: "0",
      price_cents: 0,
      fees_cents: 0,
      date: b.date,
      created: Math.max(
        Date.now(),
        ...operations.map((o) => Number(o.created) + 1),
      ),
      reversal_of: b.operationId,
    };
    try {
      positionValue([...operations, reversal]);
    } catch {
      throw new InputError(
        "Corrija primeiro as operações posteriores que dependem desta compra.",
      );
    }
    await client.query(
      "INSERT INTO investment_operations(id,user_id,position_id,operation,quantity,price_cents,fees_cents,date,created,request_id,reversal_of,reason) VALUES($1,$2,$3,$4,0,0,0,$5,$6,$7,$8,$9)",
      [
        operationId,
        owner,
        original.position_id,
        "reverse",
        b.date,
        reversal.created,
        b.requestId,
        b.operationId,
        b.reason,
      ],
    );
    const cash = (
      await client.query(
        "SELECT payload FROM records WHERE user_id=$1 AND id=ANY($2::text[])",
        [owner, [b.operationId + "-cash", b.operationId + "-fees"]],
      )
    ).rows;
    for (const row of cash) {
      const e = JSON.parse(row.payload) as Entry;
      await insertEntry(client, owner, {
        ...e,
        id: operationId + "-" + (e.id.endsWith("-fees") ? "fees" : "cash"),
        date: b.date,
        type: e.type === "income" ? "expense" : "income",
        name: "Correção de operação · " + b.reason,
        reversalOf: e.id,
        adjustmentReason: b.reason,
      });
    }
  });
  return portfolio(owner);
}
