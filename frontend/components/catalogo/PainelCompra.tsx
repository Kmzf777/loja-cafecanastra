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

function rotuloPeso(g: PesoGramas) {
  return g === 1000 ? "1 kg" : `${g} g`;
}

export function PainelCompra({
  lote,
  locale = LOCALE_PADRAO,
}: {
  lote: Lote;
  /**
   * O idioma da PDP. Os dois links para o Clube precisam dele: crus, eles
   * atravessavam a fronteira do idioma no meio do funil de assinatura.
   *
   * O RESTO DO TEXTO DESTE PAINEL AINDA ESTA EM PORTUGUES nos tres idiomas, e
   * isso e pendencia declarada, nao descuido — sao ~15 frases sem chave no
   * dicionario (a Onda 3A cobriu a moldura e o editorial dos cafes, nao a
   * interface de compra). O que ja tinha chave, "Esgotado", passou a le-la.
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
   * §10 — em mobile a PDP ganha barra de compra fixa no rodape, que aparece
   * DEPOIS que o usuario passa do botao original. Mostra-la desde o inicio
   * cobriria o proprio botao e roubaria altura util logo na primeira dobra.
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
      setErroDaSacola(
        "Não conseguimos falar com a loja agora. Tente de novo em instantes.",
      );
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
        moagem: MOAGENS.find((m) => m.valor === variante.moagem)?.rotulo,
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
        variante: MOAGENS.find((m) => m.valor === variante.moagem)?.rotulo,
      });
      setAdicionado(true);
      window.setTimeout(() => setAdicionado(false), 2500);
    } catch {
      setErroDaSacola("Não foi possível adicionar à sacola.");
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
          aria-label="Modo de compra"
          className="grid grid-cols-2 border border-fuligem"
        >
          {[
            { id: false, rotulo: "Compra única", valor: precoBase },
            {
              id: true,
              rotulo: `Assinatura −${Math.round(desconto * 100)}%`,
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
          A cada 15, 30 ou 45 dias, com a entrega incluída. Você escolhe a
          frequência no Clube e cancela quando quiser, sem multa.
        </p>
      ) : null}

      {/* ── §5.5 Moagem ────────────────────────────────────────────────────── */}
      <fieldset className="mt-8">
        <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Moagem
        </legend>
        {/* Duas colunas em qualquer largura: com dois botões, `grid-cols-2`
            já cabe folgado em 360 px e evita que um deles fique órfão numa
            segunda linha quando a grade cresce. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {MOAGENS.map((m) => {
            const existe = moagensValidas.has(m.valor);
            return (
              <button
                key={m.valor}
                onClick={() => setMoagem(m.valor)}
                disabled={!existe}
                aria-pressed={moagem === m.valor}
                title={existe ? undefined : "Não disponível para este lote"}
                className={`min-h-12 border px-4 py-3 text-left text-[14px] transition-colors ${
                  moagem === m.valor
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 hover:border-fuligem"
                } disabled:cursor-not-allowed disabled:border-fuligem-20 disabled:bg-transparent disabled:text-fuligem-20 disabled:line-through`}
              >
                {m.rotulo}
              </button>
            );
          })}
        </div>
        {/* A ponte que os sete botões faziam: quem chegava procurando
            "Aeropress" precisa saber para onde o método foi. Aponta para a
            seção que existe nesta mesma página, e não promete escolha de
            método no pedido — não há campo para isso no checkout. */}
        <p className="mt-2.5 text-[13px] text-fuligem-55">
          Moído no dia do pedido. A moagem de cada método está em{" "}
          <a
            href="#como-preparar"
            className="underline decoration-fuligem-20 underline-offset-4 hover:text-vermelho"
          >
            Como preparar
          </a>
          .
        </p>
      </fieldset>

      {/* ── Peso ───────────────────────────────────────────────────────────── */}
      <fieldset className="mt-6">
        <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Peso
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
                title={existe ? undefined : "Não disponível nesta moagem"}
                className={`border px-4 py-2.5 font-dado text-[13px] transition-colors ${
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
            Embalagem
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {embalagens.map((n) => (
              <button
                key={n}
                onClick={() => setPacotes(n)}
                aria-pressed={pacotes === n}
                className={`border px-4 py-2.5 text-[13px] transition-colors ${
                  pacotes === n
                    ? "border-fuligem bg-fuligem text-cal"
                    : "border-fuligem-20 hover:border-fuligem"
                }`}
              >
                {n === 1 ? "1 pacote" : `Caixa com ${n}`}
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
            Montar minha assinatura
          </BotaoLink>
        </div>
      ) : (
      <div ref={ctaRef} className="mt-8 flex flex-wrap items-stretch gap-3">
        <div className="flex items-center border border-fuligem-20">
          <button
            onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
            aria-label="Diminuir quantidade"
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
            aria-label="Aumentar quantidade"
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
              ? "Na sacola ✓"
              : "Adicionar à sacola"}
        </Botao>
      </div>
      )}

      {/* aria-live: quem usa leitor de tela precisa ouvir que o item entrou —
          a mudança do rótulo do botão sozinha não é anunciada. */}
      <p role="status" aria-live="polite" className="sr-only">
        {adicionado ? "Item adicionado à sacola." : ""}
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
          Este é o máximo disponível em estoque agora.
        </p>
      ) : null}

      {indisponivel ? (
        <p role="status" className="mt-3 text-[14px] text-fuligem-55">
          Esta combinação está esgotada. Tente outro peso ou outra moagem.
        </p>
      ) : (
        <p className="mt-3 text-[14px] text-fuligem-55">
          Torramos na terça, enviamos na quarta.
        </p>
      )}

      {/* Barra de compra fixa — só mobile, e só depois de passar do CTA (§10) */}
      <div
        aria-hidden={ctaVisivel}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-fuligem-20 bg-cal-puro px-4 py-3 transition-transform duration-[320ms] ease-canastra md:hidden ${
          ctaVisivel ? "translate-y-full" : "translate-y-0"
        }`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
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
              Assinar
            </BotaoLink>
          ) : (
            <Botao
              variante="primario"
              disabled={indisponivel}
              onClick={aoAdicionar}
              tabIndex={ctaVisivel ? -1 : undefined}
              className="shrink-0 disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
            >
              {indisponivel ? d.comum.esgotado : adicionado ? "✓" : "Adicionar"}
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}
