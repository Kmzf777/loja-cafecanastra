import { useCallback, useEffect, useState } from "react";
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
import { toast } from "react-toastify";
import Loading from "../../Loading/Loading";
import { clienteNavegador } from "../../../../lib/supabase/cliente";

/**
 * Moderação de avaliações (migração 0014) — aprovar / ocultar.
 *
 * DIFERENTE das telas vizinhas, esta NÃO fala com o Express: vai DIRETO ao
 * PostgREST com o mesmo cliente Supabase que o painel já usa para autenticar
 * (`legacy/api.js` importa o mesmo módulo). Quem decide é a RLS: a política
 * `avaliacoes_admin_le` mostra tudo e a `avaliacoes_admin_modera` + GRANT de
 * coluna deixam mudar SÓ `status` e `moderado_em`. Um não-admin nesta tela
 * vê apenas as aprovadas e atualiza 0 linhas — sem erro (semântica do USING),
 * e é por isso que os updates abaixo pedem `count` e conferem.
 *
 * A avaliação nasce `pendente` e NUNCA aparece na vitrine antes do "Aprovar"
 * daqui. "Ocultar" existe para despublicar sem apagar (DELETE é só do
 * service_role — atendimento, não clique).
 *
 * A TELA É DESENHADA PARA A FILA GRANDE, e as três decisões abaixo são todas
 * a mesma pergunta: "e com 200 pendentes?".
 *
 *   1. PAGINAÇÃO NO SERVIDOR (`.eq("status", …)` + `.range()`), nunca baixar a
 *      tabela inteira para filtrar no navegador. O filtro do topo vira cláusula
 *      SQL; a página traz `POR_PAGINA` linhas e o `count: "exact"` diz quantas
 *      existem no total, que é o número que o gestor quer ver.
 *   2. SELEÇÃO MÚLTIPLA, um único UPDATE. "Aprovar selecionadas" manda um
 *      `update().in("id", ids)` — uma viagem, não uma por avaliação. Aprovar 25
 *      de uma vez é 1 requisição em vez de 25.
 *   3. ESTADO LOCAL depois do sucesso, NUNCA refetch da lista inteira. O
 *      servidor já disse quantas linhas mudou; recarregar tudo a cada clique é
 *      justamente o que torna a fila grande insuportável. O refetch fica para
 *      os dois casos em que o estado local seria mentira: erro, e `count`
 *      diferente do número de ids mandados (a lista mudou embaixo).
 *
 * O QUE A PAGINAÇÃO POR OFFSET CUSTA, dito para ninguém se assustar: moderar
 * desloca as linhas seguintes. Uma avaliação pode escorregar de uma página para
 * a anterior enquanto se trabalha, e o "Mostrando X–Y" fica aproximado depois
 * de uma rodada de moderação. Cursor por `criado_em` resolveria — e seria peso
 * demais para uma tela cuja fila esvazia sozinha à medida que se trabalha.
 */

/** Linhas por página. Cabe numa tela sem rolagem infinita e limita o `.in()`. */
const POR_PAGINA = 25;

/** Explícitas, como no resto do projeto — `*` esconde o que a tela realmente lê. */
const COLUNAS =
  "id, sku, nota, titulo, texto, nome_exibicao, status, criado_em, moderado_em";

const ROTULOS = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  oculta: "Oculta",
};

const dataBr = (iso) => {
  if (!iso) return "";
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR");
};

/**
 * PGRST205/42P01: a tabela não existe no servidor — a migração 0014 ainda não
 * foi aplicada. Dizer isso vale mais que "erro".
 */
const mensagemDeErro = (error) =>
  error.code === "PGRST205" || error.code === "42P01"
    ? "O módulo de avaliações ainda não está instalado neste servidor (migração 0014)."
    : `Não foi possível carregar as avaliações (${error.code || "erro"}).`;

function AvaliacoesManager() {
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendentes, setPendentes] = useState(0);
  const [filtro, setFiltro] = useState("pendente");
  const [pagina, setPagina] = useState(0);
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [primeiraCarga, setPrimeiraCarga] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [moderando, setModerando] = useState(false);

  const carregar = useCallback(async (filtroAlvo, paginaAlvo) => {
    setCarregando(true);
    try {
      const supabase = clienteNavegador();
      const inicio = paginaAlvo * POR_PAGINA;

      // O filtro do topo é cláusula SQL, não `Array.filter` — é a diferença
      // entre pedir 25 linhas e baixar a tabela para jogar fora quase tudo.
      let consulta = supabase
        .from("avaliacoes")
        .select(COLUNAS, { count: "exact" })
        .order("criado_em", { ascending: false })
        .range(inicio, inicio + POR_PAGINA - 1);
      if (filtroAlvo !== "todas") consulta = consulta.eq("status", filtroAlvo);

      const { data, error, count } = await consulta;

      if (error) {
        // PGRST103 (416): a página pedida ficou além do fim — moderar esvaziou
        // o filtro embaixo. Voltar para a primeira é a resposta, não um erro.
        if (error.code === "PGRST103" && paginaAlvo > 0) {
          setPagina(0);
          return;
        }
        setErro(mensagemDeErro(error));
        return;
      }

      setItens(Array.isArray(data) ? data : []);
      setTotal(typeof count === "number" ? count : 0);
      setSelecionadas(new Set());
      setErro(null);

      // A fila de trabalho continua visível mesmo com o filtro em "Aprovadas".
      // `head: true` pede só o cabeçalho de contagem: resposta sem corpo.
      const fila = await supabase
        .from("avaliacoes")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (!fila.error && typeof fila.count === "number") setPendentes(fila.count);
    } catch (err) {
      console.error("Erro ao carregar avaliações", err);
      setErro("Não foi possível falar com o servidor.");
    } finally {
      setCarregando(false);
      setPrimeiraCarga(false);
    }
  }, []);

  useEffect(() => {
    carregar(filtro, pagina);
  }, [carregar, filtro, pagina]);

  const trocarFiltro = (valor) => {
    // Trocar o filtro sem zerar a página cairia na página 3 de uma lista de 1.
    setFiltro(valor);
    setPagina(0);
  };

  const alternarSelecao = (id) =>
    setSelecionadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });

  const selecionarPagina = () =>
    setSelecionadas(new Set(itens.map((a) => a.id)));

  /**
   * Um UPDATE para N avaliações. `ids` já vem filtrado por quem chama para
   * conter só linhas que MUDAM de status — mandar uma linha que já está no
   * status alvo faria `count` menor que `ids.length` e disparava o refetch de
   * segurança à toa.
   */
  const moderar = async (ids, novoStatus) => {
    if (moderando || ids.length === 0) return;

    const alvos = new Set(ids);
    // Quantas SAEM da fila — para descontar do contador sem perguntar de novo.
    const eramPendentes = itens.filter(
      (a) => alvos.has(a.id) && a.status === "pendente",
    ).length;

    setModerando(true);
    const carimbo = new Date().toISOString();
    try {
      // `moderado_em` vai JUNTO: não há trigger de moddatetime no schema —
      // quem muda o status escreve o carimbo (regra de 0005/0014).
      const { error, count } = await clienteNavegador()
        .from("avaliacoes")
        .update(
          { status: novoStatus, moderado_em: carimbo },
          { count: "exact" },
        )
        .in("id", ids);

      if (error) throw new Error(error.message || `Erro ${error.code || ""}`);
      if (!count) {
        // A RLS filtrou as linhas em silêncio: a sessão não é de administrador
        // (ou as avaliações sumiram). Sem esta checagem o toast mentiria sucesso.
        throw new Error(
          "Nada foi atualizado — confira se sua conta é de administrador.",
        );
      }

      const verbo = novoStatus === "aprovada" ? "aprovada" : "oculta";
      toast.success(
        count === 1 ? `Avaliação ${verbo}.` : `${count} avaliações ${verbo}s.`,
      );

      if (count !== ids.length) {
        // Parte das linhas escapou e não dá para saber QUAL sem perguntar —
        // este é o caso em que o estado local viraria mentira. Aqui o refetch
        // é o certo, e é o único caminho que ainda faz um.
        await carregar(filtro, pagina);
        return;
      }

      // O caminho comum: o servidor confirmou, a tela se atualiza sozinha.
      setItens((atual) => {
        const atualizados = atual.map((a) =>
          alvos.has(a.id)
            ? { ...a, status: novoStatus, moderado_em: carimbo }
            : a,
        );
        // Com filtro por status, a linha moderada deixa de pertencer à lista.
        return filtro === "todas"
          ? atualizados
          : atualizados.filter((a) => a.status === filtro);
      });
      if (filtro !== "todas") setTotal((t) => Math.max(0, t - count));
      if (novoStatus !== "pendente") {
        setPendentes((p) => Math.max(0, p - eramPendentes));
      }
      setSelecionadas((atual) => {
        const proxima = new Set(atual);
        for (const id of ids) proxima.delete(id);
        return proxima;
      });
    } catch (err) {
      console.error("Erro ao moderar avaliação", err);
      toast.error(err.message || "Erro ao atualizar a avaliação.");
    } finally {
      setModerando(false);
    }
  };

  /** "Aprovar/Ocultar selecionadas": só as que realmente mudam de status. */
  const moderarSelecionadas = (novoStatus) => {
    const ids = itens
      .filter((a) => selecionadas.has(a.id) && a.status !== novoStatus)
      .map((a) => a.id);
    if (ids.length === 0) {
      toast.info(`Nenhuma das selecionadas ficaria ${ROTULOS[novoStatus].toLowerCase()}.`);
      return;
    }
    moderar(ids, novoStatus);
  };

  const marcadas = itens.filter((a) => selecionadas.has(a.id)).length;
  const primeiroDaPagina = itens.length === 0 ? 0 : pagina * POR_PAGINA + 1;
  const ultimoDaPagina = pagina * POR_PAGINA + itens.length;
  const haMais = (pagina + 1) * POR_PAGINA < total;
  const ocupado = carregando || moderando;

  if (primeiraCarga) return <Loading />;

  return (
    <Container>
      <Title>Avaliações de Clientes</Title>

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
          {erro} A lista abaixo pode estar desatualizada — recarregue a página.
        </p>
      )}

      <Card>
        <Title as="h3">
          Moderação{pendentes ? ` — ${pendentes} pendente(s)` : ""}
        </Title>
        <p style={{ margin: "0 0 12px", color: "#666", fontSize: 14 }}>
          Avaliação só aparece na loja depois de aprovada. Ocultar despublica
          sem apagar.
        </p>

        <Label htmlFor="filtro-avaliacoes">Mostrar</Label>
        <Select
          id="filtro-avaliacoes"
          value={filtro}
          disabled={moderando}
          onChange={(e) => trocarFiltro(e.target.value)}
        >
          <option value="pendente">Pendentes</option>
          <option value="aprovada">Aprovadas</option>
          <option value="oculta">Ocultas</option>
          <option value="todas">Todas</option>
        </Select>

        {itens.length === 0 ? (
          <p style={{ color: "#888", marginTop: 12 }}>
            {erro
              ? "Nada para listar."
              : carregando
                ? "Carregando…"
                : filtro === "pendente"
                  ? "Nenhuma avaliação aguardando moderação."
                  : "Nenhuma avaliação neste filtro."}
          </p>
        ) : (
          <>
            {/* Barra de lote: uma viagem ao servidor para o que estiver marcado. */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                margin: "12px 0",
                padding: "8px 12px",
                background: "#f4f5f7",
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              <span style={{ color: "#555" }}>
                {marcadas
                  ? `${marcadas} selecionada(s)`
                  : "Marque avaliações para moderar em lote"}
              </span>
              <span style={{ flex: 1 }} />
              <ButtonSecondary
                type="button"
                disabled={ocupado || marcadas === itens.length}
                onClick={selecionarPagina}
              >
                Selecionar página
              </ButtonSecondary>
              <ButtonSecondary
                type="button"
                disabled={ocupado || marcadas === 0}
                onClick={() => setSelecionadas(new Set())}
              >
                Limpar
              </ButtonSecondary>
              <ButtonSecondary
                type="button"
                disabled={ocupado || marcadas === 0}
                onClick={() => moderarSelecionadas("aprovada")}
              >
                Aprovar selecionadas
              </ButtonSecondary>
              <ButtonSecondary
                type="button"
                disabled={ocupado || marcadas === 0}
                onClick={() => moderarSelecionadas("oculta")}
              >
                Ocultar selecionadas
              </ButtonSecondary>
            </div>

            <List>
              {itens.map((a) => (
                <ListItem key={a.id} active={a.status === "aprovada"}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selecionadas.has(a.id)}
                      disabled={ocupado}
                      onChange={() => alternarSelecao(a.id)}
                      aria-label={`Selecionar avaliação de ${a.nome_exibicao} sobre ${a.sku}`}
                      style={{ marginTop: 4, cursor: "pointer" }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <strong>{a.nome_exibicao}</strong> — nota {a.nota}/5 ·{" "}
                      {ROTULOS[a.status] || a.status}
                      <div style={{ fontSize: "0.85rem", color: "#666" }}>
                        SKU: {a.sku} · Enviada em {dataBr(a.criado_em)}
                        {a.moderado_em
                          ? ` · Moderada em ${dataBr(a.moderado_em)}`
                          : ""}
                      </div>
                      {a.titulo && (
                        <div style={{ fontSize: "0.95rem", marginTop: 4 }}>
                          <strong>{a.titulo}</strong>
                        </div>
                      )}
                      {/* Texto COMPLETO, sem reticências: moderar exige ler tudo. */}
                      {a.texto && (
                        <div
                          style={{
                            fontSize: "0.9rem",
                            color: "#444",
                            marginTop: 4,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {a.texto}
                        </div>
                      )}
                    </div>
                  </div>
                  <Actions>
                    {a.status !== "aprovada" && (
                      <ButtonSecondary
                        type="button"
                        disabled={ocupado}
                        onClick={() => moderar([a.id], "aprovada")}
                      >
                        Aprovar
                      </ButtonSecondary>
                    )}
                    {a.status !== "oculta" && (
                      <ButtonSecondary
                        type="button"
                        disabled={ocupado}
                        onClick={() => moderar([a.id], "oculta")}
                      >
                        Ocultar
                      </ButtonSecondary>
                    )}
                  </Actions>
                </ListItem>
              ))}
            </List>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 16,
                fontSize: 14,
                color: "#555",
              }}
            >
              <span>
                Mostrando {primeiroDaPagina}–{ultimoDaPagina} de {total}
              </span>
              <span style={{ flex: 1 }} />
              <ButtonSecondary
                type="button"
                disabled={ocupado || pagina === 0}
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
              >
                Anterior
              </ButtonSecondary>
              <ButtonSecondary
                type="button"
                disabled={ocupado || !haMais}
                onClick={() => setPagina((p) => p + 1)}
              >
                Próxima
              </ButtonSecondary>
            </div>
          </>
        )}
      </Card>
    </Container>
  );
}

export default AvaliacoesManager;
