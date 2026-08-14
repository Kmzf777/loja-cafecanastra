import { useEffect, useContext, useMemo, useState } from "react";
import { initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { useNavigate, useLocation } from "react-router-dom";
import productContext from "../../contexts/productContext/createProductContext";
import authContext from "../../contexts/loginContext/createAuthContext";
import { API_BASE } from "../../api";
import {
  CheckoutContainer,
  PaymentSection,
  SummarySection,
  SectionInfo,
} from "./Checkout.style";
import { toast } from "react-toastify";
import AddressForm from "../../components/AddressForm/AddressForm";
import promotionsContext from "../../contexts/promotionsContext/createPromotionContext";
import Loading from "../../components/Loading/Loading";
import { IMaskInput } from "react-imask";

const validateCPF = (cpf) => {
  if (!cpf) return false;
  const cleanCpf = cpf.replace(/[^\d]+/g, "");
  if (cleanCpf.length !== 11 || /^(\d)\1{10}$/.test(cleanCpf)) return false;

  let soma = 0,
    resto;
  for (let i = 1; i <= 9; i++)
    soma += parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cleanCpf.substring(9, 10))) return false;

  soma = 0;
  for (let i = 1; i <= 10; i++)
    soma += parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cleanCpf.substring(10, 11));
};

function Checkout() {
  const { cart, setCart, refreshCartStock } = useContext(productContext);
  const { user, authFetch } = useContext(authContext);
  const { applyOffers } = useContext(promotionsContext);
  const [address, setAddress] = useState(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const shippingFromCart = location.state?.shipping || null;
  const zipCodeFromCart = location.state?.zipCode || "";
  const [loadingMP, setLoadingMP] = useState(true);

  const [showCpfModal, setShowCpfModal] = useState(false);
  const [cpfValue, setCpfValue] = useState("");
  const [savingCpf, setSavingCpf] = useState(false);

  useEffect(() => {
    initMercadoPago(import.meta.env.VITE_MP_PUBLIC_KEY, {
      locale: "pt-BR",
    });
    setLoadingMP(false);
  }, []);

  useEffect(() => {
    // Se o user carregou e não tem a propriedade CPF (clientes antigos)
    if (user && (!user.cpf || user.cpf.trim() === "")) {
      setShowCpfModal(true);
    }
  }, [user]);

  const totalAmount = useMemo(() => {
    const productsTotal = cart.reduce((acc, item) => {
      const { price } = applyOffers(item);
      return acc + Number(price) * Number(item.quantity);
    }, 0);

    const shippingPrice = shippingFromCart ? Number(shippingFromCart.price) : 0;

    return productsTotal + shippingPrice;
  }, [cart, applyOffers, shippingFromCart]);

  useEffect(() => {
    if (cart.length > 0 && totalAmount === 0) {
      toast.error("Pedido inválido (R$ 0,00). Verifique seu carrinho.");
      navigate("/checkout/carrinho");
    }
  }, [totalAmount, cart, navigate]);

  useEffect(() => {
    if (cart.length === 0 && !isSuccess) {
      navigate("/site");
    }
  }, [cart, navigate, isSuccess]);

  const initialization = {
    amount: totalAmount,
    payer: {
      email: user?.email,
      entity_type: "individual",
    },
  };

  const customization = {
    paymentMethods: {
      ticket: "all",
      bankTransfer: "all", // Habilita PIX
      creditCard: "all",
      debitCard: "all",
      mercadoPago: "all",
    },
    visual: {
      style: {
        theme: "default", // 'default' | 'dark' | 'bootstrap' | 'flat'
      },
    },
  };

  const handleSaveCpf = async () => {
    if (!validateCPF(cpfValue)) {
      return toast.error("Por favor, insira um CPF válido.");
    }

    setSavingCpf(true);
    try {
      // Faz o PUT para a nossa nova rota do Backend
      const res = await authFetch(`${API_BASE}/account/users/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: cpfValue }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("Cadastro atualizado com sucesso!");
        setShowCpfModal(false);
        // Atualiza a variável local para ele poder prosseguir
        if (user) user.cpf = cpfValue;
      } else {
        toast.error(data.message || "Erro ao salvar CPF");
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro de conexão.");
    } finally {
      setSavingCpf(false);
    }
  };

  const onSubmit = async ({ selectedPaymentMethod, formData }) => {
    if (!user?.cpf && !showCpfModal) {
      setShowCpfModal(true);
      return toast.warn("Precisamos do seu CPF para prosseguir!");
    }

    try {
      if (!formData.payer.email && user?.email) {
        formData.payer.email = user.email;
      }

      const payload = {
        formData,
        items: cart,
        userId: user?.userId,
        userEmail: user?.email,
        address: address,
        shippingCost: shippingFromCart ? shippingFromCart.price : 0,
        shippingMethod: shippingFromCart ? shippingFromCart.name : "Retirar",
        paymentMethodType: selectedPaymentMethod, // Enviando informação extra se quiser usar no log
      };

      const response = await authFetch(`${API_BASE}/checkout/process_payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        setIsSuccess(true);
        setCart([]);
        localStorage.removeItem("cart");

        navigate("/checkout/success", {
          state: {
            orderId: data.orderId,
            status: data.status,
            ticketUrl: data.ticketUrl,
          },
        });
      } else {
        if (data.error === "CPF_MISSING") {
          setShowCpfModal(true);
          return toast.warn(data.message);
        }

        if (data.details && data.details.includes("Estoque insuficiente")) {
          toast.error("Alguns itens do seu carrinho acabaram de esgotar!");
          await refreshCartStock();
          return;
        }

        console.error(data);
        if (data.details && data.details.includes("Estoque insuficiente")) {
          toast.error("Alguns itens do seu carrinho acabaram de esgotar!");
          await refreshCartStock();
          return;
        }
        toast.error("Erro: " + (data.error || "Pagamento recusado."));
        return;
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro de conexão.");
    }
  };

  const onError = async (error) => {
    console.log(error);
  };

  const onReady = async () => {};

  if (cart.length === 0) return null;
  if (loadingMP) return <Loading />;

  return (
    <>
      <CheckoutContainer>
        <SectionInfo isCompleted={!!address}>
          <SummarySection>
            <h2>Resumo do Pedido</h2>
            {cart.map((item) => {
              const { price, discountLabel } = applyOffers(item);

              return (
                <div className="item" key={item.product_id}>
                  <span>
                    {item.quantity}x {item.name}
                    {discountLabel && (
                      <small
                        style={{
                          color: "#2e7d32",
                          marginLeft: "5px",
                          fontSize: "0.8em",
                        }}
                      >
                        ({discountLabel})
                      </small>
                    )}
                  </span>
                  <span>
                    {(Number(price) * item.quantity).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </span>
                </div>
              );
            })}

            {shippingFromCart && (
              <div className="item">
                <span>Frete ({shippingFromCart.name})</span>
                <span>
                  {shippingFromCart.price.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
            )}

            <div className="total">
              <span>Total</span>
              <span>
                {totalAmount.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>
          </SummarySection>

          <AddressForm
            onAddressSaved={setAddress}
            authFetch={authFetch}
            initialZip={zipCodeFromCart}
          />
        </SectionInfo>

        {address && (
          <PaymentSection>
            <h2>Pagamento</h2>
            <Payment
              key={totalAmount}
              initialization={initialization}
              customization={customization}
              onSubmit={onSubmit}
              onReady={onReady}
              onError={onError}
            />
          </PaymentSection>
        )}
      </CheckoutContainer>

      {showCpfModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            zIndex: 10000,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              padding: "25px",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "400px",
              boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ marginBottom: "15px", color: "#333" }}>
              Aviso Importante
            </h3>
            <p
              style={{
                marginBottom: "20px",
                color: "#555",
                fontSize: "0.95rem",
                lineHeight: "1.4",
              }}
            >
              Para emitir sua nota fiscal e prosseguir com o envio, precisamos
              validar o seu CPF.
            </p>

            <label
              style={{
                display: "block",
                marginBottom: "5px",
                fontSize: "0.85rem",
                color: "#666",
              }}
            >
              Seu CPF
            </label>
            <IMaskInput
              mask="000.000.000-00"
              value={cpfValue}
              unmask={false}
              onAccept={(value) => setCpfValue(value)}
              placeholder="000.000.000-00"
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "20px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
            />

            <button
              onClick={handleSaveCpf}
              disabled={savingCpf}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "1rem",
                opacity: savingCpf ? 0.7 : 1,
              }}
            >
              {savingCpf ? "Salvando..." : "Salvar e Continuar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default Checkout;
