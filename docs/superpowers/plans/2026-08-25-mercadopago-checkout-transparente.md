# Checkout Transparente — fechar para produção · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preencher os cinco campos que a loja deixa de mandar ao Mercado Pago e que só doem em produção — idempotência de gateway, conciliação, descritor de fatura, antifraude e Device ID.

**Architecture:** Quatro das cinco mudanças são no mesmo lugar: o objeto `paymentData` e a chamada `payment.create()` em `backend/src/controllers/PaymentController.js`. A quinta atravessa a vitrine (carregar `security.js`, mandar o `deviceId` no corpo) e termina no mesmo ponto. Nenhuma muda o fluxo de checkout, a ordem cobrar-antes-de-gravar ou a máquina de estados — só o que sai na requisição.

**Tech Stack:** Node/Express, SDK `mercadopago` (já instalado), `node --test` com Postgres embarcado, Next 15 no frontend.

---

## Antes de começar — leia isto

**A suíte só passa em serial.** Rode sempre a partir de `backend/`:

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Em paralelo caem 70–114 testes por contenção do Postgres embarcado — não é o seu código.

**A linha de base tem uma falha conhecida.** `backend/test/instalacao.test.js`, teste 289 (`o arquivo no repositorio esta em dia com o gerador`), falha por CRLF no Windows: o `actual` vem com `\r\n` e o `expected` com `\n`. **Não tente consertar** e não conte como regressão. A base é 417 passando / 1 falha / 1 pulado, em 419.

**Não mexa na CSP.** `frontend/next.config.mjs:92` já libera `https://www.mercadopago.com` em `script-src`, que é a origem do `security.js` da Task 5.

---

## File Structure

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `backend/src/controllers/PaymentController.js` | Monta `paymentData` e chama o gateway | 1, 2, 3, 4, 6 |
| `backend/test/f4_checkout_e_webhook.test.js` | Dublê do MP + testes do checkout de ponta a ponta | 1, 2, 3, 4, 6 |
| `frontend/lib/sacola/cartao.ts` | Carregamento de script do Mercado Pago no navegador | 5 |
| `frontend/lib/sacola/cartao.test.ts` | Testes do módulo de cartão | 5 |
| `frontend/lib/sacola/checkout.ts` | Monta o corpo do `process_payment` | 5 |
| `frontend/lib/sacola/checkout.test.ts` | Testes do corpo enviado | 5 |

Nenhum arquivo novo. Nenhuma migração de banco.

---

### Task 1: Idempotência que o Mercado Pago enxerga

Hoje o gateway não vê a chave da loja. Quando as duas requisições de um duplo clique passam pela conferência inicial antes de qualquer uma gravar, o índice único barra a segunda **depois de ela já ter cobrado** — e `PaymentController.js:876` só sabe pedir estorno manual.

**Files:**
- Modify: `backend/test/f4_checkout_e_webhook.test.js:29-33` (objeto `mp`) e `:127-137` (dublê do `create`)
- Modify: `backend/src/controllers/PaymentController.js:824`

- [ ] **Step 1: Fazer o dublê gravar o `requestOptions`**

O dublê hoje destrutura só `body`, então `requestOptions` é descartado e nenhuma asserção o alcança. **Não mude o que `mp.criacoes` guarda** — oito asserções em `f4_checkout_e_webhook.test.js` e `f6_cupons.test.js` leem `mp.criacoes[n].transaction_amount`, e trocar a forma quebraria todas. Adicione um array irmão.

Em `backend/test/f4_checkout_e_webhook.test.js`, no objeto `mp` (linha ~29):

```js
/** O que o dublê do MP responde; cada teste ajusta. */
const mp = {
  statusDoGet: "approved",
  falhaNoGet: false,
  falhaNoCreate: false,
  criacoes: [],
  /**
   * O SEGUNDO argumento de `payment.create`, um por criação e no mesmo índice
   * de `mp.criacoes`. Array separado de propósito: `mp.criacoes` guarda o
   * `body` e é lido por asserções em dois arquivos de teste — mudar a forma
   * dele para `{ body, requestOptions }` quebraria todas elas de uma vez.
   */
  opcoes: [],
};
```

E no dublê do `create` (linha ~127):

```js
          create: async ({ body, requestOptions }) => {
            if (mp.falhaNoCreate) throw new Error("gateway caiu");
            mp.criacoes.push(body);
            mp.opcoes.push(requestOptions || null);
            return {
              id: 900000 + mp.criacoes.length,
              status: "pending",
              point_of_interaction: {
                transaction_data: { ticket_url: "https://mp.local/pix" },
              },
            };
          },
```

- [ ] **Step 2: Escrever o teste que falha**

No fim de `backend/test/f4_checkout_e_webhook.test.js`, adicione:

```js
test("checkout: a cobrança leva a chave de idempotência ao Mercado Pago", async () => {
  /**
   * Sem isto, o duplo clique que vence a corrida cobra DUAS vezes no gateway
   * e a loja só descobre pelo log de "PAGAMENTO DUPLICADO", que pede estorno
   * manual. Com a chave, o MP devolve o MESMO pagamento na segunda chamada.
   */
  const antes = mp.criacoes.length;
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-idem-mp" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(mp.criacoes.length, antes + 1);
  assert.equal(
    mp.opcoes[mp.opcoes.length - 1]?.idempotencyKey,
    `${ANA}:clique-idem-mp`,
    "a chave tem que ser a MESMA que a linha do pedido grava",
  );
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: FALHA em `a chave tem que ser a MESMA que a linha do pedido grava`, com `undefined` no lugar de `aaaaaaaa-0000-0000-0000-000000000001:clique-idem-mp`.

- [ ] **Step 4: Implementar**

Em `backend/src/controllers/PaymentController.js`, linha 824, troque:

```js
        mpResponse = await payment.create({ body: paymentData });
```

por:

```js
        /**
         * A CHAVE VAI JUNTO, e é a mesma que o pedido grava.
         *
         * A loja já se defendia sozinha (índice único em `chave_idempotencia`),
         * mas a defesa era TARDIA: no duplo clique que vence a corrida, a
         * segunda requisição só é barrada DEPOIS de ter cobrado. Com a chave
         * no gateway, o Mercado Pago devolve o mesmo pagamento em vez de criar
         * outro — a cobrança dupla deixa de acontecer, em vez de ser
         * compensada.
         *
         * Funciona porque a chave é estável entre tentativas: o navegador
         * manda `Idempotency-Key` (lib/sacola/checkout.ts) e reusa o valor no
         * retry do mesmo pedido. Quando o cabeçalho não vem, cada requisição
         * gera um uuid próprio e o gateway não tem como deduplicar — mas
         * nesse caso a corrida de duplo clique também não existe, porque não
         * há dois cliques com a mesma identidade.
         *
         * O log de PAGAMENTO DUPLICADO mais abaixo FICA: defesa de servidor
         * não se aposenta porque apareceu uma defesa de gateway.
         */
        mpResponse = await payment.create({
          body: paymentData,
          requestOptions: { idempotencyKey: chaveIdempotencia },
        });
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_checkout_e_webhook.test.js
git commit -m "fix(pagamento): a chave de idempotencia agora vai para o Mercado Pago"
```

---

### Task 2: `external_reference` — o fio entre o painel e o pedido

O Clube já manda (`ClubeController.js:307`); a venda avulsa não. No painel do MP existe só o `payment_id`, e achar o pedido correspondente é garimpo.

**A restrição:** o pedido nasce **depois** do pagamento, então o id do pedido não existe na hora de montar o `paymentData`. Use `chaveIdempotencia`, que já existe, já é único e é exatamente o que a linha grava em `chave_idempotencia`.

**Files:**
- Modify: `backend/src/controllers/PaymentController.js:793-809` (objeto `paymentData`)
- Modify: `backend/test/f4_checkout_e_webhook.test.js` (teste novo no fim)

- [ ] **Step 1: Escrever o teste que falha**

```js
test("checkout: external_reference liga o pagamento à linha do pedido", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-ref" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.external_reference, `${ANA}:clique-ref`);

  // O que torna a conciliação possível: o campo do painel do MP e a coluna do
  // pedido guardam o MESMO valor.
  const { rows } = await bd.pool.query(
    "SELECT chave_idempotencia FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );
  assert.equal(rows[0].chave_idempotencia, cobranca.external_reference);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: FALHA com `undefined !== 'aaaaaaaa-...:clique-ref'`.

- [ ] **Step 3: Implementar**

Em `backend/src/controllers/PaymentController.js`, dentro de `const paymentData = {`, logo depois da linha `notification_url: webhookUrl,`:

```js
        /**
         * O FIO DA CONCILIAÇÃO. Sem ele, o painel do Mercado Pago mostra
         * `payment_id` e mais nada, e casar um pagamento com um pedido da loja
         * vira garimpo manual.
         *
         * POR QUE NÃO O ID DO PEDIDO: nesta loja a cobrança acontece ANTES de
         * `createOrder` — o id ainda não existe aqui. A chave de idempotência
         * existe, é única por índice, e é exatamente o que a linha do pedido
         * grava em `chave_idempotencia`. Um campo, os dois lados.
         */
        external_reference: chaveIdempotencia,
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_checkout_e_webhook.test.js
git commit -m "feat(pagamento): external_reference liga o pagamento ao pedido"
```

---

### Task 3: `statement_descriptor` — o nome na fatura

Sem o campo, a fatura do cartão sai com o nome da conta Mercado Pago. "Não reconheço esta compra" é das causas mais comuns de contestação.

**Files:**
- Modify: `backend/src/controllers/PaymentController.js:39-40` (constantes) e o objeto `paymentData`
- Modify: `backend/test/f4_checkout_e_webhook.test.js` (teste novo no fim)

- [ ] **Step 1: Escrever o teste que falha**

```js
test("checkout: a fatura do cliente traz o nome da loja", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-descritor" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];
  assert.equal(cobranca.statement_descriptor, "CAFECANASTRA");
  assert.ok(
    cobranca.statement_descriptor.length <= 13,
    "o Mercado Pago corta o descritor em 13 caracteres",
  );
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: FALHA com `undefined !== 'CAFECANASTRA'`.

- [ ] **Step 3: Implementar**

Em `backend/src/controllers/PaymentController.js`, logo abaixo de `const TOLERANCIA_FRETE = 0.01;` (linha 40):

```js
/**
 * O que o cliente lê na fatura do cartão.
 *
 * Sem isto sai o nome da conta Mercado Pago, e a pessoa não reconhece a
 * compra — que é como nasce boa parte das contestações.
 *
 * CONSTANTE, E NÃO `LOJA_NOME`: aquela variável vale "Cafe Canastra", com
 * espaço e 13 caracteres, e serve ao User-Agent da Melhor Envio. O descritor
 * aceita no máximo 13 e não aceita o mesmo conjunto de caracteres — reusar a
 * variável faria uma mudança inocente num campo virar recusa no outro.
 */
const DESCRITOR_NA_FATURA = "CAFECANASTRA";
```

E dentro de `const paymentData = {`, logo depois de `external_reference: chaveIdempotencia,`:

```js
        statement_descriptor: DESCRITOR_NA_FATURA,
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_checkout_e_webhook.test.js
git commit -m "feat(pagamento): a fatura do cliente passa a dizer CAFECANASTRA"
```

---

### Task 4: `payer` completo e `additional_info`

Hoje o `payer` leva só e-mail e CPF, e não existe `additional_info`. Pedido sem `additional_info` é pedido cego para o motor de risco do Mercado Pago — é o principal insumo de aprovação, e é item pontuado na Qualidade da integração.

`validatedItems` e `address` já estão no escopo, conferidos contra o banco. O nome do cliente **não** está: é o único dado novo, e sai de uma consulta própria.

**Files:**
- Modify: `backend/src/controllers/PaymentController.js:429-438` (bloco do `garantirCpf`) e o objeto `paymentData`
- Modify: `backend/test/f4_checkout_e_webhook.test.js` (teste novo no fim)

- [ ] **Step 1: Escrever o teste que falha**

```js
test("checkout: additional_info leva itens, destinatário e IP ao antifraude", async () => {
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-info" },
      body: corpoDeCheckout(),
      ip: "203.0.113.7",
    },
    res,
  );

  assert.equal(res.codigo, 201);
  const cobranca = mp.criacoes[mp.criacoes.length - 1];

  // O nome sai de canastra.clientes; o before() cadastrou Ana sem sobrenome.
  assert.equal(cobranca.payer.first_name, "Ana");

  const info = cobranca.additional_info;
  assert.equal(info.items.length, 1);
  assert.equal(info.items[0].id, PRODUTO);
  assert.equal(info.items[0].quantity, 2);
  assert.equal(info.items[0].title, "Café do Teste");
  assert.equal(info.ip_address, "203.0.113.7");
  assert.equal(info.shipments.receiver_address.zip_code, "35012345");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: FALHA lendo `payer.first_name` (`undefined !== 'Ana'`).

- [ ] **Step 3: Ler o nome do cliente**

Em `backend/src/controllers/PaymentController.js`, o bloco do `garantirCpf` (linha ~429) passa a guardar o nome também. Substitua:

```js
      if (userId) {
        const cpf = await garantirCpf(userId, formData?.payer?.identification);
        if (!cpf) {
          return res.status(400).json({
            error: "CPF_MISSING",
            message:
              "É necessário informar o CPF para prosseguir com a entrega.",
          });
        }
      }
```

por:

```js
      /**
       * O nome do titular, para o `payer` que vai ao antifraude.
       *
       * CONSULTA PRÓPRIA, e não um campo a mais no retorno de `garantirCpf`:
       * o contrato daquela função (`Promise<string | null>`) está documentado
       * por extenso em utils/cpf.js e é COMPARTILHADO com a adesão do Clube.
       * Alargar o retorno para servir a este caso mudaria o contrato dos dois
       * chamadores por causa de um campo — exatamente o que o comentário de lá
       * avisa para não fazer. O custo é uma ida a mais ao banco, fora da
       * transação e antes da cobrança.
       */
      let nomeDoCliente = "";
      if (userId) {
        const cpf = await garantirCpf(userId, formData?.payer?.identification);
        if (!cpf) {
          return res.status(400).json({
            error: "CPF_MISSING",
            message:
              "É necessário informar o CPF para prosseguir com a entrega.",
          });
        }
        const { rows: linhasDoCliente } = await pool.query(
          "SELECT nome FROM canastra.clientes WHERE user_id = $1::uuid",
          [userId],
        );
        nomeDoCliente = String(linhasDoCliente[0]?.nome || "").trim();
      }
```

- [ ] **Step 4: Montar `payer` e `additional_info`**

Ainda em `backend/src/controllers/PaymentController.js`, logo ANTES de `const paymentData = {`, adicione:

```js
      /**
       * O nome quebrado em dois, porque é assim que o Mercado Pago pede.
       *
       * `canastra.clientes.nome` é um campo só e aceita "Ana" tanto quanto
       * "Ana Maria de Souza". A primeira palavra é o nome; o resto, quando
       * existe, é o sobrenome. Nome de uma palavra só NÃO manda `last_name`
       * vazio: campo vazio é pior que campo ausente para o motor de risco.
       */
      const partesDoNome = nomeDoCliente.split(/\s+/).filter(Boolean);
      const primeiroNome = partesDoNome[0] || "";
      const sobrenome = partesDoNome.slice(1).join(" ");

      /**
       * O ENDEREÇO NO FORMATO DO MERCADO PAGO. O `address` do pedido usa os
       * nomes da loja (`zip_code`/`cep`, `street`/`rua`), e as duas grafias
       * circulam porque o corpo vem do navegador. Normaliza aqui, uma vez.
       */
      const enderecoParaOMp = {
        zip_code: address?.zip_code || address?.zipCode || address?.cep || "",
        street_name: address?.street || address?.rua || "",
        street_number: String(address?.number || address?.numero || ""),
      };
```

E dentro de `const paymentData = {`, no `payer`, some os campos novos ao que já existe, e adicione `additional_info` logo depois do bloco `payer`:

```js
        payer: {
          email: formData.payer.email || userEmail,
          ...(primeiroNome ? { first_name: primeiroNome } : {}),
          ...(sobrenome ? { last_name: sobrenome } : {}),
          ...(enderecoParaOMp.zip_code ? { address: enderecoParaOMp } : {}),
          ...(identification && identification.number
            ? {
                identification: {
                  type: identification.type || "CPF",
                  number: identification.number,
                },
              }
            : {}),
        },
        /**
         * O QUE O ANTIFRAUDE LÊ. Pedido sem `additional_info` é pedido cego
         * para o motor de risco do Mercado Pago: ele não vê o que foi
         * comprado, por quem, nem para onde vai. É o principal insumo de
         * aprovação de cartão, e é item pontuado na Qualidade da integração.
         *
         * Tudo aqui já está em mãos — `validatedItems` veio do banco e o
         * endereço já foi conferido. Nenhuma consulta nova.
         */
        additional_info: {
          items: validatedItems.map((item) => ({
            id: String(item.product_id),
            title: item.name,
            quantity: item.quantity,
            unit_price: item.price,
          })),
          payer: {
            ...(primeiroNome ? { first_name: primeiroNome } : {}),
            ...(sobrenome ? { last_name: sobrenome } : {}),
          },
          ...(enderecoParaOMp.zip_code
            ? { shipments: { receiver_address: enderecoParaOMp } }
            : {}),
          ...(req.ip ? { ip_address: req.ip } : {}),
        },
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_checkout_e_webhook.test.js
git commit -m "feat(pagamento): additional_info e payer completo para o antifraude"
```

---

### Task 5: Device ID na vitrine

O `security.js` do Mercado Pago não existe no repositório. Ele popula `window.MP_DEVICE_SESSION_ID`, que é o sinal de fingerprint que o motor de risco usa.

**A regra que não pode ser quebrada:** navegador com bloqueador de script não recebe `security.js`. Um checkout que morresse por causa disso trocaria uma melhoria de aprovação por uma perda de venda. **A ausência do device id nunca derruba o pagamento.**

**Files:**
- Modify: `frontend/lib/sacola/cartao.ts` (depois de `carregarSdkMp`, linha ~93)
- Modify: `frontend/lib/sacola/checkout.ts:279-293` (`corpoComum`)
- Test: `frontend/lib/sacola/checkout.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `frontend/lib/sacola/checkout.test.ts`, adicione um `describe` novo no fim do arquivo. Os helpers já existem ali e os nomes são estes — **não invente outros**: `fetchComResposta(corpo)`, `corpoEnviado(f, chamada)`, a fixture `dadosBase`, a constante `RESPOSTA_OK`, e a assinatura `pagarComPix(token, dados, fetchFn)`.

```ts
describe("device id do Mercado Pago", () => {
  it("manda o deviceId no corpo quando o security.js populou a sessão", async () => {
    (window as unknown as { MP_DEVICE_SESSION_ID?: string })
      .MP_DEVICE_SESSION_ID = "dev-sessao-123";
    try {
      const f = fetchComResposta(RESPOSTA_OK);
      await pagarComPix("tok-sessao", dadosBase, f);
      expect(corpoEnviado(f).deviceId).toBe("dev-sessao-123");
    } finally {
      delete (window as unknown as { MP_DEVICE_SESSION_ID?: string })
        .MP_DEVICE_SESSION_ID;
    }
  });

  it("sem security.js o corpo não traz deviceId, e o pagamento segue", async () => {
    // Bloqueador de script é cenário real. Perder a venda por causa do
    // fingerprint seria trocar aprovação por conversão.
    const f = fetchComResposta(RESPOSTA_OK);
    await pagarComPix("tok-sessao", dadosBase, f);
    expect(corpoEnviado(f)).not.toHaveProperty("deviceId");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd frontend && npm test -- lib/sacola/checkout.test.ts
```

Esperado: FALHA no primeiro (`undefined` no lugar de `dev-sessao-123`).

- [ ] **Step 3: Expor o device id**

Em `frontend/lib/sacola/cartao.ts`, logo depois de `carregarSdkMp` (linha ~93):

```ts
/** Onde o security.js do Mercado Pago publica o identificador da sessão. */
export const URL_SECURITY_MP = "https://www.mercadopago.com/v2/security.js";

/**
 * Carrega o script de fingerprint do Mercado Pago.
 *
 * SEPARADO DO SDK DE PROPÓSITO: o SDK v2 tokeniza o cartão e só entra quando
 * há `NEXT_PUBLIC_MP_PUBLIC_KEY`; este aqui não depende de chave nenhuma e
 * vale também para Pix, porque o motor de risco lê o device em qualquer meio
 * de pagamento.
 *
 * DUAS PROPRIEDADES, e elas são diferentes:
 *
 *   NÃO REJEITA NUNCA — bloqueador de script é cenário corriqueiro, e um
 *   checkout que morresse por não carregar o fingerprint trocaria aprovação
 *   por conversão. Falhou, segue sem: `deviceIdDoNavegador()` devolve string
 *   vazia e o corpo do pagamento sai sem o campo.
 *
 *   FALHA NÃO ENVENENA A PRÓXIMA TENTATIVA — o cache volta a `null` no erro,
 *   como `carregarSdkMp` já faz. Sem isso, uma queda de rede de um segundo
 *   deixaria a aba inteira sem device id para sempre: a promessa resolvida
 *   "sem fingerprint" ficaria no cache e toda navegação seguinte para o
 *   checkout a receberia de volta, em silêncio.
 *
 * A CSP já libera www.mercadopago.com em script-src (next.config.mjs).
 */
let securityCarregando: Promise<void> | null = null;

export function carregarSecurityMp(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (securityCarregando) return securityCarregando;

  securityCarregando = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = URL_SECURITY_MP;
    script.setAttribute("view", "checkout");
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Some do cache ANTES de resolver: a próxima chamada injeta de novo,
      // em vez de receber esta mesma promessa "sem fingerprint" para sempre.
      securityCarregando = null;
      script.remove();
      resolve();
    };
    document.head.appendChild(script);
  });
  return securityCarregando;
}

/** O identificador da sessão, ou string vazia se o script não carregou. */
export function deviceIdDoNavegador(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { MP_DEVICE_SESSION_ID?: string })
      .MP_DEVICE_SESSION_ID || ""
  );
}
```

- [ ] **Step 4: Mandar no corpo**

Em `frontend/lib/sacola/checkout.ts`, importe `deviceIdDoNavegador` de `./cartao` (junto dos imports que já existem) e, em `corpoComum`, adicione o campo ao objeto devolvido:

```ts
function corpoComum(dados: DadosDoPedido) {
  return {
    items: dados.itens.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      name: i.name,
    })),
    userEmail: dados.email,
    address: dados.endereco,
    shippingCost: dados.frete.price,
    shippingMethod: dados.frete.name,
    subtotalCentavos: subtotalDosItensCentavos(dados.itens),
    ...(dados.cupom ? { cupom: dados.cupom } : {}),
    // Fingerprint do Mercado Pago. Vale para Pix e cartão — o motor de risco
    // lê o device nos dois. Ausente quando o security.js não carregou, e a
    // ausência é tratada como normal em todo o caminho.
    ...(deviceIdDoNavegador() ? { deviceId: deviceIdDoNavegador() } : {}),
  };
}
```

- [ ] **Step 5: Disparar o carregamento na página de checkout**

Em `frontend/app/(transacional)/checkout/page.tsx`, importe `carregarSecurityMp` de `@/lib/sacola/cartao` e dispare uma vez na montagem da página, num `useEffect` sem dependências:

```tsx
  /**
   * O fingerprint precisa ter tempo de coletar antes do pagamento, então
   * carrega na montagem da página — não no submit. Não depende de
   * NEXT_PUBLIC_MP_PUBLIC_KEY: vale para Pix também.
   */
  useEffect(() => {
    void carregarSecurityMp();
  }, []);
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
cd frontend && npm test -- lib/sacola/checkout.test.ts
```

Esperado: os dois testes novos passam.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/sacola/cartao.ts frontend/lib/sacola/checkout.ts frontend/lib/sacola/checkout.test.ts "frontend/app/(transacional)/checkout/page.tsx"
git commit -m "feat(checkout): o Device ID do Mercado Pago passa a ser coletado"
```

---

### Task 6: Device ID no serviço

O valor que a Task 5 passou a mandar tem de chegar ao gateway. O SDK converte `requestOptions.meliSessionId` no header `X-meli-session-id`.

**Files:**
- Modify: `backend/src/controllers/PaymentController.js` (a chamada `payment.create`, editada na Task 1)
- Modify: `backend/test/f4_checkout_e_webhook.test.js` (teste novo no fim)

- [ ] **Step 1: Escrever o teste que falha**

```js
test("checkout: o device id do navegador chega ao Mercado Pago", async () => {
  const corpo = corpoDeCheckout();
  corpo.deviceId = "dev-sessao-abc";
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-device" },
      body: corpo,
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(
    mp.opcoes[mp.opcoes.length - 1]?.meliSessionId,
    "dev-sessao-abc",
  );
});

test("checkout: sem device id a cobrança sai do mesmo jeito", async () => {
  // Bloqueador de script no navegador. Recusar aqui seria trocar uma melhoria
  // de aprovação por uma venda perdida.
  const res = respostaFalsa();
  await PaymentController.createPayment(
    {
      user: { userId: ANA },
      headers: { "idempotency-key": "clique-sem-device" },
      body: corpoDeCheckout(),
    },
    res,
  );

  assert.equal(res.codigo, 201);
  assert.equal(mp.opcoes[mp.opcoes.length - 1]?.meliSessionId, undefined);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: FALHA no primeiro (`undefined !== 'dev-sessao-abc'`); o segundo já passa.

- [ ] **Step 3: Implementar**

Em `backend/src/controllers/PaymentController.js`, na chamada que a Task 1 deixou, some o `meliSessionId`:

```js
        mpResponse = await payment.create({
          body: paymentData,
          requestOptions: {
            idempotencyKey: chaveIdempotencia,
            /**
             * O fingerprint que o security.js coletou no navegador; o SDK o
             * envia como `X-meli-session-id`. CONDICIONAL, e é o ponto todo:
             * bloqueador de script deixa o campo ausente, e nesse caso a
             * cobrança sai sem o header em vez de não sair.
             */
            ...(typeof req.body?.deviceId === "string" && req.body.deviceId
              ? { meliSessionId: req.body.deviceId }
              : {}),
          },
        });
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd backend && node --test --test-concurrency=1 test/f4_checkout_e_webhook.test.js
```

Esperado: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_checkout_e_webhook.test.js
git commit -m "feat(pagamento): o device id chega ao gateway em X-meli-session-id"
```

---

### Task 7: Conferência final

- [ ] **Step 1: Suíte inteira do backend, em serial**

```bash
cd backend && node --test --test-concurrency=1 test/*.test.js
```

Esperado: `# fail 1` — **e a única falha tem de ser o teste 289**, `o arquivo no repositorio esta em dia com o gerador`, o CRLF pré-existente. Qualquer outra é regressão desta leva: pare e investigue.

- [ ] **Step 2: Suíte do frontend**

```bash
cd frontend && npm test
```

Esperado: tudo passando. **A base é 869 testes em 69 arquivos**, medida em
2026-08-25 durante a Task 5. (Uma versão anterior deste plano dizia 366/366 —
número obsoleto, de uma fase antiga do projeto. Não use aquele.)

- [ ] **Step 3: Build de produção**

```bash
npm run build
```

Esperado: build verde. É o que pega erro de tipo no `deviceId` e no import novo de `cartao.ts`.
