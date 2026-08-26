import { API_BASE } from "../../../api";
import { toast } from "react-toastify";
import {
  useEffect,
  useState,
  useContext,
  useCallback,
  useRef,
} from "react";
import {
  FaChevronLeft,
  FaChevronRight,
  FaDownload,
  FaEye,
  FaTimes,
} from "react-icons/fa";
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
import {
  ACOES_BLING,
  estadoDoBling,
  mesclarPedido,
  pedidoPodeIrAoBling,
} from "@/lib/painel/bling/contrato";
import { useBlingAcoes } from "../Bling/useBlingAcoes";

/**
 * CÓPIA LOCAL do vocabulário de status — a fonte é
 * `backend/src/utils/statusDePedido.js` (que espelha o CHECK da migração
 * 0009). O backend RECUSA com 400 qualquer valor fora desta lista, e recusa
 * em especial o vocabulário antigo em inglês ("pending", "sent"...): enviar
 * inglês daqui não é bug silencioso, é erro na cara do gestor. Se a lista
 * mudar lá, muda aqui.
 */
const STATUS_DO_PEDIDO = [
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "aprovado", rotulo: "Aprovado" },
  { valor: "em_processamento", rotulo: "Em processamento" },
  { valor: "autorizado", rotulo: "Autorizado" },
  { valor: "enviado", rotulo: "Enviado" },
  { valor: "entregue", rotulo: "Entregue" },
  { valor: "cancelado", rotulo: "Cancelado" },
  { valor: "rejeitado", rotulo: "Rejeitado" },
  { valor: "reembolsado", rotulo: "Reembolsado" },
];

const rotuloDeStatus = (status) =>
  STATUS_DO_PEDIDO.find((s) => s.valor === status)?.rotulo || status;

const ModalOverlay = ({ children, onClose }) => {
  // O onClose vive num ref para o efeito de teclado/foco rodar UMA vez por
  // abertura: com onClose na lista de dependências, cada re-render do pai
  // (que passa arrow function nova) removeria e recolocaria o listener — e o
  // cleanup devolveria o foco ao gatilho com o modal ainda aberto.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // Quem abriu o modal foi um clique: é para lá que o foco volta quando
    // ele fechar — sem isso, teclado e leitor de tela ficam perdidos no topo
    // da página.
    const gatilho = document.activeElement;
    const aoTeclar = (e) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
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
          aria-label="Fechar"
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
};

const formatAddress = (addr) => {
  if (!addr) return "Endereço não informado";
  return `${addr.street || "Rua não inf."}, ${addr.number || "S/N"} - ${
    addr.neighborhood || ""
  }, ${addr.city || ""} - ${addr.state || ""} (CEP: ${addr.zip_code || ""})`;
};

const moeda = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const { authFetch } = useContext(authContext);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  /**
   * `erro` existe pelo mesmo motivo do HomeDashboard: zero pedidos é um
   * número plausível. A versão anterior só logava no console e a tela
   * mostrava "Nenhum pedido encontrado." com o servidor fora do ar — mentira
   * apresentada com confiança.
   */
  const [erro, setErro] = useState(null);

  // Modal de rastreio: substitui o window.prompt. Guarda o pedido alvo e o
  // texto digitado; null = fechado.
  const [rastreio, setRastreio] = useState(null);

  // Exportação CSV: período opcional + trava de duplo clique.
  const [exportDe, setExportDe] = useState("");
  const [exportAte, setExportAte] = useState("");
  const [exportando, setExportando] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await authFetch(
        `${API_BASE}/admin/orders?page=${page}&limit=10`,
      );
      if (res.ok) {
        const data = await res.json();
        setOrders(data.data || []);
        setTotalPages(data.totalPages || 1);
        setErro(null);
      } else {
        setErro(`Não foi possível carregar os pedidos (erro ${res.status}).`);
      }
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setLoading(false);
    }
  }, [authFetch, page]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  /**
   * BLING NO MODAL DE DETALHE — porque é AQUI que o gestor está quando
   * percebe o problema.
   *
   * A tela dedicada (`/dashboard/bling`) é para trabalhar a fila; esta é para
   * o momento em que ele abriu um pedido para conferir e viu que a nota não
   * saiu. Mandá-lo trocar de tela e reencontrar o pedido pelos últimos seis
   * dígitos seria transformar um clique em uma busca.
   *
   * As três chamadas NÃO estão duplicadas: `useBlingAcoes` é o mesmo hook das
   * duas telas — trava de duplo clique, carregamento por linha e a frase do
   * servidor repassada inteira vêm de um lugar só.
   */
  const aoAtualizarPedidoDoBling = useCallback((orderId, pedido) => {
    setOrders((atuais) =>
      atuais.map((o) => (o.order_id === orderId ? mesclarPedido(o, pedido) : o)),
    );
    // O modal guarda uma CÓPIA da linha (`setSelectedOrder(order)`), então
    // atualizar só a lista deixaria o que está na frente dos olhos velho.
    setSelectedOrder((atual) =>
      atual && atual.order_id === orderId ? mesclarPedido(atual, pedido) : atual,
    );
  }, []);

  const { acaoEmAndamento, acionar: acionarBling } = useBlingAcoes({
    authFetch,
    aoAtualizarPedido: aoAtualizarPedidoDoBling,
    aoFalhar: setErro,
  });

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

  const enviarStatus = async (orderId, newStatus, trackingCode = null) => {
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
        // O backend explica a recusa (status inválido, pedido inexistente);
        // repassar a frase vale mais que um "Erro ao atualizar." genérico.
        // Toast de 2s some rápido demais para uma falha de OPERAÇÃO — a
        // frase vai também para a tarja persistente.
        const corpo = await res.json().catch(() => ({}));
        const frase = corpo.error || "Erro ao atualizar o pedido.";
        toast.error(frase);
        setErro(`Falha ao atualizar o pedido: ${frase}`);
      }
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
      toast.error("Erro de conexão.");
      setErro("Falha ao atualizar o pedido: erro de conexão com o servidor.");
    }
  };

  const handleStatusChange = (orderId, newStatus) => {
    if (newStatus === "enviado") {
      // Rastreio pede um modal, não um window.prompt: o prompt nativo não
      // tem rótulo claro, some em alguns navegadores e não segue o visual
      // do painel. Cancelar fecha sem efeito — o select volta sozinho no
      // re-render porque o valor vem de order.status.
      setRastreio({ orderId, codigo: "" });
      return;
    }
    enviarStatus(orderId, newStatus);
  };

  const confirmarRastreio = () => {
    if (!rastreio) return;
    const codigo = rastreio.codigo.trim();
    setRastreio(null);
    // Vazio segue vazio de propósito: entrega local não tem código.
    enviarStatus(rastreio.orderId, "enviado", codigo);
  };

  const handleExport = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams();
      if (exportDe) params.set("de", exportDe);
      if (exportAte) params.set("ate", exportAte);
      const query = params.toString();
      const res = await authFetch(
        `${API_BASE}/admin/orders/export${query ? `?${query}` : ""}`,
      );

      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        toast.error(corpo.error || `Falha ao exportar (erro ${res.status}).`);
        return;
      }

      // Download via blob: a rota exige Authorization, então um <a href>
      // direto chegaria sem token e voltaria 401.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sufixo = [exportDe && `de-${exportDe}`, exportAte && `ate-${exportAte}`]
        .filter(Boolean)
        .join("-");
      a.download = sufixo ? `pedidos-${sufixo}.csv` : "pedidos.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao exportar pedidos:", err);
      toast.error("Erro de conexão ao exportar.");
    } finally {
      setExportando(false);
    }
  };

  // Cores por status, no vocabulário português da 0009.
  const getStatusColor = (status) => {
    switch (status) {
      case "aprovado":
        return "#2e7d32";
      case "pendente":
        return "#f57c00";
      case "em_processamento":
        return "#7b1fa2";
      case "autorizado":
        return "#00838f";
      case "enviado":
        return "#1976d2";
      case "entregue":
        return "#00796b";
      case "cancelado":
      case "rejeitado":
        return "#d32f2f";
      case "reembolsado":
        return "#5d4037";
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

  const selectDeStatus = (order, style) => (
    <select
      value={order.status}
      onChange={(e) => handleStatusChange(order.order_id, e.target.value)}
      style={style}
    >
      {STATUS_DO_PEDIDO.map((s) => (
        <option key={s.valor} value={s.valor}>
          {s.rotulo}
        </option>
      ))}
    </select>
  );

  // Derivados do pedido aberto no modal — calculados aqui para o JSX lá
  // embaixo ficar sem lógica (o resto do arquivo segue a mesma regra).
  const estadoBling = selectedOrder ? estadoDoBling(selectedOrder) : null;
  const acaoBlingEmAndamento = selectedOrder
    ? acaoEmAndamento(selectedOrder.order_id)
    : null;
  const selecionadoVaiAoBling = pedidoPodeIrAoBling(selectedOrder);

  if (loading) return <Loading />;

  return (
    <div style={{ padding: "2rem", boxSizing: "border-box", width: "100%" }}>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#333" }}>
        Gestão de Pedidos
      </h2>

      {/* Tarja de erro ANTES da tabela (padrão do HomeDashboard): se algo
          falhou — carregamento OU uma operação de status/rastreio —, o
          gestor precisa saber antes de acreditar no que está na tela. Ela é
          persistente (toast de 2s some rápido demais), tem o retry na mão e
          é dismissível. */}
      {erro && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
            margin: "0 0 16px",
            padding: "10px 14px",
            borderLeft: "3px solid #b3261e",
            background: "#fdf2f1",
            color: "#5c1a14",
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1, minWidth: "200px" }}>
            {erro} A lista abaixo pode estar vazia ou desatualizada.
          </span>
          <button
            onClick={() => {
              setLoading(true);
              fetchOrders();
            }}
            style={{
              padding: "6px 12px",
              background: "#b3261e",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Tentar novamente
          </button>
          <button
            onClick={() => setErro(null)}
            aria-label="Dispensar aviso"
            title="Dispensar aviso"
            style={{
              background: "none",
              border: "none",
              color: "#5c1a14",
              cursor: "pointer",
              fontSize: "1rem",
              padding: "4px",
            }}
          >
            <FaTimes />
          </button>
        </div>
      )}

      {/* Exportação para Excel: período opcional, arquivo baixado na hora. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: "10px",
          marginBottom: "1.5rem",
          padding: "12px",
          background: "#fafafa",
          border: "1px solid #eee",
          borderRadius: "6px",
        }}
      >
        <label style={{ fontSize: "0.85rem", color: "#555" }}>
          De
          <input
            type="date"
            value={exportDe}
            onChange={(e) => setExportDe(e.target.value)}
            style={{
              display: "block",
              marginTop: 4,
              padding: "6px 8px",
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <label style={{ fontSize: "0.85rem", color: "#555" }}>
          Até
          <input
            type="date"
            value={exportAte}
            onChange={(e) => setExportAte(e.target.value)}
            style={{
              display: "block",
              marginTop: 4,
              padding: "6px 8px",
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
        </label>
        <button
          onClick={handleExport}
          disabled={exportando}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: exportando ? "#aaa" : "#2e7d32",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: exportando ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          <FaDownload size={13} />
          {exportando ? "Exportando..." : "Exportar CSV"}
        </button>
        <span style={{ fontSize: "0.8rem", color: "#888" }}>
          Sem datas, exporta todos os pedidos.
        </span>
      </div>

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
                  <Td>{moeda(order.total_amount)}</Td>
                  <Td
                    style={{
                      color: getStatusColor(order.status),
                      fontWeight: "bold",
                    }}
                  >
                    {rotuloDeStatus(order.status)}
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
                    {selectDeStatus(order, {
                      padding: "5px",
                      borderRadius: "4px",
                    })}
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
                  {moeda(order.total_amount)}
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
                  {rotuloDeStatus(order.status)}
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

                {selectDeStatus(order, {
                  flex: 1,
                  padding: "5px",
                  borderRadius: "4px",
                  border: "1px solid #ddd",
                })}
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

      {/* Modal de rastreio: o fim do window.prompt. */}
      {rastreio && (
        <ModalOverlay onClose={() => setRastreio(null)}>
          <h3 style={{ borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
            Marcar como enviado
          </h3>
          <p style={{ margin: "12px 0 6px", fontSize: "0.9rem", color: "#555" }}>
            Código de rastreio (deixe vazio para entrega local):
          </p>
          <input
            autoFocus
            value={rastreio.codigo}
            onChange={(e) =>
              setRastreio((r) => ({ ...r, codigo: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarRastreio();
            }}
            placeholder="Ex: AA123456789BR"
            style={{
              width: "100%",
              padding: "10px",
              border: "1px solid #ccc",
              borderRadius: "4px",
              boxSizing: "border-box",
              fontSize: "1rem",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              marginTop: "16px",
            }}
          >
            <button
              onClick={() => setRastreio(null)}
              style={{
                padding: "8px 16px",
                background: "#eee",
                color: "#333",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={confirmarRastreio}
              style={{
                padding: "8px 16px",
                background: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Confirmar envio
            </button>
          </div>
        </ModalOverlay>
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
                {moeda(selectedOrder.shipping_cost)}
              </p>
              {selectedOrder.tracking_code && (
                <p style={{ marginTop: 5 }}>
                  <strong>Rastreio:</strong> {selectedOrder.tracking_code}
                </p>
              )}
              <p style={{ marginTop: 5 }}>
                <strong>Pagamento:</strong>{" "}
                {selectedOrder.payment_method?.toUpperCase()}
              </p>
              {/* Cupom só aparece quando o pedido teve um (contrato da Onda
                  2: coupon_code/discount vêm do backend "se houver"). */}
              {selectedOrder.coupon_code && (
                <p style={{ marginTop: 5 }}>
                  <strong>Cupom:</strong> {selectedOrder.coupon_code}
                </p>
              )}
              {Number(selectedOrder.discount) > 0 && (
                <p style={{ marginTop: 5, color: "#2e7d32" }}>
                  <strong>Desconto:</strong> −{moeda(selectedOrder.discount)}
                </p>
              )}
            </div>
          </div>

          {/* BLING / NF-e — a situação no ERP e as três ações, no lugar onde
              o gestor descobre que algo ficou para trás. A tela cheia da fila
              é /dashboard/bling. */}
          <div
            style={{
              borderTop: "1px solid #eee",
              paddingTop: "10px",
              marginBottom: "20px",
            }}
          >
            <h4 style={{ fontSize: "0.9rem", color: "#666", margin: 0 }}>
              Bling (ERP e NF-e)
            </h4>
            <p
              style={{
                margin: "6px 0 0",
                color: estadoBling.cor,
                fontWeight: "bold",
              }}
            >
              {estadoBling.rotulo}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "#666" }}>
              {estadoBling.detalhe}
            </p>

            {selectedOrder.nfe_url && (
              <p style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
                <a
                  href={selectedOrder.nfe_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#1976d2" }}
                >
                  Abrir DANFE
                  {selectedOrder.nfe_numero
                    ? ` da NF-e ${selectedOrder.nfe_numero}`
                    : ""}
                </a>
              </p>
            )}

            {selecionadoVaiAoBling ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginTop: "10px",
                }}
              >
                {ACOES_BLING.map((acao) => {
                  const semPedidoDeVenda =
                    acao.precisaDeSincronia && !selectedOrder.bling_id;
                  const travado =
                    Boolean(acaoBlingEmAndamento) || semPedidoDeVenda;
                  return (
                    <button
                      key={acao.chave}
                      type="button"
                      // Uma ação em voo tranca as três: as três mexem na
                      // mesma linha do pedido.
                      disabled={travado}
                      title={
                        semPedidoDeVenda
                          ? "Sincronize o pedido com o Bling primeiro."
                          : acao.titulo
                      }
                      onClick={() => acionarBling(selectedOrder.order_id, acao.chave)}
                      style={{
                        padding: "8px 14px",
                        background: travado ? "#eee" : "#e5e7eb",
                        color: travado ? "#999" : "#333",
                        border: "none",
                        borderRadius: 4,
                        fontWeight: 500,
                        cursor: travado ? "not-allowed" : "pointer",
                      }}
                    >
                      {acaoBlingEmAndamento === acao.chave
                        ? acao.rotuloOcupado
                        : acao.rotulo}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p
                style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "#888" }}
              >
                Só pedidos pagos (aprovado, enviado, entregue) vão ao ERP —
                venda não confirmada não vira pedido de venda nem nota.
              </p>
            )}
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
                    Embalagem: {item.size || "N/A"} | Qtd: {item.quantity}
                  </div>
                </div>
                <div style={{ fontWeight: "bold" }}>{moeda(item.price)}</div>
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
            Total: {moeda(selectedOrder.total_amount)}
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
