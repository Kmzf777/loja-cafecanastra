/**
 * A lógica da tela de conexão com o Bling — SEM React, SEM fetch.
 *
 * Mesmo corte de `contrato.ts`, o vizinho deste arquivo: o que o gestor LÊ
 * (em que estado a conexão está, que frase mostrar quando o callback volta com
 * erro) mora aqui, e é a única parte da tela que dá para testar sem navegador.
 */

/** O que `GET /bling/status` devolve, na parte que esta tela usa. */
export type StatusDaConexao = {
  temCredenciais?: boolean;
  conectado?: boolean;
  ativo?: boolean;
  token?: { ok?: boolean; erro?: string } | null;
};

/**
 * A URL que se cola no campo "URL de redirecionamento" do app no Bling.
 *
 * É a da API (`/api/...`), NÃO a da vitrine: o `client_secret` entra na troca
 * do `code` pelos tokens, e num callback de página ele teria que chegar ao
 * navegador. Traefik roteia `/api/*` para o Express removendo o prefixo, então
 * isto chega lá como `GET /bling/callback`.
 *
 * Constante, e não montada de `window.location`: o Bling não aceita
 * `redirect_uri` como parâmetro — ele usa a que está CADASTRADA no app. A
 * string tem que bater caractere por caractere, e derivá-la do navegador faria
 * ela mudar em ambiente de teste sem ninguém perceber.
 */
export const URL_DE_CALLBACK =
  "https://loja.canastrainteligencia.com/api/bling/callback";

/**
 * Os escopos a marcar ao criar o aplicativo, conferidos contra as chamadas
 * reais de `backend/src/services/blingPedidos.js` — não contra o runbook.
 *
 * Produtos é o único sem escrita: a loja nunca cria produto no Bling, só
 * confere se o SKU existe antes de montar o pedido de venda. Marcar escrita ali
 * daria à integração um poder que ela não exerce.
 */
export const ESCOPOS_DO_APP = Object.freeze([
  Object.freeze({
    recurso: "Contatos",
    escrita: true,
    porque: "busca o cliente por CPF e cria quando não existe",
  }),
  Object.freeze({
    recurso: "Produtos",
    escrita: false,
    porque: "confere cada SKU do pedido antes de criar qualquer coisa",
  }),
  Object.freeze({
    recurso: "Pedidos de Venda",
    escrita: true,
    porque: "cria o pedido de venda e lê o rastreio de volta",
  }),
  Object.freeze({
    recurso: "Notas Fiscais Eletrônicas",
    escrita: true,
    porque: "gera a NF-e, transmite à SEFAZ e confere a autorização",
  }),
]);

export type ChaveDoEstado =
  | "sem_credenciais"
  | "desconectado"
  | "conectado_desligado"
  | "ligado";

/**
 * Em que passo da conexão a loja está.
 *
 * A ordem das perguntas é a ordem em que as coisas acontecem, e é a única que
 * não mente: sem credencial não há o que autorizar; sem autorização não há o
 * que ligar. Cada estado mostra UMA ação — a próxima — em vez de quatro botões
 * dos quais três recusariam.
 */
export function estadoDaConexao(status?: StatusDaConexao | null) {
  const s = status || {};

  if (!s.temCredenciais) {
    return {
      chave: "sem_credenciais" as ChaveDoEstado,
      titulo: "Aplicativo do Bling ainda não cadastrado",
      detalhe:
        "Crie o aplicativo no Bling com os escopos abaixo e cole aqui o " +
        "Client ID e o Client Secret.",
      cor: "#b3261e",
    };
  }

  if (!s.conectado) {
    return {
      chave: "desconectado" as ChaveDoEstado,
      titulo: "Credenciais salvas — falta autorizar",
      detalhe:
        "Clique em Conectar para autorizar a loja na sua conta Bling. Você " +
        "volta para esta tela em seguida.",
      cor: "#f57c00",
    };
  }

  if (!s.ativo) {
    return {
      chave: "conectado_desligado" as ChaveDoEstado,
      titulo: "Conectada, mas desligada",
      detalhe:
        "A autorização está válida e nada é enviado ao Bling enquanto a " +
        "integração estiver desligada. Ligue quando quiser que os pedidos " +
        "aprovados virem pedido de venda no ERP.",
      cor: "#1976d2",
    };
  }

  return {
    chave: "ligado" as ChaveDoEstado,
    titulo: "Integração ligada",
    detalhe:
      "Pedido aprovado vira pedido de venda no Bling automaticamente.",
    cor: "#00796b",
  };
}

export type MensagemDoRetorno = { tipo: "sucesso" | "erro"; texto: string };

/**
 * O que o callback trouxe de volta na URL.
 *
 * A frase de erro é repassada INTEIRA. É a mesma regra de `fraseDeErro` em
 * `contrato.ts`: o diagnóstico está na frase do servidor — qual credencial
 * falhou, que o `code` expirou, o que o Bling respondeu —, e trocá-la por
 * "erro ao conectar" joga fora exatamente o que resolveria o problema.
 */
export function mensagemDoRetorno(
  parametros: URLSearchParams,
): MensagemDoRetorno | null {
  const erro = parametros.get("erro");
  if (erro) return { tipo: "erro", texto: erro };
  if (parametros.get("conectado")) {
    return {
      tipo: "sucesso",
      texto: "A loja foi conectada ao Bling.",
    };
  }
  return null;
}
