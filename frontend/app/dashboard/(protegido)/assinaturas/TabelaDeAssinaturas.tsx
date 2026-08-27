"use client";

import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import {
  cafeDaAssinatura,
  frequenciaEmTexto,
  identificarAssinatura,
  rotuloDeStatus,
  tomDeStatus,
  type Assinatura,
} from "@/lib/painel/assinaturas/assinaturas.logica";
import { formatarData } from "@/lib/painel/data";
import { formatarCentavos } from "@/lib/painel/dinheiro";

/**
 * A tabela de assinaturas — arquivo `"use client"` separado pela MESMA razão de
 * `TabelaDeClientes.tsx`, e ela está escrita lá por extenso: `Coluna.celula` é
 * uma FUNÇÃO, `<Tabela>` é um primitivo de cliente, e função não atravessa a
 * fronteira Server→Client. Com as colunas na `page.tsx` o React lança "Functions
 * cannot be passed directly to Client Components" — e o `next build` NÃO pega,
 * porque as rotas sob `/dashboard` são dinâmicas e nunca são prerenderizadas.
 *
 * O que atravessa a fronteira aqui é só DADO: `linhas`, exatamente como a API a
 * entregou.
 */

/**
 * As colunas. A primeira é o R23 — identificador HUMANO, nunca UUID.
 *
 * O E-MAIL VAI NA MESMA CÉLULA DO NOME, numa segunda linha, e não numa coluna
 * própria: numa tabela de sete colunas, o e-mail sozinho rouba largura de "Café"
 * e de "Por cobrança", que é onde o olho precisa comparar. Junto do nome ele
 * cumpre o papel que tem — desempatar dois clientes homônimos — sem ocupar uma
 * coluna inteira para isso.
 *
 * `dado: true` em FREQUÊNCIA, VALOR e nas duas DATAS: R23, numeral tabular,
 * comparação por posição. "Café" e "Cliente" são texto.
 *
 * NENHUMA COLUNA É ORDENÁVEL — `GET /admin/assinaturas` devolve tudo ordenado
 * por `criado_em DESC`, e ordenar em memória seria possível, mas é regra de
 * negócio (o que fazer com nulo, se é estável) e teria de morar no módulo puro
 * com testes. Fica para quando houver pedido de gente: um cabeçalho clicável que
 * não ordena é pior que um cabeçalho quieto.
 */
const COLUNAS: Coluna<Assinatura>[] = [
  {
    chave: "cliente",
    rotulo: "Cliente",
    celula: (linha) => (
      <>
        <span className="block">{identificarAssinatura(linha)}</span>
        {linha.cliente_email && linha.cliente_email !== "—" && (
          <span className="block truncate text-[12px] font-normal text-fuligem-55">
            {linha.cliente_email}
          </span>
        )}
      </>
    ),
  },
  {
    chave: "cafe",
    rotulo: "Café",
    celula: (linha) => (
      <>
        <span className="block">{cafeDaAssinatura(linha)}</span>
        <span className="block text-[12px] font-normal text-fuligem-55">
          {/* A quantidade é número, então é `data-dado` mesmo fora de uma coluna
              marcada como tal — a regra do R23 é do DADO, não da coluna. */}
          <span data-dado>{linha.quantidade}</span> por remessa
        </span>
      </>
    ),
  },
  {
    chave: "frequencia",
    rotulo: "A cada",
    dado: true,
    celula: (linha) => frequenciaEmTexto(linha.frequencia_dias),
  },
  {
    chave: "valor",
    rotulo: "Por cobrança",
    dado: true,
    /*
      `preco_centavos` É INTEGER, EM CENTAVOS — e é por isso que a chamada é
      `formatarCentavos` e não `formatarReais`. O mesmo schema devolve as duas
      unidades (`pedidos.total` é numeric em REAIS), e é exatamente por isso que
      `dinheiro.ts` tem a unidade no nome: trocar as duas faz R$ 59,00 virar
      R$ 0,59 sem nenhum sinal na tela.
    */
    celula: (linha) => formatarCentavos(linha.preco_centavos),
  },
  {
    chave: "status",
    rotulo: "Status",
    celula: (linha) => (
      <Selo tom={tomDeStatus(linha.status)}>{rotuloDeStatus(linha.status)}</Selo>
    ),
  },
  {
    chave: "inicio",
    rotulo: "Adesão",
    dado: true,
    // dd/mm/aaaa no fuso de São Paulo — R31. Uma adesão das 22h carimbada em
    // UTC apareceria no dia seguinte.
    celula: (linha) => formatarData(linha.criado_em),
  },
  {
    chave: "fim",
    rotulo: "Encerrada",
    dado: true,
    // Travessão para quem não foi cancelada: ausência é diferente de zero, e uma
    // célula vazia parece defeito de carregamento.
    celula: (linha) => formatarData(linha.cancelada_em),
  },
];

export function TabelaDeAssinaturas({ linhas }: { linhas: Assinatura[] }) {
  return (
    <Tabela
      legenda="Assinaturas do Clube"
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.id}
    />
  );
}
