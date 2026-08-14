import styled from "styled-components";

export const Section = styled.section`
  background-color: #f4f6f8;
  min-height: 100vh;
  width: 100%;
  margin: 0;
  padding: 2rem 1rem;
`;

export const CartSectionProductsContainer = styled.section`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 90%;
  max-width: 1000px;
  margin: 0 auto 20px;
  padding: 2rem;
  background-color: #fff;
  border-radius: 1.3rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

  @media (max-width: 768px) {
    width: 100%;
    padding: 1rem;
  }

  .emptyCartText {
    font-size: 1.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #555;
    margin-bottom: 10px;
  }

  .emptyCartSpan {
    margin-top: 10px;
    color: #555;
    text-decoration: underline;
    cursor: pointer;
    font-weight: 500;
  }
`;

export const CartDivProductsContent = styled.div`
  margin: 10px 0;
  display: flex;
  gap: 1rem;
  align-items: center;
  width: 100%;
  padding: 1rem;
  background-color: #f1f1f1;
  border-radius: 1.3rem;

  img {
    height: 150px;
    max-width: 120px;
    object-fit: cover;
    width: 100%;
    border-radius: 12px;

    @media (max-width: 768px) {
      height: 100px;
    }
  }

  @media (max-width: 600px) {
    width: 95%;
    flex-direction: column;
    align-items: flex-start;
  }
`;

export const CartInfoProduct = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  flex-wrap: wrap;

  .someInfo {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 1em;

    span:nth-child(1) {
      font-weight: 700;
      font-size: 1.4rem;
      color: #000;

      @media (max-width: 768px) {
        font-size: 1.2rem;
      }
    }

    span:nth-child(2) {
      color: #777;
    }

    #price {
      font-size: 1rem;
      font-weight: 700;
      color: #222;

      span {
        font-size: 0.7rem;
        color: #777;
      }
    }
  }

  .buttonAndPrice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 0.3;
    flex-wrap: wrap;
    padding: 5px;
    gap: 1rem;

    .divChooseQuantity {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      background-color: #fff;
      padding: 10px 12px;
      border-radius: 1rem;
      width: 100px;
      margin: 0 auto;

      button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.8rem;
      }
    }

    span:nth-child(2) {
      margin: 0 auto;
      font-size: 1.2rem;
      font-weight: 600;
    }
  }

  .removeProduct {
    color: red;
    text-decoration: underline;
    font-size: 0.9rem;
    cursor: pointer;
  }

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

export const FinishOrderDiv = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 90%;
  max-width: 1000px;
  margin: 20px auto;
  padding: 2rem;
  background-color: #fff;
  border-radius: 1.3rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

  @media (max-width: 768px) {
    width: 100%;
    flex-direction: column;
    gap: 2rem;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 1rem;
    color: #555;
    padding: 5px 0;

    &.total {
      border-top: 1px solid #eee;
      padding-top: 15px;
      margin-top: 10px;
      font-size: 1.4rem;
      font-weight: 700;
      color: #000;
    }

    span:nth-child(2) {
      font-weight: 600;
    }
  }

  button {
    margin-top: 15px;
    width: 100%;
    max-width: 300px;
    align-self: flex-end;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
    background-color: #82858b;
    border: none;
    border-radius: 8px;
    padding: 15px 30px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background-color: #545454;
    }

    span {
      display: flex;
      align-items: center;
    }

    @media (max-width: 768px) {
      align-self: flex-end;
    }
  }
`;

export const ShippingContainer = styled.div`
  width: 90%;
  max-width: 1000px;
  margin: 20px auto;
  padding: 2rem;
  background-color: #fff;
  border-radius: 1.3rem;
  display: flex;
  flex-direction: column;
  gap: 15px;

  @media (max-width: 768px) {
    width: 100%;
    padding: 1rem;
  }

  h3 {
    font-size: 1.2rem;
    color: #333;
    margin-bottom: 5px;
  }

  .input-group {
    display: flex;
    gap: 10px;

    input {
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #ccc;
      flex: 1;
      max-width: 200px;
    }

    button {
      padding: 10px 20px;
      background-color: #333;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.2s;

      &:hover {
        background-color: #555;
      }

      &:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
    }
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
  }

  .shipping-option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    border: 1px solid #eee;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: #bbb;
    }

    &.selected {
      background-color: #e3f2fd;
      border-color: #2196f3;
    }

    .info {
      display: flex;
      gap: 10px;
      align-items: center;

      img {
        height: 25px;
        object-fit: contain;
      }

      span {
        font-size: 0.95rem;
        color: #444;
      }
    }

    .price {
      font-weight: bold;
      color: #333;
    }
  }
`;
