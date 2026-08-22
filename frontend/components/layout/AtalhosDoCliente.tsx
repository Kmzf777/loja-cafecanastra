"use client";

import Link from "next/link";
import { useSacola } from "@/lib/sacola/sacola";
import type { Dicionario } from "@/lib/i18n/dicionario";

/**
 * As seis palavras que este componente usa — e SÓ elas.
 *
 * O tipo é derivado do dicionário com `Pick`, então continua amarrado a ele:
 * renomear `nav.sacolaVazia` quebra o build aqui. O que se evita é passar o
 * objeto `Dicionario` inteiro por uma fronteira de cliente — tudo que atravessa
 * essa fronteira é SERIALIZADO no payload da rota, e o Cabeçalho renderiza este
 * componente DUAS vezes por página (barra e telefone). Seriam alguns KB de RSC
 * por navegação para mostrar duas palavras.
 */
export type RotulosDeAtalho = Pick<
  Dicionario["nav"],
  "conta" | "minhaConta" | "sacola" | "sacolaVazia"
> &
  Pick<Dicionario["comum"], "item" | "itens">;

/**
 * Sacola e conta no cabeçalho.
 *
 * Ilha client dentro de um header que é Server Component. A separação é
 * deliberada: o contador da sacola depende de estado do navegador, mas o resto
 * do header (logo, navegação, menu em <details>) continua fora do bundle de JS,
 * que é o que o comentário no topo de Cabecalho.tsx protege.
 *
 * Antes desta peça não havia link para entrar em lugar nenhum da vitrine: as
 * rotas /account e /account/login existiam e só eram alcançadas por quem
 * digitasse a URL ou fosse empurrado pelo guard do painel.
 *
 * OS DOIS DESTINOS NÃO PASSAM POR `href()` DE PROPÓSITO, e não é esquecimento
 * da costura: `/account` e `/sacola` são transacionais, vivem fora do
 * `[locale]`, e o próprio `href()` os devolveria crus. Escrevê-los diretos
 * poupa a quem lê a pergunta "por que este link ignora o idioma".
 *
 * O TEXTO vem do dicionário por prop, e não de um `dicionario(locale)` aqui
 * dentro: este é um Client Component, e importar o dicionário inteiro num
 * bundle de navegador para usar seis chaves seria pagar três idiomas em toda
 * rota. O Cabeçalho já é servidor e passa só o recorte (`RotulosDeAtalho`).
 */
export function AtalhosDoCliente({
  r,
  conta = true,
}: {
  /** Os rótulos, já no idioma da página. */
  r: RotulosDeAtalho;
  /**
   * Mostra o atalho da conta ao lado da sacola.
   *
   * FALSO NO CABEÇALHO DE TELEFONE, E ISSO FOI MEDIDO. Em 360px a barra
   * carregava logo (108px) + Conta (75px) + Sacola (87px) + Menu (91px) e os
   * vãos: 401px de conteúdo numa tela de 360, ou seja, 41px de ROLAGEM
   * HORIZONTAL no documento inteiro — em português, na home, desde antes desta
   * onda. Sem a conta a soma cai para 338px e sobra folga.
   *
   * A escolha de qual atalho sai é a que o próprio Cabeçalho já tinha
   * escrito: a sacola é o que a pessoa mais procura e não pode depender de
   * abrir o menu antes. A conta passa a viver dentro do acordeão, a um toque
   * de distância, com o rótulo por extenso que aqui não caberia.
   */
  conta?: boolean;
}) {
  const { quantidadeTotal } = useSacola();

  return (
    <div className="flex items-center gap-1">
      {conta ? (
        <Link
          href="/account"
          aria-label={r.minhaConta}
          className="flex h-11 items-center px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
        >
          {r.conta}
        </Link>
      ) : null}

      <Link
        href="/sacola"
        // O rótulo acessível carrega a contagem: o número ao lado do texto é
        // visual, e sem isto o leitor de tela anuncia só "Sacola".
        aria-label={
          quantidadeTotal > 0
            ? `${r.sacola} · ${quantidadeTotal} ${quantidadeTotal === 1 ? r.item : r.itens}`
            : r.sacolaVazia
        }
        className="flex h-11 items-center gap-2 border border-fuligem-20 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        {r.sacola}
        {quantidadeTotal > 0 ? (
          <span
            aria-hidden
            className="inline-flex min-w-5 items-center justify-center bg-vermelho px-1.5 font-dado text-[11px] leading-5 text-white"
          >
            {quantidadeTotal}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
