/**
 * A PÁGINA — e só isso. O componente mora em `TelaDeConexao.tsx`, ao lado.
 *
 * O CORTE EXISTE POR UMA REGRA DO APP ROUTER, não por gosto. O default export
 * de uma página só aceita o contrato dela (`params`, `searchParams`): qualquer
 * prop própria faz o `next build` recusar a página inteira com
 * "has an invalid default export".
 *
 * E a tela PRECISA de uma prop própria — `aoNavegar`, por onde o teste observa
 * a ida ao Bling. Com o componente ao lado, a página fica sem props e a costura
 * de teste vive onde pode viver.
 *
 * A armadilha que isto fecha: `tsc --noEmit` passa com a prop no lugar errado,
 * porque a validação do contrato de página é do NEXT e não do TypeScript. Só
 * `next build` reprova. Quem mexer aqui e quiser conferir, rode o build — o
 * typecheck sozinho dá um verde que não vale.
 *
 * Esta página nao leva `"use client"`: ele mora no componente, com quem usa
 * estado. Componente de servidor renderizando um de cliente e o arranjo normal.
 */
import { TelaDeConexao } from "./TelaDeConexao";

export default function PaginaDeConexaoComOBling() {
  return <TelaDeConexao />;
}
