import { HeaderComponent } from "../../components/HeaderSection/header/Header.style";
import LogoShopnaw from "../../assets/novalogo.jpeg";
import { useContext, useEffect, useMemo, useState } from "react";
import productContext from "../../contexts/productContext/createProductContext";
import {
  CartDivProductsContent,
  CartInfoProduct,
  CartSectionProductsContainer,
  FinishOrderDiv,
  Section,
  ShippingContainer,
} from "./Cart.style";
import { AiOutlinePlus, AiOutlineMinus } from "react-icons/ai";
import { FaArrowRight } from "react-icons/fa";
import { FiLogIn } from "react-icons/fi";
import { MdRemoveShoppingCart } from "react-icons/md";
import { Link, useNavigate } from "react-router-dom";
import Loading from "../../components/Loading/Loading";
import { API_BASE } from "../../api";
import authContext from "../../contexts/loginContext/createAuthContext";
import { CgProfile } from "react-icons/cg";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import AnnouncementBar from "../../components/AnnouncementBar/AnnouncementBar";
import Footer from "../../components/Footer/Footer";
import FloatingWhatsApp from "../../components/FloatingWhatsApp/FloatingWhatsApp";
import { toast } from "react-toastify";

function Cart() {
  const { cart, removeFromCart, updateQuantity, isLoading } =
    useContext(productContext);
  const { user, logoutUser, initialized } = useContext(authContext);
  const { applyOffers } = useContext(promotionsContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isDropdownOpenLogged, setIsDropdownOpenLogged] = useState(false);
  const navigate = useNavigate();

  const [zipCode, setZipCode] = useState("");
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedShipping, setSelectedShipping] = useState(null);
  const [loadingShipping, setLoadingShipping] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const totalSum = useMemo(() => {
    return cart.reduce((acc, item) => {
      const { price } = applyOffers(item);
      return acc + Number(item.quantity) * Number(price);
    }, 0);
  }, [cart, applyOffers]);

  const hasStockIssue = useMemo(() => {
    return cart.some(
      (item) => Number(item.quantity) === 0 || Number(item.stock) === 0,
    );
  }, [cart]);

  const handleOpenDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleOpenDropdownLogged = () => {
    setIsDropdownOpenLogged(!isDropdownOpenLogged);
  };

  const handleLogout = () => {
    logoutUser();
    navigate("/account/login");
  };

  const calculateShipping = async () => {
    const cleanZip = zipCode.replace(/\D/g, "");

    if (cleanZip.length !== 8) {
      toast.warning("Digite um CEP válido (8 números)");
      return;
    }

    setLoadingShipping(true);
    setShippingOptions([]);
    setSelectedShipping(null);
    try {
      const res = await fetch(`${API_BASE}/shipping/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipCode, items: cart }),
      });

      const data = await res.json();

      if (Array.isArray(data)) {
        setShippingOptions(data);
      } else {
        toast.error("Não foi possível calcular o frete.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro ao calcular frete");
    } finally {
      setLoadingShipping(false);
    }
  };

  const finalTotal = useMemo(() => {
    let total = totalSum;
    if (selectedShipping) {
      total += selectedShipping.price;
    }
    return total;
  }, [totalSum, selectedShipping]);

  const goToCheckout = () => {
    if (cart.length === 0) return;

    if (hasStockIssue) {
      toast.error(
        "Você possui itens esgotados no carrinho. Remova-os para continuar.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!selectedShipping) {
      toast.warn(
        "Por favor, calcule e selecione uma opção de frete para continuar.",
      );

      document.getElementById("zipCodeInput")?.focus();
      return;
    }

    navigate("/checkout", {
      state: {
        shipping: selectedShipping,
        zipCode: zipCode,
      },
    });
  };

  if (!initialized) return <Loading />;

  return (
    <>
      <AnnouncementBar />
      <HeaderComponent onMouseLeave={() => setIsDropdownOpen(false)}>
        <div className="logoContent" onClick={() => navigate("/site")}>
          <img src={LogoShopnaw} alt="Logo-Shopnaw" />
        </div>

        <div className="nav-menu">
          {user == null ? (
            <FiLogIn
              onClick={handleOpenDropdown}
              style={{ position: "relative" }}
              className="icon"
            />
          ) : (
            <CgProfile
              onClick={handleOpenDropdownLogged}
              style={{ position: "relative" }}
              className="icon"
            />
          )}

          {user == null ? (
            <div
              style={{
                position: "absolute",
                opacity: `${isDropdownOpen ? "1" : "0"}`,
                visibility: `${isDropdownOpen ? "visible" : "hidden"}`,
              }}
              className="dropDownAccount"
            >
              <button onClick={() => navigate("/account/login")}>Entrar</button>

              <div className="signUp">
                <p>Não possui conta?</p>
                <Link to="/account/cadastro">
                  <span>Cadastrar</span>
                </Link>
              </div>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                opacity: `${isDropdownOpenLogged ? "1" : "0"}`,
                visibility: `${isDropdownOpenLogged ? "visible" : "hidden"}`,
              }}
              className="dropDownLogout"
            >
              <span>Olá, {user.name.split(" ")[0]}!</span>
              <button id="logoutBtn" onClick={handleLogout}>
                Sair
              </button>
              <button id="removeAccountBtn">Excluir conta</button>
            </div>
          )}
        </div>
      </HeaderComponent>

      <Section>
        {isLoading ? (
          <Loading />
        ) : (
          <CartSectionProductsContainer>
            {cart.length === 0 ? (
              <>
                <p className="emptyCartText">
                  <MdRemoveShoppingCart />
                  Carrinho vazio
                </p>
                <span
                  className="emptyCartSpan"
                  onClick={() => navigate("/site")}
                >
                  Clique aqui para voltar à loja e adicionar novos produtos no
                  carrinho.
                </span>
              </>
            ) : (
              cart.map((product) => {
                const stock =
                  product.stock !== undefined ? Number(product.stock) : 99;
                const qty = Number(product.quantity);
                const { price: finalPrice, discountLabel } =
                  applyOffers(product);
                const originalPrice = Number(product.price);
                const totalItem = finalPrice * qty;

                const isOutOfStock = qty === 0 || stock === 0;

                const imgUrl = product.image?.startsWith("http")
                  ? product.image
                  : `${API_BASE}${product.image}`;

                return (
                  <CartDivProductsContent key={product.product_id}>
                    <img src={imgUrl} alt="T-shirt" />

                    <CartInfoProduct>
                      <div className="someInfo">
                        <span>{product.name}</span>
                        <span>
                          Tamanho: <b>{product.size}</b>
                        </span>

                        {isOutOfStock ? (
                          <span
                            style={{
                              color: "red",
                              fontWeight: "bold",
                              marginTop: "5px",
                            }}
                          >
                            PRODUTO ESGOTADO
                          </span>
                        ) : (
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
                                    color: "#999",
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  {originalPrice.toLocaleString("pt-BR", {
                                    style: "currency",
                                    currency: "BRL",
                                  })}
                                </span>
                                <span
                                  style={{
                                    color: "#2e7d32",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {finalPrice.toLocaleString("pt-BR", {
                                    style: "currency",
                                    currency: "BRL",
                                  })}
                                  <small style={{ marginLeft: "5px" }}>
                                    / cada
                                  </small>
                                </span>
                                <small
                                  style={{
                                    color: "#e53935",
                                    fontSize: "0.8rem",
                                  }}
                                >
                                  {discountLabel}
                                </small>
                              </>
                            ) : (
                              <span id="price">
                                {originalPrice.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                })}{" "}
                                <span>/ cada</span>
                              </span>
                            )}
                          </div>
                        )}

                        <span
                          className="removeProduct"
                          onClick={() => removeFromCart(product.product_id)}
                        >
                          Excluir
                        </span>
                      </div>

                      {!isOutOfStock && (
                        <div className="buttonAndPrice">
                          <div className="divChooseQuantity">
                            <button
                              onClick={() =>
                                updateQuantity(product.product_id, qty - 1)
                              }
                              disabled={qty <= 1}
                            >
                              <AiOutlineMinus />
                            </button>
                            <span>{qty}</span>
                            <button
                              onClick={() =>
                                updateQuantity(product.product_id, qty + 1)
                              }
                              disabled={qty >= stock}
                              style={{ opacity: qty >= stock ? 0.5 : 1 }}
                            >
                              <AiOutlinePlus />
                            </button>
                          </div>

                          <span>
                            {totalItem.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                          <span>Qtd disponível: {stock}</span>
                        </div>
                      )}
                    </CartInfoProduct>
                  </CartDivProductsContent>
                );
              })
            )}
          </CartSectionProductsContainer>
        )}

        {cart.length > 0 && (
          <ShippingContainer>
            <h3>Calcular Frete</h3>
            <div className="input-group">
              <input
                id="zipCodeInput"
                type="text"
                placeholder="Digite seu CEP"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                maxLength={8}
              />
              <button onClick={calculateShipping} disabled={loadingShipping}>
                {loadingShipping ? "Calculando..." : "Calcular"}
              </button>
            </div>

            {shippingOptions.length > 0 && (
              <div className="options-list">
                {shippingOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className={`shipping-option ${
                      selectedShipping?.id === opt.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedShipping(opt)}
                  >
                    <div className="info">
                      <input
                        type="radio"
                        name="shipping"
                        checked={selectedShipping?.id === opt.id}
                        readOnly
                        //onChange={() => handleSelectShipping(opt)}
                      />

                      {opt.company_picture && (
                        <img
                          src={opt.company_picture}
                          alt=""
                          style={{ height: 20 }}
                        />
                      )}
                      <span>
                        {opt.name} - <b>{opt.days} dias úteis</b>
                      </span>
                    </div>
                    <span className="price">
                      {opt.price.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </ShippingContainer>
        )}

        <FinishOrderDiv>
          <div className="summary-row">
            <span>Subtotal</span>
            <span>
              {totalSum.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>

          {selectedShipping && (
            <div className="summary-row">
              <span>Frete ({selectedShipping.name})</span>
              <span>
                {selectedShipping.price.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>
          )}

          <div className="summary-row total">
            <span>Total Final</span>
            <span style={{ marginLeft: 10 }}>
              {finalTotal.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>

          <button onClick={goToCheckout}>
            Confirmar produtos
            <span>
              <FaArrowRight />
            </span>
          </button>
        </FinishOrderDiv>
      </Section>

      <Footer />
      <FloatingWhatsApp />
    </>
  );
}

export default Cart;
