"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lote, Moagem, PesoGramas } from "@/lib/catalogo/tipos";
import { MOAGENS } from "@/lib/catalogo/tipos";
import {
  acharVariante,
  embalagensDe,
  formatarPreco,
  precoParaLeitor,
} from "@/lib/catalogo/repositorio";
import { Botao, BotaoLink } from "@/components/ui/Botao";
// Só o nome da variável CSS, não o componente: é o contrato de quem manda na
// base da janela. Ver o comentário longo em BannerCookies.tsx.
import { VAR_ALTURA_DO_AVISO } from "@/components/layout/BannerCookies";
import { useSacola } from "@/lib/sacola/sacola";
import { eventoAddToCart } from "@/lib/analytics";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * Painel de compra da PDP — estetica.md §5.5, §5.6 e §7.3.
 *
 * Reune tres pecas do documento que so fazem sentido juntas porque
 * compartilham o mesmo estado (moagem, peso, modo):
 *   §5.6 <ModoCompra>     — abas Compra unica / Assinatura, ACIMA do preco
 *   §5.5 <SeletorMoagem>  — grao ou moido, padrao "Grao"
 *        peso             — 250 / 500 / 1000 g
 *
 * O §5.5 pedia SETE botoes, um por metodo de preparo, e este painel os tinha.
 * Eram sete opcoes para dois produtos: os seis metodos apontavam todos para o
 * mesmo SKU moido, com o mesmo preco e o mesmo estoque. O metodo continua na
 * pagina, na secao "Como preparar", que e onde ele sempre foi orientacao de
 * receita em vez de escolha de prateleira.
 *
 * Combinacao inexistente e DESABILITADA, nunca escondida (§5.5): uma linha so
 * em grao precisa mostrar que "Moido" existe no catalogo e falta nela.
 */

const PESOS: PesoGramas[] = [250, 500, 1000];

/**
 * O rótulo da moagem COMO ELE É GRAVADO NA SACOLA — em português, nos três
 * idiomas da vitrine.
 *
 * A sacola, o checkout e a conta são pt-BR por decisão (spec §1), e este texto
 * não é rótulo de tela: ele viaja com o item para o `localStorage`, para a RPC
 * e para o funil do GA4. O botão logo abaixo mostra `d.catalogo.moagem[m]`, no
 * idioma de quem está lendo; o que fica guardado é este.
 */
const MOAGEM_NA_SACOLA = dicionario(LOCALE_PADRAO).catalogo.moagem;

function rotuloPeso(g: PesoGramas) {
  return g === 1000 ? "1 kg" : `${g} g`;
}

export function PainelCompra({
  lote,
  locale = LOCALE_PADRAO,
}: {
  lote: Lote;
  /**
   * O idioma da PDP. Ele decide DUAS coisas aqui: para onde vão os dois links
   * do Clube — crus, eles atravessavam a fronteira do idioma no meio do funil
   * de assinatura — e todo o texto do painel, que sai de `d.pdp` e `d.venda`.
   *
   * O QUE NÃO SEGUE O IDIOMA É O QUE FICA GRAVADO: a moagem que viaja com o
   * item para o localStorage, para a RPC e para o funil do GA4 é sempre o
   * português (ver `MOAGEM_NA_SACOLA` acima). Rótulo de tela e dado gravado
   * são coisas diferentes, e esta é a linha entre os dois.
   */
  locale?: Locale;
}) {
  const d = dicionario(locale);
  /**
   * O estado inicial sai do catalogo, nao de constantes.
   *
   * "Grao, 250 g" e o padrao do §5.5, mas nem toda linha o tem — o Microlote so
   * existe em 250 g em grao, e uma linha so moida nao tem "grao" nenhum. Fixar
   * o padrao no codigo abria a PDP ja num estado invalido, mostrando "Esgotado"
   * num cafe disponivel.
   */
  const inicial =
    lote.variantes.find((v) => v.moagem === "grao" && v.pesoGramas === 250) ??
    lote.variantes.find((v) => v.estoque > 0) ??
    lote.variantes[0];

  const [moagem, setMoagem] = useState<Moagem>(inicial?.moagem ?? "grao");
  const [peso, setPeso] = useState<PesoGramas>(inicial?.pesoGramas ?? 250);
  const [pacotes, setPacotes] = useState<number>(inicial?.pacotes ?? 1);
  const [assinando, setAssinando] = useState(false);
  const [quantidade, setQuantidade] = useState(1);

  const { adicionar } = useSacola();
  const [adicionado, setAdicionado] = useState(false);
  const [erroDaSacola, setErroDaSacola] = useState<string | null>(null);

  /**
   * §10 — em mobile a PDP ganha barra de compra fixa no rodape. Ela SOME
   * enquanto o botao original esta na tela, e so por isso: duas vezes o mesmo
   * "Adicionar a sacola" na mesma dobra e ruido, e a barra ainda roubaria
   * altura util da propria area de compra. Fora dessa janela ela aparece —
   * inclusive acima do botao, no comeco da pagina, que e onde a foto grande
   * empurra o preco para longe.
   */
  const ctaRef = useRef<HTMLDivElement>(null);
  const [ctaVisivel, setCtaVisivel] = useState(true);

  useEffect(() => {
    const alvo = ctaRef.current;
    if (!alvo || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([e]) => setCtaVisivel(e.isIntersecting),
      { rootMargin: "0px 0px -72px 0px" },
    );
    obs.observe(alvo);
    return () => obs.disconnect();
  }, []);

  const variante = acharVariante(lote, moagem, peso, pacotes);
  const indisponivel = !variante || variante.estoque === 0;

  /**
   * Teto do stepper: min(20, estoque) quando o estoque AO VIVO é conhecido —
   * `produtoId` presente significa que preço e estoque vieram do banco
   * (repositorio.ts). Sem API (modo contingência do JSON), o teto fica nos 20
   * de sempre: o número do JSON pode estar velho, e quem confere de verdade é
   * o servidor na hora de cobrar. Deixar pedir 20 de um estoque de 3 só para o
   * checkout recusar depois é atrito que dá para evitar aqui.
   */
  const estoqueConhecido = Boolean(variante?.produtoId) && (variante?.estoque ?? 0) > 0;
  const teto = estoqueConhecido ? Math.min(20, variante!.estoque) : 20;

  // Trocar de combinação pode encolher o teto para baixo da quantidade já
  // escolhida — puxa de volta, senão o pedido nasce maior que a prateleira.
  useEffect(() => {
    setQuantidade((q) => Math.min(q, teto));
  }, [teto]);

  /** Embalagens (avulso, caixa com 3, caixa com 4) da combinação escolhida. */
  const embalagens = useMemo(
    () => embalagensDe(lote, moagem, peso),
    [lote, moagem, peso],
  );

  /**
   * Trocar de moagem ou de peso pode deixar `pacotes` apontando para uma caixa
   * que não existe naquela combinação — e aí o painel mostra "Esgotado" sem que
   * nada esteja esgotado. Este efeito puxa a seleção de volta para a embalagem
   * mais próxima disponível.
   */
  useEffect(() => {
    if (embalagens.length && !embalagens.includes(pacotes)) {
      setPacotes(embalagens[0]);
    }
  }, [embalagens, pacotes]);

  /**
   * Coloca a combinação escolhida na sacola.
   *
   * `produtoId` só existe quando a API respondeu (ver repositorio.ts): sem ele
   * o backend não teria como identificar o item, então o botão avisa em vez de
   * fingir que guardou. É o caso de contingência em que a vitrine está de pé
   * lendo o JSON mas a API está fora.
   */
  async function aoAdicionar() {
    if (!variante) return;
    setErroDaSacola(null);

    if (!variante.produtoId) {
      setErroDaSacola(d.venda.semLoja);
      return;
    }

    try {
      await adicionar({
        product_id: variante.produtoId,
        name: `${lote.nome} — ${variante.rotuloEmbalagem}`,
        price: variante.preco / 100,
        quantity: quantidade,
        image: lote.fotos.pacote.src,
        size: variante.rotuloEmbalagem,
        // EM PORTUGUÊS, SEMPRE, e não no idioma da página: a sacola é pt-BR
        // por decisão (spec §1) e este rótulo é dado GRAVADO — ele entra na
        // chave do item e volta na próxima sessão. Ver `normalizarMoagem`
        // em lib/sacola/fusao.ts, que é o outro lado desta regra.
        moagem: MOAGEM_NA_SACOLA[variante.moagem],
        // Identidade estável do funil GA4 — o begin_checkout da sacola reporta
        // este mesmo id. Ver o comentário de `sku` em lib/sacola/sacola.tsx.
        sku: variante.skuLoja,
      });
      // Depois do sucesso, nunca antes: um add_to_cart de item que a sacola
      // recusou seria numero inventado no funil. No-op sem gtag (consentimento
      // negado ou GA4 sem env) — ver lib/analytics.ts.
      eventoAddToCart({
        id: variante.skuLoja,
        nome: `${lote.nome} — ${variante.rotuloEmbalagem}`,
        precoCentavos: variante.preco,
        quantidade,
        // Também em português: é dimensão de funil do GA4, e um relatório que
        // recebesse "Ground" e "Moído" contaria o mesmo produto duas vezes.
        variante: MOAGEM_NA_SACOLA[variante.moagem],
      });
      setAdicionado(true);
      window.setTimeout(() => setAdicionado(false), 2500);
    } catch {
      setErroDaSacola(d.venda.naoDeuParaAdicionar);
    }
  }

  const desconto = lote.assinatura?.desconto ?? 0;
  const precoBase = variante?.preco ?? 0;
  const preco = assinando ? Math.round(precoBase * (1 - desconto)) : precoBase;

  /** Pesos que existem para a moagem escolhida — muda a cada troca de moagem. */
  const pesosValidos = useMemo(
    () =>
      new Set(
        lote.variantes.filter((v) => v.moagem === moagem).map((v) => v.pesoGramas),
      ),
    [lote.variantes, moagem],
  );

  const moagensValidas = useMemo(
    () => new Set(lote.variantes.map((v) => v.moagem)),
    [lote.variantes],
  );

  return (
    <div>
      {/* ── §5.6 Modo de compra: duas abas grandes, nao um checkbox escondido ── */}
      {lote.assinatura ? (
        <div
          role="tablist"
          aria-label={d.pdp.modoDeCompra}
          className="grid grid-cols-2 border border-fuligem"
        >
          {[
            { id: false, rotulo: d.pdp.compraUnica, valor: precoBase },
            {
              // O desconto vem colado ao rótulo da navegação — "Assinatura",
              // "Subscription", "Suscripción" — em vez de ter chave própria:
              // é a mesma palavra que o cabeçalho usa para a mesma porta.
              id: true,
              rotulo: `${d.nav.assinatura} −${Math.round(desconto * 100)}%`,
              valor: Math.round(precoBase * (1 - desconto)),
            },
          ].map((aba) => (
            <button
              key={String(aba.id)}
              role="tab"
              aria-selected={assinando === aba.id}
              onClick={() => setAssinando(aba.id)}
              className={`px-4 py-3 text-left transition-colors ${
                assinando === aba.id
                  ? "bg-fuligem text-cal"
                  : "bg-transparent hover:bg-fuligem-20/40"
              }`}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em]">
                {aba.rotulo}
              </span>
              <span className="mt-1.5 block font-dado text-[17px]">
                {formatarPreco(aba.valor)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="font-dado text-[26px]" aria-label={precoParaLeitor(preco)}>
          {formatarPreco(preco)}
        </p>
      )}

      {/* Até a Onda 3J esta aba FINGIA a compra: mostrava o preço com -10% e
          um seletor de frequência, mas o "Adicionar" cobrava o preço cheio de
          uma compra avulsa — exatamente o tipo de botão-que-mente que este
          projeto veio consertar. Agora a aba é a PORTA do Clube real: o botão
          leva ao wizard de /clube (que pré-seleciona café e moagem pela
          query) e é lá que frequência, endereço e a autorização no Mercado
          Pago acontecem. */}
      {assinando && lote.assinatura ? (
        <p className="mt-4 border border-fuligem-20 p-4 text-[14px] leading-relaxed text-fuligem-80">
          {d.pdp.clubeExplicacao}
        </p>
      ) : null}

      {/* ── §5.5 Moagem ────────────────────────────────────────────────────── */}
      <fieldset className="mt-8">
        <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          {d.pdp.rotulo.moagem}
        </legend>
        {/* Duas colunas em qualquer largura: com dois botões, `grid-cols-2`
            já cabe folgado em 360 px e evita que um deles fique órfão numa
            segunda linha quando a grade cresce. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {MOAGENS.map((m) => {
            const existe = moagensValidas.has(m);
            return (
              <button
                key={m}
                onClick={() => setMoagem(m)}
                disabled={!existe}
                aria-pressed={moagem === m}
                title={existe ? undefined : d.pdp.semEstaMoagem}
                className={`min-h-12 border px-4 py-3 text-left text-[14px] transition-colors ${
                  moagem === m
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 hover:border-fuligem"
                } disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:bg-transparent disabled:text-fuligem-20 disabled:line-through`}
              >
                {d.catalogo.moagem[m]}
              </button>
            );
          })}
        </div>
        {/* A ponte que os sete botões faziam: quem chegava procurando
            "Aeropress" precisa saber para onde o método foi. Aponta para a
            seção que existe nesta mesma página, e não promete escolha de
            método no pedido — não há campo para isso no checkout. */}
        {/* O nome da seção fecha a frase nos três idiomas — em inglês e em
            espanhol o complemento também vem no fim, então a costura
            "…está em <link>." não precisa de posição variável. */}
        <p className="mt-2.5 text-[13px] text-fuligem-55">
          {d.pdp.moidoNoDia}{" "}
          <a
            href="#como-preparar"
            className="underline decoration-fuligem-20 underline-offset-4 hover:text-vermelho"
          >
            {d.pdp.comoPreparar}
          </a>
          .
        </p>
      </fieldset>

      {/* ── Peso ───────────────────────────────────────────────────────────── */}
      <fieldset className="mt-6">
        <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          {d.pdp.rotulo.peso}
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {PESOS.map((g) => {
            const existe = pesosValidos.has(g);
            return (
              <button
                key={g}
                onClick={() => setPeso(g)}
                disabled={!existe}
                aria-pressed={peso === g}
                title={existe ? undefined : d.pdp.semEstePeso}
                // `min-h-12` pelo mesmo motivo do seletor de moagem acima: com
                // `py-2.5` e 13px o botão fechava em 41,5 px de altura, abaixo
                // dos 44 do §10 — e estes são os botões que decidem O QUE se
                // compra.
                className={`min-h-12 border px-4 py-2.5 font-dado text-[13px] transition-colors ${
                  peso === g
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 hover:border-fuligem"
                } disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:bg-transparent disabled:text-fuligem-20 disabled:line-through`}
              >
                {rotuloPeso(g)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ── Embalagem ──────────────────────────────────────────────────────── */}
      {/* Só aparece quando há mais de uma opção: a loja vende caixa fechada em
          alguns pesos (3x250 g, 4x500 g) e só o pacote avulso em outros. Um
          seletor com um botão só é ruído. */}
      {embalagens.length > 1 ? (
        <fieldset className="mt-6">
          <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            {d.pdp.rotulo.embalagem}
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {embalagens.map((n) => (
              <button
                key={n}
                onClick={() => setPacotes(n)}
                aria-pressed={pacotes === n}
                // Mesma altura mínima do fieldset de peso — os dois nasceram
                // da mesma linha de classe e carregavam o mesmo defeito.
                className={`min-h-12 border px-4 py-2.5 text-[13px] transition-colors ${
                  pacotes === n
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 hover:border-fuligem"
                }`}
              >
                {n === 1 ? d.pdp.umPacote : `${d.pdp.caixaCom} ${n}`}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* ── Quantidade e CTA ───────────────────────────────────────────────── */}
      {/* No modo assinatura não há sacola: quantidade, frequência e endereço
          são do wizard. O link carrega café e moagem já escolhidos aqui. */}
      {assinando ? (
        <div ref={ctaRef} className="mt-8">
          <BotaoLink
            href={href(locale, `/clube?cafe=${lote.slug}&moagem=${moagem}`)}
            variante="primario"
            className="w-full"
          >
            {d.pdp.montarAssinatura}
          </BotaoLink>
        </div>
      ) : (
      <div ref={ctaRef} className="mt-8 flex flex-wrap items-stretch gap-3">
        <div className="flex items-center border border-fuligem-20">
          <button
            onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
            aria-label={d.pdp.diminuirQuantidade}
            className="h-12 w-12 text-[18px] leading-none hover:bg-fuligem-20/40"
          >
            −
          </button>
          <span
            aria-live="polite"
            className="w-10 text-center font-dado text-[15px]"
          >
            {quantidade}
          </span>
          <button
            onClick={() => setQuantidade((q) => Math.min(teto, q + 1))}
            disabled={quantidade >= teto}
            aria-label={d.pdp.aumentarQuantidade}
            className="h-12 w-12 text-[18px] leading-none hover:bg-fuligem-20/40 disabled:cursor-not-allowed disabled:text-fuligem-20 disabled:hover:bg-transparent"
          >
            +
          </button>
        </div>

        <Botao
          variante="primario"
          disabled={indisponivel}
          onClick={aoAdicionar}
          className="flex-1 disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
        >
          {indisponivel
            ? d.comum.esgotado
            : adicionado
              ? `${d.venda.naSacola} ✓`
              : d.venda.adicionarASacola}
        </Botao>
      </div>
      )}

      {/* aria-live: quem usa leitor de tela precisa ouvir que o item entrou —
          a mudança do rótulo do botão sozinha não é anunciada. */}
      <p role="status" aria-live="polite" className="sr-only">
        {adicionado ? d.venda.itemAdicionado : ""}
      </p>

      {erroDaSacola ? (
        <p role="alert" className="mt-3 text-[14px] text-vermelho">
          {erroDaSacola}
        </p>
      ) : null}

      {/* Discreto de propósito: bater no teto não é erro, é o estoque real.
          Só aparece quando o teto veio do estoque (não dos 20 arbitrários). */}
      {!indisponivel && estoqueConhecido && teto < 20 && quantidade >= teto ? (
        <p role="status" className="mt-3 text-[13px] text-fuligem-55">
          {d.pdp.maximoEmEstoque}
        </p>
      ) : null}

      {indisponivel ? (
        <p role="status" className="mt-3 text-[14px] text-fuligem-55">
          {d.pdp.combinacaoEsgotada}
        </p>
      ) : (
        <p className="mt-3 text-[14px] text-fuligem-55">
          {d.pdp.torramosNaTerca}
        </p>
      )}

      {/* Barra de compra fixa — só mobile, e só depois de passar do CTA (§10) */}
      {/* A BASE DA JANELA É DO AVISO DE COOKIES, NÃO DESTA BARRA.
          Medido em 360×800: o aviso ocupa de y=642,8 a 800 (157,3 px; 180 px em
          espanhol) e esta barra ocupava de y=727 a 800 — os 73 px dela inteira
          por baixo do aviso. Botão que o DOM dá por visível e dedo nenhum
          alcança, na primeira visita, que é a que converte.
          Subir a barra por `z-index` seria pior: dá para comprar sem poder
          recusar cookie. Então quem cede é a barra — ela se apoia na altura que
          o aviso publica (BannerCookies.VAR_ALTURA_DO_AVISO) e desce sozinha
          para a base quando o aviso sai. Sem aviso, o fallback `0px` mantém o
          comportamento de sempre.
          `bottom` NÃO entra na transição de propósito: o aviso some de uma vez
          (não tem animação de saída), e a barra descendo no mesmo instante lê
          como um movimento só; deslizar sozinha atrasada leria como bug. */}
      <div
        aria-hidden={ctaVisivel}
        className={`fixed inset-x-0 z-40 border-t border-fuligem-20 bg-cal-puro px-4 py-3 transition-transform duration-[320ms] ease-canastra md:hidden ${
          ctaVisivel ? "translate-y-full" : "translate-y-0"
        }`}
        style={{
          bottom: `var(${VAR_ALTURA_DO_AVISO}, 0px)`,
          // Enquanto o aviso está de pé é ELE que cobre a faixa do gesto do
          // iPhone; descontá-la aqui evita a folga dobrada. `max` devolve os
          // 0,75rem normais quando a conta dá negativo (ou quando não há aviso).
          paddingBottom: `max(0.75rem, calc(env(safe-area-inset-bottom) - var(${VAR_ALTURA_DO_AVISO}, 0px)))`,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] uppercase tracking-[0.12em] text-fuligem-55">
              {lote.nome}
            </p>
            <p className="font-dado text-[17px] leading-tight">
              {formatarPreco(preco)}
            </p>
          </div>
          {assinando ? (
            <BotaoLink
              href={href(locale, `/clube?cafe=${lote.slug}&moagem=${moagem}`)}
              variante="primario"
              tabIndex={ctaVisivel ? -1 : undefined}
              className="shrink-0"
            >
              {d.pdp.assinar}
            </BotaoLink>
          ) : (
            <Botao
              variante="primario"
              disabled={indisponivel}
              onClick={aoAdicionar}
              tabIndex={ctaVisivel ? -1 : undefined}
              className="shrink-0 disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
            >
              {indisponivel
                ? d.comum.esgotado
                : adicionado
                  ? "✓"
                  : d.venda.adicionar}
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}
