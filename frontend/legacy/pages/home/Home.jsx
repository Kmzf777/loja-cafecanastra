import logoShopnaw from "../../assets/novalogo.jpeg";
import "./Home.scss";
import { FaWhatsapp } from "react-icons/fa";
import { FaInstagram } from "react-icons/fa";
import WhatsappImage from "../../assets/whatsapp.png";
import InstagramImage from "../../assets/instagram.png";
import { useNavigate } from "react-router-dom";
import { useContext } from "react";
import configContext from "../../contexts/configContext/createConfigContext";
import bannerDesktop from "../../assets/db67511c-c95b-40a4-a370-b5a307258e4b.jpg";
import bannerMobile from "../../assets/4bd0d730-c352-48c9-aeac-f059f5fc6cdd.jpg";

function Home() {
  const navigate = useNavigate();
  const { whatsapp_number } = useContext(configContext);

  const cleanPhone = whatsapp_number ? whatsapp_number.replace(/\D/g, "") : "";

  return (
    <>
      <section className="sec">
        <div className="banner-img-container">
          <picture>
            <source media="(max-width: 700px)" srcSet={bannerMobile} />
            <img src={bannerDesktop} alt="Banner da Loja Shop Naw" />
          </picture>
        </div>

        <div className="logo-container">
          <img src={logoShopnaw} alt="Logo Shop Naw" />
        </div>
      </section>

      <main>
        <section className="section1">
          <span id="shopNaw">Shop Naw</span>
          <div>
            <a
              href={`https://wa.me/55${cleanPhone}`}
              target="_blank"
              rel="noreferrer"
              title="Fale conosco no WhatsApp"
            >
              <FaWhatsapp id="whatsappIcon" />
            </a>

            <a
              href={`https://instagram.com/shopnaw_`}
              target="_blank"
              rel="noreferrer"
              title="Siga-nos no Instagram"
            >
              <FaInstagram id="instagramIcon" />
            </a>
          </div>
        </section>

        <section className="section2">
          <div onClick={() => navigate("/site")}>
            <img src={logoShopnaw} />
            <span>Nosso site</span>
          </div>

          <div>
            <a
              href={`https://wa.me/55${cleanPhone}`}
              target="_blank"
              rel="noreferrer"
              className="social-icon"
              title="Fale conosco no WhatsApp"
            >
              <img src={WhatsappImage} />
              <span>Suporte Whatsapp</span>
            </a>
          </div>

          <div>
            <a
              href={`https://instagram.com/shopnaw_`}
              target="_blank"
              rel="noreferrer"
              className="social-icon"
              title="Siga-nos no Instagram"
            >
              <img src={InstagramImage} />
              <span>Login • Instagram</span>
            </a>
          </div>
        </section>

        <section className="section3">
          <span>
            Estilo, graça e sofisticação em cada peça. Encontre o look perfeito
            para você.
          </span>
        </section>
      </main>
    </>
  );
}

export default Home;
