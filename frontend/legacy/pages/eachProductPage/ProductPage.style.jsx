import styled from "styled-components";

export const ProductPageInfoProduct = styled.section`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2.5rem 1.5rem;
  gap: 40px;

  @media (min-width: 768px) {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
  }
`;

export const InfoProductImage = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  max-width: 500px;

  img {
    width: 100%;
    max-width: 480px;
    border-radius: 12px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }
`;

export const InfoProductText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 520px;
  padding: 1.5rem;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);

  .inputIncrementoOrDecremento {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 50px;

    .btn {
      width: 45px;
      height: 45px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #82858b;
      border: none;
      cursor: pointer;
      font-size: 1.6rem;
      color: white;
      border-radius: 50%;
      transition: all 0.3s ease;
    }

    .btn:hover {
      background: #5d5f64;
    }

    .btn:active {
      transform: scale(0.85);
    }

    .number {
      font-size: 1.6rem;
      font-weight: bold;
      width: 60px;
      text-align: center;
      color: #333;
    }
  }

  .priceAndButton {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    margin-top: 25px;

    @media (min-width: 768px) {
      flex-direction: row;
      justify-content: space-between;
    }

    @media (max-width: 768px) {
      align-items: flex-start;
    }

    span {
      font-size: 1.8rem;
      font-weight: 700;
      color: #222;

      span {
        font-size: 1.2rem;
        color: #777;
      }
    }

    button {
      padding: 14px 18px;
      width: 100%;
      max-width: 240px;
      font-size: 1.3rem;
      font-weight: 700;
      border: none;
      background-color: #82858b;
      color: #fff;
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      transition: all 0.3s;

      @media (max-width: 768px) {
        align-self: center;
      }
    }

    button:hover {
      background-color: #5d5f64;
    }
  }

  .sizeAndInfo {
    display: flex;
    flex-direction: column;
    gap: 10px;

    #size {
      font-size: 1.2rem;
      color: #444;
      margin-top: 20px;
    }

    a {
      color: #444;
      font-size: 1rem;
      text-decoration: underline;
      transition: color 0.3s;
    }

    a:hover {
      color: #82858b;
    }
  }

  #name {
    font-size: 1.7rem;
    font-weight: bold;
    color: #222;
  }
`;

export const NewTag = styled.button`
  background-color: #2ec6c6;
  padding: 10px 16px;
  border-radius: 14px;
  max-width: 150px;
  text-align: center;
  border: none;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  cursor: default;
  text-transform: uppercase;
`;

export const OldTag = styled(NewTag)`
  background-color: #8b5a2b;
`;

export const ShippingSimulator = styled.div`
  margin-top: 20px;
  width: 100%;
  padding-top: 20px;
  border-top: 1px solid #eee;

  .title {
    font-size: 1rem;
    font-weight: 600;
    color: #333;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .input-row {
    display: flex;
    gap: 10px;

    input {
      flex: 1;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
    }

    button {
      padding: 0 20px;
      background-color: #333;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;

      &:hover {
        background-color: #555;
      }
    }
  }

  .results {
    margin-top: 15px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .option {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
      color: #555;
      padding: 8px;
      background: #f9f9f9;
      border-radius: 6px;

      strong {
        color: #2e7d32;
      }
    }
  }
`;
