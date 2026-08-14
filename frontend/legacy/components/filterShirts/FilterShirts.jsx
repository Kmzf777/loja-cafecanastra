import { useContext, useEffect, useState } from "react";
import {
  ProductContainer,
  ProductContent,
  ShirtInfo,
  PriceWrapper,
} from "../NewShirtsSection/NewShirtsSection.style";
import {
  FilteredShirts,
  NoProductDiv,
  ResultTitle,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "./FilterShirts.style";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaRegFaceFrownOpen } from "react-icons/fa6";
import { API_BASE } from "../../api";
import Loading from "../Loading/Loading";
import productContext from "../../contexts/productContext/createProductContext";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import { MdAddShoppingCart } from "react-icons/md";
import { FaChevronRight, FaChevronLeft } from "react-icons/fa";

function FilterShirts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToCart } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);
  const [hoveredId, setHoveredId] = useState(null);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(10);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const [shouldScroll, setShouldScroll] = useState(false);
  useEffect(() => {
    if (!localLoading && shouldScroll) {
      const element = document.getElementById("filtered-results");
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
      setShouldScroll(false);
    }
  }, [localLoading, shouldScroll]);

  const category = searchParams.get("category");
  const size = searchParams.get("size");

  useEffect(() => {
    const p = parseInt(searchParams.get("page") || "1", 10) || 1;
    setPage(p);
  }, [searchParams]);

  useEffect(() => {
    setLocalLoading(true);

    const rawCategory = searchParams.get("category");
    const rawSize = searchParams.get("size");
    const categoryVal =
      rawCategory && rawCategory !== "undefined" ? rawCategory : null;
    const sizeVal = rawSize && rawSize !== "undefined" ? rawSize : null;

    const params = new URLSearchParams();
    if (categoryVal) params.set("category", categoryVal);
    if (sizeVal) params.set("size", sizeVal);
    params.set("page", String(page));
    params.set("limit", String(limit));

    fetch(`${API_BASE}/dashboard?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setFilteredProducts(data.products || []);
        setTotalPages(data.totalPages || 1);
      })
      .catch((err) => console.error(err))
      .finally(() => setLocalLoading(false));
  }, [category, size, limit, page, searchParams]);

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

  const getProductId = (product) => {
    const name = product.name;
    const id = product.product_id;
    navigate(`/site/product/${name}/${id}`.replaceAll(" ", "-"));
  };

  if (localLoading) return <Loading />;

  return (
    <FilteredShirts id="filtered-results">
      {filteredProducts.length === 0 ? (
        <NoProductDiv>
          <h2>
            Opa... <FaRegFaceFrownOpen />
          </h2>
          <h3>Nenhum produto encontrado.</h3>
          <button onClick={() => navigate("/site")}>Ver todos produtos</button>
        </NoProductDiv>
      ) : (
        <ResultTitle>
          Resultados encontrados para:{" "}
          <b>
            {category || "todos"} tamanho {size || "não especificado"}
          </b>
        </ResultTitle>
      )}

      <ProductContainer>
        {filteredProducts.map((product) => {
          const { price, discountLabel } = applyOffers(product);
          const orig = Number(product.price).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });
          const disc = Number(price).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });

          const isHover = hoveredId === product.product_id;
          const isOutOfStock = product.quantity <= 0;

          const imgUrl = product.image?.startsWith("http")
            ? product.image
            : `${API_BASE}${product.image}`;

          return (
            <ProductContent
              key={product.product_id}
              onClick={() => getProductId(product)}
              onMouseEnter={() => setHoveredId(product.product_id)}
              onMouseLeave={() => setHoveredId(null)}
              onTouchMove={() => setHoveredId(product.product_id)}
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
                <span>{product.category}</span>
                <span>{product.name}</span>

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
                  aria-label={`Adicionar ${product.name} ao carrinho`}
                  className="icon-shoppingCart"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToCart(product, 1, { increment: true });
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
          <PaginationButton
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
            aria-label="Página anterior"
          >
            <FaChevronLeft size={12} />
          </PaginationButton>

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

          <PaginationButton
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Próxima página"
          >
            <FaChevronRight size={12} />
          </PaginationButton>
        </PaginationContainer>
      )}
    </FilteredShirts>
  );
}

export default FilterShirts;
