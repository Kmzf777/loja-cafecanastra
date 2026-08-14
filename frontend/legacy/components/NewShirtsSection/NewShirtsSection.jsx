import {
  NewShirtsSec,
  ProductContainer,
  ProductContent,
  ShirtInfo,
  Title,
  PriceWrapper,
} from "./NewShirtsSection.style";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../../api";
import productContext from "../../contexts/productContext/createProductContext";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import { MdAddShoppingCart } from "react-icons/md";
import Loading from "../Loading/Loading";

function NewShirstSection() {
  const navigate = useNavigate();
  const { newProducts, addToCart, isNewLoading } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);
  const [hoveredId, setHoveredId] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const getProductId = (product) => {
    const name = product.name;
    const id = product.product_id;
    navigate(`/site/product/${name}/${id}`.replaceAll(" ", "-"));
  };

  if (!newProducts || !newProducts.length) return null;
  if (isNewLoading) return <Loading />;

  return (
    <NewShirtsSec id="newShirts">
      <Title>Lançamentos</Title>

      <ProductContainer>
        {newProducts.map((data) => {
          const { price, discountLabel } = applyOffers(data);
          const orig = Number(data.price).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });
          const disc = Number(price).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });

          const isHover = hoveredId === data.product_id;
          const isOutOfStock = data.quantity <= 0;

          const imgUrl = data.image?.startsWith("http")
            ? data.image
            : `${API_BASE}${data.image}`;

          return (
            <ProductContent
              key={data.product_id}
              onClick={() => getProductId(data)}
              onMouseEnter={() => setHoveredId(data.product_id)}
              onMouseLeave={() => setHoveredId(null)}
              onTouchMove={() => setHoveredId(data.product_id)}
              onBlur={() => setHoveredId(null)}
              tabIndex={0}
              role="button"
              style={{ opacity: isOutOfStock ? 0.7 : 1 }}
            >
              <img src={imgUrl} alt="T-shirt" />

              {isOutOfStock && (
                <span
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    backgroundColor: "rgba(0,0,0,0.7)",
                    color: "white",
                    padding: "5px 10px",
                    fontWeight: "bold",
                    borderRadius: "5px",
                    zIndex: 2,
                    pointerEvents: "none",
                  }}
                >
                  ESGOTADO
                </span>
              )}

              <ShirtInfo>
                <span>{data.category}</span>
                <span>{data.name}</span>

                {!isOutOfStock ? (
                  <PriceWrapper>
                    {discountLabel ? (
                      <>
                        <span className="old-price">{orig}</span>
                        <span className="discount-price">{disc}</span>
                      </>
                    ) : (
                      <span className="regular-price">{orig}</span>
                    )}
                  </PriceWrapper>
                ) : (
                  <span
                    style={{
                      color: "#555",
                      fontSize: "1rem",
                      marginTop: "10px",
                    }}
                  >
                    SEM ESTOQUE
                  </span>
                )}
              </ShirtInfo>

              {!isOutOfStock && (
                <button
                  type="button"
                  aria-label={`Adicionar ${data.name} ao carrinho`}
                  className="icon-shoppingCart"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToCart(data, 1, { increment: true });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                    }
                  }}
                  style={{
                    position: "absolute",
                    top: 13,
                    right: 13,
                    display: isHover ? "block" : "none",
                  }}
                >
                  <MdAddShoppingCart size={27} />
                </button>
              )}
            </ProductContent>
          );
        })}
      </ProductContainer>
    </NewShirtsSec>
  );
}

export default NewShirstSection;
