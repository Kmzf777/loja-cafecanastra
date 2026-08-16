import { chromium } from "playwright";

// Fumaca ponta a ponta do fluxo autenticado: guard do painel, login com a conta
// do .env, as 8 rotas de /dashboard e o catalogo real na vitrine.
// Exige backend (3333), Next (3000) e banco no ar. Uso: node scripts/verifica-fluxo.mjs

const BASE = "http://localhost:3000";
const ok = [];
const falhas = [];
const registra = (nome, passou, detalhe = "") =>
  (passou ? ok : falhas).push(`${nome}${detalhe ? ` — ${detalhe}` : ""}`);

const navegador = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

const erros = [];
p.on("console", (m) => m.type() === "error" && erros.push(m.text()));
p.on("pageerror", (e) => erros.push(String(e)));

// ── 1. /dashboard sem sessão deve mandar para o login ──────────────────────
await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
registra(
  "guard: /dashboard sem sessão redireciona para /account/login",
  p.url().includes("/account/login"),
  p.url(),
);

// ── 2. login com a conta do .env ───────────────────────────────────────────
await p.goto(`${BASE}/account/login`, { waitUntil: "domcontentloaded" });
await p.waitForSelector("#email", { timeout: 15000 });
await p.fill("#email", "teste@teste.com");
await p.fill("#senha", "123456");
await p.click('button[type="submit"]');
await p.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(3500);
registra("login: teste@teste.com/123456 leva ao painel", p.url().includes("/dashboard"), p.url());

const textoPainel = await p.textContent("body").catch(() => "");
registra(
  "painel: renderiza sem cair no erro do react-router",
  !/Unexpected Application Error|404 Not Found/i.test(textoPainel || ""),
);

// ── 3. produtos reais na listagem do painel ────────────────────────────────
await p.goto(`${BASE}/dashboard/products/addedProducts`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const html = (await p.content()) || "";
registra("painel: lista traz 'Canastra'", /Canastra/i.test(html));
registra("painel: lista traz preço real 39,70", /39[.,]70/.test(html));
for (const alvo of ["Clássico", "Suave"]) {
  registra(`painel: mostra ${alvo}`, new RegExp(alvo, "i").test(html));
}

// O painel pagina de 10 em 10, então Microlote e Néctar caem na página 2 —
// conferir pela API é mais honesto do que exigi-los na primeira tela.
const catalogo = await p.evaluate(async () => {
  const r = await fetch("http://localhost:3333/dashboard?limit=100", {
    credentials: "include",
  });
  return r.json();
});
const nomes = (catalogo.products ?? catalogo.rows ?? []).map((x) => x.name);
registra("painel: 29 SKUs cadastrados", catalogo.total === 29, `total ${catalogo.total}`);
registra("painel: Microlote cadastrado", nomes.some((n) => /Microlote/i.test(n)));
registra("painel: Néctar de Minas cadastrado", nomes.some((n) => /N[ée]ctar/i.test(n)));
registra(
  "painel: busca full-text (coluna tsv) responde",
  await p
    .evaluate(async () => {
      const r = await fetch("http://localhost:3333/dashboard?q=Microlote", {
        credentials: "include",
      });
      return (await r.json()).total;
    })
    .then((t) => t === 1),
);
await p.screenshot({ path: "./.verificacao/painel-produtos.png", fullPage: false });

// ── 4. as 8 rotas do painel, autenticado ───────────────────────────────────
const ROTAS = [
  "/dashboard",
  "/dashboard/products/addProduct",
  "/dashboard/products/addedProducts",
  "/dashboard/orders",
  "/dashboard/clients/registeredClients",
  "/dashboard/settings/updateShopInfo",
  "/dashboard/settings/manageCategories",
  "/dashboard/settings/offers",
];
for (const rota of ROTAS) {
  const resp = await p.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1800);
  const corpo = (await p.textContent("body")) || "";
  const erroRouter = /Unexpected Application Error|404 Not Found/i.test(corpo);
  const saiu = !p.url().includes("/dashboard");
  registra(
    `rota ${rota}`,
    resp?.status() === 200 && !erroRouter && !saiu,
    `http ${resp?.status()} · url ${p.url()}`,
  );
}

// ── 5. vitrine com o catálogo real ─────────────────────────────────────────
await p.goto(`${BASE}/cafes`, { waitUntil: "domcontentloaded" });
const cafes = (await p.content()) || "";
registra("vitrine: PLP lista Clássico", /Canastra Clássico/i.test(cafes));
registra("vitrine: PLP lista Microlote", /Microlote/i.test(cafes));
registra("vitrine: sumiu o lote inventado casca-danta", !/\/cafes\/casca-danta/.test(cafes));
registra("vitrine: preço real na PLP", /39,70/.test(cafes));
await p.screenshot({ path: "./.verificacao/vitrine-plp.png", fullPage: false });

await p.goto(`${BASE}/cafes/classico`, { waitUntil: "domcontentloaded" });
const pdp = (await p.content()) || "";
registra("vitrine: PDP do Clássico abre", /Canastra Clássico/i.test(pdp));
registra("vitrine: PDP mostra SCA 80+", /SCA 80\+/.test(pdp));
registra("vitrine: PDP sem altitude inventada", !/1\.320 m|Sítio Boa Vista/i.test(pdp));
await p.screenshot({ path: "./.verificacao/vitrine-pdp.png", fullPage: false });

// ── 6. área da conta ───────────────────────────────────────────────────────
await p.goto(`${BASE}/account`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const conta = (await p.content()) || "";
registra("conta: /account mostra o usuário logado", /teste@teste\.com/.test(conta), p.url());

console.log("\n=== PASSOU ===");
ok.forEach((o) => console.log("  ✓ " + o));
console.log("\n=== FALHOU ===");
falhas.length ? falhas.forEach((f) => console.log("  ✗ " + f)) : console.log("  (nenhuma)");
if (erros.length) {
  console.log("\n=== ERROS DE CONSOLE (primeiros 10) ===");
  [...new Set(erros)].slice(0, 10).forEach((e) => console.log("  ! " + e.slice(0, 200)));
}
console.log(`\nresumo: ${ok.length} ok, ${falhas.length} falhas`);

await navegador.close();
process.exit(falhas.length ? 1 : 0);
