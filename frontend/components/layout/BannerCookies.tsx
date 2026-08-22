"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import {
  EVENTO_CONSENTIMENTO,
  gravarConsentimento,
  lerConsentimento,
  type Consentimento,
} from "@/lib/analytics";

/**
 * Aviso de cookies — o que a Política de privacidade promete ("cookies de
 * medição só são usados se você aceitar no aviso que aparece na primeira
 * visita").
 *
 * Componente próprio, e não o `react-cookie-consent` que sobrou nas
 * dependências do legado: o pacote traz estilo inline fora dos tokens e mais
 * opções do que este aviso precisa. Aqui são duas escolhas e uma frase.
 *
 * "Só o essencial" NÃO é um banner de "rejeitar" escondido: as duas saídas têm
 * o mesmo tamanho e o mesmo peso visual. Sessão e sacola (localStorage)
 * funcionam nos dois casos — o que muda é só o GA4, que o ScriptsAnalytics
 * carrega apenas com a escolha "aceito".
 *
 * Acessibilidade: `role="region"` nomeada para leitores de tela acharem o
 * aviso na ordem do documento; botões reais com foco visível no padrão da
 * casa. O foco NÃO é sequestrado — o aviso não impede navegar; modal de
 * consentimento que trava a página é dark pattern.
 *
 * O IDIOMA VEM POR PROP, da moldura. Um pedido de consentimento que a pessoa
 * não consegue ler não é consentimento — e o link para a Política precisa
 * levar à versão no idioma dela, senão o banner promete uma explicação e
 * entrega outra língua. Aqui, ao contrário do <AtalhosDoCliente>, o dicionário
 * é importado direto: o banner já é a única coisa da moldura que muda a página
 * inteira, e ele carrega frase, não rótulo.
 */

/**
 * A ALTURA QUE ESTE AVISO OCUPA NA BASE DA JANELA, publicada em `<html>` para
 * quem mais quiser a base da tela.
 *
 * Existe porque o aviso e a barra de compra fixa da PDP disputavam o mesmo
 * rodapé: medido em 360×800, o aviso ia de y=642,8 até 800 (157,3 px em
 * português e inglês, 180 px em espanhol) e a barra de compra ia de y=727 até
 * 800 — 73 px de sobreposição, ou seja A BARRA INTEIRA. Na primeira visita de
 * um telefone, que é a visita que converte, "Adicionar à sacola" existia, o DOM
 * o dava por visível, e dedo nenhum o alcançava.
 *
 * QUEM CEDE ESPAÇO É A BARRA, E NÃO O AVISO. Resolver por `z-index` — pôr a
 * barra na frente — deixaria comprar sem poder recusar cookie, que é pior do
 * que não comprar. O aviso fica onde está, colado na base, porque é ele que o
 * polegar precisa alcançar para se livrar dele; a barra sobe os 157/180 px
 * enquanto o aviso estiver de pé e volta à base assim que houver escolha.
 *
 * O NÚMERO É MEDIDO, NÃO CHUTADO: a altura muda com o idioma (o espanhol é
 * 23 px mais alto), com a largura e com o tamanho de fonte do sistema. Um
 * `bottom-40` cravado erraria em duas das três línguas.
 *
 * Leitores: `components/catalogo/PainelCompra.tsx` (barra de compra da PDP).
 * Quem ler, use sempre com o fallback `var(--altura-do-aviso-de-cookies, 0px)`
 * — fora da vitrine o aviso não existe e a variável não é publicada.
 */
export const VAR_ALTURA_DO_AVISO = "--altura-do-aviso-de-cookies";

export function BannerCookies({ locale }: { locale: Locale }) {
  const d = dicionario(locale);

  // `null` = ainda não sabemos (SSR e primeiro paint) — não renderiza nada
  // para o HTML do servidor bater com o do cliente. `"pendente"` = sem escolha
  // registrada, o aviso aparece.
  const [estado, setEstado] = useState<"pendente" | "decidido" | null>(null);
  const avisoRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Ouvir o evento (e não só ler na montagem) é o que faz o banner
    // REAPARECER quando o "Rever cookies" da Política revoga a escolha —
    // aceitar tem de ser tão reversível quanto foi dizer sim.
    const atualizar = () =>
      setEstado(lerConsentimento() ? "decidido" : "pendente");
    atualizar();
    window.addEventListener(EVENTO_CONSENTIMENTO, atualizar);
    return () => window.removeEventListener(EVENTO_CONSENTIMENTO, atualizar);
  }, []);

  /**
   * Publica a altura viva do aviso em `<html>` (ver VAR_ALTURA_DO_AVISO).
   *
   * `ResizeObserver` e não uma medida única: a mesma frase quebra em três
   * linhas em 360 px e em uma só em 900 px, e girar o telefone troca a altura
   * sem desmontar nada. A limpeza APAGA a variável — quando o aviso sai, a
   * barra de compra tem de voltar à base na mesma hora, senão sobra uma faixa
   * de nada no rodapé de toda PDP.
   */
  useEffect(() => {
    const raiz = document.documentElement;
    const alvo = avisoRef.current;

    if (estado !== "pendente" || !alvo) {
      raiz.style.removeProperty(VAR_ALTURA_DO_AVISO);
      return;
    }

    // SEM ARREDONDAR. A altura do aviso é fracionária (157,25 px em português)
    // e quem se apoia nela encosta o rodapé exatamente no topo do aviso.
    // Arredondar para cima abre uma fresta de sub-pixel entre os dois, e por
    // ela aparece o conteúdo escuro da página — um fio preto entre duas faixas
    // cor de cal. Arredondar para baixo esconde um naco da barra atrás do
    // aviso. O número exato faz as duas bordas coincidirem.
    const publicar = () =>
      raiz.style.setProperty(
        VAR_ALTURA_DO_AVISO,
        `${alvo.getBoundingClientRect().height}px`,
      );

    publicar();

    if (typeof ResizeObserver === "undefined") {
      return () => raiz.style.removeProperty(VAR_ALTURA_DO_AVISO);
    }
    const observador = new ResizeObserver(publicar);
    observador.observe(alvo);
    return () => {
      observador.disconnect();
      raiz.style.removeProperty(VAR_ALTURA_DO_AVISO);
    };
  }, [estado]);

  if (estado !== "pendente") return null;

  function decidir(escolha: Consentimento) {
    gravarConsentimento(escolha);
    setEstado("decidido");
  }

  return (
    <aside
      ref={avisoRef}
      role="region"
      aria-label={d.cookies.aviso}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-fuligem-20 bg-cal-puro px-4 py-4 md:px-10"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3">
        <p className="min-w-[16rem] flex-1 text-[14px] leading-relaxed text-fuligem-80">
          {d.cookies.texto}{" "}
          <Link
            href={href(locale, "/politica-de-privacidade")}
            className="text-vermelho underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            {d.rodape.politicaDePrivacidade}
          </Link>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => decidir("essencial")}
            className="h-11 rounded-bt border border-fuligem px-5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors hover:bg-fuligem hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            {d.cookies.soOEssencial}
          </button>
          <button
            type="button"
            onClick={() => decidir("aceito")}
            className="h-11 rounded-bt bg-fuligem px-5 text-[12px] font-semibold uppercase tracking-[0.1em] text-cal transition-colors hover:bg-fuligem-80 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            {d.cookies.aceitar}
          </button>
        </div>
      </div>
    </aside>
  );
}
