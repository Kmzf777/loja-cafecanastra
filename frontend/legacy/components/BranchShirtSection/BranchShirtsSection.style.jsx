import { styled, css } from "styled-components";
import { NewShirtsSec } from "../NewShirtsSection/NewShirtsSection.style";

export const BranchShirtsSec = styled(NewShirtsSec)``;

export const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: 3rem; /* Um pouco mais de espaço no site público */
  padding-bottom: 1rem;
  flex-wrap: wrap;
`;

export const PaginationButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px; /* Botões um pouco maiores para toque no mobile */
  height: 40px;
  padding: 0 6px;
  border: 1px solid #eee;
  background-color: #fff;
  border-radius: 50%; /* Vamos fazer REDONDO para ficar diferente do Admin? */
  color: #555;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);

  &:hover:not(:disabled) {
    border-color: #82858b;
    color: #000000; /* Um rosa mais escuro para texto */
    transform: translateY(-2px);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background-color: #f9f9f9;
    box-shadow: none;
  }

  /* Estilo Especial para a página ATUAL */
  ${({ isActive }) =>
    isActive &&
    css`
      background-color: #82858b;
      border-color: #82858b;
      color: #fff;

      &:hover:not(:disabled) {
        background-color: #82858b; /* Rosa levemente mais escuro */
        color: #fff;
      }
    `}
`;

export const Dots = styled.span`
  color: #ccc;
  font-size: 14px;
  margin: 0 4px;
  letter-spacing: 2px;
`;
