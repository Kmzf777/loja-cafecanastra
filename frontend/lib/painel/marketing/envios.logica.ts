import { montarUrl, textoDoParametro, type ChipDeFiltro } from "../filtros";
import { paginaValida } from "../paginacao";
import { CANAIS_DE_CONTATO, ESTADOS_DE_ENVIO, rotuloDe } from "./vocabulario";

/**
 * A decisão da tela de Envios — o log por destinatário, agnóstico de canal.
 *
 * O QUE ELA RESPONDE: "a Ana recebeu o e-mail de carrinho abandonado?". É a
 * única tela da área que olha para uma mensagem INDIVIDUAL, e por isso a coluna
 * que mais importa nela é `erro_texto` — o CHECK `envios_erro_so_em_falha`
 * (0033) garante que ele só existe quando o estado é `falhou`, então quando ele
 * aparece é sempre a explicação de alguma coisa.
 */

export const ROTA_DE_ENVIOS = "/dashboard/marketing/envios";

export const POR_PAGINA = 20;

/** Como o Express devolve — `COLUNAS_DE_ENVIO`, exatamente. */
export type Envio = {
  id: string;
  canal: string;
  campanha_id: string | null;
  user_id: string | null;
  /** O e-mail ou o telefone para onde a mensagem foi. R23: é o identificador
   *  humano desta tabela. */
  destinatario_final: string;
  template: string | null;
  estado: string;
  provedor_id: string | null;
  erro_texto: string | null;
  criado_em: string;
  enviado_em: string | null;
  entregue_em: string | null;
};

export type RespostaDeEnvios = {
  data: Envio[];
  total: number;
  totalPages: number;
  page: number;
};

export type EstadoDosEnvios = {
  canal: string;
  estado: string;
  pagina: number;
};

export function lerEstado(
  parametros: Record<string, string | string[] | undefined>,
): EstadoDosEnvios {
  const canal = textoDoParametro(parametros.canal);
  const estado = textoDoParametro(parametros.estado);

  return {
    // Fora do vocabulário vira "sem filtro": a rota recusa com 400, e um link
    // velho transformaria a tela numa tarja de erro.
    canal: CANAIS_DE_CONTATO.some((c) => c.valor === canal) ? canal : "",
    estado: ESTADOS_DE_ENVIO.some((e) => e.valor === estado) ? estado : "",
    pagina: paginaValida(parametros.pagina, Number.MAX_SAFE_INTEGER),
  };
}

export function montarConsulta(estado: EstadoDosEnvios): string {
  return montarUrl("/admin/envios", {
    canal: estado.canal || undefined,
    estado: estado.estado || undefined,
    page: estado.pagina,
    limit: POR_PAGINA,
  });
}

export function urlDaTela(estado: Partial<EstadoDosEnvios>): string {
  const pagina = estado.pagina ?? 1;
  return montarUrl(ROTA_DE_ENVIOS, {
    canal: estado.canal || undefined,
    estado: estado.estado || undefined,
    pagina: pagina > 1 ? pagina : undefined,
  });
}

export function chipsDosEnvios(estado: EstadoDosEnvios): ChipDeFiltro[] {
  const chips: ChipDeFiltro[] = [];
  if (estado.canal) {
    chips.push({
      chave: "canal",
      dimensao: "Canal",
      valor: rotuloDe(CANAIS_DE_CONTATO, estado.canal),
      href: urlDaTela({ ...estado, canal: "", pagina: 1 }),
    });
  }
  if (estado.estado) {
    chips.push({
      chave: "estado",
      dimensao: "Estado",
      valor: rotuloDe(ESTADOS_DE_ENVIO, estado.estado),
      href: urlDaTela({ ...estado, estado: "", pagina: 1 }),
    });
  }
  return chips;
}

export function temFiltro(estado: EstadoDosEnvios): boolean {
  return estado.canal !== "" || estado.estado !== "";
}

/**
 * Onde a mensagem PAROU, numa frase — a leitura da linha do tempo do envio.
 *
 * A TABELA GUARDA TRÊS INSTANTES (`criado_em`, `enviado_em`, `entregue_em`) e
 * um `estado`, e os quatro podem discordar: o CHECK
 * `envios_entrega_depois_do_envio` garante a ordem dos dois últimos, mas nada
 * garante que `estado = 'entregue'` tenha `entregue_em` preenchido — o provedor
 * pode confirmar a entrega sem devolver o instante.
 *
 * Por isso a frase é derivada do ESTADO (que é a verdade declarada) e usa o
 * instante só quando ele existe. Mostrar "entregue em —" seria a tela parecendo
 * quebrada por causa de um campo opcional.
 */
export function ondeParou(envio: Envio): string {
  if (envio.estado === "falhou") {
    // A frase do provedor É o diagnóstico ("mailbox full", "número inexistente"),
    // e ela ganha do rótulo genérico sempre que existe.
    return envio.erro_texto ?? "Falhou, sem detalhe do provedor.";
  }
  if (envio.estado === "pendente") return "Na fila, ainda não saiu.";
  if (envio.estado === "enviado") return "Saiu daqui; sem confirmação de entrega.";
  if (envio.estado === "entregue") return "Entregue no destino.";
  if (envio.estado === "lido") return "Aberta pelo destinatário.";
  // Estado novo do backend aparece em vez de sumir atrás de um "outro".
  return envio.estado;
}
