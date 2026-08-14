import styled from "styled-components";
import { LoginFormSection } from "../LoginForm/LoginForm.style";

export {
  DivInputError,
  InputContainer,
  Button,
  FormFooter,
  Form,
} from "../LoginForm/LoginForm.style";

export const SignUpFormSection = styled(LoginFormSection)``;

export const PasswordRules = styled.ul`
  margin-top: 8px;
  margin-left: 5px;
  list-style: none;
  font-size: 0.8rem;
  background: #fff;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #e1e1e1;

  li {
    margin-bottom: 4px;
    color: #888;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;

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

export const CheckboxContainer = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 15px;
  font-size: 0.9rem;
  color: #555;

  input {
    margin-top: 3px;
    cursor: pointer;
    accent-color: #000;
    width: 16px;
    height: 16px;
  }

  label {
    cursor: pointer;
    line-height: 1.4;
  }

  a {
    color: #000;
    text-decoration: underline;
    font-weight: 500;
    &:hover {
      color: #555;
    }
  }
`;
