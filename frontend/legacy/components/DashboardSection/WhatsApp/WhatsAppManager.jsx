import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Container,
  Card,
  Title,
  List,
  ListItem,
  Actions,
  ButtonPrimary,
  ButtonSecondary,
  Input,
  Select,
  Label,
} from "../Settings/OffersAndCupons/PromotionsManager.style";

import authContext from "../../../contexts/loginContext/createAuthContext";
import Loading from "../../Loading/Loading";
import {
  CAMPOS_ESPERADOS,
  INTERRUPTORES,
  descreverDesligamento,
  descreverNumero,
  descreverSegredo,
  descreverStatus,
  descreverTemplate,
  formularioAoReler,
  precisaDeAtencao,
  rotuloDeEnvio,
} from "./whatsappContrato";
import {
  buscarConfig,
  buscarMensagens,
  buscarStatus,
  buscarTemplates,
  useWhatsAppAcoes,
} from "./useWhatsAppAcoes";

/**
 * WhatsApp — a tela por onde o bot é operado.
 *
 * O bot inteiro já existe no backend: ele avisa o cliente a cada mudança de
 * status do pedido, atende quem responde por botões e tem sete rotas de
 * administração. O que não existia era o lugar onde colar a credencial da
 * Meta, ligar e desligar cada aviso, criar os templates, mandar um teste e ver
 * o que saiu. É esta tela.
 *
 * ELA PRECISA SER ÚTIL COM O NÚMERO AINDA INEXISTENTE, e essa é a decisão que
 * a organiza. O número de WhatsApp da loja será criado depois; até lá, TODA
 * rota que fala com a Meta responde 503 e a sonda devolve `ligado:false` com a
 * lista do que falta. Uma tela que tratasse isso como falha seria um mural de
 * vermelho no estado normal — e é assim que se ensina alguém a não olhar mais
 * para o vermelho. Aqui, o que falta preencher é AZUL e vem com o passo a
 * passo; vermelho fica reservado para o que quebrou de verdade.
 *
 * SEIS BLOCOS, na ordem em que a instalação acontece:
 *
 *   1. Estado da integração — o que falta, e o que a Meta diz do número.
 *   2. Credenciais — os cinco campos, os três primeiros WRITE-ONLY.
 *   3. Avisos — o interruptor geral e um por status do pedido.
 *   4. Templates — o estado de cada um na Meta, e o botão que os cria lá.
 *   5. Envio de teste — validar a instalação antes do primeiro pedido.
 *   6. Histórico — o que saiu, e a frase da Meta quando não saiu.
 *
 * O SEGREDO NUNCA APARECE, e a tela é a última linha dessa defesa. O GET
 * devolve `access_token_mascara: "••••4821"` e nunca o valor; a máscara é
 * TEXTO ao lado do campo, jamais o `value` de um input — pôr a máscara no
 * input a faria voltar no PUT e o servidor gravaria "••••4821" COMO TOKEN, que
 * é a maneira mais rápida de matar a integração com um clique em "Salvar".
 * Pelo mesmo motivo os três campos de segredo abrem SEMPRE em branco, e branco
 * quer dizer "não mexi" (`corpoDaConfig` em `whatsappContrato.js`).
 */

/** As cores de cada tom. Mesmo vocabulário do resto do painel: vermelho de
 * `Orders.jsx`, azul do aviso de "integração desligada" do Bling. */
const CORES = {
  ok: { borda: "#2e7d32", fundo: "#eef7ee", texto: "#1b4d1e" },
  atencao: { borda: "#f57c00", fundo: "#fff5e9", texto: "#6b3d06" },
  pendente: { borda: "#1976d2", fundo: "#eef4fb", texto: "#123" },
  desligado: { borda: "#9e9e9e", fundo: "#f4f4f4", texto: "#333" },
  erro: { borda: "#b3261e", fundo: "#fdf2f1", texto: "#5c1a14" },
  neutro: { borda: "#9e9e9e", fundo: "#f7f7f7", texto: "#444" },
};

const cor = (tom) => CORES[tom] || CORES.neutro;

const dataHoraBr = (iso) => {
  if (!iso) return "—";
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleString("pt-BR");
};

/** A tarja de estado — a mesma forma para os seis tons. Só a de erro leva
 * `role="alert"`: um leitor de tela não deve ser interrompido para ouvir que
 * está tudo bem. */
function Tarja({ tom, titulo, children, acao }) {
  const c = cor(tom);
  return (
    <div
      role={tom === "erro" ? "alert" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        margin: "12px 0 0",
        padding: "10px 14px",
        borderLeft: `3px solid ${c.borda}`,
        background: c.fundo,
        color: c.texto,
        fontSize: 14,
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>
        {titulo ? <strong>{titulo}. </strong> : null}
        {children}
      </span>
      {acao}
    </div>
  );
}

Tarja.propTypes = {
  tom: PropTypes.string,
  titulo: PropTypes.string,
  children: PropTypes.node,
  acao: PropTypes.node,
};

/** Um interruptor com rótulo e explicação. */
function Interruptor({ id, ligado, rotulo, detalhe, onChange, desabilitado }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
      <input
        id={id}
        type="checkbox"
        checked={ligado}
        disabled={desabilitado}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 4 }}
      />
      <div>
        <Label htmlFor={id} style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          {rotulo}
        </Label>
        <div style={{ fontSize: "0.85rem", color: "#666" }}>{detalhe}</div>
      </div>
    </div>
  );
}

Interruptor.propTypes = {
  id: PropTypes.string,
  ligado: PropTypes.bool,
  rotulo: PropTypes.string,
  detalhe: PropTypes.string,
  onChange: PropTypes.func,
  desabilitado: PropTypes.bool,
};

function WhatsAppManager() {
  const { authFetch } = useContext(authContext);

  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(() => formularioAoReler(null, null));
  const [templates, setTemplates] = useState([]);
  const [templatesDesligados, setTemplatesDesligados] = useState(false);
  const [erroTemplates, setErroTemplates] = useState(null);
  // { [nome]: resultado } da última tentativa de criação — é onde mora a frase
  // da Meta para cada template que ela recusou.
  const [criacao, setCriacao] = useState({});
  const [mensagens, setMensagens] = useState([]);
  const [limite, setLimite] = useState(50);

  const [carregando, setCarregando] = useState(true);
  const [sondando, setSondando] = useState(false);
  const [erro, setErro] = useState(null);

  const [paraTeste, setParaTeste] = useState("");
  const [templateTeste, setTemplateTeste] = useState("");

  /**
   * Montagem e PÓS-SALVAMENTO: o formulário inteiro vem do servidor, com os
   * três segredos em branco. Limpá-los depois de salvar é o certo — eles
   * acabaram de ser gravados, e um token que fica no input depois disso é só
   * texto claro esperando em memória sem ter mais o que fazer ali.
   */
  const aplicarConfig = useCallback((nova) => {
    setConfig(nova);
    setForm(formularioAoReler(null, nova));
  }, []);

  /**
   * RELEITURA (o botão "Conferir de novo"): o servidor manda nos campos
   * visíveis e nos interruptores, e O QUE ESTIVER DIGITADO NOS SEGREDOS FICA.
   *
   * O token de System User da Meta é exibido UMA ÚNICA VEZ no Business Manager.
   * A sequência natural aqui é colar → salvar → conferir; quem inverte os dois
   * últimos passos e encontra o campo vazio pode não ter mais o token. Ver
   * `formularioAoReler` no contrato, que é onde a regra vive e é testada.
   *
   * Atualização FUNCIONAL: ler `form` de dentro do callback traria o valor
   * capturado no render em que ele foi criado — e o que interessa é o que está
   * digitado agora, no instante em que a resposta chega.
   */
  const relerConfig = useCallback((nova) => {
    setConfig(nova);
    setForm((atual) => formularioAoReler(atual, nova));
  }, []);

  /**
   * A sonda relê O STATUS E A CONFIGURAÇÃO, e a segunda metade não é zelo:
   * `ultimo_erro` e `desligado_em` — o diagnóstico do desligamento automático —
   * viajam SÓ em `GET /whatsapp/config`. O `GET /status` monta a resposta campo
   * a campo e não os inclui. Sondando só o status, "Conferir de novo" mostraria
   * `ativo:false` recém-chegado ao lado de um diagnóstico velho (ou de nenhum),
   * que é exatamente a ambiguidade que essas duas colunas existem para desfazer.
   *
   * O formulário é RELIDO, não remontado (`relerConfig`): os campos visíveis e
   * os interruptores passam a ser os do servidor — é o que o botão promete, e é
   * o que faz o checkbox "Integração ligada" acompanhar um desligamento
   * automático em vez de contradizer a faixa de alarme —, mas o que estiver
   * digitado nos três campos de segredo PERMANECE. O token da Meta é exibido
   * uma única vez; esvaziar aquele campo pode custar ao gestor a instalação
   * inteira.
   */
  const sondar = useCallback(async () => {
    setSondando(true);
    const [s, c] = await Promise.all([
      buscarStatus(authFetch),
      buscarConfig(authFetch),
    ]);
    setStatus(s.status);
    if (c.config) relerConfig(c.config);
    if (s.erro || c.erro) setErro(s.erro || c.erro);
    setSondando(false);
  }, [authFetch, relerConfig]);

  const recarregarTemplates = useCallback(async () => {
    const r = await buscarTemplates(authFetch);
    setTemplates(r.templates);
    setTemplatesDesligados(r.desligado);
    // 503 aqui é o estado normal enquanto a integração não está pronta: vira
    // explicação azul no bloco, não tarja vermelha na tela inteira.
    setErroTemplates(r.desligado ? null : r.erro);
  }, [authFetch]);

  const recarregarMensagens = useCallback(
    async (quantas) => {
      const { mensagens: m, erro: falha } = await buscarMensagens(
        authFetch,
        quantas,
      );
      setMensagens(m);
      if (falha) setErro(falha);
    },
    [authFetch],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const [s, c] = await Promise.all([
        buscarStatus(authFetch),
        buscarConfig(authFetch),
      ]);
      if (!vivo) return;
      setStatus(s.status);
      if (c.config) aplicarConfig(c.config);
      if (s.erro || c.erro) setErro(s.erro || c.erro);
      setCarregando(false);
      await Promise.all([recarregarTemplates(), recarregarMensagens(50)]);
    })();
    return () => {
      vivo = false;
    };
  }, [authFetch, aplicarConfig, recarregarTemplates, recarregarMensagens]);

  const { ocupado, salvarConfig, criarTemplates, enviarTeste } =
    useWhatsAppAcoes({
      authFetch,
      aoFalhar: setErro,
      aoSalvarConfig: (nova) => {
        aplicarConfig(nova);
        // Salvar pode ter LIGADO a integração (ou desligado): a sonda e os
        // templates passam a responder outra coisa.
        sondar();
        recarregarTemplates();
      },
    });

  const mudar = (campo) => (valor) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));

  const estado = useMemo(() => descreverStatus(status), [status]);
  const numero = useMemo(() => descreverNumero(status?.numero), [status]);
  // `null` quando ninguem desistiu de nada — e' assim que o vazio nao vira
  // alarme falso.
  const desligamento = useMemo(() => descreverDesligamento(config), [config]);

  /**
   * Integração não pronta é ESTADO CONHECIDO: os botões que precisam da Meta
   * ficam desabilitados em vez de irem buscar um 503. Enquanto a sonda não
   * respondeu, nada é desabilitado — o servidor continua sendo a autoridade, e
   * a frase dele chega inteira pelo hook.
   */
  const semMeta = status ? status.ligado === false : false;

  /**
   * Sem ter conseguido LER a configuração, não se ESCREVE por cima dela.
   *
   * O formulário nasce vazio quando o GET falha (sessão expirada, API fora), e
   * `corpoDaConfig` manda os campos visíveis SEMPRE — salvar nesse estado
   * apagaria `phone_number_id` e `waba_id` e desligaria os seis avisos, tudo
   * de uma vez, com a tela dizendo "salvo". O botão fica desabilitado até a
   * leitura funcionar.
   */
  const semConfig = !config;

  if (carregando) return <Loading />;

  return (
    <Container>
      <Title>WhatsApp — avisos de pedido e atendimento</Title>

      {/* Tarja de erro padrão do painel (mesmo desenho de Bling e Orders):
          persistente e dispensável, com a frase do servidor. */}
      {erro && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            margin: "0 0 4px",
            padding: "10px 14px",
            borderLeft: "3px solid #b3261e",
            background: "#fdf2f1",
            color: "#5c1a14",
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1, minWidth: 200 }}>{erro}</span>
          <ButtonSecondary type="button" onClick={() => setErro(null)}>
            Dispensar
          </ButtonSecondary>
        </div>
      )}

      {/* ---------------------------------------------------------------
          1. Estado da integração
          --------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Title as="h3" style={{ marginBottom: 0 }}>
            Estado da integração
          </Title>
          <span style={{ flex: 1 }} />
          <ButtonSecondary type="button" disabled={sondando} onClick={sondar}>
            {sondando ? "Conferindo…" : "Conferir de novo"}
          </ButtonSecondary>
        </div>

        {/* NO ALTO DE TUDO, e antes da tarja de estado: um bot que parou
            SOZINHO nao e a mesma coisa que um bot que falta configurar. Sem
            esta faixa, "desligado" nao distingue "fui eu quem desligou" de "a
            credencial morreu ontem a noite e nenhum cliente foi avisado desde
            entao" — e a segunda e urgente. Nada disso aparece quando
            `desligado_em` e nulo: religar limpa as duas colunas, e o vazio E a
            resposta. */}
        {desligamento && (
          <Tarja tom={desligamento.tom} titulo={desligamento.titulo}>
            Parou em <strong>{dataHoraBr(desligamento.desligado_em)}</strong>.{" "}
            {desligamento.frase}
            <div style={{ marginTop: 6, fontSize: "0.85rem" }}>
              O que a Meta respondeu: <em>{desligamento.motivo}</em>
            </div>
          </Tarja>
        )}

        <Tarja tom={estado.tom} titulo={estado.titulo}>
          {estado.frase}
        </Tarja>

        {estado.faltando.length > 0 && (
          <List style={{ marginTop: 16 }}>
            {CAMPOS_ESPERADOS.filter((campo) =>
              estado.faltando.includes(campo.rotulo),
            ).map((campo) => (
              <ListItem
                key={campo.chave}
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                  borderLeftColor: "#1976d2",
                }}
              >
                <strong>{campo.rotulo}</strong>
                <span style={{ fontSize: "0.85rem", color: "#666" }}>
                  {campo.ajuda}
                </span>
              </ListItem>
            ))}
          </List>
        )}

        <Tarja tom={numero.tom} titulo={numero.titulo}>
          {numero.frase}
        </Tarja>

        <p style={{ margin: "12px 0 0", fontSize: 13, color: "#666" }}>
          Configuração salva pela última vez em{" "}
          {dataHoraBr(config?.atualizado_em || status?.atualizado_em)}.
        </p>
      </Card>

      {/* ---------------------------------------------------------------
          2. Credenciais
          --------------------------------------------------------------- */}
      <Card>
        <Title as="h3">Credenciais da Meta</Title>
        <p style={{ margin: "0 0 12px", color: "#666", fontSize: 14 }}>
          Os três primeiros são secretos: o painel nunca os mostra de volta —
          só os quatro últimos caracteres, para você reconhecer o que colou.
          Deixe um campo secreto em branco para <strong>não mexer</strong> nele.
        </p>

        {CAMPOS_ESPERADOS.map((campo) => {
          const mascara = campo.segredo
            ? descreverSegredo(config?.[`${campo.chave}_mascara`])
            : null;
          return (
            <div key={campo.chave} style={{ marginBottom: 16 }}>
              <Label htmlFor={`wa-${campo.chave}`}>{campo.rotulo}</Label>
              <Input
                id={`wa-${campo.chave}`}
                // WRITE-ONLY: `value` é o que foi DIGITADO agora, nunca a
                // máscara. Reenviar a máscara faria o servidor gravá-la como
                // se fosse o segredo.
                type={campo.segredo ? "password" : "text"}
                autoComplete={campo.segredo ? "new-password" : "off"}
                spellCheck={false}
                value={form[campo.chave]}
                placeholder={
                  campo.segredo
                    ? mascara.configurado
                      ? "Em branco: mantém o valor atual"
                      : "Cole aqui o valor da Meta"
                    : "Cole aqui o valor da Meta"
                }
                onChange={(e) => mudar(campo.chave)(e.target.value)}
              />
              <div style={{ fontSize: "0.85rem", color: "#666", marginTop: 4 }}>
                {campo.segredo ? (
                  <>
                    <strong>{mascara.frase}</strong> — {campo.ajuda}
                  </>
                ) : (
                  campo.ajuda
                )}
              </div>
            </div>
          );
        })}

        <div style={{ marginBottom: 16 }}>
          <Label htmlFor="wa-numero_suporte">
            Número de suporte (opcional)
          </Label>
          <Input
            id="wa-numero_suporte"
            type="text"
            value={form.numero_suporte}
            placeholder="5531999990000"
            onChange={(e) => mudar("numero_suporte")(e.target.value)}
          />
          <div style={{ fontSize: "0.85rem", color: "#666", marginTop: 4 }}>
            O número que o menu de atendimento oferece ao cliente que pede para
            falar com uma pessoa. O bot funciona sem ele.
          </div>
        </div>

        <Actions>
          <ButtonPrimary
            type="button"
            disabled={ocupado("salvar") || semConfig}
            title={
              semConfig
                ? "A configuração atual não pôde ser lida — recarregue a página antes de salvar, para não gravar por cima com campos vazios."
                : "Grava a configuração. Campo de segredo em branco mantém o valor atual."
            }
            onClick={() => salvarConfig(form)}
          >
            {ocupado("salvar") ? "Salvando…" : "Salvar configuração"}
          </ButtonPrimary>
        </Actions>
      </Card>

      {/* ---------------------------------------------------------------
          3. Avisos
          --------------------------------------------------------------- */}
      <Card>
        <Title as="h3">Avisos ao cliente</Title>

        <Interruptor
          id="wa-ativo"
          ligado={form.ativo}
          rotulo="Integração ligada"
          detalhe="O interruptor geral. Desligado, nenhum aviso sai e nenhuma resposta de cliente é processada — a loja continua vendendo e avisando por e-mail."
          onChange={mudar("ativo")}
        />

        <div
          style={{
            marginTop: 20,
            paddingTop: 12,
            borderTop: "1px solid #eee",
          }}
        >
          <strong style={{ fontSize: "0.95rem" }}>
            Um interruptor por status do pedido
          </strong>
          {INTERRUPTORES.map((i) => (
            <Interruptor
              key={i.chave}
              id={`wa-${i.chave}`}
              ligado={form[i.chave]}
              rotulo={i.rotulo}
              detalhe={`${i.detalhe} Template: ${i.templates.join(", ")}.`}
              onChange={mudar(i.chave)}
            />
          ))}
          {!form.ativo && (
            <Tarja tom="desligado">
              Com a integração desligada, estes interruptores não têm efeito
              nenhum — ligue o de cima primeiro.
            </Tarja>
          )}
        </div>

        <Actions>
          <ButtonPrimary
            type="button"
            disabled={ocupado("salvar") || semConfig}
            title={
              semConfig
                ? "A configuração atual não pôde ser lida — recarregue a página antes de salvar, para não gravar por cima com campos vazios."
                : "Grava a configuração. Campo de segredo em branco mantém o valor atual."
            }
            onClick={() => salvarConfig(form)}
          >
            {ocupado("salvar") ? "Salvando…" : "Salvar configuração"}
          </ButtonPrimary>
        </Actions>
      </Card>

      {/* ---------------------------------------------------------------
          4. Templates
          --------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Title as="h3" style={{ marginBottom: 0 }}>
            Templates na Meta
          </Title>
          <span style={{ flex: 1 }} />
          <ButtonSecondary type="button" onClick={recarregarTemplates}>
            Recarregar
          </ButtonSecondary>
          <ButtonSecondary
            type="button"
            disabled={semMeta || ocupado("templates")}
            title={
              semMeta
                ? "Complete a configuração e ligue a integração para falar com a Meta."
                : "Cria na Meta todos os templates desta loja. Já existentes são ignorados."
            }
            onClick={async () => {
              // `resultados` traz uma LINHA POR TEMPLATE, com a frase do erro
              // de cada um que não subiu. Guardá-las é o que diferencia
              // "5 falharam" (o resumo do toast) de saber QUAIS e POR QUÊ — a
              // lista recarregada mostraria os cinco como "ainda não criado",
              // sem o motivo.
              const { resultados } = await criarTemplates();
              setCriacao(
                Object.fromEntries(resultados.map((r) => [r.nome, r])),
              );
              await recarregarTemplates();
            }}
          >
            {ocupado("templates") ? "Criando…" : "Criar na Meta"}
          </ButtonSecondary>
        </div>

        <p style={{ margin: "8px 0 12px", color: "#666", fontSize: 14 }}>
          A lista é a desta loja; o estado é o da Meta. Template que a loja
          dispara e não existe lá faz o cliente ficar sem aviso nenhum.
        </p>

        {templatesDesligados && (
          <Tarja tom="pendente" titulo="Ainda não dá para perguntar à Meta">
            Enquanto a credencial não estiver completa e a integração ligada,
            não há a quem perguntar o estado dos templates. Complete o bloco
            acima e volte aqui.
          </Tarja>
        )}
        {erroTemplates && <Tarja tom="erro">{erroTemplates}</Tarja>}

        {templates.length === 0 && !templatesDesligados && !erroTemplates && (
          <p style={{ color: "#888", marginTop: 12 }}>
            Nenhum template para listar.
          </p>
        )}

        {templates.length > 0 && (
          <List style={{ marginTop: 16 }}>
            {templates.map((t) => {
              const d = descreverTemplate(t);
              const c = cor(d.tom);
              return (
                <ListItem
                  key={t.nome}
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    borderLeftColor: c.borda,
                  }}
                >
                  <div>
                    <strong>{t.nome}</strong>{" "}
                    <span style={{ color: c.borda, fontWeight: 600 }}>
                      · {d.rotulo}
                    </span>
                    {precisaDeAtencao(t) && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: "#fff5e9",
                          color: "#6b3d06",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        precisa de atenção
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {d.detalhe}
                  </div>
                  {t.category && (
                    <div style={{ fontSize: "0.8rem", color: "#888" }}>
                      Categoria na Meta: {t.category}
                    </div>
                  )}
                  {/* A reclassificação é a linha cara desta tela: sem ela, a
                      mudança de UTILITY para MARKETING só aparece na fatura. */}
                  {d.categoria && (
                    <Tarja tom="atencao" titulo="Reclassificação anunciada">
                      {d.categoria}
                    </Tarja>
                  )}
                  {/* O que a Meta respondeu na última tentativa de criação
                      deste template, quando ela recusou. */}
                  {criacao[t.nome]?.erro && (
                    <Tarja tom="erro" titulo="A Meta recusou a criação">
                      {criacao[t.nome].erro}
                      {criacao[t.nome].codigo
                        ? ` (código ${criacao[t.nome].codigo})`
                        : ""}
                    </Tarja>
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </Card>

      {/* ---------------------------------------------------------------
          5. Envio de teste
          --------------------------------------------------------------- */}
      <Card>
        <Title as="h3">Enviar uma mensagem de teste</Title>
        <p style={{ margin: "0 0 12px", color: "#666", fontSize: 14 }}>
          Para validar a instalação antes do primeiro pedido — inclusive contra
          o número de teste da Meta. Não exige cliente cadastrado nem pedido. O
          painel nunca guarda o número inteiro: o histórico registra só os
          quatro últimos dígitos.
        </p>

        <Label htmlFor="wa-teste-para">Número de destino (com DDD)</Label>
        <Input
          id="wa-teste-para"
          type="tel"
          value={paraTeste}
          placeholder="31 99999-0000"
          onChange={(e) => setParaTeste(e.target.value)}
        />

        {templates.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Label htmlFor="wa-teste-template">Template</Label>
            <Select
              id="wa-teste-template"
              value={templateTeste}
              onChange={(e) => setTemplateTeste(e.target.value)}
            >
              <option value="">Padrão (pedido recebido)</option>
              {templates.map((t) => (
                <option key={t.nome} value={t.nome}>
                  {t.nome}
                </option>
              ))}
            </Select>
          </div>
        )}

        <Actions>
          <ButtonPrimary
            type="button"
            disabled={semMeta || ocupado("teste") || !paraTeste.trim()}
            title={
              semMeta
                ? "Complete a configuração e ligue a integração para enviar."
                : "Manda o template escolhido para o número informado."
            }
            onClick={async () => {
              const ok = await enviarTeste(paraTeste.trim(), templateTeste);
              if (ok) await recarregarMensagens(limite);
            }}
          >
            {ocupado("teste") ? "Enviando…" : "Enviar teste"}
          </ButtonPrimary>
        </Actions>
      </Card>

      {/* ---------------------------------------------------------------
          6. Histórico
          --------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Title as="h3" style={{ marginBottom: 0 }}>
            Histórico de envios
          </Title>
          <span style={{ flex: 1 }} />
          <Select
            aria-label="Quantas mensagens mostrar"
            value={limite}
            onChange={(e) => {
              const novo = Number(e.target.value);
              setLimite(novo);
              recarregarMensagens(novo);
            }}
            style={{ width: "auto" }}
          >
            <option value={50}>últimas 50</option>
            <option value={100}>últimas 100</option>
            <option value={200}>últimas 200</option>
          </Select>
          <ButtonSecondary
            type="button"
            onClick={() => recarregarMensagens(limite)}
          >
            Recarregar
          </ButtonSecondary>
        </div>

        {mensagens.length === 0 ? (
          <p style={{ color: "#888", marginTop: 12 }}>
            Nenhuma mensagem registrada ainda.
          </p>
        ) : (
          <List style={{ marginTop: 16 }}>
            {mensagens.map((m) => {
              const d = rotuloDeEnvio(m);
              const c = cor(d.tom);
              return (
                <ListItem
                  key={m.id}
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    borderLeftColor: c.borda,
                  }}
                >
                  <div>
                    <strong>{m.template}</strong>{" "}
                    <span style={{ color: c.borda, fontWeight: 600 }}>
                      · {d.rotulo}
                    </span>{" "}
                    <span style={{ color: "#888" }}>
                      · para ••••{m.telefone_final || "????"}
                      {m.pedido_id
                        ? ` · pedido …${String(m.pedido_id).slice(-6)}`
                        : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {d.detalhe}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>
                    Criada em {dataHoraBr(m.criado_em)}
                    {m.enviado_em ? ` · enviada ${dataHoraBr(m.enviado_em)}` : ""}
                    {m.entregue_em
                      ? ` · entregue ${dataHoraBr(m.entregue_em)}`
                      : ""}
                  </div>
                </ListItem>
              );
            })}
          </List>
        )}
      </Card>
    </Container>
  );
}

export default WhatsAppManager;
