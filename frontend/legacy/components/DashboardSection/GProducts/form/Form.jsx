import { useCallback, useContext, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ContainerForm,
  FormStyled,
  PreviewImage,
  ImageZoom,
} from "./Form.style";
import fetchDataForm, { API_BASE } from "../../../../api";
import productContext from "../../../../contexts/productContext/createProductContext";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

function Form() {
  const { authFetch } = useContext(authContext);
  const navigate = useNavigate();
  const { register, handleSubmit, reset, watch } = useForm();
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [selectImage, setSelectImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [sizes, setSizes] = useState([]);

  const [originalProduct, setOriginalProduct] = useState(null);
  const watchedFields = watch([
    "name",
    "size",
    "category",
    "price",
    "description",
    "weight",
    "width",
    "height",
    "length",
    "sku",
  ]);

  const {
    updateProductList,
    value,
    setValue,
    productId,
    setProductId,
    dataForm,
  } = useContext(productContext);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Carregar Opções (Categorias e Tamanhos)
      const [catRes, sizeRes] = await Promise.all([
        fetchDataForm("/options?type=category", "GET"),
        fetchDataForm("/options?type=size", "GET"),
      ]);

      if (catRes.ok) setCategories(await catRes.json());
      if (sizeRes.ok) setSizes(await sizeRes.json());

      // 2. Se tiver ID, carregar dados do produto para edição
      if (productId) {
        const response = await fetchDataForm(`/dashboard/${productId}`, "GET");
        if (!response.ok) throw new Error("Falha ao carregar produto");

        const found = await response.json();

        // Popula o formulário
        reset({
          name: found.name,
          size: found.size,
          category: found.category,
          price: found.price,
          description: found.description,
          weight: found.weight,
          width: found.width,
          height: found.height,
          length: found.length,
          sku: found.sku || "",
        });

        // Configura estados auxiliares
        setValue(Number(found.quantity) || 0);

        if (found.image) {
          const imgUrl = found.image.startsWith("http")
            ? found.image
            : `${API_BASE}${found.image}`;
          setImagePreview(imgUrl);
        }

        // Salva estado original para comparação de edição
        setOriginalProduct({
          name: found.name,
          size: found.size,
          category: found.category,
          price: found.price,
          quantity: Number(found.quantity),
          description: found.description || "",
          weight: found.weight,
          width: found.width,
          height: found.height,
          length: found.length,
          sku: found.sku || "",
        });
      } else {
        // Se for NOVO produto, limpa tudo
        reset({
          name: "",
          size: "",
          category: "",
          price: "",
          description: "",
          weight: "",
          width: "",
          height: "",
          length: "",
          sku: "",
        });
        setValue(0);
        setImagePreview(null);
        setOriginalProduct(null);
      }
    } catch (err) {
      console.error("Erro ao carregar dados do formulário:", err);
      toast.error("Erro ao carregar dados. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [productId, reset, setValue]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const isEdited =
    originalProduct &&
    (watchedFields[0] !== originalProduct.name ||
      watchedFields[1] !== originalProduct.size ||
      watchedFields[2] !== originalProduct.category ||
      watchedFields[3] !== String(originalProduct.price) ||
      (watchedFields[4] || "") !== (originalProduct.description || "") ||
      String(watchedFields[5]) !== String(originalProduct.weight) ||
      String(watchedFields[6]) !== String(originalProduct.width) ||
      String(watchedFields[7]) !== String(originalProduct.height) ||
      String(watchedFields[8]) !== String(originalProduct.length) ||
      (watchedFields[9] || "") !== (originalProduct.sku || "") ||
      value !== originalProduct.quantity ||
      imageFile !== null);

  const onSubmit = async (data) => {
    if (!productId && !imageFile) {
      return toast.warning("Por favor, selecione uma imagem para o produto.");
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("size", data.size);
    formData.append("category", data.category);
    formData.append("price", data.price);
    formData.append("quantity", value);
    formData.append("description", data.description || "");
    // SKU: a costura entre o painel e o catálogo (índice único parcial em
    // canastra.produtos). Duplicado, o backend recusa com a mensagem que o
    // catch abaixo repassa.
    formData.append("sku", (data.sku || "").trim());

    // Peso e as TRES dimensoes.
    // Antes so `length` era enviado, embora o formulario tenha campo para os
    // quatro e o `isDirty` acima observe os quatro. O backend, sem receber os
    // outros, aplicava os padroes (0,3 kg / 20 / 5 cm) — entao QUALQUER edicao
    // de produto, mesmo so mudar o preco, apagava as medidas reais do pacote.
    // Como o frete e cotado por peso e volume, isso fazia a loja cobrar frete
    // errado, sem nenhum sinal na tela.
    formData.append("weight", data.weight);
    formData.append("width", data.width);
    formData.append("height", data.height);
    formData.append("length", data.length);
    if (imageFile) {
      formData.append("image", imageFile);
    } else if (productId) {
      const found = dataForm.find((p) => p.product_id === productId);
      if (found?.image) {
        formData.append("image", found.image);
      }
    }

    const method = productId ? "PUT" : "POST";
    const url = productId
      ? `${API_BASE}/dashboard/${productId}`
      : `${API_BASE}/dashboard`;

    try {
      const res = await authFetch(url, {
        method: method,
        body: formData,
      });

      if (!res.ok) {
        // O backend fala frases ("Já existe um produto com este SKU.", os
        // erros de validação) — mostrar a frase vale mais que "Erro ao
        // salvar produto." genérico.
        const corpo = await res.json().catch(() => ({}));
        throw new Error(corpo.message || corpo.error || "Erro na requisição");
      }
      if (productId) {
        toast.info("Produto atualizado com sucesso!");
      } else {
        toast.success("Produto adicionado com sucesso!");
      }

      await updateProductList();
      setProductId("");
      navigate("/products/addedProducts");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Erro ao salvar produto.");
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <ContainerForm>
      <FormStyled onSubmit={handleSubmit(onSubmit)}>
        <label>Nome do produto</label>
        <input placeholder="Digite o nome..." {...register("name")} required />

        <label>SKU (código único do produto)</label>
        {/* Obrigatório para produto NOVO: o SKU é a chave que costura o
            catálogo da vitrine com o banco. Na edição continua editável —
            duplicado, o backend recusa e a mensagem aparece no toast. */}
        <input
          placeholder="Ex: CAN-CLASSICO-250G-MOIDO"
          {...register("sku")}
          required={!productId}
        />

        {/* "Embalagem" é o rótulo; o contrato da API continua sendo o type
            `size` de /options — só o texto visível mudou de camiseta para
            café. */}
        <label>Embalagem</label>
        <select {...register("size")} required>
          <option value="">Selecione a embalagem</option>
          {sizes.map((size) => (
            <option key={size.id} value={size.value}>
              {size.value}
            </option>
          ))}
        </select>

        <label>Categoria</label>
        <select {...register("category")} required>
          <option value="">Selecione uma categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.value}>
              {category.value}
            </option>
          ))}
        </select>

        <label>Preço</label>
        <input
          min="0"
          step="0.01"
          onWheel={(e) => e.target.blur()}
          placeholder="Digite o valor..."
          {...register("price")}
          type="number"
          required
        />

        <label>Quantidade em estoque</label>
        <div className="inputIncrementoOrDecremento">
          <button
            type="button"
            onClick={() =>
              setValue((prevValue) =>
                prevValue == 0 ? prevValue : prevValue - 1,
              )
            }
            className="btn"
          >
            -
          </button>
          <span className="number">{value}</span>
          <button
            type="button"
            onClick={() => setValue((prevValue) => prevValue + 1)}
            className="btn"
          >
            +
          </button>
        </div>

        <label>Descrição</label>
        <textarea
          placeholder="Digite a descrição do produto..."
          {...register("description")}
          rows={4}
        />

        <label>Imagem</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files[0];
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
          }}
        />

        {imagePreview && (
          <PreviewImage
            src={imagePreview}
            alt="preview"
            onClick={() => setSelectImage(true)}
          />
        )}

        <button
          type="submit"
          disabled={productId ? !isEdited : false}
          style={{
            opacity: productId && !isEdited ? 0.6 : 1,
            cursor: productId && !isEdited ? "not-allowed" : "pointer",
          }}
        >
          {productId ? "Atualizar produto" : "Adicionar produto"}
        </button>
      </FormStyled>

      {selectImage && (
        <ImageZoom onClick={() => setSelectImage(false)}>
          <img src={imagePreview} alt="zoom" />
        </ImageZoom>
      )}
    </ContainerForm>
  );
}

export default Form;
