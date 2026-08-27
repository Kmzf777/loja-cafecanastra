import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { BuscaDaLista } from "@/components/painel/ui/BuscaDaLista";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  POR_PAGINA,
  ROTA_DE_AVALIACOES,
  STATUS_DE_AVALIACAO,
  chipsDasAvaliacoes,
  consultaDePendentes,
  estadoCorrigido,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
  urlDoStatus,
  type RespostaDeAvaliacoes,
} from "@/lib/painel/avaliacoes/avaliacoes.logica";
import { totalDePaginas } from "@/lib/painel/paginacao";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";

import { ListaDeAvaliacoes } from "./ListaDeAvaliacoes";

/**
 * `/dashboard/avaliacoes` — a fila de moderação.
 *
 * O QUE ELA CONSERTA, E É O DEFEITO MAIS SILENCIOSO DO PAINEL INTEIRO. A tela
 * legada (`AvaliacoesManager.jsx`) era a ÚNICA que não falava com o Express:
 * ia direto ao PostgREST e dependia de RLS + GRANT de coluna. Lá, um não-admin
 * executa o `UPDATE` e atualiza ZERO LINHAS SEM ERRO NENHUM — é a semântica do
 * `USING` de uma política de RLS, que RECORTA o conjunto em vez de recusar a
 * operação. O toast anunciava sucesso e o banco ficava intacto.
 *
 * Agora é `GET /admin/avaliacoes` e `PATCH /admin/avaliacoes`, com
 * `isAuthenticated` + `isAdmin` na frente e um `{pedidas, atualizadas}` na
 * resposta. **A tela mostra `atualizadas`.** Um modelo de acesso só — e o
 * painel deixa de carregar dois clientes (supabase-js e o fetch ao Express)
 * para fazer a mesma coisa por caminhos com garantias diferentes.
 *
 * SERVER COMPONENT LENDO `searchParams`, e é daí que o R2 sai de graça: busca,
 * status, SKU e página vivem na URL, então voltar de outra tela devolve a MESMA
 * fila, o F5 não perde nada e o link colado abre exatamente o que se estava
 * vendo. O JavaScript da tela é a caixa de busca e a ilha de moderação.
 *
 * NÃO HÁ AÇÃO NO <Cabecalho>, e a ausência é deliberada. R18 quer uma ação
 * primária por página, sempre no mesmo lugar; aqui a ação PRIMÁRIA depende do
 * que está marcado na tabela, e um botão no cabeçalho que só faz sentido depois
 * de rolar até a linha certa é um botão fora do lugar. Ela mora na barra de
 * seleção, colada ao que ela opera.
 */
export const metadata: Metadata = {
  title: "Avaliações",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

/** A aba de status — um `<a href>`, não um botão: é navegação, e por isso
 *  funciona com o meio do mouse, com o Voltar e com o link colado. */
function Aba({
  href,
  ativa,
  children,
}: {
  href: string;
  ativa: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      /* `aria-current="page"` e não só a cor: quem navega por leitor de tela
         não recebe "está sublinhado" — recebe "página atual". */
      aria-current={ativa ? "page" : undefined}
      className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[11px] ${ETIQUETA} transition-colors ${FOCO} ${
        ativa
          ? "border-fuligem text-fuligem"
          : "border-transparent text-fuligem-55 hover:border-fuligem-20 hover:text-fuligem"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function PaginaDeAvaliacoes({
  searchParams,
}: {
  /** No Next 15 `searchParams` é uma Promise — ler sem `await` devolve um
   *  Proxy que falha só quando alguém tenta usar um parâmetro. */
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
    AS DUAS LEITURAS SAEM JUNTAS. A segunda é o CONTADOR DE PENDENTES, e ele
    precisa de ida própria porque tem de sobreviver ao filtro: com a fila em
    "Aprovadas", derivá-lo da página exibida daria zero, e "0 pendentes" é
    exatamente a frase que faz o gestor fechar o painel achando que acabou.

    `Promise.all` e não sequencial: são duas leituras independentes, e
    encadeá-las somaria a latência de uma à da outra em toda visita.
  */
  const [resposta, pendentes] = await Promise.all([
    lerDaApi<RespostaDeAvaliacoes>(montarConsulta(pedido)),
    lerDaApi<RespostaDeAvaliacoes>(consultaDePendentes()),
  ]);

  /*
    O BACKEND É QUEM MANDA NA PÁGINA EXIBIDA — ele devolve `page` junto. Usar o
    `pedido.pagina` no rodapé enquanto a tabela mostra outra coisa faria a tela
    discordar de si mesma. Quando a leitura falhou não há resposta nenhuma, e aí
    o estado corrigido é o pedido saneado, que é só o que se sabe.
  */
  const dados = resposta.ok ? resposta.dados : null;
  const total = dados?.total ?? 0;
  const estado = dados
    ? { ...pedido, pagina: dados.page ?? pedido.pagina }
    : estadoCorrigido(pedido, total);

  const linhas = dados?.data ?? [];
  const chips = chipsDasAvaliacoes(estado);

  /*
    O CONTADOR SÓ APARECE QUANDO FOI MEDIDO. Se a ida do contador falhou,
    `null` — e a tela não desenha "0 pendentes", que é indistinguível de "a fila
    acabou". É a mesma regra do `<EstadoDaTela>`: zero é um número plausível, e
    por isso ele nunca pode ser o valor de "não consegui perguntar".
  */
  const totalPendentes = pendentes.ok ? pendentes.dados.total : null;

  return (
    <>
      <Cabecalho
        titulo="Avaliações"
        descricao="O que os clientes escreveram sobre os cafés, e o que já está na loja."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        {/*
          A BUSCA E OS CHIPS FICAM ACIMA DA FICHA, sobre a cal — R1 quer a busca
          sempre visível, e "sempre visível" inclui quando a fila está vazia ou
          quando a leitura falhou. Dentro da <Ficha> ela sumiria junto com a
          tabela no estado de erro do <EstadoDaTela>, e o gestor ficaria sem o
          controle de que precisa justamente para tentar outra coisa.
        */}
        <BuscaDaLista
          base={ROTA_DE_AVALIACOES}
          buscaAtual={estado.busca}
          /* Os outros filtros VIAJAM JUNTO com a busca. Sem isto, buscar dentro
             de "Pendentes" jogaria o gestor de volta para "Todas" — o filtro
             sumindo por causa de um gesto que não é sobre ele. */
          outrosParametros={{
            status: estado.status || undefined,
            sku: estado.sku || undefined,
          }}
          rotulo="Buscar avaliação"
          placeholder="Texto, título ou nome de quem escreveu"
          ajuda="Procura em qualquer parte do texto."
        />

        {/*
          AS ABAS DE STATUS — R4, e cada uma é uma aba salva de verdade (uma URL
          própria, que se pode favoritar e colar). Trocar de aba ZERA a página:
          página 4 de "Pendentes" indo para "Aprovadas" que cabem em duas seria
          "nenhum resultado" logo depois de trocar o filtro, e a leitura natural
          disso é "não tem nenhuma aprovada".
        */}
        <nav
          aria-label="Filtrar por status"
          className="flex flex-wrap items-center gap-1 border-b border-fuligem-20"
        >
          <Aba href={urlDoStatus(estado, "")} ativa={estado.status === ""}>
            Todas
          </Aba>
          {STATUS_DE_AVALIACAO.map((s) => (
            <Aba
              key={s.valor}
              href={urlDoStatus(estado, s.valor)}
              ativa={estado.status === s.valor}
            >
              {s.rotulo}
              {/*
                A CONTAGEM DE PENDENTES FICA VISÍVEL EM TODAS AS ABAS — é o
                número que responde "ainda tem fila?", e ele não pode desaparecer
                porque se foi olhar as aprovadas. `data-dado` como todo número do
                painel (R23): monoespaçada, numeral tabular.
              */}
              {s.valor === "pendente" && totalPendentes !== null && (
                <span data-dado className="ml-2 text-fuligem-55">
                  {totalPendentes}
                </span>
              )}
            </Aba>
          ))}
        </nav>

        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_AVALIACOES} />

        <EstadoDaTela
          /*
            SEMPRE `false` NUM SERVER COMPONENT, e está escrito porque parece
            omissão: quando este JSX existe, o `await` já voltou. A prop
            continua sendo passada, em vez de o componente virar três `if`,
            porque é a ORDEM DAS GUARDAS (carregando → erro → vazio → conteúdo)
            que impede o defeito que ele existe para impedir.
          */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /*
            ZERO É UM NÚMERO PLAUSÍVEL, e por isso `vazio` só é verdadeiro
            quando a leitura DEU CERTO. Uma loja pode não ter avaliação nenhuma;
            o que ela não pode é ler "nenhuma avaliação" por causa de uma API
            fora do ar — que é o defeito mais caro do painel legado.
          */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhuma avaliação ainda"
          vazioTexto="Quando um cliente avaliar um café na loja, ela cai aqui para ser moderada."
        >
          <Ficha semPreenchimento>
            {/* A lista mora num arquivo `"use client"` porque `Coluna.celula` é
                uma FUNÇÃO, e função não atravessa a fronteira Server→Client. O
                porquê inteiro está em `ListaDeAvaliacoes.tsx`. */}
            <ListaDeAvaliacoes linhas={linhas} totalDoFiltro={total} />
            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPages ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              /* A URL de cada página carrega os FILTROS junto — é o que impede
                 o filtro de sumir ao virar a página, que é o R3 pelo avesso. */
              href={(pagina) => urlDaTela({ ...estado, pagina })}
              rotuloDoItem={{ singular: "avaliação", plural: "avaliações" }}
            />
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE ESTA TELA NÃO FAZ, POR ESCRITO — a mesma doutrina da tela de
          Assinaturas.

          Não há DELETE aqui de propósito: apagar avaliação é privilégio de
          `service_role`, e "Ocultar" é o despublicar sem apagar. Dizê-lo evita a
          busca por um botão que não existe, que é indistinguível de a tela estar
          quebrada.
        */}
        <p className="max-w-[70ch] text-[12px] text-fuligem-55">
          Esta tela não apaga avaliação. A exclusão só acontece quando o cliente
          apaga a conta dele — e aí a avaliação sai junto, pela LGPD.
        </p>
      </div>
    </>
  );
}
