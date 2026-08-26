# Painel de gestão — Onda 1: Fundação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixa (`- [ ]`) para acompanhamento.
>
> **Quem tocar em qualquer arquivo de `frontend/` DEVE invocar a skill `frontend-design:frontend-design`
> antes de escrever a primeira linha.** A direção estética **não** é escolha de quem executa: está
> fixada em `estetica.md` §3/§4 e na §2.5 da spec. O que a skill acrescenta aqui é o rigor de
> acabamento — tipografia, espaçamento, micro-interação, detalhe.

**Goal:** entregar o núcleo verde sobre o qual as cinco ondas seguintes se apoiam — contrato tipado,
transporte, a lógica que hoje só existe dentro do painel legado, infraestrutura de teste com DOM,
o anel de acesso fechado contra Server Action, o sistema de componentes com os tokens da Canastra,
e o painel navegável em rotas reais do App Router.

**Architecture:** o painel novo nasce em `frontend/app/dashboard/(protegido)/` como Server Components
lendo `searchParams`, com ilhas cliente só onde há interação. Toda decisão vive num módulo puro
(`*.logica.ts`, sem React e sem fetch) testado exaustivamente; a casca JSX só desenha. O Express
continua sendo a fonte da verdade, chamado pelo servidor do Next. O reset do Tailwind é escopado em
`.painel`, espelhando o que `.vitrine` já faz, para o legado seguir de pé até a Onda 6.

**Tech Stack:** Next 15 App Router · React 18.3.1 · Tailwind v4 (`@theme static`) · Vitest 4 ·
Radix UI (primitivos, com o shadcn como referência de composição — §2.7 da spec) · Supabase SSR.

**Leitura obrigatória antes de começar:** §2.7, §2.8 e §7-B da spec, e as seções CRÍTICO e ALTO de
`docs/pesquisa/2026-08-26-riscos-da-reescrita.md`.

---

## Estrutura de arquivos desta onda

| Arquivo | Responsabilidade |
|---|---|
| `.gitattributes` | normalizar fim de linha; hoje o teste de instalação falha por CRLF no Windows |
| `frontend/lib/teste/html.ts` | o `renderToStaticMarkup` que 20 arquivos redeclaram à mão |
| `frontend/lib/teste/renderizar.tsx` | render com DOM, só para o painel |
| `frontend/lib/painel/transporte.ts` | `authFetch`: token, renovação única no 401, 403 sobe inteiro |
| `frontend/lib/painel/resposta.ts` | ler resposta de corpo vazio sem quebrar; `fraseDeErro` |
| `frontend/lib/painel/dinheiro.ts` | reais × centavos, com a unidade no nome |
| `frontend/lib/painel/status.ts` | os 9 status, valor separado do rótulo |
| `frontend/lib/painel/bling/contrato.ts` | portado de `legacy/.../blingContrato.js`, intacto |
| `frontend/lib/conta/painel-servidor.ts` | ganha `exigirAdminEmAcao()`, exportado para Server Action |
| `frontend/app/globals.css` | reset escopado em `.painel` |
| `frontend/components/painel/ui/*` | os primitivos: Botao, Campo, Ficha, Tabela, Chip, Tarja, EstadoVazio, BarraDeSalvar, PainelLateral, Paginacao |
| `frontend/app/dashboard/(protegido)/layout.tsx` | ganha a casca `.painel` + menu (a checagem já está lá) |
| `frontend/components/painel/casca/*` | MenuLateral, Cabecalho, TituloDePagina |

---

### Task 1: Higiene do sinal — CRLF e concorrência da suíte

Sem isto, todo diff desta reescrita é lido contra um CI que falha por infraestrutura. São dois
arquivos e cinco minutos, e valem semanas de ruído.

**Files:**
- Create: `.gitattributes`
- Modify: `backend/package.json` (script `test`)
- Modify: `.github/workflows/ci.yml` (passo do backend)

- [ ] **Step 1: Criar `.gitattributes`**

```gitattributes
# Fim de linha normalizado no repositório, LF sempre.
#
# POR QUE ISTO EXISTE: `backend/test/instalacao.test.js` compara o SQL gerado
# por `gerar-instalacao.js` com o arquivo versionado. No Windows, o checkout
# com `core.autocrlf=true` reescreve o arquivo com CRLF, o gerador produz LF, e
# o teste falha dizendo que a instalação está desatualizada — quando o que está
# diferente é invisível. Já custou uma investigação inteira na direção errada.
* text=auto eol=lf

# Binários: nunca tocar.
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.avif binary
*.ico binary
```

- [ ] **Step 2: Confirmar que o teste de instalação passa**

Run: `cd backend && node --test --test-concurrency=1 test/instalacao.test.js`
Expected: PASS, 18 casos.

- [ ] **Step 3: Pôr `--test-concurrency=1` no script do backend**

Em `backend/package.json`, o script `test` passa a ser:

```json
"test": "node --test --test-concurrency=1 test/*.test.js"
```

Comentar no CI **não** basta: quem roda `npm --prefix backend test` na máquina precisa do mesmo
comportamento. Cada arquivo sobe o seu próprio cluster PostgreSQL embarcado; em paralelo, 70 a 114
testes caem por contenção — e o vermelho não tem nada a ver com o código.

- [ ] **Step 4: Espelhar no CI**

Em `.github/workflows/ci.yml`, o passo do backend usa o script do `package.json` (não repetir a
flag em dois formatos que podem divergir). Se o passo hoje chama `node --test test/*.test.js`
diretamente, trocar por `npm --prefix backend test`.

- [ ] **Step 5: Rodar a suíte do backend inteira**

Run: `npm --prefix backend test`
Expected: PASS. Anotar a contagem no corpo do commit — é o piso desta onda.

- [ ] **Step 6: Commit**

```bash
git add .gitattributes backend/package.json .github/workflows/ci.yml
git commit -m "chore: o CI para de falhar por CRLF e por contencao do Postgres"
```

---

### Task 2: O helper de render que 20 arquivos redeclaram

**Files:**
- Create: `frontend/lib/teste/html.ts`
- Create: `frontend/lib/teste/html.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

`frontend/lib/teste/html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { html } from "./html";

describe("html", () => {
  it("serializa um elemento em string", () => {
    expect(html(<p>oi</p>)).toBe("<p>oi</p>");
  });

  it("preserva atributos ARIA, que é o que a maioria das asserções lê", () => {
    expect(html(<button aria-label="Salvar" />)).toContain('aria-label="Salvar"');
  });
});
```

O arquivo precisa ser `.test.tsx`, não `.test.ts`, porque contém JSX. Renomear.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix frontend run test -- lib/teste`
Expected: FAIL — `Failed to resolve import "./html"`.

- [ ] **Step 3: Implementar**

`frontend/lib/teste/html.ts`:

```ts
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * O render de teste do repositório, num lugar só.
 *
 * Esta função estava COPIADA À MÃO em 20 arquivos de teste, sempre idêntica.
 * Não era um problema de estilo: era 20 lugares para mudar no dia em que a
 * técnica mudasse, e nenhum deles com nome que os ligasse.
 *
 * A técnica: `environment: "node"` no vitest.config.ts, sem jsdom e sem
 * testing-library. Isso NÃO EXECUTA EFEITO — uma ilha de cliente que busca
 * dados renderiza vazio aqui, e um teste que só verifique "não quebrou"
 * passaria provando nada. Para o que precisa de DOM existe
 * `lib/teste/renderizar.tsx`, restrito ao painel.
 */
export function html(no: ReactElement): string {
  return renderToStaticMarkup(no);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/teste`
Expected: PASS, 2 casos.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/teste/
git commit -m "test: o render de teste sai de 20 copias e vira um modulo"
```

> Os 20 arquivos existentes **não** são migrados nesta tarefa. Eles passam hoje, e trocar 20 arquivos
> de uma vez mistura ruído com sinal no diff da reescrita. Arquivo novo usa o compartilhado; arquivo
> antigo migra quando for tocado por outro motivo.

---

### Task 3: Portar o transporte, com os testes

O `authFetch` é usado em 21 pontos do painel e carrega três regras cuja falha é silenciosa. Portar
**antes** de apagar `legacy/`, não depois — é o único lugar onde o laço infinito de 403 está coberto.

**Files:**
- Create: `frontend/lib/painel/transporte.ts`
- Move: `frontend/legacy/api.test.ts` → `frontend/lib/painel/transporte.test.ts`
- Modify: `frontend/legacy/api.js` (passa a reexportar do novo módulo)

- [ ] **Step 1: Mover o teste preservando o histórico**

```bash
git mv frontend/legacy/api.test.ts frontend/lib/painel/transporte.test.ts
```

Mover, não reescrever: são 11 casos e 277 linhas que já provam o comportamento. Reescrevê-los é
reintroduzir a chance de errar exatamente o que eles protegem.

- [ ] **Step 2: Ajustar os imports do teste e ver falhar**

No arquivo movido, trocar o import do módulo sob teste para `./transporte` e o `vi.mock` de
`../lib/supabase/cliente` para `@/lib/supabase/cliente`.

Run: `npm --prefix frontend run test -- lib/painel/transporte`
Expected: FAIL — `Failed to resolve import "./transporte"`.

- [ ] **Step 3: Escrever `frontend/lib/painel/transporte.ts`**

```ts
import { clienteNavegador } from "@/lib/supabase/cliente";

export const BASE_DA_API =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

async function tokenDeAcesso(): Promise<string | null> {
  try {
    const { data } = await clienteNavegador().auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (erro) {
    console.warn("[painel] Não foi possível ler a sessão do Supabase.", erro);
    return null;
  }
}

/**
 * O transporte do painel — e as três regras que ele carrega.
 *
 * 1. O TOKEN É LIDO A CADA CHAMADA, do supabase-js, e nunca guardado. Guardar
 *    significa servir um token vencido depois que outra aba renovou a sessão.
 *
 * 2. SÓ 401 RENOVA, E SÓ SE O TOKEN MUDOU. O backend responde **403** com
 *    `{message:"Sua conta ainda não está vinculada a esta loja."}` para um token
 *    PERFEITAMENTE VÁLIDO (isAuthenticated.js:307-316). Tratar 403 como sessão
 *    expirada renova, leva o mesmo 403, renova de novo — laço contra o GoTrue
 *    que aparece como lentidão e rate limit, não como erro. Já aconteceu neste
 *    projeto. E a comparação `novoToken === token` existe porque o supabase-js
 *    resolve `refreshSession()` com o token ANTIGO quando não havia o que
 *    renovar: sem ela, a mesma requisição vai duas vezes para dar o mesmo 401.
 *
 * 3. NENHUM CABEÇALHO FORA DOS TRÊS DO CORS. `backend/src/index.js:87` aceita
 *    exatamente `Content-Type`, `Authorization` e `Accept`. Um `X-Request-Id`
 *    acrescentado aqui faz o PREFLIGHT falhar, e o erro no console é de CORS —
 *    dez minutos de investigação na direção errada. Header novo exige mexer no
 *    backend primeiro.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const opts: RequestInit = {
    ...options,
    headers: { ...((options.headers as Record<string, string>) || {}) },
  };
  opts.credentials = "include";

  const token = await tokenDeAcesso();
  if (token) {
    (opts.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, opts);
  if (res.status !== 401 || !token) return res;

  let novoToken: string | null = null;
  try {
    const { data } = await clienteNavegador().auth.refreshSession();
    novoToken = data?.session?.access_token ?? null;
  } catch (erro) {
    console.warn("[painel] Renovação da sessão falhou.", erro);
  }
  if (!novoToken || novoToken === token) return res;

  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${novoToken}`,
    },
  });
}

/** Monta a URL e delega. `body` `FormData` NÃO leva `Content-Type` — o
 *  navegador precisa escrever o `boundary` sozinho. */
export async function chamarApi(
  caminho: string,
  metodo: string = "GET",
  corpo?: unknown,
  extras: RequestInit = {},
): Promise<Response> {
  const opts: RequestInit = {
    method: metodo,
    ...extras,
    headers: { ...((extras.headers as Record<string, string>) || {}) },
  };

  if (metodo !== "GET" && metodo !== "HEAD") {
    if (corpo instanceof FormData) {
      opts.body = corpo;
    } else if (corpo !== undefined) {
      (opts.headers as Record<string, string>)["Content-Type"] =
        "application/json";
      opts.body = JSON.stringify(corpo);
    }
  }

  return authFetch(`${BASE_DA_API}${caminho}`, opts);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/painel/transporte`
Expected: PASS, 12 casos.

- [ ] **Step 5: `legacy/api.js` passa a reexportar**

O painel legado continua de pé até a Onda 6 e não pode ter uma segunda cópia da regra. Substituir o
corpo de `frontend/legacy/api.js` por:

```js
// O painel legado sai na Onda 6. Até lá ele usa o transporte novo, para não
// existirem duas cópias da regra de renovação de sessão divergindo em silêncio.
import { authFetch, chamarApi, BASE_DA_API } from "../lib/painel/transporte";

export const API_BASE = BASE_DA_API;
export { authFetch };
export default chamarApi;
```

- [ ] **Step 6: Rodar a suíte inteira do frontend**

Run: `npm --prefix frontend run test`
Expected: PASS. A contagem tem de bater com a de antes (os 11 casos mudaram de arquivo, não sumiram).

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/painel/transporte.ts frontend/lib/painel/transporte.test.ts frontend/legacy/api.js
git commit -m "refactor(painel): o transporte sai do legado e leva os testes junto"
```

---

### Task 4: Ler resposta que pode não ter corpo, e a frase que diagnostica

**Files:**
- Create: `frontend/lib/painel/resposta.ts`
- Create: `frontend/lib/painel/resposta.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { lerCorpo, fraseDeErro } from "./resposta";

function resposta(status: number, corpo?: string): Response {
  return new Response(corpo ?? null, { status });
}

describe("lerCorpo", () => {
  it("devolve objeto vazio quando o corpo é vazio (o caso do 401)", async () => {
    expect(await lerCorpo(resposta(401))).toEqual({});
  });

  it("devolve objeto vazio quando o corpo não é JSON", async () => {
    expect(await lerCorpo(resposta(500, "<html>502 Bad Gateway</html>"))).toEqual({});
  });

  it("devolve o JSON quando há JSON", async () => {
    expect(await lerCorpo(resposta(409, '{"message":"Já existe um produto com este SKU."}')))
      .toEqual({ message: "Já existe um produto com este SKU." });
  });
});

describe("fraseDeErro", () => {
  it("prefere `message`, que é a frase que o servidor escreveu", () => {
    expect(fraseDeErro(409, { message: "Já existe um produto com este SKU." }))
      .toBe("Já existe um produto com este SKU.");
  });

  it("cai em `error` quando não há `message` — o backend usa os dois campos", () => {
    expect(fraseDeErro(400, { error: "Informe um e-mail válido." }))
      .toBe("Informe um e-mail válido.");
  });

  it("explica o 401 de corpo vazio em vez de dizer 'erro'", () => {
    expect(fraseDeErro(401, {})).toMatch(/sess/i);
  });

  it("explica o 403 SEM sugerir que a sessão expirou", () => {
    const frase = fraseDeErro(403, {});
    expect(frase).toMatch(/permiss/i);
    expect(frase).not.toMatch(/sess/i);
  });

  it("não devolve string vazia para status desconhecido", () => {
    expect(fraseDeErro(418, {}).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix frontend run test -- lib/painel/resposta`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
type CorpoDeErro = { message?: string; error?: string };

/**
 * Ler o corpo de uma resposta que PODE NÃO TER CORPO.
 *
 * `isAuthenticated.js` responde 401 e 403 por `sendStatus`, ou seja, com corpo
 * VAZIO e sem `Content-Type: application/json`. Um `await res.json()` sem
 * proteção quebra com SyntaxError exatamente no caminho de sessão expirada —
 * que é o menos testado e o mais visitado numa quinta à noite. O painel legado
 * escreve `.json().catch(() => ({}))` em toda chamada; aqui isso vira um lugar
 * só, para nenhuma tela nova esquecer.
 */
export async function lerCorpo(res: Response): Promise<CorpoDeErro> {
  try {
    const corpo = await res.json();
    return corpo && typeof corpo === "object" ? (corpo as CorpoDeErro) : {};
  } catch {
    return {};
  }
}

/**
 * A frase que o gestor lê quando algo falha.
 *
 * REGRA: a frase do SERVIDOR ganha sempre. "Já existe um produto com este SKU.",
 * "SKU tal não está cadastrado no Bling", "nota gerada mas não transmitida" —
 * essas frases SÃO o diagnóstico, e trocá-las por "Erro ao salvar" transforma
 * um problema de dois minutos num chamado. Portado de
 * `legacy/.../Bling/blingContrato.js:243-292`, onde a regra nasceu.
 *
 * O 403 tem texto próprio e deliberadamente SEM a palavra "sessão": o backend
 * responde 403 para token válido de quem não está vinculado à loja, e sugerir
 * "entre de novo" manda a pessoa para um login que vai funcionar e não vai
 * resolver nada.
 */
export function fraseDeErro(status: number, corpo: CorpoDeErro): string {
  if (corpo.message) return corpo.message;
  if (corpo.error) return corpo.error;

  if (status === 401) return "Sua sessão expirou. Entre de novo para continuar.";
  if (status === 403) return "Sua conta não tem permissão para isto.";
  if (status === 404) return "Não encontramos o que você pediu.";
  if (status === 409) return "Isso conflita com algo que já existe.";
  if (status === 413) return "O arquivo é grande demais.";
  if (status >= 500) return "O servidor falhou. Tente de novo em instantes.";
  return `Não deu certo (código ${status}).`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/painel/resposta`
Expected: PASS, 7 casos.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/painel/resposta.ts frontend/lib/painel/resposta.test.ts
git commit -m "feat(painel): ler resposta sem corpo, e a frase do servidor ganha sempre"
```

---

### Task 5: Dinheiro, com a unidade no nome

O schema mistura reais (`numeric(10,2)`, que o pg devolve como **string**) e centavos (`integer`) na
mesma tela. Quatro telas legadas definem um `moeda()` próprio que adivinha. É o erro mais barato de
cometer e o mais caro de descobrir.

**Files:**
- Create: `frontend/lib/painel/dinheiro.ts`
- Create: `frontend/lib/painel/dinheiro.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import {
  formatarCentavos,
  formatarReais,
  reaisParaCentavos,
  centavosParaReais,
} from "./dinheiro";

/**
 * O REAL É ESCRITO COM ESPAÇO NÃO SEPARÁVEL, E ISSO NÃO É ACIDENTE.
 *
 * `Intl.NumberFormat("pt-BR", { currency: "BRL" })` põe U+00A0 entre "R$" e o
 * número, seguindo o CLDR — tipografia correta, que impede o símbolo da moeda
 * de ficar órfão no fim da linha.
 *
 * Constante nomeada com escape EXPLÍCITO, e não um caractere invisível colado
 * num literal, porque um `"R$ 149,00"` digitado com espaço comum falha com a
 * mensagem mais inútil que o Vitest sabe produzir: `expected 'R$ 149,00' to be
 * 'R$ 149,00'` — duas strings visualmente idênticas.
 *
 * A vitrine já emite o mesmo NBSP em `lib/catalogo/repositorio.ts:308`
 * (`formatarPreco`). Normalizar para espaço comum aqui faria o painel e a loja
 * escreverem preço de dois jeitos diferentes.
 */
const NBSP = "\u00A0";
const reais = (texto: string) => `R$${NBSP}${texto}`;

describe("formatarCentavos", () => {
  it("formata inteiro de centavos", () => {
    expect(formatarCentavos(14900)).toBe(reais("149,00"));
  });
  it("formata zero sem virar traço", () => {
    expect(formatarCentavos(0)).toBe(reais("0,00"));
  });
  it("devolve traço para ausência, que é diferente de zero", () => {
    expect(formatarCentavos(null)).toBe("—");
  });
});

describe("formatarReais", () => {
  it("aceita a STRING que o pg devolve para numeric", () => {
    expect(formatarReais("149.00")).toBe(reais("149,00"));
  });
  it("aceita número", () => {
    expect(formatarReais(59.9)).toBe(reais("59,90"));
  });
  it("devolve traço para ausência", () => {
    expect(formatarReais(null)).toBe("—");
  });
  it("escreve o preço igualzinho ao formatador de centavos", () => {
    expect(formatarReais("59.90")).toBe(formatarCentavos(5990));
  });
});

describe("conversão", () => {
  it("reais para centavos arredonda ao centavo, sem erro de ponto flutuante", () => {
    expect(reaisParaCentavos("59.90")).toBe(5990);
    expect(reaisParaCentavos(0.07)).toBe(7);
    expect(reaisParaCentavos("1.005")).toBe(101);
  });

  it("aceita o formato que o gestor digita, com vírgula", () => {
    expect(reaisParaCentavos("59,90")).toBe(5990);
  });

  it("centavos para reais devolve número, não string", () => {
    expect(centavosParaReais(5990)).toBe(59.9);
  });

  it("devolve null para entrada vazia — vazio NÃO é zero", () => {
    expect(reaisParaCentavos("")).toBeNull();
    expect(reaisParaCentavos(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix frontend run test -- lib/painel/dinheiro`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * Dinheiro no painel, com a UNIDADE NO NOME — e por que isso não é preciosismo.
 *
 * O mesmo schema devolve `total_amount`, `shipping_cost` e `discount` em REAIS
 * (numeric(10,2), que o driver do pg entrega como STRING) e
 * `minimo_centavos`, `preco_centavos` e `frete_gratis_minimo_centavos` em
 * CENTAVOS (integer). Quatro telas legadas resolveram isso com um `moeda()`
 * local que adivinha pela ordem de grandeza. Um cupom de R$ 10 formatado como
 * centavos vira R$ 0,10 e ninguém percebe até o cliente perceber.
 *
 * Nenhuma função aqui adivinha. Ou você chama a de centavos, ou a de reais.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Ausência é diferente de zero: R$ 0,00 é um desconto de zero, "—" é a
 *  ausência de desconto. Colapsar os dois esconde bug de gravação. */
const AUSENTE = "—";

export function formatarCentavos(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined || Number.isNaN(centavos)) {
    return AUSENTE;
  }
  return BRL.format(centavos / 100);
}

export function formatarReais(reais: string | number | null | undefined): string {
  if (reais === null || reais === undefined || reais === "") return AUSENTE;
  const n = typeof reais === "string" ? Number(reais) : reais;
  if (Number.isNaN(n)) return AUSENTE;
  return BRL.format(n);
}

/**
 * VAZIO DEVOLVE `null`, NUNCA `0`. Esta é a regra que impede o defeito de
 * `PUT /config`: lá, `Number('')` é `0`, e `0` no mínimo de frete grátis
 * DESLIGA o frete grátis da loja inteira. Quem chama decide o que fazer com o
 * `null` — e "não mandar o campo" é quase sempre a resposta certa.
 */
export function reaisParaCentavos(
  entrada: string | number | null | undefined,
): number | null {
  if (entrada === null || entrada === undefined) return null;
  const texto = String(entrada).trim().replace(",", ".");
  if (texto === "") return null;
  const n = Number(texto);
  if (Number.isNaN(n)) return null;
  // `Math.round(n * 100)` sozinho erra em 1.005 (ponto flutuante dá 100.49999).
  return Math.round((n + Number.EPSILON) * 100);
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/painel/dinheiro`
Expected: PASS, 11 casos.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/painel/dinheiro.ts frontend/lib/painel/dinheiro.test.ts
git commit -m "feat(painel): dinheiro com a unidade no nome, e vazio nao vira zero"
```

---

### Task 6: Os 9 status, num lugar só, com teste contra o backend

Hoje estão copiados à mão em `Orders.jsx:52-62`, `HomeDashboard.jsx:34-44` e `blingContrato.js:69-73`.
O backend recusa com 400 qualquer valor fora da lista.

**Files:**
- Create: `frontend/lib/painel/status.ts`
- Create: `frontend/lib/painel/status.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_DE_PEDIDO, rotuloDoStatus, tomDoStatus } from "./status";

describe("STATUS_DE_PEDIDO", () => {
  /**
   * O teste que importa: a lista do painel COMPARADA COM A DO BACKEND, lida do
   * disco. O backend recusa com 400 qualquer valor fora de STATUS_VALIDOS, e o
   * CHECK da migração 0009 recusa no banco. Uma divergência aqui quebra toda
   * mudança de status — e não aparece em `next build` nem em `tsc`.
   */
  it("tem exatamente os mesmos valores de backend/src/utils/statusDePedido.js", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "backend", "src", "utils", "statusDePedido.js"),
      "utf8",
    );
    const bloco = fonte.match(/STATUS_VALIDOS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(bloco).not.toBeNull();
    const doBackend = [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(STATUS_DE_PEDIDO.map((s) => s.valor)).toEqual(doBackend);
  });

  it("todo status tem rótulo em português", () => {
    for (const s of STATUS_DE_PEDIDO) {
      expect(s.rotulo.length).toBeGreaterThan(0);
      expect(s.rotulo).not.toBe(s.valor);
    }
  });
});

describe("rotuloDoStatus", () => {
  it("traduz valor conhecido", () => {
    expect(rotuloDoStatus("em_processamento")).toBe("Em processamento");
  });

  it("devolve o próprio valor para desconhecido, em vez de esconder", () => {
    expect(rotuloDoStatus("inventado")).toBe("inventado");
  });
});

describe("tomDoStatus", () => {
  it("cancelado, rejeitado e reembolsado são o tom de erro", () => {
    expect(tomDoStatus("cancelado")).toBe("erro");
    expect(tomDoStatus("rejeitado")).toBe("erro");
    expect(tomDoStatus("reembolsado")).toBe("erro");
  });
  it("entregue é sucesso", () => {
    expect(tomDoStatus("entregue")).toBe("sucesso");
  });
  it("pendente é alerta", () => {
    expect(tomDoStatus("pendente")).toBe("alerta");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix frontend run test -- lib/painel/status`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * Os 9 status de pedido — VALOR separado de RÓTULO.
 *
 * O `valor` é o que trafega para o backend e é gravado no banco; o `rotulo` é o
 * que o gestor lê. Confundir os dois é o defeito que estava esperando para
 * acontecer: traduzir os VALORES em vez dos rótulos faz o backend responder 400
 * em toda mudança de status, e o CHECK de 0009 recusar no banco.
 *
 * A lista vive aqui e é comparada com `backend/src/utils/statusDePedido.js`
 * por `status.test.ts`, lendo o arquivo do disco. Não copie esta lista para
 * dentro de componente nenhum — foi assim que ela virou três cópias.
 */
export type TomDeStatus = "sucesso" | "alerta" | "erro" | "neutro";

export const STATUS_DE_PEDIDO = [
  { valor: "pendente", rotulo: "Pendente", tom: "alerta" },
  { valor: "aprovado", rotulo: "Aprovado", tom: "sucesso" },
  { valor: "em_processamento", rotulo: "Em processamento", tom: "neutro" },
  { valor: "autorizado", rotulo: "Autorizado", tom: "neutro" },
  { valor: "enviado", rotulo: "Enviado", tom: "neutro" },
  { valor: "entregue", rotulo: "Entregue", tom: "sucesso" },
  { valor: "cancelado", rotulo: "Cancelado", tom: "erro" },
  { valor: "rejeitado", rotulo: "Rejeitado", tom: "erro" },
  { valor: "reembolsado", rotulo: "Reembolsado", tom: "erro" },
] as const satisfies ReadonlyArray<{
  valor: string;
  rotulo: string;
  tom: TomDeStatus;
}>;

export type StatusDePedido = (typeof STATUS_DE_PEDIDO)[number]["valor"];

/** Valor desconhecido devolve a si mesmo. Esconder atrás de "Outro" faria um
 *  status novo do backend sumir da tela sem ninguém notar. */
export function rotuloDoStatus(valor: string): string {
  return STATUS_DE_PEDIDO.find((s) => s.valor === valor)?.rotulo ?? valor;
}

export function tomDoStatus(valor: string): TomDeStatus {
  return STATUS_DE_PEDIDO.find((s) => s.valor === valor)?.tom ?? "neutro";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/painel/status`
Expected: PASS, 7 casos.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/painel/status.ts frontend/lib/painel/status.test.ts
git commit -m "feat(painel): os 9 status saem de tres copias, com teste contra o backend"
```

---

### Task 7: Portar a lógica do Bling intacta

293 linhas sem React e sem fetch, com 270 linhas de teste que continuam valendo. **Não reescrever.**
A ordem das perguntas de `estadoDoBling` é a ordem da vida do documento fiscal: `nfe_chave` vem
primeiro porque a chave só existe depois da autorização da SEFAZ, e `nfe_numero` **sem** chave é o
estado que mais precisa de destaque porque *parece* resolvido e não está. Reordenar produz uma tela
que diz "tudo certo" sobre uma nota que nunca chegou à SEFAZ.

**Files:**
- Move: `frontend/legacy/components/DashboardSection/Bling/blingContrato.js` → `frontend/lib/painel/bling/contrato.ts`
- Move: `frontend/legacy/components/DashboardSection/Bling/blingContrato.test.ts` → `frontend/lib/painel/bling/contrato.test.ts`
- Modify: `frontend/legacy/components/DashboardSection/Bling/BlingManager.jsx` e `useBlingAcoes.js` (imports)

- [ ] **Step 1: Mover os dois arquivos preservando o histórico**

```bash
mkdir -p frontend/lib/painel/bling
git mv frontend/legacy/components/DashboardSection/Bling/blingContrato.js frontend/lib/painel/bling/contrato.ts
git mv frontend/legacy/components/DashboardSection/Bling/blingContrato.test.ts frontend/lib/painel/bling/contrato.test.ts
```

- [ ] **Step 2: Tipar o mínimo para o TypeScript aceitar, sem mudar comportamento**

Acrescentar apenas as anotações que o compilador exigir. **Proibido** nesta tarefa: renomear função,
reordenar as perguntas de `estadoDoBling`, transformar a lista congelada de 9 campos de
`mesclarPedido` em spread. O spread `{...linha, ...pedido}` apagaria `address`, `user_name`,
`user_email` e `user_cpf`, que a resposta de `/bling` não traz — funcionaria hoje por acaso e
apagaria dados do cliente no dia em que os contratos divergissem mais um pouco.

- [ ] **Step 3: Ajustar o import do teste e rodar**

Run: `npm --prefix frontend run test -- lib/painel/bling`
Expected: PASS, 21 casos.

- [ ] **Step 4: Apontar o painel legado para o novo caminho**

Em `BlingManager.jsx` e `useBlingAcoes.js`, trocar `from "./blingContrato"` por
`from "@/lib/painel/bling/contrato"`.

- [ ] **Step 5: Rodar a suíte inteira do frontend**

Run: `npm --prefix frontend run test`
Expected: PASS, contagem igual à do commit anterior.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/lib/painel/bling frontend/legacy/components/DashboardSection/Bling
git commit -m "refactor(painel): a regra de NF-e sai do legado com seus 21 testes"
```

---

### Task 8: Fechar o anel de acesso contra Server Action

O layout de `(protegido)` protege **páginas**. Não protege Route Handler — está escrito no próprio
arquivo — **e não protege Server Action**, que é o furo novo: a ação POSTa para a rota, executa, e o
layout só roda depois, na re-renderização. Um `async function salvar()` com `"use server"` numa
página do painel executaria **antes** de qualquer checagem. O painel novo vive de Server Actions.

**Files:**
- Modify: `frontend/lib/conta/painel-servidor.ts` (nova exportação)
- Modify: `frontend/lib/conta/painel-servidor.test.ts` (troca o teste de inventário)

- [ ] **Step 1: Escrever o teste novo, que falha**

Substituir o `it("não há Route Handler sob /dashboard — layout não protegeria um")` por:

```ts
  /**
   * ROUTE HANDLER E SERVER ACTION NÃO PASSAM POR LAYOUT.
   *
   * O caso do handler já era conhecido. O da Server Action é pior porque é
   * INVISÍVEL: a ação POSTa para a própria rota, EXECUTA, e só então a página
   * re-renderiza — momento em que o layout finalmente chama
   * `exigirAdminNoPainel`. Ou seja, a checagem roda DEPOIS de a ação ter
   * gravado no banco. O painel novo é feito de Server Actions.
   *
   * A regra deixou de ser "não existe" e passou a ser "todo mundo chama a
   * checagem", porque proibir era proibir o painel de funcionar.
   */
  function arquivosComCaminho(dir: string, prefixo = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? arquivosComCaminho(join(dir, e.name), `${prefixo}${e.name}/`)
        : [prefixo + e.name],
    );
  }

  it("todo Route Handler sob /dashboard chama a checagem na própria função", () => {
    const handlers = arquivosComCaminho(RAIZ).filter((a) =>
      /(^|\/)route\.(ts|tsx|js|jsx)$/.test(a),
    );
    for (const h of handlers) {
      const fonte = readFileSync(join(RAIZ, h), "utf8");
      expect(fonte, `${h} não chama exigirAdminEmAcao`).toMatch(/exigirAdminEmAcao\s*\(/);
    }
  });

  it("todo arquivo com \"use server\" sob /dashboard chama a checagem", () => {
    const suspeitos = arquivosComCaminho(RAIZ).filter((a) => /\.(ts|tsx)$/.test(a));
    for (const arquivo of suspeitos) {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      if (!/^\s*["']use server["']/m.test(fonte)) continue;
      expect(fonte, `${arquivo} declara "use server" e não chama exigirAdminEmAcao`)
        .toMatch(/exigirAdminEmAcao\s*\(/);
    }
  });
```

Acrescentar `readFileSync` ao import de `node:fs` no topo do arquivo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix frontend run test -- lib/conta/painel-servidor`
Expected: FAIL — `exigirAdminEmAcao` ainda não existe, e o teste antigo foi substituído.

Se não houver nenhum handler nem `"use server"` sob `/dashboard` ainda, os dois casos passam
vazios — isso é correto e esperado. O teste é uma trava para o futuro, e ele fica vermelho no dia em
que alguém criar o primeiro sem a checagem.

- [ ] **Step 3: Exportar a checagem reutilizável**

Em `frontend/lib/conta/painel-servidor.ts`, acrescentar:

```ts
/**
 * A checagem que Server Action e Route Handler precisam chamar SOZINHOS.
 *
 * `exigirAdminNoPainel` existe para PÁGINA e faz `redirect()`, que é o certo
 * quando há uma tela para onde mandar a pessoa. Aqui não há: uma Server Action
 * que falha precisa PARAR, não navegar — e `redirect()` dentro de action tem
 * semântica diferente e some do `try/catch` de quem chamou.
 *
 * O layout de `(protegido)` NÃO cobre nenhum dos dois. Handler não passa por
 * layout, e Server Action executa ANTES de a página re-renderizar — ou seja, a
 * checagem do layout roda depois de a ação já ter gravado. Por isso a regra é
 * chamar isto na PRIMEIRA linha, antes de ler o corpo e antes de tocar no banco.
 *
 * `painel-servidor.test.ts` lê o diretório e falha se algum arquivo com
 * `"use server"` ou algum `route.ts` sob /dashboard não chamar esta função.
 */
export async function exigirAdminEmAcao(): Promise<{ userId: string }> {
  const acesso = await lerAcessoDoPainel();
  if (!acesso.temSessao || !acesso.ehAdmin || acesso.falhouConsulta) {
    throw new Error("SEM_PERMISSAO_NO_PAINEL");
  }
  return { userId: acesso.userId };
}
```

Se `lerAcessoDoPainel` ainda não devolve `userId`, acrescentar o campo — o `admin_log` da Onda 2 vai
precisar dele, e é mais barato agora que depois.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/conta/painel-servidor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/conta/painel-servidor.ts frontend/lib/conta/painel-servidor.test.ts
git commit -m "fix(painel): Server Action tambem nao passa por layout, e agora o teste sabe"
```

---

### Task 9: O reset escopado em `.painel`

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Acrescentar o escopo, espelhando `.vitrine`**

Depois do bloco `.vitrine` existente em `@layer base`, acrescentar:

```css
  /* -------------------------------------------------------------------------
     O PAINEL — o segundo escopo, pelo mesmo mecanismo do primeiro.

     O reset do Tailwind continua NÃO sendo global, e a razão não mudou: o
     painel LEGADO (frontend/legacy, styled-components) depende dos defaults do
     navegador e reseta só `* { margin/padding/box-sizing/font-family }` no seu
     próprio createGlobalStyle. Um preflight global zeraria font-size de título,
     aparência de button e sublinhado de <a> lá dentro.

     Então o painel NOVO ganha o mesmo tratamento que a vitrine: um contêiner
     `.painel`, aplicado por app/dashboard/(protegido)/layout.tsx, e o reset
     escopado nele. Dois escopos, um mecanismo, e o legado segue de pé até a
     Onda 6 do roteiro — quando `.painel` deixa de precisar do escopo e este
     arquivo simplifica sozinho.

     A DIFERENÇA PARA `.vitrine`, e ela é deliberada: aqui o padrão é DENSO.
     `font-size: 14px` na raiz do painel, contra os 16px da loja. Painel
     administrativo é lido de perto, com muita linha na tela, por quem passa o
     dia nele — R22 da pesquisa: "densidade alta e cor escassa; mas comprima o
     PADDING da célula, nunca o alvo de toque".
  ------------------------------------------------------------------------- */
  body:has(.painel) {
    margin: 0;
    font-family: var(--font-ui);
    line-height: 1.45;
    color: var(--color-fuligem);
    background-color: var(--color-cal);
  }

  .painel {
    font-family: var(--font-ui);
    font-size: 14px;
    line-height: 1.45;
    color: var(--color-fuligem);
    background-color: var(--color-cal);
    min-height: 100vh;
  }

  .painel *,
  .painel *::before,
  .painel *::after {
    box-sizing: border-box;
    border: 0 solid var(--color-fuligem-20);
    margin: 0;
    padding: 0;
  }

  .painel img,
  .painel svg,
  .painel video {
    display: block;
    max-width: 100%;
  }

  /* Todo NÚMERO em monoespaçada com numeral tabular — R23. É o que faz comparar
     valores numa coluna ser comparar POSIÇÃO, e não comprimento de string. */
  .painel [data-dado],
  .painel td[data-dado],
  .painel .dado {
    font-family: var(--font-dado);
    font-variant-numeric: tabular-nums;
  }

  /* `button` e `input` não herdam fonte do pai por default do navegador. Sem
     isto, todo campo do painel sai em Arial enquanto o resto sai em Archivo —
     e a diferença é sutil o bastante para passar despercebida por semanas. */
  .painel button,
  .painel input,
  .painel select,
  .painel textarea {
    font: inherit;
    color: inherit;
    background: none;
  }
```

- [ ] **Step 2: Verificar que a vitrine não mudou**

Run: `npm --prefix frontend run test`
Expected: PASS, contagem igual.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(painel): o reset do Tailwind ganha o escopo .painel, ao lado de .vitrine"
```

---

### Task 10: DOM de teste, restrito ao painel

**Files:**
- Modify: `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (devDependencies)
- Create: `frontend/lib/teste/renderizar.tsx`

- [ ] **Step 1: Instalar as dependências**

```bash
npm --prefix frontend install -D jsdom @testing-library/react @testing-library/user-event
```

`@testing-library/react` na versão compatível com **React 18.3.1** (a linha 14.x; a 16.x mira React
19). Conferir com `npm --prefix frontend ls @testing-library/react` depois de instalar.

- [ ] **Step 2: Escopar o ambiente no `vitest.config.ts`**

Acrescentar dentro de `test:`, mantendo `environment: "node"` como padrão:

```ts
    /**
     * O DOM entra AQUI E SÓ AQUI.
     *
     * A suíte da vitrine roda em `environment: "node"` e assim continua: são
     * 779 casos escritos contra `renderToStaticMarkup`, e trocar o ambiente de
     * todos eles é mudar a filosofia de teste do repositório inteiro por causa
     * de uma área nova.
     *
     * Mas painel administrativo é interativo por definição — barra de salvar
     * que aparece quando o formulário suja, seleção em massa que distingue "os
     * 50 da página" dos "1.284 do filtro", devolução de foco ao fechar o painel
     * lateral. `renderToStaticMarkup` NÃO EXECUTA EFEITO: uma ilha de cliente
     * renderiza vazio e o teste passa provando nada.
     *
     * A regra de divisão continua sendo a da spec §2.8: a DECISÃO vive num
     * módulo puro `*.logica.ts` e é testada em `node`; o DOM cobre só o que a
     * função pura não alcança.
     */
    environmentMatchGlobs: [
      ["app/dashboard/**", "jsdom"],
      ["components/painel/**", "jsdom"],
      ["lib/teste/renderizar.test.tsx", "jsdom"],
    ],
```

- [ ] **Step 3: Escrever o helper e o teste que prova que o DOM está de pé**

`frontend/lib/teste/renderizar.tsx`:

```tsx
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Render COM DOM, só para o painel.
 *
 * Devolve o resultado do testing-library junto de um `usuario` já configurado,
 * porque `userEvent.setup()` esquecido é a causa número um de teste que
 * "não clica" sem dizer por quê.
 *
 * Só funciona em arquivo coberto por `environmentMatchGlobs` no
 * vitest.config.ts. Fora dali o ambiente é `node` e `document` não existe.
 */
export function renderizar(no: ReactElement) {
  const usuario = userEvent.setup();
  return { ...render(no), usuario };
}
```

`frontend/lib/teste/renderizar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { renderizar } from "./renderizar";

function Contador() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>cliques: {n}</button>;
}

describe("renderizar", () => {
  it("monta num DOM de verdade e o clique roda o efeito", async () => {
    const { getByRole, usuario } = renderizar(<Contador />);
    const botao = getByRole("button");
    expect(botao.textContent).toBe("cliques: 0");
    await usuario.click(botao);
    expect(botao.textContent).toBe("cliques: 1");
  });
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix frontend run test -- lib/teste`
Expected: PASS, 3 casos (2 de `html`, 1 de `renderizar`).

- [ ] **Step 5: Rodar a suíte inteira e confirmar que nada da vitrine mudou de ambiente**

Run: `npm --prefix frontend run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/vitest.config.ts frontend/package.json frontend/package-lock.json frontend/lib/teste/
git commit -m "test(painel): DOM de teste escopado no painel, com a vitrine intacta em node"
```

---

### Task 11: Os primitivos do painel

**Antes de escrever a primeira linha desta tarefa, invoque `frontend-design:frontend-design`.**
A direção estética está fixada: **etiqueta pura** — filete de 1px, cantos retos, monoespaçada para
dado, cal e fuligem, vermelho só para erro. O que a skill acrescenta é acabamento.

**Regras não-negociáveis (§2.7 da spec):** proibido `rounded-lg` ou qualquer raio fora de
`--radius-cx`/`--radius-bt`; proibido `shadow-*`; proibida paleta cinza neutra e cor em `oklch`;
proibidos os componentes `Card`/`Button`/`Input`/`Table` do shadcn. Tabela é `<table>`/`<th>`/
`<button>` nativo com `aria-sort` — **não** `role="grid"` (R24: adotar grid obriga a implementar
navegação 2D por setas, roving tabindex e virtualização acessível à mão).

**Files:**
- Create: `frontend/components/painel/ui/Botao.tsx` + teste
- Create: `frontend/components/painel/ui/Tarja.tsx` + teste
- Create: `frontend/components/painel/ui/Ficha.tsx`
- Create: `frontend/components/painel/ui/Campo.tsx` + teste
- Create: `frontend/components/painel/ui/Selo.tsx` + teste
- Create: `frontend/components/painel/ui/Tabela.tsx` + teste
- Create: `frontend/components/painel/ui/EstadoDaTela.tsx` + teste
- Modify: `frontend/package.json` (Radix)

- [ ] **Step 1: Instalar os primitivos do Radix**

```bash
npm --prefix frontend install @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-popover @radix-ui/react-tooltip @radix-ui/react-dialog @radix-ui/react-tabs
```

Conferir que todos aceitam React 18: `npm --prefix frontend ls react` não pode acusar conflito de
peer dependency.

- [ ] **Step 2: `Tarja` primeiro, e o teste dela**

É o componente mais copiado do painel legado (seis telas repetem literalmente a mesma) e o que
carrega a doutrina mais importante.

`frontend/components/painel/ui/Tarja.tsx`:

```tsx
import type { ReactNode } from "react";

type Tom = "erro" | "alerta" | "sucesso" | "aviso";

const TONS: Record<Tom, { borda: string; texto: string; papel: "alert" | "status" }> = {
  erro:    { borda: "border-vermelho",   texto: "text-vermelho",   papel: "alert" },
  alerta:  { borda: "border-alerta",     texto: "text-alerta",     papel: "status" },
  sucesso: { borda: "border-sucesso",    texto: "text-sucesso",    papel: "status" },
  aviso:   { borda: "border-fuligem-20", texto: "text-fuligem-55", papel: "status" },
};

/**
 * A tarja — e por que ela NÃO é um toast.
 *
 * R9 da pesquisa: erro nunca é toast. Flash que some sozinho pode não ser
 * anunciado por leitor de tela, desaparece para quem usa ampliação, e não tem
 * como ser relido por quem olhou tarde. "Se a informação só existe no toast,
 * ela não existe."
 *
 * `role="alert"` só para erro. Em `status` o leitor de tela anuncia sem
 * interromper o que a pessoa está fazendo — usar `alert` para tudo treina o
 * usuário a ignorar a região inteira.
 *
 * Filete de 1px à esquerda e nada mais: sem fundo colorido, sem sombra, sem
 * ícone decorativo. A cor faz o trabalho e o texto carrega o diagnóstico.
 */
export function Tarja({
  tom = "erro",
  children,
  onFechar,
}: {
  tom?: Tom;
  children: ReactNode;
  onFechar?: () => void;
}) {
  const t = TONS[tom];
  return (
    <div
      role={t.papel}
      className={`flex items-start gap-3 border-l-2 ${t.borda} bg-cal-puro px-4 py-3`}
    >
      <p className={`flex-1 ${t.texto}`}>{children}</p>
      {onFechar && (
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          className="text-fuligem-55 hover:text-fuligem"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

`frontend/components/painel/ui/Tarja.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { Tarja } from "./Tarja";

describe("Tarja", () => {
  it("erro usa role=alert, que interrompe o leitor de tela", () => {
    expect(html(<Tarja tom="erro">falhou</Tarja>)).toContain('role="alert"');
  });

  it("os demais tons usam role=status, que não interrompe", () => {
    expect(html(<Tarja tom="sucesso">salvo</Tarja>)).toContain('role="status"');
    expect(html(<Tarja tom="alerta">atenção</Tarja>)).toContain('role="status"');
  });

  it("mostra a frase recebida — ela é o diagnóstico", () => {
    expect(html(<Tarja>Já existe um produto com este SKU.</Tarja>))
      .toContain("Já existe um produto com este SKU.");
  });

  it("sem onFechar não desenha botão de fechar", () => {
    expect(html(<Tarja>x</Tarja>)).not.toContain("Fechar aviso");
  });
});
```

- [ ] **Step 3: `EstadoDaTela` — a distinção entre "zero" e "não sei"**

Este é o componente que impede o defeito descrito em §7-B da spec.

```tsx
import type { ReactNode } from "react";
import { Tarja } from "./Tarja";

/**
 * Os quatro estados de uma tela de dados — e por que "vazio" não é um deles
 * quando houve erro.
 *
 * Zero produtos, zero pedidos e zero vendas são números PERFEITAMENTE
 * PLAUSÍVEIS. Mostrar o estado inicial depois de um fetch que falhou é
 * informação errada apresentada com toda a confiança: o gestor lê "não vendi
 * nada hoje" quando o certo era "não consegui perguntar". Isso é pior do que
 * não mostrar nada, e o painel legado documenta a lição em HomeDashboard.jsx.
 *
 * A ORDEM DAS GUARDAS É A REGRA: carregando → erro → vazio → conteúdo. Um
 * `if (!lista.length) return <Vazio/>` colocado antes do teste de erro apaga a
 * distinção em toda tela de uma vez.
 *
 * R16: três estados vazios distintos, com textos e ações diferentes.
 */
export function EstadoDaTela({
  carregando,
  erro,
  vazio,
  filtroAtivo,
  aoLimparFiltro,
  aoTentarDeNovo,
  esqueleto,
  vazioTitulo,
  vazioTexto,
  vazioAcao,
  children,
}: {
  carregando: boolean;
  erro: string | null;
  vazio: boolean;
  filtroAtivo?: boolean;
  aoLimparFiltro?: () => void;
  aoTentarDeNovo?: () => void;
  esqueleto: ReactNode;
  vazioTitulo: string;
  vazioTexto: string;
  vazioAcao?: ReactNode;
  children: ReactNode;
}) {
  if (carregando) return <>{esqueleto}</>;

  if (erro) {
    return (
      <Tarja tom="erro">
        {erro}
        {aoTentarDeNovo && (
          <>
            {" "}
            <button type="button" onClick={aoTentarDeNovo} className="underline">
              Tentar de novo
            </button>
          </>
        )}
      </Tarja>
    );
  }

  if (vazio && filtroAtivo) {
    return (
      <div className="border border-fuligem-20 bg-cal-puro px-6 py-10 text-center">
        <p className="text-fuligem-55">Nenhum resultado para este filtro.</p>
        {aoLimparFiltro && (
          <button type="button" onClick={aoLimparFiltro} className="mt-2 underline">
            Limpar filtros
          </button>
        )}
      </div>
    );
  }

  if (vazio) {
    return (
      <div className="border border-fuligem-20 bg-cal-puro px-6 py-10 text-center">
        <p className="font-medium">{vazioTitulo}</p>
        <p className="mt-1 text-fuligem-55">{vazioTexto}</p>
        {vazioAcao && <div className="mt-4">{vazioAcao}</div>}
      </div>
    );
  }

  return <>{children}</>;
}
```

`frontend/components/painel/ui/EstadoDaTela.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { html } from "@/lib/teste/html";
import { EstadoDaTela } from "./EstadoDaTela";

const base = {
  esqueleto: <p>carregando…</p>,
  vazioTitulo: "Nenhum produto ainda",
  vazioTexto: "Cadastre o primeiro café.",
  children: <table />,
};

describe("EstadoDaTela", () => {
  it("carregando ganha o esqueleto e mais nada", () => {
    const saida = html(<EstadoDaTela {...base} carregando erro={null} vazio={false} />);
    expect(saida).toContain("carregando…");
    expect(saida).not.toContain("<table");
  });

  it("ERRO COM LISTA VAZIA mostra o erro, NUNCA o estado vazio", () => {
    const saida = html(
      <EstadoDaTela {...base} carregando={false} erro="Não foi possível carregar." vazio />,
    );
    expect(saida).toContain("Não foi possível carregar.");
    expect(saida).not.toContain("Nenhum produto ainda");
  });

  it("vazio com filtro ativo oferece limpar, e não ensina a cadastrar", () => {
    const saida = html(
      <EstadoDaTela {...base} carregando={false} erro={null} vazio filtroAtivo />,
    );
    expect(saida).toContain("Nenhum resultado para este filtro.");
    expect(saida).not.toContain("Nenhum produto ainda");
  });

  it("vazio de verdade ensina o próximo passo", () => {
    const saida = html(<EstadoDaTela {...base} carregando={false} erro={null} vazio />);
    expect(saida).toContain("Nenhum produto ainda");
    expect(saida).toContain("Cadastre o primeiro café.");
  });

  it("com conteúdo, desenha o conteúdo", () => {
    const saida = html(
      <EstadoDaTela {...base} carregando={false} erro={null} vazio={false} />,
    );
    expect(saida).toContain("<table");
  });
});
```

- [ ] **Step 4: `Botao`, `Selo`, `Campo`, `Ficha`, `Tabela`**

Escrever no mesmo padrão: componente + teste por string de HTML cobrindo o que é **semântico**
(`aria-*`, `type`, `disabled`, papel), não o que é decorativo.

Pontos obrigatórios, cada um vindo de uma regra:

- `Botao` tem variantes `primaria` (fuligem sólido), `secundaria` (filete) e `destrutiva`
  (vermelho). **A destrutiva nunca é `primaria` com cor trocada** (R11), e `type="button"` é o
  padrão — `type` ausente dentro de `<form>` submete o formulário, que é como um botão de filtro
  vira um salvamento acidental.
- `Selo` recebe `tom` de `tomDoStatus` e usa filete, nunca fundo sólido.
- `Campo` põe a mensagem de erro **ao lado do campo**, ligada por `aria-describedby`, e valida no
  `blur` — nunca a cada tecla (R8: "e-mail inválido" na terceira letra é hostil).
- `Tabela` emite `<table>` com `<th scope="col">`, ordenação por `<button>` dentro do `<th>` e
  `aria-sort`; a primeira coluna é identificador humano (R23); célula numérica leva
  `data-dado` para pegar a monoespaçada tabular do `globals.css`.

- [ ] **Step 5: Rodar**

Run: `npm --prefix frontend run test -- components/painel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/painel/ui frontend/package.json frontend/package-lock.json
git commit -m "feat(painel): os primitivos — tarja que nao e toast, e o estado que separa zero de nao-sei"
```

---

### Task 12: A casca do painel

**Invoque `frontend-design:frontend-design` antes de escrever.**

**Files:**
- Create: `frontend/components/painel/casca/MenuLateral.tsx` + teste
- Create: `frontend/components/painel/casca/menu.logica.ts` + teste
- Create: `frontend/components/painel/casca/Cabecalho.tsx` + teste
- Modify: `frontend/app/dashboard/(protegido)/layout.tsx`

- [ ] **Step 1: A lógica do menu, pura, e o teste dela**

`menu.logica.ts` guarda a estrutura e a decisão de qual item está ativo. Nada de React.

```ts
export type ItemDeMenu = { rotulo: string; href: string };
export type GrupoDeMenu = { titulo: string | null; itens: ItemDeMenu[] };

/**
 * O menu do painel, em PORTUGUÊS e com a rota em português.
 *
 * As rotas do painel legado eram `/dashboard/products/addProduct` — inglês
 * herdado do template de onde o projeto nasceu, numa loja cujo gestor não fala
 * inglês. A reescrita corrige isso, e a estrutura vive aqui e não dentro do
 * JSX porque é dado, não desenho: é sobre ela que o teste de item ativo roda.
 *
 * A ORDEM É A DO DIA DE TRABALHO, não a do organograma: primeiro o que se olha
 * toda manhã (a home, os pedidos), por último o que se mexe uma vez por mês
 * (ajustes).
 */
export const MENU: GrupoDeMenu[] = [
  { titulo: null, itens: [{ rotulo: "Início", href: "/dashboard" }] },
  {
    titulo: "Vender",
    itens: [
      { rotulo: "Pedidos", href: "/dashboard/pedidos" },
      { rotulo: "Assinaturas do Clube", href: "/dashboard/assinaturas" },
      { rotulo: "Descontos", href: "/dashboard/descontos" },
    ],
  },
  {
    titulo: "Catálogo",
    itens: [
      { rotulo: "Produtos", href: "/dashboard/produtos" },
      { rotulo: "Avaliações", href: "/dashboard/avaliacoes" },
    ],
  },
  {
    titulo: "Crescer",
    itens: [
      { rotulo: "Marketing", href: "/dashboard/marketing" },
      { rotulo: "Vitrine", href: "/dashboard/vitrine" },
      { rotulo: "Relatórios", href: "/dashboard/relatorios" },
    ],
  },
  {
    titulo: "Gerir",
    itens: [
      { rotulo: "Clientes", href: "/dashboard/clientes" },
      { rotulo: "Ajustes", href: "/dashboard/ajustes" },
    ],
  },
];

/**
 * Qual item está ativo, dado o caminho atual.
 *
 * `/dashboard` só casa EXATO — senão a home fica acesa em toda tela do painel,
 * porque toda rota começa com ela. Os demais casam por prefixo de segmento, de
 * modo que `/dashboard/pedidos/abc-123` mantenha "Pedidos" aceso. O corte por
 * segmento (`href + "/"`) e não por string evita que `/dashboard/produtos`
 * acenda para `/dashboard/produtos-arquivados`.
 */
export function itemAtivo(caminho: string): string | null {
  const itens = MENU.flatMap((g) => g.itens);
  if (caminho === "/dashboard") return "/dashboard";
  const casados = itens
    .filter((i) => i.href !== "/dashboard")
    .filter((i) => caminho === i.href || caminho.startsWith(i.href + "/"));
  if (!casados.length) return null;
  return casados.sort((a, b) => b.href.length - a.href.length)[0].href;
}
```

Teste:

```ts
import { describe, it, expect } from "vitest";
import { MENU, itemAtivo } from "./menu.logica";

describe("MENU", () => {
  it("nenhuma rota em inglês sobreviveu", () => {
    for (const grupo of MENU) {
      for (const item of grupo.itens) {
        expect(item.href).not.toMatch(/products|orders|settings|clients|addProduct/i);
      }
    }
  });

  it("todo href começa em /dashboard", () => {
    for (const grupo of MENU) {
      for (const item of grupo.itens) {
        expect(item.href.startsWith("/dashboard")).toBe(true);
      }
    }
  });

  it("não há href repetido", () => {
    const hrefs = MENU.flatMap((g) => g.itens.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("itemAtivo", () => {
  it("a home só acende no caminho exato", () => {
    expect(itemAtivo("/dashboard")).toBe("/dashboard");
    expect(itemAtivo("/dashboard/pedidos")).toBe("/dashboard/pedidos");
  });

  it("mantém o item aceso na rota de detalhe", () => {
    expect(itemAtivo("/dashboard/pedidos/abc-123")).toBe("/dashboard/pedidos");
  });

  it("corta por segmento, não por string", () => {
    expect(itemAtivo("/dashboard/produtos-arquivados")).toBeNull();
  });

  it("devolve null para rota que não está no menu", () => {
    expect(itemAtivo("/dashboard/inventado")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar, depois passar**

Run: `npm --prefix frontend run test -- components/painel/casca`
Expected: FAIL, depois PASS com 7 casos.

- [ ] **Step 3: `MenuLateral.tsx`**

Ilha cliente (precisa de `usePathname`). Fundo `--color-fuligem`, texto `--color-cal`, filete
`--color-fuligem-80` entre grupos, **rótulo sempre junto do ícone** (R20: ícone sem texto não é
compreendido, tem alvo menor e não ensina), e `aria-current="page"` no item ativo — exatamente um
por vez, que é o que o teste verifica.

A marca no topo é a **serra** (`components/marca/Serra.tsx`), em `currentColor` sobre o fuligem —
uma das três aparições da "mão" no painel inteiro.

- [ ] **Step 4: `Cabecalho.tsx`**

Título da página, ação primária **sempre no mesmo lugar** (R18), quem está logado e **botão de
sair** — que o painel legado não tem, e é queixa registrada no mapa do terreno.

- [ ] **Step 5: Ligar no layout**

`app/dashboard/(protegido)/layout.tsx` mantém `await exigirAdminNoPainel("/dashboard")` **intacto** e
passa a envolver os filhos:

```tsx
  await exigirAdminNoPainel("/dashboard");
  return (
    <div className="painel flex min-h-screen">
      <MenuLateral />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
```

A classe `.painel` é o que liga o reset da Task 9. Sem ela, o painel herda os defaults do navegador.

- [ ] **Step 6: Rodar tudo**

Run: `npm --prefix frontend run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/painel/casca frontend/app/dashboard/\(protegido\)/layout.tsx
git commit -m "feat(painel): a casca — menu em portugues, botao de sair, e a serra no topo"
```

---

### Task 13: A primeira rota real, e o legado sai da raiz

**Files:**
- Create: `frontend/app/dashboard/(protegido)/page.tsx`
- Move: `frontend/app/dashboard/(protegido)/[[...rota]]/` → `frontend/app/dashboard/(protegido)/legado/[[...rota]]/`

- [ ] **Step 1: Criar a home nova em `page.tsx`**

Server Component. Nesta onda ela ainda não tem dados — desenha a estrutura da fila de trabalho com
`EstadoDaTela` em `carregando`, e os links para as áreas. Os números chegam na Onda 4.

- [ ] **Step 2: Mover o catch-all para baixo de `/legado`**

O catch-all `[[...rota]]` na raiz de `(protegido)` engole **toda** rota nova: `/dashboard/pedidos`
casaria com ele antes de existir uma pasta `pedidos`. Movê-lo para `legado/[[...rota]]` faz o painel
antigo continuar acessível em `/dashboard/legado/...` enquanto as telas novas nascem, sem competir
por rota.

Ajustar o `basename` do `createBrowserRouter` em `frontend/legacy/PainelApp.jsx` para
`/dashboard/legado`, senão o SPA legado tenta casar rotas que não existem mais e cai na tela de erro
padrão do react-router.

- [ ] **Step 3: Rodar o teste de estrutura**

Run: `npm --prefix frontend run test -- lib/conta/painel-servidor`
Expected: PASS — `pastasRecursivas` de `(publico)` continua sendo só `["entrar"]`, e o novo
`legado/` mora dentro de `(protegido)`, que é o que o teste exige.

- [ ] **Step 4: Verificar o build**

Run: `npm --prefix frontend run build`
Expected: sucesso, com `/dashboard` e `/dashboard/legado/[[...rota]]` na lista de rotas.

- [ ] **Step 5: Rodar tudo**

Run: `npm --prefix frontend run test && npm --prefix backend test`
Expected: PASS nas duas.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/app/dashboard frontend/legacy/PainelApp.jsx
git commit -m "feat(painel): a raiz do painel e uma rota de verdade, e o legado desce para /legado"
```

---

## Como se sabe que a Onda 1 acabou

1. `npm --prefix frontend run test` passa, com contagem **maior** que 779.
2. `npm --prefix backend test` passa, com contagem ≥ 427.
3. `npm --prefix frontend run build` passa.
4. `/dashboard` abre no painel novo, com o menu em português, o botão de sair e a serra no topo.
5. `/dashboard/legado/orders` abre o painel antigo, inteiro e funcionando.
6. `frontend/lib/painel/` contém transporte, resposta, dinheiro, status e a regra do Bling — cada um
   com teste, e nenhum deles com uma segunda cópia dentro de `legacy/`.
7. Criar um arquivo com `"use server"` sob `/dashboard` sem chamar `exigirAdminEmAcao` deixa a suíte
   **vermelha**.
