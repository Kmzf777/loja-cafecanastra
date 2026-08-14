import { useContext, useEffect, useState } from "react";
import fetchDataForm, { API_BASE } from "../../../../api";
import { toast } from "react-toastify";
import {
  Container,
  Section,
  SectionHeader,
  InputGroup,
  List,
  ListItem,
  Button,
  Input,
  Title,
} from "./ManageCategories.style";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

function ManageCategories() {
  const { authFetch } = useContext(authContext);
  const [categories, setCategories] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [newCategory, setNewCategory] = useState("");
  const [newSize, setNewSize] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchOptions = async () => {
    setLoading(true);
    try {
      const [catRes, sizeRes] = await Promise.all([
        fetchDataForm("/options?type=category", "GET"),
        fetchDataForm("/options?type=size", "GET"),
      ]);

      if (catRes.ok && sizeRes.ok) {
        setCategories(await catRes.json());
        setSizes(await sizeRes.json());
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar opções.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, []);

  const handleAdd = async (type, value) => {
    if (!value.trim()) return;

    const res = await authFetch(`${API_BASE}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, value }),
    });

    if (res.ok) {
      toast.success(
        `${
          type === "category" ? "Categoria adicionada!" : "Tamanho adicionado!"
        }`,
      );
      fetchOptions();
      if (type === "category") setNewCategory("");
      if (type === "size") setNewSize("");
    } else {
      toast.error("Erro ao adicionar.");
    }
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Tem certeza que deseja remover esta opção?",
    );
    if (!confirmDelete) return;

    try {
      const res = await authFetch(`${API_BASE}/options/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Removido com sucesso");
        fetchOptions();
      } else {
        const data = await res.json();
        toast.error(data.message || "Erro ao remover.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro de conexão ao tentar remover.");
    }
  };

  if (loading) return <Loading />;

  return (
    <Container>
      <Title>Gerenciar Opções de Produto</Title>

      <Section>
        <SectionHeader>📂 Categorias</SectionHeader>
        <List>
          {categories.map((category) => (
            <ListItem key={category.id}>
              {category.value}
              <Button $danger onClick={() => handleDelete(category.id)}>
                Excluir
              </Button>
            </ListItem>
          ))}
        </List>
        <InputGroup>
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Nova categoria"
          />
          <Button onClick={() => handleAdd("category", newCategory)}>
            Adicionar
          </Button>
        </InputGroup>
      </Section>

      <Section>
        <SectionHeader>📏 Tamanhos</SectionHeader>
        <List>
          {sizes.map((size) => (
            <ListItem key={size.id}>
              {size.value}
              <Button $danger onClick={() => handleDelete(size.id)}>
                Excluir
              </Button>
            </ListItem>
          ))}
        </List>

        <InputGroup>
          <Input
            value={newSize}
            onChange={(e) => setNewSize(e.target.value)}
            placeholder="Novo tamanho"
          />
          <Button onClick={() => handleAdd("size", newSize)}>Adicionar</Button>
        </InputGroup>
      </Section>
    </Container>
  );
}

export default ManageCategories;
