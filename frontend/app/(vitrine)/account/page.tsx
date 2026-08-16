"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import {
  API_BASE,
  recuperarSessao,
  sair,
  type Sessao,
} from "@/lib/conta/sessao";
import { formatarPreco } from "@/lib/catalogo/repositorio";

/**
 * Área da conta.
 *
 * Client-side de propósito: a sessão vive num cookie httpOnly emitido pelo
 * backend Express, que o servidor do Next não tem como ler durante o render.
 * Renderizar no servidor exigiria duplicar a verificação de token no Next —
 * duas fontes de verdade para "quem está logado" é como sessão desincroniza.
 */

type Pedido = {
  order_id: string;
  total_amount: string | number;
  status: string;
  created_at: string;
  payment_method?: string;
  shipping_method?: string;
};

/** Rótulos em português para os status que o Mercado Pago devolve. */
const STATUS: Record<string, string> = {
  pending: "Aguardando pagamento",
  in_process: "Em análise",
  approved: "Pago",
  authorized: "Autorizado",
  sent: "Enviado",
  delivered: "Entregue",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Estornado",
};

export default function PaginaConta() {
  const router = useRouter();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    recuperarSessao().then((s) => {
      if (!vivo) return;
      if (!s) {
        router.replace("/account/login?de=/account");
        return;
      }
      setSessao(s);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [router]);

  useEffect(() => {
    if (!sessao) return;
    let vivo = true;
    fetch(`${API_BASE}/my-orders`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${sessao.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => vivo && setPedidos(Array.isArray(d) ? d : (d.orders ?? [])))
      // Lista vazia, não tela quebrada: o histórico é secundário na página.
      .catch(() => vivo && setPedidos([]));
    return () => {
      vivo = false;
    };
  }, [sessao]);

  const aoSair = useCallback(async () => {
    await sair();
    router.replace("/");
    router.refresh();
  }, [router]);

  if (carregando || !sessao) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <p role="status" className="text-[15px] text-fuligem-55">
          Carregando sua conta…
        </p>
      </div>
    );
  }

  const { usuario } = sessao;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Sua conta
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        {usuario.name}
      </h1>
      <p className="mt-3 font-dado text-[14px] text-fuligem-55">{usuario.email}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <BotaoLink href="/cafes" variante="primario">
          Ver os cafés
        </BotaoLink>
        {/* /dashboard é uma ilha client-only com roteador próprio, mas navegar
            por <Link> monta a ilha do zero e o AuthProvider dela reavalia a
            sessão no efeito de montagem — não precisa de reload completo. */}
        {usuario.role === "admin" ? (
          <BotaoLink href="/dashboard" variante="secundario">
            Abrir o painel
          </BotaoLink>
        ) : null}
        <Botao variante="secundario" onClick={aoSair}>
          Sair
        </Botao>
      </div>

      <section className="mt-16">
        <h2 className="titulo-secao text-[clamp(1.5rem,3vw,2.25rem)] leading-tight">
          Seus pedidos
        </h2>

        {pedidos === null ? (
          <p className="mt-6 text-[15px] text-fuligem-55">Buscando…</p>
        ) : pedidos.length === 0 ? (
          // §11: tela vazia é convite, nunca "0 resultados".
          <div className="mt-6 max-w-[52ch]">
            <p className="text-[17px] leading-relaxed text-fuligem-80">
              Nenhum pedido ainda. Quando o primeiro sair, ele aparece aqui com o
              código de rastreio.
            </p>
            <div className="mt-6">
              <BotaoLink href="/cafes" variante="secundario">
                Escolher um café
              </BotaoLink>
            </div>
          </div>
        ) : (
          <ul className="mt-6 border-t border-fuligem-20">
            {pedidos.map((p) => (
              <li
                key={p.order_id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-fuligem-20 py-4"
              >
                <span className="font-dado text-[13px] text-fuligem-55">
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </span>
                <span className="text-[14px]">
                  {STATUS[p.status] ?? p.status}
                </span>
                <span className="font-dado text-[15px]">
                  {formatarPreco(Math.round(Number(p.total_amount) * 100))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-16 text-[14px] text-fuligem-55">
        <Link href="/" className="text-vermelho underline underline-offset-4">
          Voltar para a loja
        </Link>
      </p>
    </div>
  );
}
