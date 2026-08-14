import { API_BASE } from "../../../api";
import { toast } from "react-toastify";
import { useEffect, useState, useContext, useCallback } from "react";
import { FaChevronLeft, FaChevronRight, FaEye, FaTimes } from "react-icons/fa";
import PropTypes from "prop-types";

import {
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  TableWrapper,
  CardList,
  Card,
  CardRow,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "../Clients/RegisteredClients/RegisteredClients.style";
import authContext from "../../../contexts/loginContext/createAuthContext";
import Loading from "../../Loading/Loading";

const ModalOverlay = ({ children, onClose }) => (
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
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: "white",
        padding: "20px",
        borderRadius: "8px",
        width: "600px",
        maxWidth: "90%",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        position: "relative",
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "1.2rem",
        }}
      >
        <FaTimes />
      </button>
      {children}
    </div>
  </div>
);

const formatAddress = (addr) => {
  if (!addr) return "Endereço não informado";
  return `${addr.street || "Rua não inf."}, ${addr.number || "S/N"} - ${
    addr.neighborhood || ""
  }, ${addr.city || ""} - ${addr.state || ""} (CEP: ${addr.zip_code || ""})`;
};

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const { authFetch } = useContext(authContext);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await authFetch(
        `${API_BASE}/admin/orders?page=${page}&limit=10`,
      );
      if (res.ok) {
        const data = await res.json();
        setOrders(data.data || []);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
    } finally {
      setLoading(false);
    }
  }, [authFetch, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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
        if (i - l === 2) rangeWithDots.push(l + 1);
        else if (i - l !== 1) rangeWithDots.push("...");
      }
      rangeWithDots.push(i);
      l = i;
    }
    return rangeWithDots;
  };

  const handleStatusChange = async (orderId, newStatus) => {
    let trackingCode = null;

    if (newStatus === "sent") {
      const input = window.prompt(
        "Digite o Rastreio (ou deixe vazio para local):",
      );

      if (input === null) return;
      trackingCode = input;
    }

    try {
      const res = await authFetch(
        `${API_BASE}/admin/orders/${orderId}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus, trackingCode }),
        },
      );

      if (res.ok) {
        toast.success("Status atualizado!");
        fetchOrders();
      } else {
        toast.error("Erro ao atualizar.");
      }
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
      toast.error("Erro de conexão.");
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "approved":
        return "#2e7d32";
      case "pending":
        return "#f57c00";
      case "rejected":
        return "#d32f2f";
      case "sent":
        return "#1976d2";
      case "delivered":
        return "#00796b";
      case "cancelled":
        return "#d32f2f";
      default:
        return "#333";
    }
  };

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
    <div style={{ padding: "2rem", boxSizing: "border-box", width: "100%" }}>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "2rem", color: "#333" }}>
        Gestão de Pedidos
      </h2>

      <TableWrapper>
        <Table>
          <Thead>
            <Tr>
              <Th>ID</Th>
              <Th>Cliente</Th>
              <Th>Data</Th>
              <Th>Total</Th>
              <Th>Status</Th>
              <Th>Detalhes</Th>
              <Th>Ações</Th>
            </Tr>
          </Thead>
          <Tbody>
            {orders.length === 0 ? (
              <Tr>
                <Td colSpan="7">Nenhum pedido encontrado.</Td>
              </Tr>
            ) : (
              orders.map((order) => (
                <Tr key={order.order_id}>
                  <Td>...{order.order_id.slice(-6)}</Td>
                  <Td>
                    <div>{order.user_name}</div>
                    <div style={{ fontSize: "0.8rem", color: "#666" }}>
                      {order.user_email}
                    </div>
                  </Td>
                  <Td>
                    {new Date(order.created_at).toLocaleDateString("pt-BR")}
                  </Td>
                  <Td>
                    {Number(order.total_amount).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </Td>
                  <Td
                    style={{
                      color: getStatusColor(order.status),
                      fontWeight: "bold",
                    }}
                  >
                    {order.status.toUpperCase()}
                  </Td>
                  <Td style={{ textAlign: "center" }}>
                    <button
                      onClick={() => setSelectedOrder(order)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "#555",
                      }}
                      title="Ver Itens do Pedido"
                    >
                      <FaEye size={18} />
                    </button>
                  </Td>
                  <Td>
                    <select
                      value={order.status}
                      onChange={(e) =>
                        handleStatusChange(order.order_id, e.target.value)
                      }
                      style={{ padding: "5px", borderRadius: "4px" }}
                    >
                      <option value="pending">Pendente</option>
                      <option value="approved">Aprovado</option>
                      <option value="sent">Enviado</option>
                      <option value="delivered">Entregue</option>
                      <option value="cancelled">Cancelado</option>
                    </select>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </TableWrapper>

      <CardList>
        {orders.length === 0 ? (
          <p>Nenhum pedido encontrado.</p>
        ) : (
          orders.map((order) => (
            <Card key={order.order_id}>
              <CardRow>
                <strong>ID:</strong>
                <span>...{order.order_id.slice(-6)}</span>
              </CardRow>
              <CardRow>
                <strong>Cliente:</strong>
                <div style={{ textAlign: "right" }}>
                  <div>{order.user_name}</div>
                  <small style={{ color: "#666", fontSize: "0.8rem" }}>
                    {order.user_email}
                  </small>
                </div>
              </CardRow>
              <CardRow>
                <strong>Data:</strong>
                <span>
                  {new Date(order.created_at).toLocaleDateString("pt-BR")}
                </span>
              </CardRow>
              <CardRow>
                <strong>Total:</strong>
                <span style={{ color: "#2e7d32", fontWeight: "bold" }}>
                  {Number(order.total_amount).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </CardRow>
              <CardRow>
                <strong>Status:</strong>
                <span
                  style={{
                    color: getStatusColor(order.status),
                    fontWeight: "bold",
                  }}
                >
                  {order.status.toUpperCase()}
                </span>
              </CardRow>

              {/* Ações no Mobile */}
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginTop: "10px",
                  borderTop: "1px solid #eee",
                  paddingTop: "10px",
                }}
              >
                <button
                  onClick={() => setSelectedOrder(order)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    backgroundColor: "#f0f0f0",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                  }}
                >
                  <FaEye /> Detalhes
                </button>

                <select
                  value={order.status}
                  onChange={(e) =>
                    handleStatusChange(order.order_id, e.target.value)
                  }
                  style={{
                    flex: 1,
                    padding: "5px",
                    borderRadius: "4px",
                    border: "1px solid #ddd",
                  }}
                >
                  <option value="pending">Pendente</option>
                  <option value="approved">Aprovado</option>
                  <option value="sent">Enviado</option>
                  <option value="delivered">Entregue</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </Card>
          ))
        )}
      </CardList>

      {totalPages > 1 && (
        <PaginationContainer>
          <PaginationButton
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
          >
            <FaChevronLeft size={12} />
          </PaginationButton>

          {generatePagination().map((item, index) =>
            item === "..." ? (
              <Dots key={index}>...</Dots>
            ) : (
              <PaginationButton
                key={index}
                isActive={page === item}
                onClick={() => handlePageChange(item)}
              >
                {item}
              </PaginationButton>
            ),
          )}

          <PaginationButton
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
          >
            <FaChevronRight size={12} />
          </PaginationButton>
        </PaginationContainer>
      )}

      {selectedOrder && (
        <ModalOverlay onClose={() => setSelectedOrder(null)}>
          <h3 style={{ borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
            Detalhes do Pedido
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "20px",
              marginTop: "10px",
              marginBottom: "20px",
            }}
          >
            <div>
              <h4 style={{ fontSize: "0.9rem", color: "#666" }}>
                Dados do Cliente
              </h4>
              <p>
                <strong>Nome:</strong> {selectedOrder.user_name}
              </p>
              <p>
                <strong>Email:</strong> {selectedOrder.user_email}
              </p>
              <p>
                <strong>CPF:</strong>{" "}
                {selectedOrder.user_cpf || "Não informado"}
              </p>
              <p>
                <strong>ID Pedido:</strong>{" "}
                <small>{selectedOrder.order_id}</small>
              </p>
            </div>
            <div>
              <h4 style={{ fontSize: "0.9rem", color: "#666" }}>Entrega</h4>
              <p style={{ lineHeight: "1.4" }}>
                {typeof selectedOrder.address === "object"
                  ? formatAddress(selectedOrder.address)
                  : "Endereço não disponível (Legado)"}
              </p>
              <p style={{ marginTop: 5 }}>
                <strong>Método:</strong>{" "}
                {selectedOrder.shipping_method || "Não informado"} <br />
                <strong>Custo Frete:</strong>{" "}
                {Number(selectedOrder.shipping_cost || 0).toLocaleString(
                  "pt-BR",
                  { style: "currency", currency: "BRL" },
                )}
              </p>
              <p style={{ marginTop: 5 }}>
                <strong>Pagamento:</strong>{" "}
                {selectedOrder.payment_method?.toUpperCase()}
              </p>
            </div>
          </div>

          <h4
            style={{
              marginBottom: "10px",
              borderTop: "1px solid #eee",
              paddingTop: "10px",
            }}
          >
            Itens:
          </h4>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "350px",
              overflowY: "auto",
              paddingRight: "5px",
              paddingBottom: "15px",
            }}
          >
            {parseItems(selectedOrder.items).map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  border: "1px solid #f0f0f0",
                  padding: "10px",
                  borderRadius: "5px",
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
                      objectFit: "cover",
                      borderRadius: "4px",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "bold" }}>{item.name}</div>
                  <div style={{ fontSize: "0.9rem", color: "#666" }}>
                    Tamanho: {item.size || "N/A"} | Qtd: {item.quantity}
                  </div>
                </div>
                <div style={{ fontWeight: "bold" }}>
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
              textAlign: "right",
              fontWeight: "bold",
              fontSize: "1.2rem",
            }}
          >
            Total:{" "}
            {Number(selectedOrder.total_amount).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

export default Orders;

ModalOverlay.propTypes = {
  children: PropTypes.node,
  onClose: PropTypes.func,
};
