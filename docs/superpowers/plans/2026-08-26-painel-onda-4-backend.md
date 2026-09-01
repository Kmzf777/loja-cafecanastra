# Painel de gestão — Onda 4: o backend

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> Esta onda **não toca no frontend**, com uma exceção nomeada na Task 6.

**Goal:** o motor de promoção calcula de verdade, e as rotas que faltam existem — para que a Onda 5
escreva telas contra um contrato pronto, e não contra um que ela mesma precise inventar.

**Architecture:** o cálculo de desconto vira um **módulo puro** (`backend/src/utils/motor.js`), sem
banco e sem Express, com teste de tabela-verdade. Quem lê o banco e monta a entrada dele é um
repositório. É o mesmo desenho que `utils/preco.js` e `utils/cupom.js` já usam, e é o que permite
testar precedência e empilhamento sem subir Postgres.

**Leitura obrigatória:** `docs/superpowers/specs/…-painel-de-gestao-design.md` §3, §5.1 e §7-B; a
migração `0032_motor_de_promocao.sql` inteira (é o contrato de dados desta onda); e
`backend/src/utils/preco.js`, `utils/cupom.js` e `controllers/PaymentController.js` — os três que o
motor substitui ou passa a alimentar.

---

## O que a Onda 3 deixou anotado e esta onda tem de resolver

1. **`lgpd.routes.js` ficou incompleto.** O cabeçalho dele diz que a lista é *"TODA tabela desta
   loja com dado da pessoa, e quem criar a próxima tem de voltar aqui"*. `consentimentos` e `envios`
   nasceram fora dela, e a exportação de `pedidos` não projeta as colunas de atribuição novas.
2. **`produtos_publicos` não filtra por `estado`.** Ligar a tela de rascunho sem isso publica um
   rascunho no primeiro salvamento. **Cuidado:** a view tem **dois** leitores — a vitrine e
   `AvaliarPedido.tsx`, que a usa para mapear produto→SKU. Filtrar por estado tiraria o formulário
   de avaliação de quem comprou um produto depois arquivado. Resolva os dois, não um.
3. **`ON CONFLICT` não infere índice parcial.** `campanhas.utm_campaign` e `produtos.codigo_bling`
   são únicos **parciais**: o upsert precisa repetir o `WHERE`, ou leva 42P10.
4. **`admin_log` não é à prova de esquecimento.** É escrito pelo mesmo código que faz a ação, e um
   trigger não resolve — o painel escreve pelo pool do Express, como dono e sem claim, então
   `auth.uid()` seria NULL e todo log sairia sem autor. Fecha-se com **teste por rota**.

---

### Task 1: O motor, como módulo puro

**Files:** `backend/src/utils/motor.js` + `backend/test/motor.test.js`

Uma função: `calcularDescontos(carrinho, regras)` → `{ ajustes: [...], totalCentavos }`. Sem banco,
sem Express, sem `require` de nada que toque rede.

**A ordem de aplicação é declarada e testada, não emergente.** Hoje o "melhor preço" é um
`Math.min` ingênuo entre todas as promoções que casam (`preco.js:56`) — *"a mais generosa ganha"* é
acidente, não decisão. A ordem nova:

1. **classe `produto`** — sobre a linha, item a item.
2. **classe `pedido`** — sobre o subtotal **já reduzido** pela etapa 1. Dois percentuais de pedido
   incidem sobre o **subtotal da etapa 1**, nunca compostos entre si.
3. **classe `frete`** — por último, porque depende do subtotal final.

Dentro de cada classe: `prioridade` decrescente; `exclusiva` corta o resto da classe; uma por
`grupo_exclusividade`.

**Os casos de tabela-verdade que precisam existir** (cada um é uma linha do teste):

```
percentual simples · valor fixo · preço fixo
teto_desconto_centavos corta o percentual
minimo_tipo=subtotal não atinge → não aplica
minimo_tipo=quantidade conta só os itens ELEGÍVEIS, não o carrinho todo
escopo com exceção: 10% na loja menos o micro-lote
duas regras da mesma classe: prioridade decide
exclusiva corta as outras da classe
grupo_exclusividade: só uma passa
leve 3 pague 2 com 7 unidades → 2 grátis, sobra 1
progressivo: a faixa mais alta atingida ganha, não a soma das faixas
frete grátis com teto: modalidade acima do teto NÃO fica grátis
frete grátis só na modalidade mais barata
meio de pagamento: regra de PIX não aplica em cartão
desconto nunca ultrapassa o valor da linha nem do pedido
arredondamento: o total dos ajustes bate com a diferença do subtotal, ao centavo
```

> **O arredondamento não é cosmético.** `utils/preco.js` já documenta que 10% sobre 49,90 em float
> dá 44.910000000000004, e esse número iria para o `itens` jsonb imutável do pedido e para a soma
> cobrada no gateway. Some **em centavos inteiros**, sempre.

---

### Task 2: O motor lendo o banco

**Files:** `backend/src/repositories/motorRepository.js` + teste com Postgres embarcado

`carregarRegrasVigentes(contexto)` monta a entrada do motor a partir de `promocoes`,
`promocao_escopo`, `promocao_faixas`, `promocao_frete` e `promocao_codigos`.

**Uma consulta, não N+1.** E o filtro de vigência é o mesmo predicado que a política de `anon` usa
na 0032 — se os dois divergirem, a vitrine e a cobrança discordam sobre o mesmo carrinho, que é
exatamente o defeito que `utils/preco.js` existe para evitar.

**O limite por cliente** consulta `promocao_resgates` por `documento_hash` (SHA-256 do CPF). O hash
é calculado no servidor, nunca recebido do navegador.

---

### Task 3: O checkout usa o motor

**Files:** `PaymentController.js`, `cuponsRepository.js`, `utils/preco.js`

- O resgate é gravado em `promocao_resgates` **na mesma transação** da reserva de estoque — é o
  desenho que `cuponsRepository.js:125-130` já usa para o contador, e é o que faz dois checkouts
  simultâneos no último uso serializarem em vez de os dois passarem.
- Cada desconto aplicado vira uma linha em `pedido_ajustes_desconto`, com `sequencia`.
- **Pedido cancelado ou PIX expirado devolve o uso** — `estornado_em` preenchido. Sem isso, carrinho
  abandonado queima cupom.
- `utils/preco.js` passa a delegar ao motor. **Mantenha a assinatura** — ele tem três chamadores
  (cotação de frete, validação de cupom, cobrança), e cópias divergindo fariam os três discordarem.

> **`conferirSubtotal` NÃO muda nesta onda.** Ver spec §5.1: `subtotalCentavos` significa *"o que a
> tela somou a partir do catálogo"*, e continua correto enquanto a sacola guardar preço de catálogo.
> O campo novo `subtotalPromocionalCentavos` é da Onda 6, junto com a exibição.

---

### Task 4: As rotas que faltam

Cada uma existe porque a Onda 5 não consegue escrever a tela sem ela.

- **`GET /admin/orders/:id`** — não existe. Sem ela, `/dashboard/pedidos/[id]` não tem deep-link: o
  detalhe hoje só existe a partir da linha que já está em memória.
- **Filtro em `GET /admin/orders`** — hoje aceita só `page` e `limit`. Uma tela com filtros sobre
  uma página de 100 linhas **mente**. Aceite status, período e busca por cliente/número.
- **Busca em `GET /auth/users`** — mesma história.
- **`PATCH /dashboard/:id/estoque`** — hoje ajustar estoque obriga a reenviar o formulário inteiro
  por multipart, **inclusive a imagem**. É por esse caminho que as medidas do pacote eram apagadas.
- **`GET /admin/produtos/:id/custo`** (ou o custo na rota de detalhe do painel) — `produtos.custo`
  não é legível por `authenticated` e `RETURNING *` responde 42501 até para admin. O caminho é a
  rota admin no Express, que conecta como dono. A migração 0006 adiou essa decisão *"para a tarefa
  que construir o painel"* — é esta.
- **`/avaliacoes` no Express** — listar com filtro, paginação e contagem, e `PATCH` de status em
  lote. Hoje a tela fala direto com o PostgREST, e lá um não-admin atualiza **zero linhas sem
  erro** (semântica do `USING`), então o toast mente sucesso. Um modelo de acesso só.
- **`/admin/administradores`** — listar, promover, remover. Hoje **não existe caminho nenhum**: a
  única escrita em `canastra.admins` do repositório está no script de instalação, e promover um
  segundo gestor exige `psql` em produção. O trigger `admins_nunca_zero` (0002:118) já impede
  remover o último; a rota precisa **avisar antes de tentar**.
- **`/admin/campanhas`, `/admin/consentimentos`, `/admin/envios`** — CRUD do que a 0033 criou.

**Cuidados que valem para todas:**

> **A ordem de registro é load-bearing.** Três pares já quebram se invertidos: `/dashboard/summary`
> antes de `/dashboard/:id` (invertido, o summary vira produto de id `"summary"` e responde 404
> **público**), `/admin/orders/export` antes de `/admin/orders/:id`, e `/users/me` antes de
> `/users/:id`. Acrescente **no fim**, e não reordene nada.

> **Cinco rotas de leitura são públicas de propósito** — `GET /dashboard`, `/dashboard/:id`,
> `/config`, `/promotions`, `/options`. Parece bug e não é: a vitrine as consome em Server Component
> sem sessão. "Consertar" pondo `isAdmin` derruba a loja. Se incomodar expor `quantity`, a saída é
> uma rota admin nova — nunca fechar a existente.

> **Valide o uuid antes de tocar no banco.** `utils/formatoUuid.js` (`ehUuid`) já existe.

> **`res.json()` sem `catch` quebra no caminho de sessão expirada** — 401 e 403 saem por
> `sendStatus`, com corpo vazio.

---

### Task 5: `admin_log` escrito, com teste por rota

Toda rota de escrita do painel grava quem, o quê, antes e depois. E a exportação de CSV com dado
pessoal grava **quem exportou e quando** — hoje ela baixa a base inteira com CPF e e-mail quando as
datas ficam vazias, sem confirmação, sem teto e sem auditoria.

O teste é por rota, e não um trigger, pela razão que a Onda 3 anotou: o painel escreve pelo pool do
Express, como dono e sem claim, então `auth.uid()` num trigger seria NULL e todo log sairia sem
autor.

---

### Task 6: As duas pontas soltas da Onda 3

- **`lgpd.routes.js`** ganha `consentimentos` e `envios`, e a exportação de `pedidos` projeta as
  colunas de atribuição.
- **`produtos_publicos`** passa a filtrar `estado <> 'arquivado'` — e o segundo leitor
  (`AvaliarPedido.tsx`, que mapeia produto→SKU) ganha um caminho que continua enxergando o
  arquivado. **Esta é a exceção de frontend desta onda**, e é uma mudança pequena e nomeada.

---

## Como se sabe que a Onda 4 acabou

1. `npm --prefix backend test` verde, com contagem maior que 546.
2. A tabela-verdade do motor passa inteira — inclusive o caso de arredondamento.
3. Um pedido com promoção **e** cupom é criado, e a soma de `pedido_ajustes_desconto` bate exatamente
   com a diferença entre o subtotal de catálogo e o valor cobrado.
4. Cancelar esse pedido **devolve** o uso: `promocao_resgates.estornado_em` preenchido e o cupom
   volta a valer.
5. As rotas novas respondem, e a de administradores recusa remover o último admin **com frase**, não
   com 500.
6. `f4_checkout_e_webhook.test.js` e `f6_cupons.test.js` continuam verdes — o checkout não regrediu.
