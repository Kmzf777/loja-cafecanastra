/**
 * Duas coisas acontecem aqui, nesta ordem: o REWRITE DE IDIOMA e a RENOVAÇÃO
 * DA SESSÃO do Supabase. Elas são independentes, mas dividem o mesmo objeto de
 * resposta — e é essa divisão que exige atenção (ver `criarResposta`, abaixo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1. O REWRITE DE IDIOMA
 *
 * O site fala português, inglês e espanhol, e as páginas traduzidas vivem em
 * `app/[locale]/(vitrine)/`. O português é o padrão e NÃO APARECE NA URL:
 * `/cafes` é reescrito internamente para `/pt/cafes`.
 *
 * REWRITE, NÃO REDIRECT, e é essa a decisão inteira: a barra de endereços
 * continua mostrando `/cafes`, então nenhum link existente, nenhum backlink,
 * nenhuma entrada de sitemap e nenhum QR code impresso quebra. Um redirect
 * daria o mesmo conteúdo com uma URL nova — e trocaria a autoridade acumulada
 * de anos por uma cadeia de 301.
 *
 * Fica FORA do rewrite: `/en` e `/es` (já trazem idioma), o painel, a API, os
 * arquivos estáticos, e o caminho de compra — sacola, checkout, conta e
 * pedido, que vivem em `app/(transacional)/` porque são pt-BR por decisão do
 * cliente (spec §1: o frete é só Brasil e o pagamento é Mercado Pago BR).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2. POR QUE A RENOVAÇÃO DE SESSÃO EXISTE — E O MOTIVO NÃO É O QUE PARECE
 *
 * O `setAll` de `lib/supabase/servidor.ts` tem um `catch` vazio, porque um
 * Server Component não pode gravar cookie. A leitura fácil dessa lacuna é "o
 * token renovado nunca chega ao navegador e a pessoa cai da conta quando o
 * refresh token vence". Isso está errado nos dois sentidos, e o certo é pior.
 *
 * SUPERESTIMADO: `createBrowserClient` liga `autoRefreshToken` no navegador
 * (`@supabase/ssr/dist/main/createBrowserClient.js`). Qualquer componente de
 * cliente montado renova sozinho e grava o cookie via `document.cookie`. O
 * caminho de rotina funciona sem middleware nenhum.
 *
 * SUBESTIMADO, E É ESTE O PROBLEMA: o refresh token do GoTrue é ROTACIONADO —
 * cada renovação queima o token usado e emite outro. Quando a renovação
 * acontece dentro de um Server Component, o servidor QUEIMA o refresh token e o
 * substituto é engolido pelo `catch`. O navegador continua segurando o token
 * gasto. Enquanto durar o intervalo de tolerância a reuso, ele ainda funciona;
 * passado o intervalo, a renovação seguinte falha DE VEZ e a sessão morre — sem
 * erro no servidor, sem log, e sem relação aparente com a página que a pessoa
 * abriu. É um sintoma mais agudo e mais provável do que "vence com o tempo", e
 * é exatamente ele que este middleware evita: aqui existe um objeto de resposta,
 * então o cookie novo é devolvido ao navegador na mesma requisição que o gerou.
 *
 * O middleware NÃO GUARDA ROTA. Nenhum redirecionamento acontece aqui, e isso é
 * deliberado: `/account/verify-email` e `/account/reset-password` recebem o
 * `?code=` do GoTrue AINDA SEM SESSÃO, e um guard ingênuo mandaria essas duas
 * para o login antes de o navegador ter chance de trocar o código pela sessão —
 * quebrando confirmação de e-mail e recuperação de senha de uma vez só. Quem
 * protege a área da conta continua sendo a RLS no banco, que é a única camada
 * que um cliente não pode contornar.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ESQUEMA, chaveAnonima, urlSupabase } from "./lib/supabase/ambiente";
import { LOCALES, LOCALE_PADRAO } from "./lib/i18n/tipos";
import { caminhoSemLocale, ehCaminhoTransacional } from "./lib/i18n/rotas";

let jaReclamou = false;

/**
 * O que o rewrite de idioma nunca toca.
 *
 * A regra do arquivo estático é por extensão e não por lista: `/robots.txt`,
 * `/imagem-banner.jpg` e `/logo-canastra.png` são servidos de `public/` e não
 * existem sob `[locale]`. O `matcher` no fim deste arquivo já barra a maioria
 * deles, mas ele é uma expressão regular longa e frágil — esta checagem é a
 * rede embaixo, e custa um teste de regex.
 */
function foraDoIdioma(caminho: string): boolean {
  return (
    caminho.startsWith("/api") ||
    caminho.startsWith("/_next") ||
    caminho.startsWith("/dashboard") ||
    /\.[^/]+$/.test(caminho) ||
    ehCaminhoTransacional(caminho)
  );
}

/** O primeiro segmento do caminho: `/en/cafes` → `"en"`, `/` → `""`. */
function idiomaNaUrl(caminho: string): string {
  return caminho.split("/")[1] ?? "";
}

/**
 * O destino interno do rewrite, ou `null` quando a requisição passa intocada.
 */
function destinoDoRewrite(requisicao: NextRequest): URL | null {
  const caminho = requisicao.nextUrl.pathname;
  if (foraDoIdioma(caminho)) return null;
  // Já tem idioma na URL — inclusive `/pt`, que o bloco abaixo trata antes de
  // chegar aqui. Reescrever de novo daria `/pt/en/cafes`.
  if (LOCALES.some((locale) => locale === idiomaNaUrl(caminho))) return null;

  const destino = requisicao.nextUrl.clone();
  destino.pathname = caminho === "/" ? `/${LOCALE_PADRAO}` : `/${LOCALE_PADRAO}${caminho}`;
  return destino;
}

/**
 * `/pt/cafes` é um endereço que a loja nunca publica: o português mora em
 * `/cafes`. Deixá-lo responder 200 criaria uma segunda URL para cada página —
 * conteúdo duplicado no índice do buscador, e um canônico que não decide nada.
 *
 * AQUI O REDIRECT É O CERTO, e é o inverso exato do caso de cima: o endereço
 * prefixado NÃO é o canônico, então mudar a URL visível é justamente o
 * objetivo. Permanente (308) porque a regra não vai mudar, e 308 preserva o
 * método — um POST redirecionado não vira GET pelo caminho.
 */
function redirecionamentoDoPortugues(requisicao: NextRequest): URL | null {
  const caminho = requisicao.nextUrl.pathname;
  if (foraDoIdioma(caminho)) return null;
  if (idiomaNaUrl(caminho) !== LOCALE_PADRAO) return null;

  const destino = requisicao.nextUrl.clone();
  destino.pathname = caminhoSemLocale(caminho);
  return destino;
}

/**
 * `/en/checkout` e `/es/sacola` são endereços que a loja nunca publica e que
 * NÃO EXISTEM como rota: o caminho de compra vive em `app/(transacional)/`,
 * fora do `[locale]`. Sem esta regra eles respondiam 404 seco.
 *
 * Nenhum link gerado por `href()` produz um deles — a função devolve o caminho
 * transacional cru em qualquer idioma. Mas um cliente que troca `pt` por `en`
 * na barra de endereços, ou um link colado num grupo, cai exatamente aqui: um
 * 404 no meio do caminho que traz o dinheiro. O 308 leva ao endereço que
 * existe e que já fala português por decisão do cliente (spec §1), e o aviso
 * da moldura explica por quê.
 */
function redirecionamentoDoCaminhoDeCompra(requisicao: NextRequest): URL | null {
  const caminho = requisicao.nextUrl.pathname;
  const idioma = idiomaNaUrl(caminho);
  if (!LOCALES.some((locale) => locale === idioma)) return null;

  const semIdioma = caminhoSemLocale(caminho);
  if (!ehCaminhoTransacional(semIdioma)) return null;

  const destino = requisicao.nextUrl.clone();
  destino.pathname = semIdioma;
  return destino;
}

export async function middleware(requisicao: NextRequest) {
  // Vem ANTES do redirect do português porque `/pt/checkout` casa com os dois,
  // e os dois mandam para o mesmo lugar — mas só este sabe explicar por quê.
  const compra = redirecionamentoDoCaminhoDeCompra(requisicao);
  if (compra) return NextResponse.redirect(compra, 308);

  const canonico = redirecionamentoDoPortugues(requisicao);
  if (canonico) {
    // Sai antes da renovação de propósito: o navegador vai refazer a
    // requisição no endereço canônico em seguida, e é lá que a sessão se
    // renova. Renovar aqui queimaria um refresh token para responder um 308.
    return NextResponse.redirect(canonico, 308);
  }

  /**
   * O REWRITE É DECIDIDO AQUI E APLICADO EM TODA RESPOSTA QUE SAIR DAQUI.
   *
   * Este fecho é o ponto delicado da fusão das duas responsabilidades. O
   * `setAll` do @supabase/ssr, mais abaixo, RECRIA a resposta do zero para
   * devolver o token renovado; se essa recriação chamasse `NextResponse.next`
   * direto, o rewrite sumiria — e a loja inteira responderia 404 SÓ para quem
   * tem sessão, que é o tipo de bug que passa por toda a verificação manual.
   * Enquanto as duas pontas passarem por aqui, isso não acontece.
   */
  const destino = destinoDoRewrite(requisicao);
  const criarResposta = () =>
    destino
      ? NextResponse.rewrite(destino, { request: requisicao })
      : NextResponse.next({ request: requisicao });

  let url: string;
  let chave: string;

  try {
    url = urlSupabase();
    chave = chaveAnonima();
  } catch (erro) {
    /**
     * Configuração faltando NÃO PODE DERRUBAR A LOJA INTEIRA.
     *
     * `ambiente.ts` lança de propósito, e faz bem: numa página, o erro aparece
     * onde alguém consegue ler. Aqui não — o middleware roda em TODA
     * requisição, inclusive na home e nas páginas de catálogo, que não precisam
     * de sessão nenhuma. Deixar subir trocaria "cliente não fica logado" por
     * "a loja inteira responde 500", que é infinitamente pior.
     *
     * O aviso sai UMA vez por instância, para não afogar o log do servidor.
     *
     * O REWRITE SAI JUNTO com esta resposta: sem ele, uma env faltando deixa
     * de ser "cliente não fica logado" e passa a ser "a loja inteira responde
     * 404", que é exatamente o desastre que este bloco existe para evitar.
     */
    if (!jaReclamou) {
      jaReclamou = true;
      console.error(
        "[middleware] Sem configuração do Supabase: a sessão não será " +
          "renovada nesta requisição nem nas seguintes. " +
          (erro instanceof Error ? erro.message : String(erro)),
      );
    }
    return criarResposta();
  }

  let resposta = criarResposta();

  const supabase = createServerClient(url, chave, {
    // Mesmo esquema do resto do front. Ver lib/supabase/ambiente.ts.
    db: { schema: ESQUEMA },
    cookies: {
      getAll() {
        return requisicao.cookies.getAll();
      },
      /**
       * O SEGUNDO ARGUMENTO NÃO É OPCIONAL AQUI, e é o que separa este
       * middleware de um que vaza sessão.
       *
       * O `@supabase/ssr` 0.12.4 passa, junto dos cookies,
       * `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`,
       * `Expires: 0` e `Pragma: no-cache`
       * (`@supabase/ssr/dist/module/types.d.ts`). A resposta que carrega um
       * `Set-Cookie` de sessão é, por definição, específica de UMA pessoa; sem
       * esses cabeçalhos, o proxy reverso na frente da loja pode guardá-la e
       * servir o `Set-Cookie` de um cliente para o próximo visitante — que
       * passa a estar logado na conta alheia, com o pedido e o endereço dela.
       *
       * A topologia aprovada deste projeto é origem única atrás de proxy
       * reverso, que é exatamente a configuração que o aviso descreve. Não é
       * hipótese distante.
       *
       * `servidor.ts` ignorar esse argumento está certo: lá o cofre é o de
       * `next/headers` e não existe objeto de resposta onde pôr cabeçalho.
       */
      setAll(cookiesParaGravar, cabecalhos) {
        // Os cookies entram TAMBÉM na requisição para que qualquer leitura
        // seguinte, ainda nesta passagem, veja o token já renovado em vez do
        // que veio do navegador.
        for (const { name, value } of cookiesParaGravar) {
          requisicao.cookies.set(name, value);
        }

        // A resposta é refeita a partir da requisição atualizada — é o padrão
        // do @supabase/ssr, e sem ele os cookies novos não acompanham o
        // `request` repassado adiante. Passa por `criarResposta` e não por
        // `NextResponse.next` para o rewrite de idioma sobreviver à recriação.
        resposta = criarResposta();

        for (const { name, value, options } of cookiesParaGravar) {
          resposta.cookies.set(name, value, options);
        }

        for (const [nome, valor] of Object.entries(cabecalhos ?? {})) {
          resposta.headers.set(nome, valor);
        }
      },
    },
  });

  /**
   * `getClaims()` E NÃO `getSession()`.
   *
   * `getSession()` devolve o que estiver no cookie sem conferir NADA — cookie é
   * meio inseguro, e o próprio supabase-js avisa isso na documentação do
   * método. `getClaims()` valida: com chave assimétrica ele confere a
   * assinatura localmente contra o JWKS; com HS256, que é o caso desta
   * instância, ele não tem o segredo e cai para `getUser()`, que pergunta ao
   * GoTrue.
   *
   * O PREÇO ESTÁ MEDIDO E ACEITO: com HS256 isso é uma ida ao GoTrue por
   * requisição não-estática. O `matcher` abaixo tira os estáticos da conta, e o
   * dia em que o projeto migrar para chaves de assinatura assimétricas a
   * verificação vira local e o custo some — sem mexer nesta linha.
   *
   * A chamada é obrigatória, e não uma checagem: é ELA que faz o supabase-js
   * perceber o token vencido, renová-lo e disparar o `setAll` acima. Sem
   * chamar nada, o middleware não faria absolutamente nada.
   */
  try {
    await supabase.auth.getClaims();
  } catch (erro) {
    // GoTrue fora do ar, DNS caído, timeout. A loja continua servindo páginas:
    // quem estiver logado segue com o token que tem, e quem não estiver não
    // perde nada. Derrubar a requisição aqui tiraria o catálogo do ar por causa
    // de um serviço de autenticação instável.
    console.warn("[middleware] Falha ao renovar a sessão do Supabase.", erro);
  }

  return resposta;
}

/**
 * O que NÃO passa por aqui.
 *
 * Arquivo estático não tem sessão para renovar, e cada passagem inútil é uma
 * ida ao GoTrue (ver a nota de `getClaims()` acima). `_next/static` e
 * `_next/image` saem porque são servidos com cache agressivo — e uma resposta
 * de imagem com `Set-Cookie` de sessão dentro é justamente o que o bloco de
 * cabeçalhos do `setAll` existe para impedir.
 *
 * `/dashboard` CONTINUA PASSANDO de propósito. Era por causa do painel legado,
 * que autenticava pelo mesmo GoTrue; a Onda 7 o apagou e a razão continua, mais
 * forte: o painel novo é feito de Server Components e Server Actions, que leem a
 * sessão do cookie A CADA requisição. Sem passar por aqui o cookie não é
 * renovado, e o gestor cai na tela de entrada no meio do trabalho.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|css|js|map)$).*)",
  ],
};
