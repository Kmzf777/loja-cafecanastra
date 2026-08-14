import { useContext, useEffect, useState } from "react";
import productContext from "../../contexts/productContext/createProductContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BranchShirtsSec,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "./BranchShirtsSection.style";
import {
  ProductContainer,
  ProductContent,
  ShirtInfo,
  Title,
  PriceWrapper,
} from "../NewShirtsSection/NewShirtsSection.style";
import { API_BASE } from "../../api";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import Loading from "../Loading/Loading";
import { MdAddShoppingCart } from "react-icons/md";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";

function BranchShirtsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    oldProducts,
    oldPage,
    oldTotalPages,
    setOldPage,
    isLoadingOld,
    addToCart,
    fetchOld,
  } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);
  const [hoveredId, setHoveredId] = useState(null);

  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    fetchOld(oldPage);
  }, [fetchOld, oldPage]);

  useEffect(() => {
    if (!isLoadingOld && shouldScroll) {
      const element = document.getElementById("destaques");

      if (element) {
        const scrollOptions = {
          top: element.offsetTop - 80,
          behavior: "smooth",
        };
        window.scrollTo(scrollOptions);
      }
    }
  }, [isLoadingOld, shouldScroll]);

  const getProductId = (product) => {
    const name = product.name;
    const id = product.product_id;
    navigate(`/site/product/${name}/${id}`.replaceAll(" ", "-"));
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > oldTotalPages) return;

    setOldPage(newPage);
    setShouldScroll(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(newPage));
    setSearchParams(nextParams);
  };

  const generatePagination = () => {
    if (!oldTotalPages) return [];

    const delta = 1;
    const range = [];
    const rangeWithDots = [];

    for (let i = 1; i <= oldTotalPages; i++) {
      if (
        i === 1 ||
        i === oldTotalPages ||
        (i >= oldPage - delta && i <= oldPage + delta)
      ) {
        range.push(i);
      }
    }

    let l;
    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  };

  if (!oldProducts.length) return null;
  if (isLoadingOld) return <Loading />;

  return (
    <BranchShirtsSec id="destaques">
      <Title>Destaques</Title>

      <ProductContainer>
        {oldProducts.map((data) => {
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

      {oldTotalPages > 1 && (
        <PaginationContainer>
          {/* Botão Anterior */}
          <PaginationButton
            onClick={() => handlePageChange(oldPage - 1)}
            disabled={oldPage === 1}
            aria-label="Página anterior"
          >
            <FaChevronLeft size={12} />
          </PaginationButton>

          {/* Números */}
          {generatePagination().map((item, index) => {
            if (item === "...") {
              return <Dots key={index}>...</Dots>;
            }
            return (
              <PaginationButton
                key={index}
                isActive={oldPage === item}
                onClick={() => handlePageChange(item)}
              >
                {item}
              </PaginationButton>
            );
          })}

          {/* Botão Próxima */}
          <PaginationButton
            onClick={() => handlePageChange(oldPage + 1)}
            disabled={oldPage === oldTotalPages}
            aria-label="Próxima página"
          >
            <FaChevronRight size={12} />
          </PaginationButton>
        </PaginationContainer>
      )}
    </BranchShirtsSec>
  );
}

export default BranchShirtsSection;
