/**
 * Configuração compartilhada pelos dois clientes Supabase.
 *
 * Existe como arquivo separado por um motivo prático: `cliente.ts` só roda no
 * navegador e `servidor.ts` importa `next/headers` (que explode fora de um
 * request). Se a leitura das variáveis morasse em um dos dois, o outro teria de
 * importar código que não pode carregar. Aqui não há dependência nenhuma.
 */

/**
 * O esquema onde vive TODA a loja. A migração F1 criou as tabelas em `canastra`,
 * não em `public`.
 *
 * Sem `db: { schema: "canastra" }` no cliente, cada `.from("...")` procura em
 * `public` e o PostgREST responde 404 — banco perfeito, tela vazia, nenhum erro
 * no servidor. É a falha número um deste stack.
 *
 * E a opção do cliente SOZINHA não basta: o esquema também precisa estar na
 * lista "Exposed schemas" (Settings > API > Data API) do projeto. Sem isso a
 * resposta real, já medida no servidor de verdade, é:
 *
 *   PGRST106 — Invalid schema: canastra
 *   hint: Only the following schemas are exposed: public, graphql_public
 *
 * Ou seja: um 404/406 com o banco instalado e correto. Se algum dia as queries
 * voltarem vazias, confira o painel ANTES de mexer no código.
 */
export const ESQUEMA = "canastra";

/**
 * NUNCA coloque a `service_role` (nem qualquer `sb_secret_…`) neste módulo.
 *
 * Tudo prefixado com `NEXT_PUBLIC_` é substituído literalmente no bundle e
 * baixado por quem visita a loja — a chave ficaria legível em "view source".
 * A `service_role` ignora RLS: entregá-la ao navegador é entregar o banco
 * inteiro, leitura e escrita, para qualquer visitante.
 *
 * Se aparecer um erro de permissão, a resposta é uma policy de RLS no banco,
 * não uma chave mais forte aqui.
 */

/**
 * Falha alto e com nome.
 *
 * Mesma razão de `conferirApiBase()` em `lib/conta/sessao.ts`: configuração
 * errada neste stack não dá erro, dá 404 e tela vazia — o sintoma aparece longe
 * da causa e a investigação começa no lugar errado. Melhor quebrar na primeira
 * chamada dizendo qual variável falta.
 */
function exigir(valor: string | undefined, nome: string): string {
  const limpo = valor?.trim();
  if (!limpo) {
    throw new Error(
      `[supabase] ${nome} não está definida. Sem ela nenhuma consulta ao ` +
        "Supabase funciona: o navegador não sabe com qual projeto falar e as " +
        "chamadas falham em silêncio. Defina no .env.local (dev) e nas " +
        "variáveis de ambiente do build de produção.",
    );
  }
  return limpo;
}

/**
 * ATENÇÃO ao ler `process.env` aqui.
 *
 * O Next não injeta um objeto `process.env` no bundle do navegador: ele faz
 * busca-e-troca no TEXTO do código. Só a forma literal
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` vira a string do projeto. Um acesso
 * dinâmico — `process.env[nome]` — não é reconhecido pelo compilador, sobrevive
 * como acesso a um objeto que no navegador é `{}`, e devolve `undefined` em
 * produção enquanto funciona perfeitamente em `next dev` e nos testes.
 *
 * Por isso os dois nomes estão escritos por extenso abaixo, e o helper recebe o
 * valor já resolvido. Não troque por um loop "mais limpo".
 */
export function urlSupabase(): string {
  return exigir(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  ).replace(/\/$/, "");
}

export function chaveAnonima(): string {
  return exigir(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
