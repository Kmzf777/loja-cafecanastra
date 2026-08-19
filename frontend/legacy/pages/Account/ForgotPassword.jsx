import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Loading from "../../components/Loading/Loading";
import { pedirRedefinicao } from "../../../lib/conta/senha";

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.warning("Digite seu e-mail.");

    setLoading(true);
    try {
      await pedirRedefinicao(email);
      // A FRASE NÃO PODE CONFIRMAR QUE A CONTA EXISTE. O GoTrue responde 200
      // igual para endereço conhecido e desconhecido, de propósito: um "não
      // encontramos esse e-mail" transformaria este formulário num verificador
      // de quem é cliente da loja. A mensagem antiga vinha do servidor; esta é
      // fixa porque não há mais servidor nenhum dizendo o contrário.
      toast.success(
        "Se este e-mail estiver cadastrado, o link de redefinição já está a " +
          "caminho. Confira a caixa de entrada e o spam.",
      );
      setEmail("");
    } catch (err) {
      // `ErroDeSenha.message` já é frase de loja (limite de envio, e-mail
      // inválido). Só sobra rede como caso sem mensagem própria.
      console.error(err);
      toast.error(err?.message || "Erro de conexão.");
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
