# Painel de gestão — roteiro das ondas

> Spec: `docs/superpowers/specs/2026-08-26-painel-de-gestao-design.md`
> Riscos e checklist de paridade: `docs/pesquisa/2026-08-26-riscos-da-reescrita.md`

A reescrita é grande demais para um plano só. São seis ondas, cada uma produzindo software que
funciona e é testável por conta própria, na ordem que minimiza retrabalho. Cada onda ganha seu
próprio plano detalhado, escrito **antes** de ser executada e **depois** de a anterior estar verde —
escrever os seis de uma vez seria planejar contra um repositório que ainda vai mudar.

| Onda | Plano | Entrega | Depende de |
|---|---|---|---|
| **1 · Fundação** | `2026-08-26-painel-onda-1-fundacao.md` | O núcleo verde: contrato tipado, transporte, lógica portada do legado, infra de teste, anel de acesso fechado, sistema de componentes e o esqueleto do painel navegável | — |
| **2 · Migrações** | `…-onda-2-migracoes.md` | `0030`–`0035`: motor de promoção, vitrine, marketing, produto fiscal, auditoria, correções de privilégio — com teste de RLS por papel | 1 |
| **3 · Backend** | `…-onda-3-backend.md` | Motor de promoção calculando, rotas do painel que faltam (`GET /admin/orders/:id`, filtros, busca, `PATCH` de estoque, custo, avaliações, administradores), **e o conserto do `conferirSubtotal`** | 2 |
| **4 · Telas** | `…-onda-4-telas.md` | As 14 telas, na ordem leitura-pura → pedidos → bling → produtos → vitrine → descontos → marketing → relatórios → avaliações → administradores | 1, 3 |
| **5 · Vitrine** | `…-onda-5-vitrine.md` | Preço "de/por" nos dois vocabulários de card, herói e barra de aviso vindos do banco, captura de UTM | 3, 4 |
| **6 · Corte** | `…-onda-6-corte.md` | Apagar `frontend/legacy/`, remover `styled-components`/`react-router-dom`/`sass`, **fechar o CSP** | 4, 5 |

## Por que esta ordem

**Fundação primeiro porque tudo repete.** Seis telas legadas copiam literalmente a mesma tarja de
erro, três repetem o mesmo algoritmo de paginação e quatro definem um `moeda()` próprio. Construir
tela por tela sem o sistema de componentes é triplicar o trabalho e depois triplicar a correção.

**Migração antes de backend, backend antes de tela.** Tela escrita contra coluna que não existe
quebra no deploy; tela escrita contra rota que não existe é reescrita duas vezes. Hoje não há
`GET /admin/orders/:id` nem filtro em `/admin/orders` — sem isso, ou a tela de Pedidos não tem
deep-link, ou tem um filtro que mente sobre 100 linhas.

**A vitrine por último entre as construtivas**, porque exibir preço promocional é o item de maior
risco da spec inteira: `conferirSubtotal` compara com tolerância zero o subtotal **sem** promoção, e
no dia em que a vitrine exibir e declarar o preço promocional, toda venda com promoção ativa vira
409 `PRECO_MUDOU` e a loja para de vender. O conserto é da Onda 3; a exibição é da Onda 5. Nunca ao
contrário.

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
