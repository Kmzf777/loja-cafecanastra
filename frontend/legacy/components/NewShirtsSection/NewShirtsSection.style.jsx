import styled from "styled-components";

export const NewShirtsSec = styled.section`
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
`;

export const Title = styled.h2`
  text-transform: uppercase;
  position: relative;
  color: #82858b;
  display: block;

  &::after {
    content: "";
    position: absolute;
    bottom: -6px;
    left: 0;
    height: 3px;
    width: 195px;
    background: linear-gradient(to right, #82858b 0%, transparent 100%);
  }
`;

export const ProductContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  width: 100%;
  justify-content: center;

  @media (max-width: 768px) {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 15px;
  }
`;

export const ProductContent = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
  border-radius: 8px;
  cursor: pointer;
  position: relative;

  img {
    border-radius: 8px;
    aspect-ratio: 4 / 6;
    height: auto;
    object-fit: cover !important;
    object-position: center !important;
    max-height: 600px;
  }

  .icon-shoppingCart {
    font-size: 27px;
    color: #000000;
    background-color: inherit;
    border: none;
    z-index: 5;
    cursor: default;
  }
`;

export const ShirtInfo = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  flex: 1;

  & > span:nth-child(1) {
    color: #4a4a4a;
    font-size: 0.75rem;
  }

  & > span:nth-child(2) {
    margin-top: 3px;
    font-size: 1rem;
    color: #111;
    font-weight: 700;
    //min-height: 48px;
    overflow: hidden;
    text-overflow: ellipsis;

    @media (max-width: 768px) {
      font-size: 0.9rem;
    }
  }
`;

export const PriceWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: auto;
  width: 100%;

  .old-price {
    text-decoration: line-through;
    color: #999;
    font-size: 0.85rem;
    font-weight: 400;
  }

  .discount-price {
    color: #2e7d32;
    font-weight: 700;
    font-size: 1.2rem;
  }

  .regular-price {
    font-weight: 700;
    font-size: 1.2rem;
    color: #7b7b7b;
  }
`;
