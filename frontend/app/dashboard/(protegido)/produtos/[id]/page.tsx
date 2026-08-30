import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { Tarja } from "@/components/painel/ui/Tarja";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { lerAba, type CustoDoProduto } from "@/lib/painel/produtos/ficha.logica";
import {
  ROTA_DE_PRODUTOS,
  identificarProduto,
  type ProdutoDoPainel,
} from "@/lib/painel/produtos/produtos.logica";

import { FichaDoProduto } from "../FichaDoProduto";
import { LinkDeAcao } from "../LinkDeAcao";

/**
 * `/dashboard/produtos/[id]` — a ficha de um café.
 *
 * O ID VIVE NA URL, E É UMA CORREÇÃO DE GRAÇA. No painel legado o `productId`
 * morava em memória volátil, dentro de um context: sair de uma edição sem
 * salvar e clicar em "Cadastrar produto" abria o formulário de EDIÇÃO do
 * produto anterior, com o botão escrito "Atualizar", e salvar ali sobrescrevia
 * o produto errado achando que criava um novo. Um F5 no meio da edição fazia o
 * inverso. Com uma rota de verdade, os dois casos deixam de existir sem ninguém
 * precisar lembrar deles.
 *
 * AS DUAS LEITURAS VÃO JUNTAS, e a segunda é a que não tem outro caminho:
 * `custo` ficou fora do `GRANT SELECT` de coluna de 0006 (instância Supabase
 * COMPARTILHADA — dar a coluna a `authenticated` entregaria a margem da loja a
 * qualquer token da VPS), e por isso nem a admin a lê pelo PostgREST, e
 * `RETURNING *` responde 42501 nesta tabela até para ela. A saída é a rota
 * admin no Express, que conecta como dono do banco.
 *
 * UMA FALHA NO CUSTO NÃO DERRUBA A FICHA. Preço, estoque e as medidas da caixa
 * são o trabalho; margem é consulta. O bloco do custo desenha a frase do erro no
 * seu próprio lugar, e o resto da tela continua editável — que é o oposto de
 * uma tela inteira em branco por causa de um número que não veio.
 */
export const metadata: Metadata = {
  title: "Produto",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDaFicha({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** No Next 15 os dois são Promise — ler sem `await` devolve um Proxy que
   *  falha só quando alguém tenta usar um parâmetro. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, { id }, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    params,
    searchParams,
  ]);

  const [resposta, respostaDoCusto] = await Promise.all([
    lerDaApi<ProdutoDoPainel>(`/dashboard/${id}`),
    lerDaApi<CustoDoProduto>(`/admin/produtos/${id}/custo`),
  ]);

  /*
    404 DO BACKEND VIRA 404 DO NEXT, e só ele.

    `GET /dashboard/:id` responde 400 para id malformado, 404 para id que não
    existe e 500 para banco fora. Traduzir os três em `notFound()` faria a
    página de "não encontrado" aparecer quando o Postgres caiu — e o gestor
    concluiria que alguém apagou o café. Só a ausência de verdade vira 404; o
    resto vira uma tarja que diz o que houve, com o caminho de volta.

    A distinção é pela FRASE do backend, que é estável e está no repositório
    ("Produto não encontrado."), e não pelo status — `lerDaApi` devolve a frase
    resolvida, não o código, de propósito: é a frase que a tela mostra.
  */
  if (!resposta.ok && resposta.erro === "Produto não encontrado.") notFound();

  const produto = resposta.ok ? resposta.dados : null;

  return (
    <>
      <Cabecalho
        titulo={produto ? identificarProduto(produto) : "Produto"}
        descricao={
          produto
            ? "Preço, custo e estoque; a caixa que cota o frete; e o que a loja lê daqui."
            : undefined
        }
        email={acesso.email}
        /* R18 — a ação primária no mesmo canto de sempre. Aqui ela é a VOLTA:
           numa tela de detalhe, o caminho de saída é a ação que se usa mais. */
        acao={
          <LinkDeAcao href={ROTA_DE_PRODUTOS} variante="secundaria">
            Voltar à lista
          </LinkDeAcao>
        }
      />

      <div className="mx-auto max-w-[1000px] px-5 py-6">
        {produto ? (
          <FichaDoProduto
            produto={produto}
            custoInicial={respostaDoCusto.ok ? respostaDoCusto.dados : null}
            erroDoCusto={respostaDoCusto.ok ? null : respostaDoCusto.erro}
            abaInicial={lerAba(parametros.aba)}
          />
        ) : (
          // A leitura falhou por algo que NÃO é "não existe": a tarja diz o que
          // o servidor disse, e nada é desenhado por cima de um dado ausente.
          <Tarja tom="erro">{resposta.ok ? "" : resposta.erro}</Tarja>
        )}
      </div>
    </>
  );
}
