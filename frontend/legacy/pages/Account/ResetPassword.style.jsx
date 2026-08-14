import styled from "styled-components";
export {
  InputContainer,
  Button,
  DivInputError,
} from "../../components/LoginForm/LoginForm.style";

export const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: #fff;
  padding: 20px;
`;

export const FormBox = styled.form`
  width: 100%;
  max-width: 450px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  text-align: center;

  h2 {
    font-size: 1.8rem;
    font-weight: 600;
    color: #111;
    margin-bottom: 0.5rem;
  }
`;

export const PasswordRules = styled.ul`
  margin-top: 5px;
  margin-left: 5px;
  list-style: none;
  font-size: 0.8rem;
  background: #f9f9f9;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #e1e1e1;
  text-align: left;

  li {
    margin-bottom: 4px;
    color: #888;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    transition: color 0.2s;

    &::before {
      content: "•";
      font-size: 1.2rem;
      line-height: 0.5;
      color: #ccc;
    }

    &.valid {
      color: #2e7d32;
      font-weight: 500;
      &::before {
        content: "✓";
        color: #2e7d32;
      }
    }
  }
`;
