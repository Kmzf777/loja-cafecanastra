import { validarCpf } from "@/lib/cpf";
import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";

/**
 * A DECISÃO da tela de Clientes — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * Três coisas se decidem aqui, e cada uma tem um jeito próprio de falhar em
 * silêncio:
 *
 *   normalizarBusca ... manda o CPF com pontos e a busca não acha NINGUÉM, com
 *                       a tela dizendo "nenhum resultado" — que é uma frase que
 *                       o gestor acredita.
 *   lerEstado ......... perde o filtro ao virar a página, ou ressuscita uma
 *                       página que não existe mais.
 *   montarConsulta .... pede à API uma página diferente da que o rodapé mostra.
 */

/** A rota desta tela, num lugar só — é base de URL e de comparação no teste. */
export const ROTA_DE_CLIENTES = "/dashboard/clientes";

/**
 * Vinte por página.
 *
 * O backend aceita até 100 (`conta.routes.js`), e é tentador pedir 100 para
 * "paginar menos". Não é o que a densidade quer: R17 diz que painel é tarefa, e
 * uma tabela de cem linhas é uma tela de rolagem em que o cabeçalho fixo é a
 * única âncora. Vinte cabem numa tela de trabalho quase inteira.
 */
export const POR_PAGINA = 20;

/**
 * O que `GET /auth/users` devolve. `id` e `user_id` vêm IGUAIS do backend (o
 * SELECT projeta `c.user_id` duas vezes, com dois nomes, porque o painel legado
 * usava um para a `key` e outro para o handler) — aqui usamos `user_id`, que é
 * o nome verdadeiro da coluna.
 *
 * NÃO HÁ CPF NESTA PROJEÇÃO, e isso é do backend, não uma omissão daqui: a rota
 * BUSCA por CPF e não o DEVOLVE. Nenhuma tela precisa dele para listar, e o que
 * não trafega não vaza.
 */
export type ClienteDaLista = {
  user_id: string;
  id?: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  purchases: number;
};

export type RespostaDeClientes = {
  users: ClienteDaLista[];
  total: number;
  totalPages: number;
  page: number;
};

/** O estado da tela, que é exatamente o que está na URL. */
export type EstadoDosClientes = {
  /** O que a pessoa digitou, como ela digitou. */
  busca: string;
  pagina: number;
};

/**
 * A BUSCA POR CPF SÓ ACHA SE FOR SEM PONTUAÇÃO — e esta função é a metade da
 * defesa. A outra metade é a frase na tela.
 *
 * O FATO: `canastra.clientes.cpf` guarda ONZE DÍGITOS CRUS. `utils/cpf.js` faz
 * `String(number).replace(/\D/g, "")` antes do UPDATE, então não existe CPF
 * pontuado no banco. E `GET /auth/users?q=` compara com `c.cpf ILIKE '%q%'`,
 * texto contra texto. Consequência: quem cola "529.982.247-25" — que é como o
 * CPF aparece em toda nota fiscal e em todo cadastro — recebe ZERO RESULTADOS,
 * e a tela diz "nenhum cliente para este filtro" com toda a confiança. O gestor
 * conclui que a pessoa não é cliente.
 *
 * POR QUE NÃO SIMPLESMENTE TIRAR TODA PONTUAÇÃO DE TODA BUSCA: porque quebraria
 * as outras três. `maria@casa.com` sem pontuação vira `mariacasacom`, e o
 * `ILIKE` deixa de casar com o e-mail que existe. A normalização tem de ser
 * CIRÚRGICA.
 *
 * A REGRA, E O CASO DIFÍCIL QUE ELA RESOLVE. Um celular brasileiro também tem
 * ONZE dígitos ("35 99999-9999"), então "onze dígitos" não distingue CPF de
 * telefone — e `clientes.telefone` não tem NENHUM caminho de escrita no backend
 * atual (é dado herdado, de formato desconhecido), então normalizá-lo seria
 * chutar. Por isso a normalização exige as TRÊS condições juntas:
 *
 *   1. o texto só tem dígito, ponto, hífen e espaço (um e-mail ou um nome já
 *      saem intactos aqui);
 *   2. tem exatamente onze dígitos;
 *   3. esses onze dígitos PASSAM nos dígitos verificadores da Receita.
 *
 * A terceira é a que separa CPF de celular: um telefone que passe na conta do
 * CPF é raro, e quando acontecer o que se manda é o próprio número em dígitos —
 * que é o que a pessoa digitaria de qualquer forma.
 *
 * E O TEXTO CONTINUA SENDO O QUE VAI PARA A URL, não isto: a normalização
 * acontece na hora de montar a CONSULTA da API. O chip de filtro mostra o que a
 * pessoa escreveu, porque é isso que ela reconhece.
 */
const SO_PONTUACAO_DE_DOCUMENTO = /^[\d.\-\s]+$/;

export function normalizarBusca(bruto: string): string {
  const texto = bruto.trim();
  if (texto === "") return "";
  if (!SO_PONTUACAO_DE_DOCUMENTO.test(texto)) return texto;

  const digitos = texto.replace(/\D/g, "");
  if (digitos.length !== 11) return texto;
  if (!validarCpf(digitos)) return texto;

  return digitos;
}

/**
 * O estado a partir da URL.
 *
 * A PÁGINA É VALIDADA CONTRA O TOTAL QUE AINDA NÃO SE CONHECE, e por isso ela
 * sai daqui apenas SANEADA (≥ 1). O aperto contra a última página existente
 * acontece depois da resposta, em `estadoCorrigido` — antes dela não há como
 * saber quantas páginas há, e chutar faria a tela pedir uma página e mostrar
 * outra.
 */
export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosClientes {
  return {
    busca: textoDoParametro(parametros.q),
    // `Number.MAX_SAFE_INTEGER` como teto: aqui só interessa "não é lixo e não é
    // menor que 1". O teto de verdade é aplicado com a resposta em mãos.
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * A consulta que vai para `GET /auth/users`.
 *
 * `q` sai NORMALIZADO (ver acima) e `limit` é sempre explícito: o padrão do
 * backend é 10, e uma tela que pagina de 20 em 20 mostrando 10 linhas é uma
 * tela que discorda do próprio rodapé.
 */
export function montarConsulta(estado: EstadoDosClientes): string {
  return montarUrl("/auth/users", {
    q: normalizarBusca(estado.busca) || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

/**
 * A URL desta tela para um estado — a "aba salva" do R2.
 *
 * `pagina: 1` é OMITIDA: é o valor padrão, e `?pagina=1` cria uma segunda URL
 * para a mesma tela. Duas URLs para uma tela são duas entradas no histórico e
 * dois favoritos que o gestor não sabe distinguir.
 */
export function urlDaTela(estado: Partial<EstadoDosClientes>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_CLIENTES, {
    q: estado.busca?.trim() || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/**
 * O estado depois de ver a resposta — a página presa dentro do que existe.
 *
 * O CASO É O FAVORITO VELHO: `?pagina=9` numa base que encolheu para duas
 * páginas. Sem isto, o backend devolve zero linhas (ele próprio já prende a
 * página, mas devolve `page` corrigido enquanto a tela continua achando que
 * está na 9) e a tela desenha "nenhum resultado para este filtro" — que o
 * gestor lê como "o filtro não achou ninguém", não como "esta página não
 * existe".
 */
export function estadoCorrigido(
  estado: EstadoDosClientes,
  total: number,
): EstadoDosClientes {
  return { ...estado, pagina: paginaValida(estado.pagina, totalDePaginas(total, POR_PAGINA)) };
}

/**
 * Os chips do R3 — um por filtro ativo, cada um com o `href` que o REMOVE.
 *
 * Nesta tela há um filtro só, a busca; a função existe mesmo assim porque é ela
 * que garante que o `href` de remoção também zere a PÁGINA. Tirar a busca
 * estando na página 4 e continuar na página 4 é o jeito mais rápido de fazer
 * uma lista sem filtro parecer vazia.
 */
export function chipsDosClientes(estado: EstadoDosClientes): ChipDeFiltro[] {
  if (!estado.busca) return [];
  return [
    {
      chave: "q",
      dimensao: "Busca",
      // O que a PESSOA digitou, não o normalizado: ela precisa reconhecer o
      // próprio texto para saber o que está removendo.
      valor: estado.busca,
      href: urlDaTela({ busca: "", pagina: 1 }),
    },
  ];
}

/** Há filtro ligado? É o que decide qual dos três estados vazios o R16 mostra. */
export function temFiltro(estado: EstadoDosClientes): boolean {
  return estado.busca !== "";
}

/**
 * O identificador HUMANO do cliente, para a primeira coluna — R23.
 *
 * "nunca UUID": `user_id` é a chave, e nenhuma pessoa reconhece a si mesma por
 * ela. Cliente sem nome existe (conta criada pelo e-mail, cadastro nunca
 * completado), e nesse caso o e-mail É o identificador humano. Só quando não há
 * nenhum dos dois a linha vira "Sem identificação" — e aí ela precisa aparecer
 * como tal, não como uma célula vazia que parece um defeito de carregamento.
 */
export function identificarCliente(cliente: ClienteDaLista): string {
  const nome = (cliente.name ?? "").trim();
  if (nome) return nome;
  const email = (cliente.email ?? "").trim();
  if (email) return email;
  return "Sem identificação";
}

/**
 * O e-mail para a coluna, ou o travessão.
 *
 * O backend faz `LEFT JOIN auth.users`, então `email` é NULL para o cliente
 * cuja conta do GoTrue já não existe — e `null` renderizado é uma célula vazia,
 * indistinguível de erro de carregamento. Travessão é a ausência declarada, a
 * mesma convenção de `dinheiro.ts`.
 */
export function textoOuTraco(valor: string | null | undefined): string {
  const texto = (valor ?? "").trim();
  return texto === "" ? "—" : texto;
}
