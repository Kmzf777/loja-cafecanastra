import { API_BASE } from "../api-base";
import {
  comFallback,
  ehDestinoValido,
  imagemPermitida,
  textoUtil,
  type ChaveDeTexto,
  type IdiomaDaVitrine,
  type LinhaDeTexto,
  type RespostaDaVitrine,
} from "../painel/vitrine/vitrine.logica";
import type { Locale } from "../i18n/tipos";

/**
 * O herói da home e a barra de aviso, lidos do banco — com o texto de hoje como
 * PISO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE MANDA EM TUDO AQUI: O HERÓI NUNCA NASCE EM BRANCO.
 *
 * Linha ausente, coluna nula, string vazia, API fora do ar, resposta que não é
 * JSON — em qualquer desses casos a home aparece EXATAMENTE como aparece hoje.
 * O texto chumbado na tabela `TEXTOS` de `app/[locale]/(vitrine)/page.tsx`
 * deixou de ser a fonte e virou o piso; ele não saiu de lá, ele mudou de papel.
 *
 * Isso não é zelo: um gestor que salva o formulário pela metade não pode apagar
 * o topo da loja, e o `PUT /vitrine` permite salvar pela metade de propósito
 * (um NOT NULL obrigaria a preencher os seis campos dos três idiomas antes de
 * trocar uma foto). A permissividade de lá só é segura por causa da regra daqui.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A OUTRA REGRA: ISTO NÃO PODE TIRAR AS TRÊS HOMES DO BUILD.
 *
 * `generateStaticParams()` + `export const revalidate = 3600` fazem `/pt`,
 * `/en` e `/es` saírem prontas do `next build`. Qualquer `cookies()`,
 * `headers()` ou `searchParams` que entre no caminho da home a derruba para
 * render sob demanda, com uma ida ao servidor a cada visita — o preço está
 * medido em `docs/performance-dev.md §7` e citado em `page.tsx:54-70`.
 *
 * Por isso a leitura é `fetch` com `next: { revalidate }`, que é justamente a
 * leitura que sobrevive à geração estática — a mesma forma que
 * `lib/catalogo/repositorio.ts` já usa para preço e estoque. NENHUMA API
 * dinâmica entra neste arquivo, e o teste fixa a forma da chamada.
 */

/** A imagem que a home sempre teve, e para onde ela volta quando o banco não
 *  tem nada utilizável. É um arquivo de `public/`, não conteúdo editorial —
 *  por isso ele mora aqui e não na tabela `TEXTOS`. */
export const IMAGEM_DO_HEROI_PADRAO = "/imagem-banner.jpg";

/** O mesmo `revalidate` da home: adiantar a revalidação do herói sem adiantar a
 *  da página seria pagar a ida ao servidor sem ninguém para ver o resultado. */
export const SEGUNDOS_DE_CACHE = 3600;

/**
 * TETO DE ESPERA, pelo mesmo motivo de `lib/catalogo/repositorio.ts` e
 * `lib/avaliacoes/servidor.ts`: `fetch` não tem timeout próprio, e uma API que
 * aceita a conexão e nunca responde deixa esta promessa pendurada para sempre.
 * Quem espera aqui é o BUILD das três homes.
 *
 * 3000 ms, o MESMO número dos outros dois de propósito — são três leituras de
 * contingência do mesmo tipo, e três tetos diferentes seriam três conversas
 * sobre o mesmo problema.
 */
export const ESPERA_MAXIMA_MS = 3000;

/** O texto de hoje, vindo de quem o tem: `TEXTOS` em `page.tsx` para o herói,
 *  o dicionário para a barra. Ele é ARGUMENTO e não import porque a tabela
 *  `TEXTOS` não sai do `page.tsx` — ela é conteúdo daquela página. */
export type PisoDoHeroi = {
  kicker: string;
  titulo: string;
  texto: string;
  rotuloBotao: string;
  destino: string;
  imagemAlt: string;
};

export type Heroi = PisoDoHeroi & {
  imagemDesktop: string;
  imagemMobile: string;
};

export type PisoDaBarra = {
  texto: string;
  /** Sem piso hoje: a barra de aviso da loja nunca teve link. Vazio significa
   *  "não desenhe o link", e é o estado normal. */
  rotuloBotao: string;
  destino: string;
};

export type BarraDeAviso = PisoDaBarra;

/**
 * O estado das duas tabelas, ou `null`.
 *
 * SILENCIOSO DE PROPÓSITO, e a decisão é a mesma de `buscarDadosAoVivo` no
 * catálogo: para a loja, "a API está fora" e "a API demorou demais" são a mesma
 * coisa — em ambos os casos a página se desenha com o que já tem. Uma exceção
 * subindo daqui derrubaria o build das três homes por causa de um container
 * reiniciando.
 */
async function buscarVitrine(): Promise<RespostaDaVitrine | null> {
  try {
    const res = await fetch(`${API_BASE}/vitrine`, {
      next: { revalidate: SEGUNDOS_DE_CACHE },
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
    if (!res.ok) return null;
    const corpo = await res.json();
    return corpo && typeof corpo === "object" ? (corpo as RespostaDaVitrine) : null;
  } catch {
    return null;
  }
}

/** A linha de um (chave, idioma), ou `null`. Sem `?.` encadeado à mão em cada
 *  chamador: o contrato promete as duas chaves e os três idiomas, mas quem
 *  responde pode ser uma API de outra versão. */
function linha(
  resposta: RespostaDaVitrine | null,
  chave: ChaveDeTexto,
  idioma: IdiomaDaVitrine,
): Partial<LinhaDeTexto> | null {
  const porIdioma = resposta?.textos?.[chave];
  const encontrada = porIdioma ? porIdioma[idioma] : null;
  return encontrada && typeof encontrada === "object" ? encontrada : null;
}

/**
 * O IDIOMA PEDIDO, DEPOIS O PORTUGUÊS — e essa ordem tem um custo que vale a
 * pena pagar.
 *
 * O gestor edita o português, que é o idioma dele. Se `/en` olhasse só a linha
 * `en`, o anúncio do microlote sairia em `/pt` e o visitante inglês continuaria
 * lendo o texto de sempre: a loja anunciaria uma coisa numa língua e outra
 * noutra. O preço é ver uma frase em português numa página em inglês enquanto a
 * tradução não vem — e a tela do painel põe as três abas lado a lado justamente
 * para esse intervalo ser curto.
 *
 * É CAMPO A CAMPO: um `en` com o título traduzido e o texto em branco fica com
 * o título em inglês e o texto do português, não com os dois em português.
 */
function doBanco(
  resposta: RespostaDaVitrine | null,
  chave: ChaveDeTexto,
  idioma: IdiomaDaVitrine,
  campo: keyof LinhaDeTexto,
): string {
  const doIdioma = textoUtil(linha(resposta, chave, idioma)?.[campo]);
  if (doIdioma) return doIdioma;
  return textoUtil(linha(resposta, chave, "pt")?.[campo]);
}

/**
 * O par botão+destino, resolvido junto.
 *
 * UM DESTINO INVÁLIDO DESQUALIFICA O PAR INTEIRO. Rótulo sem destino é um botão
 * que não leva a lugar nenhum, e no herói ele SUBSTITUI o "Ver os cafés" que
 * funcionava — o visitante clicaria e não aconteceria nada. Como o par cai
 * junto, o piso devolve os dois coerentes.
 *
 * `ehDestinoValido` recusa `//evil.com` e `/\evil.com`, que são caminho para os
 * olhos e OUTRO SITE para o navegador: o herói é a primeira coisa que a home
 * desenha, e um destino desses levaria o visitante para fora com a
 * credibilidade da loja emprestada.
 */
function parDeBotao(
  resposta: RespostaDaVitrine | null,
  chave: ChaveDeTexto,
  idioma: IdiomaDaVitrine,
): { rotuloBotao: string; destino: string } {
  const destino = doBanco(resposta, chave, idioma, "destino");
  if (!ehDestinoValido(destino)) return { rotuloBotao: "", destino: "" };
  return { rotuloBotao: doBanco(resposta, chave, idioma, "rotulo_botao"), destino };
}

/**
 * A imagem, com a MESMA guarda que o painel usa para não deixar salvar.
 *
 * `next/image` LANÇA em tempo de execução para host fora de
 * `images.remotePatterns` (`next.config.mjs:157-166`) — não degrada, derruba a
 * rota. Um endereço colado de qualquer lugar faria a home responder 500, e o
 * herói é a primeira coisa que ela desenha. `validar()` já recusa isso na tela;
 * esta é a segunda trava, para o que tiver entrado por SQL ou por uma migração
 * de `config_loja`.
 *
 * A VERSÃO DE TELEFONE CAI NA DE DESKTOP, e não no arquivo padrão: pedir dois
 * uploads da mesma foto é trabalho inventado (é o que o comentário da migração
 * 0030 diz), então uma imagem só serve os dois tamanhos.
 */
function imagens(resposta: RespostaDaVitrine | null): {
  imagemDesktop: string;
  imagemMobile: string;
} {
  const bruto = resposta?.heroi ?? null;
  const desktop = textoUtil(bruto?.imagem_desktop);
  const imagemDesktop = imagemPermitida(desktop) ? desktop : IMAGEM_DO_HEROI_PADRAO;

  const mobile = textoUtil(bruto?.imagem_mobile);
  const imagemMobile = imagemPermitida(mobile) ? mobile : imagemDesktop;

  return { imagemDesktop, imagemMobile };
}

/** O herói de um idioma: o banco onde ele tem alguma coisa, o `piso` onde não
 *  tem. Ver o cabeçalho do arquivo para a regra inteira. */
export async function buscarHeroi(locale: Locale, piso: PisoDoHeroi): Promise<Heroi> {
  const resposta = await buscarVitrine();
  const par = parDeBotao(resposta, "heroi", locale);

  const texto = comFallback(
    {
      kicker: doBanco(resposta, "heroi", locale, "kicker"),
      titulo: doBanco(resposta, "heroi", locale, "titulo"),
      texto: doBanco(resposta, "heroi", locale, "texto"),
      rotuloBotao: par.rotuloBotao,
      destino: par.destino,
      imagemAlt: doBanco(resposta, "heroi", locale, "imagem_alt"),
    },
    piso,
  );

  return { ...texto, ...imagens(resposta) };
}

/**
 * A barra de aviso — o campo *write-only* mais barato de ligar.
 *
 * `canastra.config_loja.barra_de_aviso` existe desde a 0005, o Express a expõe
 * como `announcement_bar` e o painel legado a edita — e o cabeçalho da vitrine
 * sempre leu o DICIONÁRIO. O gestor salvava e nada acontecia em lugar nenhum
 * (spec §1). Agora ele lê o banco, com o dicionário como piso.
 */
export async function buscarBarraDeAviso(
  locale: Locale,
  piso: PisoDaBarra,
): Promise<BarraDeAviso> {
  const resposta = await buscarVitrine();
  const par = parDeBotao(resposta, "barra_aviso", locale);

  return comFallback(
    {
      texto: doBanco(resposta, "barra_aviso", locale, "texto"),
      rotuloBotao: par.rotuloBotao,
      destino: par.destino,
    },
    piso,
  );
}
