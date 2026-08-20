"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { CHAVE_DA_SACOLA, fundirSacola, reiniciarFusao } from "./fusao";

/**
 * Sacola da vitrine.
 *
 * O botão "Adicionar à sacola" da PDP não fazia nada: chamava um `<Botao>` sem
 * handler. A loja anunciava preço, estoque e moagem e não tinha como receber um
 * pedido — o pior tipo de defeito numa vitrine, porque parece pronta.
 *
 * ONDE A SACOLA VIVE, DEPOIS DA TASK 5
 *  - `localStorage["cart"]` é a verdade da tela, logado ou não. É daqui que a
 *    PDP, o cabeçalho e o checkout leem.
 *  - `canastra.carrinho_itens` recebe a sacola quando a pessoa entra, pela RPC
 *    `canastra.fundir_sacola` — ver `fusao.ts`, que também relê a sacola da
 *    conta na primeira vez que a conta aparece neste aparelho. É o que faz a
 *    sacola montada no celular reaparecer no computador.
 *
 * O QUE SAIU DAQUI, E POR QUÊ. Este arquivo falava com o Express em dois
 * pontos: `GET /cart` na montagem e `POST /cart/replace` a cada edição. As duas
 * rotas foram APAGADAS na Task 5, e não repontadas: elas consultavam `carts` e
 * `cart_items`, tabelas em inglês que migração nenhuma cria — respondiam 500 e
 * a vitrine engolia. Repontá-las seria reescrever código que a F4 apaga.
 *
 * O RAMO DE HIDRATAÇÃO SAIU INTEIRO, e não foi remendado, porque ele era uma
 * máquina de dobrar sacola esperando a hora: no dia em que `GET /cart` voltasse
 * a responder, a sacola da CONTA chegaria ao `localStorage` SEM selo e a fusão
 * a leria como sacola anônima pendente — cada carga de página somaria a sacola
 * da conta nela mesma. Quem traz a sacola da conta é `fusao.ts`, que carimba o
 * que grava.
 *
 * O QUE ISSO CUSTA ENQUANTO A F4 NÃO CHEGA, dito sem rodeio: entre uma entrada
 * e outra, a sacola de quem está logado vive só no `localStorage` deste
 * aparelho, mais o que a fusão já escreveu em `canastra.carrinho_itens`. Não é
 * regressão — já era assim, porque os endpoints respondiam 500.
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
   * `skuLoja` do catálogo — a identidade ESTÁVEL do item no funil do GA4.
   *
   * Existe porque `add_to_cart` reporta `item_id = skuLoja` (PainelCompra e
   * CardKit) e o `begin_checkout` da página da sacola precisa reportar o MESMO
   * id, senão o funil do GA4 quebra a ligação entre os dois eventos. O
   * `product_id` não serve de identidade de funil: é o id de banco, que muda
   * entre ambientes e não diz qual variante comercial é.
   *
   * OPCIONAL de verdade, com fallback: sacolas antigas no `localStorage` não o
   * têm, e `limparItens` da fusão (que reconstrói cada item campo a campo) não
   * o preserva — quem reporta usa `sku ?? product_id`. Nenhuma requisição o
   * manda: `traduzirParaFusao`, checkout e frete montam o corpo campo a campo.
   */
  sku?: string;
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
   * frete) escolhe os campos um a um, então ele não vaza.
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

  // Hidrata do localStorage só depois de montar: ler no primeiro render faria o
  // HTML do servidor divergir do cliente e o React descartaria a árvore.
  useEffect(() => {
    setItens(lerLocal());

    let montado = true;

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
            // Sem isto, quem sai e entra com OUTRA conta na mesma aba não teria
            // a sacola fundida — a trava seguiria valendo da sessão anterior.
            reiniciarFusao();
            return;
          }

          if (!sessaoGoTrue) return;

          // Enquanto a fusão corre, a tela continua mostrando a sacola local
          // (que é tudo o que a pessoa montou) e a página da sacola exibe
          // "Salvando sua sacola…". Em nenhum instante ela mostra menos: a
          // lista só é trocada quando a fusão responde, e o que ela devolve
          // CONTÉM a local.
          setSincronizando(true);
          fundirSacola()
            .then((resultado) => {
              if (!montado) return;
              if (resultado.situacao === "fundida") setItens(resultado.itens);
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

  /**
   * Grava a sacola: estado da tela e `localStorage`, e mais nada.
   *
   * Aqui havia um `POST /cart/replace` (com um `GET /csrf-token` na frente).
   * Os dois endpoints deixaram de existir na Task 5 — ver o cabeçalho. Quem
   * leva a sacola para o banco é a fusão, no evento de sessão.
   *
   * CONTINUA `async` DE PROPÓSITO: `adicionar`, `alterarQuantidade`, `remover`
   * e `limpar` são prometidos como `Promise<void>` no tipo `Sacola` e as telas
   * dão `await` neles. Tirar o `async` para "simplificar" mudaria a interface
   * de todo consumidor sem ganho nenhum.
   */
  const persistir = useCallback(async (novos: ItemDaSacola[]) => {
    setItens(novos);
    gravarLocal(novos);
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
