"use client";

import type { ReactNode } from "react";
import { Tarja } from "./Tarja";
import { FOCO } from "./estilos";

/**
 * O botão que se parece com um link — usado só dentro dos estados abaixo.
 *
 * É `<button>` e não `<a>` porque não navega para lugar nenhum: refaz a busca,
 * limpa o filtro. Um `<a href="#">` aqui daria ao leitor de tela a promessa de
 * um destino que não existe, e ao teclado o comportamento errado (Enter navega,
 * Espaço não aciona).
 */
const ACAO_EM_TEXTO = `underline underline-offset-4 decoration-1 hover:decoration-2 ${FOCO}`;

/**
 * Os quatro estados de uma tela de dados — e por que "vazio" não é um deles
 * quando houve erro.
 *
 * Zero produtos, zero pedidos e zero vendas são números PERFEITAMENTE
 * PLAUSÍVEIS. Mostrar o estado inicial depois de um fetch que falhou é
 * informação errada apresentada com toda a confiança: o gestor lê "não vendi
 * nada hoje" quando o certo era "não consegui perguntar". Isso é pior do que
 * não mostrar nada, e o painel legado documenta a lição em HomeDashboard.jsx.
 *
 * A ORDEM DAS GUARDAS É A REGRA: carregando → erro → vazio → conteúdo. Um
 * `if (!lista.length) return <Vazio/>` colocado antes do teste de erro apaga a
 * distinção em toda tela de uma vez.
 *
 * R16: três estados vazios distintos, com textos e ações diferentes.
 */
export function EstadoDaTela({
  carregando,
  erro,
  vazio,
  filtroAtivo,
  aoLimparFiltro,
  aoTentarDeNovo,
  esqueleto,
  vazioTitulo,
  vazioTexto,
  vazioFiltroTexto,
  vazioAcao,
  children,
}: {
  carregando: boolean;
  erro: string | null;
  vazio: boolean;
  filtroAtivo?: boolean;
  aoLimparFiltro?: () => void;
  aoTentarDeNovo?: () => void;
  esqueleto: ReactNode;
  vazioTitulo: string;
  vazioTexto: string;
  /**
   * A frase do vazio COM FILTRO, quando a tela sabe dizer algo melhor.
   *
   * O padrão ("Nenhum resultado para este filtro") é o certo para um filtro
   * qualquer: ele não afirma nada que possa estar errado. Mas há filtro cuja
   * ausência de resultado é a INFORMAÇÃO que o gestor foi buscar — a fila do
   * Bling escreveu uma frase para cada um dos seus cinco recortes justamente por
   * isso ("Todos os pedidos pagos desta página já estão no Bling"), e "nenhum
   * resultado" no lugar dela desperdiça a única resposta útil da tela.
   *
   * Opcional, e não obrigatório em todas as telas: quem não tem nada melhor a
   * dizer fica com o padrão, que é sempre verdadeiro.
   */
  vazioFiltroTexto?: string;
  vazioAcao?: ReactNode;
  children: ReactNode;
}) {
  if (carregando) return <>{esqueleto}</>;

  if (erro) {
    return (
      <Tarja tom="erro">
        {erro}
        {aoTentarDeNovo && (
          <>
            {" "}
            <button type="button" onClick={aoTentarDeNovo} className={ACAO_EM_TEXTO}>
              Tentar de novo
            </button>
          </>
        )}
      </Tarja>
    );
  }

  if (vazio && filtroAtivo) {
    return (
      <div className="rounded-cx border border-fuligem-20 bg-cal-puro px-6 py-10 text-center">
        <p className="text-fuligem-55">
          {vazioFiltroTexto || "Nenhum resultado para este filtro."}
        </p>
        {aoLimparFiltro && (
          <button
            type="button"
            onClick={aoLimparFiltro}
            /* `inline-flex min-h-11` e não só `mt-2`: aqui a ação está sozinha
               numa linha, então dá para lhe garantir os 44px do R22 sem
               empurrar texto nenhum. O "Tentar de novo" lá em cima fica no meio
               da frase do erro e não pode crescer sem quebrar a linha. */
            className={`mt-2 inline-flex min-h-11 items-center ${ACAO_EM_TEXTO}`}
          >
            Limpar filtros
          </button>
        )}
      </div>
    );
  }

  if (vazio) {
    return (
      <div className="rounded-cx border border-fuligem-20 bg-cal-puro px-6 py-10 text-center">
        <p className="font-medium">{vazioTitulo}</p>
        <p className="mt-1 text-fuligem-55">{vazioTexto}</p>
        {vazioAcao && <div className="mt-4">{vazioAcao}</div>}
      </div>
    );
  }

  return <>{children}</>;
}
