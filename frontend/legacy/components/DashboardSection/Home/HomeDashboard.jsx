import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
} from "recharts";

import {
  Container,
  Overview,
  Card,
  CardGrid,
  CardGridItem,
} from "./HomeDashboard.style";
import Loading from "../../Loading/Loading";
import { useContext, useEffect, useState } from "react";
import authContext from "../../../contexts/loginContext/createAuthContext";
import { API_BASE } from "../../../api";

const COLORS = ["#f57c00", "#00C49F", "#FF8042", "#FFBB28", "#d62728"];

/**
 * Os 9 status em PORTUGUÊS da migração 0009 — cópia local de
 * `backend/src/utils/statusDePedido.js` (mesma nota de Orders.jsx). O mapa
 * aqui só embeleza o rótulo do gráfico; valor desconhecido cai no fallback
 * `|| item.status` logo abaixo.
 */
const STATUS_TRANSLATION = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  em_processamento: "Em processamento",
  autorizado: "Autorizado",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
  rejeitado: "Rejeitado",
  reembolsado: "Reembolsado",
};

function Home() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    products: 0,
    orders: 0,
    users: 0,
  });
  const [salesData, setSalesData] = useState([]);
  const [orderStatusData, setOrderStatusData] = useState([]);
  /**
   * `erro` existe porque zero e um numero perfeitamente plausivel.
   *
   * Quando a API falhava, o `catch` so escrevia no console e a tela seguia
   * mostrando o estado inicial: 0 produtos, 0 pedidos, 0 clientes, graficos
   * vazios. Para quem administra a loja, isso e indistinguivel de "hoje nao
   * vendi nada" — informacao errada apresentada com toda a confianca. Pior que
   * nao mostrar nada.
   */
  const [erro, setErro] = useState(null);
  const { authFetch, user } = useContext(authContext);

  useEffect(() => {
    if (!user) return;

    const fetchDashboard = async () => {
      try {
        // Segundo argumento é o objeto de options do fetch — a string "GET"
        // que ficava aqui era silenciosamente ignorada.
        const res = await authFetch(`${API_BASE}/dashboard/summary`);

        if (!res.ok) {
          setErro("Não foi possível carregar os números agora.");
        } else {
          const data = await res.json();
          setErro(null);

          setMetrics(data.counts);

          const formattedSales = data.salesChart.map((item) => ({
            day: item.day,
            vendas: Number(item.total),
          }));
          setSalesData(formattedSales);

          const formattedStatus = data.statusChart.map((item) => ({
            name: STATUS_TRANSLATION[item.status] || item.status,
            value: Number(item.count),
          }));
          setOrderStatusData(formattedStatus);
        }
      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
        setErro("Não foi possível falar com o servidor.");
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [authFetch, user]);

  if (loading) return <Loading />;

  return (
    <Container>
      <h2>Relatórios</h2>

      {/* Aviso ANTES dos números: se o carregamento falhou, quem lê precisa
          saber disso antes de acreditar no que está na tela. */}
      {erro && (
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
          {erro} Os números abaixo podem estar desatualizados ou zerados —
          recarregue a página.
        </p>
      )}

      <Overview>
        <Card>
          <h3>Produtos</h3>
          <p>{metrics.products} cadastrados</p>
        </Card>
        <Card>
          <h3>Pedidos</h3>
          <p>{metrics.orders} totais</p>
        </Card>
        <Card>
          <h3>Clientes</h3>
          <p>{metrics.users} registrados</p>
        </Card>
      </Overview>

      <div style={{ marginTop: 32 }}>
        <CardGrid>
          <CardGridItem>
            <h3 style={{ marginBottom: 8 }}>Vendas (Últimos 7 dias)</h3>
            {salesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={salesData}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => `R$ ${Number(value).toFixed(2)}`}
                    cursor={{ fill: "transparent" }}
                  />
                  <Bar dataKey="vendas" fill="#8884d8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                style={{ padding: "2rem", textAlign: "center", color: "#888" }}
              >
                Nenhuma venda registrada nos últimos 7 dias.
              </div>
            )}
          </CardGridItem>

          <CardGridItem>
            <h3 style={{ marginBottom: 8 }}>Status dos Pedidos</h3>
            {orderStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={orderStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {orderStatusData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div
                style={{ padding: "2rem", textAlign: "center", color: "#888" }}
              >
                Ainda não há pedidos.
              </div>
            )}
          </CardGridItem>
        </CardGrid>
      </div>
    </Container>
  );
}

export default Home;
