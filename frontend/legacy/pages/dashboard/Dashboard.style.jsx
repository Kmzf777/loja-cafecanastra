import styled from "styled-components";

export const DashboardContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

export const SectionDashboard = styled.section`
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;

  @media (max-width: 980px) {
    flex-direction: column;
  }
`;

export const HeaderComponent = styled.header`
  width: 100%;
  height: 80px;
  margin: 0 auto;
  border-bottom: 1px solid #e3e3e3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  user-select: none;
  background-color: #fff;
  z-index: 1100;
  position: sticky;
  top: 0;

  @media (max-width: 768px) {
    padding: 10px 15px;
    gap: 8px;
  }

  .logoContent {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    flex-shrink: 0;

    img {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      object-fit: cover;

      @media (max-width: 480px) {
        width: 45px;
        height: 45px;
      }
    }
  }

  .backShop {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #666;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
    transition: all 0.2s ease;
    text-decoration: none;
    margin-left: auto;

    &:hover {
      color: #000;
      transform: translateX(-3px);
    }

    @media (max-width: 480px) {
      font-size: 0.85rem;
      gap: 5px;

      span {
        display: none;
      }
    }
  }
`;

export const ContainerHamburger = styled.div`
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 101;

  svg {
    font-size: 1.8rem;
    color: #333;
  }

  @media (max-width: 980px) {
    display: flex;
    padding-left: 15px;
  }
`;

export const ContentWrapper = styled.section`
  flex: 1;
  padding: 20px;
  background-color: #f9f9f9;
  overflow-y: auto;
  height: 100%;

  @media (max-width: 980px) {
    width: 100%;
    padding: 15px;
  }
`;
