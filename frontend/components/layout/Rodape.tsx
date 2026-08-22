import Image from "next/image";
import Link from "next/link";
import { linkWhatsApp } from "@/lib/whatsapp";
import { dicionario, type Dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import { BotaoReverCookies } from "./BotaoReverCookies";
import { FormNewsletter } from "./FormNewsletter";

/**
 * estetica.md §5.10 — fundo fuligem, quatro colunas + newsletter, e encerra
 * com o lockup COMPLETO do logo, grande (max 480px), com o "Desde 1985"
 * visivel. E o unico lugar da navegacao onde a marca aparece em tamanho
 * generoso.
 *
 * O RODAPÉ É O MAPA DO SITE, e é por isso que ele carrega o que o cabeçalho
 * não carrega: `/historia` e `/rastreabilidade` cabem aqui sem disputar espaço
 * com o caminho de venda. `/rastreabilidade` em particular só tem duas portas
 * no site inteiro — esta e a `/a-serra`.
 *
 * SEM SELETOR DE IDIOMA AQUI, e é decisão: uma segunda instância daria dois
 * grupos com o mesmo nome acessível ("Idioma") na mesma página, e o leitor de
 * tela teria de visitar os dois para descobrir que são iguais. O seletor vive
 * no cabeçalho — na barra a partir de `xl`, dentro do menu abaixo disso —, que
 * é onde a pessoa procura por ele.
 *
 * TODO CAMINHO PASSA POR `href(locale, ...)`: em `/en` um rodapé de caminhos
 * crus é o jeito mais silencioso de devolver o visitante ao português.
 */

type ItemDeColuna = {
  /** Chave estável da lista — duas linhas podem apontar para o mesmo destino. */
  chave: string;
  href: string;
  rotulo: string;
  externo?: boolean;
};

type Coluna = { chave: string; titulo: string; itens: ItemDeColuna[] };

/**
 * O alvo de toque de UMA linha de coluna — link, link externo ou botão.
 *
 * O RODAPÉ ERA A ÚLTIMA SUPERFÍCIE DA LOJA COM ALVO DE 22px. Medido em 360px:
 * texto de 15px sem padding nenhum, `space-y-2.5` entre as linhas, e 14 alvos
 * de 16px de altura — a metade do que o estetica.md pede no checklist de
 * acessibilidade (≥44×44px) e menos do que o dedo acerta sem olhar. Era
 * pré-existente, e é justamente o tipo de coisa que sobrevive porque cada
 * onda passa por perto sem se achar dona.
 *
 * O CONSERTO É A ALTURA DA LINHA, NÃO O ESPAÇO ENTRE ELAS: `min-h-11` (44px)
 * com o texto centrado, e o `space-y` some — as linhas passam a se tocar e o
 * ritmo vem do próprio alvo. Com espaçamento, o dedo que erra por 3px cai no
 * vão e não acontece nada; com alvos encostados, ele cai no vizinho, o que é
 * pior — por isso o `min-h-11` vem junto com `w-fit`: a caixa clicável abraça
 * a palavra em vez de varrer a coluna inteira, e a linha de baixo começa onde
 * a de cima termina APENAS na vertical.
 *
 * `-mx-2 px-2` alarga a caixa 8px para cada lado sem mover o texto: "Suave",
 * o rótulo mais curto do rodapé, media 42px de largura — abaixo dos 44 —, e
 * passa a medir 58px com o texto ainda alinhado ao título da coluna.
 *
 * O FOCO PASSA A SER PARA DENTRO (`-outline-offset-2`). Com as caixas
 * encostadas, um contorno para fora invadiria a linha vizinha e o cliente
 * veria o retângulo do foco cortado pelo alvo de baixo. É o mesmo ajuste que
 * os links do acordeão do Cabeçalho já usam, pela mesma razão.
 */
const LINHA_DE_COLUNA =
  "-mx-2 flex min-h-11 w-fit items-center px-2 text-[15px] text-cal/80 transition-colors hover:text-cal focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vermelho";

/**
 * As quatro colunas, no idioma pedido.
 *
 * Os nomes das linhas (Clássico, Suave, Canela) NÃO passam pelo dicionário: são
 * nome próprio impresso no pacote que chega na casa da pessoa, e traduzi-los
 * desliga o reconhecimento de quem chega pelo rótulo. É a mesma regra escrita
 * no topo de lib/i18n/dicionario.ts.
 */
function colunas(locale: Locale, d: Dicionario): Coluna[] {
  return [
    {
      chave: "cafes",
      titulo: d.rodape.colunaCafes,
      itens: [
        { chave: "todos", href: "/cafes", rotulo: d.rodape.todosOsCafes },
        { chave: "classico", href: "/cafes?linha=classico", rotulo: "Clássico" },
        { chave: "suave", href: "/cafes?linha=suave", rotulo: "Suave" },
        // A linha "aromatizado" nao existe mais no contrato: o catalogo real
        // tem "canela", que e a linha aromatizada de fato vendida.
        { chave: "canela", href: "/cafes?linha=canela", rotulo: "Canela" },
      ],
    },
    {
      chave: "assinatura",
      titulo: d.rodape.colunaAssinatura,
      itens: [
        { chave: "clube", href: "/clube", rotulo: d.rodape.clubeDaCanastra },
        {
          // Ia para `/clube` seco, igual ao item de cima: dois rótulos e um
          // endereço só. A âncora existe na página do Clube (a seção
          // "Perguntas diretas") e é o que este link sempre quis dizer.
          chave: "como-funciona",
          href: "/clube#como-funciona",
          rotulo: d.rodape.comoFunciona,
        },
      ],
    },
    {
      chave: "canastra",
      titulo: d.rodape.colunaCanastra,
      itens: [
        { chave: "serra", href: "/a-serra", rotulo: d.rodape.aSerra },
        { chave: "historia", href: "/historia", rotulo: d.rodape.historia },
        { chave: "linhas", href: "/cafes", rotulo: d.rodape.asLinhas },
        { chave: "torra", href: "/a-serra#torra", rotulo: d.rodape.aTorra },
        {
          chave: "rastreabilidade",
          href: "/rastreabilidade",
          rotulo: d.rodape.rastreabilidade,
        },
      ],
    },
    {
      chave: "ajuda",
      titulo: d.rodape.colunaAjuda,
      itens: [
        { chave: "termos", href: "/termos-de-uso", rotulo: d.rodape.termosDeUso },
        {
          chave: "privacidade",
          href: "/politica-de-privacidade",
          rotulo: d.rodape.politicaDePrivacidade,
        },
      ],
    },
  ];
}

/**
 * As colunas com o canal de contato anexado quando ele existe.
 *
 * O link vem de `lib/whatsapp.ts` — a MESMA fonte do botão flutuante
 * (BotaoWhatsApp), para número e mensagem nunca divergirem entre os dois.
 * Sem a env, a coluna fica como está: link de contato que abre conversa com
 * ninguém é pior do que não ter link.
 */
function comWhatsApp(lista: Coluna[]): Coluna[] {
  const whatsapp = linkWhatsApp();
  if (!whatsapp) return lista;

  return lista.map((coluna) =>
    coluna.chave === "ajuda"
      ? {
          ...coluna,
          itens: [
            ...coluna.itens,
            {
              chave: "whatsapp",
              href: whatsapp,
              rotulo: "WhatsApp",
              externo: true,
            },
          ],
        }
      : coluna,
  );
}

export function Rodape({ locale }: { locale: Locale }) {
  const d = dicionario(locale);

  return (
    <footer className="mt-auto bg-fuligem text-cal">
      <div className="mx-auto max-w-[1440px] px-4 py-14 md:px-10 md:py-24">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
          {comWhatsApp(colunas(locale, d)).map((coluna) => (
            <div key={coluna.chave}>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-juta">
                {coluna.titulo}
              </h2>
              {/* `mt-1` e não `mt-4`: a linha agora tem 44px com o texto
                  centrado, ou seja, ela já traz 14px de ar por cima. Com o
                  `mt-4` antigo o primeiro rótulo cairia 30px abaixo do título
                  da coluna e o grupo se desfaria. */}
              <ul className="mt-1">
                {coluna.itens.map((item) => (
                  <li key={item.chave}>
                    {item.externo ? (
                      // <a> e nao <Link>: destino fora da loja (wa.me).
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINHA_DE_COLUNA}
                      >
                        {item.rotulo}
                      </a>
                    ) : (
                      <Link
                        href={href(locale, item.href)}
                        className={LINHA_DE_COLUNA}
                      >
                        {item.rotulo}
                      </Link>
                    )}
                  </li>
                ))}
                {coluna.chave === "ajuda" ? (
                  // Botão, não link: revoga o consentimento de cookies na hora
                  // (LGPD — sair tem de ser tão fácil quanto entrar). Estilo dos
                  // vizinhos, passado por prop porque o padrão do componente é o
                  // da página clara.
                  <li>
                    <BotaoReverCookies
                      rotulo={d.cookies.rever}
                      className={LINHA_DE_COLUNA}
                    />
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>

        {/* A newsletter do §5.10 — depois das colunas, antes do lockup. O
            formulário em si é client component (FormNewsletter): é a única
            parte do rodapé com estado, e isolá-la mantém isto aqui servidor. */}
        <div className="mt-14 border-t border-fuligem-80 pt-10 md:mt-16">
          <FormNewsletter t={d.newsletter} />
        </div>

        <div className="mt-14 flex flex-col items-center border-t border-fuligem-80 pt-12 md:mt-16 md:pt-14">
          {/* O <div> com largura propria e o que impede o estouro: sem ele o
              flex se dimensiona pela largura intrinseca do PNG (3508px) e o
              documento inteiro ganha rolagem horizontal em mobile.
              invert() porque o ativo e preto sobre transparente e o fundo aqui
              e fuligem. Some quando o SVG com currentColor existir (§1). */}
          <div className="w-full max-w-[320px] md:max-w-[480px]">
            <Image
              src="/logo-canastra.png"
              // AQUI O `alt` NÃO É REDUNDANTE: no cabeçalho a marca está
              // dentro de um link que tem `aria-label`, e o `alt` fica
              // encoberto por ele. Neste lockup não há link nenhum em volta —
              // este texto é tudo o que o leitor de tela recebe da maior
              // aparição da marca no site, e ele falava português em /en e
              // /es.
              alt={d.comum.logoAlt}
              width={3508}
              height={2481}
              sizes="(min-width: 768px) 480px, 320px"
              className="h-auto w-full invert"
            />
          </div>
          {/* Nome próprio de lugar: igual nos três idiomas. */}
          <p className="mt-8 text-center font-dado text-[11px] tracking-[0.06em] text-fuligem-20">
            Serra da Canastra · Minas Gerais
          </p>
        </div>
      </div>
    </footer>
  );
}
