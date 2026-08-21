"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { clienteNavegador } from "@/lib/supabase/cliente";
import {
  ErroDeAvaliacao,
  enviarAvaliacao,
  minhasAvaliacoes,
} from "@/lib/avaliacoes/avaliacoes";

/**
 * "Avalie seus cafés" — aparece na página do pedido quando ele está ENTREGUE.
 *
 * O pedido guarda `itens` com `product_id` e SEM sku (formato do checkout);
 * a avaliação é gravada por SKU. A ponte é `produtos_publicos` (leitura
 * pública via PostgREST): `product_id -> sku`. Item cujo produto saiu do
 * catálogo não resolve SKU e não ganha formulário — a mesma regra do
 * `pode_avaliar` no banco, que também deixa de casar o join.
 *
 * Já avaliados somem da lista (`minhasAvaliacoes`); se ela falhar, o
 * formulário aparece mesmo assim e o banco recusa duplicata com 23505
 * traduzido — degradar para "um formulário a mais" é melhor que esconder.
 *
 * Acessibilidade: a nota é um grupo de RADIOS de verdade (fieldset + legend,
 * um label por estrela com texto para leitor de tela, setas do teclado
 * funcionam de graça); o sucesso é anunciado em `role="status"` (aria-live).
 */

type ItemAvaliavel = { productId: string; nome: string };

type Props = { itens: ItemAvaliavel[] };

type Avaliavel = { sku: string; nome: string };

function FormularioDeAvaliacao({ sku, nome }: Avaliavel) {
  const [nota, setNota] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (enviado) {
    return (
      <div className="border border-fuligem-20 p-5">
        <p className="text-[14px] font-semibold">{nome}</p>
        <p role="status" className="mt-2 text-[15px] text-fuligem-80">
          Obrigado — sua avaliação aparece depois de aprovada.
        </p>
      </div>
    );
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (enviando) return;
    if (nota === 0) {
      setErro("Escolha uma nota de 1 a 5.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await enviarAvaliacao({ sku, nota, titulo, texto });
      setEnviado(true);
    } catch (falha) {
      setErro(
        falha instanceof ErroDeAvaliacao
          ? falha.message
          : "Não foi possível enviar sua avaliação agora. Tente de novo em instantes.",
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="border border-fuligem-20 p-5">
      <p className="text-[14px] font-semibold">{nome}</p>

      <fieldset className="mt-3">
        <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Sua nota
        </legend>
        <div className="mt-2 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((valor) => (
            <label key={valor} className="cursor-pointer">
              <input
                type="radio"
                name={`nota-${sku}`}
                value={valor}
                checked={nota === valor}
                onChange={() => {
                  setNota(valor);
                  setErro(null);
                }}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={`block px-1 text-[22px] leading-none transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vermelho ${
                  valor <= nota ? "text-vermelho" : "text-fuligem-20"
                }`}
              >
                ★
              </span>
              <span className="sr-only">
                {valor} {valor === 1 ? "estrela" : "estrelas"}
              </span>
            </label>
          ))}
          <span className="ml-2 font-dado text-[13px] text-fuligem-55">
            {nota > 0 ? `${nota} de 5` : "escolha"}
          </span>
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Título (opcional)
        </span>
        <input
          type="text"
          maxLength={80}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ex.: Doce e encorpado"
          className="mt-1 w-full rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermelho"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
          Conte o que achou (opcional)
        </span>
        <textarea
          rows={3}
          maxLength={2000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="mt-1 w-full rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermelho"
        />
      </label>

      {erro ? (
        <p
          role="alert"
          className="mt-3 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
        >
          {erro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="mt-4 h-12 bg-vermelho px-6 text-[13px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-vermelho-esc focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-fuligem disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Enviar avaliação"}
      </button>
    </form>
  );
}

export function AvaliarPedido({ itens }: Props) {
  const [avaliaveis, setAvaliaveis] = useState<Avaliavel[] | null>(null);
  const [jaAvaliados, setJaAvaliados] = useState(0);

  // Um product_id só entra uma vez, mesmo que o pedido repita o item.
  const unicos = useMemo(() => {
    const porId = new Map<string, ItemAvaliavel>();
    for (const item of itens) {
      if (item.productId && !porId.has(item.productId)) {
        porId.set(item.productId, item);
      }
    }
    return [...porId.values()];
  }, [itens]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const supabase = clienteNavegador();
        const [produtos, minhas] = await Promise.all([
          supabase
            .from("produtos_publicos")
            .select("produto_id, sku")
            .in(
              "produto_id",
              unicos.map((i) => i.productId),
            ),
          minhasAvaliacoes(),
        ]);
        if (!vivo) return;
        if (produtos.error) {
          setAvaliaveis([]);
          return;
        }

        const skuPorProduto = new Map(
          (produtos.data ?? [])
            .filter((p) => p.sku)
            .map((p) => [p.produto_id, p.sku as string]),
        );
        const avaliadosPorSku = new Set(minhas.map((m) => m.sku));

        let avaliados = 0;
        const lista: Avaliavel[] = [];
        for (const item of unicos) {
          const sku = skuPorProduto.get(item.productId);
          if (!sku) continue; // produto fora do catálogo: sem formulário.
          if (avaliadosPorSku.has(sku)) {
            avaliados += 1;
            continue;
          }
          lista.push({ sku, nome: item.nome });
        }
        setJaAvaliados(avaliados);
        setAvaliaveis(lista);
      } catch {
        if (vivo) setAvaliaveis([]);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [unicos]);

  // Carregando ou sem nada que dê para avaliar E sem histórico: silêncio —
  // a página do pedido nunca quebra (nem enche) por causa desta seção.
  if (!avaliaveis) return null;
  if (avaliaveis.length === 0 && jaAvaliados === 0) return null;

  return (
    <section className="mt-12 max-w-[720px]">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
        Avalie seus cafés
      </h2>

      {avaliaveis.length === 0 ? (
        <p className="mt-4 text-[15px] text-fuligem-80">
          Você já avaliou os cafés deste pedido — obrigado.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {avaliaveis.map((a) => (
            <FormularioDeAvaliacao key={a.sku} sku={a.sku} nome={a.nome} />
          ))}
        </div>
      )}
    </section>
  );
}
