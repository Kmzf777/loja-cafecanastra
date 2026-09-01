# Atualizar o banco de produção

> Escrito em 27/08/2026, na branch `feat/painel-gestao`, depois do fechamento das sete ondas da
> reescrita do painel.
>
> **Este documento existe porque a ordem importa.** O painel novo lê colunas que só passam a existir
> a partir da migração 0009. Subir o site antes do banco não deixa a tela feia — deixa a lista de
> pedidos falhando inteira, com `42703` (coluna inexistente), e não só o bloco do Bling.

---

## 1. A regra de ouro

**Banco primeiro, aplicação depois. Sempre.**

As migrações desta leva são **aditivas** — criam tabela, coluna, política e função; não removem nada
de que o código antigo dependa. Isso é deliberado e é o que torna a ordem segura:

- Banco novo **+** aplicação velha ⇒ funciona. A aplicação velha ignora o que não conhece.
- Banco velho **+** aplicação nova ⇒ **quebra**, e quebra em consulta, não no boot.

A única exceção está registrada em §5.

---

## 2. Antes de rodar: descobrir onde o banco está

Não confie em documento nenhum — nem neste. **Meça.**

```sql
-- Quais migrações o banco já aplicou, e quando.
SELECT versao, aplicada_em
FROM canastra.migracoes
ORDER BY versao;
```

Se `canastra.migracoes` não existir, o banco nunca passou pelo runner — vá para §6 (instalação do
zero), não para §3.

> A anotação de memória do projeto diz que produção estava **na 0008** e o repositório na 0016. Hoje
> o repositório está na **0038**. E o comentário de `deploy/deploy.sh:83` afirma que *"o schema
> canastra já está migrado lá"* — **esse comentário é de outra época e pode estar errado**. A
> consulta acima é a única resposta confiável.

---

## 3. O que falta aplicar

Vinte e duas migrações, na ordem numérica. O runner aplica sozinho as que faltarem — esta lista é
para você saber **o que vai acontecer**, não para rodar à mão.

### As oito da loja (0009 → 0016) — anteriores à reescrita do painel

| Versão | O que faz | Por que importa agora |
|---|---|---|
| `0009_status_e_frete_gratis` | Lista fechada dos 9 status de pedido (CHECK) e o piso do frete grátis em `config_loja` | A tela de Pedidos **inteira** depende do vocabulário de status |
| `0010_cupons` | Tabela `cupons` e o rastro dela no pedido (`cupom_codigo`, `desconto`) | O checkout já grava nessas colunas |
| `0011_newsletter_e_abandono` | `newsletter_inscritos` e `carrinhos.lembrete_enviado_em` | A tela de Marketing lê as duas |
| `0012_bling` | Colunas `bling_*`/`nfe_*` no pedido e o refresh token rotativo | **A lista de pedidos projeta essas colunas explicitamente** — sem elas, `42703` |
| `0013_redacao_lgpd` | Redação de dado pessoal nos pedidos | Obrigação legal; a rota de LGPD chama a função |
| `0014_avaliacoes` | Avaliações de produto, com RLS por quem recebeu | A tela de Avaliações |
| `0015_assinaturas` | Clube da Canastra, assinatura recorrente | A tela de Assinaturas |
| `0016_redacao_ampliada` | A redação alcança tudo que congela dado pessoal | Fecha o buraco que a 0013 deixou |

### As catorze do painel (0030 → 0038)

| Versão | O que faz | Notas |
|---|---|---|
| `0030_vitrine` | `vitrine_heroi` + `vitrine_texto` — o herói da home e a barra de aviso editáveis | Toda coluna de conteúdo é nulável **de propósito**: linha vazia ⇒ a home usa o texto de hoje |
| `0031_correcoes_de_privilegio` | Fecha três buracos: o cliente escrevia o próprio CPF (e o `UNIQUE` virava oráculo de enumeração); qualquer conta da instância lia o `user_id` de todo avaliador; um admin apagava `config_loja` junto com o token do Bling | Cria `canastra.minhas_avaliacoes()` — **o frontend novo depende dela** |
| `0032_motor_de_promocao` | Sete tabelas. Promoção e cupom viram **uma** entidade. Renomeia a tabela antiga para `promocoes_legado` e migra os dados | **A de maior impacto.** Ver §4 |
| `0033_marketing` | Dez colunas de atribuição em `pedidos`, mais `campanhas`, `consentimentos`, `envios`, `automacoes`; opt-out na newsletter e token de retomada no carrinho | O dado de atribuição é **perecível**: sem estas colunas, a origem de cada venda se perde para sempre |
| `0034_produto_fiscal` | NCM, CEST, CFOP, GTIN, origem, unidade, pesos, `codigo_bling`; `estado` do produto; snapshot de custo | **É o que decide a NF-e.** Produto sem NCM passa na sincronização e só falha na transmissão à SEFAZ |
| `0035_auditoria` | `admin_log` e `admins.papel` | Registra quem mexeu no quê |
| `0037_vitrine_por_estado` | `produtos_publicos` passa a filtrar por estado; cria `produtos_sku` para o segundo leitor | Ver §5 |
| `0038_rascunho_nao_vai_para_a_loja` | Troca o filtro para `estado = 'ativo'` | Sem esta, salvar um rascunho **publica** o produto |

> **Não existe `0036`, e isso não é erro.** O runner (`backend/db/migrar.js:168`) recusa número
> **repetido**, não buraco: ele ordena por número e aplica o que falta. Um número reservado e não
> usado é preferível a renumerar uma migração — a chave de controle em `canastra.migracoes` é o
> **nome completo do arquivo**, então renomear uma já aplicada a faria rodar de novo.

---

## 4. A 0032 é a que exige atenção

Ela **renomeia** `canastra.promocoes` para `canastra.promocoes_legado` e dá o nome ao motor novo,
que tem outra forma inteira.

Três consequências:

1. **`backend/src/repositories/promotionsRepository.js` foi ajustado no mesmo commit** para apontar
   para o nome novo. Banco migrado com código velho ⇒ as cinco consultas daquele arquivo morrem com
   `42703`. É o caso mais forte da regra de §1 — e a leitura dele é `GET /promotions`, uma das cinco
   rotas públicas, então a **vitrine** sente.
2. **A migração de dados PARA em vez de perder regra.** Uma linha do legado cuja `tipo` não
   corresponda a nenhuma mecânica nova aborta a migração, com os ids e o comando que resolve. É
   deliberado: perder uma regra de desconto em silêncio é pior que parar.
3. **Promoção legada com `ativa = true` e sem datas migra DESLIGADA.** No modelo antigo ela nunca
   valia (o filtro exigia as duas datas); no novo, data nula significa "vale sempre". Migrar crua
   ligaria um desconto que nunca existiu.

As tabelas `promocoes_legado` e `cupons` **continuam de pé** depois da 0032 — a aposentadoria delas
é de uma migração futura (`0036_aposentar_promocoes_e_cupons.sql`, ainda não escrita; o número está
reservado para ela).

---

## 5. A única mudança que NÃO é puramente aditiva

`0037` + `0038` mudam o **predicado** da view `canastra.produtos_publicos`, que a vitrine consome.

- Antes: a view mostrava **todos** os produtos.
- Depois: só `estado = 'ativo'`.

A coluna `estado` nasce com `DEFAULT 'ativo'` na 0034, então **todo produto existente continua
visível**. O efeito só aparece quando alguém arquivar ou rascunhar algo pelo painel novo — que é
exatamente o comportamento desejado.

> A view tem **dois leitores**, e é por isso que a 0037 cria `canastra.produtos_sku`:
> `AvaliarPedido.tsx` usa a view para traduzir produto → SKU, e quem comprou um café arquivado depois
> continua tendo o que dizer na avaliação. Filtrar sem a view irmã apagaria, em silêncio, o
> formulário de avaliação dessas pessoas.

---

## 6. Como rodar

### Banco que já passou pelo runner (o caso de produção)

```bash
# A partir da RAIZ do repositório, com DATABASE_URL apontando para produção.
npm run db:migrar
```

O runner:
- cria `canastra.migracoes` se não existir, e revoga acesso a ela de `anon` e `authenticated`;
- lê os arquivos **antes** de abrir qualquer transação (leitura que falha no meio deixaria uma
  migração commitada e a seguinte não);
- aplica cada migração pendente **dentro da própria transação** (`BEGIN` … `COMMIT`), na ordem
  numérica, registrando a versão no fim;
- em erro, faz `ROLLBACK` e **para** — a migração que falhou não fica pela metade, e as anteriores
  já commitadas permanecem.

Ou seja: rodar de novo depois de consertar o problema retoma de onde parou. **Não há passo manual
de reparo.**

### Pelo deploy automatizado

`deploy/deploy.sh` roda o passo sozinho **se** houver mudança em `backend/db/migrations/` **e** se
existir `deploy/.env.migracao` na VPS com a `DATABASE_URL` do pooler. Sem o arquivo ele **avisa e
segue** — não derruba o deploy, e a migração fica por sua conta.

> **Confira se `deploy/.env.migracao` existe na VPS antes de confiar no automático.** Se não
> existir, o site sobe com o banco velho, que é precisamente o cenário de §1.

### Banco do zero (ambiente novo, não produção)

```bash
node backend/db/gerar-instalacao.js   # regenera db/instalacao-completa.sql a partir das migrações
psql "$DATABASE_URL" -f backend/db/instalacao-completa.sql
```

`instalacao-completa.sql` é **gerado**, nunca editado à mão — `backend/test/instalacao.test.js`
compara o arquivo versionado com o que o gerador produz e fica vermelho na divergência.

---

## 7. Depois de migrar: conferir

```sql
-- 1. Todas as 24 versões aplicadas?
SELECT count(*) AS aplicadas FROM canastra.migracoes;
-- esperado: 24  (0001–0016, 0030–0035, 0037, 0038 — não há 0017–0029 nem 0036)

-- 2. As tabelas do motor existem?
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'canastra'
  AND table_name IN ('promocoes','promocao_codigos','promocao_escopo','promocao_faixas',
                     'promocao_frete','promocao_resgates','pedido_ajustes_desconto',
                     'promocoes_legado')
ORDER BY table_name;
-- esperado: as oito

-- 3. O bloco fiscal chegou ao produto?
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'canastra' AND table_name = 'produtos'
  AND column_name IN ('ncm','cest','origem_fiscal','gtin','unidade',
                      'cfop_padrao','peso_liquido','peso_bruto','codigo_bling','estado')
ORDER BY column_name;
-- esperado: as dez

-- 4. A atribuição chegou ao pedido?
--    As dez colunas listadas à mão, e não `LIKE 'utm_%'`: o `_` é curinga em
--    LIKE (casaria "utmX"), e um OR sem parênteses aqui vazaria para outras
--    tabelas, porque AND liga mais forte que OR.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'canastra'
  AND table_name = 'pedidos'
  AND column_name IN ('utm_source','utm_medium','utm_campaign','utm_content','utm_term',
                      'canal','referrer','landing_page','gclid','fbclid')
ORDER BY column_name;
-- esperado: as dez

-- 5. NENHUMA tabela com vínculo a pessoa é legível por anônimo.
--    Este é o teste que prova que nada vazou. Resultado esperado: ZERO linhas.
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'anon'
  AND table_schema = 'canastra'
  AND table_name IN ('promocao_resgates','consentimentos','envios','admin_log',
                     'pedido_ajustes_desconto','pedidos','clientes');

-- 6. A RLS está ligada em tudo que nasceu nesta leva.
SELECT relname, relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'canastra' AND c.relkind = 'r'
  AND relname IN ('vitrine_heroi','vitrine_texto','promocoes','promocao_codigos',
                  'promocao_escopo','promocao_faixas','promocao_frete','promocao_resgates',
                  'pedido_ajustes_desconto','campanhas','consentimentos','envios',
                  'automacoes','admin_log')
ORDER BY relname;
-- esperado: relrowsecurity = true em TODAS

-- 7. A função que o frontend novo chama existe?
SELECT proname, prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'canastra' AND proname = 'minhas_avaliacoes';
-- esperado: uma linha, prosecdef = true (SECURITY DEFINER)

-- 8. O rascunho não vai para a loja?
SELECT pg_get_viewdef('canastra.produtos_publicos'::regclass, true);
-- esperado: o WHERE terminando em  estado = 'ativo'
```

---

## 8. O que ainda falta, e não é SQL

Duas coisas continuam pendentes e **nenhuma delas se resolve com migração**:

1. **Verificação de navegador.** Toda a validação até aqui foi por teste automatizado e compilação
   (2.634 no frontend, 736 no backend, build verde). Nenhuma tela foi aberta num navegador de
   verdade, porque a máquina de desenvolvimento não tem banco nem API no ar. Depois de migrar:
   `npm --prefix frontend run build && npm --prefix frontend start`, e percorrer `/`, `/cafes`,
   `/sacola`, `/checkout` e as doze telas de `/dashboard` com o console aberto — procurando violação
   de CSP e diferença visual nos diálogos do painel (o preflight do Tailwind voltou a ser global e
   agora alcança os portais do Radix, que antes ficavam fora dos escopos).

2. **As duas decisões humanas**, registradas na spec §7-C: a **série e natureza de operação da
   NF-e** (passa pelo contador — hoje os dois `POST` de emissão vão sem corpo, então 100% da regra
   fiscal vem da conta Bling) e a **política de inadimplência do Clube** (quantas falhas antes de
   avisar, quantas antes de cancelar). Enquanto a segunda não existir, o painel deliberadamente
   **não exibe** indicador de saúde de assinatura: mostrar "ativa" para quem não paga há meses é
   pior que não mostrar nada.
