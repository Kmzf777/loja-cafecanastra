import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida, totalDePaginas } from "../paginacao";
import { STATUS_DE_PEDIDO, rotuloDoStatus, type TomDeStatus } from "../status";
import {
  chaveDaFilaValida,
  filtrarFila,
  filtroDaFila,
  type ChaveDaFila,
} from "../bling/contrato";

/**
 * A DECISÃO da tela de Pedidos — sem React, sem fetch, sem DOM (spec §2.8).
 *
 * É a maior tela do painel legado (1.056 linhas de `Orders.jsx`), e quase toda
 * a regra de negócio dela morava DENTRO do componente: o vocabulário de status
 * copiado à mão, a formatação de endereço, a leitura dos itens que às vezes é
 * array e às vezes é string JSON, o nome do arquivo do CSV. Nada disso tinha
 * como ficar vermelho. Aqui tem.
 *
 * O que este módulo NÃO faz, e é deliberado: ele não conhece a lista de status
 * (importa de `../status`, que é comparada com o backend lendo o arquivo do
 * disco) e não conhece o contrato do Bling (importa de `../bling/contrato`,
 * portado com seus 21 testes). Foi copiando essas duas listas para dentro das
 * telas que o painel legado acabou com três cópias divergentes de uma.
 */

/** A rota desta tela, num lugar só — base de URL e de comparação no teste. */
export const ROTA_DE_PEDIDOS = "/dashboard/pedidos";

/**
 * Vinte por página — o mesmo passo de Clientes e pelo mesmo motivo (R17):
 * painel é tarefa, não descoberta, e uma tabela de cem linhas transforma "achar
 * o pedido da Maria" numa rolagem. O backend aceita até 100.
 */
export const POR_PAGINA = 20;

/**
 * A linha que `GET /admin/orders` devolve (projeção `COLUNAS_DO_PAINEL` do
 * `ordersRepository`), que é a MESMA de `GET /admin/orders/:id`.
 *
 * AS UNIDADES ESTÃO ANOTADAS PORQUE ELAS DIVERGEM DENTRO DO MESMO SCHEMA:
 * `total_amount`, `shipping_cost` e `discount` são `numeric(10,2)` em REAIS, e
 * o driver do `pg` os entrega como STRING. É por isso que a tela chama
 * `formatarReais` e nunca `formatarCentavos` — a mesma resposta traz
 * `preco_centavos` em outras rotas, e trocar as duas faz R$ 59,00 virar
 * R$ 0,59 sem nenhum sinal na tela.
 *
 * `address` e `items` são `jsonb`. `items` chega array quase sempre e STRING em
 * pedidos antigos (ver `lerItens`), e `address` chega objeto — exceto nos
 * pedidos anteriores à loja nova, em que é texto (ver `enderecoDoPedido`).
 */
export type PedidoDoPainel = {
  order_id: string;
  /** REAIS, como string. */
  total_amount: string | number | null;
  status: string;
  created_at: string;
  payment_method: string | null;
  items: unknown;
  address: unknown;
  /** REAIS, como string. */
  shipping_cost: string | number | null;
  shipping_method: string | null;
  tracking_code: string | null;
  coupon_code: string | null;
  /** REAIS, como string. */
  discount: string | number | null;
  bling_id: string | number | null;
  bling_situacao: string | null;
  bling_sincronizado_em: string | null;
  nfe_numero: string | null;
  nfe_chave: string | null;
  nfe_url: string | null;
  user_name: string | null;
  user_email: string | null;
  user_cpf: string | null;
};

export type RespostaDePedidos = {
  data: PedidoDoPainel[];
  total: number;
  totalPages: number;
  page: number;
};

/** `GET /admin/orders/:id` responde `{ order }` — a MESMA forma de
 *  `/my-orders/:id`, para as duas telas de detalhe lerem igual. */
export type RespostaDeUmPedido = { order: PedidoDoPainel };

/** O estado da tela, que é exatamente o que está na URL (R2). */
export type EstadoDosPedidos = {
  /** O que a pessoa digitou, como ela digitou. */
  busca: string;
  /** Valores do backend, nunca rótulos. Vazio = todos. */
  status: string[];
  /** `YYYY-MM-DD` ou `""`. */
  de: string;
  ate: string;
  /**
   * O RECORTE DE ESTADO FISCAL — o único filtro desta tela que NÃO acontece no
   * banco. `""` = desligado; qualquer outro valor é uma `chave` de
   * `FILTROS_DA_FILA` (ver `aplicarFiltroDePagina`).
   *
   * ELE ERA `nfe: "" | "pendente"`, e a mudança tem nome: a fila do Bling define
   * CINCO perguntas sobre o estado fiscal de um pedido — pendente, sem pedido de
   * venda, sem NF-e autorizada, sem rastreio, todos os pagos —, testadas desde a
   * portagem do contrato e sem nenhum consumidor. O painel novo oferecia UMA
   * delas, e "sem pedido de venda" e "sem rastreio" simplesmente deixaram de
   * existir para o gestor. Um campo com duas grafias possíveis não tinha como
   * carregar as cinco, e `?nfe=sem_rastreio` seria um nome mentindo sobre o
   * próprio valor.
   */
  fila: "" | ChaveDaFila;
  pagina: number;
};

const ESTADO_VAZIO: EstadoDosPedidos = {
  busca: "",
  status: [],
  de: "",
  ate: "",
  fila: "",
  pagina: 1,
};

/**
 * O NÚMERO DO PEDIDO QUE O CLIENTE TEM NA MÃO — e por que ele mudou.
 *
 * Não existe coluna de número sequencial: a chave é o UUID. O painel legado
 * mostrava os SEIS ÚLTIMOS dígitos (`order_id.slice(-6)`), e o e-mail que o
 * cliente recebe carimba os OITO PRIMEIROS (`emailSender.js:30`, no assunto de
 * todas as seis mensagens). Ou seja: o gestor lia um número e o cliente lia
 * outro, e não havia como cruzar os dois sem abrir o pedido.
 *
 * Esta tela adota o do CLIENTE. É ele que chega pelo telefone dizendo "meu
 * pedido é o 3F9A2C11", e é ele que a busca do backend acha
 * (`p.pedido_id::text ILIKE '%q%'`, e `ILIKE` não distingue maiúscula).
 *
 * Caixa alta porque a monoespaçada com numeral tabular do `globals.css` alinha
 * hexadecimal maiúsculo em coluna — comparar dois pedidos vira comparar
 * posição, que é literalmente o que o R23 pede.
 */
export function numeroDoPedido(orderId: string | null | undefined): string {
  const id = String(orderId ?? "").trim();
  if (!id) return "—";
  return id.slice(0, 8).toUpperCase();
}

/**
 * O identificador HUMANO da linha, para a primeira coluna — R23.
 *
 * "nunca UUID": o UUID inteiro é ilegível e não é o que ninguém tem na mão. O
 * nome vem junto porque número sozinho não diz de quem é o pedido — e o
 * backend já garante um nome ("Cliente removido" quando a conta sumiu, via
 * `COALESCE`), então célula vazia aqui seria defeito, não ausência.
 */
export function identificarPedido(pedido: PedidoDoPainel): string {
  const nome = (pedido.user_name ?? "").trim();
  return nome || "Sem identificação";
}

/**
 * A BUSCA TIRA O "#" DA FRENTE — e essa linha de código evita uma conclusão
 * errada muito cara.
 *
 * A tela imprime `#3F9A2C11`, então é isso que o gestor seleciona e cola. O
 * backend compara `p.pedido_id::text ILIKE '%#3F9A2C11%'`, que não casa com
 * nada — e a tela responde "Nenhum resultado para este filtro", que é uma frase
 * em que se acredita. A partir daí ele conclui que o pedido não existe.
 *
 * Só o "#" sai, e só da frente. Nome, e-mail e CPF passam intactos: normalizar
 * mais do que isso quebraria a busca por e-mail, que é o outro jeito de achar
 * alguém que ligou.
 */
export function normalizarBusca(bruto: string): string {
  return bruto.trim().replace(/^#+/, "").trim();
}

/**
 * O estado a partir da URL.
 *
 * VALOR DE STATUS DESCONHECIDO PASSA ADIANTE, e isso é escolha. O backend
 * recusa com `Status inválido: "delivered". Use um de: pendente, aprovado…` —
 * uma frase que diz o que fazer. Filtrar aqui em silêncio mostraria a lista
 * INTEIRA sem filtro nenhum, e é essa a mentira cara: o gestor lê "134 pedidos"
 * achando que está vendo os entregues. O mesmo vale para `de`/`ate` fora do
 * formato: a frase do servidor nomeia o parâmetro.
 *
 * A PÁGINA SAI DAQUI APENAS SANEADA (≥ 1). O aperto contra a última página que
 * existe acontece depois da resposta, em `estadoCorrigido`: antes dela não há
 * como saber quantas páginas há, e chutar faria a tela pedir uma página e
 * mostrar outra.
 */
export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosPedidos {
  const status = textoDoParametro(parametros.status)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    busca: textoDoParametro(parametros.q),
    status,
    de: textoDoParametro(parametros.de),
    ate: textoDoParametro(parametros.ate),
    // A validação é do CONTRATO do Bling, que é quem tem a lista das cinco
    // chaves. `?fila=sem_notas` (com "s") vira `""` — filtro desligado — em vez
    // de cair calado no primeiro filtro, que é o que `filtrarFila` faz com uma
    // chave que não conhece.
    fila: chaveDaFilaValida(textoDoParametro(parametros.fila)),
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * A consulta que vai para `GET /admin/orders`.
 *
 * `status` vai SEPARADO POR VÍRGULA porque é assim que o backend o lê
 * (`statusBruto.split(",")`) — a aba "Pagamento pendente" pergunta por três
 * status numa ida só, e sem isso ela faria três requisições e somaria os totais
 * no navegador, que é como um total passa a discordar da lista.
 *
 * `fila` NÃO ENTRA AQUI: não existe filtro de estado fiscal em `/admin/orders`.
 * Ele é aplicado sobre a página em `aplicarFiltroDePagina`, e a tela diz isso
 * por escrito — a mesma honestidade que a fila do Bling legada já pratica.
 *
 * `limit` é sempre explícito: o padrão do backend é 10, e uma tela que pagina
 * de 20 em 20 mostrando 10 linhas é uma tela que discorda do próprio rodapé.
 */
export function montarConsulta(estado: EstadoDosPedidos): string {
  return montarUrl("/admin/orders", {
    q: normalizarBusca(estado.busca) || undefined,
    status: estado.status.length ? estado.status.join(",") : undefined,
    de: estado.de || undefined,
    ate: estado.ate || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

/**
 * A URL desta tela para um estado — a "aba salva" do R2.
 *
 * `pagina: 1` é OMITIDA: é o valor padrão, e `?pagina=1` cria uma segunda URL
 * para a mesma tela — duas entradas no histórico e dois favoritos que o gestor
 * não sabe distinguir.
 *
 * NENHUM DADO PESSOAL ENTRA NA URL. É a ressalva explícita do R2: o que vai
 * para a barra de endereço é o que a pessoa DIGITOU na busca, nunca um campo do
 * RESULTADO. Esta tela não monta `?email=`, `?cpf=` nem `?cliente=`, e o link
 * para o detalhe leva o UUID do pedido — que é opaco — e nada mais.
 */
export function urlDaTela(estado: Partial<EstadoDosPedidos>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_PEDIDOS, {
    q: estado.busca?.trim() || undefined,
    status: estado.status?.length ? estado.status.join(",") : undefined,
    de: estado.de?.trim() || undefined,
    ate: estado.ate?.trim() || undefined,
    fila: estado.fila || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

/** A URL do detalhe em rota própria — o deep-link que `GET /admin/orders/:id`
 *  passou a permitir. Leva o UUID e nada mais. */
export function urlDoPedido(orderId: string): string {
  return `${ROTA_DE_PEDIDOS}/${orderId}`;
}

/**
 * O estado depois de ver a resposta — a página presa dentro do que existe.
 *
 * O CASO É O FAVORITO VELHO: `?pagina=9` num filtro que encolheu para duas
 * páginas. Sem isto a tela desenha "nenhum resultado para este filtro", que o
 * gestor lê como "o filtro não achou nada" e não como "esta página não existe".
 */
export function estadoCorrigido(
  estado: EstadoDosPedidos,
  total: number,
): EstadoDosPedidos {
  return {
    ...estado,
    pagina: paginaValida(estado.pagina, totalDePaginas(total, POR_PAGINA)),
  };
}

/**
 * Os chips do R3 — um por filtro ativo, cada um com o `href` que o REMOVE.
 *
 * "filtro esquecido é lido como 'sumiu meu pedido'". Nesta tela há quatro
 * dimensões de filtro, e um filtro de status herdado de uma aba salva é
 * invisível na barra de endereço — o gestor volta de outra tela, vê nove
 * pedidos onde havia mil e conclui que o painel perdeu dados.
 *
 * TODO `href` DE REMOÇÃO ZERA A PÁGINA. Tirar um filtro estando na página 4 e
 * continuar na 4 é o jeito mais rápido de uma lista sem filtro parecer vazia.
 */
export function chipsDosPedidos(estado: EstadoDosPedidos): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  const semPagina = { ...estado, pagina: 1 };

  if (estado.busca) {
    chips.push({
      chave: "q",
      dimensao: "Busca",
      // O que a PESSOA digitou, não o normalizado: ela precisa reconhecer o
      // próprio texto para saber o que está removendo.
      valor: estado.busca,
      href: urlDaTela({ ...semPagina, busca: "" }),
    });
  }

  if (estado.status.length) {
    chips.push({
      chave: "status",
      dimensao: "Status",
      // Os RÓTULOS, nunca os valores: `em_processamento` é vocabulário de
      // banco. `rotuloDoStatus` devolve o próprio valor quando não conhece,
      // então um status novo do backend aparece cru em vez de sumir.
      valor: estado.status.map(rotuloDoStatus).join(", "),
      href: urlDaTela({ ...semPagina, status: [] }),
    });
  }

  if (estado.de || estado.ate) {
    chips.push({
      chave: "periodo",
      dimensao: "Período",
      valor: textoDoPeriodo(estado.de, estado.ate),
      href: urlDaTela({ ...semPagina, de: "", ate: "" }),
    });
  }

  if (estado.fila) {
    chips.push({
      chave: "fila",
      dimensao: "No Bling",
      /* O RÓTULO VEM DO CONTRATO, e não é escrito de novo aqui: o chip precisa
         dizer a mesma palavra que o botão que o ligou, senão o gestor não
         reconhece o filtro que ele mesmo escolheu. */
      valor: filtroDaFila(estado.fila)?.rotulo ?? estado.fila,
      href: urlDaTela({ ...semPagina, fila: "" }),
    });
  }

  return chips;
}

/**
 * O período em português — para o chip e para a confirmação da exportação.
 *
 * As datas saem em dd/mm/aaaa (R31) sem passar por `Date`: `de` e `ate` já são
 * RÓTULOS DE CALENDÁRIO que o backend recorta com `AT TIME ZONE`, e construir
 * um `Date` a partir de "2026-08-26" para reformatá-lo é justamente como se
 * perde um dia — o parser lê meia-noite UTC, que em São Paulo ainda é o dia 25.
 */
export function textoDoPeriodo(de: string, ate: string): string {
  const br = (dia: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return dia;
    return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
  };
  if (de && ate) return `${br(de)} a ${br(ate)}`;
  if (de) return `de ${br(de)}`;
  if (ate) return `até ${br(ate)}`;
  return "";
}

/** Há filtro ligado? É o que decide qual dos três estados vazios o R16 mostra. */
export function temFiltro(estado: EstadoDosPedidos): boolean {
  return Boolean(
    estado.busca || estado.status.length || estado.de || estado.ate || estado.fila,
  );
}

/**
 * AS ABAS SALVAS — R4, e a razão de elas existirem é que uma tela de lista sem
 * elas obriga o gestor a remontar o mesmo filtro toda manhã.
 *
 * Cada uma é uma URL DE VERDADE com o filtro aplicado (`urlDaAba`), não um
 * estado de componente: dá para favoritar, dá para colar no WhatsApp para o
 * conferente, e o botão Voltar funciona. É o R2 pagando o R4.
 *
 * A ORDEM É A DO DIA DE TRABALHO. Primeiro o que sai hoje pela porta, depois o
 * dinheiro que ainda não entrou, depois a pendência fiscal — que é a que o
 * gestor descobre tarde.
 */
export type AbaSalva = {
  chave: string;
  rotulo: string;
  /** O que a aba liga. O resto do estado (busca, período) é zerado ao clicar. */
  filtro: Pick<EstadoDosPedidos, "status" | "fila">;
  /** A frase que explica o recorte — some a dúvida sobre o que a aba mostra. */
  ajuda: string;
};

export const ABAS_SALVAS: AbaSalva[] = [
  {
    chave: "todos",
    rotulo: "Todos",
    filtro: { status: [], fila: "" },
    ajuda: "Todos os pedidos, do mais novo para o mais antigo.",
  },
  {
    chave: "despachar",
    rotulo: "A despachar",
    // `aprovado` é o único status que significa "o dinheiro entrou e a caixa
    // ainda não saiu". `enviado` já saiu, `entregue` já chegou.
    filtro: { status: ["aprovado"], fila: "" },
    ajuda: "Pagamento confirmado e ainda não despachado — é a fila da expedição.",
  },
  {
    chave: "pagamento",
    rotulo: "Pagamento pendente",
    // Os três estados em que o dinheiro AINDA NÃO É DA LOJA: PIX não pago,
    // cartão em análise e cartão autorizado sem captura.
    filtro: { status: ["pendente", "em_processamento", "autorizado"], fila: "" },
    ajuda:
      "O dinheiro ainda não entrou: PIX não pago, pagamento em análise ou " +
      "cartão apenas autorizado.",
  },
  {
    chave: "nfe",
    rotulo: "Aguardando NF-e",
    // Só pedido PAGO vai ao ERP (`STATUS_QUE_SINCRONIZAM` do contrato do
    // Bling) — pedir nota de venda não confirmada seria imposto provisionado
    // de uma venda que ainda pode morrer.
    filtro: { status: ["aprovado", "enviado", "entregue"], fila: "sem_nota" },
    ajuda:
      "Pedido pago sem nota autorizada pela SEFAZ. Este recorte olha só a " +
      "página carregada — o servidor ainda não filtra por NF-e.",
  },
];

/** A URL de uma aba. Zera busca, período e página: a aba é um ponto de
 *  partida, e herdar a busca anterior faria a aba parecer vazia. */
export function urlDaAba(aba: AbaSalva): string {
  return urlDaTela({ ...ESTADO_VAZIO, ...aba.filtro });
}

/**
 * Qual aba está acesa — e por que ela ignora busca, período e página.
 *
 * A aba descreve o RECORTE (que status, com ou sem nota). Buscar por "Maria"
 * dentro de "A despachar" continua sendo "A despachar" com uma busca por cima:
 * apagar a aba nesse momento faria a tela dizer que o gestor saiu de onde ele
 * não saiu, e é aí que se perde a noção do filtro ligado.
 */
export function abaAtiva(estado: EstadoDosPedidos): string | null {
  const mesma = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();

  const achada = ABAS_SALVAS.find(
    (aba) => mesma(aba.filtro.status, estado.status) && aba.filtro.fila === estado.fila,
  );
  return achada ? achada.chave : null;
}

/**
 * O ENDEREÇO DE ENTREGA, formatado — com os fallbacks do legado intactos.
 *
 * `endereco_json` é `jsonb`, e em pedidos anteriores à loja nova ele NÃO é
 * objeto (é texto solto, ou nulo). Um `addr.street` ali dentro lança e derruba
 * a tela inteira de detalhe; por isso a guarda vem antes de qualquer leitura.
 *
 * Os fallbacks por campo ("Rua não inf.", "S/N") são os do legado e ficam: um
 * endereço com o número faltando ainda é entregável, e apagar a linha inteira
 * por causa de um campo vazio esconderia o resto do endereço de quem precisa
 * despachar.
 */
export function enderecoDoPedido(address: unknown): string {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return "Endereço não disponível (pedido antigo).";
  }
  const a = address as Record<string, unknown>;
  const t = (chave: string) => String(a[chave] ?? "").trim();

  const rua = t("street") || "Rua não inf.";
  const numero = t("number") || "S/N";
  const bairro = t("neighborhood");
  const cidade = t("city");
  const uf = t("state");
  const cep = t("zip_code");

  return `${rua}, ${numero} - ${bairro}, ${cidade} - ${uf} (CEP: ${cep})`;
}

/** Um item do pedido, como o carrinho o congelou. Todos os campos são
 *  opcionais: é uma FOTOGRAFIA de um produto que pode já nem existir. */
export type ItemDoPedido = {
  name?: string;
  size?: string;
  sku?: string;
  quantity?: number;
  /** REAIS — é o preço unitário congelado na venda. */
  price?: string | number;
};

/**
 * OS ITENS, que às vezes são array e às vezes são string JSON.
 *
 * O legado já tratava as duas formas, e a razão é histórica: pedidos gravados
 * antes de a coluna virar `jsonb` guardaram texto. O `catch` devolve `[]` em
 * vez de deixar o `JSON.parse` derrubar a tela.
 *
 * A DIFERENÇA PARA O LEGADO: ele devolvia o resultado do `parse` fosse ele o
 * que fosse, então um `"{}"` gravado por engano virava um objeto onde a tela
 * esperava lista, e o `.map` logo abaixo lançava. Aqui só array passa.
 */
export function lerItens(items: unknown): ItemDoPedido[] {
  if (Array.isArray(items)) return items as ItemDoPedido[];
  if (typeof items === "string") {
    try {
      const lido = JSON.parse(items);
      return Array.isArray(lido) ? (lido as ItemDoPedido[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Quantas unidades o pedido tem ao todo — o número que decide se cabe numa
 *  caixa ou em três. `quantity` ausente conta como 1, que é o que o carrinho
 *  gravava antes de o campo existir. */
export function totalDeUnidades(items: unknown): number {
  return lerItens(items).reduce((soma, item) => {
    const n = Number(item.quantity);
    return soma + (Number.isFinite(n) && n > 0 ? n : 1);
  }, 0);
}

/**
 * O TOM DE CADA ESTADO DO BLING — a tradução das cores hexadecimais do contrato
 * para os tokens da casa, e o único lugar onde ela acontece.
 *
 * `estadoDoBling` carrega `cor: "#00796b"` desde que era `blingContrato.js`, e
 * essas cores são de outro sistema (o material design do painel legado). O
 * contrato NÃO foi tocado — a instrução da pesquisa é literal: "portar como
 * está; só as cores hexadecimais viram tokens Tailwind". Então a tradução mora
 * aqui, indexada pela `chave`, que é estável e testada lá.
 *
 * DUAS ESCOLHAS QUE NÃO SÃO ÓBVIAS, e as duas são sobre não gritar à toa:
 *
 * `nota_pendente` É O ÚNICO ALERTA. É o estado que a pesquisa nomeia como "o
 * que mais precisa de destaque porque PARECE resolvido e não está": existe
 * número de nota, o gestor lê "NF-e 1234" e conclui que saiu — e ela nunca
 * chegou à SEFAZ.
 *
 * `nao_sincronizado` É NEUTRO, e não alerta. Em produção `BLING_ATIVO` está
 * desligado (o checklist de go-live tem todos os itens do Bling desmarcados),
 * então TODO pedido está neste estado. Pintar a coluna inteira de alerta
 * ensinaria, em uma manhã, que aquela coluna se ignora — e aí o alerta de
 * verdade, o de cima, some junto.
 */
const BLING_POR_CHAVE: Record<string, { tom: TomDeStatus; curto: string }> = {
  com_nota: { tom: "sucesso", curto: "NF-e emitida" },
  nota_pendente: { tom: "alerta", curto: "Não transmitida" },
  sincronizando: { tom: "neutro", curto: "Sincronizando" },
  sincronizado: { tom: "neutro", curto: "No Bling" },
  nao_sincronizado: { tom: "neutro", curto: "Sem nota" },
};

export function tomDoBling(chave: string): TomDeStatus {
  return BLING_POR_CHAVE[chave]?.tom ?? "neutro";
}

/** O rótulo curto, para a coluna da lista. O longo (`estadoDoBling().rotulo`,
 *  com número de nota e id do Bling) fica no detalhe, onde há largura. */
export function rotuloCurtoDoBling(chave: string): string {
  return BLING_POR_CHAVE[chave]?.curto ?? "—";
}

/**
 * O RECORTE FISCAL, APLICADO SOBRE A PÁGINA — e a honestidade que ele exige.
 *
 * `GET /admin/orders` filtra por status, período e busca, e NÃO por estado
 * fiscal: não existe `?fila=` do lado do servidor. Fazer a pergunta em memória é
 * o que a fila do Bling legada já faz, e ela DIZ isso na tela ("o filtro olha só
 * a página carregada"). Esconder a ressalva seria pior que não ter o filtro: o
 * gestor leria "3 pedidos aguardando NF-e" e despacharia o mês achando que
 * acabou.
 *
 * QUEM RESPONDE É `filtrarFila`, DO CONTRATO, e não uma função daqui. Havia uma
 * — `filtrarNfePendente` —, e ela era a quinta cópia de uma pergunta que o
 * contrato já fazia: `filtrarFila(linhas, "sem_nota")` dá exatamente o mesmo
 * resultado (`estadoDoBling().chave !== "com_nota"` é `!nfe_chave`, que é o
 * `aceita` daquele filtro), com os mesmos pedidos pagos primeiro. Delegar ganha
 * de graça os outros quatro recortes, que estavam escritos e testados no
 * contrato sem nenhum consumidor.
 *
 * FILTRO DESLIGADO PASSA A LISTA INTACTA, e isso NÃO é o mesmo que "todos": o
 * filtro "todos" da fila é "todos os pedidos PAGOS", e desligado é a lista do
 * servidor inteira, com a ordem que ele mandou — que é a ordem em que o gestor
 * pensa nos pedidos.
 */
export function aplicarFiltroDePagina(
  linhas: PedidoDoPainel[],
  estado: EstadoDosPedidos,
): PedidoDoPainel[] {
  if (!estado.fila) return linhas;
  return filtrarFila(
    linhas as unknown as Record<string, unknown>[],
    estado.fila,
  ) as unknown as PedidoDoPainel[];
}

/**
 * A frase que confessa o recorte em memória — copiada da fila do Bling, que já
 * paga esse preço e o diz com número.
 *
 * Ela existe porque a paginação do rodapé passa a mentir quando o filtro é de
 * página: "1–20 de 134" continua correto para o SERVIDOR e falso para o que
 * está na tela. Duas contagens que discordam sem explicação fazem o gestor
 * desconfiar das duas.
 */
export function resumoDaPaginaFiltrada(
  mostrados: number,
  naPagina: number,
  pagina: number,
  totalPaginas: number,
  total: number,
): string {
  return (
    `${mostrados} de ${naPagina} pedidos desta página · ` +
    `página ${pagina} de ${totalPaginas} (${total} no total)`
  );
}

/**
 * MUDAR PARA "ENVIADO" PEDE O CÓDIGO DE RASTREIO — e não é validação, é fluxo.
 *
 * O legado abria um `window.prompt` aqui, e a versão anterior a ele mandava
 * direto sem perguntar. O código VAZIO segue vazio de propósito: entrega local
 * (a loja entrega na região) não tem código, e obrigar um valor faria o gestor
 * inventar um.
 */
export function precisaDeRastreio(status: string): boolean {
  return status === "enviado";
}

/**
 * OS STATUS QUE PODEM IR EM LOTE — e o que fica de fora, com o motivo.
 *
 * `enviado` NÃO entra: ele carrega um código de rastreio POR PEDIDO, e um lote
 * gravaria o mesmo código em vinte encomendas diferentes. O cliente receberia
 * um e-mail com o rastreio de outra pessoa — que é pior do que não receber
 * e-mail nenhum, e não tem desfazer.
 */
export const STATUS_EM_LOTE = STATUS_DE_PEDIDO.filter(
  (s) => !precisaDeRastreio(s.valor),
);

/**
 * O QUE A SELEÇÃO ALCANÇA, POR ESCRITO — R25.
 *
 * "senão o lojista acha que arquivou 1.284 quando arquivou 50". A caixa do
 * cabeçalho marca A PÁGINA, e nada mais: não existe rota de lote no backend, e
 * uma opção de "marcar os 1.284 do filtro" que depois agisse sobre vinte seria
 * exatamente a mentira que o R25 nomeia. Por isso ela não é oferecida — e a
 * frase abaixo diz, com número, o tamanho da diferença.
 */
export function resumoDaSelecao(
  marcados: number,
  naPagina: number,
  totalDoFiltro: number,
): string {
  if (marcados <= 0) return "";
  if (marcados < naPagina) {
    return `${marcados} de ${naPagina} pedidos desta página marcados.`;
  }
  if (totalDoFiltro > naPagina) {
    return (
      `Os ${naPagina} pedidos desta página estão marcados — o filtro tem ` +
      `${totalDoFiltro}. A ação alcança só os ${marcados} marcados.`
    );
  }
  return `Os ${marcados} pedidos do filtro estão marcados.`;
}

/**
 * A CONFIRMAÇÃO DA MUDANÇA EM LOTE — R11/R12: o texto nomeia o objeto e a
 * consequência, e "Tem certeza?" não carrega informação nenhuma.
 *
 * As três consequências estão aqui porque nenhuma delas é óbvia olhando o
 * botão: mudar status MOVIMENTA ESTOQUE (o backend devolve ou rebaixa dentro da
 * transação), DISPARA E-MAIL para cada cliente, e não tem desfazer — voltar o
 * status movimenta o estoque de novo e manda outro e-mail.
 */
export function avisoDoLote(quantos: number, status: string): string {
  const plural = quantos === 1 ? "pedido" : "pedidos";
  return (
    `Mudar ${quantos} ${plural} para "${rotuloDoStatus(status)}". ` +
    "Cada um movimenta estoque e envia e-mail ao cliente. Não há como desfazer."
  );
}

/**
 * O placar de um lote — o que o gestor lê quando parte deu certo e parte não.
 *
 * A CONTAGEM É A REAL, nunca a pedida. É a mesma lição que o `PATCH` em lote de
 * avaliações registra: dizer "20 atualizados" depois de 3 falharem é mentir
 * sobre a única coisa que a tela existe para informar. E as frases das falhas
 * vêm junto porque elas SÃO o diagnóstico ("Status inválido…", "Pedido não
 * encontrado").
 */
export function resumoDoLote(
  atualizados: number,
  falhas: { numero: string; frase: string }[],
): string {
  const total = atualizados + falhas.length;
  if (falhas.length === 0) {
    return `${atualizados} de ${total} pedidos atualizados.`;
  }
  const lista = falhas.map((f) => `#${f.numero}: ${f.frase}`).join(" · ");
  return `${atualizados} de ${total} pedidos atualizados. ${falhas.length} falharam — ${lista}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   A EXPORTAÇÃO

   Três coisas se decidem aqui, e as três já custaram caro nesta loja: se a
   exportação precisa de confirmação, o que ela leva no arquivo, e como o
   arquivo se chama.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * SEM PERÍODO, PRECISA DE CONFIRMAÇÃO — e a cerca é do backend, não da tela.
 *
 * `GET /admin/orders/export` recusa com 400 e frase quando não há `de` nem
 * `ate` e falta `confirmar=true`. A tela desenha a confirmação para que o
 * gestor entenda o que está aceitando; a cerca vale mesmo para quem chamar a
 * rota por `curl`, que é o motivo de ela morar lá.
 */
export function exportacaoExigeConfirmacao(de: string, ate: string): boolean {
  return !de.trim() && !ate.trim();
}

/**
 * O AVISO DA CONFIRMAÇÃO — e ele diz QUANTAS LINHAS e O QUE VAI DENTRO.
 *
 * "com CPF e e-mail de todos os clientes" não é retórica: são duas das catorze
 * colunas de `csvDePedidos.js`, e a memória deste projeto já registra CSVs de
 * dados pessoais parados no histórico do Git. Um botão que baixa a base inteira
 * sem dizer isso é um vazamento esperando um clique distraído.
 *
 * `linhas` é `null` quando a contagem não pôde ser feita — e aí a frase diz
 * isso em vez de inventar um número. Um "0 pedidos" por falha de rede
 * convenceria o gestor de que o arquivo é inofensivo.
 */
export function avisoDaExportacao(linhas: number | null): string {
  const quantos =
    linhas === null
      ? "Não foi possível contar quantos pedidos entram"
      : `São ${linhas} ${linhas === 1 ? "pedido" : "pedidos"}`;
  return (
    `${quantos}, e o arquivo leva nome, e-mail e CPF de cada cliente. ` +
    "Guarde-o fora de pastas compartilhadas e apague quando terminar."
  );
}

/** A consulta da exportação. `confirmar` só é enviado quando é verdade — um
 *  `confirmar=false` na URL seria ruído com cara de decisão. */
export function consultaDaExportacao({
  de,
  ate,
  confirmar,
}: {
  de: string;
  ate: string;
  confirmar: boolean;
}): string {
  return montarUrl("/admin/orders/export", {
    de: de.trim() || undefined,
    ate: ate.trim() || undefined,
    confirmar: confirmar ? "true" : undefined,
  });
}

/**
 * A consulta que CONTA quantos pedidos a exportação alcançaria.
 *
 * É a listagem com `limit=1`: o que interessa é o `total`, e pedir uma linha
 * traz a contagem sem carregar a base com CPF dentro no navegador de quem só
 * queria saber o tamanho. O período é o MESMO da exportação — sem status e sem
 * busca, porque a rota do CSV também não os aceita (ver `RESSALVA_DA_EXPORTACAO`).
 */
export function consultaDaContagem({ de, ate }: { de: string; ate: string }): string {
  return montarUrl("/admin/orders", {
    de: de.trim() || undefined,
    ate: ate.trim() || undefined,
    page: 1,
    limit: 1,
  });
}

/**
 * A RESSALVA QUE O R27 OBRIGA A ESCREVER.
 *
 * R27: "exportação espelha filtro e colunas — exportar ignorando o filtro faz
 * concluir que o painel perdeu dados". Só que `GET /admin/orders/export` aceita
 * `de` e `ate` e MAIS NADA: status e busca não vão. Um botão "Exportar" ao lado
 * de um filtro de status ligado entregaria um arquivo com a base inteira, e o
 * gestor abriria o Excel achando que tem os entregues do mês.
 *
 * Não dá para consertar daqui — é rota do backend, e está relatado. O que dá
 * para fazer é a tela não mentir.
 */
export const RESSALVA_DA_EXPORTACAO =
  "A exportação leva só o período. O filtro de status, a busca e o recorte de " +
  "NF-e não vão para o arquivo — o servidor ainda não os aceita nesta rota.";

/**
 * O NOME DO ARQUIVO — a mesma fórmula do backend, de propósito.
 *
 * `OrderController.exportOrdersCsv` monta `pedidos-de-AAAA-MM-DD-ate-AAAA-MM-DD.csv`
 * e o manda no `Content-Disposition`. O navegador NÃO o alcança: a resposta vem
 * de outra origem e `Content-Disposition` não está em `exposedHeaders` do CORS,
 * então `res.headers.get(...)` devolve `null`. Como o download é por blob (a
 * rota exige `Authorization`, e um `<a href>` chegaria sem token e voltaria
 * 401), quem nomeia o arquivo é esta função.
 *
 * Ela repete a fórmula do servidor para que os dois arquivos — o baixado pela
 * tela e o baixado por `curl` — tenham o MESMO nome. Um teste compara as duas
 * fórmulas lendo o controller do disco.
 */
export function nomeDoArquivoCsv(de: string, ate: string): string {
  const sufixo = [de.trim() ? `de-${de.trim()}` : null, ate.trim() ? `ate-${ate.trim()}` : null]
    .filter(Boolean)
    .join("-");
  return sufixo ? `pedidos-${sufixo}.csv` : "pedidos.csv";
}
