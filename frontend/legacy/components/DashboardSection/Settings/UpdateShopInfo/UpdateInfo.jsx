import { useContext, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import fetchDataForm, { API_BASE } from "../../../../api";
import { FormStyled } from "../../GProducts/form/Form.style";
import { Container } from "./UpdateInfo.style";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

function UpdateInfo() {
  const { authFetch } = useContext(authContext);
  const { register, handleSubmit, setValue } = useForm();
  const [currentBanner, setCurrentBanner] = useState(null);
  const [newBannerFile, setNewBannerFile] = useState(null);
  const [currentBannerMobile, setCurrentBannerMobile] = useState(null);
  const [newBannerFileMobile, setNewBannerFileMobile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      setLoading(true);
      try {
        const res = await fetchDataForm("/config", "GET");
        const data = await res.json();

        setValue("site_title", data.site_title);
        setValue("whatsapp_number", data.whatsapp_number);
        setValue("announcement_bar", data.announcement_bar);

        if (data.banner_desktop) {
          const url = data.banner_desktop.startsWith("http")
            ? data.banner_desktop
            : `${API_BASE}${data.banner_desktop}`;
          setCurrentBanner(url);
        }

        if (data.banner_mobile) {
          const urlMobile = data.banner_mobile.startsWith("http")
            ? data.banner_mobile
            : `${API_BASE}${data.banner_mobile}`;
          setCurrentBannerMobile(urlMobile);
        }
      } catch (err) {
        console.error("Erro ao carregar configs", err);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, [setValue]);

  const onSubmit = async (data) => {
    const formData = new FormData();
    formData.append("site_title", data.site_title);
    formData.append("whatsapp_number", data.whatsapp_number);
    formData.append("announcement_bar", data.announcement_bar);

    if (newBannerFile) formData.append("banner_desktop", newBannerFile);
    if (newBannerFileMobile)
      formData.append("banner_mobile", newBannerFileMobile);

    try {
      const res = await authFetch(`${API_BASE}/config`, {
        method: "PUT",
        body: formData,
      });
      if (res.ok) {
        toast.success("Loja atualizada com sucesso!");
      } else {
        toast.error("Erro ao atualizar.");
      }
    } catch (error) {
      console.error(error);
    }
  };

  if (loading) return <Loading />;

  return (
    <Container>
      <h2 style={{ marginBottom: "20px" }}>Configurações da Loja</h2>

      <FormStyled
        onSubmit={handleSubmit(onSubmit)}
        style={{ width: "100%", maxWidth: "100%" }}
      >
        <label>Nome da Loja (Título)</label>
        <input {...register("site_title")} />

        <label>Número WhatsApp (apenas números)</label>
        <input
          {...register("whatsapp_number")}
          placeholder="Ex: 5511999999999"
        />

        <label>Barra de Anúncios (Topo do site)</label>
        <input
          {...register("announcement_bar")}
          placeholder="Ex: Frete Grátis para todo Brasil"
        />

        <label>Banner Desktop (Recomendado: 1920x600)</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files[0];
            setNewBannerFile(file);
            if (file) setCurrentBanner(URL.createObjectURL(file));
          }}
        />

        {/* Preview da Imagem */}
        {currentBanner && (
          <div style={{ marginTop: 10, marginBottom: 20 }}>
            <img
              src={currentBanner}
              alt="Banner Preview"
              style={{ width: "100%", maxWidth: "500px", borderRadius: 8 }}
            />
          </div>
        )}

        <label>Banner Mobile (Recomendado: 600x600 ou 800x1000)</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files[0];
            setNewBannerFileMobile(file);
            if (file) setCurrentBannerMobile(URL.createObjectURL(file));
          }}
        />
        {currentBannerMobile && (
          <div style={{ marginTop: 10, marginBottom: 20 }}>
            <img
              src={currentBannerMobile}
              alt="Mobile Preview"
              style={{ width: "150px", borderRadius: 8 }}
            />
          </div>
        )}

        <button type="submit">Salvar Alterações</button>
      </FormStyled>
    </Container>
  );
}

export default UpdateInfo;
