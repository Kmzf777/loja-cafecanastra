import styled from "styled-components";

export const SectionInfo = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: ${({ isCompleted }) => (isCompleted ? "500px" : "1000px")};
  gap: 20px;
  transition: all 0.3s ease;

  @media (min-width: 1024px) {
    flex-direction: ${({ isCompleted }) => (isCompleted ? "column" : "row")};
  }
`;

export const CheckoutContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  background-color: #f9f9f9;
  min-height: 100vh;
  gap: 30px;

  @media (min-width: 1024px) {
    flex-direction: row;
    align-items: flex-start;
    justify-content: center;
  }
`;

export const SummarySection = styled.div`
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  width: 100%;
  flex: 1;
  height: 430px;
  overflow-y: auto;

  h2 {
    margin-bottom: 20px;
    border-bottom: 1px solid #eee;
    padding-bottom: 10px;
  }

  .item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 0.9rem;

    span:first-child {
      color: #555;
    }
    span:last-child {
      font-weight: 600;
    }
  }

  .total {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    font-size: 1.2rem;
    font-weight: bold;
  }
`;

export const PaymentSection = styled.div`
  width: 100%;
  max-width: 500px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  animation: fadeIn 0.5s ease;

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
