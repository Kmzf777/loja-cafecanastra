# Riscos da reescrita do painel — o que se perde se ninguém perceber

> Consolidado em 26/08/2026 a partir dos 8 mapeamentos de `2026-08-26-mapa-do-terreno.md`.
> Esta é a lista que impede regressão silenciosa. Ler antes de tocar em qualquer tela.

---

## 1. Riscos, por gravidade

### CRITICO

**O formulário de produto envia weight/width/height/length sem ter input para nenhum dos quatro: `undefined` vira a string "undefined" no FormData, o backend não consegue parsear e aplica os padrões 0,3 kg / 20 / 5 / 20 cm em TODA edição. A loja cota frete errado sem sinal na tela — e o comentário do arquivo diz que esse bug foi corrigido, o que faz a reescrita copiar o defeito achando que copia a correção.**

- **Onde mora:** frontend/legacy/components/DashboardSection/GProducts/form/Form.jsx:394-397 (envio) e o JSX entre 517-533 (inputs ausentes); padrões em backend/src/repositories/dashboardRepository.js:75-78
- **Como mitigar:** Criar os quatro inputs no formulário novo, carregar os valores reais no load e barrar o submit quando qualquer um vier vazio. Teste de regressão: editar só o preço de um produto com medidas customizadas e conferir que peso/dimensões não mudaram no banco.

**PUT /promotions/:id NÃO é parcial: o repositório escreve todas as colunas com o que veio no corpo, e campo ausente vira NULL. Um formulário novo que envie só o campo alterado apaga título, datas, categoria e produto. E a rota não confere existência — PUT num id inexistente responde 200 "Promoção atualizada." tendo atualizado zero linhas.**

- **Onde mora:** backend/src/repositories/promotionsRepository.js:159-178; o legado sempre monta o objeto inteiro em frontend/legacy/.../OffersAndCupons/PromotionsManager.jsx:124
- **Como mitigar:** Ou o painel novo continua enviando o objeto COMPLETO em todo PUT (inclusive no toggle de ativo), ou o backend ganha UPDATE dinâmico + checagem de linhas afetadas (404) numa tarefa anterior à tela. Não misturar os dois modelos.

**Editar uma promoção fora da janela de datas a desativa permanentemente e a torna inalcançável pela tela: o load MUTA `p.active = false` quando a data está fora da janela, handleEdit leva esse valor mutado para o formulário, o submit grava `ativa = false`, e o botão de reativar fica `disabled` pela mesma regra de janela.**

- **Onde mora:** frontend/legacy/.../PromotionsManager.jsx:84-107 (mutação), :113-120 (handleEdit), :161-165 (submit), :329-332 (botão travado)
- **Como mitigar:** Nunca mutar o objeto do servidor. Derivar "vigente/expirada" para exibição sem tocar em `active`, e nunca desabilitar o toggle por causa da janela — corrigir a data é justamente o que o gestor precisa fazer.

**PUT /config parece total e é parcial ao contrário: o UPDATE só inclui o que não for `undefined`, mas como o corpo chega por multipart, um campo enviado VAZIO ('') sobrescreve. `Number('')` é 0, e 0 DESLIGA o frete grátis da loja inteira. Um formulário controlado ingênuo que sempre envia todos os campos apaga configuração de produção.**

- **Onde mora:** backend/src/repositories/configRepository.js:69-82; o contorno legado está em frontend/legacy/.../UpdateShopInfo/UpdateInfo.jsx:230-243
- **Como mitigar:** Manter a regra de omitir campo vazio do FormData, e escrever teste que salve a configuração com o campo de frete em branco provando que o valor no banco não mudou. Idem para o mínimo de cupom, onde vazio vira `null` e não `0`.

**A ordem de registro das rotas é load-bearing e o Express casa na ordem. Três pares quebram se invertidos: `/dashboard/summary` antes de `/dashboard/:id` (invertido, o summary vira produto de id "summary" e responde 404 PÚBLICO), `/admin/orders/export` antes de qualquer `/admin/orders/:id`, e `/users/me` antes de `/users/:id`.**

- **Onde mora:** backend/src/routes/products.routes.js:15 vs :28; backend/src/routes/orders.routes.js:32-39; backend/src/routes/conta.routes.js:575-584
- **Como mitigar:** Se a reescrita tocar as rotas (para acrescentar GET /admin/orders/:id, por exemplo), preservar a ordem e manter os comentários que a explicam. Teste que faça GET /dashboard/summary sem token e exija 401/403, nunca 404.

**Cinco rotas de LEITURA são PÚBLICAS de propósito — GET /dashboard, /dashboard/:id, /config, /promotions, /options não têm middleware nenhum. Parece bug. Um painel novo que "conserte" isso pondo isAdmin derruba a vitrine inteira, que consome as mesmas rotas em Server Component sem sessão.**

- **Onde mora:** backend/src/routes/products.routes.js:24,28,32; promotions.routes.js:13; options.routes.js:10; consumidor em frontend/lib/catalogo/repositorio.ts:79
- **Como mitigar:** Documentar as cinco como públicas por contrato. Se incomodar expor `quantity` e dimensões publicamente, a saída é uma rota admin nova, nunca fechar a existente.

**A tela de Avaliações não passa pelo Express: fala direto com o PostgREST e depende de RLS + GRANT de coluna. Um não-admin atualiza ZERO linhas SEM ERRO (semântica do USING) — sem conferir `count:"exact"` o toast MENTE sucesso e nada muda no banco.**

- **Onde mora:** frontend/legacy/components/DashboardSection/Avaliacoes/AvaliacoesManager.jsx:185-200 (o `if (!count) throw`), :207-213 (o refetch quando count !== ids.length); GRANT em backend/db/migrations/0014_avaliacoes.sql:248
- **Como mitigar:** Decidir o modelo de acesso ANTES de desenhar a tela (item das decisões abertas). Ficando no PostgREST: cliente com `db:{schema:"canastra"}` (sem isso todo `.from()` responde 404), colunas explícitas, `count` conferido em todo update e `moderado_em` escrito à mão (não há trigger de moddatetime).

**Só 401 pode disparar renovação de sessão. O backend responde 403 com corpo `{message:"Sua conta ainda não está vinculada a esta loja."}` para um token PERFEITAMENTE VÁLIDO. Tratar isso como sessão expirada cria um laço infinito de refresh contra o GoTrue — já aconteceu neste projeto.**

- **Onde mora:** backend/src/middleware/isAuthenticated.js:307-316; a defesa está em frontend/legacy/api.js:56-95 (e a retentativa só ocorre se o token REALMENTE mudou)
- **Como mitigar:** Portar `authFetch` com a regra intacta (401 renova uma vez e só se o token mudou; 403 sobe inteiro) e manter os testes de frontend/legacy/api.test.ts, movendo-os para lib/ antes de apagar legacy/.

**Os 401/403 do isAuthenticated são `sendStatus` — resposta com corpo VAZIO, sem JSON. Um cliente novo em TypeScript que faça `await res.json()` sem catch quebra com SyntaxError justamente no caminho de sessão expirada, que é o menos testado.**

- **Onde mora:** backend/src/middleware/isAuthenticated.js:239,261,280,284,290; o legado sempre usa `.json().catch(() => ({}))`
- **Como mitigar:** Um único helper de leitura de resposta que faça `res.json().catch(() => ({}))` e nunca confie em corpo. Teste unitário com resposta 401 de corpo vazio.

**Produção está OITO migrações atrás (banco na 0008, repositório na 0016). Toda coluna de 0009 em diante — CHECK de status, frete_gratis_minimo_centavos, cupons, newsletter, bling_*, nfe_*, redigido_em, avaliacoes, assinaturas — NÃO EXISTE no banco real. Um painel novo escrito contra o schema do repositório quebra contra produção.**

- **Onde mora:** backend/db/migrations/0009 a 0016; memória do projeto "producao-oito-migracoes-atras"
- **Como mitigar:** Migrar produção ANTES de construir tela que dependa de coluna nova, ou construir com degradação explícita (as telas legadas já fazem isso: 404 vira "módulo ainda não disponível neste servidor"). Decidir isso na primeira semana, não na véspera do corte.

### ALTO

**A tarja de erro não é enfeite: é a diferença entre "zero" e "não sei". Zero produtos, zero pedidos e zero vendas são números plausíveis; mostrar o estado inicial depois de um fetch falho é informação errada apresentada com toda a confiança. Um `if (!data.length) return <Vazio/>` ingênuo apaga essa distinção em seis telas de uma vez.**

- **Onde mora:** frontend/legacy/.../Home/HomeDashboard.jsx:55-63,115-130; .../addedProducts/AddedProducts.jsx:45-47,171-180 (com `{!erro && <EmptyState>}`)
- **Como mitigar:** Um componente único de estado de carga com três estados explícitos (carregando / vazio-confirmado / erro), onde vazio-com-erro se cala. E manter a ordem das guardas: `if (loading)` ANTES do teste de lista vazia.

**O CORS aceita exatamente três cabeçalhos: Content-Type, Authorization, Accept. Qualquer header novo (X-Request-Id, tracing, CSRF) faz o PREFLIGHT falhar e o erro no console é de CORS, não de autenticação — dez minutos de investigação na direção errada. Exceção crítica: `Idempotency-Key` é LIDO pelo checkout e NÃO está na lista.**

- **Onde mora:** backend/src/index.js:87; leitura em backend/src/controllers/PaymentController.js:420-426 (com fallback silencioso para uuidv4)
- **Como mitigar:** Não introduzir header nenhum no painel novo sem antes acrescentá-lo ao allowedHeaders. E conferir em produção se o Idempotency-Key está passando — se não estiver, a defesa contra cobrança duplicada sumiu SEM erro nenhum.

**Erro de upload do multer vira 500 genérico. Arquivo acima de 5 MB, mais de 2 arquivos ou mimetype fora de [jpeg,png,webp,avif] lança ANTES do handler e cai no error handler global, que responde `{message:"Erro interno no servidor."}`. A frase "Formato não aceito. Envie JPG, PNG, WebP ou AVIF." NUNCA chega ao navegador.**

- **Onde mora:** backend/src/middleware/multer.js:44-65; handler global em backend/src/index.js:201-204
- **Como mitigar:** Validar tamanho e mimetype no cliente antes de enviar (mensagem correta e imediata), e/ou acrescentar um error handler de multer no Express que traduza o erro. Sem isso, o gestor que subir um HEIC lê "Erro interno".

**A exportação de pedidos baixa a base INTEIRA com CPF e e-mail de todos os clientes quando as datas ficam vazias — sem confirmação, sem teto de linhas e sem registro de auditoria. E o download precisa ser por BLOB: a rota exige Authorization e um `<a href>` chega sem token e volta 401.**

- **Onde mora:** frontend/legacy/.../Orders/Orders.jsx:324-361 (blob) e :557-559 (a legenda que admite exportar tudo); colunas em backend/src/utils/csvDePedidos.js:138-155
- **Como mitigar:** Manter o blob e o formato do CSV (BOM + separador ';' + vírgula decimal, senão o Excel BR do chefe quebra). Acrescentar confirmação explícita quando as datas estiverem vazias e registrar quem exportou. A memória do projeto já registra CSVs de dados pessoais no histórico do Git.

**As unidades monetárias são inconsistentes dentro do mesmo schema e da mesma tela: `total_amount`, `shipping_cost` e `discount` vêm em REAIS como STRING (numeric do pg), enquanto `minimo_centavos`, `descontoCentavos`, `preco_centavos` e `frete_gratis_minimo_centavos` vêm em CENTAVOS como inteiro. É o erro mais barato de cometer e o mais caro de descobrir.**

- **Onde mora:** backend/src/repositories/cuponsRepository.js:14-17 (centavos), ordersRepository.js:29-46 (reais); a tela de Assinaturas tem um `moeda()` próprio que divide por 100 em AssinaturasManager.jsx:38-42
- **Como mitigar:** Tipar a unidade no nome (`totalReais` vs `totalCentavos`) e ter dois formatadores distintos e nomeados, nunca um `moeda()` que adivinha. Marcar o campo na camada de contrato, não na tela.

**As frases de erro do servidor SÃO o diagnóstico. Substituí-las por "Erro ao salvar" destrói o suporte: o gestor abre chamado por algo que resolveria sozinho em dois minutos ("Já existe um produto com este SKU.", "SKU tal não está cadastrado no Bling", "nota gerada mas não transmitida").**

- **Onde mora:** A regra está em frontend/legacy/.../Bling/blingContrato.js:243-292 (fraseDeErro: message > error > fallback por status). Os dois pontos que HOJE jogam a frase fora são PromotionsManager.jsx:200-203 e ManageCategories.jsx:70
- **Como mitigar:** Portar `fraseDeErro` como helper único do painel e usá-la em TODA tela. Corrigir os dois pontos que descartam a frase — não copiar o defeito.

**A ordem das perguntas de `estadoDoBling` é a ordem da vida do documento fiscal, e nenhuma outra é honesta. `nfe_chave` vem primeiro porque a chave só existe depois da autorização da SEFAZ; `nfe_numero` SEM chave é o estado que mais precisa de destaque porque PARECE resolvido e não está. Reordenar produz uma tela que diz "tudo certo" sobre uma nota que nunca chegou à SEFAZ.**

- **Onde mora:** frontend/legacy/.../Bling/blingContrato.js:78-152; o backend usa o mesmo critério em backend/src/services/blingPedidos.js:593
- **Como mitigar:** Portar `blingContrato.js` como está — é lógica pura, sem React e sem fetch, com 270 linhas de teste em blingContrato.test.ts que continuam valendo. Só as cores hexadecimais viram tokens Tailwind.

**Mesclar a resposta do Bling com spread apaga colunas da tabela. A linha de /admin/orders traz `address`, `user_name`, `user_email` e `user_cpf` que a resposta de /bling NÃO tem; `{...linha, ...pedido}` funcionaria hoje por acaso e passaria a apagar dados do cliente no dia em que os contratos divergirem mais um pouco.**

- **Onde mora:** frontend/legacy/.../Bling/blingContrato.js:209-241 (mesclarPedido, lista congelada de 9 campos)
- **Como mitigar:** Manter a mescla campo a campo com a lista explícita. Vale para qualquer tela do painel que atualize uma linha com resposta parcial de outra rota.

**A trava de duplo clique do Bling está num `useRef` e não no estado, de propósito: `setState` é assíncrono e dois cliques no mesmo tick leem o mesmo estado "livre". Migrar para `useState` reintroduz a corrida sem nenhum sintoma em teste manual — e as três ações mexem na mesma linha do banco.**

- **Onde mora:** frontend/legacy/.../Bling/useBlingAcoes.js:309-349; a trava é POR PEDIDO (sincronizar A enquanto B emite nota)
- **Como mitigar:** Portar o hook com o ref. Mesma regra vale para o submit de cupom (CuponsManager.jsx:85-87), que hoje já tem trava, e para o de config e promoções, que NÃO têm.

**O painel legado mantém CÓPIAS locais de regra do backend que precisam ser reconciliadas: os 9 status estão copiados em três lugares e o backend recusa com 400 qualquer outro valor — em especial o vocabulário antigo em inglês. Reescrever com valores em inglês, ou traduzir os VALORES em vez dos rótulos, quebra toda mudança de status.**

- **Onde mora:** Orders.jsx:52-62, HomeDashboard.jsx:34-44, blingContrato.js:69-73; fonte em backend/src/utils/statusDePedido.js:15-31 e o CHECK da migração 0009
- **Como mitigar:** Uma única constante compartilhada no painel novo, derivada do vocabulário do backend, com os rótulos em português separados dos valores. Teste que compare a lista do painel com a lista do backend.

**Route Handler NÃO passa por layout: um `app/dashboard/(protegido)/exportar/route.ts` nasceria ABERTO. E há um teste de inventário que lê o disco com readdirSync e falha se aparecer qualquer `route.ts` sob /dashboard, ou qualquer pasta fora dos grupos (protegido)/(publico) — a reescrita fica vermelha no primeiro commit que criar uma rota de exportação ou de upload.**

- **Onde mora:** frontend/app/dashboard/(protegido)/layout.tsx:24-30 (o buraco declarado) e frontend/lib/conta/painel-servidor.test.ts:315-383 (o teste de estrutura)
- **Como mitigar:** Antes de criar a primeira rota de API do painel, exportar um helper de checagem reutilizável em handler/Server Action e trocar o teste de "nenhum route.ts" por "todo route.ts chama a checagem". Não "consertar" o teste apagando a asserção.

**Não existe GET /admin/orders/:id, nem filtro/busca em /admin/orders e /auth/users (aceitam só page e limit). Uma rota /dashboard/pedidos/[id] renderizada no servidor não tem a lista em memória, e uma tabela com filtros sobre uma página de 100 linhas seria mentira — a fila do Bling já admite esse custo em texto na tela.**

- **Onde mora:** backend/src/repositories/ordersRepository.js:170-238; backend/src/routes/conta.routes.js:415-448; a confissão em frontend/legacy/.../Bling/BlingManager.jsx:45-52,478-511
- **Como mitigar:** Abrir as rotas no backend ANTES de desenhar as telas de Pedidos e Clientes. Se ficar sem, copiar a honestidade do legado: dizer na tela que o filtro olha só a página carregada.

**Não existem campos fiscais em canastra.produtos (NCM, CEST, origem, CFOP, GTIN, unidade, peso líquido/bruto) e a loja nunca cria produto no Bling — só confere por SKU. Um produto sem NCM PASSA na sincronização e só falha na transmissão da NF-e à SEFAZ, no pior momento possível: com o pedido do cliente parado.**

- **Onde mora:** backend/db/migrations/0003_catalogo.sql:13-35 (16 colunas, nenhuma fiscal); backend/src/services/blingPedidos.js:286-305; os dois POST de NF-e vão SEM CORPO em :609 e :630
- **Como mitigar:** É o item que decide a aceitação do chefe. Acrescentar as oito colunas na migração nova, validar completude em validarProduto (dashboardRepository.js:45) e criar um filtro "produtos sem NCM/GTIN/peso" na listagem — antes de ligar BLING_NFE_AUTO.

### MEDIO

**O bundle do painel carrega toda a lógica de carrinho e promoções da vitrine morta, desligada em TEMPO DE EXECUÇÃO por uma constante `ehPainel`. Sem essa guarda, o admin vê toasts de loja ("O estoque de alguns itens mudou.") no meio do cadastro de produto e duas requisições inúteis em todo load.**

- **Onde mora:** frontend/legacy/contexts/productContext/productContextProvider.jsx:16-26,139-148,237
- **Como mitigar:** A reescrita elimina o problema pela raiz (contexto próprio do painel), mas é preciso inventariar o que do productContext o painel realmente usa: dataForm, updateProductList, isLoading, page/setPage, totalPages, total, value/setValue, productId/setProductId, setDataForm — e nada mais.

**Apagar frontend/legacy/ leva junto os únicos testes que cobrem comportamento que o painel novo vai precisar reimplementar: 21 casos de blingContrato.test.ts (a regra de NF-e) e 11 de api.test.ts (token, renovação única no 401, não-renovação no 403 e o guarda de admin).**

- **Onde mora:** frontend/legacy/components/DashboardSection/Bling/blingContrato.test.ts; frontend/legacy/api.test.ts:245-276
- **Como mitigar:** MOVER blingContrato.js + teste e a lógica de authFetch + teste para lib/ ANTES de apagar legacy/. É um passo próprio na ordem de construção, não um detalhe do último commit.

**Não existe ambiente de DOM no frontend (`environment: "node"`, sem jsdom nem testing-library). Painel administrativo é interativo por definição — filtro, paginação, formulário, confirmação de exclusão — e NENHUMA dessas coisas tem hoje como ficar vermelha. `renderToStaticMarkup` não executa efeito, então ilha de cliente que busca dados renderiza string vazia e o teste passa provando nada.**

- **Onde mora:** frontend/vitest.config.ts:35; o limite documentado em frontend/components/catalogo/Avaliacoes.test.ts:11-16
- **Como mitigar:** Instalar jsdom/happy-dom + testing-library com `environmentMatchGlobs` só para app/dashboard/**, e criar frontend/lib/teste/ com os helpers compartilhados (o molde de cliente Supabase falso e de fila de fetch já existe em legacy/api.test.ts:40-125).

**A suíte do backend só passa serial, e a flag `--test-concurrency=1` não está no package.json nem no workflow — cada arquivo sobe o SEU próprio cluster Postgres. Num repositório em reescrita, vermelho intermitente por infraestrutura envenena a leitura de todo diff.**

- **Onde mora:** backend/package.json:23 e .github/workflows/ci.yml:56; a flag só aparece em prosa de docs/superpowers/plans/
- **Como mitigar:** Acrescentar a flag nos dois lugares e criar .gitattributes (o teste de instalação falha por CRLF no Windows, não por desatualização). São dois commits de 5 minutos que valem por semanas de ruído.

**Se a reescrita do painel encostar na vitrine para mostrar preço promocional, `conferirSubtotal` tem TOLERÂNCIA ZERO e compara o subtotal DE VITRINE, sem promoção. Toda venda com promoção ativa vira 409 PRECO_MUDOU e a loja para de vender.**

- **Onde mora:** backend/src/controllers/PaymentController.js:184-213
- **Como mitigar:** Tratar "exibir preço promocional" como tarefa própria, com a mudança de conferirSubtotal no MESMO commit. Não é escopo do painel, mas é a consequência direta de o painel finalmente tornar promoções gerenciáveis.

**A numeração de migração 0017 está TRIPLAMENTE disputada (worktrees melhor-envio e whatsapp-bot já ocupam), e o runner ABORTA em número repetido. O painel novo vai precisar de migração (campos fiscais, banners, auditoria) e criar um 0017 próprio quebra o merge.**

- **Onde mora:** backend/db/migrar.js:167-175; .claude/worktrees/melhor-envio/.../0017_melhor_envio.sql e .claude/worktrees/whatsapp-bot/.../0017_whatsapp_meta.sql (até 0021)
- **Como mitigar:** Combinar a numeração antes de escrever qualquer .sql — número seguro assumindo merge de tudo é 0022. E lembrar que a chave em canastra.migracoes é o NOME COMPLETO do arquivo: renomear uma migração já aplicada faz ela rodar de novo.

**`canastra.produtos` é a única relação com privilégio de SELECT por COLUNA em que o painel escreve — `RETURNING *`, inclusive o `.select()` implícito do supabase-js, responde 42501 ATÉ para o admin. E não há caminho nenhum para o painel ler `produtos.custo`, então uma tela de margem bate em 42501 sem aviso legível.**

- **Onde mora:** backend/db/migrations/0006_politicas_rls.sql:193-234 (o efeito medido) e :182-191 (a decisão adiada explicitamente para "a tarefa que construir o painel")
- **Como mitigar:** Decidir antes de desenhar a tela de produtos: ou rota admin no Express (que conecta como dono e enxerga tudo), ou função SECURITY DEFINER com eh_admin() na frente. E sempre projetar colunas por nome, nunca `*`.

**Não há caminho de aplicação nenhum para criar, listar ou remover administrador — a única escrita em canastra.admins do repositório está no script de instalação. Promover um segundo gestor exige psql em produção, e a senha do painel é irrecuperável. É ponto único de falha operacional.**

- **Onde mora:** backend/db/gerar-instalacao.js:316; a política admins_admin_le (0006:382) foi criada "porque o painel mostra a lista de administradores" — para uma tela que nunca existiu
- **Como mitigar:** Tela de administradores no escopo da reescrita, com rota nova no Express. A trigger admins_nunca_zero (0002:118) já cobre a remoção do último, mas a tela precisa avisar ANTES de tentar.

**Uma cobrança do Clube que FALHA não tem tratamento nenhum: nasce um pedido `rejeitado` poluindo a tela de Pedidos, o admin recebe o e-mail rotineiro "Novo Pedido Recebido" e o cliente um "Problema no pedido #xxxx" que nem menciona assinatura — e o status da assinatura continua `ativa` para sempre. Um painel novo que mostre "ativa" mente sobre quem não paga há meses.**

- **Onde mora:** backend/src/controllers/ClubeController.js:665,856; backend/src/utils/emailSender.js:36-41; o CHECK fechado de status em 0015_assinaturas.sql:61-63
- **Como mitigar:** Não prometer na tela nova nenhum indicador de saúde da assinatura antes de existir dunning. Se for construir: migração acrescentando contador de falhas + tabela de eventos (não há histórico algum hoje), gatilho em ClubeController.js:665 que já distingue cobrança boa de ruim.

**Duas superfícies que o painel edita são write-only: `barra_de_aviso` e os dois banners de config_loja são salvos e a vitrine NUNCA os lê. A imagem de produto que o painel sobe para a Cloudinary também nunca aparece na loja. Uma reescrita fiel reconstrói três botões que mentem.**

- **Onde mora:** Cabeçalho lê o dicionário em frontend/components/layout/Cabecalho.tsx:197-206; a vitrine ignora `image` porque ProdutoDaApi só lê product_id, sku, price e quantity (frontend/lib/catalogo/repositorio.ts:69-118)
- **Como mitigar:** Decisão explícita por campo: ligar na vitrine (barra de aviso é o mais barato — GET /config já devolve announcement_bar) ou remover do painel novo. Não reconstruir sem decidir.

**`productId` mora em memória volátil no context: sair de uma edição sem salvar e clicar em "Cadastrar produto" abre o formulário de EDIÇÃO do produto anterior com o botão "Atualizar" — salvar ali sobrescreve o produto errado achando que criou um novo. Um F5 durante a edição faz o inverso.**

- **Onde mora:** frontend/legacy/.../GProducts/form/Form.jsx:279,432; frontend/legacy/PainelApp.jsx:157; MenuAside.jsx:47
- **Como mitigar:** No painel novo, o id do produto vive na URL (/dashboard/produtos/[id]/editar), nunca em estado global. É correção de graça na reescrita — desde que ninguém porte o context como está.

### BAIXO

**DELETE /dashboard/:id devolve 204 mesmo quando o produto não existe — não há 404. Uma UI nova que confie no status para dizer "excluído" vai mentir. E o painel já mentiu por motivo parecido: sem `if (!resposta.ok)`, um 403 caía no caminho de sucesso e a tela anunciava "Produto deletado!" com o produto intacto.**

- **Onde mora:** backend/src/repositories/dashboardRepository.js:240-252; o histórico em frontend/legacy/.../AddedProducts.jsx:84-91
- **Como mitigar:** Conferir `res.ok` em TODA chamada (fetch não lança em 4xx/5xx) e, para exclusão, recarregar a lista e verificar o sumiço em vez de confiar no 204. Ou acrescentar o 404 no backend.

**Não existe DELETE de promoção nem de cupom em lugar nenhum da pilha, e o painel só oferece "Desativar". Uma promoção criada por engano fica na lista para sempre, e a lista de cupons não tem filtro nem paginação — só cresce.**

- **Onde mora:** backend/src/routes/promotions.routes.js (só POST /, GET /, PUT /:id); backend/src/routes/cupons.routes.js:25-27, que explica que cupom se desativa com PUT {ativo:false}
- **Como mitigar:** Decidir se o backend ganha DELETE (ou soft delete) antes de desenhar as telas; senão, projetar a lista assumindo crescimento infinito — com filtro por ativo/expirado e busca por código, que hoje também não existem.

---

## 2. Checklist de paridade

Toda regra de negócio que hoje vive dentro das telas legadas e precisa sobreviver à reescrita.

- [ ] CHASSI — Administrador é LINHA em canastra.admins, nunca claim de JWT, user_metadata ou app_metadata: a instância Supabase é compartilhada e um projeto vizinho pode cunhar o claim que quiser (canastra.eh_admin() em 0006:120; isAuthenticated.js:93-97; painel-servidor.ts:292)
- [ ] CHASSI — Dois anéis de guarda, que resolvem problemas diferentes: o de servidor impede que o bundle chegue a um anônimo (app/dashboard/(protegido)/layout.tsx:47), o de cliente percebe a sessão que morre com o painel JÁ ABERTO (AdminRoutes.jsx:42-77). Não remover um pelo outro
- [ ] CHASSI — Falha de CONSULTA fecha o acesso mesmo com ehAdmin true (painel-servidor.ts:78-81), e lerPapel cai para 'cliente' quando a consulta falha (sessao.ts:264-271). Inverter abre a gestão justamente durante uma queda de rede
- [ ] CHASSI — ehFalhaDeInfraestrutura escrita pelo lado estreito: SÓ 4xx conta como 'o servidor respondeu que não'; AuthRetryableFetchError carrega status 0 e a regra ingênua o classificaria errado (painel-servidor.ts:226-234)
- [ ] CHASSI — O ?de= é validado por `new URL` contra base inventada, nunca por casamento de prefixo: a versão anterior recusava '..' e %2e%2e passava inteiro (painel-servidor.ts:162-196)
- [ ] CHASSI — Sair da área do painel exige navegação dura (window.location.replace/assign); <Navigate> para rota do App Router produz 'Unexpected Application Error / 404' (AdminRoutes.jsx:25-40; Dashboard.jsx:262-265)
- [ ] CHASSI — Todo Route Handler e Server Action do painel chama a checagem de admin na própria função: layout não protege handler (layout.tsx:24-30)
- [ ] TRANSPORTE — O token vem do cliente Supabase a cada chamada, nunca do estado do React (getSession() é também o gatilho da renovação) — api.js:34-53
- [ ] TRANSPORTE — Só 401 dispara renovação, e a retentativa só acontece se o token REALMENTE mudou; 403 sobe intacto (api.js:56-95)
- [ ] TRANSPORTE — Nunca enviar cabeçalho fora de Content-Type, Authorization e Accept: o preflight falha e o erro aparece como CORS (index.js:87)
- [ ] TRANSPORTE — credentials:'include' fica dos dois lados (é do preflight, não de cookie de sessão)
- [ ] TRANSPORTE — Toda leitura de corpo usa .json().catch(() => ({})): 401/403 vêm com corpo VAZIO
- [ ] TRANSPORTE — Toda resposta confere res.ok antes do caminho de sucesso: fetch não lança em 4xx/5xx
- [ ] TRANSPORTE — FormData vai cru (sem Content-Type manual); JSON é serializado; GET/HEAD não montam corpo (api.js:101-119)
- [ ] MENU — 6 grupos, 11 links + Home, com Bling dentro de 'Gestão de pedidos' porque o gestor chega vindo de um PEDIDO (MenuAside.jsx:72-76)
- [ ] MENU — O menu fecha sozinho a cada mudança de rota; quando aberto em mobile trava o scroll do body
- [ ] HOME — Três cartões (produtos cadastrados, pedidos totais, clientes registrados) vindos de counts do /dashboard/summary
- [ ] HOME — Gráfico de barras 'Vendas (últimos 7 dias)' agrupado por DD/MM, contando só GRUPO_ATIVO menos 'pendente' e 'autorizado' (dashboardRepository.js:344-361); vazio = 'Nenhuma venda registrada nos últimos 7 dias.'
- [ ] HOME — Pizza 'Status dos Pedidos' com os 9 status TRADUZIDOS para exibição (os valores continuam em português do banco); vazio = 'Ainda não há pedidos.'
- [ ] HOME — Tarja de erro ANTES dos números, com duas frases distintas: !res.ok = 'Não foi possível carregar os números agora.'; catch de rede = 'Não foi possível falar com o servidor.'
- [ ] PRODUTO/FORM — SKU obrigatório só no cadastro, editável na edição; enviado com trim; o 409 'Já existe um produto com este SKU.' precisa chegar ao gestor com a frase do servidor
- [ ] PRODUTO/FORM — Imagem obrigatória só no cadastro ('Por favor, selecione uma imagem para o produto.'); na edição sem arquivo novo, reenviar a URL da imagem existente como texto
- [ ] PRODUTO/FORM — Peso, largura, altura e comprimento SEMPRE enviados com os valores reais (e com input próprio): sem eles o backend aplica 0,3 kg / 20 / 5 / 20 cm e a loja cobra frete errado
- [ ] PRODUTO/FORM — Preço com onWheel→blur (a roda do mouse não pode alterar preço) e step 0,01
- [ ] PRODUTO/FORM — Estoque por botões -/+, decremento travado em 0, incremento sem teto
- [ ] PRODUTO/FORM — Botão de submit travado até algo mudar na edição, com rótulo 'Atualizar produto' vs 'Adicionar produto' (comparação normalizada por valor, não por String())
- [ ] PRODUTO/FORM — O rótulo visível é 'Embalagem', mas o type da API continua sendo `size` — renomear quebra vitrine e backend
- [ ] PRODUTO/FORM — Validações de servidor não replicadas na tela e que a UI precisa refletir: nome entre 2 e 200 caracteres, preço finito entre 0 e 1.000.000, estoque inteiro >= 0
- [ ] PRODUTO/LISTA — Colunas Imagem, Nome, Preço, Embalagem, Qtd, Categoria, Ações; cards abaixo de 768px com os mesmos dados
- [ ] PRODUTO/LISTA — Confirmação antes de excluir; estado 'Deletando…' com botão travado; conferir res.ok antes de anunciar sucesso; DELETE devolve 204 mesmo para id inexistente
- [ ] PRODUTO/LISTA — `if (loading)` ANTES do teste de lista vazia; com erro, o vazio se CALA (não afirmar 'Nenhum café cadastrado ainda')
- [ ] PRODUTO/LISTA — Paginação com reticências (delta=1) e contador 'Total encontrados: N (Página X de Y)'
- [ ] PRODUTO/LISTA — Zoom de imagem ao clicar na miniatura; URL de imagem prefixada com API_BASE quando não começa com http
- [ ] PEDIDOS — Vocabulário fechado de 9 status em português (pendente, aprovado, em_processamento, autorizado, enviado, entregue, cancelado, rejeitado, reembolsado); o backend recusa com 400 e devolve a lista na mensagem
- [ ] PEDIDOS — Cor por status: aprovado #2e7d32, pendente #f57c00, em_processamento #7b1fa2, autorizado #00838f, enviado #1976d2, entregue #00796b, cancelado/rejeitado #d32f2f, reembolsado #5d4037
- [ ] PEDIDOS — Trocar o status para 'enviado' NÃO envia direto: abre o pedido de código de rastreio; código VAZIO segue vazio de propósito (entrega local não tem código); Enter confirma; cancelar não muda nada e o select volta sozinho
- [ ] PEDIDOS — ID truncado nos 6 últimos dígitos na lista; uuid completo só no detalhe
- [ ] PEDIDOS — Data em pt-BR (só data, sem hora) na lista; total formatado em BRL
- [ ] PEDIDOS — Detalhe com dados do cliente (nome, e-mail, CPF com fallback 'Não informado'), entrega (endereço formatado 'rua, número - bairro, cidade - UF (CEP: x)' com fallbacks 'Rua não inf.'/'S/N'), método e custo de frete, rastreio quando existir, pagamento em maiúsculas, cupom e desconto em verde com sinal de menos
- [ ] PEDIDOS — Pedido antigo cujo `address` não é objeto exibe 'Endereço não disponível (Legado)'; a lista de itens aceita array OU string JSON e devolve [] no catch
- [ ] PEDIDOS — Modal com Escape para fechar, devolução do foco ao elemento que abriu, clique no fundo fecha, role='dialog' aria-modal='true'
- [ ] PEDIDOS — Exportação CSV com datas OPCIONAIS ('Sem datas, exporta todos os pedidos.'), download por BLOB (a rota exige Authorization), nome pedidos-de-AAAA-MM-DD-ate-AAAA-MM-DD.csv, e o CSV com BOM, separador ';' e vírgula decimal para o Excel BR
- [ ] PEDIDOS — Tarja de erro persistente com 'Tentar novamente' e botão de dispensar: toast de 2s some rápido demais para falha de OPERAÇÃO
- [ ] BLING — Três ações na ordem do fluxo real: Sincronizar, Emitir NF-e, Buscar rastreio — e SÓ o rastreio exige sincronia prévia
- [ ] BLING — Cinco estados na ordem da vida do documento fiscal: nfe_chave → nfe_numero sem chave (o que mais precisa de destaque) → bling_situacao 'sincronizando' → bling_id → nada
- [ ] BLING — Só pedidos pagos (aprovado, enviado, entregue) vão ao ERP, com a frase que explica: venda não confirmada não vira pedido de venda nem nota
- [ ] BLING — Cinco filtros de fila (pendentes, sem pedido, sem nota, sem rastreio, todos), cada um com frase de vazio própria; o filtro aplica 'pode ir ao Bling' primeiro e preserva a ordem do servidor
- [ ] BLING — A linha se atualiza com a RESPOSTA da ação, campo a campo (9 campos), sem refetch: refetch faria a fila pular embaixo do dedo do gestor
- [ ] BLING — Frase de erro: corpo.message primeiro, corpo.error depois, e só então o fallback por status (401/403/404/503/504) — código cru sem espaço não é frase
- [ ] BLING — Trava de duplo clique POR PEDIDO, em ref: qualquer ação em voo tranca as três daquele pedido, mas não trava os outros
- [ ] BLING — Sonda /bling/status responde SEMPRE, ligada ou não; enquanto ela não responde, NADA é desabilitado (o servidor continua sendo a autoridade)
- [ ] BLING — Integração desligada mostra caixa AZUL (não vermelha) com instruções de .env: desligada não é erro, é o estado de fábrica
- [ ] BLING — A tela DIZ que o filtro olha só a página carregada, com contagem 'N de M pedidos desta página · página X de Y (T no total)'
- [ ] BLING — Link 'Abrir DANFE da NF-e {número}' quando houver nfe_url
- [ ] BLING — O mesmo bloco de estado e ações aparece no detalhe do pedido, com sincronia dupla (atualizar a lista E a cópia aberta no modal)
- [ ] CLIENTES — Colunas Nome, E-mail, Telefone (fallback '-'), Compras e Ações; `purchases` é a contagem de pedidos do cliente
- [ ] CLIENTES — A lista parte de canastra.clientes e NUNCA de auth.users: a instância é compartilhada e listar auth.users exporia contas de outros projetos
- [ ] CLIENTES — Confirmação nominal antes de excluir ('excluir o usuário "{nome}"? Isso apagará todos os dados dele.') e a frase do servidor no erro, incluindo o 409 de último administrador
- [ ] CATEGORIAS — Duas listas independentes (type=category e type=size) com adicionar e excluir; o rótulo é 'Embalagens' mas o type é `size`
- [ ] CATEGORIAS — O backend recusa excluir opção em uso por algum produto (409): a frase precisa chegar ao gestor, e idealmente a tela deveria sinalizar as opções em uso ANTES da tentativa
- [ ] CATEGORIAS — Não engolir o 409 'Esta opção já existe.' (hoje o painel mostra um genérico 'Erro ao adicionar.')
- [ ] CATEGORIAS — type desconhecido devolve [] com 200, nunca 500
- [ ] CONFIG — Cinco campos (nome da loja, WhatsApp só números, barra de anúncios, frete grátis em reais, e os dois banners com dimensões recomendadas no rótulo)
- [ ] CONFIG — A conversão reais↔centavos vive SÓ nas duas bordas desta tela: entrada divide por 100 com toFixed(2), saída faz Math.round(reais*100)
- [ ] CONFIG — Campo de frete grátis VAZIO não é enviado (o PUT é parcial e vazio zeraria o piso); e 0 DESLIGA o frete grátis, o que precisa estar dito na tela
- [ ] CONFIG — Valor de frete inválido aborta o submit INTEIRO (nem os banners sobem), com a frase 'use reais, ex: 149,00'
- [ ] CONFIG — Erro de rede tem toast próprio: falha silenciosa deixava o gestor achando que salvou
- [ ] PROMOÇÕES — Campos condicionais por applies_to: categoria só quando 'category', produto só quando 'product'
- [ ] PROMOÇÕES — O produto é escolhido em SELECT carregado de /dashboard?limit=200, nunca UUID digitado à mão (um caractere errado apontava para produto nenhum, sem erro em lugar algum)
- [ ] PROMOÇÕES — O PUT é TOTAL: enviar sempre o objeto completo, inclusive no toggle de ativo
- [ ] PROMOÇÕES — Promoção só vale no checkout com AS DUAS datas preenchidas (inicio_em <= now() <= fim_em): salvar ativa sem datas é uma promoção que nunca é aplicada, sem aviso nenhum
- [ ] PROMOÇÕES — Teto de 90% no percentual e valor > 0, validados pelo servidor (percentual acima de 100 fazia o checkout calcular preço negativo que ABATIA dos outros itens)
- [ ] PROMOÇÕES — Só desativar/ativar; não há DELETE em lugar nenhum da pilha
- [ ] PROMOÇÕES — A frase do backend precisa subir para a tela (hoje é capturada e descartada) — corrigir, não copiar
- [ ] CUPONS — Contrato em português puro (codigo, tipo, valor, descricao, minimo_centavos, limite_usos, usos, ativo, inicio_em, fim_em)
- [ ] CUPONS — Código sempre com trim e MAIÚSCULAS (o banco tem CHECK ^[A-Z0-9]{3,30}$)
- [ ] CUPONS — O rótulo do campo de valor muda com o tipo: 'Desconto (%)' ou 'Desconto (R$)' — e a unidade também (percentual 0-100 vs reais)
- [ ] CUPONS — Quatro validações de cliente: valor > 0, percentual até 90 (o teto é do banco, a tela só poupa a ida), mínimo válido, e fim depois do início
- [ ] CUPONS — Campo vazio vira null e NÃO 0: mínimo vazio = sem mínimo, limite vazio = sem limite
- [ ] CUPONS — Trava de duplo clique no submit: dois POSTs do mesmo formulário são dois cupons (ou um 409 confuso)
- [ ] CUPONS — Toggle ativo/inativo por PUT PARCIAL com apenas {ativo: !ativo} — o PUT de cupom, ao contrário do de promoção, é parcial
- [ ] CUPONS — Botão 'Cancelar' na edição, que a tela de promoções não tem
- [ ] CUPONS — Formatadores de listagem: valor ('N%' ou moeda), usos ('N/M' ou 'N/sem limite'), validade ('X a Y' / 'a partir de X' / 'até Y' / 'sem prazo') e mínimo entre parênteses quando houver
- [ ] CUPONS — Não há DELETE: desativar é o caminho, e a lista não tem filtro nem paginação (só cresce)
- [ ] AVALIAÇÕES — Colunas explícitas na consulta, nunca `*`: `*` esconde o que a tela realmente lê e o GRANT por coluna faz select=* falhar
- [ ] AVALIAÇÕES — Paginação NO SERVIDOR por range de 25, ordenada por criado_em desc; nunca Array.filter sobre a página
- [ ] AVALIAÇÕES — Contador de pendentes por consulta separada com head:true (resposta sem corpo, só a contagem), para continuar visível mesmo com o filtro em 'Aprovadas'
- [ ] AVALIAÇÕES — Trocar o filtro ZERA a página; e o erro PGRST103 (página além do fim, porque moderar esvaziou o filtro) volta para a página 0 e NÃO é erro
- [ ] AVALIAÇÕES — Moderação em LOTE por um único UPDATE com count:'exact' sobre `in(id, ids)`: aprovar 25 é uma requisição, não 25
- [ ] AVALIAÇÕES — Se count for 0, lançar erro ('confira se sua conta é de administrador') — a RLS filtra em silêncio e o toast mentiria sucesso
- [ ] AVALIAÇÕES — Se count !== ids.length, é o ÚNICO caso que justifica refetch: parte das linhas escapou e não dá para saber qual
- [ ] AVALIAÇÕES — `moderado_em` escrito à mão em todo update (não há trigger de moddatetime no schema) e SÓ status e moderado_em são graváveis (GRANT por coluna da 0014)
- [ ] AVALIAÇÕES — Texto da avaliação COMPLETO, com whiteSpace pre-wrap e sem reticências: moderar exige ler tudo
- [ ] AVALIAÇÕES — Toast com plural correto e mensagem quando nenhuma das selecionadas mudaria de status
- [ ] AVALIAÇÕES — PGRST205/42P01 viram 'O módulo de avaliações ainda não está instalado neste servidor (migração 0014).'
- [ ] AVALIAÇÕES — Não há DELETE na tela de propósito (é privilégio de service_role): 'Ocultar' é o despublicar sem apagar
- [ ] ASSINATURAS — Só leitura por decisão: criar é do cliente (wizard + autorização no Mercado Pago) e cancelar é da conta dele
- [ ] ASSINATURAS — Contagem 'N assinatura(s) · M ativa(s)' e destaque visual só para as ativas
- [ ] ASSINATURAS — preco_centavos está em CENTAVOS (dividir por 100), diferente de /admin/orders que fala em reais
- [ ] ASSINATURAS — Linha com cliente + e-mail, 'Nx nome do café · a cada N dias · R$ X por envio', rótulo de status e 'desde {data}' + 'cancelada em {data}' quando for o caso
- [ ] ASSINATURAS — Vazio educativo ('Quando um cliente assinar pelo site (/clube), ela aparece aqui — e cada cobrança vira um pedido na tela de Pedidos'), mas só quando NÃO há erro; 404 vira 'módulo do Clube ainda não disponível neste servidor'
- [ ] TRANSVERSAL — Tarja de erro role='alert' com sufixo específico por tela ('Os números abaixo podem estar desatualizados ou zerados', 'A lista abaixo pode estar vazia ou desatualizada', etc.)
- [ ] TRANSVERSAL — Toda tela degrada com frase própria para 404 de módulo ausente (cupons, assinaturas, avaliações, Bling), porque produção pode estar atrás do repositório
- [ ] TRANSVERSAL — Confirmação explícita nas três ações destrutivas (excluir produto, excluir cliente, remover opção), com foco gerenciado e Escape
- [ ] TRANSVERSAL — Formatação pt-BR em toda parte: moeda BRL, data pt-BR com guarda de data inválida, e todos os rótulos em português

---

## 3. Ordem de construção sugerida

1. 1) FIXAR O CONTRATO EM TIPOS ANTES DE QUALQUER TELA. Escrever `lib/painel/contrato/` em TypeScript com os 46 formatos de resposta mapeados: os quatro envelopes ({products,total,totalPages,page}, {data,…}, {users,…}, array puro, objeto puro), os dois vocabulários (inglês em produtos/pedidos/promoções, português em cupons/assinaturas) e a UNIDADE de cada campo de dinheiro no nome do tipo. PORQUÊ: sem fonte única, o primeiro rename de coluna no backend quebra o painel em silêncio — e é isso que os comentários dos repositórios pedem para não acontecer. Toda tela depois disso é barata; antes disso, toda tela é uma reinvenção.
2. 2) PORTAR O TRANSPORTE (authFetch) COM SEUS TESTES. Mover a lógica de frontend/legacy/api.js para lib/painel/ preservando as três regras (token do supabase-js a cada chamada; só 401 renova e só se o token mudou; nenhum header fora dos três do CORS) e levando junto os 11 casos de legacy/api.test.ts. PORQUÊ: é a peça que 21 pontos do painel usam, e apagar legacy/ depois sem ter feito isso perde a única cobertura do laço infinito de 403.
3. 3) PORTAR A LÓGICA PURA JÁ TESTADA. Mover blingContrato.js (293 linhas, sem React e sem fetch) + blingContrato.test.ts (270 linhas) para lib/painel/bling/, e extrair para lib/ o vocabulário de status, os formatadores de moeda/data e a conversão reais↔centavos. PORQUÊ: são as únicas regras do painel legado que já têm teste; portá-las cedo dá ao painel novo um núcleo verde antes da primeira tela existir, e é pré-requisito para apagar legacy/ com segurança.
4. 4) MONTAR A INFRA DE TESTE DO PAINEL. Acrescentar jsdom/testing-library com environmentMatchGlobs restrito a app/dashboard/**, criar lib/teste/ com renderizar(), mockNextNavigation() e clienteSupabaseFalso() (os moldes existem em legacy/api.test.ts:40-125), e no backend acrescentar --test-concurrency=1 em package.json e no CI mais um .gitattributes. PORQUÊ: painel é interativo por definição e hoje nenhum clique é testável; e um CI que falha por contenção do Postgres ou por CRLF envenena a leitura de todo diff da reescrita.
5. 5) FECHAR O ANEL DE ACESSO ANTES DE CRIAR ROTA NOVA. Exportar de painel-servidor.ts um helper de checagem que sirva a Server Action e Route Handler, e trocar o teste de inventário de 'nenhum route.ts sob /dashboard' por 'todo route.ts chama a checagem'. PORQUÊ: o painel novo vai querer handler de exportação e de upload; hoje eles nasceriam ABERTOS (layout não protege handler) e o teste atual fica vermelho no primeiro commit — corrigir depois é corrigir sob pressão.
6. 6) DECIDIR E RODAR AS MIGRAÇÕES, COM NUMERAÇÃO COMBINADA. Alinhar produção (que está oito migrações atrás) e escrever a migração nova a partir de 0022 (0017 está triplamente disputado entre as worktrees), contendo os campos fiscais de produto e as correções de privilégio (REVOKE UPDATE em clientes com GRANT só de nome/telefone; SELECT por coluna em avaliacoes; REVOKE DELETE em config_loja). PORQUÊ: tela escrita contra coluna que não existe em produção quebra no deploy, e migração é o item de maior lead time (depende de janela e de merge das worktrees).
7. 7) DESENHAR O SISTEMA DE COMPONENTES DO PAINEL. Tokens Tailwind v4, tabela com cards abaixo de 768px, paginação com reticências (delta=1), tarja de erro role='alert' com sufixo por tela, modal padrão com Escape e devolução de foco, toasts, formatadores. PORQUÊ: seis telas repetem hoje a mesma tarja copiada literalmente, três repetem o mesmo algoritmo de paginação e quatro definem moeda() — construir tela por tela sem isso é triplicar o trabalho e depois triplicar a correção.
8. 8) TELAS DE LEITURA PURA PRIMEIRO: Home, Clientes, Assinaturas. PORQUÊ: exercitam o contrato, a paginação, a tarja e os formatadores em produção sem nenhum risco de escrita destrutiva — é onde os erros do passo 1 aparecem barato. E a Home carrega a doutrina do 'zero é um número plausível', que precisa estar no componente compartilhado desde o começo.
9. 9) ABRIR AS ROTAS QUE FALTAM NO BACKEND: GET /admin/orders/:id, filtro por status/período/cliente em /admin/orders, busca em /auth/users. PORQUÊ: sem elas a tela de Pedidos ou não tem deep-link (o detalhe hoje só existe a partir da linha em memória), ou tem um filtro que mente sobre 100 linhas. Fazer isso ANTES da tela evita reescrever a tela duas vezes.
10. 10) TELA DE PEDIDOS (lista + detalhe em rota própria). PORQUÊ: é a maior tela do painel (1056 linhas), concentra o vocabulário de status, o fluxo de rastreio, a exportação CSV e o endereço legado — e é a base sobre a qual o Bling se apoia.
11. 11) TELA DO BLING (fila + bloco no detalhe do pedido). PORQUÊ: depende da tela de Pedidos e da lógica portada no passo 3; o bloco no detalhe existe porque o gestor está ALI quando percebe que a nota não saiu. Se o filtro por estado no servidor ainda não existir, copiar a honestidade do legado e dizer na tela que o filtro olha só a página carregada.
12. 12) TELA DE PRODUTOS (lista + formulário), já com os campos fiscais e com os quatro inputs de dimensões. PORQUÊ: precisa das decisões do passo 6 (colunas fiscais) e da decisão sobre como ler `produtos.custo` (RETURNING * responde 42501 nessa tabela até para o admin). É também onde entra o filtro de completude fiscal, que é pré-requisito para ligar a NF-e automática.
13. 13) CONFIGURAÇÃO DA LOJA E BANNERS. PORQUÊ: depende da decisão sobre os campos write-only (barra de aviso e banners que a vitrine nunca lê). Vem depois de Produtos porque compartilha o caminho de upload e a mesma armadilha de PUT parcial com campo vazio.
14. 14) PROMOÇÕES E CUPONS. PORQUÊ: são as telas cuja forma depende de decisões de backend ainda abertas (PUT total vs parcial, existência de DELETE, paginação). Construí-las antes das decisões garante retrabalho; construí-las por último aproveita todo o sistema de componentes já maduro.
15. 15) AVALIAÇÕES, depois de decidido o modelo de acesso. PORQUÊ: é a única tela que hoje fala direto com o PostgREST; se ficar assim, o painel novo carrega DOIS clientes (supabase-js e o fetch ao Express) e depende de RLS que nenhum teste do backend cobre; se migrar para o Express, é uma rota nova (listar com filtro+paginação+contagem e um PATCH de status em lote) que não existe em lugar nenhum.
16. 16) TELAS QUE NÃO EXISTIAM: administradores (hoje só por psql) e LGPD (duas rotas prontas, testadas e destrutivas, sem nenhum consumidor). PORQUÊ: são risco operacional puro — promover um segundo gestor exige acesso ao banco de produção, e atender um pedido de titular exige curl. A tela de redação precisa nascer com confirmação explícita, porque o backend não pede nenhuma.
17. 17) APAGAR frontend/legacy/ E FECHAR O CSP. PORQUÊ: só depois que blingContrato, api.js e seus testes estiverem em lib/. O 'unsafe-inline'/'unsafe-eval' do CSP existe por causa dos styled-components do painel legado — a reescrita em Tailwind é a única oportunidade de fechá-lo, e ela se perde se o legado ficar meses convivendo.

---

## 4. Decisões que só um humano toma

- MODELO DE ACESSO DA TELA DE AVALIAÇÕES: o painel novo continua falando direto com o PostgREST (carregando o cliente Supabase ALÉM do fetch ao Express, e dependendo de RLS + GRANT de coluna que nenhum teste do backend cobre), ou cria-se uma rota /avaliacoes no Express (listar com filtro+paginação+contagem e um PATCH de status em lote)? Ter dois modelos de acesso na mesma aplicação é a maior assimetria arquitetural herdada.
- MIGRAR PRODUÇÃO ANTES OU CONSTRUIR COM DEGRADAÇÃO: o banco de produção está na 0008 e o repositório na 0016. Ou se agenda a janela para subir oito migrações antes da reescrita, ou toda tela nasce com o tratamento de 404 'módulo ainda não disponível neste servidor' que o legado já faz. Envolve risco operacional e não é decisão técnica.
- NUMERAÇÃO DAS MIGRAÇÕES E ORDEM DE MERGE DAS WORKTREES: 0017 está ocupado em melhor-envio e em whatsapp-bot (que vai até 0021). Alguém precisa decidir a ordem de merge e o número inicial do painel (0022 se tudo entrar) — o runner aborta em número repetido e a chave de controle é o nome completo do arquivo.
- CAMPOS FISCAIS E SINCRONIZAÇÃO DE PRODUTO COM O BLING: criar as oito colunas (NCM, CEST, origem, CFOP, GTIN, unidade, peso líquido, peso bruto) e um POST /produtos para o Bling, ou manter o cadastro fiscal feito à mão lá dentro? É o item que decide se a substituição da Tray é real para o chefe — hoje a loja só CONFERE o SKU no Bling e nunca cria produto.
- SÉRIE E NATUREZA DE OPERAÇÃO DA NF-e: os dois POST de emissão vão SEM CORPO, então 100% da regra fiscal vem da conta Bling. Se o contador pedir outra natureza de operação para venda a consumidor final fora do estado, não há onde configurar do lado da loja. Decisão que precisa passar pelo contador, não pelo desenvolvedor.
- CANCELAMENTO/ESTORNO PROPAGADO AO BLING: hoje um pedido reembolsado devolve estoque na loja mas deixa no Bling um pedido de venda com estoque baixado e, se a nota saiu, uma NF-e autorizada de uma venda que não aconteceu. Construir agora ou aceitar a divergência e resolver manualmente no fechamento com o contador?
- PUT /promotions/:id: o backend passa a aceitar atualização PARCIAL (mudando o contrato e exigindo checagem de linhas afetadas para devolver 404), ou o painel novo continua obrigado a enviar o objeto completo em todo PUT, inclusive no toggle de ativo?
- DELETE DE PROMOÇÃO E DE CUPOM: criar (ou soft delete), ou assumir para sempre que 'desativar' é o único caminho? A decisão muda o desenho das duas telas, porque sem DELETE as listas só crescem e passam a precisar de filtro por ativo/expirado, busca e paginação que hoje não existem.
- PAGINAÇÃO EM /cupons, /promotions E /admin/assinaturas: as três rotas devolvem a tabela INTEIRA, sem filtro e sem contagem. Aceita-se o mesmo teto (e documenta-se), ou pede-se paginação no backend? Decidir depois de construir a tela significa refazê-la.
- COMO O PAINEL LÊ produtos.custo: rota admin no Express (que conecta como dono e enxerga tudo) ou função SECURITY DEFINER com eh_admin() na frente? A migração 0006 adiou explicitamente essa decisão 'para a tarefa que construir o painel'. Sem decidir, a tela de margem bate em 42501 sem aviso legível.
- ENDPOINT DE ESTOQUE SEPARADO: hoje ajustar o estoque de um produto obriga a reenviar o formulário completo por multipart, inclusive a imagem. Uma tela de 'entrou mercadoria' não tem contrato para chamar. Criar PATCH de estoque ou continuar reaproveitando o PUT total (com o risco documentado de apagar as medidas do pacote)?
- CLUBE — DUNNING: define-se uma política de inadimplência (quantas falhas antes de avisar, quantas antes de cancelar o preapproval, que mensagem vai ao cliente) ou o painel novo continua mostrando 'ativa' para quem não paga há meses? Envolve migração (o CHECK de status é fechado) e uma tabela de eventos que não existe.
- CLUBE — AUTOGESTÃO: quais das quatro operações a loja passa a oferecer (trocar endereço, pausar/retomar, pular ciclo, trocar café/quantidade/frequência)? Trocar endereço é barato e não toca o Mercado Pago; as outras mexem no preapproval e as duas últimas obrigam a decidir se o preço travado da adesão é mantido ou recalculado.
- CLUBE — AÇÕES DO GESTOR: abre-se uma rota admin de escrita (cancelar/pausar a assinatura de outra pessoa)? Hoje o botão simplesmente não tem backend: a rota de cancelamento filtra por dono e devolve 404 para admin.
- DESCONTO DE ASSINANTE EM COMPRA AVULSA: quem paga assinatura hoje paga preço cheio no pacote extra. É o benefício mais barato de anunciar e o único que não depende do Mercado Pago — mas exige decidir se assinatura 'pausada' mantém o benefício.
- PREÇO 'DE/POR' NA VITRINE: a promoção já existe, já cobra menos e o cliente nunca a vê. Se for exibir, `conferirSubtotal` (tolerância zero, comparando o subtotal SEM promoção) precisa mudar no mesmo commit, senão toda venda com promoção ativa vira 409 e a loja para de vender.
- CAMPOS WRITE-ONLY: a barra de aviso e os dois banners de config_loja são salvos pelo painel e a vitrine NUNCA os lê; a imagem de produto sobe para a Cloudinary e nenhuma superfície a mostra. Liga-se cada um na vitrine (a barra de aviso é a mais barata: GET /config já devolve announcement_bar) ou removem-se os campos do painel novo? Reconstruir sem decidir é reconstruir botões que mentem.
- ATRIBUIÇÃO (UTM/canal/referrer): não existe captura, campo de corpo nem coluna. O dado é PERECÍVEL — se não for capturado no checkout, não há como recuperar depois, nem do Mercado Pago nem do Bling. Capturar agora (mesmo sem tela de relatório) ou aceitar que a decisão de mídia continue sendo palpite?
- PAPÉIS DE ADMIN E AUDITORIA: hoje todo admin pode tudo e nada registra quem mexeu. Num painel que cria promoção, muda preço e emite NF-e, 'quem aprovou este desconto de 50%' precisa ter resposta. Criar coluna de papel + tabela de log agora, ou depois?
- EXPORTAÇÃO DE CSV COM DADOS PESSOAIS: as datas são opcionais e sem elas o arquivo leva CPF e e-mail de toda a base, sem confirmação, sem teto de linhas e sem auditoria. Que política se adota — confirmação obrigatória, período máximo, registro de quem exportou?
- E2E NO CI: instala-se @playwright/test com config próprio e um job no workflow (convertendo o script de fumaça manual, hoje com executablePath cravado num caminho Linux), ou o painel novo vive só com teste unitário? É a única forma de cobrir sessão real, cookie, redirect e RLS chegando via PostgREST.
- CORREÇÕES DE SEGURANÇA FORA DO ESCOPO DO PAINEL: entram na mesma migração ou viram tarefa separada? São três: REVOKE UPDATE em clientes com GRANT só de (nome, telefone) — hoje o cliente escreve CPF livremente e o UNIQUE vira oráculo de enumeração; recorte de coluna no SELECT de avaliacoes para authenticated — hoje qualquer token da instância compartilhada lê o user_id de todos os avaliadores; e REVOKE DELETE em config_loja — hoje um admin pode apagar a linha única junto com o refresh token do Bling.

---

## 5. Resumo por frente

## 1. Contratos do backend Express

São **45 rotas + `OPTIONS *`**, montadas em `backend/src/index.js:166-183` — parte com prefixo (`/promotions`, `/auth`, `/options`, `/cupons`, `/newsletter`, `/lgpd`, `/bling`) e parte com caminho absoluto dentro do próprio router (products, orders, address, clube). A autenticação é **uma só** (`backend/src/middleware/isAuthenticated.js:236`): lê exclusivamente `Authorization: Bearer` de um token do GoTrue, verifica HS256/ES256/RS256 e **só então** confere no banco se há linha em `canastra.clientes` e em `canastra.admins`; não há cookie, não há CSRF e o Express não emite token nenhum. Vinte e duas rotas são exclusivas do painel, quinze da vitrine, cinco são leituras públicas compartilhadas (`GET /dashboard`, `/dashboard/:id`, `/config`, `/promotions`, `/options` — "apertar" qualquer uma derruba a vitrine) e cinco não têm consumidor algum. O contrato **não tem padrão**: quatro envelopes de resposta (`{products,…}`, `{data,…}`, `{users,…}`, array puro, objeto puro), dois vocabulários (inglês traduzido em produtos/pedidos/promoções, português cru em cupons/assinaturas) e dois campos de erro (`{error}` e `{message}`), com 401/403 vindo por `sendStatus` (corpo **vazio**). Não existe OpenAPI, tipo compartilhado nem cliente gerado; não existe Route Handler no Next fazendo proxy — o navegador fala com o Express direto pela `NEXT_PUBLIC_API_URL`.

## 2. Schema do banco (`canastra`, 16 migrações)

14 tabelas + 1 view + 9 funções, colunas em **português**, traduzidas para inglês *por repositório* — e é a constante de tradução que é o contrato (`dashboardRepository.js:16`, `promotionsRepository.js:14`, `configRepository.js:12`; `cuponsRepository.js:14` não traduz nada). O desconto vive em **duas estruturas que nunca se falam**: `canastra.promocoes` (vitrine, aplicada em `backend/src/utils/preco.js:23`) e `canastra.cupons` (checkout, sobre o subtotal já promocional). Não há motor de promoção: `promocoes` não tem CHECK em `tipo`/`aplica_a`, nem prioridade, exclusividade, mínimo, teto, limite por cliente, tabela de resgates ou escopo com exceção — "a mais generosa ganha" é acidente (`preco.js:56`). Banner não é entidade: são duas colunas `text` na linha única de `config_loja`. Marketing e atribuição **não existem** (o INSERT de pedido tem 13 colunas e nenhuma é de origem — `ordersRepository.js:73`). Campos fiscais do Bling **não existem** em `canastra.produtos`. A unidade monetária é inconsistente dentro do próprio schema (reais `numeric(10,2)` × centavos `integer`).

## 3. Segurança: RLS, GRANTs e o conceito de admin

Ser administrador é **linha em `canastra.admins`**, nunca claim de JWT — decisão escrita em três lugares que precisam concordar: `canastra.eh_admin()` (`0006:120`), o `EXISTS` de `isAuthenticated.js:93-97` e o `.from("admins")` de `painel-servidor.ts:292`. O motivo é estrutural: a instância Supabase é **compartilhada**, então `auth.uid()` sozinho não prova pertencimento — por isso toda política de dono soma `canastra.eh_cliente()`. A segurança vive em duas camadas somadas: GRANT decide **tabela e coluna**, RLS decide **linha**; onde a RLS não recorta (`produtos.custo`, `pedidos.total`, `config_loja.bling_refresh_token`, `avaliacoes.status`) a trava desce para privilégio de coluna. O painel tem dois anéis de guarda (layout servidor em `app/dashboard/(protegido)/layout.tsx:47` e `AdminRoutes.jsx:42-77` no cliente), ambos falhando **fechado**. Três buracos reais: `avaliacoes` entrega `user_id` a qualquer token `authenticated` da instância (`0014:234`), o cliente escreve `cpf` livremente em `clientes` (oráculo de enumeração por 23505) e `config_loja` ainda aceita DELETE de `authenticated`. **Não existe rota nem tela para criar/listar administrador** — a única escrita em `canastra.admins` do repositório está em `backend/db/gerar-instalacao.js:316`.

## 4. As telas legadas do painel

12 telas sob `/dashboard`, 8.004 linhas em 43 arquivos, styled-components, roteadas por `createBrowserRouter` em `frontend/legacy/PainelApp.jsx:148-199`. Onze falam com o Express via `authFetch`/`fetchDataForm`; **uma** (Avaliações) fura o Express e vai direto ao PostgREST, apoiada em RLS + GRANT de coluna. A regra de negócio não está em service nenhum: está **espalhada dentro dos componentes** — os 9 status copiados à mão em `Orders.jsx:52-62` e em `HomeDashboard.jsx:34-44`, o teto de 90% em `CuponsManager.jsx:159`, a conversão reais↔centavos em `UpdateInfo.jsx:196-243`, o `isEdited` de 12 comparações em `Form.jsx:353`. A única lógica já extraída e testada é a do Bling (`blingContrato.js`, 293 linhas + 270 de teste) — é o modelo a seguir, não a exceção. Faltam: botão de sair, indicação de quem está logado, busca/filtro no catálogo (o backend já suporta `?q=`), DELETE de promoção e cupom, e qualquer tela de LGPD.

## 5. A vitrine e as superfícies que precisam mudar

Next App Router + Tailwind já em produção, com dois grupos de rota irmãos (`app/[locale]/(vitrine)` traduzido e `app/(transacional)` pt-BR fixo) costurados por `app/moldura-da-loja.tsx`. Todo preço passa por **uma** função (`formatarPreco`, `lib/catalogo/repositorio.ts:308`), pt-BR/BRL fixa. **Não existe preço "de/por"** em lugar nenhum — e o backend **já cobra** o preço promocional (`preco.js:23`), então a promoção existe, desconta e o cliente nunca a vê. O herói da home é inteiramente chumbado em `page.tsx`; a barra de aviso é chumbada no dicionário, embora `config_loja.barra_de_aviso` exista e o painel a edite — **campo write-only**, assim como `banner_desktop`/`banner_mobile` e a imagem de produto que o painel sobe para a Cloudinary. UTM/canal/referrer não existem em lugar nenhum da pilha.

## 6. Infraestrutura de teste

Duas suítes com filosofias diferentes: frontend em Vitest com **`environment: "node"`** (sem jsdom, sem testing-library, sem setupFiles) — 69 arquivos, 779 casos, e **nenhum clique em todo o repositório**; backend em `node:test` com **PostgreSQL 16 embarcado de verdade** em 23 dos 27 arquivos, aplicando as migrações reais e testando RLS por papel. Helpers compartilhados existem só no backend (`backend/test/ajuda/`); no frontend cada arquivo redeclara à mão `function html(no) { return renderToStaticMarkup(no); }`. Playwright está instalado mas **não há E2E**: o único consumidor é um script de fumaça manual com `executablePath` cravado num caminho Linux. `frontend/app/dashboard/` tem 7 arquivos e **zero teste próprio**. O CI roda tudo num job só, **sem `--test-concurrency=1`**.

## 7. Clube de assinatura

A assinatura nasce só pela vitrine (wizard de 3 passos → `POST /clube/assinar` → preapproval no Mercado Pago → o cliente autoriza **lá**). Quem cobra é o MP sozinho, por débito automático de valor fixo — **a loja não tem cron de cobrança**. Cada cobrança chega no webhook próprio e vira um pedido normal com os dados congelados da adesão. Quando a cobrança **falha não existe nenhum tratamento**: nasce um pedido `rejeitado`, o admin recebe o e-mail rotineiro de "Novo Pedido Recebido", o cliente recebe um "Problema no pedido #xxxx" genérico que nem menciona assinatura, e o status da assinatura continua `ativa`. O painel é **só leitura** — `GET /admin/assinaturas` é a única rota administrativa, e `POST /clube/assinaturas/:id/cancelar` filtra por dono, devolvendo 404 para admin.

## 8. Bling e campos fiscais

A integração está **inteira e funcionando** do lado do código (migração 0012, OAuth com token rotativo persistido, idempotência por claim, três rotas admin, cron de rastreio, tela + bloco no modal, 22 testes). O que **não existe** é o cadastro fiscal do produto: `canastra.produtos` tem 16 colunas e nenhuma é fiscal — NCM, CEST, origem, CFOP, GTIN, unidade comercial, peso líquido e peso bruto são todos "NÃO EXISTE". A loja nunca envia produto ao Bling, só faz `GET /produtos?codigo=<sku>` para conferir; os dois POST de NF-e vão **sem corpo nenhum**, ou seja, 100% da regra fiscal vem da conta Bling. A integração nasce desligada e o checklist de go-live está com todos os itens do Bling desmarcados — **nunca foi ligada em produção**.