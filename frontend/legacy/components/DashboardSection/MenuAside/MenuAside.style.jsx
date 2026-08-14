import styled from "styled-components";

export const Aside = styled.aside`
  width: 40%;
  max-width: 300px;
  height: 100vh;
  height: 100dvh;
  padding: 10px;
  display: flex;
  justify-content: center;
  box-shadow: rgba(0, 0, 0, 0.15) 1.95px 1.95px 2.6px;
  background-color: #fff;
  position: sticky;
  top: 100px;
  z-index: 1000;

  @media (max-width: 980px) {
    width: 80%;
    position: fixed;
    z-index: 1100;
    top: 0;
    left: 0;
    transform: ${({ isOpen }) =>
      isOpen ? "translateX(0)" : "translateX(-100%)"};
    transition: transform 0.3s ease-in-out;
    opacity: 1;
    box-shadow: 2px 0 5px rgba(0, 0, 0, 0.2);
  }
`;

export const ContainerSection = styled.section`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

export const DivMenu = styled.div`
  border-bottom: 0.5px solid #cecece;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;

  .link {
    display: flex;
    align-items: center;
    gap: 5px;
    text-decoration: none;
    list-style: none;
    color: #505050;
    font-size: 0.9rem;

    li {
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow: hidden;
      line-height: 25px;
    }
  }

  span {
    line-height: 35px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    font-size: 1rem;
    font-weight: 550;
    color: #484848;
    margin-bottom: 3px;
  }
`;
