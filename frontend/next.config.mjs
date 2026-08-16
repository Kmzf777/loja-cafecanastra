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
 * O painel legado usa styled-components, que injeta <style> em tempo de
 * execucao, e o runtime do Next usa scripts inline com nonce so quando ha
 * middleware para gera-lo. Remover essas permissoes hoje quebraria o painel —
 * que e justamente a area que o cliente pediu para priorizar. Ficam como
 * pendencia declarada em docs/producao.md, com o caminho (nonce via middleware)
 * escrito la. Um CSP com unsafe-inline ainda barra script de origem externa,
 * que e o vetor mais comum; e melhor que nao ter CSP.
 */

/** Origem da API, liberada no connect-src para o navegador poder falar com ela. */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://www.mercadopago.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // O backend serve /uploads (imagem enviada pelo painel quando o Cloudinary
  // nao esta configurado), entao a origem da API tambem precisa entrar aqui.
  `img-src 'self' data: blob: ${API} https://res.cloudinary.com https://cdn-icons-png.flaticon.com https://*.mlstatic.com`,
  `connect-src 'self' ${API} https://api.mercadopago.com https://api.mercadolibre.com`,
  // O checkout transparente do Mercado Pago roda os campos de cartao num iframe.
  "frame-src https://www.mercadopago.com https://sdk.mercadopago.com",
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
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
