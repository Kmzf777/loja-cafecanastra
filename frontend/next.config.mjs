/**
 * Cabecalhos de seguranca.
 *
 * Nenhum estava configurado. Para uma loja oficial, cada um destes fecha uma
 * classe inteira de ataque, e todos custam uma linha:
 *
 *  - CSP ......................... limita de onde script, estilo e imagem podem
 *                                  vir. E a defesa de fundo contra XSS: mesmo
 *                                  que alguem consiga injetar HTML, o navegador
 *                                  recusa executar script de outra origem.
 *  - HSTS ........................ obriga HTTPS nas visitas seguintes, fechando
 *                                  a janela de downgrade do primeiro acesso.
 *  - X-Frame-Options ............. impede que a loja seja embutida em iframe de
 *                                  terceiro (clickjacking sobre "Comprar").
 *  - X-Content-Type-Options ...... impede o navegador de adivinhar o tipo de um
 *                                  arquivo enviado pelo painel e executa-lo.
 *  - Referrer-Policy ............. nao vaza a URL completa (com parametros) a
 *                                  sites externos.
 *  - Permissions-Policy .......... desliga camera, microfone e geolocalizacao,
 *                                  que a loja nao usa.
 *
 * SOBRE 'unsafe-inline' E 'unsafe-eval' NO script-src
 *
 * ESTE PARAGRAFO JA CULPOU O PAINEL LEGADO, e estava errado. Dizia que as duas
 * diretivas existiam por causa do styled-components, e que apagar `legacy/`
 * destravaria as duas. A Onda 7 apagou o legado e mediu: uma sai, a outra nao,
 * e a razao da que fica nunca teve nada a ver com o painel.
 *
 *  - 'unsafe-eval' SAIU DE PRODUCAO. Foram medidos os 33 chunks de um build de
 *    producao: zero `eval(` e zero `new Function(`. Ele continua em
 *    DESENVOLVIMENTO porque o `next dev` gera source map por eval — tirar de la
 *    quebraria o console de quem depura, sem fechar nada em producao.
 *
 *  - 'unsafe-inline' FICA, e nao e omissao. Toda pagina pre-renderizada carrega
 *    de 34 a 44 <script> INLINE do proprio Next (o `self.__next_f.push(...)`,
 *    que e o payload RSC da hidratacao) e ZERO `nonce=` — medido em
 *    .next/server/app/*.html. Sem 'unsafe-inline' o navegador recusa todos
 *    eles e a loja inteira para de hidratar: nada clica, nada envia.
 *
 * O QUE SERIA PRECISO PARA TIRAR 'unsafe-inline', escrito aqui para o proximo
 * leitor nao repetir a investigacao: nonce por requisicao, gerado no
 * middleware, propagado para o Next e repetido no header. O custo e que nonce
 * OBRIGA render dinamico — e `/[locale]` hoje sai como ● (SSG), pre-renderizado
 * no build. Trocar a estatica da vitrine inteira (74 paginas) pela remocao de
 * uma diretiva que so protege contra XSS ja injetado e um mau negocio enquanto
 * nao houver superficie que aceite HTML de terceiro. Nao e uma tarefa de
 * limpeza: e uma decisao de arquitetura, e precisa ser tomada como tal.
 *
 * Um CSP com unsafe-inline ainda barra script de ORIGEM EXTERNA, que e o vetor
 * mais comum; e melhor que nao ter CSP.
 *
 * 'unsafe-inline' NO style-src TAMBEM FICA, e por outro motivo ainda: o
 * `next/image` escreve `style` inline nos seus <img>, e o painel le token de
 * cor em `style={{}}` com `var(--color-*)`. Sao superficies nossas, nao do
 * runtime — mas sao muitas.
 */

/** Origem da API, liberada no connect-src para o navegador poder falar com ela. */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

/**
 * A API só entra no CSP quando for origem ABSOLUTA (o caso do dev,
 * http://localhost:3333). Em produção NEXT_PUBLIC_API_URL é "/api" — mesma
 * origem atrás do nginx — e um caminho não é source expression válida em CSP:
 * o navegador ignoraria a diretiva inteira ou o valor, a depender do parser.
 * Nem faz falta: sendo mesma origem, o 'self' que já está em cada lista cobre.
 */
const API_CSP = /^https?:\/\//.test(API) ? API : "";

/**
 * Origem do projeto Supabase.
 *
 * O navegador passa a falar direto com o Supabase (PostgREST em /rest/v1, auth
 * em /auth/v1, realtime em wss://.../realtime/v1). O connect-src que existia
 * listava so 'self', a API e o Mercado Pago — ou seja, TODA chamada ao Supabase
 * seria bloqueada. E o bloqueio de CSP nao gera erro de servidor, nao aparece em
 * teste nenhum e nao quebra o build: so uma linha vermelha no console de quem
 * visita a loja, com a pagina carregando vazia.
 *
 * Nao vai chumbado: o projeto de producao tem outra referencia. Vem da mesma
 * variavel que lib/supabase/ambiente.ts le, entao os dois nao podem divergir.
 * O carregamento do .env acontece dentro do loadConfig do Next, ANTES deste
 * arquivo ser importado — mesmo mecanismo em que NEXT_PUBLIC_API_URL acima ja
 * se apoia.
 *
 * Um source https:// no CSP tambem cobre wss:// do mesmo host (CSP3), entao o
 * realtime nao precisa de entrada separada.
 */
const SUPABASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (!SUPABASE) {
  // Avisa em vez de abortar, pela mesma razao de conferirApiBase() em
  // lib/conta/sessao.ts: uma verificacao local tem de conseguir compilar sem o
  // projeto configurado. Mas o aviso fica no log do build, que e onde alguem
  // vai procurar quando a loja subir e nao carregar nada.
  console.warn(
    "[csp] NEXT_PUBLIC_SUPABASE_URL nao definida: a origem do Supabase NAO " +
      "entrou no connect-src. Se o build for de producao, o navegador vai " +
      "bloquear todas as chamadas ao banco.",
  );
}

/** Junta as origens de um source list ignorando as que nao foram configuradas. */
const origens = (...partes) => partes.filter(Boolean).join(" ");

/**
 * O `next dev` serve os modulos com source map por `eval()`, entao 'unsafe-eval'
 * so pode sair do CSP de producao. `NODE_ENV` e "development" sob `next dev` e
 * "production" sob `next build`/`next start` — o proprio Next o define, e nao
 * ha como esta linha divergir do modo em que o servidor esta rodando.
 */
const DESENVOLVIMENTO = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // sdk.mercadopago.com: o SDK v2 que tokeniza o cartao no navegador (o
  // checkout o injeta por script tag — lib/sacola/cartao.ts). O numero do
  // cartao nunca toca nosso servidor; sem esta origem o script nem carrega e o
  // pagamento por cartao morre em silencio no console do cliente.
  // googletagmanager.com: o gtag.js do GA4, que ScriptsAnalytics.tsx so injeta
  // com NEXT_PUBLIC_GA4_ID definida E consentimento aceito no banner — o CSP
  // precisa liberar a origem para o dia em que as duas condicoes valem.
  `script-src ${origens(
    "'self'",
    // Fica: o Next emite 34-44 <script> inline por pagina e nenhum nonce. Ver o
    // bloco do topo — tirar isto e parar a hidratacao da loja inteira.
    "'unsafe-inline'",
    // Sai de producao (zero eval nos chunks); fica no dev pelo source map.
    DESENVOLVIMENTO && "'unsafe-eval'",
    "https://sdk.mercadopago.com",
    "https://www.mercadopago.com",
    "https://www.googletagmanager.com",
  )}`,
  // 'unsafe-inline' aqui NAO e o mesmo debate do script-src: o `next/image`
  // escreve `style` inline nos <img> que ele gera, e o painel le token de cor
  // em `style={{}}`. Ver o bloco do topo.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // O backend serve /uploads (imagem enviada pelo painel quando o Cloudinary
  // nao esta configurado), entao a origem da API tambem precisa entrar aqui.
  //
  // O SUPABASE NAO ESTA AQUI, E ISSO E UMA PENDENCIA COM DATA MARCADA, nao um
  // esquecimento. A F2 nao usa Supabase Storage, entao liberar a origem hoje
  // seria permissao sem uso. Mas o spec (§151, §196) manda a imagem de produto
  // para o bucket, e no dia em que isso acontecer ESTA LINHA bloqueia todas
  // elas — com a mesma falha invisivel que motivou o bloco do connect-src la em
  // cima: nenhum erro de servidor, nenhum teste vermelho, so imagem quebrada no
  // navegador de quem visita.
  //
  // Sao DOIS lugares a mudar naquele dia, e esquecer o segundo da o mesmo
  // sintoma: esta linha (`${SUPABASE}`) e o `images.remotePatterns` mais abaixo,
  // que precisa do host do projeto para o <Image> do Next aceitar otimizar.
  `img-src ${origens("'self'", "data:", "blob:", API_CSP, "https://res.cloudinary.com", "https://cdn-icons-png.flaticon.com", "https://*.mlstatic.com")}`,
  // api.mercadopago.com: e para onde o SDK manda o numero tokenizar (e de onde
  // vem bandeira, emissor e parcelas). viacep.com.br: o CEP preenche o
  // endereco do checkout (lib/cep.ts) — sem a origem, a consulta falha em
  // silencio e vira digitacao manual, que e o fallback mas nao o desenho.
  // *.google-analytics.com e googletagmanager.com: os eventos do GA4 saem por
  // beacon para region1.google-analytics.com e afins; liberar so o script sem
  // o beacon mediria zero sem erro nenhum.
  `connect-src ${origens("'self'", API_CSP, SUPABASE, "https://api.mercadopago.com", "https://api.mercadolibre.com", "https://viacep.com.br", "https://*.google-analytics.com", "https://www.googletagmanager.com")}`,
  // Os SECURE FIELDS do CardForm: numero, validade e CVV do cartao viram
  // iframes servidos de subdominios do Mercado Pago (api-secure-fields e
  // afins, que mudam sem aviso) — por isso o curinga *.mercadopago.com, que
  // cobre tambem o www e o sdk. E o que faz o dado sensivel nunca existir no
  // nosso DOM.
  "frame-src https://*.mercadopago.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build de produção autocontido (F7): `next build` passa a emitir
  // .next/standalone/server.js com só o node_modules que o tracing provou
  // necessário — é o que a imagem Docker e o PM2 executam, sem instalar
  // devDependencies na VPS. Como `outputFileTracingRoot` logo abaixo aponta
  // para frontend/, o server.js sai direto em frontend/.next/standalone/.
  output: "standalone",
  // Ha package-lock.json na raiz do repositorio e em frontend/. Sem isto o Next
  // infere a raiz errada e o tracing de deploy pode empacotar do lugar errado.
  outputFileTracingRoot: import.meta.dirname,
  // Nao entregar a versao do Next no header: e reconhecimento gratis para quem
  // procura alvo com CVE conhecida.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Onde o painel hospeda a imagem de produto enviada pelo admin.
      { protocol: "https", hostname: "res.cloudinary.com" },
      // O host do Supabase entra aqui quando a imagem de produto migrar para o
      // Storage (spec §151, §196) — junto com o `img-src` do CSP, que e o outro
      // lugar. Fora da F2 porque a loja ainda nao serve imagem de la; deixado
      // escrito porque o sintoma de esquecer e imagem quebrada sem erro nenhum.
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
