/**
 * Data no painel — SEMPRE dd/mm/aaaa, SEMPRE em `America/Sao_Paulo` (R31).
 *
 * POR QUE UM MÓDULO E NÃO UM `toLocaleDateString` EM CADA TELA. O banco guarda
 * `timestamptz` e o driver do `pg` entrega ISO em UTC. Um pedido feito às 22h
 * de 20/08 em São Paulo é `2026-08-21T01:00:00Z`, e qualquer formatação que não
 * diga o fuso o carimba como 21/08 — a tela e o fechamento do mês discordando
 * um dia inteiro, em silêncio, exatamente na virada em que alguém confere. O
 * backend já toma a mesma decisão do outro lado (`filtrosDePeriodo` em
 * `ordersRepository.js` faz `AT TIME ZONE` para recortar o dia de São Paulo);
 * aqui é a ponta de cima da mesma regra.
 *
 * A ALTERNATIVA REJEITADA foi deixar cada tela chamar `Intl` com as opções que
 * precisasse. É o mesmo defeito que o helper `html` dos testes documentou: o
 * custo da cópia nunca é o tamanho, é não haver um nome que ligue as cópias no
 * dia em que a regra mudar — e "qual fuso o painel usa" é precisamente o tipo
 * de regra que muda uma vez e tem de mudar em todo lugar.
 *
 * Módulo puro: nada de React, nada de rede. Testado em `data.test.ts`.
 */

/** O fuso da loja. Não é configurável de propósito: uma loja, um fechamento. */
export const FUSO = "America/Sao_Paulo";

/**
 * Ausência é diferente de zero — a mesma doutrina de `dinheiro.ts`. Uma
 * assinatura sem `cancelada_em` não foi cancelada em 01/01/1970.
 */
const AUSENTE = "—";

/**
 * `Intl.DateTimeFormat` com `timeZone` explícito, construído UMA vez.
 *
 * Construir um formatador por linha de tabela é caro de verdade (o `Intl` monta
 * a tabela de fuso a cada `new`), e uma listagem de cem assinaturas formata
 * trezentas datas.
 */
const DIA_BR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DIA_E_HORA_BR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * O formatador em partes, para montar `YYYY-MM-DD` — o formato que
 * `GET /admin/orders?de=&ate=` exige.
 *
 * `formatToParts` e não `format` com um `replace`: a ordem dos campos em
 * `pt-BR` é dia/mês/ano, e remontar ISO a partir da string exigiria confiar
 * nessa ordem. As partes vêm nomeadas.
 */
const PARTES_EM_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Aceita o que o banco devolve (ISO), um `Date` já pronto, ou nada. */
export type Instante = string | number | Date | null | undefined;

function paraData(valor: Instante): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  // `new Date("qualquer coisa")` é `Invalid Date`, e ele NÃO lança: sem esta
  // guarda, uma coluna corrompida sairia na tela como "Invalid Date" — texto
  // em inglês, no meio de uma tabela em português, sem dizer de onde veio.
  return Number.isNaN(d.getTime()) ? null : d;
}

/** dd/mm/aaaa no fuso da loja, ou "—". */
export function formatarData(valor: Instante): string {
  const d = paraData(valor);
  return d ? DIA_BR.format(d) : AUSENTE;
}

/**
 * dd/mm/aaaa, HH:mm no fuso da loja, ou "—".
 *
 * Existe separado porque a HORA só serve onde ela decide alguma coisa — "esta
 * assinatura foi cancelada hoje de manhã ou agora há pouco?". Numa coluna de
 * tabela ela só rouba largura da coluna seguinte.
 */
export function formatarDataHora(valor: Instante): string {
  const d = paraData(valor);
  return d ? DIA_E_HORA_BR.format(d) : AUSENTE;
}

/**
 * O DIA DE HOJE EM SÃO PAULO, como `YYYY-MM-DD`.
 *
 * É o que `GET /admin/orders?de=&ate=` recebe, e o backend valida o formato e
 * recorta com `AT TIME ZONE 'America/Sao_Paulo'`. Mandar `new Date()
 * .toISOString().slice(0,10)` daqui — que é o que se escreve sem pensar —
 * carimbaria o dia de UTC: das 21h à meia-noite de São Paulo, a janela "últimos
 * 7 dias" começaria e terminaria um dia à frente, e a comparação com o período
 * anterior compararia oito dias com seis.
 *
 * `agora` é parâmetro para o teste poder fixar o instante. Sem isso, o único
 * teste possível seria "devolve alguma coisa com dez caracteres".
 */
export function diaEmSaoPaulo(agora: Date = new Date()): string {
  return PARTES_EM_SP.format(agora);
}

/**
 * Soma (ou subtrai) dias a um `YYYY-MM-DD`, devolvendo `YYYY-MM-DD`.
 *
 * A CONTA É FEITA EM UTC DE PROPÓSITO, e isso não contradiz o parágrafo acima:
 * o dia já foi decidido em São Paulo por `diaEmSaoPaulo`. Daqui para a frente a
 * string é um rótulo de calendário, e somar dias a um rótulo de calendário
 * dentro de um fuso com horário de verão é como se perde ou se ganha um dia por
 * ano — o Brasil não tem mais horário de verão, mas `new Date("2026-08-26")`
 * já é interpretado como meia-noite UTC pelo próprio parser, e usar métodos
 * locais em cima disso mistura os dois sistemas.
 *
 * Devolve `""` para entrada que não seja um dia — quem chama nunca deve montar
 * uma query com lixo, e um `""` faz o parâmetro ser omitido em vez de mandar
 * "NaN-NaN-NaN" para o backend, que responderia 400 com uma frase sobre
 * formato.
 */
export function somarDias(dia: string, dias: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "";
  const base = Date.UTC(
    Number(dia.slice(0, 4)),
    Number(dia.slice(5, 7)) - 1,
    Number(dia.slice(8, 10)),
  );
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A janela dos últimos `dias` dias, INCLUINDO hoje, no formato do backend.
 *
 * "Últimos 7 dias" conta hoje como um deles — é o que o gestor entende ao ler a
 * frase, e é o que faz a janela anterior encaixar sem sobrepor nem pular um
 * dia. Por isso `de = hoje - (dias - 1)`, e não `hoje - dias`: com o segundo, a
 * janela teria oito dias e a comparação com o período anterior estaria errada
 * em ~14% para sempre, sem nada na tela denunciando.
 *
 * `ate` do backend é INCLUSIVO no dia (`< ate + 1 dia`), então "hoje" traz os
 * pedidos de hoje inteiros.
 */
export function janelaDeDias(
  dias: number,
  hoje: string = diaEmSaoPaulo(),
): { de: string; ate: string } {
  return { de: somarDias(hoje, -(dias - 1)), ate: hoje };
}

/**
 * A janela imediatamente ANTERIOR a `janelaDeDias(dias, hoje)`, do mesmo
 * tamanho — o "período de comparação" que o §4.1 pede nos KPIs.
 *
 * Ela termina no dia anterior ao início da atual. Terminar no mesmo dia em que
 * a atual começa contaria esse dia duas vezes, e o KPI diria "+3%" num dia em
 * que nada mudou.
 */
export function janelaAnterior(
  dias: number,
  hoje: string = diaEmSaoPaulo(),
): { de: string; ate: string } {
  const atual = janelaDeDias(dias, hoje);
  const ate = somarDias(atual.de, -1);
  return { de: somarDias(ate, -(dias - 1)), ate };
}
