import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { totalDePaginas } from "@/lib/painel/paginacao";
import {
  POR_PAGINA,
  ROTA_DE_ENVIOS,
  chipsDosEnvios,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
  type EstadoDosEnvios,
  type RespostaDeEnvios,
} from "@/lib/painel/marketing/envios.logica";
import { CANAIS_DE_CONTATO, ESTADOS_DE_ENVIO } from "@/lib/painel/marketing/vocabulario";

import { SubNavegacao } from "../SubNavegacao";
import { TabelaDeEnvios } from "./TabelaDeEnvios";

/**
 * `/dashboard/marketing/envios` — o log por destinatário.
 *
 * A PERGUNTA QUE ELA RESPONDE é sempre a mesma e é sempre urgente: "a Ana
 * recebeu?". É a única tela desta área que olha para uma mensagem individual, e
 * por isso o atalho mais importante dela é o filtro «Falhou» — quem abre esta
 * tela sem filtro está passeando; quem abre com ele está resolvendo alguma
 * coisa.
 *
 * O QUE ESTA TELA NÃO FAZ: criar envio. `POST /admin/envios` existe, mas um
 * envio criado à mão daqui não MANDA nada — a tabela é um registro do que os
 * jobs e os disparadores fizeram, e um botão "novo envio" gravaria uma linha
 * dizendo que uma mensagem saiu quando nenhuma saiu. É a mesma família de
 * defeito do "Produto deletado!" com o produto intacto, só que na direção
 * contrária: um registro que mente sobre o mundo.
 */
export const metadata: Metadata = {
  title: "Envios",
  robots: { index: false, follow: false },
};

export default async function PaginaDeEnvios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);
  const resposta = await lerDaApi<RespostaDeEnvios>(montarConsulta(pedido));

  const dados = resposta.ok ? resposta.dados : null;
  const linhas = dados?.data ?? [];
  const total = dados?.total ?? 0;
  const estado = { ...pedido, pagina: dados?.page ?? pedido.pagina };

  return (
    <>
      <Cabecalho
        titulo="Envios"
        descricao="Cada mensagem que a loja mandou, para quem, e onde ela parou."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <SubNavegacao ativa="envios" />

        <div className="space-y-3">
          <FiltroEmLinha
            titulo="Estado"
            estado={estado}
            campo="estado"
            opcoes={ESTADOS_DE_ENVIO}
          />
          <FiltroEmLinha
            titulo="Canal"
            estado={estado}
            campo="canal"
            opcoes={CANAIS_DE_CONTATO}
          />
        </div>

        <ChipsDeFiltro chips={chipsDosEnvios(estado)} hrefLimpar={ROTA_DE_ENVIOS} />

        <EstadoDaTela
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* ZERO É PLAUSÍVEL — e nesta tela mais que nas outras: uma loja que
             ainda não disparou nada tem zero envios de verdade. `vazio` só é
             verdadeiro quando a leitura DEU CERTO. */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhuma mensagem registrada"
          vazioTexto="O job de carrinho abandonado e os disparos manuais escrevem aqui quando acontecem."
        >
          <Ficha semPreenchimento>
            <TabelaDeEnvios linhas={linhas} />
            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPages ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              href={(pagina) => urlDaTela({ ...estado, pagina })}
              rotuloDoItem={{ singular: "envio", plural: "envios" }}
            />
          </Ficha>
        </EstadoDaTela>

        <Ficha titulo="O que esta lista alcança">
          <div className="max-w-[75ch] space-y-3 text-[13px] text-fuligem-55">
            <p>
              A tabela registra o que os <strong>jobs e disparadores</strong>{" "}
              escreveram nela. Um disparo de WhatsApp feito por esta área vai
              direto ao webhook externo, que não escreve aqui — então{" "}
              <strong className="text-fuligem">
                nem toda mensagem que a loja manda aparece nesta lista
              </strong>
              .
            </p>
            <p>
              Quando o estado é <strong>Falhou</strong>, a coluna «O que
              aconteceu» mostra a frase do próprio provedor. É ela que diz se o
              conserto é corrigir um contato ou refazer o cadastro — o rótulo
              genérico não diria nem uma coisa nem outra.
            </p>
            <p>
              Não há como criar um envio por esta tela, de propósito: gravar uma
              linha aqui não faz mensagem nenhuma sair, e o registro passaria a
              afirmar algo que não aconteceu.
            </p>
          </div>
        </Ficha>
      </div>
    </>
  );
}

/** Mesma faixa de filtros da tela de consentimentos, pelo mesmo motivo: são
 *  links, então esta tela não paga uma ilha de cliente por eles. */
function FiltroEmLinha({
  titulo,
  estado,
  campo,
  opcoes,
}: {
  titulo: string;
  estado: EstadoDosEnvios;
  campo: "canal" | "estado";
  opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
}) {
  const todos = [{ valor: "", rotulo: "Todos" }, ...opcoes];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`w-16 text-[10px] ${ETIQUETA} text-fuligem-55`}>{titulo}</span>
      {todos.map((opcao) => {
        const aceso = estado[campo] === opcao.valor;
        const href = urlDaTela({ ...estado, [campo]: opcao.valor, pagina: 1 });

        return aceso ? (
          <span
            key={opcao.valor || "todos"}
            aria-current="true"
            className={`inline-flex min-h-11 items-center rounded-bt bg-fuligem px-3 text-[11px] ${ETIQUETA} text-cal`}
          >
            {opcao.rotulo}
          </span>
        ) : (
          <Link
            key={opcao.valor || "todos"}
            href={href}
            className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-fuligem hover:bg-cal hover:text-fuligem ${FOCO}`}
          >
            {opcao.rotulo}
          </Link>
        );
      })}
    </div>
  );
}
