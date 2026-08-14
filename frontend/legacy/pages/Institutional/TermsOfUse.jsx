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

function TermsOfUse() {
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
          <h1>Termos de Uso</h1>
          <span>
            Última atualização: {new Date().toLocaleDateString("pt-BR")}
          </span>
        </div>

        <p>
          Bem-vindo à <strong>Shopnaw</strong>. Ao acessar e comprar em nosso
          site, você concorda com os termos e condições descritos abaixo. Estes
          termos são regidos pelas leis da República Federativa do Brasil.
        </p>

        <h2>1. Produtos e Disponibilidade</h2>
        <p>
          Nos esforçamos para exibir as cores e características dos produtos com
          a maior precisão possível. No entanto, pequenas variações podem
          ocorrer dependendo do monitor utilizado. Todas as vendas estão
          sujeitas à disponibilidade de estoque.
        </p>

        <h2>2. Preços e Pagamentos</h2>
        <p>
          Os preços exibidos estão em Reais (BRL). Reservamo-nos o direito de
          alterar preços a qualquer momento sem aviso prévio. As compras podem
          ser pagas via Cartão de Crédito, PIX ou Boleto Bancário, processadas
          de forma segura pelo <strong>Mercado Pago</strong>.
        </p>

        <h2>3. Envios e Prazos</h2>
        <p>
          O prazo de entrega e o valor do frete variam de acordo com o endereço
          informado e a modalidade de envio escolhida (Correios, Jadlog, etc). O
          prazo começa a contar a partir da confirmação do pagamento.
        </p>

        <h2>4. Trocas e Devoluções (Direito de Arrependimento)</h2>
        <p>
          Em conformidade com o{" "}
          <strong>Código de Defesa do Consumidor (Art. 49)</strong>, você tem o
          direito de desistir da compra em até{" "}
          <strong>7 (sete) dias corridos</strong> após o recebimento do produto.
        </p>
        <ul>
          <li>
            O produto deve estar sem sinais de uso, com a etiqueta intacta.
          </li>
          <li>
            Para solicitar a devolução, entre em contato com nosso suporte.
          </li>
          <li>
            O reembolso será processado após o recebimento e análise da
            mercadoria devolvida.
          </li>
        </ul>

        <h2>5. Responsabilidades</h2>
        <p>
          A Shopnaw não se responsabiliza por danos decorrentes de mau uso dos
          produtos adquiridos ou por atrasos na entrega decorrentes de casos
          fortuitos ou força maior (greves, desastres naturais, etc).
        </p>

        <h2>6. Propriedade Intelectual</h2>
        <p>
          Todo o conteúdo deste site (fotos, textos, logotipos) é propriedade da
          Shopnaw. É proibida a reprodução sem autorização prévia.
        </p>

        <h2>7. Alterações nos Termos</h2>
        <p>
          Podemos atualizar estes Termos de Uso periodicamente. Recomendamos que
          você revise esta página regularmente.
        </p>
      </DocumentContainer>
      <Footer />
    </PageWrapper>
  );
}

export default TermsOfUse;
