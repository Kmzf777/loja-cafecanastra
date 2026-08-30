"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Dialogo } from "@/components/painel/ui/Dialogo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO, FOCO_INTERNO } from "@/components/painel/ui/estilos";
import { formatarReais } from "@/lib/painel/dinheiro";
import {
  MODOS_DE_ESTOQUE,
  MODOS_DE_PRECO,
  aplicaveis,
  preverEstoques,
  preverPrecos,
  resumoDaSelecao,
  type ModoDeEstoque,
  type ModoDePreco,
} from "@/lib/painel/produtos/lote.logica";
import {
  POR_PAGINA,
  identificarProduto,
  medidaEhOPadrao,
  resumoDaCaixa,
  AVISO_SEM_SKU,
  temSku,
  urlDaTela,
  urlDoProduto,
  type EstadoDosProdutos,
  type ProdutoDoPainel,
} from "@/lib/painel/produtos/produtos.logica";

import { ajustarEstoqueEmLote, ajustarPrecoEmLote } from "./acoes";

/**
 * A LISTA DE PRODUTOS — e por que ela é uma ilha de cliente, quando a de
 * Clientes não é.
 *
 * Clientes é leitura pura: a tabela inteira é HTML do servidor e todo controle é
 * um `<a href>`. Aqui há duas coisas que só existem no navegador:
 *
 *  1. A SELEÇÃO EM MASSA do R25, que é estado efêmero por definição — marcar
 *     doze cafés não é um lugar para onde se volta, e pôr isso na URL encheria
 *     o histórico e o R2 de dado que não é filtro.
 *  2. A PRÉVIA DA EDIÇÃO EM LOTE, que é a defesa inteira do R6: preço e estoque
 *     nunca com autosave, porque "uma vírgula errada publica R$ 5,90 no lugar
 *     de R$ 59,00". A confirmação não pergunta "tem certeza?" — ela MOSTRA o
 *     `de → para` de cada linha antes de qualquer escrita.
 *
 * `Coluna.celula` É UMA FUNÇÃO, e função não atravessa a fronteira
 * Server→Client serializada. Por isso as colunas são declaradas AQUI e nunca na
 * `page.tsx`. Isso NÃO aparece no `next build` (as rotas do painel são
 * dinâmicas), só em execução, com a tela em branco — e `proibicoes.test.ts` tem
 * um `describe("a fronteira Server->Client")` que varre exatamente isso.
 */
export function ListaDeProdutos({
  linhas: doServidor,
  estado,
  totalDoFiltro,
  totalPaginas,
}: {
  linhas: ProdutoDoPainel[];
  /** O estado da URL, já lido e saneado pela `page.tsx`. Objeto simples: é DADO
   *  atravessando a fronteira, nunca função. */
  estado: EstadoDosProdutos;
  /** Quantos produtos o FILTRO alcança no servidor — não quantos estão na tela.
   *  É a metade da frase do R25. */
  totalDoFiltro: number;
  totalPaginas: number;
}) {
  const [marcados, setMarcados] = useState<string[]>([]);
  /**
   * A SELEÇÃO SE RENDE À LISTA — reconciliação por identidade de prop, sem
   * `useEffect` e sem `key`, o mesmo padrão de `BuscaDaLista`.
   *
   * Quando `revalidatePath` traz dados novos, o Server Component re-renderiza e
   * o array chega com outra identidade. Zerar é o certo: os produtos marcados
   * podem ter saído do filtro, e agir sobre uma seleção que se refere a uma
   * lista que já não existe é o defeito que o R25 inteiro combate.
   */
  const [ultimasDoServidor, setUltimasDoServidor] = useState(doServidor);
  if (doServidor !== ultimasDoServidor) {
    setUltimasDoServidor(doServidor);
    setMarcados([]);
  }

  const [lote, setLote] = useState<"preco" | "estoque" | null>(null);
  const [modoDePreco, setModoDePreco] = useState<ModoDePreco>("percentual");
  const [modoDeEstoque, setModoDeEstoque] = useState<ModoDeEstoque>("somar");
  const [valor, setValor] = useState("");
  const [aplicando, iniciar] = useTransition();
  const [erroDoLote, setErroDoLote] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const marcadosSet = new Set(marcados);
  const selecionadas = doServidor.filter((l) => marcadosSet.has(l.product_id));
  const todosMarcados = doServidor.length > 0 && marcados.length === doServidor.length;
  const algunsMarcados = marcados.length > 0 && !todosMarcados;

  function alternarLinha(id: string) {
    setMarcados((atuais) =>
      atuais.includes(id) ? atuais.filter((i) => i !== id) : [...atuais, id],
    );
  }

  function alternarPagina() {
    setMarcados(todosMarcados ? [] : doServidor.map((l) => l.product_id));
  }

  function abrirLote(qual: "preco" | "estoque") {
    setLote(qual);
    setValor("");
    setErroDoLote(null);
    setAviso(null);
  }

  const previsoes =
    lote === "preco"
      ? preverPrecos(selecionadas, modoDePreco, valor)
      : lote === "estoque"
        ? preverEstoques(selecionadas, modoDeEstoque, valor)
        : [];
  const vaoMudar = aplicaveis(previsoes);

  function aplicar() {
    const ajustes = vaoMudar.map((p) => ({ id: p.id, valor: p.para as number }));
    const nomes = Object.fromEntries(previsoes.map((p) => [p.id, p.nome]));
    const qual = lote;
    setLote(null);
    setErroDoLote(null);
    setAviso(null);

    iniciar(async () => {
      const r =
        qual === "preco"
          ? await ajustarPrecoEmLote(ajustes)
          : await ajustarEstoqueEmLote(ajustes, nomes);
      if (r.ok) setAviso(r.frase);
      else setErroDoLote(r.erro);
    });
  }

  const COLUNAS: Coluna<ProdutoDoPainel>[] = [
    {
      chave: "produto",
      rotulo: "Produto",
      /*
        R23 — a primeira coluna é o identificador HUMANO: nome e SKU, NUNCA o
        UUID. E o SKU não é enfeite de segunda linha: é a chave por onde a
        vitrine casa este registro com o catálogo editorial, então "Sem SKU" é
        literalmente "este café não aparece na loja".
      */
      celula: (linha) => (
        <Link
          href={urlDoProduto(linha.product_id)}
          className={`-mx-1 block min-w-0 px-1 py-0.5 ${FOCO_INTERNO}`}
        >
          <span className="block truncate text-[13px]">
            {identificarProduto(linha)}
          </span>
          {temSku(linha) ? (
            <span data-dado className="block truncate text-[12px] font-normal text-fuligem-55">
              {linha.sku}
            </span>
          ) : (
            /*
              A AUSÊNCIA DE SKU É UM SELO DE ERRO, e não texto pintado de
              vermelho. R21 reserva o vermelho a erro e destruição, e a forma
              que esta casa deu ao erro numa tabela é o <Selo>: a cor para no
              FILETE e o significado fica na PALAVRA — que é o que a WCAG 1.4.1
              exige e o que mantém o contraste do texto pequeno em ~16:1.

              E ele é um erro de verdade, não um campo em branco: a vitrine casa
              banco e catálogo editorial por SKU e DESCARTA quem não tem
              (`repositorio.ts`), então este café não chega à loja — o preço e o
              estoque digitados aqui não vão a lugar nenhum.
            */
            <span className="flex items-center gap-2 text-[12px] font-normal">
              <Selo tom="erro">Sem SKU</Selo>
              <span className="truncate text-fuligem-55">{AVISO_SEM_SKU}</span>
            </span>
          )}
        </Link>
      ),
    },
    {
      chave: "embalagem",
      rotulo: "Embalagem",
      celula: (linha) => linha.size || "—",
    },
    {
      chave: "categoria",
      rotulo: "Categoria",
      celula: (linha) => linha.category || "—",
    },
    {
      chave: "preco",
      rotulo: "Preço",
      dado: true,
      // REAIS, como string do `numeric` — `formatarReais`, nunca
      // `formatarCentavos`. Trocar as duas faz R$ 59,90 virar R$ 0,60.
      celula: (linha) => formatarReais(linha.price),
    },
    {
      chave: "estoque",
      rotulo: "Estoque",
      dado: true,
      // Zero é ZERO de verdade — produto esgotado —, e por isso não vira "—":
      // trocar um zero medido por um travessão apagaria a informação mais útil
      // desta coluna.
      celula: (linha) => linha.quantity ?? 0,
    },
    {
      chave: "caixa",
      rotulo: "Caixa",
      dado: true,
      /*
        A COLUNA QUE O PAINEL LEGADO NÃO TINHA, e é ela que torna o defeito
        visível sem abrir produto por produto.

        `ShippingController` monta a cotação com `weight/width/height/length`
        lidos do BANCO. O formulário legado mandava os quatro sem ter input para
        nenhum: `undefined` virava `"undefined"`, o backend caía nos padrões
        (0,3 kg / 20×5×20 cm) e a loja passava a cotar frete de uma caixa que
        não existia — sem nada na tela.

        O selo aparece quando OS QUATRO batem com os padrões ao mesmo tempo. Não
        é um erro: pode ser a medida real. É um sinal, e a palavra "Padrão" o
        diz — a cor sozinha nunca é o canal (WCAG 1.4.1).
      */
      celula: (linha) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span>{resumoDaCaixa(linha)}</span>
          {medidaEhOPadrao(linha) && (
            <Selo tom="alerta">
              <span aria-hidden="true">Padrão</span>
              <span className="sr-only">
                As quatro medidas estão nos valores padrão — confira se são as
                reais desta embalagem.
              </span>
            </Selo>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="min-w-0">
      <Ficha semPreenchimento className="min-w-0">
        <Tabela
          legenda="Produtos do catálogo"
          colunas={COLUNAS}
          linhas={doServidor}
          chaveDaLinha={(linha) => linha.product_id}
          /*
            NENHUMA COLUNA É ORDENÁVEL, e isso é honestidade e não esquecimento:
            `GET /dashboard` ordena por `destacado_em DESC` (ou por relevância,
            quando há busca) e não aceita parâmetro de ordenação. Um cabeçalho
            clicável que não ordena é pior que um cabeçalho quieto — e a
            `<Tabela>` desta casa só desenha a seta quando recebe `aoOrdenar`,
            justamente para isso não acontecer por distração.
          */
          selecao={{
            cabecalho: (
              <input
                type="checkbox"
                checked={todosMarcados}
                // O terceiro estado da caixa NÃO é uma prop do React: ele só
                // existe como propriedade do elemento. Sem ele, marcar três de
                // vinte deixaria a caixa do cabeçalho vazia, dizendo "nada
                // marcado" com três linhas marcadas na tela.
                ref={(el) => {
                  if (el) el.indeterminate = algunsMarcados;
                }}
                onChange={alternarPagina}
                aria-label={`Marcar os ${doServidor.length} produtos desta página`}
                className={`size-4 accent-fuligem ${FOCO}`}
              />
            ),
            celula: (linha) => (
              <input
                type="checkbox"
                checked={marcadosSet.has(linha.product_id)}
                onChange={() => alternarLinha(linha.product_id)}
                // O nome NOMEIA O OBJETO. "Selecionar" sozinho obriga quem não
                // vê a tela a adivinhar qual das vinte linhas está sob o cursor.
                aria-label={`Marcar ${identificarProduto(linha)}`}
                className={`size-4 accent-fuligem ${FOCO}`}
              />
            ),
          }}
        />
        {/* A PAGINAÇÃO MORA DENTRO DA FICHA, encostada na tabela — R17. Ela fica
            AQUI, e não na `page.tsx`, porque o `href` de cada página é uma
            FUNÇÃO, e função não atravessa a fronteira Server→Client. */}
        <Paginacao
          pagina={estado.pagina}
          totalPaginas={totalPaginas}
          porPagina={POR_PAGINA}
          total={totalDoFiltro}
          href={(pagina) => urlDaTela({ ...estado, pagina })}
          rotuloDoItem={{ singular: "produto", plural: "produtos" }}
        />
      </Ficha>

      {(erroDoLote || aviso) && (
        <div className="mt-3 space-y-2">
          {/* R9 — o resultado é TARJA PERSISTENTE, nunca um toast. Um placar de
              lote que some sozinho não pode ser relido por quem olhou tarde, e é
              justamente o placar que diz quais produtos ficaram de fora. */}
          {erroDoLote && <Tarja onFechar={() => setErroDoLote(null)}>{erroDoLote}</Tarja>}
          {aviso && (
            <Tarja tom="sucesso" onFechar={() => setAviso(null)}>
              {aviso}
            </Tarja>
          )}
        </div>
      )}

      {/*
        A BARRA DA SELEÇÃO — grudada no rodapé da janela, e só quando há algo
        marcado.

        `sticky` e não `fixed`: ela pertence à coluna de conteúdo, e uma barra
        fixa de ponta a ponta atravessaria o menu lateral. Ela nasce DEPOIS da
        tabela na árvore, então aparecer não empurra nenhuma linha — que é o que
        faria a linha sob o cursor sair de baixo do dedo no exato momento em que
        a pessoa está marcando linhas.
      */}
      {marcados.length > 0 && (
        <div className="sticky bottom-0 z-30 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cx border border-fuligem-20 bg-cal-puro px-4 py-3">
          {/*
            R25 — A FRASE QUE DISTINGUE "OS 20 DESTA PÁGINA" DOS "N DO FILTRO".
            Sem ela o gestor acha que reajustou 1.284 quando reajustou 20.
          */}
          <p role="status" className="min-w-0 flex-1 text-[13px]">
            {resumoDaSelecao(marcados.length, doServidor.length, totalDoFiltro)}
          </p>
          <Botao variante="secundaria" onClick={() => abrirLote("preco")} disabled={aplicando}>
            Ajustar preço
          </Botao>
          <Botao variante="secundaria" onClick={() => abrirLote("estoque")} disabled={aplicando}>
            Ajustar estoque
          </Botao>
          <Botao variante="secundaria" onClick={() => setMarcados([])} disabled={aplicando}>
            {aplicando ? "Aplicando…" : "Desmarcar"}
          </Botao>
        </div>
      )}

      <Dialogo
        aberto={lote !== null}
        aoMudar={(aberto) => !aberto && setLote(null)}
        titulo={lote === "preco" ? "Ajustar preço em lote" : "Ajustar estoque em lote"}
        /* R12 — o texto nomeia o OBJETO e a CONSEQUÊNCIA. "Tem certeza?" não
           carrega informação e treina a clicar em OK. */
        descricao={
          lote === "preco"
            ? "O preço novo vale na loja assim que salvar. Confira a lista antes de aplicar."
            : "O estoque novo vale na loja assim que salvar. Confira a lista antes de aplicar."
        }
        acoes={
          <>
            {/* R11 — o botão que confirma o estrago fica LONGE do canto onde o
                dedo repousa, com o "Cancelar" entre ele e o resto da tela. */}
            <Botao variante="secundaria" onClick={() => setLote(null)}>
              Cancelar
            </Botao>
            <Botao onClick={aplicar} disabled={vaoMudar.length === 0}>
              Aplicar a {vaoMudar.length}{" "}
              {vaoMudar.length === 1 ? "produto" : "produtos"}
            </Botao>
          </>
        }
      >
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
              O que fazer
            </legend>
            {(lote === "preco" ? MODOS_DE_PRECO : MODOS_DE_ESTOQUE).map((modo) => {
              const atual =
                lote === "preco"
                  ? modoDePreco === (modo.valor as ModoDePreco)
                  : modoDeEstoque === (modo.valor as ModoDeEstoque);
              return (
                <label key={modo.valor} className="flex min-h-11 items-start gap-2">
                  {/* `<input type="radio">` nativo, e não Radix: a spec §2.7 é
                      explícita ("nativo, não Radix" para caixa, rádio e select
                      simples) — o navegador já dá as setas, o agrupamento e o
                      nome de graça. */}
                  <input
                    type="radio"
                    name="modo-do-lote"
                    checked={atual}
                    onChange={() =>
                      lote === "preco"
                        ? setModoDePreco(modo.valor as ModoDePreco)
                        : setModoDeEstoque(modo.valor as ModoDeEstoque)
                    }
                    className={`mt-3.5 size-4 accent-fuligem ${FOCO}`}
                  />
                  <span className="min-w-0 py-2.5">
                    <span className="block text-[13px]">{modo.rotulo}</span>
                    <span className="block text-[12px] text-fuligem-55">{modo.ajuda}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <Campo
            rotulo={lote === "preco" ? "Valor" : "Quantidade"}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            /*
              `onWheel` DEVOLVE O FOCO — a roda do mouse não pode mexer em preço.
              Num `<input type="number">` focado, rolar a página altera o valor,
              e o gestor que rola a lista com o cursor em cima do campo muda o
              preço sem tocar em nada. O campo aqui é `text` com `inputMode`
              decimal, o que já fecha essa porta; o `onWheel` fica como cinto de
              segunda ordem para o dia em que alguém o trocar por `number`.
            */
            onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
            placeholder={lote === "preco" && modoDePreco === "percentual" ? "-10" : ""}
          />

          {/*
            A PRÉVIA — R6, e é ela que substitui a pergunta "tem certeza?".
            Enquanto não houver um número digitado, a lista está vazia e o botão
            de aplicar está travado: não há como confirmar um lote sem ver o
            lote.
          */}
          {previsoes.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-cx border border-fuligem-20">
              <ul className="divide-y divide-fuligem-20">
                {previsoes.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                    {p.para === null ? (
                      /* O motivo por escrito, na linha do produto: uma lista de
                         vinte com três recusadas sem dizer quais obriga a caçar,
                         que é o trabalho que o lote veio evitar. */
                      <span className="text-vermelho">{p.problema}</span>
                    ) : (
                      <span data-dado className="shrink-0">
                        <span className="text-fuligem-55">
                          {lote === "preco" ? formatarReais(p.de) : p.de}
                        </span>{" "}
                        <span aria-hidden="true">→</span>
                        <span className="sr-only">passa para</span>{" "}
                        <span className="font-medium">
                          {lote === "preco" ? formatarReais(p.para) : p.para}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialogo>
    </div>
  );
}
