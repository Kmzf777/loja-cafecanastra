import type { Metadata } from "next";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerAba } from "@/lib/painel/produtos/ficha.logica";
import { ROTA_DE_PRODUTOS } from "@/lib/painel/produtos/produtos.logica";

import { FichaDoProduto } from "../FichaDoProduto";
import { LinkDeAcao } from "../LinkDeAcao";

/**
 * `/dashboard/produtos/novo` — o cadastro.
 *
 * É UMA ROTA PRÓPRIA, e é o outro lado da correção que o `[id]` faz. No painel
 * legado "cadastrar" e "editar" eram a MESMA tela, distinguidas por um
 * `productId` guardado em memória — e quando esse id sobrevivia a uma saída sem
 * salvar, o botão "Cadastrar produto" abria o formulário do produto anterior e
 * salvava por cima dele. Duas rotas, dois estados iniciais, e o problema
 * simplesmente não tem onde acontecer.
 *
 * É A MESMA `<FichaDoProduto>` das duas vezes, com `produto = null`. Duplicar o
 * formulário para "criar" e "editar" duplica junto as onze validações, a barra
 * de salvar e o bloqueio de saída — e é assim que as duas cópias divergem no
 * primeiro conserto que só uma delas recebe.
 *
 * NÃO HÁ BLOCO DE CUSTO NEM "SALVAR SÓ O ESTOQUE" AQUI, e não é omissão: as
 * duas coisas são rotas que precisam de um `:id`, e um produto que ainda não
 * existe não tem id. Elas aparecem assim que ele for criado.
 */
export const metadata: Metadata = {
  title: "Novo produto",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

export default async function PaginaDeNovoProduto({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([lerAcessoDoPainel(), searchParams]);

  return (
    <>
      <Cabecalho
        titulo="Novo produto"
        descricao="Nome, preço, estoque e a caixa. O SKU é o que faz a loja encontrar este café."
        email={acesso.email}
        acao={
          <LinkDeAcao href={ROTA_DE_PRODUTOS} variante="secundaria">
            Voltar à lista
          </LinkDeAcao>
        }
      />

      <div className="mx-auto max-w-[1000px] px-5 py-6">
        <FichaDoProduto
          produto={null}
          custoInicial={null}
          erroDoCusto={null}
          abaInicial={lerAba(parametros.aba)}
        />
      </div>
    </>
  );
}
