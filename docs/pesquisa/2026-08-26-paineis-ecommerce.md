# Pesquisa: painéis administrativos de e-commerce

> Levantamento feito em 26/08/2026 para o redesenho do painel do Café Canastra.
> **Método:** 8 pesquisadores em paralelo — Shopify (descontos / marketing / conteúdo / home+Polaris),
> Tray, Nuvemshop+Loja Integrada+VTEX, Medusa+Saleor+Sylius+Woo, e UX de painel administrativo —
> somando 291 chamadas de busca e leitura, seguidos de uma síntese única.
> Toda funcionalidade listada carrega a URL da fonte que o pesquisador abriu.

---

## 1. As 15 coisas de maior impacto para esta loja

Ordenadas por (impacto em receita) ÷ (esforço), para uma loja própria de café especial com clube de assinatura, saindo da Tray.

1. Banners de verdade (posicao semantica, imagem desktop+mobile, ALT, link, ordem, agendamento por data). Hoje o conteudo visual da loja sao duas colunas de texto em `config_loja`. Esforco baixo, e e o item que o chefe compara diretamente com a Tray no dia da troca — sem ele a migracao PARECE um retrocesso mesmo estando tecnicamente a frente.
2. Gravar UTM, canal e meio de pagamento NO PEDIDO desde ja (0019, secao 1). Sao cinco colunas e uma tarde de trabalho. E irreversivel no sentido pior: nenhum relatorio reconstroi depois de onde veio um pedido de tres meses atras. Fazer isto antes da primeira campanha vale mais do que qualquer grafico feito depois.
3. Campos fiscais no produto (NCM, CEST, origem, CFOP, GTIN, unidade, peso liquido/bruto). Esforco baixo, e sao literalmente os campos que o Bling exige no payload. A aceitacao do chefe depende de NF-e; sem esses campos a integracao trava depois de tudo pronto, que e o pior momento possivel.
4. Frete gratis com regra (UF ou faixa de CEP, valor minimo, teto de valor do frete, so na modalidade mais barata). Hoje e um numero global (`frete_gratis_minimo_centavos`). Cafe tem frete comparavel ao produto: sem o teto, 'frete gratis acima de R$ 149' significa bancar um SEDEX de R$ 90 para o Acre, e isso sai da margem toda semana.
5. Desconto no PIX com escopo por categoria. Receita direta no Brasil, esforco baixo — e ja nasce melhor que a Nuvemshop, que admite so conseguir aplicar global e por isso obriga a dar o mesmo percentual no cafe de R$ 40 e no micro-lote de R$ 180.
6. Home como fila de trabalho + duas ou tres views salvas de pedidos ('a despachar hoje', 'pagamento pendente', 'assinatura falhou'). Esforco baixo-medio, ganho diario em minutos de operacao. O lojista nao abre o painel para admirar receita, abre para saber o que embalar.
7. Carrinho abandonado fechando o ciclo: token de retomada no link + regua automatica + botao de envio manual com desconto decidido por carrinho. A loja ja tem metade da peca (`lembrete_enviado_em` e o job). E a automacao de maior ROI que existe em e-commerce, e falta pouco.
8. Tabela de resgates de cupom com limite por CPF (hash) e teto de desconto em reais. Substitui o contador solto por algo auditavel, mata o cupom que vaza em grupo de WhatsApp e e o que torna possivel o relatorio do item 10.
9. Ordem de aplicacao declarada + uma linha de ajuste por desconto no pedido (`pedido_ajustes_desconto`). Sem isso nao ha NF-e com desconto rateado, nem estorno proporcional em devolucao parcial, nem resposta para 'por que este pedido saiu por R$ X'. E a fundacao dos itens 8, 10 e 13.
10. Relatorio de vendas por produto e de cupom/campanha, com custo e margem (a loja ja tem `produtos.custo` — falta o snapshot do custo no item do pedido). Promocao sem relatorio e o lojista repetindo a campanha que deu prejuizo. Se vai construir motor, construa o relatorio junto, nao depois.
11. Autogestao da assinatura pelo cliente: pular ciclo, trocar endereco, trocar cartao, trocar o cafe do mes, cancelar. Hoje tudo isso e chamado para o lojista — que e a limitacao que mais dói na Nuvemshop e a que mais gera cancelamento por WhatsApp irritado.
12. Dunning do clube: 3 tentativas de recobranca com aviso ao cliente e e-mail de renovacao ANTES da cobranca. Churn involuntario (cartao vencido, limite estourado) costuma ser maior que o voluntario em clube brasileiro — e some da conta porque ninguem o mede.
13. Relatorios de assinatura: ativas, novas, canceladas ao longo do tempo e assinatura x avulso. Exige um log datado de eventos da assinatura (a tabela hoje so guarda o estado atual). E a pergunta de negocio do Canastra — quanto do faturamento e recorrente — e hoje ela nao tem resposta.
14. Progressivo / leve-mais-pague-menos com barra de progresso no carrinho. Cafe se vende por pacote e o cliente entende 'leve 3, pague 2' melhor que percentual; a barra de progresso e o mecanismo de aumento de ticket mais barato que existe. Esforco medio, retorno imediato em AOV.
15. Edicao em lote de preco e estoque + rascunho/ativo/arquivado no produto. E o que transforma o reajuste de 40 SKUs e a entrada de estoque pos-torra de meia tarde em dez minutos — e arquivar em vez de apagar impede que um produto de safra encerrada quebre pedidos antigos.

---

## 2. Regras de UX de painel administrativo

Cada regra vem com o porquê. São o critério de aceitação de interação e visual do painel novo.

**R1.** A busca de uma lista fica SEMPRE visivel, nunca atras de icone. Porque: e a acao mais frequente da tela; a Shopify escondeu a dela e lojistas reagiram em massa ('the extra click is sooooo annoying'). Um clique extra numa acao feita 200x por dia e um imposto diario.

**R2.** Todo o estado da lista (busca, filtros, ordenacao, pagina, colunas) mora na URL. Porque: voltar do detalhe tem de devolver a MESMA lista; resetar filtro em silencio e a frustracao mais citada em telas de dados. E porque URL e compartilhavel e sobrevive ao F5. Nunca coloque CPF, e-mail ou endereco na query string.

**R3.** Filtro aplicado aparece como chip removivel, com contagem de resultados e 'Limpar tudo' ao lado. Porque: chip comunica que filtros sao aditivos, a contagem evita o vazio surpresa, e 'limpar tudo' resolve a causa numero um de chamado — filtro esquecido lido como 'sumiu meu pedido'.

**R4.** O que e rotina vira aba salva; o que e exploracao fica como estado temporario. Porque: a aba nomeada transforma um filtro num processo ('Pedidos a despachar hoje'), e duplicar uma view existente e o gesto que faz o recurso ser usado — ninguem comeca do zero.

**R5.** Formulario longo usa save bar contextual (Salvar + Descartar, nada mais) e bloqueia a saida com alteracao pendente. Porque: o usuario nunca procura onde salvar e nunca perde trabalho ao navegar. E a barra e o indicador de estado sujo: aparece sozinha e some quando o valor volta ao original.

**R6.** Autosave so onde o custo do erro e zero (rascunho, nota interna). Preco, estoque, status de pedido e valor de cupom exigem salvar explicito. Porque: uma virgula errada publica R$ 5,90 no lugar de R$ 59,00, e autosave sem historico de versoes e desfazer e destruicao silenciosa.

**R7.** Um formulario editavel por pagina. Se uma secao precisa de edicao independente, ela abre num modal com salvar proprio. Porque: varios botoes 'Salvar' na mesma tela produzem estado salvo pela metade e o usuario sem saber o que persistiu.

**R8.** Validacao inline no BLUR, com a mensagem ao lado do campo e icone a esquerda do texto. Porque: validar a cada tecla ('e-mail invalido' na terceira letra) e hostil; sumario no topo sozinho forca cacar o campo e memorizar a mensagem; e icone ajuda quem nao distingue vermelho.

**R9.** Erro nunca em toast e nunca em tooltip. Erro e banner/mensagem persistente que o usuario fecha. Porque: o Primer classifica flash auto-dismissivel como nao recomendado — leitor de tela pode nao anunciar, ampliacao esconde, e quem viu tarde nao tem como reler. Se a informacao so existe no toast, ela nao existe.

**R10.** Toast so para confirmacao de acao reversivel, com 'Desfazer'. Porque: separa o que e feedback barato do que e informacao critica, e mantem o desfazer perto do gesto.

**R11.** Acao destrutiva fica espacialmente afastada da confirmacao, com peso e cor diferentes, e nunca e o primeiro item de um menu. Porque: 'Salvar' colado em 'Excluir' e um dos 10 piores erros catalogados pelo NN/g — causa slip que apaga trabalho.

**R12.** Confirmar destrutivo nomeando o objeto e a consequencia ('Cancelar a assinatura de Maria Souza? A cobranca de 12/09 nao sera feita'). Porque: 'Tem certeza?' nao carrega informacao nenhuma e treina o usuario a clicar em OK sem ler.

**R13.** Nada e deletado de verdade: arquiva-se. Porque: produto deletado quebra pedido historico que aponta para ele, e soft delete e o que torna 'Desfazer' possivel de verdade.

**R14.** UI otimista so em operacao reversivel e barata. Dinheiro (reembolso, cobranca, reserva de estoque) mostra 'processando' honesto ate o servidor confirmar. Porque: falso sucesso em dinheiro e caro e inconsistente; o pior estado nao e devagar, e 'nao sei se aconteceu'.

**R15.** Carregamento com skeleton na FORMA do conteudo, mantendo filtros e navegacao interativos. Porque: preserva a estabilidade do layout (nada pula quando os dados chegam) e antecipa a estrutura; CLS <= 0,1 e a traducao numerica dessa regra. Acao dentro da tabela carrega NA LINHA, nao recarrega a tabela toda.

**R16.** Tres estados vazios com textos e CTAs diferentes: sem dado nenhum (ensina + 'Criar'), filtro sem resultado ('Limpar filtros') e erro ('Tentar novamente'). Porque: um 'Nenhum resultado' generico nao ajuda em nenhum dos tres casos.

**R17.** Paginacao (ou 'Carregar mais' explicito), nunca scroll infinito. Porque: painel e tarefa, nao descoberta — sem marcos de pagina, e dificil voltar a posicao depois de abrir um item, o rodape fica inalcancavel e leitor de tela ve so o primeiro segmento.

**R18.** Uma acao primaria por pagina, sempre no mesmo lugar do cabecalho; subpagina tem botao de voltar. Porque: e a diferenca entre um painel que se aprende uma vez e um em que 'Novo produto' esta num canto diferente em cada tela.

**R19.** Nada de menus 'Mais', '...' ou 'Ferramentas'. Cada acao com verbo + objeto, e as 1-2 mais frequentes fora do menu. Porque: menu junk-drawer tem baixo information scent — ninguem clica, e o recurso morre.

**R20.** Icone sempre com rotulo, e acao de linha nunca so no hover (tambem no :focus-within). Porque: icone sem texto nao e compreendido, tem alvo menor (lei de Fitts) e nao ensina; acao so no hover e invisivel para teclado e para toque.

**R21.** Vermelho so para erro e acao destrutiva. Porque: vermelho usado como cor de destaque faz ninguem acreditar nos erros de verdade. Regra irma: nenhum modal ou popover abre sozinho no load, e nenhum cronometro pressiona o usuario.

**R22.** Densidade alta e cor escassa; escala tipografica curta (6 passos), sombras minimas, base de 4px. Porque: e o que permite ler uma tabela de 50 linhas sem cansaco. Mas comprima o PADDING da celula, nunca o alvo de toque — checkbox e botao continuam com ~48px.

**R23.** Primeira coluna e identificador humano (numero do pedido + nome), nunca UUID; numeros alinhados a direita com numeral tabular; cabecalho fixo. Porque: comparar valores vira comparar comprimento, e o NN/g chama id auto-gerado na primeira coluna de 'informacao sem significado'.

**R24.** Tabela ordenavel com <table>, <th> e <button> nativos + aria-sort. Porque: o teclado funciona de graca; adotar role='grid' obriga a implementar navegacao 2D por setas, roving tabindex e virtualizacao acessivel na mao.

**R25.** Selecao em massa distingue explicitamente 'todos desta pagina' de 'todos os N do filtro', e a barra de acoes so existe quando ha selecao. Porque: sem a distincao, o lojista acha que arquivou 1.284 produtos quando arquivou 50 — ou o contrario, que e pior.

**R26.** Detalhe de registro em painel lateral NAO-modal, com 'proximo/anterior'. Porque: modal cobre justamente os dados de referencia que a pessoa precisa consultar; e o botao de proximo transforma 40 cliques de triagem em 12.

**R27.** Exportacao espelha a view: mesmas colunas, mesmo filtro, mesma ordem, com escolha explicita entre pagina atual e relatorio completo e o contexto no nome do arquivo. Porque: exportar ignorando o filtro faz o lojista concluir que o painel perdeu dados.

**R28.** Toda latencia e declarada na tela ('dados atualizam em cerca de 1 minuto', 'sem dados antes de dd/mm'). Porque: mata metade dos chamados 'vendi agora e nao apareceu' e impede que uma data-zero de coleta seja lida como queda de vendas.

**R29.** Toda metrica exibe a formula num tooltip e o modelo de atribuicao ao lado do numero. Porque: quando o lojista compara com o extrato do Mercado Pago e os numeros divergem por desenho, sem o rotulo ele conclui que o sistema esta quebrado.

**R30.** Grafico so de linha (serie temporal) e barra ordenada por valor (comparacao). Nada de donut, pizza, gauge, treemap ou 3D. Porque: comprimento e posicao 2D sao os canais visuais precisos; area e angulo nao sao. E comece pela tabela ordenavel — o grafico e opcional e deve poder ser desligado.

**R31.** Datas em dd/mm/aaaa no fuso America/Sao_Paulo, dinheiro em R$ com virgula, data relativa so nas ultimas 24h e sempre com a absoluta no tooltip. Porque: um pedido carimbado em UTC aparece no dia errado no fechamento do mes e destroi a confianca em todos os relatorios.

**R32.** No celular, um subconjunto deliberado e perfeito (ver pedidos novos, marcar enviado, consultar estoque, aprovar avaliacao) em vez do painel inteiro mal adaptado. Porque: espremer 9 colunas num celular produz scroll horizontal e toque errado; a coluna primaria vira titulo do cartao e o resto empilha.

**R33.** Se o painel permite customizar algo visual, a previa aparece ao vivo, lado a lado com o editor. Porque: editar banner as cegas e abrir a loja em outra aba para conferir e o padrao que essa regra existe para proibir.

**R34.** Esconder acao sem permissao e melhor que mostrar e falhar; quando esconder confunde, mostre desabilitada com tooltip dizendo qual papel e necessario. Porque: 'cade o botao de reembolso?' e pior que um botao explicado — e 'sem permissao' merece um estado proprio, nao um 403 cru.

**R35.** Instrumente cliques por acao no admin. Porque: depois de 60 dias, o dado diz exatamente o que promover para a superficie e o que remover — e se o mesmo erro de formulario acontece 3+ vezes, o problema e o campo, nao o usuario.

---

## 3. Inventário de funcionalidades (102 itens)

### Descontos e promoções (34)

#### Promocao e cupom como UMA entidade, separada por metodo (automatico x codigo)

- **O que faz:** Um unico registro de regra com um campo `metodo`: automatico aplica sozinho no carrinho, codigo exige o cliente digitar. Limite de uso e 'um por cliente' so existem para o metodo codigo.
- **Quem faz:** Shopify, Medusa v2 (is_automatic), Saleor (Promotion x Voucher), Nuvemshop
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocoes.metodo text CHECK IN ('automatico','codigo'); codigo sai da tabela da promocao e vira tabela filha`
- **Fonte:** help.shopify.com/manual/discounts/discount-methods; docs.medusajs.com/.../promotion/concepts

#### Classe do desconto (produto / pedido / frete) com ordem de aplicacao declarada

- **O que faz:** Cada desconto pertence a uma classe e o calculo e sequencial e deterministico: produto sobre a linha, depois pedido sobre o subtotal ja reduzido, depois frete. Dois percentuais de pedido incidem sobre o subtotal original, nao compostos.
- **Quem faz:** Shopify (DiscountClass), Nuvemshop (cascata documentada), Saleor (catalogo antes de pedido), Medusa (target_type)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocoes.classe CHECK IN ('produto','pedido','frete'); pedido_ajustes_desconto.alvo + sequencia`
- **Fonte:** shopify.dev/.../enums/DiscountClass; atendimento.nuvemshop.com.br/.../como-funcionam-as-promocoes

#### Regra de desempate: prioridade, exclusividade e grupo de empilhamento

- **O que faz:** Quando duas regras se aplicam ao mesmo carrinho, uma decisao escrita resolve: prioridade numerica, flag exclusiva (se aplicar, nada mais aplica) e grupo de empilhamento (so uma por grupo). A Tray simplifica para 'so um tipo de desconto vale; ganha o que da frete gratis, depois o mais vantajoso'.
- **Quem faz:** Sylius (priority+exclusive), Tray (regra fixa), WooCommerce (individual_use), Shopify (combines with nos dois lados)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocoes.prioridade int, exclusiva bool, grupo_empilhamento text, combina_com text[]`
- **Fonte:** old-docs.sylius.com/.../promotions; basedeconhecimento.tray.com.br/.../desconto-progressivo

#### Requisito minimo: valor OU quantidade, mutuamente exclusivos

- **O que faz:** Radio de dois estados mais um campo, nunca dois campos independentes. Quando o desconto e restrito a produtos/categorias, o minimo conta apenas os itens elegiveis.
- **Quem faz:** Shopify, Tray, Loja Integrada, WooCommerce (minimum_amount), Nuvemshop
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `minimo_tipo CHECK ('nenhum','subtotal','quantidade') + minimo_valor, com CHECK de coerencia`
- **Fonte:** help.shopify.com/.../percentage-fixed-amount

#### Escopo de aplicacao com lista de INCLUSAO e de EXCLUSAO

- **O que faz:** Aplicar a loja toda / categorias / produtos, e separadamente EXCLUIR produtos e categorias. Sem o excluir, nao da para dar 10% na loja toda protegendo o micro-lote.
- **Quem faz:** Tray (Aplicacao + Restricao), WooCommerce (product_ids/excluded_product_ids), Loja Integrada, VTEX
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocao_regras(escopo='alvo'|'excecao', atributo, operador) + promocao_regra_valores`
- **Fonte:** github.com/woocommerce/woocommerce/wiki/Coupon-Data; basedeconhecimento.tray.com.br/.../cupom-de-desconto

#### Teto de desconto em reais para cupom percentual

- **O que faz:** Limita o valor absoluto que um percentual pode descontar, para que 25% num pedido de atacado nao apague o lucro do mes.
- **Quem faz:** Loja Integrada ('Limitar por valor maximo de desconto'), VTEX (maximumUnitPriceDiscount), Nuvemshop
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `promocoes.teto_desconto_centavos integer NULL`
- **Fonte:** ajuda.lojaintegrada.com.br/.../como-criar-um-cupom-de-desconto

#### Limite de uso total e limite por cliente (por CPF, nao por e-mail)

- **O que faz:** Dois limites independentes. O 'um por cliente' precisa ser por CPF porque e-mail e infinito e gratuito; cupom de primeira compra controlado por e-mail e cupom permanente.
- **Quem faz:** Loja Integrada (por CPF), Tray (Uso Por Cliente), Shopify (e-mail/telefone), VTEX (maxUsagePerClient), Woo (usage_limit_per_user)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocao_resgates com documento_hash (sha256 do CPF) e indice em (promocao_id, documento_hash)`
- **Fonte:** ajuda.lojaintegrada.com.br/.../cupom-de-desconto; help.shopify.com/.../percentage-fixed-amount

#### Tabela de resgates como fonte da verdade do uso, com incremento atomico

- **O que faz:** Uma linha por resgate (promocao, codigo, pedido, cliente, valor descontado). E ela que sustenta ao mesmo tempo o limite total, o limite por cliente e o relatorio de campanha. Contador denormalizado atualizado por job e o bug que a propria Shopify documenta (asyncUsageCount pode estar defasado).
- **Quem faz:** Shopify (confessa o defeito), Saleor, Medusa, VTEX
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocao_resgates(promocao_id, codigo_id, pedido_id, user_id, documento_hash, valor_centavos) UNIQUE(promocao_id,pedido_id); UPDATE ... SET usos=usos+1 WHERE usos<limite RETURNING`
- **Fonte:** shopify.dev/.../objects/DiscountCodeBasic; docs.saleor.io/developer/discounts/vouchers

#### Uso derivado do estado do pedido: cancelado nao conta e devolve o cupom

- **O que faz:** O contador so considera pedidos efetivados; pedido cancelado ou com Pix expirado libera o uso de volta. Incrementar na validacao do codigo queima cupom em carrinho abandonado.
- **Quem faz:** VTEX (explicito), Sylius (reusableFromCancelledOrders), Saleor (uso debitado no pedido)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `resgate apagado/anulado no cancelamento; promocoes.reutilizavel_em_pedido_cancelado bool`
- **Fonte:** help.vtex.com/.../como-criar-promocao-com-limitacao-de-uso

#### Janela de datas com fuso da loja, status derivado e kill-switch separado

- **O que faz:** Inicio obrigatorio e fim opcional; o status (agendada/ativa/expirada) e derivado das datas, e existe um booleano de desligar as pressas sem mexer no calendario. Fim opcional exige o par 'por tempo indeterminado' para o lojista nao inventar 31/12/2099.
- **Quem faz:** Shopify, Tray (checkbox indeterminado), Loja Integrada, Nuvemshop (volta ao preco original sozinho)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `inicio_em/fim_em timestamptz + habilitada bool; status como view, nunca coluna gravada`
- **Fonte:** basedeconhecimento.tray.com.br/.../como-cadastrar-banners; help.shopify.com/.../percentage-fixed-amount

#### Frete gratis como regra propria: UF/faixa de CEP, valor minimo, teto de frete e 'so no envio mais barato'

- **O que faz:** Regra dedicada com zona de entrega, valor minimo do carrinho, escolha das modalidades elegiveis e um teto: se a modalidade custar mais que X, o frete gratis nao se aplica a ela.
- **Quem faz:** Nuvemshop (zona + so o mais barato), Shopify (exclude rates over amount), VTEX (zipCodeRanges), Tray
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocao_frete(promocao_id, teto_frete_centavos, ufs text[], apenas_modalidade_mais_barata bool) + promocao_faixas_cep(cep_inicio int, cep_fim int) com CEP normalizado sem hifen`
- **Fonte:** atendimento.nuvemshop.com.br/.../como-configurar-um-frete-gratis; help.shopify.com/.../free-shipping

#### Barra de progresso no carrinho ('faltam R$ 40 para frete gratis')

- **O que faz:** Mostra ao cliente quanto falta para o proximo beneficio, com link para a categoria elegivel. Transforma uma regra invisivel de backend em pressao de compra.
- **Quem faz:** Nuvemshop, Loja Integrada (mostra o proximo degrau), Tray (contador de brinde configuravel de 10% a 90%)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `nenhuma tabela nova: o servico de carrinho devolve {proximo_degrau, falta_centavos, rotulo}`
- **Fonte:** ajuda.lojaintegrada.com.br/.../desconto-progressivo

#### Desconto por meio de pagamento (PIX / boleto) COM escopo por categoria

- **O que faz:** Percentual por forma de pagamento, calculado no servidor e exibido ao lado de cada meio no checkout. A Nuvemshop admite que o dela e global para a loja inteira — quem vende cafe de R$ 40 e micro-lote de R$ 180 nao pode dar o mesmo percentual nos dois.
- **Quem faz:** Nuvemshop, Tray, VTEX (paymentsMethods); Shopify NAO tem
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocao_regras com atributo='pagamento.metodo' + escopo por categoria; recalculo obrigatorio no servidor porque muda o valor autorizado no gateway`
- **Fonte:** atendimento.nuvemshop.com.br/.../desconto-para-pagamento-por-boleto-ou-pix

#### Alocacao 'cada' x 'rateado' e o rateio do centavo

- **O que faz:** 'R$ 20 off em 3 pacotes' e ambiguo: cada aplica R$ 20 por item (R$ 60), rateado distribui R$ 20 no conjunto. E o rateio precisa distribuir a sobra fracionaria um centavo por vez, senao a soma das linhas nao bate com o total e a NF-e sai errada.
- **Quem faz:** Medusa (each/across), Shopify (Functions: ACROSS/EACH), WooCommerce (apply_coupon_remainder)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `promocoes.alocacao CHECK ('cada','rateado'); base=floor(valor*peso/total) e distribuicao deterministica da diferenca por ordem estavel`
- **Fonte:** woocommerce.github.io/code-reference/classes/WC-Discounts.html

#### Linha de ajuste de desconto por item no pedido (auditoria e NF-e)

- **O que faz:** Uma linha por desconto aplicado, com promocao, codigo, rotulo congelado e valor. E o que responde 'por que este pedido saiu por R$ X', permite emitir NF-e com desconto rateado e estornar proporcionalmente numa devolucao parcial.
- **Quem faz:** Medusa (LineItemAdjustment), Sylius (sylius_adjustment), Shopify (discountAllocations)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `pedido_ajustes_desconto(pedido_id, item_indice, alvo, promocao_id, codigo, rotulo, valor_centavos, regra_snapshot jsonb)`
- **Fonte:** docs.medusajs.com/.../order/promotion-adjustments

#### Processador idempotente: reverter todos os ajustes e reaplicar

- **O que faz:** A cada recalculo do carrinho, apaga todos os ajustes de promocao e reavalia do zero, numa transacao. Aplicar incrementalmente acumula desconto fantasma quando o cliente muda a quantidade.
- **Quem faz:** Sylius (PromotionProcessor), Nuvemshop ('aplica automaticamente a melhor combinacao')
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `DELETE ajustes WHERE carrinho_id -> reavalia -> INSERT -> atualiza totais, tudo numa transacao`
- **Fonte:** old-docs.sylius.com/.../promotions

#### Preco promocional (de/por) agendado, em lote, com volta automatica

- **O que faz:** Marcar N produtos com preco promocional e data, com retorno automatico ao preco original no fim. Diferente de editar preco na mao — e a diferenca entre a Black Friday levar 20 minutos ou 4 horas.
- **Quem faz:** Nuvemshop (volta sozinho), Tray (promocao em lote), Shopify (compare-at, sem agendamento)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `produtos.preco_promocional + promocao_inicio/fim, guardando preco original para reverter e para o riscado`
- **Fonte:** atendimento.nuvemshop.com.br/.../desconto-sobre-o-preco-do-produto

#### Varios codigos por promocao (campanha de influenciador)

- **O que faz:** Uma regra com N codigos distintos, cada um com contador proprio e flag de uso unico. Permite 500 codigos rastreaveis individualmente com um relatorio so.
- **Quem faz:** Saleor (Voucher x VoucherCode), Shopify (bulk codes, 250 por chamada, assincrono)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `promocao_codigos(promocao_id FK, codigo UNIQUE, uso_unico bool, usos, limite_usos, ativo)`
- **Fonte:** docs.saleor.io/developer/discounts/vouchers; shopify.dev/.../discountRedeemCodeBulkAdd

#### Desconto progressivo por faixas (quantidade ou valor)

- **O que faz:** Ate tres degraus (10% acima de R$100, 15% acima de R$200...), incidindo sobre a soma dos produtos DEPOIS das ofertas individuais. A Shopify nao tem isso nativamente e e a razao numero um de compra de app.
- **Quem faz:** Tray (6 tipos), Loja Integrada (max 3 faixas), VTEX; Shopify NAO tem
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `promocao_faixas(promocao_id, minimo integer, tipo_valor, valor) ordenadas; limite deliberado de 3 a 5 faixas`
- **Fonte:** basedeconhecimento.tray.com.br/.../desconto-progressivo

#### Compre mais pague menos / preco fixo por quantidade

- **O que faz:** 'Leve 6 pacotes, pague R$ 100' — preco fixo pelo conjunto, com selo exibido no carrinho que progride conforme o cliente adiciona itens.
- **Quem faz:** Tray, VTEX (Leve Mais Por Menos), Nuvemshop (promocoes por quantidade)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `tipo='preco_fixo_por_quantidade' + params {quantidade, preco_fixo_centavos} + selo_texto`
- **Fonte:** basedeconhecimento.tray.com.br/.../compre-mais-pague-menos

#### Compre X leve Y, e a decisao de adicionar ou nao o brinde sozinho

- **O que faz:** Dois lados: gatilho (quantidade ou valor em produtos/categorias) e recompensa (quantidade de itens com percentual, valor ou gratis). Decisao critica: Shopify e Medusa NAO adicionam o item ao carrinho (mata metade da conversao); Saleor cria linha com is_gift e preco zero.
- **Quem faz:** Shopify (BXGY), Medusa (buyget), Saleor (rewardType GIFT), VTEX (Compre e Ganhe)
- **Importância:** importante · **Esforço:** alto
- **Modelo de dados:** `regras com escopo 'gatilho' e 'alvo' + compra_minima_qtd, aplicar_a_quantidade, maximo_por_pedido`
- **Fonte:** docs.medusajs.com/.../application-method; help.shopify.com/.../buy-x-get-y

#### Brinde por valor com estoque minimo de seguranca

- **O que faz:** Acima de R$ X o cliente ganha um produto. O estoque minimo desliga a campanha antes de prometer brinde que a expedicao nao tem. O brinde entra no pedido como item de preco zero que baixa estoque e aparece na NF-e.
- **Quem faz:** Tray (estoque minimo de seguranca), Loja Integrada (precisou lancar modulo separado por causa disso), Saleor (giftIds)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `promocao_brindes(promocao_id, sku, quantidade, estoque_minimo); item do pedido com eh_brinde bool`
- **Fonte:** basedeconhecimento.tray.com.br/.../brinde-por-valor

#### Compre junto / kit com desconto no conjunto

- **O que faz:** Combo montado a partir de um produto ancora, exibido na pagina do produto, com desconto que so entra quando TODOS os itens estao no carrinho. Estoque controlado item a item.
- **Quem faz:** Tray (escondido em Produtos > Opcoes Avancadas), Loja Integrada (2 a 5 produtos, max 500 combos), VTEX (Buy Together)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `kits(nome, produto_ancora_id, desconto, inicio, fim) + kit_itens(kit_id, sku, quantidade)`
- **Fonte:** ajuda.lojaintegrada.com.br/.../compre-junto

#### Flag 'nao acumula com item ja em promocao'

- **O que faz:** Impede cupom de 10% cair em cima do cafe que ja esta com 30% de queima. A Shopify nao tem isso e e a reclamacao documentada desde 2021 ('desconto sobre desconto').
- **Quem faz:** WooCommerce (exclude_sale_items), Sylius (appliesToDiscounted); Shopify NAO tem
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `promocoes.aplica_em_item_ja_promocionado bool; exige que a linha do carrinho saiba se o preco veio de preco promocional`
- **Fonte:** github.com/woocommerce/woocommerce/wiki/Coupon-Data

#### Resumo legivel da regra + simulador de carrinho antes de salvar

- **O que faz:** Um texto gerado a partir da propria regra ('15% off em Canastra Amarelo, acima de R$150, de 1 a 7/09, combina com frete gratis') e um carrinho de teste que mostra quais regras entram e quanto sai.
- **Quem faz:** Shopify (campo summary, derivado, nunca coluna), Loja Integrada (assistente conversacional supre a mesma dor)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `funcao pura sobre a regra; se virar coluna, dessincroniza na primeira edicao`
- **Fonte:** shopify.dev/.../objects/DiscountCodeBasic

#### Tipo de compra (avulso / assinatura / ambos) com limite de ciclos

- **O que faz:** Desconto de aquisicao que vale nos N primeiros ciclos e depois expira, em vez de virar desconto vitalicio que corroi a margem do clube para sempre.
- **Quem faz:** Shopify (purchase_type + recurringCycleLimit); nenhuma plataforma brasileira pequena tem
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `promocoes.tipo_compra + limite_ciclos; assinatura_descontos(assinatura_id, promocao_id, ciclo_numero) para saber onde parar`
- **Fonte:** help.shopify.com/.../percentage-fixed-amount

#### Elegibilidade por cliente, grupo ou segmento dinamico

- **O que faz:** Restringir o beneficio a assinantes, a atacado/cafeteria, ou a um segmento que se recalcula sozinho ('comprou uma vez e sumiu ha 90 dias').
- **Quem faz:** Shopify (segmentos), VTEX (Campaign Audience), Loja Integrada (grupos), Tray (cupom por caracteristica do cliente)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `promocao_regras com atributo='cliente.grupo' ou 'cliente.segmento'; segmento como entidade separada e reutilizavel`
- **Fonte:** help.vtex.com/en/docs/tutorials/campaign-audiences

#### Cupom de primeira compra verificado por CPF

- **O que faz:** Restringe o codigo a quem nunca teve pedido pago. Verificado por CPF, nao por e-mail nem por conta logada, porque a maioria compra como convidado.
- **Quem faz:** Nuvemshop, Loja Integrada
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `promocoes.apenas_primeira_compra bool + NOT EXISTS sobre pedidos com o mesmo documento_hash e status pago`
- **Fonte:** atendimento.nuvemshop.com.br/.../como-criar-cupons-de-desconto

#### Vale-presente com saldo parcial

- **O que faz:** Credito com codigo unico, saldo que pode sobrar entre compras, validade e trava contra uso concorrente. Produto de Natal e Dia dos Pais com margem alta e caixa antecipado.
- **Quem faz:** VTEX (nativo), Tray (Cupom Presente)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `vales(codigo, valor_inicial_centavos, saldo_centavos, validade, status) + vale_usos(vale_id, pedido_id, valor); debitar com SELECT ... FOR UPDATE`
- **Fonte:** suporte.bonifiq.com.br/.../cashback-na-vtex

#### Limites duros de quantidade e performance do motor

- **O que faz:** Teto declarado de regras automaticas ativas e de alvos por regra, porque toda promocao ativa e avaliada em TODO calculo de carrinho. Shopify: 25 automaticos ativos, 5 codigos + 1 de frete por pedido, 100 alvos por desconto. VTEX: 100 promocoes ativas, 100 SKUs. Loja Integrada: 50 promocoes.
- **Quem faz:** Shopify, VTEX, Loja Integrada, Saleor (100 regras com predicado de pedido)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `indice parcial WHERE metodo='automatico' AND habilitada; pre-filtrar por escopo; preferir categoria a lista de SKU`
- **Fonte:** help.vtex.com/.../qual-o-limite-maximo-de-promocoes

#### Orcamento/teto de campanha em reais

- **O que faz:** Teto de gasto ou de usos por campanha; estourado, as promocoes da campanha expiram. E o unico mecanismo que protege a margem quando um cupom vaza em grupo de WhatsApp.
- **Quem faz:** Medusa (CampaignBudget spend/usage), Tray ('Limite Acumulado em R$')
- **Importância:** diferencial · **Esforço:** medio
- **Modelo de dados:** `campanhas(orcamento_tipo, orcamento_limite_centavos, orcamento_usado_centavos); aceitar overshoot de carrinho ja aberto em vez de quebrar o checkout`
- **Fonte:** docs.medusajs.com/.../promotion/campaign

#### Cupom de troca amarrado ao pedido de origem

- **O que faz:** Devolucao gera credito em vez de estorno em dinheiro, mantendo o cliente no funil. A amarracao ao pedido de origem e o que impede fraude.
- **Quem faz:** Tray
- **Importância:** diferencial · **Esforço:** medio
- **Modelo de dados:** `tipo_cupom='troca' + pedido_origem_id`
- **Fonte:** basedeconhecimento.tray.com.br/.../cupom-de-troca

#### Link compartilhavel que ja aplica o cupom

- **O que faz:** URL que grava o codigo na sessao e leva o cliente ao carrinho com o desconto aplicado, removendo o passo em que mais gente desiste (digitar cupom no celular).
- **Quem faz:** Shopify (shareableUrls)
- **Importância:** diferencial · **Esforço:** baixo
- **Modelo de dados:** `rota /d/{codigo}; validar charset [A-Z0-9] na criacao porque o codigo vira parte da URL`
- **Fonte:** shopify.dev/.../objects/DiscountCodeBasic

#### Pagina publica de cupons ativos

- **O que faz:** Pagina institucional listando cupons ativos com codigo, validade e regra — captura a busca por 'cupom cafe canastra' antes que um agregador a intercepte.
- **Quem faz:** Tray (so para cupons de loja toda)
- **Importância:** diferencial · **Esforço:** baixo
- **Modelo de dados:** `flags exibir_na_pagina bool + titulo_publico text no proprio cupom`
- **Fonte:** basedeconhecimento.tray.com.br/.../Pagina-de-Cupons

### Conteúdo e banners (10)

#### Banner como entidade com posicao SEMANTICA, ordem e agendamento

- **O que faz:** CRUD com posicoes nomeadas por significado (home_hero, home_faixa_meio, categoria_topo) e datas de inicio/fim com opcao 'indeterminado'. A publicacao e calculada por now() BETWEEN, nunca por job que liga e desliga.
- **Quem faz:** Tray (mas com posicoes 'Extra 1..12' sem significado), Loja Integrada (agendamento com intervalo minimo de 1h); Shopify NAO agenda fora do Plus
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `banners(posicao, ordem, status, inicio_em, fim_em) + view banners_publicados`
- **Fonte:** ajuda.lojaintegrada.com.br/.../como-incluir-banners; help.shopify.com/.../launchpad

#### Imagem desktop e mobile no MESMO registro, com ALT e dimensao validada no upload

- **O que faz:** Dois campos de imagem num registro so (a Tray faz duas linhas separadas, o que e pior de operar), a mobile substituindo abaixo de 767px, ALT obrigatorio e a dimensao exigida impressa AO LADO do campo, validada no submit.
- **Quem faz:** Loja Integrada (imagem mobile + ALT via nome), Shopify (image + image_2, srcset automatico), Tray (dimensao mora no manual do tema, fora do painel)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `midia_desktop_id, midia_mobile_id NULL (cai pro desktop), alt no arquivo + alt_override no uso`
- **Fonte:** manuais-temas.netzee.com.br/tray-colecao-go/banners-1/dimensoes

#### Biblioteca de midia com ALT, CDN e transformacao on-the-fly

- **O que faz:** Repositorio unico de imagens com ALT editavel no arquivo (herdado por todo uso), URL da CDN copiavel, e transformacao por query (largura, crop, formato, qualidade) em vez de linhas por variante.
- **Quem faz:** Shopify Files (20MB, image_url/image_tag); Tray e Loja Integrada nao tem equivalente
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `midias(caminho, mime, bytes, largura, altura, alt); URL publica derivada, nunca armazenada por tamanho. No Supabase: Storage + transform`
- **Fonte:** shopify.dev/docs/api/liquid/filters/image_url

#### Rotativo/carrossel como propriedade da POSICAO, junto do upload

- **O que faz:** Se a posicao aceita mais de um banner, o intervalo de troca e o maximo de slides ficam na mesma tela do cadastro. Na Tray o interruptor mora em outro menu e o lojista cadastra 5 banners, ve 1 e nao descobre por que.
- **Quem faz:** Tray (contraexemplo), Shopify (Slideshow com intervalo de 3 a 9s), Nuvemshop (carrossel ou grade)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `banner_posicoes(posicao PK, rotulo, largura_px, altura_px, rotativo, intervalo_segundos, max_banners)`
- **Fonte:** basedeconhecimento.tray.com.br/.../design-para-a-versao-mobile

#### Texto, botao e cor FORA da imagem, com opcoes fechadas

- **O que faz:** Titulo, descricao, texto do botao e esquema de cor como campos, em vez de queimados no JPG — preserva SEO, acessibilidade e legibilidade. E as opcoes sao fechadas (esquema de cor nomeado, escala tipografica), nunca color picker livre nem font-size em px.
- **Quem faz:** Nuvemshop ('mostrar texto fora da imagem'), Shopify Dawn (color_scheme, heading_size)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `titulo, subtitulo, texto_botao, link, alinhamento + esquema_cor_id FK, nunca colunas hex soltas`
- **Fonte:** atendimento.nuvemshop.com.br/.../banners-promocionais

#### Segmentacao do banner por categoria/pagina, com o par 'especificas' x 'todas'

- **O que faz:** Um banner de 'Cafes do Cerrado' aparece so dentro daquela categoria. O par selecionar-especificas / capturar-todas repete o mesmo componente do agendamento e do escopo de promocao.
- **Quem faz:** Tray (categorias e marcas), Loja Integrada (pagina de publicacao)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `banner_categorias(banner_id, categoria) + flag todas_categorias para nao gerar N linhas`
- **Fonte:** basedeconhecimento.tray.com.br/.../como-cadastrar-banners

#### Blocos ordenaveis por secao (o slideshow como repeater)

- **O que faz:** Uma secao com N blocos filhos arrastaveis, cada um com seus proprios campos. E o mecanismo que serve slideshow, faixa de destaques e grade de mini-banners com um modelo so.
- **Quem faz:** Shopify (sections/blocks, max 50 blocos por secao, 25 secoes por grupo)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `secoes_home(tipo, ordem, config jsonb, status, inicio_em, fim_em) + blocos(secao_id, tipo, ordem, config jsonb); render por switch sobre 'tipo', nao hardcoded na pagina`
- **Fonte:** shopify.dev/.../architecture/blocks/theme-blocks

#### Ocultar o bloco quando o conteudo vinculado esta vazio

- **O que faz:** Se a fonte de dados nao existe para aquele produto/pagina, a secao some em vez de renderizar um buraco branco. A Shopify NAO tem isso e a solucao oficial dela e criar template alternativo na mao.
- **Quem faz:** lacuna reconhecida da Shopify (dynamic sources)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `campo de conteudo guarda {modo:'estatico'|'vinculo', valor, fonte, ocultar_se_vazio bool}`
- **Fonte:** help.shopify.com/.../connecting-to-your-online-store/using-metaobjects

#### Previa ao vivo lado a lado e rascunho por banner (nao por tema inteiro)

- **O que faz:** Editar e ver ao mesmo tempo, e publicar UM banner sem publicar o resto. A Shopify so tem rascunho por tema — para trocar uma frase, e como abrir um branch da loja inteira.
- **Quem faz:** Shopify (previa ao vivo e requisito do Built for Shopify; rascunho so por tema)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `status por banner ('rascunho','publicado','arquivado') ja e melhor UX que o modelo por tema`
- **Fonte:** shopify.dev/docs/apps/launch/built-for-shopify/requirements

#### Blog/noticias e depoimentos da loja

- **O que faz:** Conteudo editorial (origem, safra, torra, produtor) como canal de aquisicao por SEO, e depoimento da LOJA — que e coisa diferente de avaliacao de produto: um vende a marca, o outro vende o item.
- **Quem faz:** Tray (noticias + depoimentos), Nuvemshop, Shopify (blog nativo)
- **Importância:** diferencial · **Esforço:** medio
- **Modelo de dados:** `posts(slug, titulo, capa, corpo, publicado_em, seo_*) + depoimentos(autor, texto, nota, aprovado, ordem)`
- **Fonte:** basedeconhecimento.tray.com.br/.../Marketing-da-Loja

### Marketing (17)

#### Carrinho abandonado com token de retomada e regua automatica + envio manual

- **O que faz:** Lista de carrinhos parados com valor e itens; e-mail/WhatsApp automatico apos N horas com link que reidrata o carrinho exato, mais um botao de envio manual em que o lojista decide o desconto por carrinho (5% num de R$80, 15% num de R$400).
- **Quem faz:** Tray (manual + WhatsApp), Nuvemshop (6h), Loja Integrada (Komea), Shopify (10 min, retencao de 3 meses)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `reaproveitar canastra.carrinhos (ja tem lembrete_enviado_em) + token_retomada, abandonado_em, recuperado_pedido_id`
- **Fonte:** basedeconhecimento.tray.com.br/.../recuperar-carrinhos-abandonados; help.shopify.com/.../abandoned-checkouts

#### E-mails transacionais editaveis, cada um com toggle proprio

- **O que faz:** Assunto e corpo de cada notificacao editaveis no painel, com variaveis documentadas na propria tela e um interruptor individual por template. A Shopify NAO deixa desligar transacional e isso gera duplicidade com ferramenta externa.
- **Quem faz:** Tray (Configuracoes > Mensagens de e-mail), Nuvemshop; Shopify so deixa desligar o de carrinho
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `templates_email(chave PK, assunto, corpo_html, variaveis text[], ativo bool, atualizado_em)`
- **Fonte:** help.shopify.com/.../shopify-email; basedeconhecimento.tray.com.br

#### Gatilho generico por entrada/saida de segmento

- **O que faz:** Em vez de codificar um gatilho novo para cada caso, dois gatilhos ('entrou no segmento', 'saiu do segmento') cobrem VIP, aniversariante, inativo ha 90 dias e assinatura cancelada com queries diferentes.
- **Quem faz:** Shopify
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `segmento_membros(segmento_id, user_id, entrou_em, saiu_em); o diff entre a avaliacao anterior e a atual emite o evento — sem persistir o pertencimento, nao ha transicao`
- **Fonte:** changelog.shopify.com/.../trigger-marketing-automations-when-customers-join-or-leave-segments

#### UTM, canal e meio de pagamento gravados NO PEDIDO no momento da compra

- **O que faz:** A atribuicao vive na sessao e e copiada para o pedido no checkout. Sem isso o relatorio de origem e impossivel de reconstruir depois — e nao ha como fazer retroativo.
- **Quem faz:** Shopify, Nuvemshop, Loja Integrada, VTEX (utmSource/utmCampaign ate nas promocoes)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `ALTER pedidos ADD utm_source, utm_medium, utm_campaign, canal, referrer, campanha_id`
- **Fonte:** help.shopify.com/.../marketing-reports

#### SEO por entidade: title, description e slug por produto e categoria

- **O que faz:** Campo por produto e por categoria (nao so global), sitemap.xml e historico de slugs para redirect 301. Para cafe especial, onde a busca e por nota sensorial e regiao, e receita direta.
- **Quem faz:** Tray (3 niveis), Loja Integrada, Nuvemshop, Shopify
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `produtos/categorias: seo_titulo, seo_descricao, slug + slugs_antigos para 301`
- **Fonte:** basedeconhecimento.tray.com.br/.../Marketing-da-Loja

#### Pixels e dataLayer de e-commerce (GA4, GTM, Meta)

- **O que faz:** Campos para colar os IDs resolvem 80%; expor o dataLayer com os eventos padrao (view_item, add_to_cart, begin_checkout, purchase) resolve os outros 20% sem depender de dev a cada campanha.
- **Quem faz:** Tray (oferece a variavel base do GTM), Nuvemshop, Loja Integrada, Shopify (Pixels/customer events)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `config_loja: ga4_id, gtm_id, meta_pixel_id, meta_capi_token`
- **Fonte:** basedeconhecimento.tray.com.br/.../Marketing-da-Loja

#### Checagem de elegibilidade antes do disparo de recuperacao

- **O que faz:** Nao enviar o e-mail se o produto acabou, se nao ha frete para o endereco, se o pagamento ja falhou ou se tudo no carrinho e gratuito — reconsultando estoque e frete no MOMENTO do disparo, nao no do abandono.
- **Quem faz:** Shopify (regra documentada)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `nenhuma tabela nova; o job revalida antes de enfileirar`
- **Fonte:** help.shopify.com/.../abandoned-checkouts

#### Automacoes com gatilho -> espera -> condicao -> acao, entregues por template

- **O que faz:** Fluxos prontos (boas-vindas, pos-compra, aniversario, win-back, VIP) que o lojista so edita. Desligar a automacao cancela quem esta em espera, para ninguem receber 'esqueceu algo?' tres dias depois de voce desligar.
- **Quem faz:** Shopify (Automations), Tray (modulo nativo, precisa ser ativado pelo suporte)
- **Importância:** importante · **Esforço:** alto
- **Modelo de dados:** `automacoes + automacao_execucoes(estado, proxima_execucao_em) — a coluna de proxima execucao e o que permite cancelar em massa`
- **Fonte:** help.shopify.com/.../marketing-automations/create

#### Campanha como guarda-chuva de atribuicao, com link curto e QR code

- **O que faz:** Um contêiner que agrupa esforcos sob um nome, gera link rastreavel, short link e QR code prontos, e casa tambem o trafego que veio por UTM montado por terceiro (agencia, influenciador).
- **Quem faz:** Shopify (Campaigns + auto-match por UTM)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `campanhas + campanha_utm_regras(utm_source, utm_medium, utm_campaign); QR gerado on-the-fly, nao armazenado`
- **Fonte:** help.shopify.com/.../understanding-campaigns

#### Modelo de atribuicao declarado ao lado do numero

- **O que faz:** Rotular qual modelo gerou aquela receita (ultimo clique nao-direto, primeiro clique, linear) e permitir trocar. Numeros que divergem entre telas por desenho, sem rotulo, viram 'o relatorio esta errado'.
- **Quem faz:** Shopify (4 modelos + janela de 30 dias)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `guardar a jornada completa de toques; sem ela so da para calcular ultimo clique`
- **Fonte:** help.shopify.com/.../marketing-reports

#### Custo por campanha (investimento em midia) desde o primeiro dia

- **O que faz:** Um campo de gasto por campanha permite calcular ROAS. A Shopify nao integra custo de Google/Meta e o lojista cruza planilha na mao — vale mais que dez graficos.
- **Quem faz:** Shopify (lacuna reconhecida), Tray (painel Meta Ads)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `campanhas.custo_midia_centavos + periodo`
- **Fonte:** putler.com/shopify-analytics-limitations

#### Pedido de avaliacao disparado pela ENTREGA, com token de uso unico

- **O que faz:** Solicitacao 2 a 5 dias apos o status 'entregue' (nao um prazo fixo desde a compra), com link que permite avaliar sem login. A loja ja tem avaliacoes — falta o gatilho.
- **Quem faz:** Loja Integrada (Komea), Shopify (template pos-compra), Tray
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `avaliacao_solicitacoes(pedido_id, token UNIQUE, enviado_em, respondido_em)`
- **Fonte:** lojaintegrada.com.br/funcionalidades

#### Convite de recompra pelo ciclo de consumo

- **O que faz:** 250g dura ~2 semanas; um e-mail no dia certo com 'recomprar em 1 clique' + oferta de virar assinante e a ponte entre o avulso e o clube. E a automacao de maior ROI para cafe.
- **Quem faz:** Loja Integrada, Tray (reativacao 60/90/180 dias), Shopify (win-back)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `dias_de_consumo por SKU (peso / consumo medio) + automacao com gatilho por dias desde o ultimo pedido do SKU`
- **Fonte:** lojaintegrada.com.br/funcionalidades

#### Formularios de captura (rodape/pop-up) que enriquecem o perfil

- **O que faz:** Nao so e-mail: campos extras (aniversario, metodo de preparo preferido) que viram atributo consultavel por segmento, fechando o ciclo captura -> segmento -> automacao.
- **Quem faz:** Shopify Forms, Tray (assinantes da newsletter), Nuvemshop
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `formularios(campos jsonb, regras_exibicao) + cliente_atributos(user_id, chave, valor)`
- **Fonte:** help.shopify.com/.../customer-contact-information

#### Feed XML de produtos para Google Shopping e comparadores

- **O que faz:** Endpoint publico que liga catalogo a midia paga sem intervencao humana. Sem feed, cada campanha vira planilha que desatualiza em dias.
- **Quem faz:** Tray, Nuvemshop, Loja Integrada
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `rota /feed.xml montada do catalogo; exige GTIN/EAN no produto, campo que costuma faltar`
- **Fonte:** basedeconhecimento.tray.com.br/.../Marketing-da-Loja

#### Aniversario do cliente como gatilho

- **O que faz:** Campanha de aniversario (ou promocao restrita a aniversariantes do mes). Custa um campo de data e um WHERE, e e retencao barata para clube.
- **Quem faz:** Loja Integrada (restricao nativa na promocao), Shopify (template + Forms), Tray
- **Importância:** diferencial · **Esforço:** baixo
- **Modelo de dados:** `clientes.data_nascimento date, coletado por formulario de captura`
- **Fonte:** ajuda.lojaintegrada.com.br/.../desconto-em-produtos

#### Carteira de credito da loja (cashback) como ledger append-only

- **O que faz:** Saldo em reais por cliente com extrato e validade, creditado N dias apos a entrega (para sobreviver ao prazo de devolucao do CDC). Cashback vira credito na loja, nao dinheiro — dinheiro que so volta comprando cafe.
- **Quem faz:** Nenhuma das tres brasileiras tem nativo (BonifiQ, Fidelizar Mais); VTEX usa vale-presente como carteira; Tray tem pontos
- **Importância:** diferencial · **Esforço:** medio
- **Modelo de dados:** `credito_lancamentos(user_id, tipo credito|debito|expiracao, valor_centavos, pedido_id, expira_em); saldo SEMPRE derivado da soma, nunca campo mutavel`
- **Fonte:** nuvemshop.com.br/loja-aplicativos-nuvem/bonifiq

### Relatórios e home (11)

#### Home como fila de trabalho ('o que preciso fazer hoje')

- **O que faz:** Antes dos graficos, itens acionaveis com contagem e link para a lista ja filtrada: pagos aguardando envio, assinaturas com pagamento falhado, estoque abaixo do minimo, avaliacoes por moderar, cupons expirando. Bloco de tarefa nao e dispensavel; card informativo e.
- **Quem faz:** Shopify (Home), NN/g
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `cada item e uma saved view com COUNT, sustentado por indices parciais (WHERE status='pago' AND enviado_em IS NULL)`
- **Fonte:** help.shopify.com/.../shopify-home; nngroup.com/articles/data-tables

#### 4 a 8 KPIs com comparacao de periodo e 'sem comparacao' disponivel

- **O que faz:** Valor + variacao vs periodo anterior + sparkline, clicavel para o relatorio com o mesmo filtro. Numero sem comparacao nao e KPI, e trivia. Mais de dez numeros na tela inicial significa rastrear em vez de gerenciar.
- **Quem faz:** Shopify (4 cards configuraveis entre 16 metricas), Nuvemshop, NN/g
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `toda consulta aceita dois intervalos e devolve valor + delta absoluto + delta %`
- **Fonte:** help.shopify.com/.../overview-dashboard

#### Camada unica de definicao de metrica, com as formulas publicadas na tela

- **O que faz:** Vendas brutas, descontos, estornos, vendas liquidas e vendas totais definidas em UM lugar do codigo e reusadas por card, relatorio e exportacao — com a formula visivel num tooltip. Cada tela com sua propria consulta e a causa raiz de numeros que nao batem.
- **Quem faz:** Shopify (pagina oficial de definicoes), critica documentada ao proprio Analytics
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `'Vendas totais' inclui frete e imposto e 'liquidas' nao — confundir os dois e o erro classico`
- **Fonte:** help.shopify.com/.../default-reports/sales-report

#### Agregados diarios materializados

- **O que faz:** Tabela/view por dia (pedidos, receita liquida, itens, novos, recorrentes, desconto concedido) com refresh agendado. Varrer pedidos a cada load deixa o dashboard lento, que e a razao numero um de dashboard abandonado.
- **Quem faz:** Shopify, Nuvemshop, Tray, NN/g
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `date_trunc('day', criado_em AT TIME ZONE 'America/Sao_Paulo'); expor o timestamp do ultimo refresh na tela`
- **Fonte:** nngroup.com/articles/dashboards-preattentive

#### Vendas por produto, categoria, canal e cupom

- **O que faz:** Recortes nomeados da mesma tabela de fatos, com colunas editaveis e ordenacao por clique no cabecalho. O lojista aprende um layout e usa doze relatorios.
- **Quem faz:** Shopify (~12 relatorios de venda), Tray, Nuvemshop
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `fato por item de pedido com preco, quantidade, desconto de linha, desconto de pedido RATEADO, estorno, frete, canal, cupom — o rateio e o que quase todo painel proprio erra`
- **Fonte:** help.shopify.com/.../sales-report

#### Resultado economico: custo, margem e lucro por periodo

- **O que faz:** Relatorio com custo em R$, comissao, frete, desconto e lucro — nao so faturamento. E o relatorio que mais importa e o que quase nenhuma loja propria constroi.
- **Quem faz:** Tray (Resultado Economico); Shopify NAO tem margem nativa
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `a loja ja tem produtos.custo; falta o SNAPSHOT do custo no item do pedido — o custo muda e o relatorio historico precisa do custo da data da venda`
- **Fonte:** basedeconhecimento.tray.com.br/.../relatorios-de-vendas-pedidos

#### Relatorio de cupom e de campanha (quanto custou x quanto trouxe)

- **O que faz:** Por campanha: pedidos, receita, desconto concedido, ticket medio com e sem cupom. Se o painel vai ter motor de promocao, tem de ter o relatorio dele JUNTO, nao depois.
- **Quem faz:** Tray, Nuvemshop (Relatorio de Cupons); Shopify e raso nisso
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `depende inteiramente de promocao_resgates e pedido_ajustes_desconto existirem`
- **Fonte:** atendimento.nuvemshop.com.br/.../novas-estatisticas

#### Relatorios de assinatura: ativas, novas, canceladas, e assinatura x avulso

- **O que faz:** Quanto do faturamento e recorrente, e como a base se move mes a mes. Para uma loja que ja tem assinaturas e nenhum relatorio, e o maior ganho por linha de codigo.
- **Quem faz:** Shopify (5 relatorios de assinatura)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `exige LOG datado de eventos da assinatura (criada, ativada, pausada, cancelada), nao so o estado atual — sem ele nao existe 'canceladas ao longo do tempo'`
- **Fonte:** help.shopify.com/.../sales-report

#### Exportacao que respeita o filtro e as colunas da tela

- **O que faz:** CSV espelhando a view ativa, com escolha explicita entre 'pagina atual' e 'relatorio completo', nome de arquivo com o contexto, e geracao assincrona entregue por notificacao persistente quando for grande.
- **Quem faz:** Shopify (CSV/XML/JSONL/Parquet), Nuvemshop (assincrono por e-mail); Tray tem relatorios sem exportacao nenhuma
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `reaproveita a query da listagem sem paginacao, por cursor; exportacao com dado pessoal exige log de quem exportou (LGPD)`
- **Fonte:** help.shopify.com/.../export-reports

#### Novos vs recorrentes e coorte por mes de primeira compra

- **O que faz:** Uma grade com seletor de metrica (clientes, retencao, receita) em vez de cinco relatorios diferentes, mais listas exportaveis de 'recorrentes' e 'compra unica' que ja viram segmento de campanha no mesmo dia.
- **Quem faz:** Shopify (coorte com heatmap e curva), Nuvemshop
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `cohort = mes do primeiro pedido; para cafe, vale coorte tambem por produto de entrada`
- **Fonte:** help.shopify.com/.../customers-reports

#### Relatorio de buscas sem resultado

- **O que faz:** Lista de tarefas disfarcada de relatorio: cada linha e um produto que falta, um sinonimo que falta ou uma categoria mal nomeada. Maior taxa de acao por linha de toda a suite e barato de implementar.
- **Quem faz:** Shopify (4 relatorios de busca interna)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `eventos_busca(termo_normalizado, sessao, qtd_resultados, houve_clique, houve_compra, em)`
- **Fonte:** help.shopify.com/.../behaviour-reports

### Catálogo (6)

#### Rascunho / ativo / arquivado, e nunca deletar de verdade

- **O que faz:** Produto arquivado some das listas ativas, preserva o historico e volta a qualquer momento. Produto deletado quebra pedidos antigos que apontam para ele.
- **Quem faz:** Shopify (archive), NN/g (soft delete)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `produtos.status CHECK ('rascunho','ativo','arquivado') + publicado_em/arquivado_em; a view publica filtra status='ativo'`
- **Fonte:** help.shopify.com/en/manual/products/add-update-products

#### Edicao em lote tipo planilha (preco, estoque, status)

- **O que faz:** Selecionar N produtos e editar em grade, salvando numa transacao com relatorio por linha. E o unico jeito humano de reajustar preco de 40 SKUs ou dar entrada de estoque depois de uma torra.
- **Quem faz:** Shopify (bulk editor), Tray (promocao em lote); Loja Integrada NAO tem e e a critica citada no Capterra
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `audit_log por campo (antes/depois) — reajuste errado precisa ser rastreavel`
- **Fonte:** help.shopify.com/en/manual/products/add-update-products

#### Campos fiscais: NCM, CEST, origem, CFOP, GTIN, unidade e pesos

- **O que faz:** NCM nao e enfeite: e obrigatorio para emitir NF-e, e sao exatamente os campos que o Bling exige no payload de produto. Sem eles a integracao fiscal trava depois.
- **Quem faz:** Tray, Loja Integrada (emite NF no painel), Bling
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `ALTER produtos ADD ncm, cest, origem_mercadoria, cfop_padrao, gtin, unidade_comercial, peso_liquido, peso_bruto`
- **Fonte:** basedeconhecimento.tray.com.br/.../Gestao-do-Painel-Administrativo

#### Colunas de completude ('sem imagem', 'sem peso', 'sem descricao') como filtro

- **O que faz:** Campos computados que expõem as lacunas do catalogo. O bulk editor so brilha quando o filtro que o alimenta e bom — a critica documentada ao da Shopify e exatamente nao conseguir ver quais rascunhos estao sem imagem.
- **Quem faz:** lacuna da Shopify apontada por lojistas
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `colunas geradas/derivadas; peso ausente quebra cotacao de frete, entao vira erro operacional`
- **Fonte:** help.shopify.com/en/manual/products/add-update-products

#### Colecoes dinamicas por regra em vez de lista de SKU

- **O que faz:** Categoria por regra ('todos os cafes com nota citrica', 'micro-lotes') que a promocao e o banner apontam. E o que evita o teto de 100 alvos por desconto e o trabalho manual quando entra safra nova.
- **Quem faz:** Shopify (coleccoes automaticas), VTEX (colecoes)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `colecoes(nome, tipo manual|regra, definicao jsonb) + colecao_produtos materializada`
- **Fonte:** help.shopify.com/.../discount-methods/discount-codes

#### Estoque minimo com alerta empurrado

- **O que faz:** Alerta de ruptura considerando lead time de torra, nao so quantidade; e alerta de 'muita visita, pouca venda', que aponta preco ou foto ruim antes de o mes fechar.
- **Quem faz:** Loja Integrada (Komea), Tray
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `produtos.estoque_minimo integer + indice parcial WHERE quantidade <= estoque_minimo`
- **Fonte:** lojaintegrada.com.br/funcionalidades

### Pedidos (5)

#### Saved views como abas por processo

- **O que faz:** Aba nomeada guardando busca, filtros, colunas visiveis, ordem das colunas e ordenacao. Duplicar uma view e o gesto que faz o recurso pegar: o lojista nunca comeca do zero. Transforma um filtro num processo ('Pedidos a despachar hoje').
- **Quem faz:** Shopify (views como tabs no index table)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `saved_views(usuario_id, entidade, nome, filtros jsonb com schema_version, colunas text[], ordenacao, posicao); guardar o SORT desde o comeco — a Shopify o perde ao navegar e admite isso`
- **Fonte:** help.shopify.com/.../searching-filtering-views

#### Acoes em lote com barra flutuante e distincao 'pagina' x 'todos do filtro'

- **O que faz:** Checkbox por linha, barra que so aparece com selecao, e a oferta explicita de 'selecionar todos os 1.284 que correspondem ao filtro'. Sem essa distincao, o lojista acha que arquivou 1.284 quando arquivou 50.
- **Quem faz:** Shopify (IndexTable), NN/g
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `endpoint aceita FILTRO (nao lista de ids) + chave de idempotencia, roda assincrono acima de N linhas e devolve resultado parcial ('ok: 47, falhou: 3')`
- **Fonte:** nngroup.com/articles/data-tables

#### Timeline de eventos no registro (webhook, e-mail, etiqueta, nota interna)

- **O que faz:** Mistura eventos automaticos e notas humanas na mesma linha do tempo, com filtro para esconder os automaticos. Transforma 'o cliente diz que pagou e o pedido esta pendente' de uma investigacao no banco numa leitura de 10 segundos.
- **Quem faz:** Shopify, NN/g
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `eventos(entidade, entidade_id, tipo, ator_id NULL=sistema, payload jsonb, em) com indice (entidade, entidade_id, em DESC); LGPD: nunca logar CPF completo nem dado de cartao no payload`
- **Fonte:** nngroup.com/articles/top-10-application-design-mistakes

#### Solicitacao de devolucao/troca como entidade

- **O que faz:** Estado proprio (solicitada, aprovada, recebida, resolvida) que alimenta a fila de tarefas da home e permite gerar credito/cupom de troca amarrado ao pedido de origem.
- **Quem faz:** Shopify (tarefa na Home), Tray (cupom de troca)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `devolucoes(pedido_id, itens jsonb, motivo, status, resolucao credito|estorno, credito_id)`
- **Fonte:** help.shopify.com/.../shopify-home

#### Detalhe em painel lateral nao-modal com 'proximo registro'

- **O que faz:** Abrir a linha num drawer mantendo a tabela visivel atras, com botao proximo/anterior. Modal e desaconselhado porque cobre exatamente os dados de referencia. Resolve triagem de avaliacoes e conferencia de pedidos — transforma 40 cliques em 12.
- **Quem faz:** NN/g (recomendacao explicita), Shopify
- **Importância:** diferencial · **Esforço:** medio
- **Modelo de dados:** `endpoint de detalhe leve + a URL refletindo o registro aberto (?pedido=1042) para F5 e link compartilhado funcionarem`
- **Fonte:** nngroup.com/articles/data-tables

### Clientes (8)

#### Segmentos de clientes por regra dinamica com datas relativas

- **O que faz:** Segmento e uma query salva ('ultimo pedido <= -90d', 'assinante ativo', 'comprou origem X'), nao uma lista estatica que envelhece em uma semana.
- **Quem faz:** Shopify (ShopifyQL, ~30 filtros), VTEX (audiences), Loja Integrada (grupos, versao simples e suficiente)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `segmentos(nome, definicao jsonb com AND/OR de um nivel) + materializacao periodica em segmento_membros`
- **Fonte:** help.shopify.com/.../reference-guide/shopify-segments

#### Campos derivados materializados no cliente

- **O que faz:** Primeiro pedido, ultimo pedido, numero de pedidos, gasto total, ticket medio e consentimento gravados na linha do cliente e atualizados no fechamento do pedido. E a diferenca entre relatorio instantaneo e relatorio que trava.
- **Quem faz:** Shopify, Nuvemshop, VTEX
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `ALTER clientes ADD primeiro_pedido_em, ultimo_pedido_em, pedidos_count, gasto_total_centavos, ticket_medio_centavos`
- **Fonte:** help.shopify.com/.../customers-reports

#### Consentimento de marketing como estado, com origem e data (LGPD)

- **O que faz:** Estado explicito (inscrito / pendente / descadastrado / nunca), a origem (rodape, pop-up, checkout), a data e o token de descadastro. Pre-marcar checkbox e decisao por jurisdicao, e para SMS/WhatsApp e simplesmente proibido pre-marcar.
- **Quem faz:** Shopify (consent state por regiao), Tray (newsletter viaja no relatorio), Nuvemshop
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `clientes.consentimento_email_estado/origem/em + newsletter_inscritos ja tem origem; adicionar token_descadastro e descadastrado_em`
- **Fonte:** help.shopify.com/.../checkout-form-options

#### Autogestao da assinatura pelo cliente (pular ciclo, trocar endereco, cartao e SKU)

- **O que faz:** Cancelar, pausar, pular um envio, trocar endereco e trocar o cafe do mes na conta do cliente. A limitacao mais dolorosa da Nuvemshop e exigir intervencao do lojista — vira volume de suporte e cancelamento por WhatsApp irritado.
- **Quem faz:** Nuvemshop (nao tem, e admite), VTEX (subscriptionGroup), Shopify
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `assinatura_eventos(assinatura_id, tipo pular|pausar|retomar|trocar_sku|trocar_endereco, efetivo_em, ator); a loja ja tem status pendente/ativa/pausada/cancelada`
- **Fonte:** atendimento.nuvemshop.com.br/.../venda-por-assinatura

#### Dunning: retry de cobranca recorrente e avisos do ciclo

- **O que faz:** Ate 3 tentativas com aviso ao cliente, mais e-mail de renovacao ANTES da cobranca (reduz chargeback). Churn involuntario por cartao vencido costuma ser maior que o voluntario em clubes brasileiros.
- **Quem faz:** Nuvemshop (3 tentativas)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `cobranca_tentativas(assinatura_id, ciclo, tentativa, resposta_gateway, proximo_retry_em)`
- **Fonte:** nuvemshop.com.br/solucoes/vendas-por-assinatura

#### Grupos de clientes (assinante, atacado/cafeteria, VIP)

- **O que faz:** A versao simples e viavel do 'campaign audience': um select de grupo nas promocoes e nos precos, em vez de um motor de criterios.
- **Quem faz:** Loja Integrada, VTEX, Tray
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `grupos_clientes + grupo_membros; a loja ja tem clientes, falta so a tabela e o campo nas promocoes`
- **Fonte:** ajuda.lojaintegrada.com.br/.../desconto-em-produtos

#### RFM com 11 segmentos NOMEADOS

- **O que faz:** Score de recencia/frequencia/valor traduzido em nomes acionaveis (Campeoes, Em risco, Quase perdidos, Dormentes). O nome e o produto: '555' nao diz qual campanha disparar.
- **Quem faz:** Shopify
- **Importância:** diferencial · **Esforço:** baixo
- **Modelo de dados:** `job periodico com ntile(5) OVER (...) em Postgres puro, gravando r, f, m e grupo no cliente — nao precisa de ML`
- **Fonte:** help.shopify.com/.../customers-reports

#### Politica comercial / preco por canal (assinante, atacado com CNPJ, marketplace)

- **O que faz:** Um eixo que separa catalogo, preco, frete e pagamento por canal. Resolve preco de assinante, de atacado e de marketplace sem duplicar produto. Toda consulta de preco passa a receber um contexto (canal + cliente), nunca 'o preco' solto.
- **Quem faz:** VTEX (trade policy + price tables)
- **Importância:** diferencial · **Esforço:** alto
- **Modelo de dados:** `canais + produto_precos(sku, canal_id, preco) UNIQUE(sku, canal_id)`
- **Fonte:** help.vtex.com/.../como-funciona-uma-politica-comercial

### Configurações (3)

#### Papeis e politicas de acesso reutilizaveis, com RLS

- **O que faz:** Politica como ENTIDADE ('Expedicao') aplicada a varias pessoas, em vez de checkbox por usuario. Quem embala nao precisa ver faturamento nem editar preco; quem cuida de conteudo nao precisa ver dado de cliente.
- **Quem faz:** Tray (politicas de acesso + 2FA), Loja Integrada (plano gratuito limita a 1 admin)
- **Importância:** essencial · **Esforço:** medio
- **Modelo de dados:** `politicas(nome, permissoes jsonb) + admins.politica_id; no Supabase desce para RLS por role — esconder o botao no front NAO impede o POST`
- **Fonte:** basedeconhecimento.tray.com.br/.../Gestao-do-Painel-Administrativo

#### Trilha de auditoria de quem mudou o que

- **O que faz:** Registro de ator, entidade, acao, antes e depois. Permissao sem auditoria nao serve para nada — o proprio relatorio de pedidos excluidos da Tray identifica quem excluiu.
- **Quem faz:** Tray, NN/g
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `audit_log(usuario_id, entidade, entidade_id, acao, antes jsonb, depois jsonb, em)`
- **Fonte:** basedeconhecimento.tray.com.br/.../Gestao-do-Painel-Administrativo

#### Barra de aviso e 'pausar a loja'

- **O que faz:** Botao pequeno de valor enorme: ferias coletivas, ruptura de safra e manutencao sem despublicar produto a produto, mantendo a vitrine navegavel e bloqueando so o checkout.
- **Quem faz:** Tray
- **Importância:** diferencial · **Esforço:** baixo
- **Modelo de dados:** `config_loja.pausada bool + mensagem_pausa (a loja ja tem barra_de_aviso); flag lida no middleware do Next.js`
- **Fonte:** basedeconhecimento.tray.com.br/.../Gestao-do-Painel-Administrativo

### Plataforma e UX (8)

#### Estado da lista na URL como fonte unica de verdade

- **O que faz:** Busca, filtros, ordenacao, pagina e colunas na query string, validados na entrada. Voltar do detalhe devolve exatamente a mesma lista — resetar filtro em silencio e a frustracao mais citada em tela de dados.
- **Quem faz:** AWS Cloudscape (padrao formal), Shopify
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `a API aceita os mesmos parametros 1:1; sort so por coluna de uma whitelist indexada, senao e injecao e sequential scan; NUNCA dado pessoal na URL`
- **Fonte:** cloudscape.design/patterns/general/filter-patterns/filter-persistence-in-collection-views

#### Save bar contextual com descarte e guarda de navegacao

- **O que faz:** Assim que o formulario fica sujo, uma barra fixa aparece com 'Alteracoes nao salvas' + Descartar + Salvar, e sair da pagina pede confirmacao. Exatamente dois botoes, nunca vira menu.
- **Quem faz:** Shopify (Save Bar API; requisito do Built for Shopify)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `dirty state por deep-equal do snapshot inicial; enviar updated_at no PATCH e responder 409 quando outra pessoa alterou`
- **Fonte:** shopify.dev/.../save-bar-api

#### Filtros como chips com contagem de resultados e 'Limpar tudo'

- **O que faz:** Chips removiveis comunicam que os filtros sao aditivos; a contagem evita o estado vazio surpresa; e 'Limpar tudo' e o lembrete visual que resolve a causa numero um de chamado ('sumiu meu pedido' = filtro esquecido).
- **Quem faz:** Cloudscape, Shopify, Pencil&Paper
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `cada filtro exposto precisa de indice, senao vira scan; nao espelhar cegamente todas as colunas como filtro`
- **Fonte:** pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering

#### Busca sempre visivel, com atalho de teclado

- **O que faz:** Campo permanente no topo da lista, com foco por '/' e busca em varios campos (numero, nome, e-mail, telefone). A Shopify escondeu a busca atras de um icone e levou revolta documentada dos lojistas.
- **Quem faz:** Shopify (contraexemplo custoso)
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `a loja ja tem tsvector em produtos; replicar para pedidos e clientes, ou pg_trgm para erro de digitacao`
- **Fonte:** community.shopify.com/t/admin-panels-poor-design-updates-what-is-shopify-doing/182863

#### Idempotencia e estado honesto em operacao com dinheiro

- **O que faz:** Reembolso, cobranca e baixa de estoque mostram 'processando' e so confirmam depois da resposta do servidor; UI otimista fica so para acao reversivel. Botao critico vira disabled + spinner e nunca aceita duplo clique.
- **Quem faz:** NN/g; a loja ja usa chave de idempotencia no checkout e no webhook do MP
- **Importância:** essencial · **Esforço:** baixo
- **Modelo de dados:** `idempotency key por acao financeira + status intermediario gravado no banco, nao inferido pelo front`
- **Fonte:** nngroup.com/articles/top-10-application-design-mistakes

#### Colunas configuraveis por view, com densidade ajustavel

- **O que faz:** A escolha de colunas pertence a VIEW, nao ao usuario global — duas abas do mesmo lojista mostram colunas diferentes porque servem a tarefas diferentes. E isso que torna a aba um modo de trabalho.
- **Quem faz:** Shopify, Pencil&Paper (40/48/56px de altura de linha)
- **Importância:** importante · **Esforço:** medio
- **Modelo de dados:** `catalogo de colunas por recurso (chave, rotulo, tipo, ordenavel, permissao) guardando so as CHAVES na view, para coluna nova nao quebrar view antiga; colunas como 'custo' e 'margem' com gate por papel`
- **Fonte:** pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables

#### Paginacao por keyset em vez de scroll infinito

- **O que faz:** Lista administrativa e tarefa, nao descoberta: scroll infinito destroi a refindabilidade, torna o rodape inalcancavel e quebra teclado e leitor de tela.
- **Quem faz:** NN/g, Shopify (cursor com hasNextPage)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `(criado_em, id) < (:cursor) com desempate estavel por id; OFFSET grande fica lento e pula linhas quando chegam pedidos novos`
- **Fonte:** nngroup.com/articles/infinite-scrolling-tips

#### Estados vazios distintos: nunca houve dado, filtro sem resultado, erro

- **O que faz:** Tres textos e tres CTAs diferentes — 'Criar', 'Limpar filtros', 'Tentar novamente'. Um 'Nenhum resultado encontrado' generico serve mal as tres situacoes.
- **Quem faz:** Shopify (empty state), Atlassian (blank slate como conceito separado)
- **Importância:** importante · **Esforço:** baixo
- **Modelo de dados:** `a listagem precisa devolver total_sem_filtro junto com total_filtrado, senao o front nao sabe qual mensagem usar`
- **Fonte:** shopify.dev/.../patterns/compositions/empty-state

---

## 4. Especificidades brasileiras

O que o mercado brasileiro exige e que a Shopify não faz nativamente.

- Desconto por meio de pagamento (PIX e boleto) e expectativa basica do lojista brasileiro e NAO existe na Shopify. Nuvemshop, Tray e VTEX tem — mas a Nuvemshop admite na doc que o dela e global para a loja inteira. Nascer com escopo por categoria/produto ja e uma vantagem, nao um capricho.
- CPF e a unica chave confiavel de limite por cliente. E-mail e infinito e gratuito, entao 'cupom de primeira compra' controlado por e-mail e cupom permanente. A Loja Integrada faz por CPF por isso. Guarde HASH do CPF no resgate, nao o numero — e mais uma copia de dado pessoal que a LGPD nao perdoa (e as migracoes 0013/0016 desta loja ja passaram por essa dor).
- NF-e trava tudo: NCM, CEST, origem da mercadoria, CFOP, GTIN, unidade comercial e pesos liquido/bruto precisam existir no cadastro de produto antes da integracao com o Bling, nao depois. Loja Integrada emite NF no proprio painel e isso e a regua com que o lojista brasileiro compara.
- Frete e geografia: faixa de CEP e UF, nao 'pais'. Normalize o CEP para inteiro sem hifen antes de comparar — comparar '01310-100' com '01310100' e um bug que so aparece em producao (e esta loja ja teve um dessa familia no CEP de origem). Nuvemshop nao consegue frete gratis por cidade e obriga gambiarra; VTEX resolve com zipCodeRanges.
- 'So na modalidade de envio mais barata' e um campo brasileiro por necessidade: sem ele o cliente escolhe SEDEX de graca quando a loja queria bancar o PAC. Some a isso um teto de valor do frete, porque o Brasil tem dispersao de custo enorme entre Sudeste e Norte.
- WhatsApp converte muito mais que e-mail na recuperacao de carrinho — a Tray tem rota propria para isso. Mas o consentimento de WhatsApp/SMS NUNCA pode nascer pre-marcado, nem por regiao (a Shopify proibe pre-selecao de SMS em toda jurisdicao).
- LGPD: consentimento e um ESTADO com origem e data, nao um booleano. Guardar 'de onde veio o opt-in' (rodape, pop-up, checkout) e o que prova o consentimento depois. Toda exportacao de lista com nome/endereco/CPF precisa de log de quem exportou e quando.
- Assinatura presa a um unico gateway e a um unico meio de pagamento exclui a fatia que so usa PIX — e Pix Automatico existe. Modele o meio de pagamento da assinatura como campo, nunca como constante (o erro que a Nuvemshop cometeu ao exigir Nuvem Pago + cartao).
- Parcelamento e desconto a vista sao parte da decisao de compra no Brasil e precisam aparecer no carrinho, nao so no checkout — o cliente compara 'R$ 100 no cartao / R$ 95 no PIX' antes de decidir a quantidade.
- Atacado com CNPJ (cafeteria, escritorio, revenda) e um canal real para cafe especial e pede preco por canal — o conceito de politica comercial da VTEX. Sem ele, a saida e duplicar produto, que desalinha estoque e relatorio.
- Cupom de troca e vale-presente sao esperados por aqui: devolucao virando credito em vez de estorno mantem o cliente no funil, e vale-presente de cafe e produto de Natal e Dia dos Pais com margem alta e caixa antecipado.
- Cupom vaza em grupo de WhatsApp e em site agregador — e nao ha barreira nativa em nenhuma plataforma. Por isso limite total de uso, limite por CPF e teto de orcamento da campanha em reais sao guardrails padrao no Brasil, nao recursos avancados.
- Cafe e sazonal por safra e por torra: 'pausar a loja' com mensagem, estoque minimo considerando lead time de torra e data de ciclo da assinatura casada com o dia da torra sao uso real, nao hipotetico. Assinante que recebe cafe velho cancela.
- Fuso America/Sao_Paulo em toda apresentacao e em todo agregado diario. Um pedido feito 22h de Brasilia gravado como dia seguinte destroi a confianca em todos os relatorios de fechamento de mes — e e o tipo de erro que so aparece na conferencia com o contador.
- O suporte das plataformas brasileiras e queixa cronica (a Tray acumula 6.516 reclamacoes no Reclame Aqui, 451 so de 'site fora do ar/lentidao'), e recurso que so liga por chamado ('o modulo de e-mail marketing precisa ser ativado via suporte') e o padrao que a loja propria elimina de graca: tudo que existe esta ligado e visivel.
- Melhor Envio e o hub de frete de fato do pequeno e-commerce brasileiro, e ja aparece nominalmente em reclamacoes de instabilidade em outras plataformas — vale tratar a cotacao como servico que pode falhar, com fallback e mensagem honesta, e nao como chamada que sempre responde.

---

## 5. Esquemas de referência

> DDL de **referência**, saído da pesquisa. Não é a migração desta loja — a migração real
> nasce da spec, adaptada ao schema `canastra` que já existe.

### 5.1 Promoções e cupons

```sql
-- 0017_motor_de_promocoes.sql
--
-- O QUE ESTA MIGRACAO FAZ: transforma `canastra.promocoes` (hoje: titulo,
-- tipo, valor, aplica_a, categoria, produto_id, datas) e `canastra.cupons`
-- (hoje: codigo, tipo, valor, minimo, limite) em UMA entidade so — a mesma
-- licao que Shopify (campo `method`), Medusa (`is_automatic`) e Saleor
-- (Promotion x Voucher) aprenderam: promocao e cupom nao sao features
-- diferentes, sao a mesma regra com formas de entrega diferentes.
--
-- REGRA DE DINHEIRO DA CASA, mantida: valor de DECISAO vai em CENTAVOS
-- inteiro (como `minimo_centavos` em 0010 e `frete_gratis_minimo_centavos`
-- em 0009); `pedidos.total/frete/desconto` continuam numeric(10,2) porque
-- somam juntos na conferencia de um pedido. Nada aqui muda esses tres.
--
-- Enum como text + CHECK, e nao CREATE TYPE, seguindo 0010/0015: acrescentar
-- um valor a um enum do Postgres nao pode rodar dentro de transacao em
-- versoes antigas e nao pode ser removido nunca; um CHECK se reescreve.

-- ---------------------------------------------------------------------------
-- 1. A CAMPANHA: o teto de gasto que protege a margem quando o cupom vaza
-- ---------------------------------------------------------------------------
CREATE TABLE canastra.campanhas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           text NOT NULL,
  identificador  text NOT NULL UNIQUE,        -- slug estavel p/ UTM e relatorio
  inicio_em      timestamptz,
  fim_em         timestamptz,

  -- 'gasto' soma o desconto concedido; 'usos' conta resgates. NULL = sem teto.
  -- Regra operacional copiada do Medusa: promocao ja aplicada a um carrinho
  -- continua valida ate o pedido fechar mesmo se o teto estourar no meio —
  -- aceita-se um pequeno overshoot em vez de quebrar o checkout de alguem.
  orcamento_tipo         text
    CONSTRAINT campanhas_orcamento_tipo_valido
      CHECK (orcamento_tipo IS NULL OR orcamento_tipo IN ('gasto', 'usos')),
  orcamento_limite       bigint,              -- centavos se 'gasto', unidades se 'usos'
  orcamento_usado        bigint NOT NULL DEFAULT 0,

  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()  -- mantida por quem escreve
);

-- ---------------------------------------------------------------------------
-- 2. A PROMOCAO: colunas novas sobre a tabela que ja existe
-- ---------------------------------------------------------------------------
ALTER TABLE canastra.promocoes
  -- Entrega: automatica (aplica sozinha) x codigo (cliente digita).
  -- Limite de uso e limite por cliente SO fazem sentido em 'codigo' — em
  -- automatica nao ha a quem amarrar antes de o cliente se identificar.
  ADD COLUMN metodo text NOT NULL DEFAULT 'automatica'
    CONSTRAINT promocoes_metodo_valido CHECK (metodo IN ('automatica', 'codigo')),

  -- A classe fixa a ORDEM DE CALCULO, e e ela que torna a conta auditavel:
  -- (1) produto sobre cada linha -> (2) pedido sobre o subtotal JA reduzido ->
  -- (3) frete. Sem ordem declarada, o motor vira caixa-preta e o suporte nao
  -- consegue explicar ao cliente por que deu R$ X.
  ADD COLUMN classe text NOT NULL DEFAULT 'produto'
    CONSTRAINT promocoes_classe_valida CHECK (classe IN ('produto', 'pedido', 'frete')),

  -- Desempate quando duas regras cabem no mesmo carrinho (licao do Sylius):
  -- maior prioridade ganha; `exclusiva` descarta todas as outras; duas
  -- promocoes do mesmo `grupo_empilhamento` nunca convivem no mesmo pedido.
  ADD COLUMN prioridade integer NOT NULL DEFAULT 0,
  ADD COLUMN exclusiva boolean NOT NULL DEFAULT false,
  ADD COLUMN grupo_empilhamento text,

  -- Com quais CLASSES esta promocao aceita se somar. Vazio = nao empilha, que
  -- e o default seguro da Shopify: o silencio protege a margem. Empilhar exige
  -- consentimento dos DOIS lados (A.combina_com contem a classe de B E vice-versa).
  ADD COLUMN combina_com text[] NOT NULL DEFAULT '{}',

  -- Falta na Shopify e e a reclamacao numero um dos lojistas desde 2021:
  -- cupom de 15% caindo sobre item que ja tem 15% de markdown = ~30% off.
  ADD COLUMN aplica_em_item_ja_promocionado boolean NOT NULL DEFAULT false,

  -- 'cada' => R$ 20 off em 3 pacotes custa R$ 60. 'rateado' => custa R$ 20,
  -- distribuidos entre as linhas. E a ambiguidade que mais derruba margem.
  ADD COLUMN alocacao text NOT NULL DEFAULT 'cada'
    CONSTRAINT promocoes_alocacao_valida CHECK (alocacao IN ('cada', 'rateado')),

  -- Teto em reais para desconto PERCENTUAL. Sem ele, 25% num pedido de
  -- cafeteria apaga o lucro do mes (campo que a Loja Integrada tem e a
  -- Shopify nao).
  ADD COLUMN teto_desconto_centavos integer
    CONSTRAINT promocoes_teto_positivo CHECK (teto_desconto_centavos IS NULL OR teto_desconto_centavos > 0),

  -- Requisito de entrada: valor OU quantidade, NUNCA os dois (dois radios e um
  -- campo, nao dois campos). O CHECK garante o par coerente.
  ADD COLUMN minimo_tipo text NOT NULL DEFAULT 'nenhum'
    CONSTRAINT promocoes_minimo_tipo_valido CHECK (minimo_tipo IN ('nenhum', 'subtotal', 'quantidade')),
  ADD COLUMN minimo_valor integer,   -- centavos se 'subtotal', unidades se 'quantidade'

  ADD COLUMN limite_usos integer
    CONSTRAINT promocoes_limite_positivo CHECK (limite_usos IS NULL OR limite_usos > 0),
  ADD COLUMN limite_usos_por_cliente integer
    CONSTRAINT promocoes_limite_cliente_positivo CHECK (limite_usos_por_cliente IS NULL OR limite_usos_por_cliente > 0),
  ADD COLUMN apenas_primeira_compra boolean NOT NULL DEFAULT false,

  -- Cancelado devolve o uso. Sem isto, cliente com Pix expirado perde o cupom
  -- e abre chamado (campo `reusableFromCancelledOrders` do Sylius).
  ADD COLUMN reutilizavel_em_pedido_cancelado boolean NOT NULL DEFAULT true,

  -- O CLUBE: desconto de aquisicao que expira depois de N cobrancas em vez de
  -- virar desconto vitalicio. Quase nenhuma plataforma pequena tem isto.
  ADD COLUMN tipo_compra text NOT NULL DEFAULT 'ambos'
    CONSTRAINT promocoes_tipo_compra_valido CHECK (tipo_compra IN ('avulso', 'assinatura', 'ambos')),
  ADD COLUMN limite_ciclos integer
    CONSTRAINT promocoes_ciclos_positivo CHECK (limite_ciclos IS NULL OR limite_ciclos > 0),

  ADD COLUMN campanha_id uuid REFERENCES canastra.campanhas (id) ON DELETE SET NULL,

  -- Escape do Saleor: condicao composta com AND/OR de UM nivel, para o que nao
  -- couber nas regras tabulares abaixo. Deliberadamente pouco usado — predicado
  -- aninhado e impossivel de editar numa tela.
  ADD COLUMN predicado jsonb,

  ADD CONSTRAINT promocoes_minimo_coerente
    CHECK ((minimo_tipo = 'nenhum' AND minimo_valor IS NULL)
        OR (minimo_tipo <> 'nenhum' AND minimo_valor IS NOT NULL AND minimo_valor > 0));

-- `ativa` (que ja existe) e o KILL-SWITCH manual, separado do calendario: da
-- para desligar as pressas sem apagar as datas. O STATUS mostrado no painel
-- (agendada / ativa / expirada) e DERIVADO e nunca gravado — status gravado
-- dessincroniza no primeiro esquecimento.
CREATE VIEW canastra.promocoes_status AS
  SELECT p.*,
         CASE
           WHEN NOT p.ativa                              THEN 'desligada'
           WHEN p.inicio_em IS NOT NULL
                AND now() < p.inicio_em                  THEN 'agendada'
           WHEN p.fim_em IS NOT NULL
                AND now() > p.fim_em                     THEN 'expirada'
           ELSE 'ativa'
         END AS situacao
    FROM canastra.promocoes p;

-- Indice PARCIAL: o resolvedor de carrinho so varre promocao automatica viva.
-- E o mesmo motivo do teto de 25 automaticas da Shopify e das 100 da VTEX —
-- toda promocao ativa e avaliada em TODO calculo de carrinho.
CREATE INDEX promocoes_automaticas_vivas_idx
  ON canastra.promocoes (prioridade DESC, inicio_em)
  WHERE ativa AND metodo = 'automatica';

-- ---------------------------------------------------------------------------
-- 3. OS CODIGOS: N por promocao (influenciador, campanha, codigo unico)
-- ---------------------------------------------------------------------------
-- Por que tabela filha e nao coluna `codigo` na promocao: com a coluna, migrar
-- depois para "500 codigos unicos, um por influenciador" obriga a reescrever
-- validacao, checkout e relatorio. Saleor teve de fazer essa migracao (Voucher
-- -> VoucherCode) e nao ha razao para repetir o erro conhecendo o final.
CREATE TABLE canastra.promocao_codigos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id  uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  -- MESMO CHECK de 0010, pelo mesmo motivo: o servico grava MAIUSCULO e a busca
  -- e por igualdade exata; um codigo minusculo inserido a mao seria invisivel
  -- para sempre. A-Z0-9 tambem garante que o codigo caiba numa URL de
  -- compartilhamento sem escaping.
  codigo       text NOT NULL UNIQUE
    CONSTRAINT promocao_codigos_formato CHECK (codigo ~ '^[A-Z0-9]{3,30}$'),

  uso_unico    boolean NOT NULL DEFAULT false,  -- desativa no primeiro resgate
  usos         integer NOT NULL DEFAULT 0
    CONSTRAINT promocao_codigos_usos_nao_negativo CHECK (usos >= 0),
  limite_usos  integer
    CONSTRAINT promocao_codigos_limite_positivo CHECK (limite_usos IS NULL OR limite_usos > 0),
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promocao_codigos_promocao_idx ON canastra.promocao_codigos (promocao_id);

-- ---------------------------------------------------------------------------
-- 4. AS REGRAS: (atributo, operador, valores) — estilo Medusa
-- ---------------------------------------------------------------------------
-- Tres escopos, e a diferenca entre eles e o que confunde todo mundo:
--   elegibilidade -> a promocao vale para ESTE carrinho?
--   alvo          -> QUAIS linhas recebem o desconto
--   gatilho       -> o "compre X" do leve-3-pague-2
--   excecao       -> o que a regra NAO alcanca (o "Restricao" da Tray, sem o
--                    qual nao da para dar 10% na loja toda protegendo o micro-lote)
CREATE TABLE canastra.promocao_regras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id  uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,
  escopo       text NOT NULL DEFAULT 'elegibilidade'
    CONSTRAINT promocao_regras_escopo_valido
      CHECK (escopo IN ('elegibilidade', 'alvo', 'gatilho', 'excecao')),

  -- Vocabulario FECHADO no codigo (nao no banco, para nao exigir migracao a
  -- cada atributo novo), resolvido como caminho no carrinho. Os que a loja usa:
  --   'itens.sku' | 'itens.categoria' | 'itens.quantidade'
  --   'subtotal_centavos' | 'carrinho.tem_assinatura'
  --   'cliente.grupo' | 'cliente.pedidos_count' | 'cliente.aniversario_mes'
  --   'entrega.uf' | 'entrega.cep' | 'pagamento.metodo'
  atributo     text NOT NULL,
  operador     text NOT NULL
    CONSTRAINT promocao_regras_operador_valido
      CHECK (operador IN ('igual', 'diferente', 'em', 'nao_em', 'maior', 'maior_igual', 'menor', 'menor_igual')),
  descricao    text
);
CREATE INDEX promocao_regras_promocao_idx ON canastra.promocao_regras (promocao_id, escopo);

-- Valores em tabela filha, e nao array: permite indexar e fazer 'em' em SQL,
-- e permite contar alvos (o teto de 100 da Shopify existe por um motivo).
CREATE TABLE canastra.promocao_regra_valores (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra_id uuid NOT NULL REFERENCES canastra.promocao_regras (id) ON DELETE CASCADE,
  valor    text NOT NULL
);
CREATE INDEX promocao_regra_valores_regra_idx ON canastra.promocao_regra_valores (regra_id);

-- ---------------------------------------------------------------------------
-- 5. FRETE E FAIXAS DE CEP — o pedaco mais brasileiro do motor
-- ---------------------------------------------------------------------------
CREATE TABLE canastra.promocao_frete (
  promocao_id  uuid PRIMARY KEY REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  -- Olha o VALOR DO FRETE, nao o do pedido (a propria doc da Shopify precisa
  -- avisar isso porque o lojista confunde). Sem este teto, "frete gratis acima
  -- de R$ 149" significa bancar um SEDEX de R$ 90 para o Acre.
  teto_frete_centavos integer
    CONSTRAINT promocao_frete_teto_positivo CHECK (teto_frete_centavos IS NULL OR teto_frete_centavos > 0),

  ufs text[],                                    -- NULL = Brasil inteiro
  -- O campo mais util da Nuvemshop: evita o cliente escolher SEDEX de graca
  -- quando a loja queria bancar so o PAC.
  apenas_modalidade_mais_barata boolean NOT NULL DEFAULT true,
  modalidades text[]                             -- NULL = todas
);

-- CEP em INTEIRO, nao texto, e ja normalizado sem hifen — a loja ja teve um bug
-- desta familia no CEP de origem do frete. Comparar '01310-100' com '01310100'
-- e um erro que so aparece em producao, para o cliente.
CREATE TABLE canastra.promocao_faixas_cep (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,
  cep_inicio  integer NOT NULL CHECK (cep_inicio BETWEEN 0 AND 99999999),
  cep_fim     integer NOT NULL CHECK (cep_fim   BETWEEN 0 AND 99999999),
  CONSTRAINT promocao_faixas_cep_ordem CHECK (cep_fim >= cep_inicio)
);
CREATE INDEX promocao_faixas_cep_idx ON canastra.promocao_faixas_cep (promocao_id, cep_inicio, cep_fim);

-- ---------------------------------------------------------------------------
-- 6. DEGRAUS (progressivo) E BRINDES
-- ---------------------------------------------------------------------------
-- Maximo deliberado de 5 degraus: acima disso a tela vira planilha e ninguem
-- consegue conferir (a Loja Integrada para em 3, por escolha).
CREATE TABLE canastra.promocao_faixas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,
  minimo      integer NOT NULL CHECK (minimo > 0),  -- centavos ou unidades, conforme minimo_tipo
  tipo_valor  text NOT NULL
    CONSTRAINT promocao_faixas_tipo_valido CHECK (tipo_valor IN ('percent', 'fixed', 'preco_fixo')),
  valor       integer NOT NULL CHECK (valor > 0),   -- pontos percentuais x100, ou centavos
  UNIQUE (promocao_id, minimo)
);

-- Estoque minimo de seguranca (ideia da Tray): desliga a campanha ANTES de
-- prometer brinde que a expedicao nao tem. O brinde entra no pedido como item
-- de preco zero que BAIXA ESTOQUE e aparece na NF-e — nao e um enfeite de UI.
CREATE TABLE canastra.promocao_brindes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id    uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,
  sku            text NOT NULL,       -- texto, nao FK: fotografia (mesma licao de 0010/0015)
  quantidade     integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  estoque_minimo integer NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0)
);

-- ---------------------------------------------------------------------------
-- 7. RESGATE: a fonte da verdade do uso (nao o contador)
-- ---------------------------------------------------------------------------
-- `promocao_codigos.usos` continua existindo para o UPDATE atomico do checkout
-- (`SET usos = usos + 1 WHERE usos < limite_usos`, dentro da mesma transacao da
-- reserva de estoque, como ja e feito em 0010) — mas quem responde "quantas
-- vezes esta campanha foi usada" e "este CPF ja usou" e ESTA tabela. Contador
-- denormalizado atualizado por job e exatamente o bug que a Shopify documenta
-- em asyncUsageCount.
CREATE TABLE canastra.promocao_resgates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id    uuid NOT NULL REFERENCES canastra.promocoes (id) ON DELETE CASCADE,
  codigo_id      uuid REFERENCES canastra.promocao_codigos (id) ON DELETE SET NULL,
  pedido_id      uuid NOT NULL REFERENCES canastra.pedidos (pedido_id) ON DELETE CASCADE,
  user_id        uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- CPF em HASH, nunca em claro. O limite por cliente precisa funcionar para
  -- quem compra como convidado (a maioria), e e-mail nao serve — e gratuito e
  -- infinito, entao "cupom de primeira compra" por e-mail e cupom permanente.
  -- Hash preserva a comparacao sem criar mais uma copia de dado pessoal, que e
  -- exatamente o que 0013/0016 passaram a limpo.
  documento_hash text,

  valor_descontado_centavos integer NOT NULL CHECK (valor_descontado_centavos >= 0),
  criado_em      timestamptz NOT NULL DEFAULT now(),

  -- Um resgate por promocao por pedido: e o que impede o mesmo cupom contar
  -- duas vezes se o checkout for reprocessado.
  UNIQUE (promocao_id, pedido_id)
);
CREATE INDEX promocao_resgates_por_cliente_idx ON canastra.promocao_resgates (promocao_id, documento_hash);
CREATE INDEX promocao_resgates_campanha_idx     ON canastra.promocao_resgates (promocao_id, criado_em DESC);

-- ---------------------------------------------------------------------------
-- 8. O RASTRO NO PEDIDO: uma linha por desconto aplicado
-- ---------------------------------------------------------------------------
-- Sem esta tabela nao existe (a) relatorio de custo por campanha, (b) NF-e com
-- desconto rateado por item, (c) estorno proporcional em devolucao parcial, nem
-- (d) defesa em reclamacao de cliente. `pedidos.desconto` continua sendo o total
-- — esta tabela e a decomposicao dele.
--
-- `item_indice` aponta para a POSICAO em `pedidos.itens` (jsonb), porque esta
-- loja nao tem tabela de itens de pedido; `item_sku` viaja junto como
-- fotografia legivel. NULL nos dois = desconto de pedido ou de frete.
CREATE TABLE canastra.pedido_ajustes_desconto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    uuid NOT NULL REFERENCES canastra.pedidos (pedido_id) ON DELETE CASCADE,
  item_indice  integer,
  item_sku     text,
  alvo         text NOT NULL
    CONSTRAINT pedido_ajustes_alvo_valido CHECK (alvo IN ('item', 'pedido', 'frete')),

  promocao_id  uuid REFERENCES canastra.promocoes (id) ON DELETE SET NULL,
  -- Snapshot TEXTUAL: sobrevive a exclusao da promocao, exatamente como
  -- `pedidos.cupom_codigo` de 0010 sobrevive a exclusao do cupom.
  codigo       text,
  rotulo       text NOT NULL,        -- 'CANASTRA10 - 10% off' congelado
  valor_centavos integer NOT NULL CHECK (valor_centavos >= 0),
  regra_snapshot jsonb,              -- copia da regra no momento da aplicacao
  sequencia    integer NOT NULL DEFAULT 0,  -- ordem de aplicacao, p/ reproduzir a conta
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedido_ajustes_pedido_idx   ON canastra.pedido_ajustes_desconto (pedido_id);
CREATE INDEX pedido_ajustes_promocao_idx ON canastra.pedido_ajustes_desconto (promocao_id);

-- INVARIANTE PARA TESTAR EM CI, e o unico jeito de achar erro de arredondamento
-- antes do cliente achar:
--   SUM(pedido_ajustes_desconto.valor_centavos) / 100 = pedidos.desconto
-- No rateio de valor fixo entre linhas, distribua a sobra UM CENTAVO POR VEZ em
-- ordem estavel (por item_indice) — divisao simples faz a soma das linhas nao
-- bater com o total e a NF-e sai errada. E o `apply_coupon_remainder` do
-- WooCommerce, que existe porque esse bug e inevitavel sem ele.

-- ---------------------------------------------------------------------------
-- 9. MIGRACAO DOS CUPONS QUE JA EXISTEM
-- ---------------------------------------------------------------------------
-- Cada cupom vira uma promocao de classe 'pedido' com metodo 'codigo' e um
-- codigo filho. Roda uma vez; `canastra.cupons` fica como esta ate o servico
-- passar a ler daqui, e so entao e derrubada (nunca as duas coisas no mesmo
-- deploy — a loja esta NO AR).
INSERT INTO canastra.promocoes
  (titulo, descricao, tipo, valor, metodo, classe, ativa, inicio_em, fim_em,
   minimo_tipo, minimo_valor, limite_usos)
SELECT c.codigo, c.descricao, c.tipo, c.valor, 'codigo', 'pedido', c.ativo,
       c.inicio_em, c.fim_em,
       CASE WHEN c.minimo_centavos > 0 THEN 'subtotal' ELSE 'nenhum' END,
       NULLIF(c.minimo_centavos, 0),
       c.limite_usos
  FROM canastra.cupons c;

INSERT INTO canastra.promocao_codigos (promocao_id, codigo, usos, limite_usos, ativo)
SELECT p.id, c.codigo, c.usos, c.limite_usos, c.ativo
  FROM canastra.cupons c
  JOIN canastra.promocoes p ON p.titulo = c.codigo AND p.metodo = 'codigo';

-- ---------------------------------------------------------------------------
-- 10. FECHO — a postura de 0010: motor de desconto e assunto do servidor
-- ---------------------------------------------------------------------------
-- A lista completa de promocoes e o mapa de descontos da loja: quem a le
-- descobre todos os codigos. `anon` ja tem SELECT em `promocoes` desde 0005
-- (a vitrine mostra promocao ativa) — por isso o que e SENSIVEL fica nas
-- tabelas filhas, que nao levam GRANT nenhum. A validacao publica continua
-- sendo POST /cupons/validar, que responde so sobre O codigo perguntado.
ALTER TABLE canastra.campanhas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_codigos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_regras          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_regra_valores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_frete           ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_faixas_cep      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_faixas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_brindes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_resgates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.pedido_ajustes_desconto  ENABLE ROW LEVEL SECURITY;

-- Mesmo REVOKE de 0010/0011: o pacote arwd que 0001 concede por padrao a
-- `authenticated` esta inerte sob RLS sem politica, mas a primeira politica
-- ampla escrita daqui a seis meses o acordaria. `promocao_resgates` e o caso
-- grave: guarda hash de documento e liga cliente a pedido.
REVOKE ALL ON canastra.campanhas, canastra.promocao_codigos,
              canastra.promocao_regras, canastra.promocao_regra_valores,
              canastra.promocao_frete, canastra.promocao_faixas_cep,
              canastra.promocao_faixas, canastra.promocao_brindes,
              canastra.promocao_resgates, canastra.pedido_ajustes_desconto
  FROM authenticated;
```

### 5.2 Banners e conteúdo

```sql
-- 0018_conteudo_visual.sql
--
-- O QUE ESTA MIGRACAO RESOLVE: hoje o conteudo visual da loja sao DUAS COLUNAS
-- DE TEXTO em `canastra.config_loja` (`banner_desktop`, `banner_mobile`) — uma
-- URL cada, sem ALT, sem link, sem ordem, sem agendamento e sem historico. Sair
-- da Tray sem isto e entregar ao lojista menos do que ele ja tinha.
--
-- A DECISAO CENTRAL, e ela e uma escolha CONTRA a Shopify: agendamento vive no
-- proprio banner (`inicio_em`/`fim_em`), calculado por now() BETWEEN na
-- consulta. Na Shopify agendar banner exige plano Plus (Launchpad, que troca o
-- TEMA INTEIRO) ou app pago — existe um mercado de apps so para isso. Duas
-- colunas timestamptz entregam numa tarde o que la e um produto a parte.
--
-- A segunda escolha contra a Tray: posicao com nome SEMANTICO. La as posicoes
-- se chamam "Extra 1" a "Extra 12" e so o manual do tema (hospedado por uma
-- agencia terceira) diz o que cada uma e. E onde o lojista trava.

-- ---------------------------------------------------------------------------
-- 1. MIDIA: o arquivo, com ALT no ARQUIVO e nao no uso
-- ---------------------------------------------------------------------------
CREATE TABLE canastra.midias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Caminho no Supabase Storage. A URL publica e DERIVADA (caminho + query de
  -- transformacao: largura, qualidade, formato), nunca armazenada por variante
  -- — guardar uma linha por tamanho explode a tabela e desatualiza sozinho.
  caminho       text NOT NULL UNIQUE,

  nome_arquivo  text NOT NULL,
  mime          text NOT NULL,
  bytes         integer NOT NULL CHECK (bytes > 0),
  largura       integer CHECK (largura  IS NULL OR largura  > 0),
  altura        integer CHECK (altura   IS NULL OR altura   > 0),

  -- O ALT mora aqui e e HERDADO por todo uso: o lojista escreve uma vez ao
  -- subir e nao esquece depois. Quem quiser um ALT diferente num uso especifico
  -- sobrescreve em `banners.alt_override` (a Shopify nao permite isso, e e a
  -- critica valida ao modelo dela).
  alt           text,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL
);

-- Busca por ALT: na pratica e a unica busca de imagem que existe num painel.
CREATE INDEX midias_alt_idx ON canastra.midias USING gin (to_tsvector('portuguese', coalesce(alt, '')));

-- ---------------------------------------------------------------------------
-- 2. POSICOES: o gabarito mora NO PAINEL, ao lado do campo de upload
-- ---------------------------------------------------------------------------
-- Tabela de configuracao, e nao enum, porque quem cadastra uma posicao nova e
-- quem mexe no front — e a dimensao exigida precisa aparecer AO LADO do campo
-- de upload e ser validada no submit, com mensagem clara. Na Tray essa
-- informacao mora fora do painel e o resultado e banner esticado ou cortado a
-- cada troca de tema.
CREATE TABLE canastra.banner_posicoes (
  posicao            text PRIMARY KEY,   -- 'home_hero', 'home_faixa_meio', 'categoria_topo', 'rodape'
  rotulo             text NOT NULL,      -- 'Topo da home (o primeiro que o cliente ve)'
  descricao          text,               -- onde aparece, em portugues, na propria tela
  largura_px         integer NOT NULL,
  altura_px          integer NOT NULL,
  largura_mobile_px  integer,
  altura_mobile_px   integer,

  -- ROTATIVO E PROPRIEDADE DA POSICAO, no mesmo lugar do upload. Na Tray o
  -- cadastro esta em Marketing e o interruptor do carrossel esta em Design da
  -- Loja > Editar Tema: o lojista cadastra 5 banners, ve 1, e nao descobre por que.
  rotativo           boolean NOT NULL DEFAULT false,
  intervalo_segundos integer NOT NULL DEFAULT 5 CHECK (intervalo_segundos BETWEEN 3 AND 15),
  max_banners        integer NOT NULL DEFAULT 1 CHECK (max_banners > 0)
);

-- ---------------------------------------------------------------------------
-- 3. ESQUEMAS DE COR: opcoes fechadas em vez de color picker livre
-- ---------------------------------------------------------------------------
-- E o segredo de por que loja Shopify raramente fica feia no banner: os graus
-- de liberdade sao deliberadamente limitados. O lojista escolhe entre 'Claro',
-- 'Escuro' e 'Destaque' — nao existe combinacao ilegivel possivel.
CREATE TABLE canastra.esquemas_cor (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL UNIQUE,
  fundo        text NOT NULL CHECK (fundo        ~ '^#[0-9A-Fa-f]{6}$'),
  texto        text NOT NULL CHECK (texto        ~ '^#[0-9A-Fa-f]{6}$'),
  botao_fundo  text NOT NULL CHECK (botao_fundo  ~ '^#[0-9A-Fa-f]{6}$'),
  botao_texto  text NOT NULL CHECK (botao_texto  ~ '^#[0-9A-Fa-f]{6}$'),
  ordem        integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- 4. O BANNER
-- ---------------------------------------------------------------------------
CREATE TABLE canastra.banners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,          -- interno, so o painel ve
  posicao       text NOT NULL REFERENCES canastra.banner_posicoes (posicao),
  ordem         integer NOT NULL DEFAULT 0,

  -- DUAS IMAGENS NO MESMO REGISTRO, e nao duas linhas como faz a Tray: e um
  -- objeto so na cabeca do lojista e um so na tela. A mobile e opcional e cai
  -- para a desktop quando vazia — mas banner horizontal 1920x600 recortado em
  -- celular fica ilegivel, entao o campo importa mais do que parece.
  midia_desktop_id uuid NOT NULL REFERENCES canastra.midias (id) ON DELETE RESTRICT,
  midia_mobile_id  uuid          REFERENCES canastra.midias (id) ON DELETE RESTRICT,
  alt_override     text,               -- COALESCE(alt_override, midia.alt, '')

  link          text,
  abrir_nova_aba boolean NOT NULL DEFAULT false,

  -- TEXTO FORA DA IMAGEM, nao queimado no JPG: preserva SEO, acessibilidade e
  -- legibilidade em qualquer tela, e salva o lojista que nao tem designer.
  titulo        text,
  subtitulo     text,
  texto_botao   text,
  esquema_cor_id uuid REFERENCES canastra.esquemas_cor (id) ON DELETE SET NULL,
  alinhamento   text NOT NULL DEFAULT 'esquerda'
    CONSTRAINT banners_alinhamento_valido CHECK (alinhamento IN ('esquerda', 'centro', 'direita')),

  -- Rascunho por BANNER, nao por tema inteiro. Na Shopify, trocar uma frase
  -- exige lidar com o tema todo — e como abrir um branch da loja para corrigir
  -- uma virgula. Arquivado em vez de apagado, pela regra geral: nada some.
  status        text NOT NULL DEFAULT 'rascunho'
    CONSTRAINT banners_status_valido CHECK (status IN ('rascunho', 'publicado', 'arquivado')),

  -- O AGENDAMENTO. Ambos nulaveis: NULL/NULL = "por tempo indeterminado", que e
  -- o caso comum e evita o lojista digitar 31/12/2099 para escapar de um campo
  -- obrigatorio. Horarios em timestamptz, exibidos em America/Sao_Paulo — um
  -- banner de Black Friday que entra 3h da manha porque alguem gravou UTC e um
  -- erro que so aparece na noite da campanha.
  inicio_em     timestamptz,
  fim_em        timestamptz,
  CONSTRAINT banners_janela_coerente CHECK (fim_em IS NULL OR inicio_em IS NULL OR fim_em > inicio_em),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005/0010/0015: nao ha trigger de
  -- moddatetime neste schema. Todo UPDATE do painel escreve now() junto.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX banners_posicao_ordem_idx ON canastra.banners (posicao, ordem)
  WHERE status = 'publicado';

-- ---------------------------------------------------------------------------
-- 5. SEGMENTACAO: onde o banner aparece
-- ---------------------------------------------------------------------------
-- O par "categorias especificas" x "todas as categorias" e o mesmo componente
-- do agendamento e do escopo da promocao — a consistencia entre as tres telas e
-- o que faz o painel ser aprendido uma vez. A flag existe para nao gerar N
-- linhas quando a resposta e "todas".
ALTER TABLE canastra.banners
  ADD COLUMN todas_categorias boolean NOT NULL DEFAULT true;

CREATE TABLE canastra.banner_categorias (
  banner_id uuid NOT NULL REFERENCES canastra.banners (id) ON DELETE CASCADE,
  categoria text NOT NULL,
  PRIMARY KEY (banner_id, categoria)
);

-- ---------------------------------------------------------------------------
-- 6. SECOES DA HOME: blocos ordenaveis, para o conteudo que nao e banner
-- ---------------------------------------------------------------------------
-- Um registry de tipos com `config jsonb`, renderizado por um switch sobre
-- `tipo`. E o que permite acrescentar "faixa de depoimentos" ou "grade de
-- micro-lotes" sem migracao e sem reescrever a home. `ocultar_se_vazio` e a
-- correcao explicita do defeito da Shopify, cuja secao com fonte vazia deixa um
-- buraco branco na pagina em vez de sumir.
CREATE TABLE canastra.secoes_home (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL,   -- 'banner', 'produtos_destaque', 'texto', 'depoimentos', 'faq'
  ordem           integer NOT NULL DEFAULT 0,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocultar_se_vazio boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'rascunho'
    CONSTRAINT secoes_home_status_valido CHECK (status IN ('rascunho', 'publicado', 'arquivado')),
  inicio_em       timestamptz,
  fim_em          timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX secoes_home_ordem_idx ON canastra.secoes_home (ordem) WHERE status = 'publicado';

-- ---------------------------------------------------------------------------
-- 7. O QUE A VITRINE LE
-- ---------------------------------------------------------------------------
-- View e nao job: publicacao CALCULADA na consulta. Um job que liga e desliga
-- banner erra sempre que atrasa, cai ou roda duas vezes; a view nao tem estado
-- para errar. `security_invoker` = true seguindo a decisao de 0006.
CREATE VIEW canastra.banners_publicados
  WITH (security_invoker = true) AS
  SELECT b.id, b.posicao, b.ordem, b.link, b.abrir_nova_aba,
         b.titulo, b.subtitulo, b.texto_botao, b.alinhamento,
         md.caminho AS imagem_desktop,
         mm.caminho AS imagem_mobile,
         COALESCE(b.alt_override, md.alt, '') AS alt,
         e.fundo, e.texto, e.botao_fundo, e.botao_texto
    FROM canastra.banners b
    JOIN canastra.midias md ON md.id = b.midia_desktop_id
    LEFT JOIN canastra.midias mm ON mm.id = b.midia_mobile_id
    LEFT JOIN canastra.esquemas_cor e ON e.id = b.esquema_cor_id
   WHERE b.status = 'publicado'
     AND (b.inicio_em IS NULL OR now() >= b.inicio_em)
     AND (b.fim_em    IS NULL OR now() <= b.fim_em)
   ORDER BY b.posicao, b.ordem;

-- ---------------------------------------------------------------------------
-- 8. PAUSAR A LOJA — botao pequeno de valor enorme para cafe sazonal
-- ---------------------------------------------------------------------------
-- Cobre ferias coletivas, ruptura de safra e manutencao sem despublicar produto
-- a produto. Lido pelo middleware do Next.js: a vitrine continua navegavel, so
-- o checkout fecha, com a mensagem que o lojista escreveu.
ALTER TABLE canastra.config_loja
  ADD COLUMN pausada boolean NOT NULL DEFAULT false,
  ADD COLUMN mensagem_pausa text;

-- `config_loja.banner_desktop` e `banner_mobile` ficam por ora, apontando para
-- o banner da posicao 'home_hero', e so caem quando o front parar de le-las —
-- nunca as duas coisas no mesmo deploy, porque a loja esta NO AR.

-- ---------------------------------------------------------------------------
-- 9. FECHO
-- ---------------------------------------------------------------------------
ALTER TABLE canastra.midias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.banners           ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.banner_posicoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.banner_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.esquemas_cor      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.secoes_home       ENABLE ROW LEVEL SECURITY;

-- A vitrine e publica e le a VIEW, nao as tabelas: `anon` nunca ve rascunho,
-- nem banner agendado que ainda nao entrou, nem quem subiu o arquivo. E a mesma
-- forma da view publica de produtos de 0003.
GRANT SELECT ON canastra.banners_publicados TO anon, authenticated;

-- Escrita e do painel, que fala com o Postgres como admin autenticado — a
-- politica de `canastra.eh_admin()` de 0006 e o unico caminho de escrita.
REVOKE ALL ON canastra.midias, canastra.banners, canastra.banner_posicoes,
              canastra.banner_categorias, canastra.esquemas_cor,
              canastra.secoes_home
  FROM authenticated;

CREATE POLICY banners_admin_tudo ON canastra.banners
  FOR ALL TO authenticated USING (canastra.eh_admin()) WITH CHECK (canastra.eh_admin());
CREATE POLICY midias_admin_tudo ON canastra.midias
  FOR ALL TO authenticated USING (canastra.eh_admin()) WITH CHECK (canastra.eh_admin());
```

### 5.3 Campanhas, segmentos e automações

```sql
-- 0019_marketing.sql  (depende de 0017, que cria canastra.campanhas)
--
-- O QUE ESTA MIGRACAO FAZ: da a loja as tres pecas que faltam para marketing
-- proprio — SEGMENTO (quem), AUTOMACAO (quando) e ATRIBUICAO (o que funcionou).
--
-- A REGRA QUE ORGANIZA TUDO: nao ha acao de marketing anonima. Toda mensagem
-- enviada carrega uma campanha, e todo pedido carrega a origem que o trouxe.
-- E o contrato que a Shopify formaliza exigindo `marketing_activity_id` em
-- toda acao — sem ele nao se fecha o ciclo entre "enviei" e "vendeu".
--
-- E A REGRA QUE NAO DA PARA CORRIGIR DEPOIS: atribuicao so existe se for
-- gravada NO PEDIDO no momento da compra. Nenhum relatorio reconstroi
-- retroativamente de onde veio um pedido de tres meses atras.

-- ---------------------------------------------------------------------------
-- 1. ATRIBUICAO: a origem viaja da sessao para o pedido
-- ---------------------------------------------------------------------------
ALTER TABLE canastra.pedidos
  ADD COLUMN utm_source   text,
  ADD COLUMN utm_medium   text,
  ADD COLUMN utm_campaign text,
  ADD COLUMN canal        text,   -- 'organico','direto','email','social','pago','whatsapp'
  ADD COLUMN referrer     text,
  ADD COLUMN campanha_id  uuid REFERENCES canastra.campanhas (id) ON DELETE SET NULL;

CREATE INDEX pedidos_campanha_idx ON canastra.pedidos (campanha_id, criado_em DESC)
  WHERE campanha_id IS NOT NULL;

-- Custo de midia por campanha. UM campo — e ele vale mais que dez graficos,
-- porque sem custo nao existe ROAS e o lojista repete campanha que deu prejuizo.
-- A Shopify nao tem isso nativamente e o lojista cruza planilha na mao.
ALTER TABLE canastra.campanhas
  ADD COLUMN canal              text,
  ADD COLUMN utm_source         text,
  ADD COLUMN utm_medium         text,
  ADD COLUMN utm_campaign       text,
  ADD COLUMN custo_midia_centavos bigint NOT NULL DEFAULT 0
    CONSTRAINT campanhas_custo_nao_negativo CHECK (custo_midia_centavos >= 0),
  ADD COLUMN slug_curto         text UNIQUE;   -- link curto + QR code, gerados on-the-fly

-- Regras de auto-match: captura o trafego cujo link foi montado por terceiro
-- (agencia, influenciador) e nao pelo link canonico da campanha.
CREATE TABLE canastra.campanha_utm_regras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id  uuid NOT NULL REFERENCES canastra.campanhas (id) ON DELETE CASCADE,
  utm_source   text,
  utm_medium   text,
  utm_campaign text
);

-- ---------------------------------------------------------------------------
-- 2. O CLIENTE: campos derivados, consentimento e RFM
-- ---------------------------------------------------------------------------
-- MATERIALIZADOS de proposito, atualizados no fechamento do pedido. Recalcular
-- "gasto total" varrendo pedidos a cada listagem e a diferenca entre um
-- relatorio instantaneo e um relatorio que trava — e e o motivo pelo qual
-- dashboards sao abandonados.
ALTER TABLE canastra.clientes
  ADD COLUMN primeiro_pedido_em     timestamptz,
  ADD COLUMN ultimo_pedido_em       timestamptz,
  ADD COLUMN pedidos_count          integer NOT NULL DEFAULT 0 CHECK (pedidos_count >= 0),
  ADD COLUMN gasto_total_centavos   bigint  NOT NULL DEFAULT 0 CHECK (gasto_total_centavos >= 0),
  ADD COLUMN data_nascimento        date,

  -- CONSENTIMENTO E ESTADO, nao booleano. 'pendente' existe de verdade por
  -- causa do duplo opt-in — nao e um transitorio de interface. Guardar ORIGEM e
  -- DATA nao e capricho: e o que a LGPD exige para provar o consentimento, e a
  -- loja ja guarda `origem` em `newsletter_inscritos` desde 0011 pelo mesmo motivo.
  ADD COLUMN consentimento_email text NOT NULL DEFAULT 'nunca'
    CONSTRAINT clientes_consentimento_email_valido
      CHECK (consentimento_email IN ('nunca', 'pendente', 'inscrito', 'descadastrado')),
  ADD COLUMN consentimento_email_origem text,      -- 'rodape','popup','checkout','conta'
  ADD COLUMN consentimento_email_em     timestamptz,
  -- WhatsApp/SMS NUNCA pode nascer marcado — e regra, nao preferencia.
  ADD COLUMN consentimento_whatsapp text NOT NULL DEFAULT 'nunca'
    CONSTRAINT clientes_consentimento_whatsapp_valido
      CHECK (consentimento_whatsapp IN ('nunca', 'pendente', 'inscrito', 'descadastrado')),

  -- RFM: 1 a 5 em cada eixo, mais o NOME do grupo. O nome e o produto — '555'
  -- nao diz qual campanha disparar; 'Em risco' e 'Quase perdidos' dizem.
  -- Calculavel com ntile(5) OVER (...) em Postgres puro; nao precisa de ML.
  ADD COLUMN rfm_r smallint CHECK (rfm_r BETWEEN 1 AND 5),
  ADD COLUMN rfm_f smallint CHECK (rfm_f BETWEEN 1 AND 5),
  ADD COLUMN rfm_m smallint CHECK (rfm_m BETWEEN 1 AND 5),
  ADD COLUMN rfm_grupo text,
  ADD COLUMN rfm_calculado_em timestamptz;

ALTER TABLE canastra.newsletter_inscritos
  ADD COLUMN token_descadastro uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN descadastrado_em  timestamptz;

-- ---------------------------------------------------------------------------
-- 3. GRUPOS E SEGMENTOS
-- ---------------------------------------------------------------------------
-- Grupo = lista curada e estavel ('atacado/cafeteria', 'imprensa').
CREATE TABLE canastra.grupos_clientes (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome  text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE canastra.grupo_membros (
  grupo_id uuid NOT NULL REFERENCES canastra.grupos_clientes (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  PRIMARY KEY (grupo_id, user_id)
);

-- Segmento = REGRA, avaliada periodicamente. A diferenca entre uma campanha de
-- reativacao que se atualiza sozinha e uma planilha que envelhece em uma semana.
-- Datas em OFFSET RELATIVO ('-90d'), nunca fixas — e o que faz o segmento viver.
CREATE TABLE canastra.segmentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL UNIQUE,
  -- {"e":[{"campo":"ultimo_pedido_em","op":"<=","valor":"-90d"},
  --       {"campo":"pedidos_count","op":">=","valor":1}]}
  -- AND/OR de UM nivel de proposito: predicado aninhado tem poder de expressao
  -- maximo e custo de UX maximo (o proprio Saleor limita a 100 regras por isso).
  definicao     jsonb NOT NULL,
  avaliado_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- O PERTENCIMENTO COM HISTORICO, e nao so a lista de agora: e o diff entre a
-- avaliacao anterior e a atual que emite os eventos "entrou no segmento" e
-- "saiu do segmento". Sem persistir o estado anterior, nao ha transicao — e sem
-- transicao nao existe gatilho generico, e cada caso novo (VIP, aniversariante,
-- assinante que cancelou) vira codigo novo.
CREATE TABLE canastra.segmento_membros (
  segmento_id uuid NOT NULL REFERENCES canastra.segmentos (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  entrou_em   timestamptz NOT NULL DEFAULT now(),
  saiu_em     timestamptz,
  PRIMARY KEY (segmento_id, user_id)
);
CREATE INDEX segmento_membros_ativos_idx ON canastra.segmento_membros (segmento_id) WHERE saiu_em IS NULL;

-- ---------------------------------------------------------------------------
-- 4. TEMPLATES: a voz da marca sem deploy, com toggle POR TEMPLATE
-- ---------------------------------------------------------------------------
-- Cada notificacao tem interruptor proprio. A Shopify nao deixa desligar
-- transacional e quem usa ferramenta externa em paralelo recebe duplicidade —
-- deixe TODA notificacao com toggle desde o primeiro dia.
CREATE TABLE canastra.templates_email (
  chave      text PRIMARY KEY,   -- 'pedido_confirmado','pagamento_aprovado','enviado',
                                 -- 'carrinho_abandonado','avaliacao','aniversario',
                                 -- 'assinatura_renovacao','assinatura_falha_pagamento'
  rotulo     text NOT NULL,
  assunto    text NOT NULL,
  corpo_html text NOT NULL,
  -- Documentadas na PROPRIA TELA de edicao, nao num manual: {{nome}}, {{pedido}}...
  variaveis  text[] NOT NULL DEFAULT '{}',
  ativo      boolean NOT NULL DEFAULT true,
  -- Transacional nao entra em regra de cota nem em pausa de campanha. Separar
  -- "e-mail que recupera dinheiro" de "e-mail promocional" impede que um limite
  -- operacional derrube o primeiro (a Shopify isenta o de carrinho abandonado
  -- da cota justamente por isso).
  transacional boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. AUTOMACOES
-- ---------------------------------------------------------------------------
CREATE TABLE canastra.automacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  gatilho       text NOT NULL
    CONSTRAINT automacoes_gatilho_valido CHECK (gatilho IN (
      'carrinho_abandonado', 'pedido_entregue', 'pos_compra', 'aniversario',
      'entrou_no_segmento', 'saiu_do_segmento', 'recompra_por_ciclo',
      'assinatura_falha_pagamento', 'assinatura_renovacao_proxima')),
  gatilho_config jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"segmento_id": "...", "sku": "..."}
  atraso_minutos integer NOT NULL DEFAULT 0 CHECK (atraso_minutos >= 0),
  canal         text NOT NULL DEFAULT 'email'
    CONSTRAINT automacoes_canal_valido CHECK (canal IN ('email', 'whatsapp')),
  template_chave text REFERENCES canastra.templates_email (chave),
  campanha_id   uuid REFERENCES canastra.campanhas (id) ON DELETE SET NULL,
  ativo         boolean NOT NULL DEFAULT false,   -- nasce DESLIGADA, sempre
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- `proxima_execucao_em` e o que permite CANCELAR EM MASSA quem esta em espera
-- ao desligar a automacao — sem isso, o cliente recebe "esqueceu algo?" tres
-- dias depois de voce ter desligado a campanha, que e o pesadelo classico.
-- `chave_idempotencia` segue o desenho de 0005: o mesmo gatilho reprocessado
-- esbarra no indice em vez de mandar o e-mail duas vezes.
CREATE TABLE canastra.automacao_execucoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id  uuid NOT NULL REFERENCES canastra.automacoes (id) ON DELETE CASCADE,
  user_id       uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  email         text,
  estado        text NOT NULL DEFAULT 'aguardando'
    CONSTRAINT automacao_execucoes_estado_valido
      CHECK (estado IN ('aguardando', 'enviando', 'enviado', 'cancelado', 'falhou')),
  proxima_execucao_em timestamptz NOT NULL,
  executado_em  timestamptz,
  erro          text,
  chave_idempotencia text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX automacao_execucoes_idem_idx
  ON canastra.automacao_execucoes (chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;
CREATE INDEX automacao_execucoes_fila_idx
  ON canastra.automacao_execucoes (proxima_execucao_em)
  WHERE estado = 'aguardando';

-- Evento bruto, taxas derivadas por agregacao. Nunca guarde "taxa de abertura"
-- como coluna: ela muda a cada clique e dessincroniza no primeiro recalculo.
CREATE TABLE canastra.mensagens_eventos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id  uuid REFERENCES canastra.automacao_execucoes (id) ON DELETE CASCADE,
  campanha_id  uuid REFERENCES canastra.campanhas (id) ON DELETE SET NULL,
  user_id      uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  tipo         text NOT NULL
    CONSTRAINT mensagens_eventos_tipo_valido
      CHECK (tipo IN ('entregue', 'aberto', 'clicado', 'devolvido', 'descadastrou', 'spam')),
  url_clicada  text,
  ocorrido_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_eventos_campanha_idx ON canastra.mensagens_eventos (campanha_id, tipo, ocorrido_em DESC);

-- ---------------------------------------------------------------------------
-- 6. CARRINHO ABANDONADO: reaproveitar o que ja existe
-- ---------------------------------------------------------------------------
-- A loja JA tem `carrinhos.lembrete_enviado_em` (0011) e o job que o usa. O que
-- falta e (a) o token que reidrata o carrinho exato pelo link do e-mail — sem
-- ele o cliente cai na home e o e-mail nao converte — e (b) o fecho do ciclo,
-- para o relatorio saber quanto foi recuperado.
--
-- Regra de disparo que quase toda implementacao caseira esquece: revalidar
-- ESTOQUE e FRETE no momento do envio, nao no do abandono. Nao adianta lembrar
-- de um cafe que acabou ou de um endereco sem frete.
ALTER TABLE canastra.carrinhos
  ADD COLUMN token_retomada uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN recuperado_pedido_id uuid REFERENCES canastra.pedidos (pedido_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX carrinhos_token_retomada_idx ON canastra.carrinhos (token_retomada);

-- ---------------------------------------------------------------------------
-- 7. AVALIACAO PEDIDA PELA ENTREGA
-- ---------------------------------------------------------------------------
-- A loja ja tem avaliacoes (0014) — falta o GATILHO. Pedir 2 a 5 dias apos o
-- pedido ficar 'entregue' (quando o cafe ja foi provado) tem taxa de resposta
-- varias vezes maior que um prazo fixo contado da compra. Token de uso unico
-- para avaliar sem login: exigir conta derruba a taxa de resposta pela metade.
CREATE TABLE canastra.avaliacao_solicitacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    uuid NOT NULL REFERENCES canastra.pedidos (pedido_id) ON DELETE CASCADE,
  token        uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enviado_em   timestamptz,
  respondido_em timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id)
);

-- ---------------------------------------------------------------------------
-- 8. CREDITO DA LOJA (cashback / vale-presente / troca)
-- ---------------------------------------------------------------------------
-- LEDGER APPEND-ONLY: o saldo e SEMPRE a soma das linhas, nunca um campo
-- mutavel. Campo de saldo mutavel diverge no primeiro erro de concorrencia e
-- ninguem descobre onde. Cashback vira credito, nao dinheiro — dinheiro que so
-- volta comprando cafe. Creditar N dias APOS a entrega, para sobreviver ao
-- prazo de arrependimento do CDC.
CREATE TABLE canastra.credito_lancamentos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  tipo       text NOT NULL
    CONSTRAINT credito_tipo_valido CHECK (tipo IN ('credito', 'debito', 'expiracao', 'ajuste')),
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),  -- o SINAL vem do tipo
  origem     text NOT NULL,   -- 'cashback','vale_presente','troca','cortesia'
  pedido_id  uuid REFERENCES canastra.pedidos (pedido_id) ON DELETE SET NULL,
  expira_em  timestamptz,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credito_lancamentos_cliente_idx ON canastra.credito_lancamentos (user_id, criado_em DESC);

-- Debitar SEMPRE dentro da transacao do pedido e com SELECT ... FOR UPDATE nas
-- linhas do cliente — dois checkouts simultaneos com o mesmo saldo e o mesmo
-- cenario do ultimo uso do cupom em 0010.

-- ---------------------------------------------------------------------------
-- 9. AGREGADO DIARIO: o que sustenta a home e os relatorios
-- ---------------------------------------------------------------------------
-- Sem isto, cada carregamento do dashboard varre `pedidos` inteira. O fuso e
-- fixado em America/Sao_Paulo AQUI, uma vez: um pedido feito 22h de Brasilia
-- nao pode cair no dia seguinte no fechamento do mes.
CREATE MATERIALIZED VIEW canastra.vendas_por_dia AS
  SELECT (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
         count(*)                                   AS pedidos,
         count(*) FILTER (WHERE p.cupom_codigo IS NOT NULL) AS pedidos_com_cupom,
         sum(p.total)                               AS receita_total,
         sum(p.desconto)                            AS desconto_concedido,
         sum(p.frete)                               AS frete_cobrado,
         count(DISTINCT p.user_id)                  AS clientes
    FROM canastra.pedidos p
   WHERE p.status IN ('pago', 'enviado', 'entregue')
   GROUP BY 1;
CREATE UNIQUE INDEX vendas_por_dia_idx ON canastra.vendas_por_dia (dia);
-- REFRESH MATERIALIZED VIEW CONCURRENTLY exige o indice unico acima. Exponha o
-- horario do ultimo refresh NA TELA: declarar a latencia mata metade dos
-- chamados "vendi agora e nao apareceu".

-- ---------------------------------------------------------------------------
-- 10. AUDITORIA E FECHO
-- ---------------------------------------------------------------------------
-- Permissao sem trilha nao serve para nada: 'quem baixou o preco' e 'quem
-- exportou a lista de clientes' sao as duas perguntas que sempre aparecem.
-- LGPD: NUNCA gravar CPF completo nem dado de cartao no payload.
CREATE TABLE canastra.audit_log (
  id          bigserial PRIMARY KEY,
  usuario_id  uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  entidade    text NOT NULL,
  entidade_id text,
  acao        text NOT NULL,      -- 'criou','editou','apagou','exportou','enviou'
  antes       jsonb,
  depois      jsonb,
  em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entidade_idx ON canastra.audit_log (entidade, entidade_id, em DESC);

ALTER TABLE canastra.grupos_clientes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.grupo_membros          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.segmentos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.segmento_membros       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.templates_email        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.automacoes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.automacao_execucoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.mensagens_eventos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.avaliacao_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.credito_lancamentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.campanha_utm_regras    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.audit_log              ENABLE ROW LEVEL SECURITY;

-- Tudo aqui e dado pessoal ou mapa de campanha: nenhum GRANT para `anon`, e o
-- REVOKE de sempre para `authenticated`, pela licao de 0003/0010/0011 — o
-- pacote arwd de 0001 esta inerte hoje e a primeira politica ampla futura o
-- acordaria. `segmento_membros` sozinha ja e "quem sao os clientes em risco".
REVOKE ALL ON canastra.grupos_clientes, canastra.grupo_membros,
              canastra.segmentos, canastra.segmento_membros,
              canastra.templates_email, canastra.automacoes,
              canastra.automacao_execucoes, canastra.mensagens_eventos,
              canastra.avaliacao_solicitacoes, canastra.credito_lancamentos,
              canastra.campanha_utm_regras, canastra.audit_log
  FROM authenticated;

-- Excecao unica e deliberada: o cliente ve o PROPRIO extrato de credito.
CREATE POLICY credito_dono_le ON canastra.credito_lancamentos
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON canastra.credito_lancamentos TO authenticated;
```
