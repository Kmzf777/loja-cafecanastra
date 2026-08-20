-- Newsletter (captacao de e-mail no rodape) e o marcador do lembrete de
-- carrinho abandonado.

-- E-mail e DADO PESSOAL, e a tabela nasce com a postura de 0004: RLS ligada,
-- politica nenhuma, e nenhum GRANT para `anon` — quem escreve aqui e SO o
-- servico Node (POST /newsletter), que conecta como dono do banco. A rota
-- publica responde `{ok:true}` para qualquer e-mail valido, inclusive o ja
-- inscrito, de proposito: uma resposta diferente para "ja existe" deixaria
-- qualquer pessoa testar se um e-mail especifico esta na lista (enumeracao).
CREATE TABLE canastra.newsletter_inscritos (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O UNIQUE e o que faz o INSERT ... ON CONFLICT DO NOTHING da rota ser a
  -- deduplicacao inteira: inscrever duas vezes nao cria duas linhas nem vira
  -- erro. O CHECK e de FORMATO BASICO (algo@algo.tld, sem espaco) — validar
  -- e-mail "de verdade" por regex e uma guerra perdida; o que este CHECK barra
  -- e lixo obvio ("teste", "a@b") entrando por um caminho que nao passou pela
  -- validacao do servico.
  email  text NOT NULL UNIQUE
           CONSTRAINT newsletter_email_formato
             CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- De onde veio a inscricao ('rodape' hoje; um pop-up ou o checkout amanha).
  -- Serve para medir qual superficie converte — sem coluna, essa pergunta
  -- nunca mais tem resposta retroativa.
  origem text NOT NULL DEFAULT 'rodape',

  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE canastra.newsletter_inscritos ENABLE ROW LEVEL SECURITY;

-- Mesmo fecho de 0010: o pacote arwd que 0001 concede por padrao a
-- `authenticated` esta inerte sob a RLS sem politica, e revogar agora impede
-- que uma politica ampla futura o acorde. Uma lista de e-mails legivel por
-- qualquer token `authenticated` da instancia COMPARTILHADA seria vazamento
-- de dado pessoal em massa.
REVOKE ALL ON canastra.newsletter_inscritos FROM authenticated;

-- O marcador do lembrete de carrinho abandonado: UM lembrete por EPISODIO de
-- abandono.
--
-- A SEMANTICA COMPLETA, porque a coluna sozinha nao conta: NULL = "esta
-- sacola ainda nao foi lembrada"; preenchida = "ja foi". O episodio comeca
-- quando a sacola para (job de src/jobs/carrinhoAbandonado.js) e TERMINA NA
-- COMPRA: o checkout (`limparCarrinho`, PaymentController) apaga os itens e
-- devolve esta coluna a NULL no mesmo gesto. Sem o reset, quem comprou uma
-- vez nunca mais receberia lembrete de sacola nenhuma — "um lembrete por
-- carrinho" e por episodio, nao por cliente para sempre. O ciclo
-- abandona -> lembra -> compra -> abandona de novo -> lembra de novo esta
-- medido em test/f6_cupons.test.js.
--
-- POR QUE UMA COLUNA, e nao uma tabela de envios: a pergunta que o job faz e
-- binaria ("esta sacola ja foi lembrada?") e a resposta precisa ser travavel
-- na MESMA transacao do envio — `UPDATE ... SET lembrete_enviado_em = now()
-- WHERE lembrete_enviado_em IS NULL` com rowCount 0 significando "outra
-- execucao chegou antes". Historico de campanhas e problema de outra tarefa.
--
-- COMO SE MEDE "ABANDONADO", ja que `carrinho_itens` NAO tem timestamp nenhum
-- (0004): pelo `carrinhos.atualizado_em`. Quem o mantem e a RPC
-- `fundir_sacola` (0007), que roda a cada login — a unica escritora do
-- carrinho do servidor nesta fase (a sacola do dia a dia vive no localStorage
-- e so encosta no banco no login e no checkout, que APAGA os itens). Ou seja:
-- carrinho com itens e `atualizado_em` velho = pessoa entrou, fundiu a sacola
-- e nao comprou. E exatamente o abandono que se quer lembrar.
ALTER TABLE canastra.carrinhos
  ADD COLUMN lembrete_enviado_em timestamptz;
