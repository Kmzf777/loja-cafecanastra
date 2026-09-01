import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { montarUrl } from "@/lib/painel/filtros";
import type { RespostaDeConsentimentos } from "@/lib/painel/marketing/consentimentos.logica";
import {
  RESSALVAS_DO_DISPARADOR,
  URL_DO_DISPARADOR,
  contarExclusoes,
  montarPublico,
} from "@/lib/painel/marketing/publico.logica";

import { SubNavegacao } from "../SubNavegacao";
import { Disparo } from "./Disparo";

/**
 * `/dashboard/marketing/whatsapp` — monta o público e entrega ao disparador.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * O PÚBLICO É DERIVADO, E NUNCA DIGITADO.
 *
 * Não há caixa onde colar números. Quem entra no disparo é quem tem
 * consentimento de WhatsApp registrado e VIGENTE — e "vigente" carrega o
 * trabalho todo, porque `consentimentos` é append-only e a linha «concedido» de
 * janeiro convive com a «revogado» de março. A redução está em
 * `estadoAtualPorTitular`, com teste exaustivo.
 *
 * Uma caixa de colar números daria ao gestor um caminho de um clique para
 * contornar tudo isso, e a tela existe justamente para que esse caminho não
 * exista.
 *
 * A LEITURA É DO HISTÓRICO INTEIRO, e não do filtro `estado=concedido` do
 * backend — usar o filtro incluiria quem revogou depois. Por isso a consulta é
 * `canal=whatsapp` sem filtro de estado, e a redução acontece aqui.
 * ════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: "Público de WhatsApp",
  robots: { index: false, follow: false },
};

/**
 * O teto de leitura, declarado.
 *
 * `GET /admin/consentimentos` pagina com máximo de 100 por página, e esta tela
 * lê UMA página. Não é distração: o público de WhatsApp desta loja é da ordem de
 * dezenas, e paginar aqui trocaria uma tela simples por um laço de dez idas para
 * cobrir um caso que ainda não existe. O que NÃO se pode fazer é calar sobre
 * isso — se a base passar de 100 consentimentos de WhatsApp, o público mostrado
 * fica incompleto, e a tela avisa quando chega perto.
 */
const TETO_DA_LEITURA = 100;

export default async function PaginaDeWhatsapp() {
  const acesso = await lerAcessoDoPainel();

  const resposta = await lerDaApi<RespostaDeConsentimentos>(
    montarUrl("/admin/consentimentos", {
      canal: "whatsapp",
      // SEM `estado`: o filtro do backend traria só os «concedido», e o público
      // sairia com quem revogou depois. A redução ao estado de hoje é nossa.
      limit: TETO_DA_LEITURA,
      page: 1,
    }),
  );

  const historico = resposta.ok ? resposta.dados.data : [];
  const totalNoBanco = resposta.ok ? resposta.dados.total : 0;
  const publico = montarPublico(historico);
  const exclusoes = contarExclusoes(publico.excluidos);
  const leituraIncompleta = totalNoBanco > historico.length;

  return (
    <>
      <Cabecalho
        titulo="Público de WhatsApp"
        descricao="Quem pode receber, quem ficou de fora e por quê — e a entrega ao disparador."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <SubNavegacao ativa="whatsapp" />

        {/*
          AS DUAS RESSALVAS, NO TOPO E EM TEXTO.

          A spec §4.6 as registra como "não resolvidas nesta spec", e esta tela é
          o único lugar onde o gestor vai encontrá-las. Elas ficam ANTES do
          público e da caixa de mensagem, e não num rodapé, porque as duas mudam
          O QUE É SEGURO DISPARAR — e essa decisão se toma antes de escrever a
          mensagem, não depois.

          A tarja é de ALERTA e não de erro: nada está quebrado, e pintar isto de
          vermelho gastaria a cor que esta casa reserva a erro e destruição.
        */}
        <Tarja tom="alerta">
          <span className={`block text-[11px] ${ETIQUETA}`}>
            Antes de disparar, duas coisas sobre este canal
          </span>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {RESSALVAS_DO_DISPARADOR.map((ressalva) => (
              <li key={ressalva}>{ressalva}</li>
            ))}
          </ul>
        </Tarja>

        <EstadoDaTela
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /*
            O VAZIO AQUI TEM UM SIGNIFICADO PRÓPRIO e não é "ainda não usaram a
            tela": é "ninguém autorizou". A frase manda para o lugar onde se
            conserta, que é a tela de consentimentos.
          */
          vazio={resposta.ok && historico.length === 0}
          vazioTitulo="Nenhum consentimento de WhatsApp registrado"
          vazioTexto="Sem consentimento vigente não há público, e sem público não há disparo. Registre em Consentimentos quem autorizou receber."
          vazioAcao={
            <Link
              href="/dashboard/marketing/consentimentos"
              className={`inline-flex min-h-11 items-center justify-center rounded-bt bg-fuligem px-4 text-[11px] ${ETIQUETA} leading-none text-cal transition-colors hover:bg-fuligem-80 ${FOCO}`}
            >
              Ir para Consentimentos
            </Link>
          }
        >
          <div className="space-y-4">
            {leituraIncompleta && (
              <Tarja tom="alerta">
                Esta tela lê os {TETO_DA_LEITURA} registros de consentimento de
                WhatsApp mais recentes, e a base tem{" "}
                <span data-dado>{totalNoBanco}</span>. O público abaixo está
                incompleto — a API não tem rota que devolva o público já
                reduzido, e paginar aqui é trabalho da próxima onda.
              </Tarja>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Ficha titulo="O público">
                <p className="text-[13px] text-fuligem-55">
                  Números que vão receber
                </p>
                {/*
                  O NÚMERO GRANDE É `data-dado` — monoespaçada com numeral
                  tabular, como todo número deste painel. 32px é o passo que faz
                  ele ser a primeira coisa lida da tela sem virar manchete.
                */}
                <p data-dado className="mt-1 text-[32px] leading-none">
                  {publico.total}
                </p>

                {publico.incluidos.length > 0 && (
                  <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto border-t border-fuligem-20 pt-3 text-[13px]">
                    {publico.incluidos.map((incluido) => (
                      <li
                        key={incluido.numero}
                        className="flex flex-wrap items-baseline justify-between gap-x-3"
                      >
                        <span className="min-w-0 truncate">
                          {incluido.identificacao}
                        </span>
                        <span data-dado className="text-fuligem-55">
                          {incluido.numero}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Ficha>

              {/*
                A CONTA DE QUEM FICOU DE FORA — e ela é metade da tela, não um
                rodapé. Um público que sai de 400 consentimentos e vira 180
                números sem dizer o que houve com os outros 220 é indistinguível
                de um público quebrado; e, num pedido de titular, é esta lista
                que prova que a revogação foi respeitada.
              */}
              <Ficha titulo="Quem ficou de fora, e por quê">
                {exclusoes.length === 0 ? (
                  <p className="text-[13px] text-fuligem-55">
                    Ninguém. Todo consentimento vigente virou um número no público.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {exclusoes.map((linha) => (
                      <li
                        key={linha.motivo}
                        className="border-l-2 border-fuligem-20 pl-4"
                      >
                        <p className="flex items-baseline gap-2">
                          <span data-dado className="text-[20px] leading-none">
                            {linha.quantidade}
                          </span>
                          <span className="text-[13px] text-fuligem-55">
                            {linha.quantidade === 1 ? "pessoa" : "pessoas"}
                          </span>
                        </p>
                        <p className="mt-1 max-w-[60ch] text-[13px] text-fuligem-55">
                          {linha.frase}
                        </p>
                        <ul className="mt-2 space-y-1 text-[12px] text-fuligem-55">
                          {publico.excluidos
                            .filter((e) => e.motivo === linha.motivo)
                            /* Cinco e o resto vira contagem: a lista existe para
                               a pessoa RECONHECER alguém e ir consertar, não
                               para ser um segundo relatório dentro do primeiro. */
                            .slice(0, 5)
                            .map((excluido, indice) => (
                              <li key={`${excluido.identificacao}-${indice}`}>
                                <span className="text-fuligem">
                                  {excluido.identificacao}
                                </span>{" "}
                                — {excluido.detalhe}
                              </li>
                            ))}
                          {linha.quantidade > 5 && (
                            <li>e mais {linha.quantidade - 5}.</li>
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </Ficha>
            </div>

            <Disparo publico={publico} />
          </div>
        </EstadoDaTela>

        <Ficha titulo="Para onde isto vai">
          <div className="max-w-[75ch] space-y-3 text-[13px] text-fuligem-55">
            <p>
              O painel <strong>monta o público e entrega</strong>. Quem fala com
              o WhatsApp é uma automação que vive fora deste repositório, e
              recebe a mensagem e a lista de números em{" "}
              <code className="break-all">{URL_DO_DISPARADOR}</code>.
            </p>
            <p>
              A chamada sai do <strong>servidor</strong> do painel, e não do seu
              navegador — e vai <strong>sem o seu token de acesso</strong>: aquele
              endereço não é da loja, e mandar a credencial do painel para um
              host de terceiros seria vazá-la por nada.
            </p>
            <p>
              Como o disparador não escreve de volta, esses envios{" "}
              <strong className="text-fuligem">
                não aparecem na lista de Envios
              </strong>
              . Confirme no próprio WhatsApp o que saiu.
            </p>
          </div>
        </Ficha>
      </div>
    </>
  );
}
