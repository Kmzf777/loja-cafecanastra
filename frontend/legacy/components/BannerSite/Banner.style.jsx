import styled from "styled-components";

export const BannerContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  max-width: 1400px;
  padding: 0 10px;
  margin: 30px auto;
  border-radius: 10px;
  overflow: hidden;

  picture {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  img {
    width: 100%;
    height: auto;
    max-height: 500px;
    border-radius: inherit;
    display: block;
  }

  @media (max-width: 768px) {
    margin: 15px auto;
    padding: 0 8px;
    border-radius: 8px;

    img {
      max-height: 400px;
      object-position: center;
    }
  }

  @media (max-width: 480px) {
    padding: 0 5px;
    border-radius: 6px;
  }
`;
