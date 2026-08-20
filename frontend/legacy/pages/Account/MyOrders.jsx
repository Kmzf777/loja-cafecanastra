import { useEffect, useState, useContext, useRef } from "react";
import styled from "styled-components";
import { Link } from "react-router-dom";
import {
  FaBoxOpen,
  FaChevronRight,
  FaArrowLeft,
  FaTimes,
} from "react-icons/fa";
import authContext from "../../contexts/loginContext/createAuthContext";
import { API_BASE } from "../../api";
import Loading from "../../components/Loading/Loading";
import Header from "../../components/HeaderSection/header/Header";
import Footer from "../../components/Footer/Footer";
import AnnouncementBar from "../../components/AnnouncementBar/AnnouncementBar";
import PropTypes from "prop-types";

// --- ESTILOS ---
const Container = styled.div`
  max-width: 1000px;
  margin: 40px auto;
  padding: 0 20px;
  min-height: 60vh;
`;

const TitleSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 30px;

  h1 {
    font-size: 1.8rem;
    color: #333;
  }
`;

const BackButton = styled(Link)`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #666;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
  &:hover {
    color: #000;
  }
`;

const OrdersList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const OrderCard = styled.div`
  background: white;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
  cursor: pointer;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
    border-color: #ddd;
  }
`;

const OrderHeader = styled.div`
  background: #f9f9f9;
  padding: 15px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
  font-size: 0.9rem;
  color: #555;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
`;

const OrderBody = styled.div`
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }
`;

const OrderInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;

  strong {
    font-size: 1.1rem;
    color: #333;
  }
  span {
    color: #666;
    font-size: 0.95rem;
  }
`;

const StatusBadge = styled.span`
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;

  ${(props) => {
    switch (props.status) {
      case "aprovado":
        return `background: #e8f5e9; color: #2e7d32;`;
      case "pendente":
        return `background: #fff3e0; color: #ef6c00;`;
      case "em_processamento":
      case "autorizado":
        return `background: #f3e5f5; color: #6a1b9a;`;
      case "enviado":
        return `background: #e3f2fd; color: #1565c0;`;
      case "entregue":
        return `background: #e0f2f1; color: #00695c;`;
      case "cancelado":
      case "rejeitado":
      case "reembolsado":
        return `background: #ffebee; color: #c62828;`;
      default:
        return `background: #f5f5f5; color: #616161;`;
    }
  }}
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 60px 20px;
  color: #888;

  svg {
    font-size: 3rem;
    margin-bottom: 15px;
    opacity: 0.5;
  }
  p {
    font-size: 1.1rem;
    margin-bottom: 20px;
  }

  a {
    display: inline-block;
    background: #000;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    text-decoration: none;
    font-weight: 600;
    &:hover {
      background: #333;
    }
  }
`;

// --- MODAL STYLE ---
const ModalOverlay = ({ children, onClose }) => {
  // Ref para o efeito rodar UMA vez por abertura: com onClose (arrow nova a
  // cada render do pai) nas dependências, o cleanup devolveria o foco ao
  // gatilho com o modal ainda aberto.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const gatilho = document.activeElement;
    const aoTeclar = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      // O foco volta a quem abriu — teclado e leitor de tela não ficam
      // perdidos no topo da página.
      if (gatilho instanceof HTMLElement) gatilho.focus();
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 10000,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "white",
          padding: "25px",
          borderRadius: "12px",
          width: "600px",
          maxWidth: "100%",
          maxHeight: "85vh",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          position: "relative",
          overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            position: "absolute",
            top: "15px",
            right: "15px",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "1.2rem",
            color: "#666",
          }}
        >
          <FaTimes />
        </button>
        {children}
      </div>
    </div>
  );
};

// Vocabulário português da migração 0009 (backend/src/utils/statusDePedido.js).
const translateStatus = (status) => {
  const map = {
    pendente: "Pendente",
    aprovado: "Aprovado",
    em_processamento: "Em análise",
    autorizado: "Autorizado",
    enviado: "Enviado",
    entregue: "Entregue",
    cancelado: "Cancelado",
    rejeitado: "Recusado",
    reembolsado: "Reembolsado",
  };
  return map[status] || status;
};

const formatAddress = (addr) => {
  if (!addr) return "Endereço não informado";
  let a = addr;
  if (typeof addr === "string") {
    try {
      a = JSON.parse(addr);
    } catch {
      return addr;
    }
  }

  return `${a.street || "Rua não inf."}, ${a.number || "S/N"} 
    ${a.complement ? `- ${a.complement}` : ""} - 
    ${a.neighborhood || ""}, ${a.city || ""} - ${a.state || ""} 
    (CEP: ${a.zip_code || ""})`;
};

const getTrackingLink = (method, code) => {
  const m = method ? method.toLowerCase() : "";

  // 1. Correios (PAC, SEDEX, Mini Envios)
  if (
    (m.includes("pac") && !m.includes("kage")) ||
    m.includes("sedex") ||
    m.includes("correios")
  ) {
    return {
      label: "Rastrear nos Correios",
      url: `https://rastreamento.correios.com.br/app/index.php?objeto=${code}`,
    };
  }

  // 2. Jadlog (.Package, .Com ou o nome Jadlog)
  if (m.includes("jadlog") || m.includes(".package") || m.includes(".com")) {
    return {
      label: "Rastrear Envio (Jadlog)",
      url: `https://linketrack.com/track?codigo=${code}`,
    };
  }

  // 3. Loggi, Azul, Latam ou Genérico
  return {
    label: "Buscar Rastreio",
    url: `https://www.google.com/search?q=rastreio+${code}`,
  };
};

function MyOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  // Falha de carregamento NÃO pode virar "Você ainda não fez nenhum pedido"
  // — zero pedidos é plausível, e a mentira passaria por verdade.
  const [erro, setErro] = useState(null);
  const { authFetch, user } = useContext(authContext);

  useEffect(() => {
    if (!user) return;

    const fetchOrders = async () => {
      try {
        const res = await authFetch(`${API_BASE}/my-orders`);
        if (res.ok) {
          const data = await res.json();
          setOrders(data);
          setErro(null);
        } else {
          console.error("Erro ao buscar pedidos");
          setErro(`Não foi possível carregar seus pedidos (erro ${res.status}).`);
        }
      } catch (err) {
        console.error(err);
        setErro("Não foi possível falar com o servidor.");
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [authFetch, user]);

  const parseItems = (items) => {
    if (Array.isArray(items)) return items;
    if (typeof items === "string") {
      try {
        return JSON.parse(items);
      } catch {
        return [];
      }
    }
    return [];
  };

  const getImageUrl = (path) => {
    if (!path) return "";
    return path.startsWith("http") ? path : `${API_BASE}${path}`;
  };

  if (loading) return <Loading />;

  return (
    <>
      <AnnouncementBar />
      <Header />

      <Container>
        <TitleSection>
          <h1>Meus Pedidos</h1>
          <BackButton to="/site">
            <FaArrowLeft /> Voltar para a Loja
          </BackButton>
        </TitleSection>

        {erro && (
          <p
            role="alert"
            style={{
              margin: "0 0 16px",
              padding: "10px 14px",
              borderLeft: "3px solid #b3261e",
              background: "#fdf2f1",
              color: "#5c1a14",
              fontSize: 14,
            }}
          >
            {erro} Recarregue a página para tentar de novo.
          </p>
        )}

        {orders.length === 0 ? (
          // Com erro, a lista vazia é DESCONHECIDO, não "nenhum pedido" —
          // o convite a "começar a comprar" seria mentira apresentada com
          // confiança.
          erro ? null : (
            <EmptyState>
              <FaBoxOpen />
              <p>Você ainda não fez nenhum pedido.</p>
              <Link to="/site">Começar a comprar</Link>
            </EmptyState>
          )
        ) : (
          <OrdersList>
            {orders.map((order) => (
              <OrderCard
                key={order.order_id}
                onClick={() => setSelectedOrder(order)}
              >
                <OrderHeader>
                  <span>
                    <strong>Pedido:</strong> #
                    {order.order_id.slice(0, 8).toUpperCase()}
                  </span>
                  <span>
                    <strong>Data:</strong>{" "}
                    {new Date(order.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </OrderHeader>

                <OrderBody>
                  <OrderInfo>
                    <strong>
                      {Number(order.total_amount).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </strong>
                    <span>{parseItems(order.items).length} iten(s)</span>
                    <span style={{ fontSize: "0.8rem" }}>
                      Pagamento: {order.payment_method?.toUpperCase()}
                    </span>
                  </OrderInfo>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "15px",
                    }}
                  >
                    <StatusBadge status={order.status}>
                      {translateStatus(order.status)}
                    </StatusBadge>
                    <FaChevronRight color="#ccc" />
                  </div>
                </OrderBody>
              </OrderCard>
            ))}
          </OrdersList>
        )}
      </Container>

      {selectedOrder && (
        <ModalOverlay onClose={() => setSelectedOrder(null)}>
          <h3
            style={{
              borderBottom: "1px solid #eee",
              paddingBottom: "15px",
              marginBottom: "20px",
            }}
          >
            Detalhes do Pedido #
            {selectedOrder.order_id.slice(0, 8).toUpperCase()}
          </h3>
          <div
            style={{
              display: "grid",
              gap: "20px",
              gridTemplateColumns: "1fr 1fr",
              marginBottom: "20px",
            }}
          >
            <div>
              <h4
                style={{
                  fontSize: "0.9rem",
                  color: "#888",
                  marginBottom: "5px",
                  textTransform: "uppercase",
                }}
              >
                Entrega
              </h4>
              <p
                style={{
                  lineHeight: "1.5",
                  fontSize: "0.95rem",
                  color: "#333",
                }}
              >
                {formatAddress(selectedOrder.address_json)}
              </p>
              <p style={{ marginTop: "10px", fontSize: "0.9rem" }}>
                <strong>Método:</strong> {selectedOrder.shipping_method} <br />
              </p>
            </div>
            <div>
              <h4
                style={{
                  fontSize: "0.9rem",
                  color: "#888",
                  marginBottom: "5px",
                  textTransform: "uppercase",
                }}
              >
                Pagamento
              </h4>
              <p style={{ fontSize: "0.95rem", color: "#333" }}>
                Método:{" "}
                <strong>{selectedOrder.payment_method?.toUpperCase()}</strong>{" "}
                <br />
                Status:{" "}
                <strong
                  style={{
                    color:
                      selectedOrder.status === "aprovado" ? "green" : "orange",
                  }}
                >
                  {translateStatus(selectedOrder.status)}
                </strong>
              </p>

              {selectedOrder.tracking_code && (
                <div
                  style={{
                    marginTop: "15px",
                    background: "#f0f8ff",
                    padding: "10px",
                    borderRadius: "5px",
                    border: "1px solid #cce5ff",
                  }}
                >
                  <h4
                    style={{
                      fontSize: "0.85rem",
                      color: "#004085",
                      marginBottom: "3px",
                    }}
                  >
                    {selectedOrder.tracking_code.length < 5
                      ? "Envio:"
                      : "Código de Rastreio:"}
                  </h4>

                  <p
                    style={{
                      fontWeight: "bold",
                      fontSize: "1rem",
                      color: "#0056b3",
                    }}
                  >
                    {selectedOrder.tracking_code}
                  </p>

                  {selectedOrder.tracking_code.length > 5 && (
                    <a
                      href={
                        getTrackingLink(
                          selectedOrder.shipping_method,
                          selectedOrder.tracking_code,
                        ).url
                      }
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: "0.8rem",
                        textDecoration: "underline",
                        color: "#0056b3",
                        display: "block",
                        marginTop: "5px",
                      }}
                    >
                      {
                        getTrackingLink(
                          selectedOrder.shipping_method,
                          selectedOrder.tracking_code,
                        ).label
                      }
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <h4
            style={{
              fontSize: "0.9rem",
              color: "#888",
              marginBottom: "10px",
              textTransform: "uppercase",
              borderTop: "1px solid #eee",
              paddingTop: "15px",
            }}
          >
            Itens do Pedido
          </h4>
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              paddingRight: "5px",
              paddingBottom: "5px",
            }}
          >
            {parseItems(selectedOrder.items).map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  borderBottom: "1px solid #f9f9f9",
                  paddingBottom: "10px",
                }}
              >
                {item.image && (
                  <img
                    src={getImageUrl(item.image)}
                    alt={item.name}
                    style={{
                      width: "50px",
                      height: "50px",
                      minWidth: "50px",
                      flexShrink: 0,
                      objectFit: "cover",
                      borderRadius: "4px",
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "600", fontSize: "0.95rem" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    Embalagem: {item.size} | Qtd: {item.quantity}
                  </div>
                </div>
                <div style={{ fontWeight: "600" }}>
                  {Number(item.price).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: "20px",
              borderTop: "1px solid #eee",
              paddingTop: "15px",
              textAlign: "right",
            }}
          >
            {/* Desconto só quando houve (contrato: discount > 0 = teve
                cupom); o código junto explica DE ONDE veio o abatimento. */}
            {Number(selectedOrder.discount) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "5px",
                  color: "#2e7d32",
                }}
              >
                <span>
                  Desconto
                  {selectedOrder.coupon_code
                    ? ` (cupom ${selectedOrder.coupon_code})`
                    : ""}
                  :
                </span>
                <span>
                  −
                  {Number(selectedOrder.discount).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "5px",
                color: "#666",
              }}
            >
              <span>Frete:</span>
              <span>
                {Number(selectedOrder.shipping_cost || 0).toLocaleString(
                  "pt-BR",
                  { style: "currency", currency: "BRL" },
                )}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "1.2rem",
                fontWeight: "bold",
                color: "#333",
              }}
            >
              <span>Total:</span>
              <span>
                {Number(selectedOrder.total_amount).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>
          </div>
        </ModalOverlay>
      )}

      <Footer />
    </>
  );
}

ModalOverlay.propTypes = {
  children: PropTypes.any,
  onClose: PropTypes.func,
};

export default MyOrders;
