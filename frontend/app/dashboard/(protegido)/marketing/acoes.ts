"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import type { Campanha, PayloadDeCampanha } from "@/lib/painel/marketing/campanhas.logica";
import type {
  Consentimento,
  PayloadDeConsentimento,
} from "@/lib/painel/marketing/consentimentos.logica";
import {
  URL_DO_DISPARADOR,
  type PayloadDoDisparo,
} from "@/lib/painel/marketing/publico.logica";

/**
 * As escritas de Marketing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `exigirAdminEmAcao()` É A PRIMEIRA LINHA DE TODAS ELAS, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. A checagem do layout roda
 * DEPOIS de a ação ter gravado no banco, e quem descobrir o endereço de uma
 * Server Action pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` não chamar esta função — e
 * ele ignora comentário, porque a versão anterior da trava passava verde com a
 * chamada comentada.
 *
 * AQUI ELA PESA MAIS QUE NAS OUTRAS TELAS: `dispararWhatsapp` fala com um
 * webhook SEM AUTENTICAÇÃO em nome da loja. Se esta ação ficasse aberta, ela
 * seria um caminho autenticado por ninguém para mandar mensagem para uma lista
 * de números — que é o pior tipo de furo que este painel poderia ter.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin`.
 *
 * É uma segunda ida ao Supabase na requisição (a primeira foi
 * `exigirAdminEmAcao`, que usa `getUser()`), e ela é deliberada: `getUser()`
 * confere o token COM o GoTrue e é o certo para decidir acesso; `getSession()`
 * é o único que devolve o access token para repassar adiante. Trocar o primeiro
 * pelo segundo economizaria uma chamada e passaria a confiar no cookie para
 * decidir quem entra — que é exatamente o que a cerca não faz.
 */
async function tokenDaSessao(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * A escrita autenticada na API Express, com a frase de erro já resolvida.
 *
 * `res.ok` É CONFERIDO SEMPRE, e a linha existe por um defeito real desta casa:
 * `fetch` NÃO lança em 4xx nem em 5xx, e o painel legado já anunciou "Produto
 * deletado!" com o produto intacto por causa disso. Um `await res.json()` logo
 * depois do fetch, sem olhar o status, transforma toda recusa do servidor num
 * sucesso silencioso.
 *
 * E A LEITURA DO CORPO É PELO `lerCorpo`, nunca `res.json()` cru: os 401/403 do
 * `isAuthenticated` saem por `sendStatus`, com corpo VAZIO — um `res.json()`
 * ali estoura com SyntaxError justamente no caminho de sessão expirada, que é o
 * menos testado de todos.
 */
async function escreverNaApi<T>(
  caminho: string,
  metodo: "POST" | "PATCH",
  corpo: unknown,
): Promise<Resultado<T>> {
  const token = await tokenDaSessao();
  if (!token) {
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}`, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      cache: "no-store",
    });
  } catch (erro) {
    console.error(`[painel] ${metodo} ${caminho} não chegou ao Express.`, erro);
    return {
      ok: false,
      // "Nada foi salvo" é a metade que importa: o pior estado não é o erro, é
      // não saber se aconteceu (R14).
      erro: "Não foi possível falar com o servidor. Nada foi salvo — tente de novo.",
    };
  }

  if (!res.ok) {
    /*
      A FRASE DO SERVIDOR GANHA SEMPRE. "A UTM da campanha não pode conter
      espaço — use hífen (dia-das-maes-2026)." é o diagnóstico; trocá-la por
      "Erro ao salvar" transforma um problema de dois minutos num chamado.
    */
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  try {
    return { ok: true, dados: (await res.json()) as T };
  } catch {
    return {
      ok: false,
      erro: "A API respondeu algo que não é JSON. Recarregue a página e confira.",
    };
  }
}

/**
 * O caminho a revalidar depois de cada escrita.
 *
 * `"page"` e não `"layout"`: a área de Marketing não tem nada em cache abaixo
 * dela, e revalidar o layout arrastaria as outras telas do painel sem motivo.
 */
function revalidarMarketing(caminho: string) {
  revalidatePath(caminho, "page");
}

/* -------------------------------------------------------------------------- *
 * Campanhas
 * -------------------------------------------------------------------------- */

/**
 * Cria a campanha — ou ATUALIZA a que já tem esta UTM.
 *
 * O UPSERT É DO BACKEND, e a tela precisa saber qual dos dois aconteceu: 201 é
 * criação, 200 é sobrescrita da campanha que já usava aquela UTM. Reimportar a
 * planilha do anúncio é o gesto normal, e "criei" e "sobrescrevi uma que já
 * estava rodando" são notícias diferentes para quem acabou de clicar.
 *
 * `escreverNaApi` não expõe o status, então a distinção vem de uma comparação
 * do que voltou: campanha cujo `criada_em` e `atualizada_em` são o mesmo
 * instante nasceu agora. É o mesmo critério que o `xmax = 0` do repositório usa
 * do lado do banco, e não custa uma ida a mais.
 */
export async function salvarCampanha(
  payload: PayloadDeCampanha,
): Promise<Resultado<{ campanha: Campanha; criou: boolean }>> {
  await exigirAdminEmAcao();

  const resposta = await escreverNaApi<Campanha>("/admin/campanhas", "POST", payload);
  if (!resposta.ok) return resposta;

  revalidarMarketing("/dashboard/marketing");
  return {
    ok: true,
    dados: {
      campanha: resposta.dados,
      criou: resposta.dados.criada_em === resposta.dados.atualizada_em,
    },
  };
}

/**
 * Liga e desliga a campanha — o PATCH parcial.
 *
 * MANDA SÓ `ativa`, e é por isso que ele é seguro: `PATCH /admin/campanhas/:id`
 * é parcial de verdade (UPDATE dinâmico, só o que veio no corpo muda). É o
 * conserto explícito do defeito que `PUT /promotions/:id` carrega nesta loja,
 * onde campo ausente vira NULL e um toggle apagaria título, datas e categoria.
 * Aqui, mandar o objeto inteiro seria o erro — e é o que faz este toggle NÃO
 * precisar carregar o formulário junto.
 */
export async function alternarCampanha(
  id: string,
  ativa: boolean,
): Promise<Resultado<Campanha>> {
  await exigirAdminEmAcao();

  const resposta = await escreverNaApi<Campanha>(
    `/admin/campanhas/${encodeURIComponent(id)}`,
    "PATCH",
    { ativa },
  );
  if (resposta.ok) revalidarMarketing("/dashboard/marketing");
  return resposta;
}

/* -------------------------------------------------------------------------- *
 * Consentimentos
 * -------------------------------------------------------------------------- */

/**
 * Registra um consentimento — ou a REVOGAÇÃO dele.
 *
 * SEMPRE UM POST, NUNCA UM PATCH, e a ausência do PATCH no backend é a decisão:
 * a tabela é o HISTÓRICO da autorização, e é ele que responde "com base em quê
 * vocês me mandaram esta mensagem em março?". Revogar é uma linha NOVA;
 * corrigir a antiga apagaria a prova do que valia antes.
 */
export async function registrarConsentimento(
  payload: PayloadDeConsentimento,
): Promise<Resultado<Consentimento>> {
  await exigirAdminEmAcao();

  const resposta = await escreverNaApi<Consentimento>(
    "/admin/consentimentos",
    "POST",
    payload,
  );
  if (resposta.ok) {
    revalidarMarketing("/dashboard/marketing/consentimentos");
    // O público de WhatsApp é derivado desta tabela: uma revogação registrada
    // aqui tem de encolher aquela lista na próxima visita, e não na próxima
    // hora.
    revalidarMarketing("/dashboard/marketing/whatsapp");
  }
  return resposta;
}

/**
 * Consulta o histórico de UM titular pelo e-mail.
 *
 * O E-MAIL VIAJA NO CORPO DA AÇÃO, E NÃO NA URL — é a ressalva do R2 ("nunca
 * CPF, e-mail ou endereço na query string") aplicada onde ela mais importa: uma
 * URL de painel vai para o histórico do navegador, para o `Referer` e para o
 * print que alguém cola num grupo, e nesta tela isso seria a ferramenta de
 * conformidade vazando o dado que ela existe para proteger.
 *
 * O PREÇO ESTÁ ACEITO E DECLARADO: o resultado não sobrevive ao F5, porque não
 * há nada na URL para reconstruí-lo. A tela diz isso em texto, em vez de
 * simplesmente não ter a consulta.
 */
export async function consultarTitular(
  email: string,
): Promise<Resultado<Consentimento[]>> {
  await exigirAdminEmAcao();

  const limpo = email.trim().toLowerCase();
  if (limpo === "") {
    return { ok: false, erro: "Informe o e-mail do titular." };
  }

  const token = await tokenDaSessao();
  if (!token) {
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/admin/consentimentos?email=${encodeURIComponent(limpo)}&limit=100`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
  } catch (erro) {
    console.error("[painel] GET /admin/consentimentos não completou.", erro);
    return { ok: false, erro: "A API não respondeu. Tente de novo." };
  }

  if (!res.ok) {
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  try {
    const corpo = (await res.json()) as { data?: Consentimento[] };
    return { ok: true, dados: corpo.data ?? [] };
  } catch {
    return { ok: false, erro: "A API respondeu algo que não é JSON." };
  }
}

/* -------------------------------------------------------------------------- *
 * WhatsApp — a única escrita que sai desta loja
 * -------------------------------------------------------------------------- */

/**
 * Entrega o público ao disparador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE NÃO É A API DESTA LOJA, e três coisas decorrem disso:
 *
 * 1. NÃO VAI `Authorization`. O webhook não tem autenticação nenhuma — mandar o
 *    token do Supabase para um host de terceiros seria vazar a credencial do
 *    gestor para fora do domínio da loja, por nada.
 *
 * 2. A CHAMADA SAI DO SERVIDOR DO NEXT, e não do navegador. Do navegador ela
 *    exigiria CORS no webhook (que não temos como configurar) e, pior, poria a
 *    URL de disparo num bundle que qualquer visitante da loja baixa.
 *
 * 3. `res.ok` É CONFERIDO IGUAL. Um webhook fora do ar responde 502 com HTML de
 *    gateway, e sem esta guarda a tela diria "disparado" para uma mensagem que
 *    ninguém recebeu — o pior desfecho possível numa tela de disparo, porque o
 *    gesto seguinte é repetir.
 *
 * A ESPERA É LONGA DE PROPÓSITO (30s): o disparador enfileira centenas de
 * números, e um timeout curto devolveria "não respondeu" para um disparo que
 * ESTÁ acontecendo — e aí o gestor dispara de novo, e a lista recebe duas
 * vezes. Entre esperar e duplicar, espera-se.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function dispararWhatsapp(
  payload: PayloadDoDisparo,
): Promise<Resultado<{ quantidade: number }>> {
  await exigirAdminEmAcao();

  /*
    A CONFERÊNCIA É REFEITA AQUI, e não só no formulário. O corpo desta ação
    chega do cliente e um cliente é sempre falsificável: sem esta guarda,
    `{ numeros: [] }` viraria uma ida ao webhook, e `{ mensagem: "" }` mandaria
    mensagem vazia para a lista inteira. As duas coisas são baratas de impedir e
    impossíveis de desfazer.
  */
  const numeros = (payload.numeros ?? []).filter((n) => /^\d{12,13}$/.test(n));
  const mensagem = (payload.mensagem ?? "").trim();

  if (mensagem === "") {
    return { ok: false, erro: "A mensagem chegou vazia — nada foi disparado." };
  }
  if (numeros.length === 0) {
    return { ok: false, erro: "O público chegou vazio — nada foi disparado." };
  }

  let res: Response;
  try {
    res = await fetch(URL_DO_DISPARADOR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagem, numeros }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (erro) {
    console.error("[painel] O disparador não respondeu.", erro);
    return {
      ok: false,
      // A frase NÃO diz "nada foi enviado", e a diferença é a honestidade: a
      // requisição pode ter chegado e a resposta ter se perdido. Mandar conferir
      // antes de repetir é o único conselho verdadeiro aqui.
      erro:
        "O disparador não respondeu. A mensagem PODE ter sido enviada — confira no WhatsApp antes de disparar de novo.",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      erro: `O disparador recusou o envio (código ${res.status}). Nada foi enviado.`,
    };
  }

  return { ok: true, dados: { quantidade: numeros.length } };
}
