import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";
import type { TomDeStatus } from "../status";

/**
 * A DECISÃO da tela de Avaliações — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * O QUE ESTA TELA CONSERTA, E É O DEFEITO MAIS SILENCIOSO DO PAINEL INTEIRO.
 * A tela legada (`AvaliacoesManager.jsx`) era a ÚNICA que não passava pelo
 * Express: falava direto com o PostgREST e dependia de RLS + GRANT de coluna.
 * Lá, um não-admin executa o `UPDATE` e atualiza ZERO LINHAS SEM ERRO NENHUM —
 * é a semântica do `USING` de uma política de RLS, que RECORTA o conjunto em
 * vez de recusar a operação. Sem pedir `count: "exact"` e conferi-lo, o toast
 * anunciava sucesso e o banco ficava intacto.
 *
 * A Onda 4 fechou isso pelo único caminho que fecha de verdade: um modelo de
 * acesso só. `GET /admin/avaliacoes` e `PATCH /admin/avaliacoes` passam por
 * `isAuthenticated` + `isAdmin`, e o `PATCH` devolve `{pedidas, atualizadas}`.
 * Daí a regra que atravessa este módulo inteiro: **a tela mostra
 * `atualizadas`, nunca `pedidas`**. É a única coisa que a operação existe para
 * informar, e mostrar a pedida é mentir sobre exatamente ela.
 *
 * `moderado_em` É ESCRITO PELO BACKEND (`SET status = $1, moderado_em = now()`),
 * porque não há trigger de moddatetime neste schema. Está anotado aqui, e não
 * só lá, porque a pergunta "quem carimba a data?" nasce olhando para a tela.
 */

/** A rota desta tela, num lugar só — é base de URL e de comparação no teste. */
export const ROTA_DE_AVALIACOES = "/dashboard/avaliacoes";

/**
 * Vinte por página, como Clientes e Pedidos.
 *
 * O backend aceita até 100, e aqui a tentação de pedir mais é maior que nas
 * outras telas: a fila de moderação some quando se aprova tudo. Mas moderar é
 * LER — cada linha carrega o texto completo da avaliação —, e cem textos
 * inteiros numa página são uma tela de rolagem onde não se sabe mais o que já
 * foi lido. Vinte é o que cabe numa sessão de trabalho.
 */
export const POR_PAGINA = 20;

/**
 * O vocabulário de `status`, IGUAL ao CHECK `avaliacoes_status_valido` (0014).
 *
 * **`recusada` NÃO EXISTE**, e é o nome que todo mundo tenta primeiro. A
 * decisão da 0014 foi `oculta`, porque a avaliação continua sendo do cliente e
 * some da vitrine em vez de ser negada — e não há DELETE nesta tela de
 * propósito (apagar é privilégio de `service_role`). Inventar "Recusada" no
 * rótulo faria o gestor procurar por um estado que o banco recusa com 23514.
 *
 * A lista é comparada com `backend/src/repositories/avaliacoesRepository.js`
 * por `avaliacoes.logica.test.ts`, lendo o arquivo do disco — o mesmo contrato
 * que `status.ts` mantém com `statusDePedido.js`, e pelo mesmo motivo: uma
 * divergência aqui não aparece em `tsc` nem em `next build`.
 */
export const STATUS_DE_AVALIACAO = [
  { valor: "pendente", rotulo: "Pendente", tom: "alerta" },
  { valor: "aprovada", rotulo: "Aprovada", tom: "sucesso" },
  /* `neutro`, e não `erro`: ocultar não é falha nem destruição — R21 reserva o
     vermelho às duas, e um selo vermelho em toda avaliação escondida ensinaria
     o gestor a ver vermelho como categoria em vez de problema. */
  { valor: "oculta", rotulo: "Oculta", tom: "neutro" },
] as const satisfies ReadonlyArray<{
  valor: string;
  rotulo: string;
  tom: TomDeStatus;
}>;

export type StatusDeAvaliacao = (typeof STATUS_DE_AVALIACAO)[number]["valor"];

/** Valor desconhecido devolve a si mesmo — a mesma doutrina de
 *  `rotuloDoStatus`: esconder atrás de "Outro" faria um estado novo do backend
 *  sumir da tela sem ninguém notar. */
export function rotuloDaAvaliacao(valor: string): string {
  return STATUS_DE_AVALIACAO.find((s) => s.valor === valor)?.rotulo ?? valor;
}

export function tomDaAvaliacao(valor: string): TomDeStatus {
  return STATUS_DE_AVALIACAO.find((s) => s.valor === valor)?.tom ?? "neutro";
}

/**
 * A linha que `GET /admin/avaliacoes` devolve — a projeção EXPLÍCITA do
 * repositório, nunca `*`.
 *
 * `user_id` entra porque a moderação cruza a avaliação com o cliente (é a mesma
 * pessoa de um chamado de suporte) e NÃO sai na leitura pública da vitrine.
 * Ele fica fora da tela mesmo assim: o R2 proíbe identificador de pessoa na
 * query string, e imprimir um uuid numa coluna não ajuda ninguém a moderar.
 */
export type AvaliacaoDaLista = {
  id: string;
  sku: string | null;
  nota: number | null;
  titulo: string | null;
  texto: string | null;
  nome_exibicao: string | null;
  status: string;
  user_id: string | null;
  criado_em: string | null;
  moderado_em: string | null;
};

export type RespostaDeAvaliacoes = {
  data: AvaliacaoDaLista[];
  total: number;
  totalPages: number;
  page: number;
};

/** O estado da tela, que é exatamente o que está na URL (R2). */
export type EstadoDasAvaliacoes = {
  /** O que a pessoa digitou. O backend compara com texto, título e nome. */
  busca: string;
  /** `""` é "todos". Um valor desconhecido segue INTACTO — ver `lerEstado`. */
  status: string;
  sku: string;
  pagina: number;
};

/**
 * O estado a partir da URL.
 *
 * O `status` DESCONHECIDO ATRAVESSA DE PROPÓSITO, e essa é a decisão menos
 * óbvia deste arquivo. `?status=recusada` é o caso real — é o nome que quem
 * conhece qualquer outro e-commerce tenta —, e há dois caminhos:
 *
 *   descartar em silêncio ... a tela mostra TUDO enquanto a barra de endereço
 *                             diz "recusada". A tela discorda de si mesma, e o
 *                             gestor conclui que o filtro não funciona.
 *   deixar passar ........... o backend responde 400 com
 *                             `Status inválido: "recusada". Use um de:
 *                             pendente, aprovada, oculta.` — que nomeia os três
 *                             valores que existem.
 *
 * A frase do servidor É o diagnóstico (spec §6), e aqui ela é literalmente a
 * resposta à pergunta que a pessoa fez. Por isso passa.
 *
 * A PÁGINA sai daqui apenas SANEADA (≥ 1); o aperto contra a última página
 * existente é depois da resposta, em `estadoCorrigido` — antes dela não há como
 * saber quantas páginas há, e chutar faria a tela pedir uma e mostrar outra.
 */
export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDasAvaliacoes {
  return {
    busca: textoDoParametro(parametros.q),
    status: textoDoParametro(parametros.status),
    sku: textoDoParametro(parametros.sku),
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

/** A consulta da listagem. `limit` é sempre explícito: o padrão do backend é
 *  20 hoje, mas uma tela que pagina de 20 em 20 não pode depender de um padrão
 *  que ela não controla — o dia em que ele virar 10, o rodapé passa a mentir. */
export function montarConsulta(estado: EstadoDasAvaliacoes): string {
  return montarUrl("/admin/avaliacoes", {
    q: estado.busca || undefined,
    status: estado.status || undefined,
    sku: estado.sku || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

/**
 * A consulta do CONTADOR DE PENDENTES — uma ida separada, de propósito.
 *
 * Ele precisa continuar visível com o filtro em "Aprovadas": é o número que
 * responde "ainda tem fila?", e derivá-lo da página exibida o zeraria toda vez
 * que se olhasse outra coisa. `limit: 1` porque só `total` é lido — o backend
 * conta com o mesmo WHERE antes de paginar, então a contagem é exata e o corpo
 * é uma linha. (O `head: true` do PostgREST, que a tela legada usava para não
 * trazer corpo nenhum, não tem equivalente numa rota REST comum; uma linha é o
 * mais barato que se consegue aqui.)
 */
export function consultaDePendentes(): string {
  return montarUrl("/admin/avaliacoes", { status: "pendente", limit: 1 });
}

/**
 * A URL desta tela para um estado — a "aba salva" do R2.
 *
 * `pagina: 1` é OMITIDA: é o valor padrão, e `?pagina=1` cria uma segunda URL
 * para a mesma tela — duas entradas no histórico e dois favoritos que o gestor
 * não sabe distinguir.
 */
export function urlDaTela(estado: Partial<EstadoDasAvaliacoes>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_AVALIACOES, {
    q: estado.busca?.trim() || undefined,
    status: estado.status?.trim() || undefined,
    sku: estado.sku?.trim() || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/**
 * A URL de uma das abas de status — e ela ZERA A PÁGINA, sempre.
 *
 * O caso é este: página 4 de "Pendentes", clique em "Aprovadas", e as
 * aprovadas cabem em duas páginas. Sem zerar, a tela vai para a página 4 de um
 * conjunto de 2, o backend devolve lista vazia (ele não prende a página — só
 * garante `page >= 1`) e o gestor lê "nenhum resultado para este filtro" logo
 * depois de ter TROCADO o filtro. É a leitura mais natural possível: "não tem
 * nenhuma aprovada". `estadoCorrigido` é a rede embaixo desta; esta é a que
 * impede o problema de existir.
 */
export function urlDoStatus(
  estado: EstadoDasAvaliacoes,
  status: string,
): string {
  return urlDaTela({ ...estado, status, pagina: 1 });
}

/**
 * O estado depois de ver a resposta — a página presa dentro do que existe.
 *
 * AQUI ELE VALE MAIS QUE NAS OUTRAS TELAS, porque a lista ENCOLHE por ação de
 * quem está olhando: aprovar as 20 últimas pendentes da página 3 apaga a página
 * 3. Na tela legada isso vinha do PostgREST como `PGRST103` (range além do
 * fim), e a lição registrada no checklist de paridade é que aquilo NÃO É ERRO —
 * é voltar para uma página que existe.
 */
export function estadoCorrigido(
  estado: EstadoDasAvaliacoes,
  total: number,
): EstadoDasAvaliacoes {
  return {
    ...estado,
    pagina: paginaValida(estado.pagina, totalDePaginas(total, POR_PAGINA)),
  };
}

/** Os chips do R3 — um por filtro ativo, cada um com o `href` que o REMOVE.
 *  Todos zeram a página junto: tirar um filtro estando na página 4 e continuar
 *  na 4 é o jeito mais rápido de fazer uma lista sem filtro parecer vazia. */
export function chipsDasAvaliacoes(
  estado: EstadoDasAvaliacoes,
): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      valor: estado.busca,
      href: urlDaTela({ ...estado, busca: "", pagina: 1 }),
    });
  }
  if (estado.status) {
    chips.push({
      chave: "status",
      dimensao: "Status",
      // O RÓTULO, e não o valor: o gestor filtrou por "Pendente", não por
      // `pendente`. Um status desconhecido volta a si mesmo (ver
      // `rotuloDaAvaliacao`) — e é bom que apareça cru, porque é ele que a
      // frase de erro do servidor está falando.
      valor: rotuloDaAvaliacao(estado.status),
      href: urlDaTela({ ...estado, status: "", pagina: 1 }),
    });
  }
  if (estado.sku) {
    chips.push({
      chave: "sku",
      dimensao: "SKU",
      valor: estado.sku,
      href: urlDaTela({ ...estado, sku: "", pagina: 1 }),
    });
  }
  return chips;
}

/** Há filtro ligado? É o que decide qual dos três estados vazios o R16 mostra —
 *  "ainda não há avaliação nenhuma" e "nenhuma casa com este filtro" são
 *  diagnósticos opostos e levam a ações opostas. */
export function temFiltro(estado: EstadoDasAvaliacoes): boolean {
  return estado.busca !== "" || estado.status !== "" || estado.sku !== "";
}

/* ==========================================================================
 * A MODERAÇÃO
 * ========================================================================== */

/**
 * O teto do lote, IGUAL ao do backend (`Modere no máximo 200 avaliações por
 * vez.`).
 *
 * Uma página tem 20, então a tela sozinha nunca chega perto. Ele está aqui
 * porque a Server Action é uma SUPERFÍCIE DE REDE: quem a invocar direto não
 * passa pela tabela, e recusar com a frase daqui é melhor do que gastar uma ida
 * ao Express para ouvir a mesma coisa.
 */
export const LIMITE_DO_LOTE = 200;

/**
 * Quais das marcadas MUDARIAM de status.
 *
 * Serve à frase que o checklist de paridade pede — "mensagem quando nenhuma das
 * selecionadas mudaria de status". Sem ela, marcar três avaliações já aprovadas
 * e clicar em "Aprovar" devolve `{pedidas: 3, atualizadas: 3}`: o `UPDATE`
 * casou as três linhas e reescreveu o mesmo valor. A resposta diz "3
 * atualizadas" com toda a razão, e o gestor entende que fez alguma coisa —
 * quando não fez. Quem sabe distinguir é a TELA, que tem as linhas em mãos.
 *
 * `moderado_em` MUDA de qualquer jeito nesse caso (o backend carimba `now()`
 * sem olhar o status anterior), e é por isso que a frase diz "nenhuma mudou de
 * status" e não "nada aconteceu": a segunda seria falsa.
 */
export function idsQueMudam(
  linhas: AvaliacaoDaLista[],
  marcados: readonly string[],
  destino: string,
): string[] {
  const conjunto = new Set(marcados);
  return linhas
    .filter((linha) => conjunto.has(linha.id) && linha.status !== destino)
    .map((linha) => linha.id);
}

/** Plural correto — "1 avaliação", "2 avaliações". Num painel que o gestor lê
 *  cem vezes por dia, plural errado é a diferença entre uma ferramenta e um
 *  protótipo. */
export function contarAvaliacoes(n: number): string {
  return n === 1 ? "1 avaliação" : `${n} avaliações`;
}

export type PlacarDaModeracao = { pedidas: number; atualizadas: number };

/**
 * A frase do resultado — e ela fala de `atualizadas`, NUNCA de `pedidas`.
 *
 * Os três casos são diagnósticos diferentes, e colapsá-los é o defeito que a
 * rota nova existe para tornar impossível:
 *
 *   atualizadas = 0 ......... nada mudou. Na tela legada isto era o toast de
 *                             sucesso mentindo (RLS recortando em silêncio);
 *                             pela rota do Express, é lote de ids que já não
 *                             existem. Tom de ERRO — foi um gesto sem efeito.
 *   atualizadas < pedidas ... parte do lote não casou. É informação, não falha:
 *                             a avaliação pode ter saído junto com a conta que
 *                             o cliente apagou (LGPD). A tela precisa dizer
 *                             quantas, para não anunciar mais do que fez.
 *   atualizadas = pedidas ... o caminho normal.
 *
 * `ok` distingue "conte isto em verde" de "conte isto em vermelho"; a contagem
 * vai crua na frase nos três.
 */
export function resumoDaModeracao(
  placar: PlacarDaModeracao,
  destino: string,
): { ok: boolean; frase: string } {
  const rotulo = rotuloDaAvaliacao(destino).toLowerCase();

  if (placar.atualizadas === 0) {
    return {
      ok: false,
      frase:
        `Nenhuma das ${contarAvaliacoes(placar.pedidas)} foi alterada. ` +
        "Recarregue a página: elas podem ter saído do banco (conta excluída) " +
        "ou já estar em outro estado.",
    };
  }

  if (placar.atualizadas < placar.pedidas) {
    const fora = placar.pedidas - placar.atualizadas;
    return {
      ok: false,
      frase:
        `${contarAvaliacoes(placar.atualizadas)} de ${placar.pedidas} ` +
        `marcada${placar.atualizadas === 1 ? "" : "s"} como ${rotulo}. ` +
        `${contarAvaliacoes(fora)} não foi encontrada no banco — recarregue a ` +
        "página para ver a fila de verdade.",
    };
  }

  return {
    ok: true,
    frase: `${contarAvaliacoes(placar.atualizadas)} marcada${
      placar.atualizadas === 1 ? "" : "s"
    } como ${rotulo}.`,
  };
}

/**
 * A frase de "nada a mudar" — quando TODAS as marcadas já estão no estado
 * pedido.
 *
 * Ela existe porque a alternativa é pior: mandar o lote assim devolveria
 * `{pedidas: 3, atualizadas: 3}` (o `UPDATE` casa as três linhas e reescreve o
 * mesmo valor), e o gestor leria "3 avaliações marcadas como aprovada" tendo
 * mudado o estado de nenhuma. O checklist de paridade pede a frase por nome.
 *
 * DIZ "COMO {status}" E NÃO "NADA ACONTECEU", porque o segundo seria falso do
 * outro lado: mandado, o lote reescreveria `moderado_em = now()` nas três. Não
 * mandar é a decisão certa, e a frase descreve o motivo — não o efeito de um
 * envio que não houve.
 */
export function fraseDeNadaAMudar(marcadas: number, destino: string): string {
  const rotulo = rotuloDaAvaliacao(destino).toLowerCase();
  return (
    `${contarAvaliacoes(marcadas)} já ${marcadas === 1 ? "está" : "estão"} ` +
    `como ${rotulo} — nada foi enviado.`
  );
}

/**
 * O que a barra de seleção diz — R25, e a honestidade que ele exige.
 *
 * R25 manda distinguir "os 20 desta página" de "os N do filtro", e a razão é
 * literal: "senão o lojista acha que arquivou 1.284 quando arquivou 50". Nesta
 * tela a distinção não é uma opção de interface, é um FATO do contrato:
 * `PATCH /admin/avaliacoes` recebe uma LISTA DE IDS, e a tela só tem os ids da
 * página que carregou. Não existe "aplicar ao filtro inteiro" — existiria só
 * puxando as N páginas antes, e um botão que dispara 68 leituras escondidas é
 * pior que um botão que não existe.
 *
 * Então a tela DIZ isso, em vez de fingir. É a mesma decisão da fila do Bling
 * ("o filtro olha só a página carregada") e da tela de Assinaturas, que diz por
 * escrito o que não consegue fazer.
 */
export function resumoDaSelecao(
  marcados: number,
  naPagina: number,
  totalDoFiltro: number,
): string {
  if (marcados === 0) {
    return `Nenhuma marcada — ${naPagina} nesta página, ${totalDoFiltro} no filtro.`;
  }
  const base = `${marcados} de ${naPagina} marcada${marcados === 1 ? "" : "s"} nesta página`;
  // A ressalva só aparece quando ela É verdade: com tudo cabendo numa página,
  // "a ação vale só para esta página" seria um aviso sobre um risco que não
  // existe — e aviso que não vale nada é aviso que se aprende a ignorar.
  if (totalDoFiltro > naPagina) {
    return `${base}. O filtro tem ${totalDoFiltro}: a ação vale só para as marcadas.`;
  }
  return `${base}.`;
}

/* ==========================================================================
 * FORMATADORES DE LINHA
 * ========================================================================== */

/**
 * Quem escreveu, para a primeira coluna — R23, "identificador humano, nunca
 * UUID".
 *
 * `nome_exibicao` é o que o cliente escolheu mostrar na vitrine, e ele pode
 * estar vazio: a LGPD desta casa substitui o nome por 'Cliente Canastra' na
 * anonimização (conta.routes.js), e cadastro antigo pode não ter nenhum. Célula
 * vazia é indistinguível de defeito de carregamento, então a ausência é
 * declarada.
 */
export function identificarAutor(linha: AvaliacaoDaLista): string {
  const nome = (linha.nome_exibicao ?? "").trim();
  return nome || "Sem identificação";
}

/**
 * A nota como DADO — "4/5", monoespaçada.
 *
 * Sem estrelinhas: §2.5 manda monoespaçada em TODO número, e é ela que faz
 * comparar notas numa coluna ser comparar POSIÇÃO e não contar desenhos. Cinco
 * estrelas em 11px também não se contam de relance, que é exatamente o que uma
 * coluna de tabela existe para permitir.
 *
 * `null` vira travessão: a coluna é `NOT NULL` no banco, mas a tela não é o
 * lugar de apostar nisso — um `null/5` renderizado seria o pior dos mundos.
 */
export function notaEmTexto(nota: number | null | undefined): string {
  if (typeof nota !== "number" || !Number.isFinite(nota)) return "—";
  return `${nota}/5`;
}

/** Texto que pode faltar, virado travessão — a mesma convenção de
 *  `dinheiro.ts`: ausência declarada em vez de célula vazia. */
export function textoOuTraco(valor: string | null | undefined): string {
  const texto = (valor ?? "").trim();
  return texto === "" ? "—" : texto;
}

/**
 * O corpo da avaliação, INTEIRO.
 *
 * "moderar exige ler tudo" — sem reticências, sem truncar, e desenhado com
 * `whitespace-pre-wrap` na casca. Uma avaliação cortada em 80 caracteres
 * esconde justamente a parte pela qual se decide: o xingamento vem no fim, o
 * elogio vem no começo. A função existe só para o vazio ter texto próprio: uma
 * avaliação só com nota é comum (o formulário da PDP não exige texto), e uma
 * célula em branco ali parece linha quebrada.
 */
export function corpoDaAvaliacao(linha: AvaliacaoDaLista): string {
  const texto = (linha.texto ?? "").trim();
  return texto || "Sem texto — o cliente deixou só a nota.";
}
