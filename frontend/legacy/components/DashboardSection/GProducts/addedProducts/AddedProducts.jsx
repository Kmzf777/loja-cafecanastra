import { IoTrashBin } from "react-icons/io5";
import { FaChevronLeft, FaChevronRight, FaRegEdit } from "react-icons/fa";
import { useContext, useEffect, useState } from "react";
import productContext from "../../../../contexts/productContext/createProductContext";
import { API_BASE } from "../../../../api";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";
import {
  Container,
  TableWrapper,
  Table,
  Thumb,
  Controls,
  ImageZoom,
  CardList,
  Card,
  CardRow,
  CardActions,
  EmptyState,
  ActionsWrapper,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "./AddedProducts.style";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

// Era "AddedShirts", nome de um catálogo que não é o desta loja — e este
// arquivo era o último a dizer isso na cara do gestor.
function AddedProducts() {
  const { authFetch } = useContext(authContext);
  const navigate = useNavigate();
  const {
    dataForm,
    updateProductList,
    setProductId,
    page,
    setPage,
    totalPages,
  } = useContext(productContext);
  const [zoomImage, setZoomImage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [loading, setLoading] = useState(true);
  // Lista vazia com erro de rede NÃO é "nenhum café cadastrado": o provider
  // devolve false quando o fetch falhou de verdade, e a tarja conta isso.
  const [erro, setErro] = useState(null);

  useEffect(() => {
    setLoading(true);
    updateProductList()
      .then((ok) => {
        // `undefined` = requisição superada por outra — nem sucesso nem erro.
        if (ok === false) {
          setErro("Não foi possível carregar os produtos do servidor.");
        } else if (ok === true) {
          setErro(null);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const productToBeEditted = (index) => {
    const product = dataForm[index];
    if (!product) return;
    setProductId(product.product_id);
    navigate("/products/addProduct");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteProduct = async (id) => {
    const confirmDelete = window.confirm(
      "Tem certeza que deseja deletar este produto?",
    );
    if (!confirmDelete) return;

    try {
      setDeletingId(id);
      const resposta = await authFetch(`${API_BASE}/dashboard/${id}`, {
        method: "DELETE",
      });

      // `fetch` NAO lanca em 4xx/5xx — so em falha de rede. Sem esta checagem,
      // um 403 "Acesso negado" ou um 500 caiam no caminho de sucesso e o painel
      // anunciava "Produto deletado!" com o produto intacto no banco. O admin
      // so descobria recarregando a lista.
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.message || `Falha ${resposta.status}`);
      }

      await updateProductList();

      toast.success("Produto deletado!");
    } catch (error) {
      toast.error(error.message || "Erro ao deletar produto!");
      console.error("Erro ao deletar produto:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const generatePagination = () => {
    if (!totalPages) return [];

    const delta = 1;
    const range = [];
    const rangeWithDots = [];

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= page - delta && i <= page + delta)
      ) {
        range.push(i);
      }
    }

    let l;
    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  };

  const getImageUrl = (imagePath) => {
    if (!imagePath) return "";
    return imagePath.startsWith("http") ? imagePath : `${API_BASE}${imagePath}`;
  };

  // Loading PRIMEIRO: com a ordem invertida, o primeiro render (lista ainda
  // vazia) mostrava "nenhum café cadastrado" por um instante antes do
  // spinner — e, num load com erro, para sempre.
  if (loading) return <Loading />;

  const tarjaDeErro = erro && (
    <p
      role="alert"
      style={{
        margin: "0 0 16px",
        padding: "10px 14px",
        borderLeft: "3px solid #b3261e",
        background: "#fdf2f1",
        color: "#5c1a14",
        fontSize: 14,
      }}
    >
      {erro} A lista abaixo pode estar vazia ou desatualizada — recarregue a
      página.
    </p>
  );

  if (!Array.isArray(dataForm) || dataForm.length === 0) {
    return (
      <Container>
        <h2>Produtos cadastrados</h2>
        {tarjaDeErro}
        {/* Com erro, vazio é DESCONHECIDO — afirmar "nenhum café" mentiria. */}
        {!erro && <EmptyState>Nenhum café cadastrado ainda</EmptyState>}
      </Container>
    );
  }

  return (
    <>
      <Container>
        <h2>Produtos cadastrados</h2>

        {tarjaDeErro}

        <Controls>
          <div>
            <strong>Total encontrados:</strong> {dataForm.length} (Página {page}{" "}
            de {totalPages})
          </div>
        </Controls>

        <TableWrapper>
          <Table role="table">
            <thead>
              <tr>
                <th>Imagem</th>
                <th>Nome</th>
                <th>Preço</th>
                <th>Embalagem</th>
                <th>Qtd</th>
                <th>Categoria</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {dataForm.map((product, index) => {
                const priceToFormat = Number(product.price || 0);
                const formatedPrice = priceToFormat.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                });

                const imgUrl = getImageUrl(product.image);

                return (
                  <tr key={product.product_id}>
                    <td>
                      <Thumb
                        src={imgUrl}
                        alt={product.name}
                        onClick={() => setZoomImage(imgUrl)}
                      />
                    </td>
                    <td>{product.name}</td>
                    <td>{formatedPrice}</td>
                    <td>{product.size}</td>
                    <td>{product.quantity}</td>
                    <td>{product.category}</td>
                    <td>
                      <ActionsWrapper>
                        <FaRegEdit
                          role="button"
                          aria-label={`Editar ${product.name}`}
                          onClick={() => productToBeEditted(index)}
                          style={{
                            color: "#e7c508",
                            cursor: "pointer",
                          }}
                        />
                        <IoTrashBin
                          role="button"
                          aria-label={`Deletar ${product.name}`}
                          onClick={() => deleteProduct(product.product_id)}
                          style={{ color: "#9d2b2b", cursor: "pointer" }}
                          title="Deletar"
                        />
                      </ActionsWrapper>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <CardList>
            {dataForm.map((product, index) => {
              const priceToFormat = Number(product.price || 0);
              const formatedPrice = priceToFormat.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              });

              const imgUrl = getImageUrl(product.image);

              return (
                <Card key={product.product_id}>
                  <CardRow>
                    <div
                      style={{ display: "flex", gap: 12, alignItems: "center" }}
                    >
                      <img
                        src={imgUrl}
                        alt={product.name}
                        style={{
                          width: 80,
                          height: 80,
                          objectFit: "cover",
                          borderRadius: 6,
                        }}
                        onClick={() => setZoomImage(imgUrl)}
                      />
                      <div>
                        <div style={{ fontWeight: 700 }}>{product.name}</div>
                        <div style={{ color: "#666", fontSize: 14 }}>
                          {product.category}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 90 }}>
                      {formatedPrice}
                    </div>
                  </CardRow>

                  <CardRow>
                    <div>Embalagem: {product.size}</div>
                    <div>Qtd: {product.quantity}</div>
                  </CardRow>

                  <CardActions>
                    <button
                      type="button"
                      onClick={() => productToBeEditted(index)}
                      aria-label={`Editar ${product.name}`}
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteProduct(product.product_id)}
                      aria-label={`Deletar ${product.name}`}
                      disabled={deletingId === product.product_id}
                      style={{ background: "#9d2b2b" }}
                    >
                      {deletingId === product.product_id
                        ? "Deletando..."
                        : "Deletar"}
                    </button>
                  </CardActions>
                </Card>
              );
            })}
          </CardList>
        </TableWrapper>

        {totalPages > 1 && (
          <PaginationContainer>
            {/* Botão Anterior */}
            <PaginationButton
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
              title="Página anterior"
            >
              <FaChevronLeft size={12} />
            </PaginationButton>

            {/* Números */}
            {generatePagination().map((item, index) => {
              if (item === "...") {
                return <Dots key={index}>...</Dots>;
              }
              return (
                <PaginationButton
                  key={index}
                  isActive={page === item}
                  onClick={() => handlePageChange(item)}
                >
                  {item}
                </PaginationButton>
              );
            })}

            {/* Botão Próxima */}
            <PaginationButton
              onClick={() => handlePageChange(page + 1)}
              disabled={page === totalPages}
              title="Próxima página"
            >
              <FaChevronRight size={12} />
            </PaginationButton>
          </PaginationContainer>
        )}

        {zoomImage && (
          <ImageZoom onClick={() => setZoomImage(null)}>
            <img src={zoomImage} alt="zoomed" />
          </ImageZoom>
        )}
      </Container>
    </>
  );
}

export default AddedProducts;
