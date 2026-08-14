import styled from "styled-components";

export const LoginFormSection = styled.section`
  display: flex;
  min-height: 100vh;
  width: 100%;
  background-color: #fff;
  align-items: center;
  justify-content: center;

  img {
    max-height: 500px;
    margin: 0 auto;
    flex: 0.3;

    @media (max-width: 1024px) {
      display: none;
    }
  }
`;

export const Form = styled.form`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  max-width: 600px;
  margin: 0 auto;
  background-color: #fff;

  img {
    width: 180px;
    margin-bottom: 2rem;
    object-fit: contain;
  }

  h2 {
    font-size: 1.8rem;
    font-weight: 700;
    color: #333;
    margin-bottom: 0.5rem;
  }

  p.subtitle {
    color: #666;
    margin-bottom: 2rem;
  }
`;

export const DivInputError = styled.div`
  width: 100%;
  max-width: 400px;
  margin-bottom: 1.2rem;
  display: flex;
  flex-direction: column;

  .error-message {
    color: #d32f2f;
    font-size: 0.85rem;
    margin-top: 5px;
    margin-left: 5px;
  }
`;

export const InputContainer = styled.div`
  display: flex;
  align-items: center;
  background-color: #f9f9f9;
  border: 1px solid
    ${({ isInvalid, isValid }) =>
      isInvalid ? "#d32f2f" : isValid ? "#2e7d32" : "#e0e0e0"};
  border-radius: 8px;
  padding: 0 15px;
  height: 55px;
  transition: all 0.2s ease;

  &:focus-within {
    border-color: #333;
    background-color: #fff;
    box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.05);
  }

  .icon {
    color: #999;
    font-size: 1.3rem;
    margin-right: 12px;
  }

  input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 1rem;
    color: #333;
    height: 100%;

    &::placeholder {
      color: #aaa;
    }
  }

  .toggle-password {
    cursor: pointer;
    color: #777;
    display: flex;
    align-items: center;
    padding: 5px;
    transition: color 0.2s;

    &:hover {
      color: #333;
    }
  }

  .check-icon {
    color: #2e7d32;
    margin-left: 10px;
  }
`;

export const Button = styled.button`
  width: 100%;
  max-width: 400px;
  height: 55px;
  background-color: #111;
  color: #fff;
  font-size: 1.1rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.1s, background-color 0.2s, box-shadow 0.2s;
  margin-top: 1rem;

  &:hover:not(:disabled) {
    background-color: #333;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
`;

export const FormFooter = styled.div`
  margin-top: 1.5rem;
  font-size: 0.95rem;
  color: #666;

  a {
    color: #111;
    font-weight: 600;
    text-decoration: none;
    margin-left: 5px;

    &:hover {
      text-decoration: underline;
    }
  }
`;
