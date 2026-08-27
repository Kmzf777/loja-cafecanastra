import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { BuscaDaLista } from "@/components/painel/ui/BuscaDaLista";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { formatarCentavos } from "@/lib/painel/dinheiro";
import { totalDePaginas } from "@/lib/painel/paginacao";
import {
  POR_PAGINA,
  ROTA_DE_MARKETING,
  chipsDasCampanhas,
  custoDaPaginaEmCentavos,
  formularioAberto,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
  type RespostaDeCampanhas,
} from "@/lib/painel/marketing/campanhas.logica";

import { FormularioDeCampanha } from "./FormularioDeCampanha";
import { LacunasDeMarketing } from "./LacunasDeMarketing";
import { SubNavegacao } from "./SubNavegacao";
import { TabelaDeCampanhas } from "./TabelaDeCampanhas";

/**
 * `/dashboard/marketing` — Campanhas, e a porta da área de marketing.
 *
 * POR QUE CAMPANHAS É A TELA DE ENTRADA e não um índice com quatro cartões: das
 * quatro telas desta área, é a única que o gestor abre para FAZER alguma coisa
 * toda semana. Consentimento se consulta quando alguém reclama, envio se olha
 * quando algo falhou, e o público de WhatsApp se monta na véspera de uma
 * promoção. Um índice de cartões cobraria um clique a mais na única que se
 * visita sempre — e não mostraria nenhum dado.
 *
 * SERVER COMPONENT LENDO `searchParams`, como as outras listas do painel: busca,
 * filtros, página E o formulário aberto vivem na URL (R2). O JavaScript que vai
 * ao navegador é a caixa de busca, a tabela (por causa do interruptor) e o
 * formulário.
 *
 * O CUSTO DE MÍDIA É O CAMPO QUE JUSTIFICA A TELA. Sem ele o relatório soma
 * receita atribuída e chama de resultado — e "esta campanha trouxe R$ 4.200"
 * sem dizer que custou R$ 5.000 é pior do que não ter relatório, porque parece
 * uma resposta.
 */
export const metadata: Metadata = {
  title: "Marketing",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDeMarketing({
  searchParams,
}: {
  /** No Next 15 `searchParams` é uma Promise — ler sem `await` devolve um Proxy
   *  que falha só quando alguém tenta usar um parâmetro. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);
  const resposta = await lerDaApi<RespostaDeCampanhas>(montarConsulta(pedido));

  const dados = resposta.ok ? resposta.dados : null;
  const linhas = dados?.data ?? [];
  const total = dados?.total ?? 0;

  /* O BACKEND É QUEM MANDA NA PÁGINA EXIBIDA — mesma decisão da tela de
     Clientes. Usar `pedido.pagina` no rodapé enquanto a tabela mostra outra
     coisa faria a tela discordar de si mesma. */
  const estado = { ...pedido, pagina: dados?.page ?? pedido.pagina };
  const chips = chipsDasCampanhas(estado);
  const formulario = formularioAberto(estado, linhas);

  return (
    <>
      <Cabecalho
        titulo="Marketing"
        descricao="As campanhas que gastam, quem autorizou receber e o que já foi enviado."
        email={acesso.email}
        /*
          R18: UMA ação primária, sempre no mesmo lugar. É um <Link> e não um
          botão porque abrir o formulário é NAVEGAR — o endereço muda, o
          "voltar" fecha, e o F5 mantém aberto.
        */
        acao={
          <Link
            href={urlDaTela({ ...estado, editar: "novo" })}
            className={`inline-flex min-h-11 items-center justify-center rounded-bt bg-fuligem px-4 text-[11px] ${ETIQUETA} leading-none text-cal transition-colors hover:bg-fuligem-80 ${FOCO}`}
          >
            Nova campanha
          </Link>
        }
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <SubNavegacao ativa="campanhas" />

        {formulario.aberto && (
          <FormularioDeCampanha
            /*
              A CHAVE FORÇA UMA INSTÂNCIA NOVA por campanha editada. Sem ela, ir
              de uma campanha para outra pelo link da tabela reaproveitaria o
              componente e o `useState` inicial NÃO seria recalculado: o
              formulário mostraria os dados da campanha anterior sobre o nome da
              nova. É o modo de falha clássico de estado inicial derivado de
              prop, e ele grava dado errado sem erro nenhum.
            */
            key={formulario.campanha?.id ?? "novo"}
            campanha={formulario.campanha}
            estado={estado}
          />
        )}

        {/*
          O id na URL não achou linha nenhuma na página carregada. Não existe
          `GET /admin/campanhas/:id` no Express, então não há como buscá-la —
          e abrir um formulário vazio faria a pessoa CRIAR achando que edita.
        */}
        {formulario.perdida && (
          <Tarja tom="alerta">
            A campanha deste link não está nesta página da lista. Limpe os
            filtros ou procure pelo nome — o painel só consegue editar uma
            campanha que esteja na página carregada.
          </Tarja>
        )}

        {/* A BUSCA E OS CHIPS FICAM ACIMA DA FICHA — R1 quer a busca sempre
            visível, e "sempre" inclui quando a tabela sumiu num erro: é
            justamente aí que se precisa dela para tentar outra coisa. */}
        <BuscaDaLista
          base={ROTA_DE_MARKETING}
          buscaAtual={estado.busca}
          outrosParametros={{
            canal: estado.canal || undefined,
            ativa: estado.ativa || undefined,
          }}
          rotulo="Buscar campanha"
          placeholder="Nome ou UTM"
          ajuda="Procura em qualquer parte do nome e da UTM."
        />

        <FiltrosDeCampanha estado={estado} />
        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_MARKETING} />

        <EstadoDaTela
          /* SEMPRE `false` num Server Component: quando este JSX existe, o
             `await` já voltou. A prop continua sendo passada porque é a ORDEM
             DAS GUARDAS que impede o defeito, e trocá-la por três `if` convida
             a inverter. */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* ZERO É UM NÚMERO PLAUSÍVEL: `vazio` só é verdadeiro quando a leitura
             DEU CERTO. Uma loja pode não ter campanha nenhuma; o que ela não
             pode é ler "nenhuma campanha" por causa de uma API fora do ar. */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhuma campanha cadastrada"
          vazioTexto="Cadastre a primeira para saber quanto cada anúncio custou e o que ele trouxe."
        >
          <Ficha semPreenchimento>
            <TabelaDeCampanhas linhas={linhas} estado={estado} />

            {/*
              A SOMA É DA PÁGINA, E O TEXTO DIZ ISSO. O backend não devolve total
              de custo, e escrever "investimento do período" sobre a soma de 20
              linhas seria a mentira mais fácil desta tela. O nome da função que
              calcula (`custoDaPaginaEmCentavos`) carrega o mesmo aviso para quem
              for reusá-la.
            */}
            <p className="border-t border-fuligem-20 px-5 py-3 text-[13px] text-fuligem-55">
              Custo somado <strong>nesta página</strong>:{" "}
              <span data-dado className="text-fuligem">
                {formatarCentavos(custoDaPaginaEmCentavos(linhas))}
              </span>
            </p>

            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPages ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              href={(pagina) => urlDaTela({ ...estado, pagina, editar: "" })}
              rotuloDoItem={{ singular: "campanha", plural: "campanhas" }}
            />
          </Ficha>
        </EstadoDaTela>

        <ComoAAtribuicaoFunciona />
        <LacunasDeMarketing />
      </div>
    </>
  );
}

/**
 * Os dois filtros que não cabem na caixa de busca.
 *
 * SÃO LINKS, E NÃO UM `<select>` COM `onChange` — e por isso esta tela não paga
 * uma ilha de cliente por eles. Cada opção é um endereço; clicar navega; o
 * "voltar" desfaz; e o estado desativado sai de graça (o filtro aceso vira
 * texto, não link para si mesmo).
 */
function FiltrosDeCampanha({
  estado,
}: {
  estado: Parameters<typeof urlDaTela>[0] & { canal: string; ativa: string };
}) {
  const opcoes = [
    { rotulo: "Todas", ativo: estado.ativa === "", href: urlDaTela({ ...estado, ativa: "", editar: "", pagina: 1 }) },
    { rotulo: "Só ligadas", ativo: estado.ativa === "true", href: urlDaTela({ ...estado, ativa: "true", editar: "", pagina: 1 }) },
    { rotulo: "Só desligadas", ativo: estado.ativa === "false", href: urlDaTela({ ...estado, ativa: "false", editar: "", pagina: 1 }) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Mostrar</span>
      {opcoes.map((opcao) =>
        opcao.ativo ? (
          /* O filtro aceso NÃO é link para si mesmo — um controle que não sai do
             lugar é o mais frustrante que existe, e `aria-current` é o que diz
             "você está aqui" sem depender do fundo preto. */
          <span
            key={opcao.rotulo}
            aria-current="true"
            className={`inline-flex min-h-11 items-center rounded-bt bg-fuligem px-3 text-[11px] ${ETIQUETA} text-cal`}
          >
            {opcao.rotulo}
          </span>
        ) : (
          <Link
            key={opcao.rotulo}
            href={opcao.href}
            className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-fuligem hover:bg-cal hover:text-fuligem ${FOCO}`}
          >
            {opcao.rotulo}
          </Link>
        ),
      )}
    </div>
  );
}

/**
 * Como a atribuição funciona — e a ressalva que decide o que esta tela promete.
 *
 * R28: "latência declarada mata metade dos chamados". A ressalva aqui não é de
 * latência, é de EXISTÊNCIA: as colunas de UTM em `pedidos` nasceram na 0033,
 * mas a captura na vitrine é da Onda 6. Então pedido nenhum tem origem gravada
 * hoje, e um gráfico de resultado por campanha mostraria uma tabela vazia — que
 * se parece exatamente com queda de vendas.
 *
 * Dizer isto aqui, ao lado do campo de UTM que a pessoa acabou de preencher, é
 * o que impede a conclusão errada. E o texto diz que o cadastro NÃO é inútil: é
 * o que faz a atribuição funcionar quando a captura chegar.
 */
function ComoAAtribuicaoFunciona() {
  return (
    <Ficha titulo="Como a atribuição vai funcionar">
      <div className="max-w-[75ch] space-y-3 text-[13px] text-fuligem-55">
        <p>
          A UTM cadastrada aqui é a chave que liga uma venda a esta campanha: o
          link do anúncio carrega <code>utm_campaign</code>, o pedido guarda o
          valor, e o relatório junta os dois pelo nome.
        </p>
        <p>
          <strong className="text-fuligem">
            Hoje nenhum pedido tem origem gravada.
          </strong>{" "}
          As colunas de UTM existem em <code>pedidos</code> desde a migração
          0033, mas a captura na loja ainda não foi construída — é trabalho da
          onda seguinte. Até lá, um relatório de resultado por campanha mostraria
          uma tabela vazia, que se parece com queda de vendas; por isso ele não
          é desenhado.
        </p>
        <p>
          Cadastrar a campanha agora não é trabalho perdido:{" "}
          <strong className="text-fuligem">o custo de mídia só existe aqui</strong>{" "}
          — nenhum sistema o reconstrói depois — e a UTM já fica pronta para o dia
          em que a captura entrar.
        </p>
        <p>
          A junção é <strong className="text-fuligem">só por campanha</strong>.{" "}
          <code>canastra.campanhas</code> tem <code>utm_campaign</code> e não tem
          par para <code>utm_source</code> nem <code>utm_medium</code>, então
          «Google pago» e «Google orgânico» não serão separáveis mesmo depois da
          captura.
        </p>
      </div>
    </Ficha>
  );
}
