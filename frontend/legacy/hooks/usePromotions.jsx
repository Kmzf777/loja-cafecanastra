import { useState, useEffect, useCallback } from "react";
import fetchDataForm, { API_BASE } from "../api";

export function usePromotions() {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchDataForm(`${API_BASE}/promotions", "GET`);
    const data = await res.json();
    setPromotions(data);
    setLoading(false);
  }, []);

  const createPromotion = async (payload) => {
    await fetchDataForm(`${API_BASE}/promotions`, "POST", payload);
    await load();
  };

  const updatePromotion = async (id, payload) => {
    await fetchDataForm(`${API_BASE}/promotions/${id}`, "PUT", payload);
    await load();
  };

  const togglePromotion = async (id, active) => {
    await fetchDataForm(`${API_BASE}/promotions/${id}`, "PUT", { active });
    await load();
  };

  useEffect(() => {
    load();
  }, [load]);

  return {
    promotions,
    loading,
    createPromotion,
    updatePromotion,
    togglePromotion,
    load,
  };
}
