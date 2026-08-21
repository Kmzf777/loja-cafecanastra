import styled from "styled-components";
import { motion } from "framer-motion";

/**
 * A tela de carregamento DO PAINEL.
 *
 * O QUE ELA DIZIA ANTES. Este arquivo veio inteiro da Shopnaw, a loja de
 * camisetas de onde o painel foi herdado: `alt="Shop NAW Logo"`, a logo
 * `assets/novalogo.jpeg` e a frase "Carregando produtos para você" — a tela de
 * espera de uma LOJA, exibida para o gestor do Café Canastra toda vez que o
 * `AdminRoutes` conferia a sessão. Era a marca errada, na hora em que a pessoa
 * só olha para a tela.
 *
 * A logo vem de `/logo-canastra.png`, servida de `public/` pelo mesmo Next que
 * serve esta ilha — mesmo caminho que `pages/dashboard/Dashboard.jsx` já usa
 * para o cabeçalho do painel. Ela é 3508×2481 (paisagem), então NÃO cabe no
 * medalhão circular de 60×60 da versão antiga: aquele enquadramento era de um
 * selo quadrado, e forçar a Canastra ali a espremeria. Por isso a composição é
 * a logo inteira, centrada, com a proporção preservada.
 *
 * AS CORES VÊM DOS TOKENS DA CASA, e isto funciona aqui apesar de o painel ser
 * styled-components: `app/globals.css` declara os tokens em `@theme static`, que
 * força a emissão de todas as variáveis no `:root`, e aquele arquivo é carregado
 * pelo layout raiz — o mesmo que envolve /dashboard. Uma cópia de hex aqui seria
 * a quarta do projeto, e a que ninguém lembraria de atualizar.
 */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  width: 100vw;
  background-color: var(--color-cal-puro);
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
`;

const Marca = styled(motion.img)`
  width: 160px;
  height: auto;
  object-fit: contain;
`;

const LoadingMessage = styled(motion.p)`
  margin-top: 2rem;
  font-size: 1.125rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-fuligem-80);
`;

const DotWrapper = styled.div`
  display: flex;
  gap: 0.3rem;
  margin-top: 1.5rem;
`;

const Dot = styled(motion.span)`
  width: 0.5rem;
  height: 0.5rem;
  background-color: var(--color-fuligem-55);
  border-radius: 50%;
`;

export default function Loading() {
  return (
    // `role="status"` e `aria-live` não existiam aqui: para quem usa leitor de
    // tela, a espera era silêncio absoluto entre a navegação e o painel.
    <Container role="status" aria-live="polite">
      <Marca
        src="/logo-canastra.png"
        alt="Café Canastra"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      />

      <LoadingMessage
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      >
        Carregando o painel
      </LoadingMessage>

      <DotWrapper aria-hidden="true">
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
