"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  ROTA_DE_PRODUTOS,
  identificarProduto,
  urlDoProduto,
  type ProdutoDoPainel,
} from "@/lib/painel/produtos/produtos.logica";
import { resumoDoLote, type FalhaDoLote } from "@/lib/painel/produtos/lote.logica";

/**
 * As escritas da tela de Produtos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE CADA AÇÃO É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action. A ação POSTa para a
 * própria rota, EXECUTA, e só então a página re-renderiza — momento em que o
 * layout finalmente chama `exigirAdminNoPainel`. Ou seja: a checagem do layout
 * rodaria DEPOIS de o preço já ter mudado na loja. Quem descobrir o endereço de
 * uma Server Action pode invocá-la sem nunca renderizar a página.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função — inclusive se a chamada estiver COMENTADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `res.ok` É CONFERIDO EM TODA CHAMADA, e o corpo sai por `lerCorpo`.
 *
 * `fetch` não lança em 4xx/5xx. Foi por não conferir que o painel legado
 * anunciou "Produto deletado!" com o produto intacto — um 403 caía no caminho
 * de sucesso. E os 401/403 do `isAuthenticated` saem por `sendStatus`, com
 * corpo VAZIO e sem `Content-Type`: um `res.json()` cru quebra com SyntaxError
 * exatamente no caminho de sessão expirada, que é o menos testado e o mais
 * visitado numa quinta à noite.
 *
 * E A FRASE DO SERVIDOR GANHA SEMPRE (`fraseDeErro`). "Já existe um produto com
 * este SKU." diz o que fazer; "Erro ao salvar" transforma um problema de dois
 * minutos num chamado.
 */

export type Resultado =
  | { ok: true; frase: string }
  | { ok: false; erro: string };

/**
 * O token de quem está logado, para o Express aplicar `isAdmin`.
 *
 * É uma segunda ida ao Supabase nesta requisição (a primeira foi
 * `exigirAdminEmAcao`, que usa `getUser()`), e ela é deliberada: `getUser()`
 * confere o token COM o GoTrue e é o certo para decidir acesso; `getSession()`
 * é o único que devolve o access token para repassar adiante.
 */
async function tokenDaAcao(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

const SEM_SESSAO = "Sua sessão expirou. Entre de novo para continuar.";
const SEM_RESPOSTA = "A API não respondeu. Nada foi alterado — tente de novo.";

/** Uma ida à API com o token, com os dois modos de falha já traduzidos. */
async function chamar(
  token: string,
  caminho: string,
  init: RequestInit,
): Promise<{ ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Sem código HTTP nenhum: não houve resposta. Dizer "erro 500" apontaria
    // para o servidor da loja quando o problema pode ser a rede desta máquina.
    return { ok: false, erro: SEM_RESPOSTA };
  }

  if (!res.ok) return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };

  // 204 não tem corpo, e `lerCorpo` já devolve `{}` em vez de quebrar.
  return { ok: true, corpo: (await lerCorpo(res)) as Record<string, unknown> };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * SALVAR A FICHA
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Cria ou edita um produto — `POST /dashboard` ou `PUT /dashboard/:id`.
 *
 * O CORPO É `FormData` DO COMEÇO AO FIM, e não JSON, porque as duas rotas
 * passam por `upload.single("image")`: multer só lê `multipart/form-data`, e um
 * `application/json` chega com `request.body` vazio — o backend recusaria por
 * "O nome do produto é obrigatório." com o nome preenchido na tela.
 *
 * A `FormData` ATRAVESSA A FRONTEIRA DA AÇÃO INTEIRA, com o arquivo dentro. É a
 * forma serializável que o Next transporta sem o navegador precisar falar com o
 * Express — o que mantém o token fora do JavaScript da página e mantém a
 * `revalidatePath` no mesmo passo do salvamento.
 *
 * ELA É RECONSTRUÍDA AQUI, campo a campo, em vez de repassada como veio. Uma
 * `FormData` vinda do cliente é entrada de rede: repassá-la inteira mandaria
 * para o Express qualquer campo que alguém tenha enfiado nela. A lista abaixo é
 * o contrato, e o que não está nela não viaja.
 */
const CAMPOS_DO_PRODUTO = [
  "name",
  "price",
  "quantity",
  "size",
  "category",
  "description",
  "weight",
  "width",
  "height",
  "length",
  "sku",
] as const;

export async function salvarProduto(
  id: string | null,
  dados: FormData,
): Promise<Resultado> {
  await exigirAdminEmAcao();

  const token = await tokenDaAcao();
  if (!token) return { ok: false, erro: SEM_SESSAO };

  const corpo = new FormData();
  for (const campo of CAMPOS_DO_PRODUTO) {
    const valor = dados.get(campo);
    /*
      `null` É OMISSÃO, `""` É VALOR — e a diferença importa dos dois lados.

      O `UPDATE` do backend escreve doze colunas sempre: `description` ausente
      vira `""`, `size` e `category` ausentes viram NULL. Então o formulário
      manda tudo, inclusive vazio, e vazio é a intenção de limpar. O ÚNICO campo
      que ele omite quando está em branco é o `sku` — porque ali a omissão
      preserva, e apagar o SKU tira o café da vitrine em silêncio. Quem decide
      isso é `corpoDoProduto`, em `ficha.logica.ts`; aqui só se respeita.
    */
    if (typeof valor === "string") corpo.set(campo, valor);
  }

  const imagem = dados.get("image");
  // `instanceof File` e não "é diferente de null": um campo de arquivo vazio
  // chega como um File de 0 byte e nome "", e mandá-lo faria o multer subir um
  // arquivo vazio para a Cloudinary por cima da foto que existe.
  if (imagem instanceof File && imagem.size > 0) corpo.set("image", imagem);

  const resposta = await chamar(token, id ? `/dashboard/${id}` : "/dashboard", {
    method: id ? "PUT" : "POST",
    body: corpo,
    // SEM `Content-Type` À MÃO: o `fetch` escreve o `boundary` do multipart
    // sozinho, e um cabeçalho posto aqui o substituiria por um sem boundary —
    // o multer não acharia campo nenhum e o erro falaria de nome obrigatório.
  });

  if (!resposta.ok) return resposta;

  revalidatePath(ROTA_DE_PRODUTOS);
  if (id) revalidatePath(urlDoProduto(id));

  const frase = (resposta.corpo.message as string) || "Produto salvo.";
  return { ok: true, frase };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * O CUSTO — rota própria
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `PATCH /admin/produtos/:id/custo`.
 *
 * ELE NÃO VAI JUNTO COM O FORMULÁRIO, e a decisão é do backend, escrita lá:
 * "custo não é campo de catálogo, é de gestão, e misturá-lo ao
 * `PUT /dashboard/:id` faria toda edição de preço carregar a margem junto — com
 * o risco de zerá-la quando o campo viesse vazio". A tela obedece à mesma
 * fronteira: o bloco do custo tem o próprio botão de salvar.
 */
export async function salvarCusto(id: string, custoReais: string): Promise<Resultado> {
  await exigirAdminEmAcao();

  const token = await tokenDaAcao();
  if (!token) return { ok: false, erro: SEM_SESSAO };

  const resposta = await chamar(token, `/admin/produtos/${id}/custo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // A vírgula do teclado brasileiro vira ponto aqui: do outro lado é
    // `Number(bruto)`, e `Number("12,50")` é NaN — que o backend recusa com
    // "Custo inválido", uma frase verdadeira sobre um problema que é nosso.
    body: JSON.stringify({ custo: custoReais.trim().replace(",", ".") }),
  });

  if (!resposta.ok) return resposta;

  revalidatePath(urlDoProduto(id));
  return { ok: true, frase: "Custo salvo." };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * O ESTOQUE — rota própria, um por vez
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `PATCH /dashboard/:id/estoque` — a rota que existe justamente para o
 * formulário inteiro NÃO ser reenviado.
 *
 * "Até a Onda 4 o único caminho para corrigir o estoque de um café era reenviar
 * o formulário inteiro por multipart — imagem incluída —, e é exatamente por
 * esse caminho que as medidas do pacote eram apagadas." Uma tela de "entrou
 * mercadoria" que reenvia a ficha completa recria o defeito que a rota nova
 * existe para fechar.
 */
async function enviarEstoque(
  token: string,
  id: string,
  quantidade: number,
): Promise<Resultado> {
  const resposta = await chamar(token, `/dashboard/${id}/estoque`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: quantidade }),
  });
  if (!resposta.ok) return resposta;
  return { ok: true, frase: "Estoque ajustado." };
}

export async function ajustarEstoque(id: string, quantidade: number): Promise<Resultado> {
  await exigirAdminEmAcao();

  const token = await tokenDaAcao();
  if (!token) return { ok: false, erro: SEM_SESSAO };

  const resultado = await enviarEstoque(token, id, quantidade);
  if (resultado.ok) {
    revalidatePath(ROTA_DE_PRODUTOS);
    revalidatePath(urlDoProduto(id));
  }
  return resultado;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * OS DOIS LOTES
 * ────────────────────────────────────────────────────────────────────────── */

/** O que a tela envia: o resultado da prévia que o gestor acabou de ver. */
export type AjusteEmLote = { id: string; valor: number };

/**
 * Lê UM produto inteiro do jeito que o `PUT` vai reescrevê-lo.
 *
 * É a leitura que torna o lote de preço seguro — ver `ajustarPrecoEmLote`.
 */
async function lerProduto(
  token: string,
  id: string,
): Promise<{ ok: true; produto: ProdutoDoPainel } | { ok: false; erro: string }> {
  const resposta = await chamar(token, `/dashboard/${id}`, { method: "GET" });
  if (!resposta.ok) return resposta;
  return { ok: true, produto: resposta.corpo as unknown as ProdutoDoPainel };
}

/**
 * Estoque em lote — R25 e R14.
 *
 * SEQUENCIAL, E NÃO `Promise.all`. Cada `PATCH` abre uma transação que trava a
 * linha do produto (`FOR UPDATE`) para gravar o `antes` do log de auditoria.
 * Vinte transações concorrentes disputando as mesmas linhas trocariam segundos
 * de ganho por espera em cascata, e vinte idas sequenciais são o teto desta tela
 * — a página tem vinte linhas.
 *
 * NÃO PARA NO PRIMEIRO ERRO, e devolve o PLACAR REAL. Um produto que falhou
 * (apagado por outra pessoa, id inválido) não é motivo para deixar os outros
 * dezenove sem tratar, e mostrar "20 atualizados" quando três falharam mente
 * sobre a única coisa que a operação existe para informar.
 */
export async function ajustarEstoqueEmLote(
  ajustes: AjusteEmLote[],
  nomes: Record<string, string>,
): Promise<Resultado> {
  await exigirAdminEmAcao();

  if (ajustes.length === 0) return { ok: false, erro: "Nenhum produto marcado." };

  const token = await tokenDaAcao();
  if (!token) return { ok: false, erro: SEM_SESSAO };

  let feitos = 0;
  const falhas: FalhaDoLote[] = [];

  for (const ajuste of ajustes) {
    const r = await enviarEstoque(token, ajuste.id, ajuste.valor);
    if (r.ok) feitos += 1;
    else falhas.push({ nome: nomes[ajuste.id] ?? ajuste.id, frase: r.erro });
  }

  // A revalidação acontece mesmo com falhas parciais: os que passaram MUDARAM,
  // e deixar a lista velha faria a tela discordar do placar que ela mostra.
  revalidatePath(ROTA_DE_PRODUTOS);
  for (const ajuste of ajustes) revalidatePath(urlDoProduto(ajuste.id));

  const frase = resumoDoLote(feitos, falhas);
  return falhas.length === 0 ? { ok: true, frase } : { ok: false, erro: frase };
}

/**
 * Preço em lote — e a única parte desta tela que precisa de um parágrafo de
 * justificativa, porque ela usa o caminho que já causou estrago.
 *
 * NÃO EXISTE ROTA DE PREÇO SOZINHO. Estoque ganhou a sua (`PATCH
 * /dashboard/:id/estoque`); preço não. O único caminho é o `PUT /dashboard/:id`,
 * que reescreve DOZE colunas — e foi por um `PUT` desses, disparado por um
 * formulário sem input de medida, que a loja passou a cotar frete de uma caixa
 * que não existia.
 *
 * O QUE TORNA ESTE USO SEGURO É A LEITURA IMEDIATAMENTE ANTES. Para cada
 * produto: `GET /dashboard/:id`, troca só o `price`, `PUT` com TODAS as onze
 * colunas restantes exatamente como acabaram de vir. Nada é inventado, nada é
 * omitido, nada vem de uma lista que pode estar velha na tela. O defeito antigo
 * não era o `PUT` total — era mandar `"undefined"` nos campos que o formulário
 * não tinha.
 *
 * A LEITURA É POR PRODUTO E NÃO DA LISTA DA TELA de propósito, e custa uma ida
 * a mais em cada um: a lista pode ter sido pintada minutos atrás, e reescrever
 * doze colunas com dados de minutos atrás desfaz calado o que outra pessoa
 * salvou nesse intervalo. Quarenta idas sequenciais para vinte produtos é lento
 * e é honesto; R14 já diz que dinheiro não usa UI otimista, e "Aplicando…" fica
 * na tela até o servidor responder.
 *
 * A IMAGEM NÃO VAI. Sem arquivo no corpo, o backend mantém `atual.imagem` — e
 * é justamente por não reenviar a foto que este caminho não passa pela
 * Cloudinary vinte vezes.
 */
export async function ajustarPrecoEmLote(
  ajustes: AjusteEmLote[],
): Promise<Resultado> {
  await exigirAdminEmAcao();

  if (ajustes.length === 0) return { ok: false, erro: "Nenhum produto marcado." };

  const token = await tokenDaAcao();
  if (!token) return { ok: false, erro: SEM_SESSAO };

  let feitos = 0;
  const falhas: FalhaDoLote[] = [];

  for (const ajuste of ajustes) {
    const lido = await lerProduto(token, ajuste.id);
    if (!lido.ok) {
      falhas.push({ nome: ajuste.id, frase: lido.erro });
      continue;
    }

    const p = lido.produto;
    const nome = identificarProduto(p);

    const corpo = new FormData();
    corpo.set("name", String(p.name ?? ""));
    corpo.set("price", String(ajuste.valor));
    corpo.set("quantity", String(p.quantity));
    corpo.set("size", String(p.size ?? ""));
    corpo.set("category", String(p.category ?? ""));
    corpo.set("description", String(p.description ?? ""));
    // AS QUATRO MEDIDAS VOLTAM COMO VIERAM. É esta linha que separa este `PUT`
    // do `PUT` do formulário legado.
    corpo.set("weight", String(p.weight));
    corpo.set("width", String(p.width));
    corpo.set("height", String(p.height));
    corpo.set("length", String(p.length));
    // SKU só quando existe: a chave ausente preserva o que está no banco, e uma
    // string vazia o apagaria — tirando o café da vitrine, que casa por SKU.
    if (p.sku) corpo.set("sku", p.sku);

    const r = await chamar(token, `/dashboard/${ajuste.id}`, {
      method: "PUT",
      body: corpo,
    });

    if (r.ok) feitos += 1;
    else falhas.push({ nome, frase: r.erro });
  }

  revalidatePath(ROTA_DE_PRODUTOS);
  for (const ajuste of ajustes) revalidatePath(urlDoProduto(ajuste.id));

  const frase = resumoDoLote(feitos, falhas);
  return falhas.length === 0 ? { ok: true, frase } : { ok: false, erro: frase };
}
