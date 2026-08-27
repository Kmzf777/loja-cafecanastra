"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  urlDaTela,
  type EstadoDosPedidos,
} from "@/lib/painel/pedidos/pedidos.logica";

/**
 * O RECORTE DE PERÍODO — a segunda ilha de cliente desta tela, e a única
 * porque um `<input type="date">` tem estado enquanto se escolhe.
 *
 * O RESULTADO VAI PARA A URL (R2), como todo filtro daqui: voltar do detalhe
 * devolve o mesmo mês, o F5 não perde nada, e "os pedidos de agosto" é um link
 * que se manda para o contador.
 *
 * E ESTE MESMO PERÍODO É O DA EXPORTAÇÃO. É o que aproxima esta tela do R27
 * ("exportação espelha filtro") até onde o backend permite: `/admin/orders` e
 * `/admin/orders/export` aceitam os mesmos `de` e `ate`, então o arquivo cobre
 * exatamente a janela que está na tela. O que a rota do CSV NÃO aceita —
 * status, busca, recorte de NF-e — está escrito no diálogo de exportação, em
 * vez de silenciosamente ignorado.
 *
 * `type="date"` NATIVO, e não um calendário desenhado: ele traz o formato do
 * sistema (dd/mm/aaaa num Windows em português), o teclado numérico no celular
 * e a navegação por setas de graça — e o valor que ele emite é sempre
 * `YYYY-MM-DD`, que é exatamente o que o backend exige e recusa com frase
 * quando vem diferente.
 */
export function FiltroDePeriodo({ estado }: { estado: EstadoDosPedidos }) {
  const router = useRouter();

  /**
   * O estado local SE RENDE À URL, sem `useEffect` e sem `key` — o mesmo padrão
   * de `BuscaDaLista`. O caso é o chip "Período ✕": ele é um `<a>`, navega para
   * a lista sem `de`/`ate`, e sem esta reconciliação os dois campos
   * continuariam mostrando as datas de um filtro que já saiu — a tela se
   * contradizendo em dois lugares.
   */
  const [de, setDe] = useState(estado.de);
  const [ate, setAte] = useState(estado.ate);
  const [ultimoDe, setUltimoDe] = useState(estado.de);
  const [ultimoAte, setUltimoAte] = useState(estado.ate);
  if (estado.de !== ultimoDe || estado.ate !== ultimoAte) {
    setUltimoDe(estado.de);
    setUltimoAte(estado.ate);
    setDe(estado.de);
    setAte(estado.ate);
  }

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // A PÁGINA VOLTA PARA 1: recortar um período estando na página 7 é o jeito
    // mais rápido de um filtro com resultados parecer vazio.
    router.push(urlDaTela({ ...estado, de, ate, pagina: 1 }));
  }

  const mudou = de !== estado.de || ate !== estado.ate;

  return (
    <form onSubmit={aplicar} className="flex flex-wrap items-end gap-3">
      <Data rotulo="De" valor={de} aoMudar={setDe} />
      <Data rotulo="Até" valor={ate} aoMudar={setAte} />

      {/* O ESPAÇADOR ESPELHA A ESTRUTURA DO CAMPO — uma linha de rótulo
          invisível na mesma tipografia —, que é o que faz o botão nascer
          alinhado com os INPUTS e não com os rótulos. A alternativa seria um
          `mt-[26px]` medido a olho, que quebra em silêncio no dia em que a
          fonte da interface mudar de métrica. */}
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className={`text-[11px] ${ETIQUETA} invisible`}>
          Aplicar
        </span>
        <Botao type="submit" variante="secundaria" disabled={!mudou}>
          Aplicar período
        </Botao>
      </div>
    </form>
  );
}

function Data({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>{rotulo}</span>
      <input
        type="date"
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value)}
        // `data-dado` porque data é dado: a monoespaçada com numeral tabular
        // alinha os dois campos um sob o outro.
        data-dado
        className={`min-h-11 rounded-bt border border-fuligem-20 bg-cal-puro px-3 text-fuligem hover:border-fuligem-55 ${FOCO}`}
      />
    </label>
  );
}
