import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Container, Card, Spinner, ActionButton } from "./VerifyEmail.style";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";
import fetchDataForm from "../../api";

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  // Status: 'verifying' | 'success' | 'error'
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState(
    "Aguarde, estamos validando seu email..."
  );

  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    if (!token) {
      setStatus("error");
      setMessage("Token de verificação não encontrado.");
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await fetchDataForm("/auth/verify-email", "POST", {
          token,
        });

        const data = await response.json();

        if (response.ok) {
          setStatus("success");
          setMessage(
            "Seu email foi verificado com sucesso! Agora você pode fazer login."
          );
        } else {
          setStatus("error");
          setMessage(
            data.message || "O link de verificação é inválido ou expirou."
          );
        }
      } catch (error) {
        console.error(error);
        setStatus("error");
        setMessage("Erro de conexão. Tente novamente mais tarde.");
      }
    };

    verifyToken();
  }, [token]);

  return (
    <Container>
      <Card>
        {status === "verifying" && (
          <>
            <Spinner />
            <h2>Verificando...</h2>
            <p>{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="icon-container success">
              <FaCheckCircle />
            </div>
            <h2>Email Verificado!</h2>
            <p>{message}</p>
            <ActionButton onClick={() => navigate("/account/login")}>
              Ir para Login
            </ActionButton>
          </>
        )}

        {status === "error" && (
          <>
            <div className="icon-container error">
              <FaTimesCircle />
            </div>
            <h2>Falha na Verificação</h2>
            <p>{message}</p>
            <ActionButton onClick={() => navigate("/")}>
              Voltar para a Loja
            </ActionButton>
          </>
        )}
      </Card>
    </Container>
  );
}

export default VerifyEmail;
