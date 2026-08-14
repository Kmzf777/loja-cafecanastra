import { styled, css } from "styled-components";

export const FilteredShirts = styled.section`
  width: 90%;
  max-width: 1000px;
  margin: 50px auto;
  display: flex;
  flex-direction: column;
  gap: 30px;
  padding: 10px;

  @media (max-width: 768px) {
    width: 100%;
  }

  .single {
    width: 45%;
  }
`;

export const NoProductDiv = styled.div`
  width: 100%;
  min-height: 50vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  text-align: center;
  color: #6c757d;

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 2rem;
  }

  h3 {
    font-size: 1.2rem;
    font-weight: 400;
  }

  svg {
    font-size: 60px;
    color: #adb5bd;
  }

  button {
    margin-top: 20px;
    padding: 10px 20px;
    background-color: #82858b;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    transition: background 0.3s;
  }
`;

export const ResultTitle = styled.h3`
  font-size: 1.6rem;
  font-weight: 400;
  color: #444;
  text-align: start;
  margin: 20px 0;
  letter-spacing: 1px;
  padding-bottom: 10px;
  border-bottom: 2px solid #e5e5e5;
  max-width: 95%;
  font-family: "Roboto", sans-serif;

  @media (max-width: 768px) {
    font-size: 1.3rem;
  }
`;

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
