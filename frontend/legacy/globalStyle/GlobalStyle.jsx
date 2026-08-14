import { createGlobalStyle } from "styled-components";

export const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: sans-serif;
  }

  .input-error {
      border: 1px solid red;
    }

  .error-message {
    color: red;
    margin-top: 6px;
    font-weight: 500;
    font-size: 0.75rem;
    font-family: sans-serif;

    input, select {
      border: 1px solid red;
    }
  }

  input:-webkit-autofill,
  input:-webkit-autofill:hover, 
  input:-webkit-autofill:focus, 
  input:-webkit-autofill:active{
      -webkit-box-shadow: 0 0 0 30px white inset !important;
      -webkit-text-fill-color: #333 !important;
      transition: background-color 5000s ease-in-out 0s;
  }

  input:autofill,
  input:autofill:hover, 
  input:autofill:focus, 
  input:autofill:active {
      box-shadow: 0 0 0 30px white inset !important;
      color: #333 !important;
      background-color: white !important;
      transition: background-color 5000s ease-in-out 0s;
  }
`;
