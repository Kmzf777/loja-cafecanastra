import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { BuscaDaLista } from "@/components/painel/ui/BuscaDaLista";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  POR_PAGINA,
  ROTA_DE_CLIENTES,
  chipsDosClientes,
  estadoCorrigido,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
  type RespostaDeClientes,
} from "@/lib/painel/clientes/clientes.logica";
import { totalDePaginas } from "@/lib/painel/paginacao";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";

import { TabelaDeClientes } from "./TabelaDeClientes";

/**
 * `/dashboard/clientes` — a lista de quem compra na loja.
 *
 * O QUE ELA CONSERTA. A tela legada (`RegisteredClients.jsx`) carregava uma
 * página de cem linhas e filtrava EM MEMÓRIA: a caixa de busca escondia o
 * cliente que casava e estava na página 3, e o contador mostrava o total geral
 * — a tela mentia duas vezes, e as duas mentiras eram invisíveis. A Onda 4
 * levou o filtro para o banco (`GET /auth/users?q=`, quatro campos num `OR`), e
 * é essa rota que esta tela consome.
 *
 * SERVER COMPONENT LENDO `searchParams` — e é daí que R2 sai de graça: busca e
 * página vivem na URL, então voltar de outra tela devolve a MESMA lista, o F5
 * não perde nada, e o link colado para outra pessoa abre exatamente o que se
 * estava vendo. O único JavaScript da tela é a caixa de busca.
 *
 * NÃO HÁ AÇÃO DE ESCRITA AQUI, e por isso não há `acao` no <Cabecalho>. R18 diz
 * "uma ação primária por página, sempre no mesmo lugar"; uma tela de leitura
 * pura tem zero, e inventar um botão para preencher o canto é pior do que o
 * canto vazio. A exclusão de cliente existe no backend
 * (`DELETE /auth/users/:id`) e NÃO é desenhada aqui de propósito: ela é
 * irreversível e leva pedido junto, e o R13 desta casa manda arquivar em vez de
 * apagar — é conversa da onda que tratar de LGPD, não desta.
 *
 * E ISSO ESTÁ ESCRITO NA TELA, no rodapé, não só neste comentário. O gestor não
 * lê código: quem procura a lixeira e não a acha conclui que a tela nova está
 * incompleta, e o caminho seguinte é abrir o painel antigo ou pedir a alguém que
 * rode um DELETE. A frase também nomeia o caminho CERTO — o fluxo de LGPD —,
 * porque um aviso que só diz "não dá" manda a pessoa procurar como dar.
 */
export const metadata: Metadata = {
  title: "Clientes",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};


export default async function PaginaDeClientes({
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
  const resposta = await lerDaApi<RespostaDeClientes>(montarConsulta(pedido));

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

  const linhas = dados?.users ?? [];
  const chips = chipsDosClientes(estado);

  return (
    <>
      <Cabecalho
        titulo="Clientes"
        descricao="Quem tem conta na loja, com quantas compras cada um já fez."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        {/*
          A BUSCA E OS CHIPS FICAM ACIMA DA FICHA, sobre a cal — R1 quer a busca
          sempre visível, e "sempre visível" inclui quando a tabela está vazia
          ou quando a leitura falhou. Dentro da <Ficha> ela sumiria junto com a
          tabela no estado de erro do <EstadoDaTela>, e o gestor ficaria sem o
          controle de que precisa justamente para tentar outra coisa.
        */}
        <BuscaDaLista
          base={ROTA_DE_CLIENTES}
          buscaAtual={estado.busca}
          rotulo="Buscar cliente"
          placeholder="Nome, e-mail, telefone ou CPF"
          /*
            A AJUDA DIZ O QUE A BUSCA FAZ COM O CPF, e ela existe porque a
            normalização (em `clientes.logica.ts`) é invisível: quem cola um CPF
            pontuado precisa saber que vai funcionar, senão testa uma vez, não
            acha e nunca mais tenta.
          */
          ajuda="O CPF pode ir com ou sem pontuação."
        />
        <ChipsDeFiltro chips={chips} hrefLimpar={ROTA_DE_CLIENTES} />

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
            quando a leitura DEU CERTO. Uma loja pode não ter cliente nenhum; o
            que ela não pode é ler "nenhum cliente cadastrado" por causa de uma
            API fora do ar. Com `resposta.ok` na conta, o caminho de erro nunca
            chega aqui — mas a expressão diz isso por escrito, para quem mexer
            depois não inverter a ordem.
          */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhum cliente cadastrado"
          vazioTexto="Quando alguém criar conta na loja, ela aparece aqui."
        >
          <Ficha semPreenchimento>
            {/* A tabela mora num arquivo `"use client"` porque `Coluna.celula`
                é uma FUNÇÃO, e função não atravessa a fronteira Server→Client.
                O porquê inteiro está em `TabelaDeClientes.tsx`. */}
            <TabelaDeClientes linhas={linhas} />
            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPages ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              /* A URL de cada página carrega a BUSCA junto — é o que impede o
                 filtro de sumir ao virar a página, que é o R3 pelo avesso. */
              href={(pagina) => urlDaTela({ ...estado, pagina })}
              rotuloDoItem={{ singular: "cliente", plural: "clientes" }}
            />
          </Ficha>
        </EstadoDaTela>

        {/*
          O QUE A BUSCA ALCANÇA, POR ESCRITO — e a ressalva do telefone, que é
          real e não tem conserto nesta tela.

          `GET /auth/users?q=` compara TEXTO CRU nos quatro campos. O CPF esta
          tela normaliza sozinha (ver `clientes.logica.ts`), porque o banco só
          guarda dígitos. O TELEFONE não dá para normalizar: `clientes.telefone`
          é dado herdado da loja antiga, não tem nenhum caminho de escrita no
          backend atual, e portanto não tem formato conhecido — adivinhar um
          faria a busca por telefone parar de achar quem hoje ela acha. Dizer
          isso vale mais que esconder.
        */}
        <p className="max-w-[70ch] text-[12px] text-fuligem-55">
          A busca olha nome, e-mail, telefone e CPF, em qualquer parte do texto.
          O telefone é encontrado no formato em que foi gravado — o cadastro veio
          da loja antiga e não tem um formato único.
        </p>

        {/*
          A AUSÊNCIA DO BOTÃO DE EXCLUIR É EXPLICADA NA TELA, e não só no
          comentário logo acima deste arquivo.

          O comentário justifica a decisão para quem vier mexer no código; o
          gestor não lê código. Quem procura a lixeira e não a acha conclui que a
          tela nova está incompleta, e o caminho seguinte é abrir o painel antigo
          — ou pedir a alguém que rode um DELETE. As duas saídas são piores do
          que a frase.

          E ela nomeia o CAMINHO CERTO, não só o proibido. Um aviso que só diz
          "não dá" manda a pessoa procurar como dar; dizer que o pedido de
          eliminação tem um fluxo próprio é o que faz o pedido chegar onde ele é
          atendido de verdade. Hoje esse fluxo ainda não tem tela — as rotas de
          LGPD existem no servidor (`/lgpd/titulares/:id/dados` e `/redigir`) e
          nenhuma UI as chama —, e a frase não promete uma que não existe.
        */}
        <p className="max-w-[70ch] text-[12px] text-fuligem-55">
          Não há como excluir um cliente por aqui, de propósito: apagar uma conta
          é irreversível e mexe em venda já faturada. Pedido de exclusão de dados
          pessoais é atendido pelo fluxo de LGPD, que apaga o dado do titular e
          preserva o registro fiscal da compra — ele não passa por um botão de
          lixeira nesta lista.
        </p>
      </div>
    </>
  );
}
