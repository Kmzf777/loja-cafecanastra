import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";

/**
 * ESTADO DO PRODUTO — e por que esta tela não tem botão de excluir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * R13: NADA É APAGADO, ARQUIVA-SE. E o motivo aqui é concreto, não doutrinário.
 *
 * `pedidos.itens` guarda `product_id` SEM chave estrangeira — 0004 e 0005
 * decidiram assim de propósito, porque o jsonb é uma "fotografia congelada" da
 * venda. Consequência: apagar um produto não levanta erro de FK nenhum; ele
 * simplesmente deixa um pedido antigo apontando para uma linha que não existe
 * mais em lugar algum. O estrago é silencioso e é no HISTÓRICO, que é
 * exatamente o que ninguém confere no dia seguinte.
 *
 * O `DELETE /dashboard/:id` existe e funciona (e desde a Onda 4 responde 404
 * para id inexistente, em vez do 204 que fazia a tela anunciar exclusão de algo
 * que não existia). Ele simplesmente NÃO é oferecido aqui: desenhar o botão
 * seria pôr a mão do gestor no único caminho que o R13 proíbe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * E O ARQUIVAR TAMBÉM NÃO ESTÁ AQUI, porque não há como.
 *
 * A coluna existe: 0034 criou `produtos.estado` com CHECK em
 * `rascunho | ativo | arquivado`, e 0038 fechou a vitrine em `estado = 'ativo'`
 * — ou seja, rascunho e arquivado JÁ não aparecem na loja. O que falta é o
 * caminho:
 *
 *   `COLUNAS_DO_CONTRATO` não projeta `estado`, então `GET /dashboard/:id` não
 *   o devolve — esta tela não tem como sequer MOSTRAR em que estado o produto
 *   está. E o `UPDATE` de `editProduct` escreve doze colunas, nenhuma delas
 *   `estado`, então `PUT` não o grava.
 *
 * Um seletor de estado desenhado assim mesmo mudaria de valor na tela, salvaria
 * com "Produto editado com sucesso!" e deixaria o café ativo na loja. É o
 * "botão que mente" outra vez — e neste caso o botão mentiria sobre uma coisa
 * que o gestor usaria para TIRAR um café de venda.
 *
 * Fica registrado no relatório da onda como falta de backend: `estado` na
 * projeção do contrato e um `PATCH /dashboard/:id/estado`, no molde do de
 * estoque.
 */
export function BlocoDoEstado() {
  return (
    <Ficha titulo="Estado e retirada de venda" nivel={3}>
      <div className="space-y-3">
        <Tarja tom="alerta">
          Ainda não dá para arquivar por aqui: a coluna de estado existe no
          banco (rascunho, ativo, arquivado) e a loja já respeita os três, mas a
          API do painel não lê nem grava esse campo.
        </Tarja>

        <p className="max-w-[75ch] text-[13px] text-fuligem-55">
          Para tirar um café de venda hoje, zere o estoque — a loja continua
          mostrando a página, sem permitir a compra.
        </p>

        {/*
          A AUSÊNCIA DO BOTÃO DE EXCLUIR É EXPLICADA, e não escondida. Quem vem
          do painel antigo procura por ele; sem uma frase, a conclusão é que a
          tela nova está incompleta — e o caminho seguinte é abrir o painel
          antigo e apagar por lá.
        */}
        <p className="max-w-[75ch] text-[13px] text-fuligem-55">
          E não há botão de excluir de propósito: o item de cada pedido guarda o
          identificador do produto sem vínculo de chave, então remover um café
          não dá erro nenhum — deixa pedidos antigos apontando para um produto
          que não existe mais, e isso não aparece no dia seguinte.
        </p>
      </div>
    </Ficha>
  );
}
