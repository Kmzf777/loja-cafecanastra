import styled from "styled-components";

export const Container = styled.div`
  padding: 2rem;

  h2 {
    margin-bottom: 2rem;
    font-size: 1.5rem;
    color: #333;
  }
`;

export const Overview = styled.div`
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

export const Card = styled.div`
  background-color: #fff;
  padding: 1.5rem;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  flex: 1;
  min-width: 200px;
`;

export const GraphContainer = styled.div`
  margin-top: 3rem;
  background: #fff;
  padding: 1.5rem;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
`;

export const CardGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

export const CardGridItem = styled.div`
  background: white;
  padding: 1rem;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;
