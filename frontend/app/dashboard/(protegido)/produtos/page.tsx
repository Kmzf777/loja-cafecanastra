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
  ROTA_DE_NOVO_PRODUTO,
  ROTA_DE_PRODUTOS,
  chipsDosProdutos,
  estadoCorrigido,
  lerEstado,
  montarConsulta,
  temFiltro,
  type OpcaoDeProduto,
  type RespostaDeProdutos,
} from "@/lib/painel/produtos/produtos.logica";

import { FiltrosDeProduto } from "./FiltrosDeProduto";
import { LinkDeAcao } from "./LinkDeAcao";
import { ListaDeProdutos } from "./ListaDeProdutos";

/**
 * `/dashboard/produtos` — o catálogo comercial da loja.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ELA CONSERTA, e são três coisas medidas.
 *
 * A BUSCA NUNCA FOI USADA. `GET /dashboard?q=` existe desde 0003 — é a coluna
 * gerada `tsv`, com índice GIN e configuração `'portuguese'` — e `GProducts`
 * filtrava a página carregada EM MEMÓRIA. Com mais de vinte itens, o café que
 * casava e estava na página 2 simplesmente não aparecia, e a tela dizia
 * "nenhum resultado" com toda a confiança. É o mesmo defeito que a tela de
 * Clientes tinha e que a Onda 4 consertou lá.
 *
 * O `productId` MORAVA EM MEMÓRIA VOLÁTIL. Sair de uma edição sem salvar e
 * clicar em "Cadastrar produto" abria o formulário de EDIÇÃO do produto
 * anterior, com o botão escrito "Atualizar" — e salvar ali sobrescrevia o
 * produto errado achando que criava um novo. Aqui o id vive na URL
 * (`/dashboard/produtos/[id]`), e os dois casos deixam de existir sem ninguém
 * precisar lembrar deles.
 *
 * AS MEDIDAS DA CAIXA ERAM APAGADAS EM SILÊNCIO. O formulário legado enviava
 * `weight/width/height/length` sem ter input para nenhum dos quatro, e o
 * backend caía nos padrões (0,3 kg / 20×5×20 cm) em toda edição — a loja
 * cotando frete de uma caixa que não existia. A coluna "Caixa" desta lista é o
 * primeiro lugar do painel onde esse dado aparece.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SERVER COMPONENT LENDO `searchParams` — e é daí que o R2 sai de graça: busca,
 * categoria, embalagem, recorte de destaque e página vivem na URL. Voltar da
 * ficha devolve a MESMA lista, o F5 não perde nada, e o link colado abre o que
 * se estava vendo. As ilhas de cliente são duas: a busca e a lista (que carrega
 * a seleção em massa do R25 e a prévia do lote do R6).
 */
export const metadata: Metadata = {
  title: "Produtos",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDeProdutos({
  searchParams,
}: {
  /** No Next 15 `searchParams` é uma Promise — ler sem `await` devolve um Proxy
   *  que falha só quando alguém tenta usar um parâmetro. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    /* A segunda leitura da sessão nesta requisição — a mesma dívida que as
       outras telas já registraram: o layout chamou `exigirAdminNoPainel`, e
       aqui se pergunta de novo só para saber o E-MAIL do cabeçalho. O conserto
       é embrulhar `lerAcessoDoPainel` com o `cache()` do React; é arquivo de
       segurança, fora do escopo desta tarefa. */
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);

  /*
    AS TRÊS LEITURAS VÃO JUNTAS. As opções de filtro são uma pergunta
    independente da listagem, e encadeá-las somaria os tempos de espera na cara
    do gestor.

    AS OPÇÕES SÃO LEITURA PÚBLICA (`GET /options` não tem `isAuthenticated`), e
    isso não é descuido daqui: são os valores de `canastra.produto_opcoes`, que
    a própria vitrine usa para montar filtros. Uma falha nelas NÃO derruba a
    tela — a linha de filtros some e a lista continua funcionando, porque
    escolher categoria é conveniência e ver o catálogo é o trabalho.
  */
  const [resposta, categorias, embalagens] = await Promise.all([
    lerDaApi<RespostaDeProdutos>(montarConsulta(pedido)),
    lerDaApi<OpcaoDeProduto[]>("/options?type=category"),
    lerDaApi<OpcaoDeProduto[]>("/options?type=size"),
  ]);

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

  const linhas = dados?.products ?? [];
  const chips = chipsDosProdutos(estado);
  const totalPaginas = dados?.totalPages ?? totalDePaginas(total, POR_PAGINA);

  /** O que a busca precisa preservar ao navegar. A PÁGINA fica de fora de
   *  propósito: buscar estando na página 4 e continuar na 4 é o jeito mais
   *  rápido de uma busca com resultados parecer vazia. */
  const outrosParametros = {
    categoria: estado.categoria || undefined,
    embalagem: estado.embalagem || undefined,
    novidade: estado.novidade || undefined,
  };

  return (
    <>
      <Cabecalho
        titulo="Produtos"
        descricao="O catálogo comercial: preço, estoque e a caixa que cota o frete."
        email={acesso.email}
        /* R18 — a ação primária da tela mora sempre no mesmo canto, e leva a uma
           ROTA. O id do produto vive na URL desde o primeiro clique. */
        acao={<LinkDeAcao href={ROTA_DE_NOVO_PRODUTO}>Novo produto</LinkDeAcao>}
      />

      <div className="mx-auto max-w-[1400px] space-y-4 px-5 py-6">
        {/*
          A BUSCA E OS FILTROS FICAM ACIMA DA FICHA, sobre a cal — R1 quer a
          busca sempre visível, e "sempre visível" inclui quando a tabela está
          vazia ou quando a leitura falhou. Dentro da <Ficha> ela sumiria junto
          com a tabela no estado de erro do <EstadoDaTela>, e o gestor ficaria
          sem o controle de que precisa justamente para tentar outra coisa.
        */}
        <BuscaDaLista
          base={ROTA_DE_PRODUTOS}
          buscaAtual={estado.busca}
          outrosParametros={outrosParametros}
          rotulo="Buscar produto"
          placeholder="Nome, categoria, embalagem ou descrição"
          /* A ajuda diz o ALCANCE da busca, e ela existe porque o alcance é
             invisível: o índice `tsv` do backend cobre esses quatro campos e
             mais nenhum — quem procurar por SKU e não achar vai concluir que o
             produto não existe. */
          ajuda="Procura por nome, categoria, embalagem e descrição — não pelo SKU."
        />

        <FiltrosDeProduto
          estado={estado}
          categorias={categorias.ok ? categorias.dados : []}
          embalagens={embalagens.ok ? embalagens.dados : []}
        />

        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_PRODUTOS} />

        <EstadoDaTela
          /*
            SEMPRE `false` NUM SERVER COMPONENT, e está escrito porque parece
            omissão: quando este JSX existe, o `await` já voltou. "Carregando"
            aqui seria um estado que nunca acontece — e a prop continua sendo
            passada, em vez de o componente ser trocado por três `if`, porque é
            a ORDEM DAS GUARDAS (carregando → erro → vazio → conteúdo) que
            impede o defeito que este componente existe para impedir.
          */
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /*
            ZERO É UM NÚMERO PLAUSÍVEL, e é por isso que `vazio` só é verdadeiro
            quando a leitura DEU CERTO. Uma loja pode não ter produto nenhum; o
            que ela não pode é ler "nenhum café cadastrado" por causa de uma API
            fora do ar. É o defeito mais caro do painel legado, que fazia
            `if (!lista.length)` antes de olhar para o erro.
          */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhum café cadastrado"
          vazioTexto="Cadastre o primeiro para ele aparecer na loja."
          vazioAcao={<LinkDeAcao href={ROTA_DE_NOVO_PRODUTO}>Novo produto</LinkDeAcao>}
        >
          {/* A lista mora num arquivo `"use client"` porque `Coluna.celula` é
              uma FUNÇÃO, e função não atravessa a fronteira Server→Client. O
              porquê inteiro está em `ListaDeProdutos.tsx`. */}
          <ListaDeProdutos
            linhas={linhas}
            estado={estado}
            totalDoFiltro={total}
            totalPaginas={totalPaginas}
          />
        </EstadoDaTela>

        {/*
          O QUE ATRAVESSA DAQUI PARA A LOJA, POR ESCRITO — e é a frase mais útil
          desta tela.

          Foi medido em `lib/catalogo/repositorio.ts`: a vitrine lê
          `GET /dashboard?limit=200`, guarda QUATRO campos (`product_id`, `sku`,
          `price`, `quantity`) e sobrepõe três deles sobre o catálogo editorial
          versionado. Nome, categoria, embalagem, descrição e foto NÃO são lidos
          por superfície nenhuma da loja. E o casamento é por SKU, com
          `linhas.filter((p) => p.sku)` descartando quem não tem.

          Dizer isso aqui é o que impede a conclusão errada mais provável desta
          tela — "troquei a foto e a loja não mudou, o sistema está quebrado".
        */}
        <p className="max-w-[80ch] text-[12px] text-fuligem-55">
          Da loja, o que vem daqui é <strong className="font-medium">preço</strong> e{" "}
          <strong className="font-medium">estoque</strong>, casados por{" "}
          <strong className="font-medium">SKU</strong> — e as medidas da caixa, que
          cotam o frete. Nome, foto e descrição da vitrine vêm do catálogo
          editorial versionado (<span data-dado>data/catalogo-canastra.json</span>),
          não deste cadastro.
        </p>
      </div>
    </>
  );
}
