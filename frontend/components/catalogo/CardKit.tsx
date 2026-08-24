"use client";

import Image from "next/image";
import type { Kit } from "@/lib/catalogo/tipos";
import {
  formatarPreco,
  precoParaLeitor,
} from "@/lib/catalogo/repositorio";
import { COR_DA_LINHA, rotuloDaEmbalagem } from "@/lib/catalogo/rotulos";
import { nomeDoKitNaSacola, traduzirKit } from "@/lib/catalogo/produtos";
import { Botao } from "@/components/ui/Botao";
import { useAdicionarNaSacola } from "@/lib/sacola/usar-adicionar";
import { dicionario } from "@/lib/i18n/dicionario";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";

/**
 * Card de kit — a seção "Kits e caixas" da PLP.
 *
 * Os kits existiam no catálogo desde a captura da loja e não tinham NENHUMA
 * superfície de venda: `KITS` era um export que ninguém consumia. Este card os
 * põe à venda com as mesmas regras do PainelCompra da PDP:
 *
 *  - esgotado (ou sem preço na loja) aparece DESABILITADO com aviso — sumir
 *    com produto é pior do que dizer que acabou;
 *  - sem `produtoId` (API fora, vitrine de pé só com o JSON) o botão avisa em
 *    vez de fingir que guardou;
 *  - sucesso confirma no rótulo, anuncia em aria-live e dispara `add_to_cart`.
 *
 * Client component porque adicionar à sacola é estado do navegador; a lista de
 * kits em si chega pronta do Server Component da PLP.
 */

export function CardKit({
  kit: kitCru,
  locale = LOCALE_PADRAO,
}: {
  kit: Kit;
  /**
   * O idioma da PLP, com o MESMO contrato do <CardCafe> ao lado — os dois
   * dividem a mesma grade e o mesmo `locale` da página. Este card era o único
   * dos dois que não o recebia, e por isso a seção "Kits e caixas" de
   * /en/cafes vendia em português no meio de uma página em inglês.
   *
   * O padrão existe pelo mesmo motivo do card irmão: há chamador sem rota
   * (o teste, e o dia em que um kit aparecer numa tela sem `params`).
   */
  locale?: Locale;
}) {
  const d = dicionario(locale);
  /**
   * O KIT CHEGA CRU E É TRADUZIDO AQUI, e é o único lugar onde isso pode
   * acontecer: `listarKits()` no repositório não conhece idioma (aquela camada
   * casa preço e estoque com o banco) e a PLP entrega a lista como veio. O
   * card é a única superfície do kit no site inteiro, e ele já recebe o
   * `locale`.
   *
   * A ORDEM É A MESMA DA PDP — comercial primeiro, texto depois: o kit que
   * chega aqui já traz o preço e o `produtoId` do banco, e `traduzirKit` só
   * sobrepõe o nome. Traduzir antes de o repositório falar devolveria o preço
   * do JSON a quem trocasse de idioma.
   */
  const kit = traduzirKit(kitCru, locale);

  // "Café Especial Canastra X - Caixa com..." → título e complemento. O nome
  // capturado da loja embute o conteúdo depois do hífen; quebrado em dois, o
  // card lê como etiqueta em vez de frase corrida. O " - " é parte do nome e
  // por isso as traduções o mantêm — sem ele o card perderia o complemento e
  // ficaria com um título de uma linha e meia.
  const [titulo, ...resto] = kit.nome.split(" - ");
  const complemento = resto.join(" - ");

  /**
   * O RÓTULO TEM DUAS FORMAS, E A SEPARAÇÃO É A REGRA DA CASA.
   *
   * `rotuloNaTela` fala o idioma da página. O que vai para a SACOLA continua em
   * português — ver `nomeDoKitNaSacola` e `rotuloDaEmbalagem`, onde a razão
   * está escrita: aquele texto fica gravado e vira dimensão de relatório, e é a
   * mesma decisão que o `PainelCompra` documenta para a moagem.
   */
  const rotuloNaTela = rotuloDaEmbalagem(kit, locale);
  const nomeNaSacola = nomeDoKitNaSacola(kit);

  const indisponivel = kit.estoque === 0 || kit.preco <= 0;
  const fita = COR_DA_LINHA[kit.linha];

  /**
   * A regra de compra vive em `lib/sacola/usar-adicionar.ts` desde que a home
   * passou a vender SKU avulso e o `CardProduto` precisou da mesma coisa. O
   * que era corpo deste componente virou função provável; o teste ao lado não
   * mudou uma linha, e é ele que prova que a mudança não mexeu no que a
   * pessoa vê.
   */
  const {
    adicionado,
    erro: erroDaSacola,
    noTeto,
    aoAdicionar,
  } = useAdicionarNaSacola({
    produtoId: kit.produtoId,
    skuLoja: kit.skuLoja,
    nomeNaSacola,
    // Gravado, e portanto em português — ver `nomeDoKitNaSacola`.
    rotuloGravado: kitCru.rotuloEmbalagem,
    precoCentavos: kit.preco,
    estoque: kit.estoque,
    imagem: kit.imagem,
  });

  return (
    <article className="flex h-full flex-col border border-fuligem-20 bg-cal-puro">
      {/* Fita da linha dominante — a cor vem da embalagem, nunca inventada. */}
      <span aria-hidden className="block h-1 w-full" style={{ backgroundColor: fita }} />

      <div className="flex flex-1 gap-4 p-5">
        <div className="w-24 shrink-0 sm:w-28">
          <Image
            src={kit.imagem}
            alt=""
            aria-hidden
            width={500}
            height={500}
            sizes="112px"
            className="aspect-square w-full border border-fuligem-20 object-cover"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-[17px] font-semibold leading-tight">{titulo}</h3>
          {complemento ? (
            <p className="mt-1 text-[13px] text-fuligem-55">{complemento}</p>
          ) : null}
          <p className="mt-1.5 text-[13px] text-fuligem-55">
            {rotuloNaTela}
            {kit.unidades ? (
              <>
                <span aria-hidden> · </span>
                <span className="font-dado">{kit.unidades}</span>{" "}
                {d.venda.kit.unidades}
              </>
            ) : null}
          </p>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
            {indisponivel ? (
              <span className="text-[12px] uppercase tracking-[0.14em] text-fuligem-55">
                {d.comum.esgotado}
              </span>
            ) : (
              <span
                className="font-dado text-[17px]"
                aria-label={precoParaLeitor(kit.preco)}
              >
                {formatarPreco(kit.preco)}
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
              className="disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
            >
              {indisponivel
                ? d.comum.esgotado
                : adicionado
                  ? d.venda.naSacola
                  : d.venda.adicionarASacola}
            </Botao>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {adicionado ? d.venda.kit.adicionado : ""}
          </p>

          {erroDaSacola ? (
            <p role="alert" className="mt-3 text-[14px] text-vermelho">
              {erroDaSacola}
            </p>
          ) : null}

          {/* Discreto: bater no teto não é erro, é o estoque real. */}
          {noTeto ? (
            <p role="status" className="mt-3 text-[13px] text-fuligem-55">
              {d.venda.kit.noTeto}
            </p>
          ) : null}

          {indisponivel ? (
            <p role="status" className="mt-3 text-[13px] text-fuligem-55">
              {d.venda.kit.esgotado}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
