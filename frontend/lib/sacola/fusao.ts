/**
 * A sacola montada deslogado, entrando na conta — uma vez, e só uma.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Até a Task 3, quem fundia a sacola era o `signIn` do Express: o navegador
 * mandava `localCart` junto com e-mail e senha. Esse `signIn` morreu com o
 * GoTrue, e sem substituto TODO cliente que monta a sacola deslogado e depois
 * entra PERDE os itens — sem erro, sem log, sem 400. A sacola é o caminho da
 * receita e essa é a pior forma de perdê-la. A fusão passa a ser a RPC
 * `canastra.fundir_sacola` (migração 0007), chamada daqui.
 *
 * AS TRÊS ARMADILHAS, TODAS MEDIDAS ANTES DE ESTE ARQUIVO EXISTIR
 *
 * 1. AS CHAVES NÃO COINCIDEM. O JSON da RPC usa os nomes das COLUNAS, em
 *    português (`produto_id`, `quantidade`, `preco`, `nome`, `imagem`,
 *    `tamanho`, `moagem`); o `ItemDaSacola` do `localStorage` está em inglês
 *    (`product_id`, `quantity`, `price`, `name`, `image`, `size`) e só `moagem`
 *    coincide. Mandar a lista crua faz `produto_id` chegar nulo em todo item, o
 *    filtro da 0007 descarta todos e a sacola inteira some em silêncio.
 *    `traduzirParaFusao()` é a única ponte, e `ItemParaFundir` (Task 2) faz o
 *    esquecimento virar erro de compilação.
 *
 * 2. A FUSÃO NÃO É IDEMPOTENTE, E NÃO TEM COMO SER. A lista não carrega
 *    identidade nenhuma: chamar duas vezes soma duas vezes. E `onAuthStateChange`
 *    dispara MUITO mais do que uma vez — o próprio @supabase/auth-js 2.112.3
 *    documenta que `SIGNED_IN` sai "a cada vez que a sessão é confirmada ou
 *    reestabelecida, inclusive ao voltar o foco da aba", que `INITIAL_SESSION`
 *    sai na construção do cliente, e que os eventos são replicados ENTRE ABAS por
 *    `BroadcastChannel`. Daí as duas travas deste arquivo:
 *      · a de dentro da aba (`raiz[CHAVE_DA_TRAVA]`), em `globalThis` e não num
 *        `let` de módulo nem em estado do React — o Fast Refresh reavalia o
 *        módulo e o provedor remonta, e os dois zerariam um `let`;
 *      · a de entre abas (`localStorage[CHAVE_ENTRE_ABAS]`), porque duas abas
 *        são dois JavaScripts e a trava de dentro da aba não as alcança.
 *
 * 3. E A TERCEIRA, QUE SÓ APARECE NESTA FASE: a conta e a sacola da vitrine
 *    NÃO ESTÃO NO MESMO LUGAR. A RPC escreve em `canastra.carrinho_itens`; o
 *    `sacola.tsx` ainda lê e grava a sacola de quem tem sessão no Express
 *    (`carts`/`cart_items`, em inglês, fora do schema `canastra`) — a migração
 *    dessas rotas é da F5, não desta tarefa. Se a fusão apenas APAGASSE
 *    `localStorage["cart"]`, como diria a leitura literal do plano, o cliente
 *    ficaria com a sacola gravada num lugar que a vitrine desta fase não lê: bag
 *    vazia na tela, itens vivos no banco. Por isso, na PRIMEIRA fusão desta
 *    conta neste aparelho, este módulo LÊ DE VOLTA a sacola da conta pelo
 *    PostgREST e a escreve por cima de `localStorage["cart"]`. A sacola anônima
 *    deixa de existir (que é o ponto de apagar) e o que a pessoa vê passa a ser
 *    a sacola da conta.
 *
 *    E SÓ NA PRIMEIRA, porque nesta fase nada APAGA linha de
 *    `canastra.carrinho_itens` — a fusão soma, e remoção e compra passam pelo
 *    Express. Reler sempre traria de volta o item removido ontem e o café já
 *    comprado. O critério está em `executarFusao`, no `primeiraVezNesteAparelho`.
 *
 * O PREÇO DE ESCREVER A SACOLA DA CONTA DE VOLTA NO `localStorage`, E COMO ELE É
 * PAGO. Se a lista local voltasse a ser candidata a fusão, a PRÓXIMA carga de
 * página (que dispara `INITIAL_SESSION` de novo) somaria tudo outra vez, e a
 * sacola do cliente dobraria a cada visita — exatamente o desastre que a 0007
 * descreve, só que em câmera lenta. A defesa é `CHAVE_DA_BASE`: uma cópia do que
 * SABEMOS estar na conta, gravada junto. O que se manda para a RPC é só o que
 * excede essa base (`calcularPendentes`), então uma segunda fusão da mesma
 * sacola manda lista vazia e não acontece. A base é por `userId`.
 *
 * E COMO A BASE E A SACOLA SÃO DUAS CHAVES, ELAS PODEM SE SEPARAR — `localStorage`
 * não grava duas coisas de uma vez. Separadas, a sacola já fundida voltaria a
 * parecer pendente e as quantidades dobrariam. Por isso cada item gravado leva um
 * `selo`, o mesmo que vai na base: se um dia eles não baterem, a fusão sabe que
 * não sabe, funde apenas o que não tem selo e relê a conta em vez de somar tudo
 * de novo. Ver `novoSelo()` e o bloco de divergência em `executarFusao`.
 */
import { recuperarSessao } from "../conta/sessao";
import { clienteNavegador } from "../supabase/cliente";
import type { ItemParaFundir, Tabelas } from "../supabase/tipos";
import type { ItemDaSacola } from "./sacola";

/** A chave histórica da sacola. `sacola.tsx` e o painel legado leem esta mesma. */
export const CHAVE_DA_SACOLA = "cart";

/**
 * O que já sabemos estar na sacola da CONTA, e para qual conta.
 *
 * Não é cache de exibição — ninguém desenha tela com isto. É a única coisa que
 * impede a fusão de somar de novo o que ela mesma acabou de somar.
 *
 * ESTA CHAVE E A `cart` SÃO UMA COISA SÓ GRAVADA EM DUAS, e `localStorage` não
 * tem escrita atômica de duas chaves. Elas se separam de verdade: uma limpeza
 * parcial de dados do site, uma extensão, um script de QA, ou a cota estourando
 * entre a primeira gravação e a segunda. Separadas, a sacola JÁ FUNDIDA volta a
 * parecer sacola anônima pendente e as quantidades DOBRAM. O `selo` logo abaixo
 * existe para que essa divergência seja DETECTÁVEL — ver `executarFusao`.
 */
const CHAVE_DA_BASE = "cart:na_conta";

/** Marca de "uma aba está fundindo agora". Ver `reivindicarEntreAbas()`. */
const CHAVE_ENTRE_ABAS = "cart:fundindo";

/**
 * O SELO: o mesmo valor gravado NA SACOLA e NA BASE, para uma poder ser
 * conferida contra a outra.
 *
 * POR QUE ELE VIAJA DENTRO DE CADA ITEM, e não numa terceira chave: uma terceira
 * chave teria exatamente o problema que ele veio resolver — sumiria sozinha, ou
 * junto com a errada, e a divergência voltaria a ser invisível. Dentro do item,
 * o selo só se perde quando a sacola inteira se perde, e sacola perdida não
 * dobra nada.
 *
 * `ItemDaSacola.selo` é campo INTERNO: nenhuma tela o lê e nenhuma requisição o
 * manda (checkout e frete montam o corpo campo a campo, e `traduzirParaFusao`
 * também). Ele sobrevive às edições da sacola porque `adicionar`,
 * `alterarQuantidade` e `remover` copiam o item com `...spread`.
 *
 * NÃO precisa ser imprevisível — precisa ser DIFERENTE do anterior, para que uma
 * base velha ao lado de uma sacola nova não passe por coerente. Daí o relógio
 * mais um pedaço aleatório, sem depender de `crypto.randomUUID`, que não existe
 * em todo contexto onde este módulo é carregado.
 */
function novoSelo(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** O selo que a sacola local carrega, ou `null` se ela nunca foi fundida. */
export function seloDaSacola(itens: ItemDaSacola[]): string | null {
  for (const item of itens) {
    if (item.selo) return item.selo;
  }
  return null;
}

/**
 * Espelha o `TETO_DE_QUANTIDADE` da 0007. Lá ele existe para a soma não
 * estourar o `integer`; aqui, para um item com quantidade absurda ser CORTADO em
 * vez de DESCARTADO — o regex da RPC (`^[1-9][0-9]{0,5}$`) recusa 1000000 em
 * silêncio, e perder o item é pior do que mostrá-lo com quantidade menor.
 */
const TETO_DE_QUANTIDADE = 999999;

/**
 * Quanto tempo a marca entre abas vale. Generosa em relação a uma RPC mais uma
 * leitura (décimos de segundo) e curta o bastante para uma aba que morreu no
 * meio não bloquear a próxima tentativa por muito tempo — e mesmo bloqueando,
 * nada se perde: a sacola local continua lá e a fusão sai na carga seguinte.
 */
const VALIDADE_ENTRE_ABAS_MS = 15_000;

/** Só as colunas que a sacola da vitrine sabe exibir. */
type LinhaDaConta = Pick<
  Tabelas<"carrinho_itens">,
  "produto_id" | "quantidade" | "preco" | "nome" | "imagem" | "tamanho" | "moagem"
>;

export type ResultadoDaFusao =
  /** Ninguém logado. NÃO tranca: o login pode acontecer nesta mesma página. */
  | { situacao: "semSessao" }
  /** Nada excede o que já está na conta. É o caso comum de toda visita seguinte. */
  | { situacao: "semNovidade" }
  /** Outra aba está fundindo agora. Tenta de novo no próximo evento. */
  | { situacao: "adiada" }
  /**
   * Fundiu. `itens` é o que a pessoa deve ver a partir de agora — e cobre
   * também a primeira visita de um aparelho que só APRENDEU a sacola da conta,
   * sem ter o que somar. Quem chama trata os dois casos igual: desenhe isto.
   */
  | { situacao: "fundida"; itens: ItemDaSacola[] }
  /** Falhou. A sacola local está INTACTA de propósito. */
  | { situacao: "falhou"; codigo: string };

/* ------------------------------------------------------------------ *
 * Lógica pura — é onde moram os testes
 * ------------------------------------------------------------------ */

/**
 * A chave de identidade de um item, e ela é (produto, moagem) — não só produto.
 *
 * É a mesma que o `ON CONFLICT (carrinho_id, produto_id, moagem)` da 0007 usa.
 * Com uma chave só de produto, café moído e em grãos virariam um item só aqui e
 * dois lá, e a conta de `calcularPendentes` passaria a mentir.
 */
function chaveDoItem(item: { product_id: string; moagem?: string }): string {
  // O separador é o caractere nulo porque ele não aparece em uuid nem em
  // nome de moagem. Com um "|", um `product_id` terminado em "|" colidiria com
  // o item seguinte, e duas moagens diferentes virariam uma só na subtração.
  return `${item.product_id}\u0000${item.moagem ?? ""}`;
}

/**
 * Descarta no NAVEGADOR o que a RPC descartaria no banco — e avisa.
 *
 * POR QUE NÃO DEIXAR O BANCO FILTRAR, já que ele filtra: porque o filtro de lá é
 * mudo. Um `localStorage` de uma versão antiga do site (o painel legado grava
 * nesta mesma chave, e o site antigo tinha `product_id` numérico) sumiria inteiro
 * sem uma linha em lugar nenhum. Aqui cada item recusado tem motivo e nome no
 * console, e os BONS SEGUEM — recusar item nunca recusa a sacola.
 *
 * Aceita `unknown[]` porque a origem é `localStorage`, que é texto de origem
 * desconhecida. Tipar a entrada como `ItemDaSacola[]` seria afirmar sobre um
 * dado que ninguém conferiu.
 */
export function limparItens(bruto: unknown[]): ItemDaSacola[] {
  const bons: ItemDaSacola[] = [];
  const recusados: string[] = [];

  for (const cru of bruto) {
    if (!cru || typeof cru !== "object" || Array.isArray(cru)) {
      recusados.push(`item que não é objeto (${JSON.stringify(cru)})`);
      continue;
    }

    const item = cru as Partial<Record<keyof ItemDaSacola, unknown>>;

    const produto = typeof item.product_id === "string" ? item.product_id.trim() : "";
    if (!produto) {
      // Sem produto não há item: a RPC deixaria `produto_id` nulo e o descartaria.
      recusados.push(
        `sem product_id (nome: ${typeof item.name === "string" ? item.name : "?"})`,
      );
      continue;
    }

    // `Number` de propósito: `localStorage` guarda "2" com facilidade, e o
    // `item ->> 'quantidade'` da RPC aceitaria essa string. O que NÃO passa é
    // zero, negativo, fracionado e não-numérico — zero e negativo bateriam no
    // CHECK (quantidade > 0) da 0004 e derrubariam a fusão inteira por um item.
    const quantidade = Number(item.quantity);
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      recusados.push(`quantidade inválida em ${produto} (${String(item.quantity)})`);
      continue;
    }

    const preco = Number(item.price);

    bons.push({
      product_id: produto,
      name: typeof item.name === "string" ? item.name : "",
      // Preço é CÓPIA DE EXIBIÇÃO — quem cobra é o checkout, que relê preço e
      // estoque do banco. Preço impresentável vira 0 (a 0007 faz o mesmo) em vez
      // de custar o item: "R$ 0,00" até a vitrine reler o catálogo é reversível.
      price: Number.isFinite(preco) && preco >= 0 ? preco : 0,
      quantity: Math.min(quantidade, TETO_DE_QUANTIDADE),
      image: typeof item.image === "string" ? item.image : "",
      size: typeof item.size === "string" ? item.size : "",
      ...(typeof item.moagem === "string" && item.moagem
        ? { moagem: item.moagem }
        : {}),
      // O selo atravessa a limpeza: sem isto, passar a sacola por aqui apagaria
      // a prova de que ela já está na conta, e a fusão seguinte dobraria tudo.
      ...(typeof item.selo === "string" && item.selo ? { selo: item.selo } : {}),
    });
  }

  if (recusados.length > 0) {
    console.warn(
      `[sacola] ${recusados.length} item(ns) da sacola local não puderam ser ` +
        "fundidos na conta e ficaram de fora. Os demais foram mantidos.",
      recusados,
    );
  }

  return bons;
}

/** Soma duas sacolas por (produto, moagem). Usada pela base da conta. */
export function somarSacolas(
  a: ItemDaSacola[],
  b: ItemDaSacola[],
): ItemDaSacola[] {
  const somados = new Map<string, ItemDaSacola>();
  for (const item of [...a, ...b]) {
    const chave = chaveDoItem(item);
    const anterior = somados.get(chave);
    somados.set(
      chave,
      anterior
        ? {
            ...anterior,
            quantity: Math.min(
              anterior.quantity + item.quantity,
              TETO_DE_QUANTIDADE,
            ),
          }
        : { ...item },
    );
  }
  return [...somados.values()];
}

/**
 * O que ainda NÃO está na conta — e é só isto que vai para a RPC.
 *
 * Sem esta subtração, a sacola gravada de volta pela fusão anterior seria
 * mandada de novo na próxima carga de página, e a sacola do cliente dobraria a
 * cada visita. Com ela, refundir a mesma sacola manda lista vazia.
 *
 * A soma DENTRO da lista local (duas entradas do mesmo café e mesma moagem) não
 * é enfeite: a 0007 também pré-agrega, porque um único INSERT não pode tocar a
 * mesma linha duas vezes (21000 — "cannot affect row a second time"). Fazer aqui
 * também deixa a conta da subtração honesta e a lista menor.
 */
export function calcularPendentes(
  local: ItemDaSacola[],
  naConta: ItemDaSacola[],
): ItemDaSacola[] {
  const base = new Map<string, number>();
  for (const item of naConta) {
    const chave = chaveDoItem(item);
    base.set(chave, (base.get(chave) ?? 0) + item.quantity);
  }

  const pendentes: ItemDaSacola[] = [];
  for (const item of somarSacolas(local, [])) {
    const falta = item.quantity - (base.get(chaveDoItem(item)) ?? 0);
    if (falta > 0) {
      pendentes.push({ ...item, quantity: Math.min(falta, TETO_DE_QUANTIDADE) });
    }
  }
  return pendentes;
}

/**
 * INGLÊS → PORTUGUÊS. A ponte que a 0007 exige e o compilador cobra.
 *
 * O tipo de retorno é `ItemParaFundir[]`, que é literalmente o `Args` de
 * `fundir_sacola` em `lib/supabase/tipos.ts`. Renomear uma chave errado aqui não
 * chega a virar sacola perdida em produção: não compila.
 */
export function traduzirParaFusao(itens: ItemDaSacola[]): ItemParaFundir[] {
  return itens.map((item) => ({
    produto_id: item.product_id,
    quantidade: item.quantity,
    preco: item.price,
    nome: item.name,
    imagem: item.image,
    tamanho: item.size,
    // A única chave que já coincidia. `null` explícito porque a coluna é
    // nulável e `undefined` sumiria do JSON — dá no mesmo para a RPC, mas o
    // `null` diz "não tem moagem" em vez de "esqueci de mandar".
    moagem: item.moagem ?? null,
  }));
}

/** PORTUGUÊS → INGLÊS: a sacola da conta virando o que a vitrine desenha. */
export function traduzirDaConta(linhas: LinhaDaConta[]): ItemDaSacola[] {
  return linhas.map((linha) => ({
    product_id: linha.produto_id,
    name: linha.nome ?? "",
    price: Number(linha.preco) || 0,
    quantity: Number(linha.quantidade) || 0,
    image: linha.imagem ?? "",
    size: linha.tamanho ?? "",
    ...(linha.moagem ? { moagem: linha.moagem } : {}),
  }));
}

/* ------------------------------------------------------------------ *
 * localStorage — tudo dentro de try, porque modo privado sem cota lança
 * ------------------------------------------------------------------ */

function lerLista(chave: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = JSON.parse(localStorage.getItem(chave) || "[]");
    return Array.isArray(bruto) ? bruto : [];
  } catch {
    return [];
  }
}

/**
 * Grava a sacola JÁ CARIMBADA. A base tem de ser gravada com o mesmo selo, e as
 * duas gravações ficam sempre lado a lado em `executarFusao` — a ordem é sacola
 * primeiro, base depois, porque a sacola é o que a pessoa vê.
 */
function gravarSacola(itens: ItemDaSacola[], selo: string): void {
  try {
    localStorage.setItem(
      CHAVE_DA_SACOLA,
      JSON.stringify(itens.map((item) => ({ ...item, selo }))),
    );
  } catch {
    // Sem cota, a sacola vive só em memória nesta aba. A fusão já aconteceu.
  }
}

type BaseDaConta = { userId: string; selo: string | null; itens: ItemDaSacola[] };

/**
 * `null` quer dizer "ESTE APARELHO AINDA NÃO CONHECE A SACOLA DESTA CONTA", e a
 * diferença entre `null` e `[]` decide se a sacola da conta é relida — ver
 * `executarFusao`. `[]` é uma afirmação (a conta estava vazia da última vez);
 * `null` é a ausência de afirmação.
 */
function lerBase(userId: string): BaseDaConta | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_DA_BASE) || "null");
    if (!bruto || typeof bruto !== "object") return null;
    const base = bruto as Partial<BaseDaConta>;
    // Conta diferente: a base não vale. A sacola deste aparelho é de quem entrou.
    if (base.userId !== userId) return null;
    if (!Array.isArray(base.itens)) return null;
    return {
      userId,
      selo: typeof base.selo === "string" ? base.selo : null,
      itens: limparItens(base.itens),
    };
  } catch {
    return null;
  }
}

function gravarBase(base: BaseDaConta): void {
  try {
    localStorage.setItem(CHAVE_DA_BASE, JSON.stringify(base));
  } catch {
    // Sem base gravada, a próxima fusão soma de novo o que já está na conta.
    // Ruim, e ainda assim melhor do que perder a sacola: o cliente vê itens a
    // mais e consegue diminuir na tela; itens a menos ele não recupera.
  }
}

/**
 * A trava ENTRE ABAS, e a honestidade sobre o que ela não é.
 *
 * `localStorage` não tem compare-and-swap, então isto NÃO é exclusão mútua: duas
 * abas que leiam a marca no mesmo instante entram as duas. O que ela faz é
 * encolher a janela de "duas fusões simultâneas" do tempo inteiro da RPC mais a
 * releitura para o intervalo entre um `getItem` e um `setItem`. Fora dessa
 * janela, a aba que chega depois já enxerga a base nova gravada pela primeira e
 * não tem nada pendente a mandar.
 *
 * Sem `localStorage` (modo privado com cota zerada) o retorno é `true`: fundir
 * sem trava é melhor do que nunca fundir.
 */
function reivindicarEntreAbas(): boolean {
  try {
    const desde = Number(localStorage.getItem(CHAVE_ENTRE_ABAS));
    const idade = Date.now() - desde;
    // `idade >= 0` descarta marca com data no futuro (relógio mexido), que de
    // outro modo bloquearia a fusão até o relógio alcançá-la.
    if (Number.isFinite(desde) && desde > 0 && idade >= 0 && idade < VALIDADE_ENTRE_ABAS_MS) {
      return false;
    }
    localStorage.setItem(CHAVE_ENTRE_ABAS, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

function liberarEntreAbas(): void {
  try {
    localStorage.removeItem(CHAVE_ENTRE_ABAS);
  } catch {
    // Some sozinha pela validade.
  }
}

/* ------------------------------------------------------------------ *
 * A fusão
 * ------------------------------------------------------------------ */

/**
 * A trava de dentro da aba mora em `globalThis`, e o motivo é o mesmo do
 * singleton do cliente Supabase: um `let` de módulo é zerado a cada reavaliação
 * do módulo (Fast Refresh do `next dev`, duplicação entre chunks), e o provedor
 * da sacola remonta — as duas coisas devolveriam a trava ao estado inicial e
 * cada evento de sessão fundiria de novo.
 *
 * Guarda a PROMESSA, não um booleano: dois ouvintes que disparem no mesmo tique
 * (o cliente é um só, mas o Fast Refresh reavalia também quem se INSCREVE, e o
 * mesmo cliente pode acabar com dois `onAuthStateChange`) pegam a mesma chamada
 * em voo em vez de abrirem duas.
 */
const CHAVE_DA_TRAVA = "__canastraFusaoDaSacola__";
const raiz = globalThis as unknown as Record<
  string,
  { promessa: Promise<ResultadoDaFusao> } | undefined
>;

/**
 * Funde a sacola local na conta. Segura para ser chamada em TODO evento de
 * `onAuthStateChange` — é essa a razão de existir a trava.
 *
 * Nunca rejeita: quem chama é um ouvinte de evento, e uma promessa rejeitada ali
 * vira `unhandledrejection` sem nada na tela.
 */
export function fundirSacola(): Promise<ResultadoDaFusao> {
  const emVoo = raiz[CHAVE_DA_TRAVA];
  if (emVoo) return emVoo.promessa;

  const promessa = executarFusao()
    .catch((erro): ResultadoDaFusao => {
      console.error("[sacola] Falha inesperada ao fundir a sacola.", erro);
      return { situacao: "falhou", codigo: "excecao" };
    })
    .then((resultado) => {
      /**
       * A trava só PERSISTE quando não há mais o que fundir nesta carga de
       * página. Nos outros três desfechos ela é solta, e cada um por um motivo:
       *  · `semSessao` — o visitante ainda vai entrar NESTA página, e a trava
       *    presa faria o login não fundir nada (o `INITIAL_SESSION` sem sessão
       *    dispara antes de qualquer login, em toda visita anônima);
       *  · `adiada` — quem fundiu foi outra aba, esta não fez nada;
       *  · `falhou` — "fundir tarde é muito melhor do que perder a sacola".
       */
      if (resultado.situacao !== "fundida" && resultado.situacao !== "semNovidade") {
        delete raiz[CHAVE_DA_TRAVA];
      }
      return resultado;
    });

  // Antes de qualquer `await`: a atribuição precisa acontecer no mesmo tique da
  // chamada, senão dois ouvintes síncronos passam os dois pela porta.
  raiz[CHAVE_DA_TRAVA] = { promessa };
  return promessa;
}

/**
 * Solta a trava. Chamado no `SIGNED_OUT` — quem sai e entra com OUTRA conta na
 * mesma aba precisa que a fusão volte a acontecer.
 *
 * Também é o que os testes usam para começar cada caso do zero.
 */
export function reiniciarFusao(): void {
  delete raiz[CHAVE_DA_TRAVA];
}

async function executarFusao(): Promise<ResultadoDaFusao> {
  if (typeof window === "undefined") return { situacao: "semSessao" };

  /**
   * `recuperarSessao()` NÃO está aqui só para descobrir o `userId`.
   *
   * `fundir_sacola` exige `canastra.eh_cliente()` e responde 42501 a quem tem
   * conta no GoTrue mas ainda não tem linha em `canastra.clientes` — o caso de
   * quem confirmou o e-mail dias depois e entrou direto pelo login. Quem cria
   * esse vínculo é o `montarUsuario()` do `sessao.ts`, que chama
   * `garantir_cliente` justamente quando a leitura de `clientes` não acha linha.
   * Chamar `recuperarSessao()` antes da RPC é o que garante o vínculo; repetir a
   * chamada de `garantir_cliente` aqui seria duplicar a regra em dois lugares.
   */
  const sessao = await recuperarSessao();
  if (!sessao) return { situacao: "semSessao" };
  const userId = sessao.usuario.userId;

  const local = limparItens(lerLista(CHAVE_DA_SACOLA));
  const naConta = lerBase(userId);

  /**
   * A SACOLA DIZ QUE JÁ FOI FUNDIDA E A BASE NÃO CONFIRMA: as duas chaves se
   * separaram, e é o único estado em que este módulo pode dobrar a sacola de
   * alguém. Ele é alcançável — limpeza parcial de dados do site, extensão,
   * script de QA, ou a cota estourando entre gravar a sacola e gravar a base.
   *
   * Sem o selo, este estado é indistinguível de "sacola anônima pendente", e a
   * resposta óbvia (fundir tudo) DOBRA as quantidades. Com ele, cada item diz
   * por si: quem tem selo já está na conta e não é remandado; quem não tem é
   * novidade de verdade e vai. É a mesma conta de sempre, com a base
   * reconstruída a partir do que a própria sacola carimbada afirma.
   *
   * O QUE SE PERDE NESTE CAMINHO, e é deliberado: um item carimbado cuja
   * quantidade AUMENTOU depois da última fusão volta ao valor da conta na
   * releitura, porque a base perdida era a única coisa que sabia a quantidade
   * antiga. Uma unidade a menos, visível na tela e corrigível em um clique,
   * contra dobrar a sacola inteira em silêncio.
   */
  const carimbados = local.filter((item) => Boolean(item.selo));
  const seloLocal = seloDaSacola(local);
  const divergiu =
    seloLocal !== null && (naConta === null || naConta.selo !== seloLocal);

  if (divergiu) {
    // Dois caminhos chegam aqui, e os dois são tratados igual: a base sumiu, ou
    // ela é de OUTRA conta (computador compartilhado — quem sai deixa a sacola).
    console.warn(
      "[sacola] A sacola local diz que já está numa conta, e a base que " +
        "provaria isso sumiu ou é de outra conta. Só os itens sem selo serão " +
        "fundidos, e a sacola da conta será relida.",
    );
  }

  const jaNaConta = divergiu ? carimbados : (naConta?.itens ?? []);
  const pendentes = calcularPendentes(local, jaNaConta);

  /**
   * A PRIMEIRA VEZ DESTA CONTA NESTE APARELHO é o único momento em que a sacola
   * da conta é lida de volta, e a restrição não é economia de requisição — é
   * correção.
   *
   * Nesta fase NADA APAGA linha em `canastra.carrinho_itens`: a fusão só soma, e
   * remover item ou terminar uma compra passa por `persistir()`, que fala com o
   * Express (outro lugar; a unificação é da F5). Ou seja, a sacola da conta é
   * uma lista que só cresce. Relê-la a cada fusão traria de volta, para dentro
   * da sacola do cliente, o item que ele removeu ontem e o café que ele JÁ
   * COMPROU — um fantasma por visita.
   *
   * Enquanto este aparelho não conhece a conta, a releitura é a única forma de
   * saber o que já está lá (a sacola montada no celular, por exemplo), e não há
   * remoção local para desfazer, porque não houve nenhuma ainda. Depois disso, a
   * lista local é a versão mais recente — é ela que a pessoa vem editando — e a
   * base guardada basta para a subtração.
   *
   * A divergência de selo entra pela mesma porta: lá também a base é
   * desconhecida, e relê-la é como ela volta a existir.
   */
  const precisaReler = naConta === null || divergiu;

  // Sacola vazia, ou nada além do que a conta já tem. Não é erro nem exceção: é
  // o caso comum de toda visita depois da primeira, e a RPC nem precisa saber.
  if (pendentes.length === 0 && !precisaReler) {
    return { situacao: "semNovidade" };
  }

  const supabase = clienteNavegador();

  /**
   * UM selo por execução, usado nos dois caminhos de gravação abaixo. Dois selos
   * diferentes na mesma execução fariam sacola e base divergirem por conta
   * própria, que é exatamente o que o selo veio detectar.
   */
  const selo = novoSelo();

  if (pendentes.length > 0) {
    if (!reivindicarEntreAbas()) return { situacao: "adiada" };
    try {
      // A tradução é aqui e em nenhum outro lugar. `ItemParaFundir` é o `Args`
      // da RPC: mandar `pendentes` cru não compila, e é para isso que ele existe.
      const { error } = await supabase.rpc("fundir_sacola", {
        itens: traduzirParaFusao(pendentes),
      });

      if (error) {
        // A SACOLA LOCAL NÃO É TOCADA NESTE CAMINHO. É a regra inteira do
        // tratamento de falha: sem `localStorage` apagado, a próxima carga de
        // página tenta de novo e no pior caso o cliente funde tarde.
        console.error(
          `[sacola] fundir_sacola recusou (${error.code ?? "sem código"}): ` +
            `${error.message ?? ""}. A sacola local foi mantida e a fusão será ` +
            "tentada de novo.",
          error.hint ?? "",
        );
        return { situacao: "falhou", codigo: error.code ?? "desconhecido" };
      }

      /**
       * A CONTA JÁ TEM OS ITENS, e a base avança AQUI — antes da releitura, que
       * pode falhar. Ela é exatamente o que sabemos estar lá: o que já havia
       * mais o que acabou de ir. Adiar esta linha para depois do GET faria uma
       * queda de rede virar uma segunda fusão da mesma sacola na visita
       * seguinte, que é o desastre da 0007 em câmera lenta.
       */
      /**
       * A SACOLA É CARIMBADA AQUI TAMBÉM, e não só na releitura. Ela continua
       * com os mesmos itens — o selo é campo interno, nada muda na tela —, mas
       * sem esta linha existiria um estado "já fundida e sem selo": bastaria a
       * releitura falhar. Nesse estado, perder a base voltaria a significar
       * fundir tudo de novo, que é o buraco que o selo fecha.
       */
      gravarSacola(local, selo);
      gravarBase({ userId, selo, itens: somarSacolas(jaNaConta, pendentes) });
    } finally {
      liberarEntreAbas();
    }
  }

  if (precisaReler) {
    const daConta = await lerSacolaDaConta(supabase);

    if (daConta) {
      // A sacola da CONTA passa a ser o que a pessoa vê, e ela substitui a
      // local — é o mesmo gesto que "apagar `localStorage['cart']` depois da
      // resposta", sem deixar ninguém sem sacola na tela enquanto a leitura da
      // sacola logada não migra para o PostgREST (F5). Ver o item 3 do topo.
      //
      // Sacola e base gravadas com o MESMO selo: é o que as torna conferíveis
      // uma contra a outra na próxima visita.
      gravarSacola(daConta, selo);
      gravarBase({ userId, selo, itens: daConta });
      return { situacao: "fundida", itens: daConta.map((i) => ({ ...i, selo })) };
    }

    // Releitura falhou e não havia nada a fundir: este aparelho continua sem
    // conhecer a conta, e é isso que a AUSÊNCIA de base registra. Devolver
    // "falhou" solta a trava e o próximo evento tenta de novo.
    if (pendentes.length === 0) {
      return { situacao: "falhou", codigo: "releitura" };
    }
  }

  // Fundiu, mas a lista da conta não foi (ou não precisava ser) relida: o que a
  // pessoa vê continua sendo a sacola local, que contém tudo o que ela montou.
  // Com o selo, para bater com o que acabou de ser gravado.
  return { situacao: "fundida", itens: local.map((item) => ({ ...item, selo })) };
}

/**
 * A sacola da conta, lida de volta.
 *
 * SEM FILTRO POR CARRINHO DE PROPÓSITO: `carrinho_itens` não tem dono próprio, e
 * é a política `carrinho_itens_dono` (0006) que recorta a leitura pelo carrinho
 * de `auth.uid()`. Um `WHERE` a mais aqui não acrescentaria segurança nenhuma e
 * exigiria uma segunda consulta só para descobrir o `carrinho_id`.
 *
 * `null` significa "não deu para ler", que é diferente de "está vazia" — e a
 * diferença importa: com `[]` no lugar de `null`, uma queda de rede apagaria a
 * sacola da tela.
 */
async function lerSacolaDaConta(
  supabase: ReturnType<typeof clienteNavegador>,
): Promise<ItemDaSacola[] | null> {
  const { data, error } = await supabase
    .from("carrinho_itens")
    .select("produto_id, quantidade, preco, nome, imagem, tamanho, moagem");

  if (error) {
    console.warn(
      "[sacola] A fusão deu certo, mas não foi possível reler a sacola da " +
        `conta. ${error.code ?? ""} ${error.message ?? ""}`.trim(),
    );
    return null;
  }

  // Anotado de propósito: um `.select()` com coluna errada NÃO falha na chamada
  // (medido em `lib/supabase/tipos.test.ts`) — ele falha ao atribuir o `data`.
  // Esta linha é o que transforma uma coluna renomeada numa migração em erro de
  // compilação, em vez de uma sacola vazia em produção.
  const linhas: LinhaDaConta[] = data ?? [];
  return traduzirDaConta(linhas);
}
