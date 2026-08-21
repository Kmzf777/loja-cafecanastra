import { useCallback, useContext, useEffect, useState } from "react";
import {
  Container,
  Card,
  Title,
  List,
  ListItem,
} from "../Settings/OffersAndCupons/PromotionsManager.style";
import { API_BASE } from "../../../api";
import authContext from "../../../contexts/loginContext/createAuthContext";
import Loading from "../../Loading/Loading";

/**
 * Assinaturas do Clube da Canastra — contra `GET /admin/assinaturas`
 * (clube.routes.js, Onda 3J):
 *
 *   [{ id, sku, nome_cafe, quantidade, frequencia_dias, preco_centavos,
 *      status, criado_em, cancelada_em, cliente_nome, cliente_email }]
 *
 * SÓ LEITURA, de propósito: criar assinatura é do cliente (wizard de /clube +
 * autorização no Mercado Pago) e cancelar é da conta dele — o preapproval é
 * autorização DELE no MP, não um registro que o gestor edita. O que o gestor
 * precisa ver aqui é quem assina o quê, com que frequência e desde quando; os
 * pedidos de cada cobrança já caem na tela de Pedidos como venda normal.
 *
 * Se a rota ainda não existir neste servidor (404), a tela degrada com a
 * tarja de erro padrão — nunca quebra nem finge lista vazia (mesmo desenho do
 * CuponsManager).
 */

const STATUS = {
  pendente: "Aguardando autorização",
  ativa: "Ativa",
  pausada: "Pausada",
  cancelada: "Cancelada",
};

const moeda = (centavos) =>
  (Number(centavos || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const dataBr = (dateString) => {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
};

function AssinaturasManager() {
  const { authFetch } = useContext(authContext);
  const [assinaturas, setAssinaturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const loadAssinaturas = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/admin/assinaturas`);
      if (res.ok) {
        const data = await res.json();
        setAssinaturas(Array.isArray(data) ? data : []);
        setErro(null);
      } else if (res.status === 404) {
        setErro(
          "O módulo do Clube ainda não está disponível neste servidor.",
        );
      } else {
        setErro(
          `Não foi possível carregar as assinaturas (erro ${res.status}).`,
        );
      }
    } catch (err) {
      console.error("Erro ao carregar assinaturas", err);
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadAssinaturas();
  }, [loadAssinaturas]);

  if (loading) return <Loading />;

  const ativas = assinaturas.filter((a) => a.status === "ativa").length;

  return (
    <Container>
      <Title>Clube da Canastra — Assinaturas</Title>

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
          {erro}
        </p>
      )}

      <Card>
        <Title as="h3">
          {assinaturas.length} assinatura{assinaturas.length === 1 ? "" : "s"}
          {assinaturas.length > 0 ? ` · ${ativas} ativa${ativas === 1 ? "" : "s"}` : ""}
        </Title>

        {assinaturas.length === 0 ? (
          <p style={{ color: "#888" }}>
            {erro
              ? "Nada para listar."
              : "Nenhuma assinatura ainda. Quando um cliente assinar pelo site (/clube), ela aparece aqui — e cada cobrança vira um pedido na tela de Pedidos."}
          </p>
        ) : (
          <List>
            {assinaturas.map((a) => (
              <ListItem key={a.id} active={a.status === "ativa"}>
                <div>
                  <strong>{a.cliente_nome}</strong>{" "}
                  <span style={{ color: "#888" }}>({a.cliente_email})</span>
                  <div style={{ fontSize: "0.9rem", marginTop: 2 }}>
                    {a.quantidade > 1 ? `${a.quantidade}× ` : ""}
                    {a.nome_cafe} · a cada {a.frequencia_dias} dias ·{" "}
                    {moeda(a.preco_centavos)} por envio
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {STATUS[a.status] || a.status} · desde {dataBr(a.criado_em)}
                    {a.status === "cancelada" && a.cancelada_em
                      ? ` · cancelada em ${dataBr(a.cancelada_em)}`
                      : ""}
                  </div>
                </div>
              </ListItem>
            ))}
          </List>
        )}
      </Card>
    </Container>
  );
}

export default AssinaturasManager;
