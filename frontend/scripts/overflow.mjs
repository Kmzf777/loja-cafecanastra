/**
 * Diagnostico de overflow horizontal em mobile.
 * Reporta, por rota, o quanto o documento estoura e QUAIS elementos causam.
 */
const { spawn } = require("child_process");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.argv[2] || "http://localhost:3232";
const LARGURA = Number(process.argv[3] || 390);
const ALTURA = Number(process.argv[4] || 844);

const ROTAS = [
  "/",
  "/cafes",
  "/cafes/sao-roque",
  "/a-serra",
  "/clube",
  "/termos-de-uso",
  "/politica-de-privacidade",
];

const chrome = spawn(CHROME, [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  "--remote-debugging-port=9401",
  `--window-size=${LARGURA},${ALTURA}`,
  "about:blank",
]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SONDA = `(() => {
  const de = document.documentElement;
  const limite = de.clientWidth;
  const estouro = de.scrollWidth - limite;
  const culpados = [];
  if (estouro > 0) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > limite + 1 || r.left < -1) {
        // so o no mais externo interessa: se o pai ja estoura, o filho e sintoma
        if (el.parentElement && culpados.some(c => c.no === el.parentElement)) continue;
        culpados.push({
          no: el,
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") || "").slice(0, 90),
          txt: (el.textContent || "").trim().slice(0, 40),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    }
  }
  return JSON.stringify({
    limite, scrollWidth: de.scrollWidth, estouro,
    culpados: culpados.slice(0, 12).map(({no, ...resto}) => resto),
  });
})()`;

(async () => {
  await wait(2500);
  const list = await (await fetch("http://127.0.0.1:9401/json/list")).json();
  const alvo = list.find((t) => t.type === "page");
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.id && pend.has(d.id)) {
      pend.get(d.id)(d.result);
      pend.delete(d.id);
    }
  };
  const send = (m, p = {}) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: LARGURA,
    height: ALTURA,
    deviceScaleFactor: 2,
    mobile: true,
  });

  console.log(`viewport ${LARGURA}x${ALTURA}\n`);
  let total = 0;

  for (const rota of ROTAS) {
    await send("Page.navigate", { url: BASE + rota });
    await wait(3500);
    const r = await send("Runtime.evaluate", {
      expression: SONDA,
      returnByValue: true,
    });
    const d = JSON.parse(r.result.value);
    const marca = d.estouro > 0 ? "ESTOURA" : "ok     ";
    console.log(`${marca} ${rota.padEnd(28)} scrollWidth=${d.scrollWidth} (limite ${d.limite}, +${d.estouro}px)`);
    if (d.estouro > 0) {
      total++;
      for (const c of d.culpados) {
        console.log(`         <${c.tag}> w=${c.w} left=${c.left} right=${c.right}`);
        console.log(`           class="${c.cls}"`);
        if (c.txt) console.log(`           texto: "${c.txt}"`);
      }
    }
  }

  console.log(`\n${total} de ${ROTAS.length} rotas com overflow horizontal.`);
  chrome.kill();
  process.exit(0);
})();
