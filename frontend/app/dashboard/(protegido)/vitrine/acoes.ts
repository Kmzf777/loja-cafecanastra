"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import type {
  PayloadDaVitrine,
  RespostaDaVitrine,
} from "@/lib/painel/vitrine/vitrine.logica";

/**
 * A gravação da vitrine.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE `salvarVitrine` É `exigirAdminEmAcao()`, E ISSO NÃO É
 * ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. Ou seja: a checagem do layout
 * roda DEPOIS de a ação ter gravado no banco. Quem descobrir o endereço de uma
 * Server Action pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função. A trava existe porque o erro é por OMISSÃO, e omissão é o
 * que ninguém revisa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA SERVER ACTION E NÃO UM `chamarApi` DO NAVEGADOR.
 *
 * Spec §2.4: no painel novo quem fala com o Express é o SERVIDOR do Next, que
 * já tem a sessão. O token para de trafegar no bundle — e, o que importa mais
 * nesta tela, `revalidatePath` passa a existir.
 *
 * Sem ele esta tela seria uma armadilha: a home é ISR com `revalidate = 3600`,
 * então o gestor salvaria o herói, abriria a loja, veria o texto antigo e
 * salvaria de novo — até concluir que o painel não funciona. Uma hora de
 * silêncio entre salvar e ver é indistinguível de um salvamento que não
 * aconteceu.
 *
 * (A dúvida registrada na spec — "o container do Next alcança o do Express na
 * rede do deploy?" — já está respondida pelo código que roda hoje: a home chama
 * `${API_BASE}/dashboard` do servidor a cada revalidação, em
 * `lib/catalogo/repositorio.ts`. Se esse caminho não existisse, a loja não teria
 * preço.)
 */

export type ResultadoDoSalvamento =
  | { ok: true; estado: RespostaDaVitrine }
  | { ok: false; erro: string };

export async function salvarVitrine(
  corpo: PayloadDaVitrine,
): Promise<ResultadoDoSalvamento> {
  await exigirAdminEmAcao();

  /**
   * O TOKEN DE QUEM ESTÁ LOGADO, para o Express aplicar `isAdmin` e o Postgres
   * aplicar RLS. É uma segunda ida ao Supabase nesta requisição (a primeira foi
   * `exigirAdminEmAcao`, que usa `getUser()`), e ela é deliberada: `getUser()`
   * confere o token COM o GoTrue e é o certo para decidir acesso; `getSession()`
   * é o único que devolve o access token para repassar adiante. Trocar o
   * primeiro pelo segundo economizaria uma chamada e passaria a confiar no
   * cookie para decidir quem entra, que é exatamente o que a cerca não faz.
   */
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token ?? null;

  if (!token) {
    // Só acontece se a sessão morrer entre a checagem acima e esta linha.
    return { ok: false, erro: "Sua sessão expirou. Entre de novo para continuar." };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/vitrine`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(corpo),
      // O painel nunca lê de cache: quem está editando precisa ver o que
      // acabou de gravar, não o que estava lá antes.
      cache: "no-store",
    });
  } catch (erro) {
    console.error("[painel] PUT /vitrine não chegou ao Express.", erro);
    return {
      ok: false,
      erro: "Não foi possível falar com o servidor. Nada foi salvo — tente de novo.",
    };
  }

  if (!res.ok) {
    /**
     * A FRASE DO SERVIDOR GANHA SEMPRE — é a regra de `fraseDeErro`. O
     * `PUT /vitrine` responde 400 com diagnóstico literal ("Campo desconhecido
     * em textos.heroi.pt: title. Os campos são: ...", "Idioma inválido"), e
     * trocar isso por "Erro ao salvar" transforma um problema de dois minutos
     * num chamado.
     */
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  /**
   * A LOJA INTEIRA, E NÃO SÓ A HOME.
   *
   * O herói vive em `/[locale]`, mas a barra de aviso vive no `<Cabecalho>`, que
   * o `MolduraDaLoja` monta em TODA página traduzida — home, listagem, PDP,
   * /clube, /historia. Revalidar só a home deixaria a barra antiga em quinze
   * PDPs estáticas, e o gestor veria o aviso novo numa página e o velho na
   * seguinte, sem entender por quê.
   *
   * `"layout"` é o que alcança a subárvore inteira do segmento; `"page"`
   * alcançaria só `/[locale]` em si. O caminho é o PADRÃO DA ROTA
   * (`/[locale]`), e não `/pt`: é assim que uma chamada só cobre os três
   * idiomas.
   *
   * `app/(transacional)` (sacola, checkout, conta) usa a mesma moldura e NÃO é
   * revalidado aqui — aquelas rotas são renderizadas sob demanda por natureza
   * (leem sessão e sacola), então não há cache a invalidar.
   */
  revalidatePath("/[locale]", "layout");

  // O `PUT` devolve o estado inteiro lido DENTRO da mesma transação — o painel
  // rebaseia o formulário com ele em vez de fazer uma segunda ida ao servidor
  // que poderia correr com outra escrita.
  const estado = (await res.json()) as RespostaDaVitrine;
  return { ok: true, estado };
}
