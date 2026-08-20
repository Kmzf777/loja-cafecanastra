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
 * Módulo sem dependência nenhuma, de propósito: é importado por módulos puros
 * testados em node e por Server Components — qualquer import aqui viraria
 * bagagem de todos eles.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333"
).replace(/\/$/, "");
