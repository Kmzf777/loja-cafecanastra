import { lerDaApi } from "@/lib/painel/api-servidor";
import {
  API_PRODUTOS,
  type ProdutoDoSeletor,
  type RespostaDeProdutos,
} from "@/lib/painel/descontos/contrato";

/**
 * O catálogo que alimenta os seletores de escopo e o carrinho do simulador.
 *
 * O PRODUTO É ESCOLHIDO NUMA LISTA, NUNCA DIGITADO — é item do checklist de
 * paridade, e o motivo está escrito lá: no painel legado o UUID ia à mão, e "um
 * caractere errado apontava para produto nenhum, sem erro em lugar algum". A
 * regra ficava salva mirando o nada, e só a ausência de desconto na venda
 * denunciava — semanas depois.
 *
 * O TETO DE 200 É O DO PRÓPRIO BACKEND (`getProducts` prende `limit` em 200
 * para `?limit=999999` não puxar o catálogo inteiro numa resposta só), e é
 * exatamente o que a vitrine já usa. Esta loja tem dezenas de cafés, não
 * milhares: o dia em que 200 não bastar, o seletor precisa virar busca, e o
 * comentário fica aqui para que essa conversa aconteça em vez de o seletor
 * silenciosamente parar de mostrar os últimos produtos.
 *
 * A LEITURA NUNCA DERRUBA A TELA. `GET /dashboard` é uma das cinco rotas
 * públicas da API, então ela normalmente responde — mas se não responder, o
 * formulário abre com o seletor vazio e o gestor ainda consegue cadastrar por
 * SKU e simular com item avulso. Trocar isso por um erro de página inteira
 * seria deixar de fazer o trabalho por causa de uma comodidade.
 */
export async function lerCatalogo(): Promise<{
  produtos: ProdutoDoSeletor[];
  categorias: string[];
}> {
  const resposta = await lerDaApi<RespostaDeProdutos>(API_PRODUTOS);
  const produtos = resposta.ok ? (resposta.dados.products ?? []) : [];

  /* As categorias saem dos próprios produtos: não há rota que as liste, e
     `GET /options` devolve outra coisa. Ordenadas em pt-BR para "Único" não cair
     antes de "Torrado" pela ordem de bytes. */
  const categorias = [
    ...new Set(
      produtos
        .map((p) => (p.category ?? "").trim())
        .filter((c) => c !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { produtos, categorias };
}
