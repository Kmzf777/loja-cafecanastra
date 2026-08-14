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
} from "./AddedShirts.style";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

function AddedShirts() {
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

  useEffect(() => {
    setLoading(true);
    updateProductList()
      .catch((e) => console.warn("updateProductList failed:", e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const productToBeEditted = (index) => {
    const product = dataForm[index];
    if (!product) return;
    setProductId(product.product_id);
    navigate("/dashboard/products/addProduct");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteProduct = async (id) => {
    const confirmDelete = window.confirm(
      "Tem certeza que deseja deletar este produto?",
    );
    if (!confirmDelete) return;

    try {
      setDeletingId(id);
      await authFetch(`${API_BASE}/dashboard/${id}`, { method: "DELETE" });
      await updateProductList();

      toast.success("Produto deletado!");
    } catch (error) {
      toast.error("Erro ao deletar produto!");
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

  if (!Array.isArray(dataForm) || dataForm.length === 0) {
    return (
      <Container>
        <h2>Produtos cadastrados</h2>
        <EmptyState>Nenhuma T-shirt adicionada ainda</EmptyState>
      </Container>
    );
  }

  if (loading) return <Loading />;

  return (
    <>
      <Container>
        <h2>Produtos cadastrados</h2>

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
                <th>Tamanho</th>
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
                    <div>Tamanho: {product.size}</div>
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

export default AddedShirts;
