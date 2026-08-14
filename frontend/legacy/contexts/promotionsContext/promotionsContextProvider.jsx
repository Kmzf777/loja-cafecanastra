import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../api";
import promotionsContext from "./createPromotionContext";
import PropTypes from "prop-types";

const PromotionsProvider = ({ children }) => {
  const [promotions, setPromotions] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/promotions`);

        if (res.ok) {
          const promos = await res.json();
          if (mounted) {
            setPromotions(
              promos.filter(
                (p) =>
                  p.active &&
                  new Date(p.start_date) <= new Date() &&
                  new Date() <= new Date(p.end_date)
              )
            );
          }
        }
      } catch (err) {
        console.error("Erro ao carregar promoções", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const applyOffers = useCallback(
    (product) => {
      let bestPrice = Number(product.price);
      let bestLabel = null;

      promotions.forEach((p) => {
        const value = Number(p.value);
        let match = false;

        if (p.applies_to === "all") {
          match = true;
        }
        if (
          p.applies_to === "category" &&
          String(p.category).trim().toLocaleLowerCase() ===
            String(product.category).trim().toLocaleLowerCase()
        ) {
          match = true;
        }
        if (
          p.applies_to === "product" &&
          String(p.product_id) === String(product.product_id)
        ) {
          match = true;
        }

        if (!match) return;

        const discounted =
          p.type === "percent"
            ? Number(product.price) * (1 - value / 100)
            : Math.max(0, Number(product.price) - value);

        if (discounted < bestPrice) {
          bestPrice = discounted;
          bestLabel =
            p.type === "percent" ? `–${value}%` : `–R$ ${value.toFixed(2)}`;
        }
      });

      return { price: bestPrice, discountLabel: bestLabel };
    },
    [promotions]
  );

  return (
    <promotionsContext.Provider value={{ promotions, applyOffers }}>
      {children}
    </promotionsContext.Provider>
  );
};

PromotionsProvider.propTypes = {
  children: PropTypes.any,
};

export default PromotionsProvider;
