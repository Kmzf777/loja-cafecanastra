import type { Metadata } from "next";
import Link from "next/link";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";
import { BotaoReverCookies } from "@/components/layout/BotaoReverCookies";
import { dicionario } from "@/lib/i18n/dicionario";
import { FormDescadastroNewsletter } from "@/components/layout/FormDescadastroNewsletter";
import { alternativasDeIdioma, href, openGraphDaPagina } from "@/lib/i18n/rotas";
import { LOCALES, comoLocale, type Locale } from "@/lib/i18n/tipos";
import {
  PRIVACIDADE,
  AVISO_DE_TRADUCAO,
  AVISO_JURIDICO,
  type Bloco,
  type Paragrafo,
  type Secao,
  type Trecho,
} from "./conteudo";

/**
 * Política de privacidade — texto do site institucional, moldura da loja.
 *
 * O TEXTO NÃO MORA AQUI: está em `conteudo.ts`, testado, e esta página só o
 * monta dentro do `<PaginaTexto>` (medida de 62ch, tipografia da estetica.md
 * §4.2). O que mora aqui e não pode morar lá são os dois componentes de
 * consentimento — eles não são texto, são a porta: o formulário de descadastro
 * chama a API e o "Rever cookies" mata o gtag na hora. O conteúdo diz ONDE cada
 * um entra, na sequência de blocos; a página sabe QUAL é.
 */

/**
 * As três versões saem prontas do build. O texto é constante e os dois pontos
 * vivos da página — o "Rever cookies" e o descadastro da newsletter — são
 * componentes de CLIENTE, que rodam no navegador de quem lê e por isso não
 * pedem render de servidor nenhum: o HTML estático é a casca deles. Sem esta
 * função, o `[locale]` cobrava esse render mesmo assim. A explicação longa
 * está na home ((vitrine)/page.tsx).
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
  const { meta } = PRIVACIDADE[locale];
  return {
    title: meta.titulo,
    description: meta.descricao,
    // `generateMetadata` e não um `metadata` constante porque o canônico
    // precisa ser a PRÓPRIA página, no próprio idioma — ver lib/i18n/rotas.ts.
    alternates: alternativasDeIdioma("/politica-de-privacidade", locale),
    openGraph: openGraphDaPagina({
      locale,
      caminho: "/politica-de-privacidade",
      titulo: meta.titulo,
      descricao: meta.descricao,
    }),
  };
}

function PedacoDeFrase({ t, locale }: { t: Trecho; locale: Locale }) {
  if (typeof t === "string") return <>{t}</>;

  if ("forte" in t) {
    return <strong className="font-semibold text-fuligem">{t.forte}</strong>;
  }

  // O rótulo vem do dicionário: o botão é client e minúsculo de propósito
  // (ver a nota nele), então quem sabe o idioma passa a palavra pronta.
  if ("acao" in t)
    return <BotaoReverCookies rotulo={dicionario(locale).cookies.rever} />;

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

  // A promessa e a implementação lado a lado: quem lê que pode sair da lista
  // não precisa procurar onde. Mesmo desenho do BotaoReverCookies na seção
  // Cookies — a página que promete a escolha é a página onde ela se exerce.
  if ("formulario" in bloco)
    return <FormDescadastroNewsletter t={dicionario(locale).newsletter} />;

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

export default async function PoliticaDePrivacidade({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = comoLocale((await params).locale);
  const conteudo = PRIVACIDADE[locale];

  /** Ver a nota igual na página dos Termos — os dois ramos e o porquê deles. */
  const traduzido = locale !== "pt" ? locale : null;

  return (
    <PaginaTexto
      titulo={conteudo.titulo}
      atualizacao={conteudo.atualizacao}
      locale={locale}
    >
      {/* Fica nos três idiomas, pela mesma razão escrita nos Termos: o material
          de referência que deveria conter a política revisada trazia, no lugar
          dela, o contrato de licenciamento de outra empresa. Em en/es o bloco é
          desenhado aqui porque o <AvisoJuridico> compartilhado só fala
          português — ver a nota longa em ../termos-de-uso/page.tsx. */}
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
