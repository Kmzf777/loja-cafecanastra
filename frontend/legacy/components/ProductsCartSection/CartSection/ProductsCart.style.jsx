import styled from "styled-components";

export const CartDiv = styled.div`
  background-color: #fff;
  position: fixed;
  height: 100vh;
  height: 100dvh;
  right: 0px;
  top: 0px;
  width: 100%;
  max-width: 400px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  transform: ${({ isCartOpen }) =>
    isCartOpen ? "translateX(0)" : "translateX(100%)"};
  opacity: ${({ isCartOpen }) => (isCartOpen ? "1" : "0")};
  transition: all 0.4s ease-in-out;

  @media (min-width: 768px) {
    width: 400px;
  }
`;

export const CartHeader = styled.section`
  margin: 0 auto;
  width: 100%;
  padding: 0 20px;
  height: 60px;
  min-height: 60px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e3e3e3;
  color: #000;

  > svg {
    color: #000;
    width: 30px;
    height: 30px;
    font-size: 1.7rem;
    cursor: pointer;
  }
`;

export const CartHeaderTitle = styled.h2`
  text-transform: uppercase;
  font-size: 1.2rem;
  font-weight: 600;
`;

export const CartProductsSection = styled.section`
  width: 100%;
  flex: 1;
  padding: 10px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const CartProductCard = styled.div`
  width: 100%;
  display: flex;
  gap: 10px;
  cursor: pointer;
  border-bottom: 1px solid #e3e3e3;
  padding: 10px 0;

  img {
    height: 80px;
    width: 70px;
    object-fit: cover;
    border-radius: 8px;
    flex-shrink: 0;
  }
`;

export const ShirtInfoCart = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
  font-size: 0.9rem;
  overflow: hidden;

  span:nth-child(1) {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

export const CartFooter = styled.section`
  width: 100%;
  padding: 20px;
  border-top: 1px solid #e3e3e3;
  background-color: #fff;
  margin-top: auto;

  p {
    font-size: 1.1rem;
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    margin-bottom: 15px;
  }

  button {
    padding: 12px;
    width: 100%;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    background-color: #82858b;
    color: #fff;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background-color: #666;
    }

    &:disabled {
      background-color: #ccc;
      cursor: not-allowed;
    }
  }
`;

export const DivEmptyCart = styled.div`
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 20px;
  text-align: center;

  .emptyCartIcon {
    font-size: 3rem;
    color: #ddd;
  }

  .emptyCartText {
    font-size: 1.2rem;
    font-weight: 600;
    color: #333;
  }

  .emptyCartSpan {
    font-size: 0.9rem;
    color: #888;
    line-height: 1.4;
  }
`;
