import styled from "styled-components";

export {
  InputContainer,
  Button,
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
  padding: 2rem;
  text-align: center;

  h2 {
    font-size: 1.8rem;
    font-weight: 600;
    color: #111;
    margin-bottom: 0.5rem;
  }

  p {
    color: #666;
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1rem;
  }
`;

export const BackLink = styled.div`
  margin-top: 1rem;
  font-size: 0.9rem;

  a {
    color: #666;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;

    &:hover {
      color: #000;
      text-decoration: underline;
    }
  }
`;
