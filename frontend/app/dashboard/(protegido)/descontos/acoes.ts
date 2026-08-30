"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  API_DESCONTOS,
  API_SIMULAR,
  ROTA_DE_DESCONTOS,
  type CarrinhoDaSimulacao,
  type PayloadDeRegra,
  type RegraCompleta,
  type RespostaDaSimulacao,
} from "@/lib/painel/descontos/contrato";

/**
 * As escritas da tela de Descontos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE CADA AÇÃO É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. Ou seja: a checagem do layout
 * roda DEPOIS de a ação ter gravado. Quem descobrir o endereço de uma Server
 * Action pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` não chamar esta função. A
 * trava existe porque o erro é por OMISSÃO, e omissão é o que ninguém revisa.
 * Numa tela que cria desconto, ela é a diferença entre uma regra de negócio e
 * um cupom de 90% cadastrado por quem não devia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `res.ok` EM TODA CHAMADA, SEM EXCEÇÃO.
 *
 * `fetch` não lança em 4xx nem em 5xx. O painel legado já anunciou "Produto
 * deletado!" com o produto intacto exatamente por isso. Aqui o preço de errar é
 * maior: "Desconto salvo" sobre um 400 faria o gestor publicar uma campanha que
 * não existe no banco.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A FRASE DO SERVIDOR É O DIAGNÓSTICO, e ela sobe inteira.
 *
 * `fraseDeErro` prefere `message`, depois `error`, e só cai no genérico quando
 * o corpo está vazio — que é o caso de 401 e 403, que saem por `sendStatus`
 * COM CORPO VAZIO e quebrariam um `res.json()` cru. Trocar "Já existe um código
 * CAFE20." por "Erro ao salvar" transforma um problema de dois minutos num
 * chamado. O checklist de paridade registra os dois pontos onde o painel legado
 * fazia isso — `PromotionsManager.jsx:200-203` é um deles — com a instrução de
 * corrigir, não de copiar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS ROTAS AINDA NÃO EXISTEM NO EXPRESS. Ver o cabeçalho de
 * `lib/painel/descontos/contrato.ts`: a Onda 3 criou as sete tabelas, a Onda 4
 * escreveu o motor, e nenhuma rota de administração do motor foi montada.
 * Enquanto isso, todas estas ações voltam 404 com frase — e a tela mostra a
 * frase, que é o comportamento correto para um módulo que o backend ainda não
 * tem.
 */

/** O que toda escrita desta tela devolve. Nunca `void`: uma ação que não diz
 *  se deu certo obriga a tela a adivinhar, e dinheiro não se adivinha (R14). */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin` e o Postgres
 * aplicar RLS. É uma segunda ida ao Supabase nesta requisição, e é deliberada:
 * `getUser()` (dentro de `exigirAdminEmAcao`) confere o token COM o GoTrue e é
 * o certo para decidir acesso; `getSession()` é o único que devolve o access
 * token para repassar adiante.
 */
async function tokenDaAcao(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

async function escrever<T>(
  caminho: string,
  metodo: "POST" | "PUT" | "PATCH" | "DELETE",
  corpo: unknown,
): Promise<Resultado<T>> {
  const token = await tokenDaAcao();
  if (!token) {
    // Só acontece se a sessão morrer entre a checagem de admin e esta linha.
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
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      // O painel nunca lê de cache: quem está editando precisa ver o que
      // acabou de gravar, não o que estava lá antes.
      cache: "no-store",
    });
  } catch (erro) {
    console.error(`[painel] ${metodo} ${caminho} não chegou ao Express.`, erro);
    return {
      ok: false,
      erro: "Não foi possível falar com o servidor. Nada foi salvo — tente de novo.",
    };
  }

  if (!res.ok) {
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }

  try {
    return { ok: true, dados: (await res.json()) as T };
  } catch {
    // 200 com corpo que não é JSON: proxy interceptando, HTML de gateway.
    // Tratar como sucesso entregaria `undefined` à tela.
    return { ok: false, erro: "A API respondeu algo que não é JSON. Recarregue a página." };
  }
}

/**
 * REVALIDAR A LISTA E A FICHA, sempre as duas.
 *
 * A lista mostra usos e valor descontado; a ficha mostra a regra. Revalidar só
 * uma faria o gestor salvar, voltar para a lista e ver o estado anterior — que
 * é indistinguível de um salvamento que não aconteceu.
 */
function revalidar(id?: string) {
  revalidatePath(ROTA_DE_DESCONTOS);
  if (id) revalidatePath(`${ROTA_DE_DESCONTOS}/${id}`);
}

/* ========================================================================== *
 * Criar e editar
 * ========================================================================== */

export async function criarDesconto(
  corpo: PayloadDeRegra,
): Promise<Resultado<RegraCompleta>> {
  await exigirAdminEmAcao();

  const resultado = await escrever<RegraCompleta>(API_DESCONTOS, "POST", corpo);
  if (resultado.ok) revalidar(resultado.dados.id);
  return resultado;
}

/**
 * O `PUT` É SUBSTITUIÇÃO TOTAL, e o formulário sempre carrega a regra inteira.
 *
 * Não é o defeito do legado repetido: lá o `PUT` era total sem que o formulário
 * soubesse, e "um formulário novo que envie só o campo alterado apaga título,
 * datas, categoria e produto". Aqui é total por desenho — `escopo` e `faixas`
 * são listas, e mesclar lista não tem significado único: enviar duas faixas
 * quer dizer "estas duas e mais nenhuma". Os dois gestos que NÃO são edição de
 * formulário têm rota própria, logo abaixo, para não precisarem do objeto todo.
 */
export async function salvarDesconto(
  id: string,
  corpo: PayloadDeRegra,
): Promise<Resultado<RegraCompleta>> {
  await exigirAdminEmAcao();

  const resultado = await escrever<RegraCompleta>(
    `${API_DESCONTOS}/${encodeURIComponent(id)}`,
    "PUT",
    corpo,
  );
  if (resultado.ok) revalidar(id);
  return resultado;
}

/* ========================================================================== *
 * Ligar, desligar, arquivar
 * ========================================================================== */

/**
 * O TOGGLE TEM ROTA PRÓPRIA, e é o que impede o defeito legado de voltar por
 * outra porta.
 *
 * Se ligar/desligar passasse pelo `PUT` total, ligar uma regra expirada
 * exigiria montar o objeto inteiro a partir de alguma coisa — e "alguma coisa"
 * seria a linha da LISTA, que não tem escopo nem faixas. O `PUT` obediente
 * apagaria as duas. Com `PATCH {habilitada}`, o gesto toca uma coluna e mais
 * nada.
 *
 * E ele NUNCA é desabilitado por causa da janela: corrigir a data de uma regra
 * expirada é justamente o que o gestor precisa fazer, e foi travar esse botão
 * que tornou a promoção legada inalcançável.
 */
export async function alternarDesconto(
  id: string,
  habilitada: boolean,
): Promise<Resultado<RegraCompleta>> {
  await exigirAdminEmAcao();

  const resultado = await escrever<RegraCompleta>(
    `${API_DESCONTOS}/${encodeURIComponent(id)}/habilitada`,
    "PATCH",
    { habilitada },
  );
  if (resultado.ok) revalidar(id);
  return resultado;
}

/**
 * ARQUIVAR, NUNCA APAGAR — R13.
 *
 * E aqui não é só doutrina: `promocao_resgates` referencia a promoção com
 * `ON DELETE RESTRICT`, então o banco recusa apagar uma regra já usada com
 * 23503. Uma tela com botão "Excluir" que só funciona em regra nunca usada é
 * uma tela que falha de forma imprevisível — e apagar a que ainda não foi usada
 * também levaria junto o registro de que a campanha existiu.
 */
export async function arquivarDesconto(id: string): Promise<Resultado<RegraCompleta>> {
  await exigirAdminEmAcao();

  const resultado = await escrever<RegraCompleta>(
    `${API_DESCONTOS}/${encodeURIComponent(id)}/arquivar`,
    "POST",
    {},
  );
  if (resultado.ok) revalidar(id);
  return resultado;
}

export async function desarquivarDesconto(
  id: string,
): Promise<Resultado<RegraCompleta>> {
  await exigirAdminEmAcao();

  const resultado = await escrever<RegraCompleta>(
    `${API_DESCONTOS}/${encodeURIComponent(id)}/desarquivar`,
    "POST",
    {},
  );
  if (resultado.ok) revalidar(id);
  return resultado;
}

/* ========================================================================== *
 * Simular
 * ========================================================================== */

/**
 * A SIMULAÇÃO CHAMA O MOTOR DE VERDADE, e é por isso que ela é uma ida ao
 * servidor e não uma conta no navegador.
 *
 * `backend/src/utils/motor.js` é a mesma função que o checkout usa para cobrar,
 * com os mesmos 27 casos de tabela-verdade. Uma segunda implementação no
 * navegador divergiria — precedência entre classes, exclusividade por grupo,
 * rateio do teto pelo método do maior resto, arredondamento em centavos —, e a
 * cópia que o gestor vê deixaria de ser a que cobra. Um simulador que mente é
 * pior que simulador nenhum, porque autoriza a publicar a regra.
 *
 * A ROTA RECEBE O RASCUNHO, não um id: simular só o que já foi salvo inverteria
 * a razão de existir do simulador. Ela monta a regra em memória no formato de
 * `carregarRegrasVigentes` e chama `calcularDescontos` sem escrever nada — é
 * leitura pura, apesar do `POST` (o método é `POST` porque o corpo é grande
 * demais para a query string, e porque carrinho não se guarda em cache).
 *
 * Ela É uma Server Action e não um Route Handler porque
 * `lib/conta/painel-servidor.test.ts` fica vermelho se um `route.ts` aparecer
 * sob `/dashboard` — Route Handler não passa por layout, e a cerca do painel é
 * o layout.
 */
export async function simularDesconto(
  regra: PayloadDeRegra,
  carrinho: CarrinhoDaSimulacao,
): Promise<Resultado<RespostaDaSimulacao>> {
  await exigirAdminEmAcao();

  // Sem `revalidar`: a simulação não escreve nada, e invalidar cache a cada
  // tecla do simulador derrubaria a lista inteira dezenas de vezes por minuto.
  return escrever<RespostaDaSimulacao>(API_SIMULAR, "POST", { regra, carrinho });
}
