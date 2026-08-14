import PropTypes from "prop-types";
import { IoMdClose } from "react-icons/io";
import {
  CartDiv,
  CartFooter,
  CartHeader,
  CartHeaderTitle,
  CartProductCard,
  CartProductsSection,
  DivEmptyCart,
  ShirtInfoCart,
} from "./ProductsCart.style";
import { GoTrash } from "react-icons/go";
import { useNavigate } from "react-router-dom";
import { useContext, useEffect, useMemo } from "react";
import productContext from "../../../contexts/productContext/createProductContext";
import { MdRemoveShoppingCart } from "react-icons/md";
import { API_BASE } from "../../../api";
import promotionsContext from "../../../contexts/promotionsContext/createPromotionContext";

function ProductsCart({ isCartOpen, setIsCartOpen }) {
  const navigate = useNavigate();
  const { cart, removeFromCart } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);

  useEffect(() => {
    if (isCartOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isCartOpen]);

  const total = useMemo(() => {
    return cart.reduce((acc, p) => {
      const { price } = applyOffers(p);
      return acc + p.quantity * (Number(price) || 0);
    }, 0);
  }, [cart, applyOffers]);

  const getProductId = (e, index) => {
    const product = cart[index];
    const name = product.name;
    const id = product.product_id;
    navigate(`/site/product/${name}/${id}`.replaceAll(" ", "-"));
  };

  const closeCart = () => {
    setIsCartOpen(false);
  };

  return (
    <CartDiv isCartOpen={isCartOpen}>
      <CartHeader>
        <CartHeaderTitle>Meu carrinho</CartHeaderTitle>
        <IoMdClose onClick={closeCart} />
      </CartHeader>

      {cart.length == 0 ? (
        <DivEmptyCart>
          <MdRemoveShoppingCart className="emptyCartIcon" />
          <p className="emptyCartText">Carrinho vazio</p>
          <span className="emptyCartSpan">
            Adicione novos produtos para encher seu carrinho de compras.
          </span>
        </DivEmptyCart>
      ) : (
        <>
          <CartProductsSection>
            {cart.map((eachProduct, index) => {
              const { price: finalPrice, discountLabel } =
                applyOffers(eachProduct);
              const originalPrice = Number(eachProduct.price);
              const totalItemPrice = eachProduct.quantity * finalPrice;
              const totalItemOriginal = eachProduct.quantity * originalPrice;

              const imgUrl = eachProduct.image?.startsWith("http")
                ? eachProduct.image
                : `${API_BASE}${eachProduct.image}`;

              return (
                <CartProductCard
                  key={eachProduct.product_id}
                  onClick={(e) => {
                    getProductId(e, index);
                    setIsCartOpen(false);
                  }}
                >
                  <img src={imgUrl} alt="T-shirt" />

                  <ShirtInfoCart>
                    <span style={{ fontWeight: "bold" }}>
                      {eachProduct.name}
                    </span>
                    <span style={{ fontSize: "0.9rem", color: "#555" }}>
                      {" "}
                      Qtd: {eachProduct.quantity}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      {discountLabel ? (
                        <>
                          <span
                            style={{
                              textDecoration: "line-through",
                              fontSize: "0.85rem",
                              color: "#999",
                            }}
                          >
                            {totalItemOriginal.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                          <span
                            style={{ color: "#2e7d32", fontWeight: "bold" }}
                          >
                            {totalItemPrice.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontWeight: "bold" }}>
                          {totalItemPrice.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>
                      )}
                    </div>
                  </ShirtInfoCart>

                  <GoTrash
                    className="icon deleteIcon"
                    style={{ color: "#ec4c4c", fontSize: "1rem" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromCart(eachProduct.product_id);
                    }}
                  />
                </CartProductCard>
              );
            })}
          </CartProductsSection>

          <CartFooter>
            <p>
              <b>Valor total:</b>{" "}
              {total.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </p>
            <button
              disabled={!cart.length}
              onClick={() => {
                setIsCartOpen(false);
                navigate("/checkout/carrinho");
              }}
            >
              Finalizar compra
            </button>
          </CartFooter>
        </>
      )}
    </CartDiv>
  );
}

export default ProductsCart;

ProductsCart.propTypes = {
  isCartOpen: PropTypes.bool,
  setIsCartOpen: PropTypes.func,
};
