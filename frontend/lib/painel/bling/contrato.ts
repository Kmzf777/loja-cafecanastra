/**
 * O contrato do Bling visto do painel — SEM React, SEM fetch.
 *
 * Este módulo existe separado do hook por um motivo prático: é aqui que mora
 * a lógica que decide o que o gestor LÊ (em que estado o pedido está no ERP,
 * quais botões fazem sentido, que frase mostrar quando o servidor recusa), e
 * essa lógica é a única parte desta tela que dá para testar sem navegador.
 * `contrato.test.ts` exercita tudo o que está aqui.
 *
 * As duas superfícies que consomem isto — a tela `/dashboard/legado/bling` e o
 * modal de detalhe de `Orders.jsx` — mostram exatamente a mesma verdade porque
 * derivam dela do mesmo lugar.
 */

/**
 * A linha de pedido como este módulo a recebe — DELIBERADAMENTE ABERTA.
 *
 * O painel lê pedidos de duas rotas com projeções diferentes (`/admin/orders`
 * traz `address`, `user_name`, `user_email` e `user_cpf`; `/bling` traz
 * `address_json` e nada do cliente), e a resposta de uma ação do Bling é
 * parcial por natureza. Fechar a forma aqui obrigaria a declarar dois
 * contratos e a mantê-los sincronizados com o backend à mão — e o compilador
 * passaria a recusar exatamente o caso que `mesclarPedido` existe para tratar.
 *
 * Este arquivo veio de `legacy/.../Bling/blingContrato.js` por `git mv`, e a
 * conversão para TypeScript acrescentou ANOTAÇÃO e nada mais: nenhuma função
 * mudou de nome, nenhuma pergunta de `estadoDoBling` mudou de ordem, e a lista
 * congelada de `mesclarPedido` continua sendo lista.
 */
export type PedidoDoPainel = Record<string, unknown>;

/**
 * As três ações de `backend/src/routes/bling.routes.js`, na ordem em que o
 * fluxo real acontece: primeiro o pedido de venda existe no ERP, depois a
 * nota sai dele, e só então há rastreio para buscar.
 *
 * `precisaDeSincronia` é o que apaga o botão que não faria nada: buscar
 * rastreio de um pedido que nunca foi ao Bling é uma ida garantida ao erro.
 * (Emitir NF-e NÃO precisa: a rota sincroniza antes, se for o caso — está no
 * §6 de docs/bling.md.)
 */
export const ACOES_BLING = Object.freeze([
  Object.freeze({
    chave: "sincronizar",
    rotulo: "Sincronizar",
    rotuloOcupado: "Sincronizando…",
    caminho: (id: string) => `/bling/pedidos/${id}/sincronizar`,
    precisaDeSincronia: false,
    titulo: "Cria (ou confere) o pedido de venda no Bling. Não duplica.",
  }),
  Object.freeze({
    chave: "nfe",
    rotulo: "Emitir NF-e",
    rotuloOcupado: "Emitindo…",
    caminho: (id: string) => `/bling/pedidos/${id}/nfe`,
    precisaDeSincronia: false,
    titulo:
      "Gera a nota do pedido de venda e transmite à SEFAZ. Se a nota já foi " +
      "gerada e não transmitida, retransmite a MESMA.",
  }),
  Object.freeze({
    chave: "rastreio",
    rotulo: "Buscar rastreio",
    rotuloOcupado: "Buscando…",
    caminho: (id: string) => `/bling/pedidos/${id}/rastreio`,
    precisaDeSincronia: true,
    titulo:
      "Lê o rastreio no pedido de venda do Bling; com código lá, grava aqui, " +
      "marca como enviado e avisa o cliente por e-mail.",
  }),
]);

/** A ação pela chave — para quem tem só a string na mão. */
export const acaoBling = (chave: string) =>
  ACOES_BLING.find((a) => a.chave === chave) || null;

/**
 * Os status da LOJA em que um pedido pode ir ao ERP — cópia local de
 * `STATUS_QUE_SINCRONIZAM` (backend/src/services/blingPedidos.js), pela mesma
 * lente do `STATUS_DO_PEDIDO` de Orders.jsx: o vocabulário é do backend, a
 * cópia é para a tela não oferecer o que o servidor vai recusar com 409.
 *
 * Venda não paga não vira pedido de venda: seria estoque baixado e imposto
 * provisionado de uma venda que ainda pode morrer.
 */
export const STATUS_QUE_SINCRONIZAM = Object.freeze([
  "aprovado",
  "enviado",
  "entregue",
]);

export const pedidoPodeIrAoBling = (pedido?: PedidoDoPainel | null): boolean =>
  // O `as string` é só para o compilador: `includes` de um valor ausente já
  // devolve false, que é a resposta certa para pedido nenhum.
  STATUS_QUE_SINCRONIZAM.includes(pedido?.status as string);

/**
 * O estado do pedido DENTRO do Bling, derivado dos campos que
 * `GET /admin/orders` traz (migração 0012).
 *
 * A ordem das perguntas é a ordem da vida do documento fiscal, e a única que
 * não mente:
 *
 *   1. `nfe_chave` — a chave de acesso só existe DEPOIS de a SEFAZ autorizar.
 *      É ela, e não o número, que carimba "emitida" (é o critério do próprio
 *      backend para responder "já emitida").
 *   2. `nfe_numero` sem chave — a nota foi GERADA no Bling e NÃO transmitida:
 *      o caso do §7 do runbook, quase sempre configuração fiscal faltando. É
 *      o estado que mais precisa de destaque, porque parece resolvido e não
 *      está: existe nota lá, pendente, e a retentativa retransmite a mesma.
 *   3. `bling_situacao === 'sincronizando'` — é o CLAIM da idempotência em
 *      voo (não é situação do Bling): alguém está criando o pedido de venda
 *      agora. Clicar de novo não duplica, mas também não adianta.
 *   4. `bling_id` — existe pedido de venda lá.
 *   5. nada — nunca foi.
 *
 * As cores são as de `getStatusColor` em Orders.jsx: o painel inteiro fala a
 * mesma língua de cor.
 */
export function estadoDoBling(pedido?: PedidoDoPainel | null) {
  const p: PedidoDoPainel = pedido || {};

  if (p.nfe_chave) {
    return {
      chave: "com_nota",
      rotulo: p.nfe_numero ? `NF-e ${p.nfe_numero}` : "NF-e emitida",
      detalhe: "Nota autorizada pela SEFAZ.",
      cor: "#00796b",
    };
  }

  if (p.nfe_numero) {
    return {
      chave: "nota_pendente",
      rotulo: `NF-e ${p.nfe_numero} não transmitida`,
      detalhe:
        "A nota foi gerada no Bling mas não chegou à SEFAZ. Corrija a " +
        "configuração fiscal e emita de novo — retransmite a mesma nota.",
      cor: "#f57c00",
    };
  }

  if (p.bling_situacao === "sincronizando") {
    return {
      chave: "sincronizando",
      rotulo: "Sincronizando…",
      detalhe:
        "O pedido de venda está sendo criado no Bling agora. Se ficar assim " +
        "por mais de dez minutos, clique em Sincronizar de novo.",
      cor: "#7b1fa2",
    };
  }

  if (p.bling_id) {
    return {
      chave: "sincronizado",
      rotulo: `Pedido ${p.bling_id}`,
      detalhe: p.bling_situacao
        ? `No Bling como "${p.bling_situacao}". Sem NF-e emitida.`
        : "No Bling, sem NF-e emitida.",
      cor: "#1976d2",
    };
  }

  return {
    chave: "nao_sincronizado",
    rotulo: "Não sincronizado",
    detalhe: "Este pedido ainda não existe no Bling.",
    cor: "#b3261e",
  };
}

/**
 * Os filtros da fila, na ordem em que o gestor trabalha: o que está pendente
 * primeiro. Cada um é uma pergunta sobre UMA linha — a fila aplica em cima do
 * que a página trouxe (ver o comentário de paginação no BlingManager).
 */
export const FILTROS_DA_FILA = Object.freeze([
  Object.freeze({
    chave: "pendentes",
    rotulo: "Pendentes no Bling",
    vazio: "Nenhum pedido pago esperando o Bling nesta página.",
    aceita: (p: PedidoDoPainel) => {
      const estado = estadoDoBling(p).chave;
      return estado !== "com_nota" || !p.tracking_code;
    },
  }),
  Object.freeze({
    chave: "sem_pedido",
    rotulo: "Sem pedido de venda",
    vazio: "Todos os pedidos pagos desta página já estão no Bling.",
    aceita: (p: PedidoDoPainel) => !p.bling_id,
  }),
  Object.freeze({
    chave: "sem_nota",
    rotulo: "Sem NF-e autorizada",
    vazio: "Nenhuma nota pendente nesta página.",
    aceita: (p: PedidoDoPainel) => !p.nfe_chave,
  }),
  Object.freeze({
    chave: "sem_rastreio",
    rotulo: "Sem rastreio",
    vazio: "Todos os pedidos pagos desta página já têm rastreio.",
    aceita: (p: PedidoDoPainel) => !p.tracking_code,
  }),
  Object.freeze({
    chave: "todos",
    rotulo: "Todos os pedidos pagos",
    vazio: "Nenhum pedido pago nesta página.",
    aceita: () => true,
  }),
]);

/**
 * As chaves da fila como TIPO — porque agora elas viajam na URL.
 *
 * A tela de Pedidos guarda o recorte fiscal em `?fila=`, e um `string` solto ali
 * deixaria `?fila=sem_notas` (com "s") virar silenciosamente o filtro padrão:
 * `filtrarFila` cai no primeiro quando não reconhece a chave, e a tela mostraria
 * um recorte que ninguém pediu, com o chip dizendo outra coisa.
 *
 * A união é ESCRITA À MÃO, e não derivada de `FILTROS_DA_FILA`: as entradas são
 * `Object.freeze` de objetos literais, e o TypeScript alarga `chave` para
 * `string` sem um `as const` que mudaria a forma congelada do contrato inteiro.
 * O preço é uma lista que pode divergir da outra, e por isso há um teste que
 * compara as duas — quem acrescentar um filtro e esquecer o tipo vê vermelho.
 */
export type ChaveDaFila =
  | "pendentes"
  | "sem_pedido"
  | "sem_nota"
  | "sem_rastreio"
  | "todos";

/**
 * A chave que veio da URL, ou `""` quando não é nenhuma das cinco.
 *
 * Mora AQUI, e não em `pedidos.logica.ts`, porque quem sabe o vocabulário é
 * quem tem a lista: uma segunda cópia das cinco chaves do outro lado da casa é
 * exatamente a divergência que este módulo existe para não ter (ver o
 * comentário de abertura sobre as três cópias de `STATUS_DO_PEDIDO`).
 */
export function chaveDaFilaValida(bruto: unknown): ChaveDaFila | "" {
  const achada = FILTROS_DA_FILA.find((f) => f.chave === bruto);
  return achada ? (achada.chave as ChaveDaFila) : "";
}

/** O filtro pela chave, para quem precisa do rótulo ou da frase de vazio. */
export function filtroDaFila(chave: string) {
  return FILTROS_DA_FILA.find((f) => f.chave === chave) ?? null;
}

/**
 * A fila: só pedidos PAGOS (os outros o backend recusaria) e só os que passam
 * pelo filtro escolhido. A ordem que veio do servidor (mais novo primeiro) é
 * preservada — é a ordem em que o gestor pensa nos pedidos.
 */
export function filtrarFila(
  pedidos: PedidoDoPainel[] | null | undefined,
  chaveDoFiltro: string,
): PedidoDoPainel[] {
  const filtro =
    FILTROS_DA_FILA.find((f) => f.chave === chaveDoFiltro) ||
    FILTROS_DA_FILA[0];
  return (Array.isArray(pedidos) ? pedidos : [])
    .filter(pedidoPodeIrAoBling)
    .filter((p) => filtro.aceita(p));
}

/**
 * Os campos que uma resposta de ação atualiza na linha da lista.
 *
 * Mesclar campo a campo, e não `{ ...linha, ...pedido }`, é deliberado: a
 * linha do admin traz `address`, `user_name`, `user_email`, `user_cpf` — que
 * a resposta de `/bling` NÃO tem (ela projeta `address_json` e nenhum dado do
 * cliente). Um spread cego funcionaria hoje por acaso e passaria a apagar
 * coluna da tabela no dia em que os dois contratos divergirem mais um pouco.
 *
 * `status` e `tracking_code` estão na lista porque a busca de rastreio MUDA os
 * dois (o pedido avança para `enviado` com o código): sem eles a linha diria
 * "Aprovado" logo depois de o e-mail de envio ter saído.
 */
export const CAMPOS_ATUALIZADOS_PELO_BLING = Object.freeze([
  "bling_id",
  "bling_situacao",
  "bling_sincronizado_em",
  "nfe_numero",
  "nfe_chave",
  "nfe_url",
  "status",
  "tracking_code",
  "updated_at",
]);

export function mesclarPedido(
  linha: PedidoDoPainel,
  pedido?: PedidoDoPainel | null,
): PedidoDoPainel {
  if (!pedido || typeof pedido !== "object") return linha;
  const proxima = { ...linha };
  for (const campo of CAMPOS_ATUALIZADOS_PELO_BLING) {
    if (campo in pedido) proxima[campo] = pedido[campo];
  }
  return proxima;
}

/**
 * A FRASE QUE O GESTOR LÊ QUANDO O SERVIDOR RECUSA — e a razão de este módulo
 * existir.
 *
 * As rotas de `/bling` respondem `{ error: "CÓDIGO", message: "frase" }`: o
 * `error` é código de máquina (`BLING_DESLIGADO`, `PEDIDO_REDIGIDO`), o
 * `message` é português escrito PARA ESTA TELA — "a integração está desligada
 * (BLING_ATIVO)... passo a passo em docs/bling.md", "SKU tal não está
 * cadastrado no Bling", "nota gerada mas não transmitida — retransmita pelo
 * painel do Bling". Substituí-las por "Erro ao sincronizar" jogaria fora o
 * diagnóstico inteiro e mandaria o gestor abrir chamado por algo que ele
 * resolve sozinho em dois minutos.
 *
 * Por isso `message` vem primeiro. `error` é a segunda escolha só porque o
 * RESTO do painel usa `{ error: "frase" }` (é o formato de
 * `/admin/orders/:id/status`) e um 401/403 do middleware chega assim. O
 * fallback por status só existe para o corpo ilegível (proxy no meio, HTML de
 * erro do nginx) — e mesmo aí diz algo útil.
 */
export function fraseDeErro(
  status: number,
  corpo?: Record<string, unknown> | null,
): string {
  const doServidor =
    corpo && typeof corpo === "object"
      ? corpo.message || corpo.error
      : null;
  // Um código cru ("BLING_FALHOU") não é frase: se for só isso que veio, o
  // fallback por status explica mais.
  if (typeof doServidor === "string" && /\s/.test(doServidor.trim())) {
    return doServidor.trim();
  }

  switch (status) {
    case 401:
      return "Sua sessão expirou. Entre de novo no painel.";
    case 403:
      return "Esta ação é de administrador — sua conta não tem esse papel.";
    case 404:
      return (
        "O servidor não conhece esta rota do Bling (/bling). Confira se a " +
        "API foi atualizada — veja docs/bling.md."
      );
    case 503:
      return (
        "A integração com o Bling está desligada (BLING_ATIVO). Passo a " +
        "passo em docs/bling.md."
      );
    case 504:
      return "O Bling não respondeu a tempo. Nada foi criado pela metade — tente de novo em alguns minutos.";
    default:
      return `O servidor recusou a ação (erro ${status}).`;
  }
}
