import styled from "styled-components";

export const Container = styled.div`
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0px 6px 16px rgba(0, 0, 0, 0.06);
`;

export const Title = styled.h1`
  font-size: 1.8rem;
  font-weight: 600;
  margin-bottom: 2rem;
  color: #1f2937;
  text-align: center;
`;

export const Section = styled.section`
  margin-bottom: 3rem;
`;

export const SectionHeader = styled.h2`
  font-size: 1.4rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

export const List = styled.ul`
  list-style: none;
  padding: 0;
  margin-bottom: 1rem;
  overflow-y: auto;
  max-height: 500px;
`;

export const ListItem = styled.li`
  background-color: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #111827;
`;

export const InputGroup = styled.div`
  display: flex;
  gap: 1rem;
  margin-top: 0.5rem;

  @media (max-width: 500px) {
    flex-direction: column;
  }
`;

export const Input = styled.input`
  flex: 1;
  padding: 0.6rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:focus {
    border-color: #82858b;
    outline: none;
    box-shadow: 0 0 0 3px #afb2b233;
  }
`;

export const Button = styled.button`
  background-color: ${(props) => (props.$danger ? "#ef4444" : "#82858b")};
  color: white;
  padding: 0.6rem 1.2rem;
  font-size: 0.95rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: ${(props) => (props.$danger ? "#dc2626" : "#6a6d6d")};
  }
`;
