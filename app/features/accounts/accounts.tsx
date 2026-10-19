"use client";
import { PortfolioManager } from "./portfolio-manager";
import { FeatureTabs } from "../../ui/feature-tabs";
import { useState } from "react";
import { InvoiceManager } from "./invoice-manager";
import { CategoryManager } from "./category-manager";
import { CreditCard, Plus, Trash2, Pencil, Wallet } from "lucide-react";
import { money, balance } from "../../../lib/finance";
import { Empty } from "../../components";
import { type Actions } from "../shared";
function AccountsList(p: Actions & { openInvoices: () => void }) {
  const accounts = p.entries.filter((e) => e.kind === "account");
  const cards = p.entries.filter((e) => e.kind === "card");
  return (
    <>
      <div className="section-heading">
        <h2>Suas contas</h2>
        <button className="button" onClick={() => p.edit("account")}>
          <Plus size={16} />
          Adicionar conta
        </button>
      </div>
      <div className="cards-grid">
        {accounts.map((e) => (
          <section className="card account-card" key={e.id}>
            <div className="group-heading">
              <div className="bank-logo" style={{ color: e.color }}>
                <Wallet size={24} />
              </div>
              <b className="grow">{e.name}</b>
              <button title="Editar conta" onClick={() => p.edit("account", e)}>
                <Pencil size={16} />
              </button>
              <button title="Excluir conta" onClick={() => p.remove(e)}>
                <Trash2 size={16} />
              </button>
            </div>
            <small>Saldo atual</small>
            <strong>{money(balance(e, p.entries))}</strong>
            <div className="subtle small-text">
              Saldo inicial {money(e.initial || 0)}
            </div>
          </section>
        ))}
      </div>
      {!accounts.length && (
        <section className="card">
          <Empty
            title="Cadastre sua primeira conta"
            detail="Adicione um banco ou sua carteira para registrar movimentações."
          />
        </section>
      )}
      <div className="section-heading">
        <h2>Cartões de crédito</h2>
        <button className="button" onClick={() => p.edit("card")}>
          <Plus size={16} />
          Adicionar cartão
        </button>
      </div>
      <div className="cards-grid">
        {cards.map((e) => {
          const used = Math.max(0, -balance(e, p.entries));
          return (
            <section className="card credit-card" key={e.id}>
              <div
                className="credit-top"
                style={{
                  background: `linear-gradient(120deg,${e.color || "#385a68"},#17232d)`,
                }}
              >
                <CreditCard size={24} />
                <b>{e.name}</b>
                <span>•••• •••• ••••</span>
                <small>
                  FECHA DIA {e.closing} · VENCE DIA {e.day}
                </small>
              </div>
              <div className="credit-info">
                <div className="group-details">
                  <span>Saldo devedor atual</span>
                  <b>{money(used)}</b>
                </div>
                <div className="progress">
                  <i
                    style={{
                      width: `${Math.min(100, (used / (e.limit || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="group-details">
                  <span>Limite disponível</span>
                  <b>{money(Math.max(0, (e.limit || 0) - used))}</b>
                </div>
                <div className="form-actions">
                  <button
                    className="button"
                    title="Editar cartão"
                    onClick={() => p.edit("card", e)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="button primary"
                    disabled={!used}
                    onClick={p.openInvoices}
                  >
                    Pagar cartão
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="notice wide">
        Compras no cartão entram como despesas na data da compra. O pagamento do
        cartão é uma transferência, para evitar contar a despesa duas vezes. O
        saldo devedor reúne todas as compras registradas; confira o extrato do
        banco para o valor da fatura.
      </div>
    </>
  );
}

export function Accounts(p: Actions) {
  const [tab, setTab] = useState("Contas");
  return (
    <>
      <FeatureTabs
        values={["Contas", "Faturas", "Categorias", "Investimentos"]}
        value={tab}
        onChange={setTab}
        label="Contas e organização"
      />
      <div role="tabpanel">
        {tab === "Contas" ? (
          <AccountsList {...p} openInvoices={() => setTab("Faturas")} />
        ) : tab === "Faturas" ? (
          <InvoiceManager {...p} />
        ) : tab === "Categorias" ? (
          <CategoryManager {...p} />
        ) : (
          <PortfolioManager {...p} />
        )}
      </div>
    </>
  );
}
