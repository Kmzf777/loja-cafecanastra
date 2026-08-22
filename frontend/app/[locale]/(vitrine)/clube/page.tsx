import type { Metadata } from "next";
import { listarLotes } from "@/lib/catalogo/repositorio";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { DESCONTO_DO_CLUBE, opcoesDoClube } from "@/lib/clube";
import { AssinaturaWizard } from "./AssinaturaWizard";
import { ORDEM_DO_FAQ, textosDoClube } from "./conteudo";
import { alternativasDeIdioma } from "@/lib/i18n/rotas";
import { LOCALES, LOCALE_PADRAO, comoLocale } from "@/lib/i18n/tipos";

/**
 * Clube da Canastra — estetica.md §7.4.
 *
 * Superficie Mata. ATENCAO ao contraste: vermelho sobre mata e 2,0:1 (§4.1,
 * proibido). Todo CTA aqui sai em Cal.
 *
 * A pendencia registrada aqui ("o wizard com estado ainda nao existe") FECHOU
 * na Onda 3J: o fluxo de 3 passos com barra de progresso e a etiqueta de
 * resumo agora sao o <AssinaturaWizard>, uma ilha client que termina no POST
 * /clube/assinar e no redirect ao init_point do Mercado Pago. Esta pagina
 * segue server component: monta o editorial e entrega ao wizard so o recorte
 * assinavel do catalogo (opcoesDoClube), com preco/estoque ao vivo quando a
 * API responde.
 *
 * `revalidate` continua: o preco daqui e etiqueta — quem decide os -10% de
 * verdade e o servidor, na hora do assinar (ClubeController).
 *
 * O TEXTO INTEIRO — venda, FAQ e wizard — vem de `conteudo.ts`, nos tres
 * idiomas. O spec §1 nomeia "/clube (a pagina de venda)" como superficie
 * traduzida e ela era a ultima que nao era: em /en/clube o visitante lia a
 * pagina de venda e AUTORIZAVA COBRANCA RECORRENTE em portugues.
 */

/**
 * A /clube perdeu a geracao estatica ao entrar no `[locale]`: sem esta funcao,
 * o segmento fica dinamico e as tres versoes passam a ser renderizadas a cada
 * visita — a pagina que so muda quando o catalogo muda voltaria a chamar a API
 * no caminho do primeiro byte. Sao tres paginas, e o `revalidate` acima cuida
 * do preco envelhecer.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * `generateMetadata` e não um `metadata` constante porque o canônico precisa
 * ser a PRÓPRIA página, no próprio idioma — ver a nota em lib/i18n/rotas.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const t = textosDoClube(locale);
  return {
    title: t.meta.titulo,
    description: t.meta.descricao,
    alternates: alternativasDeIdioma("/clube", locale),
  };
}

export const revalidate = 3600;

export default async function PaginaClube({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const t = textosDoClube(locale);
  // O wizard lista os cafés assináveis pelo nome e pela nota: sem esta
  // tradução, o único passo do funil de assinatura que mostra produto sairia
  // em português dentro de /en/clube.
  const lotes = (await listarLotes()).map((l) => traduzirLote(l, locale));
  const opcoes = opcoesDoClube(lotes);

  /**
   * O NÚMERO DO HERO É A CONSTANTE, não o `assinatura.desconto` do catálogo.
   * Quem cobra é o ClubeController, sobre `DESCONTO_DO_CLUBE`; lib/clube.ts
   * espelha essa mesma constante para a etiqueta do wizard. Ler um terceiro
   * valor aqui criaria a única fonte capaz de MENTIR: um JSON de catálogo com
   * 0.15 anunciaria "15% de desconto" numa loja que cobra 10%. O campo do
   * catálogo segue existindo como marcação editorial de QUAIS linhas entram no
   * Clube (`opcoesDoClube` filtra por ele) — não de quanto se desconta.
   */
  const desconto = DESCONTO_DO_CLUBE;

  return (
    <>
      <section className="bg-mata py-16 text-cal md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-juta">
            {t.etiqueta}
          </p>
          {/* NOME PRÓPRIO, igual nos três idiomas: é o que está impresso no
              pacote, e é a mesma regra de `rodape.clubeDaCanastra`. */}
          <h1 className="mt-6 max-w-[16ch] font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
            Clube da Canastra
          </h1>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-cal/85">
            {t.chamada(Math.round(desconto * 100))}
          </p>

          {/* ── A fronteira do Clube, dita ANTES do primeiro passo ───────────
              Só em inglês e espanhol, mesma regra do aviso de compra da
              moldura. E é mais forte que aquele: ali o problema é o idioma do
              checkout; aqui o fluxo é estruturalmente brasileiro — frete
              Melhor Envio, preapproval do Mercado Pago Brasil em reais,
              endereço CEP+UF e CPF obrigatório na nota de cada remessa. Quem
              está fora do Brasil precisa saber disso antes de preencher três
              telas, não depois.

              O WIZARD CONTINUA DE PÉ, e a decisão é essa: a parede é o
              endereço de entrega, não a língua de quem lê. Um brasileiro que
              navega em inglês assina normalmente — esconder o formulário
              tiraria dele um caminho que funciona.

              SUPERFÍCIE MATA: filete em Juta à esquerda em vez de faixa kraft.
              §4.1 proíbe vermelho sobre mata (2,0:1) e o aviso não é erro; a
              Juta sobre Mata é a mesma cor que a sobrancelha acima já usa.
              Mobile-first: em 360px é uma coluna de texto com o filete; o
              `md:` só abre o respiro. */}
          {locale !== LOCALE_PADRAO ? (
            <aside
              aria-label={t.aviso.titulo}
              className="mt-8 max-w-[56ch] border-l-2 border-juta pl-4 md:pl-5"
            >
              <p className="text-[14px] font-semibold leading-snug text-juta">
                {t.aviso.titulo}
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-cal/75">
                {t.aviso.texto}
              </p>
            </aside>
          ) : null}

          <AssinaturaWizard opcoes={opcoes} locale={locale} />
        </div>
      </section>

      {/* A âncora é o destino do "Como funciona" do rodapé, que antes apontava
          para /clube igual ao item de cima — dois rótulos, um endereço. Esta é
          a seção que de fato explica o funcionamento; `scroll-mt` desconta o
          cabeçalho grudento, senão o título para atrás dele. */}
      <section id="como-funciona" className="scroll-mt-24 bg-cal py-16 md:py-24">
        <div className="mx-auto max-w-[1440px] px-4 md:px-10">
          <h2 className="titulo-secao text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight">
            {t.faq.titulo}
          </h2>
          {/* A ORDEM VEM DE `ORDEM_DO_FAQ`, não de `Object.keys` do objeto
              traduzido: ordem de digitação num arquivo de tradução é acidente,
              e uma pergunta reordenada por descuido mudaria a leitura só num
              idioma. */}
          <dl className="mt-8 max-w-[70ch]">
            {ORDEM_DO_FAQ.map((chave) => (
              <div key={chave} className="border-b border-fuligem-20 py-5">
                <dt className="text-[17px] font-semibold">
                  {t.faq[chave].pergunta}
                </dt>
                <dd className="mt-2 text-[16px] leading-relaxed text-fuligem-80">
                  {t.faq[chave].resposta}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
