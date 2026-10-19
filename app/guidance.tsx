"use client";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  HelpCircle,
  Pin,
  Wallet,
  X,
} from "lucide-react";
import { Modal } from "./components";
import {
  normalizeNavigation,
  type NavigationPreferences,
  type NavigationLabel,
} from "../lib/navigation";
import type { Entry, Kind } from "../lib/finance";
export function GettingStarted({
  entries,
  onCreate,
  onNavigate,
  onHide,
  onHelp,
}: {
  entries: Entry[];
  onCreate: (kind: Kind) => void;
  onNavigate: (page: string) => void;
  onHide: () => void;
  onHelp: () => void;
}) {
  const account = entries.some((e) => e.kind === "account"),
    transaction = entries.some((e) => e.kind === "transaction"),
    budget = entries.some((e) => e.kind === "budget" || e.kind === "goal");
  return (
    <section className="card getting-started" aria-label="Primeiros passos">
      <div className="guide-heading">
        <div>
          <p className="eyebrow">COMECE POR AQUI</p>
          <h2>
            {account
              ? "Seu próximo passo."
              : "Organize suas finanças em três passos."}
          </h2>
          <p>
            Uma conta financeira é onde o dinheiro fica: banco, carteira ou
            dinheiro em espécie.
          </p>
        </div>
        <button
          className="guide-icon"
          aria-label="Ocultar primeiros passos"
          onClick={onHide}
        >
          <X size={18} />
        </button>
      </div>
      <ol className="getting-started-steps">
        {[
          {
            done: account,
            title: "Adicione uma conta financeira",
            detail:
              "Ex.: Nubank, Bradesco ou carteira. Informe seu saldo ao começar.",
            action: () =>
              account ? onNavigate("Contas e cartões") : onCreate("account"),
            cta: account ? "Ver minhas contas" : "Adicionar primeira conta",
          },
          {
            done: transaction,
            title: "Registre entradas e saídas",
            detail:
              "Escolha de onde o dinheiro entrou ou saiu. Os totais são atualizados.",
            action: () => onCreate("transaction"),
            cta: transaction
              ? "Nova transação"
              : "Registrar primeira transação",
          },
          {
            done: budget,
            title: "Planeje seu próximo objetivo",
            detail:
              "Defina um limite de gastos ou comece a guardar para uma meta.",
            action: () => onNavigate("Planejamento"),
            cta: "Conhecer o planejamento",
          },
        ].map((step, i) => (
          <li key={step.title} className={step.done ? "step-done" : ""}>
            <span className="guide-step-number">
              {step.done ? <Check size={18} /> : i + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              <button className="text-button" onClick={step.action}>
                {step.cta} →
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button className="text-button" onClick={onHelp}>
        <HelpCircle size={15} />
        Abrir guia completo
      </button>
    </section>
  );
}
const tips: Record<
  string,
  {
    title: string;
    body: string;
  }
> = {
  Transações: {
    title: "Toda movimentação tem uma conta financeira.",
    body: "Receita é dinheiro que entrou; despesa é dinheiro que saiu. Transferência move dinheiro entre duas contas suas. “Concluído” altera o saldo; “Pendente” ajuda no planejamento. O mês escolhido filtra os lançamentos.",
  },
  "Contas e cartões": {
    title: "Comece por onde seu dinheiro fica.",
    body: "Adicione seus bancos, carteira ou dinheiro em espécie. O saldo inicial é o que você já tinha ao começar a usar o WZY. Depois, registre as movimentações. Cadastrar uma conta aqui não conecta automaticamente o banco.",
  },
  "Contas recorrentes": {
    title: "Cadastre uma vez. Acompanhe todo mês.",
    body: "Use para luz, internet ou aluguel. Ao clicar em “Pagar”, o WZY cria a despesa na conta escolhida. Evite registrar outra despesa igual para não contar o pagamento duas vezes.",
  },
  "Assinaturas em grupo": {
    title: "Inclua todos os participantes, inclusive você.",
    body: "O valor é dividido entre os nomes cadastrados. Marque os pagamentos de cada mês. Participantes são nomes para organizar a divisão; eles não acessam suas finanças.",
  },
  Orçamentos: {
    title: "Um limite para cada categoria.",
    body: "Escolha uma categoria e um limite mensal. O WZY compara com as despesas concluídas. Para transferir a sobra, ative essa opção e escolha o mês inicial.",
  },
  Metas: {
    title: "Acompanhe o que você está guardando.",
    body: "Defina o valor desejado e o aporte mensal. “Adicionar à meta” atualiza o acompanhamento; para mover dinheiro entre contas, registre uma transferência.",
  },
  Dívidas: {
    title: "Informe o total da dívida e as parcelas.",
    body: "Inclua quantas parcelas já estavam pagas antes de usar o WZY. Ao pagar uma parcela pelo botão, uma despesa é registrada sem alterar as parcelas anteriores.",
  },
  Conciliação: {
    title: "Confira o extrato antes de importar.",
    body: "Escolha uma conta em reais e envie OFX ou CSV. Revise a prévia: criar, combinar com um lançamento existente ou ignorar. Apenas a confirmação grava os registros.",
  },
  Planejamento: {
    title: "Explore o futuro com seus registros.",
    body: "Cadastre compromissos e receitas pendentes para ver os próximos 30, 60 ou 90 dias. Os cenários simulam mudanças sem alterar seus dados. A projeção não inclui movimentações que ainda não foram cadastradas.",
  },
  "Moedas e parcelas": {
    title: "Lance o valor na moeda da carteira.",
    body: "Crie carteiras em outras moedas ou divida uma compra em parcelas. As futuras ficam pendentes: atualize o status quando a movimentação acontecer.",
  },
  Arquivos: {
    title: "Guarde e vincule seus comprovantes.",
    body: "Envie um arquivo aqui. Depois, edite a transação e escolha o comprovante. Os arquivos ficam privados para sua conta.",
  },
  Inteligência: {
    title: "Faça perguntas sobre seus lançamentos.",
    body: "Experimente “Quanto gastei com alimentação neste mês?”. As respostas usam os registros disponíveis. Avisos de anomalia pedem conferência e não comprovam fraude.",
  },
};
export function ContextTip({
  page,
  onHelp,
}: {
  page: string;
  onHelp: () => void;
}) {
  const tip = tips[page];
  return tip ? (
    <details className="context-tip">
      <summary>
        <HelpCircle size={17} />
        <span>{tip.title}</span>
        <span className="tip-open-label">Como funciona</span>
      </summary>
      <p>{tip.body}</p>
      <button className="text-button" onClick={onHelp}>
        Ver guia completo →
      </button>
    </details>
  ) : null;
}
export function Prerequisite({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <Modal title="Primeiro, adicione uma conta financeira" onClose={onClose}>
      <div className="prerequisite-icon">
        <Wallet size={30} />
      </div>
      <p>
        Para registrar uma movimentação, o WZY precisa saber{" "}
        <b>onde o dinheiro entrou ou saiu</b>.
      </p>
      <p className="subtle">
        Cadastre, por exemplo, “Nubank”, “Bradesco” ou “Minha carteira”. Isso
        organiza os registros; não conecta seu banco automaticamente.
      </p>
      <div className="form-actions">
        <button className="button" onClick={onClose}>
          Voltar
        </button>
        <button className="button primary" onClick={onCreate}>
          Adicionar conta financeira
        </button>
      </div>
    </Modal>
  );
}
export function HelpGuide({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (s: string) => void;
}) {
  return (
    <Modal title="Como usar o WZY" onClose={onClose}>
      <div className="guide-content">
        <p>
          Seu perfil é seu acesso ao site. Uma <b>conta financeira</b> é um
          banco, carteira ou cartão que você cadastra para organizar o dinheiro.
        </p>
        <ol>
          <li>
            <b>Adicione uma conta financeira.</b>
            <p>
              Em Contas e cartões, escolha um nome e informe o saldo inicial que
              você já tinha. Para dinheiro em espécie, crie uma carteira.
            </p>
          </li>
          <li>
            <b>Registre suas movimentações.</b>
            <p>
              Uma receita aumenta o saldo; uma despesa o diminui. Escolha a
              conta, data e categoria. Use transferência para mover dinheiro
              entre suas próprias contas.
            </p>
          </li>
          <li>
            <b>Organize os compromissos.</b>
            <p>
              Luz e internet vão em Contas recorrentes. Use “Pagar” para criar a
              despesa. Compras parceladas vão em Moedas e parcelas.
            </p>
          </li>
          <li>
            <b>Defina limites e metas.</b>
            <p>
              Orçamentos mostram quanto pode gastar por categoria. Metas
              acompanham o que você está guardando. Planejamento mostra os
              vencimentos e os cenários.
            </p>
          </li>
        </ol>
        <details>
          <summary>Por que um valor não aparece no saldo?</summary>
          <p>
            Confira a conta escolhida e o status: apenas movimentos concluídos
            alteram o saldo. Nos relatórios, confira também o mês selecionado.
          </p>
        </details>
        <details>
          <summary>Preciso cadastrar todo meu histórico?</summary>
          <p>
            Você pode começar pelo saldo atual de suas contas e registrar as
            próximas movimentações. Para importar um extrato anterior, confira o
            saldo inicial para não contar os mesmos valores duas vezes.
          </p>
        </details>
        <details>
          <summary>Como dividir YouTube ou Spotify?</summary>
          <p>
            Crie uma assinatura em grupo, inclua os participantes e você na
            lista, e marque quem pagou no mês. Isso não dá acesso à sua conta a
            outras pessoas.
          </p>
        </details>
        <details>
          <summary>Posso deixar os atalhos do meu jeito?</summary>
          <p>
            Abra “Personalizar menu”. Use as setas para ordenar as opções e fixe
            até quatro. Suas escolhas ficam salvas na sua conta, inclusive ao
            entrar em outro dispositivo.
          </p>
        </details>
        <div className="form-actions">
          <button
            className="button"
            onClick={() => {
              onClose();
              onNavigate("Contas e cartões");
            }}
          >
            Abrir contas e cartões
          </button>
          <button className="button primary" onClick={onClose}>
            Entendi
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function SidebarCustomizer({
  preferences,
  onSave,
  onClose,
  demo,
}: {
  preferences: NavigationPreferences;
  onSave: (p: NavigationPreferences) => Promise<void>;
  onClose: () => void;
  demo: boolean;
}) {
  const [draft, setDraft] = useState(() => normalizeNavigation(preferences)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function move(label: NavigationLabel, delta: number) {
    setDraft((p) => {
      const order = [...p.sidebarOrder],
        i = order.indexOf(label),
        next = i + delta;
      if (next < 0 || next >= order.length) return p;
      [order[i], order[next]] = [order[next], order[i]];
      return { ...p, sidebarOrder: order };
    });
  }
  return (
    <Modal
      title="Personalizar menu"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="subtle">
        Mude a ordem com as setas e fixe até quatro atalhos no início do menu.
        Ao misturar seções, sua ordem aparece em uma lista única.{" "}
        {demo
          ? "Na demonstração, as mudanças duram até recarregar a página."
          : "As preferências ficam salvas na sua conta. No celular, os três primeiros fixados também aparecem na barra inferior."}
      </p>
      <ol className="sidebar-editor">
        {draft.sidebarOrder.map((label, i) => (
          <li key={label}>
            <span className="sidebar-editor-label">{label}</span>
            <label className="pin-choice">
              <input
                type="checkbox"
                aria-label={"Fixar " + label}
                checked={draft.sidebarPinned.includes(label)}
                disabled={
                  busy ||
                  (!draft.sidebarPinned.includes(label) &&
                    draft.sidebarPinned.length >= 4)
                }
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    sidebarPinned: e.target.checked
                      ? [...p.sidebarPinned, label]
                      : p.sidebarPinned.filter((x) => x !== label),
                  }))
                }
              />
              <Pin size={15} />
              <span>Fixar</span>
            </label>
            <div className="sidebar-order-actions">
              <button
                type="button"
                disabled={i === 0 || busy}
                aria-label={"Mover " + label + " para cima"}
                onClick={() => move(label, -1)}
              >
                <ArrowUp size={17} />
              </button>
              <button
                type="button"
                disabled={i === draft.sidebarOrder.length - 1 || busy}
                aria-label={"Mover " + label + " para baixo"}
                onClick={() => move(label, 1)}
              >
                <ArrowDown size={17} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="subtle" aria-live="polite">
        {draft.sidebarPinned.length} de 4 atalhos fixados.
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            setDraft(
              normalizeNavigation({ guideDismissed: draft.guideDismissed }),
            )
          }
        >
          Restaurar menu padrão
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(draft);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Salvando…" : "Salvar meu menu"}
        </button>
      </div>
    </Modal>
  );
}
