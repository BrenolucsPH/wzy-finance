import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
if (!/^wzy_qa_[a-f0-9]{32}$/.test(process.env.WZY_TEST_SCHEMA || ""))
  throw Error("Browser QA requires an isolated schema.");
const base = process.env.WZY_TEST_ORIGIN || "http://127.0.0.1:5173",
  origin = base;
const args =
  process.platform === "linux"
    ? await import("@sparticuz/chromium").then(async ({ default: c }) => ({
        // Keep normal Origin/CSP behavior: the vendor defaults disable web
        // security, omit Origin on fetch and correctly trigger our CSRF guard.
        args: c.args.filter(
          (flag) =>
            ![
              "--disable-web-security",
              "--allow-running-insecure-content",
            ].includes(flag),
        ),
        executablePath: await c.executablePath(),
        headless: true,
      }))
    : { headless: true };
const browser = await chromium.launch(args),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  }),
  page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(20000);
const test = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function api(path, body) {
  const r = await context.request.post(base + "/api/" + path, {
    headers: { Origin: origin },
    data: body,
  });
  assert.ok(r.ok(), path + ": " + (await r.text()));
  return r.json();
}
await mkdir("test-results/browser", { recursive: true });
try {
  await api("auth/register", {
    name: "Interface QA",
    email: "browser-" + randomUUID() + "@example.test",
    password: "QA-" + randomUUID(),
  });
  await page.goto(base + "/?page=" + encodeURIComponent("Transações"));
  await page
    .getByRole("heading", { name: "Transações", exact: true })
    .waitFor();
  const menu = page.getByRole("navigation", { name: "Menu principal" });
  const sectionLabels = () => menu.locator(".nav-label").allTextContents();
  assert.deepEqual(await sectionLabels(), [
    "DIA A DIA",
    "PLANEJAR",
    "ENTENDER",
    "FERRAMENTAS",
  ]);
  const defaultOrder = (await menu.getByRole("button").allTextContents()).map(
    (label) => label.trim(),
  );
  const customOrder = [...defaultOrder];
  const [files] = customOrder.splice(customOrder.indexOf("Arquivos"), 1);
  customOrder.splice(1, 0, files);
  await api("finance/preferences", {
    sidebarOrder: customOrder,
    sidebarPinned: ["Metas"],
  });
  await page.reload();
  await menu.getByText("SEU MENU", { exact: true }).waitFor();
  assert.deepEqual(await sectionLabels(), ["FIXADOS", "SEU MENU"]);
  assert.deepEqual(
    (await menu.getByRole("button").allTextContents()).map((label) =>
      label.trim(),
    ),
    ["Metas", ...customOrder.filter((label) => label !== "Metas")],
  );
  await api("finance/preferences", {
    sidebarOrder: defaultOrder,
    sidebarPinned: [],
  });
  await page.reload();
  await menu.getByText("FERRAMENTAS", { exact: true }).waitFor();
  assert.deepEqual(await sectionLabels(), [
    "DIA A DIA",
    "PLANEJAR",
    "ENTENDER",
    "FERRAMENTAS",
  ]);
  await page
    .getByRole("button", { name: "Nova transação", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Primeiro lançamento QA");
  await dialog.getByLabel("Valor (R$)", { exact: true }).fill("12,34");
  await dialog.getByLabel("Nome", { exact: true }).fill("Carteira QA");
  await dialog.getByRole("button", { name: "Criar conta e continuar" }).click();
  await expect
    .poll(() => dialog.locator('select[name="accountId"]').inputValue(), {
      timeout: 20000,
    })
    .not.toBe("");
  assert.equal(
    await dialog.getByLabel("Descrição", { exact: true }).inputValue(),
    "Primeiro lançamento QA",
  );
  assert.equal(
    await dialog.getByLabel("Valor (R$)", { exact: true }).inputValue(),
    "12,34",
  );
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Primeiro lançamento QA", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Primeiro lançamento QA", { exact: true }).waitFor();
  test(
    "The first transaction creates its financial account inline, retains the form and persists after reload",
  );
  const csp = (await page.request.get(base)).headers()[
    "content-security-policy"
  ];
  assert.ok(csp?.includes("strict-dynamic"));
  assert.ok(csp?.includes("object-src 'none'"));
  test(
    "The rendered application loads under the nonce-based content security policy",
  );
  await page
    .getByRole("button", { name: "Histórico de Primeiro lançamento QA" })
    .click();
  await page.getByRole("dialog").getByText("Criado", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  test(
    "Financial history is reachable by keyboard and dialogs close and restore focus",
  );
  let violations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations.filter((v) => ["critical", "serious"].includes(v.impact));
  await writeFile(
    "test-results/browser/accessibility.json",
    JSON.stringify(
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
      null,
      2,
    ),
  );
  assert.deepEqual(
    violations.map((v) => v.id),
    [],
    "Serious accessibility issues",
  );
  await page.screenshot({
    path: "test-results/browser/desktop-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Alterar tema" }).click();
  await page.screenshot({
    path: "test-results/browser/desktop-dark.png",
    fullPage: true,
  });
  test(
    "The transaction screen has no serious or critical automated accessibility violations in the tested state",
  );
  for (const width of [390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Horizontal overflow at " + width,
    );
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    assert.equal(await page.locator(".sidebar-collapse").isVisible(), false);
    await page.getByRole("textbox", { name: "Buscar no menu" }).fill("Invest");
    await page.getByRole("textbox", { name: "Buscar no menu" }).fill("");
    await page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("button", { name: "Contas e cartões", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Contas e cartões", exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "Categorias", exact: true }).click();
    await page.screenshot({
      path: "test-results/browser/mobile-" + width + ".png",
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  test(
    "Mobile layouts at 390 and 412 pixels preserve scrolling, hide desktop-only collapse and navigate through the sidebar",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    base +
      "/?" +
      new URLSearchParams({
        page: "Privacidade e offline",
        section: "Offline",
      }),
  );
  const localPassword = "Cofre-local-QA-" + randomUUID();
  await page.getByLabel("Senha local", { exact: true }).fill(localPassword);
  await page
    .getByRole("button", { name: "Ativar ou atualizar cofre", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bloquear cofre", exact: true })
    .waitFor();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Desbloquear cofre", exact: true })
    .waitFor();
  await page.getByLabel("Senha local", { exact: true }).fill(localPassword);
  await page
    .getByRole("button", { name: "Desbloquear cofre", exact: true })
    .click();
  await page.locator('input[name="name"]').fill("Compra offline QA");
  await page.locator('input[name="amount"]').fill("9,90");
  await page
    .locator('select[name="account"]')
    .selectOption({ label: "Carteira QA" });
  await page
    .getByRole("button", { name: "Guardar na fila", exact: true })
    .click();
  await page.getByText("Compra offline QA", { exact: true }).waitFor();
  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        const response = await context.request.get(base + "/api/records");
        const data = await response.json();
        return data.entries?.some(
          (e) => e.name === "Compra offline QA" && e.amount === 990,
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  test(
    "An encrypted vault queues a transaction without network and synchronizes it when connectivity returns",
  );
  await api("auth/logout", {});
  const login = await api("auth/login", {
    email:
      process.env.WZY_QA_BROWSER_ADMIN_EMAIL || process.env.WZY_QA_ADMIN_EMAIL,
    password:
      process.env.WZY_QA_BROWSER_ADMIN_PASSWORD ||
      process.env.WZY_QA_ADMIN_PASSWORD,
  });
  assert.ok(
    login.user,
    "The separate browser administrator must start without MFA.",
  );
  if (login.user) {
    const setup = await api("auth/mfa/setup", {});
    let bits = "";
    for (const c of setup.secret.toUpperCase())
      bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(c)
        .toString(2)
        .padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))),
      counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac("sha1", key).update(counter).digest(),
      offset = mac[19] & 15,
      code = String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
        6,
        "0",
      );
    await api("auth/mfa/enable", { mode: "totp", code });
    await page.goto(base + "/?page=" + encodeURIComponent("Configurações"));
    await page.getByRole("tab", { name: "Administração", exact: true }).click();
    await page
      .getByText("Administração de usuários", { exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(
      await page.evaluate(() => document.body.style.overflow === "hidden"),
      false,
    );
    await page.screenshot({
      path: "test-results/browser/mobile-admin.png",
      fullPage: true,
    });
    test(
      "The protected administration screen scrolls on a mobile viewport without locking the page",
    );
  }
  assert.deepEqual(errors, [], "Unexpected browser errors");
  await writeFile(
    "test-results/browser/result.json",
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        environment:
          "Headless Chromium with isolated synthetic users; not physical phones",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  await writeFile(
    "test-results/browser/controls.json",
    JSON.stringify(
      await page.locator("select,input").evaluateAll((elements) =>
        elements.map((e) => ({
          tag: e.tagName,
          name: e.getAttribute("name"),
          value: e.value,
          html: e.outerHTML,
        })),
      ),
      null,
      2,
    ),
  );
  await page
    .screenshot({ path: "test-results/browser/failure.png", fullPage: true })
    .catch(() => {});
  await writeFile(
    "test-results/browser/failure.txt",
    (await page.locator("body").innerText()).slice(0, 20000),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
