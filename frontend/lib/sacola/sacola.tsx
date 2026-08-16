"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_BASE, recuperarSessao } from "@/lib/conta/sessao";

/**
 * Sacola da vitrine.
 *
 * O botão "Adicionar à sacola" da PDP não fazia nada: chamava um `<Botao>` sem
 * handler. A loja anunciava preço, estoque e moagem e não tinha como receber um
 * pedido — o pior tipo de defeito numa vitrine, porque parece pronta.
 *
 * DUAS CAMADAS, DE PROPÓSITO
 *  - `localStorage["cart"]` é a verdade para quem não está logado, e é a MESMA
 *    chave que o backend espera em `localCart` no sign-in (ver
 *    loginRepository.signIn). Quem monta a sacola deslogado e depois entra tem
 *    os itens fundidos com os da conta em vez de perdê-los.
 *  - Com sessão, o servidor manda: `POST /cart/replace` grava, e o que ele
 *    devolve substitui o estado local. Assim a sacola sobrevive à troca de
 *    aparelho e o estoque é reconferido no servidor.
 *
 * O preço guardado aqui é só para exibir. Quem cobra é o checkout, que relê
 * preço e estoque do banco antes de gerar o pagamento (PaymentController).
 */

export type ItemDaSacola = {
  /** `product_id` no banco — é por ele que o backend identifica o item. */
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  /** Rótulo da embalagem ("Pacote com 250 g"), reaproveitando a coluna `size`. */
  size: string;
  /** Moagem escolhida. Não existe no backend legado; viaja só localmente. */
  moagem?: string;
};

type Sacola = {
  itens: ItemDaSacola[];
  quantidadeTotal: number;
  totalCentavos: number;
  adicionar: (item: ItemDaSacola) => Promise<void>;
  alterarQuantidade: (product_id: string, quantidade: number) => Promise<void>;
  remover: (product_id: string) => Promise<void>;
  limpar: () => Promise<void>;
  sincronizando: boolean;
};

const CHAVE = "cart";
const ContextoDaSacola = createContext<Sacola | null>(null);

function lerLocal(): ItemDaSacola[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) || "[]");
    return Array.isArray(bruto) ? bruto : [];
  } catch {
    return [];
  }
}

function gravarLocal(itens: ItemDaSacola[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch {
    // Modo privado com cota zerada: a sacola vive só em memória nesta aba.
  }
}

export function ProvedorDaSacola({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ItemDaSacola[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const tokenRef = useRef<string | null>(null);

  // Hidrata do localStorage só depois de montar: ler no primeiro render faria o
  // HTML do servidor divergir do cliente e o React descartaria a árvore.
  useEffect(() => {
    setItens(lerLocal());

    recuperarSessao()
      .then((sessao) => {
        if (!sessao) return;
        tokenRef.current = sessao.accessToken;
        return fetch(`${API_BASE}/cart`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessao.accessToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            // O servidor vence quando tem itens: é a sacola que atravessa
            // aparelhos. Sacola remota vazia não apaga a local.
            if (d?.items?.length) {
              setItens(d.items);
              gravarLocal(d.items);
            }
          });
      })
      .catch(() => {
        // Sem sessão ou API fora: segue com a sacola local.
      });
  }, []);

  /** Grava local sempre; no servidor só quando há sessão. */
  const persistir = useCallback(async (novos: ItemDaSacola[]) => {
    setItens(novos);
    gravarLocal(novos);

    if (!tokenRef.current) return;
    setSincronizando(true);
    try {
      const csrf = await fetch(`${API_BASE}/csrf-token`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.csrfToken)
        .catch(() => null);

      await fetch(`${API_BASE}/cart/replace`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ items: novos }),
      });
    } catch {
      // Falha de rede não pode desfazer o que a pessoa acabou de fazer na tela:
      // o estado local já foi gravado e sincroniza na próxima ação.
    } finally {
      setSincronizando(false);
    }
  }, []);

  const adicionar = useCallback(
    async (item: ItemDaSacola) => {
      const atuais = lerLocal();
      const existente = atuais.find((i) => i.product_id === item.product_id);
      const novos = existente
        ? atuais.map((i) =>
            i.product_id === item.product_id
              ? { ...i, quantity: i.quantity + item.quantity }
              : i,
          )
        : [...atuais, item];
      await persistir(novos);
    },
    [persistir],
  );

  const alterarQuantidade = useCallback(
    async (product_id: string, quantidade: number) => {
      if (quantidade < 1) return;
      await persistir(
        lerLocal().map((i) =>
          i.product_id === product_id ? { ...i, quantity: quantidade } : i,
        ),
      );
    },
    [persistir],
  );

  const remover = useCallback(
    async (product_id: string) => {
      await persistir(lerLocal().filter((i) => i.product_id !== product_id));
    },
    [persistir],
  );

  const limpar = useCallback(async () => {
    await persistir([]);
  }, [persistir]);

  const valor = useMemo<Sacola>(
    () => ({
      itens,
      quantidadeTotal: itens.reduce((s, i) => s + Number(i.quantity), 0),
      totalCentavos: itens.reduce(
        (s, i) => s + Math.round(Number(i.price) * 100) * Number(i.quantity),
        0,
      ),
      adicionar,
      alterarQuantidade,
      remover,
      limpar,
      sincronizando,
    }),
    [itens, adicionar, alterarQuantidade, remover, limpar, sincronizando],
  );

  return (
    <ContextoDaSacola.Provider value={valor}>
      {children}
    </ContextoDaSacola.Provider>
  );
}

export function useSacola(): Sacola {
  const ctx = useContext(ContextoDaSacola);
  if (!ctx) {
    throw new Error("useSacola precisa estar dentro de <ProvedorDaSacola>.");
  }
  return ctx;
}
