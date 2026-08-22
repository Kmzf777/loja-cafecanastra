import Image from "next/image";
import Link from "next/link";
import { href } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import {
  POSTS_NA_HOME,
  formatarDataDoPost,
  listarPostsDoBlog,
  postsEmDestaque,
  textosDoBlog,
  type PostDoBlog,
  type TextosDoBlog,
} from "./conteudo";

/**
 * A seção de blog da home — hoje, a casca (spec §4).
 *
 * SUPERFÍCIE KRAFT, E O LUGAR NÃO É ARBITRÁRIO. O estetica.md §7.1 proíbe duas
 * seções escuras seguidas. A home termina em "história" sobre Cal e o rodapé é
 * Fuligem; encaixar o blog entre os dois só funciona numa superfície clara, e
 * entre as duas claras o kraft é a que faz sentido: é a superfície de papel, e
 * esta é a seção de texto. A sequência fica
 * mata → cal → kraft → fuligem.
 *
 * O ESTADO VAZIO É O DESENHO, não um esqueleto de carregamento. Nada de caixas
 * cinzas pulsando: um cartão fantasma diz "está carregando" e mente, porque não
 * vem nada. O que se mostra é uma frase honesta e o carimbo "Em breve" — o
 * carimbo do §4.4 (deslocamento sólido de 4px, nunca sombra difusa), que é o
 * vocabulário da marca para "marcado à mão".
 *
 * O CAMINHO COM POSTS JÁ EXISTE, e é por isso que ligar o blog não passa por
 * redesenhar nada: quando `listarPostsDoBlog()` devolver conteúdo, a grade
 * abaixo assume o lugar do carimbo. Ver o comentário da fonte em `conteudo.ts`
 * — falta também a rota /blog/[slug], sem a qual cada cartão vira 404.
 */
export function SecaoDoBlog({ locale }: { locale: Locale }) {
  const t = textosDoBlog(locale);
  const posts = postsEmDestaque(listarPostsDoBlog(), POSTS_NA_HOME);

  return (
    <section
      aria-labelledby="blog-titulo"
      className="border-t border-fuligem-20 bg-juta-claro py-16 md:py-24"
    >
      <div className="mx-auto max-w-[1440px] px-4 md:px-10">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-barro">
          {t.rotulo}
        </p>

        {/* Coluna única no telefone; no desktop o carimbo vai para a direita do
            texto, que é onde sobra respiro. */}
        <div className="mt-5 flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-16">
          <div className="min-w-0">
            <h2
              id="blog-titulo"
              className="titulo-secao max-w-[20ch] text-[clamp(1.75rem,3.5vw,2.75rem)] leading-tight"
            >
              {t.titulo}
            </h2>
            <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-fuligem-80">
              {t.texto}
            </p>
          </div>

          {posts.length === 0 ? <Carimbo texto={t.carimbo} /> : null}
        </div>

        {posts.length > 0 ? <ListaDePosts posts={posts} locale={locale} t={t} /> : null}
      </div>
    </section>
  );
}

/**
 * O carimbo "Em breve".
 *
 * TEXTO EM FULIGEM, SOMBRA EM VERMELHO. Vermelho sobre kraft dá ~4:1 — passa
 * para elemento não textual (3:1), não para texto pequeno (4,5:1). Então a
 * cor da marca entra pelo deslocamento sólido, que é decoração, e a palavra
 * fica em Fuligem sobre Cal puro, que é 16:1.
 *
 * Não é Martian Mono: o §4.2 reserva a monoespaçada para número e código,
 * nunca para frase. A voz de etiqueta aqui vem do Archivo em caixa alta com
 * tracking largo, igual aos rótulos de seção.
 */
function Carimbo({ texto }: { texto: string }) {
  return (
    <p className="-rotate-2 self-start border border-fuligem bg-cal-puro px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem shadow-[4px_4px_0_var(--color-vermelho)] md:shrink-0">
      {texto}
    </p>
  );
}

/**
 * A grade de posts. Hoje inalcançável — a fonte devolve vazio por decisão do
 * cliente —, e é de propósito que ela já esteja escrita: é o que faz a
 * integração ser "trocar a fonte" e não "desenhar a seção".
 */
function ListaDePosts({
  posts,
  locale,
  t,
}: {
  posts: PostDoBlog[];
  locale: Locale;
  t: TextosDoBlog;
}) {
  return (
    <ul
      aria-label={t.listaRotulo}
      className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {posts.map((post) => (
        <li key={post.slug} className="h-full">
          <CardDoPost post={post} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

/** Mesmo vocabulário do <CardCafe>: filete, raio zero, carimbo no hover. */
function CardDoPost({ post, locale }: { post: PostDoBlog; locale: Locale }) {
  return (
    <article className="h-full">
      <Link
        href={href(locale, `/blog/${post.slug}`)}
        className="flex h-full flex-col border border-fuligem-20 bg-cal-puro transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho active:-translate-x-1 active:-translate-y-1 active:shadow-[4px_4px_0_var(--color-fuligem)]"
      >
        {post.imagem ? (
          <Image
            src={post.imagem.src}
            alt={post.imagem.alt}
            width={post.imagem.w}
            height={post.imagem.h}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="aspect-[3/2] w-full border-b border-fuligem-20 object-cover"
          />
        ) : null}

        <div className="flex flex-1 flex-col p-5">
          {/* <time> com `dateTime` em ISO: o texto visível é traduzido e
              abreviado, a máquina continua lendo a data exata. */}
          <time
            dateTime={post.data}
            className="font-dado text-[13px] tracking-[0.06em] text-fuligem-55"
          >
            {formatarDataDoPost(post.data, locale)}
          </time>
          <h3 className="mt-2 text-[20px] font-semibold leading-tight">
            {post.titulo}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-fuligem-80">
            {post.resumo}
          </p>
        </div>
      </Link>
    </article>
  );
}
