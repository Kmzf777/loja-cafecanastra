import { Container } from "./HamburgerMenu.style";
import { RxHamburgerMenu } from "react-icons/rx";
import { useState } from "react";
import Sidebar from "../sidebar/Sidebar";
import Overlay from "../../Overlay/Overlay";

function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  return (
    <Container>
      {menuOpen && <Overlay menuOpen={menuOpen} setMenuOpen={setMenuOpen} />}
      <RxHamburgerMenu onClick={toggleMenu} />
      <Sidebar isOpen={menuOpen} active={setMenuOpen} />
    </Container>
  );
}

export default HamburgerMenu;
