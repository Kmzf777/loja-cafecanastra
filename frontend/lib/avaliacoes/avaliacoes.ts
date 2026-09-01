/**
 * Avaliações pela vitrine — leitura pública, envio e "as minhas".
 *
 * Tudo aqui fala PostgREST DIRETO com o cliente do navegador; quem decide é a
 * RLS da migração 0014. Três regras não óbvias que este módulo carrega:
 *
 *   1. A LISTA PÚBLICA SEMPRE FILTRA `status = 'aprovada'`. Não é redundância
 *      com a política: um visitante LOGADO soma a política de dono e, sem o
 *      filtro, veria as PRÓPRIAS avaliações pendentes misturadas na lista da
 *      PDP — como se já estivessem publicadas.
 *   2. AS COLUNAS SÃO LISTADAS, nunca `*`: para `anon` as colunas `user_id` e
 *      `moderado_em` estão fora do GRANT (0014) e um `select=*` responderia
 *      42501 para visitante deslogado — a PDP inteira sem avaliações por causa
 *      de um asterisco.
 *   3. A MÉDIA É DE TODAS as aprovadas, não da página exibida: média de página
 *      seria um número que muda ao clicar em "ver mais".
 *
 * A tradução de erro segue o padrão de `lib/conta/cadastro.ts`: ramificação
 * por SQLSTATE (`error.code`), nunca por texto nem por status HTTP.
 */
import { clienteNavegador } from "../supabase/cliente";
import { TETO_DE_NOTAS, mediaDeNotas } from "./tipos";
import type {
  AvaliacaoPublica,
  MinhaAvaliacao,
  ResumoDeAvaliacoes,
} from "./tipos";

/** Colunas públicas — exatamente as do GRANT de SELECT para `anon` (0014). */
const COLUNAS_PUBLICAS =
  "id, sku, nota, titulo, texto, nome_exibicao, status, criado_em";

/** Quantas avaliações por página na PDP. */
export const POR_PAGINA = 10;

export class ErroDeAvaliacao extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo = "desconhecido") {
    super(mensagem);
    this.name = "ErroDeAvaliacao";
    this.codigo = codigo;
  }
}

/**
 * SQLSTATEs que a 0014 produz, um por desfecho que a tela trata diferente.
 *
 * 42501 é UMA porta para três recusas (sem pedido entregue, sem cadastro na
 * loja, sem sessão válida) — de propósito, como na RLS: para quem avalia, as
 * três são "a avaliação ainda não está disponível para você", e a única que a
 * tela consegue prevenir (sem sessão) é barrada ANTES, com código próprio.
 */
const MENSAGENS: Record<string, string> = {
  "42501":
    "A avaliação fica disponível depois que o pedido é entregue. " +
    "Assim que o seu chegar, volte aqui.",
  "23505": "Você já avaliou este café — cada café aceita uma avaliação por pessoa.",
  "23514": "Confira a nota (de 1 a 5) e o tamanho do título e do texto.",
  PGRST106: "As avaliações estão indisponíveis no momento.",
  PGRST205: "As avaliações estão indisponíveis no momento.",
};

const MENSAGEM_PADRAO =
  "Não foi possível enviar sua avaliação agora. Tente de novo em instantes.";

type ErroDoPostgrest = { code?: string | null; message?: string | null };

export function traduzirErroDeAvaliacao(erro: ErroDoPostgrest): ErroDeAvaliacao {
  const codigo = erro.code?.trim() || "desconhecido";
  const conhecida = MENSAGENS[codigo];
  if (conhecida) return new ErroDeAvaliacao(conhecida, codigo);

  console.warn(
    `[avaliacoes] PostgREST recusou com código não traduzido: ${codigo} — ` +
      (erro.message ?? ""),
  );
  return new ErroDeAvaliacao(MENSAGEM_PADRAO, codigo);
}

type LinhaPublica = {
  id: string;
  sku: string;
  nota: number;
  titulo: string | null;
  texto: string | null;
  nome_exibicao: string;
  criado_em: string;
};

function paraPublica(linha: LinhaPublica): AvaliacaoPublica {
  return {
    id: linha.id,
    sku: linha.sku,
    nota: linha.nota,
    titulo: linha.titulo,
    texto: linha.texto,
    nomeExibicao: linha.nome_exibicao,
    criadoEm: linha.criado_em,
  };
}

/**
 * As avaliações aprovadas de uma LINHA de café.
 *
 * `skus` é a lista de `skuLoja` das variantes e formatos especiais da linha —
 * uma PDP agrupa vários SKUs do banco (um por peso/pacote), e a avaliação é
 * gravada no SKU exato que a pessoa recebeu.
 *
 * Lança em erro de rede/PostgREST: quem chama (a ilha da PDP) decide o
 * silêncio — a página nunca quebra por causa da seção de avaliações.
 */
export async function listarAprovadas(
  skus: string[],
  opcoes: { pagina?: number } = {},
): Promise<ResumoDeAvaliacoes> {
  const pagina = Math.max(0, Math.floor(opcoes.pagina ?? 0));
  const vazio: ResumoDeAvaliacoes = {
    media: 0,
    contagem: 0,
    avaliacoes: [],
    haMais: false,
  };
  if (skus.length === 0) return vazio;

  const supabase = clienteNavegador();

  // A média sai de TODAS as notas aprovadas (ver o teto acima); a página sai
  // de uma segunda consulta. Duas idas, cada uma pequena — juntar as duas
  // faria a média depender da página.
  const notas = await supabase
    .from("avaliacoes")
    .select("nota")
    .in("sku", skus)
    .eq("status", "aprovada")
    .limit(TETO_DE_NOTAS);
  if (notas.error) throw traduzirErroDeAvaliacao(notas.error);

  const valores = (notas.data ?? []).map((l) => l.nota);
  if (valores.length === 0) return vazio;

  const inicio = pagina * POR_PAGINA;
  const paginaAtual = await supabase
    .from("avaliacoes")
    .select(COLUNAS_PUBLICAS)
    .in("sku", skus)
    .eq("status", "aprovada")
    .order("criado_em", { ascending: false })
    .range(inicio, inicio + POR_PAGINA - 1);
  if (paginaAtual.error) throw traduzirErroDeAvaliacao(paginaAtual.error);

  const linhas = (paginaAtual.data ?? []) as LinhaPublica[];

  return {
    media: mediaDeNotas(valores),
    contagem: valores.length,
    avaliacoes: linhas.map(paraPublica),
    haMais: inicio + linhas.length < valores.length,
  };
}

export type NovaAvaliacao = {
  sku: string;
  nota: number;
  titulo?: string;
  texto?: string;
};

/**
 * Envia uma avaliação. A linha nasce `pendente` — o texto de sucesso da tela
 * DEVE dizer isso ("aparece depois de aprovada"), nunca "publicada".
 *
 * As validações locais existem para dar a frase certa ANTES da ida ao banco;
 * o CHECK da 0014 continua sendo quem manda (23514 se algo escapar).
 */
export async function enviarAvaliacao(dados: NovaAvaliacao): Promise<void> {
  if (!Number.isInteger(dados.nota) || dados.nota < 1 || dados.nota > 5) {
    throw new ErroDeAvaliacao("Escolha uma nota de 1 a 5.", "nota_invalida");
  }
  const titulo = dados.titulo?.trim() || null;
  const texto = dados.texto?.trim() || null;
  if (titulo && titulo.length > 80) {
    throw new ErroDeAvaliacao(
      "O título pode ter até 80 caracteres.",
      "titulo_longo",
    );
  }
  if (texto && texto.length > 2000) {
    throw new ErroDeAvaliacao(
      "O texto pode ter até 2000 caracteres.",
      "texto_longo",
    );
  }

  const supabase = clienteNavegador();
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) {
    throw new ErroDeAvaliacao("Entre na sua conta para avaliar.", "sem_sessao");
  }

  // A política exige `user_id = auth.uid()` — mandar o uid da sessão é a
  // única forma da linha passar. `titulo`/`texto` vazios viram NULL (mesma
  // noção de "não informado" que 0008 fixou para telefone e CPF).
  const { error } = await supabase.from("avaliacoes").insert({
    user_id: uid,
    sku: dados.sku,
    nota: dados.nota,
    titulo,
    texto,
  });
  if (error) throw traduzirErroDeAvaliacao(error);
}

/**
 * As avaliações do próprio cliente, em qualquer status — é como a página do
 * pedido sabe quais cafés a pessoa JÁ avaliou.
 *
 * POR QUE UMA RPC, E NÃO `.from("avaliacoes").eq("user_id", uid)` COMO ANTES
 * A migração 0031 tirou `user_id` do GRANT de SELECT de `authenticated`: a
 * coluna entregava, para qualquer token da instância COMPARTILHADA, o uuid de
 * todo avaliador — o vínculo entre a pessoa e a compra. E privilégio de coluna
 * vale para a consulta inteira, não só para a projeção: o `.eq("user_id", uid)`
 * daqui passaria a responder 42501, e o `catch` abaixo transformaria isso em
 * `[]` SEM ERRO — o formulário voltaria a aparecer para café já avaliado e o
 * envio morreria num 23505. Falha silenciosa, que é o pior desfecho possível.
 *
 * `canastra.minhas_avaliacoes()` é SECURITY DEFINER e filtra por `auth.uid()`
 * POR DENTRO. Ela não tem parâmetro, de propósito: uma versão que aceitasse um
 * uid seria o mesmo vazamento por outra porta. E não devolve `user_id` — quem
 * chama já sabe o próprio.
 *
 * A ORDENAÇÃO É DA FUNÇÃO (`ORDER BY criado_em DESC`), e por isso não há
 * `.order()` aqui: sobre o retorno de uma RPC ele não viraria ORDER BY nenhum.
 *
 * Sem sessão (ou com erro) devolve `[]` com aviso no console, e não lança:
 * o pior desfecho de uma lista vazia é um formulário a mais, cujo envio
 * duplicado o banco recusa com 23505 traduzido. Quebrar a página do pedido
 * por causa desta consulta seria pagar caro pelo caso raro.
 */
export async function minhasAvaliacoes(): Promise<MinhaAvaliacao[]> {
  const supabase = clienteNavegador();
  const { data } = await supabase.auth.getSession();
  // A sessão continua sendo lida: sem ela a RPC responderia 42501 (o EXECUTE é
  // só de `authenticated`), e essa ida ao servidor não tem por que acontecer.
  const uid = data.session?.user?.id;
  if (!uid) return [];

  const resposta = await supabase.rpc("minhas_avaliacoes");

  if (resposta.error) {
    console.warn(
      "[avaliacoes] Não foi possível listar as suas avaliações. " +
        `${resposta.error.code ?? ""} ${resposta.error.message ?? ""}`.trim(),
    );
    return [];
  }

  return (resposta.data ?? []).map((linha) => ({
    id: linha.id,
    sku: linha.sku,
    nota: linha.nota,
    titulo: linha.titulo,
    texto: linha.texto,
    status: linha.status,
    criadoEm: linha.criado_em,
  }));
}
