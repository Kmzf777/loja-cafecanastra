"use client";

import Image from "next/image";
import Link from "next/link";
import { formatarPreco, precoParaLeitor } from "@/lib/catalogo/repositorio";
import { COR_DA_LINHA } from "@/lib/catalogo/rotulos";
import { Botao } from "@/components/ui/Botao";
import { useAdicionarNaSacola } from "@/lib/sacola/usar-adicionar";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";
import type { ProdutoVendavel } from "@/lib/catalogo/tipos";

/**
 * O CARD DE UM SKU — a unidade de venda da home nova.
 *
 * O `<CardCafe>` ao lado mostra a LINHA e diz "a partir de R$ X", porque
 * agrupa todas as variantes dela. Este mostra UM SKU comprável e por isso diz
 * o PREÇO EXATO, com botão de adicionar: numa home cuja tarefa é vender, um
 * "a partir de" é um segundo clique antes de qualquer número verdadeiro.
 *
 * A LINGUAGEM VISUAL É A MESMA DO CARD IRMÃO de propósito — filete de 1px,
 * fita da cor da embalagem no topo, deslocamento de 4px com sombra sólida,
 * raio zero. Os dois dividem a home e a PLP; dois vocabulários na mesma
 * rolagem leriam como dois sites.
 *
 * A FOTO É A DA LINHA. Os SKUs não têm arte própria no acervo (§8 do
 * estetica.md segue como caminho crítico), e inventar uma seria pior que
 * reusar a real.
 */

export function CardProduto({
  produto,
  locale = LOCALE_PADRAO,
}: {
  /**
   * Já com preço, estoque e `produtoId` do banco — é o que `produtosDaHome()`
   * devolve. NÃO aceita o produto cru do JSON de propósito: aquele não tem
   * `produtoId`, e um card montado a partir dele responderia "não deu para
   * falar com a loja" em todo clique. O tipo é a trava disso.
   */
  produto: ProdutoVendavel;
  locale?: Locale;
}) {
  const d = dicionario(locale);
  const corDaLinha = COR_DA_LINHA[produto.linha];
  const indisponivel = produto.estoque <= 0 || produto.preco <= 0;

  /**
   * O NOME NA SACOLA É EM PORTUGUÊS, SEMPRE — mesma decisão de
   * `nomeDoKitNaSacola` e do `PainelCompra`. Este texto não é tela: fica
   * gravado no localStorage, volta na sessão seguinte e vira `item_name` no
   * GA4. Um relatório com o mesmo SKU em três idiomas é o mesmo produto
   * contado três vezes.
   */
  const nomeNaSacola = `${produto.nome.split(" - ")[0]} — ${produto.rotuloEmbalagem}`;

  const { adicionado, erro, noTeto, aoAdicionar } = useAdicionarNaSacola({
    /**
     * O `produtoId` CHEGA PRONTO, e é a Task 5B que o põe aqui: quem monta a
     * lista da home é `produtosDaHome()`, que casa cada SKU com o banco antes
     * de o card existir. Continua opcional no tipo porque a contingência é
     * real — API fora, a vitrine fica de pé com o JSON versionado e sem id
     * nenhum —, e nesse caso o hook avisa em vez de fingir que guardou.
     */
    produtoId: produto.produtoId,
    skuLoja: produto.skuLoja,
    nomeNaSacola,
    rotuloGravado: produto.rotuloEmbalagem,
    precoCentavos: produto.preco,
    estoque: produto.estoque,
    imagem: produto.imagem,
  });

  /**
   * "Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas" é nome
   * de catálogo de loja, não título de card. O que interessa a quem está
   * escolhendo é a LINHA e o FORMATO — o resto vive no rótulo de embalagem
   * logo abaixo.
   */
  const nomeDaLinha = d.catalogo.linha[produto.linha];
  const formato = d.catalogo.formato[produto.formato];

  /**
   * `gramas` é OPCIONAL, e a ausência não é descuido: drip e cápsula não se
   * vendem por peso, e escrever "undefined g" num card é pior que não dizer o
   * peso. Quando falta, o card se cala sobre a gramatura e o `formato` acima
   * já diz do que se trata.
   */
  const peso = produto.gramas
    ? produto.gramas === 1000
      ? "1 kg"
      : `${produto.gramas} g`
    : null;

  return (
    <article className="group flex h-full flex-col border border-fuligem-20 bg-cal-puro transition-[box-shadow,border-color,transform] duration-[320ms] ease-canastra hover:-translate-x-1 hover:-translate-y-1 hover:border-vermelho hover:shadow-[4px_4px_0_var(--color-fuligem)]">
      {/* Fita da linha: a cor vem da embalagem, nunca inventada (§4.1). */}
      <span
        aria-hidden
        className="block h-1 w-full"
        style={{ backgroundColor: corDaLinha }}
      />

      <Link
        href={href(locale, `/cafes/${produto.linha}`)}
        className="focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <div className="relative aspect-square overflow-hidden">
          <Image
            src={produto.imagem}
            alt=""
            aria-hidden
            width={500}
            height={500}
            sizes="(min-width: 1024px) 26vw, (min-width: 640px) 38vw, 58vw"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="border-t border-fuligem-20 px-4 pt-4">
          <h3 className="text-[17px] font-semibold leading-tight">
            {nomeDaLinha}
          </h3>
          <p className="mt-1 text-[13px] text-fuligem-55">
            {formato}
            {peso ? (
              <>
                <span aria-hidden> · </span>
                <span className="font-dado">{peso}</span>
              </>
            ) : null}
          </p>
        </div>
      </Link>

      <div className="mt-auto flex flex-col gap-3 px-4 pb-4 pt-3">
        {indisponivel ? (
          <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
            {d.comum.esgotado}
          </span>
        ) : (
          <span
            className="font-dado text-[18px]"
            aria-label={precoParaLeitor(produto.preco)}
          >
            {formatarPreco(produto.preco)}
          </span>
        )}

        <Botao
          variante="primario"
          disabled={indisponivel}
          onClick={() =>
            aoAdicionar({
              semLoja: d.venda.semLoja,
              falhou: d.venda.naoDeuParaAdicionar,
            })
          }
          className="w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
        >
          {indisponivel
            ? d.comum.esgotado
            : adicionado
              ? d.venda.naSacola
              : d.venda.adicionarASacola}
        </Botao>

        {/* Genérico, não `venda.kit.*`: este card vende pacote, e quem usa
            leitor de tela ouviria "Kit adicionado" ao comprar 250 g. */}
        <p role="status" aria-live="polite" className="sr-only">
          {adicionado ? d.comum.adicionadoASacola : ""}
        </p>

        {erro ? (
          <p role="alert" className="text-[13px] text-vermelho">
            {erro}
          </p>
        ) : null}

        {/* Bater no teto não é erro, é o estoque real — por isso status e não alert. */}
        {noTeto ? (
          <p role="status" className="text-[13px] text-fuligem-55">
            {d.comum.noTetoDoEstoque}
          </p>
        ) : null}
      </div>
    </article>
  );
}
