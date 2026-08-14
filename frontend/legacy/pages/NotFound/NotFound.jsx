import styled from "styled-components";
import { Link } from "react-router-dom";
import { FaExclamationTriangle } from "react-icons/fa";
import AnnouncementBar from "../../components/AnnouncementBar/AnnouncementBar";
import Header from "../../components/HeaderSection/header/Header";
import Footer from "../../components/Footer/Footer";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  padding: 20px;

  h1 {
    font-size: 6rem;
    color: #eee;
    margin: 0;
    line-height: 1;
  }
  h2 {
    font-size: 2rem;
    margin-bottom: 10px;
    color: #333;
  }
  p {
    color: #666;
    margin-bottom: 30px;
    max-width: 400px;
  }

  .icon {
    font-size: 4rem;
    color: #ff9800;
    margin-bottom: 20px;
  }

  a {
    background: #000;
    color: white;
    padding: 12px 25px;
    border-radius: 5px;
    text-decoration: none;
    font-weight: 600;
    transition: background 0.2s;
    &:hover {
      background: #333;
    }
  }
`;

function NotFound() {
  return (
    <>
      <AnnouncementBar />
      <Header />
      <Container>
        <FaExclamationTriangle className="icon" />
        <h1>404</h1>
        <h2>Página não encontrada</h2>
        <p>
          Ops! A página que você está procurando não existe ou foi removida.
        </p>
        <Link to="/site">Voltar para a Loja</Link>
      </Container>
      <Footer />
    </>
  );
}

export default NotFound;
