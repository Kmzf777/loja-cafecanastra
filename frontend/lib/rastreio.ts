/**
 * A página /rastreio — a lógica pura, fora do React.
 *
 * DE ONDE VEM O TRÁFEGO, E O QUE ISSO IMPÕE: o botão "Rastrear pedido" do
 * template `pedido_enviado` da Meta (`backend/src/utils/whatsappMensagens.js`)
 * aponta para `/rastreio?codigo=…`, e aquela URL é CONGELADA na aprovação do
 * template. Quem chega aqui veio de um botão que não dá para consertar depois
 * — a página precisa se sustentar com qualquer coisa que venha no parâmetro,
 * inclusive nada.
 *
 * A PÁGINA NÃO CONSULTA NADA. A loja não tem integração de rastreamento: a
 * Melhor Envio aqui só cota frete (`ShippingController.calculate`) e o
 * `codigo_rastreio` é digitado à mão no painel. Então ela ECOA o código que
 * veio na URL e oferece para onde levá-lo. Isso é o que a torna pública com
 * segurança: sem login e sem banco, não há dado de pedido para vazar a quem
 * adivinhar um código alheio — e exigir login para saber onde está o café
 * seria fricção no ponto exato em que a pessoa só quer uma informação.
 *
 * O CÓDIGO É ENTRADA DE TERCEIRO. A defesa de verdade são o escape automático
 * do JSX e o `encodeURIComponent` do href; a lista branca de
 * `normalizarCodigo` é a camada que não depende de ninguém lembrar disso.
 *
 * Módulo puro (nada de `window`, `fetch` ou React) porque é o que esta casa
 * testa: componente não tem teste aqui, lógica em `lib/` tem.
 */

/**
 * Teto do que se ecoa. Sem ele, `?codigo=` com 50 kB de lixo vira 50 kB de
 * HTML servido a quem abrir o link, e um código gigante empurra o layout
 * inteiro para fora da tela. Nenhuma transportadora do país chega perto de 40.
 */
export const LIMITE_DO_CODIGO = 40;

/**
 * Formato dos Correios: duas letras, nove dígitos, duas letras
 * (`AA123456789BR`). É o padrão UPU, e é o que o painel digita na esmagadora
 * maioria dos envios — mas não em todos, ver `normalizarCodigo`.
 */
const CORREIOS = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * O rastreamento com o código embutido na URL.
 *
 * `linkcorreios.com.br` E NÃO O SITE OFICIAL, e o motivo é o único que
 * importa aqui: é o que aceita o código como parâmetro. O rastreamento
 * oficial é uma aplicação de página única, sem deep link estável — mandar
 * para lá quem acabou de tocar um botão no WhatsApp o obrigaria a copiar e
 * colar, que é exatamente o trabalho que este botão existe para poupar.
 *
 * ISTO NÃO É DECISÃO CONGELADA (ao contrário da URL do template): é uma
 * string neste arquivo, e trocar por outro rastreador custa um deploy. Por
 * isso a página oferece TAMBÉM o oficial, para quem preferir a fonte primária.
 */
export function linkDeRastreamento(codigo: string): string {
  return `https://www.linkcorreios.com.br/?id=${encodeURIComponent(codigo)}`;
}

/** A fonte primária, sem o código — não há como pré-preencher a SPA deles. */
export const RASTREAMENTO_OFICIAL = "https://rastreamento.correios.com.br/app/index.php";

/**
 * O que veio em `?codigo=` virando um código exibível, ou `null`.
 *
 * FILTRA EM VEZ DE RECUSAR: um código com um espaço colado do WhatsApp ainda é
 * o código do cliente, e devolver `null` por causa dele trocaria uma página
 * útil pela tela de "sem código". O que sobra de uma injeção é texto inerte.
 *
 * O HÍFEN FICA. A Melhor Envio despacha por Jadlog e Loggi também, e o painel
 * aceita qualquer texto em `codigo_rastreio` (não há validação de formato no
 * backend). Comer o hífen entregaria um código que a transportadora não
 * reconhece — pior do que não mostrar nada.
 */
export function normalizarCodigo(
  bruto: string | string[] | undefined | null,
): string | null {
  // O Next entrega `string[]` quando o parâmetro se repete. Isso não sai do
  // botão da Meta; sai de quem monta a URL à mão. O primeiro, de propósito:
  // renderizar "a,b" seria exibir algo que não é um código.
  const texto = Array.isArray(bruto) ? bruto[0] : bruto;
  if (!texto) return null;

  const limpo = texto
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, LIMITE_DO_CODIGO);

  return limpo || null;
}

/** O código tem cara de Correios? Só então o link de lá leva a algum lugar. */
export function ehCodigoDosCorreios(codigo: string): boolean {
  return CORREIOS.test(codigo);
}
