import type { Metadata } from "next";
import Link from "next/link";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";
import { alternativasDeIdioma, href } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import {
  TERMOS,
  AVISO_DE_TRADUCAO,
  AVISO_JURIDICO,
  type Bloco,
  type Paragrafo,
  type Secao,
  type Trecho,
} from "./conteudo";
import { aceitaCartao } from "./pagamento";

/**
 * Termos de uso — texto do site institucional, moldura da loja.
 *
 * A PÁGINA NÃO GUARDA UMA PALAVRA DO DOCUMENTO: tudo vem de `conteudo.ts`,
 * inclusive o título e a data. Aqui mora só a montagem — h2/p/ul dentro do
 * `<PaginaTexto>`, que já resolve a medida de leitura de 62ch e a tipografia
 * (estetica.md §4.2). Foi essa separação que permitiu testar o conteúdo sem
 * jsdom e sem dependência nova.
 *
 * MOBILE-FIRST SEM ESFORÇO EXTRA porque a moldura já é: o `PaginaTexto` abre em
 * `px-4 py-10` e só cresce em `md:`. O único acréscimo daqui é o `scroll-mt` de
 * cada `<h2>` — sem ele, uma âncora compartilhada (`#trocas-e-devolucoes`) para
 * debaixo do cabeçalho grudento e o leitor cai no meio da cláusula anterior.
 */

/**
 * As três versões saem prontas do build, e esta página já dependia disso sem
 * declarar: `pagamento.ts` diz, com todas as letras, que a condicional do
 * cartão "funciona porque os dois lados são resolvidos em tempo de BUILD: a
 * página é estática". Ao entrar no segmento `[locale]` ela deixou de ser, e a
 * afirmação virou meia verdade — a `NEXT_PUBLIC_*` continuava assada no
 * bundle, mas o HTML passou a ser remontado a cada visita para chegar sempre
 * ao mesmo resultado. A explicação longa está na home ((vitrine)/page.tsx).
 *
 * Sem `revalidate`: o texto só muda por deploy, que é quando o documento
 * jurídico de fato muda.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = comoLocale((await params).locale);
  const { meta } = TERMOS[locale];
  return {
    title: meta.titulo,
    description: meta.descricao,
    // `generateMetadata` e não um `metadata` constante porque o canônico
    // precisa ser a PRÓPRIA página, no próprio idioma — ver lib/i18n/rotas.ts.
    alternates: alternativasDeIdioma("/termos-de-uso", locale),
  };
}

/** Um pedaço de frase: texto puro, ênfase, link, ou a condicional do cartão. */
function PedacoDeFrase({ t, locale }: { t: Trecho; locale: Locale }) {
  if (typeof t === "string") return <>{t}</>;

  if ("forte" in t) {
    return <strong className="font-semibold text-fuligem">{t.forte}</strong>;
  }

  if ("conforme" in t) {
    // A promessa e o rádio "Cartão" do checkout leem a MESMA função — ver
    // pagamento.ts, que é onde essa amarra está escrita e testada.
    return <>{aceitaCartao() ? t.sim : t.nao}</>;
  }

  // `mailto:` e `tel:` são endereço de fora e saem em <a>; caminho interno vai
  // por <Link>, com o prefixo de idioma que o `href()` decide.
  return t.href.startsWith("/") ? (
    <Link href={href(locale, t.href)}>{t.texto}</Link>
  ) : (
    <a href={t.href}>{t.texto}</a>
  );
}

function Frase({ p, locale }: { p: Paragrafo; locale: Locale }) {
  if (typeof p === "string") return <>{p}</>;
  return (
    <>
      {p.map((t, i) => (
        <PedacoDeFrase key={i} t={t} locale={locale} />
      ))}
    </>
  );
}

/** A ordem escrita é a ordem exibida — ver a nota de `Bloco` em conteudo.ts. */
function BlocoDoTexto({ bloco, locale }: { bloco: Bloco; locale: Locale }) {
  if ("lista" in bloco) {
    return (
      <ul>
        {bloco.lista.map((item, i) => (
          <li key={i}>
            <Frase p={item} locale={locale} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p>
      <Frase p={bloco.paragrafo} locale={locale} />
    </p>
  );
}

function BlocoDaSecao({ secao, locale }: { secao: Secao; locale: Locale }) {
  return (
    <>
      <h2 id={secao.ancora} className="scroll-mt-24">
        {secao.titulo}
      </h2>
      {secao.blocos.map((bloco, i) => (
        <BlocoDoTexto key={i} bloco={bloco} locale={locale} />
      ))}
    </>
  );
}

export default async function TermosDeUso({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const conteudo = TERMOS[locale];

  /**
   * O idioma traduzido, ou `null` no português. Até a Onda 3C, `en` e `es`
   * apontavam para o objeto do `pt` e este mesmo lugar mostrava um aviso de
   * "só existe em português"; agora que os três documentos existem, o que
   * aparece é a cláusula de prevalência — ver AVISO_DE_TRADUCAO em conteudo.ts.
   */
  const traduzido = locale !== "pt" ? locale : null;

  return (
    <PaginaTexto
      titulo={conteudo.titulo}
      atualizacao={conteudo.atualizacao}
      locale={locale}
    >
      {/* Fica nos TRÊS idiomas. O texto importado do site institucional não
          passou por advogado — o próprio material de referência trazia, como se
          fosse desta marca, o contrato de licenciamento de OUTRA empresa (ver a
          nota no topo de conteudo.ts). Traduzir não revisa: um documento sem
          advogado em português continua sem advogado em inglês.

          POR QUE DOIS RAMOS. O <AvisoJuridico> compartilhado é fixo em
          português, e components/layout/PaginaTexto.tsx é de outro dono nesta
          onda. Um aviso que o leitor não consegue ler não avisa nada, então em
          en/es a página desenha o mesmo bloco com o texto do idioma dele, mais
          a cláusula de prevalência — um bloco só, que em 360 px é o que cabe.
          Quando o PaginaTexto aceitar o locale, os dois ramos viram um. */}
      {traduzido ? (
        <p className="mt-10 max-w-[62ch] border border-alerta/40 bg-alerta/5 p-4 text-[14px] leading-relaxed text-fuligem-80">
          <strong className="font-semibold text-fuligem">
            {AVISO_JURIDICO[traduzido].forte}
          </strong>{" "}
          {AVISO_JURIDICO[traduzido].texto}{" "}
          {AVISO_DE_TRADUCAO[traduzido]}
        </p>
      ) : (
        <AvisoJuridico />
      )}

      {conteudo.secoes.map((secao) => (
        <BlocoDaSecao key={secao.ancora} secao={secao} locale={locale} />
      ))}
    </PaginaTexto>
  );
}
