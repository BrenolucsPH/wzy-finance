"use client";
import Image from "next/image";
import { useOnline } from "../hooks/use-online";
import { OfflineWorkspace } from "./features/offline/workspace";
import { Invitation } from "./features/groups/invitation";
import dynamic from "next/dynamic";
import { useNavigation } from "../hooks/use-navigation";
import { requestJSON } from "../lib/client";
import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CalendarDays,
  Users,
  Wallet,
  CreditCard,
  Target,
  ChartNoAxesCombined,
  Settings,
  HelpCircle,
  SlidersHorizontal,
  Pin,
  PanelLeftClose,
  Plus,
  ChevronDown,
  Moon,
  Sun,
  Bell,
  Landmark,
  FileText,
  Menu,
  LogOut,
  LogIn,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { demoData, localDate, type Entry, type Kind } from "../lib/finance";
import { api, type Person } from "../lib/client";
import { Modal } from "./ui/modal";
const Auth = dynamic(
  () => import("./features/auth/auth-screen").then((m) => m.Auth),
  { loading: () => <PageSkeleton /> },
);
const Editor = dynamic(
  () => import("./features/transactions/entry-editor").then((m) => m.Editor),
  { loading: () => <PageSkeleton /> },
);
import {
  Overview,
  Recurring,
  Groups,
  Accounts,
  Plans,
  Reports,
  isPaid,
  type Actions,
} from "./views";
import { PageSkeleton, Notification, Ripple } from "./motion-ui";
const Security = dynamic(() => import("./settings").then((m) => m.Security), {
  loading: () => <PageSkeleton />,
});
const Files = dynamic(() => import("./settings").then((m) => m.Files), {
  loading: () => <PageSkeleton />,
});
const Transactions = dynamic(
  () =>
    import("./features/transactions/paged-transactions").then(
      (m) => m.PagedTransactions,
    ),
  { loading: () => <PageSkeleton /> },
);
import { Avatar } from "./account-center";
import {
  GettingStarted,
  ContextTip,
  Prerequisite,
  HelpGuide,
  SidebarCustomizer,
} from "./guidance";
import {
  normalizeNavigation,
  navigationGroup as navGroup,
  type NavigationPreferences,
} from "../lib/navigation";
import { requestJSON as financeApi } from "../lib/client";
const Infrastructure = dynamic(
  () => import("./infrastructure").then((m) => m.Infrastructure),
  { loading: () => <PageSkeleton /> },
);
const PlanningHub = dynamic(
  () => import("./finance-hub").then((m) => m.PlanningHub),
  { loading: () => <PageSkeleton /> },
);
const IntelligenceHub = dynamic(
  () => import("./finance-hub").then((m) => m.IntelligenceHub),
  { loading: () => <PageSkeleton /> },
);
const ReconciliationHub = dynamic(
  () => import("./finance-hub").then((m) => m.ReconciliationHub),
  { loading: () => <PageSkeleton /> },
);
const CurrencyHub = dynamic(
  () => import("./finance-hub").then((m) => m.CurrencyHub),
  { loading: () => <PageSkeleton /> },
);
const nav = [
  ["Visão geral", LayoutDashboard],
  ["Transações", ArrowLeftRight],
  ["Contas recorrentes", CalendarDays],
  ["Assinaturas em grupo", Users],
  ["Contas e cartões", Wallet],
  ["Orçamentos", ChartNoAxesCombined],
  ["Metas", Target],
  ["Dívidas", CreditCard],
  ["Relatórios", ChartNoAxesCombined],
  ["Arquivos", FileText],
  ["Planejamento", CalendarDays],
  ["Conciliação", ArrowLeftRight],
  ["Inteligência", ChartNoAxesCombined],
  ["Moedas e parcelas", Wallet],
  ["Privacidade e offline", ShieldCheck],
] as const;
const kinds: Record<string, Kind> = {
  "Visão geral": "transaction",
  Transações: "transaction",
  "Contas recorrentes": "recurring",
  "Assinaturas em grupo": "group",
  "Contas e cartões": "account",
  Orçamentos: "budget",
  Metas: "goal",
  Dívidas: "debt",
};
const descriptions: Record<string, string> = {
  "Visão geral": "Acompanhe seu presente. Planeje seu próximo passo.",
  Transações: "Cada entrada e saída, no seu devido lugar.",
  "Contas recorrentes": "Os compromissos do mês, sem surpresas.",
  "Assinaturas em grupo": "Divida a assinatura. Simplifique a organização.",
  "Contas e cartões": "Um panorama de onde seu dinheiro está.",
  Orçamentos: "Dê um limite aos gastos. Dê espaço aos planos.",
  Metas: "Seu próximo passo começa com uma escolha.",
  Dívidas: "Menos pendências. Mais tranquilidade.",
  Relatórios: "Veja os números por trás das suas escolhas.",
  Arquivos: "Guarde comprovantes e documentos das suas finanças.",
  Planejamento: "Antecipe seus compromissos. Explore suas possibilidades.",
  Conciliação: "Seu extrato e seus registros, lado a lado.",
  Inteligência: "Descubra o que seus números têm a dizer.",
  "Moedas e parcelas": "Organize moedas, carteiras e compras parceladas.",
  "Privacidade e offline": "Seu acesso, suas cópias e seus direitos.",
  Configurações: "Um espaço com a sua cara. Um acesso protegido.",
};
export default function Dashboard() {
  const [menuSearch, setMenuSearch] = useState("");
  const online = useOnline(),
    [localMode, setLocalMode] = useState(false);
  useEffect(() => {
    if (!online) {
      const timer = setTimeout(() => setLocalMode(true), 0);
      return () => clearTimeout(timer);
    }
  }, [online]);
  const [menuPreferences, setMenuPreferences] = useState(() =>
      normalizeNavigation(null),
    ),
    [guide, setGuide] = useState(false),
    [customizeMenu, setCustomizeMenu] = useState(false),
    [prerequisite, setPrerequisite] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [widgets, setWidgets] = useState([
    "cash-flow",
    "upcoming",
    "transactions",
    "subscriptions",
  ]);
  useEffect(() => {
    const listener = (e: Event) =>
      setWidgets((e as CustomEvent<string[]>).detail);
    window.addEventListener("wzy-widgets", listener);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => window.removeEventListener("wzy-widgets", listener);
  }, []);
  const { page, exiting, navigate: changePage } = useNavigation();
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [user, setUser] = useState<Person | null>(null);
  useEffect(() => {
    if (!mobile) return;
    const scrollY = window.scrollY,
      old = {
        overflow: document.body.style.overflow,
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
      };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = -scrollY + "px";
    document.body.style.width = "100%";
    return () => {
      Object.assign(document.body.style, old);
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, [mobile]);
  useEffect(() => {
    const query = window.matchMedia("(max-width:1000px)"),
      changed = () => {
        setMobile(false);
        if (query.matches) setCollapsed(false);
      };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  const [entries, setEntries] = useState<Entry[]>(
    demoData(localDate().slice(0, 7)),
  );
  const [auth, setAuth] = useState(false);
  const [reset, setReset] = useState<string>();
  const [editor, setEditor] = useState<{
    kind: Kind;
    entry?: Entry;
  } | null>(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deletion, setDeletion] = useState<Entry | null>(null);
  const [payment, setPayment] = useState<Entry | null>(null);
  const [payError, setPayError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => {
      const selected = new URLSearchParams(location.search).get("month");
      if (selected && /^20\d{2}-(0[1-9]|1[0-2])$/.test(selected))
        setMonth(selected);
    };
    const timer = setTimeout(read, 0);
    window.addEventListener("popstate", read);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", read);
    };
  }, []);
  useEffect(() => {
    if (user?.id)
      void requestJSON("telemetry", { event: "visit" }).catch(() => {});
  }, [user?.id]);
  const notify = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError("");
      try {
        const r = await api("auth/me");
        setUser(r.user);
        if (r.user) {
          const [data, prefs] = await Promise.all([
            requestJSON<{ entries: Entry[] }>(
              "workspace/snapshot?month=" + month,
            ),
            fetch("/api/finance/preferences", {
              credentials: "same-origin",
            }).then((r) => r.json()),
          ]);
          setMenuPreferences(
            normalizeNavigation(
              (
                prefs as {
                  preferences?: unknown;
                }
              ).preferences,
            ),
          );
          setEntries(data.entries);
          setWidgets(
            (
              prefs as {
                preferences?: {
                  overviewWidgets?: string[];
                };
              }
            ).preferences?.overviewWidgets || [
              "cash-flow",
              "upcoming",
              "transactions",
              "subscriptions",
            ],
          );
        } else {
          setEntries(demoData(localDate().slice(0, 7)));
          setMenuPreferences(normalizeNavigation(null));
          setWidgets([
            "cash-flow",
            "upcoming",
            "transactions",
            "subscriptions",
          ]);
        }
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [month],
  );
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      refresh();
      const stored = localStorage.getItem("aurum-theme");
      setDark(stored === "dark");
      const params = new URLSearchParams(location.search);
      const invite = params.get("invite");
      if (invite) setInviteToken(invite);
      const token = params.get("reset");
      if (token) {
        setReset(token);
        setAuth(true);
      }
      if (params.has("login")) setAuth(true);
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    async function checkAccess() {
      if (document.hidden) return;
      try {
        const r = await api("auth/me");
        if (!active) return;
        if (!r.user) {
          setUser(null);
          setEntries(demoData(localDate().slice(0, 7)));
          setAuth(true);
          notify("Seu acesso foi encerrado. Entre novamente.");
        }
      } catch {
        /* A temporary network failure does not sign out a valid session. */
      }
    }
    const timer = setInterval(checkAccess, 60000);
    window.addEventListener("focus", checkAccess);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", checkAccess);
    };
  }, [user?.id, notify]);
  function theme(d: boolean) {
    setDark(d);
    localStorage.setItem("aurum-theme", d ? "dark" : "light");
  }
  function navigate(s: string) {
    setMobile(false);
    changePage(s);
  }
  function login() {
    setAuth(true);
  }
  async function saveMenu(next: NavigationPreferences) {
    const changes = {
      sidebarOrder: next.sidebarOrder,
      sidebarPinned: next.sidebarPinned,
    };
    if (user) await financeApi("finance/preferences", changes);
    setMenuPreferences((p) => ({ ...p, ...changes }));
    notify(
      user
        ? "Seu menu foi salvo para todos os seus dispositivos."
        : "Menu de demonstração atualizado.",
    );
  }
  async function hideGuide() {
    try {
      const next = { ...menuPreferences, guideDismissed: true };
      if (user)
        await financeApi("finance/preferences", { guideDismissed: true });
      setMenuPreferences(next);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function edit(kind: Kind, entry?: Entry) {
    if (!user) {
      login();
      return;
    }

    setEditor({ kind, entry });
  }
  async function save(e: Entry) {
    if (!user) {
      login();
      throw new Error("Entre para salvar seus dados.");
    }
    const r = await api("records", e);
    setEntries((items) =>
      items.some((i) => i.id === e.id)
        ? items.map((i) => (i.id === e.id ? r.entry : i))
        : [...items, r.entry],
    );
    await refresh(true);
    notify("Registro salvo.");
  }
  function remove(e: Entry) {
    if (!user) {
      login();
      return;
    }
    setDeletion(e);
  }
  function pay(e: Entry) {
    if (!user) {
      login();
      return;
    }
    if (!entries.some((e) => e.kind === "account")) {
      setPrerequisite(true);
      return;
    }
    setPayment(e);
    setPayError("");
  }
  async function done(u: Person) {
    setUser(u);
    setAuth(false);
    setReset(undefined);
    history.replaceState(null, "", "/");
    setEntries([]);
    setLoading(true);
    await refresh();
    notify("Bem-vindo ao seu espaço.");
  }
  const p: Actions = {
    entries,
    month,
    edit,
    save,
    remove,
    pay,
    navigate,
    notify,
    authenticated: !!user,
    refresh: () => refresh(true),
  };
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeDelete = useCallback(() => setDeletion(null), []);
  const closePayment = useCallback(() => setPayment(null), []);
  if (!online || localMode)
    return (
      <div className={"shell offline-shell " + (dark ? "dark" : "")}>
        <main id="conteudo">
          <div className="page-heading">
            <h1>WZY · Cofre local</h1>
            <button
              className="button"
              disabled={!online}
              onClick={() => setLocalMode(false)}
            >
              Voltar ao sistema
            </button>
          </div>
          <OfflineWorkspace
            user={user}
            notify={notify}
            onSync={async () => {
              await refresh(true);
              setLocalMode(false);
            }}
          />
        </main>
      </div>
    );
  if (auth)
    return (
      <Auth
        onDone={done}
        onClose={() => {
          setAuth(false);
          setReset(undefined);
          history.replaceState(null, "", "/");
        }}
        resetToken={reset}
      />
    );
  const accounts = entries.filter(
    (e) => e.kind === "account" || e.kind === "card",
  );
  const mon = new Date(month + "-02T12:00:00").toLocaleString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const orderedNav = menuPreferences.sidebarOrder.map((label) =>
    nav.find((item) => item[0] === label)!,
  );
  const pinnedNav = orderedNav.filter(([label]) =>
    menuPreferences.sidebarPinned.includes(label),
  );
  const remainingNav = orderedNav.filter(
    ([label]) =>
      !menuPreferences.sidebarPinned.includes(label) &&
      label
        .toLocaleLowerCase("pt-BR")
        .includes(menuSearch.toLocaleLowerCase("pt-BR")),
  );
  const mobileNav = pinnedNav.length
    ? pinnedNav.slice(0, 3)
    : [nav[0], nav[1], nav[3]];
  const sectionStarts = remainingNav
    .filter(
      ([label], index) =>
        index === 0 || navGroup(remainingNav[index - 1][0]) !== navGroup(label),
    )
    .map(([label]) => navGroup(label));
  // A custom order may interleave sections. Keep that order without placing
  // items beneath misleading or repeated section headings.
  const showSections = new Set(sectionStarts).size === sectionStarts.length;
  const unpaid = entries.filter(
    (e) => e.kind === "recurring" && !isPaid(e, entries, month),
  );
  return (
    <div
      className={`shell ${dark ? "dark" : ""} ${collapsed ? "collapsed" : ""} ${mobile ? "menu-open" : ""}`}
    >
      <a href="#conteudo" className="skip-link">
        Ir para o conteúdo
      </a>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <Image
            className="horse-mark"
            src="/wzy-horse.png"
            alt=""
            width="42"
            height="42"
          />
          <strong>WZY</strong>
        </div>
        <button
          className="space-picker"
          onClick={() => navigate("Configurações")}
        >
          <span className="space-icon">
            <Landmark size={18} />
          </span>
          <span>
            Meu espaço<small>Finanças pessoais</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <nav aria-label="Menu principal">
          <label className="menu-search">
            <span className="sr-only">Buscar no menu</span>
            <input
              aria-label="Buscar no menu"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Encontrar ferramenta…"
            />
          </label>
          {pinnedNav.length > 0 && <p className="nav-label">FIXADOS</p>}
          {pinnedNav.map(([label, Icon]) => (
            <button
              className={page === label ? "active" : ""}
              key={label}
              aria-current={page === label ? "page" : undefined}
              onClick={() => navigate(label)}
              title={label}
            >
              <Icon size={19} />
              <span>{label}</span>
              <Pin size={12} className="menu-pin" aria-hidden="true" />
            </button>
          ))}
          {!showSections && remainingNav.length > 0 && (
            <p className="nav-label">SEU MENU</p>
          )}
          {remainingNav.map(([label, Icon], index) => (
            <span className="nav-item-group" key={label}>
              {showSections &&
                (index === 0 ||
                  navGroup(remainingNav[index - 1][0]) !== navGroup(label)) && (
                  <p className="nav-label">{navGroup(label)}</p>
                )}
              <button
                className={page === label ? "active" : ""}
                key={label}
                aria-current={page === label ? "page" : undefined}
                onClick={() => navigate(label)}
                title={label}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            </span>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span>✦</span>
            <b>Mais clareza. Mais liberdade.</b>
            <p>Cada escolha conta para o seu próximo passo.</p>
          </div>
          <button
            onClick={() => navigate("Configurações")}
            title="Configurações"
          >
            <Settings size={19} />
            <span>Configurações</span>
          </button>
          <button
            onClick={() => {
              setMobile(false);
              setGuide(true);
            }}
            title="Como usar o WZY"
          >
            <HelpCircle size={19} />
            <span>Como usar o WZY</span>
          </button>
          <button
            onClick={() => {
              setMobile(false);
              setCustomizeMenu(true);
            }}
            title="Personalizar menu"
          >
            <SlidersHorizontal size={19} />
            <span>Personalizar menu</span>
          </button>
          <button
            className="sidebar-collapse"
            onClick={() => setCollapsed(!collapsed)}
            title="Recolher ou expandir menu"
          >
            <PanelLeftClose size={19} />
            <span>{collapsed ? "Expandir menu" : "Recolher menu"}</span>
          </button>
          <div
            className="profile"
            role="button"
            tabIndex={0}
            onClick={() => (user ? navigate("Configurações") : login())}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (user) navigate("Configurações");
                else login();
              }
            }}
          >
            <Avatar user={user} />
            <div>
              <b>{user?.name || "Conheça o WZY"}</b>
              <small>{user ? "Meu perfil" : "Entre ou crie sua conta"}</small>
            </div>
            {user ? <ShieldCheck size={17} /> : <LogIn size={17} />}
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb-wrap">
            <button
              className="mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">Meu espaço</span>
            <span className="slash">/</span>
            <b>{page}</b>
          </div>
          <div className="header-tools">
            {!user ? (
              <button className="demo-badge" onClick={login}>
                Demonstração · Entrar
              </button>
            ) : (
              <button
                aria-label="Atualizar dados"
                disabled={loading}
                onClick={() => refresh()}
              >
                {loading ? <Ripple small /> : <RefreshCw size={17} />}
              </button>
            )}
            <button aria-label="Alterar tema" onClick={() => theme(!dark)}>
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              aria-label="Abrir guia de uso"
              onClick={() => setGuide(true)}
            >
              <HelpCircle size={19} />
            </button>
            <button
              aria-label="Ver vencimentos"
              onClick={() => navigate("Contas recorrentes")}
            >
              <Bell size={19} />
              {unpaid.length > 0 && <em />}
            </button>
            {user && (
              <button
                title="Sair da conta"
                onClick={async () => {
                  try {
                    await api("auth/logout", {});
                    setUser(null);
                    setEntries(demoData(month));
                    setMenuPreferences(normalizeNavigation(null));
                    setWidgets([
                      "cash-flow",
                      "upcoming",
                      "transactions",
                      "subscriptions",
                    ]);
                    navigate("Visão geral");
                    notify("Você saiu da sua conta.");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            )}
            <Avatar user={user} small />
          </div>
        </header>
        <main id="conteudo" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">SEU DINHEIRO, EM PERSPECTIVA</p>
              <h1>{page === "Visão geral" ? "Tudo sob controle." : page}</h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="heading-actions">
              {page !== "Configurações" && page !== "Arquivos" && (
                <label className="button period">
                  <CalendarDays size={17} />
                  <input
                    type="month"
                    aria-label="Mês de referência"
                    value={month}
                    min="2000-01"
                    max="2100-12"
                    onChange={(e) => {
                      if (e.target.value) {
                        setMonth(e.target.value);
                        const url = new URL(location.href);
                        url.searchParams.set("month", e.target.value);
                        history.replaceState(
                          null,
                          "",
                          url.pathname + url.search,
                        );
                      }
                    }}
                  />
                </label>
              )}
              {kinds[page] && (
                <button
                  className="button primary"
                  disabled={loading}
                  onClick={() => edit(kinds[page])}
                >
                  <Plus size={18} />
                  {page === "Visão geral" || page === "Transações"
                    ? "Nova transação"
                    : page === "Assinaturas em grupo"
                      ? "Criar grupo"
                      : page === "Contas recorrentes"
                        ? "Nova conta"
                        : page === "Contas e cartões"
                          ? "Adicionar conta"
                          : "Adicionar"}
                </button>
              )}
            </div>
          </div>
          {!user && !loading && (
            <div className="demo-note">
              <span>
                Você está explorando dados de exemplo. Crie sua conta para
                organizar suas finanças.
              </span>
              <button onClick={login}>Criar meu espaço</button>
            </div>
          )}
          {!loading && <ContextTip page={page} onHelp={() => setGuide(true)} />}
          {user &&
            !loading &&
            page === "Visão geral" &&
            !menuPreferences.guideDismissed && (
              <GettingStarted
                entries={entries}
                onCreate={edit}
                onNavigate={navigate}
                onHide={hideGuide}
                onHelp={() => setGuide(true)}
              />
            )}
          {loadError && (
            <div className="form-error" role="alert">
              {loadError}{" "}
              <button onClick={() => refresh()}>Tentar novamente</button>
              <button className="button" onClick={() => setLocalMode(true)}>
                Usar meu cofre local
              </button>
            </div>
          )}
          {loading ? (
            <PageSkeleton page={page} />
          ) : (
            <div
              className={`view-content ${exiting ? "view-exiting" : ""}`}
              key={page}
            >
              {page === "Visão geral" ? (
                <div
                  className={[
                    "overview-custom",
                    ...[
                      "cash-flow",
                      "upcoming",
                      "transactions",
                      "subscriptions",
                    ]
                      .filter((w) => !widgets.includes(w))
                      .map((w) => "hide-" + w),
                  ].join(" ")}
                >
                  <Overview {...p} />
                </div>
              ) : page === "Transações" ? (
                <Transactions {...p} />
              ) : page === "Contas recorrentes" ? (
                <Recurring {...p} />
              ) : page === "Assinaturas em grupo" ? (
                <Groups {...p} />
              ) : page === "Contas e cartões" ? (
                <Accounts {...p} />
              ) : page === "Orçamentos" ? (
                <Plans {...p} kind="budget" />
              ) : page === "Metas" ? (
                <Plans {...p} kind="goal" />
              ) : page === "Dívidas" ? (
                <Plans {...p} kind="debt" />
              ) : page === "Relatórios" ? (
                <Reports {...p} />
              ) : page === "Arquivos" ? (
                <Files
                  key={user?.id || "demo"}
                  demo={!user}
                  login={login}
                  notify={notify}
                />
              ) : page === "Planejamento" ? (
                <PlanningHub
                  {...p}
                  user={user}
                  login={login}
                  refresh={() => refresh(true)}
                />
              ) : page === "Conciliação" ? (
                <ReconciliationHub
                  {...p}
                  user={user}
                  login={login}
                  refresh={() => refresh(true)}
                />
              ) : page === "Inteligência" ? (
                <IntelligenceHub
                  {...p}
                  user={user}
                  login={login}
                  refresh={() => refresh(true)}
                />
              ) : page === "Moedas e parcelas" ? (
                <CurrencyHub
                  {...p}
                  user={user}
                  login={login}
                  refresh={() => refresh(true)}
                />
              ) : page === "Privacidade e offline" ? (
                <Infrastructure
                  refresh={() => refresh(true)}
                  user={user}
                  entries={entries}
                  notify={notify}
                  login={login}
                />
              ) : (
                <Security
                  user={user}
                  setUser={(u) => {
                    setUser(u);
                    if (!u) setEntries(demoData(month));
                  }}
                  demo={!user}
                  login={login}
                  dark={dark}
                  setDark={theme}
                  notify={notify}
                  entries={entries}
                />
              )}
            </div>
          )}
          <footer>
            Um passo de cada vez. <span>Seu futuro agradece.</span>
            <span className="footer-mark">WZY</span>
          </footer>
        </main>
      </div>
      <div className="mobile-nav">
        {mobileNav.map(([label, Icon]) => (
          <button
            className={page === label ? "active" : ""}
            key={label}
            onClick={() => navigate(label)}
            title={label}
          >
            <Icon size={19} />
            <span>
              {label === "Visão geral"
                ? "Início"
                : label === "Assinaturas em grupo"
                  ? "Grupos"
                  : label}
            </span>
          </button>
        ))}
        <button onClick={() => setMobile(true)}>
          <Menu size={19} />
          <span>Mais</span>
        </button>
      </div>
      {inviteToken && (
        <Invitation
          token={inviteToken}
          authenticated={!!user}
          login={login}
          onClose={() => {
            setInviteToken("");
            const url = new URL(location.href);
            url.searchParams.delete("invite");
            history.replaceState(null, "", url.pathname + url.search);
          }}
          onAccepted={() => {
            setInviteToken("");
            const url = new URL(location.href);
            url.searchParams.delete("invite");
            history.replaceState(null, "", url.pathname + url.search);
            navigate("Assinaturas em grupo");
            notify(
              "Convite aceito. O grupo aparece em Compartilhados com você.",
            );
          }}
        />
      )}
      {guide && (
        <HelpGuide onClose={() => setGuide(false)} onNavigate={navigate} />
      )}
      {customizeMenu && (
        <SidebarCustomizer
          preferences={menuPreferences}
          onSave={saveMenu}
          onClose={() => setCustomizeMenu(false)}
          demo={!user}
        />
      )}
      {prerequisite && (
        <Prerequisite
          onClose={() => setPrerequisite(false)}
          onCreate={() => {
            setPrerequisite(false);
            navigate("Contas e cartões");
            setEditor({ kind: "account" });
          }}
        />
      )}
      {editor && (
        <Editor
          kind={editor.kind}
          entry={editor.entry}
          accounts={accounts}
          onSave={save}
          onClose={closeEditor}
        />
      )}
      {deletion && (
        <Modal title="Excluir registro" onClose={closeDelete}>
          <p>
            Excluir <b>{deletion.name}</b>? Essa ação remove o registro e
            atualiza seus totais.
          </p>
          {payError && <div className="form-error">{payError}</div>}
          <div className="form-actions">
            <button className="button" onClick={closeDelete}>
              Cancelar
            </button>
            <button
              className="button danger-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    "records/" + encodeURIComponent(deletion.id),
                    undefined,
                    "DELETE",
                    { "If-Match": String(deletion._version || "") },
                  );
                  setEntries((x) => x.filter((e) => e.id !== deletion.id));
                  setDeletion(null);
                  await refresh(true);
                  notify(
                    "Registro excluído. O histórico da alteração foi preservado.",
                  );
                } catch (e) {
                  setPayError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <>
                  <Ripple small label="Excluindo" />
                  Excluindo…
                </>
              ) : (
                "Excluir"
              )}
            </button>
          </div>
        </Modal>
      )}
      {payment && (
        <Modal title={"Pagar " + payment.name} onClose={closePayment}>
          <form
            className="entry-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setPayError("");
              const f = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const r = await api("pay", {
                  id: payment.id,
                  month,
                  accountId: f.accountId,
                  date: f.date,
                });
                setEntries((x) => [...x, r.entry]);
                setPayment(null);
                await refresh(true);
                notify("Pagamento registrado.");
              } catch (e) {
                setPayError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="subtle">
              Vencimento de {mon}. Uma despesa será registrada na conta
              escolhida.
            </p>
            <label>
              Conta do pagamento
              <select
                name="accountId"
                defaultValue={
                  payment.accountId ||
                  accounts.find((e) => e.kind === "account")?.id ||
                  ""
                }
                required
              >
                <option value="">Selecione uma conta</option>
                {accounts
                  .filter((e) => e.kind === "account")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Data do pagamento
              <input
                type="date"
                name="date"
                defaultValue={localDate()}
                required
              />
            </label>
            {payError && (
              <div className="form-error" role="alert">
                {payError}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <>
                  <Ripple small label="Registrando" />
                  Registrando…
                </>
              ) : (
                "Confirmar pagamento"
              )}
            </button>
          </form>
        </Modal>
      )}
      <Notification message={toast} onClose={() => setToast("")} />
    </div>
  );
}
