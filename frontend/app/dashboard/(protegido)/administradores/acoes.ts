"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  PAPEIS,
  ROTA_DE_ADMINISTRADORES,
  candidatosAPromover,
  consultaDeCandidatos,
  payloadDePromocao,
  type CandidatoAAdmin,
} from "@/lib/painel/administradores/administradores.logica";

/**
 * As escritas da tela de Administradores — promover, remover, e a busca de
 * quem promover.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE CADA UMA É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO —
 * e aqui é onde ela mais importa de todo o painel.
 *
 * O layout de `(protegido)` NÃO protege Server Action: a ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. Nas outras telas isso custaria
 * um status de pedido; AQUI custaria a loja: quem descobrisse o endereço desta
 * ação se promoveria a administrador sem nunca renderizar página nenhuma, e o
 * REVOKE de escrita em `canastra.admins` (0003:269) — que existe justamente
 * para impedir a auto-promoção — não valeria nada, porque o pool do Express
 * conecta como dono e passa.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função — inclusive se a chamada estiver COMENTADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A BUSCA TAMBÉM É SERVER ACTION, e não um `chamarApi` do navegador.
 *
 * Ela é LEITURA, então parece exagero. Não é: `GET /auth/users?q=` procura por
 * CPF e e-mail, e num `chamarApi` o token do gestor e o CPF digitado
 * atravessariam o bundle do navegador para uma rota que o Server Component
 * desta casa já sabe chamar com a sessão que tem. Spec §2.4: quem fala com o
 * Express é o SERVIDOR do Next. E, como a busca não vai para a URL (ver
 * `consultaDeCandidatos`), este é o único caminho que a mantém fora do
 * histórico.
 */

export type ResultadoDaAcao =
  | { ok: true; frase: string }
  | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin`.
 *
 * Segunda ida ao Supabase nesta requisição (a primeira foi `exigirAdminEmAcao`,
 * que usa `getUser()`), e ela é deliberada: `getUser()` confere o token COM o
 * GoTrue e é o certo para decidir acesso; `getSession()` é o único que devolve
 * o access token para repassar adiante.
 */
async function tokenDaAcao(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * `fetch` com `Authorization`, com o `res.ok` já conferido.
 *
 * `res.ok` É CONFERIDO porque `fetch` NÃO lança em 4xx/5xx — é exatamente por
 * não conferir que o painel legado já anunciou "Produto deletado!" com o
 * produto intacto. O corpo sai por `lerCorpo`, nunca por `res.json()` cru: os
 * 401/403 do `isAuthenticated` saem por `sendStatus`, com corpo VAZIO, e um
 * `json()` desprotegido quebra com SyntaxError justamente no caminho de sessão
 * expirada.
 *
 * A FRASE DO SERVIDOR GANHA SEMPRE (`fraseDeErro`), e nesta tela ela é o
 * produto: "Esta pessoa já é administradora da loja.", "Cliente não encontrado
 * nesta loja.", e sobretudo a do último administrador — que sai com a chave
 * `message`, a mesma de `DELETE /auth/users/:id`, de propósito. Trocá-las por
 * "Erro ao salvar" transformaria um problema de dois minutos num chamado.
 */
async function chamar(
  caminho: string,
  init: RequestInit,
): Promise<{ ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string }> {
  const token = await tokenDaAcao();
  if (!token) {
    // Só acontece se a sessão morrer entre `exigirAdminEmAcao` e esta linha.
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
      // O painel nunca lê de cache: quem administra precisa ver o que está no
      // banco agora, não o que estava lá antes.
      cache: "no-store",
    });
  } catch (erro) {
    console.error(`[painel] ${caminho} não chegou ao Express.`, erro);
    return {
      ok: false,
      // Sem código HTTP nenhum: não houve resposta. Dizer "erro 500" apontaria
      // para o servidor da loja quando o problema pode ser a rede desta máquina.
      erro: "A API não respondeu. Nada foi alterado — tente de novo.",
    };
  }

  if (!res.ok) {
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }
  return { ok: true, corpo: (await lerCorpo(res)) as Record<string, unknown> };
}

/**
 * Promove um cliente a administrador.
 *
 * AS GUARDAS ESTÃO REPETIDAS AQUI embora a tela também as faça: uma Server
 * Action é uma SUPERFÍCIE DE REDE, e quem a invocar direto não passa pelo
 * diálogo. O backend valida tudo de novo — é ele a autoridade —, mas recusar
 * aqui devolve a frase certa sem gastar uma ida.
 */
export async function promoverAdministrador(
  userId: string,
  papel: string,
): Promise<ResultadoDaAcao> {
  await exigirAdminEmAcao();

  const alvo = (userId ?? "").trim();
  if (!alvo) {
    return { ok: false, erro: "Escolha quem promover." };
  }
  if (!PAPEIS.some((p) => p.valor === papel)) {
    /* A frase nomeia os papéis que existem, como o backend faria — "Papel
       inválido" sozinho mandaria o gestor adivinhar qual é o certo. */
    return {
      ok: false,
      erro: `Papel inválido. Use um de: ${PAPEIS.map((p) => p.valor).join(", ")}.`,
    };
  }

  const r = await chamar("/admin/administradores", {
    method: "POST",
    body: JSON.stringify(payloadDePromocao(alvo, papel)),
  });
  if (!r.ok) return r;

  revalidatePath(ROTA_DE_ADMINISTRADORES);
  /*
    A frase é MONTADA AQUI e não vem do servidor: o `POST` responde a LINHA
    criada (`{user_id, papel, criado_em}`), sem `message` — e é bom que seja
    assim, porque o servidor não sabe o nome da pessoa. Quem sabe é a tela, e
    ela passa o nome adiante. Uma confirmação que não nomeia quem foi promovido
    não confirma nada.
  */
  return { ok: true, frase: "Administrador promovido." };
}

/**
 * Remove o papel de administrador — NÃO apaga a conta.
 *
 * A distinção é a coisa mais importante desta ação, e por isso ela está no
 * nome, no comentário e na frase da confirmação (`fraseDaRemocao`):
 * `DELETE /admin/administradores/:userId` tira o CRACHÁ, e a conta de cliente
 * continua com pedidos e histórico. `DELETE /auth/users/:id`, que é outra rota
 * e outra tela, apaga tudo.
 *
 * O 409 DO ÚLTIMO ADMINISTRADOR CHEGA INTEIRO à tela — a tela avisa antes, mas
 * o aviso é sobre a lista que ela carregou. Entre carregar e clicar, outro
 * gestor pode ter removido um terceiro; aí a autoridade é o trigger
 * `admins_nunca_zero`, e a frase dele é o que o gestor precisa ler.
 */
export async function removerAdministrador(
  userId: string,
): Promise<ResultadoDaAcao> {
  await exigirAdminEmAcao();

  const alvo = (userId ?? "").trim();
  if (!alvo) return { ok: false, erro: "Escolha quem remover." };

  const r = await chamar(`/admin/administradores/${encodeURIComponent(alvo)}`, {
    method: "DELETE",
  });
  if (!r.ok) return r;

  revalidatePath(ROTA_DE_ADMINISTRADORES);
  return {
    ok: true,
    frase:
      typeof r.corpo.message === "string"
        ? r.corpo.message
        : "Administrador removido.",
  };
}

export type ResultadoDaBusca =
  | { ok: true; candidatos: CandidatoAAdmin[]; todosJaSaoAdmin: boolean }
  | { ok: false; erro: string };

/**
 * Procura clientes para promover, já sem quem administra.
 *
 * `jaSaoAdmin` VEM DA TELA, e não de uma segunda leitura daqui. A tela acabou
 * de renderizar a lista de administradores; pedi-la de novo a cada tecla seria
 * uma consulta por gesto para responder algo que já está na mão. O filtro é
 * conveniência — trocar um 409 por uma opção que não aparece —, e a autoridade
 * continua sendo o servidor, que responde 409 se alguém promover a mesma pessoa
 * no meio do caminho.
 */
export async function buscarCandidatos(
  busca: string,
  jaSaoAdmin: string[],
): Promise<ResultadoDaBusca> {
  await exigirAdminEmAcao();

  const r = await chamar(consultaDeCandidatos(busca ?? ""), { method: "GET" });
  if (!r.ok) return r;

  const users = Array.isArray(r.corpo.users)
    ? (r.corpo.users as CandidatoAAdmin[])
    : [];
  const candidatos = candidatosAPromover(
    users,
    (jaSaoAdmin ?? []).map((user_id) => ({ user_id })),
  );

  return {
    ok: true,
    candidatos,
    /*
      A DIFERENÇA ENTRE "não achei ninguém" E "achei, mas já são todos admins"
      é um dos três vazios do R16, e ela só se sabe aqui: depois do filtro, as
      duas viram uma lista vazia igual. Sem este sinalizador, a tela mandaria o
      gestor criar uma conta para quem já administra a loja.
    */
    todosJaSaoAdmin: users.length > 0 && candidatos.length === 0,
  };
}
