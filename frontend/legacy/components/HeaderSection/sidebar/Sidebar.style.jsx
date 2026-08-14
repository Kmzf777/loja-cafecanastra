import styled from "styled-components";

export const ContainerSidebar = styled.div`
  background-color: #fff;
  position: fixed;
  top: 0;
  left: 0;
  width: 70%;
  height: 100vh;
  height: 100dvh;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  transform: ${({ isOpen }) =>
    isOpen ? "translateX(0)" : "translateX(-100%)"};
  transition: all 0.4s ease-in-out;
  opacity: ${({ isOpen }) => (isOpen ? "1" : "0")};

  > svg {
    position: absolute;
    top: 32px;
    left: 32px;
    color: #000;
    width: 30px;
    height: 30px;
    cursor: pointer;
  }
`;

export const Content = styled.div`
  flex: 1;
  margin-top: 80px;
  padding: 0 30px;
  overflow-y: auto;
`;

export const SelectDown = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 15px;
  padding: 10px;
`;

export const SubTitle = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 7px;
  cursor: pointer;
  border: none;
  background: none;

  span {
    font-size: 1.1rem;
  }
`;

export const SelectDownOptions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

export const Option = styled.p`
  color: #7b7b7b;
  cursor: pointer;
  padding: 5px 7px;
`;

export const AccountButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  gap: 7px;
  padding: 8px 0;
  width: 80%;
  max-width: 300px;
  border: 1px solid #82858b;
  color: #82858b;
  font-weight: 600;
  background-color: #fff;
  cursor: pointer;
  transition: all 0.3s ease-in-out;

  &:hover {
    color: #fff;
    background-color: #82858b;
  }
`;

export const FooterMenuAside = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid #eee;

  div#clear-filters {
    width: 80%;
    max-width: 300px;
    text-align: center;
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 20px;
    border: 1px solid #dcdcdc;
    background-color: #f3f3f3;
    transition: all 0.3s ease;

    p {
      margin: 0;
      color: #a9a9a9;
      font-weight: 500;
    }

    &:hover {
      background-color: #82858b;
      border-color: #82858b;

      p {
        color: #fff;
      }
    }
  }
`;
