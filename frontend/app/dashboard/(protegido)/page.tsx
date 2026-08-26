import type { Metadata } from "next";
import Link from "next/link";
import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { LEGADO, MENU } from "@/components/painel/casca/menu.logica";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";

/**
 * A raiz do painel novo — a PRIMEIRA rota de verdade do App Router aqui dentro.
 *
 * ATÉ ESTA ONDA, `/dashboard` era servido por um catch-all `[[...rota]]` que
 * montava o SPA legado. O catch-all desceu para `legado/`, e este arquivo tomou
 * o lugar dele: é ele quem responde por `/dashboard` agora.
 *
 * É UMA FILA DE TRABALHO, NÃO UMA VITRINE DE RECEITA — spec §4.1: "o lojista não
 * abre o painel para admirar receita, abre para saber o que embalar". O topo é
 * o que precisa ser feito HOJE; os KPIs e o gráfico de receita por dia vêm
 * abaixo, numa onda futura, e nunca acima.
 *
 * NESTA ONDA NÃO HÁ DADO NENHUM, E A TELA NÃO FINGE QUE HÁ. Não existe chamada
 * de API aqui — inventar uma que devolvesse zero seria o defeito exato que o
 * comentário do <EstadoDaTela> descreve: zero pedidos é um número perfeitamente
 * plausível, e o gestor leria "não tenho nada para despachar" quando o certo é
 * "ainda não perguntei". Então a fila renderiza a ESTRUTURA em estado de
 * carregando, com o traço no lugar de cada contagem, e a tela diz por escrito
 * que os números chegam depois.
 */
export const metadata: Metadata = {
  title: "Painel",
  // O painel não é conteúdo — é ferramenta de trabalho atrás de senha.
  // `app/robots.ts` já manda Disallow em /dashboard; isto é a segunda camada,
  // para o crawler que ignora o robots.txt mas respeita a meta tag. É a mesma
  // decisão da página do painel legado, e ela vale para toda rota deste grupo.
  robots: { index: false, follow: false },
};

/**
 * As cinco filas do §4.1, com a frase que define CADA UMA.
 *
 * A frase não é ajuda de tela: é a definição da contagem. "Pedidos a despachar"
 * sem dizer o que conta como despachável é um número que o gestor não consegue
 * conferir, e um número que não se confere é um número em que não se confia
 * (R29). Elas estão aqui, e não no componente, porque na onda dos dados viram o
 * texto do tooltip da métrica sem precisar ser reescritas.
 */
const FILA: { rotulo: string; definicao: string }[] = [
  {
    rotulo: "Pedidos a despachar",
    definicao: "pagos, ainda sem código de rastreio",
  },
  {
    rotulo: "Pagamento pendente",
    definicao: "aguardando a confirmação do Mercado Pago",
  },
  {
    rotulo: "Assinatura com cobrança falhada",
    definicao: "o Clube tentou faturar e não conseguiu",
  },
  {
    rotulo: "Avaliação a moderar",
    definicao: "escritas pelo cliente e ainda não publicadas",
  },
  {
    rotulo: "Estoque baixo",
    definicao: "abaixo do mínimo cadastrado no produto",
  },
];

/**
 * A fila desenhada sem os números.
 *
 * O TRAÇO É `data-dado`, ou seja, monoespaçado com numeral tabular (R23) — é a
 * mesma coluna em que a contagem vai cair, e por isso a linha não vai pular de
 * largura no dia em que ela chegar. Ele leva um `sr-only` ao lado porque um "—"
 * sozinho é lido como travessão, ou como nada, e o leitor de tela merece a
 * mesma informação que o olho recebe.
 */
function FilaEmEsqueleto() {
  return (
    <ul>
      {FILA.map((linha) => (
        <li
          key={linha.rotulo}
          className="flex min-h-11 items-center justify-between gap-4 border-b border-fuligem-20 py-2 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="font-medium">{linha.rotulo}</p>
            <p className="text-[12px] text-fuligem-55">{linha.definicao}</p>
          </div>
          <p className="shrink-0 text-fuligem-55">
            <span data-dado aria-hidden="true">
              —
            </span>
            <span className="sr-only">sem contagem nesta versão</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const LINK_EM_TEXTO = `underline underline-offset-4 decoration-1 hover:decoration-2 ${FOCO}`;

export default async function PaginaInicialDoPainel() {
  /**
   * A SEGUNDA LEITURA DA SESSÃO NESTA REQUISIÇÃO, e ela está registrada como
   * dívida em vez de escondida: o layout já chamou `exigirAdminNoPainel`, que
   * chama `lerAcessoDoPainel` por baixo, e aqui se pergunta de novo — desta vez
   * para saber o E-MAIL, que o guard não devolve porque ele só decide entra/não
   * entra.
   *
   * Não é incorreto (as duas leituras vêm da mesma função, então não podem
   * discordar), é caro: são duas idas ao GoTrue e duas ao PostgREST por página.
   * O conserto é embrulhar `lerAcessoDoPainel` com o `cache()` do React, e ele
   * mora em `lib/conta/painel-servidor.ts` — arquivo de segurança, fora do
   * escopo desta tarefa. Fica anotado aqui porque é aqui que a conta é paga, e
   * porque cada tela nova que mostrar o cabeçalho vai pagá-la de novo.
   */
  const acesso = await lerAcessoDoPainel();

  return (
    <>
      <Cabecalho
        titulo="Início"
        descricao="O que precisa ser feito hoje, antes de qualquer número."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6">
        {/*
          O AVISO É `aviso` E NÃO `alerta`, MUITO MENOS `erro`. Nada está
          quebrado: o painel novo está incompleto, o que é um fato de
          cronograma. Gastar a tarja vermelha — ou mesmo o ocre — num recado de
          roteiro é como se ensina o gestor a ignorar a faixa no dia em que ela
          disser que o pagamento falhou (R21).
        */}
        <Tarja tom="aviso">
          Este é o painel novo, na primeira das seis ondas: por enquanto só a
          tela de Início existe. O painel antigo continua inteiro em{" "}
          <Link href={LEGADO.href} className={LINK_EM_TEXTO}>
            {LEGADO.rotulo}
          </Link>
          , e é por lá que o trabalho do dia é feito até as telas novas
          chegarem.
        </Tarja>

        <Ficha titulo="O que precisa ser feito hoje">
          {/*
            `carregando` fixo em `true` NESTA ONDA, e é o estado honesto: não há
            requisição, então não há resposta — e a ordem das guardas do
            <EstadoDaTela> (carregando → erro → vazio → conteúdo) impede que a
            ausência de dado seja desenhada como "nada para fazer hoje".
            Na onda dos dados isto vira `carregando={!resposta}`, o `erro` deixa
            de ser `null` e o `children` recebe a fila de verdade — o esqueleto
            de cima continua sendo o mesmo, porque ele já tem a forma final.
          */}
          <EstadoDaTela
            carregando
            erro={null}
            vazio={false}
            esqueleto={<FilaEmEsqueleto />}
            vazioTitulo="Nada na fila"
            vazioTexto="Quando houver pedido a despachar, ele aparece aqui."
          >
            {null}
          </EstadoDaTela>

          <p className="mt-4 text-[12px] text-fuligem-55">
            As contagens ainda não estão ligadas ao banco. A estrutura da fila é
            esta; os números entram na onda dos dados, cada linha virando um
            link para a lista já filtrada.
          </p>
        </Ficha>

        <Ficha titulo="Áreas do painel">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {MENU.filter((grupo) => grupo.titulo).map((grupo) => (
              <div key={grupo.titulo}>
                <h3 className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                  {grupo.titulo}
                </h3>
                <ul className="mt-1">
                  {grupo.itens.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        /* `min-h-11` mesmo numa lista de texto: R22 manda
                           comprimir o padding da célula, nunca o alvo de
                           toque — e um link de lista É um alvo. */
                        className={`inline-flex min-h-11 items-center ${LINK_EM_TEXTO}`}
                      >
                        {item.rotulo}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-5 border-t border-fuligem-20 pt-4 text-[12px] text-fuligem-55">
            Os endereços já estão reservados, e cada onda acende uma tela. Um
            link que ainda não abre nada é uma tela que ainda não nasceu — não é
            uma falha do painel.
          </p>
        </Ficha>
      </div>
    </>
  );
}
