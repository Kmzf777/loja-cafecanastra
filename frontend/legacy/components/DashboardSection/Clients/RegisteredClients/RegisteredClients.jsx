import { useCallback, useContext, useEffect, useState } from "react";

import {
  RegisteredClientsContainer,
  Table,
  Th,
  Td,
  Tr,
  Thead,
  Tbody,
  TableWrapper,
  CardList,
  Card,
  CardRow,
  PaginationContainer,
  PaginationButton,
  Dots,
} from "./RegisteredClients.style";
import { FaChevronLeft, FaChevronRight, FaTrash } from "react-icons/fa";
import { API_BASE } from "../../../../api";
import authContext from "../../../../contexts/loginContext/createAuthContext";
import { toast } from "react-toastify";
import Loading from "../../../Loading/Loading";

const RegisteredClients = () => {
  const { authFetch, user } = useContext(authContext);
  const [error, setError] = useState(null);
  const [dataUsers, setDataUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch(
        `${API_BASE}/auth/users?page=${page}&limit=10`,
      );

      if (res.ok) {
        const data = await res.json();
        setDataUsers(data.users || []);
        setTotalPages(data.totalPages || 1);
      } else {
        if (res.status === 403) {
          setError("Acesso negado: Você não tem permissão de administrador.");
        } else {
          setError(`Erro ao carregar dados: ${res.status}`);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar usuários:", err);
      setError("Ocorreu um erro inesperado.");
    } finally {
      setLoading(false);
    }
  }, [authFetch, page]);

  useEffect(() => {
    if (!user) return;

    fetchUsers();
  }, [page, user, fetchUsers]);

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
        if (i - l === 2) rangeWithDots.push(l + 1);
        else if (i - l !== 1) rangeWithDots.push("...");
      }
      rangeWithDots.push(i);
      l = i;
    }
    return rangeWithDots;
  };

  const handleDeleteUser = async (userId, userName) => {
    const confirm = window.confirm(
      `Tem certeza que deseja excluir o usuário "${userName}"? Isso apagará todos os dados dele.`,
    );
    if (!confirm) return;

    try {
      const res = await authFetch(`${API_BASE}/auth/users/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Usuário excluído com sucesso!");
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(data.message || "Erro ao excluir usuário.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro de conexão.");
    }
  };

  if (error) return <div style={{ padding: 20, color: "red" }}>{error}</div>;
  if (loading) return <Loading />;

  const hasClients = dataUsers.length > 0;

  return (
    <RegisteredClientsContainer>
      <h2>Clientes Cadastrados</h2>

      <TableWrapper>
        <Table>
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Email</Th>
              <Th>Telefone</Th>
              <Th>Compras</Th>
            </Tr>
          </Thead>
          <Tbody>
            {!hasClients ? (
              <Tr>
                <Td colSpan="4">Nenhum cliente cadastrado.</Td>
              </Tr>
            ) : (
              dataUsers.map((client) => (
                <Tr key={client.id}>
                  <Td>{client.name}</Td>
                  <Td>{client.email}</Td>
                  <Td>{client.phone || "-"}</Td>
                  <Td>{client.purchases}</Td>
                  <Td>
                    <button
                      onClick={() =>
                        handleDeleteUser(client.user_id, client.name)
                      }
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "#d32f2f",
                      }}
                      title="Excluir Usuário"
                    >
                      <FaTrash />
                    </button>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </TableWrapper>

      <CardList>
        {!hasClients ? (
          <p>Nenhum cliente cadastrado.</p>
        ) : (
          dataUsers.map((client) => (
            <Card key={client.user_id || client.id}>
              <CardRow>
                <strong>Nome:</strong>
                <span>{client.name}</span>
              </CardRow>
              <CardRow>
                <strong>Email:</strong>
                <span style={{ wordBreak: "break-all" }}>{client.email}</span>
              </CardRow>
              <CardRow>
                <strong>Telefone:</strong>
                <span>{client.phone || "-"}</span>
              </CardRow>
              <CardRow>
                <strong>Compras:</strong>
                <span>{client.purchases}</span>
              </CardRow>
              <CardRow>
                <strong>Ações:</strong>
                <button
                  onClick={() => handleDeleteUser(client.user_id, client.name)}
                  style={{
                    border: "none",
                    background: "#ffebee",
                    color: "#d32f2f",
                    padding: "5px 10px",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Excluir
                </button>
              </CardRow>
            </Card>
          ))
        )}
      </CardList>

      {totalPages > 1 && (
        <PaginationContainer>
          <PaginationButton
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
          >
            <FaChevronLeft size={12} />
          </PaginationButton>

          {generatePagination().map((item, index) =>
            item === "..." ? (
              <Dots key={index}>...</Dots>
            ) : (
              <PaginationButton
                key={index}
                isActive={page === item}
                onClick={() => handlePageChange(item)}
              >
                {item}
              </PaginationButton>
            ),
          )}

          <PaginationButton
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages}
          >
            <FaChevronRight size={12} />
          </PaginationButton>
        </PaginationContainer>
      )}
    </RegisteredClientsContainer>
  );
};

export default RegisteredClients;
