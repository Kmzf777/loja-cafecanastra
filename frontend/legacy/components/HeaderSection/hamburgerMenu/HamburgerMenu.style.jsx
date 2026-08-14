import styled from "styled-components";

export const Container = styled.div`
  display: none;
  position: relative;
  z-index: 1;

  > svg {
    z-index: 100;
    color: #000;
    height: 30px;
    height: 30px;
    font-size: 1.7rem;
    cursor: pointer;
  }

  @media (max-width: 900px) {
    display: flex;
  }
`;
