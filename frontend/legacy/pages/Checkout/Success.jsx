import { useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { FaCheckCircle } from "react-icons/fa";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  text-align: center;
  padding: 20px;

  h1 {
    color: #2e7d32;
    margin-top: 20px;
  }
  p {
    font-size: 1.1rem;
    color: #555;
    margin: 10px 0;
  }

  .order-id {
    background: #eee;
    padding: 5px 10px;
    border-radius: 4px;
    font-family: monospace;
    font-weight: bold;
  }

  button {
    margin-top: 30px;
    padding: 12px 24px;
    background-color: #82858b;
    border: none;
    border-radius: 5px;
    color: white;
    font-size: 1rem;
    cursor: pointer;
    font-weight: bold;
    &:hover {
      filter: brightness(0.9);
    }
  }

  .pix-link {
    margin-top: 20px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fdfdfd;

    a {
      display: inline-block;
      margin-top: 10px;
      color: #009ee3;
      text-decoration: none;
      font-weight: bold;
    }
  }
`;

function Success() {
  const location = useLocation();
  const navigate = useNavigate();
  const { orderId, status, ticketUrl } = location.state || {};

  // Se tentar acessar direto sem comprar, manda pra home
  if (!orderId) {
    return (
      <Container>
        <p>Nenhum pedido encontrado.</p>
        <button onClick={() => navigate("/site")}>Voltar para Loja</button>
      </Container>
    );
  }

  return (
    <Container>
      <FaCheckCircle size={80} color="#2e7d32" />
      <h1>Pedido Realizado!</h1>
      <p>
        Obrigado por comprar na <strong>Shopnaw</strong>.
      </p>

      <p>
        Seu número de pedido é: <span className="order-id">{orderId}</span>
      </p>

      {ticketUrl && status === "pending" && (
        <div className="pix-link">
          <h3>Pagamento Pendente</h3>
          <p>Para finalizar, realize o pagamento via PIX/Boleto.</p>
          <a href={ticketUrl} target="_blank" rel="noopener noreferrer">
            Clique aqui para abrir o Pagamento
          </a>
        </div>
      )}

      <button onClick={() => navigate("/site")}>Continuar Comprando</button>
    </Container>
  );
}

export default Success;
