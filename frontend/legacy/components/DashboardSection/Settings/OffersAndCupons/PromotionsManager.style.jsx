import styled from "styled-components";

export const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;

  @media (min-width: 768px) {
    grid-template-columns: 1fr 2fr;
  }
`;

export const Title = styled.h2`
  font-size: 1.75rem;
  color: #333;
  margin-bottom: 1rem;
`;

export const Card = styled.section`
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
`;

export const Form = styled.form`
  display: grid;
  gap: 1rem;
`;

export const Label = styled.label`
  font-size: 0.9rem;
  color: #444;
`;

export const Input = styled.input`
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
`;

export const TextArea = styled.textarea`
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
`;

export const Select = styled.select`
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
`;

export const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
`;

export const ButtonPrimary = styled.button`
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
`;

export const ButtonSecondary = styled.button`
  background: #e5e7eb;
  color: #333;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  &:hover {
    background: #d1d5db;
  }
  &:disabled {
    cursor: not-allowed;

    &:hover {
      background: #e5e7eb;
    }
  }
`;

export const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

export const ListItem = styled.li`
  background: ${({ active }) => (active ? "#fff" : "#fafafa")};
  padding: 1rem;
  border-left: 4px solid ${({ active }) => (active ? "#2ec6c6" : "#ccc")};
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
