"use server";

import { revalidatePath } from "next/cache";

import { API_BASE } from "@/lib/api-base";
import { exigirAdminEmAcao } from "@/lib/conta/painel-servidor";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { fraseDeErro, lerCorpo } from "@/lib/painel/resposta";
import {
  ROTA_DE_AJUSTES,
  TIPOS_DE_OPCAO,
  analisarFreteGratis,
  montarPayloadDaLoja,
  validarNovaOpcao,
  type EstadoDaLoja,
} from "@/lib/painel/ajustes/ajustes.logica";

/**
 * As escritas da tela de Ajustes — a configuração da loja e as duas listas de
 * opções.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA LINHA DE CADA AÇÃO É `exigirAdminEmAcao()`, E ISSO NÃO É ESTILO.
 *
 * O layout de `(protegido)` NÃO protege Server Action: ela POSTa para a própria
 * rota, EXECUTA, e só então a página re-renderiza — momento em que o layout
 * finalmente chama `exigirAdminNoPainel`. A checagem rodaria DEPOIS de o piso
 * do frete grátis já ter mudado para a loja inteira.
 *
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica vermelho se um
 * arquivo com `"use server"` sob `app/dashboard/**` ou `lib/painel/**` não
 * chamar esta função — inclusive se a chamada estiver COMENTADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A ANÁLISE DO FRETE ACONTECE AQUI DENTRO, e não é repetição do formulário.
 *
 * A ação recebe o TEXTO que a pessoa digitou e chama `analisarFreteGratis` ela
 * mesma. Uma Server Action é uma superfície de rede: quem a invocar direto não
 * passa pelo formulário, e receber `centavos` já convertido de fora seria
 * aceitar um `0` de qualquer origem no campo que DESLIGA o frete grátis da loja
 * inteira. O texto é o dado bruto; a conversão é decisão, e decisão fica do
 * lado que tem autoridade.
 */

export type ResultadoDoSalvamento =
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
 * `fetch` autenticado com o `res.ok` já conferido.
 *
 * `res.ok` É CONFERIDO porque `fetch` NÃO lança em 4xx/5xx — é exatamente por
 * não conferir que o painel legado já anunciou "Produto deletado!" com o
 * produto intacto. O corpo sai por `lerCorpo`, nunca por `res.json()` cru: os
 * 401/403 do `isAuthenticated` saem por `sendStatus`, com corpo VAZIO, e um
 * `json()` desprotegido quebra com SyntaxError justamente no caminho de sessão
 * expirada.
 *
 * `Content-Type` NÃO é definido quando o corpo é `FormData`: é o `fetch` que o
 * escreve, com o `boundary` que ele acabou de sortear. Escrevê-lo à mão produz
 * um cabeçalho sem boundary, o `multer` do Express não acha campo nenhum, e o
 * `PUT /config` grava um corpo vazio — que, com o `atribui()` condicional do
 * repositório, é um 200 que não muda nada. Sucesso silencioso: o pior modo de
 * falha desta tela.
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

  const ehFormulario = init.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body && !ehFormulario ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
      // O painel nunca lê de cache: quem configura precisa ver o que está no
      // banco agora, não o que estava lá antes.
      cache: "no-store",
    });
  } catch (erro) {
    console.error(`[painel] ${caminho} não chegou ao Express.`, erro);
    return {
      ok: false,
      // Sem código HTTP nenhum: não houve resposta. Dizer "erro 500" apontaria
      // para o servidor da loja quando o problema pode ser a rede desta máquina.
      erro: "A API não respondeu. Nada foi salvo — tente de novo.",
    };
  }

  if (!res.ok) {
    /*
      A FRASE DO SERVIDOR GANHA SEMPRE. Nesta tela ela é o produto:
      "frete_gratis_minimo_centavos precisa ser um inteiro em centavos…",
      "Esta opção já existe.", "opção em uso por algum produto". Trocá-las por
      "Erro ao salvar" transforma um problema de dois minutos num chamado — e o
      painel legado engolia justamente as duas de `/options` (`ManageCategories`
      mostrava "Erro ao adicionar.").
    */
    return { ok: false, erro: fraseDeErro(res.status, await lerCorpo(res)) };
  }
  return { ok: true, corpo: (await lerCorpo(res)) as Record<string, unknown> };
}

/**
 * Salva a configuração da loja.
 *
 * O SUBMIT É ATÔMICO DO LADO DA TELA: frete inválido aborta TUDO, e nem o
 * título sobe. É o item do checklist de paridade, e a razão é que um salvamento
 * parcial deixaria o gestor com metade do formulário gravado e nenhuma pista de
 * qual metade — ele releria a tela, veria o título novo, e concluiria que o
 * frete também foi.
 *
 * E O CORPO OMITE O CAMPO EM BRANCO em vez de mandá-lo vazio. O backend já
 * trata `''` como ausência (`ConfigRepository.ehAusencia`), mas esta tela não
 * depende disso: são duas trancas na mesma porta, e a porta dá para a receita
 * de frete da loja inteira.
 */
export async function salvarLoja(
  estado: EstadoDaLoja,
): Promise<ResultadoDoSalvamento> {
  await exigirAdminEmAcao();

  const analisado = analisarFreteGratis(estado?.freteGratisReais ?? "");
  if (analisado.tipo === "invalido") {
    return { ok: false, erro: analisado.erro };
  }

  const campos = montarPayloadDaLoja(estado, analisado);
  if (campos.length === 0) {
    /*
      Um PUT sem campo nenhum é um 200 que não muda nada — o `atribui()` do
      repositório simplesmente não teria o que atribuir. Recusar aqui evita a
      confirmação verde mais enganosa possível: "salvo" sobre um formulário
      inteiramente em branco.
    */
    return { ok: false, erro: "Não há nada para salvar: todos os campos estão em branco." };
  }

  /*
    MULTIPART, porque a rota usa `upload.fields` para os banners e o `multer`
    só lê corpo multipart. Um JSON aqui chegaria com `req.body` vazio e
    responderia 200 sem gravar nada.
  */
  const corpo = new FormData();
  for (const { campo, valor } of campos) corpo.append(campo, valor);

  const r = await chamar("/config", { method: "PUT", body: corpo });
  if (!r.ok) return r;

  /*
    A TELA DA VITRINE E A LOJA TAMBÉM MUDAM. O piso do frete grátis é lido pelo
    `Cabecalho` e pela barra de progresso da sacola, em toda página traduzida —
    `lib/config-loja.ts` tem cache de módulo de 5 minutos, então o efeito não é
    imediato, mas a página do painel precisa refletir o valor novo agora.
  */
  revalidatePath(ROTA_DE_AJUSTES);

  return {
    ok: true,
    frase: typeof r.corpo.message === "string" ? r.corpo.message : "Configurações salvas.",
  };
}

/**
 * Acrescenta uma categoria ou uma embalagem.
 *
 * O 409 "Esta opção já existe." CHEGA INTEIRO à tela — o painel legado o
 * engolia e mostrava "Erro ao adicionar.", que manda o gestor tentar de novo
 * exatamente a mesma coisa. É a diferença entre "já tem" e "não deu".
 */
export async function adicionarOpcao(
  tipo: string,
  valor: string,
): Promise<ResultadoDoSalvamento> {
  await exigirAdminEmAcao();

  if (!TIPOS_DE_OPCAO.some((t) => t.tipo === tipo)) {
    // Guarda de superfície de rede: quem chamar direto não passa pelas duas
    // listas da tela. O backend recusa igual, com frase própria.
    return { ok: false, erro: "Tipo de opção inválido. Use 'category' ou 'size'." };
  }
  const invalido = validarNovaOpcao(valor);
  if (invalido) return { ok: false, erro: invalido };

  const r = await chamar("/options", {
    method: "POST",
    body: JSON.stringify({ type: tipo, value: valor.trim() }),
  });
  if (!r.ok) return r;

  revalidatePath(ROTA_DE_AJUSTES);
  return {
    ok: true,
    frase:
      typeof r.corpo.message === "string" ? r.corpo.message : "Opção adicionada.",
  };
}

/**
 * Exclui uma opção.
 *
 * NÃO É "ARQUIVAR", e o R13 desta casa manda arquivar em vez de apagar —
 * aqui a exceção é do CONTRATO: `canastra.produto_opcoes` não tem coluna de
 * estado, e `DELETE /options/:id` é o que existe. O que o R13 protege (não
 * quebrar histórico) quem garante é o backend: ele recusa com 409 a exclusão de
 * opção em uso por algum produto, e a tela já marca as em uso antes.
 */
export async function excluirOpcao(id: string): Promise<ResultadoDoSalvamento> {
  await exigirAdminEmAcao();

  const alvo = (id ?? "").trim();
  if (!alvo) return { ok: false, erro: "Escolha a opção a excluir." };

  const r = await chamar(`/options/${encodeURIComponent(alvo)}`, {
    method: "DELETE",
  });
  if (!r.ok) return r;

  revalidatePath(ROTA_DE_AJUSTES);
  return {
    ok: true,
    frase: typeof r.corpo.message === "string" ? r.corpo.message : "Opção excluída.",
  };
}
