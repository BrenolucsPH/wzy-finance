"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { Ripple } from "../../motion-ui";
import { Modal } from "../../ui/modal";
import { api, requestJSON } from "../../../lib/client";
import {
  categories,
  localDate,
  parseMoney,
  type Entry,
  type Kind,
} from "../../../lib/finance";
export function Editor({
  kind,
  entry,
  accounts,
  onSave,
  onClose,
  allowCreateAccount = true,
}: {
  kind: Kind;
  entry?: Entry;
  accounts: Entry[];
  onSave: (e: Entry) => Promise<void>;
  onClose: () => void;
  allowCreateAccount?: boolean;
}) {
  const draftId = useRef("");
  const [creatingAccount, setCreatingAccount] = useState(
      allowCreateAccount && kind === "transaction" && !accounts.length,
    ),
    [accountBusy, setAccountBusy] = useState(false),
    [selectedAccount, setSelectedAccount] = useState(
      entry?.accountId || accounts[0]?.id || "",
    ),
    [accountName, setAccountName] = useState(""),
    [accountInitial, setAccountInitial] = useState("0,00"),
    [categoryChoices, setCategoryChoices] = useState(categories);
  useEffect(() => {
    let active = true;
    void requestJSON<{ categories: { name: string; archived: boolean }[] }>(
      "workspace/categories",
    )
      .then((data) => {
        if (active)
          setCategoryChoices(
            Array.from(
              new Set([
                ...categories,
                ...data.categories
                  .filter((c) => !c.archived)
                  .map((c) => c.name),
                ...(entry?.category ? [entry.category] : []),
              ]),
            ),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [entry?.category]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState(entry?.type || "expense");
  const [files, setFiles] = useState<
    {
      id: string;
      name: string;
    }[]
  >(
    entry?.attachmentId
      ? [{ id: entry.attachmentId, name: "Comprovante vinculado" }]
      : [],
  );
  useEffect(() => {
    api("files")
      .then((r) => setFiles(r.files))
      .catch(() => {});
  }, []);
  const titles: Record<Kind, string> = {
    transaction: "transação",
    account: "conta",
    recurring: "conta recorrente",
    group: "assinatura em grupo",
    goal: "meta",
    budget: "orçamento",
    debt: "dívida",
    card: "cartão",
  };
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(ev.currentTarget));
    const result: Entry = {
      ...entry,
      id:
        entry?.id || draftId.current || (draftId.current = crypto.randomUUID()),
      kind,
      name: String(f.name).trim(),
      amount: ["account", "card"].includes(kind)
        ? 0
        : parseMoney(String(f.amount)),
    };
    if (!Number.isFinite(result.amount)) {
      setError("Informe um valor válido, como 149,90.");
      setBusy(false);
      return;
    }
    if (f.date) result.date = String(f.date);
    if (f.category) result.category = String(f.category);
    if (f.accountId) result.accountId = String(f.accountId);
    if (f.color) result.color = String(f.color);
    result.notes = String(f.notes || "");
    result.subcategory = String(f.subcategory || "") || undefined;
    result.tags = String(f.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    result.costCenter = String(f.costCenter || "") || undefined;
    if (kind === "account")
      result.accountType = String(
        f.accountType || "checking",
      ) as Entry["accountType"];
    if (kind === "budget") {
      result.rollover = f.rollover === "on";
      result.budgetStart = String(f.budgetStart || localDate().slice(0, 7));
    }
    if (kind === "goal")
      result.monthlyContribution = parseMoney(
        String(f.monthlyContribution || "0"),
      );
    if (kind === "transaction") {
      result.type = type;
      result.status = String(f.status) as Entry["status"];
      result.targetId = type === "transfer" ? String(f.targetId) : undefined;
      result.attachmentId = String(f.attachmentId || "") || undefined;
    }
    if (["recurring", "group", "debt", "card"].includes(kind))
      result.day = Number(f.day);
    if (kind === "group") {
      const members = String(f.members)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("|");
          return {
            name: parts[0].trim(),
            weight: parts[1] ? Number(parts[1].trim()) : 1,
          };
        });
      result.members = members.map((m) => m.name);
      result.memberWeights = Object.fromEntries(
        members.map((m) => [m.name, m.weight]),
      );
      result.payments = entry?.payments || {};
    }
    if (kind === "goal") result.saved = parseMoney(String(f.saved || "0"));
    if (kind === "account") {
      const s = String(f.initial || "0");
      result.initial =
        (s.startsWith("-") ? -1 : 1) * parseMoney(s.replace(/^-/, "").trim());
    }
    if (kind === "card") {
      result.limit = parseMoney(String(f.limit));
      result.closing = Number(f.closing);
    }
    if (kind === "debt") {
      result.installments = Number(f.installments);
      result.paidInstallments = Number(f.paidInstallments);
    }
    try {
      await onSave(result);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const value = (n?: number) =>
    ((n || 0) / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <Modal
      title={`${entry ? "Editar" : "Nova"} ${titles[kind]}`}
      onClose={onClose}
    >
      <form className="entry-form" onSubmit={submit}>
        <label>
          {kind === "transaction" ? "Descrição" : "Nome"}
          <input
            name="name"
            defaultValue={entry?.name}
            required
            maxLength={150}
            placeholder={
              kind === "group"
                ? "Ex.: YouTube Premium Família"
                : "Dê um nome ao registro"
            }
          />
        </label>
        {kind === "transaction" && (
          <div className="segmented">
            {(["expense", "income", "transfer"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={type === t ? "selected" : ""}
                onClick={() => setType(t)}
              >
                {t === "expense"
                  ? "Despesa"
                  : t === "income"
                    ? "Receita"
                    : "Transferência"}
              </button>
            ))}
          </div>
        )}
        <div className="two-col">
          {!["account", "card"].includes(kind) && (
            <label>
              {kind === "goal"
                ? "Valor da meta"
                : kind === "debt"
                  ? "Valor total da dívida"
                  : "Valor (R$)"}
              <input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={entry ? value(entry.amount) : ""}
                placeholder="0,00"
              />
            </label>
          )}
          {kind === "account" && (
            <label>
              Saldo inicial (R$)
              <input
                name="initial"
                inputMode="decimal"
                defaultValue={value(entry?.initial)}
                required
              />
            </label>
          )}
          {kind === "goal" && (
            <label>
              Já reservado (R$)
              <input
                name="saved"
                inputMode="decimal"
                defaultValue={value(entry?.saved)}
                required
              />
            </label>
          )}
          {kind === "card" && (
            <label>
              Limite (R$)
              <input
                name="limit"
                inputMode="decimal"
                defaultValue={value(entry?.limit)}
                required
              />
            </label>
          )}
          {["transaction", "goal"].includes(kind) && (
            <label>
              {kind === "goal" ? "Data planejada (opcional)" : "Data"}
              <input
                type="date"
                name="date"
                defaultValue={
                  entry?.date || (kind === "transaction" ? localDate() : "")
                }
                required={kind === "transaction"}
              />
            </label>
          )}
          {["recurring", "group", "debt", "card"].includes(kind) && (
            <label>
              Dia de vencimento
              <input
                name="day"
                type="number"
                min={1}
                max={31}
                defaultValue={entry?.day || 10}
                required
              />
            </label>
          )}
          {kind === "card" && (
            <label>
              Dia de fechamento
              <input
                name="closing"
                type="number"
                min={1}
                max={31}
                defaultValue={entry?.closing || 3}
                required
              />
            </label>
          )}
          {["transaction", "recurring", "budget", "debt"].includes(kind) &&
            type !== "transfer" && (
              <label>
                Categoria
                <select
                  name="category"
                  defaultValue={entry?.category || "Outros"}
                >
                  {categoryChoices.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
          {["transaction", "recurring", "debt"].includes(kind) && (
            <label>
              {type === "transfer" ? "Conta de origem" : "Conta"}
              <select
                name="accountId"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                required={kind === "transaction"}
              >
                <option value="">Selecione uma conta</option>
                {accounts
                  .filter((a) => type !== "transfer" || a.kind === "account")
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                      {a.kind === "card" ? " (cartão)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {kind === "transaction" && allowCreateAccount && (
            <div className="inline-account-section">
              {!creatingAccount ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setCreatingAccount(true)}
                >
                  {accounts.length
                    ? "Adicionar uma conta sem sair deste lançamento"
                    : "Primeiro, adicione onde o dinheiro entra ou sai"}
                </button>
              ) : (
                <fieldset className="inline-account">
                  <legend>Adicionar conta financeira</legend>
                  <p>
                    Uma carteira ou conta bancária para este lançamento. Seus
                    outros campos continuam preenchidos.
                  </p>
                  <label>
                    Nome
                    <input
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      maxLength={150}
                      placeholder="Ex.: Carteira, Nubank"
                    />
                  </label>
                  <label>
                    Saldo inicial (R$)
                    <input
                      inputMode="decimal"
                      value={accountInitial}
                      onChange={(e) => setAccountInitial(e.target.value)}
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={accountBusy}
                      onClick={async () => {
                        setAccountBusy(true);
                        setError("");
                        try {
                          const initial = parseMoney(accountInitial);
                          if (!accountName.trim() || !Number.isFinite(initial))
                            throw Error("Informe nome e saldo válidos.");
                          const account: Entry = {
                            id: crypto.randomUUID(),
                            kind: "account",
                            name: accountName.trim(),
                            amount: 0,
                            initial,
                            accountType: "checking",
                            color: "#357c67",
                          };
                          await onSave(account);
                          setSelectedAccount(account.id);
                          setCreatingAccount(false);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setAccountBusy(false);
                        }
                      }}
                    >
                      {accountBusy ? "Salvando…" : "Criar conta e continuar"}
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setCreatingAccount(false)}
                    >
                      Cancelar cadastro
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          )}
          {kind === "transaction" && type === "transfer" && (
            <label>
              Conta de destino
              <select
                name="targetId"
                defaultValue={entry?.targetId || ""}
                required
              >
                <option value="">Selecione o destino</option>
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "transaction" && (
            <label>
              Status
              <select name="status" defaultValue={entry?.status || "paid"}>
                <option value="paid">
                  {type === "income" ? "Recebida" : "Concluída"}
                </option>
                <option value="pending">Pendente</option>
              </select>
            </label>
          )}
          {kind === "debt" && (
            <>
              <label>
                Total de parcelas
                <input
                  type="number"
                  name="installments"
                  min={1}
                  max={600}
                  defaultValue={entry?.installments || 1}
                  required
                />
              </label>
              <label>
                Parcelas pagas antes do WZY
                <input
                  type="number"
                  name="paidInstallments"
                  min={0}
                  max={600}
                  defaultValue={entry?.paidInstallments || 0}
                  required
                />
              </label>
            </>
          )}
          {["account", "group", "goal", "card"].includes(kind) && (
            <label>
              Cor
              <input
                name="color"
                type="color"
                defaultValue={entry?.color || "#357c67"}
              />
            </label>
          )}
        </div>
        {kind === "group" && (
          <label>
            Participantes e proporção (um por linha)
            <textarea
              name="members"
              rows={5}
              defaultValue={
                entry?.members
                  ?.map(
                    (m) =>
                      m +
                      (entry.memberWeights?.[m]
                        ? " | " + entry.memberWeights[m]
                        : ""),
                  )
                  .join("\n") || "Você"
              }
              maxLength={1500}
              required
            />
            <small>
              Use Ana | 1 e Lucas | 2 para cotas proporcionais. Sem número, a
              divisão é igual. Participantes e proporções ficam preservados após
              o primeiro pagamento.
            </small>
          </label>
        )}
        {kind === "transaction" && (
          <label>
            Comprovante
            <select
              name="attachmentId"
              defaultValue={entry?.attachmentId || ""}
            >
              <option value="">Sem comprovante</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <small>Envie comprovantes na aba Arquivos.</small>
          </label>
        )}
        {kind === "account" && (
          <label>
            Tipo de conta
            <select
              name="accountType"
              defaultValue={entry?.accountType || "checking"}
            >
              <option value="checking">Conta corrente</option>
              <option value="savings">Poupança</option>
              <option value="cash">Dinheiro</option>
              <option value="investment">Investimentos</option>
              <option value="meal">Vale-refeição</option>
              <option value="other">Outra carteira</option>
            </select>
          </label>
        )}
        {["transaction", "recurring", "debt"].includes(kind) && (
          <>
            <div className="two-col">
              <label>
                Subcategoria
                <input
                  name="subcategory"
                  maxLength={100}
                  defaultValue={entry?.subcategory}
                  placeholder="Ex.: Delivery, supermercado"
                />
              </label>
              <label>
                Centro de custo
                <input
                  name="costCenter"
                  maxLength={100}
                  defaultValue={entry?.costCenter}
                  placeholder="Ex.: Casa, trabalho, viagem"
                />
              </label>
            </div>
            <label>
              Tags (separadas por vírgulas)
              <input
                name="tags"
                maxLength={800}
                defaultValue={entry?.tags?.join(", ")}
                placeholder="Ex.: essencial, família"
              />
            </label>
          </>
        )}
        {kind === "budget" && (
          <>
            <label>
              Mês inicial
              <input
                name="budgetStart"
                type="month"
                min="2000-01"
                max="2100-12"
                defaultValue={entry?.budgetStart || localDate().slice(0, 7)}
                required
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                name="rollover"
                defaultChecked={entry?.rollover}
              />
              Transferir a sobra para o mês seguinte
            </label>
          </>
        )}
        {kind === "goal" && (
          <label>
            Aporte planejado por mês (R$)
            <input
              name="monthlyContribution"
              inputMode="decimal"
              defaultValue={value(entry?.monthlyContribution)}
              placeholder="0,00"
            />
          </label>
        )}
        <label>
          Observações
          <textarea
            name="notes"
            rows={2}
            maxLength={2000}
            defaultValue={entry?.notes}
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              accountBusy ||
              (kind === "transaction" && !selectedAccount)
            }
          >
            {busy ? (
              <>
                <Ripple small label="Salvando" />
                Salvando…
              </>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
