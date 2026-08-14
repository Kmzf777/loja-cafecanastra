import { OverlayScreen } from "./Overlay.style";
import PropTypes from "prop-types";

function Overlay({ isCartOpen, setIsCartOpen, menuOpen, setMenuOpen }) {
  const closeMenus = () => {
    if (isCartOpen) setIsCartOpen(false);
    if (menuOpen) setMenuOpen(false);
  };

  return <OverlayScreen onClick={closeMenus} />;
}

export default Overlay;

Overlay.propTypes = {
  isCartOpen: PropTypes.bool,
  setIsCartOpen: PropTypes.func,
  menuOpen: PropTypes.bool,
  setMenuOpen: PropTypes.func,
};
