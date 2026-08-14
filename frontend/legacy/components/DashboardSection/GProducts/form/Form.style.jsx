import styled from "styled-components";

export const ContainerForm = styled.section`
  display: flex;
  justify-content: center;
`;

export const FormStyled = styled.form`
  width: 100%;
  max-width: 600px;
  background: #ffffff;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

  .inputIncrementoOrDecremento {
    display: flex;
    height: 30px;

    .btn {
      width: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 1px solid #000;
      cursor: pointer;
      font-size: 1.5rem;
    }

    .number {
      font-size: 1rem;
      width: 40px;
      display: flex;
      justify-content: center;
      align-items: center;
      border: 1px solid #000;
    }
  }

  label {
    font-size: 0.9rem;
    color: #444;
    font-weight: 500;
  }

  input,
  select,
  textarea {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    color: #333;
    border: 1px solid #ccc;
    border-radius: 5px;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;

    &:focus {
      border-color: #82858b;
      outline: none;
      box-shadow: 0 0 0 3px #afb2b233;
    }
  }

  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  button[type="submit"] {
    align-self: flex-end;
    padding: 0.75rem 1.5rem;
    background: #82858b;
    color: #fff;
    font-weight: 600;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: #6a6d6d;
    }
  }
`;

export const DimensionsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }

  div {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
`;

export const PreviewImage = styled.img`
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 2px solid #ddd;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.05);
  }
`;

export const ImageZoom = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;

  img {
    max-width: 90%;
    max-height: 90%;
    border-radius: 8px;
    object-fit: contain;
  }
`;
