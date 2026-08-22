import type { Locale } from "../../../../lib/i18n/tipos";

/**
 * O conteúdo da /rastreabilidade.
 *
 * POR QUE ESTA PÁGINA EXISTE, JÁ QUE NÃO TEM CONTEÚDO PRÓPRIO. No site
 * institucional a rota `/rastreabilidade` era um `redirect()` seco para a base
 * do Cerrado Mineiro — três linhas, sem tela. Trazer aquilo para cá do mesmo
 * jeito daria uma rota que existe no rodapé, aparece no sitemap e joga o
 * visitante para fora do site sem avisar.
 *
 * A ALTERNATIVA CONSIDERADA E DESCARTADA foi não ter página nenhuma e apontar o
 * rodapé direto para a URL externa. Ela perde as duas coisas que importam aqui:
 * dizer o que se vai encontrar do outro lado, e dizer que o outro lado não é
 * nosso. Um rodapé não tem espaço para nenhuma das duas.
 *
 * Então a página é curta e é um link: explica o que a base é, mostra o domínio
 * e o registro ANTES do clique, e avisa que o clique sai daqui.
 *
 * IMPORT RELATIVO, não `@/`: o vitest.config.ts não resolve o alias, e este
 * módulo é importado pelo teste ao lado (mesma nota de lib/i18n/rotas.ts).
 */

/**
 * O destino, como estava no institucional.
 *
 * O `653/501` é o registro do produtor na base — é ele que a página mostra em
 * Martian Mono, e o teste ao lado prova que o número exibido e o número do
 * link são o mesmo. Domínio e registro escritos duas vezes, num lugar só, é o
 * que impede a página de anunciar um destino e levar a outro.
 */
export const URL_DA_BASE =
  "https://intranet.cerradomineiro.org/index.php/farmId/produtor/653/501";

/** Mostrado ao lado do link. Quem toca no telefone não vê barra de status. */
export const HOSPEDEIRO_DA_BASE = "intranet.cerradomineiro.org";

export const REGISTRO_DO_PRODUTOR = "653/501";

/* -------------------------------------------------------------------------
   Os textos, nos três idiomas — mesma trava do lib/i18n/dicionario.ts: `pt` é
   a fonte do tipo, `en` e `es` são declarados como `TextosDaRastreabilidade`.
------------------------------------------------------------------------- */

const pt = {
  metaTitulo: "Rastreabilidade",
  metaDescricao:
    "Onde conferir o registro do produtor do Café Canastra, numa base do Cerrado Mineiro.",

  rotulo: "Origem",
  titulo: "Rastreabilidade",
  lead: "A ficha do produtor da família Boaventura fica numa base do Cerrado Mineiro. Esta página existe para levar até lá — e para dizer, antes do clique, que a base não é nossa.",

  oQueETitulo: "O que dá para conferir lá",
  /**
   * A honestidade fina desta página. O link é do PRODUTOR, não do pacote: a
   * URL termina em `produtor/653/501`, e prometer rastreio por lote seria
   * inventar um recurso que a loja não tem.
   */
  oQueETexto:
    "O registro do produtor no Cerrado Mineiro, que é a denominação de origem do café do cerrado de Minas. É verificação de quem produz, não do pacote que você comprou: a loja não emite código por embalagem.",

  avisoTitulo: "Você sai deste site.",
  avisoTexto:
    "O endereço abaixo é mantido pelo Cerrado Mineiro, não pelo Café Canastra. Se ele estiver fora do ar, não é a loja que caiu.",
  botao: "Abrir a ficha do produtor",
  registroRotulo: "Registro",
  /** Só para leitor de tela — o aviso visível é o bloco acima do link. */
  abreEmOutraAba: "abre em outra aba",

  voltarLink: "Voltar para a serra",
};

export type TextosDaRastreabilidade = typeof pt;

const en: TextosDaRastreabilidade = {
  metaTitulo: "Traceability",
  metaDescricao:
    "Where to check the Café Canastra grower record, in a Cerrado Mineiro database.",

  rotulo: "Origin",
  titulo: "Traceability",
  lead: "The Boaventura family grower record lives in a Cerrado Mineiro database. This page exists to take you there — and to say, before the click, that the database is not ours.",

  oQueETitulo: "What you can check there",
  oQueETexto:
    "The grower record in the Cerrado Mineiro, the designation of origin for coffee from the Minas cerrado. It verifies who grows the coffee, not the bag you bought: the store issues no code per package.",

  avisoTitulo: "You are leaving this site.",
  avisoTexto:
    "The address below is kept by Cerrado Mineiro, not by Café Canastra. If it is down, it is not the store that is down.",
  botao: "Open the grower record",
  registroRotulo: "Record",
  abreEmOutraAba: "opens in a new tab",

  voltarLink: "Back to the Serra",
};

const es: TextosDaRastreabilidade = {
  metaTitulo: "Trazabilidad",
  metaDescricao:
    "Dónde verificar el registro del productor de Café Canastra, en una base del Cerrado Mineiro.",

  rotulo: "Origen",
  titulo: "Trazabilidad",
  lead: "La ficha del productor de la familia Boaventura está en una base del Cerrado Mineiro. Esta página existe para llevarlo hasta allá — y para avisar, antes del clic, que la base no es nuestra.",

  oQueETitulo: "Qué se puede verificar allá",
  oQueETexto:
    "El registro del productor en el Cerrado Mineiro, que es la denominación de origen del café del cerrado de Minas. Verifica a quien produce, no el paquete que usted compró: la tienda no emite código por envase.",

  avisoTitulo: "Usted sale de este sitio.",
  avisoTexto:
    "La dirección de abajo la mantiene el Cerrado Mineiro, no Café Canastra. Si está fuera del aire, no es la tienda la que se cayó.",
  botao: "Abrir la ficha del productor",
  registroRotulo: "Registro",
  abreEmOutraAba: "abre en otra pestaña",

  voltarLink: "Volver a la sierra",
};

const TEXTOS: Record<Locale, TextosDaRastreabilidade> = { pt, en, es };

export function textosDaRastreabilidade(
  locale: Locale,
): TextosDaRastreabilidade {
  return TEXTOS[locale];
}
