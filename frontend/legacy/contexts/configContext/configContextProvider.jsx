import PropTypes from "prop-types";
import configContext from "./createConfigContext";
import { useEffect, useState } from "react";
import { API_BASE } from "../../api";

const ConfigProvider = ({ children }) => {
  const [storeConfig, setStoreConfig] = useState({
    site_title: "Carregando...",
    whatsapp_number: "",
    announcement_bar: "",
    banner_desktop: null,
  });

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setStoreConfig(data);
          // Item 4: Atualiza o nome na aba do navegador
          if (data.site_title) {
            document.title = data.site_title;
          }
        }
      })
      .catch((err) => console.error("Erro ao carregar configs da loja", err));
  }, []);

  return (
    <configContext.Provider value={storeConfig}>
      {children}
    </configContext.Provider>
  );
};

ConfigProvider.propTypes = {
  children: PropTypes.any,
};

export default ConfigProvider;
