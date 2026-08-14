import { useContext, useEffect, useState } from "react";
import searchProductContext from "../../contexts/searchProduct/createSearchProductContext";
import {
  ProductContainer,
  ProductContent,
  ShirtInfo,
  PriceWrapper,
} from "../NewShirtsSection/NewShirtsSection.style";
import {
  SearchProductSection,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "./SearchProduct.style";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NoProductDiv, ResultTitle } from "../filterShirts/FilterShirts.style";
import { FaRegFaceFrownOpen } from "react-icons/fa6";
import { API_BASE } from "../../api";
import Loading from "../Loading/Loading";
import productContext from "../../contexts/productContext/createProductContext";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import { MdAddShoppingCart } from "react-icons/md";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";

function SearchProduct() {
  const {
    dataFormSearch,
    searchProductLoading,
    page,
    setPage,
    totalPages,
    getSearchProduct,
  } = useContext(searchProductContext);
  const { addToCart } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchResult = searchParams.get("gsearch") || "";
  const [hoveredId, setHoveredId] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (searchResult) {
      getSearchProduct(searchResult, page);
    }
  }, [searchResult, page, getSearchProduct]);

  const [shouldScroll, setShouldScroll] = useState(false);
  useEffect(() => {
    if (!searchProductLoading && shouldScroll) {
      const element = document.getElementById("searched-results");
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
      setShouldScroll(false);
    }
  }, [searchProductLoading, shouldScroll]);

  const getProductId = (productId) => {
    const productIndex = dataFormSearch.findIndex(
      (data) => data.product_id == productId
    );
    if (productIndex !== -1) {
      const name = dataFormSearch[productIndex].name;
      const id = dataFormSearch[productIndex].product_id;
      navigate(`/site/product/${name}/${id}`.replaceAll(" ", "-"));
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;

    setPage(newPage);
    setShouldScroll(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("page", String(newPage));
    setSearchParams(nextParams);
  };

  const generatePagination = () => {
    if (!totalPages) return [];

    const delta = 1;
    const range = [];
    const rangeWithDots = [];

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - delta && i <= page + delta)
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

  if (searchProductLoading) return <Loading />;

  return (
    <SearchProductSection id="searched-results">
      {dataFormSearch.length === 0 ? (
        <NoProductDiv>
          <h2>
            Opa... <FaRegFaceFrownOpen />
          </h2>
          <h3>Nenhum produto encontrado.</h3>
          <button onClick={() => navigate("/site")}>Ver todos produtos</button>
        </NoProductDiv>
      ) : (
        <ResultTitle>
          Resultados encontrados para a pesquisa: <b>{searchResult}</b>
        </ResultTitle>
      )}

      <ProductContainer>
        {dataFormSearch.map((data) => {
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
              onClick={() => getProductId(data.product_id)}
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

      {totalPages > 1 && (
        <PaginationContainer>
          {/* Botão Anterior */}
          <PaginationButton
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
            title="Página anterior"
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
                isActive={page === item}
                onClick={() => handlePageChange(item)}
              >
                {item}
              </PaginationButton>
            );
          })}

          {/* Botão Próxima */}
          <PaginationButton
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
            title="Próxima página"
          >
            <FaChevronRight size={12} />
          </PaginationButton>
        </PaginationContainer>
      )}
    </SearchProductSection>
  );
}

export default SearchProduct;
