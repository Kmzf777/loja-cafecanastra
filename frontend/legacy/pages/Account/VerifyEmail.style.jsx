import styled, { keyframes } from "styled-components";
import { Button } from "../../components/LoginForm/LoginForm.style";

export const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: #fff;
  padding: 20px;
`;

export const Card = styled.div`
  width: 100%;
  max-width: 450px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem;
  text-align: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  border-radius: 8px;

  h2 {
    font-size: 1.8rem;
    font-weight: 700;
    color: #333;
    margin-bottom: 0.5rem;
  }

  p {
    color: #666;
    font-size: 1rem;
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  .icon-container {
    font-size: 4rem;
    margin-bottom: 10px;

    &.success {
      color: #2e7d32;
    }
    &.error {
      color: #d32f2f;
    }
    &.loading {
      color: #111;
    }
  }
`;

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

export const Spinner = styled.div`
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #111;
  border-radius: 50%;
  width: 50px;
  height: 50px;
  animation: ${spin} 1s linear infinite;
  margin-bottom: 20px;
`;

export const ActionButton = styled(Button)`
  margin-top: 10px;
`;
