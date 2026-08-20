import { styled, css } from "styled-components";

export const Container = styled.div`
  padding: 1.5rem;

  h2 {
    margin-bottom: 1rem;
    font-size: 1.4rem;
    color: #222;
  }
`;

export const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
`;

export const TableWrapper = styled.div`
  overflow-x: auto;
  overflow-y: auto;
  max-height: calc(100vh - 200px);
`;

/* Tabela para desktop */
export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
  display: table;

  thead th {
    background: #fafafa;
    padding: 12px 10px;
    text-align: center;
    font-weight: 700;
    font-size: 0.9rem;
    border-bottom: 1px solid #eee;
  }

  tbody td {
    padding: 12px 10px;
    text-align: center;
    border-bottom: 1px solid #f0f0f0;
  }

  tr:last-child td {
    border-bottom: none;
  }

  @media (max-width: 768px) {
    display: none; /* esconde tabela no mobile (mostra cards) */
  }
`;

export const Thumb = styled.img`
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #ddd;
`;

/* Card list para mobile */
export const CardList = styled.div`
  display: none;
  gap: 12px;

  @media (max-width: 768px) {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
`;

export const Card = styled.article`
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const CardRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
`;

export const CardActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;

  button {
    padding: 8px 10px;
    border-radius: 6px;
    border: none;
    background: #2ec6c6;
    color: #fff;
    cursor: pointer;
  }

  button[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

export const EmptyState = styled.div`
  padding: 2rem;
  color: #666;
  text-align: center;
  border: 1px dashed #ddd;
  border-radius: 6px;
`;

export const ImageZoom = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.9);
  width: 100%;
  height: 100%;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;

  img {
    max-width: 96%;
    max-height: 96%;
    object-fit: contain;
    border-radius: 6px;
  }
`;

export const ActionsWrapper = styled.div`
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;

  svg {
    width: 20px;
    height: 20px;
  }
`;

export const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px; /* Espaço entre os botões */
  margin-top: 2rem;
  padding-bottom: 2rem;
  flex-wrap: wrap;
`;

export const PaginationButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px; /* Tamanho mínimo do quadrado */
  height: 36px;
  padding: 0 6px;
  border: 1px solid #ddd;
  background-color: #fff;
  border-radius: 4px;
  color: #555;
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    border-color: #82858b;
    color: #82858b;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: #f9f9f9;
  }

  /* Estilo Especial para a página ATUAL */
  ${({ isActive }) =>
    isActive &&
    css`
      background-color: #82858b;
      border-color: #82858b;
      color: #fff;
      font-weight: bold;

      &:hover:not(:disabled) {
        background-color: #6e7278;
        color: #fff;
      }
    `}
`;

export const Dots = styled.span`
  color: #999;
  font-size: 14px;
  margin: 0 2px;
  letter-spacing: 2px;
`;
