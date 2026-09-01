/**
 * Origem da API Express — UMA definição para a vitrine inteira.
 *
 * Antes eram quatro cópias (conta/sessao, catalogo/repositorio, sacola/cupom,
 * config-loja) com normalizações levemente diferentes: umas tiravam a barra
 * final, outras não — e `NEXT_PUBLIC_API_URL=http://host/` teria montado
 * `http://host//config` só em parte dos módulos. Uma constante, uma regra.
 *
 * `NEXT_PUBLIC_*` é resolvida em tempo de BUILD e embutida no bundle. Se a
 * variável faltar no build de produção, o fallback de desenvolvimento é assado
 * no JavaScript que o cliente baixa e a loja pública tenta falar com a máquina
 * de quem visita — `conferirApiBase()` em lib/conta/sessao.ts detecta esse
 * estado em runtime e grita no console.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A ORIGEM É DUAS, E NÃO UMA
 *
 * Em produção esta loja roda com `NEXT_PUBLIC_API_URL=/api`: o Traefik atende
 * a vitrine e a API na MESMA origem, e o `/api` é removido antes de chegar ao
 * Express. Para o NAVEGADOR isso é perfeito — URL relativa resolve contra a
 * origem da página, e não há CORS nem domínio a mais para configurar.
 *
 * Para o SERVIDOR, não existe "origem da página". O `fetch` do Node exige URL
 * absoluta e recusa a relativa antes de abrir conexão nenhuma:
 *
 *   TypeError: Failed to parse URL from /api/admin/orders?page=1&limit=20
 *     [cause]: TypeError: Invalid URL
 *
 * O erro cai no `catch` de `lib/painel/api-servidor.ts`, que — corretamente,
 * porque dali não dá para saber a causa — desenha "A API não respondeu".
 * O sintoma é o pior tipo: a API está de pé, `/api/health` responde 200 pelo
 * navegador, e o log dela está VAZIO, porque a requisição nunca saiu da
 * vitrine. Aconteceu em 01/09/2026, no dia em que `loja_api` saiu de
 * `replicas: 0`; antes disso tudo falhava de qualquer jeito e o defeito ficou
 * escondido desde o primeiro deploy.
 *
 * `API_URL_INTERNA` é a saída, e NÃO é `NEXT_PUBLIC_`: de propósito. Variável
 * pública é inlinada no bundle em build (conferido: `NEXT_PUBLIC_API_URL` não
 * aparece uma vez sequer em `.next/server`, e o literal `"/api"` aparece dez).
 * Sem o prefixo, o Next a lê em RUNTIME — trocá-la é reiniciar o serviço, não
 * reconstruir a imagem de 465 MB.
 *
 * No Swarm ela vale `http://api:3333`: o DNS da rede `canastrainteligencia`
 * resolve o nome do serviço, o tráfego não sai do host e não atravessa a
 * Cloudflare. Medido de dentro do container: 120 ms contra 419 ms pela URL
 * pública.
 *
 * Módulo sem dependência nenhuma, de propósito: é importado por módulos puros
 * testados em node e por Server Components — qualquer import aqui viraria
 * bagagem de todos eles.
 */

/**
 * A regra, separada do ambiente para poder ser testada sem mexer em
 * `process.env` nem fingir um `window`. Devolve sempre sem barra final.
 *
 * A PRECEDÊNCIA É DELIBERADA. No servidor, `interna` ganha quando existe; o
 * fallback é o valor do build, que pode ser relativo — e aí não há conserto
 * possível aqui, só o erro do `fetch` mais adiante. Preferir o valor do build
 * quando ele é absoluto (e não relativo) mantém funcionando o caso de quem
 * roda `next start` na mão, apontando para uma API em outra máquina, sem
 * `API_URL_INTERNA` definida.
 */
export function resolverApiBase({
  noNavegador,
  doBuild,
  interna,
}: {
  noNavegador: boolean;
  doBuild: string | undefined;
  interna: string | undefined;
}): string {
  const semBarra = (v: string) => v.replace(/\/$/, "");
  const publica = semBarra(doBuild || "http://localhost:3333");

  if (noNavegador) return publica;
  return interna ? semBarra(interna) : publica;
}

export const API_BASE = resolverApiBase({
  // `typeof window` e não `typeof document`: é o mesmo teste que
  // `conferirApiBase()` em lib/conta/sessao.ts usa, e duas formas de perguntar
  // a mesma coisa no mesmo projeto é uma a mais.
  noNavegador: typeof window !== "undefined",
  doBuild: process.env.NEXT_PUBLIC_API_URL,
  interna: process.env.API_URL_INTERNA,
});
