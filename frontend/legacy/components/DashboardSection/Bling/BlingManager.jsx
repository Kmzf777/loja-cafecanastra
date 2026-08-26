import { useCallback, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Container,
  Card,
  Title,
  List,
  ListItem,
  Actions,
  ButtonSecondary,
  Select,
  Label,
} from "../Settings/OffersAndCupons/PromotionsManager.style";

import { API_BASE } from "../../../api";
import authContext from "../../../contexts/loginContext/createAuthContext";
import Loading from "../../Loading/Loading";
import {
  ACOES_BLING,
  FILTROS_DA_FILA,
  estadoDoBling,
  filtrarFila,
  mesclarPedido,
} from "@/lib/painel/bling/contrato";
import { buscarStatusDoBling, useBlingAcoes } from "./useBlingAcoes";

/**
 * Bling — a tela que faltava.
 *
 * A integração inteira (pedido de venda, NF-e, rastreio) existia no backend e
 * estava documentada em `docs/bling.md`, mas o painel não tinha um único botão
 * para acioná-la: o runbook mandava "ressincronize com um clique" e o clique
 * não existia em lugar nenhum. Toda a recuperação de falha do Bling — SKU
 * cadastrado depois, nota gerada e não transmitida, rastreio preenchido lá —
 * passa por esses três gestos. Esta tela é onde eles moram.
 *
 * DUAS SEÇÕES, porque são duas perguntas diferentes:
 *
 *   1. A integração está de pé? (`GET /bling/status`) — a pergunta do dia em
 *      que "nada sincroniza e não há nada no log". A sonda responde mesmo com
 *      tudo desligado; é ela que separa "desligado de propósito" de "token
 *      queimado".
 *   2. Que pedidos estão pendentes no ERP? — a fila de trabalho.
 *
 * SOBRE A PAGINAÇÃO E O FILTRO, dito na cara para ninguém se enganar: a fila
 * vem de `GET /admin/orders` (paginado no servidor, sem filtro de Bling nem de
 * status) e o filtro do topo é aplicado SOBRE A PÁGINA CARREGADA. Pedir 50 por
 * página cobre com folga o volume de uma loja de café que despacha algumas
 * dezenas de pedidos por dia — mas com um histórico longo o pendente pode
 * estar na página 3, e a tela diz isso em vez de fingir que a fila acabou.
 * Filtrar no servidor exigiria um parâmetro novo em `/admin/orders`, que é
 * rota compartilhada; quando o volume pedir, é lá que se mexe.
 */

/** Cabe o dia inteiro de despacho numa página, e respeita o teto de 100 do
 * `paginacao()` do OrderController. */
const POR_PAGINA = 50;

const moeda = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const dataBr = (iso) => {
  if (!iso) return "—";
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
};

/** Um "sim/não" com cor — os três interruptores do `.env` no cartão de status. */
function Interruptor({ ligado, rotulo, detalhe }) {
  return (
    <div style={{ fontSize: 14, marginTop: 6 }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          marginRight: 8,
          background: ligado ? "#2e7d32" : "#9e9e9e",
        }}
      />
      <strong>{rotulo}:</strong> {ligado ? "ligado" : "desligado"}
      {detalhe ? (
        <span style={{ color: "#666" }}> — {detalhe}</span>
      ) : null}
    </div>
  );
}

Interruptor.propTypes = {
  ligado: PropTypes.bool,
  rotulo: PropTypes.string,
  detalhe: PropTypes.string,
};

function BlingManager() {
  const { authFetch } = useContext(authContext);

  const [statusBling, setStatusBling] = useState(null);
  const [erroStatus, setErroStatus] = useState(null);
  const [sondando, setSondando] = useState(true);

  const [pedidos, setPedidos] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [totalDePedidos, setTotalDePedidos] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState(FILTROS_DA_FILA[0].chave);

  const sondar = useCallback(async () => {
    setSondando(true);
    const { status, erro: falha } = await buscarStatusDoBling(authFetch);
    setStatusBling(status);
    setErroStatus(falha);
    setSondando(false);
  }, [authFetch]);

  const carregarPedidos = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await authFetch(
        `${API_BASE}/admin/orders?page=${pagina}&limit=${POR_PAGINA}`,
      );
      if (!res.ok) {
        setErro(`Não foi possível carregar os pedidos (erro ${res.status}).`);
        return;
      }
      const dados = await res.json();
      setPedidos(Array.isArray(dados.data) ? dados.data : []);
      setTotalPaginas(dados.totalPages || 1);
      setTotalDePedidos(dados.total || 0);
      setErro(null);
    } catch (err) {
      console.error("Erro ao buscar pedidos para a fila do Bling", err);
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [authFetch, pagina]);

  useEffect(() => {
    sondar();
  }, [sondar]);

  useEffect(() => {
    carregarPedidos();
  }, [carregarPedidos]);

  /**
   * A resposta da ação atualiza a linha — e SÓ a linha. Refetch aqui faria a
   * fila inteira se remontar a cada clique, e o pedido em que o gestor está
   * trabalhando saltaria de lugar (ou sumiria do filtro) embaixo do dedo.
   */
  const aoAtualizarPedido = useCallback((orderId, pedido) => {
    setPedidos((atuais) =>
      atuais.map((p) => (p.order_id === orderId ? mesclarPedido(p, pedido) : p)),
    );
  }, []);

  const { acaoEmAndamento, acionar } = useBlingAcoes({
    authFetch,
    aoAtualizarPedido,
    aoFalhar: setErro,
  });

  const filtroAtual =
    FILTROS_DA_FILA.find((f) => f.chave === filtro) || FILTROS_DA_FILA[0];
  const fila = filtrarFila(pedidos, filtro);

  // Integração desligada é ESTADO CONHECIDO, não erro: os botões não devem
  // prometer o que a rota vai recusar com 503. Enquanto a sonda não responde
  // (ou falha), nada é desabilitado — o servidor continua sendo a autoridade,
  // e a frase dele chega inteira pelo hook.
  const desligada = statusBling ? statusBling.ativo === false : false;

  if (sondando && carregando && pedidos.length === 0) return <Loading />;

  return (
    <Container>
      <Title>Bling — ERP, NF-e e rastreio</Title>

      {/* Tarja de erro padrão do painel (mesmo desenho do Orders/HomeDashboard):
          falha de carregamento OU de ação, persistente e dispensável. */}
      {erro && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            margin: "0 0 4px",
            padding: "10px 14px",
            borderLeft: "3px solid #b3261e",
            background: "#fdf2f1",
            color: "#5c1a14",
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1, minWidth: 200 }}>{erro}</span>
          <ButtonSecondary type="button" onClick={() => setErro(null)}>
            Dispensar
          </ButtonSecondary>
        </div>
      )}

      {/* ---------------------------------------------------------------
          1. Status da integração
          --------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Title as="h3" style={{ marginBottom: 0 }}>
            Status da integração
          </Title>
          <span style={{ flex: 1 }} />
          <ButtonSecondary type="button" disabled={sondando} onClick={sondar}>
            {sondando ? "Conferindo…" : "Conferir de novo"}
          </ButtonSecondary>
        </div>

        {erroStatus ? (
          <p
            role="alert"
            style={{
              margin: "12px 0 0",
              padding: "10px 14px",
              borderLeft: "3px solid #b3261e",
              background: "#fdf2f1",
              color: "#5c1a14",
              fontSize: 14,
            }}
          >
            {erroStatus}
          </p>
        ) : !statusBling ? (
          <p style={{ color: "#888", marginTop: 12 }}>Conferindo…</p>
        ) : (
          <>
            <Interruptor
              ligado={statusBling.ativo === true}
              rotulo="Integração"
              detalhe={
                statusBling.ativo === true
                  ? "pedidos aprovados vão para o Bling"
                  : "nenhuma ação chega ao Bling"
              }
            />
            <Interruptor
              ligado={statusBling.configurado === true}
              rotulo="Credenciais"
              detalhe={
                statusBling.configurado === true
                  ? "BLING_CLIENT_ID/SECRET presentes"
                  : "BLING_CLIENT_ID/BLING_CLIENT_SECRET ausentes"
              }
            />
            <Interruptor
              ligado={statusBling.token?.ok === true}
              rotulo="Token"
              // A frase de erro do token vem do próprio serviço (invalid_grant,
              // rede fora) e é o diagnóstico — repassar é o ponto.
              detalhe={
                statusBling.token?.ok === true
                  ? "renovando normalmente"
                  : statusBling.token?.erro || "não foi possível renovar"
              }
            />
            <Interruptor
              ligado={statusBling.nfeAuto === true}
              rotulo="NF-e automática"
              detalhe={
                statusBling.nfeAuto === true
                  ? "a nota sai junto da sincronização"
                  : "a nota é emitida por aqui, pedido a pedido"
              }
            />
            <Interruptor
              ligado={statusBling.rastreioCron === true}
              rotulo="Busca de rastreio automática"
              detalhe={
                statusBling.rastreioCron === true
                  ? "de hora em hora"
                  : "o rastreio é buscado por aqui"
              }
            />

            {/* Desligada NÃO é erro: é o estado de fábrica (a integração nasce
                atrás de BLING_ATIVO). A tela diz o que ligar e onde ler. */}
            {statusBling.ativo === false && (
              <p
                style={{
                  margin: "16px 0 0",
                  padding: "10px 14px",
                  borderLeft: "3px solid #1976d2",
                  background: "#eef4fb",
                  color: "#123",
                  fontSize: 14,
                }}
              >
                A integração está desligada. Para ligá-la, ponha{" "}
                <code>BLING_ATIVO=true</code> no <code>.env</code> do servidor
                (com <code>BLING_CLIENT_ID</code>,{" "}
                <code>BLING_CLIENT_SECRET</code> e{" "}
                <code>BLING_REFRESH_TOKEN</code>) e reinicie a API — o passo a
                passo completo, incluindo como obter o primeiro token, está em{" "}
                <strong>docs/bling.md</strong>. A loja continua vendendo
                normalmente enquanto isso; os pedidos só não vão ao ERP.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ---------------------------------------------------------------
          2. Fila de pedidos
          --------------------------------------------------------------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Title as="h3" style={{ marginBottom: 0 }}>
            Fila de pedidos
          </Title>
          <span style={{ flex: 1 }} />
          <ButtonSecondary
            type="button"
            disabled={carregando}
            onClick={carregarPedidos}
          >
            {carregando ? "Carregando…" : "Recarregar"}
          </ButtonSecondary>
        </div>

        <p style={{ margin: "8px 0 12px", color: "#666", fontSize: 14 }}>
          Só pedidos pagos (aprovado, enviado, entregue) — os outros o servidor
          recusa, porque venda não paga não vira pedido de venda no ERP.
        </p>

        <Label htmlFor="filtro-bling">Mostrar</Label>
        <Select
          id="filtro-bling"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        >
          {FILTROS_DA_FILA.map((f) => (
            <option key={f.chave} value={f.chave}>
              {f.rotulo}
            </option>
          ))}
        </Select>

        {fila.length === 0 ? (
          <p style={{ color: "#888", marginTop: 12 }}>
            {erro
              ? "Nada para listar."
              : carregando
                ? "Carregando…"
                : filtroAtual.vazio}
          </p>
        ) : (
          <List style={{ marginTop: 16 }}>
            {fila.map((pedido) => {
              const estado = estadoDoBling(pedido);
              const ocupadaAqui = acaoEmAndamento(pedido.order_id);

              return (
                <ListItem
                  key={pedido.order_id}
                  active={estado.chave === "com_nota"}
                  style={{
                    flexWrap: "wrap",
                    gap: 12,
                    alignItems: "flex-start",
                    borderLeftColor: estado.cor,
                  }}
                >
                  <div style={{ minWidth: 240, flex: 1 }}>
                    <strong>…{String(pedido.order_id).slice(-6)}</strong>{" "}
                    <span style={{ color: "#888" }}>
                      {pedido.user_name} · {dataBr(pedido.created_at)} ·{" "}
                      {moeda(pedido.total_amount)}
                    </span>

                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "0.95rem",
                        color: estado.cor,
                        fontWeight: 600,
                      }}
                    >
                      {estado.rotulo}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#666" }}>
                      {estado.detalhe}
                    </div>

                    <div
                      style={{ fontSize: "0.85rem", color: "#666", marginTop: 4 }}
                    >
                      {pedido.bling_sincronizado_em
                        ? `Sincronizado em ${dataBr(pedido.bling_sincronizado_em)} · `
                        : ""}
                      Rastreio:{" "}
                      {pedido.tracking_code || "ainda não informado"}
                    </div>

                    {/* O DANFE, quando existe: é o documento que o gestor
                        precisa abrir/anexar, e o link já vem pronto do Bling. */}
                    {pedido.nfe_url && (
                      <div style={{ fontSize: "0.85rem", marginTop: 4 }}>
                        <a
                          href={pedido.nfe_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#1976d2" }}
                        >
                          Abrir DANFE da NF-e{" "}
                          {pedido.nfe_numero ? `${pedido.nfe_numero}` : ""}
                        </a>
                      </div>
                    )}
                  </div>

                  <Actions style={{ marginTop: 0, flexWrap: "wrap" }}>
                    {ACOES_BLING.map((acao) => {
                      const bloqueadaSemBling =
                        acao.precisaDeSincronia && !pedido.bling_id;
                      const rodando = ocupadaAqui === acao.chave;
                      return (
                        <ButtonSecondary
                          key={acao.chave}
                          type="button"
                          // Qualquer ação em voo NESTE pedido tranca as três
                          // dele — as três mexem na mesma linha do banco.
                          disabled={
                            Boolean(ocupadaAqui) ||
                            desligada ||
                            bloqueadaSemBling
                          }
                          title={
                            desligada
                              ? "A integração está desligada (BLING_ATIVO)."
                              : bloqueadaSemBling
                                ? "Sincronize o pedido com o Bling primeiro."
                                : acao.titulo
                          }
                          onClick={() => acionar(pedido.order_id, acao.chave)}
                        >
                          {rodando ? acao.rotuloOcupado : acao.rotulo}
                        </ButtonSecondary>
                      );
                    })}
                  </Actions>
                </ListItem>
              );
            })}
          </List>
        )}

        {/* A honestidade da paginação: o filtro olha esta página, e a tela diz
            de qual página está falando. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 16,
            fontSize: 14,
            color: "#555",
          }}
        >
          <span>
            {fila.length} de {pedidos.length} pedidos desta página · página{" "}
            {pagina} de {totalPaginas} ({totalDePedidos} pedidos no total). O
            filtro olha só a página carregada.
          </span>
          <span style={{ flex: 1 }} />
          <ButtonSecondary
            type="button"
            disabled={carregando || pagina <= 1}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            Anterior
          </ButtonSecondary>
          <ButtonSecondary
            type="button"
            disabled={carregando || pagina >= totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </ButtonSecondary>
        </div>
      </Card>
    </Container>
  );
}

export default BlingManager;
