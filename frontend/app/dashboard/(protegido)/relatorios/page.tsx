import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { janelaDeDias } from "@/lib/painel/data";
import {
  DIVERGENCIAS,
  FORMULAS,
  MODELO_DE_ATRIBUICAO,
  PAGINAS_NO_MAXIMO,
  RELATORIOS,
  RELATORIOS_IMPOSSIVEIS,
  agregarPorCupom,
  agregarPorProduto,
  agregarPorStatus,
  chipsDoRelatorio,
  lerEstado,
  coberturaDoRelatorio,
  montarConsulta,
  ordenar,
  paraBr,
  serieDiaria,
  urlDaTela,
  type EstadoDoRelatorio,
  type PedidoDoRelatorio,
  type RespostaDePedidos,
} from "@/lib/painel/relatorios/relatorios.logica";

import {
  COLUNAS_DE_CUPOM,
  COLUNAS_DE_DIA,
  COLUNAS_DE_PRODUTO,
  COLUNAS_DE_STATUS,
} from "./Colunas";
import { GraficoDoRelatorio, type PontoDoGrafico } from "./GraficoDoRelatorio";
import { TabelaDoRelatorio } from "./TabelaDoRelatorio";

/**
 * `/dashboard/relatorios` — tabela ordenável primeiro, gráfico opcional.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DE ONDE VÊM OS NÚMEROS, E QUAL É O TETO.
 *
 * Não existe rota de agregação no Express. O que existe é
 * `GET /admin/orders?de&ate&status&page&limit`, paginado, com teto de 100 por
 * página — então esta tela LÊ PÁGINAS e agrega no servidor do Next.
 *
 * Isso tem um limite, e o limite é declarado na tela (`coberturaDoRelatorio`).
 * Um relatório que cobre em silêncio só os mil pedidos mais recentes é pior que
 * relatório nenhum, porque parece uma resposta; um que diz "cobre 1.000 dos
 * 3.482 do filtro — encurte o período" é honesto e útil enquanto a loja for
 * pequena, e nomeia exatamente o que falta para deixar de ter teto.
 *
 * A TABELA VEM ANTES DO GRÁFICO, no código e na tela, e o gráfico se DESLIGA
 * (R30). Quem desliga um gráfico está tentando ler a tabela; por isso o
 * desligamento vive na URL e sobrevive ao F5.
 * ════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: "Relatórios",
  robots: { index: false, follow: false },
};

/**
 * Lê até `PAGINAS_NO_MAXIMO` páginas de `/admin/orders`.
 *
 * SEQUENCIAL E NÃO EM PARALELO, e a razão é o `totalPages`: só a primeira
 * resposta diz quantas páginas existem. Disparar dez idas de uma vez faria nove
 * delas serem inúteis na esmagadora maioria dos casos (esta loja tem menos de
 * cem pedidos), e cada uma custa uma consulta com `COUNT(*)` no Postgres.
 *
 * PARA NA PRIMEIRA FALHA, e devolve o que já leu junto do erro. Um relatório
 * montado com sete das dez páginas, sem avisar, mostraria uma queda de vendas
 * que não existe — então quem chama recebe o erro e a tela desenha a tarja.
 */
async function lerPedidosDoPeriodo(
  estado: EstadoDoRelatorio,
): Promise<
  { ok: true; pedidos: PedidoDoRelatorio[]; total: number } | { ok: false; erro: string }
> {
  const pedidos: PedidoDoRelatorio[] = [];
  let total = 0;

  for (let pagina = 1; pagina <= PAGINAS_NO_MAXIMO; pagina += 1) {
    const resposta = await lerDaApi<RespostaDePedidos>(montarConsulta(estado, pagina));
    if (!resposta.ok) return { ok: false, erro: resposta.erro };

    pedidos.push(...(resposta.dados.data ?? []));
    total = resposta.dados.total ?? pedidos.length;

    if (pagina >= (resposta.dados.totalPages ?? 1)) break;
  }

  return { ok: true, pedidos, total };
}

export default async function PaginaDeRelatorios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const estado = lerEstado(parametros);
  const leitura = await lerPedidosDoPeriodo(estado);

  const pedidos = leitura.ok ? leitura.pedidos : [];
  const cobertura = coberturaDoRelatorio(
    leitura.ok ? leitura.total : 0,
    pedidos.length,
  );

  return (
    <>
      <Cabecalho
        titulo="Relatórios"
        descricao="O que vendeu, quando e com qual cupom — com a conta de cada número à vista."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <EscolhaDoRelatorio estado={estado} />
        <EscolhaDoPeriodo estado={estado} />
        <ChipsDeFiltro
          chips={chipsDoRelatorio(estado)}
          hrefLimpar={urlDaTela({ ...estado, ...janelaDeDias(30) })}
        />

        {/*
          O MODELO DE ATRIBUIÇÃO FICA AO LADO DOS NÚMEROS — R29, e não num
          rodapé. Ele diz o que conta como venda e em que fuso, que são as duas
          perguntas por trás de toda divergência com outra fonte.
        */}
        <p className="max-w-[85ch] text-[12px] text-fuligem-55">
          <span className={`text-[10px] ${ETIQUETA}`}>Como este número é feito </span>
          {MODELO_DE_ATRIBUICAO}
        </p>

        {/* O teto da leitura, declarado. A tarja só aparece quando ele foi
            atingido — um aviso que aparece sempre é um aviso que ninguém lê. */}
        {leitura.ok && !cobertura.completa && (
          <Tarja tom="alerta">{cobertura.aviso}</Tarja>
        )}

        <EstadoDaTela
          carregando={false}
          esqueleto={null}
          erro={leitura.ok ? null : leitura.erro}
          /*
            ZERO É UM NÚMERO PLAUSÍVEL — e num relatório de período mais ainda:
            um mês sem venda é um fato, não um defeito. Por isso `vazio` só é
            verdadeiro quando a leitura DEU CERTO; "nenhuma venda" por causa de
            uma API fora do ar seria lido como queda de faturamento.
          */
          vazio={leitura.ok && pedidos.length === 0}
          /*
            `false`, E ISSO FOI MEDIDO. Com `filtroAtivo` verdadeiro o
            <EstadoDaTela> desenha o vazio GENÉRICO — "Nenhum resultado para este
            filtro. Limpar filtros" — e engole a única frase que esta tela
            precisa dizer quando não há venda: QUAL é o recorte.

            E o vazio genérico seria mentira aqui, porque o período não é um
            filtro removível: um relatório sem recorte de tempo leria a base
            inteira e bateria no teto na primeira abertura. Não há "limpar" a
            oferecer — há um período a mostrar, e é o que o texto faz.
          */
          filtroAtivo={false}
          vazioTitulo="Nenhuma venda neste período"
          vazioTexto={`Entre ${paraBr(estado.de)} e ${paraBr(estado.ate)} não há pedido que conte como venda. Contam aprovado, em processamento, enviado e entregue — pedido pendente de pagamento não entra.`}
        >
          <Ficha semPreenchimento>
            <Relatorio estado={estado} pedidos={pedidos} />
          </Ficha>
        </EstadoDaTela>

        <AsFormulas />
        <AsDivergencias />
        <OQueNaoDaParaFazer />
      </div>
    </>
  );
}

/**
 * O relatório escolhido — a tabela primeiro, o gráfico depois.
 *
 * A ORDEM NO CÓDIGO É A ORDEM NA TELA, e as duas são a ordem do R30: a tabela é
 * a representação PRECISA e o gráfico é o resumo. Invertê-las faria o gestor
 * ler a forma antes do número, que é como se conclui coisa errada depressa.
 */
function Relatorio({
  estado,
  pedidos,
}: {
  estado: EstadoDoRelatorio;
  pedidos: PedidoDoRelatorio[];
}) {
  if (estado.relatorio === "dia") {
    const linhas = ordenar(
      serieDiaria(pedidos, estado.de, estado.ate),
      estado.ordem,
      estado.direcao,
    );
    return (
      <Bloco
        estado={estado}
        legenda="Vendas por dia"
        colunas={COLUNAS_DE_DIA}
        linhas={linhas}
        totalCentavos={somar(linhas)}
        /* LINHA, porque é série temporal — e os pontos vão na ordem do TEMPO,
           não na da tabela: um gráfico de linha reordenado por receita desenha
           uma tendência que não existe. */
        pontos={[...linhas]
          .sort((a, b) => a.dia.localeCompare(b.dia))
          .map((l) => ({ rotulo: l.diaBr.slice(0, 5), centavos: l.receitaCentavos }))}
        forma="linha"
      />
    );
  }

  if (estado.relatorio === "cupom") {
    const linhas = ordenar(agregarPorCupom(pedidos), estado.ordem, estado.direcao);
    return (
      <Bloco
        estado={estado}
        legenda="Vendas por cupom"
        colunas={COLUNAS_DE_CUPOM}
        linhas={linhas}
        totalCentavos={somar(linhas)}
        pontos={paraBarras(linhas.map((l) => ({ rotulo: l.codigo, centavos: l.receitaCentavos })))}
        forma="barra"
      />
    );
  }

  if (estado.relatorio === "status") {
    const linhas = ordenar(agregarPorStatus(pedidos), estado.ordem, estado.direcao);
    return (
      <Bloco
        estado={estado}
        legenda="Pedidos por status"
        colunas={COLUNAS_DE_STATUS}
        linhas={linhas}
        /* SEM TOTAL: esta coluna mistura entregue com cancelado, e a soma seria
           um número que não responde pergunta nenhuma. */
        totalCentavos={undefined}
        pontos={paraBarras(linhas.map((l) => ({ rotulo: l.rotulo, centavos: l.receitaCentavos })))}
        forma="barra"
      />
    );
  }

  const linhas = ordenar(agregarPorProduto(pedidos), estado.ordem, estado.direcao);
  return (
    <Bloco
      estado={estado}
      legenda="Vendas por produto"
      colunas={COLUNAS_DE_PRODUTO}
      linhas={linhas}
      totalCentavos={somar(linhas)}
      pontos={paraBarras(linhas.map((l) => ({ rotulo: l.nome, centavos: l.receitaCentavos })))}
      forma="barra"
    />
  );
}

function somar(linhas: { receitaCentavos: number }[]): number {
  return linhas.reduce((total, linha) => total + linha.receitaCentavos, 0);
}

/**
 * As barras do gráfico — as DEZ MAIORES, e o resto fica só na tabela.
 *
 * Trinta barras num gráfico de comparação não comparam nada: as pequenas viram
 * traços indistinguíveis e as grandes já eram óbvias. Dez é o que cabe com
 * rótulo legível. A tabela continua tendo tudo — que é precisamente por que o
 * gráfico pode se dar ao luxo de mostrar menos.
 *
 * ORDENADAS POR VALOR, e não pela ordem da tabela: "barra ordenada" é o que R30
 * autoriza, e uma barra em ordem alfabética perde o único canal visual que o
 * formato oferece.
 */
function paraBarras(pontos: PontoDoGrafico[]): PontoDoGrafico[] {
  return [...pontos].sort((a, b) => b.centavos - a.centavos).slice(0, 10);
}

function Bloco<L extends { chave: string }>({
  estado,
  legenda,
  colunas,
  linhas,
  totalCentavos,
  pontos,
  forma,
}: {
  estado: EstadoDoRelatorio;
  legenda: string;
  colunas: React.ComponentProps<typeof TabelaDoRelatorio<L>>["colunas"];
  linhas: L[];
  totalCentavos?: number;
  pontos: PontoDoGrafico[];
  forma: "linha" | "barra";
}) {
  return (
    <>
      <TabelaDoRelatorio
        legenda={legenda}
        colunas={colunas}
        linhas={linhas}
        estado={estado}
        totalCentavos={totalCentavos}
      />

      <div className="border-t border-fuligem-20 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
            {forma === "barra" ? "As dez maiores" : "Ao longo do período"}
          </h3>
          {/*
            R30: O GRÁFICO TEM DE PODER SER DESLIGADO. É um <Link> e não um
            botão porque o estado vive na URL — o desligamento sobrevive ao F5 e
            à navegação, e quem desligou um gráfico está tentando ler a tabela:
            vê-lo voltar a cada visita é hostil.
          */}
          <Link
            href={urlDaTela({ ...estado, grafico: !estado.grafico })}
            className={`inline-flex min-h-11 items-center text-[13px] underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
          >
            {estado.grafico ? "Ocultar gráfico" : "Mostrar gráfico"}
          </Link>
        </div>

        {estado.grafico && (
          <div className="mt-3">
            <GraficoDoRelatorio pontos={pontos} forma={forma} titulo={legenda} />
          </div>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Os controles
 * -------------------------------------------------------------------------- */

/** Os quatro relatórios, como links. Trocar de relatório PRESERVA o período e
 *  ZERA a ordenação (cada um tem colunas próprias, e `lerEstado` já derruba uma
 *  ordem que não existe no relatório novo). */
function EscolhaDoRelatorio({ estado }: { estado: EstadoDoRelatorio }) {
  return (
    <nav aria-label="Relatórios" className="flex flex-wrap items-center gap-2">
      {RELATORIOS.map((relatorio) => {
        const aceso = relatorio.valor === estado.relatorio;
        return aceso ? (
          <span
            key={relatorio.valor}
            aria-current="true"
            className={`inline-flex min-h-11 items-center rounded-bt bg-fuligem px-3 text-[11px] ${ETIQUETA} text-cal`}
          >
            {relatorio.rotulo}
          </span>
        ) : (
          <Link
            key={relatorio.valor}
            href={urlDaTela({
              ...estado,
              relatorio: relatorio.valor,
              // A ordenação NÃO viaja entre relatórios: "receita" existe nos
              // quatro, mas "codigo" só existe em cupom. Deixar em branco faz
              // `lerEstado` aplicar o padrão daquele relatório.
              ordem: undefined,
              direcao: undefined,
            })}
            className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-fuligem hover:bg-cal hover:text-fuligem ${FOCO}`}
          >
            {relatorio.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * As janelas de tempo.
 *
 * SÃO ATALHOS E NÃO UM SELETOR DE DATA, e a escolha é de frequência: as
 * perguntas reais são "e este mês?" e "e a semana passada?", quase nunca "e
 * entre 3 e 17 de março?". Os atalhos resolvem as duas primeiras num clique e
 * mantêm a URL legível — e a URL continua aceitando `de` e `ate` à mão para
 * quem precisar de um recorte específico, o que a tela diz logo abaixo.
 */
function EscolhaDoPeriodo({ estado }: { estado: EstadoDoRelatorio }) {
  const janelas = [
    { rotulo: "7 dias", dias: 7 },
    { rotulo: "30 dias", dias: 30 },
    { rotulo: "90 dias", dias: 90 },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Período</span>
      {janelas.map((janela) => {
        const alvo = janelaDeDias(janela.dias);
        const aceso = estado.de === alvo.de && estado.ate === alvo.ate;
        return aceso ? (
          <span
            key={janela.dias}
            aria-current="true"
            className={`inline-flex min-h-11 items-center rounded-bt bg-fuligem px-3 text-[11px] ${ETIQUETA} text-cal`}
          >
            {janela.rotulo}
          </span>
        ) : (
          <Link
            key={janela.dias}
            href={urlDaTela({ ...estado, ...alvo })}
            className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-fuligem hover:bg-cal hover:text-fuligem ${FOCO}`}
          >
            {janela.rotulo}
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * O que a tela precisa dizer — R28 e R29
 * -------------------------------------------------------------------------- */

/**
 * As fórmulas por extenso.
 *
 * ELAS JÁ ESTÃO NO `title` DE CADA CABEÇALHO, e repeti-las aqui não é
 * redundância: `title` só aparece para quem pousa o mouse. Quem usa teclado,
 * quem está no celular e quem lê num leitor de tela nunca o vê — e a fórmula é
 * exatamente a informação que impede a conclusão "o sistema está quebrado".
 */
function AsFormulas() {
  return (
    <Ficha titulo="A conta de cada coluna">
      <dl className="space-y-3 text-[13px]">
        {Object.entries(FORMULAS).map(([chave, texto]) => (
          <div key={chave} className="sm:flex sm:gap-3">
            <dt
              className={`text-[10px] ${ETIQUETA} text-fuligem-55 sm:w-40 sm:shrink-0 sm:pt-[3px]`}
            >
              {chave}
            </dt>
            <dd className="max-w-[70ch] text-fuligem-55">{texto}</dd>
          </div>
        ))}
      </dl>
    </Ficha>
  );
}

/**
 * As divergências conhecidas — R28, "latência declarada mata metade dos
 * chamados".
 *
 * Cada uma é um chamado que não vai existir. A mais importante é a do GA4: o
 * evento `purchase` dispara na resposta síncrona do Mercado Pago, INCLUSIVE
 * para PIX não pago, e aqui o PIX pendente fica de fora. Os dois números estão
 * certos e nunca vão bater — e sem esta ficha a conclusão seria que um deles
 * está quebrado.
 */
function AsDivergencias() {
  return (
    <Ficha titulo="Por que este número não bate com aquele">
      <ul className="space-y-5">
        {DIVERGENCIAS.map((divergencia) => (
          <li key={divergencia.titulo} className="border-l-2 border-fuligem-20 pl-4">
            <h3 className="font-medium">{divergencia.titulo}</h3>
            <p className="mt-1 max-w-[75ch] text-[13px] text-fuligem-55">
              {divergencia.texto}
            </p>
          </li>
        ))}
      </ul>
    </Ficha>
  );
}

/**
 * Os relatórios pedidos que ainda não podem existir.
 *
 * O MAIS CARO É O DE MARGEM, e ele está aqui em vez de na tela porque a
 * alternativa seria pior: a migração 0034 decidiu congelar `custo_centavos` em
 * cada item de `pedidos.itens`, mas o checkout ainda não grava a chave. Um
 * relatório de margem hoje leria custo ZERO em todo pedido e informaria 100% de
 * margem — a mentira mais cara que esta tela poderia contar, e a que o gestor
 * não teria como desconfiar.
 */
function OQueNaoDaParaFazer() {
  return (
    <Ficha titulo="Relatórios que ainda não dá para fazer">
      <p className="max-w-[75ch] text-[13px] text-fuligem-55">
        Quatro relatórios foram pedidos e não estão aqui. Cada um tem uma causa
        concreta, e nenhuma delas se resolve nesta tela — estão escritas para que
        a ausência seja informação, e não um chamado.
      </p>
      <ul className="mt-5 space-y-4">
        {RELATORIOS_IMPOSSIVEIS.map((relatorio) => (
          <li key={relatorio.titulo} className="border-l-2 border-fuligem-20 pl-4">
            <h3 className="font-medium">{relatorio.titulo}</h3>
            <p className="mt-1 max-w-[75ch] text-[13px] text-fuligem-55">
              {relatorio.falta}
            </p>
          </li>
        ))}
      </ul>
    </Ficha>
  );
}
