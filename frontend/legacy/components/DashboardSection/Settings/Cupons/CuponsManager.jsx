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
} from "../OffersAndCupons/PromotionsManager.style";
import { API_BASE } from "../../../../api";
import { toast } from "react-toastify";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import Loading from "../../../Loading/Loading";

/**
 * Cupons de desconto — contra o contrato fixado no plano mestre da Onda 2:
 *
 *   GET  /cupons      (admin) -> { data: [{ id, codigo, tipo, valor,
 *                       descricao, minimo_centavos, limite_usos, usos,
 *                       ativo, inicio_em, fim_em }] }
 *   POST /cupons      (mesmos campos, sem id/usos)
 *   PUT  /cupons/:id  (parcial)
 *
 * O backend deste contrato entra NESTA MESMA ONDA por outro agente: se a
 * rota ainda não existir (404), a tela degrada com a tarja de erro padrão —
 * nunca quebra nem finge lista vazia.
 *
 * Unidades: `minimo_centavos` é o que o nome diz (o formulário fala em R$ e
 * converte na borda). `valor` segue o tipo: percent = número de 0 a 100;
 * fixed = REAIS (mesma unidade dos preços da loja) — premissa alinhada ao
 * `desconto numeric(10,2)` em reais da migração 0010.
 */

const FORM_VAZIO = {
  id: "",
  codigo: "",
  tipo: "percent",
  valor: "",
  descricao: "",
  minimoReais: "",
  limite_usos: "",
  inicio_em: "",
  fim_em: "",
  ativo: true,
};

const moeda = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

/** ISO (ou Date) -> valor de <input type="datetime-local">. */
const paraInputDataHora = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dataBr = (dateString) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR");
};

function CuponsManager() {
  const { authFetch } = useContext(authContext);
  const [cupons, setCupons] = useState([]);
  const [form, setForm] = useState(FORM_VAZIO);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  // Trava de duplo clique: dois POSTs do mesmo formulário são dois cupons
  // (ou um 409 confuso) — o botão desarma enquanto a requisição viaja.
  const [salvando, setSalvando] = useState(false);

  const loadCupons = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/cupons`);
      if (res.ok) {
        const data = await res.json();
        setCupons(Array.isArray(data.data) ? data.data : []);
        setErro(null);
      } else if (res.status === 404) {
        // O módulo de cupons sobe por outro agente nesta onda: 404 aqui é
        // "ainda não instalado", e a tela diz isso em vez de fingir lista
        // vazia.
        setErro(
          "O módulo de cupons ainda não está disponível neste servidor.",
        );
      } else {
        setErro(`Não foi possível carregar os cupons (erro ${res.status}).`);
      }
    } catch (err) {
      console.error("Erro ao carregar cupons", err);
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadCupons();
  }, [loadCupons]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleEdit = (c) => {
    setForm({
      id: c.id,
      codigo: c.codigo || "",
      tipo: c.tipo || "percent",
      valor: c.valor ?? "",
      descricao: c.descricao || "",
      minimoReais:
        c.minimo_centavos !== null && c.minimo_centavos !== undefined
          ? String(Number(c.minimo_centavos) / 100)
          : "",
      limite_usos:
        c.limite_usos !== null && c.limite_usos !== undefined
          ? String(c.limite_usos)
          : "",
      inicio_em: paraInputDataHora(c.inicio_em),
      fim_em: paraInputDataHora(c.fim_em),
      ativo: c.ativo !== false,
    });
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelarEdicao = () => {
    setForm(FORM_VAZIO);
    setIsEditing(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (salvando) return;

    const valor = Number(form.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return toast.warning("Informe um valor de desconto maior que zero.");
    }
    if (form.tipo === "percent" && valor > 90) {
      // O teto de 90% é o CHECK `cupons_valor_valido` da migração 0010:
      // avisar aqui poupa a ida ao servidor, mas quem manda é o banco.
      return toast.warning("Desconto percentual não pode passar de 90%.");
    }

    // R$ -> centavos na borda; vazio = sem pedido mínimo.
    const minimoReais = String(form.minimoReais).replace(",", ".").trim();
    const minimo_centavos = minimoReais
      ? Math.round(Number(minimoReais) * 100)
      : null;
    if (minimo_centavos !== null && !Number.isFinite(minimo_centavos)) {
      return toast.warning("Pedido mínimo inválido.");
    }

    // Janela que termina antes de começar é um cupom que NUNCA vale — o
    // servidor também recusa (validarCampos, 400), mas avisar aqui poupa a
    // ida e aponta o campo certo.
    if (form.inicio_em && form.fim_em) {
      const inicio = new Date(form.inicio_em);
      const fim = new Date(form.fim_em);
      if (fim.getTime() <= inicio.getTime()) {
        return toast.warning(
          "O fim da validade precisa ser depois do início.",
        );
      }
    }

    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      tipo: form.tipo,
      valor,
      descricao: form.descricao || "",
      minimo_centavos,
      limite_usos: form.limite_usos ? Number(form.limite_usos) : null,
      ativo: form.ativo !== false,
      inicio_em: form.inicio_em ? new Date(form.inicio_em).toISOString() : null,
      fim_em: form.fim_em ? new Date(form.fim_em).toISOString() : null,
    };

    setSalvando(true);
    try {
      const res = await authFetch(
        isEditing ? `${API_BASE}/cupons/${form.id}` : `${API_BASE}/cupons`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        throw new Error(
          corpo.error || corpo.message || `Erro ${res.status} ao salvar.`,
        );
      }

      toast.success(isEditing ? "Cupom atualizado!" : "Cupom criado!");
      cancelarEdicao();
      loadCupons();
    } catch (err) {
      console.error("Erro ao salvar cupom", err);
      toast.error(err.message || "Erro ao salvar cupom.");
    } finally {
      setSalvando(false);
    }
  };

  const toggleAtivo = async (c) => {
    try {
      const res = await authFetch(`${API_BASE}/cupons/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // PUT parcial, do contrato: só o campo que muda.
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        throw new Error(corpo.error || corpo.message || "Falha ao atualizar.");
      }
      toast.success(`Cupom ${c.ativo ? "desativado" : "ativado"}!`);
      loadCupons();
    } catch (err) {
      console.error("Erro ao alterar cupom", err);
      toast.error(err.message || "Erro ao alterar o cupom.");
    }
  };

  const descreveValor = (c) =>
    c.tipo === "percent" ? `${Number(c.valor)}%` : moeda(c.valor);

  const descreveUsos = (c) => {
    const usos = Number(c.usos || 0);
    return c.limite_usos ? `${usos}/${c.limite_usos}` : `${usos}/sem limite`;
  };

  const descreveValidade = (c) => {
    const inicio = dataBr(c.inicio_em);
    const fim = dataBr(c.fim_em);
    if (inicio && fim) return `${inicio} a ${fim}`;
    if (inicio) return `a partir de ${inicio}`;
    if (fim) return `até ${fim}`;
    return "sem prazo";
  };

  if (loading) return <Loading />;

  return (
    <Container>
      <Title>Cupons de Desconto</Title>

      {/* Tarja de erro padrão do painel (mesmo desenho do HomeDashboard). */}
      {erro && (
        <p
          role="alert"
          style={{
            margin: "0 0 4px",
            padding: "10px 14px",
            borderLeft: "3px solid #b3261e",
            background: "#fdf2f1",
            color: "#5c1a14",
            fontSize: 14,
          }}
        >
          {erro} Os cupons abaixo podem estar desatualizados — recarregue a
          página.
        </p>
      )}

      <Card>
        <Title as="h3">{isEditing ? "Editar cupom" : "Novo cupom"}</Title>
        <Form onSubmit={handleSubmit}>
          <Label>Código (o que o cliente digita no checkout)</Label>
          <Input
            name="codigo"
            value={form.codigo}
            onChange={handleChange}
            placeholder="Ex: CAFE10"
            required
          />

          <Label>Tipo de desconto</Label>
          <Select name="tipo" value={form.tipo} onChange={handleChange}>
            <option value="percent">Porcentagem (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </Select>

          <Label>
            {form.tipo === "percent" ? "Desconto (%)" : "Desconto (R$)"}
          </Label>
          <Input
            name="valor"
            type="number"
            min="0"
            step="0.01"
            onWheel={(e) => e.target.blur()}
            value={form.valor}
            onChange={handleChange}
            required
          />

          <Label>Descrição (aparece para o cliente)</Label>
          <TextArea
            name="descricao"
            value={form.descricao}
            onChange={handleChange}
            rows={2}
          />

          <Label>Pedido mínimo (R$) — vazio = sem mínimo</Label>
          <Input
            name="minimoReais"
            type="number"
            min="0"
            step="0.01"
            onWheel={(e) => e.target.blur()}
            value={form.minimoReais}
            onChange={handleChange}
            placeholder="Ex: 100,00"
          />

          <Label>Limite de usos — vazio = sem limite</Label>
          <Input
            name="limite_usos"
            type="number"
            min="1"
            step="1"
            onWheel={(e) => e.target.blur()}
            value={form.limite_usos}
            onChange={handleChange}
          />

          <Label>Início da validade</Label>
          <Input
            name="inicio_em"
            type="datetime-local"
            value={form.inicio_em}
            onChange={handleChange}
          />

          <Label>Fim da validade</Label>
          <Input
            name="fim_em"
            type="datetime-local"
            value={form.fim_em}
            onChange={handleChange}
          />

          <Actions>
            {isEditing && (
              <ButtonSecondary type="button" onClick={cancelarEdicao}>
                Cancelar
              </ButtonSecondary>
            )}
            <ButtonPrimary type="submit" disabled={salvando}>
              {salvando
                ? "Salvando..."
                : isEditing
                  ? "Atualizar Cupom"
                  : "Criar Cupom"}
            </ButtonPrimary>
          </Actions>
        </Form>
      </Card>

      <Card>
        <Title as="h3">Cupons Existentes</Title>
        {cupons.length === 0 ? (
          <p style={{ color: "#888" }}>
            {erro ? "Nada para listar." : "Nenhum cupom cadastrado ainda."}
          </p>
        ) : (
          <List>
            {cupons.map((c) => (
              <ListItem key={c.id} active={c.ativo}>
                <div>
                  <strong>{c.codigo}</strong> — {descreveValor(c)}
                  {c.minimo_centavos ? (
                    <> (mín. {moeda(Number(c.minimo_centavos) / 100)})</>
                  ) : null}
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    Usos: {descreveUsos(c)} · Validade: {descreveValidade(c)} ·{" "}
                    {c.ativo ? "Ativo" : "Inativo"}
                  </div>
                  {c.descricao && (
                    <div style={{ fontSize: "0.85rem", color: "#888" }}>
                      {c.descricao}
                    </div>
                  )}
                </div>
                <Actions>
                  <ButtonSecondary onClick={() => toggleAtivo(c)}>
                    {c.ativo ? "Desativar" : "Ativar"}
                  </ButtonSecondary>
                  <ButtonSecondary onClick={() => handleEdit(c)}>
                    Editar
                  </ButtonSecondary>
                </Actions>
              </ListItem>
            ))}
          </List>
        )}
      </Card>
    </Container>
  );
}

export default CuponsManager;
