"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type MouseEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO, FOCO_INTERNO } from "@/components/painel/ui/estilos";
import { estadoDoBling, mesclarPedido } from "@/lib/painel/bling/contrato";
import { formatarData } from "@/lib/painel/data";
import { formatarReais } from "@/lib/painel/dinheiro";
import { rotuloDoStatus, tomDoStatus } from "@/lib/painel/status";
import {
  POR_PAGINA,
  STATUS_EM_LOTE,
  avisoDoLote,
  identificarPedido,
  numeroDoPedido,
  resumoDaSelecao,
  rotuloCurtoDoBling,
  tomDoBling,
  totalDeUnidades,
  urlDaTela,
  urlDoPedido,
  type EstadoDosPedidos,
  type PedidoDoPainel,
} from "@/lib/painel/pedidos/pedidos.logica";

import { PainelDoPedido } from "./PainelDoPedido";
import { mudarStatusEmLote } from "./acoes";

/**
 * A LISTA — e por que ela é uma ilha de cliente, quando Clientes e Assinaturas
 * não são.
 *
 * Aquelas telas são leitura pura: a tabela inteira é HTML do servidor e todo
 * controle é um `<a href>`. Esta tem três coisas que só existem no navegador e
 * que não dá para empurrar para o servidor sem perder o que elas valem:
 *
 *  1. O PAINEL LATERAL DO R26, que é o maior ganho operacional da tela. Abrir o
 *     detalhe sem navegar transforma a triagem de quarenta cliques em doze — e
 *     por ser NÃO-MODAL, não cobre a lista que a pessoa está conferindo.
 *  2. A SELEÇÃO EM MASSA do R25, que é estado efêmero por definição: marcar
 *     doze pedidos não é um lugar para onde se volta, e pôr isso na URL encheria
 *     o histórico e o R2 de dado que não é filtro.
 *  3. A MESCLA DA RESPOSTA DO BLING, campo a campo, sem refetch — a fila não
 *     pode pular embaixo do dedo de quem trabalha linha a linha.
 *
 * `Coluna.celula` É UMA FUNÇÃO, e função não atravessa a fronteira
 * Server→Client serializada. Por isso as colunas são declaradas AQUI e nunca na
 * `page.tsx`. Isso NÃO aparece no `next build` (as rotas do painel são
 * dinâmicas), só em execução, com a tela em branco — e `proibicoes.test.ts` tem
 * um `describe("a fronteira Server->Client")` que varre exatamente isso.
 */
export function ListaDePedidos({
  linhas: doServidor,
  estado,
  totalDoFiltro,
  totalPaginas,
  blingLigado,
}: {
  linhas: PedidoDoPainel[];
  /** O estado da URL, já lido e saneado pela `page.tsx`. Objeto simples: é DADO
   *  atravessando a fronteira, nunca função. */
  estado: EstadoDosPedidos;
  /** Quantos pedidos o FILTRO alcança no servidor — não quantos estão na tela.
   *  É a metade da frase do R25. */
  totalDoFiltro: number;
  totalPaginas: number;
  blingLigado: boolean | null;
}) {
  /**
   * A CÓPIA LOCAL DAS LINHAS existe por uma razão só: a resposta de uma ação do
   * Bling atualiza a linha SEM refetch. Fora disso ela é o que o servidor
   * mandou.
   *
   * A RECONCILIAÇÃO É POR IDENTIDADE DE PROP, sem `useEffect` e sem `key` — o
   * mesmo padrão de `BuscaDaLista`. Quando `revalidatePath` traz dados novos, o
   * Server Component re-renderiza e o array chega com outra identidade: aí a
   * cópia se rende, e a seleção é zerada junto. Zerar é o certo: os pedidos
   * marcados podem ter saído do filtro, e agir sobre uma seleção que se refere
   * a uma lista que já não existe é o defeito que o R25 inteiro combate.
   */
  const [linhas, setLinhas] = useState(doServidor);
  const [ultimasDoServidor, setUltimasDoServidor] = useState(doServidor);
  const [marcados, setMarcados] = useState<string[]>([]);
  if (doServidor !== ultimasDoServidor) {
    setUltimasDoServidor(doServidor);
    setLinhas(doServidor);
    setMarcados([]);
  }

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [destinoDoLote, setDestinoDoLote] = useState<string>("");
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [erroDoLote, setErroDoLote] = useState<string | null>(null);
  const [avisoDoResultado, setAvisoDoResultado] = useState<string | null>(null);
  const [aplicandoLote, iniciarLote] = useTransition();

  /**
   * QUEM ABRIU O PAINEL RECEBE O FOCO DE VOLTA quando ele fechar. Sem isto,
   * quem navega por teclado ou leitor de tela volta ao topo do documento a cada
   * pedido conferido — e a triagem de doze cliques vira doze viagens de Tab.
   */
  const gatilho = useRef<HTMLElement | null>(null);

  const indiceAberto = linhas.findIndex((l) => l.order_id === abertoId);
  const pedidoAberto = indiceAberto >= 0 ? linhas[indiceAberto] : null;

  function abrir(evento: MouseEvent<HTMLAnchorElement>, orderId: string) {
    /*
      O ELEMENTO É UM `<a href>` DE VERDADE, e o clique comum é interceptado.
      Isso não é cerimônia: com um `<button>`, Ctrl+clique e o botão do meio
      deixariam de abrir o pedido em outra aba — que é como se compara dois
      pedidos lado a lado — e a tela não funcionaria sem JavaScript. Com o
      `<a>`, o navegador dá as duas coisas de graça e o painel lateral entra
      só no caminho comum.
    */
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    gatilho.current = evento.currentTarget;
    setAbertoId(orderId);
  }

  function fechar() {
    setAbertoId(null);
    gatilho.current?.focus();
    gatilho.current = null;
  }

  function irPara(passo: -1 | 1) {
    const proximo = linhas[indiceAberto + passo];
    if (proximo) setAbertoId(proximo.order_id);
  }

  function aoAtualizarPedido(orderId: string, parcial: PedidoDoPainel) {
    /*
      `mesclarPedido` MANTÉM A LISTA CONGELADA DE NOVE CAMPOS. Um
      `{ ...linha, ...pedido }` apagaria `address`, `user_name`, `user_email` e
      `user_cpf`, que a resposta de `/bling` NÃO traz — funcionaria hoje por
      acaso e passaria a apagar dados do cliente no dia em que os dois contratos
      divergirem mais um pouco.
    */
    setLinhas((atuais) =>
      atuais.map((l) =>
        l.order_id === orderId
          ? (mesclarPedido(
              l as unknown as Record<string, unknown>,
              parcial as unknown as Record<string, unknown>,
            ) as unknown as PedidoDoPainel)
          : l,
      ),
    );
  }

  const marcadosSet = new Set(marcados);
  const todosMarcados = linhas.length > 0 && marcados.length === linhas.length;
  const algunsMarcados = marcados.length > 0 && !todosMarcados;

  function alternarLinha(orderId: string) {
    setMarcados((atuais) =>
      atuais.includes(orderId)
        ? atuais.filter((id) => id !== orderId)
        : [...atuais, orderId],
    );
  }

  function alternarPagina() {
    setMarcados(todosMarcados ? [] : linhas.map((l) => l.order_id));
  }

  function aplicarLote() {
    setConfirmandoLote(false);
    setErroDoLote(null);
    setAvisoDoResultado(null);
    iniciarLote(async () => {
      const r = await mudarStatusEmLote(marcados, destinoDoLote);
      if (r.ok) setAvisoDoResultado(r.frase);
      else setErroDoLote(r.erro);
    });
  }

  const COLUNAS: Coluna<PedidoDoPainel>[] = [
    {
      chave: "pedido",
      rotulo: "Pedido",
      /*
        R23 — a primeira coluna é o identificador HUMANO: número do pedido e
        nome, NUNCA o UUID. O número vai em `data-dado`, que o `globals.css`
        converte em monoespaçada com numeral tabular: comparar dois pedidos vira
        comparar POSIÇÃO, e não comprimento de string.
      */
      celula: (linha) => {
        const aberto = linha.order_id === abertoId;
        return (
          <Link
            href={urlDoPedido(linha.order_id)}
            onClick={(evento) => abrir(evento, linha.order_id)}
            aria-current={aberto ? "true" : undefined}
            className={`-mx-1 block min-w-0 px-1 py-0.5 ${FOCO_INTERNO} ${
              aberto ? "border-l-2 border-fuligem pl-2" : ""
            }`}
          >
            <span data-dado className="block text-[13px]">
              #{numeroDoPedido(linha.order_id)}
            </span>
            <span className="block truncate text-[12px] font-normal text-fuligem-55">
              {identificarPedido(linha)}
            </span>
          </Link>
        );
      },
    },
    {
      chave: "data",
      rotulo: "Data",
      dado: true,
      // Só a data na lista — R31, fuso de São Paulo. A hora fica no detalhe,
      // onde decide alguma coisa; aqui ela só roubaria largura da coluna
      // seguinte.
      celula: (linha) => formatarData(linha.created_at),
    },
    {
      chave: "itens",
      rotulo: "Itens",
      dado: true,
      // Quantas unidades saem na caixa — é o número que a expedição usa para
      // saber se cabe numa embalagem ou em três.
      celula: (linha) => totalDeUnidades(linha.items),
    },
    {
      chave: "total",
      rotulo: "Total",
      dado: true,
      // REAIS, como string do `numeric` — `formatarReais`, nunca
      // `formatarCentavos`. Trocar as duas faz R$ 128,00 virar R$ 1,28.
      celula: (linha) => formatarReais(linha.total_amount),
    },
    {
      chave: "status",
      rotulo: "Status",
      celula: (linha) => (
        <Selo tom={tomDoStatus(linha.status)}>{rotuloDoStatus(linha.status)}</Selo>
      ),
    },
    {
      chave: "nfe",
      rotulo: "NF-e",
      /*
        A COLUNA DO BLING NA LISTA, e ela é o que torna a aba "Aguardando NF-e"
        legível: sem ela o gestor filtraria por nota pendente e veria uma lista
        que não explica por que aqueles pedidos estão ali.

        `estadoDoBling` decide, com a ordem intocada; `tomDoBling` só traduz a
        cor hexadecimal do contrato para o token da casa.
      */
      celula: (linha) => {
        const podeIr = ["aprovado", "enviado", "entregue"].includes(linha.status);
        if (!podeIr) {
          return (
            <span className="text-fuligem-55" title="Venda não confirmada não vai ao ERP.">
              —
            </span>
          );
        }
        const estado = estadoDoBling(linha as unknown as Record<string, unknown>);
        return (
          <Selo tom={tomDoBling(estado.chave)}>{rotuloCurtoDoBling(estado.chave)}</Selo>
        );
      },
    },
  ];

  const resumo = resumoDaSelecao(marcados.length, linhas.length, totalDoFiltro);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <Ficha semPreenchimento className="min-w-0 flex-1">
        <Tabela
          legenda="Pedidos da loja"
          colunas={COLUNAS}
          linhas={linhas}
          chaveDaLinha={(linha) => linha.order_id}
          selecao={{
            cabecalho: (
              <input
                type="checkbox"
                checked={todosMarcados}
                // O terceiro estado da caixa NÃO é uma prop do React: ele só
                // existe como propriedade do elemento. Sem ele, marcar três de
                // vinte deixaria a caixa do cabeçalho vazia, dizendo "nada
                // marcado" com três linhas marcadas na tela.
                ref={(el) => {
                  if (el) el.indeterminate = algunsMarcados;
                }}
                onChange={alternarPagina}
                aria-label={`Marcar os ${linhas.length} pedidos desta página`}
                className={`size-4 accent-fuligem ${FOCO}`}
              />
            ),
            celula: (linha) => (
              <input
                type="checkbox"
                checked={marcadosSet.has(linha.order_id)}
                onChange={() => alternarLinha(linha.order_id)}
                // O nome NOMEIA O OBJETO. "Selecionar" sozinho obriga quem não
                // vê a tela a adivinhar qual das vinte linhas está sob o cursor.
                aria-label={`Marcar o pedido #${numeroDoPedido(linha.order_id)}`}
                className={`size-4 accent-fuligem ${FOCO}`}
              />
            ),
          }}
        />
        {/* A PAGINAÇÃO MORA DENTRO DA FICHA, encostada na tabela — R17. Ela
            fica AQUI, e não na `page.tsx`, porque o `href` de cada página é uma
            FUNÇÃO, e função não atravessa a fronteira Server→Client. */}
        <Paginacao
          pagina={estado.pagina}
          totalPaginas={totalPaginas}
          porPagina={POR_PAGINA}
          total={totalDoFiltro}
          href={(pagina) => urlDaTela({ ...estado, pagina })}
          rotuloDoItem={{ singular: "pedido", plural: "pedidos" }}
        />
      </Ficha>

      {/*
        O PAINEL LATERAL É NÃO-MODAL — R26, e é a decisão de desenho mais
        importante desta tela.

        Em telas largas ele DIVIDE o espaço com a tabela em vez de cobri-la: a
        lista continua visível, rolável e clicável, e é isso que permite
        conferir um pedido olhando o de cima. Um modal cobriria exatamente os
        dados de referência que a pessoa precisa consultar enquanto decide.

        Abaixo de `xl` não há espaço para dividir, e ele vira uma folha ancorada
        à direita — ainda sem fundo escurecido e sem prender o foco, porque
        continua não sendo modal: a tabela por baixo continua operável.
      */}
      {pedidoAberto && (
        <PainelDoPedido
          pedido={pedidoAberto}
          blingLigado={blingLigado}
          posicao={indiceAberto + 1}
          quantos={linhas.length}
          temAnterior={indiceAberto > 0}
          temProximo={indiceAberto < linhas.length - 1}
          aoAnterior={() => irPara(-1)}
          aoProximo={() => irPara(1)}
          aoFechar={fechar}
          aoAtualizarPedido={aoAtualizarPedido}
        />
      )}
      </div>

      {(erroDoLote || avisoDoResultado) && (
        <div className="mt-3 space-y-2">
          {erroDoLote && <Tarja onFechar={() => setErroDoLote(null)}>{erroDoLote}</Tarja>}
          {avisoDoResultado && (
            <Tarja tom="sucesso" onFechar={() => setAvisoDoResultado(null)}>
              {avisoDoResultado}
            </Tarja>
          )}
        </div>
      )}

      {/*
        A BARRA DA SELEÇÃO — grudada no rodapé da janela, e só quando há algo
        marcado.

        `sticky` e não `fixed`: ela pertence à coluna de conteúdo, e uma barra
        fixa de ponta a ponta atravessaria o menu lateral. Ela nasce DEPOIS da
        tabela na árvore, então aparecer não empurra nenhuma linha — que é o que
        faria a linha sob o cursor sair de baixo do dedo no exato momento em que
        a pessoa está marcando linhas.
      */}
      {marcados.length > 0 && (
        <div className="sticky bottom-0 z-30 mt-3 rounded-cx border border-fuligem-20 bg-cal-puro px-4 py-3">
          <BarraDoLote
            resumo={resumo}
            destino={destinoDoLote}
            aoEscolher={setDestinoDoLote}
            aplicando={aplicandoLote}
            aoAplicar={() => setConfirmandoLote(true)}
            aoLimpar={() => setMarcados([])}
          />
        </div>
      )}

      <Dialogo
        aberto={confirmandoLote}
        aoMudar={setConfirmandoLote}
        titulo="Mudar o status em lote"
        // R12 — o texto nomeia o OBJETO (quantos pedidos, para qual status) e a
        // CONSEQUÊNCIA (estoque, e-mail, sem desfazer). "Tem certeza?" não
        // carrega informação e treina a clicar em OK.
        descricao={avisoDoLote(marcados.length, destinoDoLote)}
        acoes={
          <>
            {/* R11 — o botão que confirma o estrago fica LONGE do canto onde o
                dedo repousa, com o "Cancelar" entre ele e o resto da tela. */}
            <Botao variante="secundaria" onClick={() => setConfirmandoLote(false)}>
              Cancelar
            </Botao>
            <Botao variante="destrutiva" onClick={aplicarLote}>
              Mudar {marcados.length} {marcados.length === 1 ? "pedido" : "pedidos"}
            </Botao>
          </>
        }
      />
    </div>
  );
}

/**
 * A barra da seleção, num componente à parte só porque ela aparece duas vezes
 * na árvore — uma para telas largas (onde a lista divide espaço com o painel) e
 * outra para as estreitas. Duplicar o JSX seria duplicar a regra junto.
 */
function BarraDoLote({
  resumo,
  destino,
  aoEscolher,
  aplicando,
  aoAplicar,
  aoLimpar,
}: {
  resumo: string;
  destino: string;
  aoEscolher: (valor: string) => void;
  aplicando: boolean;
  aoAplicar: () => void;
  aoLimpar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/*
        R25 — A FRASE QUE DISTINGUE "OS 20 DESTA PÁGINA" DOS "N DO FILTRO".
        Sem ela o gestor acha que marcou 1.284 quando marcou 20. E não há opção
        de "marcar os N do filtro" de propósito: não existe rota de lote no
        backend, e oferecer a marcação para depois agir sobre vinte seria
        exatamente a mentira que o R25 nomeia.
      */}
      <p role="status" className="min-w-0 flex-1 text-[13px]">
        {resumo}
      </p>

      <label className="flex items-center gap-2">
        <span className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Mudar para</span>
        <select
          value={destino}
          disabled={aplicando}
          onChange={(evento) => aoEscolher(evento.target.value)}
          className={`min-h-11 rounded-bt border border-fuligem-20 bg-cal-puro px-3 text-[13px] disabled:opacity-40 ${FOCO}`}
        >
          <option value="">Escolha…</option>
          {/*
            `STATUS_EM_LOTE` É A LISTA SEM "ENVIADO". Um lote gravaria o MESMO
            código de rastreio em vinte encomendas diferentes, e cada cliente
            receberia por e-mail o rastreio de outra pessoa. A regra mora no
            módulo puro e tem teste.
          */}
          {STATUS_EM_LOTE.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </select>
      </label>

      <Botao onClick={aoAplicar} disabled={aplicando || !destino}>
        {/* R14 — nada de otimismo: "Aplicando…" fica até o servidor responder,
            e o placar que vem depois é o REAL, não o pedido. */}
        {aplicando ? "Aplicando…" : "Aplicar"}
      </Botao>
      <Botao variante="secundaria" onClick={aoLimpar} disabled={aplicando}>
        Desmarcar
      </Botao>
    </div>
  );
}
