import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { LEGADO } from "@/components/painel/casca/menu.logica";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerDaApi, type Leitura } from "@/lib/painel/api-servidor";
import { janelaAnterior, janelaDeDias } from "@/lib/painel/data";
import { montarUrl } from "@/lib/painel/filtros";
import {
  contagemDeStatus,
  contarEstoqueBaixo,
  linhasSemResposta,
  montarFila,
  montarIndicadores,
  numero,
  serieDeReceita,
  type Contagem,
  type Indicador,
  type LinhaDaFila,
  type ProdutoDoCatalogo,
  type ResumoDoPainel,
  type Variacao,
} from "@/lib/painel/home/home.logica";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";

import { GraficoDeReceita } from "./GraficoDeReceita";

/**
 * `/dashboard` — a home do painel, e ela é uma FILA DE TRABALHO.
 *
 * *"O lojista não abre o painel para admirar receita, abre para saber o que
 * embalar"* (spec §4.1). Por isso a ordem da tela é literal: o que precisa ser
 * feito hoje primeiro, com cada linha levando à lista JÁ FILTRADA; os números de
 * gestão depois; o gráfico por último. Inverter a ordem faz a tela virar um
 * relatório — bonito de olhar uma vez por mês e inútil às oito da manhã.
 *
 * O `PieChart` DO PAINEL LEGADO NÃO FOI TRADUZIDO. R30: ângulo e área não são
 * canais visuais precisos. O que ele mostrava (pedidos por status) aparece aqui
 * de um jeito melhor — como fila, com um link por status, porque o gestor não
 * quer VER a proporção, quer ABRIR a lista.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA TELA NÃO USA `<EstadoDaTela>` NA FILA, e usa no gráfico.
 *
 * Ela agrega SETE leituras independentes. Uma guarda tudo-ou-nada esconderia
 * quatro números bons porque um quinto falhou — e "não consigo mostrar nada" é
 * pior que "não consigo mostrar esta linha". A regra que importa continua
 * valendo, e vale por LINHA: `null` nunca é desenhado como `0`. A linha que não
 * respondeu mostra travessão, o leitor de tela ouve por escrito que não houve
 * resposta, e uma tarja diz quantas faltaram.
 *
 * O gráfico é o oposto — uma fonte só, o `salesChart` — e ali o `<EstadoDaTela>`
 * cabe inteiro, com os três estados que ele distingue.
 */
export const metadata: Metadata = {
  title: "Painel",
  // O painel não é conteúdo — é ferramenta de trabalho atrás de senha.
  // `app/robots.ts` já manda Disallow em /dashboard; isto é a segunda camada,
  // para o crawler que ignora o robots.txt mas respeita a meta tag.
  robots: { index: false, follow: false },
};

/** O teto que `GET /dashboard` aceita — o mesmo que `lib/catalogo/repositorio.ts`
 *  usa para ler o catálogo inteiro numa ida só. */
const CATALOGO_POR_PAGINA = 200;

/** As duas janelas de comparação dos KPIs. Ver `montarIndicadores`. */
const JANELAS = [7, 30] as const;

/** `total` de um envelope `{data, total, …}`, ou `null` se a leitura falhou. */
function totalDe(leitura: Leitura<Contagem>): number | null {
  return leitura.ok ? numero(leitura.dados?.total) : null;
}

/** Quantos pedidos há numa janela de dias — a contagem é feita NO BANCO. */
function contarPedidos(janela: { de: string; ate: string }) {
  // `limit=1` porque só o `total` interessa: sem ele viriam dez pedidos
  // completos, com CPF e endereço dentro, para serem descartados.
  return lerDaApi<Contagem>(
    montarUrl("/admin/orders", { ...janela, limit: 1 }),
  );
}

export default async function PaginaInicialDoPainel() {
  /**
   * A segunda leitura da sessão nesta requisição — dívida registrada desde a
   * Onda 1: o layout já chamou `exigirAdminNoPainel`, e aqui se pergunta de novo
   * só para saber o E-MAIL do cabeçalho. O conserto é embrulhar
   * `lerAcessoDoPainel` com o `cache()` do React, em
   * `lib/conta/painel-servidor.ts` — arquivo de segurança, fora do escopo desta
   * tarefa.
   */
  const acesso = await lerAcessoDoPainel();

  /*
    AS SETE LEITURAS SAEM JUNTAS. Em série elas somariam as latências e a home
    seria a tela mais lenta do painel — que é a pior tela para ser lenta, porque
    é a primeira. `Promise.all` porque nenhuma depende de outra.

    NENHUMA DELAS BAIXA LINHA DE PEDIDO: as quatro contagens pedem `limit=1` e
    leem só o `total`, que o backend calcula com um `COUNT(*)` no banco.
  */
  const [
    resumo,
    avaliacoes,
    catalogo,
    pedidos7,
    pedidos7Antes,
    pedidos30,
    pedidos30Antes,
  ] = await Promise.all([
    lerDaApi<ResumoDoPainel>("/dashboard/summary"),
    lerDaApi<Contagem>(montarUrl("/admin/avaliacoes", { status: "pendente", limit: 1 })),
    /*
      O CATÁLOGO INTEIRO, PARA CONTAR ESTOQUE BAIXO — e é a leitura mais cara
      desta tela, porque não há alternativa: `GET /dashboard` não filtra por
      quantidade, e não existe `estoque_minimo` em `canastra.produtos`. Está
      relatado como pendência de backend; quando a rota ganhar o filtro, isto
      vira uma contagem como as outras.
    */
    lerDaApi<{ products?: ProdutoDoCatalogo[]; totalPages?: number }>(
      montarUrl("/dashboard", { limit: CATALOGO_POR_PAGINA }),
    ),
    contarPedidos(janelaDeDias(JANELAS[0])),
    contarPedidos(janelaAnterior(JANELAS[0])),
    contarPedidos(janelaDeDias(JANELAS[1])),
    contarPedidos(janelaAnterior(JANELAS[1])),
  ]);

  const dadosDoResumo = resumo.ok ? resumo.dados : null;
  const produtos = catalogo.ok ? catalogo.dados?.products : null;

  const fila = montarFila({
    aDespachar: contagemDeStatus(dadosDoResumo?.statusChart, "aprovado"),
    pagamentoPendente: contagemDeStatus(dadosDoResumo?.statusChart, "pendente"),
    pagamentoRecusado: contagemDeStatus(dadosDoResumo?.statusChart, "rejeitado"),
    avaliacoesPendentes: totalDe(avaliacoes),
    estoqueBaixo: contarEstoqueBaixo(produtos),
    // A contagem é parcial quando o catálogo não coube na única página que a
    // API permite — e a linha diz isso em vez de mostrar um número menor.
    estoqueParcial: (catalogo.ok ? (catalogo.dados?.totalPages ?? 1) : 1) > 1,
  });

  const indicadores = montarIndicadores({
    resumo: dadosDoResumo,
    pedidos7: totalDe(pedidos7),
    pedidos7Anteriores: totalDe(pedidos7Antes),
    pedidos30: totalDe(pedidos30),
    pedidos30Anteriores: totalDe(pedidos30Antes),
  });

  const serie = serieDeReceita(dadosDoResumo?.salesChart);
  const semResposta = linhasSemResposta(fila);

  return (
    <>
      <Cabecalho
        titulo="Início"
        descricao="O que precisa ser feito hoje, antes de qualquer número."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6">
        {/*
          A TARJA DE LEITURA INCOMPLETA, e ela só aparece quando é verdade.

          `alerta` e não `erro`: parte da tela funciona, e gastar o vermelho —
          que R21 reserva a erro e destruição — numa leitura parcial ensina o
          gestor a ignorar a faixa. O texto NOMEIA o sintoma ("as linhas com
          travessão") para que ele saiba exatamente o que não olhar.
        */}
        {semResposta > 0 && (
          <Tarja tom="alerta">
            <span data-dado>{semResposta}</span>{" "}
            {semResposta === 1 ? "linha da fila não pôde" : "linhas da fila não puderam"} ser
            consultada{semResposta === 1 ? "" : "s"}: elas aparecem com um travessão, e não
            com zero. Recarregue a página — nada aqui foi alterado.
          </Tarja>
        )}

        {/*
          A FILA VEM PRIMEIRO, ANTES DE QUALQUER NÚMERO DE GESTÃO. É a decisão
          central do §4.1, e a ordem no JSX é a ordem na tela.
        */}
        <Ficha titulo="O que precisa ser feito hoje">
          {/* O filete da ÚLTIMA linha sai: a <Ficha> já desenha o seu, e dois
              filetes de 1px encostados viram um de 2px que não combina com
              nenhum outro da tela. O seletor mora no <ul> e não no <li> pelo
              mesmo motivo que em `Tabela.tsx`: quem sabe quem é o último é o
              pai. */}
          <ul className="[&>li:last-child>*]:border-b-0">
            {fila.map((linha) => (
              <LinhaDeFila key={linha.chave} linha={linha} />
            ))}
          </ul>
        </Ficha>

        <section aria-label="Indicadores">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {indicadores.map((indicador) => (
              <CartaoDeIndicador key={indicador.chave} indicador={indicador} />
            ))}
          </div>
        </section>

        <Ficha titulo="Receita por dia · últimos 7 dias">
          {/*
            AQUI O <EstadoDaTela> CABE INTEIRO: uma fonte só (o `salesChart`), e
            os três desfechos são distintos e todos plausíveis. Sete dias sem
            venda nenhuma acontece numa loja pequena; a diferença entre isso e
            "não consegui perguntar" é o que a doutrina deste componente existe
            para proteger.
          */}
          <EstadoDaTela
            /* Sempre `false` num Server Component: quando este JSX existe, o
               `await` já voltou. */
            carregando={false}
            esqueleto={null}
            erro={resumo.ok ? null : resumo.erro}
            vazio={resumo.ok && serie.length === 0}
            vazioTitulo="Nenhuma venda nos últimos 7 dias"
            vazioTexto="O gráfico volta assim que houver um pedido pago no período."
          >
            <GraficoDeReceita serie={serie} />
          </EstadoDaTela>

          {/*
            R29 — a fórmula ao lado do número, e aqui ela tem de estar escrita
            porque o recorte NÃO é o mesmo dos KPIs de pedidos logo acima. O
            backend usa `criado_em >= now() - INTERVAL '7 days'`, que são 168
            horas corridas no fuso do SERVIDOR, e agrupa com
            `TO_CHAR(criado_em, 'DD/MM')` — também no fuso do servidor. Se o
            servidor estiver em UTC, o corte de cada dia é a meia-noite de
            Londres, e não a de São Paulo. Duas verdades incompatíveis na mesma
            tela é o defeito clássico de painel, e ele aparece no fechamento do
            mês, quando alguém confere. Está relatado como pendência de backend.
          */}
          <p className="mt-4 max-w-[70ch] border-t border-fuligem-20 pt-3 text-[12px] text-fuligem-55">
            Soma dos pedidos pagos (aprovado, em processamento, enviado e
            entregue) das últimas 168 horas. O corte de cada dia vem do servidor
            da API, não do fuso de São Paulo — em virada de mês, confira pelo
            relatório de pedidos.
          </p>
        </Ficha>

        {/*
          O AVISO É `aviso` E NÃO `alerta`, MUITO MENOS `erro`. Nada está
          quebrado: o painel novo está incompleto, o que é um fato de cronograma.
          Gastar a tarja vermelha — ou mesmo o ocre — num recado de roteiro é
          como se ensina o gestor a ignorar a faixa no dia em que ela disser que
          o pagamento falhou (R21).
        */}
        <Tarja tom="aviso">
          As telas de Clientes e de Assinaturas já existem. Pedidos, Produtos,
          Descontos e Avaliações chegam nas próximas ondas — os links da fila
          acima já apontam para elas com o filtro pronto, e até lá o trabalho do
          dia é feito no{" "}
          <Link
            href={LEGADO.href}
            className={`underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
          >
            {LEGADO.rotulo}
          </Link>
          .
        </Tarja>
      </div>
    </>
  );
}

/**
 * Uma linha da fila — e ela é um LINK DE CORPO INTEIRO, não um número com um
 * link ao lado.
 *
 * §4.1: "cada linha é um link para uma aba salva de verdade, não um número
 * decorativo". O alvo é a linha toda porque o gesto é "abrir esses doze
 * pedidos", e obrigar a acertar um número de duas casas para isso é o oposto do
 * R22.
 *
 * QUANDO A CONTAGEM É `null`, A LINHA DEIXA DE SER LINK. Um link para
 * "pedidos aprovados" apresentado com um travessão prometeria uma lista que a
 * home não conseguiu nem contar — e o gestor clicaria esperando encontrar o que
 * a tela acabou de dizer que não sabe.
 */
function LinhaDeFila({ linha }: { linha: LinhaDaFila }) {
  const corpo = (
    <>
      <div className="min-w-0">
        <p className="font-medium">{linha.rotulo}</p>
        <p className="text-[12px] text-fuligem-55">
          {linha.definicao}
          {linha.ressalva && ` · ${linha.ressalva}`}
        </p>
      </div>

      {linha.contagem === null ? (
        <p className="shrink-0 text-fuligem-55">
          {/* O travessão é `data-dado` — a mesma coluna monoespaçada em que a
              contagem cairia —, então a linha não muda de largura quando o
              número chegar. O `sr-only` existe porque "—" é lido como travessão,
              ou como nada. */}
          <span data-dado aria-hidden="true">
            —
          </span>
          <span className="sr-only">não foi possível consultar</span>
        </p>
      ) : (
        <p className="shrink-0 text-[20px] leading-none" data-dado>
          {linha.contagem}
        </p>
      )}
    </>
  );

  const caixa =
    "flex min-h-11 items-center justify-between gap-4 border-b border-fuligem-20 py-3";

  return (
    <li>
      {linha.contagem === null ? (
        <div className={caixa}>{corpo}</div>
      ) : (
        <Link
          href={linha.href}
          className={`${caixa} -mx-2 px-2 transition-colors hover:bg-cal ${FOCO}`}
        >
          {corpo}
        </Link>
      )}
    </li>
  );
}

/**
 * Um KPI. Rótulo, número, comparação e FÓRMULA — nesta ordem.
 *
 * A fórmula (R29) fica visível, e não num tooltip: tooltip exige JavaScript e
 * um gesto, e a informação que ele guardaria é justamente a que decide se o
 * número pode ser usado numa conversa. Num painel lido uma vez por dia, quatro
 * linhas de 12px custam menos que um número em que não se confia.
 */
function CartaoDeIndicador({ indicador }: { indicador: Indicador }) {
  return (
    <div className="flex flex-col rounded-cx border border-fuligem-20 bg-cal-puro p-4">
      <p className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>{indicador.rotulo}</p>

      {indicador.valor === null ? (
        <p className="mt-2 text-[24px] leading-none text-fuligem-55">
          <span data-dado aria-hidden="true">
            —
          </span>
          <span className="sr-only">não foi possível consultar</span>
        </p>
      ) : (
        <p className="mt-2 text-[24px] leading-none" data-dado>
          {indicador.valor}
        </p>
      )}

      <ComparacaoDePeriodo
        variacao={indicador.variacao}
        comparadoCom={indicador.comparadoCom}
      />

      <p className="mt-2 text-[12px] leading-snug text-fuligem-55">
        {indicador.definicao}
      </p>
    </div>
  );
}

/**
 * A comparação de período — e ela NÃO é verde nem vermelha.
 *
 * A tentação é pintar de verde o que sobe e de vermelho o que desce. Duas
 * razões para não: R21 reserva o vermelho a erro e ação destrutiva, e um KPI
 * que caiu 3% não é um erro; e "subir" nem sempre é bom — pedidos cancelados
 * subindo em verde seria a tela mentindo com cor. A direção viaja no GLIFO e na
 * palavra, que é o canal que a WCAG 1.4.1 exige e que funciona em impressão,
 * em daltonismo e em leitor de tela.
 */
function ComparacaoDePeriodo({
  variacao,
  comparadoCom,
}: {
  variacao: Variacao;
  comparadoCom?: string;
}) {
  if (variacao.tipo === "desconhecida") return null;

  if (variacao.tipo === "sem-base") {
    return (
      <p className="mt-1.5 text-[12px] text-fuligem-55">
        Sem base de comparação: {comparadoCom} não tiveram nenhum.
      </p>
    );
  }

  const seta = variacao.tipo === "sobe" ? "▲" : variacao.tipo === "desce" ? "▼" : "=";
  const palavra =
    variacao.tipo === "sobe" ? "acima de" : variacao.tipo === "desce" ? "abaixo de" : "igual a";

  return (
    <p className="mt-1.5 text-[12px] text-fuligem-55">
      <span aria-hidden="true">{seta}</span>{" "}
      <span data-dado>{Math.abs(variacao.percentual)}%</span> {palavra}{" "}
      {comparadoCom}
    </p>
  );
}
