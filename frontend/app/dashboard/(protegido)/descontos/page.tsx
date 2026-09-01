import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { BuscaDaLista } from "@/components/painel/ui/BuscaDaLista";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { totalDePaginas } from "@/lib/painel/paginacao";
import {
  ROTA_DE_DESCONTOS,
  type RespostaDeDescontos,
} from "@/lib/painel/descontos/contrato";
import {
  POR_PAGINA,
  abasDosDescontos,
  chipsDosDescontos,
  estadoCorrigido,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
} from "@/lib/painel/descontos/lista.logica";

import { TabelaDeDescontos } from "./TabelaDeDescontos";

/**
 * `/dashboard/descontos` — a lista única de regras.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA LISTA, E NÃO DUAS. Até a Onda 3, desconto vivia em duas estruturas que
 * nunca se falavam: `canastra.promocoes` era desconto de vitrine e
 * `canastra.cupons` era desconto de checkout, com regras diferentes e uma
 * armadilha de cada lado. A migração 0032 as uniu numa entidade com um campo
 * `metodo` — `automatico` aplica sozinho no carrinho, `codigo` exige o cliente
 * digitar. Mesma regra, porta de entrada diferente. Unificar dá uma tela, uma
 * ordem de aplicação e um relatório.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SERVER COMPONENT LENDO `searchParams` — e daí sai R2 de graça: busca, filtro
 * e página vivem na URL, então voltar da ficha devolve a MESMA lista, o F5 não
 * perde nada, e o link colado abre exatamente o que se estava vendo. O único
 * JavaScript desta tela são a caixa de busca e a tabela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O RELÓGIO É MEDIDO UMA VEZ, AQUI, e desce como número.
 *
 * A situação de cada linha é derivada das datas (nunca uma coluna gravada), e a
 * derivação precisa de um instante. Medi-lo dentro da célula daria um instante
 * por linha e um resultado que muda entre o HTML do servidor e a hidratação —
 * para uma regra que vence no meio do render, a linha piscaria de "vigente"
 * para "expirada" sem que ninguém entendesse por quê.
 */
export const metadata: Metadata = {
  title: "Descontos",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDeDescontos({
  searchParams,
}: {
  /** No Next 15 `searchParams` é uma Promise — ler sem `await` devolve um
   *  Proxy que falha só quando alguém tenta usar um parâmetro. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);
  const resposta = await lerDaApi<RespostaDeDescontos>(montarConsulta(pedido));

  /* O BACKEND É QUEM MANDA NA PÁGINA EXIBIDA. Usar `pedido.pagina` no rodapé
     enquanto a tabela mostra outra faria a tela discordar de si mesma. Quando a
     leitura falhou não há resposta nenhuma, e aí o estado corrigido é o pedido
     saneado — que é só o que se sabe. */
  const dados = resposta.ok ? resposta.dados : null;
  const total = dados?.total ?? 0;
  const estado = dados
    ? { ...pedido, pagina: dados.pagina ?? pedido.pagina }
    : estadoCorrigido(pedido, total);

  const linhas = dados?.data ?? [];
  const abas = abasDosDescontos(estado);
  const agoraEmMs = Date.now();

  return (
    <>
      <Cabecalho
        titulo="Descontos"
        descricao="Promoções e cupons são a mesma coisa aqui: o que muda é se o cliente digita um código ou não."
        email={acesso.email}
        acao={
          /* R18 — uma ação primária por página, sempre no mesmo lugar. Ela é um
             <Link> com cara de botão e não um <Botao>: navegação é navegação, e
             um <button> que navega perde o clique do meio, o "abrir em nova
             aba" e o endereço na barra de status. */
          <Link
            href={`${ROTA_DE_DESCONTOS}/novo`}
            className={`inline-flex min-h-11 items-center justify-center rounded-bt bg-fuligem px-4 text-[11px] ${ETIQUETA} leading-none text-cal transition-colors hover:bg-fuligem-80 ${FOCO}`}
          >
            Nova regra
          </Link>
        }
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        {/*
          AS ABAS SALVAS — R4. Cada uma é uma URL completa, não um estado de
          componente: é isso que faz "Vigentes" sobreviver ao F5 e ao link
          colado. "Frete grátis" é uma aba e não uma tela separada porque são as
          mesmas regras, na mesma tabela, com o mesmo relatório — duas telas
          obrigariam a procurar em dois lugares a regra que se esqueceu como foi
          cadastrada.
        */}
        <nav aria-label="Recortes salvos">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-fuligem-20">
            {abas.map((aba) => (
              <li key={aba.rotulo}>
                <Link
                  href={aba.href}
                  aria-current={aba.ativa ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[11px] ${ETIQUETA} ${FOCO} ${
                    aba.ativa
                      ? "border-fuligem text-fuligem"
                      : "border-transparent text-fuligem-55 hover:text-fuligem"
                  }`}
                >
                  {aba.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          A BUSCA E OS CHIPS FICAM ACIMA DA FICHA, sobre a cal — R1 quer a busca
          sempre visível, e "sempre visível" inclui quando a tabela está vazia
          ou quando a leitura falhou. Dentro da <Ficha> ela sumiria junto com a
          tabela no estado de erro, e o gestor ficaria sem o controle de que
          precisa justamente para tentar outra coisa.

          `outrosParametros` leva os filtros junto: buscar dentro de "Vigentes"
          tem de continuar dentro de "Vigentes".
        */}
        <BuscaDaLista
          base={ROTA_DE_DESCONTOS}
          buscaAtual={estado.busca}
          outrosParametros={{
            situacao: estado.situacao || undefined,
            metodo: estado.metodo || undefined,
            classe: estado.classe || undefined,
          }}
          rotulo="Buscar regra"
          placeholder="Nome da regra ou código"
          ajuda="O código pode ir em minúscula — a busca não diferencia."
        />
        <ChipsDeFiltro chips={chipsDosDescontos(estado)} hrefLimpar={ROTA_DE_DESCONTOS} />

        <EstadoDaTela
          /* SEMPRE `false` NUM SERVER COMPONENT: quando este JSX existe, o
             `await` já voltou. A prop continua sendo passada, em vez de o
             componente virar três `if`, porque é a ORDEM DAS GUARDAS
             (carregando → erro → vazio → conteúdo) que impede o defeito que ele
             existe para impedir. */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* ZERO É UM NÚMERO PLAUSÍVEL, e por isso `vazio` só é verdadeiro
             quando a leitura DEU CERTO. Uma loja pode não ter desconto nenhum;
             o que ela não pode é ler "nenhuma regra cadastrada" por causa de
             uma API fora do ar — ou, aqui, por causa de uma rota que o backend
             ainda não tem. */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhuma regra de desconto"
          vazioTexto="Crie a primeira e use o simulador para ver quanto ela desconta antes de ligá-la."
          vazioAcao={
            <Link
              href={`${ROTA_DE_DESCONTOS}/novo`}
              className={`inline-flex min-h-11 items-center justify-center rounded-bt bg-fuligem px-4 text-[11px] ${ETIQUETA} leading-none text-cal transition-colors hover:bg-fuligem-80 ${FOCO}`}
            >
              Criar a primeira regra
            </Link>
          }
        >
          <Ficha semPreenchimento>
            {/* A tabela mora num arquivo `"use client"` porque `Coluna.celula` é
                uma FUNÇÃO, e função não atravessa a fronteira Server→Client. O
                porquê inteiro está em `TabelaDeDescontos.tsx`. */}
            <TabelaDeDescontos linhas={linhas} agoraEmMs={agoraEmMs} />
            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPaginas ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              /* A URL de cada página carrega os filtros junto — é o que impede
                 o recorte de sumir ao virar a página, que é o R3 pelo avesso. */
              href={(pagina) => urlDaTela({ ...estado, pagina })}
              rotuloDoItem={{ singular: "regra", plural: "regras" }}
            />
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE A LISTA MOSTRA, E O QUE ELA NÃO SABE — por escrito.

          "Já descontou" vem de `promocao_resgates`, que é a fonte da verdade do
          uso e não o contador denormalizado de `promocao_codigos`: pedido
          cancelado ou PIX expirado DEVOLVE o uso, e a devolução é um
          `estornado_em` na linha do resgate, não um `DELETE`. A própria Shopify
          documenta que o contador denormalizado dela fica defasado.
        */}
        <p className="max-w-[74ch] text-[12px] text-fuligem-55">
          A situação de cada regra é lida do relógio a cada vez que esta tela
          abre — ela nunca é gravada. “Já descontou” soma os resgates que não
          foram estornados: um pedido cancelado devolve o uso e sai desta conta.
        </p>
      </div>
    </>
  );
}
