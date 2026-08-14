import { useState, useEffect, useCallback } from "react";
import fetchDataForm from "../api";

export function useProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query = "") => {
    setLoading(true);
    const res = await fetchDataForm(
      `/dashboard${query ? `?${query}` : ""}`,
      "GET"
    );
    const data = await res.json();
    setProducts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { products, loading, load };
}
