# Onda 3I — Avaliações de produto: migração 0014, vitrine, JSON-LD e moderação

> Plano detalhado da onda I do plano mestre (`2026-08-20-plano-mestre-pendencias.md`).
> Implementação com TDD; o orquestrador commita.

**Goal:** quem RECEBEU um café pode avaliá-lo (nota 1–5, título, texto); a PDP
exibe as avaliações aprovadas em tom sóbrio (estetica.md §2: "sem selo de 5
estrelas flutuante") e o Product JSON-LD ganha `aggregateRating` quando há
avaliação aprovada; o painel legado ganha uma tela de moderação simples
(aprovar/ocultar). A fronteira é a RLS — nenhum servidor no meio.

## Fatos medidos (não supor)

- `pedidos.itens` é o `validatedItems` do PaymentController: cada item tem
  `product_id, name, image, price, quantity, size, weight, width, height,
  length` — **NÃO tem `sku`**. Logo `pode_avaliar(alvo_sku)` faz join de
  `itens->>'product_id'` com `canastra.produtos.produto_id` e compara
  `produtos.sku`.
- O catálogo editorial casa com o banco pelo `skuLoja` (= `produtos.sku`;
  `lib/catalogo/repositorio.ts`). Uma linha (PDP) tem VÁRIOS SKUs — um por
  peso/pacote — então a busca de avaliações da PDP é por lista de SKUs.
- A PDP é estática (`generateStaticParams`, `dynamicParams = false`) e hoje SEM
  `revalidate`: o `aggregateRating` congelaria no build. Entra
  `export const revalidate = 3600`.
- `criarClienteServidor()` usa `cookies()` → tornaria a PDP dinâmica. A busca
  do agregado no servidor é `fetch` cru ao PostgREST com a chave anônima e
  `Accept-Profile: canastra`, com `next: { revalidate: 3600 }`.
- O painel legado JÁ importa `frontend/lib/supabase/cliente` (ver
  `legacy/api.js`) — importar o client tipado numa tela `.jsx` funciona no
  mesmo bundler. A moderação fala PostgREST direto (RLS `eh_admin()` decide).
- `ALTER DEFAULT PRIVILEGES` de 0001: `authenticated` nasce com arwd na tabela
  nova; `anon` nasce sem nada. O fecho é REVOKE + GRANTs explícitos.
- `backend/test/instalacao.test.js` compara `instalacao-completa.sql` em disco
  com o gerador: **regenerar é obrigatório** para a suíte ficar verde. No
  momento da escrita deste plano, 0012/0013 (agentes paralelos) ainda NÃO estão
  na pasta — o arquivo gerado sai sem elas e o orquestrador regenera no
  fechamento (a ordem numérica resolve).

## Decisões

1. **`nome_exibicao` congelado por TRIGGER, não pelo navegador.** BEFORE INSERT
   `SECURITY DEFINER` lê `canastra.clientes.nome` do `NEW.user_id` e SEMPRE
   sobrescreve — o cliente não consegue assinar como outra pessoa, e a
   avaliação sobrevive à conta (`user_id` ON DELETE SET NULL, nome fica).
   A coluna fica FORA do GRANT de INSERT (tentar mandá-la é 42501, barulhento).
2. **`status` fora do GRANT de INSERT**: nasce `'pendente'` pelo DEFAULT e só
   muda pelo GRANT de coluna de UPDATE (`status`, `moderado_em`) + política
   `eh_admin()` — o padrão exato de `pedidos` em 0006 (RLS diz a linha, GRANT
   diz a coluna). Sem isso, o INSERT poderia nascer `'aprovada'` e a moderação
   seria decorativa.
3. **Políticas**: SELECT público (anon+authenticated) só de `status='aprovada'`;
   dono lê as próprias em qualquer status (`eh_cliente() AND user_id=auth.uid()`,
   regra 2 de 0006); admin lê tudo; INSERT `eh_cliente() AND user_id=auth.uid()
   AND pode_avaliar(sku)`; UPDATE só admin; DELETE sem política e sem privilégio
   (só `service_role`).
4. **`pode_avaliar(alvo_sku)`** SECURITY DEFINER (padrão 0006/0008: search_path
   fixo, row_security off, EXECUTE explícito para anon+authenticated+service_role):
   EXISTS de pedido do `auth.uid()` com `status='entregue'` cujo `itens` contém
   um `product_id` cujo `produtos.sku = alvo_sku`. Defensivo contra `itens`
   nulo/não-array (`jsonb_typeof`) e contra `product_id` malformado (compara
   `produto_id::text`, nunca faz cast do jsonb para uuid).
5. **GRANT de SELECT por coluna para `anon`** (sem `user_id`/`moderado_em`):
   visitante não precisa saber o uuid de quem avaliou. `authenticated` lê a
   tabela inteira (o dono filtra as suas por `user_id`; o admin modera).
6. **A vitrine sempre filtra `status=eq.aprovada`** na lista pública: um
   visitante LOGADO soma a política de dono e veria as próprias pendentes no
   meio da lista da PDP sem o filtro.
7. **Módulo `frontend/lib/avaliacoes/`** com dublê de supabase nos testes
   (padrão `lib/conta/cadastro.test.ts`): `listarAprovadas(skus, {pagina})`
   (agregado media+contagem em consulta separada da página — média de página
   seria mentira), `enviarAvaliacao({sku, nota, titulo, texto})` (SQLSTATE →
   frase de loja; 42501 → "disponível depois da entrega"; 23505 → "você já
   avaliou"), `minhasAvaliacoes()`. `servidor.ts` à parte (fetch cru, para a
   PDP estática) — sem `next/headers`, erro vira `null` silencioso.
8. **JSON-LD**: `productJsonLd(lote, variantes, base, avaliacoes?)` — só emite
   `aggregateRating` com `contagem > 0` (não inventar nota é a regra que já
   vale para preço).
9. **PDP**: island `components/catalogo/Avaliacoes.tsx` no FIM da página
   (§7.3 põe [AVALIAÇÕES] por último). Média discreta em Martian Mono
   ("4,8 de 5 · 12 avaliações"), estrelas pequenas aria-hidden. Vazio =
   convite; erro = seção some (não quebra a PDP).
10. **`/pedido/[id]`**: componente `components/conta/AvaliarPedido.tsx` montado
    quando `status === 'entregue'`. Mapeia `product_id → sku` via
    `produtos_publicos` (PostgREST, leitura pública) e esconde itens já
    avaliados (`minhasAvaliacoes`). Radios de estrela com fieldset/legend e
    rótulos, sucesso em `aria-live`.
11. **Painel**: `legacy/components/DashboardSection/Avaliacoes/AvaliacoesManager.jsx`
    com os styled-components de `PromotionsManager.style` (o que CuponsManager
    já faz), filtro por status (pendentes primeiro), aprovar/ocultar via
    `.from("avaliacoes").update({status, moderado_em})`. NÃO edita PainelApp
    nem MenuAside — as linhas vão no relatório.
12. **`lib/supabase/tipos.ts` muda junto com a DDL** (contrato do próprio
    arquivo): tabela `avaliacoes` (Insert estreitado às colunas com GRANT — o
    mesmo espírito do `ItemParaFundir`) e função `pode_avaliar`.

## Tarefas (TDD)

1. **Migração `0014_avaliacoes.sql`** + `backend/test/f7_avaliacoes.test.js`
   (harness real: `subirPostgres` + `comoPapel`):
   - `pode_avaliar` com o formato REAL de `itens` (entregue ✓, enviado ✗,
     sku alheio ✗, itens nulo/objeto ✗ sem erro, anon ✗);
   - INSERT: com pedido entregue passa e nasce pendente com nome congelado;
     sem entrega 42501; intruso (não-cliente) 42501; `status`/`nome_exibicao`
     no INSERT 42501; UNIQUE (user_id, sku) 23505;
   - SELECT: anon só aprovada (e sem `user_id`); dono lê a própria pendente;
     outro cliente não;
   - UPDATE: admin muda status+moderado_em; admin em `nota` 42501; não-admin
     0 linhas; DELETE authenticated 42501, service_role passa;
   - conta apagada: avaliação sobrevive com nome, `user_id` NULL.
2. Regenerar `instalacao-completa.sql` (`node backend/db/gerar-instalacao.js`).
3. **`frontend/lib/avaliacoes/`**: tipos, módulo cliente + testes (dublê),
   `servidor.ts` + teste (stub de `fetch`).
4. **JSON-LD**: `aggregateRating` opcional + testes em `jsonld.test.ts`.
5. **PDP**: `revalidate = 3600` (documentado), busca do agregado no servidor,
   island `Avaliacoes.tsx`, SKUs da linha = `skuLoja` únicos de variantes +
   formatos especiais.
6. **`/pedido/[id]`**: seção "Avalie seus cafés" com `AvaliarPedido`.
7. **Painel**: `AvaliacoesManager.jsx`.
8. Suítes: `npm --prefix backend test` e `npm --prefix frontend run test`
   verdes; relatório com as linhas de PainelApp/MenuAside.

## Fora do alcance

- Editar/excluir avaliação pelo dono (simplicidade; DELETE fica com
  `service_role` para atendimento manual).
- Resposta da loja à avaliação; fotos; denúncia.
- `Review` individual no JSON-LD (só `aggregateRating` — o rich result que
  importa e não exige markup por item).
- E-mail pós-entrega pedindo avaliação (candidato natural à onda de e-mails).
