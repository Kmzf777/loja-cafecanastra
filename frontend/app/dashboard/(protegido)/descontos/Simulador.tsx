"use client";

import { useState } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import { formatarCentavos } from "@/lib/painel/dinheiro";
import {
  MEIOS_DE_PAGAMENTO,
  NOME_DO_MEIO,
  type ProdutoDoSeletor,
  type RespostaDaSimulacao,
} from "@/lib/painel/descontos/contrato";
import {
  montarPayload,
  type FormularioDeDesconto,
} from "@/lib/painel/descontos/formulario.logica";
import {
  CARRINHO_VAZIO,
  ITEM_VAZIO,
  fraseDoResultado,
  itemDoProduto,
  montarCarrinho,
  resumoDaSimulacao,
  rotuloDoProduto,
  subtotalDoCarrinho,
  validarCarrinho,
  type CarrinhoNoSimulador,
  type ItemNoSimulador,
} from "@/lib/painel/descontos/simulador.logica";

import { simularDesconto } from "./acoes";
import { LinhaRemovivel, Marcador, Selecao } from "./campos";

/**
 * O simulador de carrinho — a coisa que nenhuma das plataformas pesquisadas faz.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE EXISTE. Regra de desconto é onde o erro custa dinheiro real, e
 * ele custa em silêncio: um percentual digitado com uma casa a mais só aparece
 * no extrato, dias depois, depois de a campanha ter rodado. A única defesa
 * honesta é mostrar o resultado ANTES de salvar — "num carrinho com 2× Clássico
 * 250g = R$ 120, esta regra desconta R$ 12,00".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE CHAMA O MOTOR DE VERDADE, e isto é a decisão mais importante do arquivo.
 *
 * A conta é de `backend/src/utils/motor.js` — a mesma função que o checkout usa
 * para cobrar, com os mesmos 27 casos de tabela-verdade. Reimplementá-la aqui
 * daria duas cópias, e duas cópias divergem: precedência entre classes,
 * exclusividade por grupo, rateio do teto pelo método do maior resto,
 * arredondamento em centavos. Bastaria uma delas ficar para trás e a conta que
 * o gestor vê deixaria de ser a que a loja cobra — um simulador que mente é
 * pior que simulador nenhum, porque autoriza a publicar a regra.
 *
 * A ÚNICA aritmética deste arquivo é a soma do carrinho (preço × quantidade),
 * que é o enunciado da pergunta e não a resposta dela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE NÃO SIMULA SOZINHO. Não há `useEffect` disparando a cada tecla: o gestor
 * clica em "Simular". Duas razões — a rota vai ao banco buscar catálogo e
 * montar a regra em memória, e simular a cada dígito de "1", "12", "120" daria
 * três respostas das quais duas estão erradas por definição. R14 vale aqui:
 * dinheiro não usa interface otimista, e o pior estado não é lento, é "não sei
 * se aconteceu".
 */

const RESUMO = "flex items-baseline justify-between gap-4 py-1.5 text-[13px]";

export function Simulador({
  forma,
  produtos,
}: {
  forma: FormularioDeDesconto;
  produtos: ProdutoDoSeletor[];
}) {
  const [carrinho, setCarrinho] = useState<CarrinhoNoSimulador>(CARRINHO_VAZIO);
  const [resposta, setResposta] = useState<RespostaDaSimulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [tentou, setTentou] = useState(false);

  const errosDeVerdade = validarCarrinho(carrinho);
  const erros = tentou ? errosDeVerdade : {};
  const subtotal = subtotalDoCarrinho(carrinho);

  function mudarItem(indice: number, mudanca: Partial<ItemNoSimulador>) {
    /* O RESULTADO MORRE A CADA MUDANÇA DO CARRINHO. Deixá-lo na tela enquanto
       o carrinho muda seria a pior coisa que este componente poderia fazer: o
       gestor trocaria a quantidade, leria o número antigo e concluiria que a
       regra desconta o que ela não desconta. Um simulador desatualizado mente
       com mais autoridade do que um simulador vazio. */
    setResposta(null);
    setCarrinho((atual) => ({
      ...atual,
      itens: atual.itens.map((item, i) => (i === indice ? { ...item, ...mudanca } : item)),
    }));
  }

  function mudarCarrinho(mudanca: Partial<CarrinhoNoSimulador>) {
    setResposta(null);
    setCarrinho((atual) => ({ ...atual, ...mudanca }));
  }

  async function simular() {
    setTentou(true);
    if (Object.keys(validarCarrinho(carrinho)).length) {
      setErro("Confira o carrinho de teste — a simulação não foi feita.");
      return;
    }

    setSimulando(true);
    setErro(null);
    setResposta(null);
    try {
      const resultado = await simularDesconto(montarPayload(forma), montarCarrinho(carrinho));
      if (!resultado.ok) {
        // A FRASE DO SERVIDOR SOBE INTEIRA. Enquanto a rota de simulação não
        // existir no Express, o que chega aqui é o 404 — e é exatamente isso
        // que o gestor precisa ler, em vez de "não deu certo".
        setErro(resultado.erro);
        return;
      }
      setResposta(resultado.dados);
    } finally {
      setSimulando(false);
    }
  }

  const resumo = resposta ? resumoDaSimulacao(resposta) : null;

  return (
    <Ficha titulo="Simulador de carrinho">
      <div className="space-y-4">
        <p className="text-[13px] text-fuligem-55">
          Monte um carrinho de mentira e veja quanto ESTA regra — do jeito que
          está no formulário agora, salva ou não — desconta nele. A conta é a do
          motor que cobra no checkout, não uma cópia.
        </p>

        {/* ---------------------------------------------------------------- *
            Os itens
         * ---------------------------------------------------------------- */}
        <div className="border-t border-fuligem-20 pt-1">
          <p className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>Itens</p>

          {carrinho.itens.map((item, i) => (
            <LinhaRemovivel
              key={i}
              oQue={`item ${i + 1} do carrinho de teste`}
              aoRemover={() =>
                mudarCarrinho({ itens: carrinho.itens.filter((_, j) => j !== i) })
              }
            >
              <Selecao
                rotulo="Produto"
                className="min-w-[180px] flex-1"
                value={item.produtoId}
                onChange={(e) => {
                  const escolhido = produtos.find((p) => p.product_id === e.target.value);
                  /* O PRODUTO É ESCOLHIDO NUMA LISTA, NUNCA DIGITADO. É item do
                     checklist de paridade: no painel legado o UUID ia à mão, e
                     "um caractere errado apontava para produto nenhum, sem erro
                     em lugar algum". Escolher preenche preço, SKU e categoria
                     de uma vez — que é o que a regra vai comparar. */
                  mudarItem(i, escolhido ? itemDoProduto(escolhido) : { produtoId: "" });
                }}
                opcoes={[
                  { valor: "", rotulo: "Item avulso (digitar preço)" },
                  ...produtos.map((p) => ({
                    valor: p.product_id,
                    rotulo: rotuloDoProduto(p),
                  })),
                ]}
              />
              <Campo
                rotulo="Preço unitário (R$)"
                className="w-[130px]"
                inputMode="decimal"
                value={item.precoReais}
                erro={erros[`itens.${i}.precoReais`] ?? null}
                onChange={(e) => mudarItem(i, { precoReais: e.target.value })}
              />
              <Campo
                rotulo="Qtd."
                className="w-[80px]"
                inputMode="numeric"
                value={item.quantidade}
                erro={erros[`itens.${i}.quantidade`] ?? null}
                onChange={(e) => mudarItem(i, { quantidade: e.target.value })}
              />
            </LinhaRemovivel>
          ))}

          <Botao
            variante="secundaria"
            className="mt-2"
            onClick={() => mudarCarrinho({ itens: [...carrinho.itens, { ...ITEM_VAZIO }] })}
          >
            Acrescentar item
          </Botao>
        </div>

        {/* ---------------------------------------------------------------- *
            O contexto do carrinho
         * ---------------------------------------------------------------- */}
        <div className="grid gap-3 border-t border-fuligem-20 pt-4 sm:grid-cols-2">
          <Selecao
            rotulo="Meio de pagamento"
            value={carrinho.meioPagamento}
            onChange={(e) =>
              mudarCarrinho({ meioPagamento: e.target.value as typeof carrinho.meioPagamento })
            }
            /* "Não informado" é o padrão e NÃO é o mesmo que "qualquer": uma
               regra com meio de pagamento exigido não se aplica quando o meio é
               desconhecido, e o simulador precisa poder reproduzir isso. */
            ajuda="Não informado reproduz o carrinho antes de o cliente escolher como paga."
            opcoes={[
              { valor: "", rotulo: "Não informado" },
              ...MEIOS_DE_PAGAMENTO.map((m) => ({ valor: m, rotulo: NOME_DO_MEIO[m] })),
            ]}
          />
          <Campo
            rotulo="Frete cotado (R$)"
            inputMode="decimal"
            value={carrinho.freteReais}
            erro={erros.freteReais ?? null}
            ajuda="Em branco = frete ainda não cotado; a regra de frete nem chega a rodar."
            onChange={(e) => mudarCarrinho({ freteReais: e.target.value })}
          />
          <Campo
            rotulo="UF de entrega"
            maxLength={2}
            value={carrinho.freteUf}
            onChange={(e) => mudarCarrinho({ freteUf: e.target.value.toUpperCase() })}
          />
          <Campo
            rotulo="CEP de entrega"
            inputMode="numeric"
            value={carrinho.freteCep}
            erro={erros.freteCep ?? null}
            ajuda="Com ou sem hífen."
            onChange={(e) => mudarCarrinho({ freteCep: e.target.value })}
          />
          <Marcador
            rotulo="É a modalidade de frete mais barata"
            checked={carrinho.freteEhMaisBarata}
            onChange={(e) => mudarCarrinho({ freteEhMaisBarata: e.target.checked })}
          />
          <Marcador
            rotulo="Cliente é assinante do Clube"
            checked={carrinho.assinante}
            onChange={(e) => mudarCarrinho({ assinante: e.target.checked })}
          />
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-fuligem-20 pt-4">
          <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
            Subtotal do carrinho de teste
          </span>
          <span data-dado className="text-[15px]">
            {formatarCentavos(subtotal)}
          </span>
        </div>

        <Botao onClick={simular} disabled={simulando} className="w-full">
          {simulando ? "Simulando…" : "Simular"}
        </Botao>

        {/* ---------------------------------------------------------------- *
            O resultado
         * ---------------------------------------------------------------- */}
        {erro && <Tarja tom="erro">{erro}</Tarja>}

        {resposta && resumo && (
          <div className="border-t border-fuligem-20 pt-4">
            {/* A FRASE PRIMEIRO, A TABELA DEPOIS. Uma tabela de ajustes
                responde "o quê" e não responde "e daí"; a frase é o que o
                gestor lê em voz alta para conferir se é o que ele quis. */}
            <p className="text-[15px] leading-snug">
              {fraseDoResultado(carrinho, produtos, resposta)}
            </p>

            {resumo.semEfeito ? (
              /* ZERO AJUSTES É UM ESTADO PRÓPRIO, e não "R$ 0,00". Os dois
                 parecem a mesma coisa e não são: um diz "a regra rodou e não
                 achou nada para descontar", e é essa informação que manda o
                 gestor olhar o escopo, o mínimo ou o meio de pagamento. */
              <Tarja tom="alerta">
                A regra não alcançou nada neste carrinho. Confira escopo, mínimo,
                meio de pagamento e — se ela for de frete — se o frete foi cotado.
              </Tarja>
            ) : (
              <ul className="mt-3">
                {resumo.linhas.map((linha) => (
                  <li key={linha.chave} className={`${RESUMO} border-b border-fuligem-20`}>
                    <span className="min-w-0">
                      {linha.rotulo}
                      <span className="block text-[11px] text-fuligem-55">{linha.detalhe}</span>
                    </span>
                    <span data-dado className="shrink-0">
                      {linha.valor}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-3 border-t border-fuligem-20 pt-3">
              <div className={RESUMO}>
                <dt className="text-fuligem-55">Subtotal</dt>
                <dd data-dado>{resumo.subtotalAntes}</dd>
              </div>
              <div className={RESUMO}>
                <dt className="text-fuligem-55">Desconto</dt>
                <dd data-dado>− {resumo.descontoTotal}</dd>
              </div>
              {resumo.freteDepois !== null && (
                <div className={RESUMO}>
                  <dt className="text-fuligem-55">Frete depois da regra</dt>
                  <dd data-dado>{resumo.freteDepois}</dd>
                </div>
              )}
              <div className={`${RESUMO} border-t border-fuligem-20 pt-2 font-semibold`}>
                <dt>Total</dt>
                <dd data-dado className="text-[15px]">
                  {resumo.totalDepois}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-[12px] text-fuligem-55">
              A simulação considera só ESTA regra. No carrinho de verdade, outras
              regras vigentes podem somar ou se excluir com ela — a ordem é
              produto, depois pedido, depois frete.
            </p>
          </div>
        )}
      </div>
    </Ficha>
  );
}
