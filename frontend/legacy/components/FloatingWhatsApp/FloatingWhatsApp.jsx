import styled from "styled-components";
import { useContext } from "react";
import { FaWhatsapp } from "react-icons/fa";
import configContext from "../../contexts/configContext/createConfigContext";

const FloatBtn = styled.a`
  position: fixed;
  width: 60px;
  height: 60px;
  bottom: 40px;
  right: 40px;
  background-color: #25d366;
  color: #fff;
  border-radius: 50px;
  text-align: center;
  font-size: 30px;
  box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;

  &:hover {
    background-color: #128c7e;
  }
`;

function FloatingWhatsApp() {
  const { whatsapp_number } = useContext(configContext);

  if (!whatsapp_number) return null;

  const cleanNumber = whatsapp_number.replace(/\D/g, "");
  const link = `https://wa.me/${cleanNumber}?text=Olá! Vim pelo site e gostaria de tirar uma dúvida.`;

  return (
    <FloatBtn href={link} target="_blank" rel="noopener noreferrer">
      <FaWhatsapp />
    </FloatBtn>
  );
}

export default FloatingWhatsApp;
