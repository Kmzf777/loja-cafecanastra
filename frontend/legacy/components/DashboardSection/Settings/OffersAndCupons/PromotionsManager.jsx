import { useCallback, useContext, useEffect, useState } from "react";
import {
  Container,
  Card,
  Title,
  List,
  ListItem,
  Actions,
  ButtonPrimary,
  ButtonSecondary,
  Form,
  Input,
  TextArea,
  Select,
  Label,
} from "./PromotionsManager.style";
import fetchDataForm, { API_BASE } from "../../../../api";
import { toast } from "react-toastify";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

function OffersAndCupons() {
  const { authFetch } = useContext(authContext);
  const [promotions, setPromotions] = useState([]);
  const [form, setForm] = useState({
    id: "",
    title: "",
    description: "",
    type: "percent",
    value: 0,
    applies_to: "all",
    category: "",
    product_id: "",
    start_date: "",
    end_date: "",
    active: true,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const formatForInput = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const pad = (n) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDataForm("/promotions", "GET");
      if (res.ok) {
        const data = await res.json();
        const now = new Date();

        data.forEach((p) => {
          if (
            formatForInput(p.start_date) > formatForInput(now) ||
            formatForInput(p.end_date) < formatForInput(now)
          ) {
            p.active = false;
          }
        });
        setPromotions(data);
      }
    } catch (err) {
      console.error("Erro ao carregar promoções", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromotions();
  }, [loadPromotions]);

  const handleEdit = (p) => {
    setForm({
      ...p,
      start_date: formatForInput(p.start_date),
      end_date: formatForInput(p.end_date),
    });
    setIsEditing(true);
  };

  const toggleActive = async (p) => {
    try {
      const res = await authFetch(`${API_BASE}/promotions/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...p,
          active: !p.active,
          start_date: formatForInput(p.start_date),
          end_date: formatForInput(p.end_date),
        }),
      });

      if (res.ok) {
        toast.success(
          `Promoção ${!p.active ? "ativada" : "desativada"} com sucesso!`,
        );
        loadPromotions();
      } else {
        throw new Error("Falha ao atualizar status");
      }
    } catch (err) {
      console.error("Erro ao atualizar status da promoção", err);
      toast.error("Erro ao alterar status da promoção.");
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      let res;
      const headers = { "Content-Type": "application/json" };
      if (isEditing) {
        res = await authFetch(`${API_BASE}/promotions/${form.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(form),
        });
      } else {
        res = await authFetch(`${API_BASE}/promotions`, {
          method: "POST",
          headers,
          body: JSON.stringify(form),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar promoção.");
      }

      toast.success(
        isEditing
          ? "Promoção atualizada com sucesso!"
          : "Promoção criada com sucesso!",
      );

      setForm({
        id: "",
        title: "",
        description: "",
        type: "percent",
        value: 0,
        applies_to: "all",
        category: "",
        product_id: "",
        start_date: "",
        end_date: "",
        active: true,
      });
      setIsEditing(false);
      loadPromotions();
    } catch (err) {
      console.error("Erro ao salvar promoção", err);
      toast.error("Erro ao salvar promoção.");
    }
  };

  if (loading) return <Loading />;

  return (
    <Container>
      <Title>Gerenciar Promoções</Title>

      <Card>
        <Form onSubmit={handleSubmit}>
          <Label>Título</Label>
          <Input
            name="title"
            value={form.title}
            onChange={handleChange}
            required
          />

          <Label>Descrição</Label>
          <TextArea
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={3}
          />

          <Label>Tipo</Label>
          <Select name="type" value={form.type} onChange={handleChange}>
            <option value="percent">Porcentagem</option>
            <option value="fixed">Valor Fixo</option>
          </Select>

          <Label>Valor</Label>
          <Input
            name="value"
            type="number"
            value={form.value}
            onChange={handleChange}
            required
          />

          <Label>Aplica-se a</Label>
          <Select
            name="applies_to"
            value={form.applies_to}
            onChange={handleChange}
          >
            <option value="all">Todos</option>
            <option value="category">Categoria</option>
            <option value="product">Produto</option>
          </Select>

          {form.applies_to === "category" && (
            <>
              <Label>Categoria</Label>
              <Input
                name="category"
                value={form.category}
                onChange={handleChange}
              />
            </>
          )}
          {form.applies_to === "product" && (
            <>
              <Label>Produto</Label>
              <Input
                name="product_id"
                value={form.product_id}
                onChange={handleChange}
              />
            </>
          )}

          <Label>Início</Label>
          <Input
            name="start_date"
            type="datetime-local"
            value={form.start_date}
            onChange={handleChange}
          />

          <Label>Fim</Label>
          <Input
            name="end_date"
            type="datetime-local"
            value={form.end_date}
            onChange={handleChange}
          />

          <Actions>
            <ButtonPrimary type="submit">
              {isEditing ? "Atualizar Promoção" : "Criar Promoção"}
            </ButtonPrimary>
          </Actions>
        </Form>
      </Card>

      <Card>
        <Title as="h3">Promoções Existentes</Title>
        <List>
          {promotions.map((p) => (
            <ListItem key={p.id} active={p.active}>
              <div>
                <strong>{p.title}</strong> — R$ {Number(p.value).toFixed(2)} —{" "}
                {p.applies_to}
              </div>
              <Actions>
                <ButtonSecondary
                  onClick={() => toggleActive(p)}
                  disabled={
                    formatForInput(p.start_date) > formatForInput(new Date()) ||
                    formatForInput(p.end_date) < formatForInput(new Date())
                  }
                >
                  {p.active ? "Desativar" : "Ativar"}
                </ButtonSecondary>
                <ButtonSecondary onClick={() => handleEdit(p)}>
                  Editar
                </ButtonSecondary>
              </Actions>
            </ListItem>
          ))}
        </List>
      </Card>
    </Container>
  );
}

export default OffersAndCupons;
