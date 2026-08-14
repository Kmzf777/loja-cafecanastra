import styled from "styled-components";
import Footer from "../../components/Footer/Footer";
import Header from "../../components/HeaderSection/header/Header";
import AnnouncementBar from "../../components/AnnouncementBar/AnnouncementBar";
import { Link, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaTimes } from "react-icons/fa";

const PageWrapper = styled.div`
  background-color: #f8f9fa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const DocumentContainer = styled.div`
  max-width: 900px;
  margin: 40px auto;
  background: white;
  padding: 50px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  flex: 1;

  @media (max-width: 768px) {
    padding: 25px;
    margin: 20px;
  }

  .header-doc {
    margin-bottom: 30px;
    border-bottom: 1px solid #eee;
    padding-bottom: 20px;

    h1 {
      font-size: 2.2rem;
      color: #111;
      margin-bottom: 10px;
    }

    span {
      font-size: 0.9rem;
      color: #666;
    }
  }

  h2 {
    font-size: 1.4rem;
    color: #222;
    margin-top: 30px;
    margin-bottom: 15px;
    font-weight: 600;
  }

  p,
  li {
    font-size: 1rem;
    line-height: 1.7;
    color: #444;
    margin-bottom: 15px;
    text-align: justify;
  }

  ul {
    padding-left: 20px;
    margin-bottom: 20px;
  }

  strong {
    color: #000;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 20px;
    color: #666;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;

    &:hover {
      color: #000;
    }
  }
`;

function PrivacyPolicy() {
  const navigate = useNavigate();

  const handleBack = (e) => {
    e.preventDefault();

    if (window.history.length > 1) {
      navigate(-1);
    } else {
      window.close();
      if (!window.closed) {
        navigate("/site");
      }
    }
  };

  const isNewTab = window.history.length === 1;

  return (
    <PageWrapper>
      <AnnouncementBar />
      <Header />

      <DocumentContainer>
        <Link to="#" onClick={handleBack} className="back-link">
          {isNewTab ? <FaTimes /> : <FaArrowLeft />}
          {isNewTab ? "Fechar Janela" : "Voltar"}
        </Link>

        <div className="header-doc">
          <h1>Política de Privacidade</h1>
          <span>
            Última atualização: {new Date().toLocaleDateString("pt-BR")}
          </span>
        </div>

        <p>
          A sua privacidade é fundamental para a <strong>Shopnaw</strong>. Esta
          Política de Privacidade descreve como coletamos, usamos, armazenamos e
          protegemos suas informações pessoais, em conformidade com a{" "}
          <strong>
            Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018)
          </strong>
          .
        </p>

        <h2>1. Coleta de Informações</h2>
        <p>
          Para processar seus pedidos e oferecer uma experiência de compra
          segura, coletamos os seguintes dados pessoais:
        </p>
        <ul>
          <li>
            <strong>Dados de Identificação:</strong> Nome completo, CPF
            (obrigatório para emissão de Nota Fiscal).
          </li>
          <li>
            <strong>Dados de Contato:</strong> E-mail e número de
            telefone/WhatsApp.
          </li>
          <li>
            <strong>Dados de Entrega:</strong> Endereço completo para envio dos
            produtos.
          </li>
          <li>
            <strong>Dados de Navegação:</strong> Endereço IP, tipo de navegador
            e páginas acessadas (via Cookies).
          </li>
        </ul>

        <h2>2. Uso das Informações</h2>
        <p>Utilizamos seus dados estritamente para as seguintes finalidades:</p>
        <ul>
          <li>
            Processar pagamentos e prevenir fraudes (através de gateways seguros
            como Mercado Pago).
          </li>
          <li>
            Realizar a entrega dos pedidos via transportadoras parceiras
            (Correios, Jadlog, etc).
          </li>
          <li>Enviar atualizações sobre o status do pedido.</li>
          <li>Cumprir obrigações legais e fiscais.</li>
        </ul>

        <h2>3. Compartilhamento de Dados</h2>
        <p>
          A Shopnaw <strong>não vende</strong> suas informações pessoais.
          Compartilhamos dados apenas com parceiros essenciais para a operação,
          como:
        </p>
        <ul>
          <li>
            Instituições Financeiras e Gateways de Pagamento (para processar a
            compra).
          </li>
          <li>Transportadoras e Logística (para entregar o produto).</li>
          <li>Autoridades governamentais (quando exigido por lei).</li>
        </ul>

        <h2>4. Segurança</h2>
        <p>
          Adotamos medidas de segurança técnicas e administrativas para proteger
          seus dados, incluindo criptografia SSL em todas as transações do site.
        </p>

        <h2>5. Seus Direitos (LGPD)</h2>
        <p>
          Como titular dos dados, você tem o direito de solicitar o acesso, a
          correção, a anonimização ou a exclusão de seus dados pessoais de nossa
          base, exceto quando a manutenção for necessária para cumprimento de
          obrigação legal.
        </p>

        <h2>6. Contato</h2>
        <p>
          Para exercer seus direitos ou tirar dúvidas sobre esta política, entre
          em contato conosco através do e-mail de suporte disponível no rodapé
          do site.
        </p>
      </DocumentContainer>
      <Footer />
    </PageWrapper>
  );
}

export default PrivacyPolicy;
