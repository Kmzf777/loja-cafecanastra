import Link from "next/link";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  urlDaTela,
  type EstadoDosProdutos,
  type OpcaoDeProduto,
} from "@/lib/painel/produtos/produtos.logica";

/**
 * Os filtros da lista — e todos eles são `<a href>`, não controles.
 *
 * R2 manda o filtro viver na URL, e a consequência é que um filtro É um link:
 * clicar navega, o botão Voltar DESFAZ (que é o desfazer que se espera), o
 * favorito guarda a lista filtrada e o link colado para outra pessoa abre
 * exatamente o que se estava vendo. Um `<select onChange>` daria o mesmo
 * resultado visual e nada disso — e arrastaria um `"use client"` junto.
 *
 * NÃO É UMA ABA SALVA DO R4. As abas salvas de Pedidos ("A despachar hoje") são
 * recortes NOMEADOS que o gestor visita todo dia; isto é o vocabulário do
 * próprio catálogo, vindo de `canastra.produto_opcoes` pelo `GET /options`. Por
 * isso a lista é gerada, e não escrita à mão: opção nova cadastrada na tela de
 * Ajustes aparece aqui sozinha.
 *
 * SEM OPÇÃO NENHUMA, A LINHA NÃO EXISTE. Uma faixa "Categoria: (nada)" ocupa
 * altura para informar ausência de informação — e a densidade do painel é feita
 * de não gastar linha com nada.
 */
export function FiltrosDeProduto({
  estado,
  categorias,
  embalagens,
}: {
  estado: EstadoDosProdutos;
  categorias: OpcaoDeProduto[];
  embalagens: OpcaoDeProduto[];
}) {
  return (
    <div className="space-y-2">
      <Linha
        rotulo="Categoria"
        atual={estado.categoria}
        opcoes={categorias.map((o) => o.value)}
        href={(valor) => urlDaTela({ ...estado, categoria: valor, pagina: 1 })}
      />
      <Linha
        /* "Embalagem", e nunca "Tamanho". O rótulo visível é o do café ("250 g",
           "Caixa 3×250 g"); o nome no contrato continua sendo `size`, herança da
           loja de camisetas de onde este backend veio, e renomeá-lo lá quebraria
           a vitrine. A tradução mora em `montarConsulta`. */
        rotulo="Embalagem"
        atual={estado.embalagem}
        opcoes={embalagens.map((o) => o.value)}
        href={(valor) => urlDaTela({ ...estado, embalagem: valor, pagina: 1 })}
      />
      <Linha
        rotulo="Destaque"
        atual={estado.novidade}
        opcoes={["novos", "antigos"]}
        rotuloDaOpcao={(valor) =>
          valor === "novos" ? "Destacados há 5 dias" : "Destaque antigo"
        }
        href={(valor) =>
          urlDaTela({
            ...estado,
            novidade: valor === "novos" || valor === "antigos" ? valor : "",
            pagina: 1,
          })
        }
      />
    </div>
  );
}

/**
 * Uma dimensão de filtro: o rótulo, "Todas" e os valores.
 *
 * `aria-current="true"` NO ITEM ATIVO, e não só a cor. WCAG 1.4.1: cor não pode
 * ser o único canal, e quem usa leitor de tela precisa ouvir qual dos oito
 * valores está ligado sem contar com o negrito.
 */
function Linha({
  rotulo,
  atual,
  opcoes,
  href,
  rotuloDaOpcao,
}: {
  rotulo: string;
  atual: string;
  opcoes: string[];
  href: (valor: string) => string;
  rotuloDaOpcao?: (valor: string) => string;
}) {
  if (opcoes.length === 0) return null;

  const itens = ["", ...opcoes];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>{rotulo}</p>
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {itens.map((valor) => {
          const ativo = valor === atual;
          return (
            <li key={valor || "todas"}>
              <Link
                href={href(valor)}
                aria-current={ativo ? "true" : undefined}
                /* `min-h-11` são os 44px do R22. A densidade do painel sai do
                   padding da célula da tabela, nunca do alvo do dedo. */
                className={`inline-flex min-h-11 items-center px-2 text-[13px] transition-colors ${FOCO} ${
                  ativo
                    ? "border-b-2 border-fuligem font-medium text-fuligem"
                    : "border-b-2 border-transparent text-fuligem-55 hover:text-fuligem"
                }`}
              >
                {valor === ""
                  ? "Todas"
                  : rotuloDaOpcao
                    ? rotuloDaOpcao(valor)
                    : valor}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
