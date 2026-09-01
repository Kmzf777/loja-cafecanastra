import {
  ROTA_DE_CONTA_NEGADA,
  destinoDeEntrada,
} from "@/lib/conta/painel-rotas";

/**
 * A DECISÃO do segundo anel — pura, sem React, sem Supabase, sem `window`.
 *
 * Mesma divisão do anel de servidor (`lib/conta/painel-servidor.ts`, o comentário
 * "COMO ESTÁ DIVIDIDO, E POR QUÊ"): a regra recebe fatos e devolve um veredito;
 * a parte impura só colhe os fatos e obedece. É o que permite testar o anel sem
 * um navegador e sem um GoTrue de mentira.
 */

export type FatosDoAnel = {
  /** Há sessão viva no navegador AGORA. */
  temSessao: boolean;
  /** De quem é essa sessão. `null` quando não há nenhuma. */
  userId: string | null;
  /**
   * Por quem o anel de SERVIDOR respondeu ao servir esta tela — o que
   * `exigirAdminNoPainel` devolveu ao layout. `null` quando o layout não soube
   * dizer, e aí nenhuma identidade pode ser considerada já conferida.
   */
  userIdDoServidor: string | null;
  /**
   * O papel da sessão de agora, quando ele foi PERGUNTADO E RESPONDIDO.
   *
   * `null` tem um significado exato: não se sabe — ou porque não foi preciso
   * perguntar (é a mesma pessoa que o servidor já aprovou), ou porque a
   * pergunta falhou. Um `boolean` sozinho não distinguiria "respondeu que não"
   * de "não respondeu", e é justamente essa diferença que decide se a pessoa é
   * expulsa da tela.
   */
  ehAdmin: boolean | null;
  /** `location.pathname + location.search` — a tela e os filtros abertos. */
  rotaAtual: string;
};

export type AcaoDoAnel = { tipo: "fica" } | { tipo: "sai"; destino: string };

/**
 * O que fazer quando a sessão do navegador muda.
 *
 * A ORDEM DAS PERGUNTAS É PARTE DA REGRA.
 *
 * 1. SEM SESSÃO SAI, e este é o caso que o anel existe para pegar: o gestor
 *    deixou a aba aberta a noite inteira, ou saiu da conta em outra aba. A tela
 *    continuaria de pé, com toda chamada de API respondendo 401 em silêncio —
 *    uma interface que parece funcionar e não grava nada. É um fato LOCAL (o
 *    supabase-js diz que não há sessão), sem rede no meio, e por isso é o único
 *    que fecha a porta sozinho.
 *
 * 2. MESMA PESSOA QUE O SERVIDOR APROVOU: fica, e sem perguntar nada a
 *    ninguém. O anel de servidor conferiu `canastra.admins` na requisição que
 *    serviu esta tela; repetir a pergunta a cada renovação de token (que
 *    acontece sozinha, de hora em hora) seria uma ida à rede por hora, por aba,
 *    para reconfirmar o que não mudou.
 *
 * 3. OUTRA PESSOA E O BANCO DISSE QUE NÃO É ADMIN: sai para a própria conta, e
 *    não para o formulário de login — ela entrou com a senha certa, e devolvê-la
 *    ao login seria pedir que digitasse de novo o que já funcionou. É o caso de
 *    quem trocou de conta em outra aba e voltou para esta.
 *
 * 4. NÃO SE SABE (`ehAdmin: null` com identidade nova): FICA, e aqui este anel
 *    diverge de propósito do de servidor, que fecha o acesso quando a consulta
 *    falha. Lá o custo de errar é um F5; aqui é expulsar da tela, no meio de um
 *    formulário preenchido, um gestor legítimo por causa de uma oscilação de
 *    rede — e é justamente durante a oscilação que a consulta falha. Ficar não
 *    abre porta nenhuma: os dados continuam atrás da RLS e do `isAdmin` de cada
 *    rota, e quem não pode ler continua não lendo. Este anel decide o que a
 *    TELA faz, nunca o que o banco entrega.
 */
export function decidirNoAnelDeSessao(fatos: FatosDoAnel): AcaoDoAnel {
  if (!fatos.temSessao) {
    return { tipo: "sai", destino: destinoDeEntrada(fatos.rotaAtual) };
  }

  const jaConferida =
    fatos.userIdDoServidor !== null && fatos.userId === fatos.userIdDoServidor;
  if (jaConferida) return { tipo: "fica" };

  if (fatos.ehAdmin === false) {
    return { tipo: "sai", destino: ROTA_DE_CONTA_NEGADA };
  }

  return { tipo: "fica" };
}

/**
 * Precisa perguntar ao banco quem é essa pessoa?
 *
 * Só quando há sessão e ela NÃO é a que o servidor já aprovou. Está aqui, e não
 * embutido no efeito, porque é a regra que decide quantas idas à rede o painel
 * faz — e uma regra dessas escrita dentro de um `if` de efeito é uma regra que
 * ninguém testa e que dobra de custo na primeira distração.
 */
export function precisaConferirOPapel(
  temSessao: boolean,
  userId: string | null,
  userIdDoServidor: string | null,
): boolean {
  if (!temSessao) return false;
  return userIdDoServidor === null || userId !== userIdDoServidor;
}
