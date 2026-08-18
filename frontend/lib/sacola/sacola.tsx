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
import { clienteNavegador } from "@/lib/supabase/cliente";
import { CHAVE_DA_SACOLA, fundirSacola, reiniciarFusao } from "./fusao";

/**
 * Sacola da vitrine.
 *
 * O botão "Adicionar à sacola" da PDP não fazia nada: chamava um `<Botao>` sem
 * handler. A loja anunciava preço, estoque e moagem e não tinha como receber um
 * pedido — o pior tipo de defeito numa vitrine, porque parece pronta.
 *
 * DUAS CAMADAS, DE PROPÓSITO
 *  - `localStorage["cart"]` é a verdade para quem não está logado. Quem monta a
 *    sacola deslogado e depois entra tem os itens fundidos com os da conta em
 *    vez de perdê-los — ver `fusao.ts`.
 *  - Com sessão, o servidor manda: `POST /cart/replace` grava, e o que ele
 *    devolve substitui o estado local. Assim a sacola sobrevive à troca de
 *    aparelho e o estoque é reconferido no servidor.
 *
 * QUEM FUNDE A SACOLA NO LOGIN MUDOU, E A COSTURA VELHA NÃO EXISTE MAIS.
 * Até a Task 3, `localStorage["cart"]` viajava como `localCart` no `signIn` do
 * Express e era o próprio backend que fundia. Esse `signIn` morreu com o GoTrue.
 * Hoje a fusão é a RPC `canastra.fundir_sacola`, chamada daqui pelo
 * `onAuthStateChange` — e a trava que impede fundir duas vezes está em
 * `fusao.ts`, fora do React, porque este provedor remonta.
 *
 * ATENÇÃO AO QUE ISSO IMPLICA NESTA FASE: a fusão grava em
 * `canastra.carrinho_itens`, e as chamadas de `persistir()` logo abaixo
 * continuam falando com o Express (`carts`/`cart_items`), que é OUTRO lugar. A
 * unificação é da F5. Enquanto isso, `fusao.ts` relê a sacola da conta pelo
 * PostgREST e devolve os itens já fundidos — é por isso que o resultado da
 * fusão vence a resposta do `GET /cart` no efeito de montagem.
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
  /**
   * Campo INTERNO da fusão — não é dado de produto e nenhuma tela o lê.
   *
   * Presente, ele diz "este item já está dentro da sacola da conta", e é o que
   * permite `fusao.ts` perceber que a base guardada em `localStorage` sumiu ou
   * não bate, em vez de refundir a sacola inteira e dobrar as quantidades. Ver
   * o comentário do selo em `fusao.ts`.
   *
   * Ele sobrevive às edições porque `adicionar`, `alterarQuantidade` e `remover`
   * copiam o item com `...spread`. Quem monta corpo de requisição (checkout,
   * frete, `/cart/replace`) escolhe os campos um a um, então ele não vaza.
   */
  selo?: string;
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

/** A chave é declarada em `fusao.ts`, que também a apaga. Uma só, e por isso. */
const CHAVE = CHAVE_DA_SACOLA;
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

    let montado = true;
    /**
     * A fusão VENCE a hidratação do Express, e este sinalizador é o que garante
     * isso mesmo quando o `GET /cart` responde depois dela.
     *
     * Os dois leem sacolas de LUGARES DIFERENTES nesta fase (ver o cabeçalho), e
     * a fusão é a única das duas que acabou de escrever no banco. Sem isto, uma
     * resposta atrasada do Express sobrescreveria a sacola recém-fundida com uma
     * versão sem os itens que a pessoa montou deslogada — a perda silenciosa que
     * esta tarefa inteira existe para impedir, só que uns segundos depois.
     */
    let fusaoVenceu = false;

    recuperarSessao()
      .then((sessao) => {
        if (!sessao || !montado) return;
        tokenRef.current = sessao.accessToken;
        return fetch(`${API_BASE}/cart`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${sessao.accessToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            /**
             * TASK 5: este ramo inteiro sai junto com as rotas de carrinho do
             * Express. Enquanto ele existir, há um perigo NOVO além do descrito
             * abaixo: no dia em que `GET /cart` voltar a responder, a sacola da
             * CONTA chegaria por aqui até o `localStorage` SEM selo, e a fusão a
             * leria como sacola anônima pendente — cada carga de página somaria
             * a sacola da conta nela mesma. Hoje isso não acontece porque o
             * endpoint responde 500 (`findOrCreateCart` relança o 42P01 de
             * `carts`, tabela que nenhuma migração cria), e por isso a correção
             * é apagar o ramo, não remendá-lo.
             *
             * A SACOLA REMOTA SÓ PREENCHE A LOCAL VAZIA — ELA NÃO SUBSTITUI
             * MAIS, e esta linha mudou de sentido nesta fase.
             *
             * A regra antiga era "o servidor vence quando tem itens", e ela era
             * segura porque o `signIn` do Express fundia `localCart` ANTES de
             * qualquer `GET /cart`: o que voltava já continha a sacola anônima.
             * Esse `signIn` morreu com o GoTrue (Task 3). Mantida como estava, a
             * resposta do Express passaria por cima da sacola que a pessoa acabou
             * de montar deslogada — no `localStorage`, antes de a fusão ler dali
             * — e os itens sumiriam sem erro nenhum. É a falha desta tarefa,
             * chegando pela porta dos fundos.
             *
             * Vazia, a sacola local não tem nada a perder: aí a remota entra e a
             * promessa de atravessar aparelhos continua valendo.
             */
            if (montado && !fusaoVenceu && d?.items?.length && !lerLocal().length) {
              setItens(d.items);
              gravarLocal(d.items);
            }
          });
      })
      .catch(() => {
        // Sem sessão ou API fora: segue com a sacola local.
      });

    /**
     * A FUSÃO PENDURADA NO EVENTO DE SESSÃO, E NÃO NA MONTAGEM.
     *
     * Montar não é entrar. O `signInWithPassword` acontece na tela de login, que
     * é outro componente; nas telas de callback (confirmação de e-mail, link de
     * recuperação) quem estabelece a sessão é a troca PKCE feita DENTRO da
     * inicialização do cliente, antes de qualquer código de componente rodar. O
     * `onAuthStateChange` é o único ponto que enxerga os três caminhos.
     *
     * Ele dispara MUITAS vezes por sessão — `INITIAL_SESSION` na construção do
     * cliente, `SIGNED_IN` a cada retomada de foco da aba, `TOKEN_REFRESHED` a
     * cada renovação, e todos replicados entre abas por `BroadcastChannel`. É
     * por isso que a defesa não está aqui: está na trava de `fundirSacola()`,
     * que é segura de chamar em todo evento.
     *
     * A callback NÃO é `async` e não espera a promessa de propósito: eventos são
     * entregues em fila, e uma callback lenta atrasa os próximos.
     */
    let desinscrever = () => {};
    try {
      const supabase = clienteNavegador();
      const { data: inscricao } = supabase.auth.onAuthStateChange(
        (evento, sessaoGoTrue) => {
          if (evento === "SIGNED_OUT") {
            tokenRef.current = null;
            // Sem isto, quem sai e entra com OUTRA conta na mesma aba não teria
            // a sacola fundida — a trava seguiria valendo da sessão anterior.
            reiniciarFusao();
            return;
          }

          if (!sessaoGoTrue) return;
          tokenRef.current = sessaoGoTrue.access_token;

          // Enquanto a fusão corre, a tela continua mostrando a sacola local
          // (que é tudo o que a pessoa montou) e a página da sacola exibe
          // "Salvando sua sacola…". Em nenhum instante ela mostra menos: a
          // lista só é trocada quando a fusão responde, e o que ela devolve
          // CONTÉM a local.
          setSincronizando(true);
          fundirSacola()
            .then((resultado) => {
              if (!montado) return;
              if (resultado.situacao === "fundida") {
                fusaoVenceu = true;
                setItens(resultado.itens);
              }
            })
            .finally(() => {
              if (montado) setSincronizando(false);
            });
        },
      );
      desinscrever = () => inscricao.subscription.unsubscribe();
    } catch (erro) {
      // `clienteNavegador()` lança quando falta `NEXT_PUBLIC_SUPABASE_*`
      // (`ambiente.ts` diz qual). Sem este `catch`, uma variável esquecida no
      // build derrubaria a vitrine INTEIRA — o efeito do provedor envolve todas
      // as páginas. Assim a loja segue vendendo com a sacola local e o motivo
      // fica no console.
      console.warn(
        "[sacola] Sem cliente Supabase: a sacola não será fundida na conta.",
        erro,
      );
    }

    return () => {
      montado = false;
      desinscrever();
    };
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
