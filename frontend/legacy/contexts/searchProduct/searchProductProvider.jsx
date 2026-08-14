import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import fetchDataForm from "../../api";
import searchProductContext from "./createSearchProductContext";
import PropTypes from "prop-types";

export const SearchProductProvider = ({ children }) => {
  const [dataFormSearch, setDataFormSearch] = useState([]);
  const [searchProductLoading, setSearchProductLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(10);
  const controllerRef = useRef(null);
  const [searchParams] = useSearchParams();

  const getSearchProduct = useCallback(
    async (q, page = 1) => {
      if (!q || !q.trim()) {
        setDataFormSearch([]);
        setTotal(0);
        setTotalPages(1);
        setSearchProductLoading(false);
        return { products: [], total: 0 };
      }

      if (controllerRef.current) controllerRef.current.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setSearchProductLoading(true);

      try {
        const params = new URLSearchParams({
          q: q.trim(),
          page: String(page),
          limit: String(limit),
        });

        const res = await fetchDataForm(
          `/dashboard?${params}`,
          "GET",
          undefined,
          {
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          const txt = await res.text().catch(() => null);
          console.warn("getSearchProduct failed:", res.status, txt);
          setDataFormSearch([]);
          setTotal(0);
          setTotalPages(1);
          return { products: [], total: 0 };
        }

        const json = await res.json();
        const products = Array.isArray(json.products) ? json.products : [];
        setDataFormSearch(products);
        setTotal(json.total ?? 0);
        setTotalPages(json.totalPages ?? 1);
        setPage(json.page ?? page);
        return json;
      } catch (err) {
        if (err.name === "AbortError") {
          return { products: [], total: 0 };
        }
        console.error("getSearchProduct error:", err);
        setDataFormSearch([]);
        setTotal(0);
        setTotalPages(1);
        return { products: [], total: 0 };
      } finally {
        controllerRef.current = null;
        setSearchProductLoading(false);
      }
    },
    [limit]
  );

  const clearSearch = useCallback(() => {
    setDataFormSearch([]);
  }, []);

  useEffect(() => {
    const q = searchParams.get("gsearch") || "";
    const p = parseInt(searchParams.get("page") || "1", 10) || 1;
    if (q.trim()) {
      getSearchProduct(q, p).catch((e) =>
        console.warn("auto getSearchProduct failed:", e)
      );
    } else {
      setDataFormSearch([]);
      setTotal(0);
      setTotalPages(1);
      setPage(1);
    }
  }, [searchParams, getSearchProduct]);

  return (
    <searchProductContext.Provider
      value={{
        dataFormSearch,
        getSearchProduct,
        clearSearch,
        searchProductLoading,
        page,
        setPage,
        totalPages,
        total,
      }}
    >
      {children}
    </searchProductContext.Provider>
  );
};

SearchProductProvider.propTypes = {
  children: PropTypes.any,
};

export default SearchProductProvider;
