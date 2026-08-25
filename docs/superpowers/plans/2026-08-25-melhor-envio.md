# Melhor Envio — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consertar a cotação de frete que está errada em produção e integrar o ciclo completo da Melhor Envio — cotar, comprar etiqueta, imprimir, rastrear — com o rastreio escrito de volta no Bling.

**Architecture:** Dois serviços novos espelhando o par `blingClient` + `blingPedidos` que já está em produção: `melhorEnvioClient.js` só mantém um token válido; `melhorEnvioEtiquetas.js` só sabe a regra da etiqueta. O refresh token vive numa coluna protegida de `config_loja`, nunca no `.env`. A compra é um botão de admin, idempotente e retomável passo a passo, porque cada passo gasta dinheiro real.

**Tech Stack:** Node 22 (CommonJS), Express 4, `node --test`, Postgres via `pg`, React 18 no painel legado, Next 15 na vitrine.

**Spec:** `docs/superpowers/specs/2026-08-25-melhor-envio-design.md`

---

## Antes de começar

**A suíte deste projeto só passa serial.** Todo comando de teste neste plano usa
`--test-concurrency=1`. Em paralelo caem dezenas de testes por contenção do
Postgres embarcado — é ruído de ambiente, não regressão.

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

**Isto vale para DUAS suítes rodando ao mesmo tempo, não só para o flag.** Medido
durante a execução deste plano: uma segunda suíte disparada em paralelo com a
primeira levou as duas de 1 falha para 8. Nenhuma das 7 extras era regressão.
Quem executa uma tarefa não roda a suíte enquanto outro agente roda a dele.

### O baseline medido em 25/08/2026, no commit `f040695`

```
# tests 419   # pass 410   # fail 1   # skipped 1
```

A **única** falha é `o arquivo no repositorio esta em dia com o gerador`, em
`test/instalacao.test.js`. É ruído de CRLF no Windows — falta um `.gitattributes`
no projeto —, não desatualização do arquivo. Se a sua execução mostrar essa e só
essa, o baseline está bom. Qualquer outra falha é sua.

**Nenhuma tarefa da Fase 1 precisa de credencial.** As Fases 2 a 4 são escritas e
testadas inteiras contra mocks e uma porta fechada (`http://127.0.0.1:9`) — o
molde já existe em `test/f4_status_e_frete.test.js:53`. Credencial de sandbox só
é necessária para a verificação manual no fim de cada fase; credencial de
produção, só na Fase 5.

### Onde este plano é deliberadamente menos detalhado, e por quê

As Fases 1 e 2 trazem o código completo, teste a teste. Nas Tasks 10 a 15 os
**casos** de teste estão nomeados um a um, mas sem o corpo das asserções.

Isso é escolha, não preguiça: as asserções dessas tarefas dependem do **formato
real das respostas** da Melhor Envio (`cart`, `checkout`, `generate`, `print`, o
payload do webhook) e da resposta do spike do Bling na Task 13. Inventar
asserções contra um JSON que ninguém viu produziria testes que passam contra o
mock e falham contra a API — pior do que nenhum teste, porque dão confiança
falsa.

**A regra para quem executa essas tarefas:** primeiro capture uma resposta real
do sandbox, cole o formato no arquivo de teste como fixture, e só então escreva a
asserção. Os nomes dos testes listados são obrigatórios — cada um cobre um modo
de falha que já custou dinheiro em alguma loja.

---

## Mapa de arquivos

### Criar

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/repositories/cotacaoRepository.js` | A leitura única de peso, dimensão, preço e categoria do banco. Uma função, um `SELECT`. |
| `backend/db/migrations/0017_melhor_envio.sql` | Colunas de token em `config_loja` e de etiqueta em `pedidos`. |
| `backend/src/services/melhorEnvioClient.js` | Ciclo de vida do token: ler, renovar, persistir, autenticar requisição. Não sabe o que é pedido. |
| `backend/src/services/melhorEnvioEtiquetas.js` | Regra da etiqueta: carrinho, pagamento, geração, impressão, claim, retomada. Não sabe o que é token. |
| `backend/src/controllers/MelhorEnvioController.js` | Casca HTTP: valida entrada, chama o serviço, traduz erro em status. |
| `backend/src/routes/melhorEnvio.routes.js` | Rotas de admin. |
| `backend/test/f8_melhor_envio_token.test.js` | Renovação, ordem memória→banco→env, falha de gravação. |
| `backend/test/f8_melhor_envio_etiqueta.test.js` | Os quatro passos, retomada, claim, saldo insuficiente. |
| `backend/test/f8_melhor_envio_webhook.test.js` | HMAC, reentrega, evento desconhecido. |
| `frontend/legacy/components/DashboardSection/MelhorEnvio/MelhorEnvioManager.jsx` | Tela de status da integração. |
| `frontend/legacy/components/DashboardSection/MelhorEnvio/useMelhorEnvioAcoes.js` | Estado e chamadas das ações. |
| `frontend/legacy/components/DashboardSection/MelhorEnvio/melhorEnvioContrato.js` | Normalização das respostas da API. |
| `docs/melhor-envio.md` | Runbook: credenciais, autorização, virada, o que fazer quando quebra. |

### Modificar

| Arquivo | O quê |
|---|---|
| `backend/src/controllers/ShippingController.js` | A rota pública lê o pacote do banco; os defaults saem. |
| `backend/src/controllers/PaymentController.js:488` | Passa a usar `cotacaoRepository`; grava `me_servico_id`; `conferirFrete` casa o id. |
| `backend/src/index.js` | Monta as rotas novas e o webhook. |
| `backend/src/services/blingPedidos.js` | Escreve o rastreio da Melhor Envio no pedido de venda. |
| `backend/src/.env.example` | Variáveis novas; `MELHOR_ENVIO_TOKEN` sai. |
| `backend/test/f4_status_e_frete.test.js` | Cobre a cotação lendo do banco. |
| `frontend/legacy/components/DashboardSection/Orders/Orders.jsx` | Botões "Comprar etiqueta" e "Imprimir etiqueta". |
| `frontend/legacy/components/DashboardSection/MenuAside/MenuAside.jsx` | Item de menu da tela nova. |
| `docs/deploy.md`, `docs/go-live.md` | Variáveis novas na tabela de ambiente. |

---

# FASE 1 — a cotação passa a usar o pacote real

Independente das outras. Não precisa de credencial. Vale sozinha: para de perder
venda hoje.

---

### Task 1: O repositório de leitura para cotação

Hoje `PaymentController.js:488` faz esse `SELECT` inline e a rota pública não faz
nenhum. Extrair primeiro deixa as duas pontas lendo a mesma coisa — que é o
ponto inteiro da fase.

**Files:**
- Create: `backend/src/repositories/cotacaoRepository.js`
- Test: `backend/test/f4_status_e_frete.test.js` (adicionar ao arquivo existente)

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao fim de `backend/test/f4_status_e_frete.test.js`. O `require` vai no
`before()` existente, junto dos outros:

```js
// dentro do before(), com os demais requires:
cotacaoRepository = require("../src/repositories/cotacaoRepository.js");
```

Declare `let cotacaoRepository;` no topo, com os outros `let`. O teste:

```js
test("lerParaCotacao devolve peso e dimensões reais, indexados por product_id", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.produtos (nome, preco, peso, largura, altura, comprimento, categoria)
     VALUES ('Pacote de 1 kg', 109.90, 1.000, 24, 10, 32, 'Café em grãos')
     RETURNING produto_id`,
  );
  const id = rows[0].produto_id;

  const porId = await cotacaoRepository.lerParaCotacao([id]);

  const p = porId.get(id);
  assert.equal(Number(p.weight), 1.0);
  assert.equal(Number(p.width), 24);
  assert.equal(Number(p.height), 10);
  assert.equal(Number(p.length), 32);
  assert.equal(Number(p.price), 109.9);
  assert.equal(p.category, "Café em grãos");
});

test("lerParaCotacao não inventa produto que não existe", async () => {
  const porId = await cotacaoRepository.lerParaCotacao([
    "00000000-0000-0000-0000-000000000000",
  ]);
  assert.equal(porId.size, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f4_status_e_frete.test.js --test-concurrency=1
```

Esperado: FAIL com `Cannot find module '../src/repositories/cotacaoRepository.js'`.

- [ ] **Step 3: Escrever a implementação mínima**

`backend/src/repositories/cotacaoRepository.js`:

```js
"use strict";

/**
 * A LEITURA ÚNICA que alimenta toda cotação de frete.
 *
 * Existe uma vez só porque as DUAS pontas precisam do mesmo pacote: a rota
 * pública `/shipping/calculate`, que diz ao cliente quanto custa, e o
 * `conferirFrete` do checkout, que decide quanto ele paga. Enquanto a primeira
 * usava defaults do código e a segunda lia do banco, os dois números discordavam
 * em toda venda — e quem descobria era o cliente, com 409 na hora de pagar.
 *
 * Devolve um Map indexado por `product_id` e NÃO um array: quem chama itera a
 * sacola (que tem quantidade e ordem) e busca aqui. Um array obrigaria cada
 * chamador a montar o índice de novo.
 *
 * Produto ausente do Map é produto que não existe no banco. O chamador decide o
 * que isso significa — na cotação, recusar; no checkout, "o produto não existe
 * mais". O repositório não inventa pacote.
 */

const pool = require("../pgPool");

async function lerParaCotacao(productIds) {
  const ids = [...new Set((productIds || []).map(String))];
  if (ids.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT produto_id  AS product_id,
            preco       AS price,
            categoria   AS category,
            nome        AS name,
            peso        AS weight,
            largura     AS width,
            altura      AS height,
            comprimento AS length
       FROM canastra.produtos
      WHERE produto_id = ANY($1::uuid[])`,
    [ids],
  );

  return new Map(rows.map((p) => [p.product_id, p]));
}

module.exports = { lerParaCotacao };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/f4_status_e_frete.test.js --test-concurrency=1
```

Esperado: PASS, sem regressão nos testes que já existiam no arquivo.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/cotacaoRepository.js backend/test/f4_status_e_frete.test.js
git commit -m "feat(frete): a leitura unica de peso e dimensao para cotacao"
```

---

### Task 2: `calcularOpcoesDeFrete` recusa item sem pacote

Os defaults `0.3 kg` e `20×5×20` são a causa raiz. Enquanto existirem, qualquer
chamador novo herda o bug em silêncio.

**Files:**
- Modify: `backend/src/controllers/ShippingController.js:98-107`
- Test: `backend/test/f4_status_e_frete.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("cotar item sem peso é erro, não um pacote inventado de 300 g", async () => {
  await assert.rejects(
    () =>
      calcularOpcoesDeFrete({
        zipCode: CEP_LOCAL,
        itens: [{ product_id: "x", quantity: 1, price: 39.7 }],
      }),
    /peso|dimens/i,
  );
});

test("cotar item COM peso segue funcionando", async () => {
  const opcoes = await calcularOpcoesDeFrete({
    zipCode: CEP_LOCAL,
    itens: [
      {
        product_id: "x",
        quantity: 1,
        price: 39.7,
        weight: 0.25,
        width: 18,
        height: 7,
        length: 24,
      },
    ],
  });
  // A porta fechada derruba a cotação externa; sobra a entrega local do 350.
  assert.ok(opcoes.some((o) => o.name === "Entrega Local"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f4_status_e_frete.test.js --test-concurrency=1
```

Esperado: FAIL — o primeiro teste não rejeita, porque hoje o default assume 0,3 kg.

- [ ] **Step 3: Trocar os defaults por recusa**

Em `backend/src/controllers/ShippingController.js`, substitua o bloco
`productsPayload`:

```js
  /**
   * SEM DEFAULT, E ESTA É A CORREÇÃO DA F8.
   *
   * Este bloco tinha `item.weight ? Number(item.weight) : 0.3` e três irmãos
   * para as dimensões. Como o navegador nunca manda esses campos
   * (`frontend/lib/sacola/checkout.ts` envia product_id, quantity e price),
   * TODA cotação da vitrine saía com um pacote de 0,3 kg e 20×5×20 — que não é
   * nenhum produto do catálogo. O checkout recotava com o peso do banco, os
   * dois números discordavam, e o cliente levava 409 na hora de pagar.
   *
   * Recusar é o lado seguro do erro: cotação que falha é um aviso na tela;
   * cotação errada é uma venda perdida no último passo, sem ninguém saber por
   * quê. Quem chama é responsável por trazer o pacote do banco
   * (`cotacaoRepository.lerParaCotacao`).
   */
  const productsPayload = itens.map((item) => {
    const dimensoes = {
      width: Number(item.width),
      height: Number(item.height),
      length: Number(item.length),
      weight: Number(item.weight),
    };
    for (const [campo, valor] of Object.entries(dimensoes)) {
      if (!Number.isFinite(valor) || valor <= 0) {
        const erro = new Error(
          `Item ${item.product_id} sem ${campo}: o peso e as dimensões têm de ` +
            "vir do banco (cotacaoRepository), nunca do navegador.",
        );
        erro.code = "ITEM_SEM_PACOTE";
        throw erro;
      }
    }
    return {
      id: item.product_id,
      ...dimensoes,
      insurance_value: Number(item.price),
      quantity: Number(item.quantity),
    };
  });
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/f4_status_e_frete.test.js --test-concurrency=1
```

Esperado: PASS nos dois testes novos. **Outros arquivos vão quebrar** —
`f4_checkout_e_webhook.test.js` e `f6_cupons.test.js` cotam com itens sem peso.
Isso é esperado e a Task 3 conserta. Rode a suíte inteira para ver o estrago:

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/ShippingController.js backend/test/f4_status_e_frete.test.js
git commit -m "fix(frete): pacote inventado de 0,3 kg vira recusa explicita"
```

---

### Task 3: A rota pública monta o pacote a partir do banco

**Files:**
- Modify: `backend/src/controllers/ShippingController.js` (handler `calculate`)
- Test: `backend/test/f4_status_e_frete.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("a cotação pública ignora peso e preço do navegador e usa o do banco", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.produtos (nome, preco, peso, largura, altura, comprimento)
     VALUES ('Caixa de 2 kg', 236.70, 2.000, 18, 7, 24)
     RETURNING produto_id`,
  );
  const id = rows[0].produto_id;

  // O navegador MENTE: diz que pesa 1 g e custa R$ 1.
  const itens = await montarItensDaCotacao([
    { product_id: id, quantity: 1, price: 1, weight: 0.001 },
  ]);

  assert.equal(Number(itens[0].weight), 2.0);
  assert.equal(Number(itens[0].price), 236.7);
  assert.equal(Number(itens[0].width), 18);
});

test("a cotação recusa product_id que não existe", async () => {
  await assert.rejects(
    () =>
      montarItensDaCotacao([
        { product_id: "00000000-0000-0000-0000-000000000000", quantity: 1 },
      ]),
    /não existe/i,
  );
});
```

Adicione `montarItensDaCotacao` ao destructuring do `require` no `before()`:

```js
({ calcularOpcoesDeFrete, montarItensDaCotacao } = require("../src/controllers/ShippingController.js"));
```

E `let montarItensDaCotacao;` no topo.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f4_status_e_frete.test.js --test-concurrency=1
```

Esperado: FAIL com `montarItensDaCotacao is not a function`.

- [ ] **Step 3: Implementar**

Em `backend/src/controllers/ShippingController.js`, adicione perto do topo:

```js
const cotacaoRepository = require("../repositories/cotacaoRepository");
const PromotionsRepository = require("../repositories/promotionsRepository");
const { precoComPromocao, somarCentavos } = require("../utils/preco");
```

(`somarCentavos` já é importado — não duplique o require.)

E a função:

```js
/**
 * Transforma o que o NAVEGADOR mandou no pacote que a transportadora vai levar.
 *
 * Do corpo da requisição sobrevivem dois campos: `product_id` e `quantity`.
 * Todo o resto — peso, dimensões, preço, categoria — vem do banco. É o que faz
 * esta cotação e a recotação do checkout (`conferirFrete`) chegarem ao MESMO
 * número, que era exatamente o que não acontecia antes da F8.
 *
 * O PREÇO TAMBÉM VEM DO BANCO, e não é excesso de zelo: o preço entra na
 * decisão de frete grátis (o piso é comparado com o subtotal) e na promoção. O
 * checkout aplica `precoComPromocao`; se aqui o preço viesse da sacola, um
 * carrinho com promoção ativa poderia prometer frete grátis que o checkout
 * recusaria — o mesmo 409 por outra porta.
 */
async function montarItensDaCotacao(items) {
  const ids = items.map((i) => i.product_id);
  const porId = await cotacaoRepository.lerParaCotacao(ids);

  const promocoes = await PromotionsRepository.getActivePromotions().catch(
    (erro) => {
      // Promoção indisponível NÃO derruba a cotação: sem ela o preço é o de
      // catálogo, que é mais ALTO — o lado seguro do erro para o frete grátis.
      console.error("Cotação: promoções indisponíveis, usando preço de catálogo:", erro.message);
      return [];
    },
  );

  return items.map((item) => {
    const produto = porId.get(String(item.product_id));
    if (!produto) {
      const erro = new Error(`O produto ${item.product_id} não existe.`);
      erro.code = "PRODUTO_INEXISTENTE";
      throw erro;
    }
    return {
      product_id: produto.product_id,
      quantity: Number(item.quantity),
      price: precoComPromocao(produto, promocoes),
      weight: produto.weight,
      width: produto.width,
      height: produto.height,
      length: produto.length,
    };
  });
}
```

No handler `calculate`, troque o uso de `items` cru:

```js
      let itensDoBanco;
      try {
        itensDoBanco = await montarItensDaCotacao(items);
      } catch (erro) {
        if (erro.code === "PRODUTO_INEXISTENTE") {
          return res.status(400).json({ error: erro.message });
        }
        throw erro;
      }

      let descontoCentavos = 0;
      const codigoDeCupom = normalizarCodigo(cupom);
      if (codigoDeCupom) {
        try {
          const linha = await cuponsRepository.buscarPorCodigo(codigoDeCupom);
          // O subtotal do cupom sai dos itens DO BANCO, pela mesma razão que o
          // do frete grátis: os dois lados têm de somar sobre a mesma base.
          const avaliacao = avaliarCupom(linha, subtotalEmCentavos(itensDoBanco));
          if (avaliacao.valido) descontoCentavos = avaliacao.descontoCentavos;
        } catch (erro) {
          console.error("Cupom ignorado na cotação de frete:", erro.message);
        }
      }

      const opcoes = await calcularOpcoesDeFrete({
        zipCode,
        itens: itensDoBanco,
        descontoCentavos,
      });
      return res.json(opcoes);
```

Exporte a função no fim do arquivo:

```js
module.exports.montarItensDaCotacao = montarItensDaCotacao;
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

Esperado: PASS. Se `f4_checkout_e_webhook.test.js` ou `f6_cupons.test.js` ainda
falharem, é porque montam itens sem peso ao chamar `conferirFrete` direto —
acrescente peso e dimensões aos fixtures desses arquivos, não afrouxe a validação.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/ShippingController.js backend/test/
git commit -m "fix(frete): a cotacao publica passa a usar o pacote do banco"
```

---

### Task 4: O checkout usa o mesmo repositório

DRY: enquanto houver dois `SELECT` com a mesma lista de colunas, um dia um ganha
uma coluna e o outro não — e a divergência volta pela porta dos fundos.

**Files:**
- Modify: `backend/src/controllers/PaymentController.js:488-500`
- Test: `backend/test/f4_checkout_e_webhook.test.js` (regressão, sem teste novo)

- [ ] **Step 1: Rodar a suíte para fixar o baseline verde**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

Anote o número de testes passando. Esta tarefa não pode mudar esse número.

- [ ] **Step 2: Substituir o SELECT inline pela chamada ao repositório**

Em `backend/src/controllers/PaymentController.js`, adicione o require no topo:

```js
const cotacaoRepository = require("../repositories/cotacaoRepository");
```

E troque o bloco da PRIMEIRA PASSADA (o `pool.query` do `SELECT produto_id AS
product_id, ...`) por:

```js
      const previaPorId = await cotacaoRepository.lerParaCotacao(
        itensOrdenados.map((i) => i.product_id),
      );
```

Apague a linha `const previaPorId = new Map(leituraPrevia.map(...))` que vinha
depois — o repositório já devolve o Map. **Mantenha intactos** o comentário da
"PRIMEIRA PASSADA, SEM TRAVA" e todo o loop que vem a seguir: a razão de a
leitura ser sem `FOR UPDATE` não mudou.

- [ ] **Step 3: Rodar a suíte inteira**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

Esperado: o MESMO número de testes do Step 1, todos passando.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/PaymentController.js
git commit -m "refactor(frete): checkout e cotacao leem pelo mesmo repositorio"
```

---

### Task 5: Registrar a dúvida do CEP de origem

**Files:**
- Modify: `backend/src/.env.example`

- [ ] **Step 1: Deixar o aviso onde ele será lido**

Em `backend/src/.env.example`, substitua o comentário de `ZIPCODE_ORIGIN`:

```
# CEP de origem das encomendas — o CEP de DESPACHO, e ele precisa ser o mesmo
# endereco de origem cadastrado na conta da Melhor Envio. Cotar de um CEP e
# postar de outro devolve preco e prazo errados, sem erro nenhum aparecer.
#
# O valor 01001000 que morou aqui e a Praca da Se, em Sao Paulo: era placeholder.
# Se ele estiver em producao, todo frete ja cotado saiu de Sao Paulo e nao da
# Canastra. Conferir na VPS antes de fechar a Fase 1.
ZIPCODE_ORIGIN=
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/.env.example
git commit -m "docs(frete): o CEP de despacho precisa casar com a conta"
```

---

**Fim da Fase 1.** Critério de pronto: suíte verde com `--test-concurrency=1`, e
`grep -rn "0.3\|20, 5, 20" backend/src/controllers/ShippingController.js` sem
resultado de default de pacote.

---

# FASE 2 — o token que se renova sozinho

Precisa das credenciais de sandbox só para a verificação manual do fim.

---

### Task 6: A migração 0017

**Files:**
- Create: `backend/db/migrations/0017_melhor_envio.sql`
- Test: `backend/test/f8_melhor_envio_token.test.js`

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/f8_melhor_envio_token.test.js`, cabeçalho no molde de
`f4_status_e_frete.test.js`:

```js
"use strict";

/**
 * F8 — o ciclo de vida do token da Melhor Envio.
 *
 * `fetchImpl` é injetável no serviço justamente para este arquivo: o fluxo
 * OAuth inteiro se prova sem rede. O molde é o de `f7_bling.test.js`.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let melhorEnvioClient;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");

  process.env.DATABASE_URL = bd.connectionString;
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";
  process.env.MELHOR_ENVIO_CLIENT_ID = "123";
  process.env.MELHOR_ENVIO_CLIENT_SECRET = "segredo-de-teste";

  melhorEnvioClient = require("../src/services/melhorEnvioClient.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

test("a migração 0017 cria as colunas de token e de etiqueta", async () => {
  const { rows: config } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'config_loja'
        AND column_name LIKE 'melhor_envio%'`,
  );
  assert.deepEqual(
    config.map((r) => r.column_name).sort(),
    ["melhor_envio_refresh_token", "melhor_envio_token_expira_em"],
  );

  const { rows: pedidos } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'pedidos'
        AND column_name LIKE 'me\\_%'`,
  );
  assert.deepEqual(pedidos.map((r) => r.column_name).sort(), [
    "me_claim_em",
    "me_comprada_em",
    "me_order_id",
    "me_protocolo",
    "me_servico_id",
    "me_situacao",
  ]);
});

test("o refresh token da Melhor Envio não é legível por anon nem authenticated", async () => {
  /**
   * CLIENTE DEDICADO, e não `bd.pool.query`: `SET ROLE` vale para a CONEXÃO, e
   * o pool entrega uma conexão qualquer a cada query. Trocar o papel numa e
   * consultar noutra testaria o papel errado — e passaria por acidente, que é
   * o pior resultado possível para um teste de privilégio.
   */
  for (const papel of ["anon", "authenticated"]) {
    const cliente = await bd.pool.connect();
    try {
      await cliente.query(`SET ROLE ${papel}`);
      await assert.rejects(
        () =>
          cliente.query(
            "SELECT melhor_envio_refresh_token FROM canastra.config_loja WHERE id = 1",
          ),
        /permission denied|42501/i,
        `${papel} não pode ler o refresh token`,
      );
    } finally {
      await cliente.query("RESET ROLE").catch(() => {});
      cliente.release();
    }
  }
});

test("duas etiquetas para o mesmo pedido é impossível pelo índice", async () => {
  const primeiro = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await bd.pool.query(
    "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
    [primeiro.rows[0].pedido_id],
  );

  const segundo = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
        [segundo.rows[0].pedido_id],
      ),
    /duplicate key|unique/i,
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f8_melhor_envio_token.test.js --test-concurrency=1
```

Esperado: FAIL — as colunas não existem.

- [ ] **Step 3: Escrever a migração**

`backend/db/migrations/0017_melhor_envio.sql`:

```sql
-- 0017_melhor_envio
--
-- O token que se renova sozinho, e as colunas da etiqueta.
--
-- POR QUE O TOKEN MORA NO BANCO E NAO NO .env: o access_token da Melhor Envio
-- vale 30 dias e o refresh_token, 45. Um token colado no .env para de funcionar
-- um mes depois de configurado — e frete que nao cota e checkout que nao fecha,
-- perda de venda silenciosa, descoberta por reclamacao de cliente. O servico
-- (src/services/melhorEnvioClient.js) renova antes do vencimento e grava aqui;
-- MELHOR_ENVIO_REFRESH_TOKEN no .env vira so a semente da primeira autorizacao.
--
-- E O PONTO DE SEGURANCA DESTA MIGRACAO E QUE ELE JA ESTA RESOLVIDO: a 0012
-- trocou o GRANT de TABELA de `config_loja` por lista EXPLICITA de colunas
-- (porque o refresh token do Bling entrou pela mesma porta). Coluna nova nesta
-- tabela, portanto, NASCE SEM GRANT — nem `anon` nem `authenticated` a leem pelo
-- PostgREST, sem precisar de REVOKE nenhum aqui. Nao acrescente estas duas a
-- nenhum GRANT: o unico que as escreve e o servico Node, que conecta como dono
-- do banco e nao passa por GRANT.
ALTER TABLE canastra.config_loja
  ADD COLUMN melhor_envio_refresh_token   text,
  ADD COLUMN melhor_envio_token_expira_em timestamptz;

-- As colunas da etiqueta, no pedido.
--
-- `me_servico_id` fecha um buraco que so aparece na hora de comprar: o pedido
-- guardava `metodo_envio` (o NOME, "Correios PAC") e a Melhor Envio precisa do
-- id numerico do servico para inserir no carrinho. Sem ele, comprar a etiqueta
-- seria adivinhar o servico a partir de um texto — e adivinhar errado gasta
-- dinheiro de verdade. O checkout passa a grava-lo, e `conferirFrete` passa a
-- confirma-lo junto com nome e preco.
--
-- `me_claim_em` existe separado de `me_situacao` pelo mesmo motivo de
-- `bling_claim_em` (0012): a situacao diz ONDE o trabalho parou, o claim diz
-- QUEM esta trabalhando agora. Claim velho pode ser retomado; situacao nao
-- expira.
ALTER TABLE canastra.pedidos
  ADD COLUMN me_servico_id  integer,
  ADD COLUMN me_order_id    text,
  ADD COLUMN me_protocolo   text,
  ADD COLUMN me_situacao    text,
  ADD COLUMN me_claim_em    timestamptz,
  ADD COLUMN me_comprada_em timestamptz;

-- NAO acrescente as colunas acima ao `GRANT UPDATE (status, codigo_rastreio,
-- metodo_envio, atualizado_em) ON canastra.pedidos TO authenticated` da 0006. O
-- aviso preso aquele GRANT vale igual aqui: a defesa inteira mora na lista de
-- colunas, e um cliente que pudesse escrever `me_situacao` conseguiria fingir
-- que a propria etiqueta ja foi paga.

-- A DEFESA NO BANCO, e nao na boa vontade do codigo: dois cliques simultaneos no
-- botao "Comprar etiqueta" produzem uma etiqueta so. Parcial porque quase todo
-- pedido vive com `me_order_id` nulo — o mesmo formato de `pedidos_bling_id_idx`
-- (0012).
CREATE UNIQUE INDEX pedidos_me_order_id_idx
  ON canastra.pedidos (me_order_id)
  WHERE me_order_id IS NOT NULL;

-- Os pedidos que a tela de expedicao procura: aprovados e ainda sem etiqueta.
CREATE INDEX pedidos_sem_etiqueta_idx
  ON canastra.pedidos (criado_em DESC)
  WHERE me_order_id IS NULL;

INSERT INTO canastra.migracoes (versao) VALUES ('0017_melhor_envio')
  ON CONFLICT DO NOTHING;
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/f8_melhor_envio_token.test.js --test-concurrency=1
```

Esperado: os três testes de migração passam. O `require` do
`melhorEnvioClient.js` ainda falha — normal, é a Task 7.

- [ ] **Step 5: Regenerar `instalacao-completa.sql` — NÃO PULE**

```bash
node backend/db/gerar-instalacao.js
```

`backend/db/instalacao-completa.sql` é o arquivo que se cola no editor SQL do
Supabase para levantar a loja inteira; ele é **gerado** a partir de
`db/migrations/*.sql` e `db/seed.js`. Migração nova sem regenerar significa que o
banco instalado pelo SQL colável fica diferente do instalado pelo runner — e a
divergência não levanta erro, só aparece quando alguém compara os dois.

`backend/test/instalacao.test.js` vigia isso: sobe dois Postgres, aplica o runner
num e o arquivo colável no outro, e compara. Pular este passo faz o teste
`"o arquivo no repositorio esta em dia com o gerador"` falhar.

> **No Windows este teste já falha por CRLF, antes de qualquer mudança.** É
> ruído de plataforma conhecido (falta um `.gitattributes` no projeto), não
> desatualização. Se ele for a ÚNICA falha da suíte, o baseline está bom. Depois
> de regenerar, confirme que a falha continua sendo a mesma e só ela.

- [ ] **Step 6: Commit**

```bash
git add backend/db/migrations/0017_melhor_envio.sql backend/db/instalacao-completa.sql backend/test/f8_melhor_envio_token.test.js
git commit -m "feat(melhor-envio): a migracao do token e das colunas de etiqueta"
```

---

### Task 7: `melhorEnvioClient.js` — o token

**Files:**
- Create: `backend/src/services/melhorEnvioClient.js`
- Test: `backend/test/f8_melhor_envio_token.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao arquivo de teste:

```js
/** Um fetch de mentira que responde o que o teste mandar, e conta as chamadas. */
function fetchFalso(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const fn = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body || "{}") });
    const proxima = fila.shift();
    if (!proxima) throw new Error("fetch chamado mais vezes que o esperado");
    return {
      ok: proxima.status < 400,
      status: proxima.status,
      json: async () => proxima.corpo,
      text: async () => JSON.stringify(proxima.corpo),
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

test("a renovação persiste o refresh token novo no banco", async () => {
  melhorEnvioClient.zerarMemoria();
  await bd.pool.query(
    "UPDATE canastra.config_loja SET melhor_envio_refresh_token = 'semente' WHERE id = 1",
  );

  const fetchImpl = fetchFalso([
    {
      status: 200,
      corpo: {
        token_type: "Bearer",
        expires_in: 2592000,
        access_token: "access-novo",
        refresh_token: "refresh-novo",
      },
    },
  ]);

  await melhorEnvioClient.renovarAccessToken({ fetchImpl });

  const { rows } = await bd.pool.query(
    "SELECT melhor_envio_refresh_token, melhor_envio_token_expira_em FROM canastra.config_loja WHERE id = 1",
  );
  assert.equal(rows[0].melhor_envio_refresh_token, "refresh-novo");
  assert.ok(rows[0].melhor_envio_token_expira_em > new Date());

  // O corpo é JSON e leva grant_type refresh_token — não é o Basic do Bling.
  assert.equal(fetchImpl.chamadas[0].corpo.grant_type, "refresh_token");
  assert.equal(fetchImpl.chamadas[0].corpo.refresh_token, "semente");
});

test("a ordem de leitura é memória → banco → env", async () => {
  melhorEnvioClient.zerarMemoria();
  await bd.pool.query(
    "UPDATE canastra.config_loja SET melhor_envio_refresh_token = NULL WHERE id = 1",
  );
  process.env.MELHOR_ENVIO_REFRESH_TOKEN = "da-env";

  assert.equal(await melhorEnvioClient.carregarRefreshToken(), "da-env");

  await bd.pool.query(
    "UPDATE canastra.config_loja SET melhor_envio_refresh_token = 'do-banco' WHERE id = 1",
  );
  assert.equal(await melhorEnvioClient.carregarRefreshToken(), "do-banco");
});

test("invalid_grant esquece o token da memória para a próxima tentativa reler o banco", async () => {
  melhorEnvioClient.zerarMemoria();
  await bd.pool.query(
    "UPDATE canastra.config_loja SET melhor_envio_refresh_token = 'queimado' WHERE id = 1",
  );

  const fetchImpl = fetchFalso([
    { status: 401, corpo: { error: "invalid_grant" } },
  ]);

  await assert.rejects(
    () => melhorEnvioClient.renovarAccessToken({ fetchImpl }),
    /invalid_grant|recusou/i,
  );
  assert.equal(melhorEnvioClient.tokenEmMemoria(), null);
});

test("o User-Agent obrigatório vai em toda requisição", async () => {
  melhorEnvioClient.zerarMemoria();
  process.env.LOJA_NOME = "Cafe Canastra";
  process.env.LOJA_EMAIL = "canastrainteligencia@gmail.com";

  const fetchImpl = fetchFalso([
    {
      status: 200,
      corpo: { access_token: "a", refresh_token: "r", expires_in: 2592000 },
    },
  ]);
  await melhorEnvioClient.renovarAccessToken({ fetchImpl });

  const ua = fetchImpl.chamadas[0].opcoes.headers["User-Agent"];
  assert.match(ua, /Cafe Canastra/);
  assert.match(ua, /canastrainteligencia@gmail\.com/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f8_melhor_envio_token.test.js --test-concurrency=1
```

Esperado: FAIL com `Cannot find module '../src/services/melhorEnvioClient.js'`.

- [ ] **Step 3: Implementar**

`backend/src/services/melhorEnvioClient.js`. O molde é `blingClient.js` — leia-o
antes de escrever. As **três diferenças** em relação ao Bling, e são todas
obrigatórias:

1. O corpo do `/oauth/token` é **JSON**, não `x-www-form-urlencoded`, e as
   credenciais vão **no corpo** (`client_id`, `client_secret`), não num header
   `Basic`.
2. O `User-Agent` é **obrigatório** e a API recusa sem ele.
3. O refresh token **não é rotativo por desenho** como o do Bling, mas a resposta
   pode trazer um novo — persista sempre que vier e for diferente.

```js
"use strict";

/**
 * Cliente da API da Melhor Envio (OAuth 2.0).
 *
 * O QUE ESTE MÓDULO SABE FAZER, e só isso: manter um access token válido e
 * assinar requisições com ele. Não sabe o que é pedido, etiqueta ou frete —
 * quem sabe é `melhorEnvioEtiquetas.js`. A fronteira existe porque as duas
 * coisas falham por motivos diferentes: token falha por autorização vencida,
 * etiqueta falha por saldo, endereço ou serviço.
 *
 * ONDE O TOKEN MORA: memória → banco → env, nesta ordem. O access token vale 30
 * dias e o refresh, 45. `MELHOR_ENVIO_REFRESH_TOKEN` no .env é só a SEMENTE da
 * primeira autorização; a partir da primeira renovação quem manda é
 * `canastra.config_loja.melhor_envio_refresh_token` (migração 0017, coluna
 * protegida por privilégio de coluna).
 *
 * INSTÂNCIA ÚNICA, pelo mesmo motivo do Bling: duas instâncias renovando em
 * paralelo podem invalidar o token uma da outra. `deploy/ecosystem.config.cjs`
 * fixa `instances: 1`.
 */

const pool = require("../pgPool");

const TIMEOUT_MS = 15000;
/** Margem antes do vencimento real: evita perder uma chamada por segundos. */
const MARGEM_DE_EXPIRACAO_MS = 60 * 60 * 1000; // 1 hora

const memoria = { accessToken: null, refreshToken: null, expiraEm: 0, voo: null };

function base() {
  return (process.env.MELHOR_ENVIO_URL || "https://melhorenvio.com.br").replace(/\/+$/, "");
}

/**
 * O User-Agent que a API EXIGE — nome da aplicação e e-mail de contato. Sem
 * ele a Melhor Envio recusa a requisição, e o erro não explica o motivo.
 */
function userAgent() {
  const nome = process.env.LOJA_NOME || "Cafe Canastra";
  const email = process.env.LOJA_EMAIL || "contato@cafecanastra.com";
  return `${nome} (${email})`;
}

function configurado() {
  return Boolean(
    process.env.MELHOR_ENVIO_CLIENT_ID && process.env.MELHOR_ENVIO_CLIENT_SECRET,
  );
}

/** Só para os testes: recomeçar de um estado conhecido. */
function zerarMemoria() {
  memoria.accessToken = null;
  memoria.refreshToken = null;
  memoria.expiraEm = 0;
  memoria.voo = null;
}

function tokenEmMemoria() {
  return memoria.refreshToken;
}

async function carregarRefreshToken() {
  if (memoria.refreshToken) return memoria.refreshToken;
  try {
    const { rows } = await pool.query(
      "SELECT melhor_envio_refresh_token FROM canastra.config_loja WHERE id = 1",
    );
    if (rows[0]?.melhor_envio_refresh_token) {
      return rows[0].melhor_envio_refresh_token;
    }
  } catch (erro) {
    console.warn(
      "Melhor Envio: não consegui ler o refresh token do banco; tentando a env.",
      erro.message,
    );
  }
  return process.env.MELHOR_ENVIO_REFRESH_TOKEN || null;
}

/**
 * Persiste o token novo e o vencimento. Falhar aqui NÃO falha a renovação — o
 * access token já está na mão — mas o log grita a consequência: um restart
 * antes da próxima gravação bem-sucedida perde a autorização.
 */
async function persistirToken(refreshToken, expiraEm) {
  try {
    await pool.query(
      "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await pool.query(
      `UPDATE canastra.config_loja
          SET melhor_envio_refresh_token = $1,
              melhor_envio_token_expira_em = $2,
              atualizado_em = now()
        WHERE id = 1`,
      [refreshToken, expiraEm],
    );
    return true;
  } catch (erro) {
    console.error(
      "⚠️  MELHOR ENVIO: o refresh token NOVO não pôde ser gravado no banco " +
        `(${erro.message}). O processo segue com o token em memória, mas um ` +
        "RESTART antes da próxima gravação perde a autorização — seria preciso " +
        "reautorizar (docs/melhor-envio.md).",
    );
    return false;
  }
}

async function fetchComTimeout(fetchImpl, url, opcoes, rotulo) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...opcoes, signal: controlador.signal });
  } catch (erro) {
    if (erro?.name === "AbortError") {
      const estouro = new Error(
        `A Melhor Envio não respondeu em ${TIMEOUT_MS / 1000}s (${rotulo}).`,
      );
      estouro.status = 504;
      estouro.codigoPublico = "MELHOR_ENVIO_SEM_RESPOSTA";
      throw estouro;
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

async function renovarAccessToken({ fetchImpl = fetch } = {}) {
  if (!configurado()) {
    throw new Error(
      "Melhor Envio não configurada: defina MELHOR_ENVIO_CLIENT_ID e " +
        "MELHOR_ENVIO_CLIENT_SECRET (docs/melhor-envio.md).",
    );
  }

  const refreshToken = await carregarRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "Nenhum refresh token da Melhor Envio: cole o primeiro em " +
        "MELHOR_ENVIO_REFRESH_TOKEN (docs/melhor-envio.md).",
    );
  }

  const resposta = await fetchComTimeout(
    fetchImpl,
    `${base()}/oauth/token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: Number(process.env.MELHOR_ENVIO_CLIENT_ID),
        client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
    },
    "POST /oauth/token",
  );

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    // Token recusado não vale mais nunca: esquecer a memória faz a PRÓXIMA
    // tentativa recomeçar a ordem de leitura pelo banco, onde pode haver um
    // token bom colado à mão pelo runbook.
    if (/invalid_grant/i.test(corpo)) zerarMemoria();
    throw new Error(
      `A Melhor Envio recusou a renovação (HTTP ${resposta.status}): ` +
        `${corpo.slice(0, 300) || "sem corpo"}. Se for invalid_grant, o ` +
        "refresh token venceu — reautorize (docs/melhor-envio.md).",
    );
  }

  const dados = await resposta.json();
  if (!dados?.access_token) {
    throw new Error("A Melhor Envio respondeu a renovação sem access_token.");
  }

  const validadeMs = Math.max(0, Number(dados.expires_in || 0) * 1000);
  memoria.accessToken = dados.access_token;
  memoria.expiraEm = Date.now() + Math.max(0, validadeMs - MARGEM_DE_EXPIRACAO_MS);

  const novoRefresh = dados.refresh_token || refreshToken;
  memoria.refreshToken = novoRefresh;
  await persistirToken(novoRefresh, new Date(Date.now() + validadeMs));

  return memoria.accessToken;
}

/**
 * O access token válido. UM VOO POR VEZ: duas renovações simultâneas gastariam
 * duas autorizações e a segunda poderia invalidar a primeira.
 */
async function accessToken({ fetchImpl = fetch } = {}) {
  if (memoria.accessToken && Date.now() < memoria.expiraEm) {
    return memoria.accessToken;
  }
  if (!memoria.voo) {
    memoria.voo = renovarAccessToken({ fetchImpl }).finally(() => {
      memoria.voo = null;
    });
  }
  return memoria.voo;
}

/** Uma requisição autenticada à API v2. `caminho` começa com `/`. */
async function requisitar(metodo, caminho, { body, fetchImpl = fetch } = {}) {
  const token = await accessToken({ fetchImpl });
  const resposta = await fetchComTimeout(
    fetchImpl,
    `${base()}/api/v2${caminho}`,
    {
      method: metodo,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    `${metodo} ${caminho}`,
  );

  const texto = await resposta.text().catch(() => "");
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const erro = new Error(
      `Melhor Envio ${metodo} ${caminho} respondeu HTTP ${resposta.status}: ` +
        `${texto.slice(0, 300) || "sem corpo"}`,
    );
    erro.status = resposta.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

module.exports = {
  accessToken,
  carregarRefreshToken,
  configurado,
  renovarAccessToken,
  requisitar,
  tokenEmMemoria,
  userAgent,
  zerarMemoria,
};
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/f8_melhor_envio_token.test.js --test-concurrency=1
```

Esperado: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/melhorEnvioClient.js backend/test/f8_melhor_envio_token.test.js
git commit -m "feat(melhor-envio): o token que se renova sozinho"
```

---

### Task 8: As variáveis de ambiente e o runbook

**Files:**
- Modify: `backend/src/.env.example`
- Create: `docs/melhor-envio.md`
- Modify: `docs/deploy.md`, `docs/go-live.md`

- [ ] **Step 1: Trocar o bloco da Melhor Envio no `.env.example`**

Substitua as três linhas de hoje (`MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_URL`,
`ZIPCODE_ORIGIN`) por:

```
# ── Melhor Envio (cotacao de frete, etiqueta e rastreio) ────────────────────
# Runbook completo, com o passo a passo das credenciais: docs/melhor-envio.md
#
# MELHOR_ENVIO_TOKEN SAIU. Era um access_token estatico colado a mao, e e
# exatamente o que vence em 30 dias sem ninguem perceber — frete que para de
# cotar e checkout que para de fechar, sem erro visivel. Quem responde por ele
# agora e o par CLIENT_ID/CLIENT_SECRET mais o refresh token no banco
# (config_loja.melhor_envio_refresh_token, migracao 0017).
MELHOR_ENVIO_URL=https://sandbox.melhorenvio.com.br
MELHOR_ENVIO_CLIENT_ID=
# ATENCAO: este segredo serve para DUAS coisas — renovar o token E validar o
# HMAC do webhook. Vaza-lo custa as duas de uma vez. Nunca em log.
MELHOR_ENVIO_CLIENT_SECRET=
# So a SEMENTE da primeira autorizacao. Depois da primeira renovacao quem manda
# e o banco.
MELHOR_ENVIO_REFRESH_TOKEN=
MELHOR_ENVIO_ATIVO=false
```

- [ ] **Step 2: Escrever `docs/melhor-envio.md`**

O runbook, no molde de `docs/bling.md`. Deve conter, na ordem:

1. **O que a integração faz e o que não faz** — cota, compra etiqueta, imprime,
   rastreia. Não emite NF-e (isso é o Bling), não faz logística reversa.
2. **Pré-requisitos da conta** — cadastro completo, endereço de origem
   cadastrado (é o `ZIPCODE_ORIGIN`), saldo na carteira.
3. **Sandbox e produção são contas separadas.** Tabela de URLs:

   | | Sandbox | Produção |
   |---|---|---|
   | Cadastro | `https://sandbox.melhorenvio.com.br/` | conta real da loja |
   | Área dev | `https://app-sandbox.melhorenvio.com.br/integracoes/area-dev` | `https://app.melhorenvio.com.br/integracoes/area-dev` |
   | `MELHOR_ENVIO_URL` | `https://sandbox.melhorenvio.com.br` | `https://melhorenvio.com.br` |
   | `redirect_uri` | `https://loja.canastrainteligencia.com/api/melhor-envio/callback-sandbox` | `https://loja.canastrainteligencia.com/api/melhor-envio/callback` |
   | Webhook | `https://loja.canastrainteligencia.com/api/webhook/melhor-envio` | idem |

4. **Os dez escopos**, com o que cada um libera: `shipping-calculate`,
   `cart-read`, `cart-write`, `shipping-checkout`, `shipping-generate`,
   `shipping-print`, `shipping-tracking`, `shipping-cancel`, `orders-read`,
   `users-read`.
5. **A autorização única**, com as duas URLs de `authorize` prontas e o `curl`
   do `POST /oauth/token` (corpo JSON, `grant_type: authorization_code`).
   Registrar que o navegador cai num 404 do backend e que **isso é o esperado** —
   o que importa é o `?code=` na barra de endereços, e ele expira em segundos.
6. **Por que o token não pode ficar no `.env`** e o que fazer quando a
   autorização morre (reautorizar, colar em `MELHOR_ENVIO_REFRESH_TOKEN`,
   reiniciar).
7. **Instância única**, e por quê (duas renovando em paralelo se invalidam).
8. **Tabela de erros comuns:** saldo insuficiente, `invalid_grant`, CEP de origem
   diferente do cadastrado, `User-Agent` ausente.

- [ ] **Step 3: Atualizar as tabelas de ambiente**

Em `docs/deploy.md:71` e `docs/go-live.md:58`, trocar `MELHOR_ENVIO_TOKEN` pelas
variáveis novas, apontando para `docs/melhor-envio.md`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/.env.example docs/melhor-envio.md docs/deploy.md docs/go-live.md
git commit -m "docs(melhor-envio): o runbook das credenciais e da virada"
```

---

**Fim da Fase 2.** Verificação manual com o sandbox: preencher
`MELHOR_ENVIO_CLIENT_ID`, `CLIENT_SECRET` e a semente do `REFRESH_TOKEN`, subir o
backend e confirmar no log que a renovação acontece e o banco recebe o token.

---

# FASE 3 — comprar e imprimir a etiqueta

---

### Task 9: `me_servico_id` gravado e conferido

**Files:**
- Modify: `backend/src/controllers/PaymentController.js` (`conferirFrete` e o INSERT do pedido)
- Modify: `frontend/lib/sacola/checkout.ts` (enviar o id da opção escolhida)
- Test: `backend/test/f4_checkout_e_webhook.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("conferirFrete recusa quando o id do serviço não bate com a recotação", async () => {
  await assert.rejects(
    () =>
      conferirFrete({
        address: { zip_code: CEP_LOCAL },
        itens: ITENS_COM_PACOTE, // fixture com peso e dimensões
        shippingCost: 0,
        shippingMethod: "Entrega Local",
        shippingServiceId: 999, // não existe na recotação
      }),
    /frete mudou|serviço/i,
  );
});

test("conferirFrete aceita e devolve o id do serviço para o pedido guardar", async () => {
  const conferido = await conferirFrete({
    address: { zip_code: CEP_LOCAL },
    itens: ITENS_COM_PACOTE,
    shippingCost: 5,
    shippingMethod: "Entrega Local",
    shippingServiceId: 1,
  });
  assert.equal(conferido.servicoId, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f4_checkout_e_webhook.test.js --test-concurrency=1
```

- [ ] **Step 3: Implementar**

Em `conferirFrete`, aceitar `shippingServiceId` e casar os três campos:

```js
  /**
   * O ID DO SERVIÇO ENTRA NA CONFERÊNCIA, e não é zelo excessivo: é ele que a
   * compra da etiqueta vai usar para dizer à Melhor Envio qual frete comprar.
   * Nome e preço conferidos com um id errado deixariam a loja comprando uma
   * etiqueta de outro serviço — com dinheiro real, e sem nada na tela sugerindo
   * que algo saiu diferente.
   *
   * Nulo é TOLERADO (pedido de antes da 0017, ou entrega local, que não tem id
   * na Melhor Envio): quem tolera é a compra da etiqueta, que nesse caso pede
   * ao admin para confirmar o serviço em vez de adivinhar.
   */
  const escolhida = opcoes.find(
    (o) =>
      o.name === shippingMethod &&
      Math.abs(Number(o.price) - valor) <= 0.01 &&
      (shippingServiceId == null || Number(o.id) === Number(shippingServiceId)),
  );
```

E no INSERT do pedido, gravar `me_servico_id` a partir do retorno de
`conferirFrete`.

No frontend, `frontend/lib/sacola/checkout.ts`, incluir o id da opção escolhida
no corpo de `/checkout/process_payment` como `shippingServiceId`.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
cd ../frontend && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/PaymentController.js frontend/lib/sacola/checkout.ts backend/test/
git commit -m "feat(melhor-envio): o pedido guarda qual servico o cliente escolheu"
```

---

### Task 10: `melhorEnvioEtiquetas.js` — os quatro passos

**Files:**
- Create: `backend/src/services/melhorEnvioEtiquetas.js`
- Test: `backend/test/f8_melhor_envio_etiqueta.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Os casos, todos com `fetchImpl` injetado (nenhum toca a rede):

```js
test("o caminho feliz percorre carrinho → checkout → generate → print", ...)
test("o segundo clique NÃO compra de novo: retoma de 'released' e só gera", ...)
test("dois cliques simultâneos produzem UMA etiqueta (o claim decide)", ...)
test("saldo insuficiente vira mensagem literal, não erro genérico", ...)
test("pedido cancelado não recebe etiqueta", ...)
test("gerar etiqueta grava codigo_rastreio mas NÃO avança o pedido para enviado", ...)
```

O quinto e o sexto são os que valem mais: o quinto porque etiqueta de venda
cancelada é dinheiro jogado fora, o sexto porque é a decisão de desenho da fase.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f8_melhor_envio_etiqueta.test.js --test-concurrency=1
```

- [ ] **Step 3: Implementar**

`backend/src/services/melhorEnvioEtiquetas.js`. A espinha:

```js
/**
 * RETOMÁVEL PASSO A PASSO, E É POR ISSO QUE `me_situacao` é gravada ANTES de
 * cada passo seguinte.
 *
 * Cada um destes quatro passos gasta ou compromete dinheiro real. Uma queda de
 * conexão entre o checkout (passo 2, que DEBITA a carteira) e o generate (passo
 * 3) deixaria a loja com uma etiqueta paga e nenhum registro dela. O próximo
 * clique lê `me_situacao = 'released'` e continua do passo 3 — não compra de
 * novo.
 *
 * O CLAIM é a outra metade: `UPDATE ... WHERE me_situacao IS NULL AND
 * me_claim_em IS NULL` decide o vencedor NO BANCO. Dois cliques simultâneos
 * produzem uma etiqueta e um "já está sendo processado", e não duas compras.
 */
const PASSOS = ["cart", "checkout", "generate"];
```

Regras que os testes acima fixam:

- `pedido.status` em `GRUPO_CANCELADO` → erro 409, nada é chamado.
- Erro da API contendo `saldo` ou `balance` → mensagem
  `"Saldo insuficiente na carteira Melhor Envio (faltam R$ X)."` com `status`
  402.
- Depois de `generate`, gravar `codigo_rastreio`, `me_order_id`, `me_protocolo`,
  `me_situacao = 'generated'`, `me_comprada_em = now()` e **`atualizado_em =
  now()`** — a tabela não tem trigger.
- **Não** mexer em `pedidos.status`.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/f8_melhor_envio_etiqueta.test.js --test-concurrency=1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/melhorEnvioEtiquetas.js backend/test/f8_melhor_envio_etiqueta.test.js
git commit -m "feat(melhor-envio): comprar etiqueta em quatro passos retomaveis"
```

---

### Task 11: As rotas de admin

**Files:**
- Create: `backend/src/controllers/MelhorEnvioController.js`, `backend/src/routes/melhorEnvio.routes.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("as rotas da etiqueta exigem admin", ...)      // 401/403 sem admin
test("POST /melhor-envio/pedidos/:id/etiqueta compra e devolve o rastreio", ...)
test("GET /melhor-envio/pedidos/:id/etiqueta.pdf devolve o PDF em streaming", ...)
test("GET /melhor-envio/status devolve validade do token e saldo", ...)
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f8_melhor_envio_etiqueta.test.js --test-concurrency=1
```

- [ ] **Step 3: Implementar**

Rotas, no molde de `bling.routes.js`:

| Rota | O quê |
|---|---|
| `POST /melhor-envio/pedidos/:id/etiqueta` | compra (idempotente, retomável) |
| `GET /melhor-envio/pedidos/:id/etiqueta.pdf` | o PDF, em streaming |
| `GET /melhor-envio/status` | token, saldo, pedidos sem etiqueta |
| `POST /melhor-envio/pedidos/:id/etiqueta/cancelar` | cancela a etiqueta |

O PDF: **buscar e repassar em streaming, sem gravar em disco, e a URL nunca em
log.** Ele tem nome, endereço e telefone do cliente — é dado pessoal sob
`docs/seguranca-dados-pessoais.md`.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/MelhorEnvioController.js backend/src/routes/melhorEnvio.routes.js backend/src/index.js backend/test/
git commit -m "feat(melhor-envio): as rotas de admin da etiqueta"
```

---

### Task 12: O painel

**Files:**
- Create: `frontend/legacy/components/DashboardSection/MelhorEnvio/{MelhorEnvioManager.jsx,useMelhorEnvioAcoes.js,melhorEnvioContrato.js}`
- Modify: `frontend/legacy/components/DashboardSection/Orders/Orders.jsx`, `.../MenuAside/MenuAside.jsx`

- [ ] **Step 1: Escrever o teste do contrato**

`melhorEnvioContrato.test.ts`, no molde de `blingContrato.test.ts`: normalização
das respostas, incluindo resposta malformada e campo ausente.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd frontend && npx vitest run legacy/components/DashboardSection/MelhorEnvio
```

- [ ] **Step 3: Implementar**

Leia `BlingManager.jsx` e `useBlingAcoes.js` antes. O botão trava durante a
requisição, como os três do Bling. Na tela de status: **validade do token**,
**saldo da carteira** e **pedidos aprovados sem etiqueta** — é o alarme do risco
4 do spec, e sem ele o modo de falha é descoberto por um cliente sem frete.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/legacy/
git commit -m "feat(melhor-envio): o painel da etiqueta e o alarme do token"
```

---

# FASE 4 — rastreio automático

---

### Task 13: O spike do PUT do Bling

**Bloqueia a Task 15.** Não escreva a Task 15 antes de ter a resposta.

- [ ] **Step 1: Descobrir se o `PUT` aceita o rastreio**

Com um pedido de venda real de teste no Bling, tentar:

```
PUT /pedidos/vendas/{id}
{ "transporte": { "volumes": [ { "codigoRastreamento": "AA123456789BR" } ] } }
```

- [ ] **Step 2: Registrar a resposta em `docs/melhor-envio.md`**

Aceita → Task 15 como planejada. Recusa → **Plano B**: gravar o rastreio nas
`observacoes` do pedido de venda e alertar. Falha por outro motivo → **Plano C**:
o campo continua manual no Bling, e a Task 15 vira só o alerta.

- [ ] **Step 3: Commit**

```bash
git add docs/melhor-envio.md
git commit -m "docs(melhor-envio): o que o PUT do Bling aceita, medido"
```

---

### Task 14: O webhook

**Files:**
- Modify: `backend/src/index.js`
- Create: handler em `backend/src/controllers/MelhorEnvioController.js`
- Test: `backend/test/f8_melhor_envio_webhook.test.js`

- [ ] **Step 1: Escrever os testes que falham**

```js
test("assinatura X-ME-Signature inválida responde 401 sem tocar no pedido", ...)
test("assinatura válida com order.posted avança para enviado e manda o e-mail", ...)
test("a MESMA entrega repetida não redispara o e-mail", ...)      // reenvio 5x
test("order_id desconhecido responde 200 e não é erro", ...)
test("order.undelivered NÃO muda o status do cliente, só alerta", ...)
test("order.delivered avança para entregue", ...)
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f8_melhor_envio_webhook.test.js --test-concurrency=1
```

- [ ] **Step 3: Implementar**

O HMAC precisa do **corpo cru** — o `express.json({ verify })` do webhook do
Mercado Pago já resolve isso neste projeto; reuse o mesmo caminho, não invente
outro.

```js
/**
 * A comparação é TIMING-SAFE de propósito. Comparar hash com `===` vaza, pelo
 * tempo de resposta, quantos bytes iniciais bateram — e com um webhook público
 * e reenvio automático, um atacante tem tentativas de sobra para medir.
 */
const bate = crypto.timingSafeEqual(
  Buffer.from(assinaturaRecebida, "hex"),
  Buffer.from(assinaturaCalculada, "hex"),
);
```

Tabela de eventos, exatamente como o spec fixou:

| Evento | Efeito |
|---|---|
| `order.posted` | `enviado` + e-mail com o rastreio |
| `order.delivered` | `entregue` |
| `order.cancelled` | marca cancelada, alerta |
| `order.undelivered`, `order.paused`, `order.suspended` | **só alerta** |
| demais | registra e ignora |

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/ backend/test/f8_melhor_envio_webhook.test.js
git commit -m "feat(melhor-envio): o webhook assinado que move o pedido"
```

---

### Task 15: O rastreio volta para o Bling

Só depois da Task 13.

**Files:**
- Modify: `backend/src/services/blingPedidos.js`
- Test: `backend/test/f7_bling.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test("a etiqueta gerada escreve o rastreio no pedido de venda do Bling", ...)
test("falhar no Bling NÃO derruba a compra da etiqueta — vira alerta", ...)
```

O segundo é o que importa: o rastreio já está na loja e o cliente já será
avisado. Bling fora do ar não pode travar a expedição.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && node --test test/f7_bling.test.js --test-concurrency=1
```

- [ ] **Step 3: Implementar**

Conforme o resultado da Task 13. Em qualquer um dos três planos, o `catch`
registra e alerta — nunca propaga.

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && node --test test/*.test.js --test-concurrency=1
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/blingPedidos.js backend/test/f7_bling.test.js
git commit -m "feat(melhor-envio): o rastreio volta para o pedido do Bling"
```

---

# FASE 5 — virada para produção

**Não é tarefa de código.** É runbook, e mora em `docs/melhor-envio.md`. Exige
acesso à VPS.

- [ ] Cadastrar o aplicativo de produção e marcar os dez escopos
- [ ] `MELHOR_ENVIO_URL=https://melhorenvio.com.br`
- [ ] `ZIPCODE_ORIGIN` = o CEP de despacho real, igual ao cadastrado na conta
- [ ] Autorizar uma vez e colar a semente em `MELHOR_ENVIO_REFRESH_TOKEN`
- [ ] Cadastrar o webhook `https://loja.canastrainteligencia.com/api/webhook/melhor-envio`
- [ ] Confirmar saldo na carteira
- [ ] `MELHOR_ENVIO_ATIVO=true`
- [ ] Comprar **uma** etiqueta de teste e conferir o ciclo inteiro até o e-mail
- [ ] Confirmar `instances: 1` em `deploy/ecosystem.config.cjs`

---

## Critério de pronto

- [ ] `cd backend && node --test test/*.test.js --test-concurrency=1` verde
- [ ] `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint` verde
- [ ] `grep -rn "MELHOR_ENVIO_TOKEN" backend/ docs/` sem resultado
- [ ] Nenhum default de pacote em `ShippingController.js`
- [ ] `docs/melhor-envio.md` responde: como obter credencial, como reautorizar, o que fazer quando o saldo acaba
