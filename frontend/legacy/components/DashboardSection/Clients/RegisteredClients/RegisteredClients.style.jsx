import styled, { css } from "styled-components";

export const RegisteredClientsContainer = styled.div`
  width: 100%;
  box-sizing: border-box;
  padding: 2rem;

  @media (max-width: 768px) {
    padding: 1rem;
  }

  h2 {
    margin-bottom: 2rem;
    font-size: 1.5rem;
    color: #333;
  }
`;

export const TableWrapper = styled.div`
  overflow-x: auto;
  overflow-y: auto;
  max-height: 580px;

  @media (max-width: 768px) {
    display: none;
  }
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  box-shadow: 0 2px 8px rgba(20, 20, 20, 0.06);
  background-color: #fff;
  border-radius: 8px;
  overflow: hidden;
  display: table;
`;

export const Thead = styled.thead`
  background-color: #f8f9fa;
`;

export const Tbody = styled.tbody``;

export const Tr = styled.tr`
  border-bottom: 1px solid #eee;

  &:last-child {
    border-bottom: none;
  }
`;

export const Th = styled.th`
  padding: 12px 16px;
  text-align: left;
  font-weight: 700;
  color: #444;
  text-transform: uppercase;
  font-size: 0.8rem;
`;

export const Td = styled.td`
  padding: 12px 16px;
  text-align: left;
  vertical-align: middle;
  color: #333;
  font-size: 0.95rem;

  &[colspan="4"] {
    text-align: center;
    padding: 20px;
    font-size: 1rem;
    color: #6c757d;
  }
`;

/* Card list (mobile) */
export const CardList = styled.div`
  display: none;
  gap: 12px;

  @media (max-width: 768px) {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
`;

export const Card = styled.article`
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(20, 20, 20, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid #eee;
`;

export const CardRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  strong {
    font-size: 0.9rem;
    color: #555;
    text-transform: uppercase;
  }

  span,
  div {
    font-size: 1rem;
    color: #111;
    font-weight: 500;
  }
`;

export const Meta = styled.div`
  font-size: 0.9rem;
  color: #666;
  margin-top: -8px;
`;

export const EmptyState = styled.div`
  padding: 16px 8px;
  color: #666;
  text-align: center;
`;

export const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: 2rem;
  padding-bottom: 1rem;
  flex-wrap: wrap;
`;

export const PaginationButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
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
