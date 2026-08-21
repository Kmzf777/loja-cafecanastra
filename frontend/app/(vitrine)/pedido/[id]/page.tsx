"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BotaoLink } from "@/components/ui/Botao";
import { AvaliarPedido } from "@/components/conta/AvaliarPedido";
import { API_BASE, recuperarSessao, type Sessao } from "@/lib/conta/sessao";
import { formatarPreco } from "@/lib/catalogo/repositorio";

/**
 * A página do pedido — a URL que o cliente guarda.
 *
 * Antes o pedido só existia dentro da tela de confirmação do checkout (um
 * estado de React que morre no reload) e na lista da conta, sem detalhe. Aqui
 * ele ganha endereço permanente: o e-mail de status pode apontar para cá, o
 * cliente recarrega à vontade e o rastreio fica a um clique.
 *
 * Client component pela mesma razão da conta: a sessão vive no cookie do
 * Supabase e a API é chamada com Bearer. Sem sessão → login com `?de=` de
 * volta para cá.
 *
 * O CONTRATO: `GET /my-orders/:id` (dono autenticado) responde
 * `{ order: { order_id, status, total, timestamp, items, address_json,
 * shipping_cost, shipping_method, tracking_code, payment_method,
 * coupon_code?, discount? } }`. A leitura é TOLERANTE aos aliases da listagem
 * (`total_amount`, `created_at`): o endpoint é da onda 2-E e preferir quebrar
 * a degradar seria de graça — os dois nomes nunca coexistem com valores
 * diferentes.
 */

type ItemDoPedido = {
  product_id?: string;
  name?: string;
  image?: string;
  price?: string | number;
  quantity?: string | number;
  size?: string;
};

type Pedido = {
  order_id: string;
  status: string;
  totalReais: number;
  data: string | null;
  items: ItemDoPedido[];
  endereco: Record<string, unknown> | null;
  freteReais: number;
  metodoEnvio: string | null;
  rastreio: string | null;
  metodoPagamento: string | null;
  cupom: string | null;
  descontoReais: number;
};

/** Mesmo vocabulário da conta — o CHECK da migração 0009 é a lista. */
const STATUS: Record<string, string> = {
  pendente: "Aguardando pagamento",
  em_processamento: "Em análise",
  aprovado: "Pago",
  autorizado: "Autorizado",
  enviado: "Enviado",
  entregue: "Entregue",
  rejeitado: "Recusado",
  cancelado: "Cancelado",
  reembolsado: "Estornado",
};

/**
 * A linha do tempo feliz e onde cada status está nela. Status de desvio
 * (cancelado/rejeitado/reembolsado) não têm posição — a linha some e entra o
 * aviso, porque um "cancelado" pintado como quarta etapa de progresso leria
 * como conquista.
 */
const ETAPAS = ["Pedido recebido", "Pagamento aprovado", "Enviado", "Entregue"];
const POSICAO: Record<string, number> = {
  pendente: 0,
  em_processamento: 0,
  autorizado: 1,
  aprovado: 1,
  enviado: 2,
  entregue: 3,
};
const DESVIOS: Record<string, string> = {
  cancelado: "Este pedido foi cancelado.",
  rejeitado: "O pagamento foi recusado — nenhum valor foi cobrado.",
  reembolsado: "Este pedido foi estornado.",
};

const RASTREIO_CORREIOS =
  "https://rastreamento.correios.com.br/app/index.php?objeto=";

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resposta da API → o que a tela precisa, tolerante aos dois aliases. */
function interpretarPedido(json: unknown): Pedido | null {
  if (typeof json !== "object" || json === null) return null;
  const bruto = ((json as { order?: unknown }).order ?? json) as Record<
    string,
    unknown
  >;
  if (typeof bruto.order_id !== "string" || !bruto.order_id) return null;

  return {
    order_id: bruto.order_id,
    status: typeof bruto.status === "string" ? bruto.status : "pendente",
    totalReais: numero(bruto.total ?? bruto.total_amount),
    data:
      typeof (bruto.timestamp ?? bruto.created_at) === "string"
        ? String(bruto.timestamp ?? bruto.created_at)
        : null,
    items: Array.isArray(bruto.items) ? (bruto.items as ItemDoPedido[]) : [],
    endereco:
      typeof bruto.address_json === "object" && bruto.address_json !== null
        ? (bruto.address_json as Record<string, unknown>)
        : null,
    freteReais: numero(bruto.shipping_cost),
    metodoEnvio:
      typeof bruto.shipping_method === "string" ? bruto.shipping_method : null,
    rastreio:
      typeof bruto.tracking_code === "string" && bruto.tracking_code.trim()
        ? bruto.tracking_code.trim()
        : null,
    metodoPagamento:
      typeof bruto.payment_method === "string" ? bruto.payment_method : null,
    cupom: typeof bruto.coupon_code === "string" ? bruto.coupon_code : null,
    descontoReais: numero(bruto.discount),
  };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default function PaginaPedido() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "sumiu" | "erro">(
    "carregando",
  );

  useEffect(() => {
    let vivo = true;
    recuperarSessao().then((s) => {
      if (!vivo) return;
      if (!s) {
        router.replace(`/account/login?de=/pedido/${id}`);
        return;
      }
      setSessao(s);
    });
    return () => {
      vivo = false;
    };
  }, [router, id]);

  useEffect(() => {
    if (!sessao || !id) return;
    let vivo = true;
    fetch(`${API_BASE}/my-orders/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${sessao.accessToken}` },
    })
      .then(async (r) => {
        if (!vivo) return;
        if (r.status === 401) {
          // A sessão morreu entre a montagem e o fetch (token expirado, conta
          // deslogada em outra aba): o mesmo destino do caminho sem sessão —
          // login com volta para cá — em vez de um "erro" que não explica.
          router.replace(`/account/login?de=/pedido/${id}`);
          return;
        }
        if (r.status === 404 || r.status === 403) {
          // 403 também vira "não achamos": confirmar que o id EXISTE mas é de
          // outra pessoa seria vazar informação de pedido alheio.
          setEstado("sumiu");
          return;
        }
        if (!r.ok) {
          setEstado("erro");
          return;
        }
        const interpretado = interpretarPedido(await r.json());
        if (!vivo) return;
        if (interpretado) {
          setPedido(interpretado);
          setEstado("pronto");
        } else {
          setEstado("erro");
        }
      })
      .catch(() => vivo && setEstado("erro"));
    return () => {
      vivo = false;
    };
  }, [sessao, id, router]);

  if (!sessao || estado === "carregando") {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <p role="status" className="text-[15px] text-fuligem-55">
          Buscando seu pedido…
        </p>
      </div>
    );
  }

  if (estado === "sumiu" || estado === "erro" || !pedido) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
        <h1 className="font-titulo text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          {estado === "erro"
            ? "Não conseguimos abrir o pedido agora."
            : "Não achamos este pedido."}
        </h1>
        <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fuligem-80">
          {estado === "erro"
            ? "Tente de novo em instantes. Se continuar assim, fale com a gente pelo WhatsApp do rodapé."
            : "Confira o link — pedidos aparecem apenas para a conta que os fez."}
        </p>
        <div className="mt-8">
          <BotaoLink href="/account" variante="secundario">
            Ver meus pedidos
          </BotaoLink>
        </div>
      </div>
    );
  }

  const desvio = DESVIOS[pedido.status];
  const posicao = POSICAO[pedido.status] ?? 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Seu pedido
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2rem,4.5vw,3.25rem)] leading-[1] tracking-[-0.015em]">
        Pedido <span className="font-dado">{pedido.order_id.slice(0, 8)}</span>
      </h1>
      <p className="mt-3 text-[14px] text-fuligem-55">
        {pedido.data
          ? `Feito em ${new Date(pedido.data).toLocaleDateString("pt-BR")} · `
          : null}
        {STATUS[pedido.status] ?? pedido.status}
      </p>

      {/* ── Linha do tempo ─────────────────────────────────────────────── */}
      {desvio ? (
        <p
          role="status"
          className="mt-8 max-w-[52ch] border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[15px]"
        >
          {desvio}
        </p>
      ) : (
        <ol className="mt-8 grid max-w-[720px] grid-cols-2 gap-y-4 sm:grid-cols-4">
          {ETAPAS.map((etapa, i) => {
            const feita = i <= posicao;
            const atual = i === posicao;
            return (
              <li key={etapa} className="pr-4">
                <span
                  aria-hidden
                  className={`block h-1 w-full ${feita ? "bg-vermelho" : "bg-fuligem-20"}`}
                />
                <span
                  className={`mt-2 block text-[12px] font-semibold uppercase tracking-[0.1em] ${
                    feita ? "text-fuligem" : "text-fuligem-55"
                  }`}
                >
                  {etapa}
                  {atual ? <span className="sr-only"> (etapa atual)</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* ── Rastreio ───────────────────────────────────────────────────── */}
      {pedido.rastreio ? (
        <p className="mt-6 text-[15px]">
          Rastreio:{" "}
          <a
            href={`${RASTREIO_CORREIOS}${encodeURIComponent(pedido.rastreio)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-dado text-vermelho underline underline-offset-4"
          >
            {pedido.rastreio}
          </a>{" "}
          <span className="text-fuligem-55">(abre nos Correios)</span>
        </p>
      ) : null}

      {/* ── Avaliar (só depois da ENTREGA — a mesma regra da RLS de 0014;
             antes disso o formulário só colheria um 42501) ─────────────── */}
      {pedido.status === "entregue" ? (
        <AvaliarPedido
          itens={pedido.items
            .filter((item) => typeof item.product_id === "string" && item.product_id)
            .map((item) => ({
              productId: String(item.product_id),
              nome: texto(item.name) || "Item do pedido",
            }))}
        />
      ) : null}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        {/* ── Itens ────────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            Itens
          </h2>
          {pedido.items.length === 0 ? (
            <p className="mt-4 text-[15px] text-fuligem-55">
              Não conseguimos listar os itens deste pedido.
            </p>
          ) : (
            <ul className="mt-4 border-t border-fuligem-20">
              {pedido.items.map((item, i) => (
                <li
                  key={`${texto(item.product_id)}-${i}`}
                  className="flex items-baseline justify-between gap-4 border-b border-fuligem-20 py-4"
                >
                  <span className="min-w-0 text-[15px]">
                    <span className="font-dado">{numero(item.quantity)}×</span>{" "}
                    {texto(item.name) || "Item do pedido"}
                    {texto(item.size) ? (
                      <span className="text-fuligem-55"> · {texto(item.size)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-dado text-[15px]">
                    {formatarPreco(
                      Math.round(numero(item.price) * 100) * numero(item.quantity),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* ── Endereço ─────────────────────────────────────────────────── */}
          {pedido.endereco ? (
            <div className="mt-10">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
                Entrega
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-fuligem-80">
                {texto(pedido.endereco.street)}, {texto(pedido.endereco.number)}
                {texto(pedido.endereco.complement)
                  ? ` — ${texto(pedido.endereco.complement)}`
                  : ""}
                <br />
                {texto(pedido.endereco.neighborhood)} ·{" "}
                {texto(pedido.endereco.city)}/{texto(pedido.endereco.state)}
                <br />
                CEP <span className="font-dado">{texto(pedido.endereco.zip_code)}</span>
              </p>
              {pedido.metodoEnvio ? (
                <p className="mt-2 text-[14px] text-fuligem-55">
                  Envio: {pedido.metodoEnvio}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── Totais ───────────────────────────────────────────────────── */}
        <aside className="h-fit border border-fuligem-20 p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            Total
          </h2>

          {pedido.descontoReais > 0 ? (
            <div className="mt-4 flex justify-between text-[14px]">
              <span>
                Desconto
                {pedido.cupom ? (
                  <span className="text-fuligem-55">
                    {" "}
                    (<span className="font-dado">{pedido.cupom}</span>)
                  </span>
                ) : null}
              </span>
              <span className="font-dado">
                −{formatarPreco(Math.round(pedido.descontoReais * 100))}
              </span>
            </div>
          ) : null}

          <div className="mt-4 flex justify-between border-t border-fuligem-20 pt-3 text-[14px]">
            <span>Frete</span>
            <span className="font-dado">
              {pedido.freteReais > 0
                ? formatarPreco(Math.round(pedido.freteReais * 100))
                : "Grátis"}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-fuligem-20 pt-3">
            <span className="text-[15px] font-semibold">Pago</span>
            <span className="font-dado text-[20px]">
              {formatarPreco(Math.round(pedido.totalReais * 100))}
            </span>
          </div>

          {pedido.metodoPagamento ? (
            <p className="mt-4 text-[13px] text-fuligem-55">
              Pagamento:{" "}
              {pedido.metodoPagamento === "pix"
                ? "Pix"
                : `cartão (${pedido.metodoPagamento})`}
            </p>
          ) : null}
        </aside>
      </div>

      <p className="mt-16 text-[14px] text-fuligem-55">
        <Link
          href="/account"
          className="text-vermelho underline underline-offset-4"
        >
          Todos os seus pedidos
        </Link>
      </p>
    </div>
  );
}
