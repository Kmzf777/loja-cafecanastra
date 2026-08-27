import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { BuscaDaLista } from "@/components/painel/ui/BuscaDaLista";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { totalDePaginas } from "@/lib/painel/paginacao";
import {
  POR_PAGINA,
  RESSALVA_DA_EXPORTACAO,
  ROTA_DE_PEDIDOS,
  aplicarFiltroDePagina,
  chipsDosPedidos,
  estadoCorrigido,
  lerEstado,
  montarConsulta,
  resumoDaPaginaFiltrada,
  temFiltro,
  type RespostaDePedidos,
} from "@/lib/painel/pedidos/pedidos.logica";

import { AbasSalvas } from "./AbasSalvas";
import { ExportarPedidos } from "./ExportarPedidos";
import { FiltroDePeriodo } from "./FiltroDePeriodo";
import { ListaDePedidos } from "./ListaDePedidos";

/**
 * `/dashboard/pedidos` — a fila de trabalho da loja, e a maior tela do painel.
 *
 * O QUE ELA SUBSTITUI. `Orders.jsx`, 1.056 linhas, com a regra de negócio
 * espalhada dentro do componente: os nove status copiados à mão (a terceira
 * cópia divergente do repositório), a formatação de endereço, a leitura de
 * itens que às vezes é array e às vezes é string, o nome do arquivo do CSV. E,
 * mais grave, um `<select onChange>` por LINHA da tabela — um clique torto,
 * sem ver de quem era o pedido, movimentava estoque e disparava e-mail.
 *
 * SERVER COMPONENT LENDO `searchParams`, e é daí que o R2 sai de graça: busca,
 * status, período, recorte de NF-e e página vivem na URL. Voltar do detalhe
 * devolve a MESMA lista, o F5 não perde nada, e as abas salvas do R4 são
 * simplesmente links.
 *
 * TRÊS ILHAS DE CLIENTE, e nenhuma a mais: a busca (`BuscaDaLista`), o período
 * (`FiltroDePeriodo`) e a lista (`ListaDePedidos`, que carrega o painel lateral
 * do R26, a seleção em massa do R25 e a mescla da resposta do Bling). Os chips,
 * as abas e o cabeçalho são HTML do servidor.
 */
export const metadata: Metadata = {
  title: "Pedidos",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

/** O que `GET /bling/status` devolve. Só `ativo` interessa a esta tela — o
 *  resto (nfeAuto, rastreioCron, a sonda do token) é assunto da tela de
 *  Ajustes, que ainda não existe. */
type StatusDoBling = { ativo?: boolean };

export default async function PaginaDePedidos({
  searchParams,
}: {
  /** No Next 15 `searchParams` é uma Promise — ler sem `await` devolve um Proxy
   *  que falha só quando alguém tenta usar um parâmetro. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    /* A segunda leitura da sessão nesta requisição — a mesma dívida que
       `(protegido)/page.tsx` já registrou: o layout chamou
       `exigirAdminNoPainel`, e aqui se pergunta de novo só para saber o E-MAIL
       do cabeçalho. O conserto é embrulhar `lerAcessoDoPainel` com o `cache()`
       do React; é arquivo de segurança, fora do escopo desta tarefa. */
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);

  /*
    AS DUAS LEITURAS VÃO JUNTAS. A sonda do Bling é uma pergunta independente da
    listagem, e encadeá-las somaria os dois tempos de espera na cara do gestor.

    A SONDA RESPONDE SEMPRE, ligada ou não — é o endpoint que DIAGNOSTICA o
    desligado. Por isso um erro aqui não significa "Bling desligado": significa
    que o servidor da loja não respondeu, e nesse caso `blingLigado` fica `null`
    e NADA é desabilitado. O servidor continua sendo a autoridade — ele recusa
    com 503 e uma frase que diz qual variável ligar. (Em produção, onde a API
    pode estar atrás do repositório, `/bling` pode nem existir: 404 cai no mesmo
    `null`, e a tela segue funcionando sem o bloco prometer nada.)
  */
  const [resposta, sonda] = await Promise.all([
    lerDaApi<RespostaDePedidos>(montarConsulta(pedido)),
    lerDaApi<StatusDoBling>("/bling/status"),
  ]);
  const blingLigado = sonda.ok ? Boolean(sonda.dados?.ativo) : null;

  /*
    O BACKEND É QUEM MANDA NA PÁGINA EXIBIDA. Ele já prende `page` dentro do que
    existe, e usar o `pedido.pagina` no rodapé enquanto a tabela mostra outra
    coisa faria a tela discordar de si mesma. Quando a leitura falhou não há
    resposta nenhuma, e aí o estado corrigido é o pedido saneado — que é só o
    que se sabe.
  */
  const dados = resposta.ok ? resposta.dados : null;
  const total = dados?.total ?? 0;
  const estado = dados
    ? { ...pedido, pagina: dados.page ?? pedido.pagina }
    : estadoCorrigido(pedido, total);

  const daPagina = dados?.data ?? [];
  /* O recorte de NF-e acontece AQUI, sobre a página — não há filtro fiscal em
     `/admin/orders`. A frase logo abaixo da lista confessa isso com número. */
  const linhas = aplicarFiltroDePagina(daPagina, estado);
  const recortouAPagina = linhas.length !== daPagina.length || estado.nfe === "pendente";

  const chips = chipsDosPedidos(estado);
  const totalPaginas = dados?.totalPages ?? totalDePaginas(total, POR_PAGINA);

  /** O que a busca e o período precisam preservar ao navegar. A PÁGINA fica de
   *  fora de propósito: buscar estando na página 4 e continuar na 4 é o jeito
   *  mais rápido de uma busca com resultados parecer vazia. */
  const outrosParametros = {
    status: estado.status.length ? estado.status.join(",") : undefined,
    de: estado.de || undefined,
    ate: estado.ate || undefined,
    nfe: estado.nfe || undefined,
  };

  return (
    <>
      <Cabecalho
        titulo="Pedidos"
        descricao="A fila de trabalho da loja: o que foi pago, o que sai hoje e o que ainda não virou nota."
        email={acesso.email}
        /* R18 — a ação primária da tela mora sempre no mesmo canto. O período
           que ela exporta é o MESMO que está filtrando a lista. */
        acao={<ExportarPedidos de={estado.de} ate={estado.ate} />}
      />

      <div className="mx-auto max-w-[1500px] space-y-4 px-5 py-6">
        {/* R4 — as abas salvas antes de tudo: são elas que definem em que fila
            o gestor está trabalhando, e as outras ferramentas refinam dentro
            dela. */}
        <AbasSalvas estado={estado} />

        {/*
          A BUSCA E O PERÍODO FICAM ACIMA DA FICHA, sobre a cal — R1 quer a
          busca sempre visível, e "sempre visível" inclui quando a tabela está
          vazia ou quando a leitura falhou. Dentro da <Ficha> eles sumiriam
          junto com a tabela no estado de erro do <EstadoDaTela>, e o gestor
          ficaria sem os controles de que precisa justamente para tentar outra
          coisa.
        */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <BuscaDaLista
            base={ROTA_DE_PEDIDOS}
            buscaAtual={estado.busca}
            outrosParametros={outrosParametros}
            rotulo="Buscar pedido"
            placeholder="Número, nome, e-mail ou CPF"
            /* A AJUDA DIZ O QUE O NÚMERO É, e ela existe porque a tela mostra
               `#3F9A2C11` — que é o número do e-mail do cliente, não um
               sequencial. Sem a frase, quem cola o número com o "#" acha que o
               pedido não existe. */
            ajuda="O número é o que aparece no e-mail do cliente; pode colar com # ou sem."
          />
          <FiltroDePeriodo estado={estado} />
        </div>

        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_PEDIDOS} />

        <EstadoDaTela
          /* SEMPRE `false` NUM SERVER COMPONENT: quando este JSX existe, o
             `await` já voltou. A prop continua sendo passada porque é a ORDEM
             DAS GUARDAS (carregando → erro → vazio → conteúdo) que impede o
             defeito que este componente existe para impedir. */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* ZERO É UM NÚMERO PLAUSÍVEL, e por isso `vazio` só é verdadeiro
             quando a leitura DEU CERTO. Uma loja pode não ter vendido hoje; o
             que ela não pode é ler "nenhum pedido" por causa de uma API fora do
             ar — que é exatamente o que a tela legada fazia. */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhum pedido ainda"
          vazioTexto="Quando alguém comprar na loja, o pedido aparece aqui."
        >
          <ListaDePedidos
            linhas={linhas}
            estado={estado}
            totalDoFiltro={total}
            totalPaginas={totalPaginas}
            blingLigado={blingLigado}
          />
        </EstadoDaTela>

        {/*
          A CONFISSÃO DO RECORTE EM MEMÓRIA — com número, como a fila do Bling
          legada já fazia.

          Quando o recorte de NF-e está ligado, o rodapé da paginação continua
          contando o que o SERVIDOR filtrou, e a tabela mostra menos. Duas
          contagens que discordam sem explicação fazem desconfiar das duas; com
          a frase, a diferença deixa de ser um defeito e passa a ser um limite
          conhecido.
        */}
        {resposta.ok && recortouAPagina && (
          <p className="text-[12px] text-fuligem-55">
            <span data-dado>
              {resumoDaPaginaFiltrada(
                linhas.length,
                daPagina.length,
                estado.pagina,
                totalPaginas,
                total,
              )}
            </span>
            . O servidor ainda não filtra por estado da NF-e, então este recorte
            olha só a página carregada — vire a página para ver o resto.
          </p>
        )}

        <p className="max-w-[80ch] text-[12px] text-fuligem-55">
          A busca olha nome, e-mail, CPF e número do pedido, em qualquer parte do
          texto. {RESSALVA_DA_EXPORTACAO}
        </p>
      </div>
    </>
  );
}
