import { dicionario } from "../i18n/dicionario";
import type { Locale } from "../i18n/tipos";
import type { Linha } from "./tipos";

/**
 * Apresentacao do catalogo: a cor de cada linha e os dois rotulos de CHAVE
 * ABERTA — a nota de sabor e o ponto de torra.
 *
 * O TEXTO NAO MORA MAIS AQUI, e essa e a mudanca. `LINHAS`, `PONTO_TORRA` e
 * `NOTAS_IRREGULARES` eram tabelas de valor unico em portugues, e alimentavam
 * os filtros da PLP, os chips, a escala de torra e a ficha da PDP em qualquer
 * idioma. Todo o texto passou para `lib/i18n/dicionario.ts`, em `catalogo.*`,
 * chaveado pelo proprio valor do contrato; quem quer o rotulo de um valor
 * fechado le `d.catalogo.moagem.grao` direto, como le `d.nav.cafes`.
 *
 * SO SOBRARAM FUNCOES PARA AS DUAS CHAVES ABERTAS, e e por isso que elas sao
 * funcao: as duas podem receber uma chave que o dicionario nao tem, e sem um
 * fallback a tela mostraria `undefined`. As `notas` continuam gravadas em
 * kebab-case sem acento no contrato (`castanha-do-para`) porque sao chave de
 * filtro; a forma legivel e responsabilidade desta camada, nunca do
 * componente.
 *
 * IMPORTS RELATIVOS, nao `@/`: o vitest.config.ts nao resolve o alias.
 */

/**
 * estetica.md §4.1 — cada linha herda a cor da PROPRIA embalagem, nunca uma cor
 * inventada. Preto (Clássico), kraft (Suave), vermelho (Canela) vêm da tabela
 * de ativos do §1; o barro do Microlote vem do papel do stand-up pouch, e a
 * mata do Néctar de Minas o separa do Clássico, com quem divide o pacote preto.
 *
 * SÓ A COR: o nome da linha saiu daqui para `catalogo.linha` no dicionário.
 * Cor não tem idioma, e era a mistura das duas coisas num mapa só que fazia
 * um componente importar a tabela de cores para escrever um rótulo.
 */
export const COR_DA_LINHA: Record<Linha, string> = {
  classico: "var(--color-fuligem)",
  suave: "var(--color-juta)",
  canela: "var(--color-vermelho)",
  microlote: "var(--color-barro)",
  "nectar-de-minas": "var(--color-mata)",
};

/**
 * O texto da escala 1-5 (estetica.md §5.3: a barra NUNCA aparece sozinha).
 *
 * Recebe `number` e não `1 | 2 | 3 | 4 | 5` porque o valor também chega da
 * querystring da PLP (`?torraMin=9`), que não passa por tipo nenhum. Fora da
 * escala, devolve a palavra "Torra" — o mesmo rótulo de eixo que a ficha da
 * PDP usa, no idioma certo, em vez de um `undefined` no chip do filtro.
 */
export function rotuloPontoTorra(valor: number, locale: Locale): string {
  const d = dicionario(locale);
  // O dicionário tipa a escala com as cinco chaves literais; aqui a leitura é
  // por número aberto, e é este alias que diz isso ao compilador.
  const escala: Record<number, string> = d.catalogo.pontoTorra;
  return escala[valor] ?? d.catalogo.ficha.rotulo.torra;
}

/**
 * Kebab-case do contrato para texto de tela, no idioma da página.
 *
 * DUAS PORTAS, E AS DUAS PRECISAM EXISTIR:
 *
 *   1. A chave canônica em português (`melaco`, `citrico`) está no dicionário
 *      nos três idiomas. Era aqui que estava o defeito: um mapa só, em
 *      português, aplicado em qualquer idioma — a ficha em inglês recebia
 *      "Melaço", com cedilha.
 *   2. A chave que o editorial traduzido grava já no idioma dele (`molasses`,
 *      `melaza`) não está no dicionário de propósito, e cai no fallback, que
 *      só troca hífen por espaço e sobe a primeira letra. É o que devolve
 *      "Molasses" para o inglês sem uma segunda tabela por idioma.
 */
export function rotuloNota(nota: string, locale: Locale): string {
  const notas: Record<string, string> = dicionario(locale).catalogo.nota;
  return (
    notas[nota] ?? nota.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * "250 g" / "1 kg" — o peso do pacote, na Martian Mono.
 * Substitui `formatarAltitude`: a altitude por lote era dado inventado e saiu
 * do contrato (ver o comentário sobre `Origem` em tipos.ts).
 */
export function formatarPeso(gramas: number): string {
  return gramas >= 1000
    ? `${(gramas / 1000).toLocaleString("pt-BR")} kg`
    : `${gramas} g`;
}

/**
 * "SCA 80+" quando o número é o PISO da embalagem; "SCA 86" quando é a nota
 * daquela linha.
 *
 * O "+" é uma afirmação, não enfeite: ele diz "pelo menos isto". Colocá-lo
 * numa nota exata inventa um piso que ninguém declarou; tirá-lo do piso
 * transforma o mínimo da coleção na nota de cada café. `Math.floor` continua
 * barrando o decimal do mock antigo (84,25) por qualquer das duas portas.
 */
export function formatarSca(sca: number, exata: boolean): string {
  const n = Math.floor(sca);
  return exata ? `SCA ${n}` : `SCA ${n}+`;
}

/**
 * Café especial ou café gourmet — e quem decide é o número, não o marketing.
 *
 * 80 é o corte da própria SCA, e é ele que autoriza a palavra "especial". O
 * Néctar de Minas tem 75: chamá-lo de especial seria mentir exatamente no selo
 * que a marca usa para se provar. A embalagem dele diz gourmet, e é isso que a
 * vitrine passa a dizer. Ver `<SeloSCA>`, que muda de forma por esta função.
 */
export type ClassificacaoSca = "especial" | "gourmet";

export function classificacaoSca(sca: number): ClassificacaoSca {
  return sca >= 80 ? "especial" : "gourmet";
}
