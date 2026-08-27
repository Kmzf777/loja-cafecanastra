import { describe, it, expect, vi, beforeEach } from "vitest";

import { html } from "@/lib/teste/html";
import type { Consentimento } from "@/lib/painel/marketing/consentimentos.logica";

/**
 * A CASCA da tela de público de WhatsApp.
 *
 * A montagem do público inteira vive em `publico.logica.ts`, com 40 casos. O que
 * se prova AQUI é a costura — e ela é a parte perigosa desta tela, porque é onde
 * um deslize manda mensagem para quem pediu para parar de receber:
 *
 *   · que a CONSULTA leia o histórico INTEIRO e não o filtro `estado=concedido`
 *     do backend (que traria de volta quem revogou depois);
 *   · que as duas ressalvas do webhook estejam ESCRITAS na tela;
 *   · que o vazio mande para onde se conserta.
 */

vi.mock("@/lib/conta/painel-servidor", () => ({
  lerAcessoDoPainel: async () => ({
    temSessao: true,
    ehAdmin: true,
    falhouConsulta: false,
    email: "gestao@cafecanastra.com",
    userId: "11111111-1111-1111-1111-111111111111",
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const lerDaApi = vi.fn();
vi.mock("@/lib/painel/api-servidor", () => ({
  lerDaApi: (...args: unknown[]) => lerDaApi(...args),
}));

const { default: PaginaDeWhatsapp } = await import("./page");

let contador = 0;

function linha(sobrescreve: Partial<Consentimento> = {}): Consentimento {
  contador += 1;
  return {
    id: `cccccccc-cccc-cccc-cccc-${String(contador).padStart(12, "0")}`,
    user_id: null,
    email: `pessoa${contador}@exemplo.com`,
    telefone: "(35) 99999-8888",
    canal: "whatsapp",
    estado: "concedido",
    origem: "rodapé do site",
    texto_aceito: null,
    ip: null,
    criado_em: "2026-01-10T12:00:00.000Z",
    ...sobrescreve,
  };
}

function respostaCom(linhas: Consentimento[], total = linhas.length) {
  return { ok: true as const, dados: { data: linhas, total, totalPages: 1, page: 1 } };
}

async function montar() {
  return html(await PaginaDeWhatsapp());
}

beforeEach(() => {
  lerDaApi.mockReset();
  lerDaApi.mockResolvedValue(respostaCom([linha({ email: "ana@ex.com" })]));
});

describe("a leitura do consentimento", () => {
  /**
   * O TESTE MAIS IMPORTANTE DESTA TELA. O backend aceita `?estado=concedido`, e
   * usá-lo pareceria a coisa óbvia — só que `consentimentos` é append-only: o
   * filtro traria de volta a linha «concedido» de janeiro de alguém que revogou
   * em março. A redução ao estado de hoje tem de ser nossa, e por isso a
   * consulta NÃO pode carregar o filtro de estado.
   */
  it("pede o histórico do canal SEM filtrar por estado", async () => {
    await montar();
    const [caminho] = lerDaApi.mock.calls[0];
    expect(caminho).toContain("canal=whatsapp");
    expect(caminho).not.toContain("estado=");
  });

  it("lê da rota de consentimentos, e não de outra", async () => {
    await montar();
    expect(lerDaApi.mock.calls[0][0]).toContain("/admin/consentimentos");
  });
});

describe("o público", () => {
  it("mostra quem consente hoje, com o número pronto para o disparador", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([linha({ email: "ana@ex.com", telefone: "35999998888" })]),
    );
    const saida = await montar();
    expect(saida).toContain("ana@ex.com");
    expect(saida).toContain("5535999998888");
  });

  /** A ponta a ponta do defeito caro: as duas linhas existem no banco, e o
   *  filtro cru do backend deixaria a segunda passar. */
  it("quem revogou depois não aparece no público, e aparece na conta", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([
        linha({
          email: "saiu@ex.com",
          estado: "concedido",
          criado_em: "2026-01-01T12:00:00.000Z",
        }),
        linha({
          email: "saiu@ex.com",
          estado: "revogado",
          criado_em: "2026-03-01T12:00:00.000Z",
        }),
      ]),
    );
    const saida = await montar();
    expect(saida).toContain("Quem ficou de fora");
    expect(saida).toContain("Revogou o consentimento");
  });

  /**
   * Um público que sai de 400 consentimentos e vira 180 números sem dizer o que
   * houve com os outros 220 é indistinguível de um público quebrado.
   */
  it("a conta das exclusões explica cada motivo", async () => {
    lerDaApi.mockResolvedValue(
      respostaCom([
        linha({ email: "a@ex.com", telefone: null }),
        linha({ email: "b@ex.com", telefone: "9999" }),
      ]),
    );
    const saida = await montar();
    expect(saida).toContain("não trouxe telefone");
    expect(saida).toContain("número brasileiro");
  });

  it("sem ninguém de fora, diz isso em vez de mostrar uma lista vazia", async () => {
    expect(await montar()).toContain("Todo consentimento vigente virou um número");
  });
});

describe("as duas ressalvas do webhook, escritas na tela", () => {
  /**
   * A spec §4.6 as registra como "não resolvidas", e esta tela é o único lugar
   * onde o gestor vai encontrá-las. Elas mudam O QUE É SEGURO DISPARAR, e essa
   * decisão se toma antes de escrever a mensagem.
   */
  it("diz que o webhook não tem autenticação", async () => {
    expect(await montar()).toMatch(/não tem autenticação/);
  });

  it("diz que texto livre indica API não-oficial, e o risco disso", async () => {
    const saida = await montar();
    expect(saida).toMatch(/não-oficial/);
    expect(saida).toMatch(/bloqueio/);
  });

  it("diz que o token do painel NÃO vai junto para o host de terceiros", async () => {
    expect(await montar()).toContain("sem o seu token de acesso");
  });

  /** O disparador não escreve de volta: sem esta frase, o gestor procuraria os
   *  disparos na lista de Envios e concluiria que nada saiu. */
  it("avisa que estes envios não aparecem na lista de Envios", async () => {
    expect(await montar()).toContain("não aparecem na lista de Envios");
  });
});

describe("os estados da tela", () => {
  /** O vazio aqui não é "ainda não usaram a tela", é "ninguém autorizou" — e a
   *  frase manda para onde se conserta. */
  it("sem consentimento nenhum, explica e aponta a tela de Consentimentos", async () => {
    lerDaApi.mockResolvedValue(respostaCom([]));
    const saida = await montar();
    expect(saida).toContain("Nenhum consentimento de WhatsApp registrado");
    expect(saida).toContain("/dashboard/marketing/consentimentos");
  });

  it("leitura falhada mostra o erro, e nunca o vazio", async () => {
    lerDaApi.mockResolvedValue({ ok: false, erro: "A API não respondeu." });
    const saida = await montar();
    expect(saida).toContain("A API não respondeu");
    expect(saida).not.toContain("Nenhum consentimento de WhatsApp registrado");
  });

  /**
   * O teto da leitura é UMA página de 100. Ele é aceitável e é DECLARADO: um
   * público silenciosamente incompleto é a pior coisa que esta tela poderia
   * entregar, porque o gestor confere o número e ele parece plausível.
   */
  it("quando a base passa do teto lido, a tela avisa que o público está incompleto", async () => {
    lerDaApi.mockResolvedValue(respostaCom([linha()], 250));
    const saida = await montar();
    expect(saida).toContain("está incompleto");
    expect(saida).toContain("250");
  });

  it("dentro do teto, nenhum aviso de incompletude aparece", async () => {
    expect(await montar()).not.toContain("está incompleto");
  });
});

describe("o disparo", () => {
  it("a caixa de mensagem existe, e diz que a mensagem é a mesma para todos", async () => {
    const saida = await montar();
    expect(saida).toContain("Mensagem e disparo");
    expect(saida).toContain("não há substituição de nome");
  });

  /**
   * NÃO HÁ CAIXA DE COLAR NÚMEROS, de propósito: ela seria um caminho de um
   * clique para contornar a checagem de consentimento, que é a única coisa que
   * esta tela existe para garantir.
   */
  it("não existe campo para digitar números à mão", async () => {
    const saida = await montar();
    expect(saida).not.toContain("Colar números");
    expect(saida).not.toContain("Adicionar número");
  });
});
