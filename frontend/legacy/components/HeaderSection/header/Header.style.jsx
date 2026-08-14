import styled, { keyframes } from "styled-components";

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

  .nav-menu {
    display: flex;
    align-items: center;
    gap: 15px;
    position: relative;
    flex-shrink: 0;

    @media (max-width: 480px) {
      gap: 8px;
    }

    .icon {
      font-size: 1.4rem;
      cursor: pointer;
      color: #82858b;
      transition: color 0.2s;

      &:hover {
        color: #666;
      }

      @media (max-width: 480px) {
        font-size: 1.3rem;
      }
    }

    .dropDownAccount,
    .dropDownLogout {
      top: 3em;
      right: -10px;
      width: 200px;

      @media (max-width: 480px) {
        right: -5px;
        width: 160px;
      }

      &::before {
        right: 25px;
        @media (max-width: 480px) {
          right: 18px;
        }
      }
    }

    .dropDownAccount {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 180px;
      padding: 15px 10px;
      box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
      z-index: 100;
      transition: all 0.3s ease;
      background-color: #fff;
      border-radius: 8px;
      position: absolute;

      &::before {
        content: "";
        display: block;
        position: absolute;
        top: -8px;
        right: 20px;
        border-bottom: 8px solid #82858b;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;

        @media (max-width: 768px) {
          right: 45px;
        }
      }

      button {
        width: 100%;
        background-color: #fff;
        border: 1.5px solid #82858b;
        color: #82858b;
        padding: 7px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 600;
        transition:
          background-color 0.2s ease,
          color 0.2s ease,
          border-color 0.2s ease;

        &:hover {
          background-color: #82858b;
          color: white;
          border-color: #82858b;
        }
      }

      .signUp {
        border-top: 1px solid #e3e3e3;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;

        p {
          margin-top: 5px;
          font-size: 0.9rem;
        }

        span {
          font-size: 0.75rem;
          cursor: pointer;
          color: #555;
          font-weight: 600;
        }
      }
    }

    .dropDownLogout {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 180px;
      padding: 15px 10px;
      box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
      z-index: 100;
      transition: all 0.3s ease;
      background-color: #fff;
      border-radius: 8px;
      position: absolute;

      &::before {
        content: "";
        display: block;
        position: absolute;
        top: -8px;
        right: 20px;
        border-bottom: 8px solid #82858b;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;

        @media (max-width: 768px) {
          right: 45px;
        }
      }

      span {
        font-weight: 600;
        color: #555;
        font-size: 1rem;
        text-align: center;
        width: 100%;
        user-select: none;
      }

      #logoutBtn,
      #removeAccountBtn,
      #myOrdersBtn {
        width: 100%;
        background-color: #fff;
        border: 1.5px solid #82858b;
        color: #82858b;
        padding: 7px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 600;
        transition:
          background-color 0.2s ease,
          color 0.2s ease,
          border-color 0.2s ease;
      }

      #myOrdersBtn {
        background-color: #333;
        color: #ffffff;
        border-color: #333;
        transition:
          background-color 0.2s ease,
          color 0.2s ease,
          border-color 0.2s ease;
        &:hover {
          background-color: #555;
          border-color: #555;
        }
      }

      #logoutBtn:hover {
        background-color: #82858b;
        color: white;
        border-color: #82858b;
      }

      #removeAccountBtn {
        background-color: #82858b;
        color: #ffffff;
        border-color: #82858b;
        transition:
          background-color 0.2s ease,
          color 0.2s ease,
          border-color 0.2s ease;
        &:hover {
          background-color: #fff;
          border-color: #82858b;
          color: #82858b;
        }
      }
    }
  }

  @media (max-width: 1000px) {
    .logo-name {
      display: none;
    }
  }
`;

export const AdminButton = styled.button`
  margin-right: 15px;
  padding: 8px 12px;
  background-color: #82858b;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
  white-space: nowrap;

  &:hover {
    background-color: #666;
  }

  @media (max-width: 900px) {
    display: none;
  }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
`;

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
`;

export const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  animation: ${fadeIn} 0.2s ease-out;

  h3 {
    margin-bottom: 1rem;
    color: #333;
    font-size: 1.3rem;
  }

  p {
    color: #666;
    margin-bottom: 1.5rem;
    line-height: 1.5;
    font-size: 0.95rem;
  }
`;

export const ModalActions = styled.div`
  display: flex;
  gap: 10px;
  justify-content: center;

  button {
    padding: 10px 20px;
    border-radius: 8px;
    border: none;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
    transition:
      transform 0.1s,
      opacity 0.2s;

    &:active {
      transform: scale(0.96);
    }
  }
`;

export const CancelButton = styled.button`
  background-color: #e0e0e0;
  color: #333;

  &:hover {
    background-color: #d0d0d0;
  }
`;

export const ConfirmButton = styled.button`
  background-color: #d32f2f; /* Vermelho alerta */
  color: white;

  &:hover {
    background-color: #b71c1c;
  }
`;
