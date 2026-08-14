import styled from "styled-components";
import { useContext } from "react";
import configContext from "../../contexts/configContext/createConfigContext";
import { Link } from "react-router-dom";
import { FaWhatsapp, FaInstagram } from "react-icons/fa";

const FooterContainer = styled.footer`
  background-color: #f8f9fa;
  padding: 40px 20px;
  //margin-top: 50px;
  border-top: 1px solid #e9ecef;

  @media (max-width: 768px) {
    padding: 30px 15px;
    margin-top: 30px;
  }
`;

const Content = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 30px;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    text-align: center;
  }
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;

  @media (max-width: 480px) {
    align-items: center;
  }

  h3 {
    font-size: 1.1rem;
    margin-bottom: 10px;
    color: #333;
  }

  a:not(.social-icon) {
    color: #666;
    font-size: 0.9rem;
    text-decoration: none;
    line-height: 1.6;
    transition: color 0.2s;

    &:hover {
      color: #000;
      text-decoration: underline;
    }
  }

  p {
    color: #666;
    font-size: 0.9rem;
    text-decoration: none;
    line-height: 1.6;
  }
`;

const SocialLinks = styled.div`
  display: flex;
  gap: 15px;
  margin-top: 5px;

  a.social-icon {
    color: #666;
    font-size: 1.2rem;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      transform: translateY(-1.5px);
    }

    &.whatsapp:hover {
      color: #25d366;
    }

    &.instagram:hover {
      color: #e1306c;
    }
  }
`;

const Copyright = styled.div`
  text-align: center;
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid #ddd;
  color: #999;
  font-size: 0.8rem;
`;

function Footer() {
  const { site_title, whatsapp_number } = useContext(configContext);
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cleanPhone = whatsapp_number ? whatsapp_number.replace(/\D/g, "") : "";

  return (
    <FooterContainer>
      <Content>
        <Column>
          <h3>{site_title}</h3>
          <p style={{ maxWidth: "300px" }}>
            Estilo, graça e sofisticação em cada peça. Encontre o look perfeito
            para você.
          </p>

          <SocialLinks>
            {whatsapp_number && (
              <a
                href={`https://wa.me/55${cleanPhone}`}
                target="_blank"
                rel="noreferrer"
                className="social-icon whatsapp"
                title="Fale conosco no WhatsApp"
              >
                <FaWhatsapp />
              </a>
            )}
            <a
              href={`https://instagram.com/shopnaw_`}
              target="_blank"
              rel="noreferrer"
              className="social-icon instagram"
              title="Siga-nos no Instagram"
            >
              <FaInstagram />
            </a>
          </SocialLinks>
        </Column>

        <Column>
          <h3>Institucional</h3>
          <Link to="/politica-de-privacidade" onClick={scrollToTop}>
            Política de Privacidade
          </Link>
          <Link to="/termos-de-uso" onClick={scrollToTop}>
            Termos de Uso
          </Link>
        </Column>

        <Column>
          <h3>Contato</h3>
          {whatsapp_number && <p>WhatsApp: {whatsapp_number}</p>}
          <p>Email: shopnaw04@gmail.com</p>
        </Column>
      </Content>

      <Copyright>
        &copy; {new Date().getFullYear()} {site_title}. Todos os direitos
        reservados.
      </Copyright>
    </FooterContainer>
  );
}

export default Footer;
