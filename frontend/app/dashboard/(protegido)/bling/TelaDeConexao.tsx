"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import type { TomDeStatus } from "@/lib/painel/status";
import { fraseDeErro } from "@/lib/painel/bling/contrato";
import {
  ESCOPOS_DO_APP,
  URL_DE_CALLBACK,
  estadoDaConexao,
  mensagemDoRetorno,
  type ChaveDoEstado,
  type MensagemDoRetorno,
  type StatusDaConexao,
} from "@/lib/painel/bling/conexao.logica";
import { lerCorpo } from "@/lib/painel/resposta";
import { chamarApi } from "@/lib/painel/transporte";

/**
 * `/dashboard/bling` — a tela que conecta a loja ao ERP.
 *
 * O QUE ELA CONSERTA. Até aqui, ligar a loja ao Bling era um procedimento de
 * `docs/bling.md`: criar o aplicativo, montar uma URL de autorização à mão,
 * copiar o `code` da barra de endereço com um cronômetro de um minuto correndo,
 * trocá-lo por um refresh token com `curl`, colar o token no `.env` e publicar
 * a API de novo. Cinco passos fora do produto, três deles irreversíveis se
 * errados, e nenhum ao alcance de quem administra a loja. Agora são dois campos
 * e um botão.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA É A ÚNICA PÁGINA `"use client"` DE `(protegido)`.
 *
 * Todas as outras são Server Components que leem por `lerDaApi` e delegam a
 * escrita a ilhas (spec §2.3). Esta não pode ser, e a razão é a VOLTA DO
 * CALLBACK: o Bling devolve o navegador para `/dashboard/bling?erro=<frase>`, e
 * a frase — que é o diagnóstico inteiro — só existe em `window.location`. Somem-
 * se a isso o redirect de página inteira do "Conectar" (que precisa da `url`
 * que o servidor acabou de gerar, com o `state` de uso único dentro) e o fato
 * de que cada uma das quatro ações MUDA o estado que a própria tela desenha: um
 * Server Component teria de revalidar a rota inteira a cada clique de
 * interruptor.
 *
 * O PREÇO ESTÁ PAGO E É PEQUENO: sem `export const metadata`, que um módulo de
 * cliente não pode declarar. Nenhuma rota de `(protegido)` é indexável de
 * qualquer jeito — o `robots` de cada página é cinto sobre suspensório, já que
 * o painel inteiro está atrás de `exigirAdminNoPainel` no layout —, e o
 * `<Cabecalho>` continua dando o título visível.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UM ESTADO POR VEZ (`estadoDaConexao(...).chave`).
 *
 * A ordem das perguntas é a ordem em que as coisas acontecem: sem credencial
 * não há o que autorizar; sem autorização não há o que ligar. Cada estado
 * desenha UMA ação — a próxima — em vez de quatro botões dos quais três
 * recusariam. A decisão mora em `lib/painel/bling/conexao.logica.ts`, testada
 * sem navegador; aqui só há o desenho.
 */

/**
 * O TOM DO SELO VEM DA CHAVE, E NÃO DO `cor` DO MÓDULO PURO — divergência
 * deliberada do plano, e ela tem dois motivos.
 *
 * O primeiro é mecânico: `<Selo>` recebe `tom` (um dos quatro do painel) e
 * pinta o FILETE, porque a tinta dele é sempre fuligem — `--color-alerta` sobre
 * cal-puro dá 3,6:1, abaixo dos 4,5:1 que a WCAG 1.4.3 exige de texto pequeno,
 * e selo é o menor texto do painel. Um `#b3261e` cru num `style` fura a paleta
 * fechada do estetica.md §4.1 e o raciocínio de contraste do próprio componente.
 *
 * O segundo é o R21: `sem_credenciais` traz `#b3261e` (vermelho), e vermelho
 * aqui é RESERVADO a erro e ação destrutiva. Nunca ter configurado o Bling é o
 * estado de FÁBRICA de toda loja que ainda não usa o ERP — pintá-lo de vermelho
 * ensina o gestor a ignorar vermelho, que é como se deixa de acreditar nos
 * erros de verdade. É a mesma decisão que `/dashboard/ajustes` já tinha tomado
 * para o mesmo dado, e que o teste dela cobra nominalmente.
 */
const TOM_DO_ESTADO: Record<ChaveDoEstado, TomDeStatus> = {
  sem_credenciais: "neutro",
  desconectado: "alerta",
  conectado_desligado: "neutro",
  ligado: "sucesso",
};

/** O rótulo do selo é CURTO — ele responde "e aí?" de relance; a frase inteira
 *  vem logo abaixo, no corpo da ficha. */
const ROTULO_DO_ESTADO: Record<ChaveDoEstado, string> = {
  sem_credenciais: "Não cadastrada",
  desconectado: "Falta autorizar",
  conectado_desligado: "Desligada",
  ligado: "Ligada",
};

type EscopoDoApp = (typeof ESCOPOS_DO_APP)[number];

/**
 * A tabela dos escopos — e a terceira coluna é a que importa.
 *
 * "Contatos: ler e escrever" sozinho não diz se marcar aquilo é seguro. O
 * `porque` foi conferido contra as chamadas reais de `blingPedidos.js`, e é ele
 * que permite ao gestor recusar um escopo que a loja não exerce — Produtos é
 * só leitura porque a loja nunca cria produto no Bling, só confere o SKU.
 */
const COLUNAS_DOS_ESCOPOS: Coluna<EscopoDoApp>[] = [
  { chave: "recurso", rotulo: "Recurso", celula: (e) => e.recurso },
  {
    chave: "permissao",
    rotulo: "Permissão",
    celula: (e) => (e.escrita ? "Ler e escrever" : "Só leitura"),
  },
  { chave: "porque", rotulo: "Para quê", celula: (e) => e.porque },
];

export function TelaDeConexao({
  /**
   * A NAVEGAÇÃO SAI POR AQUI para que o teste possa observá-la.
   *
   * O padrão é `window.location.assign`, e não `router.push`: o destino é o
   * Bling, fora deste app — o roteador do Next não navega para outra origem, e
   * pedir a ele que tente só produz um erro no console. É redirect de página
   * inteira de propósito: o `client_secret` entra na troca do `code` pelos
   * tokens, então quem volta do Bling volta para a API, não para cá.
   *
   * O default é uma FUNÇÃO e não `window.location.assign` direto: ler `window`
   * na avaliação do módulo quebraria o SSR desta página (um módulo de cliente
   * ainda é executado no servidor durante a renderização inicial).
   */
  aoNavegar = (url: string) => window.location.assign(url),
}: {
  aoNavegar?: (url: string) => void;
}) {
  const [status, setStatus] = useState<StatusDaConexao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);

  /**
   * UM RECADO SÓ, no topo da tela, para o retorno do callback E para o
   * resultado das ações.
   *
   * Duas tarjas disputando o mesmo lugar é como se acaba com "Credenciais
   * salvas" verde por cima de "O Bling recusou" vermelho na mesma tela. E é
   * `<Tarja>` e não toast porque R9 é explícita: erro é banner persistente —
   * um flash de 2s pode não ser anunciado por leitor de tela, some para quem
   * usa ampliação e não pode ser relido por quem olhou tarde.
   */
  const [recado, setRecado] = useState<MensagemDoRetorno | null>(null);

  /** A FOTOGRAFIA da trava, só para o JSX repintar. Nunca é a trava. */
  const [emVoo, setEmVoo] = useState<string | null>(null);
  /**
   * A TRAVA DE VERDADE, e ela é `useRef` pelo mesmo motivo de
   * `pedidos/useAcoesDoBling.ts`: `setState` é ASSÍNCRONO, e dois cliques no
   * mesmo tick leem o mesmo estado "livre" e disparam duas requisições. A
   * escrita no `.current` é imediata, então a segunda encontra a marca da
   * primeira e desiste.
   *
   * Aqui a corrida é mais cara que na fila de pedidos: dois "Conectar" geram
   * dois `state` de uso único no servidor, e o segundo redirect atropela o
   * primeiro — o gestor volta do Bling com um `state` que já não vale.
   *
   * A trava é da TELA inteira, e não por botão: as quatro ações mexem na MESMA
   * linha de `config_loja`, e desligar a integração enquanto se desconecta não
   * é concorrência, é confusão.
   */
  const emVooRef = useRef<string | null>(null);

  const [confirmandoDesconexao, setConfirmandoDesconexao] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const marcar = useCallback((chave: string | null) => {
    emVooRef.current = chave;
    setEmVoo(chave);
  }, []);

  /**
   * `GET /bling/status` — a leitura que decide a tela inteira.
   *
   * Falha de rede NÃO vira um estado plausível. Sem isto, um `catch` que
   * deixasse `status` em `null` desenharia "Aplicativo do Bling ainda não
   * cadastrado" para uma loja perfeitamente conectada, e o gestor recadastraria
   * credenciais que já estavam lá. É a mesma lição do `<EstadoDaTela>`: zero é
   * um número plausível, e por isso ele nunca pode ser o valor de "não consegui
   * perguntar".
   */
  const lerStatus = useCallback(async () => {
    setCarregando(true);
    setErroDaLeitura(null);
    try {
      const res = await chamarApi("/bling/status");
      const corpo = (await lerCorpo(res)) as Record<string, unknown>;
      if (!res.ok) {
        // `res.ok` conferido: `fetch` não lança em 4xx/5xx, e sem isto um 401
        // cairia no caminho de sucesso com um corpo vazio.
        setStatus(null);
        setErroDaLeitura(fraseDeErro(res.status, corpo));
        return;
      }
      setStatus(corpo as StatusDaConexao);
    } catch {
      setStatus(null);
      setErroDaLeitura(
        "Não foi possível falar com o servidor da loja para saber em que " +
          "passo a conexão está.",
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void lerStatus();
  }, [lerStatus]);

  /**
   * O QUE O CALLBACK TROUXE NA URL — lido num efeito, e não no corpo do render.
   *
   * `window` não existe durante o SSR desta página, e ler `location` ali
   * quebraria a renderização inicial. No efeito, ele roda só no navegador e uma
   * vez por montagem.
   */
  useEffect(() => {
    const mensagem = mensagemDoRetorno(new URLSearchParams(window.location.search));
    if (mensagem) setRecado(mensagem);
  }, []);

  /**
   * O corpo do caminho feliz, ou `null` — e a RECUSA DO SERVIDOR VAI INTEIRA
   * para a tarja.
   *
   * `fraseDeErro` (o de `bling/contrato.ts`) devolve `corpo.message ||
   * corpo.error` quando há frase de verdade. É o diagnóstico: "Informe o Client
   * ID e o Client Secret do aplicativo criado no Bling.", "Conecte a loja ao
   * Bling antes de ligar a integração.", "O Bling recusou a autorização:
   * invalid_grant". Trocar qualquer uma delas por "erro genérico" transforma um
   * problema de dois minutos num chamado.
   */
  const acionar = useCallback(
    async (
      chave: string,
      executar: () => Promise<Response>,
    ): Promise<Record<string, unknown> | null> => {
      if (emVooRef.current) return null;
      marcar(chave);
      try {
        const res = await executar();
        const corpo = (await lerCorpo(res)) as Record<string, unknown>;
        if (!res.ok) {
          setRecado({ tipo: "erro", texto: fraseDeErro(res.status, corpo) });
          return null;
        }
        return corpo;
      } catch {
        setRecado({
          tipo: "erro",
          texto:
            "A API da loja não respondeu. Nada foi alterado — tente de novo.",
        });
        return null;
      } finally {
        // No `finally`: uma exceção que não destravasse deixaria a tela inteira
        // morta até o F5.
        marcar(null);
      }
    },
    [marcar],
  );

  async function salvarCredenciais(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const corpo = await acionar("credenciais", () =>
      chamarApi("/bling/conexao/credenciais", "POST", {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      }),
    );
    if (!corpo) return;

    /* O SEGREDO SAI DA TELA assim que é gravado. Ele emite nota fiscal e mexe
       em estoque; deixá-lo num campo aberto numa aba esquecida é o mesmo risco
       de tê-lo escrito num post-it. O Client ID fica — ele é o que o gestor
       confere contra o app do Bling. */
    setClientSecret("");
    setRecado({
      tipo: "sucesso",
      texto:
        typeof corpo.message === "string"
          ? corpo.message
          : "Credenciais salvas. Agora clique em Conectar para autorizar.",
    });
    await lerStatus();
  }

  async function conectar() {
    const corpo = await acionar("conectar", () =>
      chamarApi("/bling/conexao/iniciar", "POST"),
    );
    if (!corpo) return;

    if (typeof corpo.url !== "string" || !corpo.url) {
      /* 200 sem `url` é o backend divergindo do contrato. Dizer isso é melhor
         que um `assign(undefined)`, que recarregaria esta mesma tela e pareceria
         "o botão não faz nada". */
      setRecado({
        tipo: "erro",
        texto:
          "O servidor respondeu sem a URL de autorização do Bling. Confira se " +
          "a API foi atualizada — veja docs/bling.md.",
      });
      return;
    }
    aoNavegar(corpo.url);
  }

  async function alternarIntegracao(ligar: boolean) {
    const corpo = await acionar("ativo", () =>
      chamarApi("/bling/conexao/ativo", "POST", { ativo: ligar }),
    );
    if (!corpo) return;

    /* QUEM MANDA É A RESPOSTA, e não o que o clique pediu: o backend pode
       recusar ligar sem conexão (409) ou corrigir o valor, e desenhar o pedido
       faria o interruptor discordar do banco. Sem refetch — a rota devolve o
       `ativo` que valeu, e uma segunda viagem só para reler isso faria a tela
       piscar embaixo do dedo. */
    setStatus((anterior) => ({ ...(anterior || {}), ativo: corpo.ativo === true }));
    setRecado({
      tipo: "sucesso",
      texto:
        corpo.ativo === true
          ? "Integração ligada. Pedido aprovado passa a virar pedido de venda no Bling."
          : "Integração desligada. Nada mais é enviado ao Bling.",
    });
  }

  async function desconectar() {
    const corpo = await acionar("desconectar", () =>
      chamarApi("/bling/conexao", "DELETE"),
    );
    setConfirmandoDesconexao(false);
    if (!corpo) return;

    setRecado({
      tipo: "sucesso",
      texto:
        "A loja foi desconectada do Bling. O Client ID e o Client Secret " +
        "continuam salvos — para voltar, é só clicar em Conectar.",
    });
    await lerStatus();
  }

  const estado = estadoDaConexao(status);
  const ocupado = Boolean(emVoo);
  const ligado = status?.ativo === true;

  return (
    <>
      <Cabecalho
        titulo="Bling (ERP e NF-e)"
        descricao="A conexão da loja com o ERP: o cadastro do aplicativo, a autorização e o interruptor da integração."
        /* SEM AÇÃO NO CABEÇALHO, e a ausência é deliberada. R18 quer uma ação
           primária por página, sempre no mesmo lugar — e aqui a ação primária
           MUDA com o estado (salvar, conectar, ligar). Um botão de canto que só
           serve a um dos quatro estados é pior que canto vazio; cada ação mora
           colada ao que ela opera.

           E sem `email`: a página é de cliente, e o e-mail da sessão só existe
           no servidor. O <Cabecalho> já trata `email` ausente sem inventar nada
           no lugar. */
      />

      <div className="mx-auto max-w-[1000px] space-y-6 px-5 py-6">
        {recado && (
          <Tarja
            tom={recado.tipo === "sucesso" ? "sucesso" : "erro"}
            onFechar={() => setRecado(null)}
          >
            {recado.texto}
          </Tarja>
        )}

        <EstadoDaTela
          carregando={carregando}
          esqueleto={
            <Ficha titulo="Conexão com o Bling">
              <p className="text-fuligem-55">
                Perguntando ao servidor em que passo a conexão está…
              </p>
            </Ficha>
          }
          erro={erroDaLeitura}
          aoTentarDeNovo={() => void lerStatus()}
          /*
            NÃO HÁ ESTADO VAZIO AQUI, e por isso `vazio` é sempre `false`. Vazio
            é "a lista veio sem linhas"; uma conexão sempre está em algum dos
            quatro passos, e o primeiro deles — nunca cadastrada — já É o
            conteúdo da tela, com o formulário que o resolve. As duas props
            abaixo são obrigatórias na assinatura e ficam como documentação do
            caso que não existe.
          */
          vazio={false}
          vazioTitulo="Sem conexão para mostrar"
          vazioTexto="Esta tela nunca fica vazia: a conexão está sempre em um dos quatro passos."
        >
          <Ficha
            titulo="Conexão com o Bling"
            /* O selo fica no CABEÇALHO da ficha: é a resposta que se vem buscar
               aqui, e ela precisa estar visível antes de qualquer leitura. */
            acao={
              <Selo tom={TOM_DO_ESTADO[estado.chave]}>
                {ROTULO_DO_ESTADO[estado.chave]}
              </Selo>
            }
          >
            <div className="space-y-5">
              <div className="max-w-[70ch] space-y-1">
                <p className="font-medium">{estado.titulo}</p>
                <p className="text-[13px] text-fuligem-55">{estado.detalhe}</p>
              </div>

              {/* ----------------------------------------------------------
                  PASSO 1 — o aplicativo ainda não existe no Bling
                  ---------------------------------------------------------- */}
              {estado.chave === "sem_credenciais" && (
                <div className="space-y-6">
                  <section aria-label="Escopos do aplicativo" className="space-y-2">
                    <h3 className={`text-xs ${ETIQUETA} text-fuligem`}>
                      1. Escopos a marcar ao criar o aplicativo
                    </h3>
                    <Tabela
                      legenda="Escopos que o aplicativo do Bling precisa, e para que a loja usa cada um"
                      colunas={COLUNAS_DOS_ESCOPOS}
                      /* Cópia rasa porque `ESCOPOS_DO_APP` é congelado — a
                         tabela pede um array mutável e não escreve nele. */
                      linhas={[...ESCOPOS_DO_APP]}
                      chaveDaLinha={(e) => e.recurso}
                    />
                  </section>

                  <section
                    aria-label="URL de redirecionamento"
                    className="space-y-2"
                  >
                    <h3 className={`text-xs ${ETIQUETA} text-fuligem`}>
                      2. URL de redirecionamento
                    </h3>
                    <p className="max-w-[70ch] text-[13px] text-fuligem-55">
                      Cole exatamente esta URL no campo &quot;URL de
                      redirecionamento&quot; do aplicativo. Ela é a da API, e não
                      a da vitrine: o Client Secret entra na troca do código
                      pelos tokens, e num callback de página ele teria de chegar
                      ao navegador. O Bling não aceita a URL como parâmetro — ele
                      usa a que está cadastrada —, então ela tem de bater
                      caractere por caractere.
                    </p>
                    {/* `data-dado` porque é código, e código é dado (§2.5):
                        monoespaçada, para conferir caractere a caractere. */}
                    <code
                      data-dado
                      className="block overflow-x-auto rounded-bt border border-fuligem-20 bg-cal px-3 py-2 text-[12px]"
                    >
                      {URL_DE_CALLBACK}
                    </code>
                  </section>

                  <form onSubmit={salvarCredenciais} className="space-y-4">
                    <h3 className={`text-xs ${ETIQUETA} text-fuligem`}>
                      3. As credenciais que o Bling mostrou
                    </h3>
                    <Campo
                      rotulo="Client ID"
                      value={clientId}
                      onChange={(evento) => setClientId(evento.target.value)}
                      required
                      /* `off` nos dois: gerenciador de senha oferecendo a senha
                         do painel dentro do campo de credencial de ERP é como
                         se salva a credencial errada sem perceber. */
                      autoComplete="off"
                      ajuda="Fica visível na tela do aplicativo, no Bling."
                    />
                    <Campo
                      rotulo="Client Secret"
                      /* `password` porque este segredo emite nota fiscal e mexe
                         em estoque — ele não fica legível para quem passar atrás
                         da cadeira. */
                      type="password"
                      value={clientSecret}
                      onChange={(evento) => setClientSecret(evento.target.value)}
                      required
                      autoComplete="off"
                      ajuda="O Bling só mostra o Secret uma vez, na criação do aplicativo. Se perdeu, gere outro por lá."
                    />
                    <Botao type="submit" disabled={ocupado} aria-busy={emVoo === "credenciais"}>
                      {emVoo === "credenciais" ? "Salvando…" : "Salvar credenciais"}
                    </Botao>
                  </form>
                </div>
              )}

              {/* ----------------------------------------------------------
                  PASSO 2 — credenciais salvas, falta autorizar
                  ---------------------------------------------------------- */}
              {estado.chave === "desconectado" && (
                <div className="space-y-3">
                  <Botao
                    onClick={() => void conectar()}
                    disabled={ocupado}
                    aria-busy={emVoo === "conectar"}
                  >
                    {emVoo === "conectar" ? "Abrindo o Bling…" : "Conectar"}
                  </Botao>
                  <p className="max-w-[70ch] text-[12px] text-fuligem-55">
                    Você sai desta tela para o Bling, entra com a conta da loja e
                    autoriza. A autorização vale por um minuto depois de dada — se
                    demorar, volte aqui e clique de novo, sem prejuízo nenhum.
                  </p>
                </div>
              )}

              {/* ----------------------------------------------------------
                  PASSO 3 — conectada: o interruptor e a saída
                  ---------------------------------------------------------- */}
              {(estado.chave === "conectado_desligado" ||
                estado.chave === "ligado") && (
                <div className="space-y-5">
                  {/*
                    O INTERRUPTOR É UM `<input type="checkbox" role="switch">`, e
                    não um botão desenhado à mão. O checkbox nativo já traz
                    teclado, foco e o estado marcado/desmarcado de graça; o
                    `role="switch"` (permitido pela ARIA 1.2 exatamente sobre
                    ele) troca o anúncio de "caixa de seleção, marcada" por
                    "interruptor, ligado", que é o que isto é. Escrever um
                    <div role="switch"> obrigaria a reimplementar Espaço, Enter e
                    foco à mão, para chegar ao mesmo lugar.

                    O <label> envolve o controle E o texto: o texto visível é o
                    nome acessível, sem `aria-label` divergente (WCAG 2.5.3).
                  */}
                  <label className="flex min-h-11 max-w-[70ch] items-center gap-3">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={ligado}
                      disabled={ocupado}
                      onChange={(evento) =>
                        void alternarIntegracao(evento.target.checked)
                      }
                      className="size-4 shrink-0 accent-fuligem"
                    />
                    <span className="text-[13px]">
                      Enviar ao Bling os pedidos aprovados
                    </span>
                  </label>

                  <div className="space-y-2 border-t border-fuligem-20 pt-4">
                    <Botao
                      variante="destrutiva"
                      onClick={() => setConfirmandoDesconexao(true)}
                      disabled={ocupado}
                    >
                      Desconectar
                    </Botao>
                    <p className="max-w-[70ch] text-[12px] text-fuligem-55">
                      Desconectar apaga a autorização gravada e desliga a
                      integração. As credenciais do aplicativo ficam — isto é
                      &quot;refazer a autorização&quot;, não &quot;esquecer o
                      aplicativo&quot;.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE ESTA TELA NÃO FAZ, POR ESCRITO — a doutrina da tela de
          Assinaturas. Dizê-lo separa "a tela não tem o botão" de "a tela está
          quebrada", e poupa a busca por uma fila que não existe aqui.
        */}
        <p className="max-w-[70ch] text-[12px] text-fuligem-55">
          Emitir a nota de um pedido, sincronizar com o ERP e buscar rastreio
          ficam dentro do próprio pedido, em Pedidos — é lá que você está quando
          percebe que a nota não saiu. Esta tela cuida só da ligação entre a loja
          e o Bling.
        </p>
      </div>

      {/*
        A CONFIRMAÇÃO CARREGA A CONSEQUÊNCIA (R12). "Tem certeza?" não informa
        nada e treina a clicar em OK; o que o gestor precisa saber é que a nota
        para de sair e que as credenciais ficam.

        `Cancelar` fica ENTRE o resto da tela e o botão que faz o estrago (R11),
        e o destrutivo é o último antes da borda.
      */}
      <Dialogo
        aberto={confirmandoDesconexao}
        aoMudar={setConfirmandoDesconexao}
        titulo="Desconectar a loja do Bling?"
        descricao="A autorização é apagada e a integração é desligada: pedido aprovado deixa de virar pedido de venda e nenhuma nota sai daqui. O Client ID e o Client Secret continuam salvos — para voltar, basta clicar em Conectar e autorizar de novo."
        acoes={
          <>
            <Botao
              variante="secundaria"
              onClick={() => setConfirmandoDesconexao(false)}
              disabled={ocupado}
            >
              Cancelar
            </Botao>
            <Botao
              variante="destrutiva"
              onClick={() => void desconectar()}
              disabled={ocupado}
              aria-busy={emVoo === "desconectar"}
            >
              {emVoo === "desconectar" ? "Desconectando…" : "Sim, desconectar"}
            </Botao>
          </>
        }
      />
    </>
  );
}
