import styled from "styled-components";
import { useContext } from "react";
import configContext from "../../contexts/configContext/createConfigContext";

const BarContainer = styled.div`
  background-color: #82858b;
  color: #fff;
  text-align: center;
  padding: 8px 0;
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.5px;
  width: 100%;
`;

function AnnouncementBar() {
  const { announcement_bar } = useContext(configContext);

  if (
    !announcement_bar ||
    announcement_bar === "null" ||
    String(announcement_bar).trim() === ""
  ) {
    return null;
  }

  return <BarContainer>{announcement_bar}</BarContainer>;
}

export default AnnouncementBar;
