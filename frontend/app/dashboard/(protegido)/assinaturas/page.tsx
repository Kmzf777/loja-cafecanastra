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
import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  POR_PAGINA,
  ROTA_DE_ASSINATURAS,
  STATUS_DE_ASSINATURA,
  aplicar,
  chipsDasAssinaturas,
  lerEstado,
  temFiltro,
  urlDaTela,
  type Assinatura,
} from "@/lib/painel/assinaturas/assinaturas.logica";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";

import { TabelaDeAssinaturas } from "./TabelaDeAssinaturas";

/**
 * `/dashboard/assinaturas` — o Clube, e o que o painel NÃO consegue fazer com
 * ele.
 *
 * ESTA TELA É SÓ LEITURA, E ELA DIZ ISSO EM VOZ ALTA — em três lugares, porque
 * é a informação mais importante que ela carrega:
 *
 *   · na descrição do cabeçalho, onde o botão de ação estaria (R18);
 *   · numa <Tarja>, sobre o que "ativa" não quer dizer;
 *   · numa ficha ao pé, listando o que existe e o que não existe.
 *
 * POR QUE NÃO HÁ BOTÃO DE CANCELAR. `POST /clube/assinaturas/:id/cancelar`
 * filtra por `user_id = req.user.userId` e responde **404** — não 403 — para
 * quem não é o dono, inclusive para o administrador (a escolha do 404 é
 * deliberada no backend: um 403 confirmaria a existência do id). Não existe
 * nenhuma outra rota administrativa de escrita para assinatura. Desenhar o
 * botão daria um controle que responde "Assinatura não encontrada" para uma
 * assinatura que está na tela — o pior diagnóstico possível, porque manda quem
 * investiga procurar um bug de dados que não existe.
 *
 * A REGRA GERAL, que vale para as telas das próximas ondas: **não se desenha
 * botão que não tem backend.** Um controle inerte custa mais que a ausência do
 * controle — ele consome a confiança em todos os outros.
 */
export const metadata: Metadata = {
  title: "Assinaturas do Clube",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};


/**
 * As abas de status — as "abas salvas" do R2, cada uma um `<a href>` de
 * verdade.
 *
 * A CONTAGEM AO LADO DE CADA UMA é o que o R3 pede ("filtro vira chip
 * removível, COM CONTAGEM"), e ela é contada depois da busca e antes do status
 * (ver `contarPorStatus`): "Ativas (3)" significa "3 dos resultados da SUA
 * busca estão ativas". Sem a contagem, o gestor clica em quatro abas para
 * descobrir onde estão as coisas.
 *
 * TODAS AS ABAS APARECEM, MESMO EM ZERO. Uma aba que some quando está vazia faz
 * a barra mudar de tamanho a cada busca, e o alvo dança debaixo do ponteiro.
 */
function AbasDeStatus({
  atual,
  contagem,
  busca,
}: {
  atual: string;
  contagem: Record<string, number>;
  busca: string;
}) {
  const abas = [
    { valor: "", rotulo: "Todas" },
    ...STATUS_DE_ASSINATURA.map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
  ];

  return (
    <nav aria-label="Filtrar por status" className="flex flex-wrap items-center gap-2">
      {abas.map((aba) => {
        const ativa = aba.valor === atual;
        return (
          <Link
            key={aba.valor || "todas"}
            // Trocar de aba SEMPRE volta para a página 1 (`urlDaTela` sem
            // `pagina`): estar na página 4 de "Todas" e cair na página 4 de
            // "Pausadas" — que tem uma — mostraria uma lista vazia.
            href={urlDaTela({ busca, status: aba.valor })}
            /* `aria-current="page"` e não uma classe só: quem não enxerga
               precisa saber qual filtro está ligado, e cor não é canal. */
            aria-current={ativa ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-bt border px-3 text-[11px] ${ETIQUETA} transition-colors ${FOCO} ${
              ativa
                ? // Preenchido, o mesmo peso do botão primário: numa fileira de
                  // rótulos iguais, o "onde estou" ganha por PESO, não por
                  // matiz (spec §2.5 — cor escassa).
                  "border-fuligem bg-fuligem text-cal"
                : "border-fuligem-20 hover:border-fuligem hover:bg-cal"
            }`}
          >
            {aba.rotulo}
            <span data-dado className={ativa ? "" : "text-fuligem-55"}>
              {contagem[aba.valor] ?? 0}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export default async function PaginaDeAssinaturas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    /* A segunda leitura da sessão nesta requisição — dívida registrada em
       `(protegido)/page.tsx`, e paga por toda tela que mostra o cabeçalho. */
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const estado = lerEstado(parametros);

  /*
    A ROTA DEVOLVE UM ARRAY CRU, sem envelope: `ClubeController.listarTodas` faz
    `res.json(rows)`. Não há `total`, não há `page`, não há parâmetro de filtro
    — é por isso que o filtro e a paginação desta tela acontecem no módulo puro,
    e é a única tela do painel em que isso é aceitável (ver o cabeçalho de
    `assinaturas.logica.ts`).
  */
  const resposta = await lerDaApi<Assinatura[]>("/admin/assinaturas");
  const lista = resposta.ok && Array.isArray(resposta.dados) ? resposta.dados : [];
  const { pagina, contagem } = aplicar(lista, estado);
  const chips = chipsDasAssinaturas(estado);

  return (
    <>
      <Cabecalho
        titulo="Assinaturas do Clube"
        /*
          A DESCRIÇÃO CARREGA O LIMITE DA TELA, e ela está aqui em vez de num
          botão porque é exatamente aqui que o gestor procuraria o botão (R18:
          "uma ação primária por página, sempre no mesmo lugar"). Quando não há
          ação, o lugar dela é onde se explica por quê.
        */
        descricao="Só leitura: o painel não cria, não pausa e não cancela assinatura."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1400px] space-y-4 px-5 py-6">
        {/*
          A TARJA MAIS IMPORTANTE DESTA TELA, e ela é `alerta` e não `aviso`
          porque o que está em jogo é o gestor tomar uma decisão errada com o
          dado certo: "ativa" é um status verdadeiro no banco e falso no mundo.

          Não é `erro` (vermelho) porque nada está quebrado — é assim que o
          sistema foi construído, e gastar o vermelho aqui, numa faixa que fica
          permanentemente na tela, é como se ensina a ignorar o vermelho de
          verdade (R21).

          O FATO, de `docs/pesquisa/2026-08-26-riscos-da-reescrita.md`: quem
          cobra é o Mercado Pago sozinho, por débito automático; a loja não tem
          cron de cobrança. Cobrança que falha vira um pedido `rejeitado`, o
          admin recebe o e-mail rotineiro de "Novo Pedido Recebido", o cliente
          recebe um "Problema no pedido #xxxx" que nem menciona assinatura, e o
          status da assinatura continua `ativa`. Não existe contador de falhas
          nem tabela de eventos — não há o que consultar.
        */}
        <Tarja tom="alerta">
          <strong className="font-semibold">
            &ldquo;Ativa&rdquo; não quer dizer &ldquo;em dia&rdquo;.
          </strong>{" "}
          Quando uma cobrança do Clube falha, nada acontece com a assinatura:
          nasce um pedido <em>rejeitado</em>, o cliente recebe um aviso genérico
          que nem menciona o Clube, e o status continua &ldquo;ativa&rdquo;
          indefinidamente. Não há contador de falhas, histórico de tentativas nem
          data da próxima cobrança em lugar nenhum do sistema. Para saber se
          alguém está pagando, olhe os pedidos dessa pessoa.
        </Tarja>

        {/*
          Busca e filtros ACIMA da ficha, sobre a cal: eles precisam continuar na
          tela quando a tabela não está — no erro e no vazio —, e é justamente
          aí que o gestor precisa deles para tentar outra coisa.
        */}
        <BuscaDaLista
          base={ROTA_DE_ASSINATURAS}
          buscaAtual={estado.busca}
          /* O status sobrevive à busca; a PÁGINA não — buscar estando na página
             4 e continuar na 4 é o jeito mais rápido de uma busca com
             resultados parecer vazia. */
          outrosParametros={{ status: estado.status || undefined }}
          rotulo="Buscar assinatura"
          placeholder="Cliente, e-mail, café ou SKU"
        />

        <AbasDeStatus atual={estado.status} contagem={contagem} busca={estado.busca} />

        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_ASSINATURAS} />

        <EstadoDaTela
          /* Sempre `false` num Server Component: quando este JSX existe, o
             `await` já voltou. A prop continua sendo passada porque é a ORDEM
             das guardas (carregando → erro → vazio → conteúdo) que impede o
             defeito que o componente existe para impedir. */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* Zero assinaturas é um número plausível — o Clube pode não ter
             vendido nada ainda. O que ele não pode é ser lido como zero por
             causa de uma API fora do ar, e por isso `resposta.ok` entra na
             conta. */
          vazio={resposta.ok && pagina.total === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhuma assinatura no Clube"
          vazioTexto="A assinatura nasce na loja, pelo assistente de adesão — o painel não cria nenhuma."
        >
          <Ficha semPreenchimento>
            {/* A tabela mora num arquivo `"use client"` porque `Coluna.celula`
                é uma FUNÇÃO, e função não atravessa a fronteira Server→Client.
                O porquê inteiro está em `TabelaDeClientes.tsx`. */}
            <TabelaDeAssinaturas linhas={pagina.itens} />
            <Paginacao
              pagina={pagina.pagina}
              totalPaginas={pagina.totalPaginas}
              porPagina={POR_PAGINA}
              total={pagina.total}
              href={(numero) => urlDaTela({ ...estado, pagina: numero })}
              rotuloDoItem={{ singular: "assinatura", plural: "assinaturas" }}
            />
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE DÁ E O QUE NÃO DÁ PARA FAZER — escrito, e não deduzido da
          ausência de botões.

          Uma tela sem botão nenhum é ambígua: pode ser uma tela de leitura, ou
          pode ser uma tela quebrada. A diferença entre as duas leituras é um
          chamado de suporte, e ela custa quatro parágrafos.

          É um <dl> e não uma lista de parágrafos porque a estrutura É
          termo/definição — e um leitor de tela anuncia "lista de descrição, 4
          itens", o que dá a quem não vê a mesma varredura visual que a tabela
          dá a quem vê.
        */}
        <Ficha titulo="O que dá para fazer por aqui">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                Consultar
              </dt>
              <dd className="mt-1 text-[13px]">
                Quem assina, qual café, de quantos em quantos dias e por quanto.
                A adesão nasce na loja, pelo assistente de três passos — o painel
                não cria assinatura.
              </dd>
            </div>

            <div>
              <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                Cancelar
              </dt>
              <dd className="mt-1 text-[13px]">
                Não por aqui. O cancelamento existe só para o DONO da assinatura,
                na conta dele, e a rota responde &ldquo;não encontrada&rdquo;
                para o administrador. Não há rota administrativa de escrita — um
                botão nesta tela não funcionaria.
              </dd>
            </div>

            <div>
              <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                Pausar, trocar o café ou o valor
              </dt>
              <dd className="mt-1 text-[13px]">
                Não existe. Quem quiser mudar cancela e assina de novo; quem
                pausa é o Mercado Pago, por conta dele.
              </dd>
            </div>

            <div>
              <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Cobrar</dt>
              <dd className="mt-1 text-[13px]">
                Quem cobra é o Mercado Pago, por débito automático de valor fixo.
                A loja não tem rotina de cobrança, e cada cobrança que dá certo
                vira um pedido normal na tela de Pedidos.
              </dd>
            </div>
          </dl>
        </Ficha>
      </div>
    </>
  );
}
