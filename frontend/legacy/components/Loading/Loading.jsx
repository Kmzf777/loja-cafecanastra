import styled from "styled-components";
import { motion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import logo from "../../assets/novalogo.jpeg";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  width: 100vw;
  background-color: #ffffff;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
`;

const IconWrapper = styled(motion.div)`
  position: relative;
  padding: 2rem;
  background-color: #f1f5f9;
  border-radius: 50%;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.05);
`;

const LogoImage = styled(motion.img)`
  position: absolute;
  top: -20px;
  left: 25%;
  transform: translateX(-50%);
  width: 60px;
  height: 60px;
  border-radius: 50%;
`;

const LoadingMessage = styled(motion.p)`
  margin-top: 2rem;
  font-size: 1.25rem;
  font-weight: 500;
  color: #4b5563;
`;

const DotWrapper = styled.div`
  display: flex;
  gap: 0.3rem;
  margin-top: 1.5rem;
`;

const Dot = styled(motion.span)`
  width: 0.5rem;
  height: 0.5rem;
  background-color: #82858b;
  border-radius: 50%;
`;

export default function Loading() {
  return (
    <Container>
      <IconWrapper
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.1, 1] }}
        transition={{ duration: 0.8 }}
      >
        <LogoImage
          src={logo}
          alt="Shop NAW Logo"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <ShoppingBag size={48} color="#82858b" />
      </IconWrapper>

      <LoadingMessage
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      >
        Carregando produtos para você
      </LoadingMessage>

      <DotWrapper>
        {[0, 0.2, 0.4].map((delay, i) => (
          <Dot
            key={i}
            animate={{ opacity: [0.2, 1, 0.2], y: [0, -6, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, delay }}
          />
        ))}
      </DotWrapper>
    </Container>
  );
}
