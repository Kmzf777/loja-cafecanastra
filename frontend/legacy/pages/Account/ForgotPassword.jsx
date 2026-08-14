import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { API_BASE } from "../../api";
import Loading from "../../components/Loading/Loading";
import authContext from "../../contexts/loginContext/createAuthContext";

import {
  Container,
  FormBox,
  InputContainer,
  Button,
  BackLink,
} from "./ForgotPassword.style";
import { HiOutlineMail } from "react-icons/hi";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const { authFetch } = useContext(authContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.warning("Digite seu e-mail.");

    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(data.message);
        setEmail("");
      } else {
        toast.error(data.message || "Erro ao enviar.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container>
      <FormBox onSubmit={handleSubmit}>
        <div>
          <h2>Recuperar Senha</h2>
          <p>
            Digite seu e-mail abaixo e enviaremos um link seguro para você
            redefinir sua senha.
          </p>
        </div>

        <InputContainer>
          <HiOutlineMail className="icon" />
          <input
            type="email"
            placeholder="Seu e-mail cadastrado"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </InputContainer>

        <Button type="submit" disabled={loading}>
          {loading ? "Enviando..." : "Enviar Link"}
        </Button>

        <BackLink>
          <Link to="/account/login">← Voltar para o Login</Link>
        </BackLink>
      </FormBox>

      {loading && <Loading />}
    </Container>
  );
}

export default ForgotPassword;
