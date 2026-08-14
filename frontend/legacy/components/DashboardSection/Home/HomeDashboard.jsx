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

const STATUS_TRANSLATION = {
  pending: "Pendente",
  approved: "Aprovado",
  in_process: "Processando",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
  shipped: "Enviado",
  delivered: "Entregue",
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
  const { authFetch, user } = useContext(authContext);

  useEffect(() => {
    if (!user) return;

    const fetchDashboard = async () => {
      try {
        const res = await authFetch(`${API_BASE}/dashboard/summary`, "GET");

        if (res.ok) {
          const data = await res.json();

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
