-- Bling/NF-e (onda 3G): o rastro do ERP no pedido, e o refresh token rotativo
-- do OAuth na configuracao da loja.
--
-- O gestor opera o fiscal e o estoque no Bling, e vem da Tray, onde pedido
-- aprovado virava pedido de venda + NF-e sozinho. Esta migracao da ao schema o
-- que o servico (src/services/blingPedidos.js) precisa para reproduzir isso:
-- saber SE um pedido ja foi ao Bling (idempotencia), COMO ele esta la, e o que
-- a NF-e emitida devolveu. Tudo NULL por padrao: a integracao nasce desligada
-- (BLING_ATIVO, decisao 5 do plano mestre) e um banco sem Bling nenhum e
-- exatamente igual ao de ontem.

-- `bling_id` e TEXTO, nao inteiro, pela mesma lente de `pagamento_id_mp` (0005):
-- e um identificador OPACO de outro sistema — nao se soma, nao se ordena por
-- valor, e o dia em que o Bling mudar o formato nao pode ser uma migracao aqui.
--
-- `bling_situacao` guarda a ultima situacao conhecida no Bling ('sincronizando'
-- enquanto a criacao esta em voo — e o claim atomico da idempotencia, ver o
-- servico — e depois o que o Bling disser). E cache informativo para o painel,
-- nunca fonte de decisao de dinheiro: quem manda no status da LOJA continua
-- sendo `status`, com o CHECK de 0009.
--
-- `bling_claim_em` e o RELOGIO DO CLAIM, e existe separado de propósito. O
-- corte que desfaz um claim orfao ("faz mais de 10 minutos que alguem disse
-- 'sincronizando' e nunca voltou") precisa de um carimbo que so o claim mexa.
-- `atualizado_em` nao serve: QUALQUER escritor o carimba — o webhook do MP, a
-- mudanca de status pelo painel, a redacao da LGPD. Com ele, um pedido travado
-- em 'sincronizando' cuja linha fosse tocada por outro fluxo teria o relogio
-- do claim zerado sem que o claim tivesse recomecado, e a auto-cura ficaria
-- adiada indefinidamente — o botao do painel responderia "ja esta
-- sincronizando" para sempre.
--
-- Os `nfe_*` sao a fotografia da nota emitida: o id da nota DENTRO do Bling
-- (`nfe_id`, guardado assim que ela e gerada), numero (com serie), chave de
-- acesso (a identidade fiscal do documento, 44 digitos) e o link do DANFE que
-- o Bling publica. Fotografia, como `cupom_codigo` em 0010: a nota e um
-- documento fiscal imutavel — se amanha a conta Bling for outra, o que foi
-- emitido continua registrado aqui.
--
-- `nfe_id` E O QUE SEPARA "GERADA" DE "TRANSMITIDA". A emissao tem dois
-- passos no Bling (gerar a nota a partir do pedido; envia-la a SEFAZ), e o
-- segundo falha sozinho — configuracao fiscal ausente e o caso classico. Sem
-- guardar o id, a nota gerada ficava orfa no Bling e a retentativa geraria
-- OUTRA. Com ele, a retentativa retransmite a MESMA. Quem responde "ja
-- emitida" e `nfe_chave`, que so e gravada depois da transmissao aceita.
ALTER TABLE canastra.pedidos
  ADD COLUMN bling_id              text,
  ADD COLUMN bling_situacao        text,
  ADD COLUMN bling_claim_em        timestamptz,
  ADD COLUMN bling_sincronizado_em timestamptz,
  ADD COLUMN nfe_id                text,
  ADD COLUMN nfe_numero            text,
  ADD COLUMN nfe_chave             text,
  ADD COLUMN nfe_url               text;

-- A trava que impede um MESMO pedido de venda do Bling de ser dado como
-- origem de dois pedidos da loja: o segundo estoura 23505 em vez de virar um
-- vinculo cruzado em silencio (dois pedidos apontando para a mesma venda, e a
-- conferencia do gestor sem saber qual e qual).
--
-- ATENCAO AO QUE ELE **NAO** FAZ: ele nao impede duas vendas serem criadas no
-- Bling para o MESMO pedido da loja — nesse caso os dois `bling_id` sao
-- diferentes e o indice aceita os dois de bom grado. Contra o dobro no ERP
-- quem trabalha e o claim do servico (`bling_situacao = 'sincronizando'` +
-- `bling_claim_em`), o prazo agregado que aborta antes de o claim envelhecer,
-- e a busca por `numeroLoja` no Bling antes de criar quando o claim foi
-- herdado de um processo morto. PARCIAL (WHERE ... IS NOT NULL)
-- como os indices de 0005: quase todo pedido vive com bling_id nulo (integracao
-- desligada, ou pedido anterior a ela) e um indice total recusaria o segundo
-- NULL... nao recusa (NULL nunca conflita), mas indexaria toda a tabela para
-- proteger um punhado de linhas.
CREATE UNIQUE INDEX pedidos_bling_id_idx
  ON canastra.pedidos (bling_id)
  WHERE bling_id IS NOT NULL;

-- O refresh token do OAuth do Bling e ROTATIVO: cada renovacao INVALIDA o token
-- usado e devolve um novo. Guarda-lo so no .env mataria a integracao no
-- primeiro restart depois da primeira renovacao — o processo subiria com um
-- token ja queimado e nenhum log de renovacao explicaria o 400 do Bling. Por
-- isso ele mora no banco, atualizado a cada renovacao pelo servico
-- (src/services/blingClient.js); a env BLING_REFRESH_TOKEN vira so a semente
-- da primeira autorizacao. Em `config_loja` porque e configuracao de UMA loja,
-- linha unica — criar tabela nova para um campo seria cerimonia sem ganho.
ALTER TABLE canastra.config_loja
  ADD COLUMN bling_refresh_token text;

-- E AQUI ESTA O PONTO DE SEGURANCA DA MIGRACAO: `config_loja` e PUBLICA por
-- desenho — GRANT SELECT para `anon` (0005), politica de leitura USING (true)
-- (0006) — porque banner, titulo e piso de frete gratis SAO informacao publica.
-- Um segredo em coluna nova desta tabela nasceria legivel por qualquer chave
-- anonima da instancia via PostgREST, e refresh token do Bling e credencial
-- que emite nota fiscal e mexe em estoque.
--
-- A tranca e a mesma do `custo` em `produtos` (0006): privilegio de COLUNA.
-- Revoga-se o privilegio de tabela e devolve-se a lista explicita — todas as
-- colunas MENOS `bling_refresh_token`. O UPDATE/INSERT de `authenticated`
-- (0006) vira lista tambem: a politica `config_loja_admin_escreve` decide a
-- LINHA, o GRANT decide as COLUNAS, e nem o admin escreve o token pelo
-- PostgREST — quem o escreve e SO o servico Node, que conecta como dono do
-- banco e nao passa por GRANT nenhum.
--
-- Consequencia conhecida, a mesma medida em 0006 para `produtos`: `select=*`
-- (e `RETURNING *`) de PostgREST nesta tabela passa a responder 42501. Medido
-- que ninguem faz isso hoje: vitrine e painel leem a configuracao pelo Express
-- (`GET /config`), que projeta as colunas pelo nome.
REVOKE SELECT ON canastra.config_loja FROM anon, authenticated;
REVOKE INSERT, UPDATE ON canastra.config_loja FROM authenticated;

GRANT SELECT (id, banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em)
  ON canastra.config_loja TO anon, authenticated;

GRANT INSERT (id, banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em),
      UPDATE (banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em)
  ON canastra.config_loja TO authenticated;
