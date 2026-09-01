"use client";

import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import {
  identificarCliente,
  textoOuTraco,
  type ClienteDaLista,
} from "@/lib/painel/clientes/clientes.logica";

/**
 * A tabela de clientes — e por que ela é um arquivo `"use client"` separado em
 * vez de morar dentro da `page.tsx`.
 *
 * `<Tabela>` É UM PRIMITIVO DE CLIENTE, e `Coluna.celula` é uma FUNÇÃO. Props de
 * Server Component para Client Component atravessam serializadas, e função não
 * serializa: com as colunas declaradas na `page.tsx` (que é Server Component), o
 * React lança
 *
 *     Functions cannot be passed directly to Client Components unless you
 *     explicitly expose it by marking it with "use server".
 *
 * ISSO NÃO APARECE NO `next build`, e é por isso que o comentário é longo: as
 * rotas sob `/dashboard` são dinâmicas (`ƒ`), então nenhuma delas é
 * prerenderizada durante a compilação — o erro só existiria em tempo de
 * execução, na cara do gestor, com a tela inteira em branco. Foi medido de
 * propósito, com uma rota estática temporária montando exatamente esta tabela: o
 * build falhou com a frase acima.
 *
 * A FRONTEIRA MORA AQUI, ENTÃO, e o que atravessa é só DADO: `linhas` é um array
 * de objetos simples, exatamente como a API o entregou. A `page.tsx` continua
 * sendo Server Component, continua buscando no servidor e continua sem enviar
 * nenhuma lógica de decisão para o navegador.
 *
 * `proibicoes.test.ts` tem uma guarda estrutural para isto: todo arquivo que
 * importa `<Tabela>` precisa declarar `"use client"`.
 */

/**
 * As colunas, e a primeira delas é o R23.
 *
 * "primeira coluna é identificador humano, nunca UUID" — `identificarCliente`
 * devolve nome, ou o e-mail de quem nunca completou o cadastro, ou o texto "Sem
 * identificação". A `<Tabela>` transforma a primeira coluna em `<th scope="row">`
 * sozinha, o que faz o leitor de tela anunciar "Maria Souza, Compras, 3" ao
 * andar pela linha em vez de "3" solto.
 *
 * `dado: true` em TELEFONE E COMPRAS: os dois são número, e a monoespaçada com
 * numeral tabular do `globals.css` é o que faz comparar valores numa coluna ser
 * comparar POSIÇÃO e não comprimento de string. E-mail não é dado numérico — é
 * texto, e alinhado à direita ficaria ilegível.
 *
 * NENHUMA COLUNA É ORDENÁVEL, e isso é honestidade, não esquecimento:
 * `GET /auth/users` ordena por `criado_em DESC` e não aceita parâmetro de
 * ordenação. Um cabeçalho clicável que não ordena é pior que um cabeçalho
 * quieto — a `<Tabela>` desta casa só desenha a seta quando recebe `aoOrdenar`,
 * justamente para isso não acontecer por distração.
 */
const COLUNAS: Coluna<ClienteDaLista>[] = [
  {
    chave: "cliente",
    rotulo: "Cliente",
    celula: (linha) => identificarCliente(linha),
  },
  {
    chave: "email",
    rotulo: "E-mail",
    celula: (linha) => textoOuTraco(linha.email),
  },
  {
    chave: "telefone",
    rotulo: "Telefone",
    dado: true,
    celula: (linha) => textoOuTraco(linha.phone),
  },
  {
    chave: "compras",
    rotulo: "Compras",
    dado: true,
    // `purchases` é `count(*)::int` no backend, então zero é ZERO de verdade —
    // conta criada e nada comprado. Não é ausência, e por isso não vira "—":
    // trocar um zero medido por um travessão apagaria a informação mais útil
    // desta coluna, que é quem se cadastrou e nunca voltou.
    celula: (linha) => linha.purchases ?? 0,
  },
];

export function TabelaDeClientes({ linhas }: { linhas: ClienteDaLista[] }) {
  return (
    <Tabela
      legenda="Clientes da loja"
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.user_id}
    />
  );
}
