import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor, within } from "@testing-library/react";

import { renderizar } from "@/lib/teste/renderizar";
import { URL_DE_CALLBACK } from "@/lib/painel/bling/conexao.logica";

/**
 * A TELA DE CONEXÃO COM O BLING, com DOM de verdade.
 *
 * A DECISÃO ESTÁ TODA EM `lib/painel/bling/conexao.logica.ts` — em que passo a
 * conexão está, e que frase mostrar quando o callback volta com erro. Aqueles 8
 * casos rodam em `node`, sem navegador. O que sobra para cá é o que só existe
 * quando o JSX é montado e os efeitos rodam, e é exatamente o que
 * `renderToStaticMarkup` não alcançaria:
 *
 *   · que a tela mostre UM ESTADO POR VEZ, com a ação daquele estado e nada
 *     mais — nunca quatro botões dos quais três recusariam;
 *   · que "Conectar" NAVEGUE de verdade para a URL que o servidor devolveu;
 *   · que a frase de erro que o callback trouxe na URL apareça INTEIRA;
 *   · que um clique TRANQUE o botão até a resposta chegar (a trava de
 *     `useAcoesDoBling`, que é `useRef` e não `useState` — migrá-la para estado
 *     reintroduz a corrida sem nenhum sintoma em teste manual).
 *
 * O BACKEND AINDA NÃO EXISTE, e não precisa: o contrato das rotas está fixado
 * no plano (`docs/superpowers/plans/2026-09-16-conexao-bling.md`, seção "O
 * CONTRATO DAS ROTAS"), e é contra ele que estes dublês respondem. Se o backend
 * nascer divergindo, é aqui que se vê.
 */

/**
 * O DUBLÊ É O TRANSPORTE, e não o `fetch` global — mesmo padrão de
 * `pedidos/ListaDePedidos.test.tsx`.
 *
 * `chamarApi` é o único jeito de o painel falar com o Express do navegador, e
 * ele carrega por baixo o `authFetch`, que vai ao Supabase buscar o token e
 * renova a sessão no 401. Dublar `globalThis.fetch` obrigaria a montar uma
 * sessão falsa do supabase-js só para o teste chegar à primeira asserção — e
 * estaria testando o transporte, que já tem os próprios 20 casos em
 * `lib/painel/transporte.test.ts`.
 */
const chamarApi = vi.fn();
vi.mock("@/lib/painel/transporte", () => ({
  chamarApi: (...args: unknown[]) => chamarApi(...args),
  authFetch: vi.fn(),
  BASE_DA_API: "http://api.teste",
}));

const { TelaDeConexao: PaginaDoBling } = await import("./TelaDeConexao");

/** Uma resposta HTTP de verdade — `lerCorpo` faz `res.json()` nela. */
function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * O dublê responde por MÉTODO + CAMINHO, nunca por ordem de chamada.
 *
 * A tela relê `/bling/status` depois de gravar, então a mesma rota é chamada
 * mais de uma vez — um dublê posicional (`mockResolvedValueOnce` em fila)
 * passaria a mentir no dia em que uma ação a mais fosse acrescentada, e a
 * mentira apareceria como um erro sem relação nenhuma com a mudança.
 *
 * Rota não prevista LANÇA em vez de devolver vazio: um `undefined` silencioso
 * viraria "a tela não carregou" três asserções adiante.
 */
function responder(mapa: Record<string, () => Promise<Response>>) {
  chamarApi.mockImplementation((caminho: string, metodo = "GET") => {
    const chave = `${metodo} ${caminho}`;
    const rota = mapa[chave];
    if (!rota) throw new Error(`rota não prevista no teste: ${chave}`);
    return rota();
  });
}

const SEM_CREDENCIAIS = { temCredenciais: false, conectado: false, ativo: false };
const SO_CREDENCIAIS = { temCredenciais: true, conectado: false, ativo: false };
const LIGADA = { temCredenciais: true, conectado: true, ativo: true };

const status = (corpo: unknown) => async () => resposta(200, corpo);

/** O repositório não tem `@testing-library/jest-dom` (nem `setupFiles`), então
 *  `disabled` e `checked` se leem do próprio nó. */
const travado = (no: HTMLElement) => (no as HTMLButtonElement).disabled;
const marcado = (no: HTMLElement) => (no as HTMLInputElement).checked;

beforeEach(() => {
  chamarApi.mockReset();
  /* A URL volta ao normal entre casos: o caso do erro do callback escreve nela,
     e um `?erro=` vazado para o caso seguinte faria a tarja aparecer onde
     ninguém a pediu — vermelho que ninguém explica é como se aprende a ignorar
     vermelho. */
  window.history.replaceState({}, "", "/dashboard/bling");
});

/* ========================================================================== */

describe("tela de conexão com o Bling", () => {
  /**
   * O ESTADO DE FÁBRICA. Sem credencial não há o que autorizar, então a tela
   * mostra o que o gestor precisa para criar o aplicativo no Bling — os escopos
   * a marcar e a URL a colar lá — e só depois os dois campos.
   *
   * A URL É CONFERIDA CARACTERE POR CARACTERE, contra a constante do módulo
   * puro: o Bling não aceita `redirect_uri` como parâmetro, ele usa a que está
   * CADASTRADA no aplicativo, e um caractere de diferença rende uma recusa
   * genérica que não diz o que está errado.
   */
  it("sem credenciais, mostra o formulário e os escopos", async () => {
    responder({ "GET /bling/status": status(SEM_CREDENCIAIS) });

    const { findByLabelText, getByLabelText, getByText, queryByRole } = renderizar(
      <PaginaDoBling />,
    );

    expect(await findByLabelText(/client id/i)).toBeTruthy();
    expect(getByText("Notas Fiscais Eletrônicas")).toBeTruthy();
    expect(getByText(URL_DE_CALLBACK)).toBeTruthy();

    /* O Secret emite nota fiscal e mexe em estoque: ele não fica legível na
       tela de quem estiver passando atrás da cadeira. */
    expect(getByLabelText(/client secret/i).getAttribute("type")).toBe("password");

    /* UM ESTADO POR VEZ: aqui não há o que autorizar nem o que ligar, então
       "Conectar", o interruptor e "Desconectar" não existem na árvore. Botão
       que recusaria o clique é pior que botão nenhum. */
    expect(queryByRole("button", { name: "Conectar" })).toBeNull();
    expect(queryByRole("switch")).toBeNull();
    expect(queryByRole("button", { name: "Desconectar" })).toBeNull();
  });

  /**
   * O BOTÃO CONECTAR É UM REDIRECT DE PÁGINA INTEIRA, e a navegação sai pela
   * prop `aoNavegar` (em produção, `window.location.assign`) justamente para
   * que este caso possa observá-la: o jsdom não navega, e um `location.assign`
   * de verdade só imprimiria "Not implemented: navigation" no stderr.
   */
  it("com credenciais e sem conexão, o botão Conectar leva ao Bling", async () => {
    responder({
      "GET /bling/status": status(SO_CREDENCIAIS),
      "POST /bling/conexao/iniciar": async () =>
        resposta(200, {
          url:
            "https://www.bling.com.br/Api/v3/oauth/authorize" +
            "?response_type=code&client_id=meu-id&state=abc123",
        }),
    });

    const irPara = vi.fn();
    const { usuario, findByRole } = renderizar(<PaginaDoBling aoNavegar={irPara} />);

    /* `^conectar$` e não `/conectar/i`: "Desconectar" CONTÉM "conectar", e um
       casamento por trecho aqui passaria a pegar o botão errado no dia em que
       os dois convivessem na mesma tela. */
    await usuario.click(await findByRole("button", { name: /^conectar$/i }));

    await waitFor(() =>
      expect(irPara).toHaveBeenCalledWith(
        expect.stringContaining("bling.com.br/Api/v3/oauth/authorize"),
      ),
    );
  });

  /**
   * A REGRA MAIS FORTE DESTA TELA: a frase do servidor chega INTEIRA.
   *
   * O callback volta por `302 /dashboard/bling?erro=<frase>`, e é nessa frase
   * que está o diagnóstico — qual credencial falhou, que o `code` expirou, o
   * que o Bling respondeu. Trocá-la por "erro ao conectar" joga fora exatamente
   * o que resolveria o problema.
   */
  it("o erro que o callback trouxe aparece INTEIRO", async () => {
    const frase = "O Bling recusou: o code expirou. Clique em Conectar de novo.";
    window.history.replaceState(
      {},
      "",
      `/dashboard/bling?erro=${encodeURIComponent(frase)}`,
    );
    responder({ "GET /bling/status": status(SO_CREDENCIAIS) });

    const { findByText } = renderizar(<PaginaDoBling />);

    expect(await findByText(frase)).toBeTruthy();
  });

  /**
   * CONECTADA: o interruptor e o Desconectar, e mais nada — o formulário de
   * credenciais sai da tela, porque a pergunta que ele responde já foi
   * respondida.
   *
   * DESCONECTAR FICA ATRÁS DE UMA CONFIRMAÇÃO (R12): apaga a autorização e
   * desliga a integração, e a frase do diálogo carrega a CONSEQUÊNCIA em vez de
   * perguntar "tem certeza?", que não informa nada e treina a clicar em OK.
   */
  it("conectado, oferece desligar e desconectar", async () => {
    responder({ "GET /bling/status": status(LIGADA) });

    const { usuario, findByRole, getByRole, queryByLabelText } = renderizar(
      <PaginaDoBling />,
    );

    const desconectar = await findByRole("button", { name: "Desconectar" });
    expect(desconectar).toBeTruthy();
    expect(marcado(getByRole("switch"))).toBe(true);

    // Um estado por vez: cadastrar credencial não é assunto de quem já conectou.
    expect(queryByLabelText(/client secret/i)).toBeNull();

    /* O clique ABRE A CONFIRMAÇÃO e não desconecta nada — se o `DELETE` saísse
       daqui, o diálogo seria enfeite. */
    await usuario.click(desconectar);
    const dialogo = getByRole("dialog");
    expect(within(dialogo).getByRole("button", { name: /desconectar/i })).toBeTruthy();
    expect(chamarApi).not.toHaveBeenCalledWith("/bling/conexao", "DELETE");
  });

  /**
   * A TRAVA DE DUPLO CLIQUE. `POST /bling/conexao/iniciar` fica pendurado, e o
   * botão tem de estar trancado ANTES de a resposta chegar.
   *
   * Sem ela, dois cliques viram dois `state` gerados no servidor e duas idas ao
   * Bling — e o segundo redirect atropela o primeiro. `useState` não serve como
   * trava aqui: ele é assíncrono, e dois cliques no mesmo tick leem o mesmo
   * estado "livre". A trava é `useRef`; o estado é só a fotografia que repinta.
   */
  it("um clique tranca o botão até a resposta chegar", async () => {
    responder({
      "GET /bling/status": status(SO_CREDENCIAIS),
      // Nunca resolve: é a resposta que ainda está a caminho.
      "POST /bling/conexao/iniciar": () => new Promise<Response>(() => {}),
    });

    const { usuario, findByRole } = renderizar(<PaginaDoBling />);
    const botao = await findByRole("button", { name: /^conectar$/i });

    await usuario.click(botao);

    expect(travado(botao)).toBe(true);
    expect(
      chamarApi.mock.calls.filter((c) => c[0] === "/bling/conexao/iniciar"),
    ).toHaveLength(1);
  });
});
