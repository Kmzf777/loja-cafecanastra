# Painel de gestão — roteiro das ondas

> Spec: `docs/superpowers/specs/2026-08-26-painel-de-gestao-design.md`
> Riscos e checklist de paridade: `docs/pesquisa/2026-08-26-riscos-da-reescrita.md`

A reescrita é grande demais para um plano só. São sete ondas, cada uma produzindo software que
funciona e é testável por conta própria, na ordem que minimiza retrabalho. Cada onda ganha seu
próprio plano detalhado, escrito **antes** de ser executada e **depois** de a anterior estar verde —
escrever os sete de uma vez seria planejar contra um repositório que ainda vai mudar.

| Onda | Plano | Entrega | Depende de |
|---|---|---|---|
| **1 · Fundação** | `2026-08-26-painel-onda-1-fundacao.md` | O núcleo verde: contrato tipado, transporte, lógica portada do legado, infra de teste, anel de acesso fechado, sistema de componentes e o esqueleto do painel navegável | — |
| **2 · Vitrine** | `2026-08-26-painel-onda-2-vitrine.md` | `0030_vitrine.sql`, `GET`/`PUT /vitrine`, a tela `/dashboard/vitrine` com prévia ao vivo, e a home lendo do banco com fallback | 1 |
| **3 · Migrações** | `…-onda-3-migracoes.md` | `0031`–`0035`: motor de promoção, marketing, produto fiscal, auditoria, correções de privilégio — com teste de RLS por papel | 1 |
| **4 · Backend** | `…-onda-4-backend.md` | Motor de promoção calculando, rotas do painel que faltam (`GET /admin/orders/:id`, filtros, busca, `PATCH` de estoque, custo, avaliações, administradores), **e o conserto do `conferirSubtotal`** | 3 |
| **5 · Telas** | `…-onda-5-telas.md` | As demais telas, na ordem leitura-pura → pedidos → bling → produtos → descontos → marketing → relatórios → avaliações → administradores | 1, 4 |
| **6 · Preço e atribuição** | `…-onda-6-preco.md` | Preço "de/por" nos dois vocabulários de card, e captura de UTM | 4, 5 |
| **7 · Corte** | `…-onda-7-corte.md` | Apagar `frontend/legacy/`, remover `styled-components`/`react-router-dom`/`sass`, **fechar o CSP** | 5, 6 |

## Por que esta ordem

**Fundação primeiro porque tudo repete.** Seis telas legadas copiam literalmente a mesma tarja de
erro, três repetem o mesmo algoritmo de paginação e quatro definem um `moeda()` próprio. Construir
tela por tela sem o sistema de componentes é triplicar o trabalho e depois triplicar a correção.

**Migração antes de backend, backend antes de tela.** Tela escrita contra coluna que não existe
quebra no deploy; tela escrita contra rota que não existe é reescrita duas vezes. Hoje não há
`GET /admin/orders/:id` nem filtro em `/admin/orders` — sem isso, ou a tela de Pedidos não tem
deep-link, ou tem um filtro que mente sobre 100 linhas.

**Mas a vitrine editável foi para a frente, e o preço promocional ficou para trás — são coisas
diferentes.** Trocar o herói da home é uma fatia VERTICAL e independente: atravessa migração, RLS,
rota, tela e consumo, sem depender do motor de promoção. Fazer uma fatia fina de ponta a ponta antes
de uma camada grossa prova que as junções funcionam enquanto ainda é barato descobrir que não. Já
**exibir preço promocional é o item de maior risco da spec inteira**: `conferirSubtotal` compara com
tolerância zero o subtotal **sem** promoção, e no dia em que a vitrine exibir e declarar o preço
promocional, toda venda com promoção ativa vira 409 `PRECO_MUDOU` e a loja para de vender. O
conserto é da Onda 4; a exibição é da Onda 6. Nunca ao contrário.

**O corte por último e não antes**, porque apagar `frontend/legacy/` leva junto os únicos testes que
cobrem regra que o painel novo reimplementa: 21 casos de `blingContrato.test.ts` e 11 de
`api.test.ts`. Eles são portados na Onda 1 — o corte só remove o que já não é a única cópia.

## O que fica de fora, e onde está registrado

`estetica.md` §2 rejeita carrossel de banner; sistema de banners múltiplos e CMS de blocos não
entram. Dunning e autogestão do Clube são reais e valiosos (itens #11 e #12 do top 15 da pesquisa),
mas são o Clube, não o painel. Melhor Envio vive em `worktree-melhor-envio`. As razões completas
estão em §8 da spec.

## As duas decisões que esperam resposta humana

1. **Série e natureza de operação da NF-e** — os dois `POST` de emissão vão sem corpo nenhum, então
   100% da regra fiscal vem da conta Bling. Passa pelo contador.
2. **Política de inadimplência do Clube** — quantas falhas antes de avisar, quantas antes de
   cancelar. Enquanto não houver política, o painel não exibe indicador de saúde de assinatura:
   mostrar "ativa" para quem não paga há meses é pior que não mostrar nada.
