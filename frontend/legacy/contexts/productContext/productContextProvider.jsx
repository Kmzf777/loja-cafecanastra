import { useCallback, useContext, useEffect, useRef, useState } from "react";
import productContext from "./createProductContext";
import PropTypes from "prop-types";
import fetchDataForm, { API_BASE } from "../../api";
import { toast } from "react-toastify";
import authContext from "../loginContext/createAuthContext";

/**
 * O CARRINHO AQUI É SÓ localStorage — as rotas `GET /cart` e
 * `POST /cart/replace` morreram na F2 e as chamadas que este provider fazia
 * a elas eram dois 404 de ruído em TODO load do painel. Nenhuma tela montada
 * pela ilha do painel (`PainelApp.jsx`) usa o carrinho; quem usava eram as
 * páginas da vitrine legada (`main.jsx`), que são código morto fora da
 * ilha. O estado local fica porque essas páginas ainda compilam.
 */
/**
 * A MESMA árvore de providers serve a vitrine legada (morta, main.jsx) e a
 * ilha do painel em /dashboard. Dentro do painel, "produtos antigos",
 * "novidades" e a conferência de estoque da sacola são requisições que
 * ninguém consome — e os toasts de estoque da sacola apareceriam no ADMIN.
 * O pathname decide uma vez: a ilha é client-only (ssr: false), então
 * window sempre existe quando isto roda; o guard de typeof é só cinto.
 */
const ehPainel =
  typeof window !== "undefined" &&
  window.location.pathname.startsWith("/dashboard");

const ProductProvider = ({ children }) => {
  const { user, initialized } = useContext(authContext);

  const [dataForm, setDataForm] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(null);
  const [total, setTotal] = useState(null);
  const [limit, setLimit] = useState(10);

  const [cart, setCart] = useState(() => {
    try {
      const raw = localStorage.getItem("cart") || "[]";
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });
  const [value, setValue] = useState(0);
  const [productId, setProductId] = useState("");

  const [oldProducts, setOldProducts] = useState([]);
  const [isLoadingOld, setIsLoadingOld] = useState(true);
  const [oldPage, setOldPage] = useState(1);
  const [oldTotalPages, setOldTotalPages] = useState(1);
  const [oldLimit] = useState(10);

  const [newProducts, setNewProducts] = useState([]);
  const [isNewLoading, setIsNewLoading] = useState(true);

  const listControllerRef = useRef(null);
  const oldControllerRef = useRef(null);

  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    if (Array.isArray(cart)) {
      localStorage.setItem("cart", JSON.stringify(cart));
    }
  }, [cart]);

  // Função para validar estoque (chamada ao iniciar)
  const refreshCartStock = useCallback(
    async (currentCart) => {
      if (!currentCart || currentCart.length === 0) return;

      try {
        let hasChanges = false;
        const updatedItems = await Promise.all(
          currentCart.map(async (item) => {
            try {
              const res = await fetch(
                `${API_BASE}/dashboard/${item.product_id}`,
              );

              if (res.status === 404) {
                hasChanges = true;
                return null;
              }

              if (res.ok) {
                const data = await res.json();

                if (!data || !data.product_id) return null;

                const maxStock = Number(data.quantity);
                const currentQty = item.quantity;
                const validQty = Math.min(currentQty, maxStock);

                if (validQty !== currentQty || item.stock !== maxStock) {
                  hasChanges = true;
                }

                return {
                  ...item,
                  stock: maxStock,
                  price: data.price,
                  name: data.name,
                  image: data.image,
                  quantity: validQty,
                };
              }
              return item;
            } catch {
              return item;
            }
          }),
        );

        const validItems = updatedItems.filter((item) => item !== null);

        if (hasChanges || validItems.length !== currentCart.length) {
          if (validItems.length < currentCart.length) {
            toast.warning(
              "Alguns itens foram removidos pois não existem mais na loja.",
            );
          } else if (hasChanges) {
            toast.info("O estoque de alguns itens mudou.");
          }
          setCart(validItems);
        }
      } catch (err) {
        console.error("Erro refreshCartStock", err);
      }
    },
    [],
  );

  useEffect(() => {
    if (!initialized) return;

    // Logado ou não, a fonte é o localStorage — só o estoque é conferido no
    // servidor (rotas de catálogo, que existem). NO PAINEL a conferência não
    // roda: o admin não usa a sacola, e os toasts de "estoque mudou" dela
    // apareceriam no meio da gestão.
    const local = JSON.parse(localStorage.getItem("cart") || "[]");
    setCart(local);
    if (!ehPainel) refreshCartStock(local);

    const onCartMerged = (e) => {
      const mergedItems = (e && e.detail) || [];
      setCart(mergedItems);
      localStorage.setItem("cart", JSON.stringify(mergedItems));
    };

    const onLogout = () => {
      setCart([]);
      localStorage.removeItem("cart");
    };

    window.addEventListener("shop:cartMerged", onCartMerged);
    window.addEventListener("shop:logout", onLogout);

    return () => {
      window.removeEventListener("shop:cartMerged", onCartMerged);
      window.removeEventListener("shop:logout", onLogout);
    };
  }, [user, initialized, refreshCartStock]);

  const fetchOld = useCallback(
    async (page = 1) => {
      if (oldControllerRef.current) oldControllerRef.current.abort();
      const controller = new AbortController();
      oldControllerRef.current = controller;
      setIsLoadingOld(true);
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: oldLimit.toString(),
          onlyOld: "true",
        });
        const response = await fetchDataForm(
          `/dashboard?${params}`,
          "GET",
          undefined,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        const { products = [], totalPages = 1 } = await response.json();
        setOldProducts(products);
        setOldTotalPages(totalPages);
      } catch (err) {
        if (err.name !== "AbortError") console.error("fetchOld error:", err);
      } finally {
        setIsLoadingOld(false);
        if (oldControllerRef.current === controller)
          oldControllerRef.current = null;
      }
    },
    [oldLimit],
  );

  const fetchNew = useCallback(async () => {
    setIsNewLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "30",
        onlyNew: "true",
      });

      const response = await fetchDataForm(`/dashboard?${params}`, "GET");

      if (!response.ok) throw new Error(`Erro ${response.status}`);

      const data = await response.json();
      const products = data.products || [];

      const now = Date.now();
      const enriched = products.map((p) => ({
        ...p,
        isNew: now - new Date(p.timestamp) < 5 * 24 * 3600 * 1000,
      }));

      setNewProducts(enriched);
    } catch (err) {
      console.error("fetchNew error:", err);
    } finally {
      setIsNewLoading(false);
    }
  }, []);

  useEffect(() => {
    // "Produtos antigos" e "novidades" são seções da VITRINE legada; nenhuma
    // tela do painel as lê. Dentro de /dashboard eram duas requisições
    // inúteis em todo load.
    if (ehPainel) return;
    fetchOld(oldPage);
    fetchNew();
    return () => {
      if (oldControllerRef.current) oldControllerRef.current.abort();
    };
  }, [fetchOld, oldPage, fetchNew]);

  const updateProductList = useCallback(
    async (queryUrl = {}) => {
      if (listControllerRef.current) listControllerRef.current.abort();
      const controller = new AbortController();
      listControllerRef.current = controller;
      setIsLoading(true);
      try {
        const query = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          ...queryUrl,
        });
        const response = await fetchDataForm(
          `/dashboard?${query}`,
          "GET",
          undefined,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        const data = await response.json();
        const products = data.products || [];
        const now = Date.now();
        const enriched = products.map((p) => ({
          ...p,
          isNew: now - new Date(p.timestamp) < 5 * 24 * 3600 * 1000,
          isOld: now - new Date(p.timestamp) >= 5 * 24 * 3600 * 1000,
        }));
        setTotalPages(data.totalPages ?? null);
        setTotal(data.total ?? null);
        setDataForm(enriched);
        return true;
      } catch (err) {
        // O RESULTADO é devolvido em vez de relançado: quem chama sem catch
        // (o useEffect deste provider) não pode virar unhandled rejection, e
        // quem PRECISA saber (a tarja de erro de AddedProducts) lê o retorno.
        // `undefined` = requisição superada por outra (abort) — não é erro.
        if (err.name === "AbortError") return undefined;
        console.error("updateProductList error:", err);
        return false;
      } finally {
        setIsLoading(false);
        if (listControllerRef.current === controller)
          listControllerRef.current = null;
      }
    },
    [page, limit],
  );

  useEffect(() => {
    updateProductList();
    return () => {
      if (listControllerRef.current) listControllerRef.current.abort();
    };
  }, [updateProductList]);

  // Lógica de Sincronização LocalStorage e Contexto
  useEffect(() => {
    if (!dataForm || !dataForm.length) return;
    setCart((prev) =>
      prev.map((item) => {
        const prod = dataForm.find((p) => p.product_id === item.product_id);
        return prod
          ? {
              ...item,
              name: prod.name ?? item.name,
              price: prod.price ?? item.price,
              image: prod.image ?? item.image,
              size: prod.size ?? item.size,
            }
          : item;
      }),
    );
  }, [dataForm]);

  // Add to Cart com Debounce
  const addToCart = useCallback(
    (product, quantity = 1, { increment = false } = {}) => {
      if (!product || quantity <= 0) return;

      setCart((prev) => {
        const idx = prev.findIndex((p) => p.product_id === product.product_id);
        const next = [...prev];
        const maxStock = Number(product.quantity ?? product.stock ?? 999);
        let newQty = Number(quantity);

        if (idx >= 0) {
          const currentQty = Number(prev[idx].quantity);
          newQty = increment ? currentQty + Number(quantity) : Number(quantity);

          if (newQty > maxStock) {
            toast.info(`Limite de estoque atingido: ${maxStock} unid.`);
            return prev;
          }
          next[idx] = { ...prev[idx], quantity: newQty, stock: maxStock };
          toast.success("Carrinho atualizado!");
        } else {
          if (newQty > maxStock) {
            toast.info("Quantidade indisponível.");
            return prev;
          }
          next.push({ ...product, quantity: newQty, stock: maxStock });
          toast.success("Adicionado ao carrinho!");
        }

        return next;
      });
    },
    [],
  );

  const updateQuantity = useCallback(
    (productId, newQuantity) => {
      if (newQuantity < 0) return;
      setCart((prev) => {
        const item = prev.find((p) => p.product_id === productId);
        if (!item) return prev;

        const stock = item.stock !== undefined ? Number(item.stock) : 999;

        if (newQuantity > stock) {
          toast.info(`Apenas ${stock} disponíveis.`);
          return prev;
        }

        const next = prev.map((p) =>
          p.product_id === productId ? { ...p, quantity: newQuantity } : p,
        );

        return next;
      });
    },
    [],
  );

  const removeFromCart = useCallback((productId) => {
    setCart((prev) => prev.filter((p) => p.product_id !== productId));
  }, []);

  return (
    <productContext.Provider
      value={{
        dataForm,
        newProducts,
        isNewLoading,
        setDataForm,
        updateProductList,
        isLoading,
        page,
        setPage,
        totalPages,
        total,
        limit,
        setLimit,
        oldProducts,
        isLoadingOld,
        oldPage,
        setOldPage,
        oldTotalPages,
        oldLimit,
        fetchOld,
        cart,
        setCart,
        value,
        setValue,
        addToCart,
        updateQuantity,
        removeFromCart,
        handleAddCart: (product) => addToCart(product, value),
        productId,
        setProductId,
        setProductToLocalStorage: (c) =>
          localStorage.setItem("cart", JSON.stringify(c)),
        refreshCartStock: () => refreshCartStock(cart),
      }}
    >
      {children}
    </productContext.Provider>
  );
};

ProductProvider.propTypes = {
  children: PropTypes.any,
};

export default ProductProvider;
