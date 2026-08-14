import styled from "styled-components";

export const MenuSection = styled.section`
  display: flex;
  align-items: end;
  justify-content: center;
  width: 100%;
  height: 50px;
  white-space: nowrap;
  position: relative;

  &::after {
    content: "";
    display: block;
    width: 80%;
    height: 1px;
    background-color: #efefef76;
    position: absolute;
    bottom: -20px;
  }

  @media (max-width: 900px) {
    display: none;
  }
`;

export const Categories = styled.div`
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: center;
  position: relative;
`;

export const BackgroundOption = styled.div`
  background-color: #82858b;
  padding: 3px 12px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  user-select: none;
  transition: all 0.3s ease;
  border: 1px solid transparent;

  &:hover {
    border: 1px solid #82858b;
  }

  #clear-filters {
    color: #a9a9a9;
    cursor: pointer;
    transition: color 0.3s ease;

    &:hover {
      color: #82858b;
    }
  }
`;

export const FilterDropdown = styled.div`
  position: absolute;
  top: 2.5em;
  left: 0;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: center;
  background-color: white;
  color: #82858b;
  font-weight: 600;
  border-radius: 12px;
  box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.2s ease;
  transform: translateY(-5px);
  pointer-events: none;

  &.open {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  input {
    accent-color: #fff;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
`;

export const FilterDropdownDivInputs = styled.div`
  display: flex;
  flex-direction: row-reverse;
  gap: 5px;
`;
