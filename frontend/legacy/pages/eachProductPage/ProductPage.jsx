import { useContext, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  InfoProductImage,
  InfoProductText,
  NewTag,
  OldTag,
  ProductPageInfoProduct,
  ShippingSimulator,
} from "./ProductPage.style";
import { MdAddShoppingCart } from "react-icons/md";
import { AiOutlinePlus, AiOutlineMinus } from "react-icons/ai";
import { API_BASE } from "../../api";
import Loading from "../../components/Loading/Loading";
import productContext from "../../contexts/productContext/createProductContext";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import { toast } from "react-toastify";
import { FaTruck } from "react-icons/fa";

function ProductPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef();
  const { addToCart, value, setValue, cart } = useContext(productContext);
  const { applyOffers } = useContext(promotionsContext);

  const [zipCode, setZipCode] = useState("");
  const [shippingOptions, setShippingOptions] = useState([]);
  const [loadingShipping, setLoadingShipping] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/dashboard/${id}`)
      .then((res) => res.json())
      .then((prod) => {
        setProduct(prod);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && product) {
      const inCart = cart.find((p) => p.product_id === product.product_id);
      setValue(inCart?.quantity ?? 0);
    }
  }, [loading, product, cart, setValue]);

  const handleSimulateShipping = async () => {
    const cleanZip = zipCode.replace(/\D/g, "");
    if (cleanZip.length !== 8) {
      toast.warning("Digite um CEP válido.");
      return;
    }

    setLoadingShipping(true);
    setShippingOptions([]);

    try {
      const itemsPayload = [{ ...product, quantity: 1 }];

      const res = await fetch(`${API_BASE}/shipping/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipCode: cleanZip, items: itemsPayload }),
      });

      const data = await res.json();
      if (Array.isArray(data)) {
        setShippingOptions(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingShipping(false);
    }
  };

  if (loading) return <Loading />;
  if (!product) return <p>Produto não encontrado.</p>;

  const dateFromDb = new Date(product.timestamp);
  const diffDays = Math.floor(
    (Date.now() - dateFromDb) / (1000 * 60 * 60 * 24)
  );
  const { price: discountedPrice, discountLabel } = applyOffers(product);
  const formattedOrig = Number(product.price).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const formattedDisc = Number(discountedPrice).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const handleScroll = (event) => {
    event.preventDefault();
    const target = document.getElementById("description");
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  };

  const isOutOfStock = product.quantity <= 0;

  const imgUrl = product.image?.startsWith("http")
    ? product.image
    : `${API_BASE}${product.image}`;

  return (
    <>
      <ProductPageInfoProduct>
        <InfoProductImage>
          <img src={imgUrl} alt={product.name} />
        </InfoProductImage>

        <InfoProductText>
          {diffDays >= 7 ? (
            <OldTag className="old-tag">Destaque</OldTag>
          ) : (
            <NewTag className="new-tag">Lançamento</NewTag>
          )}

          <span id="name">{product.name}</span>
          {isOutOfStock ? (
            <span
              style={{
                color: "red",
                fontWeight: "bold",
                fontSize: "1.2rem",
                margin: "10px 0",
              }}
            >
              PRODUTO ESGOTADO
            </span>
          ) : (
            <span id="quantity">Quantidade disponível: {product.quantity}</span>
          )}

          {!isOutOfStock && (
            <div className="inputIncrementoOrDecremento">
              <button
                className="btn decrement"
                onClick={() => setValue((v) => Math.max(0, v - 1))}
              >
                <AiOutlineMinus />
              </button>

              <span className="number">{value}</span>

              <button
                className="btn increment"
                onClick={() => {
                  ref.current.style.display = "none";
                  setValue((v) => Math.min(product.quantity, v + 1));
                }}
              >
                <AiOutlinePlus />
              </button>
            </div>
          )}

          <p ref={ref} style={{ display: "none" }}>
            Selecione a quantidade
          </p>

          <div className="sizeAndInfo">
            <span id="size">Tamanho: {product.size}</span>
            <a href="#description" onClick={handleScroll}>
              Mais informações
            </a>
          </div>

          <div className="priceAndButton">
            {!isOutOfStock && (
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
                        fontSize: "1rem",
                        color: "#999",
                      }}
                    >
                      {formattedOrig}
                    </span>
                    <span
                      style={{
                        color: "#2e7d32",
                        fontWeight: "bold",
                      }}
                    >
                      {formattedDisc}
                    </span>
                    <small style={{ color: "#e53935" }}>{discountLabel}</small>
                  </>
                ) : (
                  <span style={{ fontWeight: "bold" }}>{formattedOrig}</span>
                )}
              </div>
            )}

            <button
              disabled={isOutOfStock}
              style={{
                opacity: isOutOfStock ? 0.5 : 1,
                cursor: isOutOfStock ? "not-allowed" : "pointer",
              }}
              onClick={() => {
                if (isOutOfStock) return;
                if (value === 0) {
                  ref.current.style.display = "block";
                  ref.current.classList.add("error-message");
                  return;
                }
                addToCart(product, value);
              }}
            >
              {isOutOfStock ? (
                "Indisponível"
              ) : (
                <>
                  <MdAddShoppingCart /> Adicionar
                </>
              )}
            </button>
          </div>

          <ShippingSimulator>
            <div className="title">
              <FaTruck /> Calcular Frete e Prazo
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder="Digite seu CEP"
                maxLength={8}
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
              />
              <button
                onClick={handleSimulateShipping}
                disabled={loadingShipping}
              >
                {loadingShipping ? "..." : "OK"}
              </button>
            </div>
            {shippingOptions.length > 0 && (
              <div className="results">
                {shippingOptions.map((opt) => (
                  <div key={opt.id} className="option">
                    <span>
                      {opt.name} ({opt.days} dias)
                    </span>
                    <strong>
                      {opt.price === 0
                        ? "Grátis"
                        : opt.price.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </ShippingSimulator>
        </InfoProductText>
      </ProductPageInfoProduct>
      <section id="description" style={{ width: "95%", margin: "10px auto" }}>
        <h3 style={{ marginBottom: "10px" }}>Descrição:</h3>
        <p style={{ lineHeight: "1.6" }}>
          {product.description || "Sem descrição disponível."}
        </p>
      </section>
    </>
  );
}

export default ProductPage;
